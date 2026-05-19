'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'

interface GuideSectionProps {
  title: string
  isOpen: boolean
  onToggle: () => void
  children: React.ReactNode
}

export function GuideSection({ title, isOpen, onToggle, children }: GuideSectionProps) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className="text-xs text-[#536471] hover:underline flex items-center gap-1"
      >
        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        {title}
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-[#F7F9F9] rounded-lg p-3 text-xs text-[#536471] space-y-2 border border-[#EFF3F4]"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
