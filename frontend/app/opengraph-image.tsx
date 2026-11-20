import { ImageResponse } from "next/og"

export const runtime = "edge"
export const alt = "NorthRisk Analytics regional risk and relief guidance"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#09090b",
          color: "white",
          fontFamily: "sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.07) 1px, transparent 0)",
            backgroundSize: "38px 38px",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", zIndex: 1, padding: "60px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "44px", color: "rgba(255,255,255,0.72)", fontSize: 22, letterSpacing: "0.08em" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "white" }} />
            NORTHRISK ANALYTICS
          </div>
          <div style={{ maxWidth: 980, fontSize: 68, fontWeight: 700, textAlign: "center", lineHeight: 1.08, letterSpacing: "-0.04em" }}>
            Regional Signals.
          </div>
          <div style={{ maxWidth: 980, fontSize: 68, fontWeight: 700, color: "rgba(255,255,255,0.58)", textAlign: "center", lineHeight: 1.08, letterSpacing: "-0.04em", marginTop: 5 }}>
            Clear Policy Action.
          </div>
          <div style={{ fontSize: 21, color: "rgba(255,255,255,0.58)", marginTop: 32, textAlign: "center", maxWidth: 760, lineHeight: 1.5 }}>
            Open data intelligence and accessible relief guidance for Northern Thailand.
          </div>
        </div>
        <div style={{ position: "absolute", bottom: 34, display: "flex", alignItems: "center", gap: 12, color: "rgba(255,255,255,0.4)", fontSize: 16 }}>
          17 Northern Provinces <span style={{ color: "rgba(255,255,255,0.22)" }}>·</span> Open Data Intelligence
        </div>
      </div>
    ),
    { ...size },
  )
}
