"use client"

import { motion, useInView } from "motion/react"
import { Activity, ArrowUpRight } from "lucide-react"
import Link from "next/link"
import { useRef } from "react"
import { StaffLoginButton } from "@/components/staff-login-dialog"
import { useAppState } from "@/lib/i18n"

export function Footer() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-50px" })
  const { lang } = useAppState()

  const footerLinks =
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
    <motion.footer
      ref={ref}
      initial={{ opacity: 0 }}
      animate={isInView ? { opacity: 1 } : {}}
      transition={{ duration: 0.6 }}
      className="border-t border-border bg-background"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-10 sm:px-8 md:flex-row md:items-center md:justify-between md:py-12">
        <div>
          <Link href="/" className="inline-flex items-center gap-2" aria-label="Home">
            <Activity aria-hidden="true" className="size-5" />
            <span className="font-display text-base font-semibold tracking-tight">
              {lang === "th" ? "ระบบวิเคราะห์ความเสี่ยงเศรษฐกิจภาคเหนือ" : "NorthRisk Analytics"}
            </span>
          </Link>
          <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">
            {lang === "th"
              ? "ระบบวิเคราะห์เศรษฐกิจภาคบริการ ความเปราะบางทางการเงิน 17 จังหวัดภาคเหนือ และผู้ช่วยแนะนำมาตรการช่วยเหลือจากข้อมูลเปิดภาครัฐ"
              : "Regional service sector intelligence and official financial resilience guidance for Northern Thailand."}
          </p>
        </div>

        <nav aria-label="Footer navigation" className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {footerLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
          <Link href="#relief-assistant" className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
            {lang === "th" ? "คำนวณค่างวด" : "Calculate Payment"}
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </Link>
        </nav>
      </div>
      <div className="border-t border-border px-5 pb-24 pt-4 text-center sm:px-8">
        <p className="text-sm leading-6 text-[#4B5563]">
          {lang === "th"
            ? "เพื่อการสนับสนุนข้อมูลและการวางแผนทางการเงินเบื้องต้น เงื่อนไขจริงเป็นไปตามประกาศของหน่วยงานและสถาบันการเงิน"
            : "Decision support from open official datasets. Final program eligibility rests with responsible institutions."}
        </p>
        <StaffLoginButton
          label={lang === "th" ? "เข้าสู่ระบบเจ้าหน้าที่" : "Staff sign in"}
          className="mt-3 inline-flex min-h-11 items-center text-sm text-[#4B5563] underline-offset-4 transition-colors hover:text-foreground hover:underline"
        />
      </div>
    </motion.footer>
  )
}
