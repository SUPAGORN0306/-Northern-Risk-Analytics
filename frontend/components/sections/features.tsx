"use client"

import { motion, useInView } from "motion/react"
import { ArrowUpRight, Building2, ClipboardCheck, FileCheck2, Radio, UsersRound } from "lucide-react"
import { useRef } from "react"
import { useAppState } from "@/lib/i18n"

export function Features() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-90px" })
  const { lang } = useAppState()

  const audiences =
    lang === "th"
      ? [
          {
            title: "สำหรับประชาชนและผู้ประกอบการภาคเหนือ",
            icon: Building2,
            points: [
              "ดูแนวโน้มท่องเที่ยว ภาระหนี้ และปฏิทินฤดูกาล 12 เดือนของจังหวัดตัวเองเพื่อวางแผนเงินสดล่วงหน้า",
              "คำนวณอัตราส่วนภาระหนี้ต่อรายได้ (DSR) แบบแม่นยำ พร้อมเทียบค่าเฉลี่ยจริงของจังหวัด (NSO 2568)",
              "เชื่อมโยงแนวทางแก้หนี้และเช็กลิสต์เอกสารจากประกาศทางการ พร้อมเลขหน้า PDF ที่ตรวจสอบได้จริง",
            ],
          },
          {
            title: "สำหรับนักวิเคราะห์นโยบายและเจ้าหน้าที่",
            icon: Radio,
            points: [
              "จัดกลุ่มความเสี่ยงเชิงโครงสร้าง 17 จังหวัดด้วยโมเดล KMeans (4 กลุ่ม) และคัดกรองตัวแปรเชิงประจักษ์",
              "ติดตามข่าวเหตุการณ์เศรษฐกิจ ฝุ่น และน้ำท่วมที่ผ่านการยืนยันข้อความต้นฉบับ 100%",
              "ส่งออกรายงานสรุปเชิงนโยบาย 1 หน้า A4 (ไทย/อังกฤษ) และตรวจสอบคุณภาพข้อมูลครบทุกชั้น",
            ],
          },
        ]
      : [
          {
            title: "For Citizens and Local Businesses",
            icon: Building2,
            points: [
              "Inspect provincial occupancy trends, NSO debt cushions, and a 12 month seasonality planner",
              "Run deterministic Debt Service Ratio (DSR) checks benchmarked against provincial averages",
              "Receive official debt restructuring and resilience guidance with verifiable PDF page citations",
            ],
          },
          {
            title: "For Policy Analysts and Regional Teams",
            icon: Radio,
            points: [
              "Benchmark 17 provinces across 4 empirical risk tiers with transparent feature screening",
              "Monitor verbatim grounded regional news and live Air4Thai sensor governance",
              "Export printable one page A4 executive policy briefs and inspect full Medallion data health",
            ],
          },
        ]

  return (
    <section
      ref={ref}
      id="overview"
      aria-labelledby="overview-heading"
      className="scroll-target bg-background px-5 py-16 sm:px-8 md:py-24"
    >
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.55 }}
          className="mb-10 flex flex-col gap-4 md:mb-12 md:flex-row md:items-end md:justify-between"
        >
          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              {lang === "th" ? "ภาพรวมระบบ" : "Overview"}
            </p>
            <h2
              id="overview-heading"
              className="max-w-2xl font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
            >
              {lang === "th"
                ? "ข้อมูลจริงชุดเดียว เชื่อมประชาชนและนโยบายเข้าด้วยกัน"
                : "One verified regional lens. Clearer decisions."}
            </h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            {lang === "th"
              ? "ผสานข้อมูลสถิติทางการรายเดือน รายปี และเอกสารนโยบาย เพื่อเปลี่ยนข้อมูลเศรษฐกิจให้เข้าใจและนำไปใช้ได้จริง"
              : "Connecting official tourism, household finance, macro costs, and verified policy documents into one practical platform."}
          </p>
        </motion.div>

        <div className="grid gap-4 md:grid-cols-2">
          {audiences.map((audience, index) => (
            <motion.article
              key={audience.title}
              initial={{ opacity: 0, y: 24 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.55, delay: index * 0.12 }}
              className="rounded-[1.75rem] border border-border bg-card p-6 sm:p-8"
            >
              <div className="mb-7 flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-secondary text-foreground">
                  <audience.icon aria-hidden="true" className="size-5" />
                </span>
                <ArrowUpRight aria-hidden="true" className="size-4 text-muted-foreground" />
              </div>
              <h3 className="font-display text-xl font-semibold tracking-tight text-foreground">
                {audience.title}
              </h3>
              <ul className="mt-6 flex flex-col gap-4">
                {audience.points.map((point, pointIndex) => {
                  const PointIcon =
                    index === 0
                      ? [ClipboardCheck, UsersRound, FileCheck2][pointIndex]
                      : [Radio, UsersRound, FileCheck2][pointIndex]
                  return (
                    <li key={point} className="flex items-start gap-3 text-sm leading-6 text-muted-foreground">
                      <PointIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-foreground/70" />
                      <span>{point}</span>
                    </li>
                  )
                })}
              </ul>
            </motion.article>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.28 }}
          className="mt-4 flex flex-col gap-3 rounded-2xl bg-secondary px-5 py-4 sm:flex-row sm:items-center sm:px-7"
        >
          <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
            {lang === "th" ? "วงจรข้อมูลเพื่อประชาชนและนโยบาย" : "Closed Feedback Loop"}
          </span>
          <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
          <p className="text-sm leading-6 text-muted-foreground">
            {lang === "th"
              ? "สถิติการประเมินภาระหนี้แบบไม่ระบุตัวตนช่วยให้เจ้าหน้าที่มองเห็นพื้นที่ที่มีแรงกดดันทางการเงินได้เร็วขึ้น โดยไม่เก็บข้อมูลส่วนบุคคล"
              : "Anonymized aggregate resilience checks help regional policy teams identify financial pressure areas without storing personal data."}
          </p>
        </motion.div>
      </div>
    </section>
  )
}
