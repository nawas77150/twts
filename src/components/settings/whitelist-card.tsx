'use client'

import { useState } from 'react'
import { UserCheck, ChevronDown, X, Plus, Loader2, Shield } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { apiClient } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'

interface WhitelistCardProps {
  whitelistUsernames: string[]
  onWhitelistChange: () => void
}

export function WhitelistCard({
  whitelistUsernames,
  onWhitelistChange,
}: WhitelistCardProps) {
  const [open, setOpen] = useState(true)
  const [addInput, setAddInput] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [removingUser, setRemovingUser] = useState<string | null>(null)
  const { toast } = useToast()

  const handleAdd = async () => {
    const username = addInput.trim().toLowerCase()
    if (!username) return

    if (whitelistUsernames.includes(username)) {
      toast({ title: 'User sudah ada di whitelist', variant: 'destructive' })
      return
    }

    setIsAdding(true)
    try {
      const result = await apiClient.whitelistUser(username)
      if (result.error) {
        toast({ title: 'Gagal', description: result.error, variant: 'destructive' })
      } else {
        setAddInput('')
        toast({ title: `${username} ditambahkan ke whitelist` })
        onWhitelistChange()
      }
    } catch {
      toast({ title: 'Error', description: 'Gagal menambahkan ke whitelist', variant: 'destructive' })
    } finally {
      setIsAdding(false)
    }
  }

  const handleRemove = async (username: string) => {
    setRemovingUser(username)
    try {
      const result = await apiClient.unwhitelistUser(username)
      if (result.error) {
        toast({ title: 'Gagal', description: result.error, variant: 'destructive' })
      } else {
        toast({ title: `${username} dihapus dari whitelist` })
        onWhitelistChange()
      }
    } catch {
      toast({ title: 'Error', description: 'Gagal menghapus dari whitelist', variant: 'destructive' })
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
              <UserCheck className="w-4 h-4 text-[#536471] shrink-0" /> <span>Whitelist</span>
              {whitelistUsernames.length > 0 && (
                <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                  {whitelistUsernames.length} user
                </Badge>
              )}
              <ChevronDown className={`w-4 h-4 text-[#71767B] ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            <p className="text-[9px] text-[#71767B]">
              User di whitelist bebas dari cooldown &amp; batas harian. Berguna untuk testing.
              Dikelola secara atomik — tidak akan bentrok jika ada admin lain yang sedang mengubah.
            </p>

            {/* Add user input */}
            <div className="flex gap-2">
              <Input
                value={addInput}
                onChange={(e) => setAddInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
                placeholder="username"
                className="text-xs h-8 font-mono border-[#EFF3F4]"
                disabled={isAdding}
              />
              <Button
                onClick={handleAdd}
                disabled={isAdding || !addInput.trim()}
                size="sm"
                className="h-8 bg-[#0F1419] hover:bg-[#272c30] shrink-0"
              >
                {isAdding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              </Button>
            </div>

            {/* Whitelisted users list */}
            {whitelistUsernames.length === 0 ? (
              <p className="text-[10px] text-[#71767B] text-center py-2">
                Belum ada user di whitelist
              </p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {whitelistUsernames.map((username) => (
                  <div
                    key={username}
                    className="flex items-center justify-between bg-[#F7F9F9] rounded-md px-2.5 py-1.5"
                  >
                    <span className="text-xs font-mono text-[#0F1419]">@{username}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemove(username)}
                      disabled={removingUser === username}
                      className="h-6 w-6 p-0 text-[#71767B] hover:text-red-500 hover:bg-red-50"
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
