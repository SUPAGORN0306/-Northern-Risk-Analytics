"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
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
  Volume2,
  X,
} from "lucide-react"
import {
  formatFetchError,
  sendPolicyChat,
  submitReliefCheck,
  type CitationItem,
} from "@/lib/api"
import { useAppState } from "@/lib/i18n"

type ChatMessage = {
  id: number
  role: "assistant" | "user"
  text: string
  keyPoints?: string[]
  citations?: CitationItem[]
  piiRedacted?: number
  wasRefused?: boolean
  /** Only ordinary questions are eligible for short lived retrieval context. */
  contextText?: string
}

type AssessmentStep = "type" | "province" | "income" | "debt" | "impact" | "confirm"
type AssessmentDraft = {
  step: AssessmentStep
  businessType: string
  businessLabel: string
  province: string
  monthlyIncome: number | null
  monthlyDebt: number | null
  impactTags: string[]
  impactLabel: string
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
        ? "สวัสดีครับ อยากถามเรื่องเศรษฐกิจ หนี้ หรือมาตรการช่วยเหลือเรื่องไหน พิมพ์หรือกดพูดได้เลยครับ"
        : "Hi! Ask me about the Northern economy, debt, or support programs. You can type or use the microphone.",
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

function nextAssessmentStep(data: AssessmentDraft): AssessmentStep {
  if (!data.province) return "province"
  if (data.monthlyIncome == null) return "income"
  if (data.monthlyDebt == null) return "debt"
  return "impact"
}

function amountAfter(text: string, labels: string): number | null {
  const match = text.match(new RegExp(`(?:${labels})[^\\d๐-๙]{0,20}([\\d๐-๙][\\d๐-๙,]*)`, "i"))
  return match ? parseAmount(match[1]) : null
}

function assessmentQuestion(step: AssessmentStep, province: string, lang: "th" | "en"): string {
  if (step === "province") return lang === "th" ? "อยู่จังหวัดไหนครับ? พิมพ์ชื่อจังหวัดได้เลย" : "Which province are you in? Type the province name."
  if (step === "income") return lang === "th" ? "รายรับเฉลี่ยต่อเดือนประมาณเท่าไหร่ครับ? เช่น 25,000 บาท" : "What is the approximate monthly income? For example, 25,000 baht."
  if (step === "debt") return lang === "th" ? "จ่ายหนี้รวมทุกบัญชีเดือนละประมาณเท่าไหร่ครับ? ถ้าไม่มีหนี้ ใส่ 0 ได้" : "How much do you pay toward all debts each month? Enter 0 if you have no debt."
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

function money(value: number): string {
  return `${Math.round(value).toLocaleString("th-TH")} บาท`
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
  if (/หนี้|สินเชื่อ|ค่างวด|คลินิก|ปรับโครงสร้าง|debt|loan|payment/i.test(`${question} ${answer}`)) {
    return lang === "th"
      ? ["ช่วยประเมินภาระหนี้ให้หน่อย", "ถ้าจ่ายไม่ไหว ควรเริ่มคุยกับใคร"]
      : ["Help me check my debt burden", "Who should I contact if I cannot pay?"]
  }
  if (/จังหวัด|ภาคเหนือ|เศรษฐกิจ|รายได้|ท่องเที่ยว|province|regional|economy/i.test(`${question} ${answer}`)) {
    return lang === "th"
      ? ["แผนที่เศรษฐกิจ 17 จังหวัดดูอะไรได้บ้าง", "ช่วยประเมินภาระหนี้ให้หน่อย"]
      : ["What can I see on the 17-province economy map?", "Help me check my debt burden"]
  }
  return lang === "th"
    ? ["ช่วยประเมินภาระหนี้ให้หน่อย", "อยากถามเรื่องมาตรการช่วยเหลือ"]
    : ["Help me check my debt burden", "Ask about support programs"]
}

export function CTA() {
  const { lang, selectedProvinceCode } = useAppState()
  const [isOpen, setIsOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([greetingFor("th")])
  const [followUps, setFollowUps] = useState<string[]>([])
  const [assessment, setAssessment] = useState<AssessmentDraft | null>(null)
  const [listening, setListening] = useState(false)
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(2)
  const speechRef = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => {
    setMessages((curr) => (curr.length === 1 && curr[0].id === 1 ? [greetingFor(lang)] : curr))
  }, [lang])

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
    setMessages((curr) => [...curr, { ...message, id: nextId.current++ }])
  }

  function startAssessment(promptText?: string) {
    setFollowUps([])
    setVoiceNotice(null)
    const raw = promptText ?? ""
    const lower = raw.toLowerCase()
    const matchedProvince = Object.entries(PROVINCE_NAMES).find(([, names]) =>
      lower.includes(names.th.toLowerCase()) || lower.includes(names.en.toLowerCase()),
    )?.[0]
    const isBusiness = /(กิจการ|ธุรกิจ|ร้าน|business|shop|enterprise)/i.test(raw)
    const hasType = isBusiness || /(บุคคล|ครัวเรือน|household|individual)/i.test(raw)
    const next: AssessmentDraft = {
      step: "type",
      businessType: isBusiness ? "general_service" : "household",
      businessLabel: isBusiness
        ? lang === "th" ? "กิจการ / อาชีพ" : "Business"
        : lang === "th" ? "บุคคล / ครัวเรือน" : "Household",
      province: matchedProvince ?? selectedProvinceCode ?? "",
      monthlyIncome: amountAfter(raw, "รายรับ|รายได้|เงินเดือน|income|revenue"),
      monthlyDebt: amountAfter(raw, "จ่ายหนี้(?:ต่อเดือน)?|ค่างวด|ผ่อน(?:ชำระ)?(?:ต่อเดือน)?|debt payments?"),
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
          : (lang === "th" ? "ได้ครับ ผมช่วยประเมินเบื้องต้นให้ ไม่ต้องบอกชื่อหรือเลขบัญชีครับ\n" : "I can help with a preliminary check. No name or account number is needed.\n") + assessmentQuestion(next.step, next.province, lang),
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
        impact_tags: data.impactTags,
        language: lang,
      })
      const dsr = res.dsr_assessment
      const answer =
        lang === "th"
          ? `ผลประเมินเบื้องต้นของ${provinceLabel(data.province, "th")}\nภาระหนี้ต่อรายรับ: ${dsr.dsr_pct == null ? "คำนวณไม่ได้จากข้อมูลนี้" : `${dsr.dsr_pct.toFixed(1)}%`}\n${dsr.summary_th}\nผลนี้ดูจากรายรับกับค่างวด ยังไม่รวมค่าใช้จ่ายจำเป็นและเงินสำรอง\n\nแนวทางจากเอกสารอ้างอิง: ${res.policy_guidance.answer_text}`
          : `Preliminary check for ${provinceLabel(data.province, "en")}\nDebt payment to income: ${dsr.dsr_pct == null ? "Not available from these inputs" : `${dsr.dsr_pct.toFixed(1)}%`}\n${dsr.summary_en}\nThis check uses income and debt payments only; it does not include essential expenses or savings.\n\nGuidance from cited documents: ${res.policy_guidance.answer_text}`
      addMessage({
        role: "assistant",
        text: answer,
        keyPoints: [
          lang === "th"
            ? `รายรับ ${money(data.monthlyIncome ?? 0)} · จ่ายหนี้ ${money(data.monthlyDebt ?? 0)}`
            : `Income ${money(data.monthlyIncome ?? 0)} · debt payments ${money(data.monthlyDebt ?? 0)}`,
        ],
        citations: res.policy_guidance.citations,
        wasRefused: res.policy_guidance.was_refused,
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

  function chooseImpact(tags: string[], label: string) {
    if (!assessment) return
    const next = { ...assessment, step: "confirm" as const, impactTags: tags, impactLabel: label }
    setAssessment(next)
    addMessage({ role: "user", text: label })
    addMessage({
      role: "assistant",
      text:
        lang === "th"
          ? `ขอทวนข้อมูลก่อนคำนวณครับ\n• ประเภท: ${next.businessLabel}\n• จังหวัด: ${provinceLabel(next.province, "th")}\n• รายรับต่อเดือน: ${money(next.monthlyIncome ?? 0)}\n• จ่ายหนี้ต่อเดือน: ${money(next.monthlyDebt ?? 0)}\n• สถานการณ์: ${label}\nข้อมูลถูกต้องไหมครับ?`
          : `Please confirm before I calculate:\n• Type: ${next.businessLabel}\n• Province: ${provinceLabel(next.province, "en")}\n• Monthly income: ${money(next.monthlyIncome ?? 0)}\n• Monthly debt payments: ${money(next.monthlyDebt ?? 0)}\n• Situation: ${label}\nIs this correct?`,
    })
  }

  function handleAssessmentText(prompt: string) {
    if (!assessment) return
    const value = prompt.trim()
    if (assessment.step === "province") {
      if (value.length < 2) return
      const next: AssessmentDraft = { ...assessment, step: "income", province: value }
      next.step = nextAssessmentStep(next)
      setAssessment(next)
      addMessage({ role: "user", text: value })
      addMessage({ role: "assistant", text: assessmentQuestion(next.step, next.province, lang) })
      return
    }
    if (assessment.step === "income" || assessment.step === "debt") {
      const amount = parseAmount(value)
      if (amount == null) {
        addMessage({
          role: "assistant",
          text: lang === "th" ? "ขอเป็นตัวเลขประมาณการได้ไหมครับ เช่น 25,000 บาท ถ้าพูดด้วยเสียงแล้วแปลงไม่ตรง แตะช่องข้อความเพื่อแก้ตัวเลขได้เลย" : "Please enter an approximate number, such as 25,000 baht. You can edit the recognized text if needed.",
        })
        return
      }
      if (assessment.step === "income") {
        const next: AssessmentDraft = { ...assessment, step: "debt", monthlyIncome: amount }
        next.step = nextAssessmentStep(next)
        setAssessment(next)
        addMessage({ role: "user", text: money(amount) })
        addMessage({ role: "assistant", text: assessmentQuestion(next.step, next.province, lang) })
      } else {
        const next = { ...assessment, step: "impact" as const, monthlyDebt: amount }
        setAssessment(next)
        addMessage({ role: "user", text: money(amount) })
        addMessage({ role: "assistant", text: lang === "th" ? "มีเหตุที่กระทบรายได้หรือการจ่ายหนี้เป็นพิเศษไหมครับ? เลือกข้อที่ใกล้เคียง หรือข้ามได้" : "Has anything affected your income or debt payments? Choose an option or skip." })
      }
    }
  }

  async function submitPrompt(rawPrompt: string) {
    const prompt = rawPrompt.trim()
    if (!prompt || sending) return
    setVoiceNotice(null)

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
          : lang === "th" ? "สวัสดีครับ 😊 วันนี้อยากคุยเรื่องเศรษฐกิจ หนี้ หรือให้ช่วยประเมินเบื้องต้นดีครับ?" : "Hi! 😊 Would you like to talk about the economy, debt, or get a preliminary check?",
      })
      setFollowUps(isThanks(prompt) ? [] : lang === "th" ? ["เศรษฐกิจภาคเหนือช่วงล่าสุดเป็นอย่างไร", "ช่วยประเมินภาระหนี้ให้หน่อย"] : ["How is the Northern economy doing?", "Help me check my debt burden"])
      return
    }

    setSending(true)
    try {
      const recentQuestions = messages
        .filter((message) => message.role === "user" && message.contextText)
        .slice(-4)
        .map((message) => message.contextText as string)
      const res = await sendPolicyChat({ question: prompt, language: lang, recent_questions: recentQuestions })
      addMessage({
        role: "assistant",
        text: res.answer_text,
        keyPoints: res.key_points,
        citations: res.citations,
        piiRedacted: res.pii_redacted_count,
        wasRefused: res.was_refused,
      })
      if (!res.was_refused) setFollowUps(followUpsFor(prompt, res.answer_text, lang))
    } catch (err) {
      addMessage({ role: "assistant", text: formatFetchError(err, lang) })
    } finally {
      setSending(false)
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const current = draft
    setDraft("")
    void submitPrompt(current)
  }

  function handleSuggestion(prompt: string) {
    if (/เปิดเครื่องคำนวณละเอียด|open detailed calculator/i.test(prompt)) {
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
    setFollowUps([])
    setVoiceNotice(null)
    setMessages([greetingFor(lang)])
    setDraft("")
    nextId.current = 2
  }

  const speechSupported = typeof window !== "undefined" && Boolean((window as WindowWithSpeech).SpeechRecognition || (window as WindowWithSpeech).webkitSpeechRecognition)
  const speechOutputSupported = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window

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
            role="dialog"
            aria-label={lang === "th" ? "แชตถามเรื่องเศรษฐกิจและหนี้" : "Economy and debt chat"}
            className="fixed bottom-24 right-4 z-[60] flex max-h-[min(36rem,calc(100dvh-8rem))] w-[min(25rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-[1.75rem] border border-border bg-background shadow-2xl sm:bottom-24 sm:right-6 sm:w-[min(28rem,calc(100vw-3rem))]"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3.5 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                  <MessageCircle aria-hidden="true" className="size-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="font-display text-sm font-semibold text-foreground">
                    {lang === "th" ? "ถามเรื่องเศรษฐกิจและหนี้" : "Ask about economy & debt"}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {lang === "th" ? "คุยต่อได้ หรือให้ช่วยประเมินเบื้องต้น" : "Ask follow-ups or get a preliminary check"}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {messages.length > 1 && (
                  <button type="button" onClick={resetConversation} aria-label={lang === "th" ? "เริ่มบทสนทนาใหม่" : "Start a new chat"} title={lang === "th" ? "เริ่มบทสนทนาใหม่" : "Start a new chat"} className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                    <RotateCcw aria-hidden="true" className="size-3.5" />
                  </button>
                )}
                <button type="button" onClick={() => setIsOpen(false)} aria-label={lang === "th" ? "ปิดแชต" : "Close chat"} className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                  <X aria-hidden="true" className="size-4" />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 border-b border-border bg-secondary/45 px-4 py-2">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck aria-hidden="true" className="size-3 shrink-0" />
                {lang === "th" ? "ช่วยปกปิดข้อมูลส่วนตัวที่ตรวจพบ" : "Helps hide personal details it detects"}
              </span>
            </div>

            <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4" aria-live="polite">
              {messages.map((message) => (
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
                </div>
              ))}

              {messages.length === 1 && !assessment && (
                <div className="mt-1 flex flex-wrap gap-2" aria-label={lang === "th" ? "ตัวอย่างคำถาม" : "Suggested questions"}>
                  {(lang === "th" ? ["เศรษฐกิจภาคเหนือช่วงล่าสุดเป็นอย่างไร", "ช่วยประเมินภาระหนี้ให้หน่อย"] : ["How is the Northern economy doing?", "Help me check my debt burden"]).map((prompt) => <button key={prompt} type="button" onClick={() => handleSuggestion(prompt)} className="min-h-11 rounded-full border border-border bg-background px-3 py-2 text-left text-sm leading-5 text-muted-foreground hover:bg-secondary hover:text-foreground">{prompt}</button>)}
                </div>
              )}

              {assessment && !sending && (
                <div className="ml-1 flex max-w-[95%] flex-wrap gap-2" aria-label={lang === "th" ? "ตัวเลือกประเมิน" : "Assessment options"}>
                  {assessment.step === "type" && <><button type="button" onClick={() => chooseAssessmentType("household")} className="min-h-11 rounded-full border border-border bg-background px-3 text-sm hover:bg-secondary">{lang === "th" ? "บุคคล / ครัวเรือน" : "Household"}</button><button type="button" onClick={() => chooseAssessmentType("general_service")} className="min-h-11 rounded-full border border-border bg-background px-3 text-sm hover:bg-secondary">{lang === "th" ? "กิจการ / อาชีพ" : "Business"}</button></>}
                  {assessment.step === "impact" && <><button type="button" onClick={() => chooseImpact([], lang === "th" ? "ไม่มีเหตุพิเศษ" : "No special impact")} className="min-h-11 rounded-full border border-border bg-background px-3 text-sm hover:bg-secondary">{lang === "th" ? "ไม่มีเหตุพิเศษ" : "None"}</button><button type="button" onClick={() => chooseImpact(["overdue_debt"], lang === "th" ? "มีหนี้ค้างชำระ" : "Overdue debt")} className="min-h-11 rounded-full border border-border bg-background px-3 text-sm hover:bg-secondary">{lang === "th" ? "หนี้ค้างชำระ" : "Overdue debt"}</button><button type="button" onClick={() => chooseImpact(["revenue_drop"], lang === "th" ? "รายได้ลดลง" : "Income has dropped")} className="min-h-11 rounded-full border border-border bg-background px-3 text-sm hover:bg-secondary">{lang === "th" ? "รายได้ลดลง" : "Income drop"}</button><button type="button" onClick={() => chooseImpact(["disaster"], lang === "th" ? "ได้รับผลกระทบจากภัยพิบัติ" : "Disaster impact")} className="min-h-11 rounded-full border border-border bg-background px-3 text-sm hover:bg-secondary">{lang === "th" ? "ภัยพิบัติ" : "Disaster"}</button></>}
                  {assessment.step === "confirm" && <><button type="button" disabled={sending} onClick={() => void runAssessment(assessment)} className="min-h-11 rounded-full bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-50">{lang === "th" ? "ถูกต้อง คำนวณได้เลย" : "Correct, calculate"}</button><button type="button" onClick={() => { setAssessment({ ...assessment, step: "province" }); addMessage({ role: "assistant", text: lang === "th" ? "ได้ครับ พิมพ์จังหวัดที่ต้องการแก้ได้เลย" : "Sure. Type the province you want to change." }) }} className="min-h-11 rounded-full border border-border px-3 text-sm">{lang === "th" ? "แก้จังหวัด" : "Edit province"}</button><button type="button" onClick={() => { setAssessment({ ...assessment, step: "income" }); addMessage({ role: "assistant", text: lang === "th" ? "พิมพ์รายรับต่อเดือนที่ถูกต้องได้เลยครับ" : "Type the correct monthly income." }) }} className="min-h-11 rounded-full border border-border px-3 text-sm">{lang === "th" ? "แก้ตัวเลข" : "Edit amounts"}</button><button type="button" onClick={() => { setAssessment(null); addMessage({ role: "assistant", text: lang === "th" ? "ยกเลิกการประเมินแล้วครับ ถ้าอยากเริ่มใหม่บอกได้เลย" : "Assessment cancelled. You can start again anytime." }) }} className="min-h-11 rounded-full border border-border px-3 text-sm text-muted-foreground">{lang === "th" ? "ยกเลิก" : "Cancel"}</button></>}
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

            <div className="border-t border-border px-4 pb-4 pt-3">
              {voiceNotice && <p className="mb-2 px-1 text-[10px] leading-4 text-muted-foreground" role="status">{voiceNotice}</p>}
              <form onSubmit={handleFormSubmit} className="flex items-center gap-1.5 rounded-full border border-border bg-background p-1.5 pl-4 focus-within:border-foreground/40">
                <input
                  ref={inputRef}
                  aria-label={lang === "th" ? assessment?.step === "province" ? "พิมพ์ชื่อจังหวัด" : assessment?.step === "income" ? "พิมพ์รายรับต่อเดือน" : assessment?.step === "debt" ? "พิมพ์ยอดจ่ายหนี้ต่อเดือน" : "พิมพ์คำถาม" : assessment ? "Enter your answer" : "Ask a question"}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={sending || assessment?.step === "type" || assessment?.step === "impact" || assessment?.step === "confirm"}
                  placeholder={lang === "th" ? assessment?.step === "province" ? "พิมพ์ชื่อจังหวัด…" : assessment?.step === "income" ? "รายรับต่อเดือน เช่น 25,000…" : assessment?.step === "debt" ? "จ่ายหนี้ต่อเดือน เช่น 8,000…" : "พิมพ์คำถามได้เลย…" : assessment ? "Type your answer…" : "Type a question…"}
                  className="min-w-0 flex-1 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                {speechSupported && <button type="button" disabled={sending || assessment?.step === "type" || assessment?.step === "impact" || assessment?.step === "confirm"} onClick={() => { if (listening) { speechRef.current?.stop(); setListening(false) } else startListening() }} aria-label={listening ? lang === "th" ? "หยุดฟัง" : "Stop listening" : lang === "th" ? "พูดคำถาม" : "Speak your question"} title={listening ? lang === "th" ? "หยุดฟัง" : "Stop listening" : lang === "th" ? "พูดคำถาม" : "Speak"} className={`flex size-11 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${listening ? "bg-rose-600 text-white" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>{listening ? <StopCircle aria-hidden="true" className="size-4" /> : <Mic aria-hidden="true" className="size-4" />}</button>}
                <button type="submit" disabled={sending || assessment?.step === "type" || assessment?.step === "impact" || assessment?.step === "confirm"} aria-label={lang === "th" ? "ส่งข้อความ" : "Send message"} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85 disabled:opacity-50"><ArrowUp aria-hidden="true" className="size-4" /></button>
              </form>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <button type="button" aria-expanded={isOpen} aria-controls="relief-assistant-chat" aria-label={lang === "th" ? "ถามเรื่องเศรษฐกิจและหนี้" : "Ask about economy and debt"} onClick={() => setIsOpen((current) => !current)} className="fixed bottom-5 right-4 z-50 inline-flex size-[52px] items-center justify-center rounded-full bg-foreground text-background shadow-xl transition-transform hover:scale-[1.02] md:h-12 md:w-auto md:gap-2 md:px-5 md:text-sm md:font-medium sm:right-6">
        <MessageCircle aria-hidden="true" className="size-5 md:size-4" />
        <span className="hidden md:inline">{lang === "th" ? "ถามเรื่องเศรษฐกิจและหนี้" : "Ask about economy & debt"}</span>
      </button>
    </>
  )
}
