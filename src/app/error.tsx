'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F7F9F9] px-4">
      <h1 className="text-2xl font-bold text-[#0F1419] mb-2">Terjadi Kesalahan</h1>
      <p className="text-[#536471] mb-6 text-sm">{error.message || 'Sesuatu yang tidak terduga terjadi'}</p>
      <button
        onClick={reset}
        className="bg-[#0F1419] hover:bg-[#272c30] text-white px-6 py-2 rounded-lg text-sm font-medium"
      >
        Coba Lagi
      </button>
    </div>
  )
}
