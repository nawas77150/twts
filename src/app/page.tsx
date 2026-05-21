import { getSubmitterFromCookies } from '@/lib/twitter-auth'
import { HomeClient } from './home-client'
import { Footer } from '@/components/layout/footer'

export default async function HomePage() {
  // Read session cookie on the server — no API route needed
  const submitterInfo = await getSubmitterFromCookies()

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F9F9]">
      <HomeClient initialSubmitter={submitterInfo} />
      <Footer />
    </div>
  )
}
