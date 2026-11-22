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
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
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
