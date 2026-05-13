import { db } from '@/lib/db'
import { getSubmitterFromNextRequest } from '@/lib/twitter-auth'
import { postTweetViaCookie } from '@/lib/twitter-post-cookie'
import { verifyAdmin } from '@/lib/admin-auth'
import { debug } from '@/lib/debug'
import { runContentFilter, checkDuplicate24h, DEFAULT_BLOCKED_WORDS, DEFAULT_NSFW_WORDS, DEFAULT_FILTER_RULES } from '@/lib/content-filter'
import { runGeminiFilter } from '@/lib/gemini-filter'
import { getFilterSettings, getGeminiApiKey } from '@/app/api/admin/filter-settings/route'
import { NextRequest, NextResponse } from 'next/server'

// Vercel serverless function timeout — auto-post + Gemini can take up to 15s with retries
export const maxDuration = 30

// GET /api/submissions - List all submissions (admin only, includes submitter info)
export async function GET(req: NextRequest) {
  const auth = verifyAdmin(req.headers.get('authorization'))
  if (!auth.authorized) return auth.response

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')

  const where = status && status !== 'all' ? { status } : {}

  const submissions = await db.submission.findMany({
    where,
    include: {
      submitter: {
        select: { id: true, username: true, displayName: true, profileImage: true, twitterId: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ submissions })
}

// POST /api/submissions - Create new submission (requires Twitter login)
// When auto-approve is ON and both filters pass, submission is auto-posted to X
export async function POST(req: NextRequest) {
  try {
    // Get submitter from session cookie (Twitter OAuth)
    const submitter = await getSubmitterFromNextRequest(req)

    if (!submitter) {
      return NextResponse.json({ error: 'Silakan login dengan akun X terlebih dahulu' }, { status: 401 })
    }

    const body = await req.json()
    const { message, category } = body

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Pesan wajib diisi' }, { status: 400 })
    }

    const trimmedMessage = message.trim()

    if (trimmedMessage.length === 0) {
      return NextResponse.json({ error: 'Pesan tidak boleh kosong' }, { status: 400 })
    }

    if (trimmedMessage.length > 280) {
      return NextResponse.json(
        { error: `Pesan terlalu panjang (${trimmedMessage.length}/280 karakter)` },
        { status: 400 }
      )
    }

    // --- AUTO-APPROVE FILTER ---
    // Load filter settings from DB
    let filterSettings: {
      autoApprove: boolean
      blockedWords: string[]
      nsfwWords: string[]
      filterRules: { blockedWords: boolean; jualan: boolean; urls: boolean; mentions: boolean; phoneNumbers: boolean; nsfw: boolean; capsSpam: boolean; repeatedChars: boolean; tooShort: boolean; duplicate24h: boolean }
      geminiEnabled: boolean
      geminiApiKeySet: boolean
    }

    try {
      filterSettings = await getFilterSettings()
    } catch {
      // If filter settings can't be loaded, fall back to defaults with auto-approve OFF
      debug('[submit] Failed to load filter settings, using defaults with auto-approve OFF')
      filterSettings = {
        autoApprove: false,
        blockedWords: DEFAULT_BLOCKED_WORDS,
        nsfwWords: DEFAULT_NSFW_WORDS,
        filterRules: DEFAULT_FILTER_RULES,
        geminiEnabled: false,
        geminiApiKeySet: false,
      }
    }

    // --- Step 1: Rule-based content filter ---
    const filterResult = runContentFilter(
      trimmedMessage,
      filterSettings.blockedWords,
      filterSettings.filterRules,
      filterSettings.nsfwWords,
    )

    // Check for duplicates (24h) if rule is enabled
    if (filterSettings.filterRules.duplicate24h) {
      const dupCheck = await checkDuplicate24h(trimmedMessage, submitter.id, db)
      if (dupCheck.isDuplicate && dupCheck.reason) {
        filterResult.passed = false
        filterResult.reasons.push(dupCheck.reason)
        if (filterResult.severity === 'none') filterResult.severity = 'medium'
      }
    }

    // Collect all filter reasons (from both rule-based and Gemini)
    const allFilterReasons: string[] = filterResult.passed ? [] : [...filterResult.reasons]

    // --- Step 2: Gemini AI filter (optional, only if rule-based passed) ---
    let geminiChecked = false
    let geminiPassed = true

    if (filterResult.passed && filterSettings.geminiEnabled && filterSettings.geminiApiKeySet) {
      try {
        const geminiApiKey = await getGeminiApiKey()
        if (geminiApiKey) {
          debug('[submit] Running Gemini AI filter')
          const geminiResult = await runGeminiFilter(trimmedMessage, geminiApiKey)
          geminiChecked = geminiResult.checked

          if (!geminiResult.passed) {
            // Gemini flagged the submission (or error/timeout — sends to pending)
            geminiPassed = false
            const geminiReason = geminiResult.reason || 'Flagged by AI'
            allFilterReasons.push(`ai:${geminiReason}`)
            if (geminiResult.error) {
              debug('[submit] Gemini error (sending to pending):', geminiResult.error)
            } else {
              debug('[submit] Gemini flagged submission:', geminiReason)
            }
          } else {
            debug('[submit] Gemini passed submission')
          }
        }
      } catch (err) {
        // Gemini threw an exception — send to pending for manual review
        geminiPassed = false
        allFilterReasons.push('ai:gemini_error')
        debug('[submit] Gemini exception (sending to pending):', err)
      }
    }

    // Determine if submission passes all filters
    const passedAllFilters = filterResult.passed && geminiPassed

    // --- AUTO-APPROVE OFF: All submissions go to pending (original behavior) ---
    if (!filterSettings.autoApprove) {
      const submission = await db.submission.create({
        data: {
          message: trimmedMessage,
          category: category?.trim() || null,
          submitterId: submitter.id,
          filterReasons: allFilterReasons.length > 0 ? JSON.stringify(allFilterReasons) : null,
        },
      })

      return NextResponse.json({ submission }, { status: 201 })
    }

    // --- AUTO-APPROVE ON + FILTER FAILED: Goes to pending with reasons ---
    if (!passedAllFilters) {
      debug('[submit] Filter blocked submission:', allFilterReasons)
      const submission = await db.submission.create({
        data: {
          message: trimmedMessage,
          category: category?.trim() || null,
          submitterId: submitter.id,
          filterReasons: allFilterReasons.length > 0 ? JSON.stringify(allFilterReasons) : null,
        },
      })

      return NextResponse.json({
        submission,
        filtered: true,
        filterReasons: allFilterReasons,
      }, { status: 201 })
    }

    // --- AUTO-APPROVE ON + ALL FILTERS PASSED: Auto-post to X ---
    debug('[submit] All filters passed, auto-posting submission', geminiChecked ? '(Gemini verified)' : '')
    const submission = await db.submission.create({
      data: {
        message: trimmedMessage,
        category: category?.trim() || null,
        submitterId: submitter.id,
        status: 'approved', // Mark as approved first
        filterReasons: null,
      },
    })

    // Attempt to post to X
    try {
      const tweetResult = await postTweetViaCookie(trimmedMessage)

      if (tweetResult.success) {
        debug('[submit] Auto-post succeeded! tweetId:', tweetResult.tweetId, 'method:', tweetResult.method)
        const updated = await db.submission.update({
          where: { id: submission.id },
          data: {
            status: 'posted',
            tweetId: tweetResult.tweetId || null,
            postMethod: tweetResult.method,
          },
        })

        return NextResponse.json({
          submission: updated,
          autoPosted: true,
          tweetId: tweetResult.tweetId,
          postMethod: tweetResult.method,
        }, { status: 201 })
      } else {
        // Post failed — leave as approved so admin can manually retry
        debug('[submit] Auto-post failed:', tweetResult.error)
        return NextResponse.json({
          submission,
          autoPosted: false,
          error: `Disetujui otomatis, tapi gagal posting ke X: ${tweetResult.error}. Admin bisa retry manual.`,
          postMethod: tweetResult.method,
        }, { status: 201 })
      }
    } catch (postError) {
      // Post threw exception — leave as approved so admin can manually retry
      debug('[submit] Auto-post exception:', postError)
      return NextResponse.json({
        submission,
        autoPosted: false,
        error: 'Disetujui otomatis, tapi gagal posting ke X. Admin bisa retry manual.',
      }, { status: 201 })
    }
  } catch {
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 })
  }
}
