"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion, useInView } from "motion/react"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  MapPin,
  MessageSquareText,
  PhoneCall,
  Printer,
  RotateCcw,
  Scale,
  Sparkles,
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
  buildNegotiationGuide,
  buildPlainTextNegotiationSummary,
  buildScenarioComparison,
  computeFinancialDiagnostic,
  formatRatePct,
  type DebtStatusKey,
} from "@/lib/financial-dossier"
import { fullCalendarMonth, joinNaturalList, useAppState } from "@/lib/i18n"
import { policyProgramsFor } from "@/lib/policy-catalog"

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
    th: "จ่ายได้แค่ขั้นต่ำ ตัดต้นแทบไม่ลด",
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

export type ProgramMatch = {
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

export function matchOfficialPrograms(params: {
  status: DebtStatusKey
  isSme: boolean
  dscr: number | null
  dsrPct: number | null
}): ProgramMatch[] {
  const { status, isSme, dscr, dsrPct } = params
  const list: ProgramMatch[] = []
  const audience = isSme ? "sme" : "individual"
  const hasPolicy = (id: string) => policyProgramsFor(status, audience).some((program) => program.id === id)

  if (status === "overdue_120_plus" && !isSme && hasPolicy("debt_clinic")) {
    list.push({
      id: "debt_clinic",
      badge_th: "ตรวจสอบสิทธิ์กับบริษัทบริหารสินทรัพย์สุขุมวิท",
      badge_en: "Initial Screening · Verify with SAM",
      title_th: "คลินิกแก้หนี้ โดยบริษัทบริหารสินทรัพย์สุขุมวิท (โทร 1443)",
      title_en: "Debt Clinic by SAM (Call 1443)",
      benefit_th: "รวมหนี้เสียบัตรเครดิต บัตรกดเงินสด และสินเชื่อส่วนบุคคลที่ไม่มีหลักประกัน ปรับดอกเบี้ยผ่อนปรน 3 ถึง 5% ต่อปี ผ่อนสูงสุด 10 ปี",
      benefit_en: "Consolidates unsecured credit cards, cash cards, and personal loan NPLs at 3 to 5% p.a. for up to 10 years.",
      criteria_th: "บุคคลธรรมดา ค้างชำระเกิน 120 วัน และต้องตรวจสอบคุณสมบัติเพิ่มเติมเรื่องประเภทสินเชื่อ เงินต้นรวมไม่เกิน 2 ล้านบาท อายุ และรายได้กับหน่วยงานโดยตรง",
      criteria_en: "Individuals overdue >120 days; additional criteria on loan type, <= 2M THB principal, age, and income must be verified directly with SAM.",
      action_label_th: "ตรวจสอบสิทธิ์ที่เว็บไซต์คลินิกแก้หนี้",
      action_label_en: "Verify Eligibility at Debt Clinic",
      action_href: "https://www.debtclinicbysam.com/",
      source_th: "แนวทางแก้หนี้ยั่งยืน ธนาคารแห่งประเทศไทย (โปรดตรวจสอบสิทธิ์จริง)",
      source_en: "BOT Sustainable Debt Relief & SAM (Verify Actual Eligibility)",
    })
    if (hasPolicy("clear_debt")) list.push({
      id: "fast_debt_exit_sam",
      badge_th: "โครงการเฉพาะกิจ · ตรวจสอบสิทธิ์กับ ธปท.",
      badge_en: "Special Program · Verify via BOT/SAM",
      title_th: "โครงการปิดหนี้ไว ไปต่อได้ (โทร 1213 หรือ 1443 กด 6)",
      title_en: "Fast-Close Move-Forward Program (SAM Social AMC · 1213 / 1443 ext. 6)",
      benefit_th: "สำหรับลูกหนี้รายย่อยที่เป็นหนี้เสียไม่มีหลักประกัน รับโอนหนี้มาปรับโครงสร้างโดยเลือกจ่ายปิดจบบางส่วนทันที หรือผ่อนสูงสุด 3 ปี ดอกเบี้ย 0% หากปฏิบัติตามเงื่อนไข",
      benefit_en: "Transfers eligible unsecured retail NPLs to SAM Social AMC with options for partial lump-sum settlement or up to 3-year installment at 0% interest.",
      criteria_th: "บุคคลธรรมดาที่มีภาระหนี้เสียทุกประเภทสินเชื่อรวมทุกแห่งไม่เกิน 100,000 บาท ณ วันที่ 30 กันยายน 2568 (เปิดลงทะเบียนตั้งแต่ 5 ม.ค. 2569 โปรดตรวจสอบสิทธิ์ที่ช่องทางทางการ)",
      criteria_en: "Individuals with combined NPLs across all lenders <= 100,000 THB as of 30 Sep 2025 (registration opened 5 Jan 2026 — verify eligibility via official channels).",
      action_label_th: "ตรวจสอบสิทธิ์โครงการปิดหนี้ไว",
      action_label_en: "Check Eligibility at bot.or.th/cleardebt",
      action_href: "https://www.bot.or.th/cleardebt",
      source_th: "ข่าวธนาคารแห่งประเทศไทย ฉบับที่ 1/2569 (5 ม.ค. 2569)",
      source_en: "BOT Press Release 1/2569 (5 Jan 2026)",
    })
  } else if (status === "persistent" && !isSme && hasPolicy("persistent_debt")) {
    list.push({
      id: "persistent_debt",
      badge_th: "ตรวจสอบสิทธิ์กับเจ้าหนี้เดิม",
      badge_en: "Initial Screening · Verify with Lender",
      title_th: "มาตรการปิดจบหนี้เรื้อรัง (ขยายสูงสุด 7 ปี · ดอกเบี้ยไม่เกิน 15%)",
      title_en: "Persistent Debt Exit (Up to 7 Years · Max 15% p.a.)",
      benefit_th: "เปลี่ยนสินเชื่อส่วนบุคคลประเภทวงเงินหมุนเวียนเป็นสินเชื่อผ่อนรายงวด อัตราดอกเบี้ยที่แท้จริงไม่เกิน 15% ต่อปี ปิดจบภายในสูงสุด 7 ปีตามหลักเกณฑ์ที่ปรับปรุงในปี 2568",
      benefit_en: "Converts eligible revolving personal loans into fixed installments capped at 15% p.a. for up to 7 years under the updated 2025 rules.",
      criteria_th: "เฉพาะสินเชื่อส่วนบุคคลประเภทวงเงินหมุนเวียน (ยังไม่เป็นหนี้เสีย ไม่รวมบัตรเครดิตและจำนำทะเบียน) ที่จ่ายดอกเบี้ยรวมมากกว่าเงินต้นย้อนหลัง 5 ปี และเข้าเกณฑ์รายได้ของธนาคารแห่งประเทศไทย (ต่ำกว่า 20,000 บาทต่อเดือนสำหรับธนาคาร หรือต่ำกว่า 10,000 บาทต่อเดือนสำหรับผู้ให้บริการที่ไม่ใช่ธนาคาร)",
      criteria_en: "Revolving personal loans (Non-NPL, excluding credit cards/auto-title) paying more interest than principal for 5+ years and meeting BOT income criteria (<20,000 THB/mo bank/group or <10,000 THB/mo other non-bank).",
      action_label_th: "เปิดอ่านประกาศหลักเกณฑ์ ธปท.",
      action_label_en: "Open Official BOT Guideline (PDF)",
      action_href: "https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/ThaiPDF/25680030.pdf",
      source_th: "ประกาศหลักเกณฑ์การให้สินเชื่ออย่างรับผิดชอบ ปรับปรุง 2568 (ตรวจสอบสิทธิ์กับเจ้าหนี้)",
      source_en: "Updated Responsible Lending 2568 (Verify with Lender)",
    })
  } else if (status === "persistent" && isSme && hasPolicy("responsible_lending")) {
    list.push({
      id: "sme_persistent_restructuring",
      badge_th: "สำหรับกิจการที่จ่ายขั้นต่ำต่อเนื่อง",
      badge_en: "SME Revolving Debt Option",
      title_th: "ขอปรับโครงสร้างหนี้หมุนเวียนกิจการเป็นงวดผ่อนคงที่",
      title_en: "Convert Revolving SME Debt into Fixed Installments",
      benefit_th: "หารือเจ้าหนี้เพื่อเปลี่ยนหนี้วงเงินหมุนเวียนหรือสินเชื่อระยะสั้นให้เป็นค่างวดรายเดือนที่ชัดเจนและสอดคล้องกับกระแสเงินสดของกิจการ การพิจารณาขึ้นอยู่กับเจ้าหนี้และสัญญา",
      benefit_en: "Discuss converting short term or revolving business credit into manageable monthly installments suited to cash flow, subject to lender and contract terms.",
      criteria_th: "เตรียมข้อมูลรายรับ รายจ่าย ยอดหนี้หมุนเวียน และยอดค่างวดที่จ่ายไหวจริงต่อเดือนเพื่อหารือกับเจ้าหนี้ หรือสอบถามแนวทางเบื้องต้นได้ที่สายด่วน ธปท. 1213",
      criteria_en: "Prepare revenue, expenses, revolving balance, and affordable payment figures for your lender, or call BOT hotline 1213 for general guidance.",
      action_label_th: "เปิดอ่านแนวทางช่วยลูกหนี้ (เอกสารแนบ 7 หน้า 37)",
      action_label_en: "Open Borrower Relief Annex 7 (p. 37)",
      action_href: "https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/ThaiPDF/25680030.pdf#page=37",
      source_th: "หลักเกณฑ์การให้สินเชื่ออย่างรับผิดชอบ 2568 (เอกสารแนบ 7 สำหรับสินเชื่อธุรกิจ)",
      source_en: "Responsible Lending Guideline 2568 (Annex 7 for SME Loans)",
    })
  } else if ((status === "overdue_31_120" || (status === "overdue_120_plus" && isSme)) && hasPolicy("responsible_lending")) {
    list.push({
      id: "lender_restructuring_overdue",
      badge_th: "เริ่มจากติดต่อเจ้าหนี้เดิม",
      badge_en: "Start with your current lender",
      title_th: "ขอปรับโครงสร้างหนี้ตามความสามารถในการชำระ",
      title_en: "Request restructuring based on repayment capacity",
      benefit_th: "แจ้งเจ้าหนี้เมื่อเริ่มจ่ายไม่ไหว และขอให้พิจารณาค่างวดหรือเงื่อนไขที่สอดคล้องกับรายรับจริง แนวทางและผลอนุมัติขึ้นอยู่กับเจ้าหนี้และสัญญา",
      benefit_en: "Contact your lender early and request installments or terms suited to actual income; options and approval depend on the lender and contract.",
      criteria_th: "แจ้งยอดหนี้ รายรับที่เปลี่ยนไป และจำนวนเงินที่ยังจ่ายไหว เพื่อให้เจ้าหนี้ประเมินเป็นรายกรณี",
      criteria_en: "Share the outstanding balance, income changes, and an affordable payment amount for a case-by-case review.",
      action_label_th: "เปิดอ่านแนวทางช่วยลูกหนี้ (เอกสารแนบ 7 หน้า 37)",
      action_label_en: "Open Borrower Relief Annex 7 (p. 37)",
      action_href: "https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/ThaiPDF/25680030.pdf#page=37",
      source_th: "หลักเกณฑ์การให้สินเชื่ออย่างรับผิดชอบ 2568 (ไม่ใช่การยืนยันอนุมัติอัตโนมัติ)",
      source_en: "Responsible Lending 2568 (Not an Automatic Approval)",
    })
  } else if (status === "disaster" && hasPolicy("disaster_relief")) {
    list.push({
      id: "disaster_lender_relief",
      badge_th: "ติดต่อเจ้าหนี้เพื่อขอความช่วยเหลือ",
      badge_en: "Initial Screening · Hazard Relief",
      title_th: "สอบถามแนวทางช่วยเหลือเมื่อรายได้ได้รับผลกระทบ",
      title_en: "Ask about relief when income is affected",
      benefit_th: "เจ้าหนี้อาจพิจารณาปรับค่างวดหรือเงื่อนไขตามผลกระทบและสัญญา ไม่มีเงื่อนไขเดียวที่ใช้ได้กับทุกภัยหรือทุกสถาบันการเงิน",
      benefit_en: "Your lender may review payments or terms based on the impact and contract; options vary by event and lender.",
      criteria_th: "เตรียมหลักฐานแสดงผลกระทบหรือรายได้ที่ลดลง (เช่น ใบเสร็จยอดขายย้อนหลัง รายการเดินบัญชี หรือภาพถ่ายพื้นที่ได้รับผลกระทบ) เพื่อยื่นตรวจสอบสิทธิ์กับเจ้าหนี้",
      criteria_en: "Prepare evidence of income drop or impact (sales receipts, bank statements, or site photos) for lender verification.",
      action_label_th: "ดูมาตรการช่วยเหลือจาก ธปท.",
      action_label_en: "View BOT Relief Measures",
      action_href: "https://www.bot.or.th/th/our-roles/special-measures.html",
      source_th: "มาตรการช่วยเหลือ ธปท. (ตรวจสอบตามเหตุการณ์และเจ้าหนี้)",
      source_en: "BOT Relief Measures (check event and lender-specific terms)",
    })
  } else if (isSme && status === "current" && hasPolicy("responsible_lending")) {
    list.push({
      id: "sme_lender_restructuring",
      badge_th: dscr != null && dscr < 1.25 ? "กิจการที่กระแสเงินสดตึงตัว" : "คุยกับเจ้าหนี้เรื่องกระแสเงินสด",
      badge_en: dscr != null && dscr < 1.25 ? "Tight business cash flow" : "Discuss business cash flow",
      title_th: "หารือเจ้าหนี้เรื่องค่างวดและสภาพคล่องของกิจการ",
      title_en: "Discuss business cash flow and installments with your lender",
      benefit_th: "ขอให้เจ้าหนี้ช่วยทบทวนค่างวดหรือเงื่อนไขให้เหมาะกับกระแสเงินสดของกิจการ การพิจารณาขึ้นอยู่กับเจ้าหนี้และสัญญา",
      benefit_en: "Ask your lender to review installments or terms against business cash flow; review depends on the lender and contract.",
      criteria_th: "เตรียมรายรับ รายจ่ายธุรกิจ ค่างวดหนี้ และประมาณการกระแสเงินสดเพื่อหารือกับเจ้าหนี้",
      criteria_en: "Prepare business revenue, expenses, debt installments, and a cash-flow estimate for your lender.",
      action_label_th: "เปิดอ่านแนวทางช่วยลูกหนี้ (เอกสารแนบ 7 หน้า 37)",
      action_label_en: "Open Borrower Relief Annex 7 (p. 37)",
      action_href: "https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/ThaiPDF/25680030.pdf#page=37",
      source_th: "หลักเกณฑ์การให้สินเชื่ออย่างรับผิดชอบ 2568 (เอกสารแนบ 7)",
      source_en: "Responsible Lending Guideline 2568 (Annex 7)",
    })
  }

  // Only show pre NPL Responsible Lending or SME Working Capital options when borrower is not already overdue or persistent
  if (isSme && (status === "current" || status === "disaster") && hasPolicy("smes_secure_plus")) {
    list.push({
      id: "smes_secure_plus",
      badge_th: "ขึ้นกับผลิตภัณฑ์ที่ผู้ให้กู้เปิดใช้",
      badge_en: "Subject to lender's active product",
      title_th: "กรอบ SMEs Secure+ (มีทรัพย์เพิ่ม เติมสภาพคล่อง)",
      title_en: "SMEs Secure+ Liquidity & Asset-Backed Framework",
      benefit_th: "กรอบของ ธปท. ที่เปิดให้ผู้ให้กู้จัดทำผลิตภัณฑ์สินเชื่อโดยสมัครใจ ไม่ใช่เงินช่วยเหลือหรือสิทธิอนุมัติอัตโนมัติ วงเงิน ดอกเบี้ย และหลักประกันขึ้นกับผู้ให้กู้",
      benefit_en: "A BOT framework for lenders to offer credit products voluntarily, not a grant or automatic approval. Limits, rates, and collateral depend on the lender.",
      criteria_th: "กรอบกำหนดคุณสมบัติ เช่น SME สัญชาติไทย ประวัติค้างชำระไม่เกิน 90 วัน ณ 31 มี.ค. 2569 ไม่เป็น Stage 3 ตอนยื่น และมีหลักประกันตามผลิตภัณฑ์ ต้องถามผู้ให้กู้ว่ามีผลิตภัณฑ์เปิดรับอยู่หรือไม่",
      criteria_en: "Framework criteria include Thai SME status, no more than 90 days past due as of 31 Mar 2026, not Stage 3 when applying, and lender-approved collateral. Confirm whether a lender product is currently open.",
      action_label_th: "เปิดอ่านหนังสือเวียนกรอบ SMEs Secure+",
      action_label_en: "Open SMEs Secure+ Circular (PDF)",
      action_href: "https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2569/ThaiPDF/25690074.pdf",
      source_th: "หนังสือเวียน ธปท. กรอบหลักการ SMEs Secure+ 2569 (ตรวจสอบกับผู้ให้กู้)",
      source_en: "BOT Circular SMEs Secure+ 2569 (Verify with Lender)",
    })
  }
  if (isSme && (status === "current" || status === "disaster") && hasPolicy("sme_credit_guarantee") && (dscr == null || dscr >= 1.0)) {
    list.push({
      id: "credit_boost_tcg",
      badge_th: "ขึ้นกับโครงการ บสย. ที่เปิดอยู่",
      badge_en: "Subject to active TCG programs",
      title_th: "ช่องทางสินเชื่อและค้ำประกันสำหรับกิจการ (บสย.)",
      title_en: "SME Credit and Guarantee Channels (TCG)",
      benefit_th: "เป็นช่องทางสอบถามโครงการค้ำประกันสินเชื่อของ บสย. ที่อาจเปิดรับในช่วงนั้น ไม่ใช่การรับรองว่าจะมีโครงการหรือได้รับอนุมัติ",
      benefit_en: "Ask about currently available credit guarantee channels; approval depends on TCG and lender underwriting.",
      criteria_th: "ตรวจสอบโครงการที่ยังเปิดอยู่ คุณสมบัติ และเงื่อนไขกับ บสย. และสถาบันการเงินก่อนสมัคร",
      criteria_en: "Verify currently open programs, eligibility, and terms with TCG and the financial institution before applying.",
      action_label_th: "เปิดเว็บไซต์ บสย. (ค้ำประกันสินเชื่อ)",
      action_label_en: "Open TCG Official Website",
      action_href: "https://www.tcg.or.th/",
      source_th: "บรรษัทประกันสินเชื่ออุตสาหกรรมขนาดย่อม (บสย.) · ตรวจสอบสถานะโครงการ",
      source_en: "Thai Credit Guarantee Corporation (TCG) · Verify current programs",
    })
  } else if (status === "current" || status === "disaster") {
    list.push({
      id: "responsible_lending",
      badge_th: dsrPct == null || dsrPct >= 40 || (dscr != null && dscr < 1.25) ? "แนวทางเจรจาเจ้าหนี้เดิม" : "วางแผนเชิงป้องกัน",
      badge_en: dsrPct == null || dsrPct >= 40 ? "Direct Lender Option" : "Preventive Option",
      title_th: "สิทธิขอปรับโครงสร้างหนี้เชิงป้องกันก่อนเป็นหนี้เสีย (หลักเกณฑ์ปี 2568)",
      title_en: "Pre Emptive Restructuring Before NPL (Responsible Lending 2568)",
      benefit_th: "เจ้าหนี้มีหน้าที่เสนอแนวทางปรับโครงสร้างหนี้ที่เหมาะกับความสามารถชำระจริงอย่างน้อย 1 ครั้งก่อนเป็นหนี้เสีย โดยไม่เรียกเก็บค่าธรรมเนียม",
      benefit_en: "Lenders must offer tailored restructuring at least once before NPL with zero restructuring fee.",
      criteria_th: "ลูกหนี้ที่ยังไม่เป็นหนี้เสียแต่การเงินเริ่มตึงมือ หรือต้องการปรับตารางผ่อนให้สอดคล้องฤดูกาล (เงื่อนไขจริงขึ้นอยู่กับการเจรจากับเจ้าหนี้)",
      criteria_en: "Performing borrowers facing tighter cashflow or seasonal swings (final terms determined with your lender).",
      action_label_th: "เปิดอ่านประกาศหลักเกณฑ์ปี 2568",
      action_label_en: "Open 2568 Guideline (PDF)",
      action_href: "https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/ThaiPDF/25680030.pdf",
      source_th: "ประกาศหลักเกณฑ์การให้สินเชื่ออย่างรับผิดชอบและเป็นธรรม 2568",
      source_en: "Responsible Lending Guideline 2568",
    })
  }
  if ((status === "current" || status === "overdue_31_120") && hasPolicy("debt_relief_energy")) {
    list.push({
      id: "debt_relief_energy",
      badge_th: "สำหรับผู้ได้รับผลกระทบค่าครองชีพ/ราคาพลังงาน",
      badge_en: "For cost-of-living & energy price impacts",
      title_th: "แนวทางช่วยเหลือลูกหนี้ที่ได้รับผลกระทบจากภาวะเศรษฐกิจและราคาพลังงาน",
      title_en: "Relief Guideline for Economic and Energy Cost Impacts",
      benefit_th: "ขอให้สถาบันการเงินพิจารณาปรับลดค่างวด ขยายเวลาผ่อนชำระ หรือปรับเงื่อนไขให้สอดคล้องกับรายได้ที่ลดลงหรือต้นทุนพลังงานที่สูงขึ้น",
      benefit_en: "Ask your lender to review installment reductions or term extensions aligned with lower income or elevated energy costs.",
      criteria_th: "ลูกหนี้รายย่อยหรือ SME ที่ได้รับผลกระทบจากภาวะเศรษฐกิจและราคาพลังงานในปี 2569 (ขึ้นอยู่กับการพิจารณาของสถาบันการเงินเจ้าหนี้)",
      criteria_en: "Retail or SME borrowers impacted by economic and energy cost pressures in 2026 (subject to lender assessment).",
      action_label_th: "เปิดอ่านแนวทางช่วยเหลือ ธปท. (2569)",
      action_label_en: "Open BOT 2026 Relief Notice (PDF)",
      action_href: "https://www.bot.or.th/content/dam/bot/documents/th/news-and-media/news/2026/news-20260408.pdf",
      source_th: "หนังสือเวียนช่วยเหลือลูกหนี้จากภาวะเศรษฐกิจและราคาพลังงาน 2569",
      source_en: "BOT Economic & Energy Impact Relief Circular 2026",
    })
  }

  return list.map((match) => {
    const catalogId = match.id === "fast_debt_exit_sam"
      ? "clear_debt"
      : match.id === "lender_restructuring_overdue" || match.id === "sme_lender_restructuring" || match.id === "sme_persistent_restructuring"
        ? "responsible_lending"
        : match.id === "disaster_lender_relief"
          ? "disaster_relief"
          : match.id === "credit_boost_tcg"
            ? "sme_credit_guarantee"
            : match.id
    const catalogProgram = policyProgramsFor(status, audience).find((program) => program.id === catalogId)
    if (!catalogProgram) return match
    const resolvedHref =
      catalogId === "responsible_lending" && match.action_href.includes("#page=")
        ? `${catalogProgram.source_url.split("#")[0]}#page=37`
        : catalogProgram.source_url
    return { ...match, action_href: resolvedHref }
  }).slice(0, 3)
}

type PresetKey = "individual_tight" | "sme_tight" | "restaurant_overdue" | "disaster_cr" | null

type LoanCategory = "card" | "personal" | "auto" | "home" | "sme" | "informal"

type ExtraLoanItem = {
  id: string
  category: LoanCategory
  monthlyPayment: string
  principal: string
}

function formatMoneyInput(raw: string): string {
  const digits = raw.replace(/\D/g, "")
  if (!digits) return ""
  return Number(digits).toLocaleString("en-US")
}

function parseMoney(raw: string): number {
  const cleaned = raw.replace(/[^\d.]/g, "")
  const value = Number(cleaned)
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export function Pricing({ provinces }: { provinces: ProvinceOutlookItem[] }) {
  const ref = useRef(null)
  const dossierDialogRef = useRef<HTMLDialogElement | null>(null)
  const docPageDialogRef = useRef<HTMLDialogElement | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const resultPanelRef = useRef<HTMLDivElement | null>(null)
  const isInView = useInView(ref, { once: true, margin: "-60px" })
  const {
    lang,
    selectedProvinceCode,
    setSelectedProvinceCode,
    setActiveDebtStatus,
    setActiveBorrowerType,
    provinceDetail,
  } = useAppState()

  const [formStep, setFormStep] = useState<1 | 2 | 3>(1)
  const [stepDir, setStepDir] = useState<1 | -1>(1)
  const [copiedSummary, setCopiedSummary] = useState(false)
  const [showDetailedChart, setShowDetailedChart] = useState(false)
  const [showScenarioTable, setShowScenarioTable] = useState(false)
  const [showAdvancedDetails, setShowAdvancedDetails] = useState(false)
  const [showBankQuestions, setShowBankQuestions] = useState(false)
  const [resultFlash, setResultFlash] = useState(false)
  const [activePreset, setActivePreset] = useState<PresetKey>(null)
  const docPageScrollRef = useRef<HTMLDivElement>(null)
  const [activeDocPage, setActiveDocPage] = useState<{
    docTitle: string
    pageNum: number
    docUrl: string
    fullText: string
    totalPages?: number
    prevPage?: number | null
    nextPage?: number | null
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
  const [annualRateInput, setAnnualRateInput] = useState("")
  const [rawHorizonYears, setHorizonYears] = useState(5)
  const [extraLoans, setExtraLoans] = useState<ExtraLoanItem[]>([])
  const [deferMonths, setDeferMonths] = useState(6)
  const [stressDropPct, setStressDropPct] = useState(30)

  const [submitting, setSubmitting] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [stepValidationError, setStepValidationError] = useState<string | null>(null)
  const [rawResult, setResult] = useState<ReliefCheckResponse | null>(null)

  function goToStep(next: 1 | 2 | 3) {
    if (next > formStep && next === 3 && (!hasEnteredRevenue || numDebt <= 0)) {
      setStepValidationError(
        lang === "th"
          ? "กรุณากรอกรายได้และค่างวดหนี้ให้ครบก่อน"
          : "Please enter monthly income and debt payment first.",
      )
      if (formStep === 1) {
        setStepDir(1)
        setFormStep(2)
      }
      return
    }
    setStepValidationError(null)
    setStepDir(next >= formStep ? 1 : -1)
    setFormStep(next)
  }

  function scrollToResults() {
    resultPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    setResultFlash(true)
    setTimeout(() => setResultFlash(false), 1600)
  }

  function editStepFromResults(step: 1 | 2 | 3) {
    setStepValidationError(null)
    setStepDir(step >= formStep ? 1 : -1)
    setFormStep(step)
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

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

  const numRevenue = parseMoney(revenue)
  const numOpex = parseMoney(opex)
  const baseDebt = parseMoney(debtPayment)
  const extraDebtSum = extraLoans.reduce((acc, item) => acc + parseMoney(item.monthlyPayment), 0)
  const numDebt = baseDebt > 0 ? baseDebt : extraDebtSum
  const numReserve = parseMoney(cashReserve)
  const basePrincipal = parseMoney(totalPrincipal)
  const extraPrincipalSum = extraLoans.reduce((acc, item) => acc + parseMoney(item.principal), 0)
  const numPrincipal = basePrincipal > 0 ? basePrincipal : extraPrincipalSum
  const maxHorizonYears = debtStatus === "persistent" ? 7 : 30
  const horizonYears = Math.min(rawHorizonYears, maxHorizonYears)

  useEffect(() => {
    setActiveDebtStatus(debtStatus)
  }, [debtStatus, setActiveDebtStatus])
  useEffect(() => {
    setActiveBorrowerType(isSme ? "sme" : "individual")
  }, [isSme, setActiveBorrowerType])
  const hasAnyInput = Boolean(
    revenue.trim() ||
      opex.trim() ||
      debtPayment.trim() ||
      cashReserve.trim() ||
      totalPrincipal.trim() ||
      extraLoans.length > 0 ||
      activePreset,
  )

  const hasEnteredRevenue = revenue.trim().length > 0
  const hasValidBackendInputs = numDebt > 0 && (hasEnteredRevenue || numRevenue > 0)
  const result = hasValidBackendInputs ? rawResult : null
  const hasActiveWaterPollution = Boolean(selectedProvData?.has_active_water_pollution)

  const runBackendAssessment = useCallback(
    async (params: {
      prov: string
      biz: string
      statusKey: DebtStatusKey
      revVal: number
      debtVal: number
    }) => {
      setSubmitting(true)
      setApiError(null)
      try {
        const tags: string[] = []
        if (params.statusKey === "overdue_31_120" || params.statusKey === "overdue_120_plus") tags.push("overdue_debt")
        if (params.statusKey === "persistent") tags.push("persistent_debt")
        if (params.statusKey === "disaster") tags.push("disaster")
        if (hasActiveWaterPollution) tags.push("water_pollution")
        const res = await submitReliefCheck({
          province: params.prov,
          business_type: params.biz,
          monthly_revenue_thb: params.revVal,
          monthly_debt_thb: params.debtVal,
          impact_tags: tags,
          language: lang,
        })
        setResult(res)
      } catch {
        setApiError(
          lang === "th"
            ? "การคำนวณสภาพคล่องและค่างวดเบื้องต้นยังแสดงผลได้ตามปกติ แต่ระบบค้นคำแนะนำจากเอกสารทางการขัดข้องชั่วคราว"
            : "Local liquidity and payment calculations remain available, but the official document guidance service is temporarily unavailable.",
        )
      } finally {
        setSubmitting(false)
      }
    },
    [lang, hasActiveWaterPollution],
  )

  useEffect(() => {
    if (!hasValidBackendInputs) return
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
  }, [hasValidBackendInputs, numRevenue, numDebt, selectedProvinceCode, business, debtStatus, runBackendAssessment])

  function resetAllInputs() {
    setActivePreset(null)
    setRevenue("")
    setOpex("")
    setDebtPayment("")
    setCashReserve("")
    setTotalPrincipal("")
    setAnnualRateInput("")
    setExtraLoans([])
    setHorizonYears(5)
    setApiError(null)
    setResult(null)
    goToStep(1)
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

  function addExtraLoan(category: LoanCategory = "card") {
    setExtraLoans((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${prev.length}`,
        category,
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
    if (numRevenue <= 0 && numDebt <= 0 && numOpex <= 0) return null
    return computeFinancialDiagnostic({
      isSme,
      monthlyRevenue: numRevenue,
      monthlyOpex: numOpex,
      monthlyDebt: numDebt,
      cashReserve: numReserve,
      stressDropPct,
    })
  }, [isSme, numRevenue, numOpex, numDebt, numReserve, stressDropPct])

  const numAnnualRate = useMemo(() => {
    const cleaned = annualRateInput.replace(/[^\d.]/g, "")
    const val = Number(cleaned)
    return Number.isFinite(val) && val > 0 ? Math.min(36, val) : undefined
  }, [annualRateInput])

  const loanComparison = useMemo(() => {
    if ((numRevenue <= 0 && numDebt <= 0) || debtStatus === "overdue_120_plus") return null
    return buildLoanComparison({
      status: debtStatus,
      isSme,
      monthlyRevenue: numRevenue,
      monthlyDebt: numDebt,
      totalPrincipalInput: numPrincipal,
      customAnnualRatePct: numAnnualRate,
      borrowerAge: 0,
      clinicMonths: Math.max(12, Math.min(120, Math.round(horizonYears * 12))),
      deferMonths,
      customHorizonYears: horizonYears,
      lang,
    })
  }, [debtStatus, isSme, numRevenue, numDebt, numPrincipal, numAnnualRate, deferMonths, horizonYears, lang])

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
    })
  }, [diagnostic, debtStatus, isSme])

  // Bridge real provincial seasonality and active alerts into personal payment guidance
  const provincialAdvisory = useMemo(() => {
    const matchingDetail =
      provinceDetail?.province?.province_code === selectedProvinceCode ? provinceDetail : null
    const cal = matchingDetail?.seasonality_calendar ?? []
    const validOcc = cal.filter((c) => c.avg_occupancy_rate != null)
    let lowMonthsText = ""
    let dropFromPeakPct = 0
    if (validOcc.length >= 2) {
      const sortedDesc = [...validOcc].sort((a, b) => (b.avg_occupancy_rate ?? 0) - (a.avg_occupancy_rate ?? 0))
      const sortedAsc = [...validOcc].sort((a, b) => (a.avg_occupancy_rate ?? 0) - (b.avg_occupancy_rate ?? 0))
      const peakOcc = sortedDesc[0]?.avg_occupancy_rate ?? 0
      const lowOcc = sortedAsc[0]?.avg_occupancy_rate ?? 0
      dropFromPeakPct = peakOcc > 0 ? Math.round(((peakOcc - lowOcc) / peakOcc) * 100) : 0
      lowMonthsText = joinNaturalList(
        sortedAsc.slice(0, 2).map((c) => fullCalendarMonth(c.cal_month, lang)),
        lang,
      )
    }

    const hazeExceed = cal
      .filter((c) => (c.avg_pm25_mean ?? 0) >= 37.5)
      .sort((a, b) => (b.avg_pm25_mean ?? 0) - (a.avg_pm25_mean ?? 0))
    const hazeMonthsText = joinNaturalList(
      hazeExceed.slice(0, 2).map((c) => fullCalendarMonth(c.cal_month, lang)),
      lang,
    )

    const rainSorted = [...cal]
      .filter((c) => c.avg_rainfall_mm != null)
      .sort((a, b) => (b.avg_rainfall_mm ?? 0) - (a.avg_rainfall_mm ?? 0))
    const rainMonthsText = joinNaturalList(
      rainSorted.slice(0, 2).map((c) => fullCalendarMonth(c.cal_month, lang)),
      lang,
    )

    const hasWaterAlert = Boolean(selectedProvData?.has_active_water_pollution)
    const hasShockAlert = Boolean(selectedProvData?.has_active_external_shock)
    const suggestedDropPct = isSme
      ? dropFromPeakPct > 0
        ? Math.min(40, Math.max(20, Math.round(dropFromPeakPct * 0.65)))
        : hasShockAlert
          ? 30
          : 25
      : hasShockAlert
        ? 25
        : 20

    const safeSeasonalCap =
      diagnostic && diagnostic.monthlyRevenue > 0
        ? Math.max(0, Math.round(diagnostic.monthlyRevenue * (1 - suggestedDropPct / 100) - diagnostic.monthlyOpex))
        : null

    const partsTh: string[] = []
    const partsEn: string[] = []
    if (lowMonthsText) {
      partsTh.push(
        `ช่วงนอกฤดูท่องเที่ยวอยู่ในเดือน${lowMonthsText}${dropFromPeakPct > 0 ? ` (ยอดเข้าพักลดลงเฉลี่ย ${dropFromPeakPct}% จากช่วงสูงสุด)` : ""}`,
      )
      partsEn.push(
        `low season falls in ${lowMonthsText}${dropFromPeakPct > 0 ? ` (occupancy drops ~${dropFromPeakPct}% from peak)` : ""}`,
      )
    }
    if (hazeMonthsText) {
      partsTh.push(`ฝุ่นละอองขนาดเล็กเกินเกณฑ์ในเดือน${hazeMonthsText}`)
      partsEn.push(`PM2.5 exceeds 37.5 in ${hazeMonthsText}`)
    }
    if (rainMonthsText) {
      partsTh.push(`ฝนตกชุกในเดือน${rainMonthsText}`)
      partsEn.push(`heavy rainfall peaks in ${rainMonthsText}`)
    }
    if (hasWaterAlert) {
      partsTh.push("ขณะนี้มีข่าวเฝ้าระวังมลพิษทางน้ำในพื้นที่")
      partsEn.push("an active local water pollution alert is present")
    } else if (hasShockAlert) {
      partsTh.push("ขณะนี้มีสัญญาณแรงกดดันจากภัยพิบัติหรือสภาพอากาศในพื้นที่")
      partsEn.push("active local weather or hazard stress signals are present")
    }

    const tierTh = selectedProvData?.tier_short_th || ""
    const tierEn = selectedProvData?.tier_short_en || ""
    const summaryTh =
      partsTh.length === 1
        ? partsTh[0]
        : partsTh.length === 2
          ? `${partsTh[0]} และ${partsTh[1]}`
          : partsTh.length > 2
            ? `${partsTh[0]} โดยมี${partsTh.slice(1, -1).join(" ")} และ${partsTh[partsTh.length - 1]}`
            : tierTh
              ? `ระดับสัญญาณความเปราะบางพื้นที่อยู่ในกลุ่ม "${tierTh}"`
              : `ติดตามความผันผวนตามฤดูกาลในจังหวัด${selectedProvName}`
    const summaryEn =
      partsEn.length > 0
        ? joinNaturalList(partsEn, "en")
        : tierEn
          ? `Provincial vulnerability signal is "${tierEn}"`
          : `Monitor seasonal swings in ${selectedProvName}`

    return {
      summaryTh,
      summaryEn,
      suggestedDropPct,
      safeSeasonalCap,
      hasActiveAlert: hasWaterAlert || hasShockAlert,
      tierShortTh: tierTh,
      tierShortEn: tierEn,
    }
  }, [provinceDetail, selectedProvinceCode, selectedProvData, selectedProvName, isSme, diagnostic, lang])

  const scenarioRows = useMemo(() => {
    if (!diagnostic || numDebt <= 0) return []
    return buildScenarioComparison({
      status: debtStatus,
      isSme,
      monthlyDebt: numDebt,
      totalPrincipalInput: numPrincipal,
      customAnnualRatePct: numAnnualRate,
      horizonYears,
      deferMonths,
    })
  }, [diagnostic, debtStatus, isSme, numDebt, numPrincipal, numAnnualRate, horizonYears, deferMonths])

  const negotiationGuide = useMemo(() => {
    if (!diagnostic) return null
    const primary = matchedPrograms[0]
    return buildNegotiationGuide({
      provinceName: selectedProvName,
      isSme,
      status: debtStatus,
      diag: diagnostic,
      comparison: loanComparison,
      primaryProgramTitleTh: primary?.title_th,
      primaryProgramTitleEn: primary?.title_en,
      safeSeasonalCap: provincialAdvisory.safeSeasonalCap,
      provincialSeasonSummaryTh: provincialAdvisory.summaryTh,
      provincialSeasonSummaryEn: provincialAdvisory.summaryEn,
    })
  }, [diagnostic, matchedPrograms, selectedProvName, isSme, debtStatus, loanComparison, provincialAdvisory])

  async function handleCopySummary() {
    if (!diagnostic || !negotiationGuide) return
    const bizObj = BUSINESS_OPTIONS.find((b) => b.id === business)
    const statusObj = DEBT_STATUS_OPTIONS.find((s) => s.id === debtStatus)
    const text = buildPlainTextNegotiationSummary({
      lang,
      provinceName: selectedProvName,
      businessLabel: bizObj ? (lang === "th" ? bizObj.th : bizObj.en) : business,
      statusLabel: statusObj ? (lang === "th" ? statusObj.th : statusObj.en) : debtStatus,
      diag: diagnostic,
      comparison: loanComparison,
      guide: negotiationGuide,
      matchedPrograms: matchedPrograms.map((p) => ({
        title: lang === "th" ? p.title_th : p.title_en,
        benefit: lang === "th" ? p.benefit_th : p.benefit_en,
      })),
      provincialNote: lang === "th" ? provincialAdvisory.summaryTh : provincialAdvisory.summaryEn,
      safeSeasonalCap: provincialAdvisory.safeSeasonalCap,
    })
    try {
      await navigator.clipboard.writeText(text)
      setCopiedSummary(true)
      setTimeout(() => setCopiedSummary(false), 2600)
    } catch {
      const area = document.createElement("textarea")
      area.value = text
      area.style.position = "fixed"
      area.style.opacity = "0"
      document.body.appendChild(area)
      area.select()
      document.execCommand("copy")
      document.body.removeChild(area)
      setCopiedSummary(true)
      setTimeout(() => setCopiedSummary(false), 2600)
    }
  }

  function applyPreset(preset: "individual_tight" | "sme_tight" | "restaurant_overdue" | "disaster_cr") {
    setActivePreset(preset)
    setApiError(null)
    setExtraLoans([])
    goToStep(2)
    if (preset === "individual_tight") {
      setUserType("individual")
      setBusiness("household")
      setDebtStatus("current")
      setRevenue("35,000")
      setOpex("14,000")
      setDebtPayment("15,500")
      setCashReserve("45,000")
      setTotalPrincipal("450,000")
      setHorizonYears(5)
    } else if (preset === "sme_tight") {
      setUserType("business")
      setBusiness("hotel")
      setDebtStatus("current")
      setRevenue("165,000")
      setOpex("112,000")
      setDebtPayment("48,000")
      setCashReserve("240,000")
      setTotalPrincipal("1,850,000")
    } else if (preset === "restaurant_overdue") {
      setUserType("business")
      setBusiness("restaurant")
      setDebtStatus("overdue_31_120")
      setRevenue("120,000")
      setOpex("84,000")
      setDebtPayment("44,000")
      setCashReserve("150,000")
      setTotalPrincipal("1,600,000")
    } else {
      setUserType("business")
      setSelectedProvinceCode("CR")
      setBusiness("restaurant")
      setDebtStatus("disaster")
      setRevenue("135,000")
      setOpex("92,000")
      setDebtPayment("39,000")
      setCashReserve("160,000")
      setTotalPrincipal("1,500,000")
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!hasEnteredRevenue || numDebt <= 0) {
      setApiError(
        lang === "th"
          ? "กรุณากรอกรายได้และค่างวดหนี้ให้ครบก่อน"
          : "Please enter monthly income and debt payment first.",
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
    setActiveDocPage((prev) => ({
      docTitle: title,
      pageNum: pNum,
      docUrl: cite.doc_url || prev?.docUrl || "",
      fullText: fallbackText,
      totalPages: prev?.docTitle === title ? prev.totalPages : undefined,
      prevPage: pNum > 1 ? pNum - 1 : null,
      nextPage: null,
      loading: !fallbackText,
    }))
    if (docPageDialogRef.current && !docPageDialogRef.current.open) {
      docPageDialogRef.current.showModal()
    }
    if (docPageScrollRef.current) {
      docPageScrollRef.current.scrollTop = 0
    }
    try {
      const pageData: PolicyPageResponse = await fetchPolicyPage(title, pNum)
      setActiveDocPage({
        docTitle: pageData.doc_title,
        pageNum: pageData.page_num,
        docUrl: pageData.doc_url || cite.doc_url || "",
        fullText: pageData.full_text || fallbackText,
        totalPages: pageData.total_pages,
        prevPage: pageData.prev_page ?? null,
        nextPage: pageData.next_page ?? null,
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
      negotiationGuide,
      provincialNote: lang === "th" ? provincialAdvisory.summaryTh : provincialAdvisory.summaryEn,
      safeSeasonalCap: provincialAdvisory.safeSeasonalCap,
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
          "บันทึกสรุปตัวเลขและแนวทางเจรจาเบื้องต้น (คัดลอกไว้ในมือถือหรือพิมพ์ถือไปคุยกับเจ้าหน้าที่)",
        ]
      : [
          "6 month bank statements (personal or business account)",
          "Latest loan statements and installment schedules from your lenders",
          "Evidence of seasonal drop or regional hazard/water pollution impact (if applicable)",
          "Personal financial summary and negotiation notes (copied on phone or printed)",
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
              {lang === "th" ? "ประเมินการเงินส่วนตัว" : "Personal Financial Check"}
            </p>
            <h2
              id="relief-heading"
              className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
            >
              {lang === "th"
                ? "กรอกรายรับ รายจ่าย และค่างวดหนี้ของคุณ"
                : "Enter Your Income, Expenses & Monthly Debt"}
            </h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            {lang === "th"
              ? "ใส่ตัวเลขคร่าวๆ ใน 3 ขั้นตอน หรือกดดูตัวอย่างด้านล่าง เพื่อดูผลวิเคราะห์ทันที"
              : "Fill in rough figures across 3 steps, or tap an example below to see instant results."}
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
                    key: "restaurant_overdue" as const,
                    th: "ร้านอาหารค้างชำระ 1–4 เดือน",
                    en: "Restaurant 31 to 120d",
                    onClick: () => applyPreset("restaurant_overdue"),
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

        <div
          className={
            diagnostic
              ? "grid items-start gap-5 lg:grid-cols-[5fr_7fr]"
              : "mx-auto max-w-2xl"
          }
        >
          {/* Left Sticky Control Column on Desktop holding the 3 Step Stepper and Live Summary Snapshot */}
          <div className={diagnostic ? "min-w-0 space-y-4 lg:sticky lg:top-24" : "min-w-0"}>
            {/* Connected 3 Step Horizontal Slide Wizard Form */}
            <motion.form
              ref={formRef}
              onSubmit={handleSubmit}
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.06 }}
              className="scroll-mt-24 rounded-[1.75rem] border border-border bg-card p-5 sm:p-6"
            >
            <div className="mb-4 flex items-start justify-between gap-2">
              <div>
                <h3 className="font-display text-base font-semibold text-foreground sm:text-lg">
                  {lang === "th" ? "ข้อมูลรายรับ รายจ่าย และภาระหนี้" : "Cashflow & Debt Inputs"}
                </h3>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground sm:text-sm">
                  {lang === "th"
                    ? "ต้นแบบสำหรับวางแผนเบื้องต้น · โปรดใช้ข้อมูลสมมติ"
                    : "Prototype for early planning · Please use sample data"}
                </p>
              </div>
              {hasAnyInput && (
                <button
                  type="button"
                  onClick={resetAllInputs}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <RotateCcw aria-hidden="true" className="size-3" />
                  {lang === "th" ? "เริ่มใหม่" : "Reset"}
                </button>
              )}
            </div>

            {/* Connected Circular Stepper Progress Bar */}
            <div
              role="tablist"
              aria-label={lang === "th" ? "ขั้นตอนการกรอกข้อมูล" : "Form steps"}
              className="mb-5 border-b border-border pb-4"
            >
              <div className="flex items-start justify-between">
                {(
                  [
                    { num: 1 as const, th: "สถานะและจังหวัด", en: "Profile & Status" },
                    { num: 2 as const, th: "รายรับและค่างวด", en: "Income & Debt" },
                    { num: 3 as const, th: "รายละเอียดหนี้", en: "Loan Details" },
                  ] as const
                ).map((step, idx) => {
                  const isActive = formStep === step.num
                  const isCompleted =
                    step.num < formStep || (step.num === 2 && Boolean(diagnostic) && formStep !== 2)
                  return (
                    <div key={step.num} className="flex flex-1 items-start last:flex-none">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => goToStep(step.num)}
                        className="group flex flex-col items-center gap-1.5 text-center focus:outline-none"
                      >
                        <span
                          className={`flex size-8 items-center justify-center rounded-full border-2 text-xs font-semibold transition-all ${
                            isActive
                              ? "border-foreground bg-foreground text-background shadow-sm"
                              : isCompleted
                                ? "border-foreground bg-foreground/10 text-foreground"
                                : "border-border bg-background text-muted-foreground group-hover:border-foreground/40 group-hover:text-foreground"
                          }`}
                        >
                          {isCompleted ? <Check aria-hidden="true" className="size-4" /> : step.num}
                        </span>
                        <span
                          className={`max-w-[92px] text-[11px] leading-tight sm:max-w-none ${
                            isActive
                              ? "font-semibold text-foreground"
                              : isCompleted
                                ? "font-medium text-foreground/80"
                                : "text-muted-foreground"
                          }`}
                        >
                          {lang === "th" ? step.th : step.en}
                        </span>
                      </button>

                      {idx < 2 && (
                        <div className="mx-1.5 mt-4 flex-1 sm:mx-3" aria-hidden="true">
                          <div className="h-[2px] w-full overflow-hidden rounded-full bg-border">
                            <div
                              className={`h-full transition-all duration-300 ${
                                formStep > step.num ? "w-full bg-foreground" : "w-0 bg-foreground"
                              }`}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="overflow-hidden">
              <AnimatePresence mode="wait" initial={false}>
                {formStep === 1 && (
                  <motion.div
                    key="step-1"
                    initial={{ opacity: 0, x: stepDir * 28 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: stepDir * -28 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="flex flex-col gap-4"
                  >
                    {/* User Mode Switcher */}
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

                    {/* Province and Optional Business Selector */}
                    <div className={`grid grid-cols-1 gap-3 ${userType === "business" ? "sm:grid-cols-2" : ""}`}>
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
                            className="h-10 w-full appearance-none rounded-xl border border-input bg-background bg-none px-3 pr-8 text-xs font-medium text-foreground outline-none transition focus:border-foreground/45"
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
                              className="h-10 w-full appearance-none rounded-xl border border-input bg-background bg-none px-3 pr-8 text-xs font-medium text-foreground outline-none transition focus:border-foreground/45"
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

                    {/* Live Provincial Risk Preview Linked Directly to Selected Province */}
                    <div
                      className={`rounded-xl border px-3 py-2.5 text-[11px] leading-5 ${
                        provincialAdvisory.hasActiveAlert
                          ? "border-amber-600/30 bg-amber-500/10 text-amber-950 dark:text-amber-200"
                          : "border-border bg-secondary/45 text-muted-foreground"
                      }`}
                    >
                      <p className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                        <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
                        {lang === "th"
                          ? `บริบทพื้นที่จังหวัด${selectedProvName} (ใช้ประกอบการคำนวณอัตโนมัติ)`
                          : `${selectedProvName} Local Context (Auto-Linked)`}
                      </p>
                      <p className="mt-0.5">
                        {lang === "th" ? provincialAdvisory.summaryTh : provincialAdvisory.summaryEn}
                      </p>
                    </div>

                    {/* Repayment Status Selector */}
                    <fieldset>
                      <legend className="mb-2 text-xs font-medium text-foreground">
                        {lang === "th"
                          ? "สถานะการผ่อนชำระในปัจจุบัน (เลือกเพื่อจับคู่ทางออกที่ตรงเงื่อนไข)"
                          : "Current Repayment Status (Select to match solutions)"}
                      </legend>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {DEBT_STATUS_OPTIONS.map((opt, idx) => {
                          const active = debtStatus === opt.id
                          const spanFull = idx === DEBT_STATUS_OPTIONS.length - 1
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              aria-pressed={active}
                              onClick={() => setDebtStatus(opt.id)}
                              className={`flex flex-col rounded-xl border px-3 py-2.5 text-left transition-colors ${
                                spanFull ? "sm:col-span-2" : ""
                              } ${
                                active
                                  ? "border-foreground bg-secondary/90 text-foreground"
                                  : "border-border bg-background text-muted-foreground hover:border-foreground/35 hover:text-foreground"
                              }`}
                            >
                              <span className="text-xs font-semibold text-foreground">
                                {lang === "th" ? opt.th : opt.en}
                              </span>
                              <span className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                                {lang === "th" ? opt.sub_th : opt.sub_en}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </fieldset>

                    <div className="flex items-center justify-end border-t border-border pt-3">
                      <button
                        type="button"
                        onClick={() => goToStep(2)}
                        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-xs font-medium text-background transition-opacity hover:opacity-85 sm:w-auto"
                      >
                        <span>{lang === "th" ? "ถัดไป" : "Next"}</span>
                        <ArrowRight aria-hidden="true" className="size-3.5" />
                      </button>
                    </div>
                  </motion.div>
                )}

                {formStep === 2 && (
                  <motion.div
                    key="step-2"
                    initial={{ opacity: 0, x: stepDir * 28 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: stepDir * -28 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="flex flex-col gap-3.5"
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            value={formatMoneyInput(revenue)}
                            onChange={(e) => {
                              setActivePreset(null)
                              setStepValidationError(null)
                              setRevenue(formatMoneyInput(e.target.value))
                            }}
                            placeholder={lang === "th" ? "กรอกรายได้ต่อเดือน (ไม่มีใส่ 0)" : "Enter monthly income"}
                            className={`h-10 w-full rounded-xl border bg-background px-3 pr-11 text-sm font-medium text-foreground outline-none transition placeholder:text-xs placeholder:font-normal placeholder:text-muted-foreground/60 focus:border-foreground/45 focus:ring-2 focus:ring-foreground/10 ${
                              stepValidationError && !hasEnteredRevenue ? "border-red-500/75" : "border-input"
                            }`}
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                            {lang === "th" ? "บาท" : "THB"}
                          </span>
                        </div>
                      </div>
                      <div>
                        <label htmlFor="debt-payment" className="mb-1 block text-xs font-medium text-foreground">
                          {lang === "th"
                            ? extraLoans.length > 0
                              ? "ค่างวดหนี้รวม/เดือน (ถ้าทราบ)"
                              : "ค่างวดหนี้รวม/เดือน *"
                            : extraLoans.length > 0
                              ? "Total monthly debt payment (optional)"
                              : "Total monthly debt payment *"}
                        </label>
                        <div className="relative">
                          <input
                            id="debt-payment"
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            value={formatMoneyInput(debtPayment)}
                            onChange={(e) => {
                              setActivePreset(null)
                              setStepValidationError(null)
                              setDebtPayment(formatMoneyInput(e.target.value))
                            }}
                            placeholder={lang === "th" ? "กรอกค่างวดต่อเดือน" : "Enter monthly payment"}
                            className={`h-10 w-full rounded-xl border bg-background px-3 pr-11 text-sm font-medium text-foreground outline-none transition placeholder:text-xs placeholder:font-normal placeholder:text-muted-foreground/60 focus:border-foreground/45 focus:ring-2 focus:ring-foreground/10 ${
                              stepValidationError && numDebt <= 0 ? "border-red-500/75" : "border-input"
                            }`}
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                            {lang === "th" ? "บาท" : "THB"}
                          </span>
                        </div>
                        {extraLoans.length > 0 && (
                          <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                            {lang === "th"
                              ? "ถ้ากรอกยอดรวมด้านบน ระบบใช้ยอดนั้นครั้งเดียว ถ้าเว้นว่าง ระบบจะรวมค่างวดจากรายการหนี้ในขั้นที่ 3"
                              : "The total above is used once. If left blank, payments are totaled from Step 3 items."}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor="monthly-opex" className="mb-1 block text-xs font-medium text-foreground">
                          {lang === "th"
                            ? userType === "individual"
                              ? "ค่าใช้จ่ายจำเป็น/เดือน"
                              : "รายจ่ายดำเนินงานต่อเดือน"
                            : userType === "individual"
                              ? "Essential Living Cost/mo"
                              : "Monthly Operating Cost"}
                        </label>
                        <div className="relative">
                          <input
                            id="monthly-opex"
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            value={formatMoneyInput(opex)}
                            onChange={(e) => {
                              setActivePreset(null)
                              setOpex(formatMoneyInput(e.target.value))
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
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            value={formatMoneyInput(cashReserve)}
                            onChange={(e) => {
                              setActivePreset(null)
                              setCashReserve(formatMoneyInput(e.target.value))
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

                    {diagnostic && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-700/20 bg-emerald-700/5 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-300">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          {submitting ? (
                            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                          ) : (
                            <Check aria-hidden="true" className="size-3.5" />
                          )}
                          {lang === "th"
                            ? "คำนวณผลเบื้องต้นแล้ว กดถัดไปเพื่อใส่รายละเอียดหนี้เพิ่มได้"
                            : "Initial results are ready. Tap Next to add loan principal or rate."}
                        </span>
                        <button
                          type="button"
                          onClick={scrollToResults}
                          className="rounded-full bg-foreground px-3 py-1 text-[11px] font-medium text-background lg:hidden"
                        >
                          {lang === "th" ? "ดูผลวิเคราะห์ด้านล่าง ↓" : "View results ↓"}
                        </button>
                      </div>
                    )}

                    {stepValidationError && (
                      <div
                        role="alert"
                        className="rounded-xl border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-800"
                      >
                        {stepValidationError}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                      <button
                        type="button"
                        onClick={() => goToStep(1)}
                        className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-background px-4 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                      >
                        <ArrowLeft aria-hidden="true" className="size-3.5" />
                        <span>{lang === "th" ? "ย้อนกลับ" : "Back"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => goToStep(3)}
                        className="inline-flex h-10 items-center gap-2 rounded-full bg-foreground px-5 text-xs font-medium text-background transition-opacity hover:opacity-85"
                      >
                        <span>{lang === "th" ? "ถัดไป" : "Next"}</span>
                        <ArrowRight aria-hidden="true" className="size-3.5" />
                      </button>
                    </div>
                  </motion.div>
                )}

                {formStep === 3 && (
                  <motion.div
                    key="step-3"
                    initial={{ opacity: 0, x: stepDir * 28 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: stepDir * -28 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="flex flex-col gap-3.5"
                  >
                    {debtStatus !== "overdue_120_plus" ? (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label htmlFor="total-principal" className="mb-1 block text-xs font-medium text-foreground">
                            {lang === "th" ? "ยอดเงินต้นหนี้คงเหลือรวม (ถ้าทราบ)" : "Total Debt Principal (Optional)"}
                          </label>
                          <div className="relative">
                            <input
                              id="total-principal"
                              type="text"
                              inputMode="numeric"
                              autoComplete="off"
                              value={formatMoneyInput(totalPrincipal)}
                              onChange={(e) => setTotalPrincipal(formatMoneyInput(e.target.value))}
                              placeholder={lang === "th" ? "กรอกยอดเงินต้นคงเหลือ" : "Enter total principal"}
                              className="h-10 w-full rounded-xl border border-input bg-background px-3 pr-11 text-sm text-foreground outline-none transition placeholder:text-xs placeholder:text-muted-foreground/60 focus:border-foreground/45 focus:ring-2 focus:ring-foreground/10"
                            />
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                              {lang === "th" ? "บาท" : "THB"}
                            </span>
                          </div>
                          {extraLoans.length > 0 && (
                            <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                              {lang === "th"
                                ? "ถ้ากรอกยอดเงินต้นรวมด้านบน ระบบใช้ยอดนั้นครั้งเดียว ถ้าเว้นว่างจะรวมเงินต้นจากรายการด้านล่าง"
                                : "The total principal above is used once. If left blank, principal is totaled from the items below."}
                            </p>
                          )}
                        </div>

                        <div>
                          <label htmlFor="annual-rate" className="mb-1 block text-xs font-medium text-foreground">
                            {lang === "th" ? "ดอกเบี้ยสัญญาเดิม (%/ปี · ถ้าทราบ)" : "Current Interest Rate (% p.a. · optional)"}
                          </label>
                          <div className="relative">
                            <input
                              id="annual-rate"
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={annualRateInput}
                              onChange={(e) => setAnnualRateInput(e.target.value.replace(/[^\d.]/g, ""))}
                              placeholder={lang === "th" ? "เว้นว่างใช้ค่าสมมติฐาน" : "Leave blank for assumed rate"}
                              className="h-10 w-full rounded-xl border border-input bg-background px-3 pr-10 text-sm text-foreground outline-none transition placeholder:text-xs placeholder:text-muted-foreground/60 focus:border-foreground/45 focus:ring-2 focus:ring-foreground/10"
                            />
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                              %
                            </span>
                          </div>
                          {numAnnualRate != null && numAnnualRate > 0 && numAnnualRate < 1 && (
                            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1.5 rounded-lg border border-amber-600/35 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-4 text-amber-950">
                              <span>
                                {lang === "th"
                                  ? `กรอก ${formatRatePct(numAnnualRate)}% ต่อปี (ต่ำกว่า 1%) — หากหมายถึง ${formatRatePct(numAnnualRate * 100)}% ต่อปี`
                                  : `Entered ${formatRatePct(numAnnualRate)}% p.a. (< 1%) — did you mean ${formatRatePct(numAnnualRate * 100)}% p.a.?`}
                              </span>
                              <button
                                type="button"
                                onClick={() => setAnnualRateInput(String(Number((numAnnualRate * 100).toFixed(2))))}
                                className="rounded-full bg-foreground px-2.5 py-0.5 text-[10px] font-semibold text-background hover:opacity-90"
                              >
                                {lang === "th"
                                  ? `ใช้ ${formatRatePct(numAnnualRate * 100)}%`
                                  : `Use ${formatRatePct(numAnnualRate * 100)}%`}
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="sm:col-span-2">
                          <label htmlFor="horizon-years" className="mb-1 block text-xs font-medium text-foreground">
                            {lang === "th" ? "ระยะเวลาจำลองแผน (ปี)" : "Plan Simulation Period (Years)"}
                          </label>
                          <div className="max-w-sm">
                            <select
                              id="horizon-years"
                              value={horizonYears}
                              onChange={(e) => setHorizonYears(Math.max(1, Math.min(maxHorizonYears, Number(e.target.value) || 5)))}
                              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm font-medium text-foreground outline-none focus:border-foreground/45 focus:ring-2 focus:ring-foreground/10"
                            >
                              {Array.from({ length: maxHorizonYears }, (_, i) => i + 1).map((yr) => (
                                <option key={yr} value={yr}>
                                  {yr} {lang === "th" ? "ปี" : yr === 1 ? "year" : "years"}
                                </option>
                              ))}
                            </select>
                            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                              {lang === "th"
                                ? debtStatus === "persistent"
                                  ? "เลือกได้ไม่เกิน 7 ปีตามหลักเกณฑ์ ธปท. ที่ปรับปรุงในปี 2568 ตัวเลขนี้ใช้จำลองแผน ไม่ใช่การยืนยันสิทธิ์หรือเงื่อนไขจากเจ้าหนี้"
                                  : "เลือกปีที่ต้องการดูในตารางจำลอง ไม่ใช่ระยะเวลาที่เจ้าหนี้อนุมัติแน่นอน"
                                : debtStatus === "persistent"
                                  ? "Limited to 7 years under the BOT rules updated in 2025. This is a simulation, not confirmed eligibility or lender terms."
                                  : "Choose the period to display in the simulation. It is not a guaranteed lender-approved term."}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-amber-600/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-950">
                        {lang === "th"
                          ? "สำหรับสถานะค้างชำระเกิน 4 เดือน (บัตรเครดิต/สินเชื่อบุคคล) ระบบจะส่งต่อแนวทางคัดกรองคลินิกแก้หนี้และโครงการปิดหนี้ไว ไปต่อได้โดยตรง คุณสามารถเพิ่มรายการหนี้ด้านล่างเพื่อรวมยอดได้"
                          : "For unsecured debt overdue > 120 days, the system guides you to Debt Clinic by SAM and Fast-Close screening directly. You may list multiple debts below to sum balances."}
                      </div>
                    )}

                    {/* Optional Multi Loan Breakdown */}
                    <div className="rounded-2xl border border-dashed border-border bg-secondary/20 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium text-foreground">
                            {lang === "th"
                              ? extraLoans.length > 0
                                ? `รายการหนี้ที่เพิ่ม ${extraLoans.length} ก้อน`
                                : "มีหนี้หลายก้อน? เพิ่มรายการเพื่อช่วยรวมยอด"
                              : extraLoans.length > 0
                                ? `${extraLoans.length} additional debt items`
                                : "Have multiple loans? Add items to total them."}
                          </p>
                          {extraLoans.length > 0 && (
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              {lang === "th"
                                ? `รวมค่างวดทั้งหมด ${numDebt.toLocaleString()} บาท/เดือน · เงินต้นที่ระบุ ${numPrincipal.toLocaleString()} บาท`
                                : `Combined payment ${numDebt.toLocaleString()} THB/mo · entered principal ${numPrincipal.toLocaleString()} THB`}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => addExtraLoan("card")}
                          className="min-h-9 shrink-0 rounded-full border border-border bg-background px-3 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
                        >
                          {lang === "th" ? "+ เพิ่มรายการหนี้" : "+ Add debt item"}
                        </button>
                      </div>

                      {extraLoans.length > 0 && (
                        <div className="mt-3 space-y-2.5">
                          {extraLoans.map((loan, idx) => (
                            <div key={loan.id} className="rounded-xl border border-border bg-background p-2.5">
                              <div className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 text-[11px] font-medium text-foreground">
                                  {lang === "th" ? `หนี้ก้อนที่ ${idx + 1}` : `Debt item ${idx + 1}`}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeExtraLoan(loan.id)}
                                  aria-label={lang === "th" ? `ลบหนี้ก้อนที่ ${idx + 1}` : `Remove debt item ${idx + 1}`}
                                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
                                >
                                  ✕
                                </button>
                              </div>
                              <label className="mt-1 block text-[10px] text-muted-foreground">
                                {lang === "th" ? "ประเภทหนี้" : "Debt type"}
                                <select
                                  aria-label={`${lang === "th" ? "ประเภทหนี้ก้อนที่" : "Debt item type"} ${idx + 1}`}
                                  value={loan.category}
                                  onChange={(e) =>
                                    updateExtraLoan(loan.id, { category: e.target.value as LoanCategory })
                                  }
                                  className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-xs text-foreground outline-none focus:border-foreground/45"
                                >
                                  <option value="card">{lang === "th" ? "บัตร/สินเชื่อบุคคล" : "Card / Personal"}</option>
                                  <option value="auto">{lang === "th" ? "สินเชื่อรถ" : "Auto Loan"}</option>
                                  <option value="home">{lang === "th" ? "สินเชื่อบ้าน" : "Home Loan"}</option>
                                  <option value="sme">{lang === "th" ? "สินเชื่อกิจการ" : "Business Loan"}</option>
                                  <option value="informal">{lang === "th" ? "หนี้นอกระบบ" : "Informal debt"}</option>
                                </select>
                              </label>
                              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <label className="block text-[10px] text-muted-foreground">
                                  {lang === "th" ? "ค่างวดต่อเดือน" : "Monthly payment"}
                                  <div className="relative mt-1">
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      value={formatMoneyInput(loan.monthlyPayment)}
                                      onChange={(e) =>
                                        updateExtraLoan(loan.id, { monthlyPayment: formatMoneyInput(e.target.value) })
                                      }
                                      placeholder="0"
                                      className="h-10 w-full rounded-lg border border-input bg-background px-3 pr-12 text-sm text-foreground outline-none focus:border-foreground/45"
                                    />
                                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px]">{lang === "th" ? "บาท" : "THB"}</span>
                                  </div>
                                </label>
                                <label className="block text-[10px] text-muted-foreground">
                                  {lang === "th" ? "เงินต้นคงเหลือ (ถ้าทราบ)" : "Remaining principal (optional)"}
                                  <div className="relative mt-1">
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      value={formatMoneyInput(loan.principal)}
                                      onChange={(e) =>
                                        updateExtraLoan(loan.id, { principal: formatMoneyInput(e.target.value) })
                                      }
                                      placeholder={lang === "th" ? "เว้นว่างได้" : "Optional"}
                                      className="h-10 w-full rounded-lg border border-input bg-background px-3 pr-12 text-sm text-foreground outline-none focus:border-foreground/45"
                                    />
                                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px]">{lang === "th" ? "บาท" : "THB"}</span>
                                  </div>
                                </label>
                              </div>
                            </div>
                          ))}
                          <p className="rounded-xl border border-amber-600/30 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-4 text-amber-950">
                            {lang === "th"
                              ? "ถ้ากรอกยอดรวมด้านบน ระบบใช้ยอดนั้นครั้งเดียวและใช้รายการด้านล่างเป็นรายละเอียด ถ้าเว้นยอดรวมว่าง ระบบจะรวมรายการให้ ประเภทหนี้ใช้ช่วยแยกรายการเท่านั้น ไม่ได้คำนวณดอกเบี้ยหรือเงื่อนไขแต่ละสัญญาแยกกัน"
                              : "If you enter a total above, it is used once and the items below are for breakdown. If left blank, the system totals the items."}
                          </p>
                        </div>
                      )}
                    </div>

                    <p className="rounded-xl border border-border/70 bg-secondary/20 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                      <strong className="font-medium text-foreground">
                        {lang === "th" ? "ประกาศความเป็นส่วนตัวและเส้นทางข้อมูล:" : "Data privacy & processing notice:"}
                      </strong>{" "}
                      {lang === "th"
                        ? "เครื่องมือจำลองค่างวดทำงานบนอุปกรณ์ แต่เมื่อส่งแบบประเมิน ระบบจะส่งรายรับ ค่างวด และข้อมูลที่จำเป็นไปยัง backend เพื่อคำนวณ DSR โดยไม่บันทึกยอดเงินเหล่านี้ลงฐานข้อมูลแบบประเมิน ระบบบันทึกเฉพาะสัญญาณสรุป เช่น จังหวัด ประเภทกิจการ และช่วงภาระหนี้ ข้อความแชตผ่าน backend และอาจส่งข้อความหรือบริบทบางส่วนให้ Google Gemini หลังตรวจจับและลบรูปแบบข้อมูลระบุตัวตน โปรดใช้ข้อมูลสมมติ"
                        : "The payment simulator runs in your browser. Submitting an assessment sends income, payment, and required fields to our backend to calculate DSR; those amounts are not written to the assessment database. We store summary signals such as province, business type, and DSR band. Chat messages pass through our backend and may be sent to Google Gemini after patterns resembling personal identifiers are detected and redacted. Please use sample data."}
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                      <button
                        type="button"
                        onClick={() => goToStep(2)}
                        className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-background px-4 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                      >
                        <ArrowLeft aria-hidden="true" className="size-3.5" />
                        <span>{lang === "th" ? "ย้อนกลับ" : "Back"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (!diagnostic) {
                            goToStep(2)
                          } else {
                            scrollToResults()
                          }
                        }}
                        className="inline-flex h-10 items-center gap-2 rounded-full bg-foreground px-5 text-xs font-medium text-background transition-opacity hover:opacity-85"
                      >
                        <Check aria-hidden="true" className="size-3.5" />
                        <span>
                          {diagnostic
                            ? lang === "th"
                              ? "ดูผลวิเคราะห์และแนวทางแก้หนี้"
                              : "View Diagnostic & Relief Plan"
                            : lang === "th"
                              ? "กลับไปกรอกรายรับและค่างวด"
                              : "Go to Income & Debt"}
                        </span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {apiError && (
              <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-600/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-200">
                <span>{apiError}</span>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() =>
                    void runBackendAssessment({
                      prov: selectedProvinceCode,
                      biz: business,
                      statusKey: debtStatus,
                      revVal: numRevenue,
                      debtVal: numDebt,
                    })
                  }
                  className="shrink-0 rounded-full border border-amber-700/35 bg-background px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
                >
                  {lang === "th" ? "ลองเชื่อมต่อใหม่" : "Retry"}
                </button>
              </div>
            )}
          </motion.form>

            {/* Desktop Live Input Snapshot and Quick Print Action underneath the Sticky Stepper */}
            {diagnostic && (
              <div className="hidden rounded-[1.75rem] border border-border bg-card p-5 lg:block">
                <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground">
                      {lang === "th" ? "สรุปตัวเลขที่กำลังคำนวณ" : "Active Calculation Snapshot"}
                    </p>
                    <p className="mt-0.5 text-xs font-semibold text-foreground">
                      {selectedProvName} ·{" "}
                      {DEBT_STATUS_OPTIONS.find((s) => s.id === debtStatus)?.[lang === "th" ? "th" : "en"]}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => goToStep(1)}
                    className="shrink-0 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    {lang === "th" ? "แก้สถานะ" : "Edit"}
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => goToStep(2)}
                    className="rounded-xl border border-border/70 bg-secondary/35 px-3 py-2 text-left transition-colors hover:border-foreground/35"
                  >
                    <span className="block text-[10px] text-muted-foreground">
                      {lang === "th" ? "รายได้ต่อเดือน" : "Monthly Income"}
                    </span>
                    <span className="mt-0.5 block text-xs font-semibold tabular-nums text-foreground">
                      {Math.round(diagnostic.monthlyRevenue).toLocaleString()} {lang === "th" ? "บาท" : "THB"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => goToStep(2)}
                    className="rounded-xl border border-border/70 bg-secondary/35 px-3 py-2 text-left transition-colors hover:border-foreground/35"
                  >
                    <span className="block text-[10px] text-muted-foreground">
                      {lang === "th" ? "ค่างวดหนี้รวม/เดือน" : "Monthly Debt"}
                    </span>
                    <span className="mt-0.5 block text-xs font-semibold tabular-nums text-foreground">
                      {Math.round(diagnostic.monthlyDebt).toLocaleString()} {lang === "th" ? "บาท" : "THB"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => goToStep(2)}
                    className="rounded-xl border border-border/70 bg-secondary/35 px-3 py-2 text-left transition-colors hover:border-foreground/35"
                  >
                    <span className="block text-[10px] text-muted-foreground">
                      {lang === "th" ? "ค่าใช้จ่ายจำเป็น" : "Essential Costs"}
                    </span>
                    <span className="mt-0.5 block text-xs font-semibold tabular-nums text-foreground">
                      {Math.round(diagnostic.monthlyOpex).toLocaleString()} {lang === "th" ? "บาท" : "THB"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => goToStep(2)}
                    className="rounded-xl border border-border/70 bg-secondary/35 px-3 py-2 text-left transition-colors hover:border-foreground/35"
                  >
                    <span className="block text-[10px] text-muted-foreground">
                      {lang === "th" ? "เงินเก็บสำรอง" : "Cash Reserve"}
                    </span>
                    <span className="mt-0.5 block text-xs font-semibold tabular-nums text-foreground">
                      {Math.round(diagnostic.cashReserve).toLocaleString()} {lang === "th" ? "บาท" : "THB"}
                    </span>
                  </button>
                </div>

                <div className="mt-3.5 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopySummary()}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-foreground px-4 text-xs font-medium text-background transition-opacity hover:opacity-85"
                  >
                    {copiedSummary ? (
                      <Check aria-hidden="true" className="size-3.5" />
                    ) : (
                      <Copy aria-hidden="true" className="size-3.5" />
                    )}
                    {copiedSummary
                      ? lang === "th"
                        ? "คัดลอกสรุปไว้เรียบร้อยแล้ว"
                        : "Summary Copied"
                      : lang === "th"
                        ? "คัดลอกสรุปและคำพูดคุยกับธนาคาร"
                        : "Copy Summary & Talking Points"}
                  </button>
                  <button
                    type="button"
                    onClick={openDossierModal}
                    className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-full border border-border bg-background px-4 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                  >
                    <FileText aria-hidden="true" className="size-3.5" />
                    {lang === "th" ? "ดูตัวอย่างเอกสารพร้อมพิมพ์ (ทางเลือกเสริม)" : "Preview Printable Notes (Optional)"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right Panel Shown Cleanly Only Once Numbers Are Entered or Example Selected */}
          {diagnostic && (
            <motion.div
              ref={resultPanelRef}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className={`scroll-mt-28 flex min-w-0 flex-col rounded-[1.75rem] border bg-secondary/45 p-5 transition-all duration-300 sm:p-6 ${
                resultFlash ? "border-teal-600 ring-2 ring-teal-600/25" : "border-border"
              }`}
            >
              <>
                {resultFlash && (
                  <div className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-teal-700 px-3 py-1 text-[11px] font-medium text-white">
                    <Check aria-hidden="true" className="size-3.5" />
                    {lang === "th" ? "อัปเดตผลคำนวณตามข้อมูลล่าสุดแล้ว" : "Updated with your latest numbers"}
                  </div>
                )}
                {/* 0. Plain Language Summary + Side by Side Payment Comparison for Parents and Citizens */}
                <div className="rounded-2xl border border-foreground/20 bg-background p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground">
                      {lang === "th" ? "สรุปผลให้เข้าใจง่ายๆ ตอนนี้" : "Easy-to-Read Summary"}
                    </p>
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
                          ? "ตอนนี้ยังจ่ายไหว"
                          : "Currently Affordable"
                        : lang === "th"
                          ? "ตอนนี้ค่างวดหนักเกินไป"
                          : "Payment Too Heavy"}
                    </span>
                  </div>

                  {/* Everyday Math Line */}
                  <div className="mt-3 rounded-xl bg-secondary/45 px-3.5 py-2.5 text-xs leading-6 text-foreground">
                    {lang === "th" ? (
                      <>
                        รับมาเดือนละ <strong>{Math.round(diagnostic.monthlyRevenue).toLocaleString()}</strong> บาท
                        {" − "}{userType === "business" ? "รายจ่ายกิจการ" : "ค่ากินอยู่/รายจ่าย"}{" "}
                        <strong>{Math.round(diagnostic.monthlyOpex).toLocaleString()}</strong> บาท
                        {" − "}จ่ายหนี้ <strong>{Math.round(diagnostic.monthlyDebt).toLocaleString()}</strong> บาท
                        {" = "}
                        <strong className={diagnostic.netMonthlyCashflow < 0 ? "text-red-700" : "text-teal-700"}>
                          {diagnostic.netMonthlyCashflow >= 0
                            ? `เหลือเดือนละ +${Math.round(diagnostic.netMonthlyCashflow).toLocaleString()} บาท`
                            : `เงินขาดมือเดือนละ ${Math.abs(Math.round(diagnostic.netMonthlyCashflow)).toLocaleString()} บาท`}
                        </strong>
                      </>
                    ) : (
                      <>
                        Income <strong>{Math.round(diagnostic.monthlyRevenue).toLocaleString()}</strong>
                        {" − "}Expenses <strong>{Math.round(diagnostic.monthlyOpex).toLocaleString()}</strong>
                        {" − "}Debt <strong>{Math.round(diagnostic.monthlyDebt).toLocaleString()}</strong>
                        {" = "}
                        <strong className={diagnostic.netMonthlyCashflow < 0 ? "text-red-700" : "text-teal-700"}>
                          {diagnostic.netMonthlyCashflow >= 0
                            ? `+${Math.round(diagnostic.netMonthlyCashflow).toLocaleString()} THB left/mo`
                            : `-${Math.abs(Math.round(diagnostic.netMonthlyCashflow)).toLocaleString()} THB short/mo`}
                        </strong>
                      </>
                    )}
                  </div>

                  {/* Two Big Side by Side Numbers */}
                  {loanComparison && debtStatus !== "overdue_120_plus" && (() => {
                    const isDisaster = loanComparison.mode === "disaster_defer"
                    const proposedPay = isDisaster
                      ? (loanComparison.policyGracePayment ?? loanComparison.policyYear1Payment)
                      : loanComparison.policyYear1Payment
                    const savedMonthly = Math.max(0, loanComparison.originalMonthlyPayment - proposedPay)
                    return (
                      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                        <div className="rounded-xl border border-border bg-secondary/25 px-4 py-3">
                          <p className="text-[11px] text-muted-foreground">
                            {lang === "th" ? "ตอนนี้จ่ายอยู่เดือนละ" : "Current Payment / Month"}
                          </p>
                          <p className="mt-1 font-display text-xl font-semibold tabular-nums text-foreground">
                            {loanComparison.originalMonthlyPayment.toLocaleString()} {lang === "th" ? "บาท" : "THB"}
                          </p>
                        </div>
                        <div className="rounded-xl border border-teal-700/25 bg-teal-700/5 px-4 py-3">
                          <p className="text-[11px] text-teal-900">
                            {lang === "th" ? "ถ้าขอปรับแผนแล้ว จ่ายเดือนละ" : "Target Plan Payment / Month"}
                          </p>
                          <p className="mt-1 font-display text-xl font-semibold tabular-nums text-teal-800">
                            {proposedPay.toLocaleString()} {lang === "th" ? "บาท" : "THB"}
                          </p>
                          {savedMonthly > 0 && (
                            <p className="mt-0.5 text-[11px] font-medium text-teal-800">
                              {lang === "th"
                                ? `เบาลงเดือนละ ${savedMonthly.toLocaleString()} บาท`
                                : `Saves ${savedMonthly.toLocaleString()} THB/mo`}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })()}

                  {/* 3 Bullet Plain Action Guidance */}
                  <ul className="mt-3 space-y-1.5 text-xs leading-6 text-muted-foreground">
                    {provincialAdvisory.safeSeasonalCap != null && (
                      <li>
                        <strong className="text-foreground">
                          {lang === "th" ? "• เผื่อช่วงรายได้ลดในจังหวัด" + selectedProvName + ": " : `• ${selectedProvName} Slow-Month Buffer: `}
                        </strong>
                        {provincialAdvisory.safeSeasonalCap > 0
                          ? lang === "th"
                            ? `ตัวอย่างสมมติ: หากรายรับลดลง ${provincialAdvisory.suggestedDropPct}% จะเหลือเงินหลังหักค่าใช้จ่ายก่อนจ่ายหนี้ประมาณ ${provincialAdvisory.safeSeasonalCap.toLocaleString()} บาท/เดือน ยังไม่หักค่างวดหรือเงินสำรอง ตัวเลขนี้อิงสัญญาณฤดูกาลของจังหวัด ไม่ใช่การพยากรณ์รายได้จริง`
                            : `Illustrative scenario: if revenue fell ${provincialAdvisory.suggestedDropPct}%, about ${provincialAdvisory.safeSeasonalCap.toLocaleString()} THB/mo would remain after expenses, before debt payments and reserves. This uses a provincial seasonal signal, not an income forecast.`
                          : lang === "th"
                            ? "ในตัวอย่างนี้รายรับหลังหักค่าใช้จ่ายไม่เหลือก่อนจ่ายหนี้ ควรทบทวนตัวเลขจริงและสอบถามเจ้าหนี้ถึงทางเลือกที่มี โดยตรวจสอบเงื่อนไขเป็นรายกรณี"
                            : "In this scenario, no cash remains after expenses and before debt payments. Review actual figures and ask the lender which options are available; terms vary by case."}
                      </li>
                    )}
                    {matchedPrograms[0] && (
                      <li>
                        <strong className="text-foreground">
                          {lang === "th" ? "• ช่องทางที่ควรติดต่อก่อน: " : "• First Place to Contact: "}
                        </strong>
                        {lang === "th" ? matchedPrograms[0].title_th : matchedPrograms[0].title_en}
                      </li>
                    )}
                  </ul>
                </div>

                {/* Friendly Bank Negotiation Card */}
                {negotiationGuide && (
                  <div className="mt-4 rounded-2xl border border-border bg-background p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="max-w-md">
                        <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                          <MessageSquareText aria-hidden="true" className="size-4" />
                          {lang === "th"
                            ? "จะเริ่มคุยกับธนาคารยังไงดี? (คัดลอกไปใช้ได้เลย)"
                            : "What to Say When Contacting Your Bank"}
                        </p>
                        <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                          {lang === "th"
                            ? "ใช้ข้อความนี้เวลาโทรเข้าศูนย์บริการลูกค้าหรือส่งข้อความคุยกับเจ้าหน้าที่ได้เลย"
                            : "Copy this personalized script for phone calls or chat with your lender."}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCopySummary()}
                        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-foreground px-4 text-xs font-medium text-background transition-opacity hover:opacity-85"
                      >
                        {copiedSummary ? (
                          <Check aria-hidden="true" className="size-3.5" />
                        ) : (
                          <Copy aria-hidden="true" className="size-3.5" />
                        )}
                        {copiedSummary
                          ? lang === "th"
                            ? "คัดลอกเรียบร้อยแล้ว"
                            : "Copied"
                          : lang === "th"
                            ? "คัดลอกข้อความนี้"
                            : "Copy Script"}
                      </button>
                    </div>

                    <div className="mt-3 rounded-xl border border-border bg-secondary/35 p-3.5 text-xs leading-6 text-foreground">
                      &ldquo;{lang === "th" ? negotiationGuide.openingTh : negotiationGuide.openingEn}&rdquo;
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        aria-expanded={showBankQuestions}
                        onClick={() => setShowBankQuestions((open) => !open)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        <span>
                          {showBankQuestions
                            ? lang === "th"
                              ? "ซ่อนคำถามที่ควรถามเจ้าหน้าที่"
                              : "Hide questions to ask"
                            : lang === "th"
                              ? "ดูคำถามที่ควรถามเจ้าหน้าที่ (4 ข้อ)"
                              : "View 4 questions to ask"}
                        </span>
                        <ChevronDown
                          aria-hidden="true"
                          className={`size-3.5 transition-transform ${showBankQuestions ? "rotate-180" : ""}`}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={openDossierModal}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
                      >
                        <FileText aria-hidden="true" className="size-3.5" />
                        {lang === "th" ? "ดูเอกสารพร้อมพิมพ์ (ทางเลือกเสริม)" : "Printable Notes"}
                      </button>
                    </div>

                    {showBankQuestions && (
                      <ul className="mt-3 space-y-1.5 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
                        {(lang === "th" ? negotiationGuide.questionsTh : negotiationGuide.questionsEn).map((q, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-foreground">
                              {idx + 1}
                            </span>
                            <span>{q}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Priority #1 Official Program or Lender Step Direct Action Card */}
                {matchedPrograms[0] && (
                  <div className="mt-4 rounded-2xl border border-border bg-background p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="rounded-full bg-foreground px-2.5 py-0.5 text-[10px] font-semibold text-background">
                        {["debt_clinic", "fast_debt_exit_sam", "persistent_debt", "credit_boost_tcg"].includes(
                          matchedPrograms[0].id,
                        )
                          ? lang === "th"
                            ? "โครงการที่แนะนำให้ติดต่อก่อน"
                            : "Priority Program to Contact"
                          : lang === "th"
                            ? "แนวทางที่แนะนำให้เริ่มก่อน"
                            : "Priority Step to Start With"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {lang === "th" ? matchedPrograms[0].badge_th : matchedPrograms[0].badge_en}
                      </span>
                    </div>
                    <h4 className="mt-2 font-display text-sm font-semibold text-foreground">
                      {lang === "th" ? matchedPrograms[0].title_th : matchedPrograms[0].title_en}
                    </h4>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {lang === "th" ? matchedPrograms[0].benefit_th : matchedPrograms[0].benefit_en}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <a
                        href={matchedPrograms[0].action_href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background transition-opacity hover:opacity-85"
                      >
                        {lang === "th" ? matchedPrograms[0].action_label_th : matchedPrograms[0].action_label_en}
                        <ArrowUpRight aria-hidden="true" className="size-3.5" />
                      </a>
                    </div>
                  </div>
                )}

                {/* Single Clean Toggle for Detailed Banking Numbers, Stress Test, Charts & Policy Docs */}
                <button
                  type="button"
                  aria-expanded={showAdvancedDetails}
                  onClick={() => setShowAdvancedDetails((open) => !open)}
                  className="mt-4 flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-background px-4 py-3 text-left text-xs font-medium text-foreground transition-colors hover:bg-secondary/60"
                >
                  <span>
                    {showAdvancedDetails
                      ? lang === "th"
                        ? "ซ่อนรายละเอียดตัวเลขเชิงลึกและกราฟ"
                        : "Hide detailed numbers, charts & documents"
                      : lang === "th"
                        ? "ดูรายละเอียดตัวเลขเพิ่มเติม (จำลองรายได้ลด · กราฟ · เทียบ 4 ทางเลือก · เอกสารทางการ)"
                        : "View detailed numbers (stress test, charts, 4 options & official docs)"}
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`size-4 shrink-0 text-muted-foreground transition-transform ${showAdvancedDetails ? "rotate-180" : ""}`}
                  />
                </button>

                {showAdvancedDetails && (
                  <div className="mt-4">
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
                          ? `เงินเหลือหลังหักค่าใช้จ่ายจำเป็น ${Math.round(diagnostic.operatingCashflow).toLocaleString()} บาท · ค่างวดคิดเป็น ${diagnostic.dsrPct != null ? `${diagnostic.dsrPct.toFixed(1)}% ของรายได้รวม` : "คำนวณไม่ได้ (ไม่มีรายได้)"}`
                          : `Post-expense CF ${Math.round(diagnostic.operatingCashflow).toLocaleString()} · Gross-income DSR ${diagnostic.dsrPct != null ? `${diagnostic.dsrPct.toFixed(1)}%` : "Undefined (Zero Income)"}`}
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

                  {/* Provincial Context & Income-Drop Scenario */}
                  <div className="mt-3.5 rounded-xl border border-sky-700/20 bg-sky-500/5 p-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                          <MapPin aria-hidden="true" className="size-3.5 shrink-0 text-sky-700" />
                          {lang === "th"
                            ? `ข้อมูลจังหวัด${selectedProvName}ประกอบตัวอย่างรายได้ลด`
                            : `${selectedProvName} Context for the Income-Drop Example`}
                        </p>
                        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                          {lang === "th" ? provincialAdvisory.summaryTh : provincialAdvisory.summaryEn}
                        </p>
                        {provincialAdvisory.safeSeasonalCap != null && (
                          <p className="mt-1.5 text-xs leading-5 text-foreground">
                            {provincialAdvisory.safeSeasonalCap > 0 ? (
                              lang === "th" ? (
                                <>
                                  ในตัวอย่างสมมติ หากรายรับลดลงราว {provincialAdvisory.suggestedDropPct}% จะเหลือเงินจากรายรับหลังหักค่าใช้จ่ายกิจการก่อนจ่ายหนี้ประมาณ{" "}
                                  <strong className="font-semibold text-teal-800">
                                    {provincialAdvisory.safeSeasonalCap.toLocaleString()} บาทต่อเดือน
                                  </strong>{" "}
                                  ตัวเลขนี้ยังไม่หักค่างวดหนี้และเงินสำรอง จึงไม่ใช่ยอดค่างวดที่แนะนำ
                                </>
                              ) : (
                                <>
                                  In this illustrative scenario, if revenue falls ~{provincialAdvisory.suggestedDropPct}%, estimated cash after operating expenses but before debt payments is{" "}
                                  <strong className="font-semibold text-teal-800">
                                    ~{provincialAdvisory.safeSeasonalCap.toLocaleString()} THB/mo
                                  </strong>{" "}
                                  This does not account for debt payments or reserves and is not a recommended payment amount.
                                </>
                              )
                            ) : lang === "th" ? (
                              <>
                                ในตัวอย่างสมมติ รายรับหลังหักค่าใช้จ่ายกิจการจะไม่เหลือก่อนนำไปจ่ายหนี้ ควรทบทวนตัวเลขจริงและสอบถามเจ้าหนี้ถึงทางเลือกที่มี โดยตรวจสอบเงื่อนไขเป็นรายกรณี
                              </>
                            ) : (
                              <>
                                In this illustrative scenario, revenue after operating expenses would leave no cash before debt payments. Review actual figures and ask your lender which options are available; terms are case-specific.
                              </>
                            )}
                          </p>
                        )}
                      </div>
                      {stressDropPct !== provincialAdvisory.suggestedDropPct && (
                        <button
                          type="button"
                          onClick={() => setStressDropPct(provincialAdvisory.suggestedDropPct)}
                          className="shrink-0 rounded-full border border-border bg-background px-3 py-1 text-[10px] font-medium text-foreground transition-colors hover:bg-secondary"
                        >
                          {lang === "th"
                            ? `ใช้เกณฑ์จังหวัดนี้ (-${provincialAdvisory.suggestedDropPct}%)`
                            : `Apply -${provincialAdvisory.suggestedDropPct}% dip`}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Interactive Revenue Drop Simulation */}
                  <div className="mt-3 rounded-xl border border-amber-600/25 bg-amber-500/5 p-3.5">
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

                <div>
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
                      {loanComparison.mode === "step_up_illustration" && (
                        <p className="mt-1 text-[11px] font-medium text-amber-800">
                          {lang === "th"
                            ? "ตัวเลข 50% / 70% / 90% เป็นสมมติฐานเพื่อเปรียบเทียบเท่านั้น ไม่ใช่เงื่อนไขมาตรการหรือข้อเสนอจากเจ้าหนี้"
                            : "The 50% / 70% / 90% figures are comparison assumptions only, not program terms or an offer from a lender."}
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

                      {(() => {
                        const isDisaster = loanComparison.mode === "disaster_defer"
                        const gMonths = loanComparison.graceMonths ?? deferMonths
                        const activePayment = isDisaster
                          ? (loanComparison.policyGracePayment ?? loanComparison.policyYear1Payment)
                          : loanComparison.policyYear1Payment
                        const activeRelief = Math.max(0, loanComparison.originalMonthlyPayment - activePayment)

                        return (
                          <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
                            <SimBox
                              label={
                                lang === "th"
                                  ? isDisaster
                                    ? `ค่างวดช่วงพักต้น (${gMonths} เดือนแรก)`
                                    : "ค่างวดใหม่ (ปีที่ 1)"
                                  : isDisaster
                                    ? `Grace Period Payment (${gMonths}m)`
                                    : "Proposed Yr 1 Payment"
                              }
                              value={`${activePayment.toLocaleString()} ${lang === "th" ? "บาท" : "THB"}`}
                              accent
                            />
                            <SimBox
                              label={
                                lang === "th"
                                  ? isDisaster
                                    ? `เงินสดเหลือเพิ่มช่วงพักต้น (${gMonths} เดือนแรก)`
                                    : "เงินสดเหลือเพิ่มในมือ/เดือน"
                                  : isDisaster
                                    ? `Grace Period Cash Relief (${gMonths}m)`
                                    : "Monthly Cash Relief"
                              }
                              value={
                                activeRelief > 0
                                  ? `+${activeRelief.toLocaleString()} ${lang === "th" ? "บาท" : "THB"}`
                                  : lang === "th"
                                    ? "หักเงินต้นเร็วขึ้น"
                                    : "Faster Paydown"
                              }
                            />
                            <SimBox
                              label={
                                lang === "th"
                                  ? loanComparison.totalInterestSaved <= 0
                                    ? "วัตถุประสงค์หลักของแผนจำลอง"
                                    : loanComparison.usesAssumedRate
                                      ? `ประมาณการส่วนต่างดอกเบี้ย (สมมติฐาน ${formatRatePct(loanComparison.originalRatePct)}%/ปี)`
                                      : `ประมาณการส่วนต่างดอกเบี้ย (ดอกเบี้ยที่กรอก ${formatRatePct(loanComparison.originalRatePct)}%/ปี)`
                                  : loanComparison.totalInterestSaved <= 0
                                    ? "Primary Scenario Purpose"
                                    : loanComparison.usesAssumedRate
                                      ? `Est. Interest Diff (Assumed ${formatRatePct(loanComparison.originalRatePct)}%)`
                                      : `Est. Interest Diff (Entered ${formatRatePct(loanComparison.originalRatePct)}%)`
                              }
                              value={
                                loanComparison.totalInterestSaved <= 0
                                  ? lang === "th"
                                    ? "เน้นพักเงินสดชั่วคราว"
                                    : "Temporary Cash Relief"
                                  : `${loanComparison.totalInterestSaved.toLocaleString()} ${lang === "th" ? "บาท" : "THB"}`
                              }
                              accent
                            />
                          </div>
                        )
                      })()}

                      {/* Side by Side Monthly Payment Bar Chart Collapsed by Default for Clarity */}
                      <div className="mt-4 border-t border-border pt-3">
                        <button
                          type="button"
                          aria-expanded={showDetailedChart}
                          onClick={() => setShowDetailedChart((open) => !open)}
                          className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-secondary/35 px-3.5 py-2.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-secondary/70"
                        >
                          <span>
                            {showDetailedChart
                              ? lang === "th"
                                ? "ซ่อนกราฟเปรียบเทียบค่างวดรายปี"
                                : "Hide yearly installment chart"
                              : lang === "th"
                                ? "ดูกราฟเปรียบเทียบค่างวดรายปีและคำอธิบายเพิ่มเติม"
                                : "View yearly installment chart & breakdown"}
                          </span>
                          <ChevronDown
                            aria-hidden="true"
                            className={`size-4 shrink-0 transition-transform ${showDetailedChart ? "rotate-180" : ""}`}
                          />
                        </button>

                        {showDetailedChart && (
                          <div className="mt-3">
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
                              {(() => {
                                const isDisaster = loanComparison.mode === "disaster_defer"
                                const gMonths = loanComparison.graceMonths ?? deferMonths
                                const activePayment = isDisaster
                                  ? (loanComparison.policyGracePayment ?? loanComparison.policyYear1Payment)
                                  : loanComparison.policyYear1Payment
                                const activeRelief = Math.max(0, loanComparison.originalMonthlyPayment - activePayment)
                                const periodLabelTh = isDisaster ? `ช่วงพักเงินต้น ${gMonths} เดือนแรก` : "ปีแรก"

                                return (
                                  <>
                                    <p className="mt-1 text-muted-foreground">
                                      {lang === "th"
                                        ? diagnostic.netMonthlyCashflow < 0
                                          ? `1. แก้ปัญหาเงินสดติดลบรายเดือน: เดิมมีเงินเหลือหลังหักค่าใช้จ่าย ${Math.round(diagnostic.operatingCashflow).toLocaleString()} บาท/เดือน แต่ต้องจ่ายค่างวดเดิม ${loanComparison.originalMonthlyPayment.toLocaleString()} บาท/เดือน (ทำให้เงินขาดมือ ${Math.abs(Math.round(diagnostic.netMonthlyCashflow)).toLocaleString()} บาททุกเดือน) เมื่อลดค่างวด${periodLabelTh}เหลือ ${activePayment.toLocaleString()} บาท/เดือน จะทำให้จ่ายหนี้ไหวและพลิกกลับมามีเงินเหลือ ${Math.round(diagnostic.operatingCashflow - activePayment).toLocaleString()} บาท/เดือน`
                                          : `1. เพิ่มสภาพคล่องหมุนเวียนทันที: ลดภาระค่างวด${periodLabelTh}จาก ${loanComparison.originalMonthlyPayment.toLocaleString()} บาท เหลือ ${activePayment.toLocaleString()} บาท/เดือน ทำให้มีเงินสดเหลือในมือเพิ่มขึ้น +${activeRelief.toLocaleString()} บาท/เดือน สำหรับสำรองรับ${lowSeasonPhraseTh}`
                                        : `Reduces ${isDisaster ? `first ${gMonths}-month grace period` : "Year 1"} monthly installment from ${loanComparison.originalMonthlyPayment.toLocaleString()} to ${activePayment.toLocaleString()} THB/mo, freeing +${activeRelief.toLocaleString()} THB/mo in working capital.`}
                                    </p>
                                    <p className="mt-0.5 text-muted-foreground">
                                      {loanComparison.totalInterestSaved <= 0
                                        ? lang === "th"
                                          ? "2. ข้อเท็จจริงด้านดอกเบี้ยและการผ่อนชำระ: มาตรการนี้เป็นการชะลอภาระเงินสดฉุกเฉินชั่วคราว ดอกเบี้ยยังคงคำนวณตามสัญญาปกติ จึงไม่ได้ลดยอดดอกเบี้ยรวม (0 บาท) แต่มุ่งเน้นรักษาสภาพคล่องเพื่อฟื้นฟูกิจการ และป้องกันการเกิดหนี้เสียในระหว่างวิกฤต"
                                          : "2. Interest & Cashflow Reality: This measure provides temporary emergency liquidity relief. Interest continues as contractual without cumulative interest reduction (0 THB saved), focusing on preventing default during recovery."
                                        : lang === "th"
                                          ? `2. ลดภาระดอกเบี้ยระยะยาว: ตลอดแผนช่วยประหยัดดอกเบี้ยรวมประมาณ ${loanComparison.totalInterestSaved.toLocaleString()} บาท (จากเงินต้นตั้งต้น ${loanComparison.principalUsed.toLocaleString()} บาท)`
                                          : `2. Saves approximately ${loanComparison.totalInterestSaved.toLocaleString()} THB in cumulative interest over the plan horizon.`}
                                    </p>
                                  </>
                                )
                              })()}
                              {debtStatus === "disaster" && (
                                <p className="mt-1 font-medium text-amber-900">
                                  {lang === "th"
                                    ? "3. คำแนะนำการเตรียมหลักฐาน: เตรียมหลักฐานแสดงผลกระทบหรือรายได้ที่ลดลง (เช่น ใบเสร็จยอดขายย้อนหลัง รายการเดินบัญชี หรือภาพถ่ายพื้นที่ได้รับผลกระทบ) เพื่อประกอบการพิจารณาของธนาคาร"
                                    : "3. Evidence Tip: Prepare proof of income drop or hazard impact (past sales bills, bank statements, or site photos) for bank consideration."}
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                )}

                  {/* 2C. Side by Side Debt Relief Option Comparison Collapsible for Calm Reading */}
                  {scenarioRows.length > 0 && (
                    <div className="mt-4 rounded-2xl border border-border bg-background p-4 sm:p-5">
                      <button
                        type="button"
                        aria-expanded={showScenarioTable}
                        onClick={() => setShowScenarioTable((open) => !open)}
                        className="flex w-full items-center justify-between gap-3 text-left"
                      >
                        <div>
                          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            <Scale aria-hidden="true" className="size-3.5" />
                            {lang === "th"
                              ? "ตัวอย่างเปรียบเทียบทางเลือกแก้หนี้ 4 แบบ"
                              : "Compare 4 Debt Relief Paths & Trade Offs"}
                          </p>
                          <h4 className="mt-0.5 font-display text-sm font-semibold text-foreground sm:text-base">
                            {lang === "th"
                              ? "ดูข้อดี ข้อควรระวัง และผลต่อประวัติข้อมูลเครดิตของแต่ละวิธี"
                              : "View Advantages, Trade Offs & Credit Record Impact"}
                          </h4>
                        </div>
                        <ChevronDown
                          aria-hidden="true"
                          className={`size-4 shrink-0 text-muted-foreground transition-transform ${showScenarioTable ? "rotate-180" : ""}`}
                        />
                      </button>

                      {showScenarioTable && (
                        <div className="mt-3 space-y-2.5 border-t border-border pt-3">
                          <div className="rounded-lg border border-amber-600/25 bg-amber-500/5 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                            <p>{lang === "th" ? scenarioRows[0]?.principalBasisTh : scenarioRows[0]?.principalBasisEn}</p>
                            <p className="mt-1">
                              {lang === "th"
                                ? "แต่ละแบบใช้เงื่อนไขต่างกัน บางทางเลือกใช้เฉพาะหนี้บุคคลหรือผู้มีคุณสมบัติเฉพาะ ตัวเลขไม่ใช่ข้อเสนอจากเจ้าหนี้ และควรถามเรื่องค่างวดหลังพักกับผลต่อข้อมูลเครดิตก่อนตกลง"
                                : "The options use different terms. Some apply only to personal debt or specific eligible borrowers. These are not lender offers; confirm post-pause payments and credit reporting before agreeing."}
                            </p>
                          </div>
                          {scenarioRows.map((row) => (
                            <div
                              key={row.id}
                              className={`rounded-xl border p-3.5 transition-colors ${
                                row.matchesStatus
                                  ? "border-foreground/40 bg-secondary/50"
                                  : "border-border bg-secondary/20"
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-xs font-semibold text-foreground">
                                  {lang === "th" ? row.titleTh : row.titleEn}
                                </p>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {row.matchesStatus && (
                                    <span className="rounded-full bg-foreground px-2.5 py-0.5 text-[10px] font-medium text-background">
                                      {lang === "th" ? "ตรงกับสถานะที่คุณเลือก" : "Matches your status"}
                                    </span>
                                  )}
                                  <span className="rounded-full border border-border bg-background px-2.5 py-0.5 text-[10px] font-semibold tabular-nums text-teal-800">
                                    {lang === "th" ? row.estimatedMonthlyTh : row.estimatedMonthlyEn}
                                  </span>
                                </div>
                              </div>
                              <div className="mt-2 grid gap-2 text-[11px] leading-5 sm:grid-cols-3">
                                <div className="rounded-lg bg-background px-2.5 py-2">
                                  <span className="block text-[10px] font-semibold text-teal-800">
                                    {lang === "th" ? "ข้อดีหลัก" : "Main Advantage"}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {lang === "th" ? row.prosTh : row.prosEn}
                                  </span>
                                </div>
                                <div className="rounded-lg bg-background px-2.5 py-2">
                                  <span className="block text-[10px] font-semibold text-amber-800">
                                    {lang === "th" ? "ข้อควรระวัง" : "Trade Off"}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {lang === "th" ? row.tradeoffTh : row.tradeoffEn}
                                  </span>
                                </div>
                                <div className="rounded-lg bg-background px-2.5 py-2">
                                  <span className="block text-[10px] font-semibold text-foreground">
                                    {lang === "th" ? "ผลต่อประวัติข้อมูลเครดิต" : "Credit Bureau Impact"}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {lang === "th" ? row.creditImpactTh : row.creditImpactEn}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Additional Secondary Programs (only when there are more than 1 matched options) */}
                {matchedPrograms.length > 1 && (
                  <div className="mt-4 space-y-2.5">
                    <div className="px-1">
                      <h3 className="text-xs font-semibold text-foreground">
                        {lang === "th"
                          ? "ทางเลือกเสริมเพิ่มเติม (ตรวจสอบเงื่อนไขกับหน่วยงานทางการ)"
                          : "Additional Secondary Options (Verify with Official Agency)"}
                      </h3>
                    </div>
                    {matchedPrograms.slice(1).map((prog, idx) => (
                      <div key={prog.id} className="rounded-2xl border border-border bg-background p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-border bg-secondary px-2.5 py-0.5 text-[10px] font-semibold text-foreground">
                              {lang === "th" ? `ทางเลือกที่ ${idx + 2}` : `Option ${idx + 2}`}
                            </span>
                            <h4 className="font-display text-sm font-semibold text-foreground">
                              {lang === "th" ? prog.title_th : prog.title_en}
                            </h4>
                          </div>
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
                )}

                {/* Grounded Policy Note from Backend RAG */}
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
                  </div>
                )}

                {/* Mobile Quick Jump Back to Edit Any Step Without Manual Scrolling */}
                <div className="mt-4 rounded-2xl border border-border bg-background p-4 lg:hidden">
                  <p className="text-xs font-semibold text-foreground">
                    {lang === "th" ? "ต้องการแก้ไขข้อมูลที่กรอก?" : "Want to edit your inputs?"}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => editStepFromResults(1)}
                      className="inline-flex items-center rounded-full border border-border bg-secondary/45 px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                    >
                      {lang === "th" ? "แก้จังหวัด/สถานะ ↑" : "Edit Province/Status ↑"}
                    </button>
                    <button
                      type="button"
                      onClick={() => editStepFromResults(2)}
                      className="inline-flex items-center rounded-full border border-border bg-secondary/45 px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                    >
                      {lang === "th" ? "แก้รายรับ/ค่างวด ↑" : "Edit Income/Debt ↑"}
                    </button>
                    <button
                      type="button"
                      onClick={() => editStepFromResults(3)}
                      className="inline-flex items-center rounded-full border border-border bg-secondary/45 px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                    >
                      {lang === "th" ? "แก้เงินต้น/ดอกเบี้ย ↑" : "Edit Principal/Rate ↑"}
                    </button>
                  </div>
                </div>
              </>
            </motion.div>
          )}
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
                ? "ตัวอย่างบันทึกสรุปข้อมูลการเงินและแนวทางคุยกับธนาคาร"
                : "Personal Financial Summary & Negotiation Notes Preview"}
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
              <p className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground">
                {lang === "th"
                  ? "บันทึกช่วยจำส่วนตัวสำหรับเตรียมคุยกับเจ้าหนี้ (ไม่ใช่ใบคำร้องทางการของธนาคาร)"
                  : "Personal preparation notes for lender discussion (not an official bank form)"} ·{" "}
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
                  ? "สรุปข้อมูลการเงินและแนวทางเจรจาเบื้องต้น"
                  : "Financial Summary & Debt Negotiation Notes"}
              </h2>

              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-xl border border-border bg-secondary/25 px-3.5 py-2.5">
                  <p className="text-[10px] text-muted-foreground">
                    {lang === "th"
                      ? userType === "individual"
                        ? "รายได้ต่อเดือน / เงินเหลือหลังหักค่าใช้จ่าย"
                        : "รายได้ต่อเดือน / กำไรก่อนจ่ายหนี้"
                      : "Monthly Income / Pre-Debt Cashflow"}
                  </p>
                  <p className="mt-1 font-display text-base font-semibold tabular-nums text-foreground">
                    {Math.round(diagnostic.monthlyRevenue).toLocaleString()} {lang === "th" ? "บาท" : "THB"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {lang === "th"
                      ? `${userType === "individual" ? "เงินเหลือจ่ายหนี้ได้" : "กำไรก่อนหนี้"} ${Math.round(diagnostic.operatingCashflow).toLocaleString()} บาท/เดือน`
                      : `Pre-debt cashflow ${Math.round(diagnostic.operatingCashflow).toLocaleString()} THB/mo`}
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
                      ? `ค่างวดคิดเป็น ${diagnostic.dsrPct != null ? `${diagnostic.dsrPct.toFixed(1)}% ของรายได้รวม` : "คำนวณไม่ได้ (รายได้เป็น 0)"}`
                      : `Gross-income DSR ${diagnostic.dsrPct != null ? `${diagnostic.dsrPct.toFixed(1)}%` : "Undefined (Zero Income)"}`}
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

              <div className="mt-3.5 rounded-2xl border border-sky-700/20 bg-sky-500/5 px-4 py-3 text-xs leading-6 text-muted-foreground">
                <strong className="font-semibold text-foreground">
                  {lang === "th" ? `ข้อมูลประกอบระดับจังหวัด${selectedProvName}: ` : `${selectedProvName} provincial context: `}
                </strong>
                {lang === "th" ? provincialAdvisory.summaryTh : provincialAdvisory.summaryEn}
                {provincialAdvisory.safeSeasonalCap != null && provincialAdvisory.safeSeasonalCap > 0 && (
                  <span className="font-semibold text-teal-800">
                    {lang === "th"
                      ? ` · ตัวอย่างเงินจากรายรับหลังหักค่าใช้จ่ายก่อนจ่ายหนี้: ประมาณ ${provincialAdvisory.safeSeasonalCap.toLocaleString()} บาท/เดือน (ยังไม่หักค่างวดและเงินสำรอง ไม่ใช่ยอดที่แนะนำให้จ่าย)`
                      : ` · Illustrative cash after expenses before debt payments: about ${provincialAdvisory.safeSeasonalCap.toLocaleString()} THB/mo (debt payments and reserves not deducted; not a recommended payment)`}
                  </span>
                )}
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
                      ? `ตัวอย่างแนวทางขอปรับลดภาระค่างวดปีที่ 1 จาก ${loanComparison.originalMonthlyPayment.toLocaleString()} บาท/เดือน เหลือ ${loanComparison.policyYear1Payment.toLocaleString()} บาท/เดือน เพื่อให้สอดคล้องกับ${userType === "individual" ? "เงินเหลือหลังหักค่าใช้จ่ายจำเป็น" : "กำไรจากการดำเนินงาน"} (${Math.round(diagnostic.operatingCashflow).toLocaleString()} บาท/เดือน) ช่วยเพิ่มสภาพคล่องหมุนเวียน +${loanComparison.monthlyLiquiditySaved.toLocaleString()} บาท/เดือน และมีประมาณการส่วนต่างดอกเบี้ย${loanComparison.usesAssumedRate ? `ภายใต้สมมติฐานดอกเบี้ยเดิม ${loanComparison.originalRatePct.toFixed(1)}% ต่อปี` : `ตามดอกเบี้ยที่คุณกรอก ${loanComparison.originalRatePct.toFixed(1)}% ต่อปี`} ประมาณ ${loanComparison.totalInterestSaved.toLocaleString()} บาท${loanComparison.grossWaivedInterest ? ` (ตัวอย่างดอกเบี้ยพักชำระช่วง 3 ปีแรกประมาณ ${loanComparison.grossWaivedInterest.toLocaleString()} บาท)` : ""}${loanComparison.payoffMonthPol ? ` คาดว่าจะผ่อนครบภายในปีที่ ${Math.ceil(loanComparison.payoffMonthPol / 12)} (ทั้งนี้เงื่อนไขจริงขึ้นอยู่กับการอนุมัติของเจ้าหนี้)` : " (เงื่อนไขจริงขึ้นอยู่กับการพิจารณาของเจ้าหนี้)"}`
                      : `Illustrative Year 1 payment adjustment from ${loanComparison.originalMonthlyPayment.toLocaleString()} to ${loanComparison.policyYear1Payment.toLocaleString()} THB/mo, aligned with post-expense cashflow (${Math.round(diagnostic.operatingCashflow).toLocaleString()} THB/mo), freeing +${loanComparison.monthlyLiquiditySaved.toLocaleString()} THB/mo and yielding an estimated interest difference of ~${loanComparison.totalInterestSaved.toLocaleString()} THB (${loanComparison.usesAssumedRate ? `assumed ${loanComparison.originalRatePct.toFixed(1)}%` : `entered ${loanComparison.originalRatePct.toFixed(1)}%`} p.a. baseline)${loanComparison.grossWaivedInterest ? ` (~${loanComparison.grossWaivedInterest.toLocaleString()} THB illustrative freeze interest)` : ""}${loanComparison.payoffMonthPol ? `. Estimated payoff by Year ${Math.ceil(loanComparison.payoffMonthPol / 12)} (subject to lender approval).` : " (subject to lender approval)."}`}
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
                            {lang === "th" ? "ค่างวดใหม่ที่ตั้งเป้า/เดือน" : "Target Payment/mo"}
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

              {negotiationGuide && (
                <div className="mt-4 rounded-2xl border border-border bg-secondary/25 p-4 text-xs">
                  <h3 className="font-semibold text-foreground">
                    {lang === "th"
                      ? "3. ตัวอย่างคำพูดเริ่มต้นและคำถามที่ควรถามเจ้าหน้าที่ธนาคาร"
                      : "3. Opening Talking Points & Questions for Your Bank"}
                  </h3>
                  <p className="mt-1.5 leading-6 text-foreground">
                    &ldquo;{lang === "th" ? negotiationGuide.openingTh : negotiationGuide.openingEn}&rdquo;
                  </p>
                  <ul className="mt-2.5 space-y-1 text-[11px] leading-5 text-muted-foreground">
                    {(lang === "th" ? negotiationGuide.questionsTh : negotiationGuide.questionsEn).map((q, i) => (
                      <li key={i}>
                        {i + 1}. {q}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {lang === "th"
                    ? "4. แนวทางทางการที่ควรสอบถามเรียงตามลำดับ"
                    : "4. Priority Official Programs to Discuss"}
                </h3>
                <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
                  {matchedPrograms.map((p, idx) => (
                    <div key={p.id} className="rounded-xl border border-border bg-secondary/20 px-3.5 py-2.5 text-xs">
                      <p className="font-semibold text-foreground">
                        {idx + 1}. {lang === "th" ? p.title_th : p.title_en}
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                        {lang === "th" ? p.benefit_th : p.benefit_en}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            <p className="text-[11px] text-muted-foreground">
              {lang === "th"
                ? "ไม่มีช่องลงชื่อผู้ยื่นคำขอ เพราะเป็นบันทึกส่วนตัวสำหรับใช้เตรียมคุยกับเจ้าหน้าที่"
                : "No signature block included; this is a personal preparation sheet, not a bank application form."}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopySummary()}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-background px-4 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
              >
                {copiedSummary ? (
                  <Check aria-hidden="true" className="size-3.5" />
                ) : (
                  <Copy aria-hidden="true" className="size-3.5" />
                )}
                {copiedSummary
                  ? lang === "th"
                    ? "คัดลอกเรียบร้อยแล้ว"
                    : "Copied"
                  : lang === "th"
                    ? "คัดลอกข้อความสรุป"
                    : "Copy Text Summary"}
              </button>
              <button
                type="button"
                onClick={handlePrintDossier}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-foreground px-5 text-xs font-medium text-background hover:opacity-85"
              >
                <Printer aria-hidden="true" className="size-3.5" />
                {lang === "th" ? "สั่งพิมพ์หรือบันทึกเอกสาร" : "Print / Save Document"}
              </button>
            </div>
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
                : "Excerpt from a policy document in the reference library"}
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

              <div ref={docPageScrollRef} className="mt-4 max-h-[390px] overflow-y-auto rounded-2xl border border-border bg-secondary/25 p-4 sm:p-5">
                {activeDocPage.loading ? (
                  <div className="flex h-32 items-center justify-center gap-2 text-xs text-muted-foreground">
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                    <span>{lang === "th" ? "กำลังดึงข้อความต้นฉบับจากหน้าเอกสาร…" : "Loading verbatim page text…"}</span>
                  </div>
                ) : activeDocPage.fullText ? (
                  <div className="space-y-3 text-[13px] leading-6 text-foreground">
                    {activeDocPage.fullText
                      .split(/\n{2,}/)
                      .map((block) => block.trim())
                      .filter(Boolean)
                      .map((block, bIdx) => {
                        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean)
                        if (lines.length > 1) {
                          return (
                            <div key={bIdx} className="rounded-xl border border-border/60 bg-background/75 px-3.5 py-2.5">
                              <p className="font-semibold text-foreground">{lines[0]}</p>
                              <div className="mt-1 space-y-1.5 text-foreground/90">
                                {lines.slice(1).map((bodyLine, lIdx) => (
                                  <p key={lIdx}>{bodyLine}</p>
                                ))}
                              </div>
                            </div>
                          )
                        }
                        const isBullet = /^[-•▪]\s+/.test(block)
                        if (isBullet) {
                          return (
                            <p key={bIdx} className="pl-3.5 text-foreground/90">
                              {block}
                            </p>
                          )
                        }
                        const isStandaloneHeading =
                          /^(?:\d+\.\d+(?:\.\d+)?\s+[^\n]{1,65}|เอกสารแนบ\s*\d+|ตัวอย่าง[^\n]{0,80}|หลักเกณฑ์\s*·\s*สรุปสาระสำคัญ)/.test(block) &&
                          block.length <= 90
                        if (isStandaloneHeading) {
                          return (
                            <p key={bIdx} className="pt-1 font-semibold text-foreground">
                              {block}
                            </p>
                          )
                        }
                        return (
                          <p key={bIdx} className="text-foreground/90">
                            {block}
                          </p>
                        )
                      })}
                    {activeDocPage.nextPage != null && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() =>
                            void openCitationModal({
                              doc_title: activeDocPage.docTitle,
                              page_num: activeDocPage.nextPage!,
                              doc_url: activeDocPage.docUrl,
                            })
                          }
                          className="inline-flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-background px-3.5 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                        >
                          <span>
                            {lang === "th"
                              ? `มีเนื้อหาต่อในหน้าถัดไป (อ่านต่อหน้าที่ ${activeDocPage.nextPage})`
                              : `Continues on next page (Open p. ${activeDocPage.nextPage})`}
                          </span>
                          <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
                        </button>
                      </div>
                    )}
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
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={activeDocPage.loading || activeDocPage.prevPage == null}
                    onClick={() =>
                      activeDocPage.prevPage != null &&
                      void openCitationModal({
                        doc_title: activeDocPage.docTitle,
                        page_num: activeDocPage.prevPage,
                        doc_url: activeDocPage.docUrl,
                      })
                    }
                    className="inline-flex h-9 items-center gap-1 rounded-full border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40"
                  >
                    <ChevronLeft aria-hidden="true" className="size-3.5" />
                    <span>
                      {activeDocPage.prevPage != null
                        ? lang === "th"
                          ? `หน้า ${activeDocPage.prevPage}`
                          : `p. ${activeDocPage.prevPage}`
                        : lang === "th"
                          ? "หน้าก่อน"
                          : "Prev"}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={activeDocPage.loading || activeDocPage.nextPage == null}
                    onClick={() =>
                      activeDocPage.nextPage != null &&
                      void openCitationModal({
                        doc_title: activeDocPage.docTitle,
                        page_num: activeDocPage.nextPage,
                        doc_url: activeDocPage.docUrl,
                      })
                    }
                    className="inline-flex h-9 items-center gap-1 rounded-full border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40"
                  >
                    <span>
                      {activeDocPage.nextPage != null
                        ? lang === "th"
                          ? `หน้า ${activeDocPage.nextPage}`
                          : `p. ${activeDocPage.nextPage}`
                        : lang === "th"
                          ? "หน้าถัดไป"
                          : "Next"}
                    </span>
                    <ChevronRight aria-hidden="true" className="size-3.5" />
                  </button>
                </div>
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
