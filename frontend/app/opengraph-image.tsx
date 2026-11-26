import { readFile } from "node:fs/promises"
import path from "node:path"

export const alt = "NorthRisk Analytics Northern Thailand Debt & Economic Planner"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default async function Image() {
  const pngPath = path.join(process.cwd(), "public", "og-card.png")
  const pngBytes = await readFile(pngPath)
  return new Response(new Uint8Array(pngBytes), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  })
}
