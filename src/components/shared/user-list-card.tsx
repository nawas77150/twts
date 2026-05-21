'use client'

import { useState, useCallback } from 'react'
import type { LucideIcon } from 'lucide-react'
import { X, Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { SettingsCard } from '@/components/shared/settings-card'

export interface UserListCardConfig {
  icon: LucideIcon
  title: string
  description: string
  emptyText: string
  duplicateText: string
  addErrorText: string
  addApi: (username: string) => Promise<{ error?: string }>
  removeApi: (username: string) => Promise<{ error?: string }>
  addSuccessText: (username: string) => string
  removeSuccessText: (username: string) => string
  removeErrorText: string
  addButtonClass: string
  badgeClass: string
  rowClass: string
  usernameClass: string
  removeButtonHoverClass: string
}

interface UserListCardProps {
  config: UserListCardConfig
  usernames: string[]
  onChange: () => void
}

export function UserListCard({ config, usernames, onChange }: UserListCardProps) {
  const [addInput, setAddInput] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [removingUser, setRemovingUser] = useState<string | null>(null)
  const { toast } = useToast()

  const handleAdd = useCallback(async () => {
    // Strip leading @ — admin often pastes "@alice"; API also strips, but do it here
    // so the duplicate check works against the canonical form stored in the DB.
    const username = addInput.trim().toLowerCase().replace(/^@/, '')
    if (!username) return

    if (usernames.includes(username)) {
      toast({ title: config.duplicateText, variant: 'destructive' })
      return
    }

    setIsAdding(true)
    try {
      const result = await config.addApi(username)
      if (result.error) {
        toast({ title: 'Gagal', description: result.error, variant: 'destructive' })
      } else {
        setAddInput('')
        toast({ title: config.addSuccessText(username) })
        onChange()
      }
    } catch {
      toast({ title: 'Error', description: config.addErrorText, variant: 'destructive' })
    } finally {
      setIsAdding(false)
    }
  }, [addInput, usernames, config, onChange, toast])

  const handleRemove = useCallback(async (username: string) => {
    setRemovingUser(username)
    try {
      const result = await config.removeApi(username)
      if (result.error) {
        toast({ title: 'Gagal', description: result.error, variant: 'destructive' })
      } else {
        toast({ title: config.removeSuccessText(username) })
        onChange()
      }
    } catch {
      toast({ title: 'Error', description: config.removeErrorText, variant: 'destructive' })
    } finally {
      setRemovingUser(null)
    }
  }, [config, onChange, toast])

  return (
    <SettingsCard
      icon={config.icon}
      title={config.title}
      badges={usernames.length > 0 ? (
        <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 ${config.badgeClass}`}>
          {usernames.length} user
        </Badge>
      ) : undefined}
      contentClassName="space-y-3"
    >
      <p className="text-[9px] text-[#71767B]">{config.description}</p>

      {/* Add user input */}
      <div className="flex gap-2">
        <Input
          id={`${config.title.toLowerCase()}-add`}
          name="username"
          value={addInput}
          onChange={(e) => { setAddInput(e.target.value) }}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
          placeholder="username"
          className="text-xs h-8 font-mono border-[#EFF3F4]"
          disabled={isAdding}
        />
        <Button
          onClick={handleAdd}
          disabled={isAdding || !addInput.trim()}
          className={`h-8 shrink-0 ${config.addButtonClass}`}
        >
          {isAdding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
        </Button>
      </div>

      {/* Users list */}
      {usernames.length === 0 ? (
        <p className="text-[10px] text-[#71767B] text-center py-2">{config.emptyText}</p>
      ) : (
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {usernames.map((username) => (
            <div
              key={username}
              className={`flex items-center justify-between rounded-md px-2.5 py-1.5 ${config.rowClass}`}
            >
              <span className={`text-xs font-mono ${config.usernameClass}`}>@{username}</span>
              <Button
                variant="ghost"
                onClick={() => { void handleRemove(username) }}
                disabled={removingUser === username}
                className={`h-6 w-6 p-0 text-[#71767B] ${config.removeButtonHoverClass}`}
              >
                {removingUser === username ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <X className="w-3 h-3" />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </SettingsCard>
  )
}
