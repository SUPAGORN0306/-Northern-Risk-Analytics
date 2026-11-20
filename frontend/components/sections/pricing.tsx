"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { motion, useInView } from "motion/react"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BookOpenCheck,
  Calculator,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Loader2,
  PhoneCall,
  Printer,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react"
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  fetchPolicyPage,
  submitReliefCheck,
  type CitationItem,
  type PolicyPageResponse,
  type ProvinceOutlookItem,
  type ReliefCheckResponse,
} from "@/lib/api"
import {
  buildFinancialDossierHtml,
  buildLoanComparison,
  computeFinancialDiagnostic,
  type DebtStatusKey,
} from "@/lib/financial-dossier"
import { translateDsrBand, useAppState } from "@/lib/i18n"

const FALLBACK_PROVINCES = [
  { code: "CM", name_th: "เชียงใหม่", name_en: "Chiang Mai" },
  { code: "CR", name_th: "เชียงราย", name_en: "Chiang Rai" },
  { code: "MH", name_th: "แม่ฮ่องสอน", name_en: "Mae Hong Son" },
  { code: "NN", name_th: "น่าน", name_en: "Nan" },
  { code: "LP", name_th: "ลำปาง", name_en: "Lampang" },
  { code: "LN", name_th: "ลำพูน", name_en: "Lamphun" },
  { code: "PY", name_th: "พะเยา", name_en: "Phayao" },
  { code: "PR", name_th: "แพร่", name_en: "Phrae" },
  { code: "UT", name_th: "อุตรดิตถ์", name_en: "Uttaradit" },
  { code: "TK", name_th: "ตาก", name_en: "Tak" },
  { code: "ST", name_th: "สุโขทัย", name_en: "Sukhothai" },
  { code: "PL", name_th: "พิษณุโลก", name_en: "Phitsanulok" },
  { code: "PC", name_th: "พิจิตร", name_en: "Phichit" },
  { code: "PB", name_th: "เพชรบูรณ์", name_en: "Phetchabun" },
  { code: "KP", name_th: "กำแพงเพชร", name_en: "Kamphaeng Phet" },
  { code: "NS", name_th: "นครสวรรค์", name_en: "Nakhon Sawan" },
  { code: "UN", name_th: "อุทัยธานี", name_en: "Uthai Thani" },
]

const BUSINESS_OPTIONS = [
  { id: "hotel", th: "โรงแรม / ที่พัก", en: "Hotel & Lodging" },
  { id: "restaurant", th: "ร้านอาหาร / ร้านกาแฟ", en: "Restaurant & Cafe" },
  { id: "tour", th: "นำเที่ยว / กิจการบริการ", en: "Tour & Service SME" },
  { id: "household", th: "ครัวเรือน / บุคคลทั่วไป", en: "Household / Individual" },
]

const DEBT_STATUS_OPTIONS: {
  id: DebtStatusKey
  th: string
  en: string
  sub_th: string
  sub_en: string
}[] = [
  {
    id: "current",
    th: "ยังผ่อนตรงเวลา (แต่การเงินเริ่มตึงมือ)",
    en: "Paying on time (Cashflow tightening)",
    sub_th: "ต้องการลดภาระค่างวดล่วงหน้าก่อนเสียประวัติ",
    sub_en: "Seek lower monthly payments before delinquency",
  },
  {
    id: "disaster",
    th: "รายได้ลดลงจากภัยพิบัติ / มลพิษน้ำ / ฝุ่น",
    en: "Disrupted by flood, water pollution, or haze",
    sub_th: "งานหด ลูกค้าหาย หรือพื้นที่ได้รับผลกระทบ",
    sub_en: "Direct local environmental or disaster impact",
  },
  {
    id: "overdue_31_120",
    th: "เริ่มค้างชำระ 1 ถึง 4 เดือน",
    en: "Overdue 1 to 4 months (31 to 120 days)",
    sub_th: "สินเชื่อบ้าน รถ หรือสินเชื่อธุรกิจที่เริ่มค้างจ่าย",
    sub_en: "Home, auto, or SME loans behind schedule",
  },
  {
    id: "persistent",
    th: "จ่ายได้แค่ขั้นต่ำวนไปเรื่อยๆ",
    en: "Paying minimum only on revolving debt",
    sub_th: "บัตรกดเงินสดหรือสินเชื่อหมุนเวียนที่หักเงินต้นได้น้อย",
    sub_en: "Revolving personal credit where principal barely drops",
  },
  {
    id: "overdue_120_plus",
    th: "ค้างชำระเกิน 4 เดือนขึ้นไป (บัตร/สินเชื่อบุคคล)",
    en: "Overdue more than 4 months (Unsecured)",
    sub_th: "เฉพาะบัตรเครดิตและสินเชื่อส่วนบุคคลที่ไม่มีหลักประกัน",
    sub_en: "Unsecured credit cards and personal loans in NPL status",
  },
]

const OFFICIAL_SOURCES = [
  { label_th: "คลินิกแก้หนี้ (สมัครออนไลน์ / โทร 1443)", label_en: "Debt Clinic by SAM (Apply Online / 1443)", href: "https://www.debtclinicbysam.com/" },
  { label_th: "เอกสารโครงการคุณสู้ เราช่วย (ฉบับทางการ)", label_en: "Khun Soo Rao Chuay Official PDF", href: "https://www.bot.or.th/content/dam/bot/documents/th/research-and-publications-pdf/articles-and-publications/articles/download/2024/article-2024dec24.pdf" },
  { label_th: "ประกาศหลักเกณฑ์การให้สินเชื่ออย่างรับผิดชอบ 2568", label_en: "Responsible Lending 2568 PDF", href: "https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/ThaiPDF/25680030.pdf" },
  { label_th: "คู่มือรู้ก่อน รอดก่อน แนวทางแก้หนี้ 2569", label_en: "Official Debt Relief Guide 2569 PDF", href: "https://www.bot.or.th/content/dam/bot/documents/th/thai-economy/regional-economy/northeastern/File-download/press-training-at-sakonnakorn/Debt%20Relief%20Measures.pdf" },
  { label_th: "หนังสือเวียนมาตรการลูกหนี้ผู้ประสบภัยพิบัติ 2568", label_en: "2568 Disaster Relief Circular PDF", href: "https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/ThaiPDF/25680065.pdf" },
  { label_th: "รายงานภาวะเศรษฐกิจและการเงินภาคเหนือ (ธปท.)", label_en: "Northern Regional Economy Portal", href: "https://www.bot.or.th/th/thai-economy/regional-economy/northern-economy.html" },
]

type ProgramMatch = {
  id: string
  badge_th: string
  badge_en: string
  title_th: string
  title_en: string
  benefit_th: string
  benefit_en: string
  criteria_th: string
  criteria_en: string
  action_label_th: string
  action_label_en: string
  action_href: string
  source_th: string
  source_en: string
}

function matchOfficialPrograms(params: {
  status: DebtStatusKey
  isSme: boolean
  dscr: number | null
  dsrPct: number
  hasWaterOrDisaster: boolean
}): ProgramMatch[] {
  const { status, isSme, dscr, dsrPct, hasWaterOrDisaster } = params
  const list: ProgramMatch[] = []

  if (status === "overdue_120_plus") {
    list.push({
      id: "debt_clinic",
      badge_th: "ส่งต่อหน่วยงานกลางโดยตรง",
      badge_en: "Official External Referral",
      title_th: "คลินิกแก้หนี้ (บริษัท บริหารสินทรัพย์สุขุมวิท จำกัด · โทร 1443)",
      title_en: "Debt Clinic by SAM (Official NPL Referral)",
      benefit_th: "ช่องทางกลางสำหรับรวมหนี้บัตรเครดิตและสินเชื่อส่วนบุคคลที่ไม่มีหลักประกัน ดอกเบี้ยผ่อนปรน 3 ถึง 5% ต่อปี",
      benefit_en: "Centralized program consolidating unsecured credit cards and personal loans at 3 to 5% p.a. Apply directly via SAM.",
      criteria_th: "บุคคลธรรมดา ค้างชำระเกิน 120 วัน เงินต้นรวมไม่เกิน 2 ล้านบาท และอายุรวมระยะเวลาผ่อนไม่เกิน 70 ปี",
      criteria_en: "Individuals overdue >120 days, combined principal <= 2M THB, and age + term <= 70 years.",
      action_label_th: "ไปที่เว็บไซต์คลินิกแก้หนี้ (โทร 1443)",
      action_label_en: "Go to Debt Clinic by SAM (1443)",
      action_href: "https://www.debtclinicbysam.com/",
      source_th: "เอกสารรู้ก่อน รอดก่อน 2569 หน้า 14",
      source_en: "Official Debt Relief Guide 2569, p.14",
    })
  } else if (status === "persistent") {
    list.push({
      id: "persistent_debt",
      badge_th: "สิทธิปิดจบหนี้หมุนเวียน",
      badge_en: "Revolving Debt Exit",
      title_th: "มาตรการแก้หนี้เรื้อรัง (ผ่อนปิดจบใน 5 ปี ดอกเบี้ยไม่เกิน 15%)",
      title_en: "Persistent Debt 5 Year Exit (Max 15%)",
      benefit_th: "เปลี่ยนสินเชื่อหมุนเวียนที่จ่ายขั้นต่ำและดอกเบี้ยสูงให้เป็นสินเชื่อผ่อนรายงวด ปิดจบภายใน 5 ปี ดอกเบี้ยไม่เกิน 15% ต่อปี",
      benefit_en: "Converts revolving personal loans into fixed 5 year installments capped at 15% annual interest.",
      criteria_th: "ลูกหนี้สินเชื่อหมุนเวียนที่จ่ายดอกเบี้ยสะสมมากกว่าเงินต้นต่อเนื่องตามหลักเกณฑ์ปี 2568",
      criteria_en: "Revolving borrowers whose cumulative interest paid exceeds principal under 2568 rules.",
      action_label_th: "เปิดอ่านประกาศหลักเกณฑ์ฉบับเต็ม",
      action_label_en: "Open Official Guideline (PDF)",
      action_href: "https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/ThaiPDF/25680030.pdf",
      source_th: "ประกาศหลักเกณฑ์การให้สินเชื่ออย่างรับผิดชอบ 2568",
      source_en: "Responsible Lending Guideline 2568",
    })
  } else if (status === "overdue_31_120") {
    list.push({
      id: "khunsoo",
      badge_th: "รักษาทรัพย์และกิจการ",
      badge_en: "Asset & SME Retention",
      title_th: "โครงการคุณสู้ เราช่วย (จ่ายตรง คงทรัพย์)",
      title_en: "Khun Soo Rao Chuay",
      benefit_th: "ลดค่างวด 3 ปี (ปีที่ 1 จ่าย 50%, ปีที่ 2 จ่าย 70%, ปีที่ 3 จ่าย 90%) พร้อมพักดอกเบี้ย 3 ปีโดยนำค่างวดไปหักเงินต้นทั้งหมด 100%",
      benefit_en: "Stepped 3 year payments (50%, 70%, 90%) with 3 year interest suspension applied 100% to principal.",
      criteria_th: "รองรับสินเชื่อบ้าน รถยนต์ และสินเชื่อธุรกิจ SME ที่ค้างชำระ 31 ถึง 365 วัน (กรณีบัตรเครดิต/สินเชื่อบุคคล ใช้เกณฑ์ปรับโครงสร้างหนี้เชิงป้องกันตามหลักเกณฑ์ของ ธปท.)",
      criteria_en: "Covers home, auto, and small SME loans overdue 31 to 365 days (unsecured cards/personal loans use Responsible Lending restructuring).",
      action_label_th: "เปิดอ่านเอกสารโครงการฉบับเต็ม",
      action_label_en: "Open Official Program PDF",
      action_href: "https://www.bot.or.th/content/dam/bot/documents/th/research-and-publications-pdf/articles-and-publications/articles/download/2024/article-2024dec24.pdf",
      source_th: "เอกสารโครงการคุณสู้ เราช่วย หน้า 1 ถึง 2",
      source_en: "Khun Soo Rao Chuay Publication, pp.1 to 2",
    })
  } else if (status === "disaster") {
    list.push({
      id: "disaster_2568",
      badge_th: "มาตรการพื้นที่ประสบภัย/มลพิษ",
      badge_en: "Regional Hazard Relief",
      title_th: "มาตรการช่วยเหลือลูกหนี้ผู้ประสบสาธารณภัย 2568",
      title_en: "2568 Disaster Borrower Relief",
      benefit_th: "ขอพักชำระเงินต้นชั่วคราว ลดค่างวด หรือขอวงเงินฟื้นฟูกิจการกับเจ้าหนี้เดิมโดยไม่เสียประวัติเครดิต",
      benefit_en: "Request temporary principal deferral, payment step down, or recovery credit without NPL downgrade.",
      criteria_th: "เตรียมหลักฐานแสดงผลกระทบหรือรายได้ที่ลดลง (เช่น บิลยอดขายย้อนหลัง รายการเดินบัญชี หรือภาพถ่ายพื้นที่ได้รับผลกระทบ) เพื่อประกอบการพิจารณาของธนาคาร",
      criteria_en: "Prepare evidence of income drop or impact (past sales receipts, bank statements, or site photos) for bank review.",
      action_label_th: "เปิดอ่านหนังสือเวียน ธปท.ว. 2302/2568",
      action_label_en: "Open Circular 2302/2568 (PDF)",
      action_href: "https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/ThaiPDF/25680065.pdf",
      source_th: "หนังสือเวียน ธปท.ว. 2302/2568 หน้า 1",
      source_en: "Official Circular 2302/2568, p.1",
    })
  } else if (isSme) {
    list.push({
      id: "sme_3reduce",
      badge_th: dscr != null && dscr < 1.25 ? "แนะนำสำหรับผู้ประกอบการตึงมือ" : "มาตรการหักเงินต้นผู้ประกอบการ",
      badge_en: dscr != null && dscr < 1.25 ? "Priority SME Relief" : "SME Principal Cut",
      title_th: "มาตรการ 3 ลด (ธนาคารพัฒนาวิสาหกิจขนาดกลางและขนาดย่อม · โทร 1357)",
      title_en: "SME D Bank 3 Reduce Program (Call 1357)",
      benefit_th: "ลดเงินต้น (นำค่างวดไปหักเงินต้นก่อนสูงสุด 100% นาน 2 ปี) ลดอัตราดอกเบี้ย และปรับลดค่างวดให้สอดคล้องกำไรจริง",
      benefit_en: "Applies up to 100% of payments directly to principal for 2 years plus interest and installment relief.",
      criteria_th: "ผู้ประกอบการที่ได้รับผลกระทบต้นทุนหรือรายได้ผันผวนตามฤดูกาล (ยื่นขอได้ทุกสาขาถึง ก.ย. 2570)",
      criteria_en: "SMEs facing cost pressure or seasonal revenue swings (active through Sep 2027).",
      action_label_th: "เปิดอ่านหลักเกณฑ์ปรับโครงสร้างหนี้",
      action_label_en: "Review Restructuring Rules (PDF)",
      action_href: "https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/ThaiPDF/25680030.pdf",
      source_th: "มาตรการ 3 ลด และหลักเกณฑ์การให้สินเชื่ออย่างรับผิดชอบ 2568",
      source_en: "SME D Bank 3 Reduce & Responsible Lending 2568",
    })
  }

  if (isSme && (status === "current" || status === "disaster") && (dscr == null || dscr >= 1.0)) {
    list.push({
      id: "credit_boost_tcg",
      badge_th: hasWaterOrDisaster ? "เสริมสภาพคล่องพื้นที่เสี่ยง" : "สินเชื่อหมุนเวียนและค้ำประกัน",
      badge_en: "SME Liquidity & Guarantee",
      title_th: "โครงการสนับสนุนสินเชื่อใหม่และค้ำประกันสินเชื่อ บสย. (โทร 02-890-9999)",
      title_en: "SMEs Credit Boost & TCG PGS 11 Guarantee",
      benefit_th: "กลไกช่วยค้ำประกันและแบ่งเบาความเสี่ยงสำหรับสินเชื่อหมุนเวียนธุรกิจท่องเที่ยวและบริการ พร้อมสิทธิฟรีค่าธรรมเนียมค้ำประกันช่วง 2 ถึง 3 ปีแรก",
      benefit_en: "Credit risk sharing for new working capital loans in tourism and services, plus TCG PGS 11 fee waivers.",
      criteria_th: "ผู้ประกอบการภาคบริการที่มีศักยภาพดำเนินธุรกิจต่อและต้องการวงเงินหมุนเวียนรับช่วงผู้เข้าพักน้อย",
      criteria_en: "Viable tourism and service SMEs seeking working capital via commercial banks and TCG.",
      action_label_th: "เปิดดูรายงานเศรษฐกิจภาคเหนือ (ธปท.)",
      action_label_en: "Open Northern Economy Portal",
      action_href: "https://www.bot.or.th/th/thai-economy/regional-economy/northern-economy.html",
      source_th: "มาตรการสินเชื่อฟื้นฟูและค้ำประกันสินเชื่อ บสย.",
      source_en: "SMEs Credit Boost & TCG PGS 11 Framework",
    })
  } else {
    list.push({
      id: "responsible_lending",
      badge_th: dsrPct >= 40 || (dscr != null && dscr < 1.25) ? "สิทธิเจรจาเจ้าหนี้เดิม" : "วางแผนเชิงป้องกัน",
      badge_en: dsrPct >= 40 ? "Direct Lender Right" : "Preventive Option",
      title_th: "สิทธิปรับโครงสร้างหนี้เชิงป้องกันก่อนเป็นหนี้เสีย (หลักเกณฑ์ปี 2568)",
      title_en: "Pre Emptive Restructuring (Responsible Lending 2568)",
      benefit_th: "เจ้าหนี้มีหน้าที่เสนอแนวทางปรับโครงสร้างหนี้ที่เหมาะกับรายได้จริงอย่างน้อย 1 ครั้งก่อนเป็นหนี้เสีย โดยไม่เรียกเก็บค่าธรรมเนียม",
      benefit_en: "Lenders must offer tailored restructuring at least once before NPL with zero restructuring fee.",
      criteria_th: "ลูกหนี้ทุกประเภทที่ยังไม่เป็นหนี้เสียแต่การเงินเริ่มตึงมือ หรือต้องการปรับตารางผ่อนให้สอดคล้องฤดูกาลท่องเที่ยว",
      criteria_en: "Performing borrowers facing tighter cashflow or seasonal tourism swings across all loan types.",
      action_label_th: "เปิดอ่านประกาศหลักเกณฑ์ปี 2568",
      action_label_en: "Open 2568 Guideline (PDF)",
      action_href: "https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/ThaiPDF/25680030.pdf",
      source_th: "ประกาศหลักเกณฑ์การให้สินเชื่ออย่างรับผิดชอบและเป็นธรรม 2568",
      source_en: "Responsible Lending Guideline 2568",
    })
  }

  return list.slice(0, 2)
}

type PresetKey = "individual_tight" | "sme_tight" | "khunsoo_sme" | "disaster_cr" | null

type ExtraLoanItem = {
  id: string
  category: "card" | "auto" | "home" | "sme"
  monthlyPayment: string
  principal: string
}

export function Pricing({ provinces }: { provinces: ProvinceOutlookItem[] }) {
  const ref = useRef(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const dossierDialogRef = useRef<HTMLDialogElement | null>(null)
  const docPageDialogRef = useRef<HTMLDialogElement | null>(null)
  const isInView = useInView(ref, { once: true, margin: "-60px" })
  const { lang, selectedProvinceCode, setSelectedProvinceCode } = useAppState()

  const [activePreset, setActivePreset] = useState<PresetKey>(null)
  const [activeDocPage, setActiveDocPage] = useState<{
    docTitle: string
    pageNum: number
    docUrl: string
    fullText: string
    totalPages?: number
    loading: boolean
  } | null>(null)
  const [userType, setUserType] = useState<"individual" | "business">("individual")
  const [business, setBusiness] = useState("household")
  const [debtStatus, setDebtStatus] = useState<DebtStatusKey>("current")
  const [revenue, setRevenue] = useState("")
  const [opex, setOpex] = useState("")
  const [debtPayment, setDebtPayment] = useState("")
  const [cashReserve, setCashReserve] = useState("")
  const [totalPrincipal, setTotalPrincipal] = useState("")
  const [horizonYears, setHorizonYears] = useState(5)
  const [extraLoans, setExtraLoans] = useState<ExtraLoanItem[]>([])
  const [deferMonths, setDeferMonths] = useState(6)
  const [stressDropPct, setStressDropPct] = useState(30)

  const [hasEvaluated, setHasEvaluated] = useState(false)
  const [csvImportNote, setCsvImportNote] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [result, setResult] = useState<ReliefCheckResponse | null>(null)
  const [showSources, setShowSources] = useState(false)

  const isSme = userType === "business" && business !== "household"

  const provinceList = useMemo(() => {
    if (provinces.length > 0) {
      return provinces.map((p) => ({
        code: p.province_code,
        name_th: p.name_th,
        name_en: p.name_en,
      }))
    }
    return FALLBACK_PROVINCES
  }, [provinces])

  const selectedProvData = useMemo(
    () => provinces.find((p) => p.province_code === selectedProvinceCode) ?? null,
    [provinces, selectedProvinceCode],
  )
  const selectedProvName = useMemo(() => {
    const found = provinceList.find((p) => p.code === selectedProvinceCode)
    return found ? (lang === "th" ? found.name_th : found.name_en) : selectedProvinceCode
  }, [provinceList, selectedProvinceCode, lang])

  const numRevenue = Math.max(0, Number(revenue) || 0)
  const numOpex = Math.max(0, Number(opex) || 0)
  const baseDebt = Math.max(0, Number(debtPayment) || 0)
  const extraDebtSum = extraLoans.reduce((acc, item) => acc + Math.max(0, Number(item.monthlyPayment) || 0), 0)
  const numDebt = baseDebt + extraDebtSum
  const numReserve = Math.max(0, Number(cashReserve) || 0)
  const basePrincipal = Math.max(0, Number(totalPrincipal) || 0)
  const extraPrincipalSum = extraLoans.reduce((acc, item) => acc + Math.max(0, Number(item.principal) || 0), 0)
  const numPrincipal = basePrincipal + extraPrincipalSum
  const hasAnyInput = Boolean(
    revenue.trim() ||
      opex.trim() ||
      debtPayment.trim() ||
      cashReserve.trim() ||
      totalPrincipal.trim() ||
      extraLoans.length > 0 ||
      activePreset,
  )

  useEffect(() => {
    if (!csvImportNote) return
    const timer = setTimeout(() => {
      setCsvImportNote(null)
    }, 4000)
    return () => clearTimeout(timer)
  }, [csvImportNote])

  useEffect(() => {
    if (numRevenue <= 0 || numDebt <= 0) {
      setHasEvaluated(false)
      setResult(null)
      return
    }
    setHasEvaluated(true)
    const timer = setTimeout(() => {
      void runBackendAssessment({
        prov: selectedProvinceCode,
        biz: business,
        statusKey: debtStatus,
        revVal: numRevenue,
        debtVal: numDebt,
      })
    }, 350)
    return () => clearTimeout(timer)
  }, [numRevenue, numDebt, selectedProvinceCode, business, debtStatus])

  function resetAllInputs() {
    setActivePreset(null)
    setRevenue("")
    setOpex("")
    setDebtPayment("")
    setCashReserve("")
    setTotalPrincipal("")
    setExtraLoans([])
    setHorizonYears(5)
    setHasEvaluated(false)
    setCsvImportNote(null)
    setApiError(null)
    setResult(null)
  }

  function handleUserTypeChange(nextType: "individual" | "business") {
    setUserType(nextType)
    setActivePreset(null)
    if (nextType === "individual") {
      setBusiness("household")
    } else if (business === "household") {
      setBusiness("hotel")
    }
  }

  function addExtraLoan() {
    setExtraLoans((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${prev.length}`,
        category: userType === "individual" ? "card" : "sme",
        monthlyPayment: "",
        principal: "",
      },
    ])
  }

  function updateExtraLoan(id: string, patch: Partial<ExtraLoanItem>) {
    setExtraLoans((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function removeExtraLoan(id: string) {
    setExtraLoans((prev) => prev.filter((item) => item.id !== id))
  }

  const diagnostic = useMemo(() => {
    if (numRevenue <= 0) return null
    return computeFinancialDiagnostic({
      isSme,
      monthlyRevenue: numRevenue,
      monthlyOpex: numOpex,
      monthlyDebt: numDebt,
      cashReserve: numReserve,
      stressDropPct,
    })
  }, [isSme, numRevenue, numOpex, numDebt, numReserve, stressDropPct])

  const loanComparison = useMemo(() => {
    if (numRevenue <= 0 || debtStatus === "overdue_120_plus") return null
    return buildLoanComparison({
      status: debtStatus,
      isSme,
      monthlyRevenue: numRevenue,
      monthlyDebt: numDebt,
      totalPrincipalInput: numPrincipal,
      borrowerAge: 0,
      clinicMonths: Math.max(12, Math.min(120, Math.round(horizonYears * 12))),
      deferMonths,
      customHorizonYears: horizonYears,
      lang,
    })
  }, [debtStatus, isSme, numRevenue, numDebt, numPrincipal, deferMonths, horizonYears, lang])

  // Yearly installment comparison bars up to user selected horizon
  const paymentChartData = useMemo(() => {
    if (!loanComparison || !diagnostic) return []
    const maxYearsToShow = Math.max(1, Math.min(10, Math.ceil(horizonYears)))
    return loanComparison.points
      .filter((pt) => pt.yearNum >= 1 && pt.yearNum <= maxYearsToShow)
      .map((pt) => ({
        yearLabel: pt.yearLabel,
        originalPayment: pt.originalPayment,
        policyPayment: pt.policyPayment,
        affordableProfit: Math.max(0, diagnostic.operatingCashflow),
        originalBalance: pt.originalBalance,
        policyBalance: pt.policyBalance,
      }))
  }, [loanComparison, diagnostic, horizonYears])

  // Compute Y axis max including the orange dashed affordable cashflow reference line so it never clips off top
  const chartYAxisMax = useMemo(() => {
    if (!paymentChartData.length || !diagnostic) return undefined
    const maxBar = paymentChartData.reduce(
      (acc, d) => Math.max(acc, d.originalPayment, d.policyPayment),
      0,
    )
    const peak = Math.max(maxBar, Math.max(0, diagnostic.operatingCashflow))
    return peak > 0 ? Math.ceil((peak * 1.15) / 1000) * 1000 : undefined
  }, [paymentChartData, diagnostic])

  // Dynamic context phrase based on userType and business so hotel terms never leak into individual or restaurant cases
  const lowSeasonPhraseTh = useMemo(() => {
    if (userType === "individual") return "ช่วงรายได้ลดลง"
    if (business === "restaurant") return "ช่วงลูกค้าเงียบ"
    if (business === "tour") return "ช่วงนอกฤดูท่องเที่ยว"
    return "ช่วงผู้เข้าพักน้อย"
  }, [userType, business])

  const beneficiaryNounTh = useMemo(() => {
    if (userType === "individual") return "คุณ"
    if (business === "restaurant") return "ร้านค้า"
    return "กิจการ"
  }, [userType, business])

  const matchedPrograms = useMemo(() => {
    if (!diagnostic) return []
    return matchOfficialPrograms({
      status: debtStatus,
      isSme,
      dscr: diagnostic.dscr,
      dsrPct: diagnostic.dsrPct,
      hasWaterOrDisaster: Boolean(selectedProvData?.has_active_water_pollution || selectedProvData?.has_active_external_shock),
    })
  }, [diagnostic, debtStatus, isSme, selectedProvData])

  async function runBackendAssessment(params: {
    prov: string
    biz: string
    statusKey: DebtStatusKey
    revVal: number
    debtVal: number
  }) {
    setHasEvaluated(true)
    setSubmitting(true)
    setApiError(null)
    try {
      const tags: string[] = []
      if (params.statusKey === "overdue_31_120" || params.statusKey === "overdue_120_plus") tags.push("overdue_debt")
      if (params.statusKey === "persistent") tags.push("persistent_debt")
      if (params.statusKey === "disaster") tags.push("disaster")
      if (selectedProvData?.has_active_water_pollution) tags.push("water_pollution")
      const res = await submitReliefCheck({
        province: params.prov,
        business_type: params.biz === "household" ? "general_service" : params.biz,
        monthly_revenue_thb: params.revVal,
        monthly_debt_thb: params.debtVal,
        impact_tags: tags,
        language: lang,
      })
      setResult(res)
    } catch {
      // Silently rely on client side calculations when offline or backend is waking up
      setApiError(null)
    } finally {
      setSubmitting(false)
    }
  }

  function applyPreset(preset: "individual_tight" | "sme_tight" | "khunsoo_sme" | "disaster_cr") {
    setActivePreset(preset)
    setApiError(null)
    setExtraLoans([])
    if (preset === "individual_tight") {
      setUserType("individual")
      setBusiness("household")
      setDebtStatus("current")
      setRevenue("35000")
      setOpex("14000")
      setDebtPayment("15500")
      setCashReserve("45000")
      setTotalPrincipal("450000")
      setHorizonYears(5)
      void runBackendAssessment({
        prov: selectedProvinceCode,
        biz: "household",
        statusKey: "current",
        revVal: 35000,
        debtVal: 15500,
      })
    } else if (preset === "sme_tight") {
      setUserType("business")
      setBusiness("hotel")
      setDebtStatus("current")
      setRevenue("165000")
      setOpex("112000")
      setDebtPayment("48000")
      setCashReserve("240000")
      setTotalPrincipal("1850000")
      void runBackendAssessment({
        prov: selectedProvinceCode,
        biz: "hotel",
        statusKey: "current",
        revVal: 165000,
        debtVal: 48000,
      })
    } else if (preset === "khunsoo_sme") {
      setUserType("business")
      setBusiness("restaurant")
      setDebtStatus("overdue_31_120")
      setRevenue("120000")
      setOpex("84000")
      setDebtPayment("44000")
      setCashReserve("150000")
      setTotalPrincipal("1600000")
      void runBackendAssessment({
        prov: selectedProvinceCode,
        biz: "restaurant",
        statusKey: "overdue_31_120",
        revVal: 120000,
        debtVal: 44000,
      })
    } else {
      setUserType("business")
      setSelectedProvinceCode("CR")
      setBusiness("restaurant")
      setDebtStatus("disaster")
      setRevenue("135000")
      setOpex("92000")
      setDebtPayment("39000")
      setCashReserve("160000")
      setTotalPrincipal("1500000")
      void runBackendAssessment({
        prov: "CR",
        biz: "restaurant",
        statusKey: "disaster",
        revVal: 135000,
        debtVal: 39000,
      })
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!revenue.trim() || !debtPayment.trim() || numRevenue <= 0) {
      setApiError(
        lang === "th"
          ? "กรุณากรอกรายได้ต่อเดือนและค่างวดหนี้ต่อเดือนก่อนกดคำนวณ"
          : "Please enter monthly revenue and monthly debt payment before evaluating.",
      )
      return
    }
    await runBackendAssessment({
      prov: selectedProvinceCode,
      biz: business,
      statusKey: debtStatus,
      revVal: numRevenue,
      debtVal: numDebt,
    })
  }

  function openDossierModal() {
    if (!diagnostic) return
    dossierDialogRef.current?.showModal()
  }

  async function openCitationModal(cite: CitationItem) {
    const title = cite.doc_title || "เอกสารทางการ"
    const pNum = Number(cite.page_num) || 1
    const fallbackText = cite.page_excerpt || cite.excerpt || ""
    setActiveDocPage({
      docTitle: title,
      pageNum: pNum,
      docUrl: cite.doc_url || "",
      fullText: fallbackText,
      loading: !fallbackText,
    })
    docPageDialogRef.current?.showModal()
    try {
      const pageData: PolicyPageResponse = await fetchPolicyPage(title, pNum)
      setActiveDocPage({
        docTitle: pageData.doc_title,
        pageNum: pageData.page_num,
        docUrl: pageData.doc_url || cite.doc_url || "",
        fullText: pageData.full_text || fallbackText,
        totalPages: pageData.total_pages,
        loading: false,
      })
    } catch {
      setActiveDocPage((prev) => (prev ? { ...prev, loading: false } : null))
    }
  }

  function handlePrintDossier() {
    if (!diagnostic) return
    const bizObj = BUSINESS_OPTIONS.find((b) => b.id === business)
    const statusObj = DEBT_STATUS_OPTIONS.find((s) => s.id === debtStatus)
    const html = buildFinancialDossierHtml({
      lang,
      provinceName: selectedProvName,
      provinceData: selectedProvData,
      businessLabel: bizObj ? (lang === "th" ? bizObj.th : bizObj.en) : business,
      statusLabel: statusObj ? (lang === "th" ? statusObj.th : statusObj.en) : debtStatus,
      diag: diagnostic,
      comparison: loanComparison,
      matchedPrograms: matchedPrograms.map((p) => ({
        title: lang === "th" ? p.title_th : p.title_en,
        benefit: lang === "th" ? p.benefit_th : p.benefit_en,
        criteria: lang === "th" ? p.criteria_th : p.criteria_en,
        source: lang === "th" ? p.source_th : p.source_en,
      })),
      checklist,
    })

    const iframe = document.createElement("iframe")
    iframe.style.position = "fixed"
    iframe.style.right = "0"
    iframe.style.bottom = "0"
    iframe.style.width = "0"
    iframe.style.height = "0"
    iframe.style.border = "0"
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument || iframe.contentWindow?.document
    if (!doc || !iframe.contentWindow) {
      document.body.removeChild(iframe)
      return
    }
    doc.open()
    doc.write(html)
    doc.close()
    setTimeout(() => {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
      }, 1500)
    }, 220)
  }

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
      ref={ref}
      id="relief-assistant"
      aria-labelledby="relief-heading"
      className="scroll-target scroll-mt-28 px-4 py-16 sm:px-8 md:py-20"
    >
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="mb-7 flex flex-col gap-3 md:flex-row md:items-end md:justify-between"
        >
          <div className="max-w-2xl">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              {lang === "th" ? "เช็กสุขภาพการเงินและคำนวณค่างวดใหม่" : "Financial Health & Restructuring Simulator"}
            </p>
            <h2
              id="relief-heading"
              className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
            >
              {lang === "th"
                ? "ตรวจสุขภาพการเงิน คำนวณค่างวด และสร้างใบสรุปยื่นธนาคาร"
                : "Diagnose Cashflow, Simulate Relief & Export 1 Page Dossier"}
            </h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            {lang === "th"
              ? "คำนวณความสามารถในการจ่ายหนี้ ระยะเวลาที่เงินเก็บอยู่รอดได้ และเปรียบเทียบค่างวดเดิมกับค่างวดใหม่ พร้อมพิมพ์ใบสรุปไปคุยกับธนาคารได้ทันที"
              : "Evaluate debt affordability, cash reserve runway, and policy aligned payment comparisons with a printable 1 page lender dossier."}
          </p>
        </motion.div>

        {/* Single Unified Quick Action Bar with Dynamic Active Highlight */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Sparkles aria-hidden="true" className="size-3.5" />
              {lang === "th" ? "ลองกดดูตัวอย่างทันที:" : "Instant live examples:"}
            </span>
            {(
              [
                {
                  key: "individual_tight" as const,
                  th: "บุคคลทั่วไป / มนุษย์เงินเดือน",
                  en: "Individual / Salaried",
                  onClick: () => applyPreset("individual_tight"),
                },
                {
                  key: "sme_tight" as const,
                  th: "โรงแรมที่การเงินเริ่มตึงมือ",
                  en: "Tight Hotel SME",
                  onClick: () => applyPreset("sme_tight"),
                },
                {
                  key: "khunsoo_sme" as const,
                  th: "ร้านอาหารค้างชำระ 1–4 เดือน",
                  en: "Restaurant 31 to 120d",
                  onClick: () => applyPreset("khunsoo_sme"),
                },
                {
                  key: "disaster_cr" as const,
                  th: "ร้านอาหารริมน้ำกระทบมลพิษ",
                  en: "Riverside Hazard SME",
                  onClick: () => applyPreset("disaster_cr"),
                },
              ] as const
            ).map((btn) => {
              const isSelected = activePreset === btn.key
              return (
                <button
                  key={btn.key}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={btn.onClick}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    isSelected
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-foreground hover:bg-secondary"
                  }`}
                >
                  {lang === "th" ? btn.th : btn.en}
                </button>
              )
            })}
          </div>

          {hasAnyInput && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={resetAllInputs}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <RotateCcw aria-hidden="true" className="size-3" />
                {lang === "th" ? "ล้างข้อมูล" : "Clear"}
              </button>
            </div>
          )}
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[5fr_7fr]">
          {/* Left Compact Form with Numbers Immediately Visible Above the Fold */}
          <motion.form
            onSubmit={handleSubmit}
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.06 }}
            className="rounded-[1.75rem] border border-border bg-card p-5 sm:p-6"
          >
            <div className="mb-4 flex items-start justify-between gap-2 border-b border-border pb-3">
              <div>
                <h3 className="font-display text-base font-semibold text-foreground sm:text-lg">
                  {lang === "th" ? "ข้อมูลรายรับ รายจ่าย และภาระหนี้" : "Cashflow & Debt Inputs"}
                </h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {lang === "th"
                    ? "ไม่เก็บข้อมูลส่วนบุคคล ประมวลผลเพื่อจำลองแผนเจรจาเท่านั้น"
                    : "No personal data stored. Processed strictly for planning."}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3.5">
              {/* Top User Mode Switcher (Individual vs Business) */}
              <div
                role="tablist"
                aria-label={lang === "th" ? "เลือกประเภทผู้ใช้งาน" : "Select user profile"}
                className="grid grid-cols-2 gap-1 rounded-2xl border border-border bg-secondary/50 p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={userType === "individual"}
                  onClick={() => handleUserTypeChange("individual")}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                    userType === "individual"
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {lang === "th" ? "บุคคลทั่วไป / มนุษย์เงินเดือน" : "Individual / Household"}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={userType === "business"}
                  onClick={() => handleUserTypeChange("business")}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                    userType === "business"
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {lang === "th" ? "เจ้าของร้านค้า / กิจการ" : "Shop / Business Owner"}
                </button>
              </div>

              {/* Step A Core Numbers First so User Sees Them Immediately */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="monthly-revenue" className="mb-1 block text-xs font-medium text-foreground">
                    {lang === "th"
                      ? userType === "individual"
                        ? "รายได้ต่อเดือน (เงินเดือน/รายได้รวม) *"
                        : "รายได้รวมกิจการ/เดือน *"
                      : "Monthly Income *"}
                  </label>
                  <div className="relative">
                    <input
                      id="monthly-revenue"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={revenue}
                      onChange={(e) => {
                        setActivePreset(null)
                        setRevenue(e.target.value)
                      }}
                      placeholder={lang === "th" ? "กรอกรายได้ต่อเดือน" : "Enter monthly revenue"}
                      className="h-10 w-full rounded-xl border border-input bg-background px-3 pr-11 text-sm font-medium text-foreground outline-none transition placeholder:text-xs placeholder:font-normal placeholder:text-muted-foreground/60 focus:border-foreground/45 focus:ring-2 focus:ring-foreground/10"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                      {lang === "th" ? "บาท" : "THB"}
                    </span>
                  </div>
                </div>
                <div>
                  <label htmlFor="debt-payment" className="mb-1 block text-xs font-medium text-foreground">
                    {lang === "th" ? "ค่างวดหนี้รวม/เดือน *" : "Monthly Debt *"}
                  </label>
                  <div className="relative">
                    <input
                      id="debt-payment"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={debtPayment}
                      onChange={(e) => {
                        setActivePreset(null)
                        setDebtPayment(e.target.value)
                      }}
                      placeholder={lang === "th" ? "กรอกค่างวดต่อเดือน" : "Enter monthly payment"}
                      className="h-10 w-full rounded-xl border border-input bg-background px-3 pr-11 text-sm font-medium text-foreground outline-none transition placeholder:text-xs placeholder:font-normal placeholder:text-muted-foreground/60 focus:border-foreground/45 focus:ring-2 focus:ring-foreground/10"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                      {lang === "th" ? "บาท" : "THB"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="monthly-opex" className="mb-1 block text-xs font-medium text-foreground">
                    {lang === "th"
                      ? userType === "individual"
                        ? "ค่าใช้จ่ายจำเป็น/เดือน"
                        : "รายจ่ายดำเนินงานคงที่/เดือน"
                      : userType === "individual"
                        ? "Essential Living Cost/mo"
                        : "Fixed Operating Cost/mo"}
                  </label>
                  <div className="relative">
                    <input
                      id="monthly-opex"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={opex}
                      onChange={(e) => {
                        setActivePreset(null)
                        setOpex(e.target.value)
                      }}
                      placeholder={lang === "th" ? "เช่น ค่าเช่า ค่ากิน ค่าน้ำไฟ" : "Enter fixed costs"}
                      className="h-10 w-full rounded-xl border border-input bg-background px-3 pr-11 text-sm text-foreground outline-none transition placeholder:text-xs placeholder:text-muted-foreground/60 focus:border-foreground/45 focus:ring-2 focus:ring-foreground/10"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                      {lang === "th" ? "บาท" : "THB"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {lang === "th"
                      ? userType === "individual"
                        ? "ค่าเช่าบ้าน ค่าอาหาร ค่าน้ำไฟ ค่าเดินทาง"
                        : "ค่าเช่า ค่าจ้าง ค่าน้ำไฟ วัตถุดิบ"
                      : "Rent, utilities, essentials"}
                  </p>
                </div>
                <div>
                  <label htmlFor="cash-reserve" className="mb-1 block text-xs font-medium text-foreground">
                    {lang === "th"
                      ? userType === "business"
                        ? "เงินสดสำรองกิจการที่มี"
                        : "เงินเก็บสำรองฉุกเฉินที่มี"
                      : "Liquid Cash Reserve"}
                  </label>
                  <div className="relative">
                    <input
                      id="cash-reserve"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={cashReserve}
                      onChange={(e) => {
                        setActivePreset(null)
                        setCashReserve(e.target.value)
                      }}
                      placeholder={lang === "th" ? "กรอกเงินสำรองที่มี" : "Enter cash reserve"}
                      className="h-10 w-full rounded-xl border border-input bg-background px-3 pr-11 text-sm text-foreground outline-none transition placeholder:text-xs placeholder:text-muted-foreground/60 focus:border-foreground/45 focus:ring-2 focus:ring-foreground/10"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                      {lang === "th" ? "บาท" : "THB"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {lang === "th" ? "คำนวณว่าเงินสำรองอยู่รอดได้กี่เดือน" : "Computes Liquidity Runway"}
                  </p>
                </div>
              </div>

              {debtStatus !== "overdue_120_plus" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="total-principal" className="mb-1 block text-xs font-medium text-foreground">
                      {lang === "th" ? "ยอดเงินต้นหนี้คงเหลือรวม (ถ้าทราบ)" : "Total Debt Principal (Optional)"}
                    </label>
                    <div className="relative">
                      <input
                        id="total-principal"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        value={totalPrincipal}
                        onChange={(e) => setTotalPrincipal(e.target.value)}
                        placeholder={lang === "th" ? "กรอกยอดเงินต้นคงเหลือ" : "Enter total principal"}
                        className="h-9 w-full rounded-xl border border-input bg-background px-3 pr-11 text-sm text-foreground outline-none transition placeholder:text-xs placeholder:text-muted-foreground/60 focus:border-foreground/45 focus:ring-2 focus:ring-foreground/10"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                        {lang === "th" ? "บาท" : "THB"}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="horizon-years" className="mb-1 block text-xs font-medium text-foreground">
                      {lang === "th" ? "ระยะเวลาผ่อนที่ต้องการคำนวณ (ปี)" : "Target Payoff Horizon (Years)"}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        id="horizon-years"
                        type="number"
                        min="1"
                        max="30"
                        step="1"
                        value={horizonYears}
                        onChange={(e) => setHorizonYears(Math.max(1, Math.min(30, Number(e.target.value) || 5)))}
                        className="h-9 min-w-[3.5rem] flex-1 rounded-xl border border-input bg-background px-2 text-center text-sm font-medium text-foreground outline-none focus:border-foreground/45"
                      />
                      {[3, 5, 10].map((yr) => (
                        <button
                          key={yr}
                          type="button"
                          onClick={() => setHorizonYears(yr)}
                          className={`shrink-0 whitespace-nowrap rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                            horizonYears === yr
                              ? "border-foreground bg-foreground text-background"
                              : "border-border bg-background text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {yr} {lang === "th" ? "ปี" : "yr"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Progressive Disclosure Optional Multi Loan Breakdown */}
              <div className="rounded-2xl border border-dashed border-border bg-secondary/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-foreground">
                    {lang === "th"
                      ? extraLoans.length > 0
                        ? `แยกคำนวณหนี้หลายก้อน (+${extraLoans.length} ก้อน · รวมค่างวด ${numDebt.toLocaleString()} บาท/เดือน)`
                        : "มีหนี้หลายใบ/หลายก้อน (เช่น บัตร + รถ + บ้าน)?"
                      : extraLoans.length > 0
                        ? `${extraLoans.length} additional loans (Total ${numDebt.toLocaleString()} THB/mo)`
                        : "Have multiple separate loans?"}
                  </span>
                  <button
                    type="button"
                    onClick={addExtraLoan}
                    className="shrink-0 rounded-full border border-border bg-background px-3 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
                  >
                    {lang === "th" ? "+ เพิ่มก้อนหนี้อื่น" : "+ Add Loan"}
                  </button>
                </div>

                {extraLoans.length > 0 && (
                  <div className="mt-2.5 space-y-2">
                    {extraLoans.map((loan, idx) => (
                      <div key={loan.id} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-1.5">
                        <select
                          aria-label={`Extra loan ${idx + 1} type`}
                          value={loan.category}
                          onChange={(e) =>
                            updateExtraLoan(loan.id, { category: e.target.value as ExtraLoanItem["category"] })
                          }
                          className="h-8 rounded-lg border border-input bg-background px-2 text-[11px] text-foreground outline-none"
                        >
                          <option value="card">{lang === "th" ? "บัตร/สินเชื่อบุคคล" : "Card / Personal"}</option>
                          <option value="auto">{lang === "th" ? "สินเชื่อรถ" : "Auto Loan"}</option>
                          <option value="home">{lang === "th" ? "สินเชื่อบ้าน" : "Home Loan"}</option>
                          <option value="sme">{lang === "th" ? "สินเชื่อร้านค้า" : "Business Loan"}</option>
                        </select>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={loan.monthlyPayment}
                          onChange={(e) => updateExtraLoan(loan.id, { monthlyPayment: e.target.value })}
                          placeholder={lang === "th" ? "ค่างวด/เดือน" : "Monthly pay"}
                          className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground outline-none"
                        />
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={loan.principal}
                          onChange={(e) => updateExtraLoan(loan.id, { principal: e.target.value })}
                          placeholder={lang === "th" ? "ยอดต้น (ไม่บังคับ)" : "Principal"}
                          className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => removeExtraLoan(loan.id)}
                          aria-label="Remove loan"
                          className="rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <p className="rounded-xl border border-amber-600/30 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-4 text-amber-950">
                      {lang === "th"
                        ? "ระบบคำนวณภาพรวมจากยอดผ่อนรวม ทั้งนี้ หากเป็นหนี้ต่างประเภท (เช่น สินเชื่อธุรกิจ/บ้าน + บัตรเครดิต) อาจต้องยื่นแยกตามเกณฑ์ของแต่ละสถาบันการเงิน"
                        : "Calculated from combined monthly payments. Mixed loan types (e.g. mortgage/business + credit card) may require separate applications per lender rules."}
                    </p>
                  </div>
                )}
              </div>

              {/* Step B Province & Optional Business Selector */}
              <div className={`grid grid-cols-1 gap-3 border-t border-border pt-3 ${userType === "business" ? "sm:grid-cols-2" : ""}`}>
                <div>
                  <label htmlFor="province" className="mb-1 block text-xs font-medium text-foreground">
                    {lang === "th"
                      ? userType === "individual"
                        ? "จังหวัดที่อยู่อาศัย"
                        : "จังหวัดที่ตั้งกิจการ"
                      : "Northern Province"}
                  </label>
                  <div className="relative">
                    <select
                      id="province"
                      value={selectedProvinceCode}
                      onChange={(e) => setSelectedProvinceCode(e.target.value)}
                      className="h-9 w-full appearance-none rounded-xl border border-input bg-background bg-none px-3 pr-8 text-xs font-medium text-foreground outline-none transition focus:border-foreground/45"
                    >
                      {provinceList.map((p) => (
                        <option key={p.code} value={p.code}>
                          {lang === "th" ? p.name_th : p.name_en}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      aria-hidden="true"
                      className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                    />
                  </div>
                </div>

                {userType === "business" && (
                  <div>
                    <label htmlFor="business-type" className="mb-1 block text-xs font-medium text-foreground">
                      {lang === "th" ? "ประเภทกิจการ" : "Business Type"}
                    </label>
                    <div className="relative">
                      <select
                        id="business-type"
                        value={business}
                        onChange={(e) => setBusiness(e.target.value)}
                        className="h-9 w-full appearance-none rounded-xl border border-input bg-background bg-none px-3 pr-8 text-xs font-medium text-foreground outline-none transition focus:border-foreground/45"
                      >
                        {BUSINESS_OPTIONS.filter((b) => b.id !== "household").map((b) => (
                          <option key={b.id} value={b.id}>
                            {lang === "th" ? b.th : b.en}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        aria-hidden="true"
                        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Step C Compact Repayment Status Grid */}
              <fieldset>
                <legend className="mb-1.5 text-xs font-medium text-foreground">
                  {lang === "th"
                    ? "สถานะการผ่อนชำระของคุณในปัจจุบัน (เลือกเพื่อจับคู่ทางออกที่ตรงเงื่อนไข)"
                    : "Your Current Repayment Status (Select to match solutions)"}
                </legend>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {DEBT_STATUS_OPTIONS.map((opt, idx) => {
                    const active = debtStatus === opt.id
                    const spanFull = idx === DEBT_STATUS_OPTIONS.length - 1
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setDebtStatus(opt.id)}
                        className={`flex flex-col rounded-xl border px-3 py-2 text-left transition-colors ${
                          spanFull ? "sm:col-span-2" : ""
                        } ${
                          active
                            ? "border-foreground bg-secondary/90 text-foreground"
                            : "border-border bg-background text-muted-foreground hover:border-foreground/35 hover:text-foreground"
                        }`}
                      >
                        <span className="text-[11px] font-semibold text-foreground">
                          {lang === "th" ? opt.th : opt.en}
                        </span>
                        <span className="mt-0.5 text-[10px] text-muted-foreground">
                          {lang === "th" ? opt.sub_th : opt.sub_en}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              {apiError && (
                <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {apiError}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-secondary/35 px-3.5 py-2.5">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  {submitting ? (
                    <>
                      <Loader2 aria-hidden="true" className="size-3.5 animate-spin text-foreground" />
                      <span>{lang === "th" ? "กำลังอัปเดตผลวิเคราะห์…" : "Updating diagnostic…"}</span>
                    </>
                  ) : numRevenue > 0 ? (
                    <>
                      <Check aria-hidden="true" className="size-3.5 text-emerald-700" />
                      <span>
                        {lang === "th"
                          ? "คำนวณอัตโนมัติแล้ว · แก้ตัวเลขหรือสลับสถานะได้ทันที"
                          : "Live calculated · Edit any number or status freely"}
                      </span>
                    </>
                  ) : (
                    <>
                      <Calculator aria-hidden="true" className="size-3.5" />
                      <span>
                        {lang === "th"
                          ? "กรอกรายได้และค่างวดในแบบฟอร์มเพื่อแสดงผลวิเคราะห์ทันที"
                          : "Enter income and payment above to see instant analysis"}
                      </span>
                    </>
                  )}
                </span>

                {hasAnyInput && (
                  <button
                    type="button"
                    onClick={resetAllInputs}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                  >
                    <RotateCcw aria-hidden="true" className="size-3" />
                    {lang === "th" ? "ล้างข้อมูลเพื่อกรอกใหม่" : "Reset All Fields"}
                  </button>
                )}
              </div>
            </div>
          </motion.form>

          {/* Right Panel Directly Connected Diagnostic, Payment Comparison Chart, Referral Bridge & 1 Page Dossier */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.14 }}
            className="flex flex-col rounded-[1.75rem] border border-border bg-secondary/45 p-5 sm:p-6"
          >
            {!diagnostic ? (
              <div className="flex flex-col justify-between rounded-2xl border border-border bg-background p-6">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-[11px] font-medium text-foreground">
                    <Calculator aria-hidden="true" className="size-3.5" />
                    {lang === "th" ? "ผลวิเคราะห์และแนวทางแก้หนี้" : "Live Diagnostic Appears Here"}
                  </span>
                  <h3 className="mt-3.5 font-display text-lg font-semibold text-foreground sm:text-xl">
                    {lang === "th"
                      ? "กรอกตัวเลขในแบบฟอร์ม หรือกดปุ่มตัวอย่างด้านบนเพื่อดูผลวิเคราะห์ทันที"
                      : "Enter figures in the form or click any instant example button above"}
                  </h3>
                  <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
                    {lang === "th"
                      ? "เมื่อกรอกข้อมูลครบ ระบบจะแสดงความสามารถในการจ่ายหนี้ ระยะเวลาที่เงินเก็บอยู่รอดได้ กราฟเปรียบเทียบค่างวดเดิม–ใหม่ และปุ่มพิมพ์ใบสรุป 1 หน้าสำหรับนำไปคุยกับธนาคาร"
                      : "Displays affordability, cash reserve runway, stress impact, payment comparison charts, and a 1 page printable dossier."}
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* 1. Financial Health Diagnostic Cards */}
                <div className="rounded-2xl border border-border bg-background p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        {lang === "th" ? "1. ผลตรวจสุขภาพการเงินปัจจุบัน" : "1. Current Financial Health"}
                      </p>
                      <h3 className="mt-0.5 font-display text-base font-semibold text-foreground">
                        {selectedProvName} ·{" "}
                        {userType === "individual"
                          ? lang === "th"
                            ? "บุคคลทั่วไป / มนุษย์เงินเดือน"
                            : "Individual / Household"
                          : BUSINESS_OPTIONS.find((b) => b.id === business)?.[lang === "th" ? "th" : "en"]}
                      </h3>
                    </div>
                    <span
                      className={`rounded-full border px-3 py-1 text-[11px] font-medium ${
                        diagnostic.netMonthlyCashflow < 0
                          ? "border-red-600/30 bg-red-500/10 text-red-800"
                          : diagnostic.netMonthlyCashflow < diagnostic.monthlyDebt * 0.25
                            ? "border-amber-600/30 bg-amber-500/10 text-amber-900"
                            : "border-emerald-700/25 bg-emerald-700/10 text-emerald-800"
                      }`}
                    >
                      {diagnostic.netMonthlyCashflow >= 0
                        ? lang === "th"
                          ? `เงินเหลือพอจ่าย (+${Math.round(diagnostic.netMonthlyCashflow).toLocaleString()} บาท/เดือน)`
                          : `Surplus (+${Math.round(diagnostic.netMonthlyCashflow).toLocaleString()} THB/mo)`
                        : lang === "th"
                          ? `เงินเหลือไม่พอจ่าย (ขาดอีก ${Math.abs(Math.round(diagnostic.netMonthlyCashflow)).toLocaleString()} บาท/เดือน)`
                          : `Shortfall (-${Math.abs(Math.round(diagnostic.netMonthlyCashflow)).toLocaleString()} THB/mo)`}
                    </span>
                  </div>

                  <div className="mt-3.5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-border bg-secondary/35 p-3.5">
                      <p className="text-[10px] text-muted-foreground">
                        {lang === "th" ? "ความสามารถในการจ่ายหนี้" : "Debt Affordability"}
                      </p>
                      <p
                        className={`mt-1 font-display text-lg font-semibold sm:text-xl ${
                          diagnostic.netMonthlyCashflow < 0
                            ? "text-red-700"
                            : diagnostic.netMonthlyCashflow < diagnostic.monthlyDebt * 0.25
                              ? "text-amber-700"
                              : "text-teal-700"
                        }`}
                      >
                        {diagnostic.netMonthlyCashflow >= 0
                          ? lang === "th"
                            ? `เงินเหลือพอจ่าย (+${Math.round(diagnostic.netMonthlyCashflow).toLocaleString()} บาท/เดือน)`
                            : `Surplus (+${Math.round(diagnostic.netMonthlyCashflow).toLocaleString()}/mo)`
                          : lang === "th"
                            ? `เงินเหลือไม่พอจ่าย (ขาดอีก ${Math.abs(Math.round(diagnostic.netMonthlyCashflow)).toLocaleString()} บาท/เดือน)`
                            : `Shortfall (-${Math.abs(Math.round(diagnostic.netMonthlyCashflow)).toLocaleString()}/mo)`}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {lang === "th"
                          ? `เงินเหลือหลังหักค่าใช้จ่าย ${Math.round(diagnostic.operatingCashflow).toLocaleString()} บาท · ค่างวดคิดเป็น ${diagnostic.dsrPct.toFixed(1)}% ของรายได้`
                          : `Pre debt cashflow ${Math.round(diagnostic.operatingCashflow).toLocaleString()} · DSR ${diagnostic.dsrPct.toFixed(1)}%`}
                      </p>
                    </div>

                    <div className="rounded-xl border border-border bg-secondary/35 p-3.5">
                      <p className="text-[10px] text-muted-foreground">
                        {lang === "th" ? "เงินเก็บที่มีอยู่ได้นาน (กรณีรายได้เป็น 0)" : "Zero Income Cash Runway"}
                      </p>
                      <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">
                        {diagnostic.runwayTotalMonths != null
                          ? lang === "th"
                            ? `อยู่ได้ ${diagnostic.runwayTotalMonths.toFixed(1)} เดือน`
                            : `${diagnostic.runwayTotalMonths.toFixed(1)} mos`
                          : "—"}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {diagnostic.runwayTotalMonths != null
                          ? lang === "th"
                            ? "หากไม่มีรายรับเข้ามาเลย (0 บาท) เงินเก็บจะช่วยจ่ายได้เท่านี้"
                            : "Months covered by reserve if income drops to 0"
                          : lang === "th"
                            ? "กรอกเงินเก็บสำรองเพื่อคำนวณ"
                            : "Enter reserve to calculate"}
                      </p>
                    </div>

                    <div className="rounded-xl border border-border bg-secondary/35 p-3.5">
                      <p className="text-[10px] text-muted-foreground">
                        {lang === "th" ? "เงินเหลือใช้สุทธิ/เดือน" : "Net Monthly Cash Left"}
                      </p>
                      <p
                        className={`mt-1 font-display text-2xl font-semibold tabular-nums ${
                          diagnostic.netMonthlyCashflow < 0 ? "text-red-700" : "text-teal-700"
                        }`}
                      >
                        {diagnostic.netMonthlyCashflow >= 0 ? "+" : ""}
                        {Math.round(diagnostic.netMonthlyCashflow).toLocaleString()}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {lang === "th" ? "บาท/เดือน หลังหักค่าใช้จ่ายและค่างวด" : "THB/mo after expenses & debt"}
                      </p>
                    </div>
                  </div>

                  {/* Interactive Revenue Drop Simulation */}
                  <div className="mt-3.5 rounded-xl border border-amber-600/25 bg-amber-500/5 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-foreground">
                        {lang === "th"
                          ? `จำลองภาวะรายได้หดตัว (${lowSeasonPhraseTh} / น้ำท่วม / ฝุ่น / มลพิษทางน้ำ)`
                          : "Income Shock Stress Test (Income Drop / Regional Hazard)"}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {[20, 30, 40].map((drop) => (
                          <button
                            key={drop}
                            type="button"
                            onClick={() => setStressDropPct(drop)}
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                              stressDropPct === drop
                                ? "bg-foreground text-background"
                                : "border border-border bg-background text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {lang === "th" ? `รายได้ลด -${drop}%` : `-${drop}% Revenue`}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-2.5 grid gap-2 text-xs sm:grid-cols-3">
                      <div className="rounded-lg bg-background px-3 py-2">
                        <p className="text-[10px] text-muted-foreground">
                          {lang === "th" ? `รายได้เหลือ (-${stressDropPct}%)` : `Revenue at -${stressDropPct}%`}
                        </p>
                        <p className="mt-0.5 font-semibold tabular-nums text-foreground">
                          {diagnostic.stressedRevenue.toLocaleString()} {lang === "th" ? "บาท" : "THB"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-background px-3 py-2">
                        <p className="text-[10px] text-muted-foreground">
                          {lang === "th" ? "สถานะการจ่ายหนี้เมื่อรายได้ลด" : "Affordability After Drop"}
                        </p>
                        <p
                          className={`mt-0.5 font-semibold tabular-nums ${
                            diagnostic.stressedNetMonthlyCashflow < 0 ? "text-red-700" : "text-teal-700"
                          }`}
                        >
                          {diagnostic.stressedNetMonthlyCashflow >= 0
                            ? lang === "th"
                              ? `เงินเหลือพอจ่าย (+${Math.round(diagnostic.stressedNetMonthlyCashflow).toLocaleString()} บาท/เดือน)`
                              : `Surplus (+${Math.round(diagnostic.stressedNetMonthlyCashflow).toLocaleString()}/mo)`
                            : lang === "th"
                              ? `เงินเหลือไม่พอจ่าย (ขาดอีก ${Math.abs(Math.round(diagnostic.stressedNetMonthlyCashflow)).toLocaleString()} บาท/เดือน)`
                              : `Shortfall (-${Math.abs(Math.round(diagnostic.stressedNetMonthlyCashflow)).toLocaleString()}/mo)`}
                        </p>
                      </div>
                      <div className="rounded-lg bg-background px-3 py-2">
                        <p className="text-[10px] text-muted-foreground">
                          {lang === "th" ? "เงินเก็บสำรองช่วยโปะส่วนที่ขาดได้" : "Reserve Deficit Coverage"}
                        </p>
                        <p
                          className={`mt-0.5 font-semibold tabular-nums ${
                            diagnostic.stressedNetMonthlyCashflow < 0 ? "text-red-700" : "text-teal-700"
                          }`}
                        >
                          {diagnostic.stressedNetMonthlyCashflow < 0
                            ? diagnostic.stressedRunwayMonths != null && numReserve > 0
                              ? lang === "th"
                                ? `ช่วยโปะส่วนที่ขาดได้ ${diagnostic.stressedRunwayMonths} เดือน`
                                : `Covers deficit for ${diagnostic.stressedRunwayMonths} mos`
                              : lang === "th"
                                ? "ไม่มีเงินเก็บสำรองช่วยโปะ"
                                : "No reserve buffer"
                            : lang === "th"
                              ? "ไม่ต้องดึงเงินเก็บมาใช้"
                              : "No reserve draw needed"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2A. If Overdue > 120 Days Show Official Debt Clinic Referral Bridge */}
                {debtStatus === "overdue_120_plus" ? (
                  <div className="mt-4 rounded-2xl border border-amber-600/35 bg-background p-5">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-[11px] font-medium text-amber-900">
                      <AlertTriangle aria-hidden="true" className="size-3.5" />
                      {lang === "th" ? "ช่องทางส่งต่อหน่วยงานกลางโดยตรง" : "Official Debt Clinic Referral"}
                    </span>
                    <h4 className="mt-2.5 font-display text-base font-semibold text-foreground">
                      {lang === "th"
                        ? "หนี้บัตรเครดิตหรือสินเชื่อส่วนบุคคลค้างเกิน 120 วัน แนะนำส่งต่อ คลินิกแก้หนี้ (โทร 1443)"
                        : "For Unsecured NPLs > 120 Days, Apply Directly via Debt Clinic by SAM"}
                    </h4>
                    <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
                      {lang === "th"
                        ? "กรณีค้างชำระเกิน 120 วันในกลุ่มบัตรเครดิตและสินเชื่อส่วนบุคคลที่ไม่มีหลักประกัน จะมีระบบตรวจสอบข้อมูลเครดิตและคำนวณงวดผ่อนเฉพาะของ บริษัท บริหารสินทรัพย์สุขุมวิท จำกัด ระบบของเราจึงทำหน้าที่คัดกรองเบื้องต้นและส่งต่อให้คุณติดต่อหน่วยงานกลางโดยตรง"
                        : "Unsecured personal NPLs over 120 days are centrally restructured by Sukhumvit Asset Management (SAM). Use their official portal below to check NCB eligibility and apply."}
                    </p>
                    <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
                      <a
                        href="https://www.debtclinicbysam.com/"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-10 items-center gap-1.5 rounded-full bg-foreground px-5 text-xs font-medium text-background hover:opacity-85"
                      >
                        {lang === "th" ? "ไปที่เว็บไซต์คลินิกแก้หนี้" : "Open Debt Clinic by SAM"}
                        <ArrowUpRight aria-hidden="true" className="size-3.5" />
                      </a>
                      <a
                        href="tel:1443"
                        className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border px-4 text-xs font-medium text-foreground hover:bg-secondary"
                      >
                        <PhoneCall aria-hidden="true" className="size-3.5" />
                        {lang === "th" ? "โทรสายด่วน 1443" : "Call Hotline 1443"}
                      </a>
                    </div>
                  </div>
                ) : (
                  /* 2B. Intuitive Monthly Payment vs Affordable Profit Comparison Chart */
                  loanComparison && (
                    <div className="mt-4 rounded-2xl border border-border bg-background p-5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {lang === "th"
                              ? "2. เปรียบเทียบภาระค่างวดต่อเดือน: สัญญาเดิม เทียบกับ หลังปรับโครงสร้าง"
                              : "2. Monthly Installment vs Affordable Profit"}
                          </p>
                          <h4 className="mt-0.5 font-display text-sm font-semibold text-foreground sm:text-base">
                            {lang === "th" ? loanComparison.policyTitleTh : loanComparison.policyTitleEn}
                          </h4>
                        </div>
                        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-medium text-foreground">
                          {loanComparison.policyRateLabel}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                        {lang === "th" ? loanComparison.ruleCaptionTh : loanComparison.ruleCaptionEn}
                      </p>
                      {loanComparison.mode === "khunsoo" && (
                        <p className="mt-1 text-[11px] font-medium text-amber-800">
                          {lang === "th"
                            ? "หมายเหตุ: รองรับสินเชื่อบ้าน รถยนต์ และสินเชื่อธุรกิจ SME (กรณีบัตรเครดิต/สินเชื่อบุคคล ใช้เกณฑ์ปรับโครงสร้างหนี้เชิงป้องกัน)"
                            : "Note: Covers home, auto, and SME loans (unsecured cards/personal loans use Responsible Lending restructuring)."}
                        </p>
                      )}

                      {loanComparison.mode === "disaster_defer" && (
                        <div className="mt-3 flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">{lang === "th" ? "ระยะเวลาพักเงินต้น:" : "Deferral:"}</span>
                          {[3, 6].map((m) => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setDeferMonths(m)}
                              className={`rounded-full px-3 py-1 text-xs font-medium ${
                                deferMonths === m
                                  ? "bg-foreground text-background"
                                  : "border border-border bg-background text-muted-foreground"
                              }`}
                            >
                              {m} {lang === "th" ? "เดือน" : "mos"}
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
                        <SimBox
                          label={lang === "th" ? "ค่างวดใหม่ (ปีที่ 1)" : "Proposed Yr 1 Payment"}
                          value={`${loanComparison.policyYear1Payment.toLocaleString()} ${lang === "th" ? "บาท" : "THB"}`}
                          accent
                        />
                        <SimBox
                          label={lang === "th" ? "เงินสดเหลือเพิ่มในมือ/เดือน" : "Monthly Cash Relief"}
                          value={
                            loanComparison.monthlyLiquiditySaved > 0
                              ? `+${loanComparison.monthlyLiquiditySaved.toLocaleString()} ${lang === "th" ? "บาท" : "THB"}`
                              : lang === "th"
                                ? "หักเงินต้นเร็วขึ้น"
                                : "Faster Paydown"
                          }
                        />
                        <SimBox
                          label={lang === "th" ? "ดอกเบี้ยประหยัดรวม (ประมาณ)" : "Est. Interest Saved"}
                          value={`${loanComparison.totalInterestSaved.toLocaleString()} ${lang === "th" ? "บาท" : "THB"}`}
                          accent
                        />
                      </div>

                      {/* Side by Side Monthly Payment Bar Chart against Affordable Operating Profit Line */}
                      <div className="mt-4">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
                          <span>
                            {lang === "th"
                              ? userType === "individual"
                                ? "ค่างวดที่ต้องจ่ายต่อเดือน เทียบกับ เงินเหลือหลังหักค่าใช้จ่ายจำเป็น"
                                : "ค่างวดที่ต้องจ่ายต่อเดือน เทียบกับ กำไรที่กิจการมีจ่ายไหว"
                              : "Monthly Payment vs Affordable Cashflow"}
                          </span>
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="inline-flex items-center gap-1">
                              <span className="size-2 rounded-sm bg-slate-400" aria-hidden="true" />
                              {lang === "th" ? "ค่างวดเดิม/เดือน" : "Original Payment"}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <span className="size-2 rounded-sm bg-teal-700" aria-hidden="true" />
                              {lang === "th" ? "ค่างวดใหม่หลังปรับโครงสร้าง" : "Restructured Payment"}
                            </span>
                            {diagnostic.operatingCashflow > 0 && (
                              <span className="inline-flex items-center gap-1">
                                <span className="h-0.5 w-3 border-t-2 border-dashed border-amber-600" aria-hidden="true" />
                                {lang === "th"
                                  ? `${userType === "individual" ? "เงินเหลือที่มีจ่ายไหว" : "กำไรที่มีจ่ายไหว"} (${Math.round(diagnostic.operatingCashflow).toLocaleString()} บาท)`
                                  : `Affordable Cashflow (${Math.round(diagnostic.operatingCashflow).toLocaleString()})`}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="h-[190px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={paymentChartData} margin={{ top: 8, right: 10, left: 4, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="hsl(var(--border))" />
                              <XAxis dataKey="yearLabel" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                              <YAxis
                                domain={[0, chartYAxisMax || "auto"]}
                                tick={{ fontSize: 10 }}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(v: number) =>
                                  lang === "th"
                                    ? v >= 1_000_000
                                      ? `${(v / 1_000_000).toFixed(1)} ล้าน`
                                      : `${Math.round(v / 1000).toLocaleString()} พัน`
                                    : `${Math.round(v / 1000)}k`
                                }
                              />
                              {diagnostic.operatingCashflow > 0 && (
                                <ReferenceLine
                                  y={diagnostic.operatingCashflow}
                                  stroke="#d97706"
                                  strokeDasharray="4 4"
                                  strokeWidth={1.8}
                                />
                              )}
                              <Tooltip
                                formatter={(value: number, name: string) => [
                                  `${Math.round(value).toLocaleString()} ${lang === "th" ? "บาท/เดือน" : "THB/mo"}`,
                                  name,
                                ]}
                                contentStyle={{
                                  backgroundColor: "hsl(var(--background))",
                                  border: "1px solid hsl(var(--border))",
                                  borderRadius: "0.75rem",
                                  fontSize: "11px",
                                }}
                              />
                              <Bar
                                dataKey="originalPayment"
                                name={lang === "th" ? "ค่างวดสัญญาเดิม" : "Original Payment"}
                                fill="#94a3b8"
                                radius={[4, 4, 0, 0]}
                                barSize={18}
                              />
                              <Bar
                                dataKey="policyPayment"
                                name={lang === "th" ? "ค่างวดใหม่หลังปรับโครงสร้าง" : "Restructured Payment"}
                                fill="#0f766e"
                                radius={[4, 4, 0, 0]}
                                barSize={18}
                              />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>

                        {/* Clear Plain Thai Explanation of What the User Gains from this Simulation */}
                        <div className="mt-3 rounded-xl border border-teal-700/25 bg-teal-700/5 p-3 text-xs leading-5 text-foreground">
                          <p className="font-semibold text-teal-900">
                            {lang === "th"
                              ? `สิ่งที่${beneficiaryNounTh}ได้รับจากแผนปรับโครงสร้างนี้:`
                              : "Key Benefit of This Restructuring Plan:"}
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            {lang === "th"
                              ? diagnostic.netMonthlyCashflow < 0
                                ? `1. แก้ปัญหาเงินสดติดลบรายเดือน: เดิมมีเงินเหลือหลังหักค่าใช้จ่าย ${Math.round(diagnostic.operatingCashflow).toLocaleString()} บาท/เดือน แต่ต้องจ่ายค่างวดเดิม ${loanComparison.originalMonthlyPayment.toLocaleString()} บาท/เดือน (ทำให้เงินขาดมือ ${Math.abs(Math.round(diagnostic.netMonthlyCashflow)).toLocaleString()} บาททุกเดือน) เมื่อลดค่างวดปีแรกเหลือ ${loanComparison.policyYear1Payment.toLocaleString()} บาท/เดือน จะทำให้จ่ายหนี้ไหวและพลิกกลับมามีเงินเหลือ ${Math.round(diagnostic.operatingCashflow - loanComparison.policyYear1Payment).toLocaleString()} บาท/เดือน`
                                : `1. เพิ่มสภาพคล่องหมุนเวียนทันที: ลดภาระค่างวดปีแรกจาก ${loanComparison.originalMonthlyPayment.toLocaleString()} บาท เหลือ ${loanComparison.policyYear1Payment.toLocaleString()} บาท/เดือน ทำให้มีเงินสดเหลือในมือเพิ่มขึ้น +${loanComparison.monthlyLiquiditySaved.toLocaleString()} บาท/เดือน สำหรับสำรองรับ${lowSeasonPhraseTh}`
                              : `Reduces Year 1 monthly installment from ${loanComparison.originalMonthlyPayment.toLocaleString()} to ${loanComparison.policyYear1Payment.toLocaleString()} THB/mo, freeing +${loanComparison.monthlyLiquiditySaved.toLocaleString()} THB/mo in working capital.`}
                          </p>
                          <p className="mt-0.5 text-muted-foreground">
                            {lang === "th"
                              ? `2. ลดภาระดอกเบี้ยระยะยาว: ตลอดแผนช่วยประหยัดดอกเบี้ยรวมประมาณ ${loanComparison.totalInterestSaved.toLocaleString()} บาท (จากเงินต้นตั้งต้น ${loanComparison.principalUsed.toLocaleString()} บาท)`
                              : `Saves approximately ${loanComparison.totalInterestSaved.toLocaleString()} THB in cumulative interest over the plan horizon.`}
                          </p>
                          {debtStatus === "disaster" && (
                            <p className="mt-1 font-medium text-amber-900">
                              {lang === "th"
                                ? "3. คำแนะนำการเตรียมหลักฐาน: เตรียมหลักฐานแสดงผลกระทบหรือรายได้ที่ลดลง (เช่น บิลยอดขายย้อนหลัง รายการเดินบัญชี หรือภาพถ่ายพื้นที่ได้รับผลกระทบ) เพื่อประกอบการพิจารณาของธนาคาร"
                                : "3. Evidence Tip: Prepare proof of income drop or hazard impact (past sales bills, bank statements, or site photos) for bank consideration."}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                )}

                {/* 3. Actionable One Page Financial Dossier Preview & Print */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-foreground/20 bg-background p-4">
                  <div className="max-w-md">
                    <p className="text-xs font-semibold text-foreground">
                      {lang === "th"
                        ? "3. ใบสรุปความพร้อมทางการเงิน 1 หน้าสำหรับยื่นธนาคาร"
                        : "3. One Page Financial Readiness Dossier"}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                      {lang === "th"
                        ? "เปิดดูหน้าเอกสารสรุปความสามารถจ่ายหนี้ เงินสำรอง ผลจำลองเมื่อรายได้หดตัว และตารางเปรียบเทียบค่างวด พร้อมสั่งพิมพ์หรือบันทึกได้ทันที"
                        : "Preview and print your 1 page A4 financial summary with DSCR, runway, payment comparison table, and matched programs."}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={openDossierModal}
                      className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-foreground px-5 text-xs font-medium text-background transition-opacity hover:opacity-85"
                    >
                      <FileText aria-hidden="true" className="size-3.5" />
                      {lang === "th" ? "เปิดดูและพิมพ์ใบสรุป 1 หน้า" : "Preview & Print 1 Page Dossier"}
                    </button>
                  </div>
                </div>

                {/* 4. Matched Official Programs */}
                <div className="mt-4 space-y-2.5">
                  {matchedPrograms.map((prog) => (
                    <div key={prog.id} className="rounded-2xl border border-border bg-background p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="font-display text-sm font-semibold text-foreground">
                          {lang === "th" ? prog.title_th : prog.title_en}
                        </h4>
                        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-medium text-foreground">
                          {lang === "th" ? prog.badge_th : prog.badge_en}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs leading-5 text-foreground">
                        {lang === "th" ? prog.benefit_th : prog.benefit_en}
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                        <strong className="font-medium text-foreground">
                          {lang === "th" ? "เงื่อนไขสำคัญ:" : "Eligibility:"}
                        </strong>{" "}
                        {lang === "th" ? prog.criteria_th : prog.criteria_en}
                      </p>
                      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
                        <span className="text-[10px] text-muted-foreground">
                          {lang === "th" ? prog.source_th : prog.source_en}
                        </span>
                        <a
                          href={prog.action_href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-full bg-foreground px-3.5 py-1.5 text-[11px] font-medium text-background transition-opacity hover:opacity-85"
                        >
                          {lang === "th" ? prog.action_label_th : prog.action_label_en}
                          <ArrowUpRight aria-hidden="true" className="size-3.5" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 5. Grounded Policy Note from Backend RAG */}
                {result && (
                  <div className="mt-4 rounded-2xl border border-border bg-background p-4">
                    <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-foreground">
                      <BookOpenCheck aria-hidden="true" className="size-4" />
                      {lang === "th" ? "ข้อกำหนดอ้างอิงจากเอกสารทางการ" : "Grounded Policy Document Excerpt"}
                    </div>
                    <p className="whitespace-pre-line text-xs leading-6 text-muted-foreground">
                      {result.policy_guidance.answer_text}
                    </p>
                    {result.policy_guidance.citations?.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {result.policy_guidance.citations.slice(0, 3).map((c, idx) => {
                          const citeObj: CitationItem =
                            typeof c === "string" ? { doc_title: c, page_num: 1 } : c
                          const cleanTitle =
                            lang === "th"
                              ? (citeObj.doc_title ?? "เอกสารทางการ").replace(/\s*\(Responsible Lending\)/gi, "")
                              : citeObj.doc_title ?? "Official Document"
                          const label = `${cleanTitle}${citeObj.page_num ? ` (${lang === "th" ? "หน้า" : "p."} ${citeObj.page_num})` : ""}`
                          return (
                            <button
                              key={`${label}-${idx}`}
                              type="button"
                              onClick={() => void openCitationModal(citeObj)}
                              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-3 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-foreground/40 hover:bg-secondary"
                            >
                              <FileText aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
                              <span>{label}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Collapsible Checklist & Official Links at Bottom */}
            <div className="mt-4">
              <button
                type="button"
                aria-expanded={showSources}
                onClick={() => setShowSources((curr) => !curr)}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-border bg-background px-5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
              >
                <FileCheck2 aria-hidden="true" className="size-3.5" />
                {lang === "th"
                  ? "ดูรายการเอกสารที่ต้องเตรียม สายด่วน และลิงก์โครงการทางการ"
                  : "View Checklist, Official Hotlines & Program Links"}
                <ChevronDown
                  aria-hidden="true"
                  className={`size-4 transition-transform ${showSources ? "rotate-180" : ""}`}
                />
              </button>
              {showSources && (
                <div className="mt-2.5 space-y-3 rounded-2xl border border-border bg-background p-4">
                  <div>
                    <h4 className="font-display text-xs font-semibold text-foreground">
                      {lang === "th" ? "เอกสารที่ควรเตรียมก่อนติดต่อธนาคาร" : "Preparation Checklist"}
                    </h4>
                    <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                      {checklist.map((doc) => (
                        <li key={doc} className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                          <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-foreground/70" />
                          <span>{doc}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                      <PhoneCall aria-hidden="true" className="size-3.5" />
                      {lang === "th" ? "สายด่วนทางการ:" : "Official Hotlines:"}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      <a href="tel:1213" className="rounded-full border border-border px-2.5 py-1 text-[10px] font-medium hover:bg-secondary">
                        {lang === "th" ? "1213 (ศูนย์คุ้มครองฯ)" : "1213 (Consumer)"}
                      </a>
                      <a href="tel:1357" className="rounded-full border border-border px-2.5 py-1 text-[10px] font-medium hover:bg-secondary">
                        {lang === "th" ? "1357 (ธพว.)" : "1357 (SME D Bank)"}
                      </a>
                      <a href="tel:028909999" className="rounded-full border border-border px-2.5 py-1 text-[10px] font-medium hover:bg-secondary">
                        {lang === "th" ? "02-890-9999 (บสย.)" : "02-890-9999 (TCG)"}
                      </a>
                      <a href="tel:1443" className="rounded-full border border-border px-2.5 py-1 text-[10px] font-medium hover:bg-secondary">
                        {lang === "th" ? "1443 (คลินิกแก้หนี้)" : "1443 (Debt Clinic)"}
                      </a>
                    </div>
                  </div>

                  <div className="grid gap-1.5 border-t border-border pt-2.5 sm:grid-cols-2">
                    {OFFICIAL_SOURCES.map((source) => (
                      <a
                        key={source.href}
                        href={source.href}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      >
                        <span>{lang === "th" ? source.label_th : source.label_en}</span>
                        <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Modal 1 In App One Page Financial Readiness Dossier Preview matching Staff Executive Memo */}
      <dialog
        ref={dossierDialogRef}
        aria-labelledby="dossier-modal-title"
        className="m-auto w-[calc(100%-2rem)] max-w-4xl rounded-3xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/55 backdrop:backdrop-blur-sm"
      >
        <div className="p-6 sm:p-8">
          <div className="mb-5 flex items-center justify-between border-b border-border pb-4">
            <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <FileText aria-hidden="true" className="size-4" />
              {lang === "th"
                ? "ตัวอย่างเอกสารประกอบคำขอปรับปรุงโครงสร้างหนี้"
                : "Bank Submission Document Preview"}
            </span>
            <button
              type="button"
              onClick={() => dossierDialogRef.current?.close()}
              aria-label="Close dossier preview"
              className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
            </button>
          </div>

          {diagnostic && (
            <>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {lang === "th"
                  ? "เอกสารประกอบคำขอปรับปรุงโครงสร้างหนี้และพิจารณาสินเชื่อ"
                  : "Debt Restructuring & Credit Assessment Summary"} ·{" "}
                {lang === "th" ? `จังหวัด${selectedProvName}` : selectedProvName} ·{" "}
                {userType === "individual"
                  ? lang === "th"
                    ? "บุคคลทั่วไป"
                    : "Individual"
                  : BUSINESS_OPTIONS.find((b) => b.id === business)?.[lang === "th" ? "th" : "en"] || business}
              </p>
              <h2
                id="dossier-modal-title"
                className="mt-1.5 font-display text-xl font-semibold leading-snug tracking-tight sm:text-2xl"
              >
                {lang === "th"
                  ? "เอกสารสรุปข้อมูลทางการเงินและแผนการชำระหนี้"
                  : "Financial Summary & Proposed Repayment Schedule"}
              </h2>

              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-xl border border-border bg-secondary/25 px-3.5 py-2.5">
                  <p className="text-[10px] text-muted-foreground">
                    {lang === "th" ? "รายได้ต่อเดือน / กำไรก่อนจ่ายหนี้" : "Monthly Revenue / Operating Profit"}
                  </p>
                  <p className="mt-1 font-display text-base font-semibold tabular-nums text-foreground">
                    {Math.round(diagnostic.monthlyRevenue).toLocaleString()} {lang === "th" ? "บาท" : "THB"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {lang === "th"
                      ? `กำไรก่อนหนี้ ${Math.round(diagnostic.operatingCashflow).toLocaleString()} บาท/เดือน`
                      : `Operating profit ${Math.round(diagnostic.operatingCashflow).toLocaleString()} THB/mo`}
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-secondary/25 px-3.5 py-2.5">
                  <p className="text-[10px] text-muted-foreground">
                    {lang === "th" ? "ค่างวดหนี้เดิมต่อเดือน" : "Current Monthly Installment"}
                  </p>
                  <p className="mt-1 font-display text-base font-semibold tabular-nums text-foreground">
                    {Math.round(diagnostic.monthlyDebt).toLocaleString()} {lang === "th" ? "บาท" : "THB"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {lang === "th"
                      ? `สัดส่วนหนี้ต่อรายได้ ${diagnostic.dsrPct.toFixed(1)}%`
                      : `Debt to income ${diagnostic.dsrPct.toFixed(1)}%`}
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-secondary/25 px-3.5 py-2.5">
                  <p className="text-[10px] text-muted-foreground">
                    {lang === "th" ? "สถานะเงินเหลือหลังหักค่างวด" : "Net Monthly Cash Status"}
                  </p>
                  <p
                    className={`mt-1 font-display text-sm font-semibold tabular-nums ${
                      diagnostic.netMonthlyCashflow < 0 ? "text-red-700" : "text-teal-700"
                    }`}
                  >
                    {diagnostic.netMonthlyCashflow >= 0
                      ? lang === "th"
                        ? `เงินเหลือพอจ่าย (+${Math.round(diagnostic.netMonthlyCashflow).toLocaleString()} บาท/เดือน)`
                        : `Surplus (+${Math.round(diagnostic.netMonthlyCashflow).toLocaleString()}/mo)`
                      : lang === "th"
                        ? `เงินเหลือไม่พอจ่าย (ขาดอีก ${Math.abs(Math.round(diagnostic.netMonthlyCashflow)).toLocaleString()} บาท/เดือน)`
                        : `Shortfall (-${Math.abs(Math.round(diagnostic.netMonthlyCashflow)).toLocaleString()}/mo)`}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {lang === "th" ? "คำนวณจากรายได้หักค่าใช้จ่ายและค่างวด" : "Income minus expenses and debt"}
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-secondary/25 px-3.5 py-2.5">
                  <p className="text-[10px] text-muted-foreground">
                    {lang === "th" ? "เงินเก็บอยู่ได้นาน (กรณีรายได้ 0)" : "Zero Income Runway"}
                  </p>
                  <p className="mt-1 font-display text-base font-semibold tabular-nums text-foreground">
                    {diagnostic.runwayTotalMonths != null
                      ? `${diagnostic.runwayTotalMonths.toFixed(1)} ${lang === "th" ? "เดือน" : "months"}`
                      : "—"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {lang === "th"
                      ? `เงินเก็บสำรอง ${Math.round(diagnostic.cashReserve).toLocaleString()} บาท`
                      : `Reserve ${Math.round(diagnostic.cashReserve).toLocaleString()} THB`}
                  </p>
                </div>
              </div>

              {loanComparison && (
                <div className="mt-4 rounded-2xl border border-border bg-secondary/35 p-4 text-xs leading-6">
                  <p className="font-semibold text-foreground">
                    {lang === "th"
                      ? `1. ข้อเสนอแนวทางปรับโครงสร้างหนี้: ${loanComparison.policyTitleTh}`
                      : `1. Proposed Restructuring Plan: ${loanComparison.policyTitleEn}`}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {lang === "th"
                      ? `ขอปรับลดภาระค่างวดปีที่ 1 จาก ${loanComparison.originalMonthlyPayment.toLocaleString()} บาท/เดือน เหลือ ${loanComparison.policyYear1Payment.toLocaleString()} บาท/เดือน เพื่อให้สอดคล้องกับกำไรจากการดำเนินงานจริง (${Math.round(diagnostic.operatingCashflow).toLocaleString()} บาท/เดือน) ช่วยเพิ่มสภาพคล่องหมุนเวียน +${loanComparison.monthlyLiquiditySaved.toLocaleString()} บาท/เดือน และประหยัดดอกเบี้ยจ่ายจริงเทียบสัญญาเดิมประมาณ ${loanComparison.totalInterestSaved.toLocaleString()} บาท${loanComparison.grossWaivedInterest ? ` (คิดเป็นมูลค่าดอกเบี้ยที่โครงการยกเว้นให้ในช่วงพักชำระ 3 ปีแรกประมาณ ${loanComparison.grossWaivedInterest.toLocaleString()} บาท)` : ""}${loanComparison.payoffMonthPol ? ` โดยสามารถปิดจบหนี้ได้เสร็จสิ้นภายในสิ้นปีที่ ${Math.ceil(loanComparison.payoffMonthPol / 12)} ทำให้ปีถัดไปไม่มีภาระค่างวดอีกต่อไป (0 บาท)` : ""}`
                      : `Reduces Year 1 monthly payment from ${loanComparison.originalMonthlyPayment.toLocaleString()} to ${loanComparison.policyYear1Payment.toLocaleString()} THB/mo, freeing +${loanComparison.monthlyLiquiditySaved.toLocaleString()} THB/mo in liquidity and saving approx. ${loanComparison.totalInterestSaved.toLocaleString()} THB in net interest${loanComparison.grossWaivedInterest ? ` (~${loanComparison.grossWaivedInterest.toLocaleString()} THB gross interest waived during the freeze)` : ""}${loanComparison.payoffMonthPol ? `. The loan is fully amortized by Year ${Math.ceil(loanComparison.payoffMonthPol / 12)}, with 0 THB installment thereafter.` : "."}`}
                  </p>
                </div>
              )}

              {loanComparison && (
                <div className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {lang === "th"
                      ? `2. ตารางเปรียบเทียบยอดหนี้คงเหลือและค่างวดรายปี (${horizonYears} ปี)`
                      : `2. ${horizonYears} Year Balance & Monthly Installment Schedule`}
                  </h3>
                  <div className="mt-2 overflow-x-auto rounded-2xl border border-border">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-secondary/60 text-[11px] text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">{lang === "th" ? "ปีที่" : "Year"}</th>
                          <th className="px-3 py-2 text-right font-medium">
                            {lang === "th" ? "ค่างวดสัญญาเดิม/เดือน" : "Original Payment/mo"}
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            {lang === "th" ? "ค่างวดใหม่หลังปรับ/เดือน" : "Proposed Payment/mo"}
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            {lang === "th" ? "เงินต้นคงเหลือ (สัญญาเดิม)" : "Original Balance"}
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            {lang === "th" ? "เงินต้นคงเหลือ (แผนใหม่)" : "Proposed Balance"}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {loanComparison.points.map((pt) => (
                          <tr key={pt.yearNum}>
                            <td className="px-3 py-2 font-medium">{pt.yearLabel}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {Math.round(pt.originalPayment).toLocaleString()} {lang === "th" ? "บาท" : "THB"}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums text-teal-800">
                              {Math.round(pt.policyPayment).toLocaleString()} {lang === "th" ? "บาท" : "THB"}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {Math.round(pt.originalBalance).toLocaleString()} {lang === "th" ? "บาท" : "THB"}
                            </td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums">
                              {Math.round(pt.policyBalance).toLocaleString()} {lang === "th" ? "บาท" : "THB"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {lang === "th"
                    ? "3. มาตรการทางการที่เข้าเกณฑ์และเอกสารประกอบการยื่น"
                    : "3. Matched Official Programs & Required Documents"}
                </h3>
                <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
                  {matchedPrograms.map((p) => (
                    <div key={p.id} className="rounded-xl border border-border bg-secondary/20 px-3.5 py-2.5 text-xs">
                      <p className="font-semibold text-foreground">{lang === "th" ? p.title_th : p.title_en}</p>
                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                        {lang === "th" ? p.benefit_th : p.benefit_en}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={handlePrintDossier}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-foreground px-5 text-xs font-medium text-background hover:opacity-85"
            >
              <Printer aria-hidden="true" className="size-3.5" />
              {lang === "th" ? "สั่งพิมพ์ / บันทึกเป็นไฟล์ PDF 1 หน้า" : "Print / Save 1 Page PDF"}
            </button>
          </div>
        </div>
      </dialog>

      {/* Modal 2 In App Official Policy Document Page Viewer */}
      <dialog
        ref={docPageDialogRef}
        aria-labelledby="doc-page-modal-title"
        className="m-auto w-[calc(100%-2rem)] max-w-3xl rounded-3xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/55 backdrop:backdrop-blur-sm"
      >
        <div className="p-6 sm:p-8">
          <div className="mb-4 flex items-center justify-between border-b border-border pb-4">
            <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <BookOpenCheck aria-hidden="true" className="size-4" />
              {lang === "th"
                ? "เนื้อหาต้นฉบับจากคลังเอกสารทางการ"
                : "Verified Official Policy Document Excerpt"}
            </span>
            <button
              type="button"
              onClick={() => docPageDialogRef.current?.close()}
              aria-label="Close document page viewer"
              className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
            </button>
          </div>

          {activeDocPage && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {lang === "th"
                    ? `หน้าที่ ${activeDocPage.pageNum}${activeDocPage.totalPages ? ` จากทั้งหมด ${activeDocPage.totalPages} หน้าที่มีในคลัง` : ""}`
                    : `Page ${activeDocPage.pageNum}${activeDocPage.totalPages ? ` (${activeDocPage.totalPages} indexed pages)` : ""}`}
                </p>
                {result?.policy_guidance.citations && result.policy_guidance.citations.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {result.policy_guidance.citations.slice(0, 4).map((c, idx) => {
                      const cObj: CitationItem = typeof c === "string" ? { doc_title: c, page_num: 1 } : c
                      const isCurrent =
                        cObj.doc_title === activeDocPage.docTitle && Number(cObj.page_num) === activeDocPage.pageNum
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => void openCitationModal(cObj)}
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                            isCurrent
                              ? "bg-foreground text-background"
                              : "border border-border bg-secondary/50 text-foreground hover:bg-secondary"
                          }`}
                        >
                          {lang === "th" ? `หน้า ${cObj.page_num}` : `p. ${cObj.page_num}`}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <h2
                id="doc-page-modal-title"
                className="mt-1.5 font-display text-lg font-semibold leading-snug tracking-tight sm:text-xl"
              >
                {lang === "th"
                  ? activeDocPage.docTitle.replace(/\s*\(Responsible Lending\)/gi, "")
                  : activeDocPage.docTitle}
              </h2>

              <div className="mt-4 max-h-[380px] overflow-y-auto rounded-2xl border border-border bg-secondary/30 p-4 sm:p-5">
                {activeDocPage.loading ? (
                  <div className="flex h-32 items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                    <span>{lang === "th" ? "กำลังดึงข้อความต้นฉบับจากหน้าเอกสาร…" : "Loading verbatim page text…"}</span>
                  </div>
                ) : activeDocPage.fullText ? (
                  <div className="space-y-3 whitespace-pre-line text-xs leading-6 text-foreground">
                    {activeDocPage.fullText}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {lang === "th"
                      ? "ไม่พบข้อความแยกย่อหน้าของหน้านี้ สามารถกดเปิดไฟล์เอกสารต้นฉบับด้านล่างได้โดยตรง"
                      : "Page excerpt unavailable; open the official PDF below."}
                  </p>
                )}
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                <span className="text-[11px] text-muted-foreground">
                  {lang === "th"
                    ? "ข้อความดึงตรงจากไฟล์เอกสารทางการในฐานข้อมูลโดยไม่มีการดัดแปลง"
                    : "Verbatim text extracted directly from indexed official PDF pages."}
                </span>
                {activeDocPage.docUrl && (
                  <a
                    href={`${activeDocPage.docUrl}#page=${activeDocPage.pageNum}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground px-4 text-xs font-medium text-background hover:opacity-85"
                  >
                    <span>
                      {lang === "th"
                        ? `เปิดไฟล์เอกสารต้นฉบับ (หน้า ${activeDocPage.pageNum})`
                        : `Open Official PDF (p. ${activeDocPage.pageNum})`}
                    </span>
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </dialog>
    </section>
  )
}

function SimBox({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-secondary/50 p-3">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-display text-base font-semibold tabular-nums sm:text-lg ${
          accent ? "text-teal-700" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  )
}
