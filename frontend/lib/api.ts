export type Lang = "th" | "en"

export type BusinessSegmentSensitivity = {
  sector: string
  label_th: string
  label_en: string
  risk_level: "high" | "medium" | "low"
  guidance_th: string
  guidance_en: string
}

export type VulnerabilityTierSummary = {
  tier: number
  code: string
  label_th: string
  label_en: string
  short_th: string
  short_en: string
  color: string
  playbook_title_th: string
  playbook_title_en: string
  actions_th: string[]
  actions_en: string[]
  province_count: number
  provinces: {
    province_code: string
    name_th: string
    name_en: string
    vulnerability_score: number
  }[]
}

export type ProvinceOutlookItem = {
  province_code: string
  name_th: string
  name_en: string
  subregion: string
  lat: number
  lon: number
  occupancy_rate: number | null
  occupancy_yoy_diff: number | null
  revenue_total_mthb: number | null
  revenue_yoy_pct: number | null
  foreign_visitor_share: number | null
  debt_to_annual_income_all: number | null
  debt_to_annual_income_sme: number | null
  expense_to_income_pct_all: number | null
  expense_to_income_pct_sme: number | null
  cluster_id: number | null
  cluster_label: string
  shock_intensity: number | null
  exposure_score: number | null
  latest_shock_idx: number
  shock_driver: string
  has_active_external_shock: boolean
  live_pm25_mean: number | null
  live_air_date: string | null
  recommended_policy: string
  vulnerability_tier?: number
  vulnerability_score?: number
  tier_code?: string
  tier_label_th?: string
  tier_label_en?: string
  tier_short_th?: string
  tier_short_en?: string
  tier_color?: string
  tier_playbook_title_th?: string
  tier_playbook_title_en?: string
  tier_drivers_th?: string[]
  tier_drivers_en?: string[]
  tier_actions_th?: string[]
  tier_actions_en?: string[]
  has_active_water_pollution?: boolean
  water_pollution_count?: number
  recent_news_count?: number
  max_news_severity?: number
  business_segments?: BusinessSegmentSensitivity[]
}

export type RegionalTimeseriesPoint = {
  month_date: string
  avg_occupancy_rate: number | null
  total_revenue_mthb: number | null
  avg_occupancy_yoy_diff: number | null
  avg_shock_idx: number | null
  th_cpi_yoy_pct: number | null
  oil_brent_yoy_pct: number | null
}

export type VerifiedNewsItem = {
  event_id?: number
  province_code?: string
  name_th?: string
  name_en?: string
  event_date: string
  sector: string
  shock_type: string
  severity_score: number
  evidence_quote: string
  title: string
  source_name?: string
  source_url: string
}

export type RiskOutlookResponse = {
  latest_month: string
  regional_summary: {
    provinces_count: number
    avg_occupancy_pct: number
    total_monthly_revenue_mthb: number
    th_cpi_yoy_pct: number | null
    th_cpi_month: string
    oil_brent_yoy_pct: number | null
    active_external_shock_provinces: string[]
    water_pollution_alert_provinces?: string[]
    has_active_external_shock: boolean
  }
  provinces: ProvinceOutlookItem[]
  vulnerability_tiers?: VulnerabilityTierSummary[]
  regional_timeseries: RegionalTimeseriesPoint[]
  recent_verified_news: VerifiedNewsItem[]
  default_province_detail?: ProvinceDetailResponse | null
}

export type ProvinceSeriesPoint = {
  month_date: string
  occupancy_rate: number | null
  occupancy_deseason: number | null
  occupancy_yoy_diff: number | null
  revenue_total_mthb: number | null
  visitors_total: number | null
  pm25_mean: number | null
  rainfall_sum_mm: number | null
  composite_shock_idx: number | null
  flood_shock_subidx: number | null
  haze_shock_subidx: number | null
  macro_pressure_subidx: number | null
  th_cpi_yoy_pct?: number | null
  oil_brent_yoy_pct?: number | null
  shock_driver: string
}

export type SeasonalityMonth = {
  cal_month: number
  avg_occupancy_rate: number | null
  avg_pm25_mean: number | null
  avg_rainfall_mm: number | null
}

export type ProvinceDetailResponse = {
  province: {
    province_code: string
    name_th: string
    name_en: string
    subregion: string
    lat: number
    lon: number
    cluster_id: number | null
    cluster_label: string
    shock_intensity: number | null
    exposure_score: number | null
    recommended_policy: string
  }
  nso_2025: {
    debt_to_annual_income_all?: number
    debt_to_annual_income_sme?: number
    expense_to_income_pct_all?: number
    expense_to_income_pct_sme?: number
    monthly_income_thb_all?: number
    monthly_income_thb_sme?: number
  }
  monthly_series: ProvinceSeriesPoint[]
  seasonality_calendar: SeasonalityMonth[]
  verified_news: VerifiedNewsItem[]
}

export type CitationItem = {
  doc_title: string
  page_num: number
  doc_url?: string | null
  excerpt?: string
  page_excerpt?: string
}

export type PolicyPageResponse = {
  doc_title: string
  doc_url: string
  page_num: number
  total_pages: number
  prev_page?: number | null
  next_page?: number | null
  chunks: string[]
  full_text: string
}

export type ReliefCheckResponse = {
  province_code: string | null
  province_context: {
    name_th: string
    name_en: string
    cluster_label: string
    latest_shock_idx: number | null
    recommended_policy: string
  } | null
  dsr_assessment: {
    monthly_revenue_thb: number
    monthly_debt_thb: number
    dsr_pct: number | null
    band: "stable" | "watch" | "tight" | "critical" | "not_assessable"
    summary_en: string
    summary_th: string
  }
  policy_guidance: {
    answer_text: string
    key_points: string[]
    citations: CitationItem[]
    was_refused: boolean
    refusal_reason?: string | null
    top_vector_sim?: number
    latency_ms?: number
  }
}

export type ChatResponse = {
  answer_text: string
  key_points: string[]
  citations: CitationItem[]
  was_refused: boolean
  refusal_reason: string | null
  pii_redacted_count: number
  top_vector_sim: number
  model_used: string | null
  latency_ms: number
  data_sources?: Array<{
    title: string
    source_name: string
    observed_at: string
    source_url?: string
  }>
}

export type StaffAuthResponse = {
  access_token: string
  token_type: string
  expires_in_seconds: number
  role: string
  username: string
}

export type QuadrantProvince = {
  province_code: string
  name_th: string
  name_en: string
  subregion: string
  cluster_id: number
  cluster_label: string
  shock_intensity: number | null
  exposure_score: number | null
  avg_monthly_revenue_mthb: number
  avg_occupancy_rate: number | null
  latest_occupancy_rate?: number | null
  debt_to_annual_income_all: number | null
  debt_to_annual_income_sme: number | null
  expense_to_income_pct_sme: number | null
  recommended_policy: string
  vulnerability_score?: number | null
  vulnerability_tier?: number | null
  tier_code?: string
  tier_short_th?: string
  tier_short_en?: string
  tier_color?: string
  insufficient_data?: boolean
  priority_rank?: number
  priority_score?: number
}

export type FeatureScreeningRow = {
  feature_name: string
  dataset_name: string
  target_name: string
  best_lag_months: number | null
  spearman_r: number | null
  p_value: number | null
  vif_score: number | null
  is_selected: boolean
  decision_reason: string | null
}

export type PolicyMonitorResponse = {
  authenticated_staff: string
  model_used: string | null
  silhouette_score: number | null
  panel_months?: number
  panel_start_month?: string
  panel_end_month?: string
  cache_status?: "HIT" | "MISS"
  server_query_ms?: number
  quadrant_provinces: QuadrantProvince[]
  feature_screening: FeatureScreeningRow[]
  public_demand_signals: {
    total_checks: number
    by_province_and_band: {
      province_code: string
      dsr_band: string
      query_count: number
    }[]
    by_business_type: {
      business_type: string
      query_count: number
    }[]
  }
}

export type EvalStatus = "passed" | "failed" | "warn" | "not_evaluated" | "stale" | "running"

export type EvaluationIssueItem = {
  check?: string
  case?: string
  observed?: string | number | null
  expected?: string
  reason?: string
}

export type EvaluationLayerItem = {
  layer: "code_tests" | "data_quality" | "statistical_validation" | "rag_evaluation"
  title_th: string
  title_en: string
  review_mode: "deterministic" | "ai_assisted" | "hybrid_deterministic_and_ai_assisted"
  status: EvalStatus
  raw_status: string
  is_stale: boolean
  age_hours: number | null
  stale_after_hours: number
  ran_at: string | null
  run_id: string | null
  role: "baseline" | "candidate" | string
  git_commit?: string | null
  feature_spec_version?: string | null
  dataset_cutoff?: string | null
  prompt_version?: string | null
  rag_index_version?: string | null
  evaluator_version?: string | null
  sample_size: number | null
  threshold_summary: string | null
  metrics: Record<string, unknown>
  freshness?: Record<string, unknown>
  ai_assisted_review?: {
    label: string
    prompt_version?: string
    rag_index_version?: string
    claim_factual_entailment_verified?: boolean
    human_review_required?: boolean
  } | null
  failures: EvaluationIssueItem[]
  warnings: EvaluationIssueItem[]
  trigger_policy_th: string
  trigger_policy_en: string
}

export type BaselineCandidateComparison = {
  layer: string
  baseline_run_id: string | null
  candidate_run_id: string | null
  baseline_ran_at: string | null
  candidate_ran_at: string | null
  baseline_status: string | null
  candidate_status: string | null
  baseline_spec_version?: string | null
  candidate_spec_version?: string | null
  metric_deltas: {
    metric: string
    baseline: number
    candidate: number
    delta: number
  }[]
  promotion_ready: boolean
}

export type LayeredEvaluationSummary = {
  evaluator_version: string
  feature_spec_version: string
  layers: EvaluationLayerItem[]
  baseline_vs_candidate: BaselineCandidateComparison[]
}

export type DataHealthResponse = {
  authenticated_staff: string
  rag_index_version?: string
  cache_status?: "HIT" | "MISS"
  server_query_ms?: number
  layer_counts: {
    bronze_air4thai: number
    bronze_news: number
    bronze_stats: number
    bronze_pdf_pages: number
    silver_provinces: number
    silver_air_daily: number
    silver_news_events: number
    silver_quarantine: number
    silver_policy_chunks: number
    silver_policy_docs: number
    rag_storage_mb: number
    gold_screening: number
    gold_monthly_panel: number
    panel_months?: number
    gold_clusters: number
    gold_relief_logs: number
  }
  quarantine_breakdown: {
    source_table: string
    error_reason: string
    count: number
  }[]
  indexed_official_documents: {
    doc_title: string
    doc_url: string
    page_count: number
    chunk_count: number
  }[]
  latest_eval_runs: {
    run_type: string
    token_count: number
    estimated_cost_thb: number
    ran_at: string
    metrics_json: Record<string, unknown> & {
      dim2_rag_qa?: {
        median_latency_ms?: unknown
        mean_trap_latency_ms?: unknown
      }
    }
  }[]
  layered_evaluation?: LayeredEvaluationSummary
}

export type WatchlistProvinceItem = {
  province_code: string
  name_th: string
  name_en: string
  occupancy_pct: number
  occupancy_yoy_diff: number
  dti_sme: number | null
  cash_cushion_sme: number | null
  exp_inc_all: number | null
  data_sufficient?: boolean
  risk_reason: string
  recommended_action: string
  priority_rank?: number
  priority_score?: number | null
}

export type PolicyActionItem = {
  horizon: string
  target_area: string
  action: string
}

export type ExecutiveBriefData = {
  generated_at: string
  language: Lang
  latest_month: string
  clustering_model: string
  situation_summary: string
  regional_snapshot: {
    provinces_monitored: number
    avg_occupancy_pct: number
    avg_occupancy_yoy_diff: number
    total_monthly_revenue_mthb: number
    top2_revenue_share_pct: number
    th_cpi_yoy_pct: number | null
    th_cpi_month: string
    oil_brent_yoy_pct: number | null
    oil_brent_month?: string
    elevated_shock_provinces: string[]
    has_regional_external_shock: boolean
  }
  priority_watchlist: WatchlistProvinceItem[]
  action_plan: PolicyActionItem[]
  verified_news: VerifiedNewsItem[]
}

export type LiveRefreshResponse = {
  status?: string
  provinces_synced?: number
  air4thai?: {
    stations_synced?: number
    provinces_updated?: number
  }
  news_bronze?: {
    fetched_unique?: number
    feeds_succeeded?: number
    feeds_failed?: number
  }
  news_silver?: {
    validated_silver?: number
    quarantined?: number
  }
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

export function isUnauthorizedError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError"
}

export function formatFetchError(err: unknown, lang: Lang): string {
  if (err instanceof ApiError) {
    if (err.status === 401) {
      return lang === "th"
        ? "เซสชันหมดอายุหรือไม่มีสิทธิ์เข้าถึง กรุณาเข้าสู่ระบบใหม่อีกครั้ง"
        : "Your session expired or access is unauthorized. Please sign in again."
    }
    if (err.status === 403) {
      return lang === "th"
        ? "สิทธิ์การเข้าถึงถูกจำกัดในสภาพแวดล้อมนี้"
        : "Access is restricted in this environment."
    }
    if (err.status === 429) {
      return lang === "th"
        ? "มีคำขอจำนวนมากเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง"
        : "Too many requests right now. Please wait a moment and try again."
    }
    if (err.status >= 500) {
      return lang === "th"
        ? `เซิร์ฟเวอร์ข้อมูลขัดข้องชั่วคราว (รหัส ${err.status}) กรุณากดลองใหม่อีกครั้ง`
        : `The data server is temporarily unavailable (HTTP ${err.status}). Please retry shortly.`
    }
    return lang === "th"
      ? `ไม่สามารถดึงข้อมูลได้ในขณะนี้ (${err.message})`
      : `Request failed (${err.message}).`
  }

  const msg = err instanceof Error ? err.message : String(err || "")
  const low = msg.toLowerCase()
  if (
    !msg ||
    low.includes("failed to fetch") ||
    low.includes("networkerror") ||
    low.includes("load failed") ||
    low.includes("fetch failed")
  ) {
    return lang === "th"
      ? "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ข้อมูลได้ในขณะนี้ (ระบบอาจกำลังปลุกเครื่องหรือปิดปรับปรุงชั่วคราว) กรุณากดลองใหม่"
      : "Unable to reach the data server right now (the service may be waking up or temporarily offline). Please retry."
  }
  return lang === "th"
    ? `เกิดข้อผิดพลาดในการโหลดข้อมูล กรุณาลองใหม่อีกครั้ง`
    : `Could not load data (${msg}). Please try again.`
}

const RAW_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL
if (!RAW_API_BASE && process.env.NODE_ENV === "production" && typeof console !== "undefined") {
  console.warn(
    "[api.ts] NEXT_PUBLIC_API_BASE_URL is not set in production; falling back to http://127.0.0.1:8000.",
  )
}

const API_BASE = (RAW_API_BASE || "http://127.0.0.1:8000").replace(/\/$/, "")

function formatApiErrorDetail(detail: unknown, fallbackStatus: number): string {
  if (typeof detail === "string" && detail.trim()) {
    return detail
  }
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") return item
        if (item && typeof item === "object") {
          const rec = item as { loc?: unknown[]; msg?: unknown }
          const loc = Array.isArray(rec.loc) ? rec.loc.join(".") : ""
          const msg = typeof rec.msg === "string" ? rec.msg : JSON.stringify(item)
          return loc ? `${loc}: ${msg}` : msg
        }
        return String(item)
      })
      .filter(Boolean)
    if (messages.length > 0) return messages.join("; ")
  }
  if (detail && typeof detail === "object") {
    try {
      return JSON.stringify(detail)
    } catch {
      return `HTTP ${fallbackStatus}`
    }
  }
  return `HTTP ${fallbackStatus}`
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  }

  // Only attach Content-Type when sending a request body to avoid unnecessary CORS preflight on GET
  if (options.body !== undefined && !("Content-Type" in headers)) {
    headers["Content-Type"] = "application/json"
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const isGet = !options.method || options.method.toUpperCase() === "GET"
  const maxAttempts = isGet ? 3 : 1

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        cache: "no-store",
      })
    } catch (err) {
      if (isAbortError(err) || attempt === maxAttempts) {
        throw err
      }
      await new Promise((r) => setTimeout(r, attempt * 600))
      continue
    }

    if (!response.ok) {
      if (isGet && attempt < maxAttempts && [502, 503, 504].includes(response.status)) {
        await new Promise((r) => setTimeout(r, attempt * 600))
        continue
      }
      let message = `HTTP ${response.status}`
      try {
        const errBody = await response.json()
        if (errBody?.detail !== undefined) {
          message = formatApiErrorDetail(errBody.detail, response.status)
        }
      } catch {
        // Ignore non JSON error payload
      }
      throw new ApiError(message, response.status)
    }

    return response.json() as Promise<T>
  }

  throw new Error("Request failed")
}

export function fetchRiskOutlook(months = 18, signal?: AbortSignal): Promise<RiskOutlookResponse> {
  return apiRequest<RiskOutlookResponse>(`/api/risk-outlook?months=${months}`, { signal })
}

export function fetchProvinceDetail(code: string, signal?: AbortSignal): Promise<ProvinceDetailResponse> {
  return apiRequest<ProvinceDetailResponse>(`/api/provinces/${encodeURIComponent(code)}`, { signal })
}

export function submitReliefCheck(
  payload: {
    province: string
    business_type: string
    monthly_revenue_thb: number
    monthly_debt_thb: number
    total_principal_thb?: number
    debt_payment_unspecified?: boolean
    impact_tags: string[]
    language: Lang
  },
  signal?: AbortSignal,
): Promise<ReliefCheckResponse> {
  return apiRequest<ReliefCheckResponse>("/api/relief-check", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  })
}

export function fetchPolicyPage(
  docTitle: string,
  pageNum: number,
  signal?: AbortSignal,
): Promise<PolicyPageResponse> {
  const params = new URLSearchParams({
    doc_title: docTitle,
    page_num: String(pageNum),
  })
  return apiRequest<PolicyPageResponse>(`/api/policy-page?${params.toString()}`, { signal })
}

export function sendPolicyChat(
  payload: {
    question: string
    language: Lang
    province?: string
    regional_scope?: boolean
    recent_questions?: string[]
  },
  signal?: AbortSignal,
): Promise<ChatResponse> {
  return apiRequest<ChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  })
}

export function staffLogin(username: string, password: string): Promise<StaffAuthResponse> {
  return apiRequest<StaffAuthResponse>("/api/auth/staff-login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  })
}

export function staffDemoAccess(): Promise<StaffAuthResponse> {
  // Set NEXT_PUBLIC_DISABLE_DEMO_ACCESS=true in real production environments to block passwordless demo login
  if (process.env.NEXT_PUBLIC_DISABLE_DEMO_ACCESS === "true") {
    return Promise.reject(new ApiError("Demo access is disabled in this environment", 403))
  }
  return apiRequest<StaffAuthResponse>("/api/auth/demo-access", {
    method: "POST",
  })
}

export function fetchPolicyMonitor(
  token: string,
  fresh = false,
  signal?: AbortSignal,
): Promise<PolicyMonitorResponse> {
  return apiRequest<PolicyMonitorResponse>(
    fresh ? "/api/policy-monitor?fresh=true" : "/api/policy-monitor",
    { signal },
    token,
  )
}

export function fetchDataHealth(
  token: string,
  fresh = false,
  signal?: AbortSignal,
): Promise<DataHealthResponse> {
  return apiRequest<DataHealthResponse>(
    fresh ? "/api/data-health?fresh=true" : "/api/data-health",
    { signal },
    token,
  )
}

export function fetchExecutiveBriefJson(
  token: string,
  lang: Lang,
  signal?: AbortSignal,
): Promise<ExecutiveBriefData> {
  return apiRequest<ExecutiveBriefData>(`/api/export-brief?format=json&lang=${lang}`, { signal }, token)
}

export async function fetchExecutiveBriefText(
  token: string,
  format: "markdown" | "html",
  lang: Lang,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(
    `${API_BASE}/api/export-brief?format=${format}&lang=${lang}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal,
    },
  )
  if (!response.ok) {
    throw new ApiError(`HTTP ${response.status}`, response.status)
  }
  return response.text()
}

export type StaffReclusterResponse = {
  k: number
  persisted: boolean
  compute_ms?: number
  silhouette_score: number
  davies_bouldin_index: number
  selected_features: {
    feature_key: string
    label_th: string
    label_en: string
    vif_score: number
    is_collinear: boolean
  }[]
  available_catalog: {
    feature_key: string
    label_th: string
    label_en: string
    group: string
  }[]
  groups: {
    cluster_id: number
    color: string
    title_th: string
    title_en: string
    province_count: number
    avg_cash_margin_pct: number
    avg_sme_debt_ratio: number
    avg_occupancy_pct: number
    avg_news_shock_score: number
    recommended_policy_th: string
    recommended_policy_en: string
    provinces: {
      province_code: string
      name_th: string
      name_en: string
      cash_margin_pct: number
      sme_debt_ratio: number
      avg_occupancy_pct: number
      recent_news_score: number
    }[]
  }[]
}

export type StaffMonteCarloResponse = {
  n_simulations: number
  horizon_months: number
  cost_shock_pct: number
  include_news_regime: boolean
  compute_ms?: number
  history_months_used?: number
  data_range_start?: string
  data_range_end?: string
  target_calendar_months?: number[]
  missing_expense_provinces?: string[]
  metric_definition?: string
  simulation_assumptions?: {
    sampling_method: string
    baseline_reference?: string
    shortfall_definition?: string
    cost_structure: string
    news_overlay: string
    disclaimer_th: string
    disclaimer_en: string
  }
  regional_metrics: {
    expected_monthly_shortfall_mthb?: number
    median_monthly_shortfall_mthb?: number
    var95_monthly_shortfall_mthb?: number
    cvar95_monthly_shortfall_mthb?: number
    expected_operating_deficit_mthb?: number
    var95_operating_deficit_mthb?: number
    expected_monthly_loss_mthb: number
    median_monthly_loss_mthb: number
    var95_monthly_loss_mthb: number
    cvar95_monthly_loss_mthb: number
    p95_breaching_provinces: number
  }
  loss_distribution: {
    bin_label: string
    bin_mid_mthb: number
    frequency_pct: number
    is_tail_risk: boolean
  }[]
  provinces: {
    province_code: string
    name_th: string
    name_en: string
    expense_data_status?: "observed_nso" | "not_evaluated_missing_nso"
    baseline_revenue_mthb: number
    baseline_margin_pct: number | null
    deficit_probability_pct: number | null
    simulated_deficit_ratio_pct?: number | null
    p95_worst_margin_pct: number | null
    var95_revenue_shortfall_mthb?: number
    var95_revenue_loss_mthb: number
    expected_operating_deficit_mthb?: number | null
    hypothetical_expense_scenarios?: Record<string, number>
    has_active_water_alert: boolean
    active_news_count: number
  }[]
}

export function triggerLiveRefresh(
  token: string,
  signal?: AbortSignal,
): Promise<LiveRefreshResponse> {
  return apiRequest<LiveRefreshResponse>("/api/refresh", { method: "POST", signal }, token)
}

export function runStaffRecluster(
  token: string,
  payload: { k: number; feature_keys?: string[]; persist?: boolean },
  signal?: AbortSignal,
): Promise<StaffReclusterResponse> {
  return apiRequest<StaffReclusterResponse>(
    "/api/staff/recluster",
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
    },
    token,
  )
}

export function runStaffMonteCarlo(
  token: string,
  payload: {
    horizon_months: number
    cost_shock_pct: number
    include_news_regime: boolean
    n_simulations?: number
  },
  signal?: AbortSignal,
): Promise<StaffMonteCarloResponse> {
  return apiRequest<StaffMonteCarloResponse>(
    "/api/staff/monte-carlo",
    {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
    },
    token,
  )
}
