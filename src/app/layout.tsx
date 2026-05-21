import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXTAUTH_URL || 'http://localhost:3000'),
  title: "Tweetfess - X Menfess Indonesia",
  description: "Kirim pesan anonim, admin moderasi, otomatis diposting ke X. Menfess gratis untuk komunitas Indonesia.",
  keywords: ["tweetfess", "menfess", "x", "twitter", "confess", "indonesia", "anonim"],
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "Tweetfess - X Menfess Indonesia",
    description: "Kirim pesan anonim, admin moderasi, otomatis diposting ke X. Menfess gratis untuk komunitas Indonesia.",
    type: "website",
    locale: "id_ID",
    siteName: "Tweetfess",
  },
  twitter: {
    card: "summary",
    title: "Tweetfess - X Menfess Indonesia",
    description: "Kirim pesan anonim, admin moderasi, otomatis diposting ke X. Menfess gratis untuk komunitas Indonesia.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
