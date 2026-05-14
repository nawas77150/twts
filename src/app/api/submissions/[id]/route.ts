import { db } from '@/lib/db'
import { postTweetViaCookie } from '@/lib/twitter-post-cookie'
import { verifyAdmin } from '@/lib/admin-auth'
import { debug } from '@/lib/debug'
import { acquirePostingLock, releasePostingLock } from '@/lib/posting-lock'
import { recordPostSuccess, recordPostFailure } from '@/lib/circuit-breaker'
import { getFilterSettings } from '@/app/api/admin/filter-settings/route'
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

  try {
    const { id } = await params
    const body = await req.json()
    const { status } = body

    if (!['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'Status tidak valid' }, { status: 400 })
    }

    const submission = await db.submission.findUnique({ where: { id } })
    if (!submission) {
      return NextResponse.json({ error: 'Submission tidak ditemukan' }, { status: 404 })
    }

    if (submission.status !== 'pending' && submission.status !== 'post_failed') {
      return NextResponse.json(
        { error: `Submission sudah ${submission.status}` },
        { status: 400 }
      )
    }

    // If approving, auto-post to X via cookie auth (with retry + fallback)
    if (status === 'approved') {
      // Acquire distributed lock — only one post to X at a time
      const lockValue = await acquirePostingLock()
      if (!lockValue) {
        debug('[approve route] Posting lock busy')
        return NextResponse.json(
          { error: 'Sedang ada posting lain yang berjalan. Coba lagi dalam beberapa detik.' },
          { status: 409 }
        )
      }

      try {
        debug('[approve route] Approving submission:', id, 'message length:', submission.message.length)
        const tweetResult = await postTweetViaCookie(submission.message)

        if (tweetResult.success) {
          debug('[approve route] Post succeeded! tweetId:', tweetResult.tweetId, 'method:', tweetResult.method)
          const updated = await db.submission.update({
            where: { id },
            data: {
              status: 'posted',
              tweetId: tweetResult.tweetId || null,
              postMethod: tweetResult.method,
            },
          })

          // Reset circuit breaker on success
          await recordPostSuccess()

          // Build descriptive message based on method used
          let description = ''
          if (tweetResult.method === 'direct') {
            description = 'Pesan otomatis diposting ke X.'
          } else if (tweetResult.method === 'retry') {
            description = `Pesan diposting setelah retry (${tweetResult.retriesUsed}x).`
          } else if (tweetResult.method === 'fallback') {
            description = 'Pesan diposting via fallback API.'
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
          const errorMsg = tweetResult.error || ''
          const updated = await db.submission.update({
            where: { id },
            data: { status: 'post_failed', postError: errorMsg },
          })

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
      } finally {
        await releasePostingLock(lockValue)
      }
    }

    // Reject
    const updated = await db.submission.update({
      where: { id },
      data: { status: 'rejected' },
    })

    return NextResponse.json({ submission: updated })
  } catch {
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

    await db.submission.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
