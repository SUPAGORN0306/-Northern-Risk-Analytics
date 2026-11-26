"use client"

import Image from "next/image"
import { motion } from "motion/react"
import { ArrowDown, Calculator, HeartHandshake, MessageCircle, ShieldCheck } from "lucide-react"
import type { RiskOutlookResponse } from "@/lib/api"
import { useAppState } from "@/lib/i18n"

export function Hero({ outlook }: { outlook: RiskOutlookResponse | null }) {
  const { lang } = useAppState()
  const provincesCount = outlook?.regional_summary?.provinces_count ?? 17

  const benefits =
    lang === "th"
      ? [
          {
            icon: Calculator,
            title: "รู้ค่างวดที่จ่ายไหวจริง",
            desc: "คำนวณเงินเหลือหลังหักค่าใช้จ่าย เพื่อตั้งเป้าค่างวดใหม่ที่ไม่ตึงมือ",
          },
          {
            icon: ShieldCheck,
            title: "ดูแนวทางและเตรียมคุยกับเจ้าหนี้",
            desc: "แสดงแนวทางที่อาจเกี่ยวข้องและตัวอย่างคำถาม โดยควรตรวจเงื่อนไขกับเจ้าหนี้หรือหน่วยงานผู้ดูแล",
          },
          {
            icon: MessageCircle,
            title: "เตรียมรับมือรายได้สะดุด",
            desc: "ใช้ข้อมูลจังหวัดประกอบการวางแผนสำรองเงินและรับมือภาระหนี้",
          },
        ]
      : [
          {
            icon: Calculator,
            title: "Find a Sustainable Payment",
            desc: "See what monthly installment fits comfortably after daily living expenses.",
          },
          {
            icon: ShieldCheck,
            title: "Explore Options & Prepare to Talk",
            desc: "See potentially relevant guidance and sample questions; verify terms with lenders or program owners.",
          },
          {
            icon: MessageCircle,
            title: "Prepare for Income Disruptions",
            desc: "Use local conditions as context when planning for income changes and debt payments.",
          },
        ]

  return (
    <section className="px-3 pb-4 pt-28 sm:px-6 sm:pt-32 lg:px-8 lg:pt-28">
      <div className="relative mx-auto min-h-[420px] max-w-7xl overflow-hidden rounded-[2rem] bg-foreground sm:min-h-[460px]">
        <Image
          src="/images/hero-northern-thailand.jpg"
          alt=""
          fill
          priority
          sizes="(max-width: 1280px) 100vw, 1280px"
          className="object-cover object-center saturate-[0.95] contrast-[1.03]"
        />
        <svg
          aria-hidden="true"
          viewBox="0 0 1200 180"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-x-0 bottom-3 z-[1] h-36 w-full opacity-35 sm:bottom-6 sm:h-44"
        >
          <path d="M0 145 H1200 M0 95 H1200" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
          <motion.path
            d="M0 132 C70 126 95 138 152 118 S242 125 295 94 S380 105 435 84 S525 98 580 64 S670 76 725 88 S810 52 870 68 S965 49 1010 35 S1115 43 1200 17"
            fill="none"
            stroke="rgba(255,255,255,0.62)"
            strokeWidth="2"
            strokeDasharray="7 10"
            animate={{ strokeDashoffset: [0, -170] }}
            transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
          />
        </svg>
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/40 to-black/65" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.3)_100%)]" />

        <div className="relative z-10 flex min-h-[420px] flex-col items-center justify-center px-5 py-12 text-center sm:min-h-[460px] sm:px-10 sm:py-16">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 px-4 py-1.5 backdrop-blur-md"
          >
            <HeartHandshake aria-hidden="true" className="size-3.5 shrink-0 text-white/90" />
            <span className="text-[11px] font-medium tracking-wide text-white/95 sm:text-xs">
              {lang === "th"
                ? `${provincesCount} จังหวัดภาคเหนือ · ต้นแบบสำหรับทดลองด้วยข้อมูลสมมติ`
                : `${provincesCount} Northern Provinces · Prototype · Use sample data`}
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="max-w-3xl font-display text-2xl font-semibold leading-[1.28] tracking-[-0.02em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)] sm:text-4xl sm:leading-[1.22] lg:text-[3rem]"
          >
            <span className="text-balance">
              {lang === "th"
                ? "เตรียมรับมือหนี้และวางแผนเมื่อรายได้สะดุด"
                : "Prepare for Debt and Income Disruptions"}
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.22 }}
            className="mt-4 max-w-2xl text-sm leading-7 text-white/95 drop-shadow-[0_1px_6px_rgba(0,0,0,0.65)] sm:text-base"
          >
            {lang === "th"
              ? "ประเมินภาระหนี้ ดูแนวทางช่วยเหลือ และเตรียมข้อมูลก่อนคุยกับเจ้าหนี้ พร้อมใช้สถานการณ์จังหวัดเป็นข้อมูลประกอบการวางแผน"
              : "Understand your debt, explore support options, and prepare to talk with a lender, with local conditions available as planning context."}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.32 }}
            className="mt-7 flex w-full max-w-md flex-col items-stretch justify-center gap-3 sm:max-w-none sm:flex-row sm:flex-wrap sm:items-center"
          >
            <a
              href="#relief-assistant"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-medium text-black shadow-md transition-transform hover:scale-[1.02]"
            >
              {lang === "th" ? "เริ่มเช็กหนี้และคำนวณค่างวด" : "Start Debt & Payment Check"}
              <ArrowDown aria-hidden="true" className="size-4" />
            </a>
            <a
              href="#risk-outlook"
              className="inline-flex items-center justify-center rounded-full border border-white/45 bg-black/35 px-6 py-3 text-sm font-medium text-white backdrop-blur-md transition-colors hover:bg-black/50"
            >
              {lang === "th" ? "ดูสถานการณ์จังหวัดของคุณ" : "Check Your Province"}
            </a>
          </motion.div>
        </div>
      </div>

      {/* Clear Benefits Strip on Clean Surface Below Hero */}
      <div className="mx-auto mt-6 max-w-6xl">
        <p className="mb-3 text-center text-xs font-semibold tracking-wide text-muted-foreground sm:text-sm">
          {lang === "th" ? "เว็บนี้ช่วยให้คุณและครอบครัวได้ประโยชน์อะไรบ้าง" : "How This Website Helps You"}
        </p>
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          {benefits.map((item, idx) => {
            const Icon = item.icon
            return (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true, amount: 0.25 }}
                transition={{ duration: 0.45, delay: 0.08 + idx * 0.12, ease: "easeOut" }}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.99 }}
                className="group rounded-2xl border border-border bg-card px-5 py-4 transition-shadow hover:border-foreground/25 hover:shadow-md"
              >
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground transition-transform duration-200 group-hover:scale-110">
                    <Icon aria-hidden="true" className="size-3.5" />
                  </span>
                  <span>{item.title}</span>
                </p>
                <p className="mt-2 text-xs leading-6 text-muted-foreground sm:text-sm">{item.desc}</p>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
