"use client"

import Image from "next/image"
import { motion } from "motion/react"
import { ArrowDown, Activity, ShieldCheck, AlertTriangle } from "lucide-react"
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

        <div className="relative z-10 flex min-h-[430px] flex-col items-center justify-center px-4 pb-8 pt-12 text-center sm:min-h-[540px] sm:px-10 sm:pb-12 sm:pt-20">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 backdrop-blur-md sm:mb-5 sm:px-4"
          >
            <Activity aria-hidden="true" className="size-3.5 shrink-0 text-white/80" />
            <span className="text-[11px] font-medium tracking-wide text-white/85 sm:text-xs">
              {lang === "th"
                ? "ครอบคลุม 17 จังหวัดภาคเหนือ · ข้อมูลหน่วยงานรัฐและ ธปท."
                : "17 Northern Provinces · Official Data from Government & BOT"}
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="max-w-4xl font-display text-2xl font-semibold leading-[1.2] tracking-[-0.03em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)] sm:text-5xl sm:leading-[1.15] lg:text-[3.4rem]"
          >
            <span className="text-balance">
              {lang === "th"
                ? "เช็กสถานการณ์ใกล้ตัว และหาทางออกแก้หนี้ได้ใน 1 นาที"
                : "Check Local Conditions & Find Debt Relief in 1 Minute."}
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.22 }}
            className="mt-3 max-w-2xl text-xs leading-6 text-white/95 drop-shadow-[0_1px_6px_rgba(0,0,0,0.65)] sm:mt-4 sm:text-base sm:leading-7"
          >
            {lang === "th"
              ? "ดูแนวโน้มค่าครองชีพ ภัยพิบัติ ในจังหวัดของคุณ พร้อมคำนวณค่างวดใหม่และพิมพ์ใบสรุปไปคุยกับธนาคารได้ทันที"
              : "Track local living costs and hazard alerts in your province, calculate restructured payments, and print a 1-page bank summary instantly."}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.32 }}
            className="mt-5 flex w-full max-w-md flex-col items-stretch justify-center gap-2.5 sm:mt-7 sm:max-w-none sm:flex-row sm:flex-wrap sm:items-center sm:gap-3"
          >
            <a
              href="#risk-outlook"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-medium text-black shadow-md transition-transform hover:scale-[1.02]"
            >
              {lang === "th" ? "เช็กสถานการณ์จังหวัดของคุณ" : "Check Your Province"}
              <ArrowDown aria-hidden="true" className="size-4" />
            </a>
            <a
              href="#relief-assistant"
              className="inline-flex items-center justify-center rounded-full border border-white/45 bg-black/35 px-6 py-2.5 text-sm font-medium text-white backdrop-blur-md transition-colors hover:bg-black/50"
            >
              {lang === "th" ? "คำนวณค่างวดและหาทางลดหนี้" : "Calculate Payment & Relief"}
            </a>
          </motion.div>

          {/* Live Regional Pulse Strip */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.44 }}
            className="mt-6 grid w-full max-w-5xl grid-cols-2 gap-2 text-left sm:mt-8 sm:gap-2.5 lg:grid-cols-4"
          >
            <HeroKpi
              label={lang === "th" ? "อัตราเข้าพักเฉลี่ยภาคเหนือ" : "Regional Avg Occupancy"}
              value={summary ? `${summary.avg_occupancy_pct.toFixed(1)}%` : "…"}
              sub={
                lang === "th"
                  ? `การท่องเที่ยวและค้าขายยังทรงตัว${latestLabel ? ` (${latestLabel})` : ""}`
                  : `Tourism & local trade steady${latestLabel ? ` (${latestLabel})` : ""}`
              }
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
              sub={lang === "th" ? "เม็ดเงินหมุนเวียนใน 17 จังหวัดต่อเดือน" : "Monthly cashflow across 17 provinces"}
            />
            <HeroKpi
              label={lang === "th" ? "ค่าครองชีพ / ราคาน้ำมัน" : "Living Cost / Fuel Price"}
              value={
                summary && summary.th_cpi_yoy_pct != null
                  ? `${summary.th_cpi_yoy_pct >= 0 ? "+" : ""}${summary.th_cpi_yoy_pct.toFixed(2)}%${
                      summary.oil_brent_yoy_pct != null
                        ? ` / ${summary.oil_brent_yoy_pct > 0 ? "+" : ""}${summary.oil_brent_yoy_pct.toFixed(0)}%`
                        : ""
                    }`
                  : "…"
              }
              sub={
                lang === "th"
                  ? "ต้นทุนค่าเดินทางและราคาสินค้าสูงขึ้น"
                  : `Higher transport & goods cost (${cpiLabel})`
              }
            />
            <div className="rounded-2xl border border-amber-300/35 bg-white/15 px-3.5 py-2.5 backdrop-blur-md sm:px-4 sm:py-3">
              <p className="text-[11px] font-medium text-white/85">
                {lang === "th" ? "ภัยพิบัติและมลพิษ" : "Hazard & Pollution Watch"}
              </p>
              <div className="mt-1 flex items-center gap-1.5 sm:gap-2">
                {summary?.has_active_external_shock ? (
                  <>
                    <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0 text-amber-300 sm:size-4" />
                    <span className="font-display text-base font-semibold text-amber-200 sm:text-lg">
                      {lang === "th"
                        ? `เฝ้าระวัง ${summary.active_external_shock_provinces.length}/17 จังหวัด`
                        : `${summary.active_external_shock_provinces.length}/17 Alert`}
                    </span>
                  </>
                ) : (
                  <>
                    <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0 text-emerald-300 sm:size-4" />
                    <span className="font-display text-base font-semibold text-white sm:text-lg">
                      {lang === "th" ? "ภาวะปกติ (0/17)" : "Normal (0/17)"}
                    </span>
                  </>
                )}
              </div>
              <p className="mt-0.5 hidden text-[10px] font-medium text-amber-100/95 sm:block">
                {summary?.has_active_external_shock
                  ? lang === "th"
                    ? `เฝ้าระวัง: ${alertProvinceNames.join(", ")}`
                    : `Watchlist: ${alertProvinceNames.join(", ")}`
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
    <div className="rounded-2xl border border-white/15 bg-white/10 px-3.5 py-2.5 backdrop-blur-md sm:px-4 sm:py-3">
      <p className="truncate text-[11px] text-white/75">{label}</p>
      <p className="mt-0.5 font-display text-lg font-semibold tracking-tight text-white tabular-nums sm:mt-1 sm:text-2xl">
        {value}
      </p>
      {sub && <p className="mt-0.5 hidden text-[10px] text-white/60 sm:block">{sub}</p>}
    </div>
  )
}
