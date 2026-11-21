"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Building2,
  ChartNoAxesCombined,
  Check,
  CheckCircle2,
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
  MinusCircle,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  X,
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
import {
  CLUSTER_COLORS,
  CLUSTER_DOT_CLASS,
  ProvinceHistoryChart,
  RegionalRiskGrouping,
} from "@/components/regional-risk-charts"
import {
  fetchDataHealth,
  fetchExecutiveBriefJson,
  fetchExecutiveBriefText,
  fetchPolicyMonitor,
  fetchProvinceDetail,
  isAbortError,
  isUnauthorizedError,
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

type RankedProvince = QuadrantProvince & {
  cash_margin_pct: number | null
  sme_debt_ratio: number | null
  computed_priority_score: number
  priority_rank: number
}

/**
 * Unified composite vulnerability score matching backend brief_generator.py:
 * 0.38 exposure + 0.32 external shock + 0.15 tight cash margin penalty + 0.15 SME debt penalty.
 * Renormalizes weights across available non-null indicators (zero synthetic fallback values).
 */
function computeCompositePriorityScore(p: QuadrantProvince): {
  cashMargin: number | null
  smeDebt: number | null
  score: number
} {
  const cashMargin =
    p.expense_to_income_pct_sme != null
      ? Math.max(0, 100 - p.expense_to_income_pct_sme)
      : null
  const smeDebt = p.debt_to_annual_income_sme

  if (p.priority_score != null && Number.isFinite(p.priority_score)) {
    return { cashMargin, smeDebt, score: p.priority_score }
  }

  let weightedSum = 0
  let activeWeight = 0

  if (p.exposure_score != null) {
    weightedSum += 0.38 * p.exposure_score
    activeWeight += 0.38
  }
  if (p.shock_intensity != null) {
    weightedSum += 0.32 * p.shock_intensity
    activeWeight += 0.32
  }
  if (cashMargin != null) {
    const tightMarginPenalty = Math.max(0, (30 - cashMargin) * 2.2)
    weightedSum += 0.15 * tightMarginPenalty
    activeWeight += 0.15
  }
  if (smeDebt != null) {
    const debtPenalty = Math.min(100, smeDebt * 65)
    weightedSum += 0.15 * debtPenalty
    activeWeight += 0.15
  }

  const score = activeWeight > 0 ? Number((weightedSum / activeWeight).toFixed(2)) : 0
  return { cashMargin, smeDebt, score }
}

export function StaffWorkspace({
  auth,
  onExit,
}: {
  auth: StaffAuthResponse
  onExit: () => void
}) {
  const { lang, setLang, selectedProvinceCode, setSelectedProvinceCode } = useAppState()
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview")
  const [months, setMonths] = useState(24)

  const [monitor, setMonitor] = useState<PolicyMonitorResponse | null>(null)
  const [health, setHealth] = useState<DataHealthResponse | null>(null)
  const [detail, setDetail] = useState<ProvinceDetailResponse | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [briefOpen, setBriefOpen] = useState(false)
  const [brief, setBrief] = useState<ExecutiveBriefData | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)
  const [printingBrief, setPrintingBrief] = useState(false)
  const [printError, setPrintError] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [testingSpeed, setTestingSpeed] = useState(false)
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null)
  const [refreshNotice, setRefreshNotice] = useState<{
    type: "success" | "error"
    text: string
  } | null>(null)
  const [cachedFetchMs, setCachedFetchMs] = useState<number | null>(null)
  const [freshDbFetchMs, setFreshDbFetchMs] = useState<number | null>(null)
  const [mcComputeMs, setMcComputeMs] = useState<number | null>(null)
  const [clusterComputeMs, setClusterComputeMs] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const briefRef = useRef<HTMLDialogElement>(null)
  const sessionExpiredRef = useRef(false)

  const handleUnauthorized = useCallback(() => {
    if (sessionExpiredRef.current) return
    sessionExpiredRef.current = true
    setError(
      lang === "th"
        ? "เซสชันเจ้าหน้าที่หมดอายุ กำลังกลับสู่หน้าสาธารณะ…"
        : "Staff session expired. Returning to public view…",
    )
    setTimeout(() => {
      onExit()
    }, 1500)
  }, [lang, onExit])

  const loadWorkspaceData = useCallback(
    async (forceFresh = false, signal?: AbortSignal) => {
      if (forceFresh) {
        setTestingSpeed(true)
      } else {
        setLoading(true)
      }
      setError(null)
      const t0 = typeof performance !== "undefined" ? performance.now() : Date.now()
      try {
        const [m, h] = await Promise.all([
          fetchPolicyMonitor(auth.access_token, forceFresh, signal),
          fetchDataHealth(auth.access_token, forceFresh, signal),
        ])
        const elapsed = Math.round(
          (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0,
        )
        if (forceFresh || h.cache_status === "MISS") {
          setFreshDbFetchMs(elapsed)
        } else {
          setCachedFetchMs(elapsed)
        }
        setMonitor(m)
        setHealth(h)
      } catch (err) {
        if (isAbortError(err)) return
        if (isUnauthorizedError(err)) {
          handleUnauthorized()
          return
        }
        setError(
          err instanceof Error
            ? err.message
            : lang === "th"
              ? "ไม่สามารถโหลดข้อมูลโหมดเจ้าหน้าที่ได้"
              : "Failed to load staff workspace",
        )
      } finally {
        setLoading(false)
        setTestingSpeed(false)
      }
    },
    [auth.access_token, handleUnauthorized, lang],
  )

  async function runSpeedBenchmark() {
    setTestingSpeed(true)
    setBenchmarkError(null)
    try {
      const tFresh0 = performance.now()
      const hFresh = await fetchDataHealth(auth.access_token, true)
      const freshMs = Math.round(performance.now() - tFresh0)
      setFreshDbFetchMs(freshMs)
      setHealth(hFresh)

      const tHit0 = performance.now()
      await fetchDataHealth(auth.access_token, false)
      const hitMs = Math.max(1, Math.round(performance.now() - tHit0))
      setCachedFetchMs(hitMs)
    } catch (err) {
      if (isUnauthorizedError(err)) {
        handleUnauthorized()
        return
      }
      setBenchmarkError(
        err instanceof Error
          ? err.message
          : lang === "th"
            ? "ทดสอบความเร็วไม่สำเร็จ กรุณาลองใหม่"
            : "Speed benchmark failed. Please retry.",
      )
    } finally {
      setTestingSpeed(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void loadWorkspaceData(false, controller.signal)
    return () => controller.abort()
  }, [loadWorkspaceData])

  // Auto-dismiss success notices only; keep error notices visible until dismissed or retried
  useEffect(() => {
    if (!refreshNotice || refreshNotice.type !== "success") return
    const timer = setTimeout(() => {
      setRefreshNotice(null)
    }, 5000)
    return () => clearTimeout(timer)
  }, [refreshNotice])

  // Fetch provincial detail synced with global selectedProvinceCode (with AbortController)
  useEffect(() => {
    const controller = new AbortController()
    setDetail(null)
    setDetailError(null)
    fetchProvinceDetail(selectedProvinceCode, controller.signal)
      .then((res) => {
        setDetail(res)
      })
      .catch((err) => {
        if (isAbortError(err)) return
        setDetail(null)
        setDetailError(
          err instanceof Error
            ? err.message
            : lang === "th"
              ? "ไม่สามารถดึงข้อมูลรายเดือนของจังหวัดนี้ได้"
              : "Failed to load provincial monthly details",
        )
      })
    return () => controller.abort()
  }, [selectedProvinceCode, lang])

  const provinces = monitor?.quadrant_provinces ?? []
  const selected = useMemo(
    () => provinces.find((p) => p.province_code === selectedProvinceCode) ?? provinces[0] ?? null,
    [provinces, selectedProvinceCode],
  )

  const loadBriefData = useCallback(
    async (signal?: AbortSignal) => {
      setBriefLoading(true)
      setBriefError(null)
      setPrintError(null)
      try {
        const data = await fetchExecutiveBriefJson(auth.access_token, lang, signal)
        setBrief(data)
      } catch (err) {
        if (isAbortError(err)) return
        if (isUnauthorizedError(err)) {
          briefRef.current?.close()
          setBriefOpen(false)
          handleUnauthorized()
          return
        }
        setBrief(null)
        setBriefError(
          err instanceof Error
            ? err.message
            : lang === "th"
              ? "ไม่สามารถสร้างรายงานสรุปเชิงนโยบายได้"
              : "Failed to generate policy brief",
        )
      } finally {
        setBriefLoading(false)
      }
    },
    [auth.access_token, handleUnauthorized, lang],
  )

  // Re-fetch policy brief whenever modal opens or language switches while open
  useEffect(() => {
    if (!briefOpen) return
    const controller = new AbortController()
    void loadBriefData(controller.signal)
    return () => controller.abort()
  }, [briefOpen, loadBriefData])

  function openBriefDialog() {
    setBrief(null)
    setBriefError(null)
    setPrintError(null)
    setBriefOpen(true)
    if (briefRef.current && !briefRef.current.open) {
      briefRef.current.showModal()
    }
  }

  function closeBriefDialog() {
    setBriefOpen(false)
    briefRef.current?.close()
  }

  async function printOnePageBrief() {
    if (!brief || briefLoading || printingBrief) return
    setPrintingBrief(true)
    setPrintError(null)
    try {
      const html = await fetchExecutiveBriefText(auth.access_token, "html", lang)
      const iframe = document.createElement("iframe")
      iframe.style.position = "fixed"
      iframe.style.width = "0"
      iframe.style.height = "0"
      iframe.style.border = "0"
      iframe.style.visibility = "hidden"

      const cleanup = () => {
        setTimeout(() => {
          iframe.remove()
        }, 1500)
      }

      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus()
          iframe.contentWindow?.print()
        } catch {
          setPrintError(
            lang === "th"
              ? "เบราว์เซอร์ไม่สามารถเปิดหน้าต่างพิมพ์ได้"
              : "Unable to open browser print dialog",
          )
        } finally {
          setPrintingBrief(false)
          cleanup()
        }
      }

      iframe.onerror = () => {
        setPrintError(
          lang === "th" ? "ไม่สามารถเตรียมเอกสารสำหรับพิมพ์ได้" : "Failed to prepare printable document",
        )
        setPrintingBrief(false)
        iframe.remove()
      }

      iframe.srcdoc = html
      document.body.appendChild(iframe)
    } catch (err) {
      if (isUnauthorizedError(err)) {
        closeBriefDialog()
        handleUnauthorized()
        return
      }
      setPrintError(
        err instanceof Error
          ? err.message
          : lang === "th"
            ? "ดึงเอกสารสำหรับพิมพ์ไม่สำเร็จ"
            : "Failed to fetch printable brief",
      )
      setPrintingBrief(false)
    }
  }

  async function handleLiveRefresh() {
    setRefreshing(true)
    setRefreshNotice(null)
    try {
      const res = await triggerLiveRefresh(auth.access_token)
      await loadWorkspaceData(true)
      const freshDetail = await fetchProvinceDetail(selectedProvinceCode)
      setDetail(freshDetail)
      setDetailError(null)

      const fetched = Number(res?.news_bronze?.fetched_unique ?? 0)
      const added = Number(res?.news_silver?.validated_silver ?? 0)
      const failedFeeds = Number(res?.news_bronze?.feeds_failed ?? 0)
      const syncedCount = res?.provinces_synced ?? res?.air4thai?.provinces_updated ?? provinces.length

      if (failedFeeds > 0) {
        setRefreshNotice({
          type: "error",
          text:
            lang === "th"
              ? `อัปเดตข้อมูลแล้วบางส่วน (${syncedCount} จังหวัด · ข่าว ${fetched} รายการ, ผ่านเกณฑ์ ${added} ข่าว) แต่มีแหล่งข่าว ${failedFeeds} แหล่งดึงไม่สำเร็จ`
              : `Partial sync completed (${syncedCount} provinces · ${fetched} scanned, ${added} verified), but ${failedFeeds} feed(s) failed.`,
        })
      } else {
        setRefreshNotice({
          type: "success",
          text:
            lang === "th"
              ? `อัปเดตข้อมูลสดเรียบร้อย (${syncedCount} จังหวัด) · ตรวจพบข่าว ${fetched} รายการ และคัดกรองเพิ่ม ${added} ข่าวที่ตรวจสอบแล้ว`
              : `Synced live Air4Thai & RSS feeds (${syncedCount} provinces · ${fetched} scanned, ${added} new verified events).`,
        })
      }
    } catch (err) {
      if (isUnauthorizedError(err)) {
        handleUnauthorized()
        return
      }
      setRefreshNotice({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : lang === "th"
              ? "ดึงข้อมูลสดไม่สำเร็จ กรุณาลองใหม่"
              : "Live refresh failed. Please try again.",
      })
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
            <span className="hidden rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline-flex">
              {auth.username === "demo_analyst" && lang === "th"
                ? "เจ้าหน้าที่วิเคราะห์นโยบาย"
                : auth.username}
            </span>
          </div>

          <nav
            aria-label={lang === "th" ? "เมนูมุมมองเจ้าหน้าที่" : "Staff portal views"}
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
            <div
              role="group"
              aria-label={lang === "th" ? "เลือกภาษา" : "Language selector"}
              className="inline-flex items-center rounded-full border border-border bg-secondary/70 p-0.5 text-[11px] font-medium"
            >
              <button
                type="button"
                aria-pressed={lang === "th"}
                onClick={() => setLang("th")}
                className={`rounded-full px-2.5 py-1 ${lang === "th" ? "bg-foreground text-background" : "text-muted-foreground"}`}
              >
                ไทย
              </button>
              <button
                type="button"
                aria-pressed={lang === "en"}
                onClick={() => setLang("en")}
                className={`rounded-full px-2.5 py-1 ${lang === "en" ? "bg-foreground text-background" : "text-muted-foreground"}`}
              >
                EN
              </button>
            </div>
            <button
              type="button"
              onClick={onExit}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <span className="size-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
              <span>{lang === "th" ? "ออกจากโหมดเจ้าหน้าที่" : "Exit Staff View"}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {error && (
          <div
            role="alert"
            className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label={lang === "th" ? "ปิดข้อความแจ้งเตือน" : "Dismiss error"}
              className="rounded-full p-1 hover:bg-destructive/10"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        )}
        {refreshNotice && (
          <div
            role={refreshNotice.type === "error" ? "alert" : "status"}
            className={`mb-4 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs ${
              refreshNotice.type === "error"
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : "border-emerald-700/20 bg-emerald-700/5 text-emerald-800 dark:text-emerald-300"
            }`}
          >
            <span>{refreshNotice.text}</span>
            <button
              type="button"
              onClick={() => setRefreshNotice(null)}
              aria-label={lang === "th" ? "ปิดการแจ้งเตือน" : "Dismiss notice"}
              className="rounded-full p-1 hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        )}

        {loading && !monitor ? (
          <div className="flex h-64 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            <span>{lang === "th" ? "กำลังดึงข้อมูลจากฐานข้อมูล…" : "Loading analytics data…"}</span>
          </div>
        ) : activeTab === "overview" ? (
          <PolicyOverviewPage
            monitor={monitor}
            selected={selected}
            selectedCode={selectedProvinceCode}
            detail={detail}
            detailError={detailError}
            months={months}
            refreshing={refreshing}
            onSelectCode={setSelectedProvinceCode}
            onMonthsChange={setMonths}
            onRefresh={() => void handleLiveRefresh()}
            onExport={openBriefDialog}
            onOpenModeling={() => setActiveTab("modeling")}
          />
        ) : activeTab === "modeling" ? (
          <RiskModelingAndClusteringPage
            token={auth.access_token}
            monitor={monitor}
            provincesCount={provinces.length}
            onPublished={() => void loadWorkspaceData(true)}
            onUnauthorized={handleUnauthorized}
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
            benchmarkError={benchmarkError}
            onRunBenchmark={() => void runSpeedBenchmark()}
          />
        )}
      </main>

      {/* Printable 1-Page Policy Brief modal */}
      <dialog
        ref={briefRef}
        aria-labelledby="brief-title"
        data-print-brief
        onCancel={(e) => {
          e.preventDefault()
          closeBriefDialog()
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-4xl rounded-3xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/55 backdrop:backdrop-blur-sm"
      >
        <div id="executive-brief" className="p-6 sm:p-8">
          <div className="no-print mb-5 flex items-center justify-between border-b border-border pb-4">
            <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <FileText aria-hidden="true" className="size-4" />
              {lang === "th" ? "รายงานสรุปเชิงนโยบาย (1 หน้า)" : "1-Page Policy Brief"}
            </span>
            <button
              type="button"
              onClick={closeBriefDialog}
              aria-label={lang === "th" ? "ปิดหน้ารายงานสรุปเชิงนโยบาย" : "Close policy brief"}
              className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>

          {briefLoading ? (
            <div className="flex h-44 items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              <span>
                {lang === "th"
                  ? "กำลังสร้างรายงานสรุปเชิงนโยบายจากข้อมูลล่าสุด…"
                  : "Generating policy brief from latest data…"}
              </span>
            </div>
          ) : briefError ? (
            <div className="flex h-44 flex-col items-center justify-center gap-3 text-center">
              <p className="text-xs text-destructive">{briefError}</p>
              <button
                type="button"
                onClick={() => void loadBriefData()}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-xs font-medium text-foreground hover:bg-secondary"
              >
                <RefreshCw aria-hidden="true" className="size-3.5" />
                {lang === "th" ? "ลองโหลดใหม่" : "Retry"}
              </button>
            </div>
          ) : brief ? (
            <>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {lang === "th" ? "ระบบวิเคราะห์ความเสี่ยงเศรษฐกิจภาคเหนือ" : "NorthRisk Analytics"} ·{" "}
                {formatThaiMonth(brief.latest_month, lang)} · {brief.generated_at}
              </p>
              <h2
                id="brief-title"
                className="mt-1.5 font-display text-xl font-semibold leading-snug tracking-tight sm:text-2xl"
              >
                {lang === "th"
                  ? "รายงานสรุปเชิงนโยบาย: เศรษฐกิจภาคบริการและความเปราะบางทางการเงินภาคเหนือ"
                  : "Policy Brief: Northern Service Sector & Financial Vulnerability"}
              </h2>

              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <BriefMetric
                  label={
                    lang === "th"
                      ? `อัตราเข้าพักเฉลี่ย (${brief.regional_snapshot.provinces_monitored} จังหวัด)`
                      : `Regional Avg Occupancy (${brief.regional_snapshot.provinces_monitored} Prov.)`
                  }
                  value={`${brief.regional_snapshot.avg_occupancy_pct.toFixed(1)}%`}
                  sub={`${lang === "th" ? "เทียบปีก่อน" : "YoY"} ${brief.regional_snapshot.avg_occupancy_yoy_diff >= 0 ? "+" : ""}${brief.regional_snapshot.avg_occupancy_yoy_diff.toFixed(1)}%`}
                />
                <BriefMetric
                  label={lang === "th" ? "รายได้ท่องเที่ยวรวมต่อเดือน" : "Monthly Tourism Revenue"}
                  value={`${Math.round(brief.regional_snapshot.total_monthly_revenue_mthb).toLocaleString()} ${lang === "th" ? "ล้านบาท" : "M THB"}`}
                  sub={
                    lang === "th"
                      ? `เชียงใหม่และเชียงรายคิดเป็น ${brief.regional_snapshot.top2_revenue_share_pct}%`
                      : `CM+CR share ${brief.regional_snapshot.top2_revenue_share_pct}%`
                  }
                />
                <BriefMetric
                  label={
                    lang === "th"
                      ? "เงินเฟ้อไทย / น้ำมัน Brent (เทียบปีก่อน)"
                      : "CPI / Brent Oil (YoY)"
                  }
                  value={
                    brief.regional_snapshot.th_cpi_yoy_pct != null
                      ? `${brief.regional_snapshot.th_cpi_yoy_pct.toFixed(2)}%`
                      : "—"
                  }
                  sub={
                    brief.regional_snapshot.oil_brent_yoy_pct != null
                      ? `${lang === "th" ? "น้ำมัน Brent" : "Brent"} ${brief.regional_snapshot.oil_brent_yoy_pct >= 0 ? "+" : ""}${brief.regional_snapshot.oil_brent_yoy_pct.toFixed(0)}%`
                      : ""
                  }
                />
                <BriefMetric
                  label={lang === "th" ? "สถานะแรงกระแทกภายนอก" : "External Shock Status"}
                  value={
                    brief.regional_snapshot.has_regional_external_shock
                      ? lang === "th"
                        ? `เฝ้าระวัง ${brief.regional_snapshot.elevated_shock_provinces.length}/${brief.regional_snapshot.provinces_monitored} จังหวัด`
                        : `${brief.regional_snapshot.elevated_shock_provinces.length}/${brief.regional_snapshot.provinces_monitored} Active`
                      : lang === "th"
                        ? `ภาวะปกติ (0/${brief.regional_snapshot.provinces_monitored})`
                        : `Normal (0/${brief.regional_snapshot.provinces_monitored})`
                  }
                  sub={lang === "th" ? "เกณฑ์เตือนภัยดัชนี 50 ขึ้นไป" : "Alert cutoff >= 50"}
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
                  <table className="w-full text-left text-xs">
                    <thead className="bg-secondary/60 text-[11px] text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="px-3 py-2 font-medium">{lang === "th" ? "จังหวัด" : "Province"}</th>
                        <th className="px-2.5 py-2 text-right font-medium">
                          {lang === "th" ? "อัตราเข้าพัก" : "Occupancy"}
                        </th>
                        <th className="px-2.5 py-2 text-right font-medium">
                          {lang === "th" ? "หนี้ SME" : "SME Debt"}
                        </th>
                        <th className="px-2.5 py-2 text-right font-medium">
                          {lang === "th" ? "เงินเหลือหลังหักรายจ่าย" : "Cash Margin"}
                        </th>
                        <th className="px-3 py-2 font-medium">{lang === "th" ? "จุดเสี่ยงหลัก" : "Risk Driver"}</th>
                        <th className="px-3 py-2 font-medium">
                          {lang === "th" ? "แนวทางดำเนินการ" : "Recommended Action"}
                        </th>
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
                  {lang === "th" ? "3. แผนปฏิบัติการเชิงนโยบาย 3 ระยะ" : "3. Three-Horizon Policy Action Plan"}
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
                    {lang === "th"
                      ? "4. สัญญาณข่าวภาคสนามที่ตรวจสอบแล้วล่าสุด"
                      : "4. Latest Verified Field Signals"}
                  </h3>
                  <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                    {brief.verified_news.slice(0, 2).map((n, idx) => (
                      <li key={idx}>
                        <strong className="text-foreground">
                          {n.event_date} · {lang === "th" ? n.name_th : n.name_en} (
                          {translateShockType(n.shock_type, lang)}):
                        </strong>{" "}
                        {n.evidence_quote}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="mt-4 border-t border-border pt-3 text-[11px] leading-5 text-muted-foreground">
                {lang === "th"
                  ? "แหล่งข้อมูลทางการ: กระทรวงการท่องเที่ยวและกีฬา (MOTS), สำนักงานสถิติแห่งชาติ (สสช. 2568), BIS CPI, FRED, Open-Meteo, กรมควบคุมมลพิษ (Air4Thai) และเอกสารธนาคารแห่งประเทศไทย"
                  : "Official Sources: MOTS, NSO 2025, BIS CPI, FRED, Open-Meteo, Air4Thai, and Bank of Thailand Official Publications."}
              </p>
            </>
          ) : null}

          {printError && (
            <p role="alert" className="no-print mt-3 text-right text-xs text-destructive">
              {printError}
            </p>
          )}

          <div className="no-print mt-6 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={closeBriefDialog}
              className="inline-flex h-10 items-center justify-center rounded-full border border-border px-4 text-xs font-medium text-foreground hover:bg-secondary"
            >
              {lang === "th" ? "ปิดหน้าต่าง" : "Close"}
            </button>
            <button
              type="button"
              disabled={!brief || briefLoading || printingBrief}
              onClick={() => void printOnePageBrief()}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-foreground px-5 text-xs font-medium text-background hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {printingBrief ? (
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              ) : (
                <Download aria-hidden="true" className="size-3.5" />
              )}
              {lang === "th" ? "พิมพ์ / บันทึกรายงานสรุป 1 หน้า" : "Print / Save 1-Page Brief"}
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
  detailError,
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
  detailError: string | null
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

  // Deduplicated horizon options
  const monthOptions = useMemo(() => {
    const base = [12, 24]
    if (totalAvailableMonths > 0 && !base.includes(totalAvailableMonths)) {
      return [...base, totalAvailableMonths]
    }
    return base
  }, [totalAvailableMonths])

  // Rank provinces using the unified formula shared with brief_generator.py (zero synthetic fallbacks)
  const rankedProvinces: RankedProvince[] = useMemo(() => {
    const scored = provinces.map((p) => {
      const { cashMargin, smeDebt, score } = computeCompositePriorityScore(p)
      return {
        ...p,
        cash_margin_pct: cashMargin,
        sme_debt_ratio: smeDebt,
        computed_priority_score: score,
      }
    })
    scored.sort((a, b) => {
      if (a.priority_rank != null && b.priority_rank != null) {
        return a.priority_rank - b.priority_rank
      }
      return b.computed_priority_score - a.computed_priority_score
    })
    return scored.map((item, idx) => ({
      ...item,
      priority_rank: item.priority_rank ?? idx + 1,
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

  // Compute regional distribution strictly from available non-null values
  const distributionStats = useMemo(() => {
    if (!rankedProvinces.length) return null

    const rows = rankedProvinces
      .map((p) => {
        const val =
          distMetric === "margin"
            ? p.cash_margin_pct
            : distMetric === "debt"
              ? p.sme_debt_ratio
              : p.avg_occupancy_rate
        return val != null && Number.isFinite(val) ? { ...p, metricValue: val } : null
      })
      .filter((r): r is RankedProvince & { metricValue: number } => r !== null)

    if (!rows.length) return null

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
      sortedAsc.length % 2 !== 0 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2

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
      missingCount: rankedProvinces.length - rows.length,
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

  // Group summary statistics across structural clusters using only non-null observations
  const clusterSummaries = useMemo(() => {
    const groups = new Map<
      number,
      {
        cluster_id: number
        cluster_label: string
        items: RankedProvince[]
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
        const marginVals = g.items
          .map((item) => item.cash_margin_pct)
          .filter((v): v is number => v != null)
        const debtVals = g.items
          .map((item) => item.sme_debt_ratio)
          .filter((v): v is number => v != null)
        const avgMargin = marginVals.length
          ? marginVals.reduce((acc, v) => acc + v, 0) / marginVals.length
          : null
        const avgDebt = debtVals.length
          ? debtVals.reduce((acc, v) => acc + v, 0) / debtVals.length
          : null
        const avgOcc =
          g.items.reduce((acc, item) => acc + item.avg_occupancy_rate, 0) /
          Math.max(1, g.items.length)
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
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {lang === "th"
              ? "ระบบติดตามและวิเคราะห์เศรษฐกิจรายจังหวัด"
              : "Regional Provincial Monitoring"}
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {lang === "th" ? "ภาพรวมเศรษฐกิจและติดตามนโยบาย" : "Regional Policy Overview"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {lang === "th"
              ? "วิเคราะห์การกระจายตัวของสภาพคล่องและภาระหนี้รายจังหวัดทั่วภาคเหนือ จัดอันดับพื้นที่เฝ้าระวังสูงสุด พร้อมตัวกรองเจาะลึกรายจังหวัด"
              : "Regional distribution of liquidity and SME debt across Northern provinces, top priority watchlist, and direct provincial filter."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex h-10 items-center gap-2 rounded-full border border-foreground/25 bg-background px-3.5 text-xs">
            <span className="font-medium text-muted-foreground">
              {lang === "th" ? "เลือกจังหวัด" : "Province"}
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
            aria-label={lang === "th" ? "เลือกช่วงเวลาย้อนหลังของกราฟ" : "Chart time horizon"}
            value={months}
            onChange={(e) => onMonthsChange(Number(e.target.value))}
            className="h-10 rounded-full border border-input bg-background px-4 text-xs font-medium text-foreground outline-none"
          >
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {m === totalAvailableMonths && m !== 12 && m !== 24
                  ? lang === "th"
                    ? `ทั้งหมดในฐานข้อมูล (${m} เดือน)`
                    : `All Available (${m} Months)`
                  : lang === "th"
                    ? `ย้อนหลัง ${m} เดือน`
                    : `Last ${m} Months`}
              </option>
            ))}
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
            {lang === "th" ? "ไปที่หน้าจำลองความเสี่ยงและจัดกลุ่ม" : "Simulation & Clustering"}
          </button>

          <button
            type="button"
            onClick={onExport}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-foreground px-4 text-xs font-medium text-background transition-opacity hover:opacity-85"
          >
            <Download aria-hidden="true" className="size-3.5" />
            {lang === "th" ? "รายงานสรุปเชิงนโยบาย" : "Policy Brief"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,33fr)_minmax(0,67fr)] lg:items-stretch">
        {/* Left Sidebar */}
        <aside className="flex flex-col gap-4">
          {selectedRanked && (
            <div className="rounded-2xl border border-border bg-secondary/45 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-foreground px-2.5 py-0.5 text-[11px] font-semibold text-background">
                  {lang === "th"
                    ? `อันดับเฝ้าระวัง #${selectedRanked.priority_rank} จาก ${provinces.length} จังหวัด`
                    : `Watchlist Rank #${selectedRanked.priority_rank} of ${provinces.length}`}
                </span>
                <span className="text-[11px] font-medium text-muted-foreground">
                  {formatGroupTag(selectedRanked.cluster_id, lang)}
                </span>
              </div>
              <p className="mt-2 text-base font-semibold text-foreground">
                {lang === "th" ? selectedRanked.name_th : selectedRanked.name_en}
              </p>
              <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                {translateClusterLabel(selectedRanked.cluster_label, lang)}
              </p>

              <div className="mt-3 grid grid-cols-3 gap-1.5">
                <div className="rounded-xl border border-border bg-background px-2.5 py-2">
                  <span className="block text-[11px] text-muted-foreground">
                    {lang === "th" ? "เงินเหลือหลังหักรายจ่าย" : "Cash Margin"}
                  </span>
                  <span className="mt-0.5 block text-xs font-semibold tabular-nums text-foreground">
                    {selectedRanked.cash_margin_pct != null
                      ? `${selectedRanked.cash_margin_pct.toFixed(0)}%`
                      : "—"}
                  </span>
                </div>
                <div className="rounded-xl border border-border bg-background px-2.5 py-2">
                  <span className="block text-[11px] text-muted-foreground">
                    {lang === "th" ? "หนี้ SME/รายได้ปี" : "SME Debt"}
                  </span>
                  <span className="mt-0.5 block text-xs font-semibold tabular-nums text-foreground">
                    {selectedRanked.sme_debt_ratio != null
                      ? lang === "th"
                        ? `${selectedRanked.sme_debt_ratio.toFixed(2)} เท่า`
                        : `${selectedRanked.sme_debt_ratio.toFixed(2)}x`
                      : "—"}
                  </span>
                </div>
                <div className="rounded-xl border border-border bg-background px-2.5 py-2">
                  <span className="block text-[11px] text-muted-foreground">
                    {lang === "th" ? "อัตราเข้าพัก" : "Occupancy"}
                  </span>
                  <span className="mt-0.5 block text-xs font-semibold tabular-nums text-foreground">
                    {selectedRanked.avg_occupancy_rate.toFixed(0)}%
                  </span>
                </div>
              </div>

              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                {translateClusterGuidance(
                  selectedRanked.cluster_label,
                  lang,
                  selectedRanked.recommended_policy,
                )}
              </p>
            </div>
          )}

          <section className="rounded-2xl border border-border bg-card">
            <div className="border-b border-border px-4 py-3.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">
                    {lang === "th"
                      ? showAllWatchlist || provinceSearch.trim()
                        ? "จัดอันดับความเปราะบางรายจังหวัด"
                        : "5 อันดับจังหวัดเฝ้าระวังสูงสุด"
                      : showAllWatchlist || provinceSearch.trim()
                        ? `All ${provinces.length} Provinces by Vulnerability Rank`
                        : "Top 5 Priority Watchlist"}
                    <InfoTooltip
                      align="left"
                      text={
                        lang === "th"
                          ? "คำนวณด้วยสูตรเดียวกับรายงานสรุป: ความเปราะบางด้านหนี้และท่องเที่ยว 38% + แรงกระแทกภายนอก 32% + เงินเหลือหลังหักรายจ่ายตึงตัว 15% + ภาระหนี้ SME 15%"
                          : "Unified with Policy Brief: 38% exposure + 32% external shock + 15% tight cash margin + 15% SME debt ratio."
                      }
                    />
                  </h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {lang === "th"
                      ? "เรียงตามความเปราะบาง ภาระหนี้ และแรงกระแทกภายนอก"
                      : "Ranked by exposure, SME debt, cash margin, and external shock"}
                  </p>
                </div>
                <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-foreground">
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
                  placeholder={
                    lang === "th" ? "ค้นหาชื่อจังหวัดเพื่อกรองดูทันที…" : "Filter province by name…"
                  }
                  className="h-9 w-full rounded-xl border border-input bg-background px-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground"
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
                          className={`inline-flex h-5 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums ${
                            isSelected
                              ? "bg-background/20 text-background"
                              : isTopThree
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
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
                            className={`block truncate text-[11px] ${
                              isSelected ? "text-background/80" : "text-muted-foreground"
                            }`}
                          >
                            {lang === "th"
                              ? `เงินเหลือ ${p.cash_margin_pct != null ? `${p.cash_margin_pct.toFixed(0)}%` : "—"} · หนี้ ${p.sme_debt_ratio != null ? `${p.sme_debt_ratio.toFixed(2)} เท่า` : "—"}`
                              : `Margin ${p.cash_margin_pct != null ? `${p.cash_margin_pct.toFixed(0)}%` : "—"} · Debt ${p.sme_debt_ratio != null ? `${p.sme_debt_ratio.toFixed(2)}x` : "—"}`}
                          </span>
                        </span>
                      </span>
                      <span
                        className={`shrink-0 text-right text-[11px] tabular-nums ${
                          isSelected ? "text-background/90" : "text-muted-foreground"
                        }`}
                      >
                        <span className="block font-medium">
                          {lang === "th"
                            ? `เข้าพัก ${p.avg_occupancy_rate.toFixed(0)}%`
                            : `Occ ${p.avg_occupancy_rate.toFixed(0)}%`}
                        </span>
                        <span className="block">
                          {lang === "th"
                            ? `แรงกระแทก ${p.shock_intensity != null ? p.shock_intensity.toFixed(0) : "—"}`
                            : `Shock ${p.shock_intensity != null ? p.shock_intensity.toFixed(0) : "—"}`}
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

          <section className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">
                  {lang === "th"
                    ? `สรุปโครงสร้างความเสี่ยง ${clusterSummaries.length} กลุ่มจังหวัด`
                    : `${clusterSummaries.length}-Group Structural Risk Summary`}
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
                        className={`size-2.5 shrink-0 rounded-full ${CLUSTER_DOT_CLASS[g.cluster_id] || "bg-slate-400"}`}
                      />
                      {formatGroupTag(g.cluster_id, lang)} · {translateClusterLabel(g.cluster_label, lang)}
                    </span>
                    <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {lang === "th" ? `${g.items.length} จังหวัด` : `${g.items.length} prov`}
                    </span>
                  </div>

                  <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                    {lang === "th"
                      ? `เงินเหลือเฉลี่ย ${g.avgMargin != null ? `${g.avgMargin.toFixed(0)}%` : "—"} · หนี้เฉลี่ย ${g.avgDebt != null ? `${g.avgDebt.toFixed(2)} เท่า` : "—"} · อัตราเข้าพัก ${g.avgOcc.toFixed(0)}%`
                      : `Avg Cash Margin ${g.avgMargin != null ? `${g.avgMargin.toFixed(0)}%` : "—"} · Debt ${g.avgDebt != null ? `${g.avgDebt.toFixed(2)}x` : "—"} · Occ ${g.avgOcc.toFixed(0)}%`}
                  </p>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {g.items.map((p) => {
                      const active = p.province_code === selectedCode
                      return (
                        <button
                          key={p.province_code}
                          type="button"
                          onClick={() => onSelectCode(p.province_code)}
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
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

          <section className="flex flex-1 flex-col justify-between rounded-2xl border border-border bg-card p-4">
            <div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">
                    {lang === "th"
                      ? "สถิติการประเมินภาระหนี้จากหน้าสาธารณะ (ไม่ระบุตัวตน)"
                      : "Anonymized Public Debt-Check Activity"}
                  </h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {lang === "th"
                      ? `ยอดกดประเมินสะสม ${demand?.total_checks ?? 0} ครั้ง (สรุประดับจังหวัด ไม่มีข้อมูลส่วนบุคคล)`
                      : `${demand?.total_checks ?? 0} aggregate checks (provincial totals with zero personal data)`}
                  </p>
                </div>
                <Gauge aria-hidden="true" className="size-4 text-muted-foreground" />
              </div>

              {demand && demand.by_province_and_band.length > 0 ? (
                <div className="mt-3.5 space-y-2.5">
                  {demand.by_province_and_band.slice(0, 6).map((row, i) => {
                    const pct = Math.min(
                      100,
                      Math.round((row.query_count / Math.max(demand.total_checks, 1)) * 100),
                    )
                    return (
                      <div key={i}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            {provNameMap.get(row.province_code) || row.province_code} ·{" "}
                            {translateDsrBand(row.dsr_band, lang)}
                          </span>
                          <span className="font-medium tabular-nums text-foreground">
                            {row.query_count}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full rounded-full bg-foreground/75"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {lang === "th"
                    ? "ยังไม่มีสถิติการกดประเมินจากหน้าสาธารณะ เมื่อประชาชนใช้งานหน้าประเมินภาระหนี้ สถิติรวมระดับจังหวัดจะแสดงที่นี่อัตโนมัติ"
                    : "No public checks logged yet. Aggregate provincial debt bands appear automatically as citizens run checks."}
                </p>
              )}
            </div>

            <div className="mt-4 rounded-xl border border-border/70 bg-secondary/30 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
              {lang === "th"
                ? "รวบรวมเฉพาะรหัสจังหวัดและระดับภาระหนี้ ไม่มีการจัดเก็บชื่อ เบอร์โทร หรือเลขบัญชี"
                : "Aggregated strictly by province code and debt service band with zero personal identifiers stored."}
            </div>
          </section>
        </aside>

        {/* Right Executive Pane */}
        <div className="flex min-w-0 flex-col gap-4">
          {distributionStats && (
            <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {lang === "th"
                      ? "การกระจายตัวและความแตกต่างระหว่างจังหวัด"
                      : "Regional Dispersion Across Provinces"}
                  </p>
                  <h2 className="mt-1 font-display text-lg font-semibold">
                    {distMetric === "margin"
                      ? lang === "th"
                        ? "การกระจายตัวของเงินเหลือหลังหักรายจ่ายผู้ประกอบการ (%)"
                        : "Distribution of SME Cash Margin (%)"
                      : distMetric === "debt"
                        ? lang === "th"
                          ? "การกระจายตัวของภาระหนี้ SME ต่อรายได้ต่อปี (เท่า)"
                          : "Distribution of SME Debt to Annual Income (x)"
                        : lang === "th"
                          ? "การกระจายตัวของอัตราเข้าพักเฉลี่ยรายจังหวัด (%)"
                          : "Distribution of Provincial Average Occupancy (%)"}
                  </h2>
                </div>

                <div
                  role="tablist"
                  aria-label={
                    lang === "th" ? "เลือกตัวชี้วัดเพื่อดูการกระจายตัว" : "Select distribution metric"
                  }
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
                        label: lang === "th" ? "หนี้ SME/รายได้ปี (เท่า)" : "SME Debt (x)",
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
                      className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
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

              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-xl border border-border bg-secondary/35 px-3 py-2.5">
                  <span className="block text-[11px] text-muted-foreground">
                    {lang === "th" ? "ค่าต่ำสุดในภูมิภาค" : "Regional Minimum"}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold tabular-nums text-foreground">
                    {formatDistVal(distributionStats.minRow.metricValue)}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {lang === "th" ? distributionStats.minRow.name_th : distributionStats.minRow.name_en}
                  </span>
                </div>

                <div className="rounded-xl border border-border bg-secondary/35 px-3 py-2.5">
                  <span className="block text-[11px] text-muted-foreground">
                    {lang === "th" ? "ค่ามัธยฐานภูมิภาค" : "Regional Median"}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold tabular-nums text-foreground">
                    {formatDistVal(distributionStats.median)}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {lang === "th" ? "จุดกึ่งกลางของการกระจายตัว" : "50th percentile benchmark"}
                  </span>
                </div>

                <div className="rounded-xl border border-border bg-secondary/35 px-3 py-2.5">
                  <span className="block text-[11px] text-muted-foreground">
                    {lang === "th" ? "ค่าเฉลี่ยภูมิภาค" : "Regional Mean"}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold tabular-nums text-foreground">
                    {formatDistVal(distributionStats.mean)}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {lang === "th"
                      ? `เส้นอ้างอิงเทียบทั้ง ${distributionStats.total} จังหวัด`
                      : `Reference across ${distributionStats.total} provinces`}
                  </span>
                </div>

                <div className="rounded-xl border border-border bg-secondary/35 px-3 py-2.5">
                  <span className="block text-[11px] text-muted-foreground">
                    {lang === "th" ? "ค่าสูงสุดในภูมิภาค" : "Regional Maximum"}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold tabular-nums text-foreground">
                    {formatDistVal(distributionStats.maxRow.metricValue)}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {lang === "th" ? distributionStats.maxRow.name_th : distributionStats.maxRow.name_en}
                  </span>
                </div>
              </div>

              {/* Stacked 3-zone proportion bar with colorblind-safe icons */}
              <div className="mt-4 rounded-xl border border-border bg-secondary/20 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-foreground">
                    {lang === "th"
                      ? "สัดส่วนจังหวัดตามเกณฑ์ความเปราะบาง"
                      : "Provincial Breakdown by Risk Zone"}
                  </span>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <AlertTriangle aria-hidden="true" className="size-3.5 text-rose-600" />
                      {distMetric === "margin"
                        ? lang === "th"
                          ? `ตึงตัว (<19%) ${distributionStats.zoneHighRisk} จังหวัด`
                          : `Tight (<19%) ${distributionStats.zoneHighRisk}`
                        : distMetric === "debt"
                          ? lang === "th"
                            ? `หนี้สูง (≥0.65 เท่า) ${distributionStats.zoneHighRisk} จังหวัด`
                            : `High Debt (>=0.65x) ${distributionStats.zoneHighRisk}`
                          : lang === "th"
                            ? `เข้าพักชะลอตัว (<52%) ${distributionStats.zoneHighRisk} จังหวัด`
                            : `Low Occ (<52%) ${distributionStats.zoneHighRisk}`}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MinusCircle aria-hidden="true" className="size-3.5 text-amber-600" />
                      {distMetric === "margin"
                        ? lang === "th"
                          ? `ปานกลาง (19–24%) ${distributionStats.zoneModerate} จังหวัด`
                          : `Moderate (19–24%) ${distributionStats.zoneModerate}`
                        : distMetric === "debt"
                          ? lang === "th"
                            ? `ปานกลาง (0.45–<0.65 เท่า) ${distributionStats.zoneModerate} จังหวัด`
                            : `Moderate (0.45–<0.65x) ${distributionStats.zoneModerate}`
                          : lang === "th"
                            ? `ท่องเที่ยวรอง (52–66%) ${distributionStats.zoneModerate} จังหวัด`
                            : `Secondary (52–66%) ${distributionStats.zoneModerate}`}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <CheckCircle2 aria-hidden="true" className="size-3.5 text-teal-600" />
                      {distMetric === "margin"
                        ? lang === "th"
                          ? `คล่องตัว (>24%) ${distributionStats.zoneHealthy} จังหวัด`
                          : `Healthy (>24%) ${distributionStats.zoneHealthy}`
                        : distMetric === "debt"
                          ? lang === "th"
                            ? `หนี้ต่ำ (<0.45 เท่า) ${distributionStats.zoneHealthy} จังหวัด`
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
                      style={{
                        width: `${(distributionStats.zoneHighRisk / distributionStats.total) * 100}%`,
                      }}
                    />
                  )}
                  {distributionStats.zoneModerate > 0 && (
                    <div
                      className="h-full bg-amber-500 transition-all"
                      style={{
                        width: `${(distributionStats.zoneModerate / distributionStats.total) * 100}%`,
                      }}
                    />
                  )}
                  {distributionStats.zoneHealthy > 0 && (
                    <div
                      className="h-full bg-teal-600 transition-all"
                      style={{
                        width: `${(distributionStats.zoneHealthy / distributionStats.total) * 100}%`,
                      }}
                    />
                  )}
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>
                    {lang === "th"
                      ? "คลิกที่แท่งจังหวัดใดก็ได้เพื่อกรองดูข้อมูลแนวโน้มและข่าวของจังหวัดนั้น"
                      : "Click any province bar to filter monthly series and news below"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <span className="inline-block h-3 w-0.5 bg-foreground" />
                    {lang === "th"
                      ? `เส้นแนวตั้งคือค่าเฉลี่ยภูมิภาค (${formatDistVal(distributionStats.mean)})`
                      : `Vertical line marks regional mean (${formatDistVal(distributionStats.mean)})`}
                  </span>
                </div>

                <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                  {distributionStats.rows.map((r) => {
                    const isSelected = r.province_code === selectedCode
                    const pct = Math.min(
                      100,
                      Math.max(4, (r.metricValue / distributionStats.maxScale) * 100),
                    )
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
                    const ZoneIcon =
                      r.zone === "risk"
                        ? AlertTriangle
                        : r.zone === "watch"
                          ? MinusCircle
                          : CheckCircle2
                    const iconColor =
                      r.zone === "risk"
                        ? "text-rose-600"
                        : r.zone === "watch"
                          ? "text-amber-600"
                          : "text-teal-600"

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
                            <ZoneIcon aria-hidden="true" className={`size-3 shrink-0 ${iconColor}`} />
                            <span className="w-4 text-[11px] font-semibold tabular-nums text-muted-foreground">
                              {r.distRank}.
                            </span>
                            <span className="truncate font-semibold text-foreground">
                              {lang === "th" ? r.name_th : r.name_en}
                            </span>
                            {isSelected && (
                              <span className="rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">
                                {lang === "th" ? "เลือกอยู่" : "Active"}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground">
                            {formatDistVal(r.metricValue)}
                            <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                              ({r.diffFromMean >= 0 ? "+" : ""}
                              {distMetric === "debt"
                                ? r.diffFromMean.toFixed(2)
                                : `${r.diffFromMean.toFixed(1)}%`}
                              )
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
                {distributionStats.missingCount > 0 && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {lang === "th"
                      ? `หมายเหตุ: ไม่แสดง ${distributionStats.missingCount} จังหวัดที่ไม่มีข้อมูลตัวชี้วัดนี้ (ไม่เติมค่าสมมติ)`
                      : `Note: ${distributionStats.missingCount} province(s) without published values are omitted (no synthetic fill).`}
                  </p>
                )}
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {lang === "th"
                    ? `การจัดกลุ่มจังหวัดปัจจุบัน · ความชัดเจนของการแยกกลุ่ม (Silhouette) ${monitor?.silhouette_score != null ? monitor.silhouette_score.toFixed(4) : "—"}`
                    : `${monitor?.model_used || "KMeans"} · Silhouette ${monitor?.silhouette_score != null ? monitor.silhouette_score.toFixed(4) : "—"}`}
                  <InfoTooltip
                    align="left"
                    text={
                      lang === "th"
                        ? "ค่า Silhouette อยู่ระหว่าง -1 ถึง 1 ยิ่งเข้าใกล้ 1 แปลว่าจังหวัดในกลุ่มเดียวกันมีโครงสร้างใกล้เคียงกันและแยกจากกลุ่มอื่นชัดเจน"
                        : "Silhouette ranges from -1 to 1. Higher scores mean clearer separation between provincial groups."
                    }
                  />
                </p>
                <h2 className="mt-1 font-display text-lg font-semibold">
                  {lang === "th"
                    ? `แผนภาพการกระจายตัว ${clusterSummaries.length || 4} กลุ่มจังหวัดตามความเปราะบางและแรงกระแทกภายนอก`
                    : `${clusterSummaries.length || 4}-Group Regional Positioning (Exposure vs. External Shock)`}
                </h2>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
                {clusterSummaries.map((g) => (
                  <ClusterLegend
                    key={g.cluster_id}
                    color={CLUSTER_DOT_CLASS[g.cluster_id] || "bg-slate-400"}
                    label={`${formatGroupTag(g.cluster_id, lang)} ${translateClusterLabel(g.cluster_label, lang)}`}
                  />
                ))}
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
                      ? `แนวโน้มรายเดือนทางการ: จังหวัด${selected.name_th} (อัตราเข้าพัก เทียบกับ PM2.5 และแรงกระแทกภายนอก)`
                      : `Official Monthly Series: ${selected.name_en} (Occupancy vs. PM2.5 & External Shock)`
                    : lang === "th"
                      ? "แนวโน้มรายเดือนทางการรายจังหวัด"
                      : "Official Provincial Monthly Series"}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {lang === "th"
                    ? "ข้อมูลรายเดือนจากกระทรวงการท่องเที่ยวและกีฬา (MOTS) ร่วมกับข้อมูลสภาพอากาศและดัชนีแรงกระแทกภายนอก"
                    : "Official MOTS monthly occupancy paired with weather readings and external shock indices"}
                </p>
              </div>
              <span className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground">
                {months} {lang === "th" ? "เดือน" : "months"}
              </span>
            </div>
            {detailError ? (
              <div className="mt-3 flex h-[240px] items-center justify-center rounded-xl border border-destructive/25 bg-destructive/5 px-4 text-center text-xs text-destructive">
                {detailError}
              </div>
            ) : detail ? (
              <ProvinceHistoryChart series={detail.monthly_series} months={months} lang={lang} />
            ) : (
              <div className="flex h-[240px] items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                <span>{lang === "th" ? "กำลังโหลดข้อมูลรายเดือน…" : "Loading monthly series…"}</span>
              </div>
            )}
          </section>

          <section className="flex flex-1 flex-col justify-between rounded-2xl border border-border bg-card p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-semibold">
                  {lang === "th"
                    ? "ข่าวเศรษฐกิจและเหตุการณ์ที่ตรวจสอบแล้ว"
                    : "Verified Regional News"}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selected ? (lang === "th" ? `จังหวัด${selected.name_th}` : selected.name_en) : ""}
                </p>
              </div>
              <ShieldCheck aria-hidden="true" className="size-4 text-muted-foreground" />
            </div>

            {detailError ? (
              <p className="mt-4 text-xs text-destructive">{detailError}</p>
            ) : !detail ? (
              <p className="mt-4 text-xs text-muted-foreground">
                {lang === "th"
                  ? "กำลังดึงข่าวที่ตรวจสอบแล้วของจังหวัดนี้…"
                  : "Loading verified provincial news…"}
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
                        <span className="block text-[11px] text-muted-foreground">
                          {n.event_date} · {translateShockType(n.shock_type, lang)} ·{" "}
                          {n.shock_type !== "policy_relief" && (
                            <>
                              {" · "}
                              {lang === "th" ? `ความรุนแรง ${n.severity_score}/5` : `Sev ${n.severity_score}/5`}
                            </>
                          )}
                        </span>
                        <span className="mt-1 block line-clamp-2 text-xs font-medium text-foreground">
                          {n.evidence_quote || n.title}
                        </span>
                      </span>
                      <ExternalLink
                        aria-hidden="true"
                        className="mt-1 size-3.5 shrink-0 text-muted-foreground"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">
                {lang === "th"
                  ? "ไม่พบข่าวเหตุการณ์ที่ตรวจสอบแล้วในจังหวัดนี้ในช่วงเวลาล่าสุด (สามารถกดดึงข้อมูลสดเพื่ออัปเดตได้)"
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
  provincesCount,
  onPublished,
  onUnauthorized,
  onMonteCarloMeasured,
  onClusterMeasured,
}: {
  token: string
  monitor: PolicyMonitorResponse | null
  provincesCount: number
  onPublished: () => void
  onUnauthorized: () => void
  onMonteCarloMeasured: (ms: number) => void
  onClusterMeasured: (ms: number) => void
}) {
  const { lang } = useAppState()

  // Empirical Bootstrap Monte Carlo state
  const [horizonMonths, setHorizonMonths] = useState(3)
  const [costShockPct, setCostShockPct] = useState(5)
  const [nSimulations, setNSimulations] = useState(3000)
  const [includeNewsRegime, setIncludeNewsRegime] = useState(true)
  const [mcData, setMcData] = useState<StaffMonteCarloResponse | null>(null)
  const [mcLoading, setMcLoading] = useState(false)
  const [mcError, setMcError] = useState<string | null>(null)
  const mcAbortRef = useRef<AbortController | null>(null)

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
  const [clusterError, setClusterError] = useState<string | null>(null)
  const [publishNote, setPublishNote] = useState<string | null>(null)
  const clusterAbortRef = useRef<AbortController | null>(null)

  const timeSeriesScreening = (monitor?.feature_screening ?? []).filter(
    (r) => r.is_selected && r.spearman_r != null && r.p_value != null,
  )
  const actualHistoryMonths = mcData?.history_months_used ?? monitor?.panel_months ?? 0

  // Detect whether current selected features or k differ from the last computed clustering result
  const hasPendingClusterChanges = useMemo(() => {
    if (!clusterData) return false
    if (clusterData.k !== kVal) return true
    const computedKeys = new Set(clusterData.selected_features.map((f) => f.feature_key))
    if (computedKeys.size !== selectedFeatures.length) return true
    return selectedFeatures.some((k) => !computedKeys.has(k))
  }, [clusterData, kVal, selectedFeatures])

  const executeMonteCarlo = useCallback(
    async (h: number, c: number, news: boolean, nDraws: number) => {
      mcAbortRef.current?.abort()
      const controller = new AbortController()
      mcAbortRef.current = controller

      setMcLoading(true)
      setMcError(null)
      try {
        const res = await runStaffMonteCarlo(
          token,
          {
            horizon_months: h,
            cost_shock_pct: c,
            include_news_regime: news,
            n_simulations: nDraws,
          },
          controller.signal,
        )
        setMcData(res)
        if (typeof res.compute_ms === "number") {
          onMonteCarloMeasured(Math.round(res.compute_ms))
        }
      } catch (err) {
        if (isAbortError(err)) return
        if (isUnauthorizedError(err)) {
          onUnauthorized()
          return
        }
        setMcError(
          err instanceof Error
            ? err.message
            : lang === "th"
              ? "ไม่สามารถประมวลผลการจำลองมอนติคาร์โลได้"
              : "Failed to run Monte Carlo simulation",
        )
      } finally {
        if (mcAbortRef.current === controller) {
          setMcLoading(false)
        }
      }
    },
    [token, lang, onMonteCarloMeasured, onUnauthorized],
  )

  const executeRecluster = useCallback(
    async (kInput: number, feats: string[], persist: boolean) => {
      clusterAbortRef.current?.abort()
      const controller = new AbortController()
      clusterAbortRef.current = controller

      setClusterLoading(true)
      setClusterError(null)
      setPublishNote(null)
      try {
        const res = await runStaffRecluster(
          token,
          {
            k: kInput,
            feature_keys: feats,
            persist,
          },
          controller.signal,
        )
        setClusterData(res)
        if (typeof res.compute_ms === "number") {
          onClusterMeasured(Math.round(res.compute_ms))
        }
        if (persist) {
          setPublishNote(
            lang === "th"
              ? "บันทึกผลการจัดกลุ่มจังหวัดใหม่ลงฐานข้อมูลหลักเรียบร้อยแล้ว"
              : "Saved new provincial clustering assignments to the primary database.",
          )
          onPublished()
        }
      } catch (err) {
        if (isAbortError(err)) return
        if (isUnauthorizedError(err)) {
          onUnauthorized()
          return
        }
        setClusterError(
          err instanceof Error
            ? err.message
            : lang === "th"
              ? "ไม่สามารถคำนวณการจัดกลุ่มจังหวัดได้"
              : "Failed to run provincial clustering",
        )
      } finally {
        if (clusterAbortRef.current === controller) {
          setClusterLoading(false)
        }
      }
    },
    [token, lang, onClusterMeasured, onPublished, onUnauthorized],
  )

  useEffect(() => {
    void executeMonteCarlo(3, 5, true, 3000)
    void executeRecluster(4, selectedFeatures, false)
    return () => {
      mcAbortRef.current?.abort()
      clusterAbortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    if (!publishNote) return
    const timer = setTimeout(() => {
      setPublishNote(null)
    }, 4500)
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

  const totalProvDisplay = provincesCount || mcData?.provinces.length || 17

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {lang === "th"
            ? "แบบจำลองความเสี่ยงเชิงความน่าจะเป็นและการจัดกลุ่มจังหวัดแบบปรับเปลี่ยนได้"
            : "Probabilistic Monte Carlo Risk & Dynamic Provincial Clustering Lab"}
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {lang === "th"
            ? "จำลองความเสี่ยงกระแสเงินสดและจัดกลุ่มจังหวัด"
            : "Cashflow Risk Simulation & Dynamic Provincial Clustering"}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          {lang === "th"
            ? `ใช้ประวัติความผันผวนจริงจากฐานข้อมูล${actualHistoryMonths > 0 ? ` (${actualHistoryMonths} เดือน)` : ""} ร่วมกับข่าวเหตุการณ์รุนแรงล่าสุดเพื่อสุ่มจำลองความเสี่ยงแบบ Bootstrap ตามจำนวนรอบที่กำหนดเอง และปรับตัวแปรจัดกลุ่มจังหวัดได้ทันที`
            : `Uses real provincial history${actualHistoryMonths > 0 ? ` (${actualHistoryMonths} months)` : ""} paired with verified severe news events for configurable Empirical Bootstrap Monte Carlo stress testing and KMeans clustering.`}
        </p>
      </div>

      {/* Section 1: Empirical Bootstrap Monte Carlo */}
      <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-foreground">
              <Sparkles aria-hidden="true" className="size-3.5" />
              {lang === "th"
                ? `โมเดลที่ 1 · มอนติคาร์โลแบบสุ่มซ้ำจากข้อมูลจริง / Empirical Bootstrap (${nSimulations.toLocaleString()} รอบ${mcData?.compute_ms != null ? ` · ${mcData.compute_ms} มิลลิวินาที` : ""})`
                : `Model 1 · Empirical Bootstrap Monte Carlo (${nSimulations.toLocaleString()} draws${mcData?.compute_ms != null ? ` · ${mcData.compute_ms} ms` : ""})`}
            </span>
            <h2 className="mt-2 font-display text-xl font-semibold text-foreground">
              {lang === "th"
                ? "ประเมินโอกาสขาดสภาพคล่องรายจังหวัดและมูลค่าความเสี่ยงรายได้ (VaR / CVaR)"
                : "Regional Revenue Value at Risk & Provincial Cashflow Deficit Probability"}
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {lang === "th"
                ? `สุ่มซ้ำแบบ Bootstrap จากประวัติรายได้จริงในฐานข้อมูล${actualHistoryMonths > 0 ? ` (${actualHistoryMonths} เดือน${mcData?.data_range_start && mcData?.data_range_end ? ` · ${formatThaiMonth(mcData.data_range_start, lang)} ถึง ${formatThaiMonth(mcData.data_range_end, lang)}` : ""})` : ""} ร่วมกับสัดส่วนรายจ่ายผู้ประกอบการ ปรับจำนวนรอบจำลองได้เอง (ยิ่งสุ่มมากความคลาดเคลื่อนเชิงสถิติยิ่งลดลง)`
                : `Bootstraps real database revenue history${actualHistoryMonths > 0 ? ` (${actualHistoryMonths} months)` : ""} paired with NSO expense ratios. Draw count is configurable (higher draws reduce quantile standard error).`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">{lang === "th" ? "จำนวนรอบ:" : "Draws:"}</span>
              {[1000, 3000, 5000].map((draws) => (
                <button
                  key={draws}
                  type="button"
                  aria-pressed={nSimulations === draws}
                  onClick={() => {
                    setNSimulations(draws)
                    void executeMonteCarlo(horizonMonths, costShockPct, includeNewsRegime, draws)
                  }}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    nSimulations === draws
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
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
                  aria-pressed={horizonMonths === h}
                  onClick={() => {
                    setHorizonMonths(h)
                    void executeMonteCarlo(h, costShockPct, includeNewsRegime, nSimulations)
                  }}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    horizonMonths === h
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {h} {lang === "th" ? "เดือน" : "mo"}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">{lang === "th" ? "ต้นทุนเพิ่ม:" : "Cost shock:"}</span>
              {[0, 5, 10, 15].map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={costShockPct === c}
                  onClick={() => {
                    setCostShockPct(c)
                    void executeMonteCarlo(horizonMonths, c, includeNewsRegime, nSimulations)
                  }}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    costShockPct === c
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  +{c}%
                </button>
              ))}
            </div>

            {/* Stable label + explicit ON/OFF pill + aria-pressed */}
            <button
              type="button"
              aria-pressed={includeNewsRegime}
              onClick={() => {
                const next = !includeNewsRegime
                setIncludeNewsRegime(next)
                void executeMonteCarlo(horizonMonths, costShockPct, next, nSimulations)
              }}
              className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                includeNewsRegime
                  ? "border-amber-600/40 bg-amber-500/15 text-amber-950 dark:text-amber-200"
                  : "border-border bg-background text-muted-foreground"
              }`}
            >
              <AlertTriangle aria-hidden="true" className="size-3.5" />
              <span>{lang === "th" ? "รวมผลข่าวเหตุการณ์รุนแรง" : "Include Severe News Events"}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  includeNewsRegime
                    ? "bg-amber-700 text-white"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                {includeNewsRegime ? (lang === "th" ? "เปิด" : "ON") : lang === "th" ? "ปิด" : "OFF"}
              </span>
            </button>
          </div>
        </div>

        {mcError && (
          <div
            role="alert"
            className="mt-4 flex items-center justify-between gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive"
          >
            <span>{mcError}</span>
            <button
              type="button"
              onClick={() =>
                void executeMonteCarlo(horizonMonths, costShockPct, includeNewsRegime, nSimulations)
              }
              className="shrink-0 rounded-full border border-destructive/30 px-3 py-1 font-medium hover:bg-destructive/10"
            >
              {lang === "th" ? "ลองใหม่" : "Retry"}
            </button>
          </div>
        )}

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
          <div className={`relative transition-opacity ${mcLoading ? "opacity-55" : "opacity-100"}`}>
            {mcLoading && (
              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-foreground">
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                <span>
                  {lang === "th"
                    ? "กำลังคำนวณรอบจำลองใหม่ตามพารามิเตอร์ที่เลือก…"
                    : "Recalculating simulation with updated parameters…"}
                </span>
              </div>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-border bg-secondary/35 p-4">
                <p className="text-xs text-muted-foreground">
                  {lang === "th" ? "ความสูญเสียรายได้เฉลี่ยต่อเดือน" : "Expected Monthly Revenue Loss"}
                </p>
                <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">
                  {mcData.regional_metrics.expected_monthly_loss_mthb.toLocaleString()}{" "}
                  {lang === "th" ? "ล้านบาท" : "M THB"}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {lang === "th"
                    ? `ค่ามัธยฐาน ${mcData.regional_metrics.median_monthly_loss_mthb.toLocaleString()} ล้านบาท/เดือน`
                    : `Median ${mcData.regional_metrics.median_monthly_loss_mthb.toLocaleString()} M THB/mo`}
                </p>
              </div>

              <div className="rounded-2xl border border-amber-600/30 bg-amber-500/5 p-4">
                <p className="text-xs font-medium text-amber-900 dark:text-amber-300">
                  {lang === "th"
                    ? "ความเสียหายขั้นต่ำกรณีเลวร้าย 5% (VaR 95%)"
                    : "95% Value at Risk (VaR 95%)"}
                  <InfoTooltip
                    text={
                      lang === "th"
                        ? "VaR 95% ไม่ใช่ความเสียหายสูงสุด แต่คือระดับความเสียหายขั้นต่ำที่ 5% ของกรณีเลวร้ายที่สุดจะเกินกว่านี้ (โอกาสเกิด 1 ใน 20)"
                        : "VaR 95% is not a maximum cap; it is the loss threshold exceeded in the worst 5% of scenarios."
                    }
                  />
                </p>
                <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-amber-900 dark:text-amber-300">
                  {mcData.regional_metrics.var95_monthly_loss_mthb.toLocaleString()}{" "}
                  {lang === "th" ? "ล้านบาท" : "M THB"}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {lang === "th"
                    ? "ระดับความเสียหายที่จะถูกเกินในกรณีเลวร้าย 5% ท้ายสุด"
                    : "Loss threshold exceeded in the worst 5% of monthly draws"}
                </p>
              </div>

              <div className="rounded-2xl border border-red-600/30 bg-red-500/5 p-4">
                <p className="text-xs font-medium text-red-900 dark:text-red-300">
                  {lang === "th"
                    ? "ความสูญเสียเฉลี่ยในกรณีเลวร้าย 5% ท้ายสุด (CVaR 95%)"
                    : "95% Expected Shortfall (CVaR 95%)"}
                  <InfoTooltip
                    text={
                      lang === "th"
                        ? "ค่าเฉลี่ยความเสียหายเมื่อสถานการณ์หลุดเข้าไปอยู่ในกลุ่มเลวร้าย 5% ท้ายสุด เหมาะใช้ประเมินวงเงินรองรับกรณีฉุกเฉิน"
                        : "Average monthly loss conditional on falling inside the worst 5% tail scenarios."
                    }
                  />
                </p>
                <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-red-800 dark:text-red-300">
                  {mcData.regional_metrics.cvar95_monthly_loss_mthb.toLocaleString()}{" "}
                  {lang === "th" ? "ล้านบาท" : "M THB"}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {lang === "th"
                    ? "ค่าเฉลี่ยความเสียหายเมื่อเกิดแรงกระแทกซ้อนทับรุนแรง"
                    : "Average monthly loss inside the worst 5% tail scenarios"}
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-secondary/35 p-4">
                <p className="text-xs text-muted-foreground">
                  {lang === "th"
                    ? "จังหวัดที่เสี่ยงขาดสภาพคล่อง (กรณีเลวร้าย 5% ท้าย)"
                    : "Provinces in Cashflow Deficit (95th Pct)"}
                </p>
                <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-foreground">
                  {mcData.regional_metrics.p95_breaching_provinces} / {totalProvDisplay}{" "}
                  {lang === "th" ? "จังหวัด" : "provinces"}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {lang === "th"
                    ? `จังหวัดที่รายจ่ายรวมสูงกว่ารายได้จากการสุ่ม ${mcData.n_simulations.toLocaleString()} รอบ`
                    : `Provinces where expenses exceed revenue across ${mcData.n_simulations.toLocaleString()} draws`}
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[5fr_7fr]">
              <div className="rounded-2xl border border-border bg-background p-4">
                <p className="text-xs font-semibold text-foreground">
                  {lang === "th"
                    ? "กราฟการแจกแจงโอกาสเกิดความสูญเสียรายได้ทั้งภาคเหนือ (ล้านบาท/เดือน)"
                    : "Regional Monthly Revenue Loss Distribution (M THB)"}
                </p>
                <p className="mb-3 mt-0.5 text-[11px] text-muted-foreground">
                  {lang === "th"
                    ? "แท่งสีแดงคือกลุ่มสถานการณ์เลวร้าย 5% ท้ายสุด (เกินระดับ VaR 95%) ที่ควรเตรียมวงเงินมาตรการรองรับ"
                    : "Crimson bars indicate the worst 5% tail risk exceeding VaR 95%."}
                </p>
                <div className="h-[230px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={mcData.loss_distribution}
                      margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 5"
                        vertical={false}
                        className="stroke-border"
                      />
                      <XAxis
                        dataKey="bin_mid_mthb"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        tickLine={false}
                        axisLine={false}
                        unit="%"
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(100, 116, 139, 0.12)", radius: 6 }}
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null
                          const item = payload[0]
                          const isTail = Boolean(item.payload?.is_tail_risk)
                          const lossVal = Number(label)
                          const freqVal = Number(item.value)
                          return (
                            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
                              <p className="font-semibold">
                                {lang === "th"
                                  ? `ความสูญเสียประมาณ ${Number.isFinite(lossVal) ? lossVal.toLocaleString() : label} ล้านบาท/เดือน`
                                  : `Loss ~${Number.isFinite(lossVal) ? lossVal.toLocaleString() : label} M THB/mo`}
                              </p>
                              <div className="mt-1 flex items-center gap-2 text-[11px]">
                                <span
                                  className={`size-2 rounded-full ${isTail ? "bg-red-700" : "bg-slate-700"}`}
                                />
                                <span className="text-slate-500 dark:text-zinc-400">
                                  {lang === "th" ? "ความถี่:" : "Frequency:"}
                                </span>
                                <span className="font-semibold tabular-nums">
                                  {freqVal}% {lang === "th" ? "ของรอบจำลองทั้งหมด" : "of draws"}
                                </span>
                              </div>
                              {isTail && (
                                <p className="mt-1 text-[10px] font-medium text-red-700 dark:text-red-400">
                                  {lang === "th"
                                    ? "อยู่ในกลุ่มเลวร้าย 5% ท้ายสุด (เกิน VaR 95%)"
                                    : "Worst 5% tail risk (exceeds VaR 95%)"}
                                </p>
                              )}
                            </div>
                          )
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

              <div className="rounded-2xl border border-border bg-background p-4">
                <p className="text-xs font-semibold text-foreground">
                  {lang === "th"
                    ? `จัดอันดับจังหวัดตามโอกาสที่ผู้ประกอบการจะขาดสภาพคล่อง (จากการจำลอง ${mcData.n_simulations.toLocaleString()} รอบ)`
                    : `Provincial Cashflow Deficit Probability Ranking (${mcData.n_simulations.toLocaleString()} Draws)`}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {lang === "th"
                    ? "ช่วยจัดลำดับความสำคัญว่าควรส่งมาตรการปรับโครงสร้างหนี้และพักชำระเงินต้นลงพื้นที่ใดก่อน"
                    : "Identifies priority provinces requiring immediate liquidity and debt restructuring deployment."}
                </p>
                <div className="mt-3 max-h-[245px] overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-secondary/85 text-[11px] text-muted-foreground backdrop-blur-sm">
                      <tr className="border-b border-border">
                        <th className="px-2.5 py-2 font-medium">{lang === "th" ? "จังหวัด" : "Province"}</th>
                        <th className="px-2 py-2 text-right font-medium">
                          {lang === "th" ? "เงินเหลือเดิม" : "Base Margin"}
                        </th>
                        <th className="px-2 py-2 text-right font-medium">
                          {lang === "th" ? "โอกาสเงินสดติดลบ" : "Deficit Prob."}
                        </th>
                        <th className="px-2 py-2 text-right font-medium">
                          {lang === "th" ? "เงินเหลือ (5% ท้าย)" : "Worst 5% Margin"}
                        </th>
                        <th className="px-2.5 py-2 text-right font-medium">
                          {lang === "th" ? "ความเสียหาย (VaR 95%)" : "VaR 95% Loss"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {mcData.provinces.map((p) => (
                        <tr key={p.province_code} className="border-b border-border/50 last:border-0">
                          <td className="px-2.5 py-2 font-medium text-foreground">
                            <span>{lang === "th" ? p.name_th : p.name_en}</span>
                            {p.has_active_water_alert && (
                              <span className="ml-1.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:text-amber-200">
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
                                  ? "text-red-700 dark:text-red-400"
                                  : p.deficit_probability_pct >= 20
                                    ? "text-amber-700 dark:text-amber-400"
                                    : "text-teal-700 dark:text-teal-400"
                              }
                            >
                              {p.deficit_probability_pct.toFixed(1)}%
                            </span>
                          </td>
                          <td
                            className={`px-2 py-2 text-right tabular-nums ${
                              p.p95_worst_margin_pct < 0
                                ? "font-semibold text-red-700 dark:text-red-400"
                                : "text-muted-foreground"
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
          </div>
        ) : null}
      </section>

      {/* Section 2: Interactive KMeans Provincial Clustering & Live VIF */}
      <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-foreground">
              <Layers aria-hidden="true" className="size-3.5" />
              {lang === "th"
                ? "โมเดลที่ 2 · ระบบจัดกลุ่มจังหวัดและตรวจสอบความซ้ำซ้อนของตัวแปร (KMeans & VIF)"
                : "Model 2 · Interactive KMeans Provincial Clustering & Live VIF"}
            </span>
            <h2 className="mt-2 font-display text-xl font-semibold text-foreground">
              {lang === "th"
                ? "ปรับจำนวนกลุ่มและเลือกตัวแปรเพื่อจัดกลุ่มจังหวัดและออกแบบชุดมาตรการ"
                : "Customize Provincial Groups, Check Variable Collinearity & Generate Targeted Playbooks"}
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {lang === "th"
                ? "เลือกตัวแปรอย่างน้อย 3 ตัวแปรแล้วกดคำนวณ ระบบจะคำนวณค่าความซ้ำซ้อนของตัวแปร (VIF) และแจ้งเตือนด้วยป้ายสีเหลืองเมื่อเกิน 5.0"
                : "Select at least 3 variables and click Run Clustering. Live VIF scores are computed and flagged in amber when exceeding 5.0."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">{lang === "th" ? "จำนวนกลุ่ม:" : "Groups:"}</span>
              {[3, 4, 5].map((num) => (
                <button
                  key={num}
                  type="button"
                  aria-pressed={kVal === num}
                  onClick={() => setKVal(num)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    kVal === num
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {num} {lang === "th" ? "กลุ่ม" : "groups"}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={clusterLoading}
              onClick={() => void executeRecluster(kVal, selectedFeatures, false)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-xs font-medium transition-colors disabled:opacity-60 ${
                hasPendingClusterChanges
                  ? "border-amber-600 bg-amber-500/15 text-amber-950 hover:bg-amber-500/25 dark:text-amber-200"
                  : "border-border bg-background text-foreground hover:bg-secondary"
              }`}
            >
              {clusterLoading ? (
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              ) : (
                <Play aria-hidden="true" className="size-3.5" />
              )}
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

        {clusterError && (
          <div
            role="alert"
            className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-xs text-destructive"
          >
            <span>{clusterError}</span>
            <button
              type="button"
              onClick={() => void executeRecluster(kVal, selectedFeatures, false)}
              className="shrink-0 rounded-full border border-destructive/30 px-3 py-1 font-medium hover:bg-destructive/10"
            >
              {lang === "th" ? "ลองใหม่" : "Retry"}
            </button>
          </div>
        )}

        {publishNote && (
          <div className="mt-3 rounded-xl border border-emerald-700/25 bg-emerald-700/10 px-4 py-2 text-xs font-medium text-emerald-900 dark:text-emerald-200">
            {publishNote}
          </div>
        )}

        {hasPendingClusterChanges && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-600/35 bg-amber-500/10 px-4 py-2 text-xs text-amber-950 dark:text-amber-200">
            <span>
              {lang === "th"
                ? "มีการปรับจำนวนกลุ่มหรือตัวแปร — ผลลัพธ์และค่า VIF ด้านล่างยังเป็นของรอบก่อน กด “คำนวณการจัดกลุ่มใหม่” เพื่ออัปเดต"
                : "Group count or variables changed — results and VIF badges below reflect the previous run. Click “Run Clustering” to update."}
            </span>
          </div>
        )}

        {clusterData && (
          <div className={`transition-opacity ${clusterLoading ? "opacity-55" : "opacity-100"}`}>
            <div className="mt-4 rounded-2xl border border-border bg-secondary/30 p-4">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">
                  {lang === "th"
                    ? "เลือกตัวแปรที่ใช้จัดกลุ่ม (อย่างน้อย 3 ตัวแปร · แจ้งเตือนเมื่อค่าความซ้ำซ้อน VIF เกิน 5.0)"
                    : "Select clustering variables (minimum 3 · alerts when VIF exceeds 5.0)"}
                  <InfoTooltip
                    align="left"
                    text={
                      lang === "th"
                        ? "VIF (Variance Inflation Factor) ใช้วัดว่าตัวแปรที่เลือกซ้ำซ้อนกันเองหรือไม่ หากเกิน 5.0 ควรพิจารณาตัดตัวแปรที่ซ้ำออกเพื่อไม่ให้โมเดลถ่วงน้ำหนักเอียง"
                        : "VIF measures multicollinearity among chosen variables. Values above 5.0 indicate redundancy."
                    }
                  />
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-background px-3 py-1 font-medium text-foreground">
                    {lang === "th"
                      ? `ความชัดเจนของการแยกกลุ่ม (Silhouette) ${clusterData.silhouette_score.toFixed(4)}`
                      : `Silhouette ${clusterData.silhouette_score.toFixed(4)}`}
                    <InfoTooltip
                      text={
                        lang === "th"
                          ? "ค่าเต็ม 1.0 ยิ่งสูงยิ่งดี แสดงว่าแต่ละกลุ่มแยกออกจากกันได้ชัดเจน"
                          : "Ranges from -1 to 1; higher values indicate better-defined clusters."
                      }
                    />
                  </span>
                  <span className="rounded-full bg-background px-3 py-1 text-muted-foreground">
                    {lang === "th"
                      ? `ดัชนีความซ้อนทับระหว่างกลุ่ม (DBI · ยิ่งต่ำยิ่งดี) ${clusterData.davies_bouldin_index.toFixed(4)}`
                      : `DBI (lower is better) ${clusterData.davies_bouldin_index.toFixed(4)}`}
                    <InfoTooltip
                      align="right"
                      text={
                        lang === "th"
                          ? "Davies-Bouldin Index (DBI) วัดความซ้อนทับระหว่างกลุ่ม ยิ่งเข้าใกล้ 0 แปลว่าแต่ละกลุ่มแยกขาดจากกันดี"
                          : "Davies-Bouldin Index measures inter-cluster overlap; values closer to 0 are better."
                      }
                    />
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {clusterData.available_catalog.map((cat) => {
                  const isChecked = selectedFeatures.includes(cat.feature_key)
                  const vifObj = clusterData.selected_features.find(
                    (f) => f.feature_key === cat.feature_key,
                  )
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
                          className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                            vifObj.is_collinear
                              ? "bg-amber-400 text-black"
                              : isChecked
                                ? "bg-background/20 text-background"
                                : "bg-secondary text-foreground"
                          }`}
                        >
                          VIF {vifObj.vif_score}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {clusterData.groups.map((grp) => {
                const groupColor = CLUSTER_COLORS[grp.cluster_id] || grp.color
                return (
                  <div
                    key={grp.cluster_id}
                    className="flex flex-col justify-between rounded-2xl border border-border bg-background p-4"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            style={{ backgroundColor: groupColor }}
                            className="size-3 shrink-0 rounded-full"
                            aria-hidden="true"
                          />
                          <h3 className="font-display text-sm font-semibold text-foreground sm:text-base">
                            {lang === "th" ? grp.title_th : grp.title_en}
                          </h3>
                        </div>
                        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-semibold text-foreground">
                          {grp.province_count} {lang === "th" ? "จังหวัด" : "provinces"}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-secondary/40 p-2.5 text-center text-xs">
                        <div>
                          <p className="text-[11px] text-muted-foreground">
                            {lang === "th" ? "เงินเหลือเฉลี่ย" : "Avg Cash Margin"}
                          </p>
                          <p className="font-semibold text-foreground">{grp.avg_cash_margin_pct}%</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-muted-foreground">
                            {lang === "th" ? "หนี้ SME/รายได้ปี" : "SME Debt Ratio"}
                          </p>
                          <p className="font-semibold text-foreground">
                            {grp.avg_sme_debt_ratio} {lang === "th" ? "เท่า" : "x"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] text-muted-foreground">
                            {lang === "th" ? "อัตราเข้าพักเฉลี่ย" : "Avg Occupancy"}
                          </p>
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
                        {lang === "th" ? "มาตรการที่แนะนำสำหรับกลุ่มนี้: " : "Targeted Policy Prescription: "}
                      </span>
                      <span className="text-muted-foreground">
                        {lang === "th" ? grp.recommended_policy_th : grp.recommended_policy_en}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {/* Section 3: Automated Empirical Feature Screening Table */}
      {timeSeriesScreening.length > 0 && (
        <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
          <div>
            <h2 className="font-display text-lg font-semibold">
              {lang === "th"
                ? "ตารางผลการคัดเลือกตัวแปรทางสถิติอัตโนมัติ (อัปเดตตามข้อมูลใหม่ในระบบ)"
                : "Automated Empirical Feature Screening Table"}
              <InfoTooltip
                align="left"
                text={
                  lang === "th"
                    ? "Spearman r วัดความสัมพันธ์ร่วมกันของ 2 ตัวแปร (ไม่ใช่การพิสูจน์สาเหตุโดยตรง) โดยคัดเฉพาะตัวแปรที่ p-value < 0.05 และ VIF < 5.0"
                    : "Spearman r measures statistical correlation (not direct causation), screened at p < 0.05 and VIF < 5.0."
                }
              />
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {lang === "th"
                ? "คัดเฉพาะตัวแปรที่มีความสัมพันธ์เชิงสถิติกับภาคบริการอย่างมีนัยสำคัญ (p-value < 0.05) และไม่ซ้ำซ้อนกันเอง (VIF < 5.0)"
                : "Screened via within-province lag correlation (p < 0.05) and low multicollinearity (VIF < 5.0)."}
            </p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-[11px] text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">
                    {lang === "th" ? "ตัวแปรปัจจัย" : "Driver Indicator"}
                  </th>
                  <th className="py-2 pr-3 font-medium">
                    {lang === "th" ? "ตัวชี้วัดเป้าหมาย" : "Target Metric"}
                  </th>
                  <th className="py-2 pr-3 font-medium">
                    {lang === "th" ? "ระยะหน่วงเวลา (เดือน)" : "Lag (Months)"}
                  </th>
                  <th className="py-2 pr-3 font-medium">
                    {lang === "th" ? "ค่าสหสัมพันธ์ (Spearman r)" : "Spearman r"}
                  </th>
                  <th className="py-2 pr-3 font-medium">
                    {lang === "th" ? "ค่านัยสำคัญ (p-value)" : "p-value"}
                  </th>
                  <th className="py-2 font-medium">
                    {lang === "th" ? "ความซ้ำซ้อนของตัวแปร (VIF)" : "VIF"}
                  </th>
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
                      {r.spearman_r != null
                        ? `${r.spearman_r >= 0 ? "+" : ""}${r.spearman_r.toFixed(3)}`
                        : "—"}
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
  benchmarkError,
  onRunBenchmark,
}: {
  health: DataHealthResponse | null
  cachedFetchMs: number | null
  freshDbFetchMs: number | null
  mcComputeMs: number | null
  clusterComputeMs: number | null
  testingSpeed: boolean
  benchmarkError: string | null
  onRunBenchmark: () => void
}) {
  const { lang } = useAppState()
  const c = health?.layer_counts
  const evalRun = health?.latest_eval_runs.find((r) => r.run_type === "full_7d_evaluation")
  const eval7d = evalRun?.metrics_json
  const evalRanDate = evalRun?.ran_at ? String(evalRun.ran_at).slice(0, 16).replace("T", " ") : null

  const ragMedianMs =
    typeof eval7d?.dim2_rag_qa?.median_latency_ms === "number"
      ? eval7d.dim2_rag_qa.median_latency_ms
      : null
  const ragTrapMs =
    typeof eval7d?.dim2_rag_qa?.mean_trap_latency_ms === "number"
      ? eval7d.dim2_rag_qa.mean_trap_latency_ms
      : null

  function latencyTone(ms: number | null): string {
    if (ms === null) return "text-muted-foreground"
    if (ms <= 300) return "text-emerald-700 dark:text-emerald-400"
    if (ms <= 1500) return "text-amber-700 dark:text-amber-400"
    return "text-red-700 dark:text-red-400"
  }

  function latencyStatusNote(ms: number | null): string {
    if (ms === null) return lang === "th" ? "ยังไม่ได้วัดค่าในรอบนี้" : "Not measured in this session yet"
    if (ms <= 300) return lang === "th" ? "ตอบสนองเร็ว (ต่ำกว่า 300 มิลลิวินาที)" : "Fast response (< 300 ms)"
    if (ms <= 1500) return lang === "th" ? "ปานกลาง (เชื่อมฐานข้อมูลคลาวด์)" : "Moderate (cloud DB round-trip)"
    return lang === "th"
      ? "ช้า (เกิน 1.5 วินาที · ควรตรวจสอบการเชื่อมต่อ)"
      : "Slow (> 1.5 s · check DB connection)"
  }

  const summaryCards = [
    {
      label: lang === "th" ? "ข้อมูลดิบจากแหล่งต้นทาง (ชั้น Bronze)" : "Raw Source Records (Bronze · Unfiltered)",
      value: c
        ? (c.bronze_air4thai + c.bronze_news + c.bronze_stats + c.bronze_pdf_pages).toLocaleString()
        : "—",
      icon: Database,
    },
    {
      label: lang === "th" ? "เอกสารและข่าวที่คัดกรองแล้ว (ชั้น Silver)" : "Verified Chunks & News (Silver · Cleaned)",
      value: c ? `${c.silver_policy_chunks} / ${c.silver_news_events}` : "—",
      icon: Check,
    },
    {
      label: lang === "th" ? "ข้อมูลผิดปกติที่คัดแยกไว้ตรวจสอบ (Quarantine)" : "Quarantined Anomalies (Isolated)",
      value: c ? c.silver_quarantine.toLocaleString() : "—",
      icon: CircleHelp,
    },
    {
      label: lang === "th" ? "คลังเอกสารและตารางพร้อมวิเคราะห์ (ชั้น Gold)" : "Vector Storage / Analytical Panel (Gold)",
      value: c
        ? `${c.rag_storage_mb} ${lang === "th" ? "MB" : "MB"} · ${c.gold_monthly_panel}${c.panel_months ? ` (${c.panel_months} ${lang === "th" ? "เดือน" : "mo"})` : ""}`
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
            : "120s in-memory read cache invalidated automatically on writes",
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
            : "End-to-end uncached query round-trip to Neon PostgreSQL",
      icon: Database,
    },
    {
      label:
        lang === "th"
          ? "ความเร็วประมวลผลแบบจำลอง (มอนติคาร์โล / จัดกลุ่ม)"
          : "Live Model Compute (Monte Carlo / Clustering)",
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
            : "Real server-side execution time measured from your latest modeling run"
          : lang === "th"
            ? "เปิดหน้าจำลองความเสี่ยงและจัดกลุ่มจังหวัด ระบบจะบันทึกเวลาคำนวณจริงมาแสดงที่นี่"
            : "Open the Simulation & Clustering tab to record live compute time here",
      icon: Gauge,
    },
    {
      label:
        lang === "th"
          ? "เวลาค้นหาเอกสารทางการและสร้างคำตอบ (ผลตรวจล่าสุด)"
          : "Document Search & Answer Latency (Last Eval)",
      value:
        ragMedianMs !== null
          ? lang === "th"
            ? `${(ragMedianMs / 1000).toFixed(2)} วินาที`
            : `${(ragMedianMs / 1000).toFixed(2)} s`
          : "—",
      tone:
        ragMedianMs === null
          ? "text-muted-foreground"
          : ragMedianMs <= 5000
            ? "text-emerald-700 dark:text-emerald-400"
            : ragMedianMs <= 10000
              ? "text-amber-700 dark:text-amber-400"
              : "text-red-700 dark:text-red-400",
      detail:
        ragMedianMs !== null
          ? lang === "th"
            ? `ค่ามัธยฐาน ${(ragMedianMs / 1000).toFixed(2)} วินาที${ragTrapMs !== null ? ` · เฉลี่ยคำถามนอกขอบเขต ${(ragTrapMs / 1000).toFixed(2)} วินาที` : ""} (จากบันทึกการประเมินจริง)`
            : `Median ${(ragMedianMs / 1000).toFixed(2)}s${ragTrapMs !== null ? ` · out-of-scope mean ${(ragTrapMs / 1000).toFixed(2)}s` : ""} (from DB eval log)`
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

  // Dynamic qualitative interpretation based strictly on live benchmark numbers
  const silBandTh =
    silEval == null ? "" : silEval >= 0.5 ? "สูง" : silEval >= 0.25 ? "ปานกลาง" : "ค่อนข้างต่ำ"
  const silBandEn =
    silEval == null ? "" : silEval >= 0.5 ? "Strong" : silEval >= 0.25 ? "Moderate" : "Weak"

  const evalCards = [
    {
      label:
        lang === "th"
          ? "ความแม่นยำการค้นคืนเอกสารทางการ 5 อันดับแรก (Hit Rate @ 5)"
          : "Official PDF Retrieval Hit Rate @ Top 5",
      value: hitTop5 != null ? `${hitTop5}%` : "—",
      tone:
        hitTop5 == null
          ? "text-muted-foreground"
          : hitTop5 >= 85
            ? "text-emerald-700 dark:text-emerald-400"
            : "text-amber-700 dark:text-amber-400",
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
      label:
        lang === "th"
          ? "ความถูกต้องของการอ้างอิง / ปฏิเสธนอกขอบเขต / ตอบในขอบเขต"
          : "Citation / Refusal / In-Scope Answer Rate",
      value:
        citeAcc != null && refusalAcc != null
          ? `${citeAcc}% / ${refusalAcc}% / ${inScopeAns != null ? `${inScopeAns}%` : "—"}`
          : "—",
      tone:
        inScopeAns != null && inScopeAns < 90
          ? "text-amber-700 dark:text-amber-400"
          : citeAcc != null
            ? "text-emerald-700 dark:text-emerald-400"
            : "text-muted-foreground",
      detail:
        citeAcc != null
          ? lang === "th"
            ? `อ้างอิงตรงเอกสาร ${citeAcc}% · ปฏิเสธคำถามนอกขอบเขต ${refusalAcc}% · อัตราตอบคำถามในขอบเขต ${inScopeAns ?? "—"}%`
            : `Citation accuracy ${citeAcc}% · out-of-scope refusal ${refusalAcc}% · in-scope answer rate ${inScopeAns ?? "—"}%`
          : lang === "th"
            ? "ไม่มีผลทดสอบในฐานข้อมูล"
            : "No benchmark recorded",
      icon: BadgeCheck,
    },
    {
      label:
        lang === "th"
          ? "การปกปิดข้อมูลส่วนบุคคล (PII) และป้องกันคำสั่งโจมตี"
          : "PII Redaction & Prompt Injection Defense",
      value: piiRecall != null && injBlock != null ? `${piiRecall}% / ${injBlock}%` : "—",
      tone:
        piiRecall === 100 && injBlock === 100
          ? "text-emerald-700 dark:text-emerald-400"
          : "text-amber-700 dark:text-amber-400",
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
      label:
        lang === "th"
          ? "ความชัดเจนกลุ่มจังหวัด (Silhouette) / เสถียรภาพ (ARI) / ความแม่นยำข่าว (F1)"
          : "Cluster Separation (Silhouette) / Stability (ARI) / News F1",
      value:
        silEval != null && ariScore != null
          ? `${silEval} / ${ariScore} / ${shockF1 != null ? `${shockF1}%` : "—"}`
          : "—",
      tone:
        silEval != null && silEval < 0.35 ? "text-amber-700 dark:text-amber-400" : "text-foreground",
      detail:
        silEval != null
          ? lang === "th"
            ? `ความชัดเจนการแยกกลุ่มระดับ${silBandTh} (Silhouette ${silEval}) · เสถียรภาพเมื่อสุ่มรบกวนข้อมูล (ARI) ${ariScore} · จำแนกประเภทข่าวได้ F1 ${shockF1 ?? "—"}% (ตรงข้อความต้นฉบับ ${quoteMatch ?? "—"}%)`
            : `${silBandEn} cluster separation (Silhouette ${silEval}) · perturbation stability ARI ${ariScore} · news classification F1 ${shockF1 ?? "—"}% (verbatim quote match ${quoteMatch ?? "—"}%)`
          : lang === "th"
            ? "ไม่มีผลทดสอบในฐานข้อมูล"
            : "No benchmark recorded",
      icon: ChartNoAxesCombined,
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {lang === "th"
            ? "ธรรมาภิบาลข้อมูลและผลการตรวจสอบคุณภาพระบบตามจริง"
            : "Live Data Governance & Actual Evaluation Metrics"}
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {lang === "th"
            ? "คุณภาพข้อมูลและผลตรวจวัดความแม่นยำจริงของระบบ"
            : "Data Health & Honest Benchmarks"}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {lang === "th"
            ? `ทุกตัวเลขด้านล่างดึงสดจากฐานข้อมูลและบันทึกการทดสอบจริง ไม่ใช้ข้อมูลจำลอง${evalRanDate ? ` · รอบประเมิน 7 มิติล่าสุดเมื่อ ${evalRanDate} UTC` : ""}`
            : `Every metric below is read directly from live PostgreSQL tables and actual evaluation logs without synthetic data${evalRanDate ? ` · Last 7D eval ${evalRanDate} UTC` : ""}.`}
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold">
          {lang === "th" ? "สรุปปริมาณข้อมูลในฐานข้อมูลหลัก" : "Live Database Layer Summary"}
          <InfoTooltip
            align="left"
            text={
              lang === "th"
                ? "สถาปัตยกรรม 3 ชั้น: Bronze = ข้อมูลดิบจากแหล่งต้นทาง, Silver = ข้อมูลที่คัดกรองและตรวจสอบแล้ว, Gold = ตารางรวมรายจังหวัดพร้อมนำไปวิเคราะห์"
                : "Medallion architecture: Bronze = raw ingested data, Silver = cleaned & validated records, Gold = analytics-ready tables."
            }
          />
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((item) => (
            <article key={item.label} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <item.icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              </div>
              <p className="mt-4 font-display text-2xl font-semibold tracking-tight tabular-nums">
                {item.value}
              </p>
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
            {lang === "th"
              ? "ทดสอบความเร็วดึงข้อมูลจริง (เทียบแคชกับฐานข้อมูล)"
              : "Benchmark Live DB vs Cache"}
          </button>
        </div>
        {benchmarkError && (
          <p role="alert" className="mb-3 text-xs text-destructive">
            {benchmarkError}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {speedCards.map((item) => (
            <article key={item.label} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-secondary">
                  <item.icon aria-hidden="true" className="size-4 text-foreground" />
                </span>
              </div>
              <p
                className={`mt-3 font-display text-2xl font-semibold tracking-tight tabular-nums ${item.tone}`}
              >
                {item.value}
              </p>
              <p className="mt-2 text-xs leading-4 text-muted-foreground">{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">
          {lang === "th"
            ? "ผลประเมินความแม่นยำและข้อจำกัดตามจริง (7 มิติ)"
            : "Actual 7-Dimension Evaluation Results"}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {evalCards.map((item) => (
            <article key={item.label} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground">{item.label}</h3>
                  <p
                    className={`mt-3 font-display text-2xl font-semibold tracking-tight tabular-nums ${item.tone}`}
                  >
                    {item.value}
                  </p>
                </div>
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
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
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
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
            {lang === "th"
              ? "รายการข้อมูลที่ระบบคัดแยกออกเนื่องจากไม่เข้าเกณฑ์"
              : "Quarantined Anomaly Diagnostics"}
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
                <span className="shrink-0 rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-semibold tabular-nums">
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

function InfoTooltip({
  text,
  align = "center",
}: {
  text: string
  align?: "center" | "left" | "right"
}) {
  const posClass =
    align === "left"
      ? "left-0"
      : align === "right"
        ? "right-0"
        : "left-1/2 -translate-x-1/2"

  return (
    <span className="group relative ml-1 inline-flex items-center align-middle">
      <button
        type="button"
        aria-label={text}
        className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
      >
        <CircleHelp aria-hidden="true" className="size-3.5" />
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute bottom-full z-50 mb-2 w-64 rounded-xl border border-border bg-foreground px-3 py-2 text-left text-[11px] font-normal normal-case tracking-normal leading-4 text-background opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${posClass}`}
      >
        {text}
      </span>
    </span>
  )
}

function ClusterLegend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-2.5 rounded-full ${color}`} aria-hidden="true" />
      {label}
    </span>
  )
}

function BriefMetric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/25 px-3.5 py-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-base font-semibold tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )
}