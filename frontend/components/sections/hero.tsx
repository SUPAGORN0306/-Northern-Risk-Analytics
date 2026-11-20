"use client"

import Image from "next/image"
import { motion } from "motion/react"
import { ArrowDown, Activity, ShieldCheck, AlertTriangle } from "lucide-react"
import { StaffLoginButton } from "@/components/staff-login-dialog"
import type { RiskOutlookResponse } from "@/lib/api"
import { formatThaiMonth, useAppState } from "@/lib/i18n"

export function Hero({ outlook }: { outlook: RiskOutlookResponse | null }) {
  const { lang } = useAppState()
  const summary = outlook?.regional_summary
  const latestLabel = formatThaiMonth(outlook?.latest_month, lang)
  const cpiLabel = formatThaiMonth(summary?.th_cpi_month, lang)
  const alertProvinceNames = (summary?.active_external_shock_provinces ?? []).map((code) => {
    const match = outlook?.provinces.find((p) => p.province_code === code)
    return match ? (lang === "th" ? match.name_th : match.name_en) : code
  })
  const hasWaterAlert = (summary?.water_pollution_alert_provinces?.length ?? 0) > 0

  return (
    <section className="px-3 pb-6 pt-28 sm:px-6 sm:pt-32 lg:px-8 lg:pt-28">
      <div className="relative mx-auto min-h-[500px] max-w-7xl overflow-hidden rounded-[2rem] bg-foreground sm:min-h-[540px]">
        <Image
          src="/images/hero-northern-thailand.jpg"
          alt=""
          fill
          priority
          sizes="(max-width: 1280px) 100vw, 1280px"
          className="object-cover object-center saturate-[0.95] contrast-[1.03]"
        />
        <svg
          aria-hidden="true"
          viewBox="0 0 1200 180"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-x-0 bottom-3 z-[1] h-36 w-full opacity-35 sm:bottom-6 sm:h-44"
        >
          <path d="M0 145 H1200 M0 95 H1200" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
          <motion.path
            d="M0 132 C70 126 95 138 152 118 S242 125 295 94 S380 105 435 84 S525 98 580 64 S670 76 725 88 S810 52 870 68 S965 49 1010 35 S1115 43 1200 17"
            fill="none"
            stroke="rgba(255,255,255,0.62)"
            strokeWidth="2"
            strokeDasharray="7 10"
            animate={{ strokeDashoffset: [0, -170] }}
            transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
          />
        </svg>
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/40 to-black/65" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.3)_100%)]" />

        <div className="relative z-10 flex min-h-[500px] flex-col items-center justify-center px-5 py-12 text-center sm:min-h-[540px] sm:px-10">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 backdrop-blur-md"
          >
            <Activity aria-hidden="true" className="size-3.5 text-white/80" />
            <span className="text-xs font-medium tracking-wide text-white/85">
              {lang === "th"
                ? "17 จังหวัดภาคเหนือ · ข้อมูลเศรษฐกิจและการเงินจากแหล่งทางการ"
                : "17 Northern Provinces · Official Open Economic & Finance Data"}
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="max-w-4xl font-display text-3xl font-semibold leading-[1.15] tracking-[-0.03em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)] sm:text-5xl lg:text-[3.4rem]"
          >
            <span className="text-balance">
              {lang === "th"
                ? "อ่านชีพจรเศรษฐกิจภาคเหนือ วางแผนหนี้และการเงินอย่างแม่นยำ"
                : "Northern Economic Pulse. Clear Financial Resilience."}
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.22 }}
            className="mt-4 max-w-2xl text-sm leading-7 text-white/95 drop-shadow-[0_1px_6px_rgba(0,0,0,0.65)] sm:text-base"
          >
            {lang === "th"
              ? "สำรวจภาวะท่องเที่ยวและฐานะการเงินผู้ประกอบการรายจังหวัด พร้อมเครื่องมือประเมินภาระหนี้และจำลองค่างวดตามเกณฑ์โครงการทางการ"
              : "Explore provincial tourism and SME debt resilience across Northern Thailand, paired with instant DSR screening and official installment simulation."}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.32 }}
            className="mt-7 flex flex-wrap items-center justify-center gap-3"
          >
            <a
              href="#risk-outlook"
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-medium text-black shadow-md transition-transform hover:scale-[1.02]"
            >
              {lang === "th" ? "เปิดแผนที่ 17 จังหวัด" : "Explore 17 Province Map"}
              <ArrowDown aria-hidden="true" className="size-4" />
            </a>
            <a
              href="#relief-assistant"
              className="inline-flex items-center rounded-full border border-white/45 bg-black/35 px-6 py-2.5 text-sm font-medium text-white backdrop-blur-md transition-colors hover:bg-black/50"
            >
              {lang === "th" ? "ประเมินหนี้และจำลองค่างวด" : "Check Debt & Simulate Payments"}
            </a>
            <StaffLoginButton
              label={lang === "th" ? "ระบบงานเจ้าหน้าที่" : "Staff Portal"}
              className="inline-flex items-center rounded-full border border-white/40 bg-black/30 px-5 py-2.5 text-sm font-medium text-white backdrop-blur-md transition-colors hover:bg-black/50"
            />
          </motion.div>

          {/* Live Regional Pulse Strip */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.44 }}
            className="mt-8 grid w-full max-w-5xl grid-cols-2 gap-2.5 text-left lg:grid-cols-4"
          >
            <HeroKpi
              label={lang === "th" ? "อัตราเข้าพักเฉลี่ยภาคเหนือ" : "Regional Avg Occupancy"}
              value={summary ? `${summary.avg_occupancy_pct.toFixed(1)}%` : "…"}
              sub={latestLabel ? (lang === "th" ? `ข้อมูลเดือน ${latestLabel}` : `Data ${latestLabel}`) : ""}
            />
            <HeroKpi
              label={lang === "th" ? "รายได้ท่องเที่ยวทั้งภาค" : "Monthly Service Revenue"}
              value={
                summary
                  ? lang === "th"
                    ? `${(summary.total_monthly_revenue_mthb / 1000).toFixed(2)} พันล้าน`
                    : `${(summary.total_monthly_revenue_mthb / 1000).toFixed(2)}B THB`
                  : "…"
              }
              sub={lang === "th" ? "บาทต่อเดือน (17 จังหวัด)" : "Per month across 17 provinces"}
            />
            <HeroKpi
              label={lang === "th" ? "เงินเฟ้อไทย / ราคาน้ำมันโลก" : "Thailand CPI / Brent Oil"}
              value={
                summary && summary.th_cpi_yoy_pct != null
                  ? `${summary.th_cpi_yoy_pct >= 0 ? "+" : ""}${summary.th_cpi_yoy_pct.toFixed(2)}%`
                  : "…"
              }
              sub={
                summary
                  ? lang === "th"
                    ? `เงินเฟ้อ ${cpiLabel} · น้ำมันโลก ${summary.oil_brent_yoy_pct != null ? `${summary.oil_brent_yoy_pct > 0 ? "+" : ""}${summary.oil_brent_yoy_pct.toFixed(0)}%` : ""}`
                    : `CPI ${cpiLabel} · Brent ${summary.oil_brent_yoy_pct != null ? `${summary.oil_brent_yoy_pct > 0 ? "+" : ""}${summary.oil_brent_yoy_pct.toFixed(0)}%` : "N/A"}`
                  : ""
              }
            />
            <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-md">
              <p className="text-[11px] text-white/75">
                {lang === "th" ? "ฝุ่น น้ำท่วม และมลพิษทางน้ำ" : "Multi Hazard & Water Alert"}
              </p>
              <div className="mt-1 flex items-center gap-2">
                {summary?.has_active_external_shock ? (
                  <>
                    <AlertTriangle aria-hidden="true" className="size-4 shrink-0 text-amber-300" />
                    <span className="font-display text-lg font-semibold text-amber-200">
                      {lang === "th"
                        ? `เฝ้าระวัง ${summary.active_external_shock_provinces.length}/17 จังหวัด`
                        : `${summary.active_external_shock_provinces.length}/17 Alert`}
                    </span>
                  </>
                ) : (
                  <>
                    <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-emerald-300" />
                    <span className="font-display text-lg font-semibold text-white">
                      {lang === "th" ? "ภาวะปกติ (0/17)" : "Normal (0/17)"}
                    </span>
                  </>
                )}
              </div>
              <p className="mt-0.5 text-[10px] text-white/75">
                {summary?.has_active_external_shock
                  ? lang === "th"
                    ? `${hasWaterAlert ? "พบข่าวมลพิษทางน้ำ: " : "จังหวัดเฝ้าระวัง: "}${alertProvinceNames.join(", ")}`
                    : `${hasWaterAlert ? "Water pollution alert: " : "Alert: "}${alertProvinceNames.join(", ")}`
                  : lang === "th"
                    ? "ไม่พบจังหวัดที่ฝุ่น ฝน หรือมลพิษเกินเกณฑ์"
                    : "No active haze, flood, or water alert"}
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

function HeroKpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-md">
      <p className="text-[11px] text-white/70">{label}</p>
      <p className="mt-1 font-display text-xl font-semibold tracking-tight text-white tabular-nums sm:text-2xl">
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[10px] text-white/60">{sub}</p>}
    </div>
  )
}
