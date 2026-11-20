"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { motion, useInView } from "motion/react"
import {
  AlertTriangle,
  ArrowDownRight,
  CalendarDays,
  ExternalLink,
  LineChart as LineChartIcon,
  MapPin,
  Newspaper,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { NorthernThailandMap, type MapMetricMode } from "@/components/northern-thailand-map"
import {
  fetchProvinceDetail,
  type ProvinceDetailResponse,
  type RiskOutlookResponse,
} from "@/lib/api"
import {
  formatThaiMonth,
  shortCalendarMonth,
  translateClusterGuidance,
  translateClusterLabel,
  translateShockType,
  translateSubregion,
  useAppState,
} from "@/lib/i18n"

type ChartTab = "trend" | "seasonality"

export function RiskOutlook({
  outlook,
  loading,
  error,
}: {
  outlook: RiskOutlookResponse | null
  loading: boolean
  error: string | null
}) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-60px" })
  const { lang, selectedProvinceCode, setSelectedProvinceCode } = useAppState()

  const [metricMode, setMetricMode] = useState<MapMetricMode>("cluster")
  const [chartTab, setChartTab] = useState<ChartTab>("trend")
  const [detail, setDetail] = useState<ProvinceDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const provinces = outlook?.provinces ?? []
  const selectedItem = useMemo(
    () =>
      provinces.find((p) => p.province_code === selectedProvinceCode) ??
      provinces[0] ??
      null,
    [provinces, selectedProvinceCode],
  )

  useEffect(() => {
    let active = true
    if (!selectedProvinceCode) return
    setDetailLoading(true)
    fetchProvinceDetail(selectedProvinceCode)
      .then((res) => {
        if (active) setDetail(res)
      })
      .catch(() => {
        if (active) setDetail(null)
      })
      .finally(() => {
        if (active) setDetailLoading(false)
      })
    return () => {
      active = false
    }
  }, [selectedProvinceCode])

  // Compute live regional averages and notable spotlight provinces for 1 click exploration
  const regionalBenchmarks = useMemo(() => {
    if (!provinces.length) {
      return { avgOcc: 58.0, avgSmeDebt: 0.65, avgSmeCushion: 22.0, spotlights: [] as { code: string; tag: string; name: string }[] }
    }
    const occVals = provinces.map((p) => p.occupancy_rate).filter((v): v is number => v != null)
    const debtVals = provinces.map((p) => p.debt_to_annual_income_sme).filter((v): v is number => v != null)
    const cushionVals = provinces
      .map((p) => (p.expense_to_income_pct_sme != null ? Math.max(0, 100 - p.expense_to_income_pct_sme) : null))
      .filter((v): v is number => v != null)

    const avgOcc = occVals.length ? occVals.reduce((a, b) => a + b, 0) / occVals.length : 58.0
    const avgSmeDebt = debtVals.length ? debtVals.reduce((a, b) => a + b, 0) / debtVals.length : 0.65
    const avgSmeCushion = cushionVals.length ? cushionVals.reduce((a, b) => a + b, 0) / cushionVals.length : 22.0

    const topOcc = [...provinces].sort((a, b) => (b.occupancy_rate ?? 0) - (a.occupancy_rate ?? 0))[0]
    const topDebt = [...provinces].sort(
      (a, b) => (b.debt_to_annual_income_sme ?? 0) - (a.debt_to_annual_income_sme ?? 0),
    )[0]
    const lowCushion = [...provinces]
      .filter((p) => p.province_code !== topDebt?.province_code)
      .sort((a, b) => (b.expense_to_income_pct_sme ?? 0) - (a.expense_to_income_pct_sme ?? 0))[0]
    const highShock = [...provinces].sort((a, b) => (b.shock_intensity ?? 0) - (a.shock_intensity ?? 0))[0]

    const spotlights: { code: string; tag: string; name: string }[] = []
    if (topOcc) {
      spotlights.push({
        code: topOcc.province_code,
        tag: lang === "th" ? "เข้าพักสูงสุด" : "Top Occupancy",
        name: lang === "th" ? topOcc.name_th : topOcc.name_en,
      })
    }
    if (topDebt) {
      spotlights.push({
        code: topDebt.province_code,
        tag: lang === "th" ? "หนี้ธุรกิจสูงสุด" : "Highest SME Debt",
        name: lang === "th" ? topDebt.name_th : topDebt.name_en,
      })
    }
    if (lowCushion) {
      spotlights.push({
        code: lowCushion.province_code,
        tag: lang === "th" ? "เงินเหลือน้อย" : "Thin Cash Surplus",
        name: lang === "th" ? lowCushion.name_th : lowCushion.name_en,
      })
    }
    if (highShock && !spotlights.some((s) => s.code === highShock.province_code)) {
      spotlights.push({
        code: highShock.province_code,
        tag: highShock.has_active_water_pollution
          ? lang === "th"
            ? "เฝ้าระวังสารพิษน้ำ"
            : "Water Pollution Alert"
          : lang === "th"
            ? "เสี่ยงภัยฝุ่น/ฝนสูง"
            : "High Hazard Exposure",
        name: lang === "th" ? highShock.name_th : highShock.name_en,
      })
    }

    return { avgOcc, avgSmeDebt, avgSmeCushion, spotlights }
  }, [provinces, lang])

  const trendChartData = useMemo(() => {
    const series = detail?.monthly_series ?? []
    return series.slice(-18).map((pt) => ({
      label: formatThaiMonth(pt.month_date, lang),
      occupancy: pt.occupancy_rate != null ? Number(pt.occupancy_rate.toFixed(1)) : null,
      shock: Number(pt.composite_shock_idx.toFixed(1)),
      flood: pt.flood_shock_subidx != null ? Number(pt.flood_shock_subidx.toFixed(1)) : 0,
      haze: pt.haze_shock_subidx != null ? Number(pt.haze_shock_subidx.toFixed(1)) : 0,
      macro: pt.macro_pressure_subidx != null ? Number(pt.macro_pressure_subidx.toFixed(1)) : 0,
      rainMm: pt.rainfall_sum_mm != null ? Math.round(pt.rainfall_sum_mm) : 0,
      pm25: pt.pm25_mean != null ? Number(pt.pm25_mean.toFixed(1)) : 0,
    }))
  }, [detail, lang])

  const seasonalityData = useMemo(() => {
    const cal = detail?.seasonality_calendar ?? []
    return cal.map((m) => ({
      month: shortCalendarMonth(m.cal_month, lang),
      occupancy: m.avg_occupancy_rate != null ? Number(m.avg_occupancy_rate.toFixed(1)) : 0,
      pm25: m.avg_pm25_mean != null ? Number(m.avg_pm25_mean.toFixed(1)) : 0,
      rain: m.avg_rainfall_mm != null ? Math.round(m.avg_rainfall_mm) : 0,
    }))
  }, [detail, lang])

  const seasonalPlan = useMemo(() => {
    const cal = detail?.seasonality_calendar ?? []
    const validOcc = cal.filter((c) => c.avg_occupancy_rate != null)
    if (!validOcc.length) return null

    const annualAvgOcc = Number(
      (validOcc.reduce((acc, c) => acc + (c.avg_occupancy_rate ?? 0), 0) / validOcc.length).toFixed(1),
    )
    const sortedOccDesc = [...validOcc].sort((a, b) => (b.avg_occupancy_rate ?? 0) - (a.avg_occupancy_rate ?? 0))
    const sortedOccAsc = [...validOcc].sort((a, b) => (a.avg_occupancy_rate ?? 0) - (b.avg_occupancy_rate ?? 0))

    const peakM = sortedOccDesc[0]
    const lowM = sortedOccAsc[0]
    const peakOcc = peakM?.avg_occupancy_rate ?? annualAvgOcc
    const lowOcc = lowM?.avg_occupancy_rate ?? annualAvgOcc
    const dropFromPeakPct = peakOcc > 0 ? Math.round(((peakOcc - lowOcc) / peakOcc) * 100) : 0

    const highMonthsText = sortedOccDesc
      .slice(0, 2)
      .map((c) => shortCalendarMonth(c.cal_month, lang))
      .join(", ")
    const lowMonthsText = sortedOccAsc
      .slice(0, 2)
      .map((c) => shortCalendarMonth(c.cal_month, lang))
      .join(", ")

    // Check actual threshold exceedances (PM2.5 >= 37.5 ug/m3 and Heavy Rainfall >= 180 mm)
    const hazeExceed = cal
      .filter((c) => (c.avg_pm25_mean ?? 0) >= 37.5)
      .sort((a, b) => (b.avg_pm25_mean ?? 0) - (a.avg_pm25_mean ?? 0))
    const maxHaze = [...cal]
      .filter((c) => c.avg_pm25_mean != null)
      .sort((a, b) => (b.avg_pm25_mean ?? 0) - (a.avg_pm25_mean ?? 0))[0]

    const rainExceed = cal
      .filter((c) => (c.avg_rainfall_mm ?? 0) >= 180)
      .sort((a, b) => (b.avg_rainfall_mm ?? 0) - (a.avg_rainfall_mm ?? 0))
    const maxRain = [...cal]
      .filter((c) => c.avg_rainfall_mm != null)
      .sort((a, b) => (b.avg_rainfall_mm ?? 0) - (a.avg_rainfall_mm ?? 0))[0]

    return {
      annualAvgOcc,
      highMonthsText,
      peakMonthName: peakM ? shortCalendarMonth(peakM.cal_month, lang) : "",
      peakOcc: peakOcc.toFixed(1),
      lowMonthsText,
      lowMonthName: lowM ? shortCalendarMonth(lowM.cal_month, lang) : "",
      lowOcc: lowOcc.toFixed(1),
      dropFromPeakPct,
      hasHazeExceed: hazeExceed.length > 0,
      hazeExceedMonths: hazeExceed
        .slice(0, 2)
        .map((c) => shortCalendarMonth(c.cal_month, lang))
        .join(", "),
      maxHazeVal: maxHaze?.avg_pm25_mean != null ? maxHaze.avg_pm25_mean.toFixed(1) : "0",
      maxHazeMonth: maxHaze ? shortCalendarMonth(maxHaze.cal_month, lang) : "",
      rainPeakMonths: (rainExceed.length ? rainExceed : maxRain ? [maxRain] : [])
        .slice(0, 2)
        .map((c) => shortCalendarMonth(c.cal_month, lang))
        .join(", "),
      maxRainMm: maxRain?.avg_rainfall_mm != null ? Math.round(maxRain.avg_rainfall_mm) : 0,
    }
  }, [detail, lang])

  const bestSeasonMonths = useMemo(() => {
    const cal = detail?.seasonality_calendar ?? []
    if (!cal.length) return ""
    return [...cal]
      .filter((c) => c.avg_occupancy_rate != null)
      .sort((a, b) => (b.avg_occupancy_rate ?? 0) - (a.avg_occupancy_rate ?? 0))
      .slice(0, 2)
      .map((c) => shortCalendarMonth(c.cal_month, lang))
      .join(", ")
  }, [detail, lang])

  const stressSeasonMonths = useMemo(() => {
    const cal = detail?.seasonality_calendar ?? []
    if (!cal.length) return ""
    const peakHaze = [...cal]
      .filter((c) => c.avg_pm25_mean != null)
      .sort((a, b) => (b.avg_pm25_mean ?? 0) - (a.avg_pm25_mean ?? 0))[0]
    const peakRain = [...cal]
      .filter((c) => c.avg_rainfall_mm != null)
      .sort((a, b) => (b.avg_rainfall_mm ?? 0) - (a.avg_rainfall_mm ?? 0))[0]
    const parts: string[] = []
    if (peakHaze) {
      parts.push(
        lang === "th"
          ? `ฝุ่นสูง ${shortCalendarMonth(peakHaze.cal_month, lang)}`
          : `Haze peak ${shortCalendarMonth(peakHaze.cal_month, lang)}`,
      )
    }
    if (peakRain) {
      parts.push(
        lang === "th"
          ? `ฝนชุก ${shortCalendarMonth(peakRain.cal_month, lang)}`
          : `Rain peak ${shortCalendarMonth(peakRain.cal_month, lang)}`,
      )
    }
    return parts.join(" · ")
  }, [detail, lang])

  const metricTabs: { id: MapMetricMode; label: string }[] =
    lang === "th"
      ? [
          { id: "cluster", label: "อันดับความเปราะบาง" },
          { id: "occupancy", label: "อัตราเข้าพัก" },
          { id: "debt", label: "ภาระหนี้และเงินเหลือ" },
        ]
      : [
          { id: "cluster", label: "Vulnerability Tier" },
          { id: "occupancy", label: "Occupancy" },
          { id: "debt", label: "Debt & Cash Surplus" },
        ]

  const summary = outlook?.regional_summary
  const newsItems = outlook?.recent_verified_news ?? []
  const tierGroups = outlook?.vulnerability_tiers ?? []

  const activeTierGroup = useMemo(
    () => tierGroups.find((g) => g.tier === selectedItem?.vulnerability_tier) ?? null,
    [tierGroups, selectedItem],
  )

  const shockProvinceNames = useMemo(() => {
    const codes = summary?.active_external_shock_provinces ?? []
    return codes.map((code) => {
      const m = provinces.find((p) => p.province_code === code)
      return m ? (lang === "th" ? m.name_th : m.name_en) : code
    })
  }, [summary, provinces, lang])

  // Plain language 3 bullet takeaways comparing the selected province to the 17 province mean
  const plainTakeaways = useMemo(() => {
    if (!selectedItem) return []
    const regOcc = regionalBenchmarks.avgOcc
    const occ = selectedItem.occupancy_rate
    const yoy = selectedItem.occupancy_yoy_diff
    const smeDebt = selectedItem.debt_to_annual_income_sme
    const smeExp = selectedItem.expense_to_income_pct_sme
    const cushion = smeExp != null ? Math.max(0, 100 - smeExp) : null

    if (lang === "th") {
      const occCompare =
        occ == null
          ? "ยังไม่มีข้อมูลอัตราเข้าพักล่าสุด"
          : occ >= regOcc + 3
            ? `อัตราเข้าพัก ${occ.toFixed(1)}% สูงกว่าค่าเฉลี่ยภาคเหนือ (${regOcc.toFixed(1)}%)`
            : occ <= regOcc - 3
              ? `อัตราเข้าพัก ${occ.toFixed(1)}% ต่ำกว่าค่าเฉลี่ยภาคเหนือ (${regOcc.toFixed(1)}%)`
              : `อัตราเข้าพัก ${occ.toFixed(1)}% ใกล้เคียงค่าเฉลี่ยภาคเหนือ (${regOcc.toFixed(1)}%)`
      const yoyNote =
        yoy == null
          ? ""
          : yoy > 0.5
            ? ` และดีขึ้นจากปีก่อน +${yoy.toFixed(1)}%`
            : yoy < -0.5
              ? ` และชะลอตัวจากปีก่อน ${yoy.toFixed(1)}%`
              : " และทรงตัวเทียบปีก่อน"

      const finLine =
        smeDebt != null && cushion != null
          ? smeDebt >= 1.0 || cushion <= 12
            ? `หนี้ผู้ประกอบการเฉลี่ย ${smeDebt.toFixed(2)} เท่าของรายได้ทั้งปี และหลังหักรายจ่ายแล้วเหลือเงินเก็บเพียง ${cushion.toFixed(0)}% ของรายได้ (ควรวางแผนลดภาระค่างวด)`
            : smeDebt >= 0.65 || cushion <= 22
              ? `หนี้ผู้ประกอบการเฉลี่ย ${smeDebt.toFixed(2)} เท่าของรายได้ทั้งปี หลังหักรายจ่ายแล้วเหลือเงิน ${cushion.toFixed(0)}% ของรายได้ (ควรสำรองเงินรับช่วงผู้เข้าพักน้อย)`
              : `หนี้ผู้ประกอบการเฉลี่ย ${smeDebt.toFixed(2)} เท่าของรายได้ทั้งปี และหลังหักรายจ่ายยังเหลือเงิน ${cushion.toFixed(0)}% ของรายได้ (อยู่ในเกณฑ์คล่องตัว)`
          : "อยู่ระหว่างอัปเดตข้อมูลฐานะการเงินรายจังหวัด"

      const seasonLine = bestSeasonMonths
        ? `ช่วงทำรายได้หลักคือ ${bestSeasonMonths}${stressSeasonMonths ? ` · ช่วงที่ควรสำรองเงินสดรับมือคือ ${stressSeasonMonths}` : ""}`
        : translateClusterGuidance(selectedItem.cluster_id, lang)

      return [
        { label: "ภาวะท่องเที่ยว", text: `${occCompare}${yoyNote}` },
        { label: "หนี้และเงินเหลือผู้ประกอบการ", text: finLine },
        { label: "จังหวะวางแผนเงินสด", text: seasonLine },
      ]
    }

    const occCompareEn =
      occ == null
        ? "Latest occupancy unavailable"
        : occ >= regOcc + 3
          ? `Occupancy at ${occ.toFixed(1)}% outperforms the regional average (${regOcc.toFixed(1)}%)`
          : occ <= regOcc - 3
            ? `Occupancy at ${occ.toFixed(1)}% trails the regional average (${regOcc.toFixed(1)}%)`
            : `Occupancy at ${occ.toFixed(1)}% tracks near the regional average (${regOcc.toFixed(1)}%)`
    const yoyNoteEn =
      yoy == null
        ? ""
        : yoy > 0.5
          ? `, up +${yoy.toFixed(1)} pp YoY.`
          : yoy < -0.5
            ? `, down ${yoy.toFixed(1)} pp YoY.`
            : ", flat YoY."

    const finLineEn =
      smeDebt != null && cushion != null
        ? smeDebt >= 1.0 || cushion <= 12
          ? `High SME fragility: debt averages ${smeDebt.toFixed(2)}x annual income with only a ${cushion.toFixed(0)}% cash cushion.`
          : smeDebt >= 0.65 || cushion <= 22
            ? `Moderate SME watch: debt averages ${smeDebt.toFixed(2)}x annual income with a ${cushion.toFixed(0)}% cash cushion.`
            : `Healthy SME buffer: debt averages ${smeDebt.toFixed(2)}x annual income with a ${cushion.toFixed(0)}% cash cushion.`
        : "Provincial SME finance benchmark updating."

    const seasonLineEn = bestSeasonMonths
      ? `Peak demand in ${bestSeasonMonths}${stressSeasonMonths ? ` · Reserve liquidity before ${stressSeasonMonths}` : ""}.`
      : translateClusterGuidance(selectedItem.cluster_id, lang)

    return [
      { label: "Service Demand", text: `${occCompareEn}${yoyNoteEn}` },
      { label: "SME Debt & Buffer", text: finLineEn },
      { label: "Cashflow Timing", text: seasonLineEn },
    ]
  }, [selectedItem, regionalBenchmarks, lang, bestSeasonMonths, stressSeasonMonths])

  const selectedCushion =
    selectedItem?.expense_to_income_pct_sme != null
      ? Math.max(0, 100 - selectedItem.expense_to_income_pct_sme)
      : null

  return (
    <section
      ref={ref}
      id="risk-outlook"
      aria-labelledby="risk-outlook-heading"
      className="scroll-target bg-secondary/45 px-4 py-16 sm:px-8 md:py-20"
    >
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
        >
          <div className="max-w-2xl">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              {lang === "th" ? "ชีพจรเศรษฐกิจภาคบริการรายจังหวัด" : "Provincial Economic Pulse"}
            </p>
            <h2
              id="risk-outlook-heading"
              className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
            >
              {lang === "th"
                ? "แผนที่เศรษฐกิจและฐานะการเงิน 17 จังหวัดภาคเหนือ"
                : "17 Province Northern Economic & Financial Map"}
            </h2>
            <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
              {lang === "th"
                ? "ชี้หรือคลิกจังหวัดบนแผนที่เพื่อเทียบอัตราเข้าพัก ภาระหนี้ และเงินเหลือหลังหักรายจ่ายของผู้ประกอบการกับค่าเฉลี่ยทั้งภาคเหนือ พร้อมข้อมูลฤดูกาล 12 เดือน"
                : "Hover or click any province to compare occupancy, SME debt, and post expense cash surplus against the regional average with a 12 month planner."}
            </p>
          </div>

          <div
            role="tablist"
            aria-label={lang === "th" ? "ตัวเลือกมุมมองแผนที่" : "Map layer selector"}
            className="inline-flex flex-wrap items-center gap-1 rounded-full border border-border bg-background p-1"
          >
            {metricTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={metricMode === tab.id}
                onClick={() => setMetricMode(tab.id)}
                className={`rounded-full px-3.5 py-2 text-xs font-medium transition-colors ${
                  metricMode === tab.id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </motion.div>

        {/* 1 Click Spotlight Quick Jump Bar */}
        {regionalBenchmarks.spotlights.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Sparkles aria-hidden="true" className="size-3.5 text-foreground" />
              {lang === "th" ? "จุดเด่นที่น่าสนใจ:" : "Notable provinces:"}
            </span>
            {regionalBenchmarks.spotlights.map((sp) => {
              const active = selectedProvinceCode === sp.code
              return (
                <button
                  key={sp.code}
                  type="button"
                  onClick={() => setSelectedProvinceCode(sp.code)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-foreground hover:bg-secondary"
                  }`}
                >
                  <span className={active ? "text-background/75" : "text-muted-foreground"}>{sp.tag}:</span>
                  <span>{sp.name}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Conditional External Shock Banner shown ONLY when abnormal physical stress is active */}
        {summary?.has_active_external_shock && (
          <div
            role="status"
            className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-600/30 bg-amber-500/10 px-5 py-4 text-sm text-foreground"
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-700" />
            <div>
              <p className="font-semibold">
                {lang === "th"
                  ? (summary.water_pollution_alert_provinces?.length ?? 0) > 0
                    ? "ตรวจพบสัญญาณเฝ้าระวังมลพิษ/สารพิษทางน้ำและแรงกดดันภายนอก"
                    : "ตรวจพบสัญญาณแรงกดดันภายนอกเกินเกณฑ์เฝ้าระวัง"
                  : (summary.water_pollution_alert_provinces?.length ?? 0) > 0
                    ? "Active Water Pollution & Multi Hazard Alert"
                    : "Active External Physical Shock Alert"}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {lang === "th"
                  ? `จังหวัดที่ควรติดตามเป็นพิเศษ: ${shockProvinceNames.join(", ")} (ตรวจสอบข่าวอ้างอิงจริงและเกณฑ์มาตรการด้านล่าง)`
                  : `Provinces under active alert: ${shockProvinceNames.join(", ")} (inspect verified field reports and relief playbook below).`}
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-5 rounded-2xl border border-destructive/30 bg-destructive/5 px-5 py-4 text-xs text-destructive">
            {lang === "th"
              ? `ไม่สามารถเชื่อมต่อข้อมูลสดจากเซิร์ฟเวอร์ได้ (${error})`
              : `Unable to load live backend data (${error}).`}
          </div>
        )}

        {/* Balanced 2 Column Map Stage + Animated Provincial Inspector */}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(320px,44fr)_minmax(0,56fr)]">
          {/* Left Map Stage with Regional Tier Breakdown */}
          <div className="flex flex-col gap-4 rounded-[1.75rem] border border-border bg-background p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <MapPin aria-hidden="true" className="size-3.5 text-foreground" />
                {lang === "th" ? "ชี้เพื่อดูเร็ว · คลิกเพื่อเจาะลึก" : "Hover to preview · Click to inspect"}
              </span>
              {outlook?.latest_month && (
                <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                  {formatThaiMonth(outlook.latest_month, lang)}
                </span>
              )}
            </div>

            {loading && !provinces.length ? (
              <div className="flex h-[440px] items-center justify-center text-xs text-muted-foreground">
                {lang === "th" ? "กำลังโหลดแผนที่ข้อมูลจริง 17 จังหวัด…" : "Loading live 17 province map…"}
              </div>
            ) : (
              <NorthernThailandMap
                provinces={provinces}
                selectedCode={selectedProvinceCode}
                onSelect={setSelectedProvinceCode}
                metricMode={metricMode}
                lang={lang}
              />
            )}

            {/* Compact 4 Tier Regional Summary Matrix below map for quick selection */}
            {tierGroups.length > 0 && (
              <div className="rounded-2xl border border-border bg-secondary/30 p-3.5">
                <p className="mb-2 text-[11px] font-semibold text-foreground">
                  {lang === "th"
                    ? "ภาพรวม 17 จังหวัดแยกตามระดับความเปราะบาง"
                    : "17 Provinces by Vulnerability Tier"}
                </p>
                <div className="space-y-2">
                  {tierGroups.map((grp) => (
                    <div key={grp.tier} className="rounded-xl bg-background px-3 py-2">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                          <span
                            style={{ backgroundColor: grp.color }}
                            className="size-2 shrink-0 rounded-full"
                            aria-hidden="true"
                          />
                          {lang === "th" ? `ระดับ ${grp.tier} ${grp.short_th}` : `Tier ${grp.tier} ${grp.short_en}`}
                        </span>
                        <span className="tabular-nums text-[10px] text-muted-foreground">
                          {lang === "th" ? `${grp.province_count} จังหวัด` : `${grp.province_count} prov.`}
                        </span>
                      </div>
                      {grp.provinces.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {grp.provinces.map((p) => (
                            <button
                              key={p.province_code}
                              type="button"
                              onClick={() => setSelectedProvinceCode(p.province_code)}
                              className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
                                p.province_code === selectedProvinceCode
                                  ? "bg-foreground font-medium text-background"
                                  : "bg-secondary/70 text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {lang === "th" ? p.name_th : p.name_en}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Provincial Inspector Card */}
          <motion.div
            key={selectedItem?.province_code || "loading"}
            initial={{ opacity: 0.75, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            className="flex min-w-0 flex-col justify-between gap-4 rounded-[1.75rem] border border-border bg-background p-5 sm:p-6"
          >
            {selectedItem ? (
              <>
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3.5">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-medium text-foreground">
                          {translateSubregion(selectedItem.subregion, lang)}
                        </span>
                        <span className="rounded-full border border-border px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {translateClusterLabel(selectedItem.cluster_label, lang)}
                        </span>
                      </div>
                      <h3 className="mt-2 font-display text-2xl font-semibold tracking-tight text-foreground">
                        {lang === "th" ? selectedItem.name_th : selectedItem.name_en}
                      </h3>
                    </div>

                    {selectedItem.has_active_water_pollution ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-600/35 bg-amber-500/15 px-3 py-1 text-[11px] font-medium text-amber-900">
                        <AlertTriangle aria-hidden="true" className="size-3.5" />
                        {lang === "th"
                          ? `เฝ้าระวังสารพิษทางน้ำ (${selectedItem.water_pollution_count ?? 1} ข่าว)`
                          : `Water Pollution Alert (${selectedItem.water_pollution_count ?? 1})`}
                      </span>
                    ) : selectedItem.has_active_external_shock ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-600/30 bg-amber-500/10 px-3 py-1 text-[11px] font-medium text-amber-800">
                        <AlertTriangle aria-hidden="true" className="size-3.5" />
                        {lang === "th" ? "มีแรงกดดันภายนอก" : "Active Stress"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-700/20 bg-emerald-700/5 px-3 py-1 text-[11px] font-medium text-emerald-800">
                        <ShieldCheck aria-hidden="true" className="size-3.5" />
                        {lang === "th"
                          ? `ภาวะปกติ · ไม่พบน้ำท่วม${selectedItem.live_pm25_mean != null ? ` · ค่าฝุ่น ${selectedItem.live_pm25_mean}` : ""}`
                          : `Normal · No Flood${selectedItem.live_pm25_mean != null ? ` · PM2.5 ${selectedItem.live_pm25_mean}` : ""}`}
                      </span>
                    )}
                  </div>

                  {/* Plain language 3 bullet summary */}
                  <div className="rounded-2xl border border-border bg-secondary/45 p-3.5">
                    <ul className="space-y-1.5 text-xs leading-5 text-muted-foreground">
                      {plainTakeaways.map((item) => (
                        <li key={item.label} className="flex items-start gap-2">
                          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/70" aria-hidden="true" />
                          <span>
                            <strong className="font-medium text-foreground">{item.label}:</strong> {item.text}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Visual Comparison Bars vs 17 Province Northern Average */}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <CompareBarTile
                      label={lang === "th" ? "อัตราเข้าพัก" : "Occupancy"}
                      valueText={selectedItem.occupancy_rate != null ? `${selectedItem.occupancy_rate.toFixed(1)}%` : "—"}
                      subText={
                        lang === "th"
                          ? `เฉลี่ยภาคเหนือ ${regionalBenchmarks.avgOcc.toFixed(1)}%`
                          : `North avg ${regionalBenchmarks.avgOcc.toFixed(1)}%`
                      }
                      pct={Math.min(100, selectedItem.occupancy_rate ?? 0)}
                      avgPct={Math.min(100, regionalBenchmarks.avgOcc)}
                      tone="neutral"
                    />
                    <CompareBarTile
                      label={lang === "th" ? "หนี้ธุรกิจต่อรายได้ปี" : "SME Debt / Annual Income"}
                      valueText={
                        selectedItem.debt_to_annual_income_sme != null
                          ? lang === "th"
                            ? `${selectedItem.debt_to_annual_income_sme.toFixed(2)} เท่า`
                            : `${selectedItem.debt_to_annual_income_sme.toFixed(2)}x`
                          : "—"
                      }
                      subText={
                        lang === "th"
                          ? `เฉลี่ยภาคเหนือ ${regionalBenchmarks.avgSmeDebt.toFixed(2)} เท่า`
                          : `North avg ${regionalBenchmarks.avgSmeDebt.toFixed(2)}x`
                      }
                      pct={Math.min(100, ((selectedItem.debt_to_annual_income_sme ?? 0) / 1.6) * 100)}
                      avgPct={Math.min(100, (regionalBenchmarks.avgSmeDebt / 1.6) * 100)}
                      tone={(selectedItem.debt_to_annual_income_sme ?? 0) >= 1.0 ? "warn" : "neutral"}
                    />
                    <CompareBarTile
                      label={lang === "th" ? "เงินเหลือหลังหักรายจ่าย" : "SME Surplus After Expenses"}
                      valueText={selectedCushion != null ? `${selectedCushion.toFixed(0)}%` : "—"}
                      subText={
                        lang === "th"
                          ? `เฉลี่ยภาคเหนือ ${regionalBenchmarks.avgSmeCushion.toFixed(0)}%`
                          : `North avg ${regionalBenchmarks.avgSmeCushion.toFixed(0)}%`
                      }
                      pct={Math.min(100, ((selectedCushion ?? 0) / 50) * 100)}
                      avgPct={Math.min(100, (regionalBenchmarks.avgSmeCushion / 50) * 100)}
                      tone={selectedCushion != null && selectedCushion <= 12 ? "warn" : "good"}
                    />
                  </div>

                  {/* Vulnerability Tiering Playbook & Sector Sensitivity */}
                  {selectedItem.vulnerability_tier && (
                    <div className="rounded-2xl border border-border bg-secondary/35 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            style={{ backgroundColor: selectedItem.tier_color || "#475569" }}
                            className="size-2.5 shrink-0 rounded-full"
                            aria-hidden="true"
                          />
                          <p className="text-xs font-semibold text-foreground">
                            {lang === "th" ? selectedItem.tier_label_th : selectedItem.tier_label_en}
                          </p>
                        </div>
                        <span className="rounded-full bg-background px-2.5 py-0.5 text-[10px] font-semibold tabular-nums text-foreground">
                          {lang === "th"
                            ? `คะแนนความเปราะบาง ${selectedItem.vulnerability_score ?? 0}/100`
                            : `Score ${selectedItem.vulnerability_score ?? 0}/100`}
                        </span>
                      </div>

                      {/* Drivers explaining why this province falls in this tier */}
                      {(lang === "th" ? selectedItem.tier_drivers_th : selectedItem.tier_drivers_en)?.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(lang === "th" ? selectedItem.tier_drivers_th : selectedItem.tier_drivers_en)?.map((drv) => (
                            <span
                              key={drv}
                              className="rounded-full border border-border bg-background px-2.5 py-0.5 text-[10px] text-muted-foreground"
                            >
                              {drv}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {/* Targeted Policy Starting Point */}
                      <div className="mt-3 rounded-xl border border-border/80 bg-background p-3">
                        <p className="text-[11px] font-semibold text-foreground">
                          {lang === "th"
                            ? `เกณฑ์ตั้งต้นมาตรการช่วยเหลือ: ${selectedItem.tier_playbook_title_th}`
                            : `Recommended Starting Playbook: ${selectedItem.tier_playbook_title_en}`}
                        </p>
                        <ul className="mt-1.5 space-y-1 text-[11px] leading-5 text-muted-foreground">
                          {(lang === "th" ? selectedItem.tier_actions_th : selectedItem.tier_actions_en)
                            ?.slice(0, 3)
                            .map((act) => (
                              <li key={act} className="flex items-start gap-2">
                                <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/60" aria-hidden="true" />
                                <span>{act}</span>
                              </li>
                            ))}
                        </ul>
                      </div>

                      {/* Business Segment Sensitivity Pills */}
                      {selectedItem.business_segments && selectedItem.business_segments.length > 0 && (
                        <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
                          {selectedItem.business_segments.map((seg) => {
                            const toneCls =
                              seg.risk_level === "high"
                                ? "border-red-600/25 bg-red-500/5 text-red-800"
                                : seg.risk_level === "medium"
                                  ? "border-amber-600/25 bg-amber-500/5 text-amber-900"
                                  : "border-emerald-700/20 bg-emerald-700/5 text-emerald-800"
                            const riskText =
                              seg.risk_level === "high"
                                ? lang === "th"
                                  ? "ตึงตัวสูง"
                                  : "High"
                                : seg.risk_level === "medium"
                                  ? lang === "th"
                                    ? "เฝ้าระวัง"
                                    : "Watch"
                                  : lang === "th"
                                    ? "คล่องตัว"
                                    : "Resilient"
                            return (
                              <div
                                key={seg.sector}
                                className="flex h-full flex-col justify-between rounded-xl border border-border bg-background p-2.5"
                              >
                                <div className="flex items-center justify-between gap-1.5">
                                  <span className="min-w-0 truncate text-[11px] font-medium text-foreground">
                                    {lang === "th" ? seg.label_th.replace("คาเฟ่", "ร้านกาแฟ") : seg.label_en}
                                  </span>
                                  <span
                                    className={`shrink-0 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${toneCls}`}
                                  >
                                    {riskText}
                                  </span>
                                </div>
                                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                                  {lang === "th" ? seg.guidance_th : seg.guidance_en}
                                </p>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      {/* Peer Provinces in the same Vulnerability Tier */}
                      {activeTierGroup && activeTierGroup.provinces.length > 1 && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-2.5">
                          <span className="text-[10px] font-medium text-muted-foreground">
                            {lang === "th"
                              ? `จังหวัดระดับเดียวกัน (${activeTierGroup.province_count} จังหวัด):`
                              : `Same Tier Peers (${activeTierGroup.province_count}):`}
                          </span>
                          {activeTierGroup.provinces.map((peer) => (
                            <button
                              key={peer.province_code}
                              type="button"
                              onClick={() => setSelectedProvinceCode(peer.province_code)}
                              className={`rounded-full border px-2.5 py-0.5 text-[10px] transition-colors ${
                                peer.province_code === selectedItem.province_code
                                  ? "border-foreground bg-foreground text-background"
                                  : "border-border bg-background text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {lang === "th" ? peer.name_th : peer.name_en}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Interactive chart switcher between 18 month history and 12 month seasonality planner */}
                  <div className="rounded-2xl border border-border bg-secondary/30 p-4">
                    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                      <div className="inline-flex rounded-full border border-border bg-background p-0.5 text-[11px] font-medium">
                        <button
                          type="button"
                          onClick={() => setChartTab("trend")}
                          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors ${
                            chartTab === "trend"
                              ? "bg-foreground text-background"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <LineChartIcon aria-hidden="true" className="size-3" />
                          {lang === "th" ? "แนวโน้มจริง 18 เดือน" : "18 Month Trend"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setChartTab("seasonality")}
                          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors ${
                            chartTab === "seasonality"
                              ? "bg-foreground text-background"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <CalendarDays aria-hidden="true" className="size-3" />
                          {lang === "th" ? "ฤดูกาลท่องเที่ยว 12 เดือน" : "12 Month Seasonality"}
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                        {chartTab === "trend" ? (
                          <>
                            <span className="inline-flex items-center gap-1">
                              <span className="h-0.5 w-3 bg-slate-900" aria-hidden="true" />
                              {lang === "th" ? "อัตราเข้าพัก" : "Occupancy"}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="size-2 rounded-sm bg-slate-300" aria-hidden="true" />
                              {lang === "th" ? "แรงกดดันฝุ่น ฝน และต้นทุน (เกิน 50 = น่ากังวล)" : "Hazard & Cost Pressure (50+ alert)"}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="inline-flex items-center gap-1">
                              <span className="h-0.5 w-3 bg-slate-900" aria-hidden="true" />
                              {lang === "th" ? "เข้าพักเฉลี่ย" : "Avg Occupancy"}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="h-0.5 w-3 border-t border-dashed border-amber-600" aria-hidden="true" />
                              {lang === "th"
                                ? `ค่าเฉลี่ยทั้งปี (${seasonalPlan?.annualAvgOcc ?? "—"}%)`
                                : `Annual Mean (${seasonalPlan?.annualAvgOcc ?? "—"}%)`}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="size-2 rounded-sm bg-sky-600/50" aria-hidden="true" />
                              {lang === "th" ? "ปริมาณฝนเฉลี่ย (มม.)" : "Avg Rainfall (mm)"}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {detailLoading ? (
                      <div className="flex h-[205px] items-center justify-center text-xs text-muted-foreground">
                        {lang === "th" ? "กำลังโหลดข้อมูลรายเดือนของจังหวัด…" : "Loading provincial series…"}
                      </div>
                    ) : chartTab === "trend" ? (
                      <div className="h-[205px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={trendChartData} margin={{ top: 8, right: 6, left: -16, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="hsl(var(--border))" />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={2} />
                            <YAxis
                              yAxisId="occ"
                              domain={[0, 100]}
                              tick={{ fontSize: 10 }}
                              tickLine={false}
                              axisLine={false}
                              unit="%"
                            />
                            <YAxis
                              yAxisId="shock"
                              orientation="right"
                              domain={[0, 100]}
                              tick={{ fontSize: 10 }}
                              tickLine={false}
                              axisLine={false}
                            />
                            <ReferenceLine yAxisId="shock" y={50} stroke="#d97706" strokeDasharray="4 4" strokeOpacity={0.55} />
                            <Tooltip
                              content={({ active, payload, label }) => {
                                if (!active || !payload?.length) return null
                                const d = payload[0]?.payload as (typeof trendChartData)[number] | undefined
                                if (!d) return null
                                return (
                                  <div className="rounded-xl border border-border bg-background px-3 py-2 text-[11px] shadow-lg">
                                    <p className="font-semibold text-foreground">{label}</p>
                                    <p className="mt-1 text-foreground">
                                      {lang === "th" ? "อัตราเข้าพัก" : "Occupancy"}:{" "}
                                      <strong>{d.occupancy != null ? `${d.occupancy}%` : "N/A"}</strong>
                                    </p>
                                    <p className="text-muted-foreground">
                                      {lang === "th" ? "แรงกดดันรวม" : "Total Pressure"}:{" "}
                                      <strong className="text-foreground">{d.shock}/100</strong>
                                    </p>
                                    <div className="mt-1 space-y-0.5 border-t border-border pt-1 text-[10px] text-muted-foreground">
                                      <p>
                                        {lang === "th" ? "น้ำฝน/เสี่ยงน้ำท่วม" : "Flood/Rain"}: {d.flood} ({d.rainMm} {lang === "th" ? "มม." : "mm"})
                                      </p>
                                      <p>
                                        {lang === "th" ? "ฝุ่น PM2.5" : "PM2.5 Haze"}: {d.haze} ({d.pm25} µg/m³)
                                      </p>
                                      <p>
                                        {lang === "th" ? "ต้นทุนเงินเฟ้อและน้ำมัน" : "CPI & Oil Cost"}: {d.macro}
                                      </p>
                                    </div>
                                  </div>
                                )
                              }}
                            />
                            <Bar
                              yAxisId="shock"
                              dataKey="shock"
                              name={lang === "th" ? "แรงกดดันฝุ่น ฝน และต้นทุน" : "External Pressure"}
                              fill="#cbd5e1"
                              radius={[4, 4, 0, 0]}
                              barSize={14}
                            />
                            <Line
                              yAxisId="occ"
                              type="monotone"
                              dataKey="occupancy"
                              name={lang === "th" ? "อัตราเข้าพัก (%)" : "Occupancy (%)"}
                              stroke="#0f172a"
                              strokeWidth={2.2}
                              dot={{ r: 2.5 }}
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <>
                        <div className="h-[205px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={seasonalityData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="hsl(var(--border))" />
                              <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                              <YAxis
                                yAxisId="occ"
                                tick={{ fontSize: 10 }}
                                tickLine={false}
                                axisLine={false}
                                unit="%"
                                domain={[0, 100]}
                              />
                              <YAxis
                                yAxisId="rain"
                                orientation="right"
                                tick={{ fontSize: 10 }}
                                tickLine={false}
                                axisLine={false}
                                unit={lang === "th" ? " มม." : "mm"}
                              />
                              {seasonalPlan && (
                                <ReferenceLine
                                  yAxisId="occ"
                                  y={seasonalPlan.annualAvgOcc}
                                  stroke="#d97706"
                                  strokeDasharray="4 4"
                                  strokeOpacity={0.75}
                                />
                              )}
                              <Tooltip
                                content={({ active, payload, label }) => {
                                  if (!active || !payload?.length) return null
                                  const d = payload[0]?.payload as (typeof seasonalityData)[number] | undefined
                                  if (!d) return null
                                  return (
                                    <div className="rounded-xl border border-border bg-background px-3 py-2 text-[11px] shadow-lg">
                                      <p className="font-semibold text-foreground">{label}</p>
                                      <p className="mt-1 text-foreground">
                                        {lang === "th" ? "อัตราเข้าพักเฉลี่ย" : "Avg Occupancy"}:{" "}
                                        <strong>{d.occupancy}%</strong>
                                      </p>
                                      <p className="text-muted-foreground">
                                        {lang === "th" ? "ปริมาณฝนเฉลี่ย" : "Avg Rainfall"}:{" "}
                                        <strong className="text-foreground">{d.rain} {lang === "th" ? "มม." : "mm"}</strong>
                                      </p>
                                      <p className="text-muted-foreground">
                                        {lang === "th" ? "ค่าฝุ่น PM2.5 เฉลี่ย" : "Avg PM2.5"}:{" "}
                                        <strong className={d.pm25 >= 37.5 ? "text-amber-700" : "text-foreground"}>
                                          {d.pm25} µg/m³ {d.pm25 >= 37.5 ? (lang === "th" ? "(เกินเกณฑ์ 37.5)" : "(>37.5)") : ""}
                                        </strong>
                                      </p>
                                    </div>
                                  )
                                }}
                              />
                              <Bar
                                yAxisId="rain"
                                dataKey="rain"
                                name={lang === "th" ? "ปริมาณฝนเฉลี่ย (มม.)" : "Avg Rainfall (mm)"}
                                fill="#0284c7"
                                fillOpacity={0.32}
                                radius={[4, 4, 0, 0]}
                                barSize={16}
                              />
                              <Line
                                yAxisId="occ"
                                type="monotone"
                                dataKey="occupancy"
                                name={lang === "th" ? "อัตราเข้าพักเฉลี่ย (%)" : "Avg Occupancy (%)"}
                                stroke="#0f172a"
                                strokeWidth={2.3}
                                dot={{ r: 2.8 }}
                              />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>

                        {seasonalPlan && (
                          <div className="mt-3 grid gap-2 border-t border-border/70 pt-3 sm:grid-cols-3">
                            <div className="rounded-xl bg-background px-3 py-2">
                              <p className="text-[10px] font-semibold text-teal-800">
                                {lang === "th"
                                  ? `ช่วงฤดูท่องเที่ยว (${seasonalPlan.highMonthsText})`
                                  : `High Season (${seasonalPlan.highMonthsText})`}
                              </p>
                              <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                                {lang === "th"
                                  ? `เข้าพักสูงสุดเดือน ${seasonalPlan.peakMonthName} (${seasonalPlan.peakOcc}%) สูงกว่าค่าเฉลี่ยทั้งปี (${seasonalPlan.annualAvgOcc}%)`
                                  : `Peaks in ${seasonalPlan.peakMonthName} (${seasonalPlan.peakOcc}%) vs ${seasonalPlan.annualAvgOcc}% annual mean.`}
                              </p>
                            </div>
                            <div className="rounded-xl bg-background px-3 py-2">
                              <p className="text-[10px] font-semibold text-amber-800">
                                {lang === "th"
                                  ? `ช่วงผู้เข้าพักน้อย (${seasonalPlan.lowMonthsText})`
                                  : `Low Season (${seasonalPlan.lowMonthsText})`}
                              </p>
                              <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                                {lang === "th"
                                  ? `ต่ำสุดเดือน ${seasonalPlan.lowMonthName} (${seasonalPlan.lowOcc}%) · ยอดเข้าพักลดลง -${seasonalPlan.dropFromPeakPct}% จากเดือนสูงสุด`
                                  : `Lowest in ${seasonalPlan.lowMonthName} (${seasonalPlan.lowOcc}%), a -${seasonalPlan.dropFromPeakPct}% drop from peak.`}
                              </p>
                            </div>
                            <div className="rounded-xl bg-background px-3 py-2">
                              <p className="text-[10px] font-semibold text-slate-800">
                                {lang === "th" ? "สภาพอากาศตามสถิติจังหวัดนี้" : "Provincial Weather Pattern"}
                              </p>
                              <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                                {seasonalPlan.hasHazeExceed
                                  ? lang === "th"
                                    ? `ฝุ่นเกินเกณฑ์ 37.5 ช่วง ${seasonalPlan.hazeExceedMonths} (สูงสุด ${seasonalPlan.maxHazeVal}) · ฝนหนักสุด ${seasonalPlan.rainPeakMonths} (${seasonalPlan.maxRainMm} มม.)`
                                    : `PM2.5 >37.5 in ${seasonalPlan.hazeExceedMonths} (${seasonalPlan.maxHazeVal}) · Heavy rain ${seasonalPlan.rainPeakMonths} (${seasonalPlan.maxRainMm}mm).`
                                  : lang === "th"
                                    ? `ฝุ่นเฉลี่ยรายเดือนไม่เกินเกณฑ์ 37.5 (สูงสุด ${seasonalPlan.maxHazeVal} เดือน ${seasonalPlan.maxHazeMonth}) · ฝนชุก ${seasonalPlan.rainPeakMonths} (${seasonalPlan.maxRainMm} มม.)`
                                    : `Monthly PM2.5 stays under 37.5 (max ${seasonalPlan.maxHazeVal} in ${seasonalPlan.maxHazeMonth}) · Rain peaks ${seasonalPlan.rainPeakMonths} (${seasonalPlan.maxRainMm}mm).`}
                              </p>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Action Bridge directly to Financial Resilience Calculator */}
                <a
                  href="#relief-assistant"
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-xs font-medium text-background transition-opacity hover:opacity-85 sm:text-sm"
                >
                  {lang === "th"
                    ? `ประเมินภาระหนี้และจำลองค่างวดสำหรับจังหวัด${selectedItem.name_th}`
                    : `Run Resilience Check & Simulator for ${selectedItem.name_en}`}
                  <ArrowDownRight aria-hidden="true" className="size-4" />
                </a>
              </>
            ) : (
              <div className="flex h-[420px] items-center justify-center text-xs text-muted-foreground">
                {lang === "th" ? "กำลังเตรียมข้อมูลรายจังหวัด…" : "Preparing provincial profile…"}
              </div>
            )}
          </motion.div>
        </div>

        {/* Verified Field News Strip */}
        {newsItems.length > 0 && (
          <div className="mt-5 rounded-[1.75rem] border border-border bg-background p-5 sm:p-6">
            <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Newspaper aria-hidden="true" className="size-4 text-foreground" />
                <h3 className="font-display text-sm font-semibold text-foreground sm:text-base">
                  {lang === "th"
                    ? "ข่าวเศรษฐกิจและเหตุการณ์ภาคเหนือที่ผ่านการตรวจสอบแหล่งที่มา"
                    : "Verified Northern Economic & Event News"}
                </h3>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {lang === "th" ? "คัดกรองเฉพาะข้อความตรงแหล่งข่าวต้นฉบับ" : "100% verbatim source grounded"}
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {newsItems.slice(0, 3).map((item, idx) => (
                <a
                  key={item.event_id ?? idx}
                  href={item.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-col justify-between rounded-2xl border border-border bg-secondary/30 p-3.5 transition-colors hover:bg-secondary/70"
                >
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
                      <span className="rounded-full bg-background px-2.5 py-0.5 font-medium text-foreground">
                        {lang === "th" ? item.name_th || item.province_code : item.name_en || item.province_code}
                      </span>
                      <span className="text-muted-foreground">
                        {translateShockType(item.shock_type, lang)} · {item.event_date}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs font-medium leading-5 text-foreground">
                      {item.evidence_quote || item.title}
                    </p>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span className="truncate">{item.source_name || "Official News"}</span>
                    <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function CompareBarTile({
  label,
  valueText,
  subText,
  pct,
  avgPct,
  tone,
}: {
  label: string
  valueText: string
  subText: string
  pct: number
  avgPct: number
  tone: "neutral" | "good" | "warn"
}) {
  const barColor =
    tone === "warn" ? "bg-amber-600" : tone === "good" ? "bg-teal-700" : "bg-foreground/80"

  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-border bg-secondary/30 px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 truncate text-[10px] text-muted-foreground">{label}</p>
        <p className="shrink-0 whitespace-nowrap font-display text-base font-semibold tabular-nums text-foreground">
          {valueText}
        </p>
      </div>
      <div>
        <div className="relative mt-2.5 h-1.5 w-full rounded-full bg-border/80">
          <div className={`h-full rounded-full transition-all duration-300 ${barColor}`} style={{ width: `${Math.max(4, pct)}%` }} />
          <span
            title={subText}
            style={{ left: `${Math.min(96, Math.max(4, avgPct))}%` }}
            className="absolute -top-1 h-3.5 w-0.5 bg-foreground/60"
            aria-hidden="true"
          />
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">{subText}</p>
      </div>
    </div>
  )
}
