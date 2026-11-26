"use client"

import type { ReactNode } from "react"
import { StaffPortalProvider } from "@/components/staff-portal"
import { AppStateProvider } from "@/lib/i18n"

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AppStateProvider>
      <StaffPortalProvider>{children}</StaffPortalProvider>
    </AppStateProvider>
  )
}
