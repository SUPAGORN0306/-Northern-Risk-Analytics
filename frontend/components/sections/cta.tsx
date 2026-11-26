"use client"

import { FormEvent, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import {
  ArrowUp,
  Check,
  ExternalLink,
  Loader2,
  MessageCircle,
  Mic,
  RotateCcw,
  ShieldCheck,
  StopCircle,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  X,
} from "lucide-react"
import {
  formatFetchError,
  sendPolicyChat,
  submitReliefCheck,
  submitChatFeedback,
  type CitationItem,
} from "@/lib/api"
import { useAppState } from "@/lib/i18n"
import { buildLoanComparison, computeFinancialDiagnostic, formatRatePct, type DebtStatusKey } from "@/lib/financial-dossier"
import { matchOfficialPrograms } from "@/components/sections/pricing"

type ChatMessage = {
  id: number
  role: "assistant" | "user"
  text: string
  keyPoints?: string[]
  citations?: CitationItem[]
  dataSources?: Array<{ title: string; source_name: string; observed_at: string; source_url?: string }>
  piiRedacted?: number
  wasRefused?: boolean
  feedback?: { modelUsed: string | null; topVectorSim: number; wasRefused: boolean; sent?: boolean }
  /** Only ordinary questions are eligible for short lived retrieval context. */
  contextText?: string
}

type AssessmentStep = "type" | "province" | "income" | "income_zero_confirm" | "debt" | "expenses" | "reserve" | "principal" | "rate" | "rate_low_confirm" | "status" | "horizon" | "impact" | "confirm"
type ChatAreaScope = { kind: "regional" } | { kind: "province"; code: string }
type AreaClarification = { question: string; step: "scope" | "province" }
type AssessmentDraft = {
  step: AssessmentStep
  businessType: string
  businessLabel: string
  province: string
  monthlyIncome: number | null
  monthlyDebt: number | null
  debtSkipped: boolean
  monthlyExpenses: number | null
  expensesSkipped: boolean
  cashReserve: number | null
  reserveSkipped: boolean
  totalPrincipal: number | null
  principalSkipped?: boolean
  annualRate: number | null
  rateSkipped?: boolean
  pendingLowRate?: number | null
  horizonYears: number | null
  debtStatus: DebtStatusKey | null
  impactTags: string[]
  impactLabel: string
  returnToConfirm?: boolean
}

type SpeechResult = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: { results: SpeechResult }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike
type WindowWithSpeech = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

function greetingFor(lang: "th" | "en"): ChatMessage {
  return {
    id: 1,
    role: "assistant",
    text:
      lang === "th"
        ? "สวัสดีครับ ผมช่วยประเมินภาระหนี้และเตรียมคุยกับเจ้าหนี้ได้ครับ จะเริ่มจากดูภาระหนี้ หรือวางแผนรับมือรายได้ที่อาจลดลงดีครับ"
        : "Hi! I can help you understand your debt, prepare to talk with a lender, and plan for income changes. Where would you like to start?",
  }
}

const PROVINCE_NAMES: Record<string, { th: string; en: string }> = {
  CM: { th: "เชียงใหม่", en: "Chiang Mai" }, CR: { th: "เชียงราย", en: "Chiang Rai" },
  LP: { th: "ลำปาง", en: "Lampang" }, LN: { th: "ลำพูน", en: "Lamphun" },
  MH: { th: "แม่ฮ่องสอน", en: "Mae Hong Son" }, NN: { th: "น่าน", en: "Nan" },
  PY: { th: "พะเยา", en: "Phayao" }, PR: { th: "แพร่", en: "Phrae" },
  UT: { th: "อุตรดิตถ์", en: "Uttaradit" }, TK: { th: "ตาก", en: "Tak" },
  ST: { th: "สุโขทัย", en: "Sukhothai" }, PL: { th: "พิษณุโลก", en: "Phitsanulok" },
  PC: { th: "พิจิตร", en: "Phichit" }, PB: { th: "เพชรบูรณ์", en: "Phetchabun" },
  KP: { th: "กำแพงเพชร", en: "Kamphaeng Phet" }, NS: { th: "นครสวรรค์", en: "Nakhon Sawan" },
  UN: { th: "อุทัยธานี", en: "Uthai Thani" },
}

function provinceLabel(codeOrName: string, lang: "th" | "en"): string {
  return PROVINCE_NAMES[codeOrName.toUpperCase()]?.[lang] ?? codeOrName
}

function debtStatusLabel(status: DebtStatusKey | null, lang: "th" | "en"): string {
  if (lang === "th") {
    return status === "current" ? "ยังชำระตรงเวลา"
      : status === "persistent" ? "หนี้เรื้อรัง"
        : status === "overdue_31_120" ? "ค้างชำระ 1–4 เดือน"
          : status === "overdue_120_plus" ? "ค้างชำระเกิน 4 เดือน"
            : status === "disaster" ? "ได้รับผลกระทบจากภัยพิบัติ" : "ไม่ระบุ"
  }
  return status === "current" ? "Current"
    : status === "persistent" ? "Persistent debt"
      : status === "overdue_31_120" ? "1–4 months overdue"
        : status === "overdue_120_plus" ? "Over 4 months overdue"
          : status === "disaster" ? "Disaster affected" : "Not specified"
}

function findProvinceCode(text: string): string | undefined {
  const lower = text.toLocaleLowerCase()
  return Object.entries(PROVINCE_NAMES).find(([, names]) => {
    if (lower.includes(names.th.toLocaleLowerCase())) return true
    const escapedEnglishName = names.en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`(?:^|[^a-z])${escapedEnglishName}(?:$|[^a-z])`, "i").test(text)
  })?.[0]
}

function needsAreaScope(text: string): boolean {
  const hasExplicitAreaMetric =
    /เศรษฐกิจ|รายได้(?:จังหวัด|ท่องเที่ยว|พื้นที่|ภาค)|ท่องเที่ยว|อัตราเข้าพัก|เข้าพัก|ฝน|ฝุ่น|pm\s*2\.5|คุณภาพอากาศ|อากาศ|สารพิษ|สารหนู|มลพิษ|น้ำท่วม|ข่าว|สถานการณ์จังหวัด|economic|(?:provincial|tourism|local)\s+revenue|tourism|occupancy|rain|weather|air quality|haze|pollution|arsenic|toxin|flood|news|local conditions/i.test(
      text,
    )
  if (!hasExplicitAreaMetric) return false
  const isPurePersonalDebtPrep =
    /(ถ้ารายได้ลด|เมื่อรายได้ลด|ถ้ารายได้สะดุด|เตรียมตัวยังไง|วางแผนยังไง|คุยกับเจ้าหนี้|ประเมินภาระหนี้|prepare if income|plan if income|talk to my lender|check my debt)/i.test(
      text,
    ) && !/จังหวัด|ภาคเหนือ|ท่องเที่ยว|เข้าพัก|ฝน|ฝุ่น|pm\s*2\.5|อากาศ|สารพิษ|สารหนู|มลพิษ|น้ำท่วม|ข่าว|province|northern|tourism|occupancy|rain|weather|haze|pollution|flood|news/i.test(text)
  return !isPurePersonalDebtPrep
}

function asksNorthernOverview(text: string): boolean {
  return /ภาคเหนือ|ทุกจังหวัด|ภาพรวม|regional|northern|all provinces|region-wide/i.test(text)
}

function nextAssessmentStep(data: AssessmentDraft): AssessmentStep {
  if (!data.province) return "province"
  if (data.monthlyIncome == null) return "income"
  if (data.monthlyDebt == null) return "debt"
  if (data.monthlyExpenses == null && !data.expensesSkipped) return "expenses"
  if (data.cashReserve == null && !data.reserveSkipped) return "reserve"
  if (data.totalPrincipal == null && !data.principalSkipped) return "principal"
  if (data.annualRate == null && !data.rateSkipped) return "rate"
  if (!data.debtStatus) return "status"
  if (data.horizonYears == null) return "horizon"
  if (data.returnToConfirm) return "confirm"
  return "impact"
}

function amountAfter(text: string, labels: string): number | null {
  const match = text.match(new RegExp(`(?:${labels})[^\\d๐-๙]{0,20}([\\d๐-๙][\\d๐-๙,]*)`, "i"))
  return match ? parseAmount(match[1]) : null
}

function assessmentQuestion(step: AssessmentStep, province: string, lang: "th" | "en"): string {
  if (step === "province") return lang === "th" ? "อยู่จังหวัดไหนครับ? พิมพ์ชื่อจังหวัดได้เลย" : "Which province are you in? Type the province name."
  if (step === "income") return lang === "th" ? "รายรับเฉลี่ยต่อเดือนประมาณเท่าไหร่ครับ? เช่น 25,000 บาท" : "What is the approximate monthly income? For example, 25,000 baht."
  if (step === "income_zero_confirm") return lang === "th" ? "รายรับ 0 บาทหมายถึงตอนนี้ไม่มีรายรับจริง ๆ หรือยังไม่สะดวกบอกครับ? เลือกข้อที่ตรงได้เลยครับ" : "Does 0 baht mean you currently have no income, or would you rather not share? Choose whichever fits."
  if (step === "debt") return lang === "th" ? "จ่ายค่างวดหนี้รวมทุกบัญชีเดือนละประมาณเท่าไหร่ครับ? (หากไม่ทราบค่างวด กดข้ามเพื่อให้ระบบประเมินจากยอดเงินต้นแทน หรือใส่ 0 หากยังไม่มียอดผ่อนรายเดือน)" : "How much do you pay toward all debts each month? (Skip if unsure to estimate from principal, or enter 0 if no payment right now.)"
  if (step === "expenses") return lang === "th" ? "ค่าใช้จ่ายจำเป็นต่อเดือนประมาณเท่าไหร่ครับ เช่น ค่าเช่า อาหาร ค่าน้ำไฟ ถ้าไม่ทราบเลือกข้ามได้ครับ" : "About how much are your essential monthly expenses? Skip if unsure."
  if (step === "reserve") return lang === "th" ? "มีเงินสำรองที่ใช้ได้ตอนนี้ประมาณเท่าไหร่ครับ? ถ้าไม่ทราบเลือกข้ามได้ครับ" : "How much accessible savings do you have? Skip if unsure."
  if (step === "principal") return lang === "th" ? "ยอดเงินต้นหนี้คงเหลือรวมประมาณเท่าไหร่ครับ? ถ้าไม่ทราบเลือกข้ามได้ครับ" : "What is the approximate total outstanding principal? Skip if unsure."
  if (step === "rate") return lang === "th" ? "ดอกเบี้ยสัญญาเดิมประมาณกี่เปอร์เซ็นต์ต่อปีครับ? (เช่น 15 สำหรับ 15% ต่อปี) ถ้าไม่ทราบ ระบบจะใช้สมมติฐานตามประเภทหนี้และระบุให้เห็นครับ" : "What is the approximate annual interest rate (e.g., 15 for 15% p.a.)? Skip if unsure; any estimate will be labeled."
  if (step === "rate_low_confirm") return lang === "th" ? "ตัวเลขดอกเบี้ยที่กรอกต่ำกว่า 1% ต่อปี ตั้งใจระบุเป็นเปอร์เซ็นต์ตามนี้จริง ๆ หรือหมายถึงคูณ 100 (เช่น 0.15 = 15% ต่อปี) ครับ?" : "The rate entered is under 1% p.a. Did you mean that exact percentage, or 100x higher (e.g., 0.15 = 15% p.a.)?"
  if (step === "horizon") return lang === "th" ? "อยากดูตัวอย่างแผนผ่อนกี่ปีครับ เลือกจำนวนปีด้านล่างได้เลย" : "What repayment horizon should I illustrate? Choose a number of years below."
  if (step === "status") return lang === "th" ? "ตอนนี้สถานะหนี้ใกล้เคียงข้อไหนครับ? เลือกตามจริงเพื่อให้ตัวอย่างมาตรการตรงขึ้น" : "Which option best describes your current debt status?"
  if (step === "impact") return lang === "th" ? "มีเหตุที่กระทบรายได้หรือการจ่ายหนี้เป็นพิเศษไหมครับ? เลือกข้อที่ใกล้เคียง หรือข้ามได้" : "Has anything affected your income or debt payments? Choose an option or skip."
  if (step === "confirm") return lang === "th" ? "ขอทวนข้อมูลก่อนคำนวณครับ" : "Please confirm your information before I calculate."
  return lang === "th" ? "ใช้จังหวัด" + provinceLabel(province, "th") + "นะครับ" : "I’ll use " + provinceLabel(province, "en") + "."
}

function parseAmount(raw: string): number | null {
  const thaiDigits = "๐๑๒๓๔๕๖๗๘๙"
  const normalized = raw.replace(/[๐-๙]/g, (digit) => String(thaiDigits.indexOf(digit)))
  const match = normalized.replace(/,/g, "").match(/\d+(?:\.\d+)?/)
  if (match) {
    const value = Number(match[0])
    return Number.isFinite(value) && value >= 0 ? value : null
  }

  const digitWords: Record<string, number> = { ศูนย์: 0, หนึ่ง: 1, เอ็ด: 1, สอง: 2, ยี่: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6, เจ็ด: 7, แปด: 8, เก้า: 9 }
  const unitWords: Record<string, number> = { สิบ: 10, ร้อย: 100, พัน: 1_000, หมื่น: 10_000, แสน: 100_000 }
  const tokens = normalized.match(/ล้าน|แสน|หมื่น|พัน|ร้อย|สิบ|ศูนย์|หนึ่ง|เอ็ด|สอง|ยี่|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า/g)
  if (!tokens?.length) return null
  let total = 0
  let section = 0
  let digit: number | null = null
  for (const token of tokens) {
    if (token === "ล้าน") {
      total += (section + (digit ?? 0)) * 1_000_000
      section = 0
      digit = null
    } else if (unitWords[token] != null) {
      section += (digit ?? 1) * unitWords[token]
      digit = null
    } else {
      digit = digitWords[token]
    }
  }
  const value = total + section + (digit ?? 0)
  return Number.isFinite(value) && value >= 0 ? value : null
}

function money(value: number, lang: "th" | "en" = "th"): string {
  return `${Math.round(value).toLocaleString(lang === "en" ? "en-US" : "th-TH")}${lang === "en" ? " THB" : " บาท"}`
}

function normalizeCurrencyLabels(text: string): string {
  return text.replace(/บาท(?:\s+บาท)+/g, "บาท").replace(/\bTHB(?:\s+THB)+\b/g, "THB")
}

function isGreeting(text: string): boolean {
  return /^(สวัสดี|หวัดดี|ดีจ้า|ดีครับ|ดีค่ะ|hello|hi|hey|good morning|good afternoon)[\s!,.ครับค่ะจ้าๆ]*$/i.test(
    text.trim(),
  )
}

function isThanks(text: string): boolean {
  return /^(ขอบคุณ|ขอบใจ|แต๊งกิ้ว|thanks|thank you)[\s!,.ครับค่ะจ้าๆ]*$/i.test(text.trim())
}

function isAssessmentRequest(text: string): boolean {
  return /(ช่วย)?(คำนวณ|ประเมิน|เช็ก|ตรวจ).{0,24}(หนี้|ภาระ|ค่างวด|รายได้|จ่าย|เงินเหลือ|สภาพคล่อง)|(จ่ายหนี้ไหว|เงินเหลือพอ|ภาระหนี้ของฉัน)/i.test(
    text,
  )
}

function followUpsFor(question: string, answer: string, lang: "th" | "en"): string[] {
  if (/ฝน|ฝุ่น|อากาศ|pm\s*2\.5|มลพิษ|สารพิษ|น้ำท่วม|rain|weather|air quality|pollution|haze|flood/i.test(`${question} ${answer}`)) {
    return lang === "th"
      ? ["ถ้าสถานการณ์นี้กระทบรายได้ ควรเตรียมตัวยังไง", "ช่วยประเมินภาระหนี้ให้หน่อย"]
      : ["How can I prepare if this affects my income?", "Help me check my debt burden"]
  }
  if (/หนี้|สินเชื่อ|ค่างวด|คลินิก|ปรับโครงสร้าง|debt|loan|payment/i.test(`${question} ${answer}`)) {
    return lang === "th"
      ? ["ถ้ารายได้ลดลง ควรวางแผนยังไง", "เตรียมข้อมูลอะไรไปคุยกับเจ้าหนี้"]
      : ["How should I plan if income falls?", "What should I prepare before talking to my lender?"]
  }
  if (/จังหวัด|ภาคเหนือ|เศรษฐกิจ|รายได้|ท่องเที่ยว|province|regional|economy/i.test(`${question} ${answer}`)) {
    return lang === "th"
      ? ["ถ้ารายได้สะดุด ควรเตรียมอะไรบ้าง", "มาตรการช่วยเหลือหนี้มีอะไรที่ควรรู้"]
      : ["How can I prepare for an income disruption?", "What debt support options should I know about?"]
  }
  return lang === "th"
    ? ["ช่วยประเมินภาระหนี้ให้หน่อย", "อยากถามเรื่องมาตรการช่วยเหลือ"]
    : ["Help me check my debt burden", "Ask about support programs"]
}

function subscribeNoop() {
  return () => {}
}

function getSpeechInputSupported() {
  const browserWindow = window as WindowWithSpeech
  return Boolean(browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition)
}

function getSpeechOutputSupported() {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window
}

function getServerFalse() {
  return false
}

export function CTA({ fullPage = false }: { fullPage?: boolean }) {
  const { lang, selectedProvinceCode } = useAppState()
  const [isOpen, setIsOpen] = useState(fullPage)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>(() => [greetingFor(lang)])
  const [followUps, setFollowUps] = useState<string[]>([])
  const [assessment, setAssessment] = useState<AssessmentDraft | null>(null)
  const [chatAreaScope, setChatAreaScope] = useState<ChatAreaScope | null>(null)
  const [areaClarification, setAreaClarification] = useState<AreaClarification | null>(null)
  const [areaProvinceDraft, setAreaProvinceDraft] = useState(selectedProvinceCode || "CM")
  const [listening, setListening] = useState(false)
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null)
  const router = useRouter()
  const speechSupported = useSyncExternalStore(subscribeNoop, getSpeechInputSupported, getServerFalse)
  const speechOutputSupported = useSyncExternalStore(subscribeNoop, getSpeechOutputSupported, getServerFalse)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(2)
  const speechRef = useRef<SpeechRecognitionLike | null>(null)
  const displayedMessages = messages.length === 1 && messages[0].id === 1 ? [greetingFor(lang)] : messages

  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, sending, assessment, followUps])

  useEffect(
    () => () => {
      speechRef.current?.stop()
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel()
    },
    [],
  )

  function addMessage(message: Omit<ChatMessage, "id">) {
    setMessages((curr) =>
      curr.length === 1 && curr[0].id === 1
        ? [greetingFor(lang), { ...message, id: nextId.current++ }]
        : [...curr, { ...message, id: nextId.current++ }],
    )
  }

  function startAssessment(promptText?: string) {
    setFollowUps([])
    setVoiceNotice(null)
    const raw = promptText ?? ""
    const matchedProvince = findProvinceCode(raw)
    const isBusiness = /(กิจการ|ธุรกิจ|ร้าน|business|shop|enterprise)/i.test(raw)
    const hasType = isBusiness || /(บุคคล|ครัวเรือน|household|individual)/i.test(raw)
    const next: AssessmentDraft = {
      step: "type",
      businessType: isBusiness ? "general_service" : "household",
      businessLabel: isBusiness
        ? lang === "th" ? "กิจการ / อาชีพ" : "Business"
        : lang === "th" ? "บุคคล / ครัวเรือน" : "Household",
      province: matchedProvince ?? (chatAreaScope?.kind === "province" ? chatAreaScope.code : ""),
      monthlyIncome: amountAfter(raw, "รายรับ|รายได้|เงินเดือน|income|revenue"),
      monthlyDebt: amountAfter(raw, "จ่ายหนี้(?:ต่อเดือน)?|ค่างวด|ผ่อน(?:ชำระ)?(?:ต่อเดือน)?|debt payments?"),
      debtSkipped: false,
      monthlyExpenses: null,
      expensesSkipped: false,
      cashReserve: null,
      reserveSkipped: false,
      totalPrincipal: null,
      annualRate: null,
      horizonYears: null,
      debtStatus: null,
      impactTags: [],
      impactLabel: lang === "th" ? "ไม่มีเหตุพิเศษ" : "No special impact",
    }
    next.step = hasType ? nextAssessmentStep(next) : "type"
    setAssessment(next)
    if (promptText) addMessage({ role: "user", text: promptText, contextText: "ช่วยประเมินภาระหนี้" })
    addMessage({
      role: "assistant",
      text:
        next.step === "type"
          ? lang === "th"
            ? "ได้ครับ ผมช่วยประเมินเบื้องต้นให้ได้ ขอถามทีละข้อนะครับ ไม่ต้องบอกชื่อหรือเลขบัญชี ข้อมูลนี้เป็นของบุคคล/ครัวเรือน หรือกิจการครับ?"
            : "I can help with a preliminary check. I’ll ask one thing at a time; please don’t share your name or account number. Is this for a household or a business?"
          : (lang === "th" ? "ได้ครับ ผมช่วยประเมินเบื้องต้นให้ ไม่ต้องบอกชื่อหรือเลขบัญชีครับ\n" : "I can help with a preliminary check. No name or account number is needed.\n")
            + (next.province ? (lang === "th" ? `ใช้จังหวัด${provinceLabel(next.province, "th")} หากต้องการเปลี่ยนบอกได้ครับ\n` : `I’ll use ${provinceLabel(next.province, "en")}; tell me if you want to change it.\n`) : "")
            + assessmentQuestion(next.step, next.province, lang),
    })
  }

  async function runAssessment(data: AssessmentDraft) {
    setSending(true)
    setFollowUps([])
    try {
      const res = await submitReliefCheck({
        province: data.province,
        business_type: data.businessType,
        monthly_revenue_thb: data.monthlyIncome ?? 0,
        monthly_debt_thb: data.monthlyDebt ?? 0,
        total_principal_thb: data.totalPrincipal ?? 0,
        debt_payment_unspecified: data.debtSkipped,
        impact_tags: [...new Set([
          ...data.impactTags,
          ...(data.debtStatus === "persistent" ? ["persistent_debt"] : []),
          ...(data.debtStatus === "overdue_31_120" || data.debtStatus === "overdue_120_plus" ? ["overdue_debt"] : []),
          ...(data.debtStatus === "disaster" ? ["disaster"] : []),
        ])],
        language: lang,
      })
      const incomeVal = data.monthlyIncome ?? 0
      const debtVal = data.monthlyDebt ?? 0
      const principalVal = data.totalPrincipal ?? 0
      const isSme = data.businessType !== "household"
      const hasPaidDebt = debtVal > 0
      const hasPrincipalWithZeroPay = !hasPaidDebt && principalVal > 0
      const zeroIncomeNoPayments = incomeVal === 0 && debtVal === 0 && principalVal === 0
      const hasExpenses = data.monthlyExpenses != null && !data.expensesSkipped
      const hasReserve = data.cashReserve != null && !data.reserveSkipped
      const diagnostic = hasExpenses
        ? computeFinancialDiagnostic({
            isSme,
            monthlyRevenue: incomeVal,
            monthlyOpex: data.monthlyExpenses ?? 0,
            monthlyDebt: debtVal,
            cashReserve: hasReserve ? (data.cashReserve ?? 0) : 0,
            stressDropPct: 30,
          })
        : null
      const loan = data.debtStatus && data.debtStatus !== "overdue_120_plus"
        ? buildLoanComparison({
            status: data.debtStatus,
            isSme,
            monthlyRevenue: incomeVal,
            monthlyDebt: debtVal,
            totalPrincipalInput: principalVal,
            ...(data.annualRate != null && data.annualRate > 0 ? { customAnnualRatePct: data.annualRate } : {}),
            borrowerAge: 0,
            clinicMonths: (data.horizonYears ?? 5) * 12,
            deferMonths: 6,
            customHorizonYears: data.horizonYears ?? 5,
            lang,
          })
        : null
      const matchedPrograms = matchOfficialPrograms({
        status: data.debtStatus ?? "current",
        isSme,
        dscr: diagnostic?.dscr ?? null,
        dsrPct: incomeVal > 0 && hasPaidDebt ? Number(((debtVal / incomeVal) * 100).toFixed(1)) : null,
      })

      const estPay = loan?.originalMonthlyPayment ?? 0
      const estDsrPct = estPay > 0 && incomeVal > 0 ? Number(((estPay / incomeVal) * 100).toFixed(1)) : null
      let dsrBlockTh = ""
      let dsrBlockEn = ""
      if (incomeVal <= 0) {
        dsrBlockTh = "ภาระหนี้ต่อรายรับ: คำนวณไม่ได้จากข้อมูลนี้\nไม่มีรายรับที่ใช้เป็นฐานคำนวณ จึงระบุสัดส่วนค่างวดต่อรายรับไม่ได้"
        dsrBlockEn = "Debt payment to income: Not available from these inputs\nThere is no positive income base, so debt payments as a share of income cannot be calculated."
      } else if (hasPaidDebt) {
        const dsrPct = Number(((debtVal / incomeVal) * 100).toFixed(1))
        dsrBlockTh = `ค่างวดที่แจ้งคิดเป็น ${dsrPct.toFixed(1)}% ของรายรับต่อเดือน\nควรดูตัวเลขนี้ร่วมกับค่าใช้จ่ายจำเป็น เงินสำรอง และยอดหนี้คงเหลือ`
        dsrBlockEn = `The payment you reported is ${dsrPct.toFixed(1)}% of monthly income.\nConsider it alongside essential expenses, savings, and outstanding principal.`
      } else if (hasPrincipalWithZeroPay) {
        dsrBlockTh = `ภาระหนี้ต่อรายรับ: ${data.debtSkipped ? "ยังไม่ได้ระบุค่างวดต่อเดือน" : "แจ้งยอดผ่อนปัจจุบัน 0 บาท/เดือน (แต่ยังมีเงินต้นคงเหลือ)"}\n${
          data.debtSkipped
            ? `ข้ามการระบุค่างวดรายเดือน แต่มีเงินต้นคงเหลือ ${money(principalVal, "th")} จึงไม่ถือว่าไม่มีภาระหนี้`
            : `แม้ปัจจุบันยังไม่มีค่างวดที่จ่ายรายเดือน (เช่น ช่วงพักชำระหรือยังไม่เริ่มผ่อน) แต่ยังมีเงินต้นคงเหลือ ${money(principalVal, "th")} จึงไม่ถือว่าไม่มีภาระหนี้`
        }${estPay > 0 && estDsrPct != null ? ` · หากคิดเป็นค่างวดผ่อนมาตรฐานจะอยู่ที่ราว ${money(estPay, "th")}/เดือน (ประมาณ ${estDsrPct.toFixed(1)}% ของรายรับ)` : ""}`
        dsrBlockEn = `Debt payment to income: ${data.debtSkipped ? "Monthly payment not specified" : "0 THB/month currently paid (with outstanding principal)"}\nWith ${money(principalVal, "en")} in remaining principal, this is not treated as debt free.${
          estPay > 0 && estDsrPct != null
            ? ` Under standard amortization, the estimated payment would be around ${money(estPay, "en")}/month (${estDsrPct.toFixed(1)}% of income).`
            : ""
        }`
      } else {
        dsrBlockTh = "ภาระหนี้ต่อรายรับ: 0.0% (ไม่มีค่างวดที่จ่ายอยู่และไม่ได้ระบุยอดเงินต้นคงเหลือ)\nหากมีหนี้ที่กำลังพักชำระหรือยังไม่ได้เริ่มผ่อน แนะนำให้ระบุยอดเงินต้นคงเหลือเพื่อให้ระบบจำลองแนวทางวางแผนให้ได้"
        dsrBlockEn = "Debt payment to income: 0.0% (no monthly payment or principal specified)\nIf you have deferred or grace-period debt, enter the remaining principal so an illustrative plan can be calculated."
      }

      const baselinePaymentLabelTh = hasPaidDebt ? "ค่างวดเดิมที่ใช้เปรียบเทียบ" : "ค่างวดมาตรฐานประมาณการจากเงินต้น"
      const baselinePaymentLabelEn = hasPaidDebt ? "baseline payment" : "estimated standard payment from principal"
      const cashflowNoteTh = diagnostic
        ? `เงินเหลือหลังหักค่าใช้จ่ายจำเป็นและค่างวด: ${money(diagnostic.netMonthlyCashflow, "th")}/เดือน · ${hasReserve ? `เงินสำรองคิดเป็น ${diagnostic.runwayTotalMonths == null ? "คำนวณระยะเวลาไม่ได้" : `${diagnostic.runwayTotalMonths} เดือน`}` : "ระยะเวลาเงินสำรอง: ยังคำนวณไม่ได้เนื่องจากไม่ได้ระบุเงินสำรอง"} · หากรายรับลดลง 30% เงินเหลือจะเป็น ${money(diagnostic.stressedNetMonthlyCashflow, "th")}/เดือน`
        : "ยังสรุปเงินเหลือหลังหักค่าใช้จ่ายจำเป็นไม่ได้ เนื่องจากไม่ได้ระบุค่าใช้จ่ายจำเป็น"
      const cashflowNoteEn = diagnostic
        ? `Monthly cash flow after essential expenses and debt: ${money(diagnostic.netMonthlyCashflow, "en")}/month · ${hasReserve ? `Reserve runway: ${diagnostic.runwayTotalMonths == null ? "not available" : `${diagnostic.runwayTotalMonths} months`}` : "Reserve runway: not calculated because savings were skipped"} · With a 30% income reduction: ${money(diagnostic.stressedNetMonthlyCashflow, "en")}/month`
        : "Post-expense cash flow is unavailable because essential expenses were not provided"
      const loanNoteTh = data.debtStatus === "overdue_120_plus"
        ? !isSme
          ? "\nกรณีค้างชำระเกิน 4 เดือน (120 วัน): แนะนำตรวจสอบสิทธิ์ตรงกับ คลินิกแก้หนี้ by SAM (โทร 1443 สำหรับหนี้เสียไม่มีหลักประกัน ดอกเบี้ย 3–5% ต่อปี ผ่อนสูงสุด 10 ปี) หรือ โครงการปิดหนี้ไว ไปต่อได้ (หนี้เสียรวมทุกแห่งไม่เกิน 100,000 บาท โทร 1213 หรือ 1443 กด 6)"
          : "\nกรณีค้างชำระเกิน 4 เดือน (กิจการ): แนะนำติดต่อสถาบันการเงินเจ้าหนี้โดยตรงเพื่อขอปรับโครงสร้างหนี้ตามความสามารถในการชำระจริง (หลักเกณฑ์การให้สินเชื่ออย่างรับผิดชอบ 2568 เอกสารแนบ 7)"
        : loan
          ? `\nตัวอย่างจำลอง ${loan.horizonYears} ปี: ${baselinePaymentLabelTh} ${money(loan.originalMonthlyPayment, "th")}/เดือน · เงินต้น ${loan.usesEstimatedPrincipal ? `ประมาณ ${money(loan.principalUsed, "th")} (ประเมินจากค่างวดเดิมภายใต้สมมติฐานเหลือ ${loan.estimatedPrincipalMonths} งวด)` : money(loan.principalUsed, "th")} · ดอกเบี้ยอ้างอิง ${formatRatePct(loan.originalRatePct)}% ต่อปี${loan.usesAssumedRate ? " (สมมติฐาน ไม่ใช่อัตราจริงในสัญญา)" : ""}\n${loan.policyTitleTh} · ค่างวดตัวอย่างปีแรก ${money(loan.policyYear1Payment, "th")}/เดือน\n${loan.ruleCaptionTh}`
          : "\nยังทำตัวอย่างแผนผ่อนไม่ได้จากข้อมูลยอดหนี้หรือค่างวดที่ระบุ"
      const loanNoteEn = data.debtStatus === "overdue_120_plus"
        ? !isSme
          ? "\nFor unsecured personal NPLs overdue > 4 months (120 days): verify eligibility directly with Debt Clinic by SAM (call 1443; 3–5% p.a. up to 10 years) or Clear Debt Move Forward (combined NPLs <= 100,000 THB; call 1213 or 1443 ext. 6)."
          : "\nFor business loans overdue > 4 months: contact your lender directly to request capacity-based restructuring under Responsible Lending 2568 (Annex 7)."
        : loan
          ? `\nIllustrative ${loan.horizonYears}-year comparison: ${baselinePaymentLabelEn} ${money(loan.originalMonthlyPayment, "en")}/month · principal ${loan.usesEstimatedPrincipal ? `estimated at ${money(loan.principalUsed, "en")} from payment (assuming ${loan.estimatedPrincipalMonths} remaining months)` : money(loan.principalUsed, "en")} · reference rate ${formatRatePct(loan.originalRatePct)}% p.a.${loan.usesAssumedRate ? " (assumption, not your contract rate)" : ""}\n${loan.policyTitleEn} · illustrative year-one payment ${money(loan.policyYear1Payment, "en")}/month\n${loan.ruleCaptionEn}`
          : "\nAn illustrative repayment comparison could not be calculated from the principal/payment provided"
      const matchedProgramsBlockTh = matchedPrograms.length > 0
        ? `\n\nช่องทางและมาตรการที่ตรงกับข้อมูลเบื้องต้น:\n${matchedPrograms.map((prog, idx) => `${idx + 1}. ${prog.title_th} — ${prog.benefit_th}`).join("\n")}`
        : ""
      const matchedProgramsBlockEn = matchedPrograms.length > 0
        ? `\n\nMatched official channels and frameworks:\n${matchedPrograms.map((prog, idx) => `${idx + 1}. ${prog.title_en} — ${prog.benefit_en}`).join("\n")}`
        : ""
      const ragGuidanceBlockTh = !res.policy_guidance.was_refused && res.policy_guidance.answer_text
        ? `\n\nข้อมูลอ้างอิงจากเอกสารทางการ:\n${res.policy_guidance.answer_text}`
        : res.policy_guidance.was_refused
          ? "\n\nรอบนี้ยังหาเอกสารมาตรการที่ตรงกับข้อมูลไม่พบ จึงยังสรุปรายละเอียดหรือสิทธิ์เพิ่มเติมจากเอกสารไม่ได้"
          : ""
      const ragGuidanceBlockEn = !res.policy_guidance.was_refused && res.policy_guidance.answer_text
        ? `\n\nGrounded official document guidance:\n${res.policy_guidance.answer_text}`
        : res.policy_guidance.was_refused
          ? "\n\nI could not find a source that directly matches this case, so I cannot summarize additional document terms."
          : ""
      const calculationNote = lang === "th"
        ? `\n\n${cashflowNoteTh}${loanNoteTh}${hasPrincipalWithZeroPay ? "\nหมายเหตุ: ค่างวดจำลองนี้คำนวณจากเงินต้น ดอกเบี้ย และระยะเวลา ไม่ใช่ยอดที่แจ้งว่าจ่ายอยู่ในปัจจุบัน" : ""}\nตัวเลขเป็นการจำลองเบื้องต้น ไม่ใช่การยืนยันสิทธิหรือข้อเสนอจากเจ้าหนี้${matchedProgramsBlockTh}${ragGuidanceBlockTh}`
        : `\n\n${cashflowNoteEn}${loanNoteEn}${hasPrincipalWithZeroPay ? "\nNote: this simulated payment uses principal, rate, and term; it is not the current payment you reported." : ""}\nThis is an estimate, not confirmation of eligibility or a lender offer.${matchedProgramsBlockEn}${ragGuidanceBlockEn}`
      const answer = normalizeCurrencyLabels(
        lang === "th"
          ? `ผลประเมินเบื้องต้นของ${provinceLabel(data.province, "th")}\n${dsrBlockTh}${zeroIncomeNoPayments ? "\n\nรายรับและค่างวดเป็น 0 ทั้งคู่ จึงยังสรุปความสามารถชำระหนี้จากอัตราส่วนนี้ไม่ได้" : ""}${calculationNote}`
          : `Preliminary check for ${provinceLabel(data.province, "en")}\n${dsrBlockEn}${zeroIncomeNoPayments ? "\n\nBoth income and payments are zero, so this ratio cannot establish affordability." : ""}${calculationNote}`
      )
      const summaryKeyPoint = hasPaidDebt
        ? (lang === "th"
          ? `รายรับ ${money(incomeVal, "th")} · จ่ายหนี้ ${money(debtVal, "th")}`
          : `Income ${money(incomeVal, "en")} · debt payments ${money(debtVal, "en")}`)
        : hasPrincipalWithZeroPay
          ? (lang === "th"
            ? `รายรับ ${money(incomeVal, "th")} · เงินต้นหนี้ ${money(principalVal, "th")}${estPay > 0 ? ` · ประเมินค่างวดมาตรฐาน ${money(estPay, "th")}/เดือน` : ""}`
            : `Income ${money(incomeVal, "en")} · principal ${money(principalVal, "en")}${estPay > 0 ? ` · est. standard payment ${money(estPay, "en")}/mo` : ""}`)
          : (lang === "th"
            ? `รายรับ ${money(incomeVal, "th")} · ยังไม่มีค่างวดรายเดือนที่ระบุ`
            : `Income ${money(incomeVal, "en")} · no monthly debt payment specified`)
      const ragKeyPoints = !res.policy_guidance.was_refused ? (res.policy_guidance.key_points ?? []).slice(0, 3) : []
      addMessage({
        role: "assistant",
        text: answer,
        keyPoints: [summaryKeyPoint, ...ragKeyPoints],
        citations: res.policy_guidance.citations,
        wasRefused: res.policy_guidance.was_refused,
        feedback: {
          modelUsed: "relief_check_rag",
          topVectorSim: res.policy_guidance.top_vector_sim ?? 0,
          wasRefused: res.policy_guidance.was_refused,
        },
      })
      setAssessment(null)
      setFollowUps(lang === "th"
        ? ["ถ้าจ่ายไม่ไหว ควรเริ่มคุยกับใคร", "เปิดเครื่องคำนวณละเอียด"]
        : ["Who should I contact if I cannot pay?", "Open detailed calculator"])
    } catch (err) {
      addMessage({
        role: "assistant",
        text:
          lang === "th"
            ? `ยังประเมินไม่สำเร็จครับ ลองตรวจชื่อจังหวัดและลองอีกครั้งได้เลย (${formatFetchError(err, lang)})`
            : `I couldn’t complete the check. Please verify the province and try again. (${formatFetchError(err, lang)})`,
      })
    } finally {
      setSending(false)
    }
  }

  function chooseAssessmentType(type: "general_service" | "household") {
    if (!assessment) return
    const label = type === "household" ? (lang === "th" ? "บุคคล / ครัวเรือน" : "Household") : lang === "th" ? "กิจการ / อาชีพ" : "Business"
    const next: AssessmentDraft = {
      ...assessment,
      step: nextAssessmentStep(assessment),
      businessType: type,
      businessLabel: label,
    }
    setAssessment(next)
    addMessage({ role: "user", text: label })
    addMessage({
      role: "assistant",
      text: (next.province && next.step !== "province"
        ? lang === "th" ? "ใช้จังหวัด" + provinceLabel(next.province, "th") + "นะครับ\n" : "I’ll use " + provinceLabel(next.province, "en") + ".\n"
        : "") + assessmentQuestion(next.step, next.province, lang),
    })
  }

  function buildConfirmationMessage(next: AssessmentDraft): string {
    const debtSummaryTh = next.debtSkipped
      ? "ข้าม ไม่ทราบค่างวด (จะประเมินเทียบจากเงินต้นหากระบุ)"
      : (next.monthlyDebt ?? 0) === 0 && (next.totalPrincipal ?? 0) > 0
        ? `${money(0, "th")} (แต่มีเงินต้นคงเหลือ ${money(next.totalPrincipal!, "th")})`
        : money(next.monthlyDebt ?? 0, "th")
    const debtSummaryEn = next.debtSkipped
      ? "skipped (will estimate from principal if provided)"
      : (next.monthlyDebt ?? 0) === 0 && (next.totalPrincipal ?? 0) > 0
        ? `${money(0, "en")} (with ${money(next.totalPrincipal!, "en")} remaining principal)`
        : money(next.monthlyDebt ?? 0, "en")
    return lang === "th"
      ? `ขอทวนข้อมูลก่อนคำนวณครับ\n• ประเภท: ${next.businessLabel}\n• จังหวัด: ${provinceLabel(next.province, "th")}\n• รายรับต่อเดือน: ${money(next.monthlyIncome ?? 0, "th")}\n• จ่ายหนี้ต่อเดือน: ${debtSummaryTh}\n• ค่าใช้จ่ายจำเป็น: ${next.expensesSkipped ? "ข้าม" : money(next.monthlyExpenses ?? 0, "th")} · เงินสำรอง: ${next.reserveSkipped ? "ข้าม" : money(next.cashReserve ?? 0, "th")}\n• เงินต้นคงเหลือ: ${next.totalPrincipal ? money(next.totalPrincipal, "th") : "ไม่ทราบ/ระบบประเมินจากค่างวด"} · ดอกเบี้ย: ${next.annualRate ? `${next.annualRate}% ต่อปี` : "ใช้สมมติฐาน"}\n• ระยะเวลาจำลอง: ${next.horizonYears ?? 5} ปี · สถานะหนี้: ${debtStatusLabel(next.debtStatus, "th")}\n• สถานการณ์เพิ่มเติม: ${next.impactLabel}\nข้อมูลถูกต้องไหมครับ?`
      : `Please confirm before I calculate:\n• Type: ${next.businessLabel}\n• Province: ${provinceLabel(next.province, "en")}\n• Monthly income: ${money(next.monthlyIncome ?? 0, "en")}\n• Monthly debt payments: ${debtSummaryEn}\n• Essential expenses: ${next.expensesSkipped ? "skipped" : money(next.monthlyExpenses ?? 0, "en")} · Cash reserve: ${next.reserveSkipped ? "skipped" : money(next.cashReserve ?? 0, "en")}\n• Principal: ${next.totalPrincipal ? money(next.totalPrincipal, "en") : "unknown/estimated from payment"} · Interest: ${next.annualRate ? `${next.annualRate}% p.a.` : "assumed"}\n• Illustrative horizon: ${next.horizonYears ?? 5} years · Debt status: ${debtStatusLabel(next.debtStatus, "en")}\n• Additional situation: ${next.impactLabel}\nIs this correct?`
  }

  function advancePromptMessage(next: AssessmentDraft): string {
    return next.step === "confirm" ? buildConfirmationMessage(next) : assessmentQuestion(next.step, next.province, lang)
  }

  function chooseImpact(tags: string[], label: string) {
    if (!assessment) return
    const next: AssessmentDraft = { ...assessment, step: "confirm", impactTags: tags, impactLabel: label, returnToConfirm: false }
    setAssessment(next)
    addMessage({ role: "user", text: label })
    addMessage({
      role: "assistant",
      text: buildConfirmationMessage(next),
    })
  }

  function chooseDebtStatus(status: DebtStatusKey, label: string) {
    if (!assessment) return
    const clampedHorizon =
      status === "persistent" && assessment.horizonYears != null && assessment.horizonYears > 7
        ? 7
        : assessment.horizonYears
    const next: AssessmentDraft = {
      ...assessment,
      debtStatus: status,
      horizonYears: clampedHorizon,
      step: "horizon",
    }
    next.step = nextAssessmentStep(next)
    setAssessment(next)
    addMessage({ role: "user", text: label })
    addMessage({
      role: "assistant",
      text:
        next.step === "confirm"
          ? buildConfirmationMessage(next)
          : next.step === "horizon"
            ? status === "persistent"
              ? lang === "th"
                ? "สำหรับมาตรการปิดจบหนี้เรื้อรัง เลือกระยะเวลาจำลองได้สูงสุด 7 ปีครับ (เลือก 3, 5 หรือ 7 ปี)"
                : "For Persistent Debt exit, choose an illustrative horizon up to 7 years (3, 5, or 7 years)."
              : assessmentQuestion("horizon", next.province, lang)
            : lang === "th"
              ? "มีเหตุที่กระทบรายได้หรือการจ่ายหนี้เพิ่มเติมไหมครับ? เลือกได้ หรือเลือกไม่มีเหตุพิเศษ"
              : "Has anything else affected income or payments? Choose an option, or none.",
    })
  }

  function handleAssessmentText(prompt: string) {
    if (!assessment) return
    const value = prompt.trim()
    if (/^(ยกเลิก|หยุด|ไม่เอา|ออก|cancel|stop|exit)$/i.test(value)) {
      setAssessment(null)
      addMessage({ role: "user", text: value })
      addMessage({
        role: "assistant",
        text: lang === "th" ? "ยกเลิกการประเมินแล้วครับ สามารถพิมพ์คำถามทั่วไปต่อได้เลย" : "Assessment cancelled. Feel free to ask any general question.",
      })
      return
    }
    if (assessment.step === "province") {
      if (value.length < 2) return
      const matchedProv = findProvinceCode(value)
      if (!matchedProv) {
        addMessage({ role: "user", text: value })
        addMessage({
          role: "assistant",
          text:
            lang === "th"
              ? "ขออภัยครับ ระบบรองรับเฉพาะ 17 จังหวัดภาคเหนือ (เช่น เชียงใหม่ เชียงราย ลำปาง ลำพูน แม่ฮ่องสอน น่าน พะเยา แพร่ อุตรดิตถ์ ตาก สุโขทัย พิษณุโลก พิจิตร เพชรบูรณ์ กำแพงเพชร นครสวรรค์ อุทัยธานี) รบกวนพิมพ์ชื่อจังหวัดภาคเหนือได้เลยครับ"
              : "Sorry, this tool covers the 17 Northern Thailand provinces (e.g., Chiang Mai, Lamphun, Chiang Rai, Nan, Phitsanulok). Please enter a Northern province name.",
        })
        return
      }
      const next: AssessmentDraft = { ...assessment, step: assessment.returnToConfirm ? "confirm" : "income", province: matchedProv }
      if (!assessment.returnToConfirm) next.step = nextAssessmentStep(next)
      setAssessment(next)
      addMessage({ role: "user", text: provinceLabel(matchedProv, lang) })
      addMessage({ role: "assistant", text: advancePromptMessage(next) })
      return
    }
    if (assessment.step === "income_zero_confirm") {
      if (/(ไม่มีรายรับ|ไม่มีรายได้|ไม่มี|จริง|ใช่|no income|none|yes)/i.test(value)) {
        const next: AssessmentDraft = { ...assessment, step: "debt", monthlyIncome: 0 }
        next.step = nextAssessmentStep(next)
        setAssessment(next)
        addMessage({ role: "user", text: lang === "th" ? "ไม่มีรายรับตอนนี้" : "No income currently" })
        addMessage({ role: "assistant", text: advancePromptMessage(next) })
      } else if (/(ไม่สะดวก|ขอไม่บอก|ไม่อยากบอก|ข้าม|ไม่ระบุ|prefer not|rather not|skip)/i.test(value)) {
        setAssessment(null)
        addMessage({ role: "user", text: lang === "th" ? "ไม่สะดวกบอกรายรับ" : "Prefer not to share income" })
        addMessage({ role: "assistant", text: lang === "th" ? "ไม่เป็นไรครับ ผมจะไม่เดาตัวเลขหรือคำนวณสัดส่วนจากข้อมูลที่ไม่ครบครับ ถ้าสะดวกเมื่อไรค่อยเริ่มประเมินใหม่ได้ หรือถามข้อมูลทั่วไปต่อได้เลยครับ" : "That’s okay. I won’t guess or calculate a ratio without the needed information. You can restart when convenient or ask a general question." })
      } else {
        const correctedAmount = parseAmount(value)
        if (correctedAmount != null && correctedAmount > 0) {
          const next: AssessmentDraft = { ...assessment, step: "debt", monthlyIncome: correctedAmount }
          next.step = nextAssessmentStep(next)
          setAssessment(next)
          addMessage({ role: "user", text: money(correctedAmount, lang) })
          addMessage({ role: "assistant", text: advancePromptMessage(next) })
        } else {
          addMessage({ role: "assistant", text: assessmentQuestion("income_zero_confirm", assessment.province, lang) })
        }
      }
      return
    }
    if (assessment.step === "income" || assessment.step === "debt") {
      if (assessment.step === "debt" && /^(ข้าม|ไม่ทราบ|ไม่แน่ใจ|ไม่รู้|skip|unknown|not sure)$/i.test(value)) {
        const next: AssessmentDraft = { ...assessment, step: "expenses", monthlyDebt: 0, debtSkipped: true }
        next.step = nextAssessmentStep(next)
        setAssessment(next)
        addMessage({ role: "user", text: lang === "th" ? "ข้าม ไม่ทราบค่างวด" : "Skip, not sure" })
        addMessage({ role: "assistant", text: advancePromptMessage(next) })
        return
      }
      const amount = parseAmount(value)
      if (amount == null) {
        addMessage({
          role: "assistant",
          text: lang === "th" ? "ขอเป็นตัวเลขประมาณการได้ไหมครับ เช่น 25,000 บาท ถ้าพูดด้วยเสียงแล้วแปลงไม่ตรง แตะช่องข้อความเพื่อแก้ตัวเลขได้เลย" : "Please enter an approximate number, such as 25,000 THB. You can edit the recognized text if needed.",
        })
        return
      }
      if (assessment.step === "income") {
        if (amount === 0) {
          const next: AssessmentDraft = { ...assessment, step: "income_zero_confirm", monthlyIncome: 0 }
          setAssessment(next)
          addMessage({ role: "user", text: money(amount, lang) })
          addMessage({ role: "assistant", text: assessmentQuestion("income_zero_confirm", next.province, lang) })
          return
        }
        const next: AssessmentDraft = { ...assessment, step: assessment.returnToConfirm ? "confirm" : "debt", monthlyIncome: amount }
        if (!assessment.returnToConfirm) next.step = nextAssessmentStep(next)
        setAssessment(next)
        addMessage({ role: "user", text: money(amount, lang) })
        addMessage({ role: "assistant", text: advancePromptMessage(next) })
      } else {
        const next: AssessmentDraft = { ...assessment, step: assessment.returnToConfirm ? "confirm" : "expenses", monthlyDebt: amount, debtSkipped: false }
        if (!assessment.returnToConfirm) next.step = nextAssessmentStep(next)
        setAssessment(next)
        addMessage({ role: "user", text: money(amount, lang) })
        addMessage({ role: "assistant", text: advancePromptMessage(next) })
      }
      return
    }
    if (assessment.step === "rate_low_confirm") {
      const lowVal = assessment.pendingLowRate ?? 0.15
      const scaledVal = Number((lowVal * 100).toFixed(2))
      if (/^(ข้าม|ไม่ทราบ|ไม่แน่ใจ|skip|unknown|not sure)$/i.test(value)) {
        const next: AssessmentDraft = { ...assessment, annualRate: 0, rateSkipped: true, pendingLowRate: null, step: "status" }
        next.step = nextAssessmentStep(next)
        setAssessment(next)
        addMessage({ role: "user", text: lang === "th" ? "ข้าม ใช้สมมติฐาน" : "Skip, use assumption" })
        addMessage({ role: "assistant", text: advancePromptMessage(next) })
        return
      }
      const typedNum = parseAmount(value)
      if (typedNum != null && typedNum > 0 && typedNum <= 36) {
        const next: AssessmentDraft = { ...assessment, annualRate: typedNum, rateSkipped: false, pendingLowRate: null, step: "status" }
        next.step = nextAssessmentStep(next)
        setAssessment(next)
        addMessage({ role: "user", text: `${formatRatePct(typedNum)}% ${lang === "th" ? "ต่อปี" : "p.a."}` })
        addMessage({ role: "assistant", text: advancePromptMessage(next) })
        return
      }
      addMessage({
        role: "assistant",
        text:
          lang === "th"
            ? `กรุณาเลือก "${formatRatePct(lowVal)}% ต่อปี" หรือ "${formatRatePct(scaledVal)}% ต่อปี" หรือพิมพ์ตัวเลขใหม่ (ไม่เกิน 36%) ครับ`
            : `Please choose "${formatRatePct(lowVal)}% p.a." or "${formatRatePct(scaledVal)}% p.a.", or enter a rate up to 36%.`,
      })
      return
    }
    const optionalSteps: AssessmentStep[] = ["expenses", "reserve", "principal", "rate"]
    if (optionalSteps.includes(assessment.step)) {
      const skipped = /^(ข้าม|ไม่ทราบ|ไม่แน่ใจ|skip|unknown|not sure)$/i.test(value)
      const parsedAmount = skipped ? null : parseAmount(value)
      const amount = parsedAmount ?? (skipped ? 0 : null)
      if (amount == null && !/^(ข้าม|ไม่ทราบ|ไม่แน่ใจ|skip|unknown|not sure)$/i.test(value)) {
        addMessage({ role: "assistant", text: lang === "th" ? "พิมพ์ตัวเลข หรือเลือกข้ามได้ครับ" : "Enter a number or choose Skip." })
        return
      }
      if (assessment.step === "rate" && amount != null && amount > 36) {
        addMessage({ role: "assistant", text: lang === "th" ? "ดอกเบี้ยที่กรอกสูงเกินช่วงที่ระบบจำลองได้ กรุณาระบุไม่เกิน 36% ต่อปี หรือเลือกข้ามครับ" : "The rate is above the supported simulation range. Enter up to 36% p.a. or skip." })
        return
      }
      if (assessment.step === "rate" && !skipped && amount != null && amount > 0 && amount < 1) {
        const scaled = Number((amount * 100).toFixed(2))
        const next: AssessmentDraft = { ...assessment, pendingLowRate: amount, step: "rate_low_confirm" }
        setAssessment(next)
        addMessage({ role: "user", text: `${amount}` })
        addMessage({
          role: "assistant",
          text:
            lang === "th"
              ? `คุณกรอก ${formatRatePct(amount)} ซึ่งต่ำกว่า 1% ต่อปี ตั้งใจระบุ ${formatRatePct(amount)}% ต่อปีจริง ๆ หรือหมายถึง ${formatRatePct(scaled)}% ต่อปีครับ? เลือกปุ่มด้านล่างหรือพิมพ์ตัวเลขใหม่ได้เลย`
              : `You entered ${formatRatePct(amount)}, which is under 1% p.a. Did you mean ${formatRatePct(amount)}% p.a. or ${formatRatePct(scaled)}% p.a.? Choose below or type a new rate.`,
        })
        return
      }
      const fields = { expenses: "monthlyExpenses", reserve: "cashReserve", principal: "totalPrincipal", rate: "annualRate" } as const
      const field = fields[assessment.step as keyof typeof fields]
      const next: AssessmentDraft = {
        ...assessment,
        [field]: amount,
        ...(assessment.step === "expenses" ? { expensesSkipped: skipped } : {}),
        ...(assessment.step === "reserve" ? { reserveSkipped: skipped } : {}),
        ...(assessment.step === "principal" ? { principalSkipped: skipped } : {}),
        ...(assessment.step === "rate" ? { rateSkipped: skipped, pendingLowRate: null } : {}),
        step: "income",
      }
      next.step = nextAssessmentStep(next)
      setAssessment(next)
      const userReplyText = skipped
        ? (lang === "th" ? "ข้าม" : "Skip")
        : assessment.step === "rate"
          ? `${formatRatePct(amount ?? 0)}% ${lang === "th" ? "ต่อปี" : "p.a."}`
          : money(amount ?? 0, lang)
      addMessage({ role: "user", text: userReplyText })
      addMessage({ role: "assistant", text: advancePromptMessage(next) })
      return
    }
    if (assessment.step === "horizon") {
      const maxYears = assessment.debtStatus === "persistent" ? 7 : 30
      const years = parseAmount(value)
      if (years == null || years < 1 || years > maxYears) {
        addMessage({
          role: "assistant",
          text:
            assessment.debtStatus === "persistent"
              ? lang === "th"
                ? "สำหรับมาตรการปิดจบหนี้เรื้อรัง เลือกระยะเวลาได้ 1–7 ปี (เช่น 3, 5 หรือ 7 ปี) ตามหลักเกณฑ์ ธปท. ครับ"
                : "For Persistent Debt exit, choose between 1 and 7 years (e.g., 3, 5, or 7 years) under BOT rules."
              : lang === "th"
                ? "เลือกระยะเวลา 3, 5 หรือ 10 ปี หรือพิมพ์ 1–30 ปีครับ"
                : "Choose 3, 5, or 10 years, or enter 1–30 years.",
        })
        return
      }
      const next: AssessmentDraft = {
        ...assessment,
        horizonYears: years,
        step: assessment.returnToConfirm ? "confirm" : "impact",
      }
      if (!assessment.returnToConfirm) next.step = nextAssessmentStep(next)
      setAssessment(next)
      addMessage({ role: "user", text: `${years} ${lang === "th" ? "ปี" : "years"}` })
      addMessage({
        role: "assistant",
        text:
          next.step === "confirm"
            ? buildConfirmationMessage(next)
            : lang === "th"
              ? "มีเหตุที่กระทบรายได้หรือการจ่ายหนี้เพิ่มเติมไหมครับ? เลือกได้ หรือเลือกไม่มีเหตุพิเศษ"
              : "Has anything else affected income or payments? Choose an option, or none.",
      })
    }
  }

  async function submitPrompt(rawPrompt: string) {
    const prompt = rawPrompt.trim()
    if (!prompt || sending) return
    setVoiceNotice(null)

    if (areaClarification) {
      const province = findProvinceCode(prompt)
      if (asksNorthernOverview(prompt) || /ภาพรวม|ทั้งหมด|ภาคเหนือ|regional|region/i.test(prompt)) {
        chooseAreaScope({ kind: "regional" })
      } else if (province) {
        setAreaProvinceDraft(province)
        chooseAreaScope({ kind: "province", code: province })
      } else if (/เลือกจังหวัด|จังหวัดไหน|province/i.test(prompt)) {
        setAreaClarification({ ...areaClarification, step: "province" })
        addMessage({ role: "assistant", text: lang === "th" ? "เลือกจังหวัดที่ต้องการดูได้เลยครับ" : "Choose the province you want to see." })
      } else {
        addMessage({ role: "assistant", text: lang === "th" ? "เลือกภาพรวมภาคเหนือ หรือพิมพ์ชื่อจังหวัดที่ต้องการดูได้เลยครับ" : "Choose the Northern region overview or type a province name." })
      }
      return
    }

    if (assessment) {
      handleAssessmentText(prompt)
      return
    }

    if (isAssessmentRequest(prompt)) {
      startAssessment(prompt)
      return
    }

    setFollowUps([])
    addMessage({ role: "user", text: prompt, contextText: prompt })
    if (isGreeting(prompt) || isThanks(prompt)) {
      addMessage({
        role: "assistant",
        text: isThanks(prompt)
          ? lang === "th" ? "ยินดีครับ 😊 ถ้าอยากถามต่อหรือให้ช่วยประเมิน บอกได้เลยครับ" : "You’re welcome! 😊 Feel free to ask another question or request a check."
          : lang === "th" ? "สวัสดีครับ 😊 ผมช่วยประเมินภาระหนี้ เตรียมคุยกับเจ้าหนี้ และวางแผนรับมือรายได้ที่เปลี่ยนแปลงได้ครับ อยากเริ่มเรื่องไหนครับ" : "Hi! I can help you understand debt, prepare to talk with a lender, and plan for income changes. Where would you like to start?",
      })
      setFollowUps(isThanks(prompt) ? [] : lang === "th" ? ["ช่วยประเมินภาระหนี้ให้หน่อย", "เตรียมข้อมูลอะไรไปคุยกับเจ้าหนี้"] : ["Help me check my debt burden", "What should I prepare before talking to my lender?"])
      return
    }

    const mentionedProvince = findProvinceCode(prompt)
    const isAreaQuestion = needsAreaScope(prompt)
    const explicitRegional = asksNorthernOverview(prompt)
    const selectedScope = mentionedProvince
      ? { kind: "province", code: mentionedProvince } as const
      : explicitRegional
        ? { kind: "regional" } as const
        : chatAreaScope

    if (mentionedProvince) setChatAreaScope({ kind: "province", code: mentionedProvince })
    else if (explicitRegional) setChatAreaScope({ kind: "regional" })

    if (isAreaQuestion && !selectedScope) {
      setAreaClarification({ question: prompt, step: "scope" })
      addMessage({
        role: "assistant",
        text: lang === "th" ? "อยากดูภาพรวมภาคเหนือ หรือเจาะจงจังหวัดไหนครับ" : "Would you like the Northern region overview or a specific province?",
      })
      return
    }

    await sendChatAnswer(prompt, selectedScope)
  }

  async function sendChatAnswer(prompt: string, scope: ChatAreaScope | null) {
    setSending(true)
    setAreaClarification(null)
    try {
      const recentQuestions = messages
        .filter((message) => message.role === "user" && message.contextText)
        .slice(-4)
        .map((message) => message.contextText as string)
      const res = await sendPolicyChat({
        question: prompt,
        language: lang,
        province: scope?.kind === "province" ? scope.code : undefined,
        regional_scope: scope?.kind === "regional",
        recent_questions: recentQuestions,
      })
      addMessage({
        role: "assistant",
        text: res.answer_text,
        keyPoints: res.key_points,
        citations: res.citations,
        dataSources: res.data_sources,
        piiRedacted: res.pii_redacted_count,
        wasRefused: res.was_refused,
        feedback: { modelUsed: res.model_used, topVectorSim: res.top_vector_sim, wasRefused: res.was_refused },
      })
      if (!res.was_refused) setFollowUps(followUpsFor(prompt, res.answer_text, lang))
    } catch (err) {
      addMessage({ role: "assistant", text: formatFetchError(err, lang) })
    } finally {
      setSending(false)
    }
  }

  async function rateChatAnswer(messageId: number, rating: "helpful" | "inaccurate") {
    const message = messages.find((item) => item.id === messageId)
    if (!message?.feedback || message.feedback.sent) return
    try {
      await submitChatFeedback({
        rating,
        reason_tag: rating === "inaccurate" ? "wrong_fact" : undefined,
        language: lang,
        model_used: message.feedback.modelUsed,
        top_vector_sim: message.feedback.topVectorSim,
        was_refused: message.feedback.wasRefused,
      })
      setMessages((current) => current.map((item) => item.id === messageId && item.feedback
        ? { ...item, feedback: { ...item.feedback, sent: true } }
        : item))
    } catch {
      // Keep the chat usable when the optional feedback endpoint is unavailable.
    }
  }

  function chooseAreaScope(scope: ChatAreaScope) {
    const pending = areaClarification
    if (!pending) return
    setChatAreaScope(scope)
    addMessage({
      role: "user",
      text: scope.kind === "regional"
        ? lang === "th" ? "ภาพรวมภาคเหนือ" : "Northern region overview"
        : provinceLabel(scope.code, lang),
    })
    void sendChatAnswer(pending.question, scope)
  }

  function chooseProvinceForPendingQuestion() {
    const pending = areaClarification
    if (!pending) return
    chooseAreaScope({ kind: "province", code: areaProvinceDraft })
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const current = draft
    setDraft("")
    void submitPrompt(current)
  }

  function handleSuggestion(prompt: string) {
    if (/เปิดเครื่องคำนวณละเอียด|open detailed calculator/i.test(prompt)) {
      if (fullPage) {
        router.push("/#relief-assistant")
        return
      }
      setIsOpen(false)
      window.setTimeout(() => {
        document.getElementById("relief-assistant")?.scrollIntoView({ behavior: "smooth", block: "start" })
        document.getElementById("monthly-revenue")?.focus({ preventScroll: true })
      }, 220)
      return
    }
    if (/ประเมินภาระหนี้|ประเมินอีกครั้ง|check my debt burden|check again/i.test(prompt)) {
      startAssessment(prompt)
    } else {
      void submitPrompt(prompt)
    }
  }

  function startListening() {
    const browserWindow = window as WindowWithSpeech
    const Recognition = browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition
    if (!Recognition) {
      setVoiceNotice(lang === "th" ? "อุปกรณ์นี้ยังไม่รองรับการพูดเป็นข้อความ ลองพิมพ์แทนได้เลยครับ" : "Speech input is not supported here. You can type instead.")
      return
    }
    speechRef.current?.stop()
    const recognition = new Recognition()
    recognition.lang = lang === "th" ? "th-TH" : "en-US"
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1]?.[0]?.transcript
      if (transcript) setDraft((current) => `${current}${current ? " " : ""}${transcript}`)
    }
    recognition.onerror = () => {
      setVoiceNotice(lang === "th" ? "ฟังเสียงไม่สำเร็จ ลองพูดอีกครั้งหรือพิมพ์แทนได้ครับ" : "I couldn’t hear that. Please try again or type instead.")
      setListening(false)
    }
    recognition.onend = () => setListening(false)
    speechRef.current = recognition
    setVoiceNotice(lang === "th" ? "กำลังฟังอยู่ เสียงจะถูกแปลงเป็นข้อความให้ตรวจแก้ก่อนส่ง" : "Listening. Speech will be transcribed for you to review before sending.")
    setListening(true)
    try {
      recognition.start()
    } catch {
      setListening(false)
      setVoiceNotice(lang === "th" ? "เปิดไมโครโฟนไม่สำเร็จ ลองพิมพ์แทนได้เลยครับ" : "Couldn’t start the microphone. You can type instead.")
    }
  }

  function speak(text: string) {
    if (!("speechSynthesis" in window)) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang === "th" ? "th-TH" : "en-US"
    window.speechSynthesis.speak(utterance)
  }

  function resetConversation() {
    speechRef.current?.stop()
    setListening(false)
    setAssessment(null)
    setChatAreaScope(null)
    setAreaClarification(null)
    setAreaProvinceDraft(selectedProvinceCode || "CM")
    setFollowUps([])
    setVoiceNotice(null)
    setMessages([greetingFor(lang)])
    setDraft("")
    nextId.current = 2
  }

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.aside
            id="relief-assistant-chat"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            role={fullPage ? undefined : "dialog"}
            aria-label={lang === "th" ? "หน้าต่างสนทนาเพื่อวางแผนรับมือหนี้" : "Debt preparedness chat"}
            className={fullPage
              ? "relative mx-auto flex h-[calc(100dvh-12rem)] min-h-[28rem] w-full max-w-5xl flex-col overflow-hidden rounded-[1.75rem] border border-border bg-background shadow-sm"
              : "fixed bottom-24 right-4 z-[60] flex max-h-[min(36rem,calc(100dvh-8rem))] w-[min(25rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-[1.75rem] border border-border bg-background shadow-2xl sm:bottom-24 sm:right-6 sm:w-[min(28rem,calc(100vw-3rem))]"}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center opacity-[0.14] dark:opacity-[0.09]"
              style={{ backgroundImage: "url('/wat-rong-khun.jpg')" }}
            />
            <div className="relative z-10 flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-border/80 bg-background/80 px-4 py-3.5 backdrop-blur-md sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                  <MessageCircle aria-hidden="true" className="size-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="font-display text-sm font-semibold text-foreground">
                    {lang === "th" ? "ผู้ช่วยวางแผนรับมือหนี้" : "Debt & Preparedness Assistant"}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {lang === "th" ? "ประเมินเบื้องต้น · เตรียมคุยกับเจ้าหนี้" : "Understand your situation · prepare to talk with a lender"}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {messages.length > 1 && (
                  <button type="button" onClick={resetConversation} aria-label={lang === "th" ? "เริ่มบทสนทนาใหม่" : "Start a new chat"} title={lang === "th" ? "เริ่มบทสนทนาใหม่" : "Start a new chat"} className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                    <RotateCcw aria-hidden="true" className="size-3.5" />
                  </button>
                )}
                {!fullPage && (
                  <button type="button" onClick={() => setIsOpen(false)} aria-label={lang === "th" ? "ปิดหน้าต่างสนทนา" : "Close chat"} className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                    <X aria-hidden="true" className="size-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 border-b border-border bg-secondary/45 px-4 py-2">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck aria-hidden="true" className="size-3 shrink-0" />
                {lang === "th" ? "ช่วยปกปิดข้อมูลส่วนตัวที่ตรวจพบ" : "Helps hide personal details it detects"}
              </span>
            </div>

            <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4" aria-live="polite">
              {displayedMessages.map((message) => (
                <div key={message.id} className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
                  <div className={`max-w-[92%] whitespace-pre-line rounded-2xl px-3.5 py-3 text-sm leading-6 ${message.role === "user" ? "bg-foreground text-background" : "bg-secondary text-foreground"}`}>
                    {message.text}
                    {message.keyPoints && message.keyPoints.length > 0 && (
                      <ul className="mt-2 space-y-1 border-t border-border/60 pt-2">
                        {message.keyPoints.map((point, index) => <li key={index} className="flex items-start gap-1.5 text-xs leading-5"><Check aria-hidden="true" className="mt-0.5 size-3 shrink-0" /><span>{point}</span></li>)}
                      </ul>
                    )}
                  </div>
                  {message.role === "assistant" && speechOutputSupported && (
                    <button type="button" onClick={() => speak(message.text)} aria-label={lang === "th" ? "อ่านข้อความนี้ออกเสียง" : "Read this message aloud"} title={lang === "th" ? "อ่านข้อความออกเสียง" : "Read aloud"} className="mt-1 inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground">
                      <Volume2 aria-hidden="true" className="size-3.5" />{lang === "th" ? "ฟังคำตอบ" : "Listen"}
                    </button>
                  )}
                  {message.piiRedacted != null && message.piiRedacted > 0 && <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-[10px] text-muted-foreground"><ShieldCheck aria-hidden="true" className="size-3" />{lang === "th" ? `ปกปิดข้อมูลส่วนตัว ${message.piiRedacted} รายการ` : `${message.piiRedacted} personal detail(s) redacted`}</span>}
                  {message.citations && message.citations.length > 0 && (
                    <div className="mt-1 flex max-w-full flex-wrap gap-1.5">
                      {message.citations.map((citation, index) => {
                        const label = lang === "th" ? `${citation.doc_title} หน้า ${citation.page_num}` : `${citation.doc_title}, p.${citation.page_num}`
                        return citation.doc_url ? <a key={index} href={citation.doc_url} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[10px] leading-4 text-foreground hover:bg-secondary"><Check aria-hidden="true" className="size-2.5 shrink-0" /><span className="max-w-[210px] truncate">{label}</span><ExternalLink aria-hidden="true" className="size-2.5 shrink-0" /></a> : <span key={index} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[10px] leading-4 text-muted-foreground"><Check aria-hidden="true" className="size-2.5 shrink-0" /><span className="max-w-[210px] truncate">{label}</span></span>
                      })}
                    </div>
                  )}
                  {message.dataSources && message.dataSources.length > 0 && (
                    <div className="mt-1 flex max-w-full flex-wrap gap-1.5" aria-label={lang === "th" ? "ข้อมูลพื้นที่ที่ใช้ตอบ" : "Local data used"}>
                      {message.dataSources.map((source, index) => source.source_url
                        ? <a key={`${source.title}-${index}`} href={source.source_url} target="_blank" rel="noreferrer" className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[10px] leading-4 text-foreground hover:bg-secondary"><span className="max-w-[230px] truncate">{source.title}</span><ExternalLink aria-hidden="true" className="size-2.5 shrink-0" /></a>
                        : <span key={`${source.title}-${index}`} className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[10px] leading-4 text-muted-foreground"><span className="max-w-[230px] truncate">{source.title}</span></span>)}
                    </div>
                  )}
                  {message.feedback && (
                    <div className="mt-1 flex items-center gap-1" aria-label={lang === "th" ? "ประเมินคำตอบ" : "Rate this answer"}>
                      {message.feedback.sent ? (
                        <span className="px-2 text-[11px] text-muted-foreground">{lang === "th" ? "ขอบคุณสำหรับความเห็น" : "Thanks for the feedback"}</span>
                      ) : (
                        <>
                          <span className="px-2 text-[11px] text-muted-foreground">{lang === "th" ? "คำตอบนี้ช่วยได้ไหม" : "Was this helpful?"}</span>
                          <button type="button" onClick={() => void rateChatAnswer(message.id, "helpful")} aria-label={lang === "th" ? "คำตอบมีประโยชน์" : "Helpful answer"} className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"><ThumbsUp aria-hidden="true" className="size-4" /></button>
                          <button type="button" onClick={() => void rateChatAnswer(message.id, "inaccurate")} aria-label={lang === "th" ? "คำตอบคลาดเคลื่อน" : "Inaccurate answer"} className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"><ThumbsDown aria-hidden="true" className="size-4" /></button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {messages.length === 1 && !assessment && (
                <div className="mt-1 flex flex-wrap gap-2" aria-label={lang === "th" ? "ตัวอย่างคำถาม" : "Suggested questions"}>
                  {(lang === "th"
                    ? ["ช่วยประเมินภาระหนี้ให้หน่อย", "ถ้ารายได้ลดลงควรเตรียมตัวยังไง", "เตรียมข้อมูลอะไรไปคุยกับเจ้าหนี้", "มาตรการช่วยเหลือหนี้มีอะไรบ้าง", "ดูสถานการณ์จังหวัดที่อาจกระทบรายได้"]
                    : ["Help me check my debt burden", "How should I prepare if income falls?", "What should I prepare before talking to my lender?", "What debt support options are available?", "Show local conditions that may affect income"]
                  ).map((prompt) => <button key={prompt} type="button" onClick={() => handleSuggestion(prompt)} className="min-h-11 rounded-full border border-border bg-background px-3 py-2 text-left text-sm leading-5 text-muted-foreground hover:bg-secondary hover:text-foreground">{prompt}</button>)}
                </div>
              )}

              {areaClarification && !sending && (
                <div className="ml-1 flex max-w-[95%] flex-wrap items-center gap-2" aria-label={lang === "th" ? "เลือกขอบเขตพื้นที่" : "Choose an area scope"}>
                  {areaClarification.step === "scope" ? <>
                    <button type="button" onClick={() => chooseAreaScope({ kind: "regional" })} className="min-h-11 rounded-full border border-border bg-background px-3 text-sm hover:bg-secondary">{lang === "th" ? "ภาพรวมภาคเหนือ" : "Northern region overview"}</button>
                    <button type="button" onClick={() => setAreaClarification({ ...areaClarification, step: "province" })} className="min-h-11 rounded-full border border-border bg-background px-3 text-sm hover:bg-secondary">{lang === "th" ? "เลือกจังหวัด" : "Choose a province"}</button>
                  </> : <>
                    <select value={areaProvinceDraft} onChange={(event) => setAreaProvinceDraft(event.target.value)} aria-label={lang === "th" ? "เลือกจังหวัด" : "Choose province"} className="min-h-11 rounded-full border border-border bg-background px-3 text-sm">
                      {Object.entries(PROVINCE_NAMES).map(([code, names]) => <option key={code} value={code}>{names[lang]}</option>)}
                    </select>
                    <button type="button" onClick={chooseProvinceForPendingQuestion} className="min-h-11 rounded-full bg-foreground px-4 text-sm font-medium text-background hover:opacity-90">{lang === "th" ? "ดูจังหวัดนี้" : "Show this province"}</button>
                    <button type="button" onClick={() => setAreaClarification({ ...areaClarification, step: "scope" })} className="min-h-11 rounded-full border border-border px-3 text-sm">{lang === "th" ? "กลับ" : "Back"}</button>
                  </>}
                </div>
              )}

              {assessment && !sending && (
                <div className="ml-1 flex max-w-[95%] flex-wrap gap-2" aria-label={lang === "th" ? "ตัวเลือกประเมิน" : "Assessment options"}>
                  {assessment.step === "type" && <><button type="button" onClick={() => chooseAssessmentType("household")} className="min-h-11 rounded-full border border-border bg-background px-3 text-sm hover:bg-secondary">{lang === "th" ? "บุคคล / ครัวเรือน" : "Household"}</button><button type="button" onClick={() => chooseAssessmentType("general_service")} className="min-h-11 rounded-full border border-border bg-background px-3 text-sm hover:bg-secondary">{lang === "th" ? "กิจการ / อาชีพ" : "Business"}</button></>}
                  {assessment.step === "income_zero_confirm" && <><button type="button" onClick={() => handleAssessmentText(lang === "th" ? "ไม่มีรายรับตอนนี้" : "No income currently")} className="min-h-11 rounded-full border border-border bg-background px-3 text-sm hover:bg-secondary">{lang === "th" ? "ไม่มีรายรับตอนนี้" : "No income currently"}</button><button type="button" onClick={() => handleAssessmentText(lang === "th" ? "ไม่สะดวกบอก" : "Prefer not to share")} className="min-h-11 rounded-full border border-border bg-background px-3 text-sm hover:bg-secondary">{lang === "th" ? "ไม่สะดวกบอก" : "Prefer not to share"}</button></>}
                  {assessment.step === "debt" && <button type="button" onClick={() => handleAssessmentText("ข้าม")} className="min-h-11 rounded-full border border-border bg-background/90 px-3 text-sm hover:bg-secondary">{lang === "th" ? "ข้าม ไม่ทราบค่างวด" : "Skip, not sure"}</button>}
                  {assessment.step === "expenses" && <button type="button" onClick={() => handleAssessmentText("ข้าม")} className="min-h-11 rounded-full border border-border bg-background/90 px-3 text-sm hover:bg-secondary">{lang === "th" ? "ข้าม ไม่ทราบตัวเลข" : "Skip, not sure"}</button>}
                  {assessment.step === "reserve" && <button type="button" onClick={() => handleAssessmentText("ข้าม")} className="min-h-11 rounded-full border border-border bg-background/90 px-3 text-sm hover:bg-secondary">{lang === "th" ? "ข้าม ไม่ทราบตัวเลข" : "Skip, not sure"}</button>}
                  {assessment.step === "principal" && <button type="button" onClick={() => handleAssessmentText("ข้าม")} className="min-h-11 rounded-full border border-border bg-background/90 px-3 text-sm hover:bg-secondary">{lang === "th" ? "ข้าม ไม่ทราบยอด" : "Skip, not sure"}</button>}
                  {assessment.step === "rate" && <button type="button" onClick={() => handleAssessmentText("ข้าม")} className="min-h-11 rounded-full border border-border bg-background/90 px-3 text-sm hover:bg-secondary">{lang === "th" ? "ข้าม ใช้สมมติฐาน" : "Skip, use assumption"}</button>}
                  {assessment.step === "rate_low_confirm" && (() => {
                    const lowVal = assessment.pendingLowRate ?? 0.15
                    const scaledVal = Number((lowVal * 100).toFixed(2))
                    return (
                      <>
                        <button type="button" onClick={() => handleAssessmentText(String(scaledVal))} className="min-h-11 rounded-full bg-foreground px-3.5 text-sm font-medium text-background hover:opacity-90">{lang === "th" ? `ใช้ ${formatRatePct(scaledVal)}% ต่อปี` : `Use ${formatRatePct(scaledVal)}% p.a.`}</button>
                        <button type="button" onClick={() => handleAssessmentText(String(lowVal))} className="min-h-11 rounded-full border border-border bg-background/90 px-3 text-sm hover:bg-secondary">{lang === "th" ? `ยืนยัน ${formatRatePct(lowVal)}% ต่อปี` : `Keep ${formatRatePct(lowVal)}% p.a.`}</button>
                        <button type="button" onClick={() => handleAssessmentText("ข้าม")} className="min-h-11 rounded-full border border-border bg-background/90 px-3 text-sm hover:bg-secondary">{lang === "th" ? "ข้าม ใช้สมมติฐาน" : "Skip, use assumption"}</button>
                      </>
                    )
                  })()}
                  {assessment.step === "horizon" && (assessment.debtStatus === "persistent" ? [3, 5, 7] : [3, 5, 10]).map((years) => <button key={years} type="button" onClick={() => handleAssessmentText(String(years))} className="min-h-11 rounded-full border border-border px-3 text-sm">{years} {lang === "th" ? "ปี" : "years"}</button>)}
                  {assessment.step === "status" && <><button type="button" onClick={() => chooseDebtStatus("current", lang === "th" ? "ยังชำระตรงเวลา" : "Current")} className="min-h-11 rounded-full border border-border px-3 text-sm">{lang === "th" ? "ยังชำระตรงเวลา" : "Current"}</button><button type="button" onClick={() => chooseDebtStatus("persistent", lang === "th" ? "หนี้เรื้อรัง" : "Persistent debt")} className="min-h-11 rounded-full border border-border px-3 text-sm">{lang === "th" ? "หนี้เรื้อรัง" : "Persistent debt"}</button><button type="button" onClick={() => chooseDebtStatus("overdue_31_120", lang === "th" ? "ค้างชำระ 1–4 เดือน" : "1–4 months overdue")} className="min-h-11 rounded-full border border-border px-3 text-sm">{lang === "th" ? "ค้างชำระ 1–4 เดือน" : "1–4 months overdue"}</button><button type="button" onClick={() => chooseDebtStatus("overdue_120_plus", lang === "th" ? "ค้างเกิน 4 เดือน" : "Over 4 months overdue")} className="min-h-11 rounded-full border border-border px-3 text-sm">{lang === "th" ? "ค้างเกิน 4 เดือน" : "Over 4 months overdue"}</button><button type="button" onClick={() => chooseDebtStatus("disaster", lang === "th" ? "ได้รับผลกระทบจากภัยพิบัติ" : "Disaster affected")} className="min-h-11 rounded-full border border-border px-3 text-sm">{lang === "th" ? "ได้รับผลกระทบจากภัยพิบัติ" : "Disaster affected"}</button></>}                  {assessment.step === "impact" && <><button type="button" onClick={() => chooseImpact([], lang === "th" ? "ไม่มีเหตุพิเศษ" : "No special impact")} className="min-h-11 rounded-full border border-border bg-background px-3 text-sm hover:bg-secondary">{lang === "th" ? "ไม่มีเหตุพิเศษ" : "None"}</button><button type="button" onClick={() => chooseImpact(["overdue_debt"], lang === "th" ? "มีหนี้ค้างชำระ" : "Overdue debt")} className="min-h-11 rounded-full border border-border bg-background px-3 text-sm hover:bg-secondary">{lang === "th" ? "หนี้ค้างชำระ" : "Overdue debt"}</button><button type="button" onClick={() => chooseImpact(["revenue_drop"], lang === "th" ? "รายได้ลดลง" : "Income has dropped")} className="min-h-11 rounded-full border border-border bg-background px-3 text-sm hover:bg-secondary">{lang === "th" ? "รายได้ลดลง" : "Income drop"}</button><button type="button" onClick={() => chooseImpact(["disaster"], lang === "th" ? "ได้รับผลกระทบจากภัยพิบัติ" : "Disaster impact")} className="min-h-11 rounded-full border border-border bg-background px-3 text-sm hover:bg-secondary">{lang === "th" ? "ภัยพิบัติ" : "Disaster"}</button></>}
                  {assessment.step === "confirm" && <><button type="button" disabled={sending} onClick={() => void runAssessment(assessment)} className="min-h-11 rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-50">{lang === "th" ? "ถูกต้อง คำนวณได้เลย" : "Correct, calculate"}</button><button type="button" onClick={() => { setAssessment({ ...assessment, step: "province", returnToConfirm: true }); addMessage({ role: "assistant", text: lang === "th" ? "ได้ครับ พิมพ์จังหวัดที่ต้องการแก้ได้เลย" : "Sure. Type the province you want to change." }) }} className="min-h-11 rounded-full border border-border bg-background/90 px-3 text-sm hover:bg-secondary">{lang === "th" ? "แก้จังหวัด" : "Edit province"}</button><button type="button" onClick={() => { setAssessment({ ...assessment, step: "income", returnToConfirm: true }); addMessage({ role: "assistant", text: lang === "th" ? "พิมพ์รายรับต่อเดือนที่ถูกต้องได้เลยครับ" : "Type the correct monthly income." }) }} className="min-h-11 rounded-full border border-border bg-background/90 px-3 text-sm hover:bg-secondary">{lang === "th" ? "แก้รายรับ" : "Edit income"}</button><button type="button" onClick={() => { setAssessment({ ...assessment, step: "debt", debtSkipped: false, returnToConfirm: true }); addMessage({ role: "assistant", text: assessmentQuestion("debt", assessment.province, lang) }) }} className="min-h-11 rounded-full border border-border bg-background/90 px-3 text-sm hover:bg-secondary">{lang === "th" ? "แก้ค่างวด" : "Edit debt payment"}</button><button type="button" onClick={() => { setAssessment({ ...assessment, step: "expenses", expensesSkipped: false, monthlyExpenses: null, returnToConfirm: true }); addMessage({ role: "assistant", text: assessmentQuestion("expenses", assessment.province, lang) }) }} className="min-h-11 rounded-full border border-border bg-background/90 px-3 text-sm hover:bg-secondary">{lang === "th" ? "แก้ค่าใช้จ่าย/เงินสำรอง" : "Edit expenses/reserve"}</button><button type="button" onClick={() => { setAssessment({ ...assessment, step: "principal", principalSkipped: false, totalPrincipal: null, returnToConfirm: true }); addMessage({ role: "assistant", text: assessmentQuestion("principal", assessment.province, lang) }) }} className="min-h-11 rounded-full border border-border bg-background/90 px-3 text-sm hover:bg-secondary">{lang === "th" ? "แก้เงินต้น" : "Edit principal"}</button><button type="button" onClick={() => { setAssessment({ ...assessment, step: "rate", rateSkipped: false, annualRate: null, returnToConfirm: true }); addMessage({ role: "assistant", text: assessmentQuestion("rate", assessment.province, lang) }) }} className="min-h-11 rounded-full border border-border bg-background/90 px-3 text-sm hover:bg-secondary">{lang === "th" ? "แก้ดอกเบี้ย" : "Edit interest rate"}</button><button type="button" onClick={() => { setAssessment({ ...assessment, step: "status", debtStatus: null, returnToConfirm: true }); addMessage({ role: "assistant", text: assessmentQuestion("status", assessment.province, lang) }) }} className="min-h-11 rounded-full border border-border bg-background/90 px-3 text-sm hover:bg-secondary">{lang === "th" ? "แก้สถานะหนี้/ระยะเวลา" : "Edit status/horizon"}</button><button type="button" onClick={() => { setAssessment(null); addMessage({ role: "assistant", text: lang === "th" ? "ยกเลิกการประเมินแล้วครับ ถ้าอยากเริ่มใหม่บอกได้เลย" : "Assessment cancelled. You can start again anytime." }) }} className="min-h-11 rounded-full border border-border bg-background/90 px-3 text-sm text-muted-foreground hover:bg-secondary">{lang === "th" ? "ยกเลิก" : "Cancel"}</button></>}
                  {assessment.step !== "confirm" && (
                    <button
                      type="button"
                      onClick={() => {
                        setAssessment(null)
                        addMessage({
                          role: "assistant",
                          text: lang === "th" ? "ยกเลิกการประเมินแล้วครับ สามารถพิมพ์คำถามทั่วไปต่อได้เลย" : "Assessment cancelled. Feel free to ask any general question.",
                        })
                      }}
                      className="min-h-11 rounded-full border border-border px-3 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      {lang === "th" ? "ยกเลิกการประเมิน" : "Cancel"}
                    </button>
                  )}
                </div>
              )}

              {!assessment && !sending && messages.at(-1)?.role === "assistant" && followUps.length > 0 && (
                <div className="ml-1 flex max-w-[95%] flex-wrap items-center gap-1.5" aria-label={lang === "th" ? "คำถามต่อ" : "Follow-up questions"}>
                  <span className="w-full text-[10px] text-muted-foreground">{lang === "th" ? "ถามต่อได้" : "You can also ask"}</span>
                  {followUps.map((prompt) => <button key={prompt} type="button" onClick={() => handleSuggestion(prompt)} className="min-h-11 rounded-full border border-border bg-background px-3 py-2 text-left text-sm leading-5 text-muted-foreground hover:bg-secondary hover:text-foreground">{prompt}</button>)}
                </div>
              )}

              {sending && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 aria-hidden="true" className="size-3.5 animate-spin" /><span>{lang === "th" ? assessment ? "กำลังประเมินข้อมูล…" : "กำลังค้นข้อมูลอ้างอิง…" : assessment ? "Checking your information…" : "Searching cited sources…"}</span></div>}
            </div>

            <div className="border-t border-border/80 bg-background/80 px-4 pb-4 pt-3 backdrop-blur-md">
              {voiceNotice && <p className="mb-2 px-1 text-[10px] leading-4 text-muted-foreground" role="status">{voiceNotice}</p>}
              <form onSubmit={handleFormSubmit} className="flex items-center gap-1.5 rounded-full border border-border bg-background/90 p-1.5 pl-4 shadow-sm focus-within:border-foreground/40">
                <input
                  ref={inputRef}
                  aria-label={lang === "th" ? assessment?.step === "province" ? "พิมพ์ชื่อจังหวัด" : assessment?.step === "income" ? "พิมพ์รายรับต่อเดือน" : assessment?.step === "debt" ? "พิมพ์ยอดจ่ายหนี้ต่อเดือน" : "พิมพ์คำถาม" : assessment ? "Enter your answer" : "Ask a question"}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={sending || assessment?.step === "type" || assessment?.step === "status" || assessment?.step === "impact" || assessment?.step === "confirm"}
                  placeholder={lang === "th" ? assessment?.step === "province" ? "พิมพ์ชื่อจังหวัด…" : assessment?.step === "income" ? "รายรับต่อเดือน เช่น 25,000…" : assessment?.step === "debt" ? "จ่ายหนี้ต่อเดือน เช่น 8,000…" : "พิมพ์คำถามได้เลย…" : assessment ? "Type your answer…" : "Type a question…"}
                  className="min-w-0 flex-1 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                {speechSupported && <button type="button" disabled={sending || assessment?.step === "type" || assessment?.step === "status" || assessment?.step === "impact" || assessment?.step === "confirm"} onClick={() => { if (listening) { speechRef.current?.stop(); setListening(false) } else startListening() }} aria-label={listening ? lang === "th" ? "หยุดฟัง" : "Stop listening" : lang === "th" ? "พูดคำถาม" : "Speak your question"} title={listening ? lang === "th" ? "หยุดฟัง" : "Stop listening" : lang === "th" ? "พูดคำถาม" : "Speak"} className={`flex size-11 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${listening ? "bg-rose-600 text-white" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>{listening ? <StopCircle aria-hidden="true" className="size-4" /> : <Mic aria-hidden="true" className="size-4" />}</button>}
                <button type="submit" disabled={sending || assessment?.step === "type" || assessment?.step === "status" || assessment?.step === "impact" || assessment?.step === "confirm"} aria-label={lang === "th" ? "ส่งข้อความ" : "Send message"} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85 disabled:opacity-50"><ArrowUp aria-hidden="true" className="size-4" /></button>
              </form>
            </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {!fullPage && (
        <button type="button" aria-expanded={isOpen} aria-controls="relief-assistant-chat" aria-label={lang === "th" ? "วางแผนรับมือหนี้" : "Debt preparedness chat"} onClick={() => setIsOpen((current) => !current)} className="fixed bottom-4 right-3.5 z-40 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-foreground/95 px-4 text-xs font-medium text-background shadow-lg backdrop-blur-sm transition-all hover:scale-[1.02] hover:bg-foreground sm:right-6 md:bottom-5 md:h-12 md:px-5 md:text-sm">
          <MessageCircle aria-hidden="true" className="size-4 shrink-0" />
          <span>{lang === "th" ? "วางแผนรับมือหนี้" : "Debt Preparedness"}</span>
        </button>
      )}
    </>
  )
}
