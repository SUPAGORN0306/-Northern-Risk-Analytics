"use client"

import { motion, useInView } from "motion/react"
import { Activity } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useRef } from "react"
import { StaffLoginButton } from "@/components/staff-login-dialog"
import { useAppState } from "@/lib/i18n"

export function Footer() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-50px" })
  const { lang } = useAppState()
  const pathname = usePathname()
  const homePath = pathname === "/" ? "" : "/"

  const footerLinks =
    lang === "th"
      ? [
          { label: "เช็กหนี้และสิทธิช่วยเหลือ", href: `${homePath}#relief-assistant` },
          { label: "สถานการณ์รายจังหวัด", href: `${homePath}#risk-outlook` },
          { label: "เอกสารและสายด่วน", href: `${homePath}#official-resources` },
          { label: "คุยกับผู้ช่วย", href: "/chat" },
          { label: "ความเป็นส่วนตัว", href: "/privacy" },
        ]
      : [
          { label: "Check Debt & Relief", href: `${homePath}#relief-assistant` },
          { label: "Provincial Outlook", href: `${homePath}#risk-outlook` },
          { label: "Documents & Hotlines", href: `${homePath}#official-resources` },
          { label: "Chat with us", href: "/chat" },
          { label: "Privacy", href: "/privacy" },
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
              {lang === "th" ? "วางแผนแก้หนี้และเศรษฐกิจภาคเหนือ" : "NorthRisk Analytics"}
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
        </nav>
      </div>
      <div className="border-t border-border px-5 pb-24 pt-4 text-center sm:px-8">
        <p className="text-xs leading-5 text-muted-foreground">
          {lang === "th"
            ? "แหล่งข้อมูลสาธารณะ (Open Data Sources): ธนาคารแห่งประเทศไทย (ธปท.), กระทรวงการท่องเที่ยวและกีฬา (กทก.), สำนักงานสถิติแห่งชาติ (สสช. SFD_SPB0801), กรมควบคุมมลพิษ (Air4Thai), Open-Meteo, BIS และ FRED"
            : "Public Open Data Sources: Bank of Thailand (BOT), Ministry of Tourism & Sports (MOTS), National Statistical Office (NSO SFD_SPB0801), PCD Air4Thai, Open-Meteo, BIS, and FRED."}
        </p>
        <p className="mt-2 text-sm leading-6 text-[#4B5563]">
          {lang === "th"
            ? "เครื่องมืออิสระสำหรับจำลองแผนและรวบรวมข้อมูลเปิดภาครัฐเพื่อการวางแผนทางการเงินเบื้องต้น ไม่ใช่บริการ การรับรอง หรือความร่วมมืออย่างเป็นทางการของธนาคารหรือธนาคารแห่งประเทศไทย เงื่อนไขจริงเป็นไปตามประกาศของแต่ละสถาบันการเงิน"
            : "Independent decision-support prototype built from public open datasets. Not an official service, endorsement, or partnership of any bank or the Bank of Thailand; final eligibility rests with financial institutions."}
        </p>
        <StaffLoginButton
          label={lang === "th" ? "เข้าสู่ระบบเจ้าหน้าที่" : "Staff sign in"}
          className="mt-3 inline-flex min-h-11 items-center text-sm text-[#4B5563] underline-offset-4 transition-colors hover:text-foreground hover:underline"
        />
      </div>
    </motion.footer>
  )
}
