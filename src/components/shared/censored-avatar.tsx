'use client'

import Image from 'next/image'
import { HelpCircle } from 'lucide-react'

interface CensoredAvatarProps {
  src: string | null
  username: string
  censored: boolean
  /** Size in px — defaults to 20 (w-5 h-5) */
  size?: number
}

/**
 * Avatar that respects the censor_sender preference.
 * When censored: shows a generic ? icon.
 * When uncensored: shows the profile image or a letter fallback.
 */
export function CensoredAvatar({ src, username, censored, size = 20 }: CensoredAvatarProps) {
  const cls = `rounded-full shrink-0`

  if (censored) {
    return (
      <div
        className={`${cls} bg-[#272c30] flex items-center justify-center text-white`}
        style={{ width: size, height: size }}
      >
        <HelpCircle style={{ width: size * 0.6, height: size * 0.6 }} />
      </div>
    )
  }

  if (src) {
    return (
      <Image
        src={src}
        alt=""
        width={size}
        height={size}
        className={`${cls} border border-[#EFF3F4]`}
      />
    )
  }

  return (
    <div
      className={`${cls} bg-[#272c30] flex items-center justify-center text-white font-bold`}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {username.charAt(0).toUpperCase()}
    </div>
  )
}
