-- Enable pgvector extension for grounded RAG retrieval
CREATE EXTENSION IF NOT EXISTS vector;

-- Create medallion schemas
CREATE SCHEMA IF NOT EXISTS bronze;
CREATE SCHEMA IF NOT EXISTS silver;
CREATE SCHEMA IF NOT EXISTS gold;

-- Bronze layer raw immutable tables

CREATE TABLE IF NOT EXISTS bronze.air4thai_raw (
    id              BIGSERIAL PRIMARY KEY,
    station_id      TEXT NOT NULL,
    province_raw    TEXT,
    recorded_at     TIMESTAMPTZ NOT NULL,
    pm25_raw        DOUBLE PRECISION,
    aqi_raw         INTEGER,
    raw_payload     JSONB NOT NULL,
    content_sha256  CHAR(64) NOT NULL UNIQUE,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bronze_air_recorded
    ON bronze.air4thai_raw (recorded_at DESC);

CREATE TABLE IF NOT EXISTS bronze.news_raw (
    id              BIGSERIAL PRIMARY KEY,
    source_name     TEXT NOT NULL,
    source_url      TEXT NOT NULL,
    title           TEXT NOT NULL,
    published_at    TIMESTAMPTZ,
    raw_text        TEXT NOT NULL,
    content_sha256  CHAR(64) NOT NULL UNIQUE,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bronze_news_published
    ON bronze.news_raw (published_at DESC);

CREATE TABLE IF NOT EXISTS bronze.provincial_stats_raw (
    id              BIGSERIAL PRIMARY KEY,
    dataset_name    TEXT NOT NULL,
    source_org      TEXT NOT NULL,
    source_file     TEXT NOT NULL,
    period_date     DATE NOT NULL,
    province_raw    TEXT,
    metric_name     TEXT NOT NULL,
    metric_value    DOUBLE PRECISION,
    raw_row         JSONB NOT NULL,
    content_sha256  CHAR(64) NOT NULL UNIQUE,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bronze_stats_lookup
    ON bronze.provincial_stats_raw (dataset_name, period_date);

CREATE TABLE IF NOT EXISTS bronze.bot_docs_raw (
    id              BIGSERIAL PRIMARY KEY,
    doc_title       TEXT NOT NULL,
    doc_url         TEXT,
    page_num        INTEGER NOT NULL,
    raw_text        TEXT NOT NULL,
    file_sha256     CHAR(64) NOT NULL,
    extraction_method TEXT NOT NULL DEFAULT 'pdf_text',
    ocr_reviewed_by TEXT,
    ocr_reviewed_at TIMESTAMPTZ,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (file_sha256, page_num)
);

-- Silver layer validated tables and quarantine

CREATE TABLE IF NOT EXISTS silver.dim_provinces (
    province_code   CHAR(2) PRIMARY KEY,
    name_th         TEXT NOT NULL UNIQUE,
    name_en         TEXT NOT NULL UNIQUE,
    subregion       TEXT NOT NULL CHECK (subregion IN ('Upper North', 'Lower North')),
    lat             DOUBLE PRECISION NOT NULL,
    lon             DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS silver.air_daily (
    province_code   CHAR(2) NOT NULL REFERENCES silver.dim_provinces(province_code),
    obs_date        DATE NOT NULL,
    pm25_mean       DOUBLE PRECISION CHECK (pm25_mean >= 0),
    pm25_max        DOUBLE PRECISION CHECK (pm25_max >= 0),
    station_count   INTEGER NOT NULL CHECK (station_count > 0),
    exceeds_37_5    BOOLEAN NOT NULL,
    exceeds_75_0    BOOLEAN NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (province_code, obs_date)
);
CREATE INDEX IF NOT EXISTS idx_silver_air_date
    ON silver.air_daily (obs_date DESC);

CREATE TABLE IF NOT EXISTS silver.news_events (
    event_id        BIGSERIAL PRIMARY KEY,
    news_id         BIGINT NOT NULL UNIQUE REFERENCES bronze.news_raw(id) ON DELETE CASCADE,
    province_code   CHAR(2) NOT NULL REFERENCES silver.dim_provinces(province_code),
    event_date      DATE NOT NULL,
    sector          TEXT NOT NULL CHECK (sector IN ('tourism_hotel', 'food_retail', 'transport', 'general_service')),
    shock_type      TEXT NOT NULL CHECK (shock_type IN ('flood', 'pm25', 'water_pollution', 'demand_drop', 'cost_surge', 'policy_relief')),
    severity_score  SMALLINT NOT NULL CHECK (severity_score BETWEEN 1 AND 5),
    evidence_quote  TEXT NOT NULL,
    confidence      DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
    model_name      TEXT NOT NULL,
    extracted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_silver_news_prov_date
    ON silver.news_events (province_code, event_date DESC);

CREATE TABLE IF NOT EXISTS silver.quarantine (
    id               BIGSERIAL PRIMARY KEY,
    source_table     TEXT NOT NULL,
    source_record_id TEXT NOT NULL,
    error_reason     TEXT NOT NULL,
    raw_payload      JSONB NOT NULL,
    quarantined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_table, source_record_id)
);
CREATE INDEX IF NOT EXISTS idx_silver_quarantine_source
    ON silver.quarantine (source_table, quarantined_at DESC);

CREATE TABLE IF NOT EXISTS silver.policy_chunks (
    chunk_id        BIGSERIAL PRIMARY KEY,
    doc_title       TEXT NOT NULL,
    doc_url         TEXT,
    page_num        INTEGER NOT NULL,
    chunk_index     INTEGER NOT NULL,
    chunk_text      TEXT NOT NULL,
    embedding       vector(768),
    content_sha256  CHAR(64) NOT NULL UNIQUE,
    doc_id          TEXT,
    doc_version     TEXT NOT NULL DEFAULT '1.0',
    effective_from  DATE,
    effective_to    DATE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    extraction_method TEXT NOT NULL DEFAULT 'pdf_text',
    ocr_reviewed_by TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE bronze.bot_docs_raw ADD COLUMN IF NOT EXISTS extraction_method TEXT NOT NULL DEFAULT 'pdf_text';
ALTER TABLE bronze.bot_docs_raw ADD COLUMN IF NOT EXISTS ocr_reviewed_by TEXT;
ALTER TABLE bronze.bot_docs_raw ADD COLUMN IF NOT EXISTS ocr_reviewed_at TIMESTAMPTZ;
ALTER TABLE silver.policy_chunks ADD COLUMN IF NOT EXISTS doc_id TEXT;
ALTER TABLE silver.policy_chunks ADD COLUMN IF NOT EXISTS doc_version TEXT NOT NULL DEFAULT '1.0';
ALTER TABLE silver.policy_chunks ADD COLUMN IF NOT EXISTS effective_from DATE;
ALTER TABLE silver.policy_chunks ADD COLUMN IF NOT EXISTS effective_to DATE;
ALTER TABLE silver.policy_chunks ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE silver.policy_chunks ADD COLUMN IF NOT EXISTS extraction_method TEXT NOT NULL DEFAULT 'pdf_text';
ALTER TABLE silver.policy_chunks ADD COLUMN IF NOT EXISTS ocr_reviewed_by TEXT;
CREATE INDEX IF NOT EXISTS idx_silver_policy_embedding_hnsw
    ON silver.policy_chunks USING hnsw (embedding vector_cosine_ops);

-- Gold layer empirical screening and analytics marts

CREATE TABLE IF NOT EXISTS gold.feature_screening_results (
    screening_id        BIGSERIAL PRIMARY KEY,
    feature_name        TEXT NOT NULL,
    dataset_name        TEXT NOT NULL,
    target_name         TEXT NOT NULL,
    best_lag_months     SMALLINT NOT NULL,
    pearson_r           DOUBLE PRECISION,
    spearman_r          DOUBLE PRECISION,
    p_value             DOUBLE PRECISION,
    vif_score           DOUBLE PRECISION,
    missing_pct         DOUBLE PRECISION,
    is_selected         BOOLEAN NOT NULL,
    decision_reason     TEXT NOT NULL,
    screened_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gold.province_monthly_panel (
    province_code       CHAR(2) NOT NULL REFERENCES silver.dim_provinces(province_code),
    month_date          DATE NOT NULL,
    target_metrics      JSONB NOT NULL DEFAULT '{}'::jsonb,
    selected_features   JSONB NOT NULL DEFAULT '{}'::jsonb,
    composite_shock_idx DOUBLE PRECISION CHECK (composite_shock_idx BETWEEN 0 AND 100),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (province_code, month_date)
);

CREATE TABLE IF NOT EXISTS gold.province_clusters (
    province_code       CHAR(2) PRIMARY KEY REFERENCES silver.dim_provinces(province_code),
    model_used          TEXT NOT NULL,
    cluster_id          SMALLINT NOT NULL,
    cluster_label       TEXT NOT NULL,
    shock_intensity     DOUBLE PRECISION NOT NULL,
    exposure_score      DOUBLE PRECISION NOT NULL,
    silhouette_score    DOUBLE PRECISION,
    recommended_policy  TEXT NOT NULL,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Anonymized public feedback log without personal identifiers
CREATE TABLE IF NOT EXISTS gold.relief_query_logs (
    log_id              BIGSERIAL PRIMARY KEY,
    province_code       CHAR(2) REFERENCES silver.dim_provinces(province_code),
    business_type       TEXT NOT NULL,
    impact_tags         TEXT[] NOT NULL DEFAULT '{}',
    dsr_band            TEXT NOT NULL CHECK (dsr_band IN ('stable', 'watch', 'tight', 'critical', 'not_assessable')),
    matched_program     TEXT,
    was_refused         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Keep existing deployments compatible when the not-assessable DSR band is introduced.
ALTER TABLE gold.relief_query_logs
    DROP CONSTRAINT IF EXISTS relief_query_logs_dsr_band_check;
ALTER TABLE gold.relief_query_logs
    ADD CONSTRAINT relief_query_logs_dsr_band_check
    CHECK (dsr_band IN ('stable', 'watch', 'tight', 'critical', 'not_assessable'));
CREATE INDEX IF NOT EXISTS idx_gold_relief_prov_time
    ON gold.relief_query_logs (province_code, created_at DESC);

-- Operational and evaluation metrics
CREATE TABLE IF NOT EXISTS gold.pipeline_eval_runs (
    run_id              BIGSERIAL PRIMARY KEY,
    run_type            TEXT NOT NULL,
    metrics_json        JSONB NOT NULL,
    token_count         INTEGER DEFAULT 0,
    estimated_cost_thb  DOUBLE PRECISION DEFAULT 0.0,
    ran_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Silver natural key resolved provincial statistics (latest revision wins with conflict audit)
CREATE TABLE IF NOT EXISTS silver.provincial_stats_resolved (
    dataset_name        TEXT NOT NULL,
    province_code       TEXT NOT NULL,
    period_date         DATE NOT NULL,
    metric_name         TEXT NOT NULL,
    metric_value        DOUBLE PRECISION,
    source_bronze_id    BIGINT,
    revision_count      INTEGER NOT NULL DEFAULT 1,
    has_conflict        BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (dataset_name, province_code, period_date, metric_name)
);
-- Idempotent upgrade path for databases that created the resolved table before revision audit fields existed.
ALTER TABLE silver.provincial_stats_resolved ADD COLUMN IF NOT EXISTS metric_value DOUBLE PRECISION;
ALTER TABLE silver.provincial_stats_resolved ADD COLUMN IF NOT EXISTS source_bronze_id BIGINT;
ALTER TABLE silver.provincial_stats_resolved ADD COLUMN IF NOT EXISTS revision_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE silver.provincial_stats_resolved ADD COLUMN IF NOT EXISTS has_conflict BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE silver.provincial_stats_resolved ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE UNIQUE INDEX IF NOT EXISTS uq_silver_stats_resolved_natural_key
    ON silver.provincial_stats_resolved (dataset_name, province_code, period_date, metric_name);
CREATE INDEX IF NOT EXISTS idx_silver_stats_resolved_lookup
    ON silver.provincial_stats_resolved (dataset_name, period_date DESC);

-- Structured document versioning metadata on silver.policy_chunks
ALTER TABLE silver.policy_chunks ADD COLUMN IF NOT EXISTS doc_id TEXT;
ALTER TABLE silver.policy_chunks ADD COLUMN IF NOT EXISTS doc_version TEXT DEFAULT '1.0';
ALTER TABLE silver.policy_chunks ADD COLUMN IF NOT EXISTS effective_from DATE;
ALTER TABLE silver.policy_chunks ADD COLUMN IF NOT EXISTS effective_to DATE;
ALTER TABLE silver.policy_chunks ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS idx_silver_policy_active_doc
    ON silver.policy_chunks (is_active, doc_id);

-- Lineage metadata on gold.feature_screening_results
ALTER TABLE gold.feature_screening_results ADD COLUMN IF NOT EXISTS run_id TEXT;
ALTER TABLE gold.feature_screening_results ADD COLUMN IF NOT EXISTS feature_spec_version TEXT;
ALTER TABLE gold.feature_screening_results ADD COLUMN IF NOT EXISTS data_cutoff DATE;
ALTER TABLE gold.feature_screening_results ADD COLUMN IF NOT EXISTS p_block_perm DOUBLE PRECISION;

-- Typed SQL columns are the stable query contract; JSONB remains for backwards compatibility and evolving metadata.
-- Missingness taxonomy and lineage are persisted alongside the typed columns.
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS run_id TEXT;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS feature_spec_version TEXT;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS data_cutoff DATE;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS occupancy_rate DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS occupancy_deseason DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS occupancy_yoy_diff DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS revenue_total_mthb DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS pm25_mean DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS rainfall_sum_mm DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS visitors_total DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS visitors_yoy_pct DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS revenue_deseason_pct DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS revenue_yoy_pct DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS foreign_visitor_share DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS rainfall_excess_mm DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS heavy_rain_days DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS pm25_days_over_37_5 DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS pm25_days_over_75_0 DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS pm25_z_prov DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS th_cpi_yoy_pct DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS oil_brent_yoy_pct DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS usdthb_yoy_pct DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS flood_shock_subidx DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS haze_shock_subidx DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS physical_hazard_subidx DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS macro_pressure_subidx DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS hazard_data_coverage_pct DOUBLE PRECISION;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS shock_driver TEXT;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS shock_band TEXT;
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS data_status TEXT NOT NULL DEFAULT 'observed';
ALTER TABLE gold.province_monthly_panel ADD COLUMN IF NOT EXISTS metric_status JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE gold.province_monthly_panel DROP CONSTRAINT IF EXISTS province_monthly_panel_occ_range_check;
ALTER TABLE gold.province_monthly_panel ADD CONSTRAINT province_monthly_panel_occ_range_check
    CHECK (occupancy_rate IS NULL OR (occupancy_rate >= 0 AND occupancy_rate <= 100));
ALTER TABLE gold.province_monthly_panel DROP CONSTRAINT IF EXISTS province_monthly_panel_pm25_range_check;
ALTER TABLE gold.province_monthly_panel ADD CONSTRAINT province_monthly_panel_pm25_range_check
    CHECK (pm25_mean IS NULL OR (pm25_mean >= 0 AND pm25_mean <= 500));
ALTER TABLE gold.province_monthly_panel DROP CONSTRAINT IF EXISTS province_monthly_panel_rain_range_check;
ALTER TABLE gold.province_monthly_panel ADD CONSTRAINT province_monthly_panel_rain_range_check
    CHECK (rainfall_sum_mm IS NULL OR rainfall_sum_mm >= 0);
ALTER TABLE gold.province_monthly_panel DROP CONSTRAINT IF EXISTS province_monthly_panel_status_check;
ALTER TABLE gold.province_monthly_panel ADD CONSTRAINT province_monthly_panel_status_check
    CHECK (data_status IN ('observed', 'no_data', 'true_zero', 'not_applicable'));

-- Lineage metadata on gold.province_clusters and append only snapshot archive for run to run diff
ALTER TABLE gold.province_clusters ADD COLUMN IF NOT EXISTS run_id TEXT;
ALTER TABLE gold.province_clusters ADD COLUMN IF NOT EXISTS feature_spec_version TEXT;
ALTER TABLE gold.province_clusters ADD COLUMN IF NOT EXISTS data_cutoff DATE;

CREATE TABLE IF NOT EXISTS gold.cluster_run_history (
    run_id               TEXT NOT NULL,
    province_code        CHAR(2) NOT NULL REFERENCES silver.dim_provinces(province_code),
    model_used           TEXT NOT NULL,
    feature_spec_version TEXT NOT NULL,
    git_commit           TEXT,
    data_cutoff          DATE,
    cluster_id           SMALLINT NOT NULL,
    cluster_label        TEXT NOT NULL,
    shock_intensity      DOUBLE PRECISION NOT NULL,
    exposure_score       DOUBLE PRECISION NOT NULL,
    silhouette_score     DOUBLE PRECISION,
    computed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (run_id, province_code)
);
CREATE INDEX IF NOT EXISTS idx_gold_cluster_history_time
    ON gold.cluster_run_history (computed_at DESC);

-- Anonymous RAG chat quality feedback log without PII or conversation text
CREATE TABLE IF NOT EXISTS gold.chat_feedback (
    feedback_id      BIGSERIAL PRIMARY KEY,
    rating           TEXT NOT NULL CHECK (rating IN ('helpful', 'inaccurate', 'incomplete')),
    reason_tag       TEXT,
    language         TEXT NOT NULL DEFAULT 'th' CHECK (language IN ('th', 'en')),
    model_used       TEXT,
    top_vector_sim   DOUBLE PRECISION,
    was_refused      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gold_chat_feedback_time
    ON gold.chat_feedback (created_at DESC);
