'use client'

import { useState, useEffect } from 'react'

export function useCountdown(initialSeconds: number) {
  const [remaining, setRemaining] = useState(initialSeconds)

  useEffect(() => {
    setRemaining(initialSeconds) // eslint-disable-line react-hooks/set-state-in-effect -- reset on initialSeconds change
    if (initialSeconds <= 0) return

    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => { clearInterval(interval) }
  }, [initialSeconds])

  return remaining
}
