"use client"

import { useState } from "react"
import type { Lang, ProvinceOutlookItem } from "@/lib/api"
import { NORTH17_GEO_SHAPES } from "@/lib/north17-map-data"
import { translateClusterLabel } from "@/lib/i18n"

export type MapMetricMode = "occupancy" | "debt" | "cluster"

type Props = {
  provinces: ProvinceOutlookItem[]
  selectedCode: string
  onSelect: (code: string) => void
  metricMode: MapMetricMode
  lang: Lang
}

const TIER_FILLS: Record<number, string> = {
  1: "#991b1b",
  2: "#d97706",
  3: "#0369a1",
  4: "#0f766e",
}

function getFillColor(item: ProvinceOutlookItem | undefined, mode: MapMetricMode): string {
  if (!item) return "#e5e7eb"
  if (mode === "cluster") {
    return TIER_FILLS[item.vulnerability_tier ?? 3] || "#0369a1"
  }
  if (mode === "occupancy") {
    const occ = item.occupancy_rate ?? 0
    if (occ >= 68) return "#1e3a8a"
    if (occ >= 58) return "#2563eb"
    if (occ >= 48) return "#60a5fa"
    return "#bfdbfe"
  }
  const smeDebt = item.debt_to_annual_income_sme ?? item.debt_to_annual_income_all ?? 0
  const expRatio = item.expense_to_income_pct_sme ?? item.expense_to_income_pct_all ?? 0
  if (smeDebt >= 1.0 || expRatio >= 88) return "#7c2d12"
  if (smeDebt >= 0.7 || expRatio >= 80) return "#c2410c"
  if (smeDebt >= 0.5 || expRatio >= 72) return "#f59e0b"
  return "#fde68a"
}

function isDarkFill(hex: string): boolean {
  return [
    "#0f172a",
    "#1e3a8a",
    "#2563eb",
    "#0369a1",
    "#334155",
    "#475569",
    "#64748b",
    "#0f766e",
    "#b45309",
    "#991b1b",
    "#b91c1c",
    "#d97706",
    "#7c2d12",
    "#c2410c",
  ].includes(hex)
}

function metricValueText(item: ProvinceOutlookItem, mode: MapMetricMode, lang: Lang): string {
  if (mode === "occupancy") {
    return item.occupancy_rate != null
      ? lang === "th"
        ? `อัตราเข้าพัก ${item.occupancy_rate.toFixed(1)}%`
        : `Occupancy ${item.occupancy_rate.toFixed(1)}%`
      : "—"
  }
  if (mode === "debt") {
    const dti = item.debt_to_annual_income_sme != null ? `${item.debt_to_annual_income_sme.toFixed(2)} เท่า` : "—"
    const cushion =
      item.expense_to_income_pct_sme != null
        ? `${Math.max(0, 100 - item.expense_to_income_pct_sme).toFixed(0)}%`
        : "—"
    return lang === "th"
      ? `หนี้ธุรกิจ ${dti} · เงินเหลือ ${cushion}`
      : `SME Debt ${item.debt_to_annual_income_sme?.toFixed(2) ?? "N/A"}x · Surplus ${cushion}`
  }
  if (mode === "cluster") {
    return item.vulnerability_tier
      ? lang === "th"
        ? `ระดับความเสี่ยงเศรษฐกิจในพื้นที่ ${item.vulnerability_tier} (คะแนน ${item.vulnerability_score ?? 0}/100)`
        : `Vulnerability Tier ${item.vulnerability_tier} (${item.vulnerability_score ?? 0}/100)`
      : translateClusterLabel(item.cluster_label, lang)
  }
  return translateClusterLabel(item.cluster_label, lang)
}

export function NorthernThailandMap({
  provinces,
  selectedCode,
  onSelect,
  metricMode,
  lang,
}: Props) {
  const [hoveredCode, setHoveredCode] = useState<string | null>(null)
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null)

  const byCode = new Map(provinces.map((p) => [p.province_code, p]))
  const hoveredItem = hoveredCode ? byCode.get(hoveredCode) : null

  return (
    <div className="flex flex-col">
      <div
        className="relative mx-auto w-full max-w-[430px]"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          setPointerPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
        }}
        onMouseLeave={() => {
          setHoveredCode(null)
          setPointerPos(null)
        }}
      >
        <svg
          viewBox="-14 -14 488 617"
          role="img"
          aria-label={
            lang === "th"
              ? "แผนที่ 17 จังหวัดภาคเหนือแบบโต้ตอบ"
              : "Interactive map of 17 Northern Thailand provinces"
          }
          preserveAspectRatio="xMidYMid meet"
          className="mx-auto block h-auto w-full select-none max-md:h-[min(56dvh,520px)] max-md:w-auto"
        >
          {/* Render province polygons first so borders never overlap neighboring text labels */}
          <g>
            {Object.values(NORTH17_GEO_SHAPES).map((shape) => {
              const item = byCode.get(shape.code)
              const isSelected = shape.code === selectedCode
              const isHovered = shape.code === hoveredCode
              const fill = getFillColor(item, metricMode)

              return (
                <path
                  key={`poly-${shape.code}`}
                  d={shape.path}
                  role="button"
                  tabIndex={0}
                  aria-label={
                    item ? (lang === "th" ? item.name_th : item.name_en) : shape.code
                  }
                  aria-pressed={isSelected}
                  onClick={() => onSelect(shape.code)}
                  onMouseEnter={() => setHoveredCode(shape.code)}
                  onMouseLeave={() => setHoveredCode(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onSelect(shape.code)
                    }
                  }}
                  fill={fill}
                  fillOpacity={isSelected ? 1 : isHovered ? 0.94 : 0.84}
                  stroke={isSelected ? "#09090b" : "#ffffff"}
                  strokeWidth={isSelected ? 2.8 : isHovered ? 1.8 : 1.15}
                  className="cursor-pointer outline-none transition-all duration-150"
                />
              )
            })}
          </g>

          {/* Render text labels on top of all polygons with clean halo legibility */}
          <g className="pointer-events-none select-none">
            {Object.values(NORTH17_GEO_SHAPES).map((shape) => {
              const item = byCode.get(shape.code)
              const isSelected = shape.code === selectedCode
              const fill = getFillColor(item, metricMode)
              const dark = isDarkFill(fill)
              const label = item ? (lang === "th" ? item.name_th : item.province_code) : shape.code
              const labelX = shape.code === "MH" ? shape.labelX + 5 : shape.labelX

              return (
                <text
                  key={`lbl-${shape.code}`}
                  x={labelX}
                  y={shape.labelY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={lang === "th" ? 8.6 : 10}
                  fontWeight={isSelected ? 700 : 600}
                  fill={dark ? "#ffffff" : "#0f172a"}
                  stroke={dark ? "rgba(15,23,42,0.45)" : "rgba(255,255,255,0.75)"}
                  strokeWidth={2}
                  paintOrder="stroke"
                >
                  {label}
                </text>
              )
            })}
          </g>
        </svg>

        {/* Floating cursor following tooltip with core economic and vulnerability metrics */}
        {hoveredItem && pointerPos && (
          <div
            style={{
              left: Math.min(pointerPos.x + 14, 195),
              top: Math.max(pointerPos.y - 76, 8),
            }}
            className="pointer-events-none absolute z-20 w-60 rounded-xl border border-border bg-background/95 px-3.5 py-2.5 text-[11px] shadow-lg backdrop-blur-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-foreground">
                {lang === "th" ? hoveredItem.name_th : hoveredItem.name_en}
              </p>
              {hoveredItem.vulnerability_tier && (
                <span
                  style={{ backgroundColor: hoveredItem.tier_color || "#475569" }}
                  className="rounded-full px-2 py-0.5 text-[9px] font-medium text-white"
                >
                  {lang === "th" ? hoveredItem.tier_short_th : hoveredItem.tier_short_en}
                </span>
              )}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {lang === "th"
                ? `เข้าพัก ${hoveredItem.occupancy_rate != null ? `${hoveredItem.occupancy_rate.toFixed(1)}%` : "—"} · เงินเหลือ ${hoveredItem.expense_to_income_pct_sme != null ? `${Math.max(0, 100 - hoveredItem.expense_to_income_pct_sme).toFixed(0)}%` : "—"}`
                : `Occ ${hoveredItem.occupancy_rate != null ? `${hoveredItem.occupancy_rate.toFixed(1)}%` : "N/A"} · SME Surplus ${hoveredItem.expense_to_income_pct_sme != null ? `${Math.max(0, 100 - hoveredItem.expense_to_income_pct_sme).toFixed(0)}%` : "N/A"}`}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {metricValueText(hoveredItem, metricMode, lang)}
            </p>
            {hoveredItem.has_active_water_pollution && (
              <p className="mt-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                {lang === "th"
                  ? `เฝ้าระวังสารพิษทางน้ำ (${hoveredItem.water_pollution_count ?? 1} ข่าว)`
                  : `Water pollution alert (${hoveredItem.water_pollution_count ?? 1} events)`}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Compact color legend with clear ranking order */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3.5 gap-y-2 border-t border-border pt-3.5 text-[11px] text-muted-foreground">
        {metricMode === "occupancy" && (
          <>
            <LegendDot color="#1e3a8a" label={lang === "th" ? "อันดับ 1 เข้าพักสูง (68% ขึ้นไป)" : "68%+"} />
            <LegendDot color="#2563eb" label={lang === "th" ? "อันดับ 2 ปานกลางค่อนสูง (58–68%)" : "58 to 68%"} />
            <LegendDot color="#60a5fa" label={lang === "th" ? "อันดับ 3 ปานกลาง (48–58%)" : "48 to 58%"} />
            <LegendDot color="#bfdbfe" label={lang === "th" ? "อันดับ 4 เข้าพักน้อย (ต่ำกว่า 48%)" : "Under 48%"} />
          </>
        )}
        {metricMode === "debt" && (
          <>
            <LegendDot color="#7c2d12" label={lang === "th" ? "อันดับ 1 หนี้หนักสุด / เงินเหลือน้อย" : "Rank 1 Highest Debt"} />
            <LegendDot color="#c2410c" label={lang === "th" ? "อันดับ 2 หนี้ค่อนข้างสูง" : "Rank 2 Elevated Debt"} />
            <LegendDot color="#f59e0b" label={lang === "th" ? "อันดับ 3 ภาระหนี้ปานกลาง" : "Rank 3 Moderate Debt"} />
            <LegendDot color="#fde68a" label={lang === "th" ? "อันดับ 4 หนี้ต่ำ / เงินเหลือคล่องตัว" : "Rank 4 Low Debt"} />
          </>
        )}
        {metricMode === "cluster" && (
          <>
            <LegendDot color="#991b1b" label={lang === "th" ? "อันดับ 1 เปราะบางสูง" : "Tier 1 Critical"} />
            <LegendDot color="#d97706" label={lang === "th" ? "อันดับ 2 เปราะบางต่อภัยและฤดูกาล" : "Tier 2 Hazard & Seasonal"} />
            <LegendDot color="#0369a1" label={lang === "th" ? "อันดับ 3 เฝ้าระวังปานกลาง" : "Tier 3 Moderate"} />
            <LegendDot color="#0f766e" label={lang === "th" ? "อันดับ 4 คล่องตัว" : "Tier 4 Resilient"} />
          </>
        )}
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}
