import { db } from '@/lib/db'
import { postTweetViaCookie } from '@/lib/twitter-post-cookie'
import { verifyAdmin } from '@/lib/admin-auth'
import { debug } from '@/lib/debug'
import { decodeHtmlEntities } from '@/lib/content-filter'
import { acquirePostingLock, releasePostingLock } from '@/lib/posting-lock'
import { recordPostSuccess, recordPostFailure } from '@/lib/circuit-breaker'
import { getFilterSettings } from '@/app/api/admin/filter-settings/route'
import { checkStalePosting } from '@/lib/stale-posting'
import { NextRequest, NextResponse } from 'next/server'

// Vercel serverless function timeout — approve+post can take up to 15s with retries
export const maxDuration = 30

// PATCH /api/submissions/[id] - Approve (auto-post) or reject
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  // Declare lockValue outside try so outer catch can release it on error
  // (e.g. if updateMany throws between lock acquisition and inner try/finally)
  let lockValue: string | null = null

  try {
    const { id } = await params
    const body = await req.json()
    const { status } = body

    if (!['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'Status tidak valid' }, { status: 400 })
    }

    let submission = await db.submission.findUnique({ where: { id } })
    if (!submission) {
      return NextResponse.json({ error: 'Submission tidak ditemukan' }, { status: 404 })
    }

    if (submission.status === 'posted') {
      return NextResponse.json(
        { error: 'Submission sudah diposting' },
        { status: 400 }
      )
    }

    if (submission.status === 'posting') {
      const stale = await checkStalePosting(submission)
      if (!stale.isStale) {
        return NextResponse.json(
          { error: 'Submission sedang diproses (posting ke X). Coba lagi dalam beberapa menit.' },
          { status: 409 }
        )
      }
      // Stale posting auto-recovered — re-fetch with updated status and fall through.
      // The submission is now post_failed, so the pending/post_failed check will pass.
      const refreshed = await db.submission.findUnique({ where: { id } })
      if (!refreshed) {
        return NextResponse.json({ error: 'Submission tidak ditemukan' }, { status: 404 })
      }
      submission = refreshed
    }

    if (submission.status === 'rejected') {
      return NextResponse.json(
        { error: 'Submission sudah ditolak' },
        { status: 400 }
      )
    }

    if (submission.status !== 'pending' && submission.status !== 'post_failed') {
      return NextResponse.json(
        { error: `Status tidak valid: ${submission.status}` },
        { status: 400 }
      )
    }

    // If approving, auto-post to X via cookie auth (with retry + fallback)
    if (status === 'approved') {
      // Acquire distributed lock — only one post to X at a time
      lockValue = await acquirePostingLock()
      if (!lockValue) {
        debug('[approve route] Posting lock busy')
        return NextResponse.json(
          { error: 'Sedang ada posting lain yang berjalan. Coba lagi dalam beberapa detik.' },
          { status: 409 }
        )
      }

      // Mark as "posting" before calling X API — prevents double-post race condition
      const marked = await db.submission.updateMany({
        where: { id, status: { in: ['pending', 'post_failed'] } },
        data: { status: 'posting' },
      })
      if (marked.count === 0) {
        debug('[approve route] Submission status changed before posting, aborting')
        await releasePostingLock(lockValue)
        return NextResponse.json(
          { error: 'Submission sedang diproses oleh proses lain.' },
          { status: 409 }
        )
      }

      try {
        debug('[approve route] Approving submission:', id, 'message length:', submission.message.length)
        const tweetResult = await postTweetViaCookie(decodeHtmlEntities(submission.message))

        if (tweetResult.success) {
          debug('[approve route] Post succeeded! tweetId:', tweetResult.tweetId, 'method:', tweetResult.method)
          // Only update if still "posting" — prevents overwriting concurrent status changes
          const result = await db.submission.updateMany({
            where: { id, status: 'posting' },
            data: {
              status: 'posted',
              tweetId: tweetResult.tweetId || null,
              postMethod: tweetResult.method,
              postError: null, // Clear any previous error on success
            },
          })

          // Reset circuit breaker on success
          await recordPostSuccess()

          if (result.count === 0) {
            debug('[approve route] Post succeeded but status was changed by another process')
            return NextResponse.json({
              autoPosted: true,
              tweetId: tweetResult.tweetId,
              postMethod: tweetResult.method,
              warning: 'Tweet posted, but submission status was changed by another process.',
            })
          }

          const updated = await db.submission.findUnique({ where: { id } })

          // Build descriptive message based on method used
          let description = ''
          if (tweetResult.method === 'direct') {
            description = 'Pesan otomatis diposting ke X.'
          } else if (tweetResult.method === 'retry') {
            description = `Pesan diposting setelah retry (${tweetResult.retriesUsed}x).`
          } else if (tweetResult.method === 'fallback_cookie') {
            description = 'Pesan diposting via Cookie API (twitterapi.io).'
          } else if (tweetResult.method === 'fallback_login') {
            description = 'Pesan diposting via V2 Login API (twitterapi.io).'
          }

          return NextResponse.json({
            submission: updated,
            autoPosted: true,
            tweetId: tweetResult.tweetId,
            postMethod: tweetResult.method,
            description,
          })
        } else {
          debug('[approve route] Post failed:', tweetResult.error, 'method:', tweetResult.method)
          // Cookie + retry + fallback all failed — mark as post_failed with error details
          // Only update if still "posting" — prevents overwriting concurrent status changes
          const errorMsg = tweetResult.error || ''
          await db.submission.updateMany({
            where: { id, status: 'posting' },
            data: { status: 'post_failed', postError: errorMsg },
          })
          const updated = await db.submission.findUnique({ where: { id } })

          // Record failure for circuit breaker
          try {
            const settings = await getFilterSettings()
            await recordPostFailure(settings.rateLimits)
          } catch { /* best effort */ }

          // Context-aware hint based on error type
          let hint = ''
          if (errorMsg.includes('code: 344') || errorMsg.includes('daily limit')) {
            hint = 'Batas harian tweet tercapai. Coba lagi besok.'
          } else if (errorMsg.includes('code: 32') || errorMsg.includes('Could not authenticate')) {
            hint = 'Cookie expired. Perbarui cookie di X Settings lalu klik "Post to X".'
          } else if (errorMsg.includes('code: 88') || errorMsg.includes('Rate limit')) {
            hint = 'Rate limit tercapai. Tunggu beberapa menit lalu coba lagi.'
          } else if (errorMsg.includes('226') || errorMsg.includes('automated')) {
            hint = 'X mendeteksi otomatisasi (226). Semua retry gagal. Coba lagi dalam 1-2 menit.'
          } else if (errorMsg.includes('Empty tweet_results') || errorMsg.includes('silently rejected')) {
            hint = 'Tweet ditolak X (empty results). Semua retry gagal. Coba lagi dalam 1-2 menit.'
          } else if (errorMsg.includes('Fallback API') || errorMsg.includes('fallback')) {
            hint = 'Direct post gagal, fallback API juga gagal. Periksa API keys dan cookie.'
          } else {
            hint = 'Cek X Settings lalu klik "Post to X" untuk retry.'
          }

          return NextResponse.json({
            submission: updated,
            autoPosted: false,
            error: `Disetujui, tapi gagal posting ke X: ${errorMsg}. ${hint}`,
            postMethod: tweetResult.method,
          })
        }
      } catch (postError) {
        // postTweetViaCookie threw — mark as post_failed
        const errorMsg = postError instanceof Error ? postError.message : String(postError)
        debug('[approve route] Post exception, marking as post_failed:', errorMsg)
        await db.submission.updateMany({
          where: { id, status: 'posting' },
          data: { status: 'post_failed', postError: errorMsg },
        })
        const updated = await db.submission.findUnique({ where: { id } })
        try {
          const settings = await getFilterSettings()
          await recordPostFailure(settings.rateLimits)
        } catch { /* best effort */ }
        return NextResponse.json({
          submission: updated,
          autoPosted: false,
          error: `Gagal posting ke X: ${errorMsg}`,
        }, { status: 502 })
      } finally {
        await releasePostingLock(lockValue!)
        lockValue = null // Mark as released so outer catch doesn't double-release
      }
    }

    // Reject — conditional update prevents overwriting if status changed
    // between our fetch and this write (e.g. another admin approved it).
    const rejectResult = await db.submission.updateMany({
      where: { id, status: { in: ['pending', 'post_failed'] } },
      data: { status: 'rejected' },
    })
    if (rejectResult.count === 0) {
      return NextResponse.json({ error: 'Status berubah — coba refresh halaman.' }, { status: 409 })
    }
    const updated = await db.submission.findUnique({ where: { id } })

    return NextResponse.json({ submission: updated })
  } catch (e) {
    // Release lock if it was acquired but not yet released by inner finally
    // (e.g. updateMany threw between lock acquisition and inner try/finally)
    if (lockValue) {
      await releasePostingLock(lockValue).catch(() => {})
    }
    console.error('[submissions] Reject error:', e)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}

// DELETE /api/submissions/[id] - Delete a submission
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  try {
    const { id } = await params

    const submission = await db.submission.findUnique({ where: { id } })
    if (!submission) {
      return NextResponse.json({ error: 'Submission tidak ditemukan' }, { status: 404 })
    }

    // Prevent deleting a submission that is currently being posted to X
    // (would orphan the tweet — it posts but we lose the record)
    // However, if the posting is stale (>2 min), auto-recover so the admin can delete.
    if (submission.status === 'posting') {
      const stale = await checkStalePosting(submission)
      if (!stale.isStale) {
        return NextResponse.json({ error: 'Tidak bisa menghapus pesan yang sedang diposting. Coba lagi dalam beberapa menit.' }, { status: 409 })
      }
      // Stale posting auto-recovered — fall through to delete below.
      // WARNING: The tweet may have been posted to X before the crash.
      // Deleting the DB record means we lose track of it — but the admin
      // is explicitly choosing to delete, so this is acceptable.
    }

    // Conditional delete — only succeeds if status is not 'posting'.
    // Prevents the race where checkStalePosting recovers an old 'posting',
    // but another process has since set a fresh 'posting' (e.g. admin approved).
    const deleted = await db.submission.deleteMany({
      where: { id, status: { not: 'posting' } },
    })
    if (deleted.count === 0) {
      return NextResponse.json({ error: 'Tidak bisa menghapus pesan yang sedang diposting. Coba lagi dalam beberapa menit.' }, { status: 409 })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[submissions] Delete error:', e)
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
