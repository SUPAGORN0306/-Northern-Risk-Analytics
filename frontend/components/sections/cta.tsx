"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ArrowUp, Check, ExternalLink, Loader2, MessageCircle, RotateCcw, ShieldCheck, X } from "lucide-react"
import { sendPolicyChat, type CitationItem } from "@/lib/api"
import { useAppState } from "@/lib/i18n"

type ChatMessage = {
  id: number
  role: "assistant" | "user"
  text: string
  keyPoints?: string[]
  citations?: CitationItem[]
  piiRedacted?: number
  wasRefused?: boolean
}

function greetingFor(lang: "th" | "en"): ChatMessage {
  return {
    id: 1,
    role: "assistant",
    text:
      lang === "th"
        ? "สวัสดีครับ สอบถามข้อมูลภาวะเศรษฐกิจภาคเหนือ หรือเงื่อนไขมาตรการแก้หนี้จากเอกสารทางการได้เลย (ระบบไม่บันทึกข้อความสนทนาและปกปิดข้อมูลส่วนบุคคลอัตโนมัติ)"
        : "Ask about Northern Thailand regional economic trends or official debt restructuring criteria. Messages are not stored and PII is redacted automatically.",
  }
}

export function CTA() {
  const { lang } = useAppState()
  const [isOpen, setIsOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([greetingFor("th")])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(2)

  // Keep initial greeting synchronized when user switches language before sending a message
  useEffect(() => {
    setMessages((curr) => (curr.length === 1 && curr[0].id === 1 ? [greetingFor(lang)] : curr))
  }, [lang])

  const quickPrompts =
    lang === "th"
      ? [
          "เศรษฐกิจภาคเหนือไตรมาส 3 ปี 2569 ภาคบริการเป็นอย่างไร",
          "คลินิกแก้หนี้มีคุณสมบัติและดอกเบี้ยเท่าไหร่",
          "โครงการคุณสู้ เราช่วย มีมาตรการอะไรบ้าง",
        ]
      : [
          "Northern Thailand Q3 2026 service sector outlook",
          "Debt Clinic eligibility and interest rate",
          "Responsible Lending debt restructuring options",
        ]

  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, sending])

  async function submitPrompt(rawPrompt: string) {
    const prompt = rawPrompt.trim()
    if (!prompt || sending) return
    setMessages((curr) => [...curr, { id: nextId.current++, role: "user", text: prompt }])
    setSending(true)
    try {
      const res = await sendPolicyChat({ question: prompt, language: lang })
      setMessages((curr) => [
        ...curr,
        {
          id: nextId.current++,
          role: "assistant",
          text: res.answer_text,
          keyPoints: res.key_points,
          citations: res.citations,
          piiRedacted: res.pii_redacted_count,
          wasRefused: res.was_refused,
        },
      ])
    } catch (err) {
      setMessages((curr) => [
        ...curr,
        {
          id: nextId.current++,
          role: "assistant",
          text:
            lang === "th"
              ? `ไม่สามารถเชื่อมต่อระบบผู้ช่วยได้ในขณะนี้ (${err instanceof Error ? err.message : "Network error"})`
              : `Assistant service is currently unavailable (${err instanceof Error ? err.message : "Network error"}).`,
        },
      ])
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
            aria-label={lang === "th" ? "ผู้ช่วยข้อมูลเศรษฐกิจและมาตรการทางการเงิน" : "Policy Knowledge Assistant"}
            className="fixed bottom-24 right-4 z-[60] flex max-h-[min(36rem,calc(100dvh-10rem))] w-[min(25rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-[1.75rem] border border-border bg-background shadow-2xl sm:bottom-24 sm:right-6"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-full bg-foreground text-background">
                  <MessageCircle aria-hidden="true" className="size-4" />
                </span>
                <div>
                  <h2 className="font-display text-sm font-semibold text-foreground">
                    {lang === "th" ? "ผู้ช่วยความรู้เศรษฐกิจและมาตรการ" : "Policy Knowledge Assistant"}
                  </h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {lang === "th" ? "ตอบจากคลังเอกสารทางการ 7 ฉบับพร้อมเลขหน้าจริง" : "Grounded across 7 official PDFs with page citations"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setMessages([greetingFor(lang)])}
                    aria-label={lang === "th" ? "ล้างบทสนทนา" : "Clear chat"}
                    title={lang === "th" ? "ล้างบทสนทนา" : "Clear chat"}
                    className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <RotateCcw aria-hidden="true" className="size-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close Policy Assistant"
                  className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </div>
            </div>

            <div className="border-b border-border bg-secondary/60 px-4 py-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-[10px] font-medium text-foreground/80">
                <ShieldCheck aria-hidden="true" className="size-3" />
                {lang === "th" ? "ซ่อนข้อมูลส่วนตัวและตรวจสอบเลขหน้าอ้างอิงอัตโนมัติ" : "Privacy Redaction & Citation Guardrails Active"}
              </div>
              <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                {lang === "th"
                  ? "ตอบเฉพาะข้อมูลที่มีในเอกสารอ้างอิงและปฏิเสธคำถามนอกขอบเขตโดยอัตโนมัติ"
                  : "Answers strictly from indexed official PDFs and declines out of scope prompts."}
              </p>
            </div>

            <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4" aria-live="polite">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`max-w-[92%] whitespace-pre-line rounded-2xl px-3.5 py-3 text-xs leading-5 ${
                      message.role === "user" ? "bg-foreground text-background" : "bg-secondary text-foreground"
                    }`}
                  >
                    {message.text}
                    {message.keyPoints && message.keyPoints.length > 0 && (
                      <ul className="mt-2 space-y-1 border-t border-border/60 pt-2">
                        {message.keyPoints.map((kp, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-[11px]">
                            <Check aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                            <span>{kp}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {message.piiRedacted && message.piiRedacted > 0 ? (
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-[9px] text-muted-foreground">
                      <ShieldCheck aria-hidden="true" className="size-3" />
                      {lang === "th"
                        ? `เซ็นเซอร์ข้อมูลส่วนตัวแล้ว ${message.piiRedacted} รายการ`
                        : `${message.piiRedacted} PII item(s) redacted`}
                    </span>
                  ) : null}

                  {message.citations && message.citations.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {message.citations.map((c, idx) => {
                        const text =
                          lang === "th"
                            ? `${c.doc_title} หน้า ${c.page_num}`
                            : `${c.doc_title}, p.${c.page_num}`
                        return c.doc_url ? (
                          <a
                            key={idx}
                            href={c.doc_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[9px] leading-4 text-foreground hover:bg-secondary"
                          >
                            <Check aria-hidden="true" className="size-2.5 shrink-0" />
                            <span className="max-w-[210px] truncate">{text}</span>
                            <ExternalLink aria-hidden="true" className="size-2.5 shrink-0" />
                          </a>
                        ) : (
                          <span
                            key={idx}
                            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[9px] leading-4 text-muted-foreground"
                          >
                            <Check aria-hidden="true" className="size-2.5 shrink-0" />
                            <span className="max-w-[210px] truncate">{text}</span>
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}

              {sending && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                  <span>{lang === "th" ? "กำลังค้นหาเอกสารทางการและตรวจสอบอ้างอิง…" : "Searching official documents…"}</span>
                </div>
              )}
            </div>

            <div className="border-t border-border px-4 pb-4 pt-3">
              <div className="mb-3 flex flex-wrap gap-1.5">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={sending}
                    onClick={() => void submitPrompt(prompt)}
                    className="rounded-full border border-border px-2.5 py-1 text-left text-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
              <form
                onSubmit={handleFormSubmit}
                className="flex items-center gap-2 rounded-full border border-border bg-background p-1.5 pl-4 focus-within:border-foreground/40"
              >
                <input
                  ref={inputRef}
                  aria-label={lang === "th" ? "พิมพ์คำถาม" : "Ask a question"}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={sending}
                  placeholder={lang === "th" ? "ถามเรื่องเศรษฐกิจภาคเหนือหรือมาตรการหนี้…" : "Ask about Northern economy or relief…"}
                  className="min-w-0 flex-1 bg-transparent py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="submit"
                  disabled={sending}
                  aria-label="Send question"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85 disabled:opacity-50"
                >
                  <ArrowUp aria-hidden="true" className="size-4" />
                </button>
              </form>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls="relief-assistant-chat"
        aria-label={lang === "th" ? "ถาม-ตอบเรื่องแก้หนี้ / สิทธิช่วยเหลือ" : "Ask Debt & Relief Q&A"}
        onClick={() => setIsOpen((curr) => !curr)}
        className="fixed bottom-5 right-4 z-50 inline-flex size-[52px] items-center justify-center rounded-full bg-foreground text-background shadow-xl transition-transform hover:scale-[1.02] md:h-12 md:w-auto md:gap-2 md:px-5 md:text-sm md:font-medium sm:right-6"
      >
        <MessageCircle aria-hidden="true" className="size-5 md:size-4" />
        <span className="hidden md:inline">
          {lang === "th" ? "ถาม-ตอบเรื่องแก้หนี้ / สิทธิช่วยเหลือ" : "Ask Debt & Relief Q&A"}
        </span>
      </button>
    </>
  )
}
