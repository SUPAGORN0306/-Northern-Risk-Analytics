import type { Metadata, Viewport } from "next"
import { AppProviders } from "@/app/providers"

import "./globals.css"

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://northrisk-analytics.vercel.app"
const pageTitle = "วางแผนแก้หนี้และเศรษฐกิจภาคเหนือ | NorthRisk Analytics"
const pageDescription =
  "เครื่องมือประเมินภาระหนี้ จำลองค่างวด ติดตามภาวะเศรษฐกิจ 17 จังหวัดภาคเหนือ และผู้ช่วยแนะนำมาตรการทางการเงินจากเอกสารทางการ"

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: pageTitle,
    template: "%s | วางแผนแก้หนี้และเศรษฐกิจภาคเหนือ",
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
    siteName: "วางแผนแก้หนี้และเศรษฐกิจภาคเหนือ (NorthRisk Analytics)",
    title: pageTitle,
    description: pageDescription,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "วางแผนแก้หนี้และเศรษฐกิจภาคเหนือ | NorthRisk Analytics",
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
      </head>
      <body
        className="font-sans antialiased"
      >
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
