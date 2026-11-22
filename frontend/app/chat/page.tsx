import type { Metadata } from "next"
import { Header } from "@/components/sections/header"
import { CTA } from "@/components/sections/cta"

export const metadata: Metadata = {
  title: "ผู้ช่วยวางแผนรับมือหนี้",
  description: "ประเมินภาระหนี้ เตรียมข้อมูลก่อนคุยกับเจ้าหนี้ และรู้จักช่องทางช่วยเหลือ",
}

export default function ChatPage() {
  return (
    <>
      <Header />
      <main className="min-h-screen bg-secondary/20 px-3 pb-6 pt-24 sm:px-6 sm:pt-28">
        <div className="mx-auto mb-4 max-w-5xl">
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            ผู้ช่วยวางแผนรับมือหนี้
          </h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            ประเมินภาระหนี้ เตรียมข้อมูลก่อนคุยกับเจ้าหนี้ หรือวางแผนรับมือเมื่อรายได้เปลี่ยนแปลง พิมพ์หรือกดไมค์เพื่อพูดได้
          </p>
        </div>
        <CTA fullPage />
      </main>
    </>
  )
}
