"use client"

import { useAppState } from "@/lib/i18n"

export function ChatPageIntro() {
  const { lang } = useAppState()

  return (
    <div className="mx-auto mb-4 max-w-5xl">
      <h1 className="font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        {lang === "th" ? "ผู้ช่วยวางแผนรับมือหนี้" : "Debt Resilience Assistant"}
      </h1>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        {lang === "th"
          ? "ประเมินภาระหนี้ เตรียมข้อมูลก่อนคุยกับเจ้าหนี้ หรือวางแผนรับมือเมื่อรายได้เปลี่ยนแปลง พิมพ์หรือกดไมค์เพื่อพูดได้"
          : "Review debt, prepare to talk with a lender, or plan for income changes. Type or use voice input."}
      </p>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
        {lang === "th"
          ? "ระบบต้นแบบส่งข้อความผ่าน backend และอาจส่งข้อความหรือบริบทบางส่วนให้ Google Gemini หลังตรวจจับและลบรูปแบบเลขบัตร เบอร์โทร อีเมล หรือเลขบัญชี โดยไม่บันทึกบทสนทนาลงฐานข้อมูลของแอป โปรดใช้ข้อมูลสมมติและอย่าพิมพ์ข้อมูลระบุตัวตนจริง"
          : "Prototype privacy: Messages pass through our backend and may be sent to Google Gemini after patterns resembling ID, phone, email, or account numbers are detected and redacted. Chat transcripts are not stored in our app database. Use sample data and do not enter real identifiers."}
      </p>
    </div>
  )
}
