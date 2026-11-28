"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Activity,
  AlertTriangle,
  Building2,
  ChartNoAxesCombined,
  Check,
  CheckCircle2,
  ChevronDown,
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
  Menu,
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
  formatFetchError,
  getStaffRoleLabel,
  hasStaffPermission,
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

// Read unified backend vulnerability score matching public map and executive brief
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

  const unifiedScore = p.vulnerability_score ?? p.priority_score
  if (unifiedScore != null && Number.isFinite(unifiedScore)) {
    return { cashMargin, smeDebt, score: unifiedScore }
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
  const canViewHealth = hasStaffPermission(auth, "view_health")
  const canTriggerRefresh = hasStaffPermission(auth, "trigger_refresh")
  const canExportBrief = hasStaffPermission(auth, "export_brief")
  const canPublishClusters = hasStaffPermission(auth, "publish_clusters")
  const isDataStewardPrimary = canViewHealth && !canExportBrief
  const roleLabel = getStaffRoleLabel(auth.role, lang)

  const [activeTab, setActiveTab] = useState<WorkspaceTab>(() =>
    isDataStewardPrimary ? "health" : "overview",
  )
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
  const [staffMobileMenuOpen, setStaffMobileMenuOpen] = useState(false)

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
        if (canViewHealth) {
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
        } else {
          const m = await fetchPolicyMonitor(auth.access_token, forceFresh, signal)
          const elapsed = Math.round(
            (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0,
          )
          if (forceFresh || m.cache_status === "MISS") {
            setFreshDbFetchMs(elapsed)
          } else {
            setCachedFetchMs(elapsed)
          }
          setMonitor(m)
          setHealth(null)
        }
      } catch (err) {
        if (isAbortError(err)) return
        if (isUnauthorizedError(err)) {
          handleUnauthorized()
          return
        }
        setError(formatFetchError(err, lang))
      } finally {
        setLoading(false)
        setTestingSpeed(false)
      }
    },
    [auth.access_token, canViewHealth, handleUnauthorized, lang],
  )

  async function runSpeedBenchmark() {
    if (!canViewHealth) return
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
      setBenchmarkError(formatFetchError(err, lang))
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

  const loadProvinceDetailData = useCallback(
    async (code: string, signal?: AbortSignal) => {
      setDetail(null)
      setDetailError(null)
      try {
        const res = await fetchProvinceDetail(code, signal)
        setDetail(res)
      } catch (err) {
        if (isAbortError(err)) return
        setDetail(null)
        setDetailError(formatFetchError(err, lang))
      }
    },
    [lang],
  )

  // Fetch provincial detail synced with global selectedProvinceCode
  useEffect(() => {
    const controller = new AbortController()
    void loadProvinceDetailData(selectedProvinceCode, controller.signal)
    return () => controller.abort()
  }, [selectedProvinceCode, loadProvinceDetailData])

  // Auto recover provincial detail if monitor finishes loading after a transient wakeup error
  useEffect(() => {
    if (monitor && !detail && detailError) {
      const controller = new AbortController()
      void loadProvinceDetailData(selectedProvinceCode, controller.signal)
      return () => controller.abort()
    }
  }, [monitor, detail, detailError, selectedProvinceCode, loadProvinceDetailData])

  const provinces = useMemo(
    () => monitor?.quadrant_provinces ?? [],
    [monitor?.quadrant_provinces],
  )
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
        setBriefError(formatFetchError(err, lang))
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
    if (!canExportBrief) return
    setStaffMobileMenuOpen(false)
    setBrief(null)
    setBriefError(null)
    setPrintError(null)
    setBriefOpen(true)
    if (briefRef.current && !briefRef.current.open) {
      briefRef.current.showModal()
    }
  }

  // Match the public navigation: dismiss the mobile menu when the layout becomes desktop.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)")
    const onChange = () => {
      if (mq.matches) setStaffMobileMenuOpen(false)
    }
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

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
      setPrintError(formatFetchError(err, lang))
      setPrintingBrief(false)
    }
  }

  async function handleLiveRefresh() {
    if (!canTriggerRefresh) return
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
              : `Partial sync completed (${syncedCount} provinces · ${fetched} scanned, ${added} added to screening), but ${failedFeeds} feed(s) failed.`,
        })
      } else {
        setRefreshNotice({
          type: "success",
          text:
            lang === "th"
              ? `อัปเดตข้อมูลสดเรียบร้อย (${syncedCount} จังหวัด) · สแกนข่าว ${fetched} รายการ และเพิ่มเข้าระบบคัดกรอง ${added} รายการ`
              : `Synced live Air4Thai & RSS feeds (${syncedCount} provinces · ${fetched} scanned, ${added} added to screening).`,
        })
      }
    } catch (err) {
      if (isUnauthorizedError(err)) {
        handleUnauthorized()
        return
      }
      setRefreshNotice({
        type: "error",
        text: formatFetchError(err, lang),
      })
    } finally {
      setRefreshing(false)
    }
  }

  const visibleTabs: { id: WorkspaceTab; th: string; en: string; mobileTh: string; mobileEn: string }[] =
    isDataStewardPrimary
      ? [
          {
            id: "health",
            th: "คุณภาพและฐานข้อมูล",
            en: "Data Health",
            mobileTh: "คุณภาพและฐานข้อมูล",
            mobileEn: "Data Health",
          },
          {
            id: "overview",
            th: "ภาพรวมอ้างอิง 17 จังหวัด",
            en: "17-Province Reference",
            mobileTh: "ภาพรวมอ้างอิง 17 จังหวัด",
            mobileEn: "17-Province Reference",
          },
          {
            id: "modeling",
            th: "ตรวจสอบและเผยแพร่กลุ่มหลัก",
            en: "Cluster Review & Publish",
            mobileTh: "ตรวจสอบและเผยแพร่กลุ่มหลัก",
            mobileEn: "Cluster Review & Publish",
          },
        ]
      : [
          {
            id: "overview",
            th: "ภาพรวมและติดตามนโยบาย",
            en: "Policy Overview",
            mobileTh: "ภาพรวมเศรษฐกิจและติดตามนโยบาย",
            mobileEn: "Policy Overview & Watchlist",
          },
          {
            id: "modeling",
            th: "จำลองความเสี่ยงและจัดกลุ่มจังหวัด",
            en: "Risk Simulation & Clustering Lab",
            mobileTh: "จำลองความเสี่ยงและจัดกลุ่มจังหวัด",
            mobileEn: "Risk Simulation & Clustering Lab",
          },
          ...(canViewHealth
            ? [
                {
                  id: "health" as const,
                  th: "คุณภาพและฐานข้อมูล",
                  en: "Data Health",
                  mobileTh: "คุณภาพและฐานข้อมูล",
                  mobileEn: "Data Health",
                },
              ]
            : []),
        ]

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header
        className={`sticky top-2 z-40 mx-3 max-w-[1440px] border border-border bg-background/95 shadow-lg backdrop-blur-xl transition-all md:top-0 md:mx-auto md:rounded-none md:border-x-0 md:border-t-0 md:shadow-none ${
          staffMobileMenuOpen ? "rounded-3xl" : "rounded-full"
        }`}
      >
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-2 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <Activity aria-hidden="true" className="size-5 shrink-0" />
            <span className="truncate font-display text-sm font-semibold tracking-tight sm:text-base">
              {isDataStewardPrimary
                ? lang === "th"
                  ? "ระบบดูแลคุณภาพข้อมูลและท่อข้อมูล"
                  : "NorthRisk Data Governance"
                : lang === "th"
                  ? "ระบบงานเจ้าหน้าที่วิเคราะห์นโยบาย"
                  : "NorthRisk Staff Analytics"}
            </span>
            <span className="hidden items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 py-0.5 text-[11px] font-medium text-foreground lg:inline-flex">
              <ShieldCheck aria-hidden="true" className="size-3 shrink-0" />
              <span>{roleLabel}</span>
            </span>
          </div>

          <nav
            aria-label={lang === "th" ? "เมนูมุมมองเจ้าหน้าที่" : "Staff portal views"}
            className="hidden items-center gap-1 md:flex"
          >
            <button
              type="button"
              onClick={onExit}
              className="whitespace-nowrap rounded-full px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {lang === "th" ? "กลับหน้าสาธารณะ" : "Public View"}
            </button>
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-current={activeTab === tab.id ? "page" : undefined}
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap rounded-full px-3.5 py-2 text-xs font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {lang === "th" ? tab.th : tab.en}
              </button>
            ))}
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
              className="hidden shrink-0 items-center gap-2 rounded-full border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:inline-flex"
            >
              <span className="size-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
              <span>{lang === "th" ? "ออกจากโหมดเจ้าหน้าที่" : "Exit Staff View"}</span>
            </button>

            <button
              type="button"
              aria-expanded={staffMobileMenuOpen}
              aria-label={staffMobileMenuOpen ? "Close staff menu" : "Open staff menu"}
              onClick={() => setStaffMobileMenuOpen((prev) => !prev)}
              className="flex size-9 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-secondary md:hidden"
            >
              {staffMobileMenuOpen ? (
                <X aria-hidden="true" className="size-4" />
              ) : (
                <Menu aria-hidden="true" className="size-4" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Hamburger Navigation Drawer for Staff Portal */}
        {staffMobileMenuOpen && (
          <nav
            aria-label={lang === "th" ? "เมนูนำทางเจ้าหน้าที่บนมือถือ" : "Staff mobile navigation"}
            className="flex flex-col gap-1 border-t border-border px-4 pb-4 pt-2.5 md:hidden"
          >
            <div className="mb-1.5 flex items-center justify-between rounded-xl border border-border bg-secondary/50 px-3 py-2 text-xs">
              <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0" />
                {roleLabel}
              </span>
              <span className="text-[11px] text-muted-foreground">{auth.username}</span>
            </div>
            {visibleTabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id)
                  setStaffMobileMenuOpen(false)
                }}
                className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm font-medium transition-colors ${
                  activeTab === item.id
                    ? "bg-foreground text-background"
                    : "text-foreground hover:bg-secondary"
                }`}
              >
                <span>{lang === "th" ? item.mobileTh : item.mobileEn}</span>
                {activeTab === item.id && <Check aria-hidden="true" className="size-4" />}
              </button>
            ))}

            <div className="mt-2 flex flex-col gap-1.5 border-t border-border/70 pt-2.5">
              {canExportBrief && (
                <button
                  type="button"
                  onClick={openBriefDialog}
                  className="flex items-center justify-between rounded-xl border border-border bg-secondary/45 px-3.5 py-2.5 text-left text-xs font-semibold text-foreground"
                >
                  <span className="inline-flex items-center gap-2">
                    <Download aria-hidden="true" className="size-3.5" />
                    {lang === "th" ? "เปิดรายงานสรุปเชิงนโยบาย (1 หน้า)" : "Open 1-Page Policy Brief"}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setStaffMobileMenuOpen(false)
                  onExit()
                }}
                className="flex items-center justify-between rounded-xl px-3.5 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <span className="inline-flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-emerald-600" aria-hidden="true" />
                  {lang === "th" ? "กลับหน้าสาธารณะ / ออกจากโหมดเจ้าหน้าที่" : "Return to Public View / Exit Staff"}
                </span>
              </button>
            </div>
          </nav>
        )}
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

        {loading && !monitor && !health ? (
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
            onRetryDetail={() => void loadProvinceDetailData(selectedProvinceCode)}
            months={months}
            refreshing={refreshing}
            canTriggerRefresh={canTriggerRefresh}
            canExportBrief={canExportBrief}
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
            canPublishClusters={canPublishClusters}
            onPublished={() => void loadWorkspaceData(true)}
            onUnauthorized={handleUnauthorized}
            onMonteCarloMeasured={setMcComputeMs}
            onClusterMeasured={setClusterComputeMs}
          />
        ) : canViewHealth ? (
          <DataHealthView
            health={health}
            cachedFetchMs={cachedFetchMs}
            freshDbFetchMs={freshDbFetchMs}
            mcComputeMs={mcComputeMs}
            clusterComputeMs={clusterComputeMs}
            testingSpeed={testingSpeed}
            benchmarkError={benchmarkError}
            canTriggerRefresh={canTriggerRefresh}
            refreshing={refreshing}
            onRefresh={() => void handleLiveRefresh()}
            onRunBenchmark={() => void runSpeedBenchmark()}
          />
        ) : null}
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
                            {w.dti_sme != null
                              ? `${w.dti_sme} ${lang === "th" ? "เท่า" : "x"}`
                              : lang === "th"
                                ? "ไม่มีข้อมูล"
                                : "N/A"}
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-2.5 text-right align-top font-semibold tabular-nums">
                            {w.cash_cushion_sme != null
                              ? `${w.cash_cushion_sme.toFixed(0)}%`
                              : lang === "th"
                                ? "ไม่มีข้อมูล"
                                : "N/A"}
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
                      ? "4. ข่าวและเหตุการณ์ที่ระบบคัดกรองล่าสุด"
                      : "4. Recently Screened News and Event Signals"}
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
                  ? "แหล่งข้อมูล: กระทรวงการท่องเที่ยวและกีฬา, สำนักงานสถิติแห่งชาติ (สำรวจปี 2568), BIS, FRED, Open-Meteo, Air4Thai และเอกสาร ธปท. โดยแสดงประเภทและช่วงเวลาของข้อมูลประกอบเมื่อมีข้อมูล"
                  : "Sources: MOTS, NSO (2025 survey), BIS, FRED, Open-Meteo, Air4Thai, and Bank of Thailand publications."}
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
  onRetryDetail,
  months,
  refreshing,
  canTriggerRefresh,
  canExportBrief,
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
  onRetryDetail: () => void
  months: number
  refreshing: boolean
  canTriggerRefresh: boolean
  canExportBrief: boolean
  onSelectCode: (code: string) => void
  onMonthsChange: (m: number) => void
  onRefresh: () => void
  onExport: () => void
  onOpenModeling: () => void
}) {
  const { lang } = useAppState()
  const provinces = useMemo(
    () => monitor?.quadrant_provinces ?? [],
    [monitor?.quadrant_provinces],
  )
  const demand = monitor?.public_demand_signals
  const provNameMap = new Map(
    provinces.map((p) => [p.province_code, lang === "th" ? p.name_th : p.name_en]),
  )
  const totalAvailableMonths = monitor?.panel_months || detail?.monthly_series.length || 0

  const [provinceSearch, setProvinceSearch] = useState("")
  const [showAllWatchlist, setShowAllWatchlist] = useState(false)
  const [showAllDistMobile, setShowAllDistMobile] = useState(false)
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
              : (p.latest_occupancy_rate ?? p.avg_occupancy_rate)
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
        const occVals = g.items
          .map((item) => item.avg_occupancy_rate)
          .filter((value): value is number => value != null && Number.isFinite(value))
        const avgOcc = occVals.length
          ? occVals.reduce((acc, value) => acc + value, 0) / occVals.length
          : null
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
          {monitor?.data_quality_summary && (
            <div className="mt-3 inline-flex flex-wrap items-center gap-2 rounded-full border border-border bg-secondary/45 px-3 py-1 text-[11px] text-muted-foreground">
              <span
                className={`size-2 rounded-full ${
                  monitor.data_quality_summary.latest_dq_status === "passed"
                    ? "bg-emerald-600"
                    : "bg-amber-500"
                }`}
                aria-hidden="true"
              />
              <span className="font-medium text-foreground">
                {monitor.data_quality_summary.latest_dq_status === "passed"
                  ? lang === "th"
                    ? "คุณภาพข้อมูลผ่านเกณฑ์"
                    : "Data quality passed"
                  : lang === "th"
                    ? "กำลังติดตามคุณภาพข้อมูล"
                    : "Data quality monitored"}
              </span>
              {monitor.data_quality_summary.air_latest_date && (
                <span>
                  {lang === "th"
                    ? `· อากาศล่าสุด ${monitor.data_quality_summary.air_latest_date}`
                    : `· Air ${monitor.data_quality_summary.air_latest_date}`}
                </span>
              )}
              {monitor.data_quality_summary.news_latest_date && (
                <span>
                  {lang === "th"
                    ? `· ข่าวล่าสุด ${monitor.data_quality_summary.news_latest_date}`
                    : `· News ${monitor.data_quality_summary.news_latest_date}`}
                </span>
              )}
              <span>
                {lang === "th"
                  ? `· กักกันตรวจสอบ ${monitor.data_quality_summary.quarantine_rows} รายการ`
                  : `· ${monitor.data_quality_summary.quarantine_rows} quarantined`}
              </span>
            </div>
          )}
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

          {canTriggerRefresh && (
            <button
              type="button"
              disabled={refreshing}
              onClick={onRefresh}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-background px-4 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
            >
              <RefreshCw aria-hidden="true" className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
              {lang === "th" ? "ดึงข้อมูลสด" : "Sync Live Data"}
            </button>
          )}

          <button
            type="button"
            onClick={onOpenModeling}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-foreground/30 bg-secondary px-4 text-xs font-medium text-foreground transition-colors hover:bg-secondary/80"
          >
            <Sparkles aria-hidden="true" className="size-3.5" />
            {lang === "th" ? "ไปที่หน้าจำลองความเสี่ยงและจัดกลุ่ม" : "Simulation & Clustering"}
          </button>

          {canExportBrief && (
            <button
              type="button"
              onClick={onExport}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-foreground px-4 text-xs font-medium text-background transition-opacity hover:opacity-85"
            >
              <Download aria-hidden="true" className="size-3.5" />
              {lang === "th" ? "รายงานสรุปเชิงนโยบาย" : "Policy Brief"}
            </button>
          )}
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
                    {selectedRanked.latest_occupancy_rate != null
                      ? lang === "th" ? "เข้าพักเดือนล่าสุด" : "Latest Occ."
                      : lang === "th" ? "เข้าพักเฉลี่ยย้อนหลัง" : "Historical Avg. Occ."}
                  </span>
                  <span className="mt-0.5 block text-xs font-semibold tabular-nums text-foreground">
                    {(selectedRanked.latest_occupancy_rate ?? selectedRanked.avg_occupancy_rate) != null
                      ? `${(selectedRanked.latest_occupancy_rate ?? selectedRanked.avg_occupancy_rate)!.toFixed(1)}%`
                      : "—"}
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
                        ? "เรียงจังหวัดตามคะแนนคัดกรอง"
                        : "5 อันดับจังหวัดเฝ้าระวังสูงสุด"
                      : showAllWatchlist || provinceSearch.trim()
                        ? `All ${provinces.length} Provinces by Screening Score`
                        : "Top 5 Priority Watchlist"}
                    <InfoTooltip
                      align="left"
                      text={
                        lang === "th"
                          ? "ดัชนีคัดกรองเชิงพรรณนาตามเกณฑ์ระบบ (สูตรเดียวกับหน้าสาธารณะและรายงานสรุป): สภาพคล่องและหนี้ สสช. 55% + โครงสร้างท่องเที่ยว กทก. 25% + แรงกระแทกภัยพิบัติและข่าวที่ผ่านการคัดกรอง 20% — ใช้จัดกลุ่มเพื่อเฝ้าระวังภาพรวม ไม่ใช่ความน่าจะเป็นที่สอบเทียบแล้วหรือการยืนยันสิทธิ์รายบุคคล"
                          : "Rule-based descriptive screening index (synced with Public Map & Policy Brief): 55% NSO cashflow/debt + 25% MOTS tourism exposure + 20% hazard & screened news signals. For macro triage only—not a calibrated probability or individual credit decision."
                      }
                    />
                  </h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {lang === "th"
                      ? "ดัชนีคัดกรองเชิงพรรณนารายจังหวัด (ไม่ใช่ความน่าจะเป็นหรือการประเมินเครดิตรายบุคคล)"
                      : "Descriptive provincial screening index (synced with Public Map; not a calibrated probability)"}
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
                          {p.latest_occupancy_rate != null
                            ? lang === "th"
                              ? `เข้าพักล่าสุด ${p.latest_occupancy_rate.toFixed(1)}%`
                              : `Latest Occ. ${p.latest_occupancy_rate.toFixed(1)}%`
                            : (p.avg_occupancy_rate != null
                              ? lang === "th"
                                ? `เฉลี่ยย้อนหลัง ${p.avg_occupancy_rate.toFixed(1)}%`
                                : `Historical Avg. ${p.avg_occupancy_rate.toFixed(1)}%`
                              : lang === "th" ? "ไม่มีข้อมูลอัตราเข้าพัก" : "Occupancy unavailable")}
                        </span>
                        <span className="block">
                          {p.tier_short_th
                            ? lang === "th"
                              ? `${p.tier_short_th} · ${p.vulnerability_score != null ? `${p.vulnerability_score.toFixed(0)}/100` : "—"}`
                              : `${p.tier_short_en} · ${p.vulnerability_score != null ? `${p.vulnerability_score.toFixed(0)}/100` : "—"}`
                            : lang === "th"
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
                      ? `เงินเหลือเฉลี่ย ${g.avgMargin != null ? `${g.avgMargin.toFixed(0)}%` : "—"} · หนี้เฉลี่ย ${g.avgDebt != null ? `${g.avgDebt.toFixed(2)} เท่า` : "—"} · อัตราเข้าพัก ${g.avgOcc != null ? `${g.avgOcc.toFixed(0)}%` : "—"}`
                      : `Avg Cash Margin ${g.avgMargin != null ? `${g.avgMargin.toFixed(0)}%` : "—"} · Debt ${g.avgDebt != null ? `${g.avgDebt.toFixed(2)}x` : "—"} · Occ ${g.avgOcc != null ? `${g.avgOcc.toFixed(0)}%` : "—"}`}
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
                      ? "สถิติคำขอจำลองภาระหนี้จากหน้าสาธารณะ (นับตามจำนวนคำขอ ไม่ระบุตัวตน)"
                      : "Anonymized Public Simulation Request Counts"}
                  </h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {lang === "th"
                      ? `จำนวนคำขอจำลองสะสม ${demand?.total_checks ?? 0} ครั้ง (นับจำนวนคำขอที่ส่งเข้ามา ไม่ใช่จำนวนผู้ใช้งานที่ไม่ซ้ำหรือตัวแทนความต้องการเชิงประชากร)`
                      : `${demand?.total_checks ?? 0} simulation requests logged (counts total requests, not unique individuals or population demand)`}
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
                          ? "การกระจายตัวของอัตราเข้าพักล่าสุดรายจังหวัด (%)"
                          : "Distribution of Latest Monthly Provincial Occupancy (%)"}
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
                        label: lang === "th" ? "อัตราเข้าพักล่าสุด (%)" : "Latest Occupancy (%)",
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
                  {distributionStats.rows.map((r, idx) => {
                    const isSelected = r.province_code === selectedCode
                    const hiddenOnMobile = !showAllDistMobile && idx >= 6 && !isSelected
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
                        className={`${
                          hiddenOnMobile ? "hidden sm:flex" : "flex"
                        } group flex-col gap-1 rounded-xl border px-3 py-2 text-left transition-all ${
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
                {distributionStats.rows.length > 6 && (
                  <button
                    type="button"
                    onClick={() => setShowAllDistMobile((prev) => !prev)}
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-secondary/40 py-2 text-xs font-medium text-foreground transition-colors hover:bg-secondary sm:hidden"
                  >
                    <span>
                      {showAllDistMobile
                        ? lang === "th"
                          ? "ย่อเหลือ 6 จังหวัดแรก"
                          : "Show top 6 only"
                        : lang === "th"
                          ? `ดูครบทั้ง ${distributionStats.rows.length} จังหวัด`
                          : `Show all ${distributionStats.rows.length} provinces`}
                    </span>
                    <ChevronDown
                      aria-hidden="true"
                      className={`size-3.5 transition-transform ${showAllDistMobile ? "rotate-180" : ""}`}
                    />
                  </button>
                )}
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
              <div className="mt-3 flex h-[240px] flex-col items-center justify-center gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-4 text-center text-xs text-destructive">
                <p className="max-w-md leading-5">{detailError}</p>
                <button
                  type="button"
                  onClick={onRetryDetail}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-destructive/30 bg-background px-3.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                >
                  <RefreshCw aria-hidden="true" className="size-3" />
                  {lang === "th" ? "ลองโหลดข้อมูลใหม่" : "Retry Loading"}
                </button>
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
                    ? "ข่าวเศรษฐกิจและเหตุการณ์ที่ผ่านการคัดกรอง"
                    : "Screened Regional News and Events"}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selected ? (lang === "th" ? `จังหวัด${selected.name_th}` : selected.name_en) : ""}
                </p>
              </div>
              <ShieldCheck aria-hidden="true" className="size-4 text-muted-foreground" />
            </div>

            {detailError ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-2.5 text-xs text-destructive">
                <span>{detailError}</span>
                <button
                  type="button"
                  onClick={onRetryDetail}
                  className="inline-flex h-7 items-center gap-1 rounded-full border border-destructive/30 bg-background px-3 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
                >
                  <RefreshCw aria-hidden="true" className="size-3" />
                  {lang === "th" ? "ลองใหม่" : "Retry"}
                </button>
              </div>
            ) : !detail ? (
              <p className="mt-4 text-xs text-muted-foreground">
                {lang === "th"
                  ? "กำลังโหลดข่าวที่ผ่านการคัดกรองของจังหวัดนี้…"
                  : "Loading screened news for this province…"}
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
                  ? "ไม่พบข่าวหรือเหตุการณ์ที่ผ่านเกณฑ์คัดกรองของระบบในจังหวัดนี้ช่วงล่าสุด (กดดึงข้อมูลสดเพื่ออัปเดตได้)"
                  : "No recent news or events passed the system's screening criteria for this province (sync live data to refresh)."}
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
  canPublishClusters,
  onPublished,
  onUnauthorized,
  onMonteCarloMeasured,
  onClusterMeasured,
}: {
  token: string
  monitor: PolicyMonitorResponse | null
  provincesCount: number
  canPublishClusters: boolean
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

  // Interactive KMeans Clustering state aligned with canonical EDA validated CORE_6_FEATURES
  const [kVal, setKVal] = useState(4)
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([
    "avg_occupancy_rate",
    "occupancy_volatility",
    "log_foreign_visitor_share",
    "annual_pm25_days_over_37_5",
    "max_monthly_rainfall_mm",
    "debt_to_annual_income_all",
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
        setMcError(formatFetchError(err, lang))
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
        setClusterError(formatFetchError(err, lang))
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
            ? "จำลองสถานการณ์ความเสี่ยงและจัดกลุ่มจังหวัด"
            : "Monte Carlo Stress Simulation & Provincial Clustering"}
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {lang === "th"
            ? "จำลองความเสี่ยงกระแสเงินสดและจัดกลุ่มจังหวัด"
            : "Cashflow Risk Simulation & Dynamic Provincial Clustering"}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          {lang === "th"
            ? `ใช้ประวัติความผันผวนจริงจากฐานข้อมูล${actualHistoryMonths > 0 ? ` (${actualHistoryMonths} เดือน)` : ""} ร่วมกับข่าวเหตุการณ์รุนแรงล่าสุดเพื่อสุ่มจำลองความเสี่ยงแบบ Bootstrap ตามจำนวนรอบที่กำหนดเอง และปรับตัวแปรจัดกลุ่มจังหวัดได้ทันที`
            : `Uses provincial history${actualHistoryMonths > 0 ? ` (${actualHistoryMonths} months)` : ""} paired with screened severe-news signals for configurable Empirical Bootstrap Monte Carlo stress testing and KMeans clustering.`}
        </p>
      </div>

      {/* Section 1 Empirical Bootstrap Monte Carlo */}
      <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
        <div className="space-y-4 border-b border-border pb-5">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-foreground">
              <Sparkles aria-hidden="true" className="size-3.5" />
              {lang === "th"
                ? `โมเดลที่ 1 · มอนติคาร์โลแบบสุ่มซ้ำจากข้อมูลจริง / Empirical Bootstrap (${nSimulations.toLocaleString()} รอบ${mcData?.compute_ms != null ? ` · ${mcData.compute_ms} มิลลิวินาที` : ""})`
                : `Model 1 · Empirical Bootstrap Monte Carlo (${nSimulations.toLocaleString()} draws${mcData?.compute_ms != null ? ` · ${mcData.compute_ms} ms` : ""})`}
            </span>
            <h2 className="mt-2.5 font-display text-xl font-semibold text-foreground">
              {lang === "th"
                ? "สัดส่วนรอบจำลองที่ขาดดุลรายจังหวัดและมูลค่าความเสี่ยงรายได้ (VaR / CVaR)"
                : "Regional Revenue Value at Risk & Simulated Deficit Iteration Ratio"}
            </h2>
            <p className="mt-1.5 max-w-5xl text-xs leading-6 text-muted-foreground sm:text-[13px]">
              {lang === "th"
                ? `จำลองด้วยวิธี Regional Contiguous Block Bootstrap จากประวัติรายได้จริงในฐานข้อมูล${actualHistoryMonths > 0 ? ` (${actualHistoryMonths} เดือน${mcData?.data_range_start && mcData?.data_range_end ? ` · ${formatThaiMonth(mcData.data_range_start, lang)} ถึง ${formatThaiMonth(mcData.data_range_end, lang)}` : ""})` : ""} โดยสุ่มช่วงเดือนต่อเนื่องชุดเดียวกันพร้อมกันทั้ง 17 จังหวัดเพื่อรักษาฤดูกาลและความสัมพันธ์ของแรงกระแทกข้ามจังหวัด ภายใต้โครงสร้างต้นทุนคงที่ 70% ผันแปร 30% จากสัดส่วนรายจ่าย สสช. (ผลลัพธ์คือสัดส่วนรอบจำลองที่ขาดดุลระดับพื้นที่ ไม่ใช่ความน่าจะเป็นผิดนัดชำระหนี้ของธุรกิจรายบุคคล)`
                : `Uses Regional Contiguous Block Bootstrap over real database revenue history${actualHistoryMonths > 0 ? ` (${actualHistoryMonths} months)` : ""}, drawing shared multi-month blocks across all 17 provinces simultaneously to preserve calendar seasonality and cross-province tail co-movement under observed NSO expense ratios (70% fixed / 30% variable). Reports simulated deficit ratios for regional surveillance, not calibrated firm default probability.`}
            </p>
            {/* Mobile collapsible reading guide vs Desktop 3-column guide */}
            <details className="mt-3 rounded-2xl border border-border/80 bg-secondary/35 p-3 text-xs leading-6 text-muted-foreground md:hidden">
              <summary className="cursor-pointer font-semibold text-foreground">
                {lang === "th"
                  ? "วิธีอ่านผลจำลองมอนติคาร์โล (แตะเพื่อดูสรุป 3 ข้อ)"
                  : "How to read Monte Carlo results (3 key points)"}
              </summary>
              <div className="mt-2 space-y-2 border-t border-border/70 pt-2">
                <div>
                  <strong className="font-semibold text-foreground">
                    {lang === "th" ? "1. สิ่งที่จำลอง:" : "1. What is simulated:"}
                  </strong>{" "}
                  {lang === "th"
                    ? "สุ่มช่วงเหตุการณ์ย้อนหลังซ้ำตามจำนวนรอบที่เลือก เพื่อทดสอบว่ารายได้ภาคเหนือจะหดตัวต่ำกว่าฐานฤดูกาลเท่าไรเมื่อรวมต้นทุนเพิ่มและข่าววิกฤต"
                    : "Replays historical multi-month regional shock blocks to stress-test seasonal revenue shortfalls under added cost pressure and severe news events."}
                </div>
                <div>
                  <strong className="font-semibold text-foreground">
                    {lang === "th" ? "2. สิ่งที่เห็นในระดับภาค (VaR / CVaR):" : "2. Regional tail risk (VaR / CVaR):"}
                  </strong>{" "}
                  {lang === "th"
                    ? "ขนาดรายได้ที่อาจหายไปในกลุ่มกรณีเลวร้าย 5% ท้ายสุด (แท่งสีแดง) เพื่อช่วยกะขนาดวงเงินพยุงสภาพคล่องระดับภูมิภาค"
                    : "Magnitude of gross revenue shortfall in the worst 5% correlated tail (red bars) to help size regional emergency liquidity buffers."}
                </div>
                <div>
                  <strong className="font-semibold text-foreground">
                    {lang === "th" ? "3. สิ่งที่เห็นรายจังหวัด:" : "3. Provincial prioritization:"}
                  </strong>{" "}
                  {lang === "th"
                    ? "ชี้เป้าว่าจังหวัดใดมีเงินเหลือเดิมบางและเสี่ยงขาดดุลก่อนเพื่อน เพื่อจัดลำดับลงพื้นที่และเตรียมมาตรการเชิงป้องกันได้ตรงจุด"
                    : "Highlights which provinces have thin NSO cash cushions and hit deficit first so field teams can prioritize proactive intervention."}
                </div>
              </div>
            </details>

            <div className="mt-3 hidden gap-3 rounded-2xl border border-border/80 bg-secondary/35 p-3.5 text-xs leading-6 text-muted-foreground md:grid md:grid-cols-3">
              <div>
                <strong className="font-semibold text-foreground">
                  {lang === "th" ? "1. สิ่งที่จำลอง:" : "1. What is simulated:"}
                </strong>{" "}
                {lang === "th"
                  ? "สุ่มช่วงเหตุการณ์ย้อนหลังซ้ำตามจำนวนรอบที่เลือก เพื่อทดสอบว่ารายได้ภาคเหนือจะหดตัวต่ำกว่าฐานฤดูกาลเท่าไรเมื่อรวมต้นทุนเพิ่มและข่าววิกฤต"
                  : "Replays historical multi-month regional shock blocks to stress-test seasonal revenue shortfalls under added cost pressure and severe news events."}
              </div>
              <div>
                <strong className="font-semibold text-foreground">
                  {lang === "th" ? "2. สิ่งที่เห็นในระดับภาค (VaR / CVaR):" : "2. Regional tail risk (VaR / CVaR):"}
                </strong>{" "}
                {lang === "th"
                  ? "ขนาดรายได้ที่อาจหายไปในกลุ่มกรณีเลวร้าย 5% ท้ายสุด (แท่งสีแดง) เพื่อช่วยกะขนาดวงเงินพยุงสภาพคล่องระดับภูมิภาค"
                  : "Magnitude of gross revenue shortfall in the worst 5% correlated tail (red bars) to help size regional emergency liquidity buffers."}
              </div>
              <div>
                <strong className="font-semibold text-foreground">
                  {lang === "th" ? "3. สิ่งที่เห็นรายจังหวัด:" : "3. Provincial prioritization:"}
                </strong>{" "}
                {lang === "th"
                  ? "ชี้เป้าว่าจังหวัดใดมีเงินเหลือเดิมบางและเสี่ยงขาดดุลก่อนเพื่อน เพื่อจัดลำดับลงพื้นที่และเตรียมมาตรการเชิงป้องกันได้ตรงจุด"
                  : "Highlights which provinces have thin NSO cash cushions and hit deficit first so field teams can prioritize proactive intervention."}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 rounded-2xl border border-border bg-secondary/25 p-3 md:flex md:flex-wrap md:items-center md:rounded-none md:border-0 md:bg-transparent md:p-0">
            <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-1.5 text-xs md:justify-start md:gap-1.5 md:rounded-full">
              <span className="shrink-0 font-medium text-muted-foreground md:font-normal">
                {lang === "th" ? "จำนวนรอบ:" : "Draws:"}
              </span>
              <div className="grid flex-1 grid-cols-3 gap-1 md:flex md:flex-none md:items-center md:gap-1.5">
                {[1000, 3000, 5000].map((draws) => (
                  <button
                    key={draws}
                    type="button"
                    aria-pressed={nSimulations === draws}
                    onClick={() => {
                      setNSimulations(draws)
                      void executeMonteCarlo(horizonMonths, costShockPct, includeNewsRegime, draws)
                    }}
                    className={`rounded-lg px-2 py-1 text-center text-xs font-medium md:rounded-full md:px-2.5 md:py-0.5 ${
                      nSimulations === draws
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {draws.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-1.5 text-xs md:justify-start md:gap-1.5 md:rounded-full">
              <span className="shrink-0 font-medium text-muted-foreground md:font-normal">
                {lang === "th" ? "ระยะเวลา:" : "Horizon:"}
              </span>
              <div className="grid flex-1 grid-cols-3 gap-1 md:flex md:flex-none md:items-center md:gap-1.5">
                {[1, 3, 6].map((h) => (
                  <button
                    key={h}
                    type="button"
                    aria-pressed={horizonMonths === h}
                    onClick={() => {
                      setHorizonMonths(h)
                      void executeMonteCarlo(h, costShockPct, includeNewsRegime, nSimulations)
                    }}
                    className={`rounded-lg px-2 py-1 text-center text-xs font-medium md:rounded-full md:px-2.5 md:py-0.5 ${
                      horizonMonths === h
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {h} {lang === "th" ? "เดือน" : "mo"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-1.5 text-xs md:justify-start md:gap-1.5 md:rounded-full">
              <span className="shrink-0 font-medium text-muted-foreground md:font-normal">
                {lang === "th" ? "ต้นทุนเพิ่ม:" : "Cost shock:"}
              </span>
              <div className="grid flex-1 grid-cols-4 gap-1 md:flex md:flex-none md:items-center md:gap-1.5">
                {[0, 5, 10, 15].map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={costShockPct === c}
                    onClick={() => {
                      setCostShockPct(c)
                      void executeMonteCarlo(horizonMonths, c, includeNewsRegime, nSimulations)
                    }}
                    className={`rounded-lg px-1.5 py-1 text-center text-xs font-medium md:rounded-full md:px-2.5 md:py-0.5 ${
                      costShockPct === c
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    +{c}%
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              aria-pressed={includeNewsRegime}
              onClick={() => {
                const next = !includeNewsRegime
                setIncludeNewsRegime(next)
                void executeMonteCarlo(horizonMonths, costShockPct, next, nSimulations)
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2 text-xs font-medium transition-colors md:inline-flex md:w-auto md:justify-start md:rounded-full md:py-1.5 ${
                includeNewsRegime
                  ? "border-amber-600/40 bg-amber-500/15 text-amber-950 dark:text-amber-200"
                  : "border-border bg-background text-muted-foreground"
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
                <span>{lang === "th" ? "รวมผลข่าวเหตุการณ์รุนแรง" : "Include Severe News Events"}</span>
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
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
          <div className={`relative transition-opacity ${mcLoading ? "opacity-70" : "opacity-100"}`}>
            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
              <div className="flex flex-col justify-between rounded-2xl border border-border bg-secondary/35 p-3 sm:p-4">
                <p className="text-[11px] leading-4 text-muted-foreground sm:text-xs sm:leading-5">
                  <span className="sm:hidden">
                    {lang === "th" ? "รายได้หดตัวเฉลี่ย" : "Avg Shortfall"}
                  </span>
                  <span className="hidden sm:inline">
                    {lang === "th"
                      ? "รายได้ที่หดตัวเฉลี่ยเทียบฐานฤดูกาล (Revenue Shortfall)"
                      : "Expected Monthly Revenue Shortfall (vs Seasonal Base)"}
                  </span>
                </p>
                <div className="mt-1.5 sm:mt-2">
                  <p className="font-display text-lg font-semibold tabular-nums text-foreground sm:text-2xl">
                    {(
                      mcData.regional_metrics.expected_monthly_shortfall_mthb ??
                      mcData.regional_metrics.expected_monthly_loss_mthb
                    ).toLocaleString()}{" "}
                    <span className="text-xs font-medium sm:text-xl">
                      {lang === "th" ? "ล้านบาท" : "M THB"}
                    </span>
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground sm:text-xs sm:leading-5">
                    {lang === "th"
                      ? `มัธยฐาน ${(mcData.regional_metrics.median_monthly_shortfall_mthb ?? mcData.regional_metrics.median_monthly_loss_mthb).toLocaleString()} ลบ.${mcData.regional_metrics.expected_operating_deficit_mthb != null ? ` · ขาดดุล ${mcData.regional_metrics.expected_operating_deficit_mthb.toLocaleString()} ลบ.` : ""}`
                      : `Median ${(mcData.regional_metrics.median_monthly_shortfall_mthb ?? mcData.regional_metrics.median_monthly_loss_mthb).toLocaleString()} M${mcData.regional_metrics.expected_operating_deficit_mthb != null ? ` · Net deficit ${mcData.regional_metrics.expected_operating_deficit_mthb.toLocaleString()} M` : ""}`}
                  </p>
                </div>
              </div>

              <div className="flex flex-col justify-between rounded-2xl border border-amber-600/30 bg-amber-500/5 p-3 sm:p-4">
                <div className="flex items-start justify-between gap-1">
                  <p className="text-[11px] font-medium leading-4 text-amber-900 dark:text-amber-300 sm:text-xs sm:leading-5">
                    <span className="sm:hidden">
                      {lang === "th" ? "ขั้นต่ำ 5% ท้าย (VaR 95%)" : "VaR 95% Shortfall"}
                    </span>
                    <span className="hidden sm:inline">
                      {lang === "th"
                        ? "รายได้หดตัวขั้นต่ำกรณีเลวร้าย 5% (VaR 95%)"
                        : "95% Revenue Shortfall VaR (vs Seasonal Base)"}
                    </span>
                  </p>
                  <InfoTooltip
                    align="right"
                    text={
                      lang === "th"
                        ? "วัดเฉพาะรายได้ที่ลดลงต่ำกว่าฐานฤดูกาล (Revenue Shortfall) ไม่ใช่ขาดทุนสุทธิทางบัญชี คำนวณด้วย Regional Block Bootstrap ที่รักษาฤดูกาลและความสัมพันธ์ข้ามจังหวัด"
                        : "Measures gross revenue shortfall below seasonal baseline (distinct from net accounting loss) using a regional contiguous block bootstrap."
                    }
                  />
                </div>
                <div className="mt-1.5 sm:mt-2">
                  <p className="font-display text-lg font-semibold tabular-nums text-amber-900 dark:text-amber-300 sm:text-2xl">
                    {(
                      mcData.regional_metrics.var95_monthly_shortfall_mthb ??
                      mcData.regional_metrics.var95_monthly_loss_mthb
                    ).toLocaleString()}{" "}
                    <span className="text-xs font-medium sm:text-xl">
                      {lang === "th" ? "ล้านบาท" : "M THB"}
                    </span>
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground sm:text-xs sm:leading-5">
                    {lang === "th"
                      ? "ระดับรายได้หดตัวในกรณีเลวร้าย 5% ท้ายสุด"
                      : "Gross revenue shortfall threshold in worst 5% blocks"}
                  </p>
                </div>
              </div>

              <div className="flex flex-col justify-between rounded-2xl border border-red-600/30 bg-red-500/5 p-3 sm:p-4">
                <div className="flex items-start justify-between gap-1">
                  <p className="text-[11px] font-medium leading-4 text-red-900 dark:text-red-300 sm:text-xs sm:leading-5">
                    <span className="sm:hidden">
                      {lang === "th" ? "เฉลี่ย 5% ท้าย (CVaR 95%)" : "CVaR 95% Shortfall"}
                    </span>
                    <span className="hidden sm:inline">
                      {lang === "th"
                        ? "รายได้หดตัวเฉลี่ยในกลุ่มเลวร้าย 5% ท้าย (CVaR 95%)"
                        : "95% Tail Revenue Shortfall (CVaR 95%)"}
                    </span>
                  </p>
                  <InfoTooltip
                    align="right"
                    text={
                      lang === "th"
                        ? "ค่าเฉลี่ยของรายได้ที่หดตัวต่ำกว่าฐานฤดูกาลเมื่อหลายจังหวัดเผชิญแรงกระแทกร่วมกันใน 5% ท้ายสุด (ไม่ใช่ขาดทุนสุทธิหลังหักต้นทุนผันแปร)"
                        : "Average gross revenue shortfall conditional on the worst 5% correlated regional shock blocks."
                    }
                  />
                </div>
                <div className="mt-1.5 sm:mt-2">
                  <p className="font-display text-lg font-semibold tabular-nums text-red-800 dark:text-red-300 sm:text-2xl">
                    {(
                      mcData.regional_metrics.cvar95_monthly_shortfall_mthb ??
                      mcData.regional_metrics.cvar95_monthly_loss_mthb
                    ).toLocaleString()}{" "}
                    <span className="text-xs font-medium sm:text-xl">
                      {lang === "th" ? "ล้านบาท" : "M THB"}
                    </span>
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground sm:text-xs sm:leading-5">
                    {lang === "th"
                      ? "รายได้หดตัวเฉลี่ยเมื่อเกิดแรงกระแทกพร้อมกัน"
                      : "Mean shortfall inside worst 5% correlated tail"}
                  </p>
                </div>
              </div>

              <div className="flex flex-col justify-between rounded-2xl border border-border bg-secondary/35 p-3 sm:p-4">
                <p className="text-[11px] leading-4 text-muted-foreground sm:text-xs sm:leading-5">
                  <span className="sm:hidden">
                    {lang === "th" ? "จังหวัดที่ขาดดุล (P95)" : "Deficit Provinces (P95)"}
                  </span>
                  <span className="hidden sm:inline">
                    {lang === "th"
                      ? "จำนวนจังหวัดที่จำลองแล้วขาดดุล (เปอร์เซ็นไทล์ 95)"
                      : "Simulated Deficit Provinces (95th Pct)"}
                  </span>
                </p>
                <div className="mt-1.5 sm:mt-2">
                  <p className="font-display text-lg font-semibold tabular-nums text-foreground sm:text-2xl">
                    {mcData.regional_metrics.p95_breaching_provinces} / {totalProvDisplay}{" "}
                    <span className="text-xs font-medium sm:text-xl">
                      {lang === "th" ? "จังหวัด" : "provinces"}
                    </span>
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-muted-foreground sm:text-xs sm:leading-5">
                    {lang === "th"
                      ? "นับเฉพาะจังหวัดที่มีข้อมูลรายจ่าย สสช. จริง"
                      : "Counts only provinces with observed NSO expense data"}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[5fr_7fr]">
              <div className="rounded-2xl border border-border bg-background p-4">
                <p className="text-sm font-semibold text-foreground">
                  {lang === "th"
                    ? "กราฟการแจกแจงรายได้ที่หดตัวเทียบฐานฤดูกาลทั้งภาคเหนือ (ล้านบาท/เดือน)"
                    : "Regional Monthly Revenue Shortfall Distribution vs Seasonal Base (M THB)"}
                </p>
                <p className="mb-3 mt-1 text-xs leading-5 text-muted-foreground">
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
                <p className="text-sm font-semibold text-foreground">
                  {lang === "th"
                    ? `จัดอันดับจังหวัดตามสัดส่วนรอบจำลองที่ขาดดุล (จากการจำลอง ${mcData.n_simulations.toLocaleString()} รอบ)`
                    : `Provincial Simulated Deficit Iteration Ratio (${mcData.n_simulations.toLocaleString()} Draws)`}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {lang === "th"
                    ? "แสดงสัดส่วนรอบจำลองที่ขาดดุลจากการสุ่มช่วงเดือนต่อเนื่องตามฤดูกาลร่วมกันทั้งภาคและต้นทุนคงที่ 70% (ใช้เฝ้าระวังระดับพื้นที่ ไม่ใช่ความน่าจะเป็นจริงของธุรกิจรายบุคคล)"
                    : "Reports fraction of simulated draws in deficit under shared regional seasonal block bootstrap and 70% fixed cost assumptions (regional surveillance only)."}
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
                          {lang === "th" ? "สัดส่วนรอบที่ขาดดุล" : "Simulated Deficit Ratio"}
                        </th>
                        <th className="px-2 py-2 text-right font-medium">
                          {lang === "th" ? "เงินเหลือ (5% ท้าย)" : "Worst 5% Margin"}
                        </th>
                        <th className="px-2.5 py-2 text-right font-medium">
                          {lang === "th" ? "รายได้หดตัว (VaR 95%)" : "VaR 95% Shortfall"}
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
                            {p.baseline_margin_pct != null
                              ? `${p.baseline_margin_pct.toFixed(1)}%`
                              : lang === "th"
                                ? "ไม่มีข้อมูล"
                                : "N/A"}
                          </td>
                          <td className="px-2 py-2 text-right font-semibold tabular-nums">
                            {p.deficit_probability_pct != null ? (
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
                            ) : (
                              <span className="font-normal text-muted-foreground">
                                {lang === "th" ? "ยังไม่ได้ตรวจ" : "Not eval."}
                              </span>
                            )}
                          </td>
                          <td
                            className={`px-2 py-2 text-right tabular-nums ${
                              p.p95_worst_margin_pct != null && p.p95_worst_margin_pct < 0
                                ? "font-semibold text-red-700 dark:text-red-400"
                                : "text-muted-foreground"
                            }`}
                          >
                            {p.p95_worst_margin_pct != null
                              ? `${p.p95_worst_margin_pct >= 0 ? "+" : ""}${p.p95_worst_margin_pct.toFixed(1)}%`
                              : lang === "th"
                                ? "ไม่มีข้อมูล"
                                : "N/A"}
                          </td>
                          <td className="px-2.5 py-2 text-right tabular-nums text-foreground">
                            {(p.var95_revenue_shortfall_mthb ?? p.var95_revenue_loss_mthb).toLocaleString()}{" "}
                            {lang === "th" ? "ล้าน" : "M"}
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

      {/* Section 2 Interactive KMeans Provincial Clustering and Live VIF */}
      <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
        <div className="space-y-4 border-b border-border pb-5">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-foreground">
              <Layers aria-hidden="true" className="size-3.5" />
              {lang === "th"
                ? "โมเดลที่ 2 · ระบบจัดกลุ่มจังหวัดและตรวจสอบความซ้ำซ้อนของตัวแปร (KMeans & VIF)"
                : "Model 2 · Interactive KMeans Provincial Clustering & Live VIF"}
            </span>
            <h2 className="mt-2.5 font-display text-xl font-semibold text-foreground">
              {lang === "th"
                ? "ปรับจำนวนกลุ่มและเลือกตัวแปรเพื่อจัดกลุ่มจังหวัดและออกแบบชุดมาตรการ"
                : "Customize Provincial Groups, Check Variable Collinearity & Generate Targeted Playbooks"}
            </h2>
            <p className="mt-1.5 max-w-5xl text-xs leading-6 text-muted-foreground sm:text-[13px]">
              {lang === "th"
                ? "เลือกตัวแปรอย่างน้อย 3 ตัวแปรแล้วกดคำนวณ ระบบจะคำนวณค่าความซ้ำซ้อนของตัวแปร (VIF) และแจ้งเตือนด้วยป้ายสีเหลืองเมื่อเกิน 5.0"
                : "Select at least 3 variables and click Run Clustering. Live VIF scores are computed and flagged in amber when exceeding 5.0."}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 rounded-2xl border border-border bg-secondary/25 p-3 md:flex md:flex-wrap md:items-center md:rounded-none md:border-0 md:bg-transparent md:p-0">
            <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-1.5 text-xs md:justify-start md:gap-1.5 md:rounded-full">
              <span className="shrink-0 font-medium text-muted-foreground md:font-normal">
                {lang === "th" ? "จำนวนกลุ่ม:" : "Groups:"}
              </span>
              <div className="grid flex-1 grid-cols-3 gap-1 md:flex md:flex-none md:items-center md:gap-1.5">
                {[3, 4, 5].map((num) => (
                  <button
                    key={num}
                    type="button"
                    aria-pressed={kVal === num}
                    onClick={() => setKVal(num)}
                    className={`rounded-lg px-2 py-1 text-center text-xs font-medium md:rounded-full md:px-2.5 md:py-0.5 ${
                      kVal === num
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {num} {lang === "th" ? "กลุ่ม" : "groups"}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:contents">
              <button
                type="button"
                disabled={clusterLoading}
                onClick={() => void executeRecluster(kVal, selectedFeatures, false)}
                className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border px-4 text-xs font-medium transition-colors disabled:opacity-60 md:h-9 md:rounded-full ${
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

              {canPublishClusters ? (
                <button
                  type="button"
                  disabled={clusterLoading}
                  onClick={() => void executeRecluster(kVal, selectedFeatures, true)}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-foreground px-4 text-xs font-medium text-background hover:opacity-85 disabled:opacity-60 md:h-9 md:rounded-full"
                >
                  <Save aria-hidden="true" className="size-3.5" />
                  {lang === "th" ? "บันทึกไปใช้เป็นกลุ่มหลักของระบบ" : "Publish to Primary Map"}
                </button>
              ) : (
                <span className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-secondary/60 px-3.5 text-[11px] font-medium text-muted-foreground md:h-9 md:rounded-full">
                  <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0" />
                  {lang === "th"
                    ? "โหมดทดลอง (การเผยแพร่กลุ่มหลักต้องใช้สิทธิ์ผู้ดูแลคุณภาพข้อมูล)"
                    : "Sandbox mode (Data Steward role required to publish)"}
                </span>
              )}
            </div>
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
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    {lang === "th" ? "เลือกตัวแปรสำหรับจัดกลุ่ม" : "Choose variables for clustering"}
                    <InfoTooltip
                      align="left"
                      text={
                        lang === "th"
                          ? "เลือกอย่างน้อย 3 ตัวแปร ค่า VIF ใช้ดูว่าตัวแปรที่เลือกซ้ำซ้อนกันหรือไม่ หากเกิน 5 ควรทบทวนตัวแปรนั้น ค่า VIF เป็นผลจากการคำนวณรอบล่าสุด"
                          : "Choose at least 3 variables. VIF indicates overlap between selected variables; values above 5 should be reviewed. VIF values come from the latest run."
                      }
                    />
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {lang === "th"
                      ? "คลิกที่รายการเพื่อเลือกหรือเอาออก ต้องเลือกอย่างน้อย 3 ตัวแปร"
                      : "Click an item to select or remove it. Keep at least 3 selected."}
                  </p>
                </div>
                <span className="rounded-full bg-background px-3 py-1 text-xs font-medium text-foreground">
                  {lang === "th"
                    ? `เลือกแล้ว ${selectedFeatures.length} จาก ${clusterData.available_catalog.length} ตัวแปร`
                    : `${selectedFeatures.length} of ${clusterData.available_catalog.length} selected`}
                </span>
              </div>

              <div
                role="group"
                tabIndex={0}
                aria-label={lang === "th" ? "รายการตัวแปรสำหรับจัดกลุ่ม เลื่อนเพื่อดูรายการทั้งหมด" : "Clustering variables. Scroll to see all items."}
                className="max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-border bg-background p-2 pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  {clusterData.available_catalog.map((cat) => {
                    const isChecked = selectedFeatures.includes(cat.feature_key)
                    const vifObj = clusterData.selected_features.find(
                      (f) => f.feature_key === cat.feature_key,
                    )
                    const categoryLabel =
                      cat.group === "vulnerability"
                        ? lang === "th" ? "การเงิน" : "Finance"
                        : cat.group === "exposure"
                          ? lang === "th" ? "การท่องเที่ยว" : "Tourism"
                          : cat.group === "experimental"
                            ? lang === "th" ? "ทดลองเสริม (Media Bias)" : "Experimental (Media Bias)"
                            : lang === "th" ? "ภัยพิบัติ" : "Hazards"
                    return (
                      <button
                        key={cat.feature_key}
                        type="button"
                        aria-pressed={isChecked}
                        onClick={() => toggleFeature(cat.feature_key)}
                        className={`flex min-h-14 w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                          isChecked
                            ? "border-slate-400 bg-slate-50 text-foreground"
                            : "border-border bg-background text-muted-foreground hover:border-slate-300 hover:bg-secondary/40 hover:text-foreground"
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border ${
                            isChecked
                              ? "border-slate-700 bg-slate-700 text-white"
                              : "border-slate-400 bg-background text-transparent"
                          }`}
                          aria-hidden="true"
                        >
                          {isChecked && <Check className="size-3" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block leading-4">{lang === "th" ? cat.label_th : cat.label_en}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {categoryLabel}
                            </span>
                            {vifObj && (
                              <span
                                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                  vifObj.is_collinear
                                    ? "bg-amber-200 text-amber-950"
                                    : "bg-slate-100 text-slate-700"
                                }`}
                              >
                                VIF {vifObj.vif_score}
                                {vifObj.is_collinear && (lang === "th" ? " · ทบทวน" : " · Review")}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-background px-3 py-1 font-medium text-foreground">
                  {lang === "th"
                    ? `ความชัดเจนของการแยกกลุ่ม (Silhouette) ${clusterData.silhouette_score.toFixed(4)}`
                    : `Silhouette ${clusterData.silhouette_score.toFixed(4)}`}
                  <InfoTooltip
                    text={
                      lang === "th"
                        ? "ค่าอยู่ระหว่าง -1 ถึง 1 ยิ่งสูงยิ่งแสดงว่ากลุ่มแยกจากกันชัดเจน"
                        : "Ranges from -1 to 1; higher values indicate better-defined clusters."
                    }
                  />
                </span>
                <span className="rounded-full bg-background px-3 py-1 text-muted-foreground">
                  {lang === "th"
                    ? `ดัชนีความซ้อนทับระหว่างกลุ่ม (DBI ยิ่งต่ำยิ่งดี) ${clusterData.davies_bouldin_index.toFixed(4)}`
                    : `DBI (lower is better) ${clusterData.davies_bouldin_index.toFixed(4)}`}
                  <InfoTooltip
                    align="right"
                    text={
                      lang === "th"
                        ? "Davies-Bouldin Index (DBI) วัดความซ้อนทับระหว่างกลุ่ม ค่ายิ่งใกล้ 0 ยิ่งดี"
                        : "Davies-Bouldin Index measures inter-cluster overlap; values closer to 0 are better."
                    }
                  />
                </span>
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
                ? "ตารางการคัดกรองความสัมพันธ์เชิงสำรวจเบื้องต้น (Exploratory Feature Screening)"
                : "Exploratory Within-Province Lag Correlation Screening"}
              <InfoTooltip
                align="left"
                text={
                  lang === "th"
                    ? "เป็นการวิเคราะห์เชิงสำรวจ (Exploratory Analysis) ปรับค่าการทดสอบหลายสมมติฐานด้วย Benjamini-Hochberg FDR และคัด VIF < 5.0 ไม่ใช่ผลยืนยันเชิงสาเหตุหรือพยากรณ์"
                    : "Exploratory screening with Benjamini-Hochberg FDR multiple testing adjustment and VIF < 5.0 pruning; not causal or predictive proof."
                }
              />
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {lang === "th"
                ? "หมายเหตุระเบียบวิธี: ข้อมูลรายจังหวัดรายเดือนมีความต่อเนื่องตามเวลา ตารางนี้จึงใช้เพื่อการสำรวจความสัมพันธ์เบื้องต้น (Exploratory Analysis) คู่กับการปรับแก้การทดสอบหลายตัวแปร (FDR) ไม่ใช่การยืนยันเชิงสาเหตุ"
                : "Methodology note: Panel observations exhibit temporal autocorrelation; results represent exploratory lag screening with FDR control rather than causal confirmation."}
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
  canTriggerRefresh,
  refreshing,
  onRefresh,
  onRunBenchmark,
}: {
  health: DataHealthResponse | null
  cachedFetchMs: number | null
  freshDbFetchMs: number | null
  mcComputeMs: number | null
  clusterComputeMs: number | null
  testingSpeed: boolean
  benchmarkError: string | null
  canTriggerRefresh: boolean
  refreshing: boolean
  onRefresh: () => void
  onRunBenchmark: () => void
}) {
  const { lang } = useAppState()
  const c = health?.layer_counts
  const evalRun = health?.latest_eval_runs.find((r) => r.run_type === "full_7d_evaluation")
  const driftRun = health?.latest_eval_runs.find((r) => r.run_type === "drift_monitoring")
  const driftMetrics = driftRun?.metrics_json?.metrics as Record<string, { status?: string }> | undefined
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
      label: lang === "th" ? "เอกสารและข่าวที่ผ่านการคัดกรอง (ชั้น Silver)" : "Screened Documents & News (Silver · Cleaned)",
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

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
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

        {canTriggerRefresh && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={refreshing}
              onClick={onRefresh}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-foreground px-4 text-xs font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-60"
            >
              <RefreshCw aria-hidden="true" className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
              {lang === "th" ? "ดึงข้อมูลสดและอัปเดตท่อข้อมูล" : "Sync Live Data & ELT"}
            </button>
          </div>
        )}
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold">
          {lang === "th" ? "สรุปปริมาณข้อมูลในฐานข้อมูลหลัก" : "Live Database Layer Summary"}
          <InfoTooltip
            align="left"
            text={
              lang === "th"
                ? "สถาปัตยกรรม 3 ชั้น: Bronze = ข้อมูลดิบจากแหล่งต้นทาง, Silver = ข้อมูลที่ผ่านกฎคัดกรอง/ตรวจคุณภาพ (ไม่ได้ยืนยันข้อเท็จจริงทุกชิ้น), Gold = ตารางรวมเพื่อการวิเคราะห์"
                : "Medallion architecture: Bronze = raw source data, Silver = screened and quality-checked records (not individually fact-verified), Gold = analytics tables."
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

      <section className="grid gap-4 md:grid-cols-2" aria-label={lang === "th" ? "ติดตามความเปลี่ยนแปลง" : "Change monitoring"}>
        <article className="rounded-2xl border border-border bg-background p-5">
          <h2 className="text-sm font-semibold">{lang === "th" ? "การเปลี่ยนกลุ่มจังหวัด" : "Province cluster changes"}</h2>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {health?.cluster_run_diff?.status === "compared" ? health.cluster_run_diff.changed_province_count : "—"}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {health?.cluster_run_diff?.status === "compared"
              ? lang === "th" ? `จังหวัดเปลี่ยนกลุ่ม ${health.cluster_run_diff.changed_province_count} จาก ${health.cluster_run_diff.province_count} จังหวัด · เทียบรอบ ${health.cluster_run_diff.previous_run_id} กับ ${health.cluster_run_diff.latest_run_id}` : `${health.cluster_run_diff.changed_province_count} of ${health.cluster_run_diff.province_count} provinces changed · ${health.cluster_run_diff.previous_run_id} → ${health.cluster_run_diff.latest_run_id}`
              : lang === "th" ? "ยังมีประวัติไม่พอสำหรับเทียบสองรอบ" : "Two completed runs are needed for comparison"}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">{lang === "th" ? "กลุ่มเป็นเครื่องมือจัดประเภทเชิงพรรณนา ไม่ใช่หลักฐานเหตุและผล" : "Clusters are descriptive groups, not causal evidence."}</p>
        </article>
        <article className="rounded-2xl border border-border bg-background p-5">
          <h2 className="text-sm font-semibold">{lang === "th" ? "สัญญาณการเปลี่ยนแปลงของข้อมูล" : "Data drift signals"}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {driftMetrics
              ? lang === "th" ? `Occupancy: ${driftMetrics.occupancy_rate?.status ?? "—"} · PM2.5: ${driftMetrics.pm25_mean?.status ?? "—"} · ฝน: ${driftMetrics.rainfall_sum_mm?.status ?? "—"}` : `Occupancy: ${driftMetrics.occupancy_rate?.status ?? "—"} · PM2.5: ${driftMetrics.pm25_mean?.status ?? "—"} · Rainfall: ${driftMetrics.rainfall_sum_mm?.status ?? "—"}`
              : lang === "th" ? "ยังไม่มีผลตรวจ drift — จะเริ่มบันทึกเมื่อรัน pipeline รอบถัดไป" : "No drift run yet; it will be recorded after the next pipeline run."}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">{lang === "th" ? "เปรียบเทียบค่าเฉลี่ยย้อนหลัง 6 เดือนกับ 6 เดือนก่อนหน้า เป็นสัญญาณให้ตรวจ ไม่ใช่การทดสอบนัยสำคัญ" : "Compares recent and prior six-month means; a review signal, not a significance test."}</p>
        </article>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">
              {lang === "th"
                ? "ระบบตรวจสอบคุณภาพ 4 ชั้น แยกการตรวจอัตโนมัติออกจากการตรวจร่วมกับผู้เชี่ยวชาญ"
                : "4-Layer Verification System (Deterministic Gates vs AI-Assisted Review)"}
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {lang === "th"
                ? `แสดงสถานะตามจริง 6 ระดับ (ผ่าน / ไม่ผ่าน / เตือน / ยังไม่ได้ตรวจ / ผลเก่า / กำลังตรวจ) พร้อมจำนวนตัวอย่าง เกณฑ์ผ่าน และวันตรวจล่าสุด · รุ่นชุดตัวแปร v${health?.layered_evaluation?.feature_spec_version ?? "1.0.0"}`
                : `Each layer reports honest 6-state status (passed / failed / warn / not evaluated / stale / running) with sample size, thresholds, timestamps, and lineage · Feature Spec v${health?.layered_evaluation?.feature_spec_version ?? "1.0.0"}${health?.rag_index_version ? ` · RAG Index ${health.rag_index_version}` : ""}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-medium text-emerald-700 dark:text-emerald-400">
              {lang === "th" ? "ผ่าน" : "Passed"}
            </span>
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 font-medium text-amber-700 dark:text-amber-400">
              {lang === "th" ? "เตือน" : "Warn"}
            </span>
            <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-2.5 py-0.5 font-medium text-orange-700 dark:text-orange-400">
              {lang === "th" ? "ผลเก่า" : "Stale"}
            </span>
            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 font-medium text-red-700 dark:text-red-400">
              {lang === "th" ? "ไม่ผ่าน" : "Failed"}
            </span>
            <span className="rounded-full border border-border bg-secondary px-2.5 py-0.5 font-medium text-muted-foreground">
              {lang === "th" ? "ยังไม่ได้ตรวจ" : "Not Evaluated"}
            </span>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {(health?.layered_evaluation?.layers ?? []).map((layer) => {
            const layerTitles: Record<string, { th: string; en: string }> = {
              code_tests: {
                th: "ชั้นที่ 1 การทดสอบโค้ดและเกณฑ์ความปลอดภัย",
                en: "Layer 1: Code & Safety Tests",
              },
              data_quality: {
                th: "ชั้นที่ 2 คุณภาพและความสดใหม่ของข้อมูล",
                en: "Layer 2: Data Quality & Freshness",
              },
              statistical_validation: {
                th: "ชั้นที่ 3 การตรวจสอบทางสถิติและเสถียรภาพโมเดล",
                en: "Layer 3: Statistical & Model Validation",
              },
              rag_evaluation: {
                th: "ชั้นที่ 4 การประเมินระบบค้นเอกสารและผู้ช่วยนโยบาย",
                en: "Layer 4: Policy Assistant & Retrieval Evaluation",
              },
            }
            const metricDictionary: Record<
              string,
              { th: string; en: string; unitTh?: string; unitEn?: string }
            > = {
              failed_cases: { th: "เคสที่ไม่ผ่าน", en: "Failed Cases", unitTh: " เคส" },
              passed_cases: { th: "เคสที่ผ่าน", en: "Passed Cases", unitTh: " เคส" },
              pass_rate_pct: { th: "อัตราผ่านทั้งหมด", en: "Pass Rate", unitTh: "%", unitEn: "%" },
              checks_total: { th: "รายการตรวจทั้งหมด", en: "Total Checks", unitTh: " รายการ" },
              checks_passed: { th: "รายการที่ผ่าน", en: "Passed Checks", unitTh: " รายการ" },
              nso_provinces_covered: { th: "จังหวัดที่มีข้อมูล สสช.", en: "NSO Provinces", unitTh: " จังหวัด" },
              air_fresh_provinces_3d: { th: "จังหวัดค่าฝุ่นอัปเดตใน 3 วัน", en: "Fresh Air (3d)", unitTh: " จังหวัด" },
              quarantine_rows_caught: { th: "แถวผิดปกติที่กักกันไว้", en: "Quarantined Rows", unitTh: " รายการ" },
              silhouette_score: { th: "ความชัดการแยกกลุ่ม (Silhouette)", en: "Silhouette Score" },
              davies_bouldin_index: { th: "ดัชนีทับซ้อนกลุ่ม (Davies–Bouldin)", en: "Davies–Bouldin Index" },
              perturbation_ari: { th: "ความเสถียรเมื่อข้อมูลคลาดเคลื่อน (ARI)", en: "Perturbation ARI" },
              cross_scaler_ari: { th: "ความสอดคล้องข้ามตัวปรับสเกล (ARI)", en: "Cross-Scaler ARI" },
              kmeans_vs_ward_ari: { th: "ความสอดคล้อง KMeans กับ Ward", en: "KMeans vs Ward ARI" },
              kruskal_occ_yoy_p: { th: "นัยสำคัญความต่างระหว่างกลุ่ม (p)", en: "Kruskal YoY p-value" },
              hit_rate_top5_pct: { th: "ค้นพบเอกสารตรงใน 5 อันดับแรก", en: "Top-5 Hit Rate", unitTh: "%", unitEn: "%" },
              mrr: { th: "อันดับเฉลี่ยเอกสารที่ตรง (MRR)", en: "Mean Reciprocal Rank" },
              citation_provenance_pct: { th: "อ้างอิงเอกสารและเลขหน้าตรงจริง", en: "Citation Provenance", unitTh: "%", unitEn: "%" },
              refusal_accuracy_pct: { th: "ปฏิเสธคำถามนอกขอบเขตถูกต้อง", en: "Refusal Accuracy", unitTh: "%", unitEn: "%" },
              in_scope_answer_rate_pct: { th: "อัตราตอบคำถามในขอบเขตได้ครบ", en: "In-Scope Answer Rate", unitTh: "%", unitEn: "%" },
              in_scope_tested: { th: "คำถามในขอบเขตที่ทดสอบ", en: "In-Scope Tested", unitTh: " ข้อ" },
              oos_tested: { th: "คำถามนอกขอบเขตที่ทดสอบ", en: "Out-of-Scope Tested", unitTh: " ข้อ" },
              lag_fdr_significant_count: { th: "ตัวแปรผ่านเกณฑ์ FDR", en: "FDR-Significant Vars", unitTh: " ตัวแปร" },
              shock_oos_r2: { th: "ความแม่นยำนอกช่วงฝึก (OOS R²)", en: "Out-of-Sample R²" },
            }
            const thresholdRulesMap: Record<string, { th: string[]; en: string[] }> = {
              code_tests: {
                th: [
                  "ชุดทดสอบโค้ด โครงสร้างข้อมูล การป้องกันข้อมูลส่วนบุคคล และการจัดระดับความเสี่ยงต้องผ่านครบ 100%",
                ],
                en: [
                  "100% of unit, schema, PII, prompt defense, and tiering tests must pass",
                ],
              },
              data_quality: {
                th: [
                  "โครงสร้างตาราง ความครบ 17 จังหวัด และช่วงค่าที่สมเหตุสมผลต้องผ่านทั้งหมด",
                  "หากข้อมูลสภาพอากาศหรือฝุ่นอัปเดตล่าช้าจะขึ้นสถานะเตือน",
                ],
                en: [
                  "All critical schema, 17-province coverage, and bounds checks must pass",
                  "Freshness gaps trigger a warning status",
                ],
              },
              statistical_validation: {
                th: [
                  "ค่า Silhouette ตั้งแต่ 0.25 ขึ้นไป (ขึ้นเตือนหากต่ำกว่า 0.40)",
                  "ความเสถียรเมื่อข้อมูลคลาดเคลื่อน (ARI) ตั้งแต่ 0.70 ขึ้นไป",
                  "คัดตัวแปรด้วยเกณฑ์ BH FDR (q น้อยกว่า 0.05) และแบ่งช่วงเวลาโดยไม่รั่วข้อมูลอนาคต",
                ],
                en: [
                  "Silhouette ≥ 0.25 (warn if below 0.40)",
                  "Perturbation ARI ≥ 0.70",
                  "Strict BH FDR (q < 0.05) with leak-free chronological split",
                ],
              },
              rag_evaluation: {
                th: [
                  "ค้นพบเอกสารตรงใน 5 อันดับแรกอย่างน้อย 85%",
                  "อ้างอิงชื่อเอกสารและเลขหน้าตรงจริง 100%",
                  "ปฏิเสธคำถามนอกขอบเขตได้ถูกต้อง 100% (ความถูกต้องเชิงเนื้อหายังต้องสุ่มตรวจโดยเจ้าหน้าที่)",
                ],
                en: [
                  "Top-5 document hit rate ≥ 85%",
                  "Citation document and page provenance 100%",
                  "Out-of-scope refusal 100% (semantic accuracy requires human spot-check)",
                ],
              },
            }
            const statusMeta: Record<
              string,
              { labelTh: string; labelEn: string; pill: string; border: string }
            > = {
              passed: {
                labelTh: "ผ่าน",
                labelEn: "Passed",
                pill: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                border: "border-border",
              },
              failed: {
                labelTh: "ไม่ผ่าน",
                labelEn: "Failed",
                pill: "border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-400",
                border: "border-red-500/30",
              },
              warn: {
                labelTh: "เตือน",
                labelEn: "Warning",
                pill: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                border: "border-amber-500/25",
              },
              stale: {
                labelTh: "ผลเก่า",
                labelEn: "Stale",
                pill: "border-orange-500/35 bg-orange-500/10 text-orange-700 dark:text-orange-400",
                border: "border-orange-500/25",
              },
              running: {
                labelTh: "กำลังตรวจ",
                labelEn: "Running",
                pill: "border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-400",
                border: "border-sky-500/25",
              },
              not_evaluated: {
                labelTh: "ยังไม่ได้ตรวจ",
                labelEn: "Not Evaluated",
                pill: "border-border bg-secondary text-muted-foreground",
                border: "border-border",
              },
            }
            const meta = statusMeta[layer.status] ?? statusMeta.not_evaluated
            const ranLabel = layer.ran_at
              ? (() => {
                  const dt = new Date(layer.ran_at)
                  if (Number.isNaN(dt.getTime())) return layer.ran_at.slice(0, 16).replace("T", " ")
                  return lang === "th"
                    ? dt.toLocaleString("th-TH", {
                        timeZone: "Asia/Bangkok",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }) + " น."
                    : dt.toLocaleString("en-GB", {
                        timeZone: "Asia/Bangkok",
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }) + " ICT"
                })()
              : lang === "th"
                ? "ยังไม่เคยตรวจ"
                : "Never run"
            const metricEntries = Object.entries(layer.metrics || {}).filter(
              (entry): entry is [string, string | number | boolean] =>
                typeof entry[1] === "string" ||
                typeof entry[1] === "number" ||
                typeof entry[1] === "boolean",
            )
            const thresholdRules =
              thresholdRulesMap[layer.layer]?.[lang] ??
              (layer.threshold_summary ? [layer.threshold_summary] : [])
            const roleLabel =
              layer.role === "baseline"
                ? lang === "th"
                  ? "รุ่นอ้างอิงหลัก"
                  : "Baseline"
                : layer.role === "candidate"
                  ? lang === "th"
                    ? "รุ่นทดสอบใหม่"
                    : "Candidate"
                  : layer.role
            const LayerIcon =
              layer.layer === "code_tests"
                ? ShieldCheck
                : layer.layer === "data_quality"
                  ? Database
                  : layer.layer === "statistical_validation"
                    ? ChartNoAxesCombined
                    : ClipboardList

            return (
              <article
                key={layer.layer}
                className={`flex min-w-0 flex-col justify-between rounded-2xl border bg-card p-4 sm:p-5 ${meta.border}`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary">
                        <LayerIcon aria-hidden="true" className="size-4 text-foreground" />
                      </span>
                      <div>
                        <h3 className="text-sm font-semibold leading-5 text-foreground">
                          {layerTitles[layer.layer]?.[lang] ??
                            (lang === "th" ? layer.title_th : layer.title_en)}
                        </h3>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className={`rounded-full border px-2 py-0.5 font-semibold ${meta.pill}`}>
                            {lang === "th" ? meta.labelTh : meta.labelEn}
                            {layer.is_stale && layer.age_hours != null
                              ? lang === "th"
                                ? ` (${Math.round(layer.age_hours)} ชม. / เกิน ${Math.round(layer.stale_after_hours)} ชม.)`
                                : ` (${Math.round(layer.age_hours)}h > ${Math.round(layer.stale_after_hours)}h)`
                              : ""}
                          </span>
                          <span className="rounded-full border border-border bg-secondary/70 px-2 py-0.5 font-medium text-muted-foreground">
                            {layer.review_mode === "deterministic"
                              ? lang === "th"
                                ? "ตรวจอัตโนมัติตามเกณฑ์"
                                : "Deterministic Test"
                              : lang === "th"
                                ? "ตรวจอัตโนมัติร่วมกับผู้เชี่ยวชาญ"
                                : "Deterministic + Human Review"}
                          </span>
                          {roleLabel && (
                            <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
                              {roleLabel}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {metricEntries.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {metricEntries.slice(0, 6).map(([k, v]) => {
                        const def = metricDictionary[k]
                        const metricLabel = def ? def[lang] : k.replaceAll("_", " ")
                        const unit = def ? (lang === "th" ? def.unitTh ?? "" : def.unitEn ?? "") : ""
                        const formattedVal =
                          typeof v === "boolean"
                            ? v
                              ? lang === "th"
                                ? "ผ่าน"
                                : "Yes"
                              : lang === "th"
                                ? "ไม่ผ่าน"
                                : "No"
                            : `${v}${unit}`
                        return (
                          <div key={k} className="rounded-xl border border-border/70 bg-secondary/35 px-3 py-2">
                            <p className="text-[11px] leading-4 text-muted-foreground">{metricLabel}</p>
                            <p className="mt-1 font-display text-sm font-semibold tabular-nums text-foreground">
                              {formattedVal}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
                      {lang === "th"
                        ? "ยังไม่มีบันทึกผลการตรวจสอบในชั้นนี้ ไม่ควรตีความว่าผ่านเกณฑ์"
                        : "No recorded evaluation run for this layer yet; must not be interpreted as passed."}
                    </p>
                  )}

                  {layer.ai_assisted_review && (
                    <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-xs leading-5 text-amber-900 dark:text-amber-300">
                      <span className="font-semibold">
                        {lang === "th" ? "หมายเหตุการตรวจร่วมกับผู้เชี่ยวชาญ: " : "Human Review Note: "}
                      </span>
                      {lang === "th"
                        ? "การตรวจอ้างอิงเอกสารเป็นการยืนยันชื่อเอกสารและเลขหน้าเท่านั้น ส่วนความถูกต้องเชิงเนื้อหาคำตอบด้านสิทธิ์หนี้ต้องมีเจ้าหน้าที่สุ่มตรวจประกอบ ไม่ถือเป็นตรารับรองอัตโนมัติ"
                        : "Citation checks verify document/page provenance only; semantic accuracy of debt-relief claims requires human spot-checking and is not an automated certification."}
                    </div>
                  )}

                  {(layer.failures.length > 0 || layer.warnings.length > 0) && (
                    <details className="rounded-xl border border-border/80 bg-secondary/30 px-3 py-2 text-xs">
                      <summary className="cursor-pointer font-medium text-foreground">
                        {lang === "th"
                          ? `ดูข้อผิดพลาดและข้อจำกัด (${layer.failures.length} ข้อผิดพลาด · ${layer.warnings.length} คำเตือน)`
                          : `View failures & caveats (${layer.failures.length} failures · ${layer.warnings.length} warnings)`}
                      </summary>
                      <ul className="mt-2 space-y-1.5 text-xs leading-5">
                        {layer.failures.map((f, idx) => (
                          <li key={`f-${idx}`} className="text-red-700 dark:text-red-400">
                            • [{f.check || f.case || "failure"}] {f.reason || `observed=${f.observed}, expected=${f.expected}`}
                          </li>
                        ))}
                        {layer.warnings.map((w, idx) => (
                          <li key={`w-${idx}`} className="text-amber-700 dark:text-amber-400">
                            • [{w.check || w.case || "warning"}] {w.reason || `observed=${w.observed}, expected=${w.expected}`}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>

                <div className="mt-4 space-y-2.5 border-t border-border/70 pt-3.5">
                  <div className="rounded-xl border border-border/70 bg-secondary/30 px-3.5 py-2.5 text-xs leading-5">
                    <p className="font-semibold text-foreground">
                      {lang === "th" ? "เกณฑ์ผ่านของชั้นนี้" : "Pass Criteria"}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                      {thresholdRules.map((rule, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span aria-hidden="true" className="mt-0.5 text-foreground/60">•</span>
                          <span>{rule}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {lang === "th" ? "รอบการตรวจ:" : "Schedule:"}
                      </span>{" "}
                      {lang === "th" ? layer.trigger_policy_th : layer.trigger_policy_en}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="tabular-nums">
                      {lang === "th"
                        ? `จำนวนตัวอย่าง ${layer.sample_size ?? 0} · ตรวจล่าสุด ${ranLabel}`
                        : `Samples ${layer.sample_size ?? 0} · Last run ${ranLabel}`}
                    </span>
                    <details className="group">
                      <summary className="cursor-pointer list-none font-medium text-foreground/80 underline decoration-border underline-offset-2 hover:text-foreground">
                        {lang === "th" ? "ดูรหัสรอบตรวจและรุ่นข้อมูล" : "Audit lineage"}
                      </summary>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] tabular-nums">
                        {layer.run_id && (
                          <span className="rounded-md bg-secondary px-2 py-0.5">
                            {lang === "th" ? `รหัสรอบ: ${layer.run_id}` : `run: ${layer.run_id}`}
                          </span>
                        )}
                        {layer.git_commit && layer.git_commit !== "unrecorded" && (
                          <span className="rounded-md bg-secondary px-2 py-0.5">
                            {lang === "th" ? `รหัสโค้ด: ${layer.git_commit}` : `commit: ${layer.git_commit}`}
                          </span>
                        )}
                        {layer.feature_spec_version && (
                          <span className="rounded-md bg-secondary px-2 py-0.5">
                            {lang === "th" ? `รุ่นตัวแปร: v${layer.feature_spec_version}` : `spec: v${layer.feature_spec_version}`}
                          </span>
                        )}
                        {layer.prompt_version && (
                          <span className="rounded-md bg-secondary px-2 py-0.5">
                            {lang === "th" ? `ชุดคำสั่ง: ${layer.prompt_version}` : `prompt: ${layer.prompt_version}`}
                          </span>
                        )}
                        {layer.rag_index_version && layer.rag_index_version !== "unrecorded" && (
                          <span className="rounded-md bg-secondary px-2 py-0.5">
                            {lang === "th" ? `ดัชนีเอกสาร: ${layer.rag_index_version}` : `index: ${layer.rag_index_version}`}
                          </span>
                        )}
                        {layer.dataset_cutoff && (
                          <span className="rounded-md bg-secondary px-2 py-0.5">
                            {lang === "th" ? `วันตัดยอดข้อมูล: ${layer.dataset_cutoff}` : `cutoff: ${layer.dataset_cutoff}`}
                          </span>
                        )}
                      </div>
                    </details>
                  </div>
                </div>
              </article>
            )
          })}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">
                {lang === "th"
                  ? "การเทียบผลรุ่นอ้างอิงหลักกับรุ่นทดสอบใหม่"
                  : "Baseline vs Candidate Experiment Comparison"}
              </h3>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                {lang === "th"
                  ? "ทุกครั้งที่ปรับตัวแปรหรืออัปเดตคลังเอกสาร ให้ทดสอบเป็นรุ่นทดสอบใหม่เพื่อเทียบผลต่างกับรุ่นหลักก่อนอนุมัติใช้งานจริง"
                  : "Whenever modifying feature_specs.yaml or RAG prompt/index, run with --role candidate to inspect deltas before promotion."}
              </p>
            </div>
          </div>

          {(health?.layered_evaluation?.baseline_vs_candidate?.length ?? 0) > 0 ? (
            <div className="mt-4 space-y-3">
              {health!.layered_evaluation!.baseline_vs_candidate.map((cmp) => (
                <div key={cmp.layer} className="rounded-xl border border-border bg-secondary/25 p-3.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">{cmp.layer}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        cmp.promotion_ready
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
                      }`}
                    >
                      {cmp.promotion_ready
                        ? lang === "th"
                          ? "ผ่านเกณฑ์พร้อมพิจารณาอนุมัติ"
                          : "Eligible for Promotion"
                        : lang === "th"
                          ? "ยังไม่ผ่านเกณฑ์ — คงรุ่นเดิมไว้"
                          : "Blocked — Keep Baseline"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {lang === "th"
                      ? `รุ่นหลัก (${cmp.baseline_run_id}) เทียบกับ รุ่นทดสอบ (${cmp.candidate_run_id})`
                      : `Baseline (${cmp.baseline_run_id}, ${cmp.baseline_status}) vs Candidate (${cmp.candidate_run_id}, ${cmp.candidate_status})`}
                  </p>
                  <div className="mt-2.5 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground">
                          <th className="py-1.5 pr-3">{lang === "th" ? "ตัวชี้วัด" : "Metric"}</th>
                          <th className="py-1.5 px-2 text-right">{lang === "th" ? "รุ่นหลัก" : "Baseline"}</th>
                          <th className="py-1.5 px-2 text-right">{lang === "th" ? "รุ่นทดสอบ" : "Candidate"}</th>
                          <th className="py-1.5 pl-2 text-right">{lang === "th" ? "ส่วนต่าง" : "Delta"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cmp.metric_deltas.map((d) => (
                          <tr key={d.metric} className="border-b border-border/50 last:border-0 tabular-nums">
                            <td className="py-1 pr-3 font-medium text-foreground">{d.metric}</td>
                            <td className="py-1 px-2 text-right">{d.baseline}</td>
                            <td className="py-1 px-2 text-right">{d.candidate}</td>
                            <td
                              className={`py-1 pl-2 text-right font-semibold ${
                                d.delta > 0
                                  ? "text-emerald-700 dark:text-emerald-400"
                                  : d.delta < 0
                                    ? "text-amber-700 dark:text-amber-400"
                                    : "text-muted-foreground"
                              }`}
                            >
                              {d.delta > 0 ? `+${d.delta}` : d.delta}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-border px-3.5 py-3 text-xs leading-5 text-muted-foreground">
              <p>
                {lang === "th"
                  ? "ขณะนี้ยังไม่มีชุดทดสอบใหม่รอเปรียบเทียบ (ระบบกำลังใช้งานรุ่นอ้างอิงหลักอยู่)"
                  : "No active candidate run is pending comparison (production is currently using the baseline run)."}
              </p>
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[11px] font-medium text-foreground/80 underline decoration-border underline-offset-2 hover:text-foreground">
                  {lang === "th" ? "ดูคำสั่งสำหรับสร้างรอบทดสอบเปรียบเทียบ" : "Show CLI command to create a candidate run"}
                </summary>
                <code className="mt-1.5 block break-all rounded-lg bg-secondary px-2.5 py-1.5 font-mono text-[11px] text-foreground">
                  python -m src.evaluation.layered_eval --layer all_deterministic --role candidate
                </code>
              </details>
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold">
            {lang === "th"
              ? `คลังเอกสารทางการที่ใช้ตอบคำถาม (${health?.indexed_official_documents.length ?? 0} ฉบับ)`
              : `Indexed Official Documents (${health?.indexed_official_documents.length ?? 0} PDFs)`}
          </h2>
          <ul className="mt-3 space-y-2.5">
            {(health?.indexed_official_documents ?? []).map((doc) => (
              <li
                key={doc.doc_title}
                className="flex flex-col items-start justify-between gap-1.5 rounded-xl border border-border px-3.5 py-2.5 text-xs sm:flex-row sm:items-center sm:gap-3"
              >
                <a
                  href={doc.doc_url || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 break-words font-medium leading-5 text-foreground hover:underline sm:truncate"
                >
                  {lang === "th" ? doc.doc_title.replace(/\s*\(Responsible Lending\)/gi, "") : doc.doc_title}
                </a>
                <span className="shrink-0 rounded-full bg-secondary/70 px-2.5 py-0.5 text-[11px] tabular-nums text-muted-foreground sm:bg-transparent sm:p-0">
                  {lang === "th"
                    ? `${doc.page_count} หน้า · ${doc.chunk_count} ส่วนข้อความ`
                    : `${doc.page_count}p · ${doc.chunk_count} chunks`}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold">
            {lang === "th"
              ? "รายการข้อมูลที่ระบบคัดแยกออกเนื่องจากไม่เข้าเกณฑ์"
              : "Quarantined Anomaly Diagnostics"}
          </h2>
          <ul className="mt-3 space-y-2">
            {(health?.quarantine_breakdown ?? []).map((q, idx) => (
              <li
                key={idx}
                className="flex items-start justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5 text-xs sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium leading-5 text-foreground sm:truncate">
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
