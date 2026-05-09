import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { makeQuizQuestion, QuizBlockEditor } from '../QuizBlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { QuizBlock } from '@/types/document'

describe('makeQuizQuestion', () => {
  it('seeds single-choice with options + first correct', () => {
    const q = makeQuizQuestion('single-choice')
    expect(q.kind).toBe('single-choice')
    expect(q.options?.length).toBeGreaterThan(0)
    expect(q.correct).toBe(q.options?.[0])
  })
  it('seeds multi-choice with empty correct array', () => {
    const q = makeQuizQuestion('multi-choice')
    expect(q.kind).toBe('multi-choice')
    expect(Array.isArray(q.correct)).toBe(true)
  })
  it('seeds true-false with boolean correct', () => {
    const q = makeQuizQuestion('true-false')
    expect(q.kind).toBe('true-false')
    expect(typeof q.correct).toBe('boolean')
  })
  it('seeds short-text with empty string correct', () => {
    const q = makeQuizQuestion('short-text')
    expect(q.kind).toBe('short-text')
    expect(q.correct).toBe('')
  })
})

describe('<QuizBlockEditor /> smoke render', () => {
  it('renders without crashing and exposes the meta + attempts surface', () => {
    const block: QuizBlock = {
      type: 'quiz',
      id: '01TESTQUIZBLOCK00000000QED',
      title: '보안 퀴즈',
      passing_score: 70,
      max_attempts: 3,
      show_answers_after: true,
      questions: [
        {
          id: 'q1',
          kind: 'single-choice',
          label: '문제 1',
          options: ['A', 'B'],
          correct: 'A',
          points: 1,
        },
      ],
    }
    useEditorStore.getState().bind(
      'sample-slug',
      {
        schema_version: '1.0',
        id: '01TESTDOC00000000000000000',
        slug: 'sample-slug',
        title: 't',
        metadata: {
          division: 'MX',
          owners: ['u'],
          tags: [],
          confidentiality: 'internal',
        },
        sections: [],
      } as never,
      'etag-123',
    )
    const html = renderToStaticMarkup(
      <QuizBlockEditor slug="sample-slug" block={block} />,
    )
    expect(html).toContain('응시 기록 보기')
    expect(html).toContain('통과 점수')
    expect(html).toContain('최대 시도 횟수')
    expect(html).toContain('셔플 출제')
    expect(html).toContain('정답 공개')
    expect(html).toContain('문제 추가')
    // Per-question correct + explanation surface present.
    expect(html).toContain('정답')
    expect(html).toContain('해설')
  })
})
