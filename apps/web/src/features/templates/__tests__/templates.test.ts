import { describe, it, expect } from 'vitest'
import { TEMPLATES, findTemplate, templateToSections } from '../templates'

describe('templates library', () => {
  it('exports the 6 promised templates', () => {
    const ids = TEMPLATES.map((t) => t.id)
    expect(ids).toEqual([
      'monthly-report',
      'project-kickoff',
      'tech-design',
      'meeting-notes',
      'faq',
      'data-analysis',
    ])
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
})
