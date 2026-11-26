# Architecture Decision Records (ADR), Data Dictionary & Defense Q&A
**Project:** NorthRisk Analytics (`วางแผนแก้หนี้และเศรษฐกิจภาคเหนือ`)  
**Repository:** `D:\northern-risk-analytics`  
**Feature Spec Version:** `2.3.0` (`backend/config/feature_specs.yaml`)

---

## 1. Architecture Decision Records (ADR)

### ADR-01: Python-Orchestrated Medallion ELT on Neon PostgreSQL + `pgvector`
- **Context:** Data comes from 6+ heterogeneous open government & global sources (Air4Thai JSON API, Google News RSS, MOTS Excel workbooks, NSO CSV, Open-Meteo ERA5/PM2.5 JSON, BIS/FRED Macro CSV, BOT official PDFs).
- **Decision:** Land immutable raw records into `bronze.*` (`JSONB` + `content_sha256` deduplication) first, then run deterministic + LLM-guarded transformations reading from `bronze.*` into `silver.*` (normalized, validated, `silver.quarantine` dead-letter table, and `pgvector(768)` HNSW) and `gold.*` (monthly panel, feature screening audit, 17-province clusters, anonymous telemetry, layered eval runs).
- **Why not pure SQL/dbt or separate Vector DB (Pinecone/Weaviate)?**
  - Storing relational facts + `pgvector` inside one Neon PostgreSQL database keeps storage around **~21 MB / 512 MB (~4.1% of Free Tier)**, avoids cross-database sync drift, and lets `silver.policy_chunks` and `bronze.bot_docs_raw` update inside a single ACID transaction (`indexer.py`).
  - Python orchestration cleanly handles Excel/PDF parsing, Thai Unicode normalization, Gemini structured extraction, and statistical screening (BH-FDR, FE OLS, VIF, Clustering) while remaining idempotent (`ON CONFLICT`, `atomic_replace_table`).

### ADR-02: Single Source of Truth Feature Registry (`feature_specs.yaml` v2.3.0)
- **Context:** In early iterations, EDA reports, clustering pipelines, and interactive web labs can easily drift in feature names, transforms, or defaults.
- **Decision:** Centralize feature contracts, screening policy cutoffs (`alpha_threshold: 0.05`, `max_vif: 5.0`, `max_pairwise_spearman: 0.85`, `max_missing_pct: 30.0`, `time_split_train_ratio: 0.75`), data freshness/coverage limits, scoring weights and thresholds, EDA resampling settings, shock-index policy, and the canonical 6-feature clustering tuple (`clustering_core_features`) in `backend/config/feature_specs.yaml`.
- **Honest Role of EDA:** The Core 6 features are **domain-anchored** across Exposure, Physical Hazard, and Financial Vulnerability to satisfy small-sample parsimony (`N = 17, N/p = 2.83`), and **empirically audited/validated** by EDA (`eda_feature_selection.py`) for skewness (`log1p`), pairwise redundancy (`|r| < 0.85`), and non-collinearity (`max VIF = 4.07 < 5.0`)—not framed as an unconstrained automated feature discovery.
- **Scope boundary:** Monthly feature screening studies associations with tourism occupancy/revenue measures; structural screening checks redundancy for province-level descriptive clustering. Household/SME debt indicators are contextual provincial survey aggregates, not individual borrower outcomes. These analyses do not estimate debt-relief effectiveness, individual default probability, or causal effects. Keep this boundary visible in charts, API descriptions, and public-facing copy.
- **Scope boundary:** Monthly feature screening currently studies associations with tourism occupancy/revenue measures; structural screening checks redundancy for province-level descriptive clustering. Household/SME debt indicators are contextual provincial survey aggregates, not individual borrower outcomes. These analyses do not estimate debt-relief effectiveness, individual default probability, or causal effects. Keep that boundary visible in charts, API descriptions, and public-facing copy.

### ADR-03: Exclude News Volume (`news_shock_count`) from Quantitative Models
- **Empirical Evidence:** Across `244` verified events in `silver.news_events` (17 provinces), the top 3 provinces (`CR` 79, `CM` 23, `NN` 17) hold **48.8%** of all articles, while `TK` has only 3 (**26.3x max/min gap**).
- **Decision:** Permanently exclude `news_shock_count` from lag modeling and default clustering to avoid Media Concentration Bias. Route verified news (100% verbatim quote & province grounded) strictly to qualitative alert feeds and mark `recent_news_shock_score` as an unchecked `"Experimental (Media Bias)"` toggle in the Staff Clustering Lab.

### ADR-04: `log1p` Transformation + Core 6 Small-Sample Parsimony (`N = 17`)
- **Empirical Evidence:**
  - `foreign_visitor_share` raw skewness is **`+1.59`** (`CM`/`MH`/`ST` outliers) → applying `log1p` produces `log_foreign_visitor_share` with skewness **`+0.49`**.
  - With `N = 17` provinces, keeping too many correlated indicators inflates VIF and causes curse of dimensionality. Pruning `|r| >= 0.85` removes `foreign_revenue_share` (`|r|=0.98`), `pm25_mean_3y` (`|r|=0.86`), `pm25_p90_3y` (`|r|=0.96`). Testing marginal VIF against the canonical Core 6 rejects `annual_heavy_rain_days` (`VIF = 33.76`) and `debt_to_annual_income_sme` (`VIF = 5.10`), while separating raw-scale/secondary liquidity proxies (`avg_monthly_revenue_mthb`, `expense_to_income_pct_*`) preserves **`N/p = 17/6 = 2.83`** with **`max VIF = 4.07 < 5.0`**.
  - **Historical model benchmark (`KMeans k=4, StandardScaler`):** A previously recorded run compared 24 combinations (3 families × 2 scalers × `k = 2..5`). It reported `Silhouette = 0.2712`, `DBI = 1.0253`, `CH = 8.91`, perturbation ARI `= 0.984`, cross-scaler ARI `= 1.000`, and KMeans/Ward ARI `= 0.805`. These show partition stability under the tested perturbations and alternatives only; they do not validate the groups as real risk types or predict debt distress. Recompute and attach a run ID before presenting them as current.

### ADR-05: Anti-Lookahead Preprocessing, BH-FDR, and Province-Clustered SE
- **Context:** Monthly provincial panel rows (`17 × 34 = 578`) exhibit strong within-province autocorrelation (`AR(1) = +0.49` for `occupancy_deseason`, `+0.61` for `revenue_deseason_pct`), violating i.i.d. assumptions.
- **Decision:**
  - Fit seasonal baselines, winsorization caps (98th percentile), rainfall regime P75/P95 cutoffs, and Composite Shock Index empirical weights strictly on the **chronological 75% Train window (`<= 2026-02-01`)** before evaluating the out-of-sample holdout (`n = 136`).
  - Apply **within-province circular block permutation** for monthly feature-lag hypotheses, then **Benjamini-Hochberg FDR** across the tested family; use restricted Rademacher wild-cluster bootstrap alongside province-clustered covariance in the fixed-effects OLS summary.
  - With 17 province clusters, label results `exploratory_within_province_screening_not_causal`. Resampling improves the treatment of serial dependence and small-cluster inference; it does not establish causal effects or make the estimates confirmatory.

### ADR-06: Grounded Hybrid RAG + Zero LLM Arithmetic + Quality Gate
- **Decision:**
  - All financial calculations (Gross-Income DSR, installment scenarios, cash cushion) run deterministically in Python (`dsr_calculator.py`) and TypeScript (`financial-dossier.ts`) — **never** by LLM arithmetic.
  - Chat requests pass deterministic **PII Redaction** (100% on 20 cases) and **Prompt Injection Defense** (100% on 10 cases) before touching Gemini, retrieve chunks via **Hybrid RRF (Vector 68% + BM25 32%)**, enforce cosine similarity threshold (`>= 0.50`), and verify every `(doc_title, page_num)` citation verbatim against retrieved chunks (`rag_verifier.py`).
  - **PDF Quality Gate (`assess_pdf_text_quality`):** Rejects image-only scanned or garbled-font PDFs before indexing. Gemini or local Tesseract can prepare resumable OCR drafts, but both require human review and explicit approval before indexing. SMEs Secure+ is mapped to BOT circular `25690074.pdf` and its attached framework; OCR must be checked against that exact source. `25690073.pdf` is the corresponding circular for commercial financial institutions, not a standalone text PDF.

### ADR-07: Dual-Role Staff Governance RBAC (`policy_analyst` vs `data_steward`)
- **Decision:** Separate analytical decision-making from data-quality governance via stateless HMAC-SHA256 tokens (8-hour expiry) and backend `403 Forbidden` enforcement:
  - `policy_analyst`: Provincial monitor, experimental Monte Carlo / Re-clustering (`persist=false`), 1-page A4 policy brief export. Blocked from `/api/data-health`, `/api/refresh`, and persisting live cluster labels.
  - `data_steward`: Medallion health, `silver.quarantine` audit, layered eval runs, live ELT refresh, and approving persisted clusters (`persist=true`). Blocked from policy brief generation.
  - `admin` (optional): Combined governance & policy access.

### ADR-08: Fail-Closed Data Readiness and Atomic Gold Publication
- **Decision:** In full mode, require successful upstream stages and configured freshness/coverage/schema checks before computing Gold. Latest revisions are materialized in `silver.provincial_stats_resolved`; conflicting values are counted and reported while the deterministic latest revision is used.
- **Publication:** Compute outputs in memory, validate coverage and shared `run_id`, then replace the live panel and cluster snapshot and append feature-screening/cluster history within one PostgreSQL transaction. A failed stage or write rolls back the publication transaction.
- **Duplicate policy:** Bronze retains source revisions. Gold panel construction sorts revisions deterministically and uses a strict `pivot` after revision resolution, so an unexpected duplicate natural key raises an error rather than silently selecting its first row.
- **Operational limit:** Code changes do not update an existing database until the idempotent schema migration is applied. Freshness cutoffs and coverage floors must be reviewed against the actual source release cadence before operational use.

---

## 2. Core Data Dictionary (Gold Analytics & Canonical Features)

| Feature / Column | Source / Layer | Grain | Unit / Range | Role in System |
| :--- | :--- | :--- | :--- | :--- |
| `avg_occupancy_rate` | MOTS (`bronze.provincial_stats_raw`) | `province_3y` | `%` (`0..100`) | Core 6 Clustering (`VIF 1.99`) |
| `occupancy_volatility` | MOTS (34M std dev) | `province_3y` | `pp` (`0..40`) | Core 6 Clustering (`VIF 4.07`) |
| `log_foreign_visitor_share` | MOTS (`log1p` of `%`) | `province_3y` | `log1p(%)` (`0..4.62`) | Core 6 Clustering (`VIF 1.91`) |
| `annual_pm25_days_over_37_5` | Open-Meteo (annualized) | `province_3y` | `days/yr` (`0..365`) | Core 6 Clustering (`VIF 1.59`) |
| `max_monthly_rainfall_mm` | Open-Meteo ERA5 | `province_3y` | `mm` (`0..1500`) | Core 6 Clustering (`VIF 1.64`) |
| `debt_to_annual_income_all` | NSO 2025 (`SFD_SPB0801`) | `province_year` | `ratio (x)` (`0..5`) | Core 6 Clustering (`VIF 1.82`) |
| `occupancy_deseason` | MOTS (train-fit deseason) | `province_month` | `pp` | EDA target for tourism conditions, not debt distress |
| `revenue_deseason_pct` | MOTS (train-fit deseason) | `province_month` | `%` | EDA target for tourism revenue, not debt distress |
| `composite_shock_idx` | Physical (`0.78`) + Macro (`0.22`) | `province_month` | `0..100` | Alert Bands (`<30`, `30–49`, `50–69`, `>=70`) |
| `expense_to_income_pct_sme` | NSO 2025 | `province_year` | `%` | Cash Cushion (`<15%` flags `KP, PL, UT`) + Optional Lab toggle |
| `recent_news_shock_score` | `silver.news_events` | `province_90d` | `0..100` | Qualitative Alerts / Experimental Lab toggle only |

---

## 3. Objective-to-Implementation Traceability Matrix

| Objective | Target Persona | Modules & Routes | Proof Artifacts |
| :--- | :--- | :--- | :--- |
| **O1. Reliable Open-Data ELT** | Data Steward | `run_pipeline.py`, `src/extract/*`, `silver_clean.py`, `llm_shock_extractor.py`, `.github/workflows/daily_elt.yml` | Historical Layer 2 checks and lineage artifacts; table counts vary by run and data snapshot |
| **O2. Exploratory Regional Analytics** | Policy Analyst | `panel_builder.py`, `eda_deep_insights.py`, `eda_feature_selection.py`, `shock_index.py`, `clustering.py` | Historical feature-screening output and figures `02`, `02a–02d`, `03`, `04`; interpret row counts with their run metadata |
| **O3. Debt Preparedness & Simulation** | Citizen / SME | `pricing.tsx`, `platforms.tsx`, `official-resources.tsx`, `dsr_calculator.py`, `financial-dossier.ts` | `shared/policy_catalog.json` (9 programs synced across BE/FE), `gold.relief_query_logs` (No PII) |
| **O4. Safe Grounded Policy AI** | Citizen / SME | `cta.tsx`, `/chat`, `policy_assistant.py`, `indexer.py`, `src/guardrails/*` | Historical retrieval eval: 10 docs / 418 chunks; later user-reported staging sync: 11 docs / 430 chunks; metrics are run-specific |
| **O5. Role-Separated Policy Governance** | Analyst & Steward | `staff-portal.tsx`, `staff-workspace.tsx`, `vulnerability_lab.py`, `brief_generator.py`, `layered_eval.py` | Backend `403` RBAC tests, Staff Lab synced to Core 6 |

---

## 4. Committee Defense Q&A Cheat Sheet

1. **Q: Why is `Silhouette = 0.271` acceptable for your 17-province clustering?**  
   **A:** Regional economic profiles vary continuously across geography rather than forming isolated islands, and with `N = 17` provinces in 6 dimensions (`N/p = 2.83`), Silhouette scores around `0.25–0.35` are expected. Therefore we evaluate 4 criteria jointly (Silhouette, DBI `1.025`, CH `8.91`, and **Perturbation Stability ARI = `0.984`** + **Cross-Scaler ARI = `1.000`**), proving that cluster assignments remain highly stable under noise and scaling changes.

2. **Q: Why didn't you include news events directly inside the clustering model?**  
   **A:** Our live audit of `silver.news_events` (244 events) proved severe **Media Concentration Bias**: the top 3 provinces (`CR`, `CM`, `NN`) account for **48.8%** of news volume while `TK` has only 3 events (`26.3x` gap). Including news counts would cluster provinces by media attention rather than underlying economic vulnerability. Instead, verified news feeds qualitative alerts and an optional clearly labeled experimental toggle.

3. **Q: Why did you remove Kruskal-Wallis p-values from the monthly panel charts?**  
   **A:** Our autocorrelation audit (`02b` Panel D) showed strong within-province persistence (`AR(1) = +0.49` to `+0.61`), violating the i.i.d. assumption required by Kruskal-Wallis or raw Spearman p-values. For inference, we rely on **Benjamini-Hochberg FDR** screening plus **Within-Province Fixed-Effects OLS with Province-Clustered SE** (`02` Panel B), explicitly scoped as exploratory rather than causal.

4. **Q: How do you guarantee the AI doesn't hallucinate debt relief rules or leak personal data?**  
   **A:** Four deterministic guardrails: (1) Single-pass PII redaction (100% recall on 20 test cases) strips IDs/phones/emails/bank accounts before any API call; (2) Prompt injection filter blocks attacks at zero token cost (100% on 10 cases); (3) Hybrid RRF retrieval enforces similarity `>= 0.50` and verbatim `(doc_title, page_num)` citation verification (`100%` provenance, `100%` trap refusal on 10 traps); (4) All DSR and payment math executes deterministically outside the LLM.

5. **Q: What happens if an upstream government PDF is scanned or broken?**  
   **A:** `bot_pdf_loader.py` runs `assess_pdf_text_quality()` before deleting old versions or calling the embedding API. Image-only PDFs are kept out of `silver.policy_chunks` until OCR is complete, reviewed against the exact source, and explicitly approved. The SMEs Secure+ framework is mapped to BOT circular and framework attachment `25690074.pdf`. The latest user-reported staging sync indexed four pages as 12 chunks after review; recheck the target database before claiming the document is present in a deployed index. The catalog routes users to the official framework with a lender-verification disclaimer.

6. **Q: What are the honest limitations and next steps?**  
   **A:** (1) A usability protocol and an opt-in staging HTTP probe exist, but neither a participant study nor a Render load test has been run; (2) Monthly panel inference remains exploratory and is not causal; (3) The latest user-reported sync indexed SMEs Secure+ after review, but this workspace review did not query the deployment database; (4) schema changes and pipeline features require a staging migration and fresh run before they can be considered operational. Evaluation metrics must name their run and data cutoff.

---

## 5. Open Data Source Registry (Ownership, Cadence, License & Caveats)

> **Non-Affiliation Statement:** This project is an independent analytical prototype referencing public open datasets. Listing an agency below indicates **data provenance only**—not formal partnership, endorsement, or official service status.

| Dataset | Owner Agency | Cadence | Open-Data Access / Terms | Methodological & Population Caveats |
| :--- | :--- | :--- | :--- | :--- |
| **BOT Policy & Regional Reports (11 PDFs)** | Bank of Thailand (BOT) | Ad-hoc / Quarterly | Public official publications (`bot.or.th`) | Historical retrieval evaluation covered 10 of 11 PDFs; later user-reported staging sync indexed all 11. Verify target environment before relying on live coverage. |
| **Tourism Occupancy & Revenue (`mots_monthly_*`)** | Ministry of Tourism & Sports (MOTS) | Monthly (revised annually) | Public government statistics (`mots.go.th`) | Revisions handled deterministically via latest `fetched_at DESC, id DESC` |
| **Household Socio-Economic Survey (`SFD_SPB0801`)** | National Statistical Office (NSO) | Biennial (2023, 2025) | Open Government Data Catalog (`catalogapi.nso.go.th`) | **Provincial sample-survey averages** (All households & Non-farm SMEs); **cannot represent any individual borrower** (Ecological Fallacy guard) |
| **Live PM2.5 Sensors (`Air4Thai`)** | Pollution Control Department (PCD) | Hourly (daily Silver agg) | Public API (`air4thai.pcd.go.th`) | Negative sentinel `-1.0` and stale stations (`>48h`) routed to `silver.quarantine` |
| **Historical PM2.5 & Rainfall (36M)** | Open-Meteo (ERA5 / CAMS) | Daily → Monthly | CC BY 4.0 (Non-commercial open API) | Reanalysis grid at provincial centroids; missing rows kept `NaN` (no silent zero fill) |
| **Headline CPI & Macro Controls** | BIS & Federal Reserve (FRED) | Monthly | Public open CSV endpoints | National-level controls merged by month (`macro_month` grain) |
| **Northern Local News Feeds** | Google News RSS (19 queries) | Daily | Public RSS headlines/snippets | Exhibits 48.8% top-3 Media Concentration Bias → qualitative alerts only |

---

## 6. Data Flow & PDPA Privacy Summary (Honest Path)

1. **Client-Side Calculator (`pricing.tsx` / `financial-dossier.ts`):** Income, expenses, debt balances, and scenario schedules compute locally in the browser; raw amounts are never written to our database.
2. **Anonymous Telemetry (`gold.relief_query_logs`):** Stores only non-identifying aggregate tags (`province_code`, `business_type`, `dsr_band`, `matched_program`, `was_refused`)—zero names, IDs, phones, emails, income, or debt amounts.
3. **Chat Assistant (`/api/chat` → `policy_assistant.py`):** User questions pass deterministic single-pass PII redaction (`pii_redactor.py`, 20/20 test cases) before being sent transiently to **Google Gemini API** solely to generate a citation-grounded answer; raw chat text is not stored in Neon PostgreSQL.
4. **Staff Portal Security (`main.py`):** Stateless HMAC-SHA256 bearer tokens (8h expiry) with strict backend RBAC (`policy_analyst` vs `data_steward` vs `admin`) and **fail-closed signing secret** (rejects requests if signing secret is unconfigured).

---

## 7. Hand-Check Walkthrough Cases (For BOT / Committee Verification)

### Case 1: Deterministic Gross-Income DSR (`backend/src/analytics/dsr_calculator.py`)
- **Input:** `monthly_revenue_thb = 45,000 THB`, `monthly_debt_thb = 27,000 THB`
- **Hand Formula:** $\text{DSR}_{\text{gross}} = \frac{27,000}{45,000} \times 100 = 60.00\%$
- **Band Rule:** `<40%` Stable · `40%..<60%` Watch · **`60%..<80%` Tight (`ตึงตัวสูง`)** · `>=80%` Critical
- **Verification:** `calculate_dsr(45000, 27000)` returns `dsr_pct = 60.0`, `band = "tight"`, `formula_type = "gross_income_dsr"` (zero LLM arithmetic; post-expense cash buffer evaluated separately in `financial-dossier.ts`).

### Case 2: Deterministic Provincial Screening Index (`backend/src/analytics/vulnerability_tiering.py`)
- **Formula (Descriptive Screening Index — Not a Probability):**
  $$\text{Index} = 0.55 \times \text{Cashflow/Debt}_{\text{NSO}} + 0.25 \times \text{Tourism Exposure}_{\text{MOTS}} + 0.20 \times \text{Hazard/News}$$
  - Cashflow/Debt subscore (`0–100`): `0.50 × clamp((1 - min(sme_margin, 45)/45)×100) + 0.35 × clamp((sme_debt/1.4)×100) + 0.15 × clamp((hh_debt/1.4)×100)`
  - Tourism subscore (`0–100`): `0.55 × clamp((1 - min(occ, 80)/80)×100) + 0.45 × clamp(exposure)`
  - Hazard subscore (`0–100`): `0.50 × hist_shock + 0.25 × latest_shock + 0.25 × news_boost`
  - Missing inputs are **renormalized over observed weights** (never silently filled with `0`); provinces missing NSO inputs are explicitly flagged `insufficient_data`.
- **Example Check (`sme_margin = 10%`, `sme_debt = 1.4x`, `hh_debt = 0.7x`):**
  - Margin term: `(1 - 10/45) × 100 = 77.78`
  - SME debt term: `(1.4/1.4) × 100 = 100.00`
  - HH debt term: `(0.7/1.4) × 100 = 50.00`
  - Cashflow subscore: `0.50(77.78) + 0.35(100.00) + 0.15(50.00) = 38.89 + 35.00 + 7.50 = 81.39` (matches `vulnerability_tiering.py` to the exact decimal).

