#!/usr/bin/env node
// Validate golden samples against DocumentJSON v1.0 schema
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCHEMA = resolve(__dirname, '../schemas/document.json')
const SAMPLES_DIR = resolve(__dirname, '../samples')

const schema = JSON.parse(readFileSync(SCHEMA, 'utf-8'))
const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats.default(ajv)
const validate = ajv.compile(schema)

const files = readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.json'))
if (files.length === 0) {
  console.error('✗ No samples found in', SAMPLES_DIR)
  process.exit(1)
}

let failed = 0
for (const f of files) {
  const data = JSON.parse(readFileSync(resolve(SAMPLES_DIR, f), 'utf-8'))
  const ok = validate(data)
  if (ok) {
    console.log(`✓ ${basename(f)}`)
  } else {
    failed++
    console.error(`✗ ${basename(f)}`)
    for (const err of validate.errors ?? []) {
      console.error(`    ${err.instancePath || '/'} ${err.message}`)
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${files.length} samples failed validation`)
  process.exit(1)
}
console.log(`\n${files.length}/${files.length} samples valid ✓`)
