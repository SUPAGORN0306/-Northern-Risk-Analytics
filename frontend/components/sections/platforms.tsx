"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { motion, useInView } from "motion/react"
import {
  AlertTriangle,
  ArrowDownRight,
  CalendarDays,
  ChevronDown,
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
  Cell,
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
  formatFetchError,
  type ProvinceDetailResponse,
  type RiskOutlookResponse,
} from "@/lib/api"
import {
  formatThaiMonth,
  fullCalendarMonth,
  joinNaturalList,
  shortCalendarMonth,
  translateClusterGuidance,
  translateClusterLabel,
  translateShockType,
  translateSubregion,
  useAppState,
} from "@/lib/i18n"

type ChartTab = "trend" | "seasonality"
type WeatherOverlay = "both" | "pm25" | "rain"

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
  const [weatherOverlay, setWeatherOverlay] = useState<WeatherOverlay>("both")
  const [seasonYear, setSeasonYear] = useState<string>("all")
  const [detail, setDetail] = useState<ProvinceDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailRetryNonce, setDetailRetryNonce] = useState(0)
  const [playbookOpen, setPlaybookOpen] = useState(false)
  const [segmentsOpen, setSegmentsOpen] = useState(false)
  const [mobileTierListOpen, setMobileTierListOpen] = useState(false)
  const [mobileInspectorTab, setMobileInspectorTab] = useState<"summary" | "chart" | "advice">("summary")

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
    setPlaybookOpen(false)
    setSegmentsOpen(false)

    // Hydrate Chiang Mai immediately from the initial outlook payload when available
    if (
      selectedProvinceCode === "CM" &&
      outlook?.default_province_detail &&
      outlook.default_province_detail.province?.province_code === "CM"
    ) {
      setDetail(outlook.default_province_detail)
      setDetailError(null)
      setDetailLoading(false)
      return () => {
        active = false
      }
    }

    setDetailLoading(true)
    setDetailError(null)
    fetchProvinceDetail(selectedProvinceCode)
      .then((res) => {
        if (active) {
          setDetail(res)
          setDetailError(null)
        }
      })
      .catch((err) => {
        if (active) {
          setDetail(null)
          setDetailError(formatFetchError(err, lang))
        }
      })
      .finally(() => {
        if (active) setDetailLoading(false)
      })
    return () => {
      active = false
    }
  }, [selectedProvinceCode, detailRetryNonce, lang, outlook?.default_province_detail])

  // Recover automatically if outlook finishes loading after an early cold start detail error
  useEffect(() => {
    if (outlook && !detail && detailError && !detailLoading) {
      setDetailRetryNonce((n) => n + 1)
    }
  }, [outlook, detail, detailError, detailLoading])

  // Compute live regional averages and notable spotlight provinces for 1 click exploration
  const regionalBenchmarks = useMemo(() => {
    if (!provinces.length) {
      return {
        avgOcc: 58.0,
        avgSmeDebt: 0.65,
        avgSmeCushion: 22.0,
        spotlights: [] as { code: string; tag: string; name: string }[],
      }
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
        tag: lang === "th" ? "อัตราเข้าพักสูงสุด" : "Top Occupancy",
        name: lang === "th" ? topOcc.name_th : topOcc.name_en,
      })
    }
    if (topDebt) {
      spotlights.push({
        code: topDebt.province_code,
        tag: lang === "th" ? "ภาระหนี้ธุรกิจสูง" : "Highest SME Debt",
        name: lang === "th" ? topDebt.name_th : topDebt.name_en,
      })
    }
    if (lowCushion) {
      spotlights.push({
        code: lowCushion.province_code,
        tag: lang === "th" ? "เงินเหลือหลังหักค่าใช้จ่ายน้อย" : "Thin Cash Surplus",
        name: lang === "th" ? lowCushion.name_th : lowCushion.name_en,
      })
    }
    if (highShock && !spotlights.some((s) => s.code === highShock.province_code)) {
      spotlights.push({
        code: highShock.province_code,
        tag: highShock.has_active_water_pollution
          ? lang === "th"
            ? "เฝ้าระวังน้ำปนเปื้อนสารพิษ"
            : "Water Pollution Alert"
          : lang === "th"
            ? "เสี่ยงภัยฝุ่นหรือฝนตกหนัก"
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
      shock: pt.composite_shock_idx != null ? Number(pt.composite_shock_idx.toFixed(1)) : null,
      flood: pt.flood_shock_subidx != null ? Number(pt.flood_shock_subidx.toFixed(1)) : null,
      haze: pt.haze_shock_subidx != null ? Number(pt.haze_shock_subidx.toFixed(1)) : null,
      macro: pt.macro_pressure_subidx != null ? Number(pt.macro_pressure_subidx.toFixed(1)) : null,
      cpiYoy: pt.th_cpi_yoy_pct != null ? Number(pt.th_cpi_yoy_pct.toFixed(2)) : null,
      oilYoy: pt.oil_brent_yoy_pct != null ? Number(pt.oil_brent_yoy_pct.toFixed(1)) : null,
      rainMm: pt.rainfall_sum_mm != null ? Math.round(pt.rainfall_sum_mm) : null,
      pm25: pt.pm25_mean != null ? Number(pt.pm25_mean.toFixed(1)) : null,
    }))
  }, [detail, lang])

  const availableSeasonYears = useMemo(() => {
    const years = new Set<string>()
    for (const pt of detail?.monthly_series ?? []) {
      const yr = pt.month_date?.slice(0, 4)
      if (yr && /^\d{4}$/.test(yr)) years.add(yr)
    }
    return Array.from(years).sort((a, b) => Number(b) - Number(a))
  }, [detail])

  const effectiveSeasonYear =
    seasonYear !== "all" && availableSeasonYears.includes(seasonYear) ? seasonYear : "all"

  const activeSeasonRows = useMemo(() => {
    if (effectiveSeasonYear === "all") {
      return detail?.seasonality_calendar ?? []
    }
    const filtered = (detail?.monthly_series ?? [])
      .filter((pt) => pt.month_date?.startsWith(effectiveSeasonYear))
      .map((pt) => ({
        cal_month: Number(pt.month_date.slice(5, 7)),
        avg_occupancy_rate: pt.occupancy_rate,
        avg_pm25_mean: pt.pm25_mean,
        avg_rainfall_mm: pt.rainfall_sum_mm,
      }))
      .filter((row) => row.cal_month >= 1 && row.cal_month <= 12)
      .sort((a, b) => a.cal_month - b.cal_month)
    return filtered
  }, [detail, effectiveSeasonYear])

  const seasonYearRangeLabel = useMemo(() => {
    if (!availableSeasonYears.length) {
      return lang === "th" ? "เฉลี่ยทุกปี" : "All Years"
    }
    const minYr = Number(availableSeasonYears[availableSeasonYears.length - 1])
    const maxYr = Number(availableSeasonYears[0])
    if (minYr === maxYr) {
      return lang === "th" ? `ปี ${maxYr + 543}` : `${maxYr}`
    }
    return lang === "th"
      ? `เฉลี่ยทุกปี (${minYr + 543}–${maxYr + 543})`
      : `All Years (${minYr}–${maxYr})`
  }, [availableSeasonYears, lang])

  const seasonalityData = useMemo(() => {
    return activeSeasonRows.map((m) => ({
      month: shortCalendarMonth(m.cal_month, lang),
      fullMonth: fullCalendarMonth(m.cal_month, lang),
      occupancy: m.avg_occupancy_rate != null ? Number(m.avg_occupancy_rate.toFixed(1)) : null,
      pm25: m.avg_pm25_mean != null ? Number(m.avg_pm25_mean.toFixed(1)) : null,
      rain: m.avg_rainfall_mm != null ? Math.round(m.avg_rainfall_mm) : null,
    }))
  }, [activeSeasonRows, lang])

  const monthlyTrendPeriod = useMemo(() => {
    const series = (detail?.monthly_series ?? []).slice(-18)
    if (!series.length) return ""
    return `${formatThaiMonth(series[0].month_date, lang)}–${formatThaiMonth(series[series.length - 1].month_date, lang)}`
  }, [detail, lang])

  const seasonalPlan = useMemo(() => {
    const cal = activeSeasonRows
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

    const highMonthsText = joinNaturalList(
      sortedOccDesc.slice(0, 2).map((c) => fullCalendarMonth(c.cal_month, lang)),
      lang,
    )
    const lowMonthsText = joinNaturalList(
      sortedOccAsc.slice(0, 2).map((c) => fullCalendarMonth(c.cal_month, lang)),
      lang,
    )

    // Check actual threshold exceedances for PM2.5 above 37.5 ug/m3 and heavy rainfall above 180 mm
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
      peakMonthName: peakM ? fullCalendarMonth(peakM.cal_month, lang) : "",
      peakOcc: peakOcc.toFixed(1),
      lowMonthsText,
      lowMonthName: lowM ? fullCalendarMonth(lowM.cal_month, lang) : "",
      lowOcc: lowOcc.toFixed(1),
      dropFromPeakPct,
      hasHazeExceed: hazeExceed.length > 0,
      hazeExceedMonths: joinNaturalList(
        hazeExceed.slice(0, 2).map((c) => fullCalendarMonth(c.cal_month, lang)),
        lang,
      ),
      maxHazeVal: maxHaze?.avg_pm25_mean != null ? maxHaze.avg_pm25_mean.toFixed(1) : "0",
      maxHazeMonth: maxHaze ? fullCalendarMonth(maxHaze.cal_month, lang) : "",
      rainPeakMonths: joinNaturalList(
        (rainExceed.length ? rainExceed : maxRain ? [maxRain] : [])
          .slice(0, 2)
          .map((c) => fullCalendarMonth(c.cal_month, lang)),
        lang,
      ),
      maxRainMm: maxRain?.avg_rainfall_mm != null ? Math.round(maxRain.avg_rainfall_mm) : 0,
      monthCount: cal.length,
      lastMonthName: cal.length ? fullCalendarMonth(cal[cal.length - 1].cal_month, lang) : "",
    }
  }, [activeSeasonRows, lang])

  const bestSeasonMonths = useMemo(() => {
    const cal = detail?.seasonality_calendar ?? []
    if (!cal.length) return ""
    return joinNaturalList(
      [...cal]
        .filter((c) => c.avg_occupancy_rate != null)
        .sort((a, b) => (b.avg_occupancy_rate ?? 0) - (a.avg_occupancy_rate ?? 0))
        .slice(0, 2)
        .map((c) => fullCalendarMonth(c.cal_month, lang)),
      lang,
    )
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
          ? `ช่วงฝุ่นสูงในเดือน${fullCalendarMonth(peakHaze.cal_month, lang)}`
          : `high haze in ${fullCalendarMonth(peakHaze.cal_month, lang)}`,
      )
    }
    if (peakRain) {
      parts.push(
        lang === "th"
          ? `ช่วงฝนชุกในเดือน${fullCalendarMonth(peakRain.cal_month, lang)}`
          : `heavy rainfall in ${fullCalendarMonth(peakRain.cal_month, lang)}`,
      )
    }
    return joinNaturalList(parts, lang)
  }, [detail, lang])

  const metricTabs: { id: MapMetricMode; label: string }[] =
    lang === "th"
      ? [
          { id: "cluster", label: "ระดับความเสี่ยง" },
          { id: "occupancy", label: "อัตราเข้าพัก" },
          { id: "debt", label: "ภาระหนี้และเงินเหลือ" },
        ]
      : [
          { id: "cluster", label: "Risk Tier" },
          { id: "occupancy", label: "Occupancy" },
          { id: "debt", label: "Debt & Surplus" },
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
            ? `ยอดหนี้คงค้างเฉลี่ยคิดเป็น ${Math.round(smeDebt * 100)}% ของรายได้ทั้งปี (ไม่ใช่ค่างวดรายเดือน) และมีเงินเหลือหลังหักรายจ่ายเฉลี่ย ${cushion.toFixed(0)}% ของรายได้ (ควรวางแผนลดภาระค่างวด)`
            : smeDebt >= 0.65 || cushion <= 22
              ? `ยอดหนี้คงค้างเฉลี่ยคิดเป็น ${Math.round(smeDebt * 100)}% ของรายได้ทั้งปี (ไม่ใช่ค่างวดรายเดือน) และมีเงินเหลือหลังหักรายจ่ายเฉลี่ย ${cushion.toFixed(0)}% ของรายได้ (ควรสำรองเงินรับช่วงผู้เข้าพักน้อย)`
              : `ยอดหนี้คงค้างเฉลี่ยคิดเป็น ${Math.round(smeDebt * 100)}% ของรายได้ทั้งปี (ไม่ใช่ค่างวดรายเดือน) และมีเงินเหลือหลังหักรายจ่ายเฉลี่ย ${cushion.toFixed(0)}% ของรายได้ (สภาพคล่องดี)`
          : "อยู่ระหว่างอัปเดตข้อมูลฐานะการเงินรายจังหวัด"

      const seasonLine = bestSeasonMonths
        ? `ช่วงทำรายได้หลักคือเดือน${bestSeasonMonths}${stressSeasonMonths ? ` ส่วนช่วงที่ควรสำรองเงินสดรับมือคือ${stressSeasonMonths}` : ""}`
        : translateClusterGuidance(selectedItem.cluster_label, lang)

      return [
        { label: "สถานการณ์การท่องเที่ยว", text: `${occCompare}${yoyNote}` },
        { label: "ภาระหนี้และรายได้ของผู้ประกอบการ", text: finLine },
        { label: "ช่วงเวลาที่ควรวางแผนการเงิน", text: seasonLine },
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
      : translateClusterGuidance(selectedItem.cluster_label, lang)

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
      className="scroll-target scroll-mt-28 bg-secondary/45 px-4 py-16 sm:px-8 md:py-20"
    >
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-5"
        >
          <div className="max-w-2xl">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              {lang === "th" ? "สถานการณ์รายจังหวัด" : "Provincial Outlook"}
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
                ? "เลือกจังหวัดเพื่อดูอัตราเข้าพัก ภาระหนี้ และรายได้ที่เหลือหลังหักค่าใช้จ่าย เทียบกับค่าเฉลี่ยภาคเหนือตลอดทั้งปี"
                : "Hover or click any province to compare occupancy, SME debt, and post-expense cash surplus against the regional average with a 12-month planner."}
            </p>
          </div>
        </motion.div>

        {/* 1 Click Spotlight Quick Jump Bar */}
        {regionalBenchmarks.spotlights.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Sparkles aria-hidden="true" className="size-3.5 text-foreground" />
              {lang === "th" ? "ข้อมูลที่น่าสนใจ:" : "Notable provinces:"}
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
                    ? "ตรวจพบสัญญาณเฝ้าระวังน้ำปนเปื้อนสารพิษและแรงกดดันภายนอก"
                    : "ตรวจพบสัญญาณแรงกดดันภายนอกเกินเกณฑ์เฝ้าระวัง"
                  : (summary.water_pollution_alert_provinces?.length ?? 0) > 0
                    ? "Active Water Pollution & Multi Hazard Alert"
                    : "Active External Physical Shock Alert"}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {lang === "th"
                  ? `จังหวัดที่ควรเฝ้าระวังเป็นพิเศษ: ${shockProvinceNames.join(", ")} (ตรวจสอบข่าวอ้างอิงจริงและเกณฑ์มาตรการด้านล่าง)`
                  : `Provinces under active alert: ${shockProvinceNames.join(", ")} (inspect verified field reports and relief playbook below).`}
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-5 rounded-2xl border border-amber-600/30 bg-amber-500/10 px-5 py-3.5 text-xs text-amber-950">
            {lang === "th"
              ? "กำลังเชื่อมต่อข้อมูลจากเซิร์ฟเวอร์ กรุณารอสักครู่หรือกดรีเฟรชหน้าเว็บหากเพิ่งเปิดใช้งานครั้งแรก"
              : "Connecting to live backend service. Please refresh in a moment if the server is waking up."}
          </div>
        )}

        {/* Balanced 2 Column Map Stage + Animated Provincial Inspector */}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(320px,44fr)_minmax(0,56fr)]">
          {/* Left Map Stage with Regional Tier Breakdown */}
          <div className="flex flex-col gap-4 rounded-[1.75rem] border border-border bg-background p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-sm font-medium text-[#4B5563]">
                <MapPin aria-hidden="true" className="size-3.5 text-foreground" />
                <span className="md:hidden">
                  {lang === "th"
                    ? "แตะจังหวัดบนแผนที่ หรือเลือกจากรายชื่อด้านล่าง"
                    : "Tap a province, or pick one from the list below"}
                </span>
                <span className="hidden md:inline">
                  {lang === "th" ? "ชี้เพื่อดูเร็ว · คลิกเพื่อเจาะลึก" : "Hover to preview · Click to inspect"}
                </span>
              </span>
              {outlook?.latest_month && (
                <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                  {formatThaiMonth(outlook.latest_month, lang)}
                </span>
              )}
            </div>

            <div
              role="tablist"
              aria-label={lang === "th" ? "ตัวเลือกมุมมองแผนที่" : "Map layer selector"}
              className="grid grid-cols-3 gap-1 rounded-2xl border border-border bg-secondary/45 p-1"
            >
              {metricTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={metricMode === tab.id}
                  onClick={() => setMetricMode(tab.id)}
                  className={`rounded-xl px-2 py-2 text-center text-[11px] font-medium leading-tight transition-colors sm:text-xs ${
                    metricMode === tab.id
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {provinces.length > 0 && (
              <label className="block md:hidden">
                <span className="mb-1.5 block text-sm font-medium text-[#4B5563]">
                  {lang === "th" ? "เลือกจังหวัด" : "Choose a province"}
                </span>
                <select
                  value={selectedItem?.province_code ?? ""}
                  onChange={(e) => setSelectedProvinceCode(e.target.value)}
                  className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base font-medium text-foreground outline-none focus:border-foreground/45"
                >
                  {provinces.map((p) => (
                    <option key={p.province_code} value={p.province_code}>
                      {lang === "th" ? p.name_th : p.name_en}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {loading && !provinces.length ? (
              <div className="flex h-[440px] items-center justify-center text-xs text-muted-foreground">
                {lang === "th" ? "กำลังโหลดแผนที่ข้อมูลจริง…" : "Loading map…"}
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
                <button
                  type="button"
                  aria-expanded={mobileTierListOpen}
                  onClick={() => setMobileTierListOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 text-left md:hidden"
                >
                  <span className="text-xs font-semibold text-foreground">
                    {lang === "th"
                      ? "ดูรายชื่อ 17 จังหวัดแยกตามระดับความเสี่ยง (4 ระดับ)"
                      : "View all 17 provinces by risk tier"}
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                      mobileTierListOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                <p className="mb-2 hidden text-[11px] font-semibold text-foreground md:block">
                  {lang === "th"
                    ? "ภาพรวมทุกจังหวัด จำแนกตามระดับความเสี่ยงทางเศรษฐกิจของพื้นที่"
                    : "Provincial Economic Risk Overview"}
                </p>
                <div className={`${mobileTierListOpen ? "mt-2.5 block" : "hidden"} space-y-2 md:mt-0 md:block`}>
                  {tierGroups.map((grp) => (
                    <div key={grp.tier} className="rounded-xl bg-background px-3 py-2">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                          <span
                            style={{
                              backgroundColor:
                                grp.tier === 1
                                  ? "#e57373"
                                  : grp.tier === 2
                                    ? "#f5b87a"
                                    : grp.tier === 3
                                      ? "#93c5e8"
                                      : "#7ec8a9",
                            }}
                            className="size-2.5 shrink-0 rounded-full ring-1 ring-black/10"
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
                          ? `เฝ้าระวังน้ำปนเปื้อนสารพิษ (${selectedItem.water_pollution_count ?? 1} ข่าว)`
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

                  {/* Mobile sub-tab switcher to prevent long scrolling on phones while keeping desktop untouched */}
                  <div
                    role="tablist"
                    aria-label={lang === "th" ? "เลือกหัวข้อข้อมูลจังหวัด" : "Provincial section tabs"}
                    className="grid grid-cols-3 gap-1 rounded-2xl border border-border bg-secondary/45 p-1 md:hidden"
                  >
                    {(
                      [
                        { id: "summary", th: "สรุปจังหวัด", en: "Summary" },
                        { id: "chart", th: "กราฟและฤดูกาล", en: "Charts" },
                        { id: "advice", th: "คำแนะนำธุรกิจ", en: "Guidance" },
                      ] as const
                    ).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={mobileInspectorTab === t.id}
                        onClick={() => setMobileInspectorTab(t.id)}
                        className={`rounded-xl px-2 py-2 text-center text-xs font-medium transition-colors ${
                          mobileInspectorTab === t.id
                            ? "bg-foreground text-background shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {lang === "th" ? t.th : t.en}
                      </button>
                    ))}
                  </div>

                  <div className={mobileInspectorTab === "summary" ? "space-y-4" : "hidden md:block md:space-y-4"}>
                    {/* Plain language 3 bullet summary */}
                    <div className="rounded-2xl border border-border bg-secondary/45 p-3.5">
                      <ul className="space-y-1.5 text-sm leading-6 text-[#4B5563]">
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
                        pct={selectedItem.occupancy_rate != null ? Math.min(100, selectedItem.occupancy_rate) : null}
                        avgPct={Math.min(100, regionalBenchmarks.avgOcc)}
                      />
                      <CompareBarTile
                        label={lang === "th" ? "สัดส่วนหนี้ต่อรายได้ทั้งปี" : "Debt / Annual Income"}
                        valueText={
                          selectedItem.debt_to_annual_income_sme != null
                            ? `${Math.round(selectedItem.debt_to_annual_income_sme * 100)}%`
                            : "—"
                        }
                        subText={
                          lang === "th"
                            ? `เฉลี่ยภาคเหนือ ${Math.round(regionalBenchmarks.avgSmeDebt * 100)}%`
                            : `North avg ${Math.round(regionalBenchmarks.avgSmeDebt * 100)}%`
                        }
                        pct={selectedItem.debt_to_annual_income_sme != null
                          ? Math.min(100, (selectedItem.debt_to_annual_income_sme / 1.6) * 100)
                          : null}
                        avgPct={Math.min(100, (regionalBenchmarks.avgSmeDebt / 1.6) * 100)}
                      />
                      <CompareBarTile
                        label={lang === "th" ? "เงินเหลือใช้ต่อเดือน" : "Monthly cash left"}
                        valueText={selectedCushion != null ? `${selectedCushion.toFixed(0)}%` : "—"}
                        subText={
                          lang === "th"
                            ? `เฉลี่ยภาคเหนือ ${regionalBenchmarks.avgSmeCushion.toFixed(0)}%`
                            : `North avg ${regionalBenchmarks.avgSmeCushion.toFixed(0)}%`
                        }
                        pct={selectedCushion != null ? Math.min(100, (selectedCushion / 50) * 100) : null}
                        avgPct={Math.min(100, (regionalBenchmarks.avgSmeCushion / 50) * 100)}
                      />
                    </div>
                  </div>

                  {/* Vulnerability Tiering Playbook & Sector Sensitivity */}
                  {selectedItem.vulnerability_tier && (
                    <div
                      className={`${
                        mobileInspectorTab === "advice" ? "block" : "hidden md:block"
                      } rounded-2xl border border-border bg-secondary/35 p-4`}
                    >
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
                            ? `สัญญาณระดับจังหวัด ${selectedItem.vulnerability_score ?? 0}/100`
                            : `Provincial Signal ${selectedItem.vulnerability_score ?? 0}/100`}
                        </span>
                      </div>

                      <p className="mt-1.5 text-xs leading-5 text-[#4B5563]">
                        {lang === "th"
                          ? "หมายเหตุ: การจัดระดับและแนวทางด้านล่างเป็นสัญญาณเฝ้าระวังระดับจังหวัดจากค่าเฉลี่ยสถิติทางการ ไม่ใช่การประเมินเครดิตหรือความสามารถชำระหนี้ของธุรกิจรายบุคคล (การคำนวณข้อมูลกิจการของท่านแยกอยู่ในเครื่องมือตรวจสุขภาพการเงินด้านบน)"
                          : "Note: This tier and sector playbook reflect provincial macro surveillance averages, not an individual firm credit assessment (use the firm calculator above for your own business numbers)."}
                      </p>

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

                      <div className="mt-3 overflow-hidden rounded-xl border border-border/80 bg-background">
                        <button
                          type="button"
                          aria-expanded={playbookOpen}
                          onClick={() => setPlaybookOpen((open) => !open)}
                          className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                        >
                          <span className="text-sm font-semibold text-foreground">
                            {lang === "th"
                              ? `เกณฑ์ตั้งต้นมาตรการช่วยเหลือ: ${selectedItem.tier_playbook_title_th}`
                              : `Recommended starting playbook: ${selectedItem.tier_playbook_title_en}`}
                          </span>
                          <ChevronDown
                            aria-hidden="true"
                            className={`size-4 shrink-0 transition-transform ${playbookOpen ? "rotate-180" : ""}`}
                          />
                        </button>
                        {playbookOpen && (
                          <ul className="space-y-1.5 border-t border-border px-3 py-3 text-sm leading-6 text-[#4B5563]">
                            {(lang === "th" ? selectedItem.tier_actions_th : selectedItem.tier_actions_en)
                              ?.slice(0, 3)
                              .map((act) => (
                                <li key={act} className="flex items-start gap-2">
                                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/60" aria-hidden="true" />
                                  <span>{act}</span>
                                </li>
                              ))}
                          </ul>
                        )}
                      </div>

                      {selectedItem.business_segments && selectedItem.business_segments.length > 0 && (
                        <div className="mt-2.5 overflow-hidden rounded-xl border border-border bg-background">
                          <button
                            type="button"
                            aria-expanded={segmentsOpen}
                            onClick={() => setSegmentsOpen((open) => !open)}
                            className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm font-semibold text-foreground"
                          >
                            {lang === "th"
                              ? "คำแนะนำสำหรับแต่ละประเภทธุรกิจ"
                              : "Guidance by business sector"}
                            <ChevronDown
                              aria-hidden="true"
                              className={`size-4 shrink-0 transition-transform ${segmentsOpen ? "rotate-180" : ""}`}
                            />
                          </button>
                          {segmentsOpen && (
                            <div className="grid gap-2 border-t border-border p-3 sm:grid-cols-3">
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
                                        ? "สภาพคล่องดี"
                                        : "Resilient"
                                return (
                                  <div
                                    key={seg.sector}
                                    className="flex h-full flex-col justify-between rounded-xl border border-border bg-background p-2.5"
                                  >
                                    <div className="flex items-center justify-between gap-1.5">
                                      <span className="min-w-0 text-sm font-medium text-foreground">
                                        {lang === "th" ? seg.label_th.replace("คาเฟ่", "ร้านกาแฟ") : seg.label_en}
                                      </span>
                                      <span
                                        className={`shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${toneCls}`}
                                      >
                                        {riskText}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-sm leading-6 text-[#4B5563]">
                                      {lang === "th" ? seg.guidance_th : seg.guidance_en}
                                    </p>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Peer Provinces in the same Vulnerability Tier */}
                      {activeTierGroup && activeTierGroup.provinces.length > 1 && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-2.5">
                          <span className="text-[10px] font-medium text-muted-foreground">
                            {lang === "th"
                              ? `จังหวัดที่มีระดับความเสี่ยงใกล้เคียงกัน (${activeTierGroup.province_count} จังหวัด):`
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
                  <div
                    className={`${
                      mobileInspectorTab === "chart" ? "block" : "hidden md:block"
                    } rounded-2xl border border-border bg-secondary/30 p-4`}
                  >
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
                          {lang === "th" ? "แนวโน้มข้อมูลรายเดือน" : "Month Trend"}
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
                          {lang === "th" ? "ฤดูกาลท่องเที่ยวและสภาพอากาศ" : "Monthly Tourism & Weather"}
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                        {chartTab === "trend" ? (
                          <>
                            <span className="inline-flex items-center gap-1">
                              <span className="h-0.5 w-3 bg-slate-900" aria-hidden="true" />
                              {lang === "th" ? "อัตราเข้าพัก" : "Occupancy Rate"}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="size-2 rounded-sm bg-slate-300" aria-hidden="true" />
                              {lang === "th" ? "แรงกดดันรวม 0–100 (ตั้งแต่ 50 = เฝ้าระวัง)" : "Total Pressure 0–100 (50+ = watch)"}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="inline-flex items-center gap-1">
                              <span className="h-0.5 w-3 bg-slate-900" aria-hidden="true" />
                              {lang === "th" ? "อัตราเข้าพักเฉลี่ย" : "Avg Occupancy"}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="h-0.5 w-3 border-t border-dashed border-amber-600" aria-hidden="true" />
                              {lang === "th"
                                ? `เฉลี่ยรายเดือนย้อนหลัง (${seasonalPlan?.annualAvgOcc ?? "—"}%)`
                                : `Historical monthly mean (${seasonalPlan?.annualAvgOcc ?? "—"}%)`}
                            </span>
                            {(weatherOverlay === "both" || weatherOverlay === "rain") && (
                              <span className="inline-flex items-center gap-1">
                                <span className="size-2 rounded-sm bg-sky-600/50" aria-hidden="true" />
                                {lang === "th" ? "ปริมาณฝน (มม.)" : "Rainfall (mm)"}
                              </span>
                            )}
                            {(weatherOverlay === "both" || weatherOverlay === "pm25") && (
                              <>
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-2 py-1 text-orange-800">
                                  <span className="size-2 shrink-0 rounded-full bg-orange-500" aria-hidden="true" />
                                  {lang === "th" ? "ต่ำกว่า 37.5 µg/m³ สีส้ม" : "Below 37.5 µg/m³ Orange"}
                                </span>
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2 py-1 text-red-800">
                                  <span className="size-2 shrink-0 rounded-full bg-red-600" aria-hidden="true" />
                                  {lang === "th" ? "ตั้งแต่ 37.5 µg/m³ สีแดง" : "At or above 37.5 µg/m³ Red"}
                                </span>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {chartTab === "trend" && !detailLoading && !detailError && (
                      <p className="mb-1 text-[10px] text-muted-foreground">
                        {lang === "th"
                          ? `ข้อมูลรายเดือน${monthlyTrendPeriod ? ` ${monthlyTrendPeriod}` : ""} ช่องว่างคือไม่มีข้อมูล`
                          : `Monthly data${monthlyTrendPeriod ? ` ${monthlyTrendPeriod}` : ""} Gaps mean no data`}
                      </p>
                    )}

                    {chartTab === "seasonality" && !detailLoading && !detailError && (
                      <div className="mb-2.5 space-y-2 text-[10px]">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div
                            role="group"
                            aria-label={lang === "th" ? "เลือกปีข้อมูลฤดูกาล" : "Select seasonality year"}
                            className="inline-flex flex-wrap items-center gap-0.5 rounded-full border border-border bg-background p-0.5 font-medium"
                          >
                            <button
                              type="button"
                              onClick={() => setSeasonYear("all")}
                              className={`rounded-full px-2.5 py-0.5 transition-colors ${
                                effectiveSeasonYear === "all"
                                  ? "bg-foreground text-background"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {seasonYearRangeLabel}
                            </button>
                            {availableSeasonYears.map((yr) => (
                              <button
                                key={yr}
                                type="button"
                                onClick={() => setSeasonYear(yr)}
                                className={`rounded-full px-2.5 py-0.5 transition-colors ${
                                  effectiveSeasonYear === yr
                                    ? "bg-foreground text-background"
                                    : "text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                {lang === "th" ? `ปี ${Number(yr) + 543}` : yr}
                              </button>
                            ))}
                          </div>

                          <div className="inline-flex rounded-full border border-border bg-background p-0.5 font-medium">
                            {(
                              [
                                { id: "both", th: "เทียบทั้งฝนและฝุ่น", en: "Rain & PM2.5" },
                                { id: "pm25", th: "เฉพาะฝุ่น PM2.5", en: "PM2.5 Only" },
                                { id: "rain", th: "เฉพาะปริมาณฝน", en: "Rain Only" },
                              ] as const
                            ).map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => setWeatherOverlay(opt.id)}
                                className={`rounded-full px-2.5 py-0.5 transition-colors ${
                                  weatherOverlay === opt.id
                                    ? "bg-foreground text-background"
                                    : "text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                {lang === "th" ? opt.th : opt.en}
                              </button>
                            ))}
                          </div>
                        </div>

                        {effectiveSeasonYear !== "all" && seasonalPlan && seasonalPlan.monthCount < 12 && (
                          <p className="text-[10px] text-muted-foreground">
                            {lang === "th"
                              ? `ข้อมูลทางการปี ${Number(effectiveSeasonYear) + 543} เผยแพร่ล่าสุดถึงเดือน${seasonalPlan.lastMonthName} (${seasonalPlan.monthCount} เดือน)`
                              : `Official ${effectiveSeasonYear} data currently covers through ${seasonalPlan.lastMonthName} (${seasonalPlan.monthCount} months).`}
                          </p>
                        )}
                      </div>
                    )}

                    {detailLoading ? (
                      <div className="flex h-[205px] items-center justify-center text-xs text-muted-foreground">
                        {lang === "th" ? "กำลังโหลดข้อมูลรายเดือนของจังหวัด…" : "Loading provincial series…"}
                      </div>
                    ) : detailError ? (
                      <div className="flex h-[205px] flex-col items-center justify-center gap-2.5 rounded-xl border border-destructive/25 bg-destructive/5 px-4 text-center text-xs text-destructive">
                        <p className="max-w-md leading-5">{detailError}</p>
                        <button
                          type="button"
                          onClick={() => setDetailRetryNonce((n) => n + 1)}
                          className="inline-flex h-8 items-center rounded-full border border-destructive/30 bg-background px-3.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                        >
                          {lang === "th" ? "ลองโหลดข้อมูลใหม่" : "Retry Loading"}
                        </button>
                      </div>
                    ) : chartTab === "trend" ? (
                      <div className="h-[205px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={trendChartData} margin={{ top: 8, right: 6, left: -16, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="hsl(var(--border))" />
                            <XAxis
                              dataKey="label"
                              tick={{ fontSize: 10 }}
                              tickLine={false}
                              axisLine={false}
                              interval="preserveStartEnd"
                              minTickGap={32}
                            />
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
                                const shockBandTh =
                                  d.shock == null
                                    ? ""
                                    : d.shock >= 70
                                      ? "รุนแรง"
                                      : d.shock >= 50
                                        ? "เฝ้าระวังสูง"
                                        : d.shock >= 30
                                          ? "เฝ้าระวัง"
                                          : "ปกติ"
                                const shockBandEn =
                                  d.shock == null
                                    ? ""
                                    : d.shock >= 70
                                      ? "Severe"
                                      : d.shock >= 50
                                        ? "Elevated"
                                        : d.shock >= 30
                                          ? "Watch"
                                          : "Normal"
                                const rainStatusTh =
                                  d.flood != null && d.flood >= 50
                                    ? "ฝนชุกกว่าปกติ"
                                    : d.flood != null && d.flood >= 25
                                      ? "ฝนค่อนข้างมาก"
                                      : "ปกติ"
                                const rainStatusEn =
                                  d.flood != null && d.flood >= 50
                                    ? "Above normal"
                                    : d.flood != null && d.flood >= 25
                                      ? "Moderate"
                                      : "Normal"
                                const pmStatusTh =
                                  d.pm25 != null && d.pm25 >= 75
                                    ? "วิกฤต"
                                    : d.pm25 != null && d.pm25 >= 37.5
                                      ? "เกินเกณฑ์ 37.5"
                                      : "ปกติ"
                                const pmStatusEn =
                                  d.pm25 != null && d.pm25 >= 75
                                    ? "Hazardous"
                                    : d.pm25 != null && d.pm25 >= 37.5
                                      ? "Above 37.5"
                                      : "Normal"
                                const macroStatusTh =
                                  d.macro == null
                                    ? "รอประกาศ"
                                    : d.macro >= 50
                                      ? "ต้นทุนกดดันสูง"
                                      : d.macro >= 20
                                        ? "ต้นทุนเริ่มกดดัน"
                                        : "ต้นทุนไม่กดดัน"
                                const macroStatusEn =
                                  d.macro == null
                                    ? "Pending"
                                    : d.macro >= 50
                                      ? "High pressure"
                                      : d.macro >= 20
                                        ? "Mild pressure"
                                        : "No pressure"
                                const cpiTxt =
                                  d.cpiYoy != null
                                    ? `${d.cpiYoy > 0 ? "+" : ""}${d.cpiYoy}%`
                                    : lang === "th"
                                      ? "รอประกาศ"
                                      : "Pending"
                                const oilTxt =
                                  d.oilYoy != null
                                    ? `${d.oilYoy > 0 ? "+" : ""}${d.oilYoy}%`
                                    : lang === "th"
                                      ? "รอประกาศ"
                                      : "Pending"

                                return (
                                  <div className="rounded-xl border border-border bg-background px-3 py-2 text-[11px] shadow-lg">
                                    <p className="font-semibold text-foreground">{label}</p>
                                    <p className="mt-1 text-foreground">
                                      {lang === "th" ? "อัตราเข้าพัก" : "Occupancy"}:{" "}
                                      <strong>{d.occupancy != null ? `${d.occupancy}%` : "N/A"}</strong>
                                    </p>
                                    <p className="text-muted-foreground">
                                      {lang === "th" ? "แรงกดดันภายนอกรวม" : "External Pressure"}:{" "}
                                      <strong className="text-foreground">
                                        {d.shock != null
                                          ? `${d.shock}/100 (${lang === "th" ? shockBandTh : shockBandEn})`
                                          : lang === "th"
                                            ? "ไม่มีข้อมูล"
                                            : "No data"}
                                      </strong>
                                    </p>
                                    <div className="mt-1.5 space-y-1 border-t border-border pt-1.5 text-[10px] text-muted-foreground">
                                      <p>
                                        {lang === "th" ? "ปริมาณฝน" : "Rainfall"}:{" "}
                                        <strong className="text-foreground">
                                          {d.rainMm != null
                                            ? `${d.rainMm} ${lang === "th" ? "มม." : "mm"}`
                                            : lang === "th"
                                              ? "ไม่มีข้อมูล"
                                              : "No data"}
                                        </strong>{" "}
                                        ({lang === "th" ? rainStatusTh : rainStatusEn})
                                      </p>
                                      <p>
                                        {lang === "th" ? "ฝุ่น PM2.5 เฉลี่ย" : "Avg PM2.5"}:{" "}
                                        <strong className="text-foreground">
                                          {d.pm25 != null
                                            ? `${d.pm25} µg/m³`
                                            : lang === "th"
                                              ? "ไม่มีข้อมูล"
                                              : "No data"}
                                        </strong>{" "}
                                        ({lang === "th" ? pmStatusTh : pmStatusEn})
                                      </p>
                                      <p>
                                        {lang === "th" ? "ต้นทุนมหภาค" : "Macro Costs"}:{" "}
                                        {lang === "th"
                                          ? `เงินเฟ้อ ${cpiTxt}, น้ำมัน Brent ${oilTxt} (${macroStatusTh})`
                                          : `CPI ${cpiTxt}, Brent ${oilTxt} (${macroStatusEn})`}
                                      </p>
                                    </div>
                                  </div>
                                )
                              }}
                            />
                            <Bar
                              yAxisId="shock"
                              dataKey="shock"
                              name={lang === "th" ? "แรงกดดันรวม (ภัยทางกายภาพและต้นทุนมหภาค)" : "Total Pressure (physical hazards & macro costs)"}
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
                        <div className="h-[215px] w-full">
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
                                hide={weatherOverlay === "pm25"}
                                tick={{ fontSize: 10 }}
                                tickLine={false}
                                axisLine={false}
                                unit={lang === "th" ? " มม." : "mm"}
                              />
                              <YAxis
                                yAxisId="pm25"
                                orientation="right"
                                hide={weatherOverlay !== "pm25"}
                                domain={[0, 90]}
                                tick={{ fontSize: 10 }}
                                tickLine={false}
                                axisLine={false}
                                unit=" µg/m³"
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
                              {weatherOverlay === "pm25" && (
                                <ReferenceLine
                                  yAxisId="pm25"
                                  y={37.5}
                                  stroke="#dc2626"
                                  strokeDasharray="3 3"
                                  strokeOpacity={0.7}
                                />
                              )}
                              <Tooltip
                                content={({ active, payload }) => {
                                  if (!active || !payload?.length) return null
                                  const d = payload[0]?.payload as (typeof seasonalityData)[number] | undefined
                                  if (!d) return null
                                  const isSingleYear = effectiveSeasonYear !== "all"
                                  const yearSuffix = isSingleYear
                                    ? lang === "th"
                                      ? ` ${Number(effectiveSeasonYear) + 543}`
                                      : ` ${effectiveSeasonYear}`
                                    : ""
                                  return (
                                    <div className="rounded-xl border border-border bg-background px-3 py-2 text-[11px] shadow-lg">
                                      <p className="font-semibold text-foreground">
                                        {lang === "th" ? `เดือน${d.fullMonth}${yearSuffix}` : `${d.fullMonth}${yearSuffix}`}
                                      </p>
                                      <p className="mt-1 text-foreground">
                                        {lang === "th"
                                          ? isSingleYear
                                            ? "อัตราการเข้าพัก"
                                            : "อัตราการเข้าพักเฉลี่ย"
                                          : isSingleYear
                                            ? "Occupancy Rate"
                                            : "Average Occupancy Rate"}
                                        :{" "}
                                        <strong>{d.occupancy != null ? `${d.occupancy}%` : (lang === "th" ? "ไม่มีข้อมูล" : "No data")}</strong>
                                      </p>
                                      <p className="text-muted-foreground">
                                        {lang === "th"
                                          ? isSingleYear
                                            ? "ปริมาณฝน"
                                            : "ปริมาณฝนเฉลี่ย"
                                          : isSingleYear
                                            ? "Rainfall"
                                            : "Avg Rainfall"}
                                        :{" "}
                                        <strong className="text-foreground">{d.rain != null ? `${d.rain} ${lang === "th" ? "มม." : "mm"}` : (lang === "th" ? "ไม่มีข้อมูล" : "No data")}</strong>
                                      </p>
                                      <p className="text-muted-foreground">
                                        {lang === "th"
                                          ? isSingleYear
                                            ? "ค่าฝุ่น PM2.5 รายเดือน"
                                            : "ค่าฝุ่น PM2.5 เฉลี่ย"
                                          : isSingleYear
                                            ? "Monthly PM2.5"
                                            : "Avg PM2.5"}
                                        :{" "}
                                        <strong className={d.pm25 != null && d.pm25 >= 37.5 ? "text-red-700" : "text-foreground"}>
                                          {d.pm25 != null
                                            ? `${d.pm25} µg/m³${d.pm25 >= 37.5 ? (lang === "th" ? " (ตั้งแต่เกณฑ์ 37.5)" : " (at/above 37.5)") : ""}`
                                            : (lang === "th" ? "ไม่มีข้อมูล" : "No data")}
                                        </strong>
                                      </p>
                                    </div>
                                  )
                                }}
                              />
                              {(weatherOverlay === "both" || weatherOverlay === "rain") && (
                                <Bar
                                  yAxisId="rain"
                                  dataKey="rain"
                                  name={lang === "th" ? "ปริมาณฝนเฉลี่ย (มม.)" : "Avg Rainfall (mm)"}
                                  fill="#0284c7"
                                  fillOpacity={0.32}
                                  radius={[4, 4, 0, 0]}
                                  barSize={weatherOverlay === "both" ? 10 : 16}
                                />
                              )}
                              {(weatherOverlay === "both" || weatherOverlay === "pm25") && (
                                <Bar
                                  yAxisId="pm25"
                                  dataKey="pm25"
                                  name={lang === "th" ? "ค่าฝุ่น PM2.5 เฉลี่ย (µg/m³)" : "Avg PM2.5 (µg/m³)"}
                                  radius={[4, 4, 0, 0]}
                                  barSize={weatherOverlay === "both" ? 10 : 16}
                                >
                                  {seasonalityData.map((entry, idx) => (
                                    <Cell
                                      key={`pm-${idx}`}
                                      fill={entry.pm25 != null && entry.pm25 >= 37.5 ? "#dc2626" : "#f97316"}
                                      fillOpacity={entry.pm25 != null && entry.pm25 >= 37.5 ? 0.72 : 0.45}
                                    />
                                  ))}
                                </Bar>
                              )}
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
                                  ? `ช่วงฤดูท่องเที่ยว (เดือน${seasonalPlan.highMonthsText})`
                                  : `High Season (${seasonalPlan.highMonthsText})`}
                              </p>
                              <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                                {lang === "th"
                                  ? `อัตราเข้าพักสูงสุดในเดือน${seasonalPlan.peakMonthName} (${seasonalPlan.peakOcc}%) เทียบกับค่าเฉลี่ย${effectiveSeasonYear === "all" ? "รายเดือนย้อนหลัง" : `ปี ${Number(effectiveSeasonYear) + 543}`} ${seasonalPlan.annualAvgOcc}%`
                                  : `Peaks in ${seasonalPlan.peakMonthName} (${seasonalPlan.peakOcc}%) vs ${effectiveSeasonYear === "all" ? "historical monthly" : effectiveSeasonYear} mean ${seasonalPlan.annualAvgOcc}%.`}
                              </p>
                            </div>
                            <div className="rounded-xl bg-background px-3 py-2">
                              <p className="text-[10px] font-semibold text-amber-800">
                                {lang === "th"
                                  ? `ช่วงผู้เข้าพักน้อย (เดือน${seasonalPlan.lowMonthsText})`
                                  : `Low Season (${seasonalPlan.lowMonthsText})`}
                              </p>
                              <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                                {lang === "th"
                                  ? `ต่ำสุดในเดือน${seasonalPlan.lowMonthName} (${seasonalPlan.lowOcc}%) โดยยอดเข้าพักลดลง ${seasonalPlan.dropFromPeakPct}% จากช่วงสูงสุด`
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
                                    ? `ฝุ่น PM2.5 เกินเกณฑ์ 37.5 ในเดือน${seasonalPlan.hazeExceedMonths} (สูงสุด ${seasonalPlan.maxHazeVal}) และฝนหนักสุดในเดือน${seasonalPlan.rainPeakMonths} (${seasonalPlan.maxRainMm} มิลลิเมตร)`
                                    : `PM2.5 exceeds 37.5 in ${seasonalPlan.hazeExceedMonths} (peak ${seasonalPlan.maxHazeVal}) and rain peaks in ${seasonalPlan.rainPeakMonths} (${seasonalPlan.maxRainMm} mm).`
                                  : lang === "th"
                                    ? `ฝุ่น PM2.5 เฉลี่ยรายเดือนไม่เกินเกณฑ์ 37.5 (สูงสุด ${seasonalPlan.maxHazeVal} ในเดือน${seasonalPlan.maxHazeMonth}) และฝนชุกในเดือน${seasonalPlan.rainPeakMonths} (${seasonalPlan.maxRainMm} มิลลิเมตร)`
                                    : `Monthly PM2.5 stays under 37.5 (peak ${seasonalPlan.maxHazeVal} in ${seasonalPlan.maxHazeMonth}) and rain peaks in ${seasonalPlan.rainPeakMonths} (${seasonalPlan.maxRainMm} mm).`}
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

        {/* Provincial News Strip Synced with Selected Province on Map */}
        {((detail?.verified_news?.length ?? 0) > 0 || newsItems.length > 0) && (
          <div className="mt-5 rounded-[1.75rem] border border-border bg-background p-5 sm:p-6">
            <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Newspaper aria-hidden="true" className="size-4 text-foreground" />
                <h3 className="font-display text-sm font-semibold text-foreground sm:text-base">
                  {selectedItem
                    ? lang === "th"
                      ? `ข่าวเศรษฐกิจและเหตุการณ์ล่าสุด: จังหวัด${selectedItem.name_th}`
                      : `Latest Economic & Local News: ${selectedItem.name_en}`
                    : lang === "th"
                      ? "ข่าวเศรษฐกิจและเหตุการณ์ล่าสุด"
                      : "Latest Economic & Local News"}
                </h3>
              </div>
              {selectedItem && (
                <span className="rounded-full bg-secondary px-3 py-1 text-[11px] font-medium text-foreground">
                  {lang === "th"
                    ? `จังหวัด${selectedItem.name_th}`
                    : selectedItem.name_en}
                </span>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(detail?.verified_news?.length ? detail.verified_news : newsItems).slice(0, 4).map((item, idx) => (
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
                        {selectedItem
                          ? lang === "th"
                            ? selectedItem.name_th
                            : selectedItem.name_en
                          : lang === "th"
                            ? item.name_th || item.province_code
                            : item.name_en || item.province_code}
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
                    <span className="truncate">{item.source_name || item.event_date}</span>
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
}: {
  label: string
  valueText: string
  subText: string
  pct: number | null
  avgPct: number
}) {
  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-border bg-secondary/30 px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 text-sm leading-5 text-[#4B5563]">{label}</p>
        <p className="shrink-0 whitespace-nowrap font-display text-base font-semibold tabular-nums text-foreground">
          {valueText}
        </p>
      </div>
      <div>
        <div className="relative mt-2.5 h-1.5 w-full rounded-full bg-border/80">
          {pct != null && (
            <div
              className="h-full rounded-full bg-slate-600 transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
            />
          )}
          <span
            title={subText}
            style={{ left: `${Math.min(96, Math.max(4, avgPct))}%` }}
            className="absolute -top-1 h-3.5 w-0.5 bg-slate-400"
            aria-hidden="true"
          />
        </div>
        <p className="mt-1.5 text-sm leading-5 text-[#4B5563]">{subText}</p>
      </div>
    </div>
  )
}
