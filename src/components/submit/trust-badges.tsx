import { Shield, Eye, Zap } from 'lucide-react'

export function TrustBadges() {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg mx-auto mt-6">
        <div className="flex items-center gap-2 p-3 rounded-xl bg-[#F7F9F9] border border-[#EFF3F4]">
          <Shield className="w-4 h-4 text-[#536471] shrink-0" />
          <span className="text-xs text-[#536471]">Dimoderasi AI</span>
        </div>
        <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 border border-green-100">
          <Eye className="w-4 h-4 text-green-500 shrink-0" />
          <span className="text-xs text-green-700">Anonim di X</span>
        </div>
        <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-100">
          <Zap className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="text-xs text-amber-700">Gratis</span>
        </div>
      </div>
      <p className="text-center text-xs text-[#71767B] mt-4">
        * Tweet yang diposting 100% anonim. Kami tidak mengambil data apapun dari kamu. Login hanya diperlukan untuk keperluan pembatasan penggunaan.
      </p>
    </>
  )
}
