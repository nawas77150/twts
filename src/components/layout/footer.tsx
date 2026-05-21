import { APP_VERSION } from '@/lib/constants'

export function Footer() {
  return (
    <footer className="mt-auto border-t border-[#EFF3F4] bg-white/80 backdrop-blur-lg">
      <div className="max-w-4xl mx-auto px-4 py-3 flex flex-col items-center gap-1.5 text-center sm:flex-row sm:justify-between sm:gap-1">
        <p className="text-xs text-[#71767B]">Tweetfess &mdash; X Menfess Indonesia</p>
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5">
          <span className="text-[10px] text-[#71767B]/60">v{APP_VERSION}</span>
          <span className="text-xs text-[#71767B]">&middot;</span>
          <a href="/admin" className="text-xs text-[#71767B] hover:text-[#0F1419] transition-colors">
            Admin? &rarr; Dashboard
          </a>
          <span className="text-xs text-[#71767B]">&middot;</span>
          <p className="text-xs text-[#71767B]">Login with X only &middot; Anonim di tweet</p>
          <span className="text-xs text-[#71767B]">&middot;</span>
          <p className="text-xs text-[#71767B]">Made with ❤️ by B</p>
        </div>
      </div>
    </footer>
  )
}
