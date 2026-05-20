'use client'

import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface SecretInputProps {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  reveal: boolean
  onRevealChange: (reveal: boolean) => void
  className?: string
  inputClassName?: string
  /** Override the eye toggle button classes. Default: "absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 p-0" */
  buttonClassName?: string
  /** Override the eye icon classes. Default: "w-3 h-3" */
  iconClassName?: string
}

export function SecretInput({
  id,
  value,
  onChange,
  placeholder,
  reveal,
  onRevealChange,
  className,
  inputClassName,
  buttonClassName,
  iconClassName,
}: SecretInputProps) {
  // If inputClassName already contains a pr-* class, use it directly
  // to avoid fragile conflicting padding classes (e.g. pr-8 + pr-10).
  // Otherwise, default to pr-8 to keep text from overlapping the eye button.
  const hasPaddingRight = inputClassName != null && /\bpr-\S+/.test(inputClassName)
  const resolvedInputClassName = hasPaddingRight
    ? inputClassName
    : `pr-8${inputClassName ? ` ${inputClassName}` : ''}`

  return (
    <div className={`relative ${className ?? ''}`}>
      <Input
        id={id}
        type={reveal ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value) }}
        className={resolvedInputClassName}
      />
      <Button
        variant="ghost"
        className={buttonClassName ?? 'absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 p-0'}
        onClick={() => { onRevealChange(!reveal) }}
      >
        {reveal
          ? <EyeOff className={iconClassName ?? 'w-3 h-3'} />
          : <Eye className={iconClassName ?? 'w-3 h-3'} />}
      </Button>
    </div>
  )
}
