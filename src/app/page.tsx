import { getSubmitterFromCookies } from '@/lib/twitter-auth'
import { getFilterSettings } from '@/lib/filter-settings'
import { HomeClient } from './home-client'
import { Footer } from '@/components/layout/footer'

export default async function HomePage() {
  // Read session cookie on the server — no API route needed
  const submitterInfo = await getSubmitterFromCookies()

  // Check blocked status server-side (30s-cached — no extra DB hit)
  // so blocked users see the block screen immediately, not after a failed submit
  let initialIsBlocked = false
  if (submitterInfo?.username) {
    const { blockedUsernames } = await getFilterSettings()
    initialIsBlocked = blockedUsernames.includes(submitterInfo.username.toLowerCase())
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F9F9]">
      <HomeClient initialSubmitter={submitterInfo} initialIsBlocked={initialIsBlocked} />
      <Footer />
    </div>
  )
}
