const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://northrisk-analytics.vercel.app"

export function StructuredData() {
  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "NorthRisk Analytics",
    url: siteUrl,
    description: "Regional risk signals and relief guidance for Northern Thailand.",
  }

  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "NorthRisk Analytics",
    url: siteUrl,
    description: "Early visibility into seasonal haze and flood impacts across Northern Thailand, paired with accessible relief guidance for local businesses.",
  }

  const serviceSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "Northern Regional Risk and Relief Analytics",
    serviceType: "Regional decision support and public relief guidance",
    areaServed: {
      "@type": "AdministrativeArea",
      name: "Northern Thailand",
    },
    provider: {
      "@type": "Organization",
      name: "NorthRisk Analytics",
      url: siteUrl,
    },
  }

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "What does the debt service ratio show?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "It compares monthly debt payments with monthly revenue to support a liquidity assessment. It is guidance only, not an approval decision.",
        },
      },
      {
        "@type": "Question",
        name: "What records should businesses prepare?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Business registration, recent revenue records, documented impact, and a loan payment schedule.",
        },
      },
      {
        "@type": "Question",
        name: "Are messages saved?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Messages are not saved and remain in the current session.",
        },
      },
      {
        "@type": "Question",
        name: "Which public sources are included?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Air4Thai, Ministry of Tourism and Sports, National Statistical Office, Bank of Thailand publications, and regional news.",
        },
      },
    ],
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
    </>
  )
}
