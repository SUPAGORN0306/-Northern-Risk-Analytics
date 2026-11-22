"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion, useInView } from "motion/react"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  Loader2,
  PhoneCall,
  Printer,
  RotateCcw,
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
  computeFinancialDiagnostic,
  type DebtStatusKey,
} from "@/lib/financial-dossier"
import { useAppState } from "@/lib/i18n"

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
  dsrPct: number | null
  hasWaterOrDisaster: boolean
}): ProgramMatch[] {
  const { status, isSme, dscr, dsrPct, hasWaterOrDisaster } = params
  const list: ProgramMatch[] = []

  if (status === "overdue_120_plus") {
    list.push({
      id: "debt_clinic",
      badge_th: "แนวทางคัดกรองเบื้องต้น · ตรวจสอบสิทธิ์กับ SAM",
      badge_en: "Initial Screening · Verify with SAM",
      title_th: "คลินิกแก้หนี้ by SAM (โทร 1443)",
      title_en: "Debt Clinic by SAM (Call 1443)",
      benefit_th: "รวมหนี้เสียบัตรเครดิต บัตรกดเงินสด และสินเชื่อส่วนบุคคลที่ไม่มีหลักประกัน ปรับดอกเบี้ยผ่อนปรน 3 ถึง 5% ต่อปี ผ่อนสูงสุด 10 ปี",
      benefit_en: "Consolidates unsecured credit cards, cash cards, and personal loan NPLs at 3 to 5% p.a. for up to 10 years.",
      criteria_th: "บุคคลธรรมดา ค้างชำระเกิน 120 วัน และต้องตรวจสอบคุณสมบัติเพิ่มเติมเรื่องประเภทสินเชื่อ เงินต้นรวมไม่เกิน 2 ล้านบาท อายุ และรายได้กับ SAM โดยตรง",
      criteria_en: "Individuals overdue >120 days; additional criteria on loan type, <= 2M THB principal, age, and income must be verified directly with SAM.",
      action_label_th: "ตรวจสอบสิทธิ์ที่เว็บไซต์คลินิกแก้หนี้",
      action_label_en: "Verify Eligibility at Debt Clinic",
      action_href: "https://www.debtclinicbysam.com/",
      source_th: "แนวทางแก้หนี้ยั่งยืน ธปท. และ SAM (โปรดตรวจสอบสิทธิ์จริง)",
      source_en: "BOT Sustainable Debt Relief & SAM (Verify Actual Eligibility)",
    })
    list.push({
      id: "fast_debt_exit_sam",
      badge_th: "โครงการเฉพาะกิจ · ตรวจสอบสิทธิ์กับ ธปท./SAM",
      badge_en: "Special Program · Verify via BOT/SAM",
      title_th: "โครงการปิดหนี้ไว ไปต่อได้ (SAM Social AMC · โทร 1213 / 1443 กด 6)",
      title_en: "Fast-Close Move-Forward Program (SAM Social AMC · 1213 / 1443 ext. 6)",
      benefit_th: "สำหรับลูกหนี้รายย่อยที่เป็นหนี้เสียไม่มีหลักประกัน รับโอนหนี้มาปรับโครงสร้างโดยเลือกจ่ายปิดจบบางส่วนทันที หรือผ่อนสูงสุด 3 ปี ดอกเบี้ย 0% หากปฏิบัติตามเงื่อนไข",
      benefit_en: "Transfers eligible unsecured retail NPLs to SAM Social AMC with options for partial lump-sum settlement or up to 3-year installment at 0% interest.",
      criteria_th: "บุคคลธรรมดาที่มีภาระหนี้เสีย (NPL) ทุกประเภทสินเชื่อรวมทุกแห่งไม่เกิน 100,000 บาท ณ วันที่ 30 กันยายน 2568 (เปิดลงทะเบียนตั้งแต่ 5 ม.ค. 2569 — โปรดตรวจสอบสิทธิ์ที่ช่องทางทางการ)",
      criteria_en: "Individuals with combined NPLs across all lenders <= 100,000 THB as of 30 Sep 2025 (registration opened 5 Jan 2026 — verify eligibility via official channels).",
      action_label_th: "ตรวจสอบสิทธิ์ที่ bot.or.th/cleardebt",
      action_label_en: "Check Eligibility at bot.or.th/cleardebt",
      action_href: "https://www.bot.or.th/cleardebt",
      source_th: "ข่าว ธปท. ฉบับที่ 1/2569 (5 ม.ค. 2569) · LINE @samsocialamc",
      source_en: "BOT Press Release 1/2569 (5 Jan 2026) · LINE @samsocialamc",
    })
  } else if (status === "persistent") {
    list.push({
      id: "persistent_debt",
      badge_th: "แนวทางคัดกรองเบื้องต้น · ตรวจสอบสิทธิ์กับเจ้าหนี้",
      badge_en: "Initial Screening · Verify with Lender",
      title_th: "มาตรการปิดจบหนี้เรื้อรัง (ขยายสูงสุด 7 ปี เริ่ม 1 ม.ค. 2568 · ดอกเบี้ยไม่เกิน 15%)",
      title_en: "Persistent Debt Exit (Up to 7 Years Effective 1 Jan 2025 · Max 15% p.a.)",
      benefit_th: "เปลี่ยนสินเชื่อส่วนบุคคลประเภทวงเงินหมุนเวียนเป็นสินเชื่อผ่อนรายงวด อัตราดอกเบี้ยที่แท้จริงไม่เกิน 15% ต่อปี ปิดจบภายในสูงสุด 7 ปี (ขยายจากเดิม 5 ปี เริ่ม 1 ม.ค. 2568)",
      benefit_en: "Converts revolving personal loans into fixed installments capped at 15% p.a. for up to 7 years (expanded from 5 to 7 years effective 1 Jan 2025).",
      criteria_th: "เฉพาะสินเชื่อส่วนบุคคลประเภทวงเงินหมุนเวียน (ยังไม่เป็น NPL ไม่รวมบัตรเครดิต/จำนำทะเบียน) ที่จ่ายดอกเบี้ยรวมมากกว่าเงินต้นย้อนหลัง 5 ปี และเข้าเกณฑ์รายได้ ธปท. (< 20,000 บาท/เดือน สำหรับธนาคาร/กลุ่มธุรกิจ หรือ < 10,000 บาท/เดือน สำหรับ Non-bank อื่น)",
      criteria_en: "Revolving personal loans (Non-NPL, excluding credit cards/auto-title) paying more interest than principal for 5+ years and meeting BOT income criteria (<20,000 THB/mo bank/group or <10,000 THB/mo other non-bank).",
      action_label_th: "เปิดอ่านประกาศหลักเกณฑ์ ธปท.",
      action_label_en: "Open Official BOT Guideline (PDF)",
      action_href: "https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/ThaiPDF/25680030.pdf",
      source_th: "ประกาศ Responsible Lending ปรับปรุง 2568 (โปรดตรวจสอบสิทธิ์กับเจ้าหนี้)",
      source_en: "Updated Responsible Lending 2568 (Verify with Lender)",
    })
  } else if (status === "overdue_31_120") {
    list.push({
      id: "khunsoo",
      badge_th: "ตัวอย่างแนวทางเจรจา (คุณสู้ เราช่วย ปิดรับสมัครใหม่แล้ว)",
      badge_en: "Negotiation Reference (Khun Soo Closed to New Signups)",
      title_th: "ติดต่อเจ้าหนี้เดิมเพื่อขอปรับโครงสร้างหนี้ (ใช้แผนขั้นบันไดเป็นตัวอย่างประกอบการเจรจา)",
      title_en: "Contact Original Lender for Restructuring (Use Stepped Plan as Illustrative Reference)",
      benefit_th: "สามารถใช้ตารางลดค่างวดขั้นบันได (เช่น 50% / 70% / 90%) เป็นตัวอย่างสถานการณ์ประกอบการเจรจากับเจ้าหนี้ตามเกณฑ์ Responsible Lending ทั้งนี้เงื่อนไขจริงขึ้นอยู่กับการพิจารณาของแต่ละสถาบันการเงิน",
      benefit_en: "Use the stepped payment schedule (50% / 70% / 90%) as an illustrative scenario when negotiating with your lender under Responsible Lending; actual approval and terms depend on the lender.",
      criteria_th: "โครงการคุณสู้ เราช่วย ปิดลงทะเบียนใหม่แล้วตั้งแต่วันที่ 30 กันยายน 2568 (ผู้ลงทะเบียนเดิมยังดำเนินการต่อได้ ส่วนลูกหนี้ใหม่ให้ติดต่อเจรจาปรับโครงสร้างหนี้กับเจ้าหนี้โดยตรง)",
      criteria_en: "Khun Soo Rao Chuay closed new registration on 30 Sep 2025 (existing registrants continue; new applicants must negotiate restructuring directly with their lender).",
      action_label_th: "เปิดอ่านหลักเกณฑ์ปรับโครงสร้างหนี้ 2568",
      action_label_en: "Open 2568 Restructuring Guideline (PDF)",
      action_href: "https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/ThaiPDF/25680030.pdf",
      source_th: "หลักเกณฑ์ Responsible Lending 2568 (ไม่ใช่การยืนยันอนุมัติอัตโนมัติ)",
      source_en: "Responsible Lending 2568 (Not an Automatic Approval)",
    })
  } else if (status === "disaster") {
    list.push({
      id: "disaster_2568",
      badge_th: "แนวทางคัดกรองเบื้องต้น · พื้นที่ประสบภัย",
      badge_en: "Initial Screening · Hazard Relief",
      title_th: "มาตรการช่วยเหลือลูกหนี้ผู้ประสบสาธารณภัย 2568",
      title_en: "2568 Disaster Borrower Relief",
      benefit_th: "ขอพักชำระเงินต้นชั่วคราว ลดค่างวด หรือขอวงเงินฟื้นฟูกิจการกับเจ้าหนี้เดิมตามเงื่อนไขของสถาบันการเงิน",
      benefit_en: "Request temporary principal deferral, payment step down, or recovery credit subject to lender review.",
      criteria_th: "เตรียมหลักฐานแสดงผลกระทบหรือรายได้ที่ลดลง (เช่น บิลยอดขายย้อนหลัง รายการเดินบัญชี หรือภาพถ่ายพื้นที่ได้รับผลกระทบ) เพื่อยื่นตรวจสอบสิทธิ์กับเจ้าหนี้",
      criteria_en: "Prepare evidence of income drop or impact (sales receipts, bank statements, or site photos) for lender verification.",
      action_label_th: "เปิดอ่านหนังสือเวียน ธปท.ว. 2302/2568",
      action_label_en: "Open Circular 2302/2568 (PDF)",
      action_href: "https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/ThaiPDF/25680065.pdf",
      source_th: "หนังสือเวียน ธปท.ว. 2302/2568 (โปรดตรวจสอบเงื่อนไขกับเจ้าหนี้)",
      source_en: "Official Circular 2302/2568 (Verify with Lender)",
    })
  } else if (isSme) {
    list.push({
      id: "sme_3reduce",
      badge_th: dscr != null && dscr < 1.25 ? "แนวทางสำหรับ SME ตึงมือ" : "แนวทางหักเงินต้น SME",
      badge_en: dscr != null && dscr < 1.25 ? "SME Screening Option" : "SME Principal Cut Option",
      title_th: "มาตรการ 3 ลด (ธนาคารพัฒนาวิสาหกิจขนาดกลางและขนาดย่อม · โทร 1357)",
      title_en: "SME D Bank 3 Reduce Program (Call 1357)",
      benefit_th: "ลดเงินต้น (นำค่างวดไปหักเงินต้นก่อนสูงสุด 100% นาน 2 ปี) ลดอัตราดอกเบี้ย และปรับลดค่างวดให้สอดคล้องกำไรจริง",
      benefit_en: "Applies up to 100% of payments directly to principal for 2 years plus interest and installment relief.",
      criteria_th: "เฉพาะลูกหนี้หรือผู้ประกอบการที่เข้าเกณฑ์ของ SME D Bank โปรดตรวจสอบคุณสมบัติและเงื่อนไขสัญญาจริงกับสาขาหรือโทร 1357",
      criteria_en: "Subject to SME D Bank borrower eligibility criteria; verify actual contract terms via branch or call 1357.",
      action_label_th: "เปิดอ่านหลักเกณฑ์ปรับโครงสร้างหนี้",
      action_label_en: "Review Restructuring Rules (PDF)",
      action_href: "https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/ThaiPDF/25680030.pdf",
      source_th: "มาตรการ 3 ลด และ Responsible Lending 2568 (ตรวจสอบสิทธิ์จริงกับธนาคาร)",
      source_en: "SME D Bank 3 Reduce & Responsible Lending 2568 (Verify with Bank)",
    })
  }

  // Only show pre-NPL Responsible Lending or SME Working Capital options when borrower is NOT already overdue/persistent
  if (isSme && (status === "current" || status === "disaster") && (dscr == null || dscr >= 1.0)) {
    list.push({
      id: "credit_boost_tcg",
      badge_th: hasWaterOrDisaster ? "เสริมสภาพคล่องพื้นที่เสี่ยง" : "สินเชื่อหมุนเวียนและค้ำประกัน",
      badge_en: "SME Liquidity & Guarantee",
      title_th: "โครงการสนับสนุนสินเชื่อใหม่และค้ำประกันสินเชื่อ บสย. (โทร 02-890-9999)",
      title_en: "SMEs Credit Boost & TCG PGS 11 Guarantee",
      benefit_th: "กลไกช่วยค้ำประกันและแบ่งเบาความเสี่ยงสำหรับสินเชื่อหมุนเวียนธุรกิจท่องเที่ยวและบริการ พร้อมสิทธิฟรีค่าธรรมเนียมค้ำประกันช่วง 2 ถึง 3 ปีแรก",
      benefit_en: "Credit risk sharing for new working capital loans in tourism and services, plus TCG PGS 11 fee waivers.",
      criteria_th: "ผู้ประกอบการภาคบริการที่มีศักยภาพดำเนินธุรกิจต่อและผ่านเกณฑ์พิจารณาสินเชื่อของธนาคารพาณิชย์และ บสย.",
      criteria_en: "Viable tourism and service SMEs subject to commercial bank and TCG credit underwriting.",
      action_label_th: "เปิดดูรายงานเศรษฐกิจภาคเหนือ (ธปท.)",
      action_label_en: "Open Northern Economy Portal",
      action_href: "https://www.bot.or.th/th/thai-economy/regional-economy/northern-economy.html",
      source_th: "มาตรการสินเชื่อฟื้นฟูและค้ำประกันสินเชื่อ บสย.",
      source_en: "SMEs Credit Boost & TCG PGS 11 Framework",
    })
  } else if (status === "current" || status === "disaster") {
    list.push({
      id: "responsible_lending",
      badge_th: dsrPct == null || dsrPct >= 40 || (dscr != null && dscr < 1.25) ? "แนวทางเจรจาเจ้าหนี้เดิม" : "วางแผนเชิงป้องกัน",
      badge_en: dsrPct == null || dsrPct >= 40 ? "Direct Lender Option" : "Preventive Option",
      title_th: "สิทธิขอปรับโครงสร้างหนี้เชิงป้องกันก่อนเป็นหนี้เสีย (Responsible Lending 2568)",
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

  return list.slice(0, 3)
}

type PresetKey = "individual_tight" | "sme_tight" | "khunsoo_sme" | "disaster_cr" | null

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
  const resultPanelRef = useRef<HTMLDivElement | null>(null)
  const isInView = useInView(ref, { once: true, margin: "-60px" })
  const { lang, selectedProvinceCode, setSelectedProvinceCode } = useAppState()

  const [formStep, setFormStep] = useState<1 | 2 | 3>(1)
  const [stepDir, setStepDir] = useState<1 | -1>(1)
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
  const [annualRateInput, setAnnualRateInput] = useState("")
  const [horizonYears, setHorizonYears] = useState(5)
  const [extraLoans, setExtraLoans] = useState<ExtraLoanItem[]>([])
  const [deferMonths, setDeferMonths] = useState(6)
  const [stressDropPct, setStressDropPct] = useState(30)

  const [submitting, setSubmitting] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [result, setResult] = useState<ReliefCheckResponse | null>(null)

  function goToStep(next: 1 | 2 | 3) {
    setStepDir(next >= formStep ? 1 : -1)
    setFormStep(next)
  }

  function scrollToResults() {
    resultPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
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
  const [mobileResultTab, setMobileResultTab] = useState<"sim" | "programs" | "dossier">("sim")
  const maxHorizonYears = debtStatus === "persistent" ? 7 : 30

  useEffect(() => {
    setHorizonYears((years) => Math.min(years, maxHorizonYears))
  }, [maxHorizonYears])
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

  useEffect(() => {
    if (numDebt <= 0 || (!hasEnteredRevenue && numRevenue <= 0)) {
      setResult(null)
      return
    }
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
  }, [hasEnteredRevenue, numRevenue, numDebt, selectedProvinceCode, business, debtStatus])

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
  }

  function applyPreset(preset: "individual_tight" | "sme_tight" | "khunsoo_sme" | "disaster_cr") {
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
    } else if (preset === "khunsoo_sme") {
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
          ? "กรุณากรอกรายได้ต่อเดือน (หากไม่มีรายได้ใส่ 0) และค่างวดหนี้ต่อเดือนก่อนกดคำนวณ"
          : "Please enter monthly revenue (enter 0 if no income) and monthly debt payment before evaluating.",
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

        <div
          className={
            diagnostic
              ? "grid items-start gap-5 lg:grid-cols-[5fr_7fr]"
              : "mx-auto max-w-2xl"
          }
        >
          {/* Left Sticky Control Column on Desktop holding the 3 Step Stepper and Live Summary Snapshot */}
          <div className={diagnostic ? "space-y-4 lg:sticky lg:top-24" : ""}>
            {/* Connected 3 Step Horizontal Slide Wizard Form */}
            <motion.form
              onSubmit={handleSubmit}
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.06 }}
              className="rounded-[1.75rem] border border-border bg-card p-5 sm:p-6"
            >
            <div className="mb-4 flex items-start justify-between gap-2">
              <div>
                <h3 className="font-display text-base font-semibold text-foreground sm:text-lg">
                  {lang === "th" ? "ข้อมูลรายรับ รายจ่าย และภาระหนี้" : "Cashflow & Debt Inputs"}
                </h3>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground sm:text-sm">
                  {lang === "th"
                    ? "ไม่เก็บข้อมูลส่วนบุคคล ประมวลผลเพื่อจำลองแผนเจรจาเท่านั้น"
                    : "No personal data stored. Processed strictly for planning."}
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
                        <span>{lang === "th" ? "ถัดไป · กรอกรายรับและค่างวด" : "Next · Income & Debt"}</span>
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
                              setRevenue(formatMoneyInput(e.target.value))
                            }}
                            placeholder={lang === "th" ? "กรอกรายได้ต่อเดือน (ไม่มีใส่ 0)" : "Enter monthly income"}
                            className="h-10 w-full rounded-xl border border-input bg-background px-3 pr-11 text-sm font-medium text-foreground outline-none transition placeholder:text-xs placeholder:font-normal placeholder:text-muted-foreground/60 focus:border-foreground/45 focus:ring-2 focus:ring-foreground/10"
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
                              setDebtPayment(formatMoneyInput(e.target.value))
                            }}
                            placeholder={lang === "th" ? "กรอกค่างวดต่อเดือน" : "Enter monthly payment"}
                            className="h-10 w-full rounded-xl border border-input bg-background px-3 pr-11 text-sm font-medium text-foreground outline-none transition placeholder:text-xs placeholder:font-normal placeholder:text-muted-foreground/60 focus:border-foreground/45 focus:ring-2 focus:ring-foreground/10"
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
                            ? "คำนวณผลวิเคราะห์เบื้องต้นแล้ว · กรอกเงินต้นและดอกเบี้ยต่อในขั้นที่ 3 ได้"
                            : "Diagnostic ready · Add loan principal or rate in Step 3"}
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
                        <span>{lang === "th" ? "ถัดไป · ใส่เงินต้น/ดอกเบี้ยเพิ่ม" : "Next · Loan Details"}</span>
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
                                  ? "เลือกได้ไม่เกิน 7 ปีตามกรอบมาตรการหนี้เรื้อรัง ตัวเลขนี้ใช้จำลองแผน ไม่ใช่การยืนยันสิทธิ์หรือเงื่อนไขจากเจ้าหนี้"
                                  : "เลือกปีที่ต้องการดูในตารางจำลอง ไม่ใช่ระยะเวลาที่เจ้าหนี้อนุมัติแน่นอน"
                                : debtStatus === "persistent"
                                  ? "Limited to 7 years for the persistent-debt measure. This is a simulation, not confirmed eligibility or lender terms."
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
                        {lang === "th" ? "ความเป็นส่วนตัวของข้อมูล:" : "Data privacy notice:"}
                      </strong>{" "}
                      {lang === "th"
                        ? "เมื่อระบบเชื่อมต่อเพื่อค้นเอกสารอ้างอิง จะบันทึกเฉพาะสถิติไม่ระบุตัวตน (จังหวัด ประเภทกิจการ และช่วงภาระหนี้) โดยไม่บันทึกชื่อ ยอดรายได้ หรือยอดหนี้ของคุณ"
                        : "When querying official document guidance, only anonymized aggregate signals (province, business type, and DSR band) are logged, never your name, income, or debt figures."}
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

                <button
                  type="button"
                  onClick={openDossierModal}
                  className="mt-3.5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-foreground px-4 text-xs font-medium text-background transition-opacity hover:opacity-85"
                >
                  <FileText aria-hidden="true" className="size-3.5" />
                  {lang === "th" ? "เปิดดูและพิมพ์ใบสรุปยื่นธนาคาร" : "Preview & Print Bank Dossier"}
                </button>
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
              className="scroll-mt-28 flex flex-col rounded-[1.75rem] border border-border bg-secondary/45 p-5 sm:p-6"
            >
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
                          ? `เงินเหลือหลังหักค่าใช้จ่ายจำเป็น (ใช้คำนวณ DSCR) ${Math.round(diagnostic.operatingCashflow).toLocaleString()} บาท · ค่างวดต่อรายได้รวม (Gross DSR) ${diagnostic.dsrPct != null ? `${diagnostic.dsrPct.toFixed(1)}%` : "คำนวณไม่ได้ (ไม่มีรายได้ · วิกฤต)"}`
                          : `Post-expense CF (DSCR base) ${Math.round(diagnostic.operatingCashflow).toLocaleString()} · Gross-income DSR ${diagnostic.dsrPct != null ? `${diagnostic.dsrPct.toFixed(1)}%` : "Undefined (Zero Income · Critical)"}`}
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

                {/* Mobile result section switcher so citizens on phones can browse results without an overwhelming scroll */}
                <div
                  role="tablist"
                  aria-label={lang === "th" ? "เลือกดูผลลัพธ์การคำนวณ" : "Result section tabs"}
                  className="mt-4 grid grid-cols-3 gap-1 rounded-2xl border border-border bg-background p-1 md:hidden"
                >
                  {(
                    [
                      { id: "sim", th: "จำลองค่างวด", en: "Installment" },
                      { id: "programs", th: "แนวทางแก้หนี้", en: "Programs" },
                      { id: "dossier", th: "ใบสรุปยื่นธนาคาร", en: "Bank Summary" },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={mobileResultTab === t.id}
                      onClick={() => setMobileResultTab(t.id)}
                      className={`rounded-xl px-2 py-2 text-center text-xs font-medium transition-colors ${
                        mobileResultTab === t.id
                          ? "bg-foreground text-background shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {lang === "th" ? t.th : t.en}
                    </button>
                  ))}
                </div>

                <div className={mobileResultTab === "sim" ? "block" : "hidden md:block"}>
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
                                      ? `ประมาณการส่วนต่างดอกเบี้ย (สมมติฐาน ${loanComparison.originalRatePct.toFixed(1)}%/ปี)`
                                      : `ประมาณการส่วนต่างดอกเบี้ย (ดอกเบี้ยที่กรอก ${loanComparison.originalRatePct.toFixed(1)}%/ปี)`
                                  : loanComparison.totalInterestSaved <= 0
                                    ? "Primary Scenario Purpose"
                                    : loanComparison.usesAssumedRate
                                      ? `Est. Interest Diff (Assumed ${loanComparison.originalRatePct.toFixed(1)}%)`
                                      : `Est. Interest Diff (Entered ${loanComparison.originalRatePct.toFixed(1)}%)`
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
                                      ? "2. ข้อเท็จจริงด้านดอกเบี้ยและการผ่อนชำระ: มาตรการนี้เป็นการชะลอภาระเงินสดฉุกเฉินชั่วคราว ดอกเบี้ยยังคงคำนวณตามสัญญาปกติ จึงไม่ได้ลดยอดดอกเบี้ยรวม (0 บาท) แต่มุ่งเน้นรักษาสภาพคล่องเพื่อฟื้นฟูกิจการ และป้องกันการเกิดหนี้เสีย (NPL) ในช่วงวิกฤต"
                                      : "2. Interest & Cashflow Reality: This measure provides temporary emergency liquidity relief. Interest continues as contractual without cumulative interest reduction (0 THB saved), focusing on preventing default and protecting working capital during recovery."
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
                                ? "3. คำแนะนำการเตรียมหลักฐาน: เตรียมหลักฐานแสดงผลกระทบหรือรายได้ที่ลดลง (เช่น บิลยอดขายย้อนหลัง รายการเดินบัญชี หรือภาพถ่ายพื้นที่ได้รับผลกระทบ) เพื่อประกอบการพิจารณาของธนาคาร"
                                : "3. Evidence Tip: Prepare proof of income drop or hazard impact (past sales bills, bank statements, or site photos) for bank consideration."}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                )}
                </div>

                {/* 3. Actionable One Page Financial Dossier Preview & Print */}
                <div
                  className={`${
                    mobileResultTab === "dossier" ? "flex" : "hidden md:flex"
                  } mt-4 flex-wrap items-center justify-between gap-3 rounded-2xl border border-foreground/20 bg-background p-4`}
                >
                  <div className="max-w-md">
                    <p className="text-xs font-semibold text-foreground">
                      {lang === "th"
                        ? "3. ใบสรุปความพร้อมทางการเงิน สำหรับยื่นธนาคาร"
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
                      {lang === "th" ? "เปิดดูและพิมพ์ใบสรุป" : "Preview & Print Dossier"}
                    </button>
                  </div>
                </div>

                {/* 4. Potentially Relevant Programs Initial Screening Only */}
                <div
                  className={`${
                    mobileResultTab === "programs" ? "block" : "hidden md:block"
                  } mt-4 space-y-2.5`}
                >
                  <div className="px-1">
                    <h3 className="text-xs font-semibold text-foreground">
                      {lang === "th"
                        ? "แนวทางที่อาจเกี่ยวข้อง — กรุณาตรวจสอบสิทธิ์จริงกับเจ้าหนี้หรือหน่วยงานทางการ"
                        : "Potentially Relevant Options — Verify Actual Eligibility with Your Lender or Agency"}
                    </h3>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {lang === "th"
                        ? "เป็นการคัดกรองเบื้องต้นตามสถานะที่คุณเลือกเท่านั้น ยังไม่ได้ตรวจสอบสัญญา ประเภทสินเชื่อ ยอดหนี้ อายุ หรือเกณฑ์รายได้จริง"
                        : "Initial screening based on your selected status only; actual loan type, balance, age, and income criteria must be verified with the lender."}
                    </p>
                  </div>
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
                  <div
                    className={`${
                      mobileResultTab === "programs" ? "block" : "hidden md:block"
                    } mt-4 rounded-2xl border border-border bg-background p-4`}
                  >
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
                      ? `ค่างวดต่อรายได้รวม (Gross DSR) ${diagnostic.dsrPct != null ? `${diagnostic.dsrPct.toFixed(1)}%` : "คำนวณไม่ได้ (รายได้เป็น 0)"} (เกณฑ์คัดกรองภายใน 40/60/80%)`
                      : `Gross-income DSR ${diagnostic.dsrPct != null ? `${diagnostic.dsrPct.toFixed(1)}%` : "Undefined (Zero Income)"} (internal 40/60/80% heuristic)`}
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
              {lang === "th" ? "สั่งพิมพ์ / บันทึกเป็นไฟล์ PDF" : "Print / Save PDF"}
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
