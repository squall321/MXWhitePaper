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

// Compatibility aliases: the schema unified the SectionLevel1/2/3 trio into
// a single recursive `Section` type, but plenty of FE code still imports
// the legacy names (`SectionLevel1` / `SectionLevel2` / `SectionLevel3`).
// Emit backwards-compatible aliases so the rename can land without touching
// dozens of call sites.
const compatFooter = [
  '',
  '// ── Backwards-compatibility aliases ──────────────────────────────────',
  '// The schema collapsed the explicit level-1/2/3 Section interfaces into a',
  '// single recursive `Section`. These aliases keep older imports compiling.',
  'export type SectionLevel1 = Section',
  'export type SectionLevel2 = Section',
  'export type SectionLevel3 = Section',
  '',
].join('\n')

writeFileSync(OUT, ts + compatFooter)
console.log(`✓ TS types generated → ${OUT}`)
