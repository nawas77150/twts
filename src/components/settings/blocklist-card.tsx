'use client'

import { useState } from 'react'
import { UserX, ChevronDown, X, Plus, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { apiClient } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'

interface BlocklistCardProps {
  blockedUsernames: string[]
  onBlocklistChange: () => void
}

export function BlocklistCard({
  blockedUsernames,
  onBlocklistChange,
}: BlocklistCardProps) {
  const [open, setOpen] = useState(true)
  const [addInput, setAddInput] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [removingUser, setRemovingUser] = useState<string | null>(null)
  const { toast } = useToast()

  const handleAdd = async () => {
    const username = addInput.trim().toLowerCase()
    if (!username) return

    if (blockedUsernames.includes(username)) {
      toast({ title: 'User sudah ada di blocklist', variant: 'destructive' })
      return
    }

    setIsAdding(true)
    try {
      const result = await apiClient.blockUser(username)
      if (result.error) {
        toast({ title: 'Gagal', description: result.error, variant: 'destructive' })
      } else {
        setAddInput('')
        toast({ title: `${username} ditambahkan ke blocklist` })
        onBlocklistChange()
      }
    } catch {
      toast({ title: 'Error', description: 'Gagal menambahkan ke blocklist', variant: 'destructive' })
    } finally {
      setIsAdding(false)
    }
  }

  const handleRemove = async (username: string) => {
    setRemovingUser(username)
    try {
      const result = await apiClient.unblockUser(username)
      if (result.error) {
        toast({ title: 'Gagal', description: result.error, variant: 'destructive' })
      } else {
        toast({ title: `${username} di-unblock` })
        onBlocklistChange()
      }
    } catch {
      toast({ title: 'Error', description: 'Gagal meng-unblock user', variant: 'destructive' })
    } finally {
      setRemovingUser(null)
    }
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="shadow-sm border-[#EFF3F4]">
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer hover:bg-[#F7F9F9]/50 rounded-t-lg transition-colors">
            <CardTitle className="text-sm sm:text-base flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <UserX className="w-4 h-4 text-[#536471] shrink-0" /> <span>Blocklist</span>
              {blockedUsernames.length > 0 && (
                <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-red-50 text-red-700">
                  {blockedUsernames.length} user
                </Badge>
              )}
              <ChevronDown className={`w-4 h-4 text-[#71767B] ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            <p className="text-[9px] text-[#71767B]">
              User di blocklist tidak bisa mengirim pesan sama sekali. Saat diblokir, user otomatis dihapus dari whitelist.
              Dikelola secara atomik — tidak akan bentrok jika ada operasi lain yang sedang berjalan.
            </p>

            {/* Add user input */}
            <div className="flex gap-2">
              <Input
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
                size="sm"
                className="h-8 bg-red-600 hover:bg-red-700 shrink-0"
              >
                {isAdding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              </Button>
            </div>

            {/* Blocked users list */}
            {blockedUsernames.length === 0 ? (
              <p className="text-[10px] text-[#71767B] text-center py-2">
                Belum ada user di blocklist
              </p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {blockedUsernames.map((username) => (
                  <div
                    key={username}
                    className="flex items-center justify-between bg-red-50 rounded-md px-2.5 py-1.5"
                  >
                    <span className="text-xs font-mono text-red-800">@{username}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { handleRemove(username) }}
                      disabled={removingUser === username}
                      className="h-6 w-6 p-0 text-[#71767B] hover:text-green-600 hover:bg-green-50"
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
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
