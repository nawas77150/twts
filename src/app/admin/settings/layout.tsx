import { EncryptionBanner } from '@/components/dashboard/encryption-banner'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-[#0F1419]">Settings</h2>
        <p className="text-xs text-[#536471]">Manage autobase configuration</p>
      </div>
      <div className="mb-4">
        <EncryptionBanner />
      </div>
      {children}
    </>
  )
}
