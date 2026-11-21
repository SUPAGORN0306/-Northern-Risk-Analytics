"use client"

import { useEffect, useRef, useState } from "react"
import { motion } from "motion/react"
import Link from "next/link"
import { Activity } from "lucide-react"
import { useAppState } from "@/lib/i18n"

export function Header() {
  const { lang, setLang } = useAppState()
  const [navHidden, setNavHidden] = useState(false)
  const lastY = useRef(0)

  useEffect(() => {
    lastY.current = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      const mobile = window.matchMedia("(max-width: 767px)").matches
      if (!mobile) {
        setNavHidden(false)
        lastY.current = y
        return
      }
      if (y > lastY.current + 8 && y > 40) setNavHidden(true)
      else if (y < lastY.current - 8 || y < 16) setNavHidden(false)
      lastY.current = y
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const navigation =
    lang === "th"
      ? [
          { label: "สถานการณ์รายจังหวัด", href: "#risk-outlook" },
          { label: "เช็กหนี้และสิทธิช่วยเหลือ", href: "#relief-assistant" },
        ]
      : [
          { label: "Provincial Outlook", href: "#risk-outlook" },
          { label: "Check Debt & Relief", href: "#relief-assistant" },
        ]

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className="fixed left-3 right-3 top-3 z-50 mx-auto max-w-6xl rounded-full border border-border bg-background/85 shadow-lg backdrop-blur-xl md:left-6 md:right-6"
    >
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 px-4 py-2.5 md:grid-cols-[1fr_auto_1fr] md:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-2" aria-label="Home">
          <Activity aria-hidden="true" className="size-5 shrink-0 text-foreground" />
          <span className="truncate font-display text-sm font-semibold tracking-tight text-foreground sm:text-base">
            {lang === "th" ? "วิเคราะห์เศรษฐกิจภาคเหนือ" : "NorthRisk Analytics"}
          </span>
        </Link>

        <nav
          aria-label="Main navigation"
          className={`col-span-2 row-start-2 items-center justify-center gap-6 md:col-span-1 md:col-start-2 md:row-start-1 md:flex md:gap-8 ${
            navHidden ? "hidden" : "flex"
          }`}
        >
          {navigation.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="whitespace-nowrap text-xs font-medium text-muted-foreground transition-colors hover:text-foreground sm:text-sm"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="col-start-2 row-start-1 flex items-center justify-end gap-2 md:col-start-3 md:gap-2.5">
          <div
            role="group"
            aria-label="Language switcher"
            className={`items-center rounded-full border border-border bg-secondary/70 p-0.5 text-[11px] font-medium md:inline-flex ${
              navHidden ? "hidden" : "inline-flex"
            }`}
          >
            <button
              type="button"
              onClick={() => setLang("th")}
              aria-pressed={lang === "th"}
              className={`rounded-full px-2.5 py-1 transition-colors ${
                lang === "th" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              ไทย
            </button>
            <button
              type="button"
              onClick={() => setLang("en")}
              aria-pressed={lang === "en"}
              className={`rounded-full px-2.5 py-1 transition-colors ${
                lang === "en" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              EN
            </button>
          </div>
          <a
            href="#relief-assistant"
            className="whitespace-nowrap rounded-full bg-foreground px-3.5 py-2 text-xs font-medium text-background transition-opacity hover:opacity-85 sm:px-5 sm:text-sm"
          >
            {lang === "th" ? "คำนวณค่างวด" : "Calculate Payment"}
          </a>
        </div>
      </div>
    </motion.header>
  )
}
