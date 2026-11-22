"use client"

import { Check, ExternalLink, FileCheck2, PhoneCall } from "lucide-react"
import { useAppState } from "@/lib/i18n"

const OFFICIAL_SOURCES = [
  {
    label_th: "คลินิกแก้หนี้ (สมัครออนไลน์ / โทร 1443)",
    label_en: "Debt Clinic by SAM (Apply Online / 1443)",
    href: "https://www.debtclinicbysam.com/",
  },
  {
    label_th: "โครงการปิดหนี้ไว ไปต่อได้ (SAM Social AMC)",
    label_en: "Fast Close Move Forward Program (SAM Social AMC)",
    href: "https://www.bot.or.th/cleardebt",
  },
  {
    label_th: "เอกสารโครงการคุณสู้ เราช่วย (ฉบับทางการ)",
    label_en: "Khun Soo Rao Chuay Official PDF",
    href: "https://www.bot.or.th/content/dam/bot/documents/th/research-and-publications-pdf/articles-and-publications/articles/download/2024/article-2024dec24.pdf",
  },
  {
    label_th: "ประกาศหลักเกณฑ์การให้สินเชื่ออย่างรับผิดชอบ 2568",
    label_en: "Responsible Lending 2568 PDF",
    href: "https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/ThaiPDF/25680030.pdf",
  },
  {
    label_th: "คู่มือรู้ก่อน รอดก่อน แนวทางแก้หนี้ 2569",
    label_en: "Official Debt Relief Guide 2569 PDF",
    href: "https://www.bot.or.th/content/dam/bot/documents/th/thai-economy/regional-economy/northeastern/File-download/press-training-at-sakonnakorn/Debt%20Relief%20Measures.pdf",
  },
  {
    label_th: "หนังสือเวียนมาตรการลูกหนี้ผู้ประสบภัยพิบัติ 2568",
    label_en: "2568 Disaster Relief Circular PDF",
    href: "https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/ThaiPDF/25680065.pdf",
  },
  {
    label_th: "รายงานภาวะเศรษฐกิจและการเงินภาคเหนือ (ธปท.)",
    label_en: "Northern Regional Economy Portal (BOT)",
    href: "https://www.bot.or.th/th/thai-economy/regional-economy/northern-economy.html",
  },
]

const HOTLINES = [
  { href: "tel:1213", th: "1213 (ศูนย์คุ้มครองฯ ธปท.)", en: "1213 (BOT Consumer)" },
  { href: "tel:1443", th: "1443 (คลินิกแก้หนี้ SAM)", en: "1443 (Debt Clinic SAM)" },
  { href: "tel:1357", th: "1357 (ธพว. SME D Bank)", en: "1357 (SME D Bank)" },
  { href: "tel:028909999", th: "02-890-9999 (บสย.)", en: "02-890-9999 (TCG)" },
]

export function OfficialResources() {
  const { lang } = useAppState()

  const checklist =
    lang === "th"
      ? [
          "รายการเดินบัญชีย้อนหลัง 6 เดือน (บัญชีส่วนตัว หรือบัญชีร้านค้า)",
          "ใบแจ้งยอดหนี้คงเหลือและตารางค่างวดล่าสุดของสถาบันการเงินเจ้าหนี้",
          "หลักฐานรายได้ลดลงตามฤดูกาลหรือผลกระทบจากน้ำท่วม ฝุ่น หรือมลพิษทางน้ำในพื้นที่ (ถ้ามี)",
          "ใบสรุปความพร้อมทางการเงิน 1 หน้า (สั่งพิมพ์จากระบบนี้เพื่อถือไปยื่นประกอบการพูดคุย)",
        ]
      : [
          "6 month bank statements (personal or business account)",
          "Latest loan statements and installment schedules from your lenders",
          "Evidence of seasonal drop or regional hazard/water pollution impact (if applicable)",
          "One page Financial Readiness Dossier printed from this tool",
        ]

  return (
    <section
      id="official-resources"
      aria-labelledby="official-resources-heading"
      className="scroll-target scroll-mt-28 px-4 py-14 sm:px-8 md:py-18"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 max-w-2xl">
          <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            <FileCheck2 aria-hidden="true" className="size-3.5" />
            {lang === "th" ? "เอกสารที่ต้องเตรียมและช่องทางทางการ" : "Preparation & Official Resources"}
          </p>
          <h2
            id="official-resources-heading"
            className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
          >
            {lang === "th"
              ? "เอกสารประกอบการยื่นคำขอ สายด่วน และลิงก์โครงการทางการ"
              : "Document Checklist, Official Hotlines & Program Links"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {lang === "th"
              ? "รวมเอกสารสำคัญที่ควรเตรียมก่อนติดต่อธนาคาร พร้อมเบอร์สายด่วนและลิงก์ต้นฉบับจากธนาคารแห่งประเทศไทยและคลินิกแก้หนี้"
              : "Prepare these documents before contacting your bank, and access verified Bank of Thailand and SAM channels directly."}
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="flex flex-col justify-between gap-5 rounded-[1.75rem] border border-border bg-card p-5 sm:p-6">
            <div>
              <h3 className="font-display text-base font-semibold text-foreground">
                {lang === "th" ? "เอกสารที่ควรเตรียมก่อนติดต่อธนาคาร" : "Documents to Prepare Before Visiting Your Bank"}
              </h3>
              <ul className="mt-3.5 space-y-2.5">
                {checklist.map((doc) => (
                  <li key={doc} className="flex items-start gap-2.5 text-xs leading-6 text-muted-foreground sm:text-sm">
                    <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
                      <Check aria-hidden="true" className="size-3" />
                    </span>
                    <span>{doc}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t border-border pt-4">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <PhoneCall aria-hidden="true" className="size-3.5" />
                {lang === "th" ? "สายด่วนทางการ (แตะเพื่อโทรออก)" : "Official Hotlines (Tap to Call)"}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {HOTLINES.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="inline-flex items-center rounded-full border border-border bg-background px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                  >
                    {lang === "th" ? item.th : item.en}
                  </a>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-border bg-card p-5 sm:p-6">
            <h3 className="font-display text-base font-semibold text-foreground">
              {lang === "th" ? "ลิงก์ประกาศและคลังเอกสารทางการ (ธปท. / SAM)" : "Official BOT & SAM Portals & Guidelines"}
            </h3>
            <div className="mt-3 space-y-1.5">
              {OFFICIAL_SOURCES.map((source) => (
                <a
                  key={source.href}
                  href={source.href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-3 rounded-xl border border-transparent px-3 py-2.5 text-xs font-medium text-foreground transition-colors hover:border-border hover:bg-secondary/60 sm:text-sm"
                >
                  <span className="min-w-0 leading-5">{lang === "th" ? source.label_th : source.label_en}</span>
                  <ExternalLink aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
