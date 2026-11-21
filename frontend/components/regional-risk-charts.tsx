"use client"

import { useMemo, useState } from "react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { Lang, ProvinceSeriesPoint, QuadrantProvince } from "@/lib/api"
import { formatGroupTag, formatThaiMonth, translateClusterLabel } from "@/lib/i18n"

// Unified 5-cluster palette shared with StaffWorkspace and Clustering Lab
export const CLUSTER_COLORS: Record<number, string> = {
  1: "#0f766e", // teal-700
  2: "#d97706", // amber-600
  3: "#334155", // slate-700
  4: "#94a3b8", // slate-400
  5: "#4f46e5", // indigo-600
}

export const CLUSTER_DOT_CLASS: Record<number, string> = {
  1: "bg-teal-700",
  2: "bg-amber-600",
  3: "bg-slate-700",
  4: "bg-slate-400",
  5: "bg-indigo-600",
}

type PlottableProvince = QuadrantProvince & {
  shock_intensity: number
  exposure_score: number
}

export function RegionalRiskGrouping({
  provinces,
  selectedCode,
  onSelectProvince,
  lang,
}: {
  provinces: QuadrantProvince[]
  selectedCode: string
  onSelectProvince: (code: string) => void
  lang: Lang
}) {
  const [hovered, setHovered] = useState<QuadrantProvince | null>(null)

  const { plottable, omittedCount, clusterIds } = useMemo(() => {
    const valid: PlottableProvince[] = []
    let omitted = 0
    const idSet = new Set<number>()

    for (const p of provinces) {
      if (
        p.shock_intensity != null &&
        p.exposure_score != null &&
        Number.isFinite(p.shock_intensity) &&
        Number.isFinite(p.exposure_score)
      ) {
        valid.push(p as PlottableProvince)
        if (p.cluster_id != null) idSet.add(p.cluster_id)
      } else {
        omitted += 1
      }
    }

    return {
      plottable: valid,
      omittedCount: omitted,
      clusterIds: Array.from(idSet).sort((a, b) => a - b),
    }
  }, [provinces])

  const selectedProvince = useMemo(
    () => provinces.find((p) => p.province_code === selectedCode) ?? null,
    [provinces, selectedCode],
  )

  const activeInfo = hovered ?? selectedProvince

  // SVG coordinate helpers mapping (0..100, 0..100) onto (64..764, 272..26)
  const toX = (shock: number) => 64 + Math.max(0, Math.min(100, shock)) * 7.0
  const toY = (exposure: number) => 272 - Math.max(0, Math.min(100, exposure)) * 2.46

  // Compute enclosing ellipse per cluster dynamically for any k (e.g. k=3, 4, 5)
  const clusterEnclosures = useMemo(
    () =>
      clusterIds
        .map((cid) => {
          const members = plottable.filter((p) => p.cluster_id === cid)
          if (!members.length) return null
          const xs = members.map((m) => toX(m.shock_intensity))
          const ys = members.map((m) => toY(m.exposure_score))
          const minX = Math.min(...xs)
          const maxX = Math.max(...xs)
          const minY = Math.min(...ys)
          const maxY = Math.max(...ys)
          const cx = (minX + maxX) / 2
          const cy = (minY + maxY) / 2
          const rx = Math.max(38, (maxX - minX) / 2 + 30)
          const ry = Math.max(26, (maxY - minY) / 2 + 22)
          return {
            cid,
            cx,
            cy,
            rx,
            ry,
            color: CLUSTER_COLORS[cid] || "#475569",
            label: formatGroupTag(cid, lang),
          }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    [clusterIds, plottable, lang],
  )

  if (!plottable.length) {
    return (
      <div className="flex h-52 items-center justify-center rounded-xl border border-dashed border-border bg-secondary/20 px-4 text-center text-xs text-muted-foreground">
        {lang === "th"
          ? "ยังไม่มีข้อมูลคะแนนแรงกระแทกภายนอกและความเปราะบางเพียงพอสำหรับสร้างแผนภาพ"
          : "Insufficient external shock and exposure scores to render the regional grouping chart."}
      </div>
    )
  }

  return (
    <div className="relative w-full">
      {/* Horizontal scroll wrapper preserves readable SVG text on narrow mobile screens */}
      <div className="w-full overflow-x-auto pb-1">
        <div className="min-w-[640px]">
          <svg
            viewBox="0 0 800 322"
            role="img"
            aria-label={
              lang === "th"
                ? "แผนภาพการกระจายตัวของกลุ่มจังหวัดภาคเหนือตามแรงกระแทกภายนอกและความเปราะบางด้านหนี้และการท่องเที่ยว"
                : "Regional grouping scatter plot of Northern provinces by external shock intensity and tourism/debt exposure"
            }
            className="h-auto w-full select-none overflow-visible text-foreground"
          >
            {/* Background plot frame and 50/50 reference quadrant dividers */}
            <rect
              x={64}
              y={26}
              width={700}
              height={246}
              rx={12}
              className="fill-secondary/30 stroke-border"
            />
            <line
              x1={414}
              y1={26}
              x2={414}
              y2={272}
              className="stroke-border"
              strokeDasharray="4 4"
            />
            <line
              x1={64}
              y1={149}
              x2={764}
              y2={149}
              className="stroke-border"
              strokeDasharray="4 4"
            />

            {/* Quadrant corner guide labels */}
            <text x={76} y={46} fontSize={10.5} className="fill-muted-foreground">
              {lang === "th"
                ? "พึ่งพาท่องเที่ยว/หนี้สูง · แรงกระแทกภายนอกต่ำ"
                : "High Exposure · Low External Shock"}
            </text>
            <text
              x={752}
              y={46}
              textAnchor="end"
              fontSize={10.5}
              fontWeight={600}
              className="fill-red-700 dark:fill-red-400"
            >
              {lang === "th"
                ? "เฝ้าระวังสูงสุด (พึ่งพาท่องเที่ยว/หนี้สูง · แรงกระแทกสูง)"
                : "Critical Watch (High Exposure · High External Shock)"}
            </text>
            <text
              x={76}
              y={260}
              fontSize={10.5}
              className="fill-teal-700 dark:fill-teal-400"
            >
              {lang === "th"
                ? "พึ่งพา/หนี้ต่ำ · แรงกระแทกภายนอกต่ำ"
                : "Low Exposure · Low External Shock"}
            </text>
            <text x={752} y={260} textAnchor="end" fontSize={10.5} className="fill-muted-foreground">
              {lang === "th"
                ? "พึ่งพา/หนี้ต่ำ · แรงกระแทกภายนอกสูง"
                : "Low Exposure · High External Shock"}
            </text>

            {/* Enclosing cluster ellipses */}
            {clusterEnclosures.map((enc) => (
              <g key={`enc-${enc.cid}`}>
                <ellipse
                  cx={enc.cx}
                  cy={enc.cy}
                  rx={enc.rx}
                  ry={enc.ry}
                  fill={enc.color}
                  fillOpacity={0.09}
                  stroke={enc.color}
                  strokeWidth={1.6}
                  strokeDasharray="5 4"
                  strokeOpacity={0.65}
                />
                <text
                  x={enc.cx}
                  y={Math.max(38, enc.cy - enc.ry + 12)}
                  textAnchor="middle"
                  fontSize={10.5}
                  fontWeight={700}
                  fill={enc.color}
                >
                  {enc.label}
                </text>
              </g>
            ))}

            {/* Keyboard-accessible province circles and full TH/EN labels */}
            {plottable.map((p, idx) => {
              const cx = toX(p.shock_intensity)
              const cy = toY(p.exposure_score)
              const isSel = p.province_code === selectedCode
              const color = CLUSTER_COLORS[p.cluster_id] || "#475569"
              const radius = isSel
                ? 9
                : Math.max(
                    5.5,
                    Math.min(8.5, 5 + Math.log10(Math.max(10, p.avg_monthly_revenue_mthb))),
                  )
              const labelYOffset = idx % 2 === 0 ? -radius - 6 : radius + 12
              const displayName = lang === "th" ? p.name_th : p.name_en

              return (
                <g
                  key={p.province_code}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSel}
                  aria-label={
                    lang === "th"
                      ? `${displayName} แรงกระแทกภายนอก ${p.shock_intensity.toFixed(1)} ความเปราะบาง ${p.exposure_score.toFixed(1)}`
                      : `${displayName}, external shock ${p.shock_intensity.toFixed(1)}, exposure ${p.exposure_score.toFixed(1)}`
                  }
                  onClick={() => onSelectProvince(p.province_code)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onSelectProvince(p.province_code)
                    }
                  }}
                  onMouseEnter={() => setHovered(p)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(p)}
                  onBlur={() => setHovered(null)}
                  className="cursor-pointer outline-none focus-visible:opacity-100"
                >
                  {isSel && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={radius + 4}
                      fill="none"
                      className="stroke-foreground"
                      strokeWidth={2}
                    />
                  )}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={radius}
                    fill={color}
                    fillOpacity={0.92}
                    className="stroke-background"
                    strokeWidth={1.6}
                  />
                  <text
                    x={cx}
                    y={cy + labelYOffset}
                    textAnchor="middle"
                    fontSize={10.5}
                    fontWeight={isSel ? 700 : 500}
                    className="fill-foreground stroke-background"
                    strokeWidth={2.8}
                    paintOrder="stroke"
                  >
                    {displayName}
                  </text>
                </g>
              )
            })}

            {/* Axis ticks and titles */}
            {[0, 25, 50, 75, 100].map((v) => (
              <text
                key={`x-${v}`}
                x={toX(v)}
                y={289}
                textAnchor="middle"
                fontSize={10.5}
                className="fill-muted-foreground"
              >
                {v}
              </text>
            ))}
            {[0, 25, 50, 75, 100].map((v) => (
              <text
                key={`y-${v}`}
                x={54}
                y={toY(v) + 3.5}
                textAnchor="end"
                fontSize={10.5}
                className="fill-muted-foreground"
              >
                {v}
              </text>
            ))}
            <text
              x={414}
              y={311}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              className="fill-foreground"
            >
              {lang === "th"
                ? "ระดับแรงกระแทกภายนอก: ฝุ่น น้ำท่วม และเหตุการณ์ผลกระทบ (คะแนน 0–100)"
                : "External Shock Intensity: Haze, Flooding & Events (0–100)"}
            </text>
            <text
              x={16}
              y={149}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              className="fill-foreground"
              transform="rotate(-90 16 149)"
            >
              {lang === "th"
                ? "ความเปราะบางด้านหนี้และการพึ่งพาท่องเที่ยว (0–100)"
                : "Tourism & Debt Exposure Score (0–100)"}
            </text>
          </svg>
        </div>
      </div>

      {/* Chart reading guide & omitted province notice */}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {lang === "th"
            ? "ขนาดวงกลมแทนรายได้ท่องเที่ยวเฉลี่ยต่อเดือน · เส้นประแบ่งเกณฑ์อ้างอิงที่คะแนน 50 · เส้นวงรีแสดงขอบเขตกลุ่มเพื่อการมองเห็น"
            : "Circle size reflects average monthly tourism revenue · Dashed lines mark the 50-point reference midpoint · Ellipses show visual group bounds"}
        </span>
        {omittedCount > 0 && (
          <span className="font-medium text-amber-700 dark:text-amber-400">
            {lang === "th"
              ? `ไม่ได้แสดง ${omittedCount} จังหวัดเนื่องจากขาดข้อมูลคะแนน`
              : `${omittedCount} province(s) omitted due to missing scores`}
          </span>
        )}
      </div>

      {/* Persistent detail strip (shows hovered province or currently selected province for touch/mobile) */}
      {activeInfo && (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-secondary/40 px-3.5 py-2.5 text-xs">
          <div>
            <span className="font-semibold text-foreground">
              {lang === "th" ? activeInfo.name_th : activeInfo.name_en}
            </span>{" "}
            <span className="text-muted-foreground">
              · {formatGroupTag(activeInfo.cluster_id, lang)} (
              {translateClusterLabel(activeInfo.cluster_label, lang)})
            </span>
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] tabular-nums text-muted-foreground">
            <span>
              {lang === "th" ? "แรงกระแทกภายนอก" : "External Shock"}:{" "}
              <strong className="text-foreground">
                {activeInfo.shock_intensity != null ? activeInfo.shock_intensity.toFixed(1) : "—"}
              </strong>
            </span>
            <span>
              {lang === "th" ? "ความเปราะบาง" : "Exposure"}:{" "}
              <strong className="text-foreground">
                {activeInfo.exposure_score != null ? activeInfo.exposure_score.toFixed(1) : "—"}
              </strong>
            </span>
            <span>
              {lang === "th" ? "หนี้ SME ต่อรายได้ต่อปี" : "SME Debt"}:{" "}
              <strong className="text-foreground">
                {activeInfo.debt_to_annual_income_sme != null
                  ? `${activeInfo.debt_to_annual_income_sme.toFixed(2)} ${lang === "th" ? "เท่า" : "x"}`
                  : "—"}
              </strong>
            </span>
            <span>
              {lang === "th" ? "รายได้เฉลี่ย/เดือน" : "Avg Revenue/mo"}:{" "}
              <strong className="text-foreground">
                {Math.round(activeInfo.avg_monthly_revenue_mthb).toLocaleString()}{" "}
                {lang === "th" ? "ลบ." : "M THB"}
              </strong>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export function ProvinceHistoryChart({
  series,
  months,
  lang,
}: {
  series: ProvinceSeriesPoint[]
  months: number
  lang: Lang
}) {
  const sliced = useMemo(
    () =>
      series.slice(-months).map((s) => ({
        label: formatThaiMonth(s.month_date, lang),
        occupancy: s.occupancy_rate != null ? Number(s.occupancy_rate.toFixed(1)) : null,
        pm25: s.pm25_mean != null ? Number(s.pm25_mean.toFixed(1)) : null,
        shock: s.composite_shock_idx != null ? Number(s.composite_shock_idx.toFixed(1)) : null,
      })),
    [series, months, lang],
  )

  const hasData = sliced.some((d) => d.occupancy != null || d.pm25 != null || d.shock != null)

  if (!hasData) {
    return (
      <div className="mt-3 flex h-[240px] items-center justify-center rounded-xl border border-dashed border-border bg-secondary/20 px-4 text-center text-xs text-muted-foreground">
        {lang === "th"
          ? "ไม่มีข้อมูลอนุกรมเวลารายเดือนสำหรับจังหวัดนี้ในช่วงเวลาที่เลือก"
          : "No monthly historical series available for this province in the selected window."}
      </div>
    )
  }

  return (
    <div className="mt-2 h-[265px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={sliced} margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 5" vertical={false} className="stroke-border" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#64748b" }}
            interval="preserveStartEnd"
            minTickGap={36}
          />
          {/* Dedicated Left Y-Axis for PM2.5 (µg/m³) with auto upper bound so peaks >100 are never clipped */}
          <YAxis
            yAxisId="pm25"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#d97706" }}
            width={46}
            domain={[0, (dataMax: number) => Math.max(100, Math.ceil((dataMax + 10) / 20) * 20)]}
            unit=" µg"
          />
          {/* Right Y-Axis (0-100 scale) shared by Occupancy (%) and External Shock Index (0-100) */}
          <YAxis
            yAxisId="scale100"
            orientation="right"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#64748b" }}
            width={38}
            domain={[0, 100]}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              return (
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
                  <p className="mb-1.5 font-semibold text-foreground">{label}</p>
                  <div className="space-y-1">
                    {payload.map((entry, idx) => {
                      const val = entry.value
                      const formatted =
                        val == null || Number.isNaN(Number(val))
                          ? "—"
                          : entry.dataKey === "pm25"
                            ? `${Number(val).toFixed(1)} µg/m³`
                            : entry.dataKey === "occupancy"
                              ? `${Number(val).toFixed(1)}%`
                              : `${Number(val).toFixed(1)} / 100`
                      return (
                        <div key={idx} className="flex items-center justify-between gap-4 text-[11px]">
                          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ backgroundColor: entry.color }}
                            />
                            {entry.name}
                          </span>
                          <span className="font-semibold tabular-nums text-foreground">
                            {formatted}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            }}
          />
          <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: "11px" }} />
          <Line
            yAxisId="pm25"
            dataKey="pm25"
            name={
              lang === "th"
                ? "ค่าฝุ่น PM2.5 เฉลี่ย (µg/m³ · แกนซ้าย)"
                : "Avg PM2.5 (µg/m³ · Left)"
            }
            type="monotone"
            stroke="#d97706"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
          <Line
            yAxisId="scale100"
            dataKey="shock"
            name={
              lang === "th"
                ? "ดัชนีแรงกระแทกภายนอก (0–100 · แกนขวา)"
                : "External Shock Index (0–100 · Right)"
            }
            type="monotone"
            stroke="#64748b"
            strokeWidth={1.6}
            strokeDasharray="4 4"
            dot={false}
            connectNulls={false}
          />
          <Line
            yAxisId="scale100"
            dataKey="occupancy"
            name={lang === "th" ? "อัตราเข้าพัก (% · แกนขวา)" : "Occupancy (% · Right)"}
            type="monotone"
            stroke="#0f766e"
            strokeWidth={2.3}
            dot={{ r: 2 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}