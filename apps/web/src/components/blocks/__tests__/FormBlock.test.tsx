import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FormBlockView, validateAnswers } from '../FormBlock'
import type { FormBlock, FormQuestion } from '@/types/document'

const QUESTIONS: FormQuestion[] = [
  { id: 'q1', kind: 'text', label: '이름', required: true },
  { id: 'q2', kind: 'email', label: '이메일' },
  { id: 'q3', kind: 'select', label: '팀', options: ['A', 'B'] },
  { id: 'q4', kind: 'rating-5', label: '만족도' },
  { id: 'q5', kind: 'multi-select', label: '도구', options: ['X', 'Y'] },
]

const block: FormBlock = {
  type: 'form',
  id: '01TESTBLOCK00000000000FORM',
  title: '폼 제목',
  description: '설명입니다.',
  questions: [...QUESTIONS] as FormBlock['questions'],
}

describe('validateAnswers (FE)', () => {
  it('flags required when missing', () => {
    const errs = validateAnswers(QUESTIONS, {})
    expect(errs.q1).toBeTruthy()
  })
  it('flags invalid email', () => {
    const errs = validateAnswers(QUESTIONS, { q1: 'X', q2: 'oops' })
    expect(errs.q2).toBeTruthy()
  })
  it('flags rating out of range', () => {
    const errs = validateAnswers(QUESTIONS, { q1: 'X', q4: 9 })
    expect(errs.q4).toBeTruthy()
  })
  it('returns empty when valid', () => {
    const errs = validateAnswers(QUESTIONS, {
      q1: 'X',
      q2: 'a@b.co',
      q3: 'A',
      q4: 4,
      q5: ['X'],
    })
    expect(errs).toEqual({})
  })
})

describe('validateAnswers — WIDGET-03 validation extensions', () => {
  // ── numeric min/max ──
  it('flags number below min', () => {
    const qs: FormQuestion[] = [{ id: 'n', kind: 'number', label: '나이', min: 18, max: 99 }]
    const errs = validateAnswers(qs, { n: 10 })
    expect(errs.n).toMatch(/최소/)
  })
  it('flags number above max', () => {
    const qs: FormQuestion[] = [{ id: 'n', kind: 'number', label: '나이', min: 18, max: 99 }]
    const errs = validateAnswers(qs, { n: 200 })
    expect(errs.n).toMatch(/최대/)
  })
  it('passes number within range', () => {
    const qs: FormQuestion[] = [{ id: 'n', kind: 'number', label: '나이', min: 18, max: 99 }]
    const errs = validateAnswers(qs, { n: 30 })
    expect(errs).toEqual({})
  })

  // ── text minLength/maxLength ──
  it('flags text below minLength', () => {
    const qs: FormQuestion[] = [{ id: 't', kind: 'text', label: '이름', minLength: 3 }]
    const errs = validateAnswers(qs, { t: 'Hi' })
    expect(errs.t).toMatch(/너무 적습니다/)
  })
  it('flags text above maxLength', () => {
    const qs: FormQuestion[] = [{ id: 't', kind: 'text', label: '이름', maxLength: 5 }]
    const errs = validateAnswers(qs, { t: 'TooLongValue' })
    expect(errs.t).toMatch(/너무 많습니다/)
  })
  it('passes text within length range', () => {
    const qs: FormQuestion[] = [
      { id: 't', kind: 'text', label: '이름', minLength: 2, maxLength: 10 },
    ]
    const errs = validateAnswers(qs, { t: 'Alice' })
    expect(errs).toEqual({})
  })

  // ── pattern ──
  it('passes when pattern matches', () => {
    const qs: FormQuestion[] = [
      { id: 'p', kind: 'text', label: '전화', pattern: '^010-\\d{4}-\\d{4}$' },
    ]
    const errs = validateAnswers(qs, { p: '010-1234-5678' })
    expect(errs).toEqual({})
  })
  it('flags when pattern does not match', () => {
    const qs: FormQuestion[] = [
      { id: 'p', kind: 'text', label: '전화', pattern: '^010-\\d{4}-\\d{4}$' },
    ]
    const errs = validateAnswers(qs, { p: 'abc' })
    expect(errs.p).toMatch(/형식/)
  })
  it('silently skips invalid pattern (compile error)', () => {
    const qs: FormQuestion[] = [
      { id: 'p', kind: 'text', label: '이름', pattern: '[unclosed' },
    ]
    const errs = validateAnswers(qs, { p: 'Anything' })
    expect(errs).toEqual({})
  })

  // ── long-text / email also pick up the constraints ──
  it('applies maxLength to long-text', () => {
    const qs: FormQuestion[] = [
      { id: 'b', kind: 'long-text', label: '바이오', maxLength: 4 },
    ]
    const errs = validateAnswers(qs, { b: '너무너무너무 길어요' })
    expect(errs.b).toMatch(/너무 많습니다/)
  })
  it('applies minLength to email', () => {
    const qs: FormQuestion[] = [
      { id: 'e', kind: 'email', label: '이메일', minLength: 20 },
    ]
    const errs = validateAnswers(qs, { e: 'a@b.co' })
    expect(errs.e).toMatch(/너무 적습니다/)
  })
})

describe('<FormBlockView /> read-mode render', () => {
  it('renders title + description + submit label', () => {
    const html = renderToStaticMarkup(<FormBlockView block={block} />)
    expect(html).toContain('폼 제목')
    expect(html).toContain('설명입니다.')
    expect(html).toContain('제출')
  })
  it('renders one input per question label', () => {
    const html = renderToStaticMarkup(<FormBlockView block={block} />)
    for (const q of block.questions) {
      expect(html).toContain(q.label)
    }
  })
  it('uses configured submit_label when provided', () => {
    const b: FormBlock = { ...block, submit_label: '보내기' }
    const html = renderToStaticMarkup(<FormBlockView block={b} />)
    expect(html).toContain('보내기')
  })
})
