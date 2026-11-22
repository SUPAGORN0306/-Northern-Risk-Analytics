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
  1: "#e57373",
  2: "#f5b87a",
  3: "#93c5e8",
  4: "#7ec8a9",
}

function getFillColor(item: ProvinceOutlookItem | undefined, mode: MapMetricMode): string {
  if (!item) return "#eef2f6"
  if (mode === "cluster") {
    return TIER_FILLS[item.vulnerability_tier ?? 3] || "#93c5e8"
  }
  if (mode === "occupancy") {
    const occ = item.occupancy_rate ?? 0
    if (occ >= 68) return "#6bb8a8"
    if (occ >= 58) return "#99d6c8"
    if (occ >= 48) return "#c8ece3"
    return "#e8eef3"
  }
  const smeDebt = item.debt_to_annual_income_sme ?? item.debt_to_annual_income_all ?? 0
  const expRatio = item.expense_to_income_pct_sme ?? item.expense_to_income_pct_all ?? 0
  if (smeDebt >= 1.0 || expRatio >= 88) return "#e57373"
  if (smeDebt >= 0.7 || expRatio >= 82) return "#f5b482"
  if (smeDebt >= 0.5 || expRatio >= 78) return "#fae588"
  return "#7ec8a9"
}

function isDarkFill(hex: string): boolean {
  return ["#0f172a", "#1e293b", "#334155"].includes(hex)
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
                  fillOpacity={isSelected ? 1 : isHovered ? 0.96 : 0.9}
                  stroke={isSelected ? "#1e293b" : "#ffffff"}
                  strokeWidth={isSelected ? 2.6 : isHovered ? 1.8 : 1.15}
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
                  fill={dark ? "#ffffff" : "#1e293b"}
                  stroke={dark ? "rgba(15,23,42,0.45)" : "rgba(255,255,255,0.85)"}
                  strokeWidth={2.2}
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
            <LegendDot color="#6bb8a8" label={lang === "th" ? "อันดับ 1 เข้าพักสูง (68% ขึ้นไป)" : "68%+"} />
            <LegendDot color="#99d6c8" label={lang === "th" ? "อันดับ 2 ปานกลางค่อนสูง (58–68%)" : "58 to 68%"} />
            <LegendDot color="#c8ece3" label={lang === "th" ? "อันดับ 3 ปานกลาง (48–58%)" : "48 to 58%"} />
            <LegendDot color="#e8eef3" label={lang === "th" ? "อันดับ 4 เข้าพักน้อย (ต่ำกว่า 48%)" : "Under 48%"} />
          </>
        )}
        {metricMode === "debt" && (
          <>
            <LegendDot color="#e57373" label={lang === "th" ? "อันดับ 1 หนี้หนักสุด / เงินเหลือน้อย" : "Rank 1 Highest Debt"} />
            <LegendDot color="#f5b482" label={lang === "th" ? "อันดับ 2 หนี้ค่อนข้างสูง" : "Rank 2 Elevated Debt"} />
            <LegendDot color="#fae588" label={lang === "th" ? "อันดับ 3 ภาระหนี้ปานกลาง" : "Rank 3 Moderate Debt"} />
            <LegendDot color="#7ec8a9" label={lang === "th" ? "อันดับ 4 หนี้ต่ำ / เงินเหลือคล่องตัว" : "Rank 4 Low Debt"} />
          </>
        )}
        {metricMode === "cluster" && (
          <>
            <LegendDot color="#e57373" label={lang === "th" ? "อันดับ 1 เปราะบางสูง" : "Tier 1 Critical"} />
            <LegendDot color="#f5b87a" label={lang === "th" ? "อันดับ 2 เปราะบางต่อภัยและฤดูกาล" : "Tier 2 Hazard & Seasonal"} />
            <LegendDot color="#93c5e8" label={lang === "th" ? "อันดับ 3 เฝ้าระวังปานกลาง" : "Tier 3 Moderate"} />
            <LegendDot color="#7ec8a9" label={lang === "th" ? "อันดับ 4 คล่องตัว" : "Tier 4 Resilient"} />
          </>
        )}
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="size-2.5 shrink-0 rounded-full ring-1 ring-black/15"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span>{label}</span>
    </span>
  )
}
