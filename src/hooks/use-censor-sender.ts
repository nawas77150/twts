'use client'

import { useState, useCallback, useEffect } from 'react'

// UI preference key (boolean) — NOT a credential or sensitive value.
// nosemgrep: rules_lgpl_javascript_crypto_rule-hardcoded-passwords-local-storage
const PREF_CENSOR_SENDER = 'tweetfess_pref:censor_sender'

function readStored(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(PREF_CENSOR_SENDER) === 'true'
}

/** Per-browser visual preference — hides sender identity in admin views. */
export function useCensorSender() {
  const [censored, setCensored] = useState(readStored)

  const toggle = useCallback(() => {
    setCensored((prev) => {
      const next = !prev
      localStorage.setItem(PREF_CENSOR_SENDER, String(next))
      return next
    })
  }, [])

  // Sync across tabs (storage event only fires in OTHER tabs)
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === PREF_CENSOR_SENDER) setCensored(e.newValue === 'true')
    }
    window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener('storage', onStorage) }
  }, [])

  return { censored, toggle } as const
}
