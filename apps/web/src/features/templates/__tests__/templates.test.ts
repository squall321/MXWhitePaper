import { describe, it, expect } from 'vitest'
import { TEMPLATES, findTemplate, templateToSections } from '../templates'
import type { Block } from '@/types/document'

describe('templates library', () => {
  it('exports the 14 promised templates in the expected order', () => {
    const ids = TEMPLATES.map((t) => t.id)
    expect(ids).toEqual([
      'monthly-report',
      'project-kickoff',
      'tech-design',
      'meeting-notes',
      'faq',
      'data-analysis',
      'one-on-one',
      'okr',
      'rfc',
      'retro',
      'postmortem',
      'design-doc',
      'brainstorm',
      'announce',
    ])
  })

  it('every template id is unique', () => {
    const ids = TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every template is tagged with one of the four allowed categories', () => {
    for (const t of TEMPLATES) {
      expect(['report', 'collab', 'tech', 'announce']).toContain(t.category)
    }
  })

  it('category assignment matches the spec', () => {
    const expected: Record<string, string> = {
      'monthly-report': 'report',
      'project-kickoff': 'collab',
      'tech-design': 'tech',
      'meeting-notes': 'collab',
      faq: 'announce',
      'data-analysis': 'report',
      'one-on-one': 'collab',
      okr: 'report',
      rfc: 'tech',
      retro: 'collab',
      postmortem: 'tech',
      'design-doc': 'tech',
      brainstorm: 'collab',
      announce: 'announce',
    }
    for (const t of TEMPLATES) {
      expect(t.category).toBe(expected[t.id])
    }
  })

  it('every template has at least one section with blocks', () => {
    for (const t of TEMPLATES) {
      expect(t.sections.length).toBeGreaterThan(0)
      for (const sec of t.sections) {
        expect(sec.blocks.length).toBeGreaterThan(0)
      }
    }
  })

  it('findTemplate looks up by id', () => {
    expect(findTemplate('monthly-report')?.title).toBe('월간 보고서')
    expect(findTemplate('postmortem')?.category).toBe('tech')
    expect(findTemplate('nope')).toBeUndefined()
  })

  it('templateToSections injects fresh ULIDs (length 26 chars) into every block', () => {
    const tpl = findTemplate('monthly-report')!
    const sections = templateToSections(tpl)
    expect(sections.length).toBe(1)
    const sec = sections[0]!
    expect(sec.level).toBe(1)
    expect(typeof sec.id).toBe('string')
    expect(sec.id.length).toBe(26)
    expect(sec.title).toBe('요약')
    for (const b of sec.blocks) {
      expect(typeof b.id).toBe('string')
      expect(b.id.length).toBe(26)
    }
  })

  it('two materialisations produce distinct section/block ids', () => {
    const tpl = findTemplate('monthly-report')!
    const a = templateToSections(tpl)
    const b = templateToSections(tpl)
    expect(a[0]!.id).not.toBe(b[0]!.id)
    expect(a[0]!.blocks[0]!.id).not.toBe(b[0]!.blocks[0]!.id)
  })

  it('every template ships at least one block kind in its thumbnailIcons', () => {
    for (const t of TEMPLATES) {
      expect(t.thumbnailIcons.length).toBeGreaterThan(0)
    }
  })

  /**
   * Structural sanity check: walk every template, materialise it, and
   * confirm every block (including children of containers like columns /
   * accordion / tabs) carries a 26-char ULID after `templateToSections`.
   * This is the FE-side equivalent of "schema-valid" for templates — the
   * BE schema is exercised when the resulting payload is saved, but here
   * we want to fail fast at template-authoring time.
   */
  it('every block (recursively) gets a 26-char ULID after materialisation', () => {
    function walk(b: Block, ids: Set<string>) {
      expect(typeof b.id).toBe('string')
      expect(b.id.length).toBe(26)
      ids.add(b.id)
      if (b.type === 'columns') {
        for (const col of b.columns) for (const cb of col) walk(cb, ids)
      } else if (b.type === 'tabs') {
        for (const tab of b.tabs) for (const cb of tab.blocks) walk(cb, ids)
      } else if (b.type === 'accordion') {
        for (const it of b.items) for (const cb of it.blocks) walk(cb, ids)
      }
    }
    for (const tpl of TEMPLATES) {
      const ids = new Set<string>()
      const sections = templateToSections(tpl)
      for (const sec of sections) {
        expect(sec.id.length).toBe(26)
        for (const b of sec.blocks) walk(b, ids)
      }
      // every top-level + nested block id must be unique within a template
      const totalCount = sections.reduce((n, s) => {
        function count(b: Block): number {
          if (b.type === 'columns') {
            return 1 + b.columns.flat().reduce((m, cb) => m + count(cb), 0)
          }
          if (b.type === 'tabs') {
            return 1 + b.tabs.reduce((m, t) => m + t.blocks.reduce((k, cb) => k + count(cb), 0), 0)
          }
          if (b.type === 'accordion') {
            return 1 + b.items.reduce((m, it) => m + it.blocks.reduce((k, cb) => k + count(cb), 0), 0)
          }
          return 1
        }
        return n + s.blocks.reduce((k, b) => k + count(b), 0)
      }, 0)
      expect(ids.size).toBe(totalCount)
    }
  })

  it('thumbnailIcons is non-empty for every new template', () => {
    const newOnes = ['one-on-one', 'okr', 'rfc', 'retro', 'postmortem', 'design-doc', 'brainstorm', 'announce']
    for (const id of newOnes) {
      const tpl = findTemplate(id)
      expect(tpl, `template ${id} must exist`).toBeDefined()
      expect(tpl!.thumbnailIcons.length).toBeGreaterThan(0)
    }
  })
})
