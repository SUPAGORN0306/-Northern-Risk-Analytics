"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Building2,
  ChartNoAxesCombined,
  Check,
  CircleHelp,
  ClipboardList,
  Clock,
  Database,
  Download,
  ExternalLink,
  FileText,
  Gauge,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ProvinceHistoryChart, RegionalRiskGrouping } from "@/components/regional-risk-charts"
import {
  fetchDataHealth,
  fetchExecutiveBriefJson,
  fetchExecutiveBriefText,
  fetchPolicyMonitor,
  fetchProvinceDetail,
  runStaffMonteCarlo,
  runStaffRecluster,
  triggerLiveRefresh,
  type DataHealthResponse,
  type ExecutiveBriefData,
  type PolicyMonitorResponse,
  type ProvinceDetailResponse,
  type QuadrantProvince,
  type StaffAuthResponse,
  type StaffMonteCarloResponse,
  type StaffReclusterResponse,
} from "@/lib/api"
import {
  formatGroupTag,
  formatThaiMonth,
  translateClusterGuidance,
  translateClusterLabel,
  translateDsrBand,
  translateFeatureName,
  translateQuarantineReason,
  translateShockType,
  translateTargetName,
  useAppState,
} from "@/lib/i18n"

type WorkspaceTab = "overview" | "modeling" | "health"

const CLUSTER_DOT_CLASS: Record<number, string> = {
  1: "bg-teal-700",
  2: "bg-amber-600",
  3: "bg-slate-700",
  4: "bg-slate-400",
}

export function StaffWorkspace({
  auth,
  onExit,
}: {
  auth: StaffAuthResponse
  onExit: () => void
}) {
  const { lang, setLang } = useAppState()
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview")
  const [selectedCode, setSelectedCode] = useState("CR")
  const [months, setMonths] = useState(24)

  const [monitor, setMonitor] = useState<PolicyMonitorResponse | null>(null)
  const [health, setHealth] = useState<DataHealthResponse | null>(null)
  const [detail, setDetail] = useState<ProvinceDetailResponse | null>(null)
  const [brief, setBrief] = useState<ExecutiveBriefData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [testingSpeed, setTestingSpeed] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)
  const [cachedFetchMs, setCachedFetchMs] = useState<number | null>(null)
  const [freshDbFetchMs, setFreshDbFetchMs] = useState<number | null>(null)
  const [mcComputeMs, setMcComputeMs] = useState<number | null>(null)
  const [clusterComputeMs, setClusterComputeMs] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const briefRef = useRef<HTMLDialogElement>(null)

  async function loadWorkspaceData(forceFresh = false) {
    if (forceFresh) {
      setTestingSpeed(true)
    } else {
      setLoading(true)
    }
    setError(null)
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now()
    try {
      const [m, h] = await Promise.all([
        fetchPolicyMonitor(auth.access_token, forceFresh),
        fetchDataHealth(auth.access_token, forceFresh),
      ])
      const elapsed = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0)
      if (forceFresh || h.cache_status === "MISS") {
        setFreshDbFetchMs(elapsed)
      } else {
        setCachedFetchMs(elapsed)
      }
      setMonitor(m)
      setHealth(h)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load staff workspace")
    } finally {
      setLoading(false)
      setTestingSpeed(false)
    }
  }

  async function runSpeedBenchmark() {
    setTestingSpeed(true)
    try {
      // Measure real uncached live query to Neon PostgreSQL
      const tFresh0 = performance.now()
      const hFresh = await fetchDataHealth(auth.access_token, true)
      const freshMs = Math.round(performance.now() - tFresh0)
      setFreshDbFetchMs(freshMs)
      setHealth(hFresh)

      // Measure fast cached response immediately after warm up
      const tHit0 = performance.now()
      await fetchDataHealth(auth.access_token, false)
      const hitMs = Math.max(1, Math.round(performance.now() - tHit0))
      setCachedFetchMs(hitMs)
    } catch {
      // Keep last measured values if transient network failure occurs
    } finally {
      setTestingSpeed(false)
    }
  }

  useEffect(() => {
    void loadWorkspaceData()
  }, [auth.access_token])

  useEffect(() => {
    if (!refreshMsg) return
    const timer = setTimeout(() => {
      setRefreshMsg(null)
    }, 4000)
    return () => clearTimeout(timer)
  }, [refreshMsg])

  useEffect(() => {
    let active = true
    setDetail(null)
    fetchProvinceDetail(selectedCode)
      .then((res) => {
        if (active) setDetail(res)
      })
      .catch(() => {
        if (active) setDetail(null)
      })
    return () => {
      active = false
    }
  }, [selectedCode])

  const provinces = monitor?.quadrant_provinces ?? []
  const selected = useMemo(
    () => provinces.find((p) => p.province_code === selectedCode) ?? provinces[0] ?? null,
    [provinces, selectedCode],
  )

  async function openBriefDialog() {
    briefRef.current?.showModal()
    try {
      const data = await fetchExecutiveBriefJson(auth.access_token, lang)
      setBrief(data)
    } catch {
      setBrief(null)
    }
  }

  async function printOnePageBrief() {
    try {
      const html = await fetchExecutiveBriefText(auth.access_token, "html", lang)
      const iframe = document.createElement("iframe")
      iframe.style.position = "fixed"
      iframe.style.width = "0"
      iframe.style.height = "0"
      iframe.style.border = "0"
      iframe.style.visibility = "hidden"
      document.body.appendChild(iframe)

      const doc = iframe.contentDocument || iframe.contentWindow?.document
      if (!doc) {
        iframe.remove()
        return
      }
      doc.open()
      doc.write(html)
      doc.close()

      setTimeout(() => {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
        setTimeout(() => iframe.remove(), 1500)
      }, 250)
    } catch {
      // Ignore transient print failure
    }
  }

  async function handleLiveRefresh() {
    setRefreshing(true)
    setRefreshMsg(null)
    try {
      const res = await triggerLiveRefresh(auth.access_token)
      await loadWorkspaceData()
      const freshDetail = await fetchProvinceDetail(selectedCode)
      setDetail(freshDetail)
      const fetched = Number(res?.news_bronze?.fetched_unique ?? 0)
      const added = Number(res?.news_silver?.validated_silver ?? 0)
      setRefreshMsg(
        lang === "th"
          ? `ดึงข้อมูลล่าสุดครบ 17 จังหวัดเรียบร้อย · ตรวจพบข่าว ${fetched} รายการ และคัดกรองเพิ่มเข้าสู่ระบบ ${added} ข่าว`
          : `Synced live Air4Thai & 17 province RSS feeds (${fetched} scanned, ${added} new verified events).`,
      )
    } catch (err) {
      setRefreshMsg(err instanceof Error ? err.message : "Refresh failed")
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <Activity aria-hidden="true" className="size-5 shrink-0" />
            <span className="truncate font-display text-sm font-semibold tracking-tight sm:text-base">
              {lang === "th" ? "ระบบงานเจ้าหน้าที่วิเคราะห์นโยบาย" : "NorthRisk Staff Analytics"}
            </span>
            <span className="hidden rounded-full border border-border px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
              {auth.username === "demo_analyst" && lang === "th" ? "เจ้าหน้าที่วิเคราะห์นโยบาย" : auth.username}
            </span>
          </div>

          <nav
            aria-label="Staff portal views"
            className="order-3 flex w-full items-center gap-1 overflow-x-auto md:order-none md:w-auto"
          >
            <button
              type="button"
              onClick={onExit}
              className="whitespace-nowrap rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {lang === "th" ? "กลับหน้าสาธารณะ" : "Public View"}
            </button>
            <button
              type="button"
              aria-current={activeTab === "overview" ? "page" : undefined}
              onClick={() => setActiveTab("overview")}
              className={`whitespace-nowrap rounded-full px-3.5 py-2 text-xs font-medium transition-colors ${
                activeTab === "overview"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {lang === "th" ? "ภาพรวมและติดตามนโยบาย" : "Policy Overview"}
            </button>
            <button
              type="button"
              aria-current={activeTab === "modeling" ? "page" : undefined}
              onClick={() => setActiveTab("modeling")}
              className={`whitespace-nowrap rounded-full px-3.5 py-2 text-xs font-medium transition-colors ${
                activeTab === "modeling"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {lang === "th" ? "จำลองความเสี่ยงและจัดกลุ่มจังหวัด" : "Risk Simulation & Clustering Lab"}
            </button>
            <button
              type="button"
              aria-current={activeTab === "health" ? "page" : undefined}
              onClick={() => setActiveTab("health")}
              className={`whitespace-nowrap rounded-full px-3.5 py-2 text-xs font-medium transition-colors ${
                activeTab === "health"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {lang === "th" ? "คุณภาพและฐานข้อมูล" : "Data Health"}
            </button>
          </nav>

          <div className="flex items-center gap-2">
            <div className="inline-flex items-center rounded-full border border-border bg-secondary/70 p-0.5 text-[10px] font-medium">
              <button
                type="button"
                onClick={() => setLang("th")}
                className={`rounded-full px-2 py-1 ${lang === "th" ? "bg-foreground text-background" : "text-muted-foreground"}`}
              >
                ไทย
              </button>
              <button
                type="button"
                onClick={() => setLang("en")}
                className={`rounded-full px-2 py-1 ${lang === "en" ? "bg-foreground text-background" : "text-muted-foreground"}`}
              >
                EN
              </button>
            </div>
            <button
              type="button"
              onClick={onExit}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border px-3 py-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <span className="size-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
              <span>{lang === "th" ? "ออกจากระบบ" : "Exit Staff View"}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {error && (
          <div className="mb-4 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
            {error}
          </div>
        )}
        {refreshMsg && (
          <div className="mb-4 rounded-2xl border border-emerald-700/20 bg-emerald-700/5 px-4 py-3 text-xs text-emerald-800">
            {refreshMsg}
          </div>
        )}

        {loading && !monitor ? (
          <div className="flex h-64 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            <span>{lang === "th" ? "กำลังดึงข้อมูลจริงจากฐานข้อมูล…" : "Loading live analytics…"}</span>
          </div>
        ) : activeTab === "overview" ? (
          <PolicyOverviewPage
            monitor={monitor}
            selected={selected}
            selectedCode={selectedCode}
            detail={detail}
            months={months}
            refreshing={refreshing}
            onSelectCode={setSelectedCode}
            onMonthsChange={setMonths}
            onRefresh={() => void handleLiveRefresh()}
            onExport={() => void openBriefDialog()}
            onOpenModeling={() => setActiveTab("modeling")}
          />
        ) : activeTab === "modeling" ? (
          <RiskModelingAndClusteringPage
            token={auth.access_token}
            monitor={monitor}
            onPublished={() => void loadWorkspaceData(true)}
            onMonteCarloMeasured={setMcComputeMs}
            onClusterMeasured={setClusterComputeMs}
          />
        ) : (
          <DataHealthView
            health={health}
            cachedFetchMs={cachedFetchMs}
            freshDbFetchMs={freshDbFetchMs}
            mcComputeMs={mcComputeMs}
            clusterComputeMs={clusterComputeMs}
            testingSpeed={testingSpeed}
            onRunBenchmark={() => void runSpeedBenchmark()}
          />
        )}
      </main>

      {/* Printable one page Executive Policy Memo modal without Markdown button */}
      <dialog
        ref={briefRef}
        aria-labelledby="brief-title"
        data-print-brief
        className="m-auto w-[calc(100%-2rem)] max-w-4xl rounded-3xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/55 backdrop:backdrop-blur-sm"
      >
        <div id="executive-brief" className="p-6 sm:p-8">
          <div className="no-print mb-5 flex items-center justify-between border-b border-border pb-4">
            <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <FileText aria-hidden="true" className="size-4" />
              {lang === "th" ? "บันทึกสรุปเชิงนโยบาย" : "Executive Policy Memo"}
            </span>
            <button
              type="button"
              onClick={() => briefRef.current?.close()}
              aria-label="Close executive brief"
              className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
            </button>
          </div>

          {brief ? (
            <>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {lang === "th" ? "ระบบวิเคราะห์ความเสี่ยงเศรษฐกิจภาคเหนือ" : "NorthRisk Analytics"} ·{" "}
                {formatThaiMonth(brief.latest_month, lang)} · {brief.generated_at}
              </p>
              <h2 id="brief-title" className="mt-1.5 font-display text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
                {lang === "th"
                  ? "บันทึกสรุปเชิงนโยบาย: เศรษฐกิจภาคบริการและความเปราะบางทางการเงินภาคเหนือ"
                  : "Executive Policy Memo: Northern Service Sector & Debt Resilience"}
              </h2>

              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <BriefMetric
                  label={lang === "th" ? "อัตราเข้าพักเฉลี่ย 17 จังหวัด" : "17P Avg Occupancy"}
                  value={`${brief.regional_snapshot.avg_occupancy_pct.toFixed(1)}%`}
                  sub={`${lang === "th" ? "เทียบปีก่อน" : "YoY"} ${brief.regional_snapshot.avg_occupancy_yoy_diff >= 0 ? "+" : ""}${brief.regional_snapshot.avg_occupancy_yoy_diff.toFixed(1)}%`}
                />
                <BriefMetric
                  label={lang === "th" ? "รายได้ท่องเที่ยวรวมต่อเดือน" : "Monthly Revenue"}
                  value={`${Math.round(brief.regional_snapshot.total_monthly_revenue_mthb).toLocaleString()} ${lang === "th" ? "ล้านบาท" : "M THB"}`}
                  sub={
                    lang === "th"
                      ? `เชียงใหม่และเชียงรายคิดเป็น ${brief.regional_snapshot.top2_revenue_share_pct}%`
                      : `CM+CR share ${brief.regional_snapshot.top2_revenue_share_pct}%`
                  }
                />
                <BriefMetric
                  label={lang === "th" ? "เงินเฟ้อไทย / ราคาน้ำมันโลก" : "CPI / Brent Oil YoY"}
                  value={
                    brief.regional_snapshot.th_cpi_yoy_pct != null
                      ? `${brief.regional_snapshot.th_cpi_yoy_pct.toFixed(2)}%`
                      : "—"
                  }
                  sub={
                    brief.regional_snapshot.oil_brent_yoy_pct != null
                      ? `${lang === "th" ? "น้ำมันโลก" : "Brent"} ${brief.regional_snapshot.oil_brent_yoy_pct >= 0 ? "+" : ""}${brief.regional_snapshot.oil_brent_yoy_pct.toFixed(0)}%`
                      : ""
                  }
                />
                <BriefMetric
                  label={lang === "th" ? "สัญญาณภัยพิบัติภายนอก" : "External Hazard Status"}
                  value={
                    brief.regional_snapshot.has_regional_external_shock
                      ? lang === "th"
                        ? `เฝ้าระวัง ${brief.regional_snapshot.elevated_shock_provinces.length} จังหวัด`
                        : `${brief.regional_snapshot.elevated_shock_provinces.length} Active`
                      : lang === "th"
                        ? "ภาวะปกติ (0/17)"
                        : "Normal (0/17)"
                  }
                  sub={lang === "th" ? "เกณฑ์เตือนภัยดัชนีเกิน 50" : "Alert cutoff >= 50"}
                />
              </div>

              <div className="mt-4 rounded-2xl border-l-4 border-foreground bg-secondary/45 px-4 py-3.5 text-xs leading-6 text-foreground">
                <span className="font-semibold">
                  {lang === "th" ? "1. สรุปสถานการณ์ภาพรวม: " : "1. Situation Overview: "}
                </span>
                <span className="text-muted-foreground">{brief.situation_summary}</span>
              </div>

              <div className="mt-5">
                <h3 className="text-xs font-semibold text-foreground">
                  {lang === "th"
                    ? "2. รายชื่อ 5 จังหวัดที่ต้องเฝ้าระวังเร่งด่วนที่สุด"
                    : "2. Priority Watchlist (Top 5 Provinces Requiring Attention)"}
                </h3>
                <div className="mt-2 overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-secondary/60 text-[10px] text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-3 py-2 font-medium">{lang === "th" ? "จังหวัด" : "Province"}</th>
                        <th className="px-2.5 py-2 text-right font-medium">{lang === "th" ? "เข้าพัก" : "Occ"}</th>
                        <th className="px-2.5 py-2 text-right font-medium">{lang === "th" ? "หนี้ธุรกิจ" : "SME Debt"}</th>
                        <th className="px-2.5 py-2 text-right font-medium">{lang === "th" ? "เงินเหลือ" : "Surplus"}</th>
                        <th className="px-3 py-2 font-medium">{lang === "th" ? "จุดเสี่ยงหลัก" : "Risk Driver"}</th>
                        <th className="px-3 py-2 font-medium">{lang === "th" ? "แนวทางดำเนินการ" : "Recommended Action"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {brief.priority_watchlist.map((w) => (
                        <tr key={w.province_code} className="border-b border-border/60 last:border-0">
                          <td className="whitespace-nowrap px-3 py-2.5 align-top font-semibold text-foreground">
                            {lang === "th" ? w.name_th : w.name_en}
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-2.5 text-right align-top tabular-nums">
                            {w.occupancy_pct}%
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-2.5 text-right align-top tabular-nums">
                            {w.dti_sme} {lang === "th" ? "เท่า" : "x"}
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-2.5 text-right align-top font-semibold tabular-nums">
                            {w.cash_cushion_sme.toFixed(0)}%
                          </td>
                          <td className="px-3 py-2.5 align-top leading-5 text-muted-foreground">{w.risk_reason}</td>
                          <td className="px-3 py-2.5 align-top leading-5 text-foreground">{w.recommended_action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-5">
                <h3 className="text-xs font-semibold text-foreground">
                  {lang === "th" ? "3. แผนปฏิบัติการเชิงนโยบาย 3 ระยะ" : "3. Three Horizon Policy Action Plan"}
                </h3>
                <div className="mt-2 space-y-2">
                  {brief.action_plan.map((item, idx) => (
                    <div key={idx} className="rounded-xl border border-border bg-secondary/30 px-4 py-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-foreground">{item.horizon}</span>
                        <span className="text-[11px] text-muted-foreground">{item.target_area}</span>
                      </div>
                      <p className="mt-1 leading-5 text-muted-foreground">{item.action}</p>
                    </div>
                  ))}
                </div>
              </div>

              {brief.verified_news.length > 0 && (
                <div className="mt-4 border-t border-border pt-3.5">
                  <h3 className="text-xs font-semibold text-foreground">
                    {lang === "th" ? "4. สัญญาณข่าวภาคสนามล่าสุด" : "4. Latest Verified Field Signals"}
                  </h3>
                  <ul className="mt-2 space-y-1.5 text-[11px] text-muted-foreground">
                    {brief.verified_news.slice(0, 2).map((n, idx) => (
                      <li key={idx}>
                        <strong className="text-foreground">
                          {n.event_date} · {lang === "th" ? n.name_th : n.name_en} ({translateShockType(n.shock_type, lang)}):
                        </strong>{" "}
                        {n.evidence_quote}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="mt-4 border-t border-border pt-3 text-[10px] leading-5 text-muted-foreground">
                {lang === "th"
                  ? "แหล่งข้อมูลทางการ: กระทรวงการท่องเที่ยวและกีฬา, สำนักงานสถิติแห่งชาติ (2568), ดัชนีเงินเฟ้อ, ราคาน้ำมันโลก, กรมควบคุมมลพิษ และเอกสารธนาคารแห่งประเทศไทย"
                  : "Official Sources: MOTS, NSO 2025, BIS CPI, FRED, Open Meteo, Air4Thai, and Bank of Thailand Official Publications."}
              </p>
            </>
          ) : (
            <div className="flex h-40 items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              <span>{lang === "th" ? "กำลังสร้างบันทึกสรุปจากข้อมูลล่าสุด…" : "Generating live memo…"}</span>
            </div>
          )}

          <div className="no-print mt-6 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => briefRef.current?.close()}
              className="inline-flex h-10 items-center justify-center rounded-full border border-border px-4 text-xs font-medium text-foreground hover:bg-secondary"
            >
              {lang === "th" ? "ปิดหน้าต่าง" : "Close"}
            </button>
            <button
              type="button"
              onClick={() => void printOnePageBrief()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-foreground px-5 text-xs font-medium text-background hover:opacity-85"
            >
              <Download aria-hidden="true" className="size-3.5" />
              {lang === "th" ? "พิมพ์ / บันทึกเอกสารสรุป 1 หน้า" : "Print / Save 1 Page Memo"}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  )
}

function PolicyOverviewPage({
  monitor,
  selected,
  selectedCode,
  detail,
  months,
  refreshing,
  onSelectCode,
  onMonthsChange,
  onRefresh,
  onExport,
  onOpenModeling,
}: {
  monitor: PolicyMonitorResponse | null
  selected: QuadrantProvince | null
  selectedCode: string
  detail: ProvinceDetailResponse | null
  months: number
  refreshing: boolean
  onSelectCode: (code: string) => void
  onMonthsChange: (m: number) => void
  onRefresh: () => void
  onExport: () => void
  onOpenModeling: () => void
}) {
  const { lang } = useAppState()
  const provinces = monitor?.quadrant_provinces ?? []
  const demand = monitor?.public_demand_signals
  const provNameMap = new Map(
    provinces.map((p) => [p.province_code, lang === "th" ? p.name_th : p.name_en]),
  )
  const totalAvailableMonths = monitor?.panel_months || detail?.monthly_series.length || 0

  const [provinceSearch, setProvinceSearch] = useState("")
  const [showAllWatchlist, setShowAllWatchlist] = useState(false)
  const [distMetric, setDistMetric] = useState<"margin" | "debt" | "occupancy">("margin")

  // Rank all 17 provinces by composite vulnerability priority score
  const rankedProvinces = useMemo(() => {
    const scored = provinces.map((p) => {
      const margin = p.expense_to_income_pct_sme != null ? Math.max(0, 100 - p.expense_to_income_pct_sme) : 22
      const debt = p.debt_to_annual_income_sme ?? 0.57
      const tightMarginPenalty = Math.max(0, (30 - margin) * 2.2)
      const debtPenalty = Math.min(100, debt * 65)
      const priorityScore =
        0.38 * (p.exposure_score ?? 50) +
        0.32 * (p.shock_intensity ?? 40) +
        0.15 * tightMarginPenalty +
        0.15 * debtPenalty
      return {
        ...p,
        cash_margin_pct: margin,
        sme_debt_ratio: debt,
        priority_score: priorityScore,
      }
    })
    scored.sort((a, b) => b.priority_score - a.priority_score)
    return scored.map((item, idx) => ({
      ...item,
      priority_rank: idx + 1,
    }))
  }, [provinces])

  const selectedRanked = useMemo(
    () => rankedProvinces.find((p) => p.province_code === selectedCode) ?? rankedProvinces[0] ?? null,
    [rankedProvinces, selectedCode],
  )

  const filteredWatchlist = useMemo(() => {
    const q = provinceSearch.trim().toLowerCase()
    if (q) {
      return rankedProvinces.filter(
        (p) =>
          p.name_th.toLowerCase().includes(q) ||
          p.name_en.toLowerCase().includes(q) ||
          p.province_code.toLowerCase().includes(q),
      )
    }
    if (showAllWatchlist) return rankedProvinces
    const topFive = rankedProvinces.slice(0, 5)
    if (selectedRanked && !topFive.some((p) => p.province_code === selectedRanked.province_code)) {
      return [...topFive, selectedRanked]
    }
    return topFive
  }, [rankedProvinces, provinceSearch, showAllWatchlist, selectedRanked])

  // Compute 17 province distribution statistics for the 3 selectable indicators
  const distributionStats = useMemo(() => {
    if (!rankedProvinces.length) return null

    const rows = rankedProvinces.map((p) => {
      const val =
        distMetric === "margin"
          ? p.cash_margin_pct
          : distMetric === "debt"
            ? p.sme_debt_ratio
            : p.avg_occupancy_rate
      return {
        ...p,
        metricValue: val,
      }
    })

    // Sort from highest policy concern to lowest concern
    rows.sort((a, b) => {
      if (distMetric === "margin") return a.metricValue - b.metricValue
      if (distMetric === "debt") return b.metricValue - a.metricValue
      return b.metricValue - a.metricValue
    })

    const vals = rows.map((r) => r.metricValue)
    const sortedAsc = [...vals].sort((a, b) => a - b)
    const mean = vals.reduce((acc, v) => acc + v, 0) / vals.length
    const mid = Math.floor(sortedAsc.length / 2)
    const median =
      sortedAsc.length % 2 !== 0
        ? sortedAsc[mid]
        : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2

    const minRow = [...rows].sort((a, b) => a.metricValue - b.metricValue)[0]
    const maxRow = [...rows].sort((a, b) => b.metricValue - a.metricValue)[0]
    const maxScale =
      distMetric === "margin"
        ? Math.max(40, maxRow.metricValue * 1.1)
        : distMetric === "debt"
          ? Math.max(1.2, maxRow.metricValue * 1.1)
          : 100

    let zoneHighRisk = 0
    let zoneModerate = 0
    let zoneHealthy = 0

    const enrichedRows = rows.map((r, i) => {
      let zone: "risk" | "watch" | "healthy" = "watch"
      if (distMetric === "margin") {
        if (r.metricValue < 19) {
          zone = "risk"
          zoneHighRisk++
        } else if (r.metricValue <= 24) {
          zone = "watch"
          zoneModerate++
        } else {
          zone = "healthy"
          zoneHealthy++
        }
      } else if (distMetric === "debt") {
        if (r.metricValue >= 0.65) {
          zone = "risk"
          zoneHighRisk++
        } else if (r.metricValue >= 0.45) {
          zone = "watch"
          zoneModerate++
        } else {
          zone = "healthy"
          zoneHealthy++
        }
      } else {
        if (r.metricValue < 52) {
          zone = "risk"
          zoneHighRisk++
        } else if (r.metricValue <= 66) {
          zone = "watch"
          zoneModerate++
        } else {
          zone = "healthy"
          zoneHealthy++
        }
      }
      return {
        ...r,
        distRank: i + 1,
        zone,
        diffFromMean: r.metricValue - mean,
      }
    })

    return {
      rows: enrichedRows,
      mean,
      median,
      minRow,
      maxRow,
      maxScale,
      zoneHighRisk,
      zoneModerate,
      zoneHealthy,
      total: rows.length,
    }
  }, [rankedProvinces, distMetric])

  const formatDistVal = (v: number) => {
    if (distMetric === "margin") return `${v.toFixed(1)}%`
    if (distMetric === "debt") return lang === "th" ? `${v.toFixed(2)} เท่า` : `${v.toFixed(2)}x`
    return `${v.toFixed(1)}%`
  }

  // Group summary statistics across the 4 structural clusters for the left executive column
  const clusterSummaries = useMemo(() => {
    const groups = new Map<
      number,
      {
        cluster_id: number
        cluster_label: string
        items: typeof rankedProvinces
      }
    >()
    for (const p of rankedProvinces) {
      const existing = groups.get(p.cluster_id)
      if (existing) {
        existing.items.push(p)
      } else {
        groups.set(p.cluster_id, {
          cluster_id: p.cluster_id,
          cluster_label: p.cluster_label,
          items: [p],
        })
      }
    }
    return Array.from(groups.values())
      .sort((a, b) => a.cluster_id - b.cluster_id)
      .map((g) => {
        const avgMargin =
          g.items.reduce((acc, item) => acc + item.cash_margin_pct, 0) / Math.max(1, g.items.length)
        const avgDebt =
          g.items.reduce((acc, item) => acc + item.sme_debt_ratio, 0) / Math.max(1, g.items.length)
        const avgOcc =
          g.items.reduce((acc, item) => acc + item.avg_occupancy_rate, 0) / Math.max(1, g.items.length)
        return {
          ...g,
          avgMargin,
          avgDebt,
          avgOcc,
        }
      })
  }, [rankedProvinces])

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            {lang === "th" ? "ระบบติดตามสถานการณ์รายจังหวัดสำหรับเจ้าหน้าที่" : "Executive Provincial Monitoring"}
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {lang === "th" ? "ภาพรวมเศรษฐกิจและติดตามนโยบาย 17 จังหวัด" : "Regional Policy Overview"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {lang === "th"
              ? "วิเคราะห์การกระจายตัวของสภาพคล่องและภาระหนี้ทั้ง 17 จังหวัด จัดอันดับจังหวัดเฝ้าระวังสูงสุด พร้อมตัวกรองเจาะลึกรายจังหวัด"
              : "Regional distribution of liquidity and debt across 17 provinces, top priority watchlist, and direct provincial filter."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Direct Province Filter Selector */}
          <div className="inline-flex h-10 items-center gap-2 rounded-full border border-foreground/25 bg-background px-3.5 text-xs">
            <span className="font-medium text-muted-foreground">
              {lang === "th" ? "ตัวกรองจังหวัด" : "Province"}
            </span>
            <select
              aria-label={lang === "th" ? "เลือกจังหวัดที่ต้องการเจาะลึก" : "Select province to inspect"}
              value={selectedCode}
              onChange={(e) => onSelectCode(e.target.value)}
              className="bg-transparent font-semibold text-foreground outline-none"
            >
              {rankedProvinces.map((p) => (
                <option key={p.province_code} value={p.province_code}>
                  {lang === "th"
                    ? `อันดับ #${p.priority_rank} ${p.name_th}`
                    : `#${p.priority_rank} ${p.name_en}`}
                </option>
              ))}
            </select>
          </div>

          <select
            aria-label="Chart horizon"
            value={months}
            onChange={(e) => onMonthsChange(Number(e.target.value))}
            className="h-10 rounded-full border border-input bg-background px-4 text-xs font-medium text-foreground outline-none"
          >
            <option value={12}>{lang === "th" ? "ย้อนหลัง 12 เดือน" : "Last 12 Months"}</option>
            <option value={24}>{lang === "th" ? "ย้อนหลัง 24 เดือน" : "Last 24 Months"}</option>
            {totalAvailableMonths > 0 && (
              <option value={totalAvailableMonths}>
                {lang === "th"
                  ? `ทั้งหมดในฐานข้อมูล (${totalAvailableMonths} เดือน)`
                  : `All Available (${totalAvailableMonths} Months)`}
              </option>
            )}
          </select>

          <button
            type="button"
            disabled={refreshing}
            onClick={onRefresh}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-background px-4 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
          >
            <RefreshCw aria-hidden="true" className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {lang === "th" ? "ดึงข้อมูลสด" : "Sync Live Data"}
          </button>

          <button
            type="button"
            onClick={onOpenModeling}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-foreground/30 bg-secondary px-4 text-xs font-medium text-foreground transition-colors hover:bg-secondary/80"
          >
            <Sparkles aria-hidden="true" className="size-3.5" />
            {lang === "th" ? "ไปที่หน้าจำลองความเสี่ยงและจัดกลุ่ม" : "Go to Simulation & Clustering"}
          </button>

          <button
            type="button"
            onClick={onExport}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-foreground px-4 text-xs font-medium text-background transition-opacity hover:opacity-85"
          >
            <Download aria-hidden="true" className="size-3.5" />
            {lang === "th" ? "ออกบันทึกสรุปผู้บริหาร 1 หน้า" : "Export 1 Page Memo"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(310px,33fr)_minmax(0,67fr)] lg:items-stretch">
        {/* Left Sidebar Active Provincial Focus + Top 5 Priority Watchlist + 4 Group Summary + Demand Signals */}
        <aside className="flex flex-col gap-4">
          {selectedRanked && (
            <div className="rounded-2xl border border-border bg-secondary/45 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-foreground px-2.5 py-0.5 text-[10px] font-semibold text-background">
                  {lang === "th"
                    ? `อันดับเฝ้าระวัง #${selectedRanked.priority_rank} จาก 17 จังหวัด`
                    : `Watchlist Rank #${selectedRanked.priority_rank} of 17`}
                </span>
                <span className="text-[10px] font-medium text-muted-foreground">
                  {formatGroupTag(selectedRanked.cluster_id, lang)}
                </span>
              </div>
              <p className="mt-2 text-base font-semibold text-foreground">
                {lang === "th" ? selectedRanked.name_th : selectedRanked.name_en}
              </p>
              <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                {translateClusterLabel(selectedRanked.cluster_label, lang)}
              </p>

              <div className="mt-3 grid grid-cols-3 gap-1.5">
                <div className="rounded-xl border border-border bg-background px-2.5 py-2">
                  <span className="block text-[10px] text-muted-foreground">
                    {lang === "th" ? "เงินเหลือ" : "Margin"}
                  </span>
                  <span className="mt-0.5 block text-xs font-semibold tabular-nums text-foreground">
                    {selectedRanked.cash_margin_pct.toFixed(0)}%
                  </span>
                </div>
                <div className="rounded-xl border border-border bg-background px-2.5 py-2">
                  <span className="block text-[10px] text-muted-foreground">
                    {lang === "th" ? "หนี้ต่อรายได้ปี" : "Debt/Inc"}
                  </span>
                  <span className="mt-0.5 block text-xs font-semibold tabular-nums text-foreground">
                    {lang === "th"
                      ? `${selectedRanked.sme_debt_ratio.toFixed(2)} เท่า`
                      : `${selectedRanked.sme_debt_ratio.toFixed(2)}x`}
                  </span>
                </div>
                <div className="rounded-xl border border-border bg-background px-2.5 py-2">
                  <span className="block text-[10px] text-muted-foreground">
                    {lang === "th" ? "อัตราเข้าพัก" : "Occupancy"}
                  </span>
                  <span className="mt-0.5 block text-xs font-semibold tabular-nums text-foreground">
                    {selectedRanked.avg_occupancy_rate.toFixed(0)}%
                  </span>
                </div>
              </div>

              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                {translateClusterGuidance(selectedRanked.cluster_id, lang)}
              </p>
            </div>
          )}

          <section className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="border-b border-border px-4 py-3.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">
                    {lang === "th"
                      ? showAllWatchlist || provinceSearch.trim()
                        ? "จัดอันดับความเปราะบางทั้ง 17 จังหวัด"
                        : "5 อันดับจังหวัดเฝ้าระวังสูงสุด"
                      : showAllWatchlist || provinceSearch.trim()
                        ? "All 17 Provinces by Vulnerability Rank"
                        : "Top 5 Priority Watchlist"}
                  </h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {lang === "th"
                      ? "เรียงตามคะแนนความเปราะบาง ภาระหนี้ และแรงกดดันภัยพิบัติ"
                      : "Ranked by debt exposure, cash margin, and external shock"}
                  </p>
                </div>
                <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold text-foreground">
                  {showAllWatchlist || provinceSearch.trim()
                    ? `${filteredWatchlist.length}/${provinces.length}`
                    : lang === "th"
                      ? "5 อันดับแรก"
                      : "Top 5"}
                </span>
              </div>

              <div className="mt-2.5">
                <input
                  type="search"
                  value={provinceSearch}
                  onChange={(e) => setProvinceSearch(e.target.value)}
                  placeholder={lang === "th" ? "ค้นหาชื่อจังหวัดเพื่อกรองดูทันที…" : "Filter province by name…"}
                  className="h-8 w-full rounded-xl border border-input bg-background px-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground"
                />
              </div>
            </div>

            <ul className="divide-y divide-border/50 p-2">
              {filteredWatchlist.map((p) => {
                const isSelected = selectedCode === p.province_code
                const isTopThree = p.priority_rank <= 3
                return (
                  <li key={p.province_code}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => onSelectCode(p.province_code)}
                      className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition-colors ${
                        isSelected
                          ? "bg-foreground text-background"
                          : "text-foreground hover:bg-secondary/70"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span
                          className={`inline-flex h-5 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold tabular-nums ${
                            isSelected
                              ? "bg-background/20 text-background"
                              : isTopThree
                                ? "bg-amber-500/15 text-amber-700"
                                : "bg-secondary text-muted-foreground"
                          }`}
                        >
                          #{p.priority_rank}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold">
                            {lang === "th" ? p.name_th : p.name_en}
                          </span>
                          <span
                            className={`block truncate text-[10px] ${
                              isSelected ? "text-background/80" : "text-muted-foreground"
                            }`}
                          >
                            {lang === "th"
                              ? `เงินเหลือ ${p.cash_margin_pct.toFixed(0)}% · หนี้ ${p.sme_debt_ratio.toFixed(2)} เท่า`
                              : `Margin ${p.cash_margin_pct.toFixed(0)}% · Debt ${p.sme_debt_ratio.toFixed(2)}x`}
                          </span>
                        </span>
                      </span>
                      <span
                        className={`shrink-0 text-right text-[10px] tabular-nums ${
                          isSelected ? "text-background/90" : "text-muted-foreground"
                        }`}
                      >
                        <span className="block font-medium">
                          {lang === "th" ? `เข้าพัก ${p.avg_occupancy_rate.toFixed(0)}%` : `Occ ${p.avg_occupancy_rate.toFixed(0)}%`}
                        </span>
                        <span className="block text-[9px]">
                          {lang === "th" ? `แรงกดดัน ${p.shock_intensity.toFixed(0)}` : `Shock ${p.shock_intensity.toFixed(0)}`}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            {!provinceSearch.trim() && provinces.length > 5 && (
              <div className="border-t border-border p-2">
                <button
                  type="button"
                  onClick={() => setShowAllWatchlist((prev) => !prev)}
                  className="w-full rounded-xl bg-secondary/70 px-3 py-2 text-center text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                >
                  {showAllWatchlist
                    ? lang === "th"
                      ? "ย่อเหลือ 5 อันดับจังหวัดเฝ้าระวังสูงสุด"
                      : "Show Top 5 Priority Watchlist Only"
                    : lang === "th"
                      ? `ดูครบทั้ง ${provinces.length} จังหวัด (ซ่อนอยู่ ${provinces.length - 5} จังหวัด)`
                      : `Show All ${provinces.length} Provinces`}
                </button>
              </div>
            )}
          </section>

          {/* 4 Group Structural Risk Breakdown Card to enrich Left Column */}
          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">
                  {lang === "th"
                    ? "สรุปโครงสร้างความเสี่ยง 4 กลุ่มจังหวัด"
                    : "4 Group Structural Risk Summary"}
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {lang === "th"
                    ? "ค่าเฉลี่ยสภาพคล่องและรายชื่อจังหวัดในแต่ละกลุ่ม"
                    : "Group averages and clickable province chips"}
                </p>
              </div>
              <Layers aria-hidden="true" className="size-4 text-muted-foreground" />
            </div>

            <div className="space-y-2.5">
              {clusterSummaries.map((g) => (
                <div
                  key={g.cluster_id}
                  className="rounded-xl border border-border/80 bg-secondary/25 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
                      <span
                        className={`size-2 shrink-0 rounded-full ${CLUSTER_DOT_CLASS[g.cluster_id] || "bg-slate-400"}`}
                      />
                      {formatGroupTag(g.cluster_id, lang)} · {translateClusterLabel(g.cluster_label, lang)}
                    </span>
                    <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {lang === "th" ? `${g.items.length} จังหวัด` : `${g.items.length} prov`}
                    </span>
                  </div>

                  <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
                    {lang === "th"
                      ? `เงินเหลือเฉลี่ย ${g.avgMargin.toFixed(0)}% · หนี้เฉลี่ย ${g.avgDebt.toFixed(2)} เท่า · เข้าพัก ${g.avgOcc.toFixed(0)}%`
                      : `Avg margin ${g.avgMargin.toFixed(0)}% · Debt ${g.avgDebt.toFixed(2)}x · Occ ${g.avgOcc.toFixed(0)}%`}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-1">
                    {g.items.map((p) => {
                      const active = p.province_code === selectedCode
                      return (
                        <button
                          key={p.province_code}
                          type="button"
                          onClick={() => onSelectCode(p.province_code)}
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                            active
                              ? "border-foreground bg-foreground text-background"
                              : "border-border bg-background text-foreground hover:bg-secondary"
                          }`}
                        >
                          {lang === "th" ? p.name_th : p.name_en}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Anonymized Public Demand Signals Card stretched to align bottom with Right Column */}
          <section className="flex flex-1 flex-col justify-between rounded-2xl border border-border bg-card p-4">
            <div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">
                    {lang === "th" ? "สัญญาณความต้องการช่วยเหลือสะสม (ไม่ระบุตัวตน)" : "Anonymized Public Demand Signals"}
                  </h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {lang === "th"
                      ? `ยอดประเมินสะสม ${demand?.total_checks ?? 0} ครั้ง (สรุประดับจังหวัด ไม่มีข้อมูลส่วนบุคคล)`
                      : `${demand?.total_checks ?? 0} aggregate checks (provincial totals with zero personal data)`}
                  </p>
                </div>
                <Gauge aria-hidden="true" className="size-4 text-muted-foreground" />
              </div>

              {demand && demand.by_province_and_band.length > 0 ? (
                <div className="mt-3.5 space-y-2.5">
                  {demand.by_province_and_band.slice(0, 6).map((row, i) => {
                    const pct = Math.min(100, Math.round((row.query_count / Math.max(demand.total_checks, 1)) * 100))
                    return (
                      <div key={i}>
                        <div className="mb-1 flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">
                            {provNameMap.get(row.province_code) || row.province_code} · {translateDsrBand(row.dsr_band, lang)}
                          </span>
                          <span className="font-medium tabular-nums text-foreground">{row.query_count}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                          <div className="h-full rounded-full bg-foreground/75" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {lang === "th"
                    ? "ยังไม่มีสถิติการกดประเมินจากหน้าสาธารณะ เมื่อประชาชนใช้งานหน้าประเมินภาระหนี้ สถิติรวมระดับจังหวัดจะแสดงที่นี่อัตโนมัติ"
                    : "No public checks logged yet. Aggregate provincial demand bands appear automatically as citizens run checks."}
                </p>
              )}
            </div>

            <div className="mt-4 rounded-xl border border-border/70 bg-secondary/30 px-3 py-2 text-[10px] leading-4 text-muted-foreground">
              {lang === "th"
                ? "ข้อมูลสถิติความต้องการความช่วยเหลือรวบรวมเฉพาะรหัสจังหวัดและระดับภาระหนี้ ไม่มีการจัดเก็บชื่อหรือเลขบัญชี"
                : "Aggregated strictly by province code and debt service band with zero personal identifiers stored."}
            </div>
          </section>
        </aside>

        {/* Right Streamlined Executive Pane */}
        <div className="flex min-w-0 flex-col gap-4">
          {/* Option 3 Multi Metric 17 Province Regional Distribution Panel */}
          {distributionStats && (
            <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
                    {lang === "th"
                      ? "การกระจายตัวและความเหลื่อมล้ำระดับภูมิภาค 17 จังหวัด"
                      : "17 Province Regional Dispersion & Inequality"}
                  </p>
                  <h2 className="mt-1 font-display text-lg font-semibold">
                    {distMetric === "margin"
                      ? lang === "th"
                        ? "การกระจายตัวของสัดส่วนเงินเหลือหลังหักรายจ่าย (%)"
                        : "Distribution of SME Post Expense Cash Margin (%)"
                      : distMetric === "debt"
                        ? lang === "th"
                          ? "การกระจายตัวของภาระหนี้ธุรกิจต่อรายได้ปี (เท่า)"
                          : "Distribution of SME Debt to Annual Income Ratio (x)"
                        : lang === "th"
                          ? "การกระจายตัวของอัตราการเข้าพักเฉลี่ยรายจังหวัด (%)"
                          : "Distribution of Provincial Mean Occupancy Rate (%)"}
                  </h2>
                </div>

                {/* Single Line Non Wrapping 3 Metric Switcher Tabs */}
                <div
                  role="tablist"
                  aria-label={lang === "th" ? "เลือกตัวชี้วัดเพื่อดูการกระจายตัว" : "Select distribution metric"}
                  className="inline-flex shrink-0 flex-nowrap items-center gap-1 overflow-x-auto rounded-full border border-border bg-secondary/50 p-1"
                >
                  {(
                    [
                      {
                        id: "margin",
                        label: lang === "th" ? "เงินเหลือหลังหักรายจ่าย (%)" : "Cash Margin (%)",
                      },
                      {
                        id: "debt",
                        label: lang === "th" ? "หนี้ต่อรายได้ปี (เท่า)" : "SME Debt (x)",
                      },
                      {
                        id: "occupancy",
                        label: lang === "th" ? "อัตราเข้าพักเฉลี่ย (%)" : "Occupancy (%)",
                      },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={distMetric === tab.id}
                      onClick={() => setDistMetric(tab.id)}
                      className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[11px] font-medium transition-colors ${
                        distMetric === tab.id
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 4 Summary Distribution Statistics Cards */}
              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-xl border border-border bg-secondary/35 px-3 py-2.5">
                  <span className="block text-[10px] text-muted-foreground">
                    {lang === "th" ? "ค่าต่ำสุดในภาคเหนือ" : "Regional Minimum"}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold tabular-nums text-foreground">
                    {formatDistVal(distributionStats.minRow.metricValue)}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                    {lang === "th" ? distributionStats.minRow.name_th : distributionStats.minRow.name_en}
                  </span>
                </div>

                <div className="rounded-xl border border-border bg-secondary/35 px-3 py-2.5">
                  <span className="block text-[10px] text-muted-foreground">
                    {lang === "th" ? "ค่ามัธยฐาน 17 จังหวัด" : "Regional Median"}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold tabular-nums text-foreground">
                    {formatDistVal(distributionStats.median)}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {lang === "th" ? "จุดกึ่งกลางของการกระจายตัว" : "50th percentile benchmark"}
                  </span>
                </div>

                <div className="rounded-xl border border-border bg-secondary/35 px-3 py-2.5">
                  <span className="block text-[10px] text-muted-foreground">
                    {lang === "th" ? "ค่าเฉลี่ยภาคเหนือ" : "Regional Mean"}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold tabular-nums text-foreground">
                    {formatDistVal(distributionStats.mean)}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">
                    {lang === "th" ? "เส้นอ้างอิงเทียบรายจังหวัด" : "Reference line across 17 provinces"}
                  </span>
                </div>

                <div className="rounded-xl border border-border bg-secondary/35 px-3 py-2.5">
                  <span className="block text-[10px] text-muted-foreground">
                    {lang === "th" ? "ค่าสูงสุดในภาคเหนือ" : "Regional Maximum"}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold tabular-nums text-foreground">
                    {formatDistVal(distributionStats.maxRow.metricValue)}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                    {lang === "th" ? distributionStats.maxRow.name_th : distributionStats.maxRow.name_en}
                  </span>
                </div>
              </div>

              {/* Stacked 3 Zone Proportion Breakdown Bar */}
              <div className="mt-4 rounded-xl border border-border bg-secondary/20 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="font-medium text-foreground">
                    {lang === "th"
                      ? "สัดส่วนการกระจายตัวของ 17 จังหวัดตามเกณฑ์ความเปราะบาง"
                      : "17 Province Breakdown by Risk Zone"}
                  </span>
                  <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-rose-600" />
                      {distMetric === "margin"
                        ? lang === "th"
                          ? `เงินเหลือตึงตัว (<19%) ${distributionStats.zoneHighRisk} จังหวัด`
                          : `Tight (<19%) ${distributionStats.zoneHighRisk}`
                        : distMetric === "debt"
                          ? lang === "th"
                            ? `ภาระหนี้สูง (>=0.65 เท่า) ${distributionStats.zoneHighRisk} จังหวัด`
                            : `High Debt (>=0.65x) ${distributionStats.zoneHighRisk}`
                          : lang === "th"
                            ? `เข้าพักชะลอตัว (<52%) ${distributionStats.zoneHighRisk} จังหวัด`
                            : `Low Occ (<52%) ${distributionStats.zoneHighRisk}`}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-amber-500" />
                      {distMetric === "margin"
                        ? lang === "th"
                          ? `ปานกลาง (19 ถึง 24%) ${distributionStats.zoneModerate} จังหวัด`
                          : `Moderate (19 to 24%) ${distributionStats.zoneModerate}`
                        : distMetric === "debt"
                          ? lang === "th"
                            ? `ปานกลาง (0.45 ถึง 0.65 เท่า) ${distributionStats.zoneModerate} จังหวัด`
                            : `Moderate (0.45 to 0.65x) ${distributionStats.zoneModerate}`
                          : lang === "th"
                            ? `ท่องเที่ยวรอง (52 ถึง 66%) ${distributionStats.zoneModerate} จังหวัด`
                            : `Secondary (52 to 66%) ${distributionStats.zoneModerate}`}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-teal-600" />
                      {distMetric === "margin"
                        ? lang === "th"
                          ? `คล่องตัว (>24%) ${distributionStats.zoneHealthy} จังหวัด`
                          : `Healthy (>24%) ${distributionStats.zoneHealthy}`
                        : distMetric === "debt"
                          ? lang === "th"
                            ? `ภาระหนี้ต่ำ (<0.45 เท่า) ${distributionStats.zoneHealthy} จังหวัด`
                            : `Low Debt (<0.45x) ${distributionStats.zoneHealthy}`
                          : lang === "th"
                            ? `ท่องเที่ยวหลัก (>66%) ${distributionStats.zoneHealthy} จังหวัด`
                            : `Primary (>66%) ${distributionStats.zoneHealthy}`}
                    </span>
                  </div>
                </div>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                  {distributionStats.zoneHighRisk > 0 && (
                    <div
                      className="h-full bg-rose-600 transition-all"
                      style={{ width: `${(distributionStats.zoneHighRisk / distributionStats.total) * 100}%` }}
                    />
                  )}
                  {distributionStats.zoneModerate > 0 && (
                    <div
                      className="h-full bg-amber-500 transition-all"
                      style={{ width: `${(distributionStats.zoneModerate / distributionStats.total) * 100}%` }}
                    />
                  )}
                  {distributionStats.zoneHealthy > 0 && (
                    <div
                      className="h-full bg-teal-600 transition-all"
                      style={{ width: `${(distributionStats.zoneHealthy / distributionStats.total) * 100}%` }}
                    />
                  )}
                </div>
              </div>

              {/* 17 Province Interactive Horizontal Distribution Bars in Compact 3 Column Grid */}
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {lang === "th"
                      ? "คลิกที่แท่งจังหวัดใดก็ได้เพื่อกรองดูข้อมูลแนวโน้มและข่าวของจังหวัดนั้น"
                      : "Click any province bar to filter monthly series and news below"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <span className="inline-block h-3 w-0.5 bg-foreground" />
                    {lang === "th"
                      ? `ขีดตั้งคือค่าเฉลี่ยภาคเหนือ (${formatDistVal(distributionStats.mean)})`
                      : `Vertical tick is regional mean (${formatDistVal(distributionStats.mean)})`}
                  </span>
                </div>

                <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                  {distributionStats.rows.map((r) => {
                    const isSelected = r.province_code === selectedCode
                    const pct = Math.min(100, Math.max(4, (r.metricValue / distributionStats.maxScale) * 100))
                    const meanPct = Math.min(
                      100,
                      Math.max(0, (distributionStats.mean / distributionStats.maxScale) * 100),
                    )
                    const barColor =
                      r.zone === "risk"
                        ? "bg-rose-600"
                        : r.zone === "watch"
                          ? "bg-amber-500"
                          : "bg-teal-600"

                    return (
                      <button
                        key={r.province_code}
                        type="button"
                        onClick={() => onSelectCode(r.province_code)}
                        className={`group flex flex-col gap-1 rounded-xl border px-3 py-2 text-left transition-all ${
                          isSelected
                            ? "border-foreground bg-secondary/80 ring-1 ring-foreground"
                            : "border-border/70 bg-background hover:border-foreground/40 hover:bg-secondary/40"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5 text-xs">
                          <span className="flex min-w-0 items-center gap-1">
                            <span className="w-4 text-[10px] font-semibold tabular-nums text-muted-foreground">
                              {r.distRank}.
                            </span>
                            <span className="truncate font-semibold text-foreground">
                              {lang === "th" ? r.name_th : r.name_en}
                            </span>
                            {isSelected && (
                              <span className="rounded-full bg-foreground px-1.5 py-0.2 text-[9px] font-semibold text-background">
                                {lang === "th" ? "เลือกอยู่" : "Active"}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground">
                            {formatDistVal(r.metricValue)}
                            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                              ({r.diffFromMean >= 0 ? "+" : ""}
                              {distMetric === "debt"
                                ? r.diffFromMean.toFixed(2)
                                : `${r.diffFromMean.toFixed(1)}%`})
                            </span>
                          </span>
                        </div>

                        <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
                          <div
                            className={`h-full rounded-full transition-all ${barColor}`}
                            style={{ width: `${pct}%` }}
                          />
                          <div
                            aria-hidden="true"
                            className="absolute top-0 h-full w-0.5 bg-foreground/85"
                            style={{ left: `${meanPct}%` }}
                          />
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
                  {lang === "th"
                    ? `การจัดกลุ่มความเปราะบางปัจจุบัน · คะแนนความชัดเจน ${monitor?.silhouette_score != null ? monitor.silhouette_score.toFixed(4) : "—"}`
                    : `${monitor?.model_used || "KMeans"} · Silhouette ${monitor?.silhouette_score != null ? monitor.silhouette_score.toFixed(4) : "—"}`}
                </p>
                <h2 className="mt-1 font-display text-lg font-semibold">
                  {lang === "th" ? "แผนภาพการกระจายตัว 4 กลุ่มจังหวัดตามการพึ่งพาท่องเที่ยวและแรงกดดันภายนอก" : "4 Group Regional Risk Positioning"}
                </h2>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[10px] text-muted-foreground">
                <ClusterLegend
                  color="bg-teal-700"
                  label={lang === "th" ? "กลุ่มที่ 1 เมืองท่องเที่ยวหลัก (พึ่งพิงฤดูกาล)" : "Group 1 Primary Tourism Hub"}
                />
                <ClusterLegend
                  color="bg-amber-600"
                  label={lang === "th" ? "กลุ่มที่ 2 ภาระหนี้สูงและเผชิญฝุ่นสะสม" : "Group 2 High Debt & Haze"}
                />
                <ClusterLegend
                  color="bg-slate-700"
                  label={lang === "th" ? "กลุ่มที่ 3 เมืองท่องเที่ยวรอง (การเงินปานกลาง)" : "Group 3 Secondary Tourism"}
                />
                <ClusterLegend
                  color="bg-slate-400"
                  label={lang === "th" ? "กลุ่มที่ 4 ลุ่มน้ำภาคเหนือตอนล่าง (เงินสดตึงตัว)" : "Group 4 Lower Basin Tight Margin"}
                />
              </div>
            </div>
            <RegionalRiskGrouping
              provinces={provinces}
              selectedCode={selectedCode}
              onSelectProvince={onSelectCode}
              lang={lang}
            />
          </section>

          <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-semibold">
                  {selected
                    ? lang === "th"
                      ? `แนวโน้มรายเดือนจริง: จังหวัด${selected.name_th} (อัตราเข้าพัก เทียบกับ ฝุ่นและแรงกดดันวิกฤต)`
                      : `Live Monthly Series: ${selected.name_en}`
                    : "Provincial Monthly Series"}
                </h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {lang === "th"
                    ? "ข้อมูลรายเดือนจากกระทรวงการท่องเที่ยวและกีฬา ร่วมกับข้อมูลสภาพอากาศและดัชนีแรงกดดัน"
                    : "Official MOTS monthly occupancy paired with weather and shock indices"}
                </p>
              </div>
              <span className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground">
                {months} {lang === "th" ? "เดือน" : "months"}
              </span>
            </div>
            {detail ? (
              <ProvinceHistoryChart series={detail.monthly_series} months={months} lang={lang} />
            ) : (
              <div className="flex h-[240px] items-center justify-center text-xs text-muted-foreground">…</div>
            )}
          </section>

          <section className="flex flex-1 flex-col justify-between rounded-2xl border border-border bg-card p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold">
                  {lang === "th" ? "ข่าวเศรษฐกิจและเหตุการณ์ล่าสุดของจังหวัด" : "Verified Regional News"}
                </h2>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {selected
                    ? lang === "th"
                      ? `จังหวัด${selected.name_th} · คัดกรองเฉพาะข่าวที่มีข้อความอ้างอิงตรงต้นฉบับ`
                      : `${selected.name_en} · Filtered for verbatim source quotes`
                    : ""}
                </p>
              </div>
              <ShieldCheck aria-hidden="true" className="size-4 text-muted-foreground" />
            </div>

            {!detail ? (
              <p className="mt-4 text-xs text-muted-foreground">
                {lang === "th" ? "กำลังดึงข่าวล่าสุดของจังหวัดนี้…" : "Loading verified provincial news…"}
              </p>
            ) : detail.verified_news.length ? (
              <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
                {detail.verified_news.slice(0, 4).map((n, idx) => (
                  <li key={idx}>
                    <a
                      href={n.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-full items-start justify-between gap-3 rounded-xl border border-border px-3.5 py-3 transition-colors hover:bg-secondary"
                    >
                      <span className="min-w-0">
                        <span className="block text-[10px] text-muted-foreground">
                          {n.event_date} · {translateShockType(n.shock_type, lang)} ·{" "}
                          {lang === "th" ? `ความรุนแรง ${n.severity_score}/5` : `Sev ${n.severity_score}/5`}
                        </span>
                        <span className="mt-1 block line-clamp-2 text-xs font-medium text-foreground">
                          {n.evidence_quote || n.title}
                        </span>
                      </span>
                      <ExternalLink aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">
                {lang === "th"
                  ? "ไม่พบข่าวเหตุการณ์ในจังหวัดนี้ในช่วงเวลาล่าสุด (สามารถกดดึงข้อมูลล่าสุดเพื่ออัปเดตข่าวใหม่ได้)"
                  : "No recent verified events for this province (click Sync Live Data to refresh)."}
              </p>
            )}
          </section>
        </div>
      </div>
    </>
  )
}

function RiskModelingAndClusteringPage({
  token,
  monitor,
  onPublished,
  onMonteCarloMeasured,
  onClusterMeasured,
}: {
  token: string
  monitor: PolicyMonitorResponse | null
  onPublished: () => void
  onMonteCarloMeasured: (ms: number) => void
  onClusterMeasured: (ms: number) => void
}) {
  const { lang } = useAppState()

  // Empirical Monte Carlo state
  const [horizonMonths, setHorizonMonths] = useState(3)
  const [costShockPct, setCostShockPct] = useState(5)
  const [nSimulations, setNSimulations] = useState(3000)
  const [includeNewsRegime, setIncludeNewsRegime] = useState(true)
  const [mcData, setMcData] = useState<StaffMonteCarloResponse | null>(null)
  const [mcLoading, setMcLoading] = useState(false)

  // Interactive KMeans Clustering state
  const [kVal, setKVal] = useState(4)
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([
    "expense_to_income_pct_sme",
    "debt_to_annual_income_sme",
    "avg_occupancy_rate",
    "occupancy_volatility",
    "annual_pm25_days_over_37_5",
    "max_monthly_rainfall_mm",
    "recent_news_shock_score",
  ])
  const [clusterData, setClusterData] = useState<StaffReclusterResponse | null>(null)
  const [clusterLoading, setClusterLoading] = useState(false)
  const [publishNote, setPublishNote] = useState<string | null>(null)

  const timeSeriesScreening = (monitor?.feature_screening ?? []).filter(
    (r) => r.is_selected && r.spearman_r != null && r.p_value != null,
  )
  const actualHistoryMonths = mcData?.history_months_used ?? monitor?.panel_months ?? 0

  async function executeMonteCarlo(
    h = horizonMonths,
    c = costShockPct,
    news = includeNewsRegime,
    nDraws = nSimulations,
  ) {
    setMcLoading(true)
    try {
      const res = await runStaffMonteCarlo(token, {
        horizon_months: h,
        cost_shock_pct: c,
        include_news_regime: news,
        n_simulations: nDraws,
      })
      setMcData(res)
      if (typeof res.compute_ms === "number") {
        onMonteCarloMeasured(Math.round(res.compute_ms))
      }
    } catch {
      // Ignore transient error
    } finally {
      setMcLoading(false)
    }
  }

  async function executeRecluster(kInput = kVal, feats = selectedFeatures, persist = false) {
    setClusterLoading(true)
    setPublishNote(null)
    try {
      const res = await runStaffRecluster(token, {
        k: kInput,
        feature_keys: feats,
        persist,
      })
      setClusterData(res)
      if (typeof res.compute_ms === "number") {
        onClusterMeasured(Math.round(res.compute_ms))
      }
      if (persist) {
        setPublishNote(
          lang === "th"
            ? "บันทึกผลการจัดกลุ่มใหม่ลงฐานข้อมูลหลักเรียบร้อยแล้ว"
            : "Saved new clustering assignments to primary database.",
        )
        onPublished()
      }
    } catch {
      // Ignore transient error
    } finally {
      setClusterLoading(false)
    }
  }

  useEffect(() => {
    void executeMonteCarlo(3, 5, true, 3000)
    void executeRecluster(4, selectedFeatures, false)
  }, [token])

  useEffect(() => {
    if (!publishNote) return
    const timer = setTimeout(() => {
      setPublishNote(null)
    }, 4000)
    return () => clearTimeout(timer)
  }, [publishNote])

  function toggleFeature(key: string) {
    setSelectedFeatures((curr) => {
      if (curr.includes(key)) {
        if (curr.length <= 3) return curr
        return curr.filter((x) => x !== key)
      }
      return [...curr, key]
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          {lang === "th"
            ? "แบบจำลองความเสี่ยงเชิงความน่าจะเป็นและการจัดกลุ่มความเปราะบางแบบปรับเปลี่ยนได้"
            : "Probabilistic Monte Carlo Risk & Dynamic Clustering Lab"}
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {lang === "th"
            ? "จำลองความเสี่ยงกระแสเงินสดและจัดกลุ่มมาตรการรายจังหวัด"
            : "Cashflow Risk Simulation & Dynamic Clustering Lab"}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          {lang === "th"
            ? `ดึงข้อมูลความผันผวนจริงจากฐานข้อมูล${actualHistoryMonths > 0 ? ` (${actualHistoryMonths} เดือน)` : ""} ร่วมกับข่าววิกฤตล่าสุดเพื่อสุ่มจำลองสถานการณ์ความเสี่ยงตามจำนวนรอบที่เจ้าหน้าที่กำหนดเอง และปรับตัวแปรจัดกลุ่มจังหวัดได้ทันที`
            : `Uses real provincial history${actualHistoryMonths > 0 ? ` (${actualHistoryMonths} months)` : ""} paired with live verified crisis news for configurable Monte Carlo stress testing and KMeans clustering.`}
        </p>
      </div>

      {/* Section 1 Empirical Monte Carlo 3000 Draws */}
      <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-[11px] font-medium text-foreground">
              <Sparkles aria-hidden="true" className="size-3.5" />
              {lang === "th"
                ? `โมเดลที่ 1 · การจำลองมอนติคาร์โลจากข้อมูลจริง (${nSimulations.toLocaleString()} รอบ${mcData?.compute_ms != null ? ` · ประมวลผล ${mcData.compute_ms} มิลลิวินาที` : ""})`
                : `Model 1 · Empirical Bootstrap Monte Carlo (${nSimulations.toLocaleString()} draws${mcData?.compute_ms != null ? ` · ${mcData.compute_ms} ms` : ""})`}
            </span>
            <h2 className="mt-2 font-display text-xl font-semibold text-foreground">
              {lang === "th"
                ? "ประเมินโอกาสที่ธุรกิจในแต่ละจังหวัดจะขาดสภาพคล่องและมูลค่าความเสียหายสูงสุด"
                : "Regional Revenue Value at Risk & Provincial Cashflow Deficit Probability"}
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {lang === "th"
                ? `สุ่มซ้ำจากประวัติรายได้จริงในฐานข้อมูล${actualHistoryMonths > 0 ? ` (${actualHistoryMonths} เดือน${mcData?.data_range_start && mcData?.data_range_end ? ` · ${formatThaiMonth(mcData.data_range_start, lang)} ถึง ${formatThaiMonth(mcData.data_range_end, lang)}` : ""})` : ""} ร่วมกับสัดส่วนรายจ่ายผู้ประกอบการ เจ้าหน้าที่ปรับจำนวนรอบจำลองได้เอง (ยิ่งสุ่มมากความคลาดเคลื่อนเชิงสถิติยิ่งลดลง)`
                : `Resamples real database revenue history${actualHistoryMonths > 0 ? ` (${actualHistoryMonths} months)` : ""} paired with NSO expense ratios. Draw count is configurable (higher draws reduce quantile standard error).`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">{lang === "th" ? "จำนวนรอบ:" : "Draws:"}</span>
              {[1000, 3000, 5000].map((draws) => (
                <button
                  key={draws}
                  type="button"
                  onClick={() => {
                    setNSimulations(draws)
                    void executeMonteCarlo(horizonMonths, costShockPct, includeNewsRegime, draws)
                  }}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    nSimulations === draws ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {draws.toLocaleString()}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">{lang === "th" ? "ระยะเวลา:" : "Horizon:"}</span>
              {[1, 3, 6].map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => {
                    setHorizonMonths(h)
                    void executeMonteCarlo(h, costShockPct, includeNewsRegime, nSimulations)
                  }}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    horizonMonths === h ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {h} {lang === "th" ? "เดือน" : "mo"}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">{lang === "th" ? "ต้นทุนพุ่ง:" : "Cost surge:"}</span>
              {[0, 5, 10, 15].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setCostShockPct(c)
                    void executeMonteCarlo(horizonMonths, c, includeNewsRegime, nSimulations)
                  }}
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    costShockPct === c ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  +{c}%
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                const next = !includeNewsRegime
                setIncludeNewsRegime(next)
                void executeMonteCarlo(horizonMonths, costShockPct, next, nSimulations)
              }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                includeNewsRegime
                  ? "border-amber-600/40 bg-amber-500/15 text-amber-900"
                  : "border-border bg-background text-muted-foreground"
              }`}
            >
              <AlertTriangle aria-hidden="true" className="size-3.5" />
              {lang === "th"
                ? includeNewsRegime
                  ? "เปิดรวมผลกระทบข่าววิกฤตล่าสุดแล้ว"
                  : "ปิดผลกระทบข่าววิกฤตล่าสุด"
                : includeNewsRegime
                  ? "News Crisis Regime ON"
                  : "News Crisis Regime OFF"}
            </button>
          </div>
        </div>

        {mcLoading && !mcData ? (
          <div className="flex h-52 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            <span>
              {lang === "th"
                ? `กำลังสุ่มจำลองมอนติคาร์โล ${nSimulations.toLocaleString()} รอบ…`
                : `Running ${nSimulations.toLocaleString()} Monte Carlo draws…`}
            </span>
          </div>
        ) : mcData ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-border bg-secondary/35 p-4">
                <p className="text-[11px] text-muted-foreground">
                  {lang === "th" ? "ความสูญเสียรายได้เฉลี่ยต่อเดือน" : "Expected Monthly Revenue Loss"}
                </p>
                <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">
                  {mcData.regional_metrics.expected_monthly_loss_mthb.toLocaleString()}{" "}
                  {lang === "th" ? "ล้านบาท" : "M THB"}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {lang === "th"
                    ? `ค่ากลาง ${mcData.regional_metrics.median_monthly_loss_mthb.toLocaleString()} ล้านบาท/เดือน`
                    : `Median ${mcData.regional_metrics.median_monthly_loss_mthb.toLocaleString()} M THB`}
                </p>
              </div>

              <div className="rounded-2xl border border-amber-600/30 bg-amber-500/5 p-4">
                <p className="text-[11px] text-amber-900">
                  {lang === "th"
                    ? "ความเสียหายสูงสุดที่ความเชื่อมั่นร้อยละ 95"
                    : "95% Value at Risk (VaR 95%)"}
                </p>
                <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-amber-900">
                  {mcData.regional_metrics.var95_monthly_loss_mthb.toLocaleString()}{" "}
                  {lang === "th" ? "ล้านบาท" : "M THB"}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {lang === "th"
                    ? "ในกรณีเลวร้าย 5% ท้ายสุด รายได้ทั้งภาคจะหายไปอย่างน้อยเท่านี้"
                    : "Worst 5% threshold of monthly regional tourism revenue loss"}
                </p>
              </div>

              <div className="rounded-2xl border border-red-600/30 bg-red-500/5 p-4">
                <p className="text-[11px] text-red-900">
                  {lang === "th"
                    ? "ความสูญเสียเฉลี่ยในกลุ่มวิกฤตรุนแรง 5% ท้ายสุด"
                    : "95% Expected Shortfall (CVaR 95%)"}
                </p>
                <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-red-800">
                  {mcData.regional_metrics.cvar95_monthly_loss_mthb.toLocaleString()}{" "}
                  {lang === "th" ? "ล้านบาท" : "M THB"}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {lang === "th"
                    ? "ค่าเฉลี่ยความเสียหายเมื่อเกิดวิกฤตซ้อนทับรุนแรง"
                    : "Average monthly loss inside the worst 5% tail scenarios"}
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-secondary/35 p-4">
                <p className="text-[11px] text-muted-foreground">
                  {lang === "th"
                    ? "จังหวัดที่ผู้ประกอบการเสี่ยงขาดสภาพคล่อง (กรณีเลวร้าย)"
                    : "Provinces in Cashflow Deficit (95th Pct)"}
                </p>
                <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">
                  {mcData.regional_metrics.p95_breaching_provinces} / 17{" "}
                  {lang === "th" ? "จังหวัด" : "provinces"}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {lang === "th"
                    ? `จังหวัดที่รายจ่ายรวมสูงกว่ารายได้จากการสุ่ม ${mcData.n_simulations.toLocaleString()} รอบ`
                    : `Provinces where expenses exceed revenue across ${mcData.n_simulations.toLocaleString()} draws`}
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[5fr_7fr]">
              {/* Left Loss Distribution Histogram */}
              <div className="rounded-2xl border border-border bg-background p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold text-foreground">
                    {lang === "th"
                      ? "กราฟการแจกแจงโอกาสเกิดความสูญเสียรายได้ทั้งภาคเหนือ (ล้านบาท/เดือน)"
                      : "Regional Monthly Revenue Loss Distribution (M THB)"}
                  </p>
                </div>
                <p className="mb-3 text-[11px] text-muted-foreground">
                  {lang === "th"
                    ? "แท่งสีแดงคือกลุ่มสถานการณ์เลวร้ายร้อยละ 5 ท้ายสุด ที่ควรเตรียมวงเงินมาตรการรองรับ"
                    : "Crimson bars indicate the worst 5% tail risk exceeding VaR 95%."}
                </p>
                <div className="h-[230px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={mcData.loss_distribution} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="bin_mid_mthb" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} unit="%" />
                      <Tooltip
                        formatter={(val: number) => [
                          `${val}% ${lang === "th" ? "ของรอบจำลองทั้งหมด" : "of draws"}`,
                          lang === "th" ? "ความถี่" : "Frequency",
                        ]}
                        labelFormatter={(lbl) =>
                          lang === "th" ? `ความสูญเสียประมาณ ${lbl} ล้านบาท/เดือน` : `Loss ~${lbl} M THB/mo`
                        }
                        contentStyle={{
                          backgroundColor: "hsl(var(--background))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "0.75rem",
                          fontSize: "11px",
                        }}
                      />
                      <Bar dataKey="frequency_pct" radius={[4, 4, 0, 0]}>
                        {mcData.loss_distribution.map((entry, idx) => (
                          <Cell key={idx} fill={entry.is_tail_risk ? "#b91c1c" : "#334155"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Right Provincial Cashflow Deficit Probability Ranking */}
              <div className="rounded-2xl border border-border bg-background p-4">
                <p className="text-xs font-semibold text-foreground">
                  {lang === "th"
                    ? `จัดอันดับจังหวัดตามโอกาสที่ผู้ประกอบการจะขาดสภาพคล่อง (จากการจำลอง ${mcData.n_simulations.toLocaleString()} รอบ)`
                    : `Provincial Cashflow Deficit Probability Ranking (${mcData.n_simulations.toLocaleString()} Draws)`}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {lang === "th"
                    ? "ช่วยผู้บริหารตัดสินใจว่าควรส่งมาตรการปรับโครงสร้างหนี้และพักชำระเงินต้นลงจังหวัดใดเป็นลำดับแรก"
                    : "Identifies priority provinces requiring immediate liquidity and debt restructuring deployment."}
                </p>
                <div className="mt-3 max-h-[245px] overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-secondary/80 text-[10px] text-muted-foreground backdrop-blur-sm">
                      <tr className="border-b border-border">
                        <th className="px-2.5 py-2 font-medium">{lang === "th" ? "จังหวัด" : "Province"}</th>
                        <th className="px-2 py-2 text-right font-medium">
                          {lang === "th" ? "เงินเหลือฐานเดิม" : "Base Margin"}
                        </th>
                        <th className="px-2 py-2 text-right font-medium">
                          {lang === "th" ? "โอกาสเงินสดติดลบ" : "Deficit Prob."}
                        </th>
                        <th className="px-2 py-2 text-right font-medium">
                          {lang === "th" ? "กรณีเลวร้าย (5% ท้าย)" : "Worst 5% Margin"}
                        </th>
                        <th className="px-2.5 py-2 text-right font-medium">
                          {lang === "th" ? "รายได้เสี่ยงหายสูงสุด" : "VaR 95% Loss"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {mcData.provinces.map((p) => (
                        <tr key={p.province_code} className="border-b border-border/50 last:border-0">
                          <td className="px-2.5 py-2 font-medium text-foreground">
                            <span>{lang === "th" ? p.name_th : p.name_en}</span>
                            {p.has_active_water_alert && (
                              <span className="ml-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-medium text-amber-900">
                                {lang === "th" ? "ข่าวมลพิษน้ำ" : "Water Alert"}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                            {p.baseline_margin_pct.toFixed(1)}%
                          </td>
                          <td className="px-2 py-2 text-right font-semibold tabular-nums">
                            <span
                              className={
                                p.deficit_probability_pct >= 50
                                  ? "text-red-700"
                                  : p.deficit_probability_pct >= 20
                                    ? "text-amber-700"
                                    : "text-teal-700"
                              }
                            >
                              {p.deficit_probability_pct.toFixed(1)}%
                            </span>
                          </td>
                          <td
                            className={`px-2 py-2 text-right tabular-nums ${
                              p.p95_worst_margin_pct < 0 ? "font-semibold text-red-700" : "text-muted-foreground"
                            }`}
                          >
                            {p.p95_worst_margin_pct >= 0 ? "+" : ""}
                            {p.p95_worst_margin_pct.toFixed(1)}%
                          </td>
                          <td className="px-2.5 py-2 text-right tabular-nums text-foreground">
                            {p.var95_revenue_loss_mthb.toLocaleString()} {lang === "th" ? "ล้าน" : "M"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </section>

      {/* Section 2 Interactive KMeans Vulnerability Clustering & Live VIF Feature Selection Lab */}
      <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-[11px] font-medium text-foreground">
              <Layers aria-hidden="true" className="size-3.5" />
              {lang === "th"
                ? "โมเดลที่ 2 · ระบบจัดกลุ่มความเปราะบางและคัดเลือกตัวแปรสด"
                : "Model 2 · Interactive KMeans Clustering & Live VIF"}
            </span>
            <h2 className="mt-2 font-display text-xl font-semibold text-foreground">
              {lang === "th"
                ? "ปรับจำนวนกลุ่มและเลือกตัวแปรเพื่อจัดชุดมาตรการช่วยเหลือให้ตรงเป้าแต่ละพื้นที่"
                : "Customize Policy Tiers, Test Feature Collinearity & Generate Targeted Playbooks"}
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {lang === "th"
                ? "เจ้าหน้าที่สามารถติ๊กเลือกตัวแปรที่ต้องการนำมาจัดกลุ่ม (รวมถึงตัวแปรความรุนแรงของข่าววิกฤตล่าสุด) ระบบจะคำนวณค่าความซ้ำซ้อนของตัวแปรให้อัตโนมัติและแนะนำชุดมาตรการเฉพาะแต่ละกลุ่ม"
                : "Select at least 3 variables to re run KMeans live with automatic Variance Inflation Factor (VIF) screening."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">{lang === "th" ? "จำนวนกลุ่ม:" : "Groups:"}</span>
              {[3, 4, 5].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => {
                    setKVal(num)
                    void executeRecluster(num, selectedFeatures, false)
                  }}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    kVal === num ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {num} {lang === "th" ? "กลุ่ม" : "tiers"}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={clusterLoading}
              onClick={() => void executeRecluster(kVal, selectedFeatures, false)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-4 text-xs font-medium text-foreground hover:bg-secondary disabled:opacity-60"
            >
              <Play aria-hidden="true" className="size-3.5" />
              {lang === "th" ? "คำนวณการจัดกลุ่มใหม่" : "Run Clustering"}
            </button>

            <button
              type="button"
              disabled={clusterLoading}
              onClick={() => void executeRecluster(kVal, selectedFeatures, true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-foreground px-4 text-xs font-medium text-background hover:opacity-85 disabled:opacity-60"
            >
              <Save aria-hidden="true" className="size-3.5" />
              {lang === "th" ? "บันทึกไปใช้เป็นกลุ่มหลักของระบบ" : "Publish to Primary Map"}
            </button>
          </div>
        </div>

        {publishNote && (
          <div className="mt-3 rounded-xl border border-emerald-700/25 bg-emerald-700/10 px-4 py-2 text-xs font-medium text-emerald-900">
            {publishNote}
          </div>
        )}

        {clusterData && (
          <>
            {/* Feature Checkboxes with Live VIF Badges */}
            <div className="mt-4 rounded-2xl border border-border bg-secondary/30 p-4">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">
                  {lang === "th"
                    ? "ติ๊กเลือกตัวแปรที่ใช้ในการจัดกลุ่ม (อย่างน้อย 3 ตัวแปร · ระบบตรวจค่าความซ้ำซ้อนไม่ให้เกิน 5.0 อัตโนมัติ):"
                    : "Select clustering variables (minimum 3 · live VIF multicollinearity check < 5.0):"}
                </p>
                <div className="flex items-center gap-3 text-xs">
                  <span className="rounded-full bg-background px-3 py-1 font-medium text-foreground">
                    {lang === "th"
                      ? `คะแนนความชัดเจนในการแยกกลุ่ม ${clusterData.silhouette_score.toFixed(4)}`
                      : `Silhouette ${clusterData.silhouette_score.toFixed(4)}`}
                  </span>
                  <span className="rounded-full bg-background px-3 py-1 text-muted-foreground">
                    {lang === "th"
                      ? `ดัชนีระยะห่างระหว่างกลุ่ม ${clusterData.davies_bouldin_index.toFixed(4)}`
                      : `DBI ${clusterData.davies_bouldin_index.toFixed(4)}`}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {clusterData.available_catalog.map((cat) => {
                  const isChecked = selectedFeatures.includes(cat.feature_key)
                  const vifObj = clusterData.selected_features.find((f) => f.feature_key === cat.feature_key)
                  return (
                    <button
                      key={cat.feature_key}
                      type="button"
                      aria-pressed={isChecked}
                      onClick={() => toggleFeature(cat.feature_key)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                        isChecked
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-background text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span>{lang === "th" ? cat.label_th : cat.label_en}</span>
                      {vifObj && (
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                            vifObj.is_collinear
                              ? "bg-amber-400 text-black"
                              : isChecked
                                ? "bg-background/20 text-background"
                                : "bg-secondary text-foreground"
                          }`}
                        >
                          {lang === "th" ? `ความซ้ำซ้อน ${vifObj.vif_score}` : `VIF ${vifObj.vif_score}`}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Resulting Cluster Cards & Targeted Policy Prescriptions */}
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {clusterData.groups.map((grp) => (
                <div key={grp.cluster_id} className="flex flex-col justify-between rounded-2xl border border-border bg-background p-4">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          style={{ backgroundColor: grp.color }}
                          className="size-3 shrink-0 rounded-full"
                          aria-hidden="true"
                        />
                        <h3 className="font-display text-sm font-semibold text-foreground sm:text-base">
                          {lang === "th" ? grp.title_th : grp.title_en}
                        </h3>
                      </div>
                      <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-semibold text-foreground">
                        {grp.province_count} {lang === "th" ? "จังหวัด" : "provinces"}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-secondary/40 p-2.5 text-center text-[11px]">
                      <div>
                        <p className="text-[10px] text-muted-foreground">{lang === "th" ? "เงินเหลือเฉลี่ย" : "Avg Margin"}</p>
                        <p className="font-semibold text-foreground">{grp.avg_cash_margin_pct}%</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">{lang === "th" ? "หนี้ต่อรายได้ปี" : "Debt Ratio"}</p>
                        <p className="font-semibold text-foreground">
                          {grp.avg_sme_debt_ratio} {lang === "th" ? "เท่า" : "x"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">{lang === "th" ? "อัตราเข้าพัก" : "Avg Occupancy"}</p>
                        <p className="font-semibold text-foreground">{grp.avg_occupancy_pct}%</p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {grp.provinces.map((p) => (
                        <span
                          key={p.province_code}
                          className="rounded-full border border-border bg-secondary/30 px-2.5 py-0.5 text-xs font-medium text-foreground"
                        >
                          {lang === "th" ? p.name_th : p.name_en}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-3.5 rounded-xl border border-border/80 bg-secondary/25 p-3 text-xs leading-5">
                    <span className="font-semibold text-foreground">
                      {lang === "th" ? "มาตรการที่ควรมุ่งเป้าสำหรับกลุ่มนี้: " : "Targeted Policy Prescription: "}
                    </span>
                    <span className="text-muted-foreground">
                      {lang === "th" ? grp.recommended_policy_th : grp.recommended_policy_en}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Section 3 Automatic Statistical Feature Screening Table */}
      {timeSeriesScreening.length > 0 && (
        <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
          <div>
            <h2 className="font-display text-lg font-semibold">
              {lang === "th"
                ? "ตารางผลการคัดเลือกตัวแปรทางสถิติอัตโนมัติ (อัปเดตตามข้อมูลใหม่ในระบบ)"
                : "Automated Empirical Feature Screening Table"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {lang === "th"
                ? "คัดเฉพาะตัวแปรที่ส่งผลต่อภาคบริการอย่างมีนัยสำคัญทางสถิติ (ค่านัยสำคัญต่ำกว่า 0.05) และไม่ซ้ำซ้อนกันเอง (ค่าความซ้ำซ้อนต่ำกว่า 5.0)"
                : "Screened via within province lag correlation (p < 0.05) and low multicollinearity (VIF < 5.0)."}
            </p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">{lang === "th" ? "ตัวแปรปัจจัย" : "Driver Indicator"}</th>
                  <th className="py-2 pr-3 font-medium">{lang === "th" ? "ตัวชี้วัดเป้าหมาย" : "Target Metric"}</th>
                  <th className="py-2 pr-3 font-medium">{lang === "th" ? "ระยะเวลาส่งผล" : "Lag"}</th>
                  <th className="py-2 pr-3 font-medium">{lang === "th" ? "ค่าความสัมพันธ์" : "Spearman r"}</th>
                  <th className="py-2 pr-3 font-medium">{lang === "th" ? "ค่านัยสำคัญทางสถิติ" : "p value"}</th>
                  <th className="py-2 font-medium">{lang === "th" ? "ค่าความซ้ำซ้อน" : "VIF"}</th>
                </tr>
              </thead>
              <tbody>
                {timeSeriesScreening.slice(0, 8).map((r, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-foreground">
                      {translateFeatureName(r.feature_name, lang)}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">
                      {translateTargetName(r.target_name, lang)}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">
                      {lang === "th" ? `${r.best_lag_months ?? 0} เดือน` : `${r.best_lag_months ?? 0}M`}
                    </td>
                    <td className="py-2.5 pr-3 font-medium tabular-nums text-foreground">
                      {r.spearman_r != null ? `${r.spearman_r >= 0 ? "+" : ""}${r.spearman_r.toFixed(3)}` : "—"}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-muted-foreground">
                      {r.p_value != null
                        ? r.p_value < 0.001
                          ? "< 0.001"
                          : r.p_value.toFixed(4)
                        : "—"}
                    </td>
                    <td className="py-2.5 tabular-nums text-muted-foreground">
                      {r.vif_score != null ? r.vif_score.toFixed(2) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function DataHealthView({
  health,
  cachedFetchMs,
  freshDbFetchMs,
  mcComputeMs,
  clusterComputeMs,
  testingSpeed,
  onRunBenchmark,
}: {
  health: DataHealthResponse | null
  cachedFetchMs: number | null
  freshDbFetchMs: number | null
  mcComputeMs: number | null
  clusterComputeMs: number | null
  testingSpeed: boolean
  onRunBenchmark: () => void
}) {
  const { lang } = useAppState()
  const c = health?.layer_counts
  const evalRun = health?.latest_eval_runs.find((r) => r.run_type === "full_7d_evaluation")
  const eval7d = evalRun?.metrics_json
  const evalRanDate = evalRun?.ran_at ? String(evalRun.ran_at).slice(0, 16).replace("T", " ") : null

  const ragMedianMs =
    typeof eval7d?.dim2_rag_qa?.median_latency_ms === "number" ? eval7d.dim2_rag_qa.median_latency_ms : null
  const ragTrapMs =
    typeof eval7d?.dim2_rag_qa?.mean_trap_latency_ms === "number" ? eval7d.dim2_rag_qa.mean_trap_latency_ms : null

  function latencyTone(ms: number | null): string {
    if (ms === null) return "text-muted-foreground"
    if (ms <= 300) return "text-emerald-700"
    if (ms <= 1500) return "text-amber-700"
    return "text-red-700"
  }

  function latencyStatusNote(ms: number | null): string {
    if (ms === null) return lang === "th" ? "ยังไม่ได้วัดค่าในรอบนี้" : "Not measured in this session yet"
    if (ms <= 300) return lang === "th" ? "ตอบสนองเร็ว (ต่ำกว่า 300 มิลลิวินาที)" : "Fast response (< 300 ms)"
    if (ms <= 1500) return lang === "th" ? "ปานกลาง (เชื่อมฐานข้อมูลคลาวด์)" : "Moderate (cloud DB round trip)"
    return lang === "th" ? "ช้า (เกิน 1.5 วินาที · ควรตรวจสอบการเชื่อมต่อ)" : "Slow (> 1.5 s · check DB connection)"
  }

  const summaryCards = [
    {
      label: lang === "th" ? "ข้อมูลดิบจากแหล่งต้นทางทั้งหมด" : "Raw Source Records (Bronze)",
      value: c ? (c.bronze_air4thai + c.bronze_news + c.bronze_stats + c.bronze_pdf_pages).toLocaleString() : "—",
      icon: Database,
    },
    {
      label: lang === "th" ? "ย่อหน้าเอกสารและข่าวที่ผ่านการตรวจสอบ" : "Clean Chunks & Events (Silver)",
      value: c ? `${c.silver_policy_chunks} / ${c.silver_news_events}` : "—",
      icon: Check,
    },
    {
      label: lang === "th" ? "ข้อมูลผิดปกติที่ระบบคัดแยกไว้ตรวจสอบ" : "Quarantined Anomalies",
      value: c ? c.silver_quarantine.toLocaleString() : "—",
      icon: CircleHelp,
    },
    {
      label: lang === "th" ? "ขนาดคลังเอกสารและจำนวนแถวตารางวิเคราะห์" : "Vector Storage / Gold Panel",
      value: c
        ? `${c.rag_storage_mb} ${lang === "th" ? "เมกะไบต์" : "MB"} · ${c.gold_monthly_panel}${c.panel_months ? ` (${c.panel_months} ${lang === "th" ? "เดือน" : "mo"})` : ""}`
        : "—",
      icon: Building2,
    },
  ]

  const speedCards = [
    {
      label: lang === "th" ? "ความเร็วการโหลดจากแคชหน่วยความจำ" : "Cached Fast Read Speed",
      value:
        cachedFetchMs !== null
          ? lang === "th"
            ? `${cachedFetchMs.toLocaleString()} มิลลิวินาที`
            : `${cachedFetchMs.toLocaleString()} ms`
          : lang === "th"
            ? "กดทดสอบเพื่อวัดจริง"
            : "Click test to measure",
      tone: latencyTone(cachedFetchMs),
      detail:
        cachedFetchMs !== null
          ? latencyStatusNote(cachedFetchMs)
          : lang === "th"
            ? "ระบบเก็บแคช 120 วินาทีและล้างทันทีเมื่อดึงข้อมูลสดหรือบันทึกผลใหม่"
            : "120s in memory read cache invalidated automatically on writes",
      icon: Zap,
    },
    {
      label: lang === "th" ? "ความเร็วดึงสดจากฐานข้อมูลหลัก (ไม่ใช้แคช)" : "Live Uncached Database Query Speed",
      value:
        freshDbFetchMs !== null
          ? lang === "th"
            ? `${freshDbFetchMs.toLocaleString()} มิลลิวินาที`
            : `${freshDbFetchMs.toLocaleString()} ms`
          : lang === "th"
            ? "ยังไม่ได้วัดค่า"
            : "Not measured yet",
      tone: latencyTone(freshDbFetchMs),
      detail:
        freshDbFetchMs !== null
          ? `${latencyStatusNote(freshDbFetchMs)}${health?.server_query_ms != null ? (lang === "th" ? ` · ฝั่งเซิร์ฟเวอร์ ${health.server_query_ms} มิลลิวินาที` : ` · server ${health.server_query_ms} ms`) : ""}`
          : lang === "th"
            ? "วัดเวลาจริงตั้งแต่ส่งคำขอไปฐานข้อมูลจนแสดงผลเสร็จ"
            : "End to end uncached query round trip to Neon PostgreSQL",
      icon: Database,
    },
    {
      label: lang === "th" ? "ความเร็วประมวลผลแบบจำลอง (มอนติคาร์โล / จัดกลุ่ม)" : "Live Model Compute (Monte Carlo / Clustering)",
      value:
        mcComputeMs !== null || clusterComputeMs !== null
          ? `${mcComputeMs !== null ? `${mcComputeMs}` : "—"} / ${clusterComputeMs !== null ? `${clusterComputeMs}` : "—"} ${lang === "th" ? "มิลลิวินาที" : "ms"}`
          : lang === "th"
            ? "ยังไม่เคยรันในรอบนี้"
            : "Not run in this session",
      tone: latencyTone(mcComputeMs ?? clusterComputeMs),
      detail:
        mcComputeMs !== null || clusterComputeMs !== null
          ? lang === "th"
            ? "วัดเวลาคำนวณจริงจากเซิร์ฟเวอร์ในรอบที่คุณเพิ่งสั่งรันหน้าแบบจำลอง"
            : "Real server side execution time measured from your latest modeling run"
          : lang === "th"
            ? "เปิดหน้าจำลองความเสี่ยงและจัดกลุ่มจังหวัด ระบบจะบันทึกเวลาคำนวณจริงมาแสดงที่นี่"
            : "Open the Simulation & Clustering tab to record live compute time here",
      icon: Gauge,
    },
    {
      label: lang === "th" ? "เวลาค้นหาเอกสารทางการและสร้างคำตอบ (ผลตรวจล่าสุด)" : "Document Search & Answer Latency (Last Eval)",
      value:
        ragMedianMs !== null
          ? lang === "th"
            ? `${(ragMedianMs / 1000).toFixed(2)} วินาที`
            : `${(ragMedianMs / 1000).toFixed(2)} s`
          : "—",
      tone: ragMedianMs === null ? "text-muted-foreground" : ragMedianMs <= 5000 ? "text-emerald-700" : ragMedianMs <= 10000 ? "text-amber-700" : "text-red-700",
      detail:
        ragMedianMs !== null
          ? lang === "th"
            ? `ค่ามัธยฐาน ${(ragMedianMs / 1000).toFixed(2)} วินาที${ragTrapMs !== null ? ` · เฉลี่ยคำถามนอกขอบเขต ${(ragTrapMs / 1000).toFixed(2)} วินาที` : ""} (บันทึกจริงในฐานข้อมูล)`
            : `Median ${(ragMedianMs / 1000).toFixed(2)}s${ragTrapMs !== null ? ` · trap mean ${(ragTrapMs / 1000).toFixed(2)}s` : ""} (from DB eval log)`
          : lang === "th"
            ? "ไม่พบบันทึกผลทดสอบความเร็วในฐานข้อมูล"
            : "No latency log recorded in evaluation table",
      icon: Clock,
    },
  ]

  const hitTop5 = eval7d?.dim1_retrieval?.hybrid_rrf?.hit_rate_top5_pct
  const mrrScore = eval7d?.dim1_retrieval?.hybrid_rrf?.mrr
  const citeAcc = eval7d?.dim2_rag_qa?.citation_accuracy_pct
  const refusalAcc = eval7d?.dim2_rag_qa?.refusal_accuracy_pct
  const inScopeAns = eval7d?.dim2_rag_qa?.in_scope_answer_rate_pct
  const piiRecall = eval7d?.dim5_security_guardrails?.pii_redaction_recall_pct
  const injBlock = eval7d?.dim5_security_guardrails?.injection_block_rate_pct
  const ariScore = eval7d?.dim6_stability?.kmeans_k4_perturbation_ari
  const silEval = eval7d?.dim4_analytics?.silhouette_score
  const quoteMatch = eval7d?.dim3_news_extraction?.verbatim_quote_match_pct
  const shockF1 = eval7d?.dim3_news_extraction?.shock_type_macro_f1_pct

  const evalCards = [
    {
      label: lang === "th" ? "ความแม่นยำการค้นคืนเอกสารทางการ 5 อันดับแรก" : "Official PDF Retrieval Hit Rate @ Top 5",
      value: hitTop5 != null ? `${hitTop5}%` : "—",
      tone: hitTop5 == null ? "text-muted-foreground" : hitTop5 >= 85 ? "text-emerald-700" : "text-amber-700",
      detail:
        hitTop5 != null
          ? lang === "th"
            ? `คะแนนลำดับเฉลี่ย (MRR) ${mrrScore ?? "—"} จากชุดคำถามทดสอบ ${eval7d?.dim1_retrieval?.hybrid_rrf?.n_queries ?? "—"} ข้อ`
            : `MRR ${mrrScore ?? "—"} across ${eval7d?.dim1_retrieval?.hybrid_rrf?.n_queries ?? "—"} benchmark queries`
          : lang === "th"
            ? "ไม่มีผลทดสอบในฐานข้อมูล"
            : "No benchmark recorded",
      icon: ClipboardList,
    },
    {
      label: lang === "th" ? "ความถูกต้องของการอ้างอิง / ปฏิเสธนอกขอบเขต / ตอบในขอบเขต" : "Citation / Refusal / In Scope Answer Rate",
      value:
        citeAcc != null && refusalAcc != null
          ? `${citeAcc}% / ${refusalAcc}% / ${inScopeAns != null ? `${inScopeAns}%` : "—"}`
          : "—",
      tone:
        inScopeAns != null && inScopeAns < 90
          ? "text-amber-700"
          : citeAcc != null
            ? "text-emerald-700"
            : "text-muted-foreground",
      detail:
        citeAcc != null
          ? lang === "th"
            ? `อ้างอิงตรงเอกสาร ${citeAcc}% ปฏิเสธนอกขอบเขต ${refusalAcc}% แต่ตอบคำถามในขอบเขตได้ ${inScopeAns ?? "—"}% (1 ข้อที่เข้มงวดเกินไปจึงปฏิเสธ)`
            : `Citation ${citeAcc}%, trap refusal ${refusalAcc}%, in scope answer rate ${inScopeAns ?? "—"}% (strict threshold refused 1 edge case)`
          : lang === "th"
            ? "ไม่มีผลทดสอบในฐานข้อมูล"
            : "No benchmark recorded",
      icon: BadgeCheck,
    },
    {
      label: lang === "th" ? "การปกปิดข้อมูลส่วนบุคคลและป้องกันคำสั่งโจมตี" : "PII Redaction & Prompt Injection Defense",
      value: piiRecall != null && injBlock != null ? `${piiRecall}% / ${injBlock}%` : "—",
      tone: piiRecall === 100 && injBlock === 100 ? "text-emerald-700" : "text-amber-700",
      detail:
        piiRecall != null
          ? lang === "th"
            ? `ทดสอบปิดบังข้อมูลส่วนบุคคล ${eval7d?.dim5_security_guardrails?.pii_cases_tested ?? "—"} กรณี และป้องกันคำสั่งโจมตี ${eval7d?.dim5_security_guardrails?.injection_cases_tested ?? "—"} กรณี`
            : `Tested across ${eval7d?.dim5_security_guardrails?.pii_cases_tested ?? "—"} PII and ${eval7d?.dim5_security_guardrails?.injection_cases_tested ?? "—"} injection cases`
          : lang === "th"
            ? "ไม่มีผลทดสอบในฐานข้อมูล"
            : "No benchmark recorded",
      icon: ShieldCheck,
    },
    {
      label: lang === "th" ? "ความชัดเจนกลุ่มจังหวัด (Silhouette) / เสถียรภาพ / ความแม่นยำข่าว" : "Cluster Separation / Stability / News F1",
      value:
        silEval != null && ariScore != null
          ? `${silEval} / ${ariScore} / ${shockF1 != null ? `${shockF1}%` : "—"}`
          : "—",
      tone: silEval != null && silEval < 0.35 ? "text-amber-700" : "text-foreground",
      detail:
        silEval != null
          ? lang === "th"
            ? `การแยก 4 กลุ่มจาก 17 จังหวัดมีค่าความชัดเจนระดับปานกลาง (${silEval}) เนื่องจากบริบทจังหวัดใกล้เคียงกัน แต่เสถียรภาพสูง (${ariScore}) และจำแนกประเภทข่าวได้ F1 ${shockF1 ?? "—"}% (ข้อความตรงต้นฉบับ ${quoteMatch ?? "—"}%)`
            : `Moderate cluster separation (${silEval}) reflects natural provincial overlap, high perturbation ARI (${ariScore}), news type F1 ${shockF1 ?? "—"}% (verbatim ${quoteMatch ?? "—"}%)`
          : lang === "th"
            ? "ไม่มีผลทดสอบในฐานข้อมูล"
            : "No benchmark recorded",
      icon: ChartNoAxesCombined,
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
          {lang === "th" ? "ธรรมาภิบาลข้อมูลและผลการตรวจสอบคุณภาพระบบตามจริง" : "Live Medallion Governance & Real Evaluation Metrics"}
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {lang === "th" ? "คุณภาพข้อมูลและผลตรวจวัดความแม่นยำจริงของระบบ" : "Data Health & Honest Benchmarks"}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {lang === "th"
            ? `ทุกตัวเลขด้านล่างดึงสดจากฐานข้อมูลและผลทดสอบจริงโดยไม่มีค่าตั้งต้นจำลอง${evalRanDate ? ` · รอบประเมิน 7 มิติล่าสุดเมื่อ ${evalRanDate} (เวลาสากล)` : ""}`
            : `Every number below is read directly from live PostgreSQL tables and actual evaluation logs with zero synthetic fallbacks${evalRanDate ? ` · Last 7D eval ${evalRanDate} UTC` : ""}.`}
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold">
          {lang === "th" ? "สรุปปริมาณข้อมูลในฐานข้อมูลหลัก" : "Live Database Layer Summary"}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((item) => (
            <article key={item.label} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <item.icon aria-hidden="true" className="size-4 text-muted-foreground" />
              </div>
              <p className="mt-4 font-display text-2xl font-semibold tracking-tight tabular-nums">{item.value}</p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {lang === "th"
              ? "ผลวัดความเร็วการดึงข้อมูลและการประมวลผลตามจริง"
              : "Measured Data Fetch & Compute Latency"}
          </h2>
          <button
            type="button"
            disabled={testingSpeed}
            onClick={onRunBenchmark}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
          >
            <RefreshCw aria-hidden="true" className={`size-3 ${testingSpeed ? "animate-spin" : ""}`} />
            {lang === "th" ? "ทดสอบความเร็วดึงข้อมูลจริง (เทียบแคชกับฐานข้อมูล)" : "Benchmark Live DB vs Cache"}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {speedCards.map((item) => (
            <article key={item.label} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-secondary">
                  <item.icon aria-hidden="true" className="size-4 text-foreground" />
                </span>
              </div>
              <p className={`mt-3 font-display text-2xl font-semibold tracking-tight tabular-nums ${item.tone}`}>
                {item.value}
              </p>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">
          {lang === "th" ? "ผลประเมินความแม่นยำและข้อจำกัดตามจริง (7 มิติ)" : "Actual 7 Dimension Evaluation Results"}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {evalCards.map((item) => (
            <article key={item.label} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground">{item.label}</h3>
                  <p className={`mt-3 font-display text-2xl font-semibold tracking-tight tabular-nums ${item.tone}`}>
                    {item.value}
                  </p>
                </div>
                <span className="flex size-10 items-center justify-center rounded-xl bg-secondary">
                  <item.icon aria-hidden="true" className="size-4" />
                </span>
              </div>
              <p className="mt-2.5 text-xs leading-5 text-muted-foreground">{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">
            {lang === "th"
              ? `คลังเอกสารทางการที่ใช้ตอบคำถาม (${health?.indexed_official_documents.length ?? 0} ฉบับ)`
              : `Indexed Official Documents (${health?.indexed_official_documents.length ?? 0} PDFs)`}
          </h2>
          <ul className="mt-3 space-y-2.5">
            {(health?.indexed_official_documents ?? []).map((doc) => (
              <li
                key={doc.doc_title}
                className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5 text-xs"
              >
                <a
                  href={doc.doc_url || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 truncate font-medium text-foreground hover:underline"
                >
                  {doc.doc_title}
                </a>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {lang === "th"
                    ? `${doc.page_count} หน้า · ${doc.chunk_count} ส่วนข้อความ`
                    : `${doc.page_count}p · ${doc.chunk_count} chunks`}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">
            {lang === "th" ? "รายการข้อมูลที่ระบบคัดออกเนื่องจากไม่เข้าเกณฑ์" : "Quarantined Anomaly Diagnostics"}
          </h2>
          <ul className="mt-3 space-y-2">
            {(health?.quarantine_breakdown ?? []).map((q, idx) => (
              <li
                key={idx}
                className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {translateQuarantineReason(q.error_reason, lang)}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-semibold tabular-nums">
                  {q.count} {lang === "th" ? "รายการ" : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

function ClusterLegend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-2 rounded-full ${color}`} aria-hidden="true" />
      {label}
    </span>
  )
}

function BriefMetric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/25 px-3.5 py-2.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-base font-semibold tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  )
}
