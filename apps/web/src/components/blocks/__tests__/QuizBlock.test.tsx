import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuizBlockView, findMissingAnswers } from '../QuizBlock'
import type { QuizBlock, QuizQuestion } from '@/types/document'

const QUESTIONS: QuizQuestion[] = [
  {
    id: 'q1',
    kind: 'single-choice',
    label: '비밀번호 최소 길이',
    options: ['6', '8', '10'],
    correct: '10',
    points: 1,
  },
  {
    id: 'q2',
    kind: 'multi-choice',
    label: '허용되는 행위',
    options: ['A', 'B', 'C'],
    correct: ['A', 'B'],
    points: 2,
  },
  {
    id: 'q3',
    kind: 'true-false',
    label: 'MFA 의무?',
    correct: true,
    points: 1,
  },
  {
    id: 'q4',
    kind: 'short-text',
    label: '핫라인 단축번호',
    correct: '9119',
    points: 1,
  },
]

const block: QuizBlock = {
  type: 'quiz',
  id: '01TESTBLOCK00000000000QUIZ',
  title: '보안 퀴즈',
  description: '4문제, 통과 점수 70점.',
  passing_score: 70,
  max_attempts: 3,
  show_answers_after: true,
  questions: [...QUESTIONS] as QuizBlock['questions'],
}

describe('findMissingAnswers (FE)', () => {
  it('flags every empty answer', () => {
    const missing = findMissingAnswers(QUESTIONS, {})
    expect(missing).toEqual(['q1', 'q2', 'q3', 'q4'])
  })
  it('honors filled answers including booleans + arrays', () => {
    const missing = findMissingAnswers(QUESTIONS, {
      q1: '10',
      q2: ['A'],
      q3: false,
      q4: '9119',
    })
    expect(missing).toEqual([])
  })
  it('treats empty string and empty array as missing', () => {
    const missing = findMissingAnswers(QUESTIONS, {
      q1: '',
      q2: [],
      q3: null,
      q4: '   ',
    })
    expect(missing).toEqual(['q1', 'q2', 'q3', 'q4'])
  })
})

describe('<QuizBlockView /> read-mode render', () => {
  it('renders title + description + every question label', () => {
    const html = renderToStaticMarkup(<QuizBlockView block={block} />)
    expect(html).toContain('보안 퀴즈')
    expect(html).toContain('4문제, 통과 점수 70점.')
    for (const q of block.questions) expect(html).toContain(q.label)
  })
  it('shows submit button by default', () => {
    const html = renderToStaticMarkup(<QuizBlockView block={block} />)
    expect(html).toContain('제출')
  })
  it('renders single-choice options', () => {
    const html = renderToStaticMarkup(<QuizBlockView block={block} />)
    const opts = QUESTIONS[0]?.options ?? []
    for (const opt of opts) expect(html).toContain(opt)
  })
})
