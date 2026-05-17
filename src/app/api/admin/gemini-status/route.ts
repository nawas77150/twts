import { isEncryptionEnabled } from '@/lib/encrypt'
import { verifyAdmin, getAdminTokenFromRequest } from '@/lib/admin-auth'
import { getGeminiModel } from '@/lib/filter-settings'
import { db } from '@/lib/db'
import { decryptSetting } from '@/lib/encrypt'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const auth = verifyAdmin(getAdminTokenFromRequest(req))
  if (!auth.authorized) return auth.response

  const model = await getGeminiModel()

  // Get the Gemini API key
  const setting = await db.setting.findUnique({ where: { key: 'gemini_api_key' } })
  if (!setting?.value) {
    return NextResponse.json({ healthy: false, model, encryptionEnabled: isEncryptionEnabled(), error: 'No API key configured' })
  }

  const apiKey = decryptSetting(setting.value).trim()
  if (!apiKey) {
    return NextResponse.json({ healthy: false, model, encryptionEnabled: isEncryptionEnabled(), error: 'API key is empty' })
  }

  try {
    // Lightweight health check — fetch model info, not generateContent
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${apiKey}`,
      { signal: AbortSignal.timeout(5000) }
    )
    return NextResponse.json({
      healthy: resp.ok,
      model,
      encryptionEnabled: isEncryptionEnabled(),
      error: resp.ok ? null : `HTTP ${resp.status}`,
    })
  } catch (err) {
    return NextResponse.json({
      healthy: false,
      model,
      encryptionEnabled: isEncryptionEnabled(),
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }
}
