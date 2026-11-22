"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { Lang, ProvinceDetailResponse } from "@/lib/api"
import type { DebtStatusKey } from "@/lib/financial-dossier"

type AppContextValue = {
  lang: Lang
  setLang: (lang: Lang) => void
  toggleLang: () => void
  selectedProvinceCode: string
  setSelectedProvinceCode: (code: string) => void
  activeDebtStatus: DebtStatusKey
  setActiveDebtStatus: (status: DebtStatusKey) => void
  activeBorrowerType: "individual" | "sme"
  setActiveBorrowerType: (type: "individual" | "sme") => void
  provinceDetail: ProvinceDetailResponse | null
  setProvinceDetail: (detail: ProvinceDetailResponse | null) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  // Default language is Thai per product preference with seamless switch to English
  const [lang, setLangState] = useState<Lang>("th")
  const [selectedProvinceCode, setSelectedProvinceCode] = useState<string>("CM")
  const [activeDebtStatus, setActiveDebtStatus] = useState<DebtStatusKey>("current")
  const [activeBorrowerType, setActiveBorrowerType] = useState<"individual" | "sme">("individual")
  const [provinceDetail, setProvinceDetail] = useState<ProvinceDetailResponse | null>(null)

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang
    }
  }, [lang])

  function setLang(next: Lang) {
    setLangState(next)
  }

  function toggleLang() {
    setLangState((prev) => (prev === "th" ? "en" : "th"))
  }

  return (
    <AppContext.Provider
      value={{
        lang,
        setLang,
        toggleLang,
        selectedProvinceCode,
        setSelectedProvinceCode,
        activeDebtStatus,
        setActiveDebtStatus,
        activeBorrowerType,
        setActiveBorrowerType,
        provinceDetail,
        setProvinceDetail,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useAppState() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useAppState must be used inside AppStateProvider")
  return ctx
}

export function formatThaiMonth(isoDate: string | null | undefined, lang: Lang): string {
  if (!isoDate) return ""
  const parts = isoDate.split("-")
  if (parts.length < 2) return isoDate
  const year = Number(parts[0])
  const monthIdx = Number(parts[1]) - 1
  if (Number.isNaN(year) || monthIdx < 0 || monthIdx > 11) return isoDate

  const thMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
  const enMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  if (lang === "th") {
    return `${thMonths[monthIdx]} ${year + 543}`
  }
  return `${enMonths[monthIdx]} ${year}`
}

export function shortCalendarMonth(calMonth: number, lang: Lang): string {
  const th = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
  const en = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const idx = Math.max(0, Math.min(11, calMonth - 1))
  return lang === "th" ? th[idx] : en[idx]
}

export function fullCalendarMonth(calMonth: number, lang: Lang): string {
  const th = [
    "มกราคม",
    "กุมภาพันธ์",
    "มีนาคม",
    "เมษายน",
    "พฤษภาคม",
    "มิถุนายน",
    "กรกฎาคม",
    "สิงหาคม",
    "กันยายน",
    "ตุลาคม",
    "พฤศจิกายน",
    "ธันวาคม",
  ]
  const en = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ]
  const idx = Math.max(0, Math.min(11, calMonth - 1))
  return lang === "th" ? th[idx] : en[idx]
}

export function joinNaturalList(items: string[], lang: Lang): string {
  const clean = items.filter(Boolean)
  if (clean.length === 0) return ""
  if (clean.length === 1) return clean[0]
  if (clean.length === 2) {
    return lang === "th" ? `${clean[0]}และ${clean[1]}` : `${clean[0]} and ${clean[1]}`
  }
  const head = clean.slice(0, -1).join(lang === "th" ? " " : ", ")
  const last = clean[clean.length - 1]
  return lang === "th" ? `${head} และ${last}` : `${head}, and ${last}`
}

export function translateClusterLabel(label: string, lang: Lang): string {
  if (lang === "en") return label
  const map: Record<string, string> = {
    "International Tourism Hub": "ศูนย์กลางท่องเที่ยวหลักภาคเหนือ (ตลาดต่างชาติ)",
    "High Debt Chronic Haze Belt": "กลุ่มจังหวัดภาคเหนือที่มีภาระหนี้สูงและเผชิญฝุ่นควันเรื้อรัง",
    "Secondary Domestic Tourism Corridor": "เส้นทางท่องเที่ยวรองภาคเหนือ (ตลาดในประเทศ)",
    "Elevated Debt Domestic Basin": "กลุ่มจังหวัดลุ่มน้ำภาคเหนือที่มีหนี้ค่อนข้างสูงและพึ่งพาตลาดในประเทศ",
  }
  // Return the actual label when a custom cluster name (e.g. k=3 or k=5) is not in the static map
  return map[label] ?? label
}

export function translateQuarantineReason(reason: string, lang: Lang): string {
  const normalized = reason.trim()
  const lower = normalized.toLowerCase()

  // Structured code matching first, followed by legacy substring rules
  if (normalized === "OUT_OF_SCOPE_NON_NORTHERN" || lower.includes("out of scope non northern")) {
    return lang === "th"
      ? "ข่าวนอกพื้นที่ภาคเหนือหรือนอกขอบเขตภาคบริการ"
      : "News outside Northern Thailand or service-sector scope"
  }
  if (normalized === "SCHEMA_VALIDATION_ERROR" || lower.includes("validationerror") || lower.includes("pydantic")) {
    return lang === "th"
      ? "โครงสร้างข้อมูลข่าวไม่สมบูรณ์หรือไม่มีข้อความอ้างอิงตรงต้นฉบับ"
      : "Incomplete news record or missing verbatim source quote"
  }
  if (normalized === "OUTSIDE_ANALYSIS_WINDOW" || lower.includes("outside 36 month")) {
    return lang === "th"
      ? "ข่าวเก่าเกินกรอบเวลาวิเคราะห์ 3 ปีล่าสุด"
      : "News event older than the 36-month analysis window"
  }
  if (normalized === "PROVINCE_OUTSIDE_NORTH" || lower.includes("province outside northern")) {
    return lang === "th"
      ? "สถานีตรวจวัดหรือข้อมูลอยู่นอกเขตจังหวัดภาคเหนือ"
      : "Station or record located outside Northern Thailand"
  }
  return reason
}

export function formatGroupTag(clusterId: number | null | undefined, lang: Lang): string {
  if (clusterId == null) return ""
  return lang === "th" ? `กลุ่มจังหวัดที่ ${clusterId}` : `Group ${clusterId}`
}

export function translateFeatureName(feature: string, lang: Lang): string {
  const th: Record<string, string> = {
    avg_occupancy_rate: "อัตราเข้าพักเฉลี่ย (%)",
    occupancy_volatility: "ความผันผวนของอัตราเข้าพักตามฤดูกาล",
    avg_monthly_revenue_mthb: "รายได้ท่องเที่ยวเฉลี่ยต่อเดือน (ล้านบาท)",
    debt_to_annual_income_all: "สัดส่วนหนี้ต่อรายได้ต่อปีของครัวเรือน (เท่า)",
    debt_to_annual_income_sme: "สัดส่วนหนี้ต่อรายได้ต่อปีของผู้ประกอบการ (เท่า)",
    expense_to_income_pct_all: "สัดส่วนรายจ่ายต่อรายได้ครัวเรือน (%)",
    expense_to_income_pct_sme: "สัดส่วนรายจ่ายต่อรายได้ผู้ประกอบการ (%)",
    annual_pm25_days_over_37_5: "จำนวนวันที่ค่าฝุ่น PM2.5 เกิน 37.5 µg/m³ ต่อปี (วัน)",
    max_monthly_rainfall_mm: "ปริมาณฝนสูงสุดรายเดือน (มม.)",
    recent_news_shock_score: "คะแนนแรงกระแทกจากข่าวเหตุการณ์ล่าสุด",
    oil_brent_yoy_pct: "ราคาน้ำมันดิบ Brent เปลี่ยนแปลงเทียบปีก่อน (%)",
    oil_dubai_yoy_pct: "ราคาน้ำมันดิบดูไบเปลี่ยนแปลงเทียบปีก่อน (%)",
    pm25_days_over_37_5: "จำนวนวันที่ค่าฝุ่น PM2.5 เกิน 37.5 µg/m³ ในเดือน (วัน)",
    pm25_days_over_75_0: "จำนวนวันที่ค่าฝุ่น PM2.5 เกิน 75 µg/m³ ระดับสีแดง (วัน)",
    pm25_excess: "ค่าฝุ่น PM2.5 สูงกว่าค่าเฉลี่ยตามฤดูกาล (µg/m³)",
    pm25_z_prov: "ค่าเบี่ยงเบนฝุ่น PM2.5 เทียบค่าปกติของจังหวัด (Z-score)",
    rainfall_excess_mm: "ปริมาณฝนส่วนเกินกว่าค่าเฉลี่ยฤดูกาล (มม.)",
    rainfall_max_day_mm: "ปริมาณฝนสะสมสูงสุดใน 1 วัน (มม.)",
    heavy_rain_days: "จำนวนวันฝนตกหนักในเดือน (วัน)",
    th_cpi_yoy_pct: "อัตราเงินเฟ้อทั่วไปของไทยเทียบปีก่อน (%)",
    usdthb_yoy_pct: "อัตราแลกเปลี่ยนเงินบาทต่อดอลลาร์เทียบปีก่อน (%)",
    th_reer_yoy_pct: "ดัชนีค่าเงินบาทที่แท้จริงเทียบคู่ค้าและคู่แข่ง เทียบปีก่อน (%)",
    thai_rice_usd_yoy_pct: "ราคาข้าวส่งออกไทยเทียบปีก่อน (%)",
  }
  const en: Record<string, string> = {
    avg_occupancy_rate: "Average Occupancy (%)",
    occupancy_volatility: "Seasonal Occupancy Volatility",
    avg_monthly_revenue_mthb: "Average Monthly Tourism Revenue (M THB)",
    debt_to_annual_income_all: "Household Debt to Annual Income (x)",
    debt_to_annual_income_sme: "SME Debt to Annual Income (x)",
    expense_to_income_pct_all: "Household Expense Ratio (%)",
    expense_to_income_pct_sme: "SME Expense Ratio (%)",
    annual_pm25_days_over_37_5: "Annual Elevated PM2.5 Days (>37.5 µg/m³)",
    max_monthly_rainfall_mm: "Peak Monthly Rainfall (mm)",
    recent_news_shock_score: "Recent Verified News Shock Score",
    oil_brent_yoy_pct: "Brent Crude Oil YoY Change (%)",
    oil_dubai_yoy_pct: "Dubai Crude Oil YoY Change (%)",
    pm25_days_over_37_5: "Monthly Elevated PM2.5 Days (>37.5 µg/m³)",
    pm25_days_over_75_0: "Monthly Critical PM2.5 Days (>75 µg/m³)",
    pm25_excess: "PM2.5 Above Seasonal Norm (µg/m³)",
    pm25_z_prov: "Provincial PM2.5 Anomaly (Z-score)",
    rainfall_excess_mm: "Excess Rainfall Above Seasonal Norm (mm)",
    rainfall_max_day_mm: "Peak Single-Day Rainfall (mm)",
    heavy_rain_days: "Monthly Heavy Rain Days",
    th_cpi_yoy_pct: "Thailand Headline CPI Inflation (% YoY)",
    usdthb_yoy_pct: "USD/THB Exchange Rate (% YoY)",
    th_reer_yoy_pct: "Real Effective Exchange Rate (% YoY)",
    thai_rice_usd_yoy_pct: "Thai Export Rice Price (% YoY)",
  }
  return (lang === "th" ? th[feature] : en[feature]) || feature
}

export function translateTargetName(target: string, lang: Lang): string {
  const th: Record<string, string> = {
    occupancy_yoy_diff: "อัตราเข้าพักเทียบปีก่อน",
    occupancy_deseason: "อัตราเข้าพักปรับผลฤดูกาล",
    revenue_deseason_pct: "รายได้ท่องเที่ยวปรับผลฤดูกาล",
    clustering_17_provinces: "โครงสร้างจัดกลุ่มจังหวัดภาคเหนือ",
  }
  const en: Record<string, string> = {
    occupancy_yoy_diff: "Occupancy YoY Change",
    occupancy_deseason: "Deseasonalized Occupancy",
    revenue_deseason_pct: "Deseasonalized Revenue",
    clustering_17_provinces: "Northern Provincial Structural Profile",
  }
  return (lang === "th" ? th[target] : en[target]) || target
}

export function translateClusterGuidance(
  clusterKey: string | number | null,
  lang: Lang,
  apiRecommendedPolicy?: string | null,
): string {
  if (clusterKey == null || clusterKey === "") {
    return apiRecommendedPolicy?.trim() || ""
  }

  const byLabelTh: Record<string, string> = {
    "International Tourism Hub":
      "เน้นสำรองสภาพคล่องรับช่วงนอกฤดูท่องเที่ยวและเตรียมพักชำระเงินต้นระยะสั้นหากเกิดเหตุฉุกเฉินด้านฝุ่นหรือน้ำท่วม",
    "High Debt Chronic Haze Belt":
      "เน้นปรับโครงสร้างหนี้เชิงรุก ลดภาระดอกเบี้ย และเชื่อมโยงคลินิกแก้หนี้สำหรับผู้ประกอบการและครัวเรือนที่มีเงินเหลือหลังหักรายจ่ายน้อย",
    "Secondary Domestic Tourism Corridor":
      "เน้นสินเชื่อหมุนเวียนรับฤดูกาลท่องเที่ยวในประเทศและวงเงินฟื้นฟูหลังน้ำป่าไหลหลากในพื้นที่ลุ่มน้ำ",
    "Elevated Debt Domestic Basin":
      "เน้นรวมหนี้และวางแผนภาระค่างวดเชิงป้องกันเพื่อรักษาสภาพคล่องท่ามกลางต้นทุนค่าครองชีพและฝุ่นละอองเรื้อรัง",
  }

  const byLabelEn: Record<string, string> = {
    "International Tourism Hub":
      "Focus on seasonal working capital buffers and temporary principal deferral during acute haze or flood disruptions.",
    "High Debt Chronic Haze Belt":
      "Prioritize proactive debt restructuring, interest reduction, and Debt Clinic referral for high-debt SMEs and households.",
    "Secondary Domestic Tourism Corridor":
      "Support domestic seasonal working capital lines and targeted flash flood recovery credit across secondary corridors.",
    "Elevated Debt Domestic Basin":
      "Encourage preventive debt consolidation and cash margin planning against rising living costs and chronic haze.",
  }

  if (typeof clusterKey === "string") {
    const matched = lang === "th" ? byLabelTh[clusterKey] : byLabelEn[clusterKey]
    if (matched) return matched
    if (apiRecommendedPolicy?.trim()) return apiRecommendedPolicy.trim()
    return lang === "th"
      ? "แนวทางทั่วไป: วางแผนสภาพคล่องและปรับโครงสร้างภาระค่างวดให้สอดคล้องกับรายได้ตามฤดูกาลของจังหวัด"
      : "General guidance: Align debt installments and cash margins with the province's seasonal revenue cycle."
  }

  const legacyOrder = [
    "International Tourism Hub",
    "High Debt Chronic Haze Belt",
    "Secondary Domestic Tourism Corridor",
    "Elevated Debt Domestic Basin",
  ]
  const mappedLabel = legacyOrder[clusterKey - 1]
  return mappedLabel
    ? translateClusterGuidance(mappedLabel, lang, apiRecommendedPolicy)
    : apiRecommendedPolicy?.trim() || ""
}

export function translateShockType(shockType: string, lang: Lang): string {
  const th: Record<string, string> = {
    pm25: "ฝุ่นละออง PM2.5",
    flood: "อุทกภัย",
    water_pollution: "มลพิษ/สารพิษทางน้ำ",
    demand_drop: "อุปสงค์ชะลอตัว",
    cost_surge: "ต้นทุนพุ่งสูงฉับพลัน",
    cost_inflation: "แรงกดดันต้นทุนและเงินเฟ้อ",
    policy_relief: "มาตรการช่วยเหลือ",
  }
  const en: Record<string, string> = {
    pm25: "PM2.5 Haze",
    flood: "Flooding",
    water_pollution: "Water Pollution",
    demand_drop: "Demand Softening",
    cost_surge: "Cost Surge",
    cost_inflation: "Cost Pressure",
    policy_relief: "Policy Relief",
  }
  return (lang === "th" ? th[shockType] : en[shockType]) || shockType
}

export function translateSubregion(subregion: string, lang: Lang): string {
  if (lang === "en") return subregion
  if (subregion.toLowerCase().includes("upper")) return "ภาคเหนือตอนบน"
  if (subregion.toLowerCase().includes("lower")) return "ภาคเหนือตอนล่าง"
  return subregion
}

export function translateDsrBand(band: string, lang: Lang): string {
  const th: Record<string, string> = {
    stable: "สภาพคล่องปกติ (ต่ำกว่า 40%)",
    watch: "เฝ้าระวัง (40% ถึงต่ำกว่า 60%)",
    tight: "ตึงตัวสูง (60% ถึงต่ำกว่า 80%)",
    critical: "เปราะบางวิกฤต (80% ขึ้นไป)",
    not_assessable: "ยังคำนวณสัดส่วนไม่ได้",
  }
  const en: Record<string, string> = {
    stable: "Stable Liquidity (Under 40%)",
    watch: "Moderate Watch (40% to under 60%)",
    tight: "Tight Liquidity (60% to under 80%)",
    critical: "Critical Stress (80% and above)",
    not_assessable: "Ratio not assessable",
  }
  return (lang === "th" ? th[band] : en[band]) || band
}
