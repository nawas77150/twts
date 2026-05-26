import { getSubmitterFromCookies } from '@/lib/twitter-auth'
import { getFilterSettings } from '@/lib/filter-settings'
import { safeGet } from '@/lib/utils'
import { HomeClient } from './home-client'
import { Footer } from '@/components/layout/footer'

export default async function HomePage() {
  // Read session cookie on the server — no API route needed
  const submitterInfo = await getSubmitterFromCookies()

  // Check blocked status server-side (30s-cached — no extra DB hit)
  // so blocked users see the block screen immediately, not after a failed submit
  let initialIsBlocked = false
  let initialBlockReason: string | undefined = undefined
  if (submitterInfo?.username) {
    const { blockedUsernames, blockedReasons } = await getFilterSettings()
    initialIsBlocked = blockedUsernames.includes(submitterInfo.username.toLowerCase())
    if (initialIsBlocked) {
      initialBlockReason = safeGet(blockedReasons, submitterInfo.username.toLowerCase())
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F9F9]">
      <HomeClient initialSubmitter={submitterInfo} initialIsBlocked={initialIsBlocked} {...(initialBlockReason != null && { initialBlockReason })} />
      <Footer />
    </div>
  )
}
