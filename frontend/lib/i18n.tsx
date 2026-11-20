"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { Lang } from "@/lib/api"

type AppContextValue = {
  lang: Lang
  setLang: (lang: Lang) => void
  toggleLang: () => void
  selectedProvinceCode: string
  setSelectedProvinceCode: (code: string) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  // Default language is Thai per product preference with seamless switch to English
  const [lang, setLangState] = useState<Lang>("th")
  const [selectedProvinceCode, setSelectedProvinceCode] = useState<string>("CM")

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

export function translateClusterLabel(label: string, lang: Lang): string {
  if (lang === "en") return label
  const map: Record<string, string> = {
    "International Tourism Hub": "เศรษฐกิจพึ่งพาท่องเที่ยว ช่วงโลว์ซีซันรายได้อาจสะดุด",
    "High Debt Chronic Haze Belt": "ภาระหนี้ธุรกิจสูงและเผชิญฝุ่นสะสม",
    "Secondary Domestic Tourism Corridor": "เมืองท่องเที่ยวรอง ฐานะการเงินปานกลาง",
    "Elevated Debt Domestic Basin": "ลุ่มน้ำภาคเหนือตอนล่าง กระแสเงินสดตึงตัว",
  }
  return map[label] || label
}

export function translateQuarantineReason(reason: string, lang: Lang): string {
  if (lang === "en") return reason
  if (reason.includes("Out of scope non Northern")) {
    return "ข่าวอยู่นอกพื้นที่ 17 จังหวัดภาคเหนือหรือนอกภาคบริการ"
  }
  if (reason.includes("ValidationError") || reason.includes("Pydantic")) {
    return "ข้อมูลข่าวไม่ครบโครงสร้างมาตรฐานหรือไม่มีข้อความอ้างอิงตรงต้นฉบับ"
  }
  if (reason.includes("Outside 36 month")) {
    return "ข่าวเก่าเกินกรอบเวลาวิเคราะห์ 36 เดือนล่าสุด"
  }
  if (reason.includes("Province outside Northern 17")) {
    return "สถานีหรือข้อมูลอยู่นอกเขต 17 จังหวัดภาคเหนือ"
  }
  return reason
}

export function formatGroupTag(clusterId: number | null, lang: Lang): string {
  if (!clusterId) return ""
  return lang === "th" ? `กลุ่มที่ ${clusterId}` : `Group ${clusterId}`
}

export function translateFeatureName(feature: string, lang: Lang): string {
  const th: Record<string, string> = {
    avg_occupancy_rate: "อัตราการเข้าพักเฉลี่ย (%)",
    occupancy_volatility: "ความผันผวนของอัตราเข้าพักตามฤดูกาล",
    avg_monthly_revenue_mthb: "รายได้ท่องเที่ยวเฉลี่ยต่อเดือน (ล้านบาท)",
    debt_to_annual_income_all: "สัดส่วนหนี้ต่อรายได้ต่อปีของครัวเรือน (เท่า)",
    debt_to_annual_income_sme: "สัดส่วนหนี้ต่อรายได้ต่อปีของผู้ประกอบการ (เท่า)",
    expense_to_income_pct_all: "สัดส่วนรายจ่ายต่อรายได้ครัวเรือน (%)",
    expense_to_income_pct_sme: "สัดส่วนรายจ่ายต่อรายได้ผู้ประกอบการ (%)",
    annual_pm25_days_over_37_5: "จำนวนวันที่ฝุ่นเกินเกณฑ์มาตรฐานต่อปี (วัน)",
    max_monthly_rainfall_mm: "ปริมาณฝนสูงสุดรายเดือน (มม.)",
    oil_brent_yoy_pct: "ราคาน้ำมันดิบโลกเปลี่ยนแปลงเทียบปีก่อน (%)",
    oil_dubai_yoy_pct: "ราคาน้ำมันดิบดูไบเปลี่ยนแปลงเทียบปีก่อน (%)",
    pm25_days_over_37_5: "จำนวนวันที่ฝุ่นเกินมาตรฐานในเดือน (วัน)",
    pm25_days_over_75_0: "จำนวนวันที่ฝุ่นอยู่ในระดับวิกฤตสีแดง (วัน)",
    pm25_excess: "ค่าฝุ่นละอองสูงกว่าค่าเฉลี่ยตามฤดูกาล",
    pm25_z_prov: "ค่าเบี่ยงเบนฝุ่นละอองเทียบค่าปกติของจังหวัด",
    rainfall_excess_mm: "ปริมาณฝนส่วนเกินกว่าค่าเฉลี่ยฤดูกาล (มม.)",
    rainfall_max_day_mm: "ปริมาณฝนสะสมสูงสุดใน 1 วัน (มม.)",
    heavy_rain_days: "จำนวนวันฝนตกหนักในเดือน (วัน)",
    th_cpi_yoy_pct: "อัตราเงินเฟ้อทั่วไปของไทยเทียบปีก่อน (%)",
    usdthb_yoy_pct: "อัตราแลกเปลี่ยนเงินบาทต่อดอลลาร์เทียบปีก่อน (%)",
    th_reer_yoy_pct: "ดัชนีค่าเงินบาทที่แท้จริงเทียบปีก่อน (%)",
    thai_rice_usd_yoy_pct: "ราคาข้าวส่งออกไทยเทียบปีก่อน (%)",
  }
  const en: Record<string, string> = {
    avg_occupancy_rate: "Average Hotel Occupancy (%)",
    occupancy_volatility: "Seasonal Occupancy Volatility",
    avg_monthly_revenue_mthb: "Average Monthly Tourism Revenue (M THB)",
    debt_to_annual_income_all: "Household Debt to Annual Income (x)",
    debt_to_annual_income_sme: "SME Debt to Annual Income (x)",
    expense_to_income_pct_all: "Household Expense Ratio (%)",
    expense_to_income_pct_sme: "SME Expense Ratio (%)",
    annual_pm25_days_over_37_5: "Annual Elevated PM2.5 Days (>37.5)",
    max_monthly_rainfall_mm: "Peak Monthly Rainfall (mm)",
    oil_brent_yoy_pct: "Brent Crude Oil YoY Change (%)",
    oil_dubai_yoy_pct: "Dubai Crude Oil YoY Change (%)",
    pm25_days_over_37_5: "Monthly Elevated PM2.5 Days",
    pm25_days_over_75_0: "Monthly Critical PM2.5 Days (>75)",
    pm25_excess: "PM2.5 Above Seasonal Norm (µg/m³)",
    pm25_z_prov: "Provincial PM2.5 Anomaly (Z-score)",
    rainfall_excess_mm: "Excess Rainfall Above Seasonal Norm (mm)",
    rainfall_max_day_mm: "Peak Single Day Rainfall (mm)",
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
    occupancy_yoy_diff: "อัตราเข้าพักเทียบกับปีก่อน",
    occupancy_deseason: "อัตราเข้าพักปรับผลฤดูกาล",
    revenue_deseason_pct: "รายได้ท่องเที่ยวปรับผลฤดูกาล",
    clustering_17_provinces: "โครงสร้างจัดกลุ่ม 17 จังหวัด",
  }
  const en: Record<string, string> = {
    occupancy_yoy_diff: "Occupancy YoY Change",
    occupancy_deseason: "Deseasonalized Occupancy",
    revenue_deseason_pct: "Deseasonalized Revenue",
    clustering_17_provinces: "17 Province Structural Profile",
  }
  return (lang === "th" ? th[target] : en[target]) || target
}

export function translateClusterGuidance(clusterId: number | null, lang: Lang): string {
  const th: Record<number, string> = {
    1: "เน้นสำรองสภาพคล่องรับช่วงผู้เข้าพักน้อยและเตรียมพักชำระเงินต้นระยะสั้นหากเกิดเหตุฉุกเฉินด้านฝุ่นหรือน้ำท่วม",
    2: "เน้นปรับโครงสร้างหนี้เชิงรุก ลดภาระดอกเบี้ย และเชื่อมโยงคลินิกแก้หนี้สำหรับผู้ประกอบการและครัวเรือนที่มีเงินเหลือหลังหักรายจ่ายน้อย",
    3: "เน้นสินเชื่อหมุนเวียนรับฤดูกาลท่องเที่ยวในประเทศและวงเงินฟื้นฟูหลังน้ำป่าไหลหลากในพื้นที่ลุ่มน้ำ",
    4: "เน้นรวมหนี้และวางแผนภาระค่างวดเชิงป้องกันเพื่อรักษาสภาพคล่องท่ามกลางต้นทุนค่าครองชีพและฝุ่นละอองเรื้อรัง",
  }
  const en: Record<number, string> = {
    1: "Focus on seasonal working capital buffers and temporary principal deferral during acute haze or flood disruptions.",
    2: "Prioritize proactive debt restructuring, interest reduction, and Debt Clinic referral for high debt SMEs and households.",
    3: "Support domestic seasonal working capital lines and targeted flash flood recovery credit across secondary corridors.",
    4: "Encourage preventive debt consolidation and cash buffer planning against rising living costs and chronic orange haze.",
  }
  if (!clusterId) return ""
  return (lang === "th" ? th[clusterId] : en[clusterId]) || ""
}

export function translateShockType(shockType: string, lang: Lang): string {
  const th: Record<string, string> = {
    pm25: "ฝุ่นละออง",
    flood: "อุทกภัย",
    water_pollution: "มลพิษ/สารพิษทางน้ำ",
    demand_drop: "อุปสงค์ชะลอตัว",
    cost_surge: "ต้นทุนและเงินเฟ้อ",
    cost_inflation: "ต้นทุนและเงินเฟ้อ",
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
    watch: "เฝ้าระวัง (40 ถึง 60%)",
    tight: "ตึงตัวสูง (60 ถึง 80%)",
    critical: "เปราะบางวิกฤต (80% ขึ้นไป)",
  }
  const en: Record<string, string> = {
    stable: "Stable Liquidity (Under 40%)",
    watch: "Moderate Watch (40 to 60%)",
    tight: "Tight Liquidity (60 to 80%)",
    critical: "Critical Stress (80% and above)",
  }
  return (lang === "th" ? th[band] : en[band]) || band
}
