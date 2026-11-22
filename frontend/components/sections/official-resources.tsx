"use client"

import { useMemo, useState } from "react"
import { Check, ChevronDown, ExternalLink, FileCheck2, PhoneCall } from "lucide-react"
import type { DebtStatusKey } from "@/lib/financial-dossier"
import { useAppState } from "@/lib/i18n"
import { POLICY_CATALOG, policyProgramsFor } from "@/lib/policy-catalog"

type OfficialSource = {
  id: string
  status: string
  label_th: string
  label_en: string
  desc_th: string
  desc_en: string
  href: string
}

const STATUS_BADGE_LABELS: Record<DebtStatusKey, { th: string; en: string }> = {
  current: { th: "ยังผ่อนตรงเวลา (เริ่มตึงมือ)", en: "Paying on time" },
  disaster: { th: "ได้รับผลกระทบจากภัยพิบัติ/มลพิษ", en: "Disaster / hazard impact" },
  overdue_31_120: { th: "เริ่มค้างชำระ 1–4 เดือน", en: "Overdue 1 to 4 months" },
  persistent: { th: "จ่ายขั้นต่ำ / หนี้เรื้อรัง", en: "Persistent revolving debt" },
  overdue_120_plus: { th: "ค้างชำระเกิน 4 เดือนขึ้นไป", en: "Overdue over 4 months" },
}

const HOTLINES = [
  { href: "tel:1213", th: "1213 (ศูนย์คุ้มครองผู้ใช้บริการทางการเงิน ธปท.)", en: "1213 (BOT Consumer Center)" },
  { href: "tel:1443", th: "1443 (คลินิกแก้หนี้)", en: "1443 (Debt Clinic)" },
  { href: "tel:1357", th: "1357 (ธนาคารพัฒนาวิสาหกิจขนาดกลางและขนาดย่อม)", en: "1357 (SME D Bank)" },
  { href: "tel:028909999", th: "02-890-9999 (บสย.)", en: "02-890-9999 (TCG)" },
]

export function OfficialResources() {
  const { lang, activeDebtStatus, activeBorrowerType } = useAppState()
  const [showAllLinks, setShowAllLinks] = useState(false)

  const { recommendedSources, remainingSources } = useMemo(() => {
    const matched: OfficialSource[] = policyProgramsFor(activeDebtStatus, activeBorrowerType).map((program) => ({
      id: program.id,
      status: program.status,
      label_th: program.title_th,
      label_en: program.title_en,
      desc_th: program.summary_th,
      desc_en: program.summary_en,
      href: program.source_url,
    }))
    const primary = matched.slice(0, 3)
    const primaryIds = new Set(primary.map((s) => s.id))
    const others = matched.filter((s) => !primaryIds.has(s.id))
    return { recommendedSources: primary, remainingSources: others }
  }, [activeDebtStatus, activeBorrowerType])

  const checklist =
    lang === "th"
      ? [
          "รายการเดินบัญชีย้อนหลัง 6 เดือน (บัญชีส่วนตัว หรือบัญชีร้านค้า)",
          "ใบแจ้งยอดหนี้คงเหลือและตารางค่างวดล่าสุดของสถาบันการเงินเจ้าหนี้",
          "หลักฐานรายได้ลดลงตามฤดูกาลหรือผลกระทบจากน้ำท่วม ฝุ่น หรือมลพิษทางน้ำในพื้นที่ (ถ้ามี)",
          "บันทึกสรุปตัวเลขและตัวอย่างคำพูดเจรจา (คัดลอกไว้ในมือถือหรือพิมพ์เก็บไว้ดูตอนติดต่อเจ้าหน้าที่)",
        ]
      : [
          "6 month bank statements (personal or business account)",
          "Latest loan statements and installment schedules from your lenders",
          "Evidence of seasonal drop or regional hazard/water pollution impact (if applicable)",
          "Personal financial summary and negotiation notes (copied on phone or printed)",
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
            {lang === "th" ? "ขั้นตอนเตรียมตัวก่อนติดต่อเจ้าหนี้" : "Preparation & Official Resources"}
          </p>
          <h2
            id="official-resources-heading"
            className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
          >
            {lang === "th"
              ? "เอกสารที่ต้องเตรียม สายด่วน และช่องทางทางการ"
              : "Document Preparation, Hotlines & Official Channels"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {lang === "th"
              ? "คัดเฉพาะช่องทางทางการที่ตรงกับสถานะการผ่อนที่คุณเลือกไว้ด้านบน พร้อมรายการเอกสารและสายด่วนที่ติดต่อได้ทันที"
              : "Highlights the official channels matching your selected debt status above, alongside preparation documents and hotlines."}
          </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {lang === "th"
                  ? `ตรวจทานทะเบียนมาตรการล่าสุด ${POLICY_CATALOG.verified_on.split("-").reverse().join("/")} · การแสดงผลนี้ไม่ใช่การยืนยันสิทธิ์`
                  : `Policy catalog reviewed ${POLICY_CATALOG.verified_on} · display does not confirm eligibility`}
              </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="flex flex-col justify-between gap-5 rounded-[1.75rem] border border-border bg-card p-5 sm:p-6">
            <div>
              <span className="inline-flex rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-semibold text-foreground">
                {lang === "th" ? "ขั้นที่ 1 · เตรียมเอกสารประกอบ" : "Step 1 · Prepare Documents"}
              </span>
              <h3 className="mt-2 font-display text-base font-semibold text-foreground">
                {lang === "th" ? "เอกสารที่ควรเตรียมก่อนติดต่อธนาคาร" : "Documents to Prepare Before Contacting Your Bank"}
              </h3>
              <ul className="mt-3 space-y-2.5">
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
              <span className="inline-flex rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-semibold text-foreground">
                {lang === "th" ? "ขั้นที่ 2 · ช่องทางปรึกษาทางโทรศัพท์" : "Step 2 · Call Official Hotlines"}
              </span>
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
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

          <div className="flex flex-col justify-between rounded-[1.75rem] border border-border bg-card p-5 sm:p-6">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex rounded-full bg-foreground px-2.5 py-0.5 text-[10px] font-semibold text-background">
                  {lang === "th"
                    ? `คัดตามสถานะ: ${STATUS_BADGE_LABELS[activeDebtStatus].th}`
                    : `Matched: ${STATUS_BADGE_LABELS[activeDebtStatus].en}`}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {lang === "th"
                    ? `แสดง ${recommendedSources.length} ช่องทางหลัก`
                    : `Showing ${recommendedSources.length} key links`}
                </span>
              </div>
              <h3 className="mt-2 font-display text-base font-semibold text-foreground">
                {lang === "th" ? "ช่องทางและเอกสารทางการที่ตรงกับสถานการณ์ของคุณ" : "Official Portals & Guidelines Matching Your Status"}
              </h3>

              <div className="mt-3 space-y-2">
                {recommendedSources.map((source) => (
                  <a
                    key={source.id}
                    href={source.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start justify-between gap-3 rounded-xl border border-border bg-secondary/25 px-3.5 py-3 transition-colors hover:border-foreground/35 hover:bg-secondary/60"
                  >
                    <div className="min-w-0">
                      <span className="mb-1 inline-flex rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {lang === "th"
                          ? source.status === "lender_dependent"
                            ? "ขึ้นกับผลิตภัณฑ์ที่เจ้าหนี้เปิดอยู่"
                            : source.status === "event_dependent"
                              ? "ขึ้นกับเหตุการณ์และพื้นที่"
                                : source.status === "ongoing_framework"
                                  ? "หลักเกณฑ์ทั่วไป"
                              : "ตรวจสอบคุณสมบัติก่อน"
                          : source.status === "lender_dependent"
                            ? "Depends on active lender product"
                            : source.status === "event_dependent"
                              ? "Depends on event and area"
                              : source.status === "ongoing_framework"
                                ? "General framework"
                              : "Check eligibility"}
                      </span>
                      <span className="block text-xs font-semibold leading-5 text-foreground sm:text-sm">
                        {lang === "th" ? source.label_th : source.label_en}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                        {lang === "th" ? source.desc_th : source.desc_en}
                      </span>
                    </div>
                    <ExternalLink aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  </a>
                ))}
              </div>
            </div>

            {remainingSources.length > 0 && (
              <div className="mt-4 border-t border-border pt-3.5">
                <button
                  type="button"
                  aria-expanded={showAllLinks}
                  onClick={() => setShowAllLinks((open) => !open)}
                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-background px-3.5 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                >
                  <span>
                    {showAllLinks
                      ? lang === "th"
                        ? "ซ่อนรายการประกาศทางการอื่นๆ"
                        : "Hide other official links"
                      : lang === "th"
                        ? `ดูประกาศและคลังเอกสารทางการอื่นๆ เพิ่มเติม (อีก ${remainingSources.length} รายการ)`
                        : `View all other official guidelines (${remainingSources.length} more)`}
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`size-4 shrink-0 transition-transform ${showAllLinks ? "rotate-180" : ""}`}
                  />
                </button>

                {showAllLinks && (
                  <div className="mt-2 space-y-1.5">
                    {remainingSources.map((source) => (
                      <a
                        key={source.id}
                        href={source.href}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between gap-3 rounded-xl border border-transparent px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-secondary/50 hover:text-foreground"
                      >
                        <span className="min-w-0 leading-5">{lang === "th" ? source.label_th : source.label_en}</span>
                        <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
