'use client'

import { Loader2, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface SaveButtonProps {
  isSaving: boolean
  isLoaded: boolean
  label: string
  onClick: () => void
}

export function SaveButton({ isSaving, isLoaded, label, onClick }: SaveButtonProps) {
  return (
    <Button
      onClick={onClick}
      disabled={isSaving || !isLoaded}
      className="w-full bg-[#0F1419] hover:bg-[#272c30]"
    >
      {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Shield className="w-4 h-4 mr-2" />}
      {!isLoaded ? 'Loading...' : label}
    </Button>
  )
}
