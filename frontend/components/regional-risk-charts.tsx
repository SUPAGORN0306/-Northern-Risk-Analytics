"use client"

import { useState } from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { Lang, ProvinceSeriesPoint, QuadrantProvince } from "@/lib/api"
import { formatGroupTag, formatThaiMonth, translateClusterLabel } from "@/lib/i18n"

const CLUSTER_COLORS: Record<number, string> = {
  1: "#0f766e",
  2: "#d97706",
  3: "#1e3a8a",
  4: "#991b1b",
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
  const clusterIds = [1, 2, 3, 4]

  // SVG coordinate helpers mapping (0..100, 0..100) onto (60..760, 270..25)
  const toX = (shock: number) => 60 + Math.max(0, Math.min(100, shock)) * 7.0
  const toY = (exposure: number) => 270 - Math.max(0, Math.min(100, exposure)) * 2.45

  // Compute enclosing ellipse per cluster so each group has a visible boundary circle
  const clusterEnclosures = clusterIds
    .map((cid) => {
      const members = provinces.filter((p) => p.cluster_id === cid)
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
    .filter((x): x is NonNullable<typeof x> => x !== null)

  return (
    <div className="relative w-full">
      <svg
        viewBox="0 0 800 315"
        role="img"
        aria-label={
          lang === "th"
            ? "แผนภาพวงกลมครอบกลุ่มความเสี่ยง 17 จังหวัดภาคเหนือ"
            : "17 province cluster grouping chart with enclosing group boundaries"
        }
        className="h-auto w-full select-none overflow-visible"
      >
        {/* Background plot frame and quadrant dividers */}
        <rect x={60} y={25} width={700} height={245} rx={12} fill="hsl(var(--secondary) / 0.28)" stroke="hsl(var(--border))" />
        <line x1={410} y1={25} x2={410} y2={270} stroke="hsl(var(--border))" strokeDasharray="4 4" />
        <line x1={60} y1={147.5} x2={760} y2={147.5} stroke="hsl(var(--border))" strokeDasharray="4 4" />

        {/* Quadrant corner guide labels */}
        <text x={74} y={44} fontSize={9.5} fill="hsl(var(--muted-foreground))">
          {lang === "th" ? "พึ่งพาท่องเที่ยว/หนี้สูง · แรงกดดันภัยต่ำ" : "High Exposure · Low Physical Shock"}
        </text>
        <text x={746} y={44} textAnchor="end" fontSize={9.5} fill="#b91c1c" fontWeight={600}>
          {lang === "th" ? "เฝ้าระวังสูงสุด (พึ่งพาท่องเที่ยว/หนี้สูง + ภัยรุนแรง)" : "Critical Zone (High Exposure & High Shock)"}
        </text>
        <text x={74} y={258} fontSize={9.5} fill="#0f766e">
          {lang === "th" ? "ความเปราะบางต่ำ · แรงกดดันภัยต่ำ" : "Low Exposure · Low Physical Shock"}
        </text>
        <text x={746} y={258} textAnchor="end" fontSize={9.5} fill="hsl(var(--muted-foreground))">
          {lang === "th" ? "แรงกดดันภัยสูง · ภาระหนี้ปานกลาง" : "High Physical Shock · Moderate Debt"}
        </text>

        {/* Enclosing cluster ellipses (วงกลมครอบแต่ละกลุ่ม) */}
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
              y={Math.max(36, enc.cy - enc.ry + 11)}
              textAnchor="middle"
              fontSize={9.5}
              fontWeight={700}
              fill={enc.color}
            >
              {enc.label}
            </text>
          </g>
        ))}

        {/* Province circles and direct Thai/English labels */}
        {provinces.map((p, idx) => {
          const cx = toX(p.shock_intensity)
          const cy = toY(p.exposure_score)
          const isSel = p.province_code === selectedCode
          const color = CLUSTER_COLORS[p.cluster_id] || "#475569"
          const radius = isSel ? 9 : Math.max(5.5, Math.min(8.5, 5 + Math.log10(Math.max(10, p.avg_monthly_revenue_mthb))))
          const labelYOffset = idx % 2 === 0 ? -radius - 5 : radius + 11

          return (
            <g
              key={p.province_code}
              onClick={() => onSelectProvince(p.province_code)}
              onMouseEnter={() => setHovered(p)}
              onMouseLeave={() => setHovered(null)}
              className="cursor-pointer"
            >
              {isSel && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={radius + 4}
                  fill="none"
                  stroke="#09090b"
                  strokeWidth={2}
                />
              )}
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill={color}
                fillOpacity={0.92}
                stroke="#ffffff"
                strokeWidth={1.5}
              />
              <text
                x={cx}
                y={cy + labelYOffset}
                textAnchor="middle"
                fontSize={9.5}
                fontWeight={isSel ? 700 : 500}
                fill="#0f172a"
                stroke="rgba(255,255,255,0.85)"
                strokeWidth={2.2}
                paintOrder="stroke"
              >
                {lang === "th" ? p.name_th : p.province_code}
              </text>
            </g>
          )
        })}

        {/* Axis ticks and titles */}
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={`x-${v}`}>
            <text x={toX(v)} y={286} textAnchor="middle" fontSize={9.5} fill="hsl(var(--muted-foreground))">
              {v}
            </text>
          </g>
        ))}
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={`y-${v}`}>
            <text x={50} y={toY(v) + 3} textAnchor="end" fontSize={9.5} fill="hsl(var(--muted-foreground))">
              {v}
            </text>
          </g>
        ))}
        <text x={410} y={306} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="hsl(var(--foreground))">
          {lang === "th" ? "ความรุนแรงของแรงกดดันจากฝุ่น น้ำท่วม และมลพิษ (คะแนน 0 ถึง 100)" : "Physical & Environmental Shock Intensity (0 to 100)"}
        </text>
        <text
          x={16}
          y={147.5}
          textAnchor="middle"
          fontSize={10.5}
          fontWeight={600}
          fill="hsl(var(--foreground))"
          transform="rotate(-90 16 147.5)"
        >
          {lang === "th" ? "ความเปราะบางด้านหนี้และการพึ่งพาท่องเที่ยว" : "Tourism & Debt Exposure Score"}
        </text>
      </svg>

      {hovered && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-secondary/40 px-3.5 py-2 text-xs">
          <div>
            <span className="font-semibold text-foreground">
              {lang === "th" ? hovered.name_th : hovered.name_en}
            </span>{" "}
            <span className="text-muted-foreground">
              · {formatGroupTag(hovered.cluster_id, lang)} ({translateClusterLabel(hovered.cluster_label, lang)})
            </span>
          </div>
          <div className="flex flex-wrap gap-3 text-[11px] tabular-nums text-muted-foreground">
            <span>
              {lang === "th" ? "แรงกดดันภัย" : "Shock"}:{" "}
              <strong className="text-foreground">{hovered.shock_intensity.toFixed(1)}</strong>
            </span>
            <span>
              {lang === "th" ? "ความเปราะบาง" : "Exposure"}:{" "}
              <strong className="text-foreground">{hovered.exposure_score.toFixed(1)}</strong>
            </span>
            <span>
              {lang === "th" ? "หนี้ธุรกิจต่อรายได้ปี" : "SME Debt"}:{" "}
              <strong className="text-foreground">
                {hovered.debt_to_annual_income_sme != null
                  ? `${hovered.debt_to_annual_income_sme.toFixed(2)} ${lang === "th" ? "เท่า" : "x"}`
                  : "—"}
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
  const sliced = series.slice(-months).map((s) => ({
    label: formatThaiMonth(s.month_date, lang),
    occupancy: s.occupancy_rate != null ? Number(s.occupancy_rate.toFixed(1)) : null,
    pm25: s.pm25_mean != null ? Number(s.pm25_mean.toFixed(1)) : null,
    shock: Number(s.composite_shock_idx.toFixed(1)),
  }))

  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={sliced} margin={{ top: 12, right: 6, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10 }}
            interval={months <= 12 ? 1 : 3}
          />
          <YAxis
            yAxisId="left"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10 }}
            width={34}
            domain={[0, 100]}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10 }}
            width={36}
            unit="%"
            domain={[0, 100]}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--background))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "0.75rem",
              fontSize: "11px",
            }}
          />
          <Line
            yAxisId="left"
            dataKey="pm25"
            name={lang === "th" ? "ค่าฝุ่นละอองเฉลี่ย" : "Avg PM2.5 (µg/m³)"}
            type="monotone"
            stroke="#d97706"
            strokeWidth={2}
            dot={false}
          />
          <Line
            yAxisId="left"
            dataKey="shock"
            name={lang === "th" ? "ดัชนีแรงกดดัน (0–100)" : "Shock Index (0 to 100)"}
            type="monotone"
            stroke="#64748b"
            strokeWidth={1.6}
            strokeDasharray="4 4"
            dot={false}
          />
          <Line
            yAxisId="right"
            dataKey="occupancy"
            name={lang === "th" ? "อัตราเข้าพัก" : "Occupancy (%)"}
            type="monotone"
            stroke="#0f766e"
            strokeWidth={2.3}
            dot={{ r: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
