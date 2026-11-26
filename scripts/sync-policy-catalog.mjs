import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const sourcePath = resolve(repoRoot, "shared", "policy_catalog.json")
const targets = [
  resolve(repoRoot, "backend", "config", "policy_catalog.json"),
  resolve(repoRoot, "frontend", "lib", "policy-catalog.json"),
]

if (!existsSync(sourcePath)) {
  console.error(`Missing canonical policy catalog at ${sourcePath}`)
  process.exit(1)
}

const sourceHash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex")
for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true })
  const currentHash = existsSync(target)
    ? createHash("sha256").update(readFileSync(target)).digest("hex")
    : ""
  if (currentHash !== sourceHash) {
    copyFileSync(sourcePath, target)
    console.log(`Synced policy_catalog.json -> ${target}`)
  }
}
console.log(`Policy catalog verified synced (sha256=${sourceHash.slice(0, 12)})`)
