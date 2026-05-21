import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F7F9F9] px-4">
      <h1 className="text-4xl font-bold text-[#0F1419] mb-2">404</h1>
      <p className="text-[#536471] mb-6">Halaman tidak ditemukan</p>
      <Link
        href="/"
        className="bg-[#0F1419] hover:bg-[#272c30] text-white px-6 py-2 rounded-lg text-sm font-medium"
      >
        Kembali ke Beranda
      </Link>
    </div>
  )
}
