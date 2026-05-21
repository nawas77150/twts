import type { Metadata } from 'next'
import { AdminClientShell } from './_client-shell'

export const metadata: Metadata = {
  robots: { index: false },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminClientShell>{children}</AdminClientShell>
}
