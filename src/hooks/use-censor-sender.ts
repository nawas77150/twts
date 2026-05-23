'use client'

import { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'censor_sender'

function readStored(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(STORAGE_KEY) === 'true'
}

/** Per-browser visual preference — hides sender identity in admin views. */
export function useCensorSender() {
  const [censored, setCensored] = useState(readStored)

  const toggle = useCallback(() => {
    setCensored((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }, [])

  // Sync across tabs (storage event only fires in OTHER tabs)
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setCensored(e.newValue === 'true')
    }
    window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener('storage', onStorage) }
  }, [])

  return { censored, toggle } as const
}
