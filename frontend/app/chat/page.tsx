import type { Metadata } from "next"
import { ChatPageIntro } from "@/components/chat-page-intro"
import { Header } from "@/components/sections/header"
import { CTA } from "@/components/sections/cta"
import { Footer } from "@/components/sections/footer"

export const metadata: Metadata = {
  title: "ผู้ช่วยวางแผนรับมือหนี้",
  description: "ประเมินภาระหนี้ เตรียมข้อมูลก่อนคุยกับเจ้าหนี้ และรู้จักช่องทางช่วยเหลือ",
}

export default function ChatPage() {
  return (
    <>
      <Header />
      <main className="min-h-screen bg-secondary/20 px-3 pb-10 pt-24 sm:px-6 sm:pt-28">
        <ChatPageIntro />
        <CTA fullPage />
      </main>
      <Footer />
    </>
  )
}
