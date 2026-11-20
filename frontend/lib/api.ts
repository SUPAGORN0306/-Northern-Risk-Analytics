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
  composite_shock_idx: number
  flood_shock_subidx: number | null
  haze_shock_subidx: number | null
  macro_pressure_subidx: number | null
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
    band: "stable" | "watch" | "tight" | "critical"
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
  shock_intensity: number
  exposure_score: number
  avg_monthly_revenue_mthb: number
  avg_occupancy_rate: number
  debt_to_annual_income_all: number | null
  debt_to_annual_income_sme: number | null
  expense_to_income_pct_sme: number | null
  recommended_policy: string
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

export type DataHealthResponse = {
  authenticated_staff: string
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
    metrics_json: Record<string, any>
  }[]
}

export type WatchlistProvinceItem = {
  province_code: string
  name_th: string
  name_en: string
  occupancy_pct: number
  occupancy_yoy_diff: number
  dti_sme: number
  cash_cushion_sme: number
  exp_inc_all: number
  risk_reason: string
  recommended_action: string
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
    elevated_shock_provinces: string[]
    has_regional_external_shock: boolean
  }
  priority_watchlist: WatchlistProvinceItem[]
  action_plan: PolicyActionItem[]
  verified_news: VerifiedNewsItem[]
}

const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "")

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    cache: "no-store",
  })

  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const errBody = await response.json()
      if (errBody?.detail) detail = String(errBody.detail)
    } catch {
      // Ignore non JSON error payload
    }
    throw new Error(detail)
  }
  return response.json() as Promise<T>
}

export function fetchRiskOutlook(months = 18): Promise<RiskOutlookResponse> {
  return apiRequest<RiskOutlookResponse>(`/api/risk-outlook?months=${months}`)
}

export function fetchProvinceDetail(code: string): Promise<ProvinceDetailResponse> {
  return apiRequest<ProvinceDetailResponse>(`/api/provinces/${encodeURIComponent(code)}`)
}

export function submitReliefCheck(payload: {
  province: string
  business_type: string
  monthly_revenue_thb: number
  monthly_debt_thb: number
  impact_tags: string[]
  language: Lang
}): Promise<ReliefCheckResponse> {
  return apiRequest<ReliefCheckResponse>("/api/relief-check", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function fetchPolicyPage(docTitle: string, pageNum: number): Promise<PolicyPageResponse> {
  const params = new URLSearchParams({
    doc_title: docTitle,
    page_num: String(pageNum),
  })
  return apiRequest<PolicyPageResponse>(`/api/policy-page?${params.toString()}`)
}

export function sendPolicyChat(payload: {
  question: string
  language: Lang
}): Promise<ChatResponse> {
  return apiRequest<ChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify(payload),
  })
}

export function staffLogin(username: string, password: string): Promise<StaffAuthResponse> {
  return apiRequest<StaffAuthResponse>("/api/auth/staff-login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  })
}

export function staffDemoAccess(): Promise<StaffAuthResponse> {
  return apiRequest<StaffAuthResponse>("/api/auth/demo-access", {
    method: "POST",
  })
}

export function fetchPolicyMonitor(token: string, fresh = false): Promise<PolicyMonitorResponse> {
  return apiRequest<PolicyMonitorResponse>(fresh ? "/api/policy-monitor?fresh=true" : "/api/policy-monitor", {}, token)
}

export function fetchDataHealth(token: string, fresh = false): Promise<DataHealthResponse> {
  return apiRequest<DataHealthResponse>(fresh ? "/api/data-health?fresh=true" : "/api/data-health", {}, token)
}

export function fetchExecutiveBriefJson(token: string, lang: Lang): Promise<ExecutiveBriefData> {
  return apiRequest<ExecutiveBriefData>(`/api/export-brief?format=json&lang=${lang}`, {}, token)
}

export async function fetchExecutiveBriefText(
  token: string,
  format: "markdown" | "html",
  lang: Lang,
): Promise<string> {
  const response = await fetch(
    `${API_BASE}/api/export-brief?format=${format}&lang=${lang}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  )
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
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
  regional_metrics: {
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
    baseline_revenue_mthb: number
    baseline_margin_pct: number
    deficit_probability_pct: number
    p95_worst_margin_pct: number
    var95_revenue_loss_mthb: number
    has_active_water_alert: boolean
    active_news_count: number
  }[]
}

export function triggerLiveRefresh(token: string): Promise<Record<string, any>> {
  return apiRequest<Record<string, any>>("/api/refresh", { method: "POST" }, token)
}

export function runStaffRecluster(
  token: string,
  payload: { k: number; feature_keys?: string[]; persist?: boolean },
): Promise<StaffReclusterResponse> {
  return apiRequest<StaffReclusterResponse>(
    "/api/staff/recluster",
    {
      method: "POST",
      body: JSON.stringify(payload),
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
): Promise<StaffMonteCarloResponse> {
  return apiRequest<StaffMonteCarloResponse>(
    "/api/staff/monte-carlo",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  )
}
