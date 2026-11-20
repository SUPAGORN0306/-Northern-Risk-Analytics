import type { Metadata, Viewport } from "next"
import { IBM_Plex_Sans_Thai, Inter, Space_Grotesk } from "next/font/google"

import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
})

const ibmPlexThai = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-thai",
  display: "swap",
})

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://northrisk-analytics.vercel.app"
const pageTitle = "NorthRisk Analytics | ระบบวิเคราะห์ความเสี่ยงภาคบริการภาคเหนือและมาตรการทางการเงิน"
const pageDescription =
  "ระบบติดตามภาวะเศรษฐกิจภาคบริการ ความเปราะบางด้านหนี้สิน 17 จังหวัดภาคเหนือ และผู้ช่วยนำทางมาตรการทางการเงินจากเอกสารทางการ"

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: pageTitle,
    template: "%s | NorthRisk Analytics",
  },
  description: pageDescription,
  keywords: [
    "Northern Thailand regional economy",
    "service sector analytics",
    "household debt resilience",
    "Thailand open data intelligence",
    "NorthRisk Analytics",
  ],
  authors: [{ name: "NorthRisk Analytics", url: siteUrl }],
  creator: "NorthRisk Analytics",
  publisher: "NorthRisk Analytics",
  applicationName: "NorthRisk Analytics",
  category: "Regional economic intelligence",
  referrer: "strict-origin-when-cross-origin",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    type: "website",
    locale: "th_TH",
    url: siteUrl,
    siteName: "NorthRisk Analytics",
    title: pageTitle,
    description: pageDescription,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "NorthRisk Analytics regional economic pulse and financial resilience",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: pageTitle,
    description: pageDescription,
    images: ["/twitter-image"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: siteUrl,
  },
  icons: {
    icon: "/favicon.svg",
  },
  manifest: "/site.webmanifest",
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  colorScheme: "light dark",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="th" dir="ltr">
      <head>
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} ${ibmPlexThai.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  )
}
