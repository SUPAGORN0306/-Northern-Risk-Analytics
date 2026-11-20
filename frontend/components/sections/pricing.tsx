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
  parseStatementCsv,
  SAMPLE_STATEMENT_CSV,
  type DebtStatusKey,
  type ParsedCsvSummary,
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
    th: "รายได้สะดุดจากภัยพิบัติ / มลพิษน้ำ / ฝุ่น",
    en: "Disrupted by flood, water pollution, or haze",
    sub_th: "กิจการหรือรายได้ในพื้นที่ได้รับผลกระทบโดยตรง",
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
      criteria_th: "สินเชื่อบ้าน รถ หรือธุรกิจขนาดเล็ก ที่ค้างชำระ 31 ถึง 365 วัน (ติดต่อธนาคารเจ้าหนี้เดิมหรือสอบถามสายด่วน 1213)",
      criteria_en: "Home, auto, or small SME loans overdue 31 to 365 days (contact your lender or call 1213).",
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
      criteria_th: "ผู้ประกอบการและลูกหนี้ที่รายได้ลดลงจากอุทกภัย ฝุ่นละออง หรือวิกฤตมลพิษทางน้ำในพื้นที่ภาคเหนือ",
      criteria_en: "SMEs and borrowers with documented revenue loss from floods, haze, or river water contamination.",
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

type PresetKey = "sample_csv" | "sme_tight" | "khunsoo_sme" | "disaster_cr" | "custom_csv" | null

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
  const [business, setBusiness] = useState("hotel")
  const [debtStatus, setDebtStatus] = useState<DebtStatusKey>("current")
  const [revenue, setRevenue] = useState("")
  const [opex, setOpex] = useState("")
  const [debtPayment, setDebtPayment] = useState("")
  const [cashReserve, setCashReserve] = useState("")
  const [totalPrincipal, setTotalPrincipal] = useState("")
  const [deferMonths, setDeferMonths] = useState(6)
  const [stressDropPct, setStressDropPct] = useState(30)

  const [hasEvaluated, setHasEvaluated] = useState(false)
  const [csvImportNote, setCsvImportNote] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [result, setResult] = useState<ReliefCheckResponse | null>(null)
  const [showSources, setShowSources] = useState(false)

  const isSme = business !== "household"

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
  const numOpex = isSme ? Math.max(0, Number(opex) || 0) : 0
  const numDebt = Math.max(0, Number(debtPayment) || 0)
  const numReserve = Math.max(0, Number(cashReserve) || 0)
  const numPrincipal = Math.max(0, Number(totalPrincipal) || 0)
  const hasAnyInput = Boolean(
    revenue.trim() || opex.trim() || debtPayment.trim() || cashReserve.trim() || totalPrincipal.trim() || activePreset,
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
    setHasEvaluated(false)
    setCsvImportNote(null)
    setApiError(null)
    setResult(null)
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
      clinicMonths: 84,
      deferMonths,
      lang,
    })
  }, [debtStatus, isSme, numRevenue, numDebt, numPrincipal, deferMonths, lang])

  // Yearly installment comparison bars so users clearly see monthly payment dropping below affordable operating profit
  const paymentChartData = useMemo(() => {
    if (!loanComparison || !diagnostic) return []
    return loanComparison.points
      .filter((pt) => pt.yearNum >= 1 && pt.yearNum <= 5)
      .map((pt) => ({
        yearLabel: pt.yearLabel,
        originalPayment: pt.originalPayment,
        policyPayment: pt.policyPayment,
        affordableProfit: Math.max(0, diagnostic.operatingCashflow),
        originalBalance: pt.originalBalance,
        policyBalance: pt.policyBalance,
      }))
  }, [loanComparison, diagnostic])

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
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Relief check failed")
    } finally {
      setSubmitting(false)
    }
  }

  function applyParsedCsv(parsed: ParsedCsvSummary, sourceLabel: string, presetTag: PresetKey, provOverride?: string) {
    const targetProv = provOverride || selectedProvinceCode
    const estPrin = Math.round(parsed.avgMonthlyDebt * 45)
    if (provOverride) {
      setSelectedProvinceCode(provOverride)
    }
    setActivePreset(presetTag)
    setBusiness("hotel")
    setDebtStatus("current")
    setRevenue(String(parsed.avgMonthlyRevenue))
    setOpex(String(parsed.avgMonthlyOpex))
    setDebtPayment(String(parsed.avgMonthlyDebt))
    setCashReserve(String(parsed.estimatedCashReserve))
    setTotalPrincipal(String(estPrin))
    setCsvImportNote(
      lang === "th"
        ? `ดึงยอดเฉลี่ยจากรายการเดินบัญชี (${parsed.rowCount} รายการ ย้อนหลัง ${parsed.monthsDetected} เดือน) เรียบร้อย · คุณปรับแก้ตัวเลขในช่องด้านล่างเพิ่มเติมได้ทันที`
        : `Loaded averages from ${sourceLabel} (${parsed.rowCount} rows over ${parsed.monthsDetected} months). You can freely edit any field below.`,
    )
    void runBackendAssessment({
      prov: targetProv,
      biz: "hotel",
      statusKey: "current",
      revVal: parsed.avgMonthlyRevenue,
      debtVal: parsed.avgMonthlyDebt,
    })
  }

  function handleCsvFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : ""
      const parsed = parseStatementCsv(text)
      if (!parsed) {
        setApiError(
          lang === "th"
            ? "ไม่พบคอลัมน์รายรับหรือรายจ่ายในไฟล์ตาราง กรุณาดาวน์โหลดไฟล์ตารางตัวอย่างเพื่อดูรูปแบบ"
            : "Could not detect income/expense columns. Please download the sample template.",
        )
        return
      }
      applyParsedCsv(parsed, file.name, "custom_csv")
    }
    reader.readAsText(file, "utf-8")
    e.target.value = ""
  }

  function loadSampleStatement() {
    const parsed = parseStatementCsv(SAMPLE_STATEMENT_CSV)
    if (parsed) {
      setSelectedProvinceCode("CR")
      applyParsedCsv(
        parsed,
        lang === "th" ? "บัญชีรายรับรายจ่ายตัวอย่าง (โรงแรมและร้านกาแฟ เชียงราย)" : "Sample Chiang Rai Hotel CSV",
        "sample_csv",
        "CR",
      )
    }
  }

  function downloadSampleCsv() {
    const blob = new Blob(["\uFEFF" + SAMPLE_STATEMENT_CSV], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "northrisk_sample_statement.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  function applyPreset(preset: "sme_tight" | "khunsoo_sme" | "disaster_cr") {
    setActivePreset(preset)
    setApiError(null)
    setCsvImportNote(null)
    if (preset === "sme_tight") {
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
          "รายการเดินบัญชีย้อนหลัง 6 เดือน แสดงรายรับและรายจ่ายของกิจการ",
          "ใบแจ้งยอดหนี้คงเหลือและตารางค่างวดล่าสุดของสถาบันการเงินเจ้าหนี้",
          "หลักฐานรายได้ลดลงตามฤดูกาลหรือผลกระทบจากน้ำท่วม ฝุ่น หรือมลพิษทางน้ำในพื้นที่ (ถ้ามี)",
          "ใบสรุปความพร้อมทางการเงิน 1 หน้า (สั่งพิมพ์จากระบบนี้เพื่อถือไปยื่นประกอบการพูดคุย)",
        ]
      : [
          "6 month bank statements showing business cash inflows and fixed expenses",
          "Latest loan statements and installment schedules from your lenders",
          "Evidence of seasonal drop or regional hazard/water pollution impact (if applicable)",
          "One page Financial Readiness Dossier printed from this tool",
        ]

  return (
    <section
      ref={ref}
      id="relief-assistant"
      aria-labelledby="relief-heading"
      className="scroll-target px-4 py-16 sm:px-8 md:py-20"
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
              {lang === "th" ? "ประเมินสุขภาพการเงินและแผนปรับโครงสร้างหนี้ผู้ประกอบการ" : "SME Financial Health & Restructuring Simulator"}
            </p>
            <h2
              id="relief-heading"
              className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
            >
              {lang === "th"
                ? "ตรวจสุขภาพการเงิน จำลองค่างวด และสร้างใบสรุปยื่นธนาคาร"
                : "Diagnose Cashflow, Simulate Relief & Export 1 Page Dossier"}
            </h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            {lang === "th"
              ? "คำนวณความสามารถในการจ่ายหนี้จากกำไร ระยะเวลาที่เงินสำรองอยู่รอดได้ และผลกระทบเมื่อรายได้หดตัว พร้อมเปรียบเทียบค่างวดเดิมกับค่างวดใหม่เพื่อใช้ยื่นเจรจากับธนาคาร"
              : "Evaluate DSCR, liquidity runway, and seasonal stress impact alongside policy aligned payment comparisons and a printable 1 page lender dossier."}
          </p>
        </motion.div>

        {/* Single Unified Quick Action Bar with Dynamic Active Highlight */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Sparkles aria-hidden="true" className="size-3.5" />
              {lang === "th" ? "ลองกดดูผลวิเคราะห์ตัวอย่างทันที:" : "Instant live examples:"}
            </span>
            {(
              [
                {
                  key: "sample_csv" as const,
                  th: "บัญชีรายรับรายจ่ายโรงแรมเชียงราย",
                  en: "Chiang Rai Hotel CSV",
                  onClick: loadSampleStatement,
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

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvFileUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                activePreset === "custom_csv"
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-secondary/60 text-foreground hover:bg-secondary"
              }`}
            >
              <Upload aria-hidden="true" className="size-3" />
              {lang === "th" ? "นำเข้าไฟล์ตารางบัญชีของคุณ" : "Upload Your CSV"}
            </button>
            <button
              type="button"
              onClick={downloadSampleCsv}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <Download aria-hidden="true" className="size-3" />
              {lang === "th" ? "ดาวน์โหลดตารางตัวอย่าง" : "CSV Template"}
            </button>
            {hasAnyInput && (
              <button
                type="button"
                onClick={resetAllInputs}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <RotateCcw aria-hidden="true" className="size-3" />
                {lang === "th" ? "ล้างข้อมูล" : "Clear"}
              </button>
            )}
          </div>
        </div>

        {csvImportNote && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-700/25 bg-emerald-700/10 px-4 py-2 text-xs font-medium text-emerald-900">
            <ShieldCheck aria-hidden="true" className="size-4 shrink-0" />
            <span>{csvImportNote}</span>
          </div>
        )}

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
              {selectedProvData?.has_active_water_pollution ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-600/35 bg-amber-500/15 px-2.5 py-1 text-[10px] font-medium text-amber-900">
                  <AlertTriangle aria-hidden="true" className="size-3" />
                  {lang === "th" ? "พื้นที่เฝ้าระวังสารพิษน้ำ" : "Water Alert"}
                </span>
              ) : selectedProvData?.vulnerability_tier ? (
                <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-medium text-foreground">
                  {lang === "th" ? selectedProvData.tier_short_th : selectedProvData.tier_short_en}
                </span>
              ) : null}
            </div>

            <div className="flex flex-col gap-3.5">
              {/* Step A Core Numbers First so User Sees Them Immediately */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="monthly-revenue" className="mb-1 block text-xs font-medium text-foreground">
                    {lang === "th" ? "รายได้รวมต่อเดือน *" : "Monthly Revenue *"}
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

              <div className={`grid gap-3 ${isSme ? "grid-cols-2" : "grid-cols-1"}`}>
                {isSme && (
                  <div>
                    <label htmlFor="monthly-opex" className="mb-1 block text-xs font-medium text-foreground">
                      {lang === "th" ? "รายจ่ายดำเนินงานคงที่/เดือน" : "Fixed Operating Cost/mo"}
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
                        placeholder={lang === "th" ? "กรอกรายจ่ายคงที่" : "Enter fixed costs"}
                        className="h-10 w-full rounded-xl border border-input bg-background px-3 pr-11 text-sm text-foreground outline-none transition placeholder:text-xs placeholder:text-muted-foreground/60 focus:border-foreground/45 focus:ring-2 focus:ring-foreground/10"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                        {lang === "th" ? "บาท" : "THB"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {lang === "th" ? "ค่าเช่า ค่าจ้าง ค่าน้ำไฟ วัตถุดิบ" : "Rent, payroll, utilities"}
                    </p>
                  </div>
                )}
                <div>
                  <label htmlFor="cash-reserve" className="mb-1 block text-xs font-medium text-foreground">
                    {lang === "th" ? (isSme ? "เงินสดสำรองกิจการที่มี" : "เงินออมสำรองฉุกเฉิน") : "Liquid Cash Reserve"}
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
                <div>
                  <label htmlFor="total-principal" className="mb-1 block text-xs font-medium text-foreground">
                    {lang === "th" ? "ยอดเงินต้นหนี้คงเหลือรวม (ไม่บังคับ · ใช้คำนวณดอกเบี้ยที่ประหยัดได้)" : "Total Debt Principal (Optional)"}
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
                      placeholder={lang === "th" ? "กรอกยอดเงินต้นคงเหลือรวม" : "Enter total principal"}
                      className="h-9 w-full rounded-xl border border-input bg-background px-3 pr-11 text-sm text-foreground outline-none transition placeholder:text-xs placeholder:text-muted-foreground/60 focus:border-foreground/45 focus:ring-2 focus:ring-foreground/10"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                      {lang === "th" ? "บาท" : "THB"}
                    </span>
                  </div>
                </div>
              )}

              {/* Step B Province & Profile Selector */}
              <div className="grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="province" className="mb-1 block text-xs font-medium text-foreground">
                    {lang === "th" ? "จังหวัดที่ตั้งกิจการ" : "Northern Province"}
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

                <div>
                  <label htmlFor="business-type" className="mb-1 block text-xs font-medium text-foreground">
                    {lang === "th" ? "ประเภทกิจการ" : "Profile Type"}
                  </label>
                  <div className="relative">
                    <select
                      id="business-type"
                      value={business}
                      onChange={(e) => setBusiness(e.target.value)}
                      className="h-9 w-full appearance-none rounded-xl border border-input bg-background bg-none px-3 pr-8 text-xs font-medium text-foreground outline-none transition focus:border-foreground/45"
                    >
                      {BUSINESS_OPTIONS.map((b) => (
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
              </div>

              {/* Step C Compact Repayment Status Grid */}
              <fieldset>
                <legend className="mb-1.5 text-xs font-medium text-foreground">
                  {lang === "th"
                    ? "สถานะการผ่อนชำระของคุณในปัจจุบัน (คลิกเลือกเพื่อดูทางออกที่ตรงเกณฑ์ทางขวา)"
                    : "Your Current Repayment Status (Select to match solutions on the right)"}
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
                      <span>{lang === "th" ? "กำลังอัปเดตผลวิเคราะห์ทางขวา…" : "Updating diagnostic…"}</span>
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
                          ? "กรอกรายได้และค่างวดด้านบนเพื่อแสดงผลวิเคราะห์ทางขวาอัตโนมัติ"
                          : "Enter revenue and payment above to see instant analysis"}
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
                    {lang === "th" ? "ผลวิเคราะห์จะแสดงที่ฝั่งขวานี้ทันที" : "Live Diagnostic Appears Here"}
                  </span>
                  <h3 className="mt-3.5 font-display text-lg font-semibold text-foreground sm:text-xl">
                    {lang === "th"
                      ? "กรอกตัวเลขทางซ้าย หรือกดปุ่มตัวอย่างด้านบนเพื่อดูผลวิเคราะห์จริง"
                      : "Enter figures on the left or click any instant example button above"}
                  </h3>
                  <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
                    {lang === "th"
                      ? "เมื่อกดคำนวณ ฝั่งขวานี้จะแสดงความสามารถในการจ่ายหนี้จากกำไร ระยะเวลาที่เงินสำรองอยู่รอดได้ ผลจำลองเมื่อรายได้หดตัว กราฟเปรียบเทียบค่างวดเดิมกับค่างวดใหม่ และปุ่มพิมพ์ใบสรุป 1 หน้าสำหรับถือไปเจรจากับธนาคาร"
                      : "Displays DSCR, liquidity runway, low season stress impact, payment comparison charts, and a 1 page printable dossier."}
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
                        {BUSINESS_OPTIONS.find((b) => b.id === business)?.[lang === "th" ? "th" : "en"]}
                      </h3>
                    </div>
                    <span
                      className={`rounded-full border px-3 py-1 text-[11px] font-medium ${
                        diagnostic.isSme
                          ? diagnostic.dscrStatus === "safe"
                            ? "border-emerald-700/25 bg-emerald-700/10 text-emerald-800"
                            : diagnostic.dscrStatus === "tight"
                              ? "border-amber-600/30 bg-amber-500/10 text-amber-900"
                              : "border-red-600/30 bg-red-500/10 text-red-800"
                          : diagnostic.dsrPct < 40
                            ? "border-emerald-700/25 bg-emerald-700/10 text-emerald-800"
                            : "border-amber-600/30 bg-amber-500/10 text-amber-900"
                      }`}
                    >
                      {diagnostic.isSme
                        ? diagnostic.dscrStatus === "safe"
                          ? lang === "th"
                            ? "กำไรเพียงพอจ่ายหนี้ตามเกณฑ์ธนาคาร (เกิน 1.25 เท่า)"
                            : "Healthy DSCR (>1.25x)"
                          : diagnostic.dscrStatus === "tight"
                            ? lang === "th"
                              ? "กำไรเริ่มตึงตัว (1.00 ถึง 1.24 เท่าของค่างวด)"
                              : "Tight DSCR (1.00 to 1.24x)"
                            : lang === "th"
                              ? "กำไรไม่พอจ่ายค่างวด (ต่ำกว่า 1.0 เท่า) · ควรปรับโครงสร้างหนี้"
                              : "Critical DSCR (<1.0x)"
                        : result
                          ? translateDsrBand(result.dsr_assessment.band, lang)
                          : `${lang === "th" ? "สัดส่วนหนี้" : "DSR"} ${diagnostic.dsrPct}%`}
                    </span>
                  </div>

                  <div className="mt-3.5 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-border bg-secondary/35 p-3.5">
                      <p className="text-[10px] text-muted-foreground">
                        {diagnostic.isSme
                          ? lang === "th"
                            ? "ความสามารถจ่ายหนี้จากกำไร"
                            : "DSCR (Operating CF / Debt)"
                          : lang === "th"
                            ? "สัดส่วนค่างวดหนี้ต่อรายได้"
                            : "Debt Service Ratio (DSR)"}
                      </p>
                      <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">
                        {diagnostic.isSme
                          ? diagnostic.dscr != null
                            ? `${diagnostic.dscr.toFixed(2)} ${lang === "th" ? "เท่า" : "x"}`
                            : "—"
                          : `${diagnostic.dsrPct.toFixed(1)}%`}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {diagnostic.isSme
                          ? lang === "th"
                            ? `เกณฑ์ปลอดภัย > 1.25 เท่า · ค่างวดคิดเป็น ${diagnostic.dsrPct.toFixed(1)}% ของรายได้`
                            : `Bank safe >1.25x · DSR ${diagnostic.dsrPct.toFixed(1)}%`
                          : lang === "th"
                            ? "เกณฑ์ปลอดภัยไม่เกิน 40% ของรายได้"
                            : "Safe ceiling <= 40%"}
                      </p>
                    </div>

                    <div className="rounded-xl border border-border bg-secondary/35 p-3.5">
                      <p className="text-[10px] text-muted-foreground">
                        {lang === "th" ? "เงินสำรองอยู่รอดได้นาน" : "Liquidity Runway"}
                      </p>
                      <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">
                        {diagnostic.runwayTotalMonths != null
                          ? `${diagnostic.runwayTotalMonths.toFixed(1)} ${lang === "th" ? "เดือน" : "mos"}`
                          : "—"}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {diagnostic.runwayOpexMonths != null
                          ? lang === "th"
                            ? `ครอบคลุมรายจ่ายคงที่ได้ ${diagnostic.runwayOpexMonths.toFixed(1)} เดือน`
                            : `Covers fixed opex for ${diagnostic.runwayOpexMonths.toFixed(1)} mos`
                          : lang === "th"
                            ? "กรอกเงินสดสำรองเพื่อคำนวณ"
                            : "Enter reserve to calculate"}
                      </p>
                    </div>

                    <div className="rounded-xl border border-border bg-secondary/35 p-3.5">
                      <p className="text-[10px] text-muted-foreground">
                        {lang === "th" ? "เงินสดสุทธิคงเหลือ/เดือน" : "Net Monthly Cashflow"}
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
                        {lang === "th" ? "บาท/เดือน หลังหักต้นทุนและหนี้" : "THB/mo after opex & debt"}
                      </p>
                    </div>
                  </div>

                  {/* Interactive Revenue Drop Simulation */}
                  <div className="mt-3.5 rounded-xl border border-amber-600/25 bg-amber-500/5 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-foreground">
                        {lang === "th"
                          ? "จำลองภาวะรายได้หดตัว (ช่วงผู้เข้าพักน้อย / น้ำท่วม / ฝุ่น / มลพิษทางน้ำ)"
                          : "Revenue Shock Stress Test (Low Season / Regional Hazard)"}
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
                          {diagnostic.isSme
                            ? lang === "th"
                              ? "กำไรต่อค่างวดที่ลดลงเหลือ"
                              : "Stressed DSCR"
                            : lang === "th"
                              ? "สัดส่วนหนี้ต่อรายได้ที่เพิ่มขึ้น"
                              : "Stressed DSR"}
                        </p>
                        <p
                          className={`mt-0.5 font-semibold tabular-nums ${
                            (diagnostic.isSme ? (diagnostic.stressedDscr ?? 0) < 1 : diagnostic.stressedDsrPct >= 60)
                              ? "text-red-700"
                              : "text-foreground"
                          }`}
                        >
                          {diagnostic.isSme
                            ? `${diagnostic.stressedDscr?.toFixed(2) ?? "—"} ${lang === "th" ? "เท่า" : "x"}`
                            : `${diagnostic.stressedDsrPct.toFixed(1)}%`}
                        </p>
                      </div>
                      <div className="rounded-lg bg-background px-3 py-2">
                        <p className="text-[10px] text-muted-foreground">
                          {lang === "th" ? "เงินสดขาดดุล / เงินสำรองรองรับได้" : "Stressed Cash / Runway"}
                        </p>
                        <p
                          className={`mt-0.5 font-semibold tabular-nums ${
                            diagnostic.stressedNetMonthlyCashflow < 0 ? "text-red-700" : "text-teal-700"
                          }`}
                        >
                          {diagnostic.stressedNetMonthlyCashflow >= 0 ? "+" : ""}
                          {Math.round(diagnostic.stressedNetMonthlyCashflow).toLocaleString()}
                          {diagnostic.stressedRunwayMonths != null && numReserve > 0
                            ? lang === "th"
                              ? ` (รองรับได้ ${diagnostic.stressedRunwayMonths} ด.)`
                              : ` (${diagnostic.stressedRunwayMonths}m buffer)`
                            : ""}
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
                              ? "ค่างวดที่ต้องจ่ายต่อเดือน เทียบกับ กำไรที่กิจการมีจ่ายไหว"
                              : "Monthly Payment vs Affordable Operating Profit"}
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
                                  ? `กำไรที่มีจ่ายไหว (${Math.round(diagnostic.operatingCashflow).toLocaleString()} บาท)`
                                  : `Affordable Profit (${Math.round(diagnostic.operatingCashflow).toLocaleString()})`}
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
                              ? "สิ่งที่ผู้ประกอบการได้รับจากแผนปรับโครงสร้างนี้:"
                              : "Key Benefit of This Restructuring Plan:"}
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            {lang === "th"
                              ? diagnostic.netMonthlyCashflow < 0
                                ? `1. แก้ปัญหาเงินสดติดลบรายเดือน: เดิมมีกำไรก่อนจ่ายหนี้ ${Math.round(diagnostic.operatingCashflow).toLocaleString()} บาท/เดือน แต่ต้องจ่ายค่างวดเดิม ${loanComparison.originalMonthlyPayment.toLocaleString()} บาท/เดือน (ทำให้เงินสดติดลบ ${Math.abs(Math.round(diagnostic.netMonthlyCashflow)).toLocaleString()} บาททุกเดือน) เมื่อลดค่างวดปีแรกเหลือ ${loanComparison.policyYear1Payment.toLocaleString()} บาท/เดือน จะทำให้จ่ายหนี้ไหวและพลิกกลับมามีเงินสดเหลือ ${Math.round(diagnostic.operatingCashflow - loanComparison.policyYear1Payment).toLocaleString()} บาท/เดือน`
                                : `1. เพิ่มสภาพคล่องหมุนเวียนทันที: ลดภาระค่างวดปีแรกจาก ${loanComparison.originalMonthlyPayment.toLocaleString()} บาท เหลือ ${loanComparison.policyYear1Payment.toLocaleString()} บาท/เดือน ทำให้มีเงินสดเหลือในมือเพิ่มขึ้น +${loanComparison.monthlyLiquiditySaved.toLocaleString()} บาท/เดือน สำหรับสำรองรับช่วงผู้เข้าพักน้อย`
                              : `Reduces Year 1 monthly installment from ${loanComparison.originalMonthlyPayment.toLocaleString()} to ${loanComparison.policyYear1Payment.toLocaleString()} THB/mo, freeing +${loanComparison.monthlyLiquiditySaved.toLocaleString()} THB/mo in working capital.`}
                          </p>
                          <p className="mt-0.5 text-muted-foreground">
                            {lang === "th"
                              ? `2. ลดภาระดอกเบี้ยระยะยาว: ตลอดแผนช่วยประหยัดดอกเบี้ยรวมประมาณ ${loanComparison.totalInterestSaved.toLocaleString()} บาท (จากเงินต้นตั้งต้น ${loanComparison.principalUsed.toLocaleString()} บาท)`
                              : `Saves approximately ${loanComparison.totalInterestSaved.toLocaleString()} THB in cumulative interest over the plan horizon.`}
                          </p>
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
                ? "ใบสรุปความพร้อมทางการเงินสำหรับยื่นธนาคาร 1 หน้า"
                : "One Page Financial Readiness Dossier"}
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
                {lang === "th" ? "ระบบวิเคราะห์ความเสี่ยงเศรษฐกิจภาคเหนือ" : "NorthRisk Analytics"} ·{" "}
                {lang === "th" ? `จังหวัด${selectedProvName}` : selectedProvName} ·{" "}
                {BUSINESS_OPTIONS.find((b) => b.id === business)?.[lang === "th" ? "th" : "en"] || business}
              </p>
              <h2
                id="dossier-modal-title"
                className="mt-1.5 font-display text-xl font-semibold leading-snug tracking-tight sm:text-2xl"
              >
                {lang === "th"
                  ? "ใบสรุปความพร้อมทางการเงินและแผนขอปรับโครงสร้างหนี้"
                  : "Financial Readiness & Restructuring Proposal"}
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
                    {lang === "th" ? "ความสามารถจ่ายหนี้จากกำไร" : "Debt Coverage Ratio"}
                  </p>
                  <p className="mt-1 font-display text-base font-semibold tabular-nums text-foreground">
                    {diagnostic.dscr != null
                      ? `${diagnostic.dscr.toFixed(2)} ${lang === "th" ? "เท่า" : "x"}`
                      : "—"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {lang === "th" ? "เกณฑ์มาตรฐานธนาคาร 1.25 เท่า" : "Banking benchmark 1.25x"}
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-secondary/25 px-3.5 py-2.5">
                  <p className="text-[10px] text-muted-foreground">
                    {lang === "th" ? "เงินสำรองอยู่รอดได้นาน" : "Liquidity Runway"}
                  </p>
                  <p className="mt-1 font-display text-base font-semibold tabular-nums text-foreground">
                    {diagnostic.runwayOpexMonths != null
                      ? `${diagnostic.runwayOpexMonths.toFixed(1)} ${lang === "th" ? "เดือน" : "months"}`
                      : "—"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {lang === "th"
                      ? `เงินสำรอง ${Math.round(diagnostic.cashReserve).toLocaleString()} บาท`
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
                      ? `ขอปรับลดภาระค่างวดปีที่ 1 จาก ${loanComparison.originalMonthlyPayment.toLocaleString()} บาท/เดือน เหลือ ${loanComparison.policyYear1Payment.toLocaleString()} บาท/เดือน เพื่อให้สอดคล้องกับกำไรจากการดำเนินงานจริง (${Math.round(diagnostic.operatingCashflow).toLocaleString()} บาท/เดือน) ช่วยเพิ่มสภาพคล่องหมุนเวียน +${loanComparison.monthlyLiquiditySaved.toLocaleString()} บาท/เดือน และประหยัดดอกเบี้ยรวมตลอดแผนประมาณ ${loanComparison.totalInterestSaved.toLocaleString()} บาท`
                      : `Reduces Year 1 monthly payment from ${loanComparison.originalMonthlyPayment.toLocaleString()} to ${loanComparison.policyYear1Payment.toLocaleString()} THB/mo, freeing +${loanComparison.monthlyLiquiditySaved.toLocaleString()} THB/mo in liquidity.`}
                  </p>
                </div>
              )}

              {loanComparison && (
                <div className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {lang === "th"
                      ? "2. ตารางเปรียบเทียบยอดหนี้คงเหลือและค่างวดรายปี (5 ปี)"
                      : "2. 5 Year Balance & Monthly Installment Schedule"}
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
