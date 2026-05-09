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
