"use client"

import type { ReactNode } from "react"
import { AppStateProvider } from "@/lib/i18n"

export function AppProviders({ children }: { children: ReactNode }) {
  return <AppStateProvider>{children}</AppStateProvider>
}
