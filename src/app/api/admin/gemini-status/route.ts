import { isEncryptionEnabled } from '@/lib/encrypt'
import { verifyAdmin, getAdminTokenFromRequest } from '@/lib/admin-auth'
import { getFilterSettings } from '@/lib/filter-settings'
import { getErrorMessage } from '@/lib/utils'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const auth = verifyAdmin(getAdminTokenFromRequest(req))
  if (!auth.authorized) return auth.response

  const { geminiApiKey, geminiModel: model } = await getFilterSettings()

  if (!geminiApiKey) {
    return NextResponse.json({ healthy: false, model, encryptionEnabled: isEncryptionEnabled(), error: 'No API key configured' })
  }

  const apiKey = geminiApiKey.trim()
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
      error: getErrorMessage(err),
    })
  }
}
