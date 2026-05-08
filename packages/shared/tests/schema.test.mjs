// Node test runner — run with: node --test packages/shared/tests/
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
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

test('schema compiles successfully', () => {
  assert.ok(validate)
})

test('all golden samples pass validation', () => {
  const files = readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.json'))
  assert.ok(files.length >= 5, 'expected at least 5 golden samples')
  for (const f of files) {
    const data = JSON.parse(readFileSync(resolve(SAMPLES_DIR, f), 'utf-8'))
    const ok = validate(data)
    assert.ok(ok, `${f} failed: ${JSON.stringify(validate.errors)}`)
  }
})

test('rejects level=2 at top level (must be level=1)', () => {
  const bad = makeMinimalDoc()
  bad.sections[0].level = 2
  const ok = validate(bad)
  assert.equal(ok, false, 'expected validation failure')
})

test('rejects subsection level mismatch (level=3 directly under level=1)', () => {
  const doc = makeMinimalDoc()
  doc.sections[0].subsections = [
    {
      id: '01J9X1Y2Z3A4B5C6D7E8F9G0AA1',
      number: '1.1',
      level: 3, // should be 2
      title: '잘못된 level',
      blocks: [],
      subsections: [],
    },
  ]
  const ok = validate(doc)
  assert.equal(ok, false)
})

test('rejects unknown block type', () => {
  const doc = makeMinimalDoc()
  doc.sections[0].blocks.push({
    type: 'unknown-block',
    id: '01J9X1Y2Z3A4B5C6D7E8F9G0BB1',
    foo: 'bar',
  })
  const ok = validate(doc)
  assert.equal(ok, false)
})

test('rejects invalid confidentiality value', () => {
  const doc = makeMinimalDoc()
  doc.metadata.confidentiality = 'top-secret'
  const ok = validate(doc)
  assert.equal(ok, false)
})

test('rejects slug with uppercase', () => {
  const doc = makeMinimalDoc()
  doc.slug = 'MyDoc'
  const ok = validate(doc)
  assert.equal(ok, false)
})

function makeMinimalDoc() {
  return {
    schema_version: '1.0',
    id: '01J9X1Y2Z3A4B5C6D7E8F9G0AA0',
    slug: 'test-doc',
    title: 'Test',
    metadata: {
      division: 'MX',
      owners: ['u-test'],
      tags: [],
      confidentiality: 'internal',
    },
    sections: [
      {
        id: '01J9X1Y2Z3A4B5C6D7E8F9G0SS1',
        number: '1',
        level: 1,
        title: '섹션',
        blocks: [],
        subsections: [],
      },
    ],
  }
}
