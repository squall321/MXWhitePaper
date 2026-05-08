#!/usr/bin/env node
// Generate TypeScript types from packages/shared/schemas/document.json
// Output: apps/web/src/types/document.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from 'json-schema-to-typescript'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../../..')
const SCHEMA = resolve(__dirname, '../schemas/document.json')
const OUT = resolve(ROOT, 'apps/web/src/types/document.ts')

const schema = JSON.parse(readFileSync(SCHEMA, 'utf-8'))

const ts = await compile(schema, 'Document', {
  bannerComment: [
    '/**',
    ' * AUTO-GENERATED — do not edit by hand.',
    ' * Source: packages/shared/schemas/document.json',
    ' * Run: pnpm schema:gen',
    ' */',
    '',
  ].join('\n'),
  style: { semi: false, singleQuote: true, printWidth: 100 },
  additionalProperties: false,
  unknownAny: false,
  strictIndexSignatures: true,
})

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, ts)
console.log(`✓ TS types generated → ${OUT}`)
