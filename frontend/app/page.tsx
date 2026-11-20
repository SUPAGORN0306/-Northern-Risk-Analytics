"use client"

import { useEffect, useState } from "react"
import { SmoothScroll } from "@/components/smooth-scroll"
import { StructuredData } from "@/components/structured-data"
import { Header } from "@/components/sections/header"
import { Hero } from "@/components/sections/hero"
import { RiskOutlook } from "@/components/sections/platforms"
import { StaffPortalProvider } from "@/components/staff-portal"
import { Pricing } from "@/components/sections/pricing"
import { CTA } from "@/components/sections/cta"
import { Footer } from "@/components/sections/footer"
import { fetchRiskOutlook, type RiskOutlookResponse } from "@/lib/api"
import { AppStateProvider } from "@/lib/i18n"

function PublicExperience() {
  const [outlook, setOutlook] = useState<RiskOutlookResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchRiskOutlook(18)
      .then((res) => {
        if (active) setOutlook(res)
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Unable to load live data")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <SmoothScroll>
      <StructuredData />
      <Header />
      <main>
        <Hero outlook={outlook} />
        <RiskOutlook outlook={outlook} loading={loading} error={error} />
        <Pricing provinces={outlook?.provinces ?? []} />
      </main>
      <CTA />
      <Footer />
    </SmoothScroll>
  )
}

export default function Home() {
  return (
    <AppStateProvider>
      <StaffPortalProvider>
        <PublicExperience />
      </StaffPortalProvider>
    </AppStateProvider>
  )
}
