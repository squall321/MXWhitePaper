#!/usr/bin/env node
/**
 * check-bundle-size — fail-fast bundle budget gate.
 *
 * Walks `apps/web/dist/assets/*.js`, gzips each chunk in memory, and asserts:
 *   1. No individual chunk exceeds 800 kB (gzip-pre).
 *   2. Total bundle is under 5 MB (gzip-pre).
 *
 * "gzip-pre" = result of `zlib.gzipSync` on the minified JS, which is the
 * size the browser will pull over the wire if Brotli is unavailable. Sourcemaps
 * are excluded — only `.js` files are weighed.
 *
 * Designed for CI; exits 1 on any breach so check-all.sh fails the gate.
 *
 * Usage:
 *   node apps/web/scripts/check-bundle-size.cjs
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const PER_CHUNK_LIMIT_BYTES = 800 * 1024 // 800 kB
const TOTAL_LIMIT_BYTES = 5 * 1024 * 1024 // 5 MB

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function main() {
  const distAssets = path.resolve(__dirname, '..', 'dist', 'assets')
  if (!fs.existsSync(distAssets)) {
    console.error(`[check-bundle-size] missing dist directory: ${distAssets}`)
    console.error('  → run `pnpm --filter @mx/web build` first.')
    process.exit(1)
  }

  const files = fs
    .readdirSync(distAssets)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(distAssets, f))

  if (files.length === 0) {
    console.error(`[check-bundle-size] no .js files under ${distAssets}`)
    process.exit(1)
  }

  const rows = []
  let total = 0
  const violations = []

  for (const file of files) {
    const buf = fs.readFileSync(file)
    const gz = zlib.gzipSync(buf).length
    total += gz
    rows.push({ name: path.basename(file), raw: buf.length, gz })
    if (gz > PER_CHUNK_LIMIT_BYTES) {
      violations.push(
        `chunk too large: ${path.basename(file)} = ${fmt(gz)} > ${fmt(PER_CHUNK_LIMIT_BYTES)} (gzip)`,
      )
    }
  }

  rows.sort((a, b) => b.gz - a.gz)

  console.log('[check-bundle-size] top 10 chunks (gzip):')
  for (const r of rows.slice(0, 10)) {
    console.log(`  ${fmt(r.gz).padStart(10)}  raw ${fmt(r.raw).padStart(10)}  ${r.name}`)
  }
  console.log(
    `[check-bundle-size] total ${fmt(total)} across ${rows.length} chunks (gzip-pre)`,
  )

  if (total > TOTAL_LIMIT_BYTES) {
    violations.push(
      `total bundle too large: ${fmt(total)} > ${fmt(TOTAL_LIMIT_BYTES)} (gzip)`,
    )
  }

  if (violations.length > 0) {
    console.error('[check-bundle-size] FAIL')
    for (const v of violations) console.error(`  - ${v}`)
    process.exit(1)
  }

  console.log('[check-bundle-size] OK')
}

main()
