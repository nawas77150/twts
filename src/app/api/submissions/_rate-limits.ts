// ============================================================
// Submission rate limit checks
//
// Extracted from _lib.ts to reduce per-file complexity.
// Handles: blocked check, global cap, per-user cooldown,
// daily cap, pending cap, and whitelist bypass.
// ============================================================

import { db } from '@/lib/db'
import { getStartOfTodayWIB } from '@/lib/constants'
import { debug } from '@/lib/debug'
import { type getFilterSettings } from '@/lib/filter-settings'
import { getEffectiveLimit } from '@/lib/limit-resolver'
import { safeGet } from '@/lib/utils'
import { NextResponse } from 'next/server'

// Log a rate limit hit (fire-and-forget, never blocks the response)
export function logLimitHit(username: string, limitType: string) {
  db.limitHit.create({ data: { username, limitType } }).catch(() => {
    // Swallow — logging must never break the submission flow
  })
}

export interface RateLimitContext {
  isWhitelisted: boolean
  effectivePostCap: number
}

// Check global submission daily cap (applies to everyone including whitelisted)
async function checkGlobalDailyCap(
  username: string,
  globalCap: number,
): Promise<NextResponse | null> {
  if (globalCap <= 0) return null
  const globalCount = await db.submission.count({
    where: { createdAt: { gte: getStartOfTodayWIB() } },
  })
  if (globalCount >= globalCap) {
    debug('submit', 'Global daily cap reached:', globalCount)
    logLimitHit(username, 'global_cap')
    return NextResponse.json({
      error: 'Sistem sedang sibuk',
      message: 'Batas harian sistem tercapai. Coba lagi besok.',
    }, { status: 400 })
  }
  return null
}

// Check per-user cooldown between submissions
async function checkUserCooldown(
  submitterId: string,
  username: string,
  effectiveCooldown: number,
): Promise<NextResponse | null> {
  if (effectiveCooldown <= 0) return null
  const lastSubmission = await db.submission.findFirst({
    where: { submitterId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  if (!lastSubmission) return null
  const elapsedMs = Date.now() - lastSubmission.createdAt.getTime()
  const cooldownMs = effectiveCooldown * 60 * 1000
  if (elapsedMs >= cooldownMs) return null
  const waitMinutes = Math.ceil((cooldownMs - elapsedMs) / 60000)
  const waitSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000)
  const waitMsg = waitMinutes > 1 ? `${waitMinutes} menit` : `${waitSeconds} detik`
  debug('submit', 'Cooldown: user must wait', waitMsg)
  logLimitHit(username, 'cooldown')
  return NextResponse.json({
    error: 'Tunggu sebentar',
    message: `Tunggu ${waitMsg} sebelum mengirim pesan lagi.`,
  }, { status: 400 })
}

// Check per-user daily submission cap
async function checkUserDailyCap(
  submitterId: string,
  username: string,
  effectiveDailyCap: number,
): Promise<NextResponse | null> {
  if (effectiveDailyCap <= 0) return null
  const todayCount = await db.submission.count({
    where: { submitterId, createdAt: { gte: getStartOfTodayWIB() } },
  })
  if (todayCount < effectiveDailyCap) return null
  debug('submit', 'Daily cap reached:', todayCount)
  logLimitHit(username, 'daily_cap')
  return NextResponse.json({
    error: 'Batas harian tercapai',
    message: `Kamu sudah mengirim ${todayCount} pesan hari ini (maksimal ${effectiveDailyCap}). Coba lagi besok.`,
  }, { status: 400 })
}

// Check per-user pending submission cap (daily — resets 00:00 WIB)
async function checkUserPendingCap(
  submitterId: string,
  username: string,
  effectivePendingCap: number,
): Promise<NextResponse | null> {
  if (effectivePendingCap <= 0) return null
  const pendingCount = await db.submission.count({
    where: { submitterId, status: 'pending', createdAt: { gte: getStartOfTodayWIB() } },
  })
  if (pendingCount < effectivePendingCap) return null
  debug('submit', 'User pending cap reached:', pendingCount, 'for user', username)
  logLimitHit(username, 'pending_cap')
  return NextResponse.json({
    error: 'Terlalu banyak pesan menunggu',
    message: `Kamu sudah mengirim ${pendingCount} pesan menunggu hari ini (maksimal ${effectivePendingCap}). Coba lagi besok.`,
  }, { status: 400 })
}

export async function checkSubmissionRateLimits(
  submitter: { id: string; username: string; customLimits: unknown },
  filterSettings: Awaited<ReturnType<typeof getFilterSettings>>,
): Promise<RateLimitContext | NextResponse> {
  // Check if user is blocked (cannot submit at all)
  const isBlocked = filterSettings.blockedUsernames.includes(submitter.username.toLowerCase())

  if (isBlocked) {
    debug('submit', 'User is blocked:', submitter.username)
    return NextResponse.json({
      error: 'Akun diblokir',
      message: 'Akun kamu tidak diperbolehkan mengirim pesan.',
      blockReason: safeGet(filterSettings.blockedReasons, submitter.username.toLowerCase()),
    }, { status: 403 })
  }

  // Check if this user is whitelisted (bypasses per-user rate limits)
  const isWhitelisted = filterSettings.whitelistUsernames.includes(submitter.username.toLowerCase())

  // --- GLOBAL RATE LIMITS (apply to everyone including whitelisted) ---
  const globalCapFail = await checkGlobalDailyCap(submitter.username, filterSettings.rateLimits.globalSubmissionDailyCap)
  if (globalCapFail) return globalCapFail

  // --- PER-USER RATE LIMITS (bypassed by whitelist) ---
  if (!isWhitelisted) {
    const effectiveCooldown = getEffectiveLimit('submissionCooldown', submitter.customLimits, filterSettings.rateLimits.submissionCooldown)
    const effectiveDailyCap = getEffectiveLimit('submissionDailyCap', submitter.customLimits, filterSettings.rateLimits.submissionDailyCap)
    const effectivePendingCap = getEffectiveLimit('userPendingCap', submitter.customLimits, filterSettings.rateLimits.userPendingCap)

    const cooldownFail = await checkUserCooldown(submitter.id, submitter.username, effectiveCooldown)
    if (cooldownFail) return cooldownFail

    const dailyCapFail = await checkUserDailyCap(submitter.id, submitter.username, effectiveDailyCap)
    if (dailyCapFail) return dailyCapFail

    const pendingCapFail = await checkUserPendingCap(submitter.id, submitter.username, effectivePendingCap)
    if (pendingCapFail) return pendingCapFail
  } else {
    debug('submit', 'User whitelisted, skipping rate limits:', submitter.username)
  }

  const effectivePostCap = getEffectiveLimit('userPostDailyCap', submitter.customLimits, filterSettings.rateLimits.userPostDailyCap)
  return { isWhitelisted, effectivePostCap }
}
