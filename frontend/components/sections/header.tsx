"use client"

import { useEffect, useState } from "react"
import { motion } from "motion/react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Activity, ArrowUpRight, Menu, MessageCircle, PhoneCall, X } from "lucide-react"
import { useAppState } from "@/lib/i18n"

export function Header() {
  const { lang, setLang } = useAppState()
  const pathname = usePathname()
  const homePath = pathname === "/" ? "" : "/"
  const [menuOpen, setMenuOpen] = useState(false)

  // Automatically close the mobile drawer when resizing to desktop view
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)")
    const onChange = () => {
      if (mq.matches) setMenuOpen(false)
    }
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  const desktopNavigation =
    lang === "th"
      ? [
          { label: "เช็กหนี้และสิทธิช่วยเหลือ", href: `${homePath}#relief-assistant` },
          { label: "สถานการณ์รายจังหวัด", href: `${homePath}#risk-outlook` },
          { label: "เอกสารและสายด่วน", href: `${homePath}#official-resources` },
        ]
      : [
          { label: "Check Debt & Relief", href: `${homePath}#relief-assistant` },
          { label: "Provincial Outlook", href: `${homePath}#risk-outlook` },
          { label: "Documents & Hotlines", href: `${homePath}#official-resources` },
        ]

  const mobileNavigation =
    lang === "th"
      ? [
          { label: "คำนวณค่างวดและเช็กสิทธิ", href: `${homePath}#relief-assistant` },
          { label: "สถานการณ์รายจังหวัด", href: `${homePath}#risk-outlook` },
          { label: "เอกสารที่ต้องเตรียมและลิงก์โครงการ", href: `${homePath}#official-resources` },
        ]
      : [
          { label: "Payment Simulator & Relief", href: `${homePath}#relief-assistant` },
          { label: "Provincial Outlook", href: `${homePath}#risk-outlook` },
          { label: "Document Checklist & Official Links", href: `${homePath}#official-resources` },
        ]

  function handleMobileNavClick() {
    setMenuOpen(false)
  }

  return (
    <motion.header
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className={`fixed left-3 right-3 top-3 z-50 mx-auto max-w-6xl border border-border bg-background/90 shadow-lg backdrop-blur-xl transition-all md:left-6 md:right-6 md:rounded-full ${
        menuOpen ? "rounded-3xl" : "rounded-full"
      }`}
    >
      {/* Single-row header bar across both mobile and desktop */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 md:grid md:grid-cols-[1fr_auto_1fr] md:px-6">
        <Link
          href="/"
          onClick={() => setMenuOpen(false)}
          className="flex min-w-0 items-center gap-2"
          aria-label="Home"
        >
          <Activity aria-hidden="true" className="size-5 shrink-0 text-foreground" />
          <span className="truncate font-display text-sm font-semibold tracking-tight text-foreground sm:text-base">
            {lang === "th" ? "วางแผนแก้หนี้และเศรษฐกิจภาคเหนือ" : "Northern Debt & Economic Planner"}
          </span>
        </Link>

        {/* Horizontal navigation links shown only on desktop (md and up) */}
        <nav aria-label="Main navigation" className="hidden items-center justify-center gap-2 md:flex lg:gap-5">
          {desktopNavigation.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="whitespace-nowrap text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
          <Link
            href="/chat"
            title={lang === "th" ? "คุยกับผู้ช่วย" : "Chat with us"}
            aria-label={lang === "th" ? "คุยกับผู้ช่วย" : "Chat with us"}
            aria-current={pathname === "/chat" ? "page" : undefined}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors hover:text-foreground ${pathname === "/chat" ? "text-foreground" : "text-muted-foreground"}`}
          >
            <MessageCircle aria-hidden="true" className="size-4" />
            <span className="hidden lg:inline">{lang === "th" ? "คุยกับผู้ช่วย" : "Chat with us"}</span>
          </Link>
        </nav>

        {/* Right-hand action controls */}
        <div className="flex items-center justify-end gap-2 md:gap-2.5">
          <div
            role="group"
            aria-label="Language switcher"
            className="inline-flex items-center rounded-full border border-border bg-secondary/70 p-0.5 text-[11px] font-medium"
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

          {/* Primary CTA button shown only on desktop */}
          <a
            href="#relief-assistant"
            className="hidden whitespace-nowrap rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85 md:inline-flex"
          >
            {lang === "th" ? "คำนวณค่างวด" : "Calculate Payment"}
          </a>

          {/* Hamburger toggle button shown only on mobile */}
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((prev) => !prev)}
            className="flex size-9 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-secondary md:hidden"
          >
            {menuOpen ? <X aria-hidden="true" className="size-4" /> : <Menu aria-hidden="true" className="size-4" />}
          </button>
        </div>
      </div>

      {/* Clean mobile navigation drawer without redundant CTA buttons */}
      {menuOpen && (
        <nav
          aria-label="Mobile navigation"
          className="flex flex-col gap-1 border-t border-border px-4 pb-4 pt-2.5 md:hidden"
        >
          <Link
            href="/chat"
            onClick={handleMobileNavClick}
            aria-current={pathname === "/chat" ? "page" : undefined}
            className="flex items-center justify-between rounded-xl bg-secondary/70 px-3 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
          >
            <span className="inline-flex items-center gap-2"><MessageCircle aria-hidden="true" className="size-4" />{lang === "th" ? "คุยกับผู้ช่วย" : "Chat with us"}</span>
            <ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground" />
          </Link>
          {mobileNavigation.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={handleMobileNavClick}
              className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
            >
              <span>{item.label}</span>
              <ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground" />
            </a>
          ))}

          {/* One-tap official hotline call strip */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-2 pt-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <PhoneCall aria-hidden="true" className="size-3.5 text-foreground" />
              {lang === "th" ? "สายด่วนปรึกษาหนี้:" : "Official Hotlines:"}
            </span>
            <div className="flex items-center gap-1.5">
              <a
                href="tel:1213"
                className="rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
              >
                {lang === "th" ? "โทร 1213 (ธปท.)" : "Call 1213"}
              </a>
              <a
                href="tel:1443"
                className="rounded-full border border-border bg-secondary/60 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
              >
                {lang === "th" ? "โทร 1443 (คลินิกแก้หนี้)" : "Call 1443"}
              </a>
            </div>
          </div>
        </nav>
      )}
    </motion.header>
  )
}
