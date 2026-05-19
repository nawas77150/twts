'use client'

import { useState, useCallback } from 'react'
import { BarChart3, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { KeyCredits } from '@/types'

interface ApiCreditsProps {
  apiCredits: KeyCredits[]
  onRefresh: () => Promise<void>
  isLoading?: boolean
}

export function ApiCredits({ apiCredits, onRefresh, isLoading }: ApiCreditsProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setIsRefreshing(false)
    }
  }, [onRefresh])

  if (apiCredits.length === 0) return null

  return (
    <Card className="shadow-sm border-[#EFF3F4]">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-purple-500" /> API Credits
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 ml-1"
            onClick={handleRefresh}
          >
            <RefreshCw
              className={`w-3 h-3 ${isRefreshing || isLoading ? 'animate-spin' : ''}`}
            />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          {apiCredits.map((credit) => (
            <div
              key={credit.apiKey}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 bg-[#F7F9F9] rounded-lg p-2 border border-[#EFF3F4]"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-[#536471]">
                  {credit.apiKey}
                </span>
                {credit.error && (
                  <Badge
                    variant="outline"
                    className="text-[8px] px-1 bg-red-50 text-red-600 border-red-200"
                  >
                    {credit.error}
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                <span className="text-[10px] text-[#71767B]">
                  Bonus: {credit.bonusCredits}
                </span>
                <span className="text-[10px] font-medium text-[#3D4145]">
                  Total: {credit.totalCredits}
                </span>
                <span className="text-[8px] text-[#71767B]">
                  (~{Math.floor(credit.totalCredits / 300)} tweets)
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
