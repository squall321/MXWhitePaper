/**
 * 3-way DocumentJSON v1.0 diff/merge engine for the Conflict Merge modal
 * (FR-16). Pure functions, no React deps.
 *
 * The two pairs we compare:
 *
 *   minePatch   = diff(base, mine)
 *   theirsPatch = diff(base, theirs)
 *
 * A node is in CONFLICT when both sides changed the same id (or the same
 * top-level metadata/infobox key). Otherwise the change can be auto-merged.
 */

import type {
  Block,
  DocumentJSONV10,
  GlossaryItem,
  Infobox,
  Reference,
  RelatedDoc,
  SectionLevel1,
  SectionLevel2,
  SectionLevel3,
  Slug,
  Ulid,
} from '@/types/document'

/** Node-level diff status. */
export type DiffStatus =
  | 'unchanged'
  | 'added'
  | 'removed'
  | 'changed'
  | 'moved'

export type Side = 'mine' | 'theirs'

export interface KeyDiff {
  key: string
  status: DiffStatus
  baseValue: unknown
  newValue: unknown
}

export interface BlockDiff {
  id: Ulid
  status: DiffStatus
  /** Type at base (if present) and on the new side. */
  baseType?: string
  newType?: string
  /** Field-level changes when both base and new exist with same type. */
  fieldChanges: string[]
  /** Index in the parent before/after. -1 when not present on that side. */
  baseIndex: number
  newIndex: number
}

export interface SectionDiff {
  id: Ulid
  status: DiffStatus
  level?: number
  baseTitle?: string
  newTitle?: string
  titleChanged: boolean
  levelChanged: boolean
  blocksChanged: boolean
  blockDiffs: BlockDiff[]
  /** child sections diffs, recursive. */
  childDiffs: SectionDiff[]
  baseIndex: number
  newIndex: number
}

export interface ListDiff<T> {
  added: T[]
  removed: T[]
  /** Items present on both but with different content (key-equal, value-different). */
  changed: { key: string; baseValue: T; newValue: T }[]
}

export interface DocDiff {
  /** Top-level scalar fields that are not metadata/infobox/sections. */
  scalars: KeyDiff[]
  metadata: KeyDiff[]
  infobox: KeyDiff[]
  sections: SectionDiff[]
  related_documents: ListDiff<RelatedDoc>
  glossary: ListDiff<GlossaryItem>
  references: ListDiff<Reference>
  see_also: ListDiff<Slug>
}

export interface DocSide {
  label: 'mine' | 'base' | 'theirs'
  doc: DocumentJSONV10
}

/**
 * Conflicts: keys / ids that were modified by BOTH sides relative to base.
 * Each conflict node includes the base, mine, and theirs values for the UI's
 * three-pane chooser.
 */
export type ConflictScope =
  | 'metadata'
  | 'infobox'
  | 'section.title'
  | 'section.level'
  | 'section.presence'
  | 'block'
  | 'related_documents'
  | 'glossary'
  | 'references'
  | 'see_also'
  | 'top'

export interface ConflictNode {
  /** Unique conflict id, used as React key + chooser radio name. */
  conflictId: string
  scope: ConflictScope
  /** Display label in 한국어. */
  label: string
  /** Path-style locator (e.g., "metadata.tags", "section/01ABC.../title"). */
  path: string
  baseValue: unknown
  mineValue: unknown
  theirsValue: unknown
}

export interface ThreeWayDiff {
  base: DocumentJSONV10
  mine: DocumentJSONV10
  theirs: DocumentJSONV10
  minePatch: DocDiff
  theirsPatch: DocDiff
  conflicts: ConflictNode[]
  /** Non-conflict ids: theirs-side changes that can be auto-applied to mine. */
  autoMergeableConflictIds: string[]
}

// ---------------------------------------------------------------------------
// deep equality (local, no extra dep)
// ---------------------------------------------------------------------------

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  if (Array.isArray(b)) return false
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao)
  const bk = Object.keys(bo)
  if (ak.length !== bk.length) return false
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false
    if (!deepEqual(ao[k], bo[k])) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Section / Block walking helpers
// ---------------------------------------------------------------------------

type AnySection = SectionLevel1 | SectionLevel2 | SectionLevel3

function flattenBlocks(
  sections: AnySection[],
): { sectionId: Ulid; block: Block; index: number }[] {
  const out: { sectionId: Ulid; block: Block; index: number }[] = []
  const walk = (secs: AnySection[]): void => {
    for (const sec of secs) {
      sec.blocks.forEach((b, i) => out.push({ sectionId: sec.id, block: b, index: i }))
      const subs = (sec as SectionLevel1).subsections as AnySection[] | undefined
      if (subs && subs.length) walk(subs)
    }
  }
  walk(sections)
  return out
}

function indexSections(sections: AnySection[]): Map<Ulid, AnySection> {
  const m = new Map<Ulid, AnySection>()
  const walk = (secs: AnySection[]): void => {
    for (const sec of secs) {
      m.set(sec.id, sec)
      const subs = (sec as SectionLevel1).subsections as AnySection[] | undefined
      if (subs && subs.length) walk(subs)
    }
  }
  walk(sections)
  return m
}

function indexBlocks(sections: AnySection[]): Map<Ulid, Block> {
  const m = new Map<Ulid, Block>()
  for (const { block } of flattenBlocks(sections)) m.set(block.id, block)
  return m
}

function findBlockIndex(
  sections: AnySection[],
  blockId: Ulid,
): { sectionId: Ulid; index: number } | null {
  for (const { sectionId, block, index } of flattenBlocks(sections)) {
    if (block.id === blockId) return { sectionId, index }
  }
  return null
}

// ---------------------------------------------------------------------------
// Pairwise diff (base vs newSide)
// ---------------------------------------------------------------------------

const SCALAR_KEYS: (keyof DocumentJSONV10)[] = [
  'schema_version',
  'id',
  'slug',
  'title',
  'summary',
]

function diffMetadata(
  base: DocumentJSONV10['metadata'],
  next: DocumentJSONV10['metadata'],
): KeyDiff[] {
  const baseRec = base as unknown as Record<string, unknown>
  const nextRec = next as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(baseRec), ...Object.keys(nextRec)])
  const out: KeyDiff[] = []
  for (const k of keys) {
    const bv = baseRec[k]
    const nv = nextRec[k]
    if (deepEqual(bv, nv)) continue
    const status: DiffStatus =
      bv === undefined ? 'added' : nv === undefined ? 'removed' : 'changed'
    out.push({ key: k, status, baseValue: bv, newValue: nv })
  }
  return out
}

function diffInfobox(base: Infobox | undefined, next: Infobox | undefined): KeyDiff[] {
  const b = base ?? {}
  const n = next ?? {}
  const keys = new Set([...Object.keys(b), ...Object.keys(n)])
  const out: KeyDiff[] = []
  for (const k of keys) {
    const bv = b[k]
    const nv = n[k]
    if (deepEqual(bv, nv)) continue
    const status: DiffStatus =
      bv === undefined ? 'added' : nv === undefined ? 'removed' : 'changed'
    out.push({ key: k, status, baseValue: bv, newValue: nv })
  }
  return out
}

function diffBlocks(
  baseSec: AnySection | undefined,
  nextSec: AnySection | undefined,
): BlockDiff[] {
  const baseBlocks = baseSec?.blocks ?? []
  const nextBlocks = nextSec?.blocks ?? []
  const baseMap = new Map(baseBlocks.map((b, i) => [b.id, { b, i }]))
  const nextMap = new Map(nextBlocks.map((b, i) => [b.id, { b, i }]))
  const ids = new Set([...baseMap.keys(), ...nextMap.keys()])
  const out: BlockDiff[] = []
  for (const id of ids) {
    const a = baseMap.get(id)
    const c = nextMap.get(id)
    if (!a && c) {
      out.push({
        id,
        status: 'added',
        newType: c.b.type,
        fieldChanges: [],
        baseIndex: -1,
        newIndex: c.i,
      })
    } else if (a && !c) {
      out.push({
        id,
        status: 'removed',
        baseType: a.b.type,
        fieldChanges: [],
        baseIndex: a.i,
        newIndex: -1,
      })
    } else if (a && c) {
      const sameType = a.b.type === c.b.type
      const moved = a.i !== c.i
      let fieldChanges: string[] = []
      let bodyChanged = false
      if (sameType) {
        fieldChanges = blockFieldChanges(a.b, c.b)
        bodyChanged = fieldChanges.length > 0
      } else {
        bodyChanged = true
      }
      const status: DiffStatus =
        bodyChanged ? 'changed' : moved ? 'moved' : 'unchanged'
      if (status === 'unchanged') continue
      out.push({
        id,
        status,
        baseType: a.b.type,
        newType: c.b.type,
        fieldChanges,
        baseIndex: a.i,
        newIndex: c.i,
      })
    }
  }
  return out
}

function blockFieldChanges(a: Block, b: Block): string[] {
  if (a.type !== b.type) return ['*']
  const ao = a as unknown as Record<string, unknown>
  const bo = b as unknown as Record<string, unknown>
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)])
  const out: string[] = []
  for (const k of keys) {
    if (k === 'id' || k === 'type') continue
    if (!deepEqual(ao[k], bo[k])) out.push(k)
  }
  return out
}

function diffSections(
  base: AnySection[],
  next: AnySection[],
): SectionDiff[] {
  const baseMap = indexSections(base)
  const nextMap = indexSections(next)
  const baseFlatBlocks = indexBlocks(base)
  const nextFlatBlocks = indexBlocks(next)
  const ids = new Set([...baseMap.keys(), ...nextMap.keys()])
  const out: SectionDiff[] = []
  for (const id of ids) {
    const a = baseMap.get(id)
    const c = nextMap.get(id)
    if (!a && c) {
      out.push({
        id,
        status: 'added',
        level: c.level,
        newTitle: c.title,
        titleChanged: true,
        levelChanged: false,
        blocksChanged: c.blocks.length > 0,
        blockDiffs: c.blocks.map((b, i) => ({
          id: b.id,
          status: 'added',
          newType: b.type,
          fieldChanges: [],
          baseIndex: -1,
          newIndex: i,
        })),
        childDiffs: [],
        baseIndex: -1,
        newIndex: locateSectionIndex(next, id),
      })
    } else if (a && !c) {
      out.push({
        id,
        status: 'removed',
        level: a.level,
        baseTitle: a.title,
        titleChanged: false,
        levelChanged: false,
        blocksChanged: a.blocks.length > 0,
        blockDiffs: a.blocks.map((b, i) => ({
          id: b.id,
          status: 'removed',
          baseType: b.type,
          fieldChanges: [],
          baseIndex: i,
          newIndex: -1,
        })),
        childDiffs: [],
        baseIndex: locateSectionIndex(base, id),
        newIndex: -1,
      })
    } else if (a && c) {
      const titleChanged = a.title !== c.title
      const levelChanged = a.level !== c.level
      const blockDiffs = diffBlocks(a, c)
      // additionally: blocks moved across sections — flag in the *destination* section as 'moved'
      const blocksChanged = blockDiffs.length > 0 || hasCrossSectionMove(id, baseFlatBlocks, nextFlatBlocks)
      const baseIdx = locateSectionIndex(base, id)
      const newIdx = locateSectionIndex(next, id)
      const moved = baseIdx !== newIdx
      let status: DiffStatus = 'unchanged'
      if (titleChanged || levelChanged || blocksChanged) status = 'changed'
      else if (moved) status = 'moved'
      if (status === 'unchanged') continue
      out.push({
        id,
        status,
        level: c.level,
        baseTitle: a.title,
        newTitle: c.title,
        titleChanged,
        levelChanged,
        blocksChanged,
        blockDiffs,
        childDiffs: [],
        baseIndex: baseIdx,
        newIndex: newIdx,
      })
    }
  }
  return out
}

function locateSectionIndex(sections: AnySection[], id: Ulid): number {
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    if (!s) continue
    if (s.id === id) return i
    const subs = (s as SectionLevel1).subsections as AnySection[] | undefined
    if (subs) {
      const idx = locateSectionIndex(subs, id)
      if (idx !== -1) return idx
    }
  }
  return -1
}

function hasCrossSectionMove(
  _id: Ulid,
  _baseFlat: Map<Ulid, Block>,
  _nextFlat: Map<Ulid, Block>,
): boolean {
  // Conservative: ignore for status calc — diffBlocks already labels the
  // affected blocks as added/removed in the source/dest sections, which is
  // enough for the UI.
  return false
}

function diffList<T>(
  base: T[] | undefined,
  next: T[] | undefined,
  keyOf: (v: T) => string,
): ListDiff<T> {
  const b = base ?? []
  const n = next ?? []
  const bm = new Map(b.map((x) => [keyOf(x), x]))
  const nm = new Map(n.map((x) => [keyOf(x), x]))
  const added: T[] = []
  const removed: T[] = []
  const changed: { key: string; baseValue: T; newValue: T }[] = []
  for (const [k, v] of nm) {
    if (!bm.has(k)) added.push(v)
    else if (!deepEqual(bm.get(k), v)) changed.push({ key: k, baseValue: bm.get(k) as T, newValue: v })
  }
  for (const [k, v] of bm) if (!nm.has(k)) removed.push(v)
  return { added, removed, changed }
}

export function diffDocument(
  base: DocumentJSONV10,
  next: DocumentJSONV10,
): DocDiff {
  const safeBase = (base ?? {}) as DocumentJSONV10
  const safeNext = (next ?? {}) as DocumentJSONV10
  const scalars: KeyDiff[] = []
  for (const k of SCALAR_KEYS) {
    const bv = safeBase[k]
    const nv = safeNext[k]
    if (!deepEqual(bv, nv)) {
      scalars.push({
        key: k as string,
        status:
          bv === undefined ? 'added' : nv === undefined ? 'removed' : 'changed',
        baseValue: bv,
        newValue: nv,
      })
    }
  }
  return {
    scalars,
    metadata: diffMetadata(
      safeBase.metadata ?? ({} as DocumentJSONV10['metadata']),
      safeNext.metadata ?? ({} as DocumentJSONV10['metadata']),
    ),
    infobox: diffInfobox(safeBase.infobox, safeNext.infobox),
    sections: diffSections(
      (Array.isArray(safeBase.sections) ? safeBase.sections : []) as AnySection[],
      (Array.isArray(safeNext.sections) ? safeNext.sections : []) as AnySection[],
    ),
    related_documents: diffList<RelatedDoc>(
      safeBase.related_documents,
      safeNext.related_documents,
      (r) => `${r?.slug ?? ''}::${r?.relation ?? ''}`,
    ),
    glossary: diffList<GlossaryItem>(
      safeBase.glossary,
      safeNext.glossary,
      (g) => g?.term ?? '',
    ),
    references: diffList<Reference>(
      safeBase.references,
      safeNext.references,
      (r) => `${r?.type ?? ''}::${r?.label ?? ''}::${r?.url ?? ''}`,
    ),
    see_also: diffList<Slug>(safeBase.see_also, safeNext.see_also, (s) => s ?? ''),
  }
}

// ---------------------------------------------------------------------------
// 3-way diff (base vs mine vs theirs) — pull out conflicts
// ---------------------------------------------------------------------------

export function threeWayDiff(
  base: DocumentJSONV10,
  mine: DocumentJSONV10,
  theirs: DocumentJSONV10,
): ThreeWayDiff {
  const safeBase = (base ?? {}) as DocumentJSONV10
  const safeMine = (mine ?? {}) as DocumentJSONV10
  const safeTheirs = (theirs ?? {}) as DocumentJSONV10
  const minePatch = diffDocument(safeBase, safeMine)
  const theirsPatch = diffDocument(safeBase, safeTheirs)

  const conflicts: ConflictNode[] = []

  // metadata conflicts: same key changed on both sides differently
  const mineMetaKeys = new Map(minePatch.metadata.map((d) => [d.key, d]))
  const theirsMetaKeys = new Map(theirsPatch.metadata.map((d) => [d.key, d]))
  for (const k of mineMetaKeys.keys()) {
    if (!theirsMetaKeys.has(k)) continue
    const m = mineMetaKeys.get(k)!
    const t = theirsMetaKeys.get(k)!
    if (deepEqual(m.newValue, t.newValue)) continue
    conflicts.push({
      conflictId: `metadata::${k}`,
      scope: 'metadata',
      label: `메타데이터 · ${k}`,
      path: `metadata.${k}`,
      baseValue: m.baseValue,
      mineValue: m.newValue,
      theirsValue: t.newValue,
    })
  }

  // infobox conflicts
  const mineIbKeys = new Map(minePatch.infobox.map((d) => [d.key, d]))
  const theirsIbKeys = new Map(theirsPatch.infobox.map((d) => [d.key, d]))
  for (const k of mineIbKeys.keys()) {
    if (!theirsIbKeys.has(k)) continue
    const m = mineIbKeys.get(k)!
    const t = theirsIbKeys.get(k)!
    if (deepEqual(m.newValue, t.newValue)) continue
    conflicts.push({
      conflictId: `infobox::${k}`,
      scope: 'infobox',
      label: `정보 박스 · ${k}`,
      path: `infobox.${k}`,
      baseValue: m.baseValue,
      mineValue: m.newValue,
      theirsValue: t.newValue,
    })
  }

  // section presence + title + blocks
  const mineSecMap = new Map(minePatch.sections.map((s) => [s.id, s]))
  const theirsSecMap = new Map(theirsPatch.sections.map((s) => [s.id, s]))
  const baseSecIndex = indexSections((Array.isArray(safeBase.sections) ? safeBase.sections : []) as AnySection[])
  const mineSecIndex = indexSections((Array.isArray(safeMine.sections) ? safeMine.sections : []) as AnySection[])
  const theirsSecIndex = indexSections((Array.isArray(safeTheirs.sections) ? safeTheirs.sections : []) as AnySection[])

  const allSectionIds = new Set([...mineSecMap.keys(), ...theirsSecMap.keys()])
  for (const sid of allSectionIds) {
    const m = mineSecMap.get(sid)
    const t = theirsSecMap.get(sid)
    if (!m || !t) continue // only changed on one side → no conflict
    // presence conflict: removed on one, kept/changed on other
    if (m.status === 'removed' && t.status !== 'removed') {
      conflicts.push({
        conflictId: `section::${sid}::presence`,
        scope: 'section.presence',
        label: `섹션 존재 여부 — ${(m.baseTitle ?? sid)}`,
        path: `sections/${sid}`,
        baseValue: baseSecIndex.get(sid),
        mineValue: null,
        theirsValue: theirsSecIndex.get(sid),
      })
      continue
    }
    if (t.status === 'removed' && m.status !== 'removed') {
      conflicts.push({
        conflictId: `section::${sid}::presence`,
        scope: 'section.presence',
        label: `섹션 존재 여부 — ${(t.baseTitle ?? sid)}`,
        path: `sections/${sid}`,
        baseValue: baseSecIndex.get(sid),
        mineValue: mineSecIndex.get(sid),
        theirsValue: null,
      })
      continue
    }
    // title conflict
    if (m.titleChanged && t.titleChanged && m.newTitle !== t.newTitle) {
      conflicts.push({
        conflictId: `section::${sid}::title`,
        scope: 'section.title',
        label: `섹션 제목 — ${(m.baseTitle ?? sid)}`,
        path: `sections/${sid}/title`,
        baseValue: m.baseTitle,
        mineValue: m.newTitle,
        theirsValue: t.newTitle,
      })
    }
    // level conflict
    if (m.levelChanged && t.levelChanged && m.level !== t.level) {
      conflicts.push({
        conflictId: `section::${sid}::level`,
        scope: 'section.level',
        label: `섹션 레벨 — ${(m.baseTitle ?? sid)}`,
        path: `sections/${sid}/level`,
        baseValue: baseSecIndex.get(sid)?.level,
        mineValue: m.level,
        theirsValue: t.level,
      })
    }
  }

  // block-level conflicts (across the whole doc)
  const baseBlocks = indexBlocks((Array.isArray(safeBase.sections) ? safeBase.sections : []) as AnySection[])
  const mineBlocks = indexBlocks((Array.isArray(safeMine.sections) ? safeMine.sections : []) as AnySection[])
  const theirsBlocks = indexBlocks((Array.isArray(safeTheirs.sections) ? safeTheirs.sections : []) as AnySection[])
  const allBlockIds = new Set<Ulid>([
    ...mineBlocks.keys(),
    ...theirsBlocks.keys(),
    ...baseBlocks.keys(),
  ])
  for (const bid of allBlockIds) {
    const baseB = baseBlocks.get(bid)
    const mineB = mineBlocks.get(bid)
    const theirsB = theirsBlocks.get(bid)
    const mineChanged = !deepEqual(baseB, mineB)
    const theirsChanged = !deepEqual(baseB, theirsB)
    if (!mineChanged || !theirsChanged) continue
    if (deepEqual(mineB, theirsB)) continue // same change → no conflict
    conflicts.push({
      conflictId: `block::${bid}`,
      scope: 'block',
      label: `블록 — ${bid.slice(-6)} (${mineB?.type ?? theirsB?.type ?? baseB?.type ?? '?'})`,
      path: `block/${bid}`,
      baseValue: baseB ?? null,
      mineValue: mineB ?? null,
      theirsValue: theirsB ?? null,
    })
  }

  // list conflicts: same key changed differently on both sides
  const listScopes: { scope: ConflictScope; label: string; mineList: ListDiff<unknown>; theirsList: ListDiff<unknown> }[] = [
    {
      scope: 'related_documents',
      label: '연관 문서',
      mineList: minePatch.related_documents as unknown as ListDiff<unknown>,
      theirsList: theirsPatch.related_documents as unknown as ListDiff<unknown>,
    },
    {
      scope: 'glossary',
      label: '용어집',
      mineList: minePatch.glossary as unknown as ListDiff<unknown>,
      theirsList: theirsPatch.glossary as unknown as ListDiff<unknown>,
    },
    {
      scope: 'references',
      label: '참고 문헌',
      mineList: minePatch.references as unknown as ListDiff<unknown>,
      theirsList: theirsPatch.references as unknown as ListDiff<unknown>,
    },
    {
      scope: 'see_also',
      label: '관련 항목',
      mineList: minePatch.see_also as unknown as ListDiff<unknown>,
      theirsList: theirsPatch.see_also as unknown as ListDiff<unknown>,
    },
  ]
  for (const ls of listScopes) {
    const mineChanges = new Map(ls.mineList.changed.map((c) => [c.key, c]))
    const theirsChanges = new Map(ls.theirsList.changed.map((c) => [c.key, c]))
    for (const k of mineChanges.keys()) {
      if (!theirsChanges.has(k)) continue
      const a = mineChanges.get(k)!
      const b = theirsChanges.get(k)!
      if (deepEqual(a.newValue, b.newValue)) continue
      conflicts.push({
        conflictId: `${ls.scope}::${k}`,
        scope: ls.scope,
        label: `${ls.label} · ${k}`,
        path: `${ls.scope}/${k}`,
        baseValue: a.baseValue,
        mineValue: a.newValue,
        theirsValue: b.newValue,
      })
    }
  }

  // top-level scalars (title, slug, summary, …)
  const mineScalars = new Map(minePatch.scalars.map((s) => [s.key, s]))
  const theirsScalars = new Map(theirsPatch.scalars.map((s) => [s.key, s]))
  for (const k of mineScalars.keys()) {
    if (!theirsScalars.has(k)) continue
    const a = mineScalars.get(k)!
    const b = theirsScalars.get(k)!
    if (deepEqual(a.newValue, b.newValue)) continue
    conflicts.push({
      conflictId: `top::${k}`,
      scope: 'top',
      label: `최상위 · ${k}`,
      path: k,
      baseValue: a.baseValue,
      mineValue: a.newValue,
      theirsValue: b.newValue,
    })
  }

  // Auto-mergeable: theirs-side changes that don't appear as conflicts
  // (these are the changes the auto-merge button can apply onto mine)
  const conflictIds = new Set(conflicts.map((c) => c.conflictId))
  const autoMergeableConflictIds: string[] = []
  // theirs-only metadata changes
  for (const [k] of theirsMetaKeys) {
    const id = `metadata::${k}`
    if (!conflictIds.has(id) && !mineMetaKeys.has(k)) autoMergeableConflictIds.push(id)
  }
  for (const [k] of theirsIbKeys) {
    const id = `infobox::${k}`
    if (!conflictIds.has(id) && !mineIbKeys.has(k)) autoMergeableConflictIds.push(id)
  }
  for (const bid of theirsBlocks.keys()) {
    const id = `block::${bid}`
    if (conflictIds.has(id)) continue
    const baseB = baseBlocks.get(bid)
    const theirsB = theirsBlocks.get(bid)
    if (deepEqual(baseB, theirsB)) continue
    if (mineBlocks.has(bid) && !deepEqual(baseB, mineBlocks.get(bid))) continue
    autoMergeableConflictIds.push(id)
  }

  return {
    base: safeBase,
    mine: safeMine,
    theirs: safeTheirs,
    minePatch,
    theirsPatch,
    conflicts,
    autoMergeableConflictIds,
  }
}

// ---------------------------------------------------------------------------
// Apply theirs-side changes onto mine for non-conflicting nodes (auto-merge)
// ---------------------------------------------------------------------------

export function autoMerge(
  threeWay: ThreeWayDiff,
): DocumentJSONV10 {
  const { base, mine, theirs, conflicts } = threeWay
  const conflictIds = new Set(conflicts.map((c) => c.conflictId))
  const merged: DocumentJSONV10 = JSON.parse(JSON.stringify(mine))

  // metadata: theirs-only changes apply
  const baseMeta = base.metadata as unknown as Record<string, unknown>
  const theirsMeta = theirs.metadata as unknown as Record<string, unknown>
  const mergedMeta = merged.metadata as unknown as Record<string, unknown>
  for (const k of new Set([...Object.keys(baseMeta), ...Object.keys(theirsMeta)])) {
    if (deepEqual(baseMeta[k], theirsMeta[k])) continue
    if (conflictIds.has(`metadata::${k}`)) continue
    if (theirsMeta[k] === undefined) delete mergedMeta[k]
    else mergedMeta[k] = theirsMeta[k]
  }

  // infobox
  const baseIb = (base.infobox ?? {}) as Record<string, unknown>
  const theirsIb = (theirs.infobox ?? {}) as Record<string, unknown>
  const mergedIb = (merged.infobox ?? {}) as Record<string, unknown>
  for (const k of new Set([...Object.keys(baseIb), ...Object.keys(theirsIb)])) {
    if (deepEqual(baseIb[k], theirsIb[k])) continue
    if (conflictIds.has(`infobox::${k}`)) continue
    if (theirsIb[k] === undefined) delete mergedIb[k]
    else mergedIb[k] = theirsIb[k]
  }
  if (Object.keys(mergedIb).length > 0) merged.infobox = mergedIb as Infobox

  // blocks: replace mine block with theirs block for non-conflicting ids that
  // theirs changed and mine did NOT.
  const baseBlocks = indexBlocks(base.sections as AnySection[])
  const theirsBlocks = indexBlocks(theirs.sections as AnySection[])
  const mineBlocks = indexBlocks(mine.sections as AnySection[])
  for (const [bid, tBlock] of theirsBlocks) {
    if (conflictIds.has(`block::${bid}`)) continue
    const bBlock = baseBlocks.get(bid)
    if (deepEqual(bBlock, tBlock)) continue
    const mBlock = mineBlocks.get(bid)
    if (mBlock && !deepEqual(bBlock, mBlock)) continue // mine also changed -> would be conflict
    // splice into merged at the same section/index theirs has it
    const loc = findBlockIndex(theirs.sections as AnySection[], bid)
    if (!loc) continue
    const targetSec = indexSections(merged.sections as AnySection[]).get(loc.sectionId)
    if (!targetSec) continue
    const existingIdx = targetSec.blocks.findIndex((b) => b.id === bid)
    if (existingIdx >= 0) {
      targetSec.blocks[existingIdx] = tBlock
    } else {
      const idx = Math.min(loc.index, targetSec.blocks.length)
      targetSec.blocks.splice(idx, 0, tBlock)
    }
  }

  return merged
}

// ---------------------------------------------------------------------------
// Apply user-resolved conflict choices to produce final merged doc
// ---------------------------------------------------------------------------

export type ConflictChoice =
  | { kind: 'mine' }
  | { kind: 'theirs' }
  | { kind: 'manual'; value: unknown }

export function applyResolutions(
  threeWay: ThreeWayDiff,
  baseDoc: DocumentJSONV10,
  choices: Record<string, ConflictChoice>,
): DocumentJSONV10 {
  // Start from auto-merged (so non-conflicts are picked up), then overlay user picks.
  const merged: DocumentJSONV10 = JSON.parse(JSON.stringify(baseDoc))

  for (const c of threeWay.conflicts) {
    const choice = choices[c.conflictId] ?? { kind: 'mine' }
    let value: unknown
    if (choice.kind === 'mine') value = c.mineValue
    else if (choice.kind === 'theirs') value = c.theirsValue
    else value = choice.value
    applyConflictValue(merged, c, value)
  }
  return merged
}

function applyConflictValue(
  doc: DocumentJSONV10,
  c: ConflictNode,
  value: unknown,
): void {
  if (c.scope === 'metadata') {
    const k = c.path.split('.')[1] ?? ''
    const meta = doc.metadata as unknown as Record<string, unknown>
    if (value === undefined) delete meta[k]
    else meta[k] = value
    return
  }
  if (c.scope === 'infobox') {
    const k = c.path.split('.')[1] ?? ''
    const ib = (doc.infobox ?? {}) as Record<string, unknown>
    if (value === undefined) delete ib[k]
    else ib[k] = value
    doc.infobox = ib as Infobox
    return
  }
  if (c.scope === 'block') {
    const bid = c.path.split('/')[1] ?? ''
    if (value === null) {
      // remove block
      walkSections(doc.sections as AnySection[], (sec) => {
        const i = sec.blocks.findIndex((b) => b.id === bid)
        if (i >= 0) sec.blocks.splice(i, 1)
      })
      return
    }
    const v = value as Block
    let placed = false
    walkSections(doc.sections as AnySection[], (sec) => {
      const i = sec.blocks.findIndex((b) => b.id === bid)
      if (i >= 0) {
        sec.blocks[i] = v
        placed = true
      }
    })
    if (!placed) {
      // Insert into first section as fallback (rare case after auto-merge churn).
      const first = doc.sections[0]
      if (first) first.blocks.push(v)
    }
    return
  }
  if (c.scope === 'section.title') {
    const sid = c.path.split('/')[1] ?? ''
    const idx = indexSections(doc.sections as AnySection[]).get(sid)
    if (idx) idx.title = String(value)
    return
  }
  if (c.scope === 'section.level') {
    // Level changes are structurally invasive; we keep the user's pick on the
    // section node itself but do NOT re-tier siblings — the BE schema will
    // reject if invalid, surfacing a clean error.
    const sid = c.path.split('/')[1] ?? ''
    const idx = indexSections(doc.sections as AnySection[]).get(sid)
    if (idx) (idx as { level: number }).level = value as number
    return
  }
  if (c.scope === 'section.presence') {
    const sid = c.path.split('/')[1] ?? ''
    if (value === null) {
      // remove
      removeSection(doc.sections as AnySection[], sid)
    } else {
      // ensure present at top level (best-effort restore)
      const exists = indexSections(doc.sections as AnySection[]).get(sid)
      if (!exists) (doc.sections as AnySection[]).push(value as AnySection)
    }
    return
  }
  if (c.scope === 'top') {
    ;(doc as unknown as Record<string, unknown>)[c.path] = value
    return
  }
  // list scopes: replace the matching item
  const listKey = c.scope as 'related_documents' | 'glossary' | 'references' | 'see_also'
  const list = ((doc as unknown as Record<string, unknown>)[listKey] as unknown[]) ?? []
  const itemKey = c.path.split('/').slice(1).join('/')
  const matchIdx = list.findIndex((item) => listItemKey(listKey, item) === itemKey)
  if (matchIdx >= 0) list[matchIdx] = value
  else list.push(value)
  ;(doc as unknown as Record<string, unknown>)[listKey] = list
}

function listItemKey(scope: string, item: unknown): string {
  if (scope === 'related_documents') {
    const r = item as RelatedDoc
    return `${r.slug}::${r.relation}`
  }
  if (scope === 'glossary') return (item as GlossaryItem).term
  if (scope === 'references') {
    const r = item as Reference
    return `${r.type}::${r.label}::${r.url ?? ''}`
  }
  if (scope === 'see_also') return item as string
  return ''
}

function walkSections(secs: AnySection[], fn: (sec: AnySection) => void): void {
  for (const s of secs) {
    fn(s)
    const subs = (s as SectionLevel1).subsections as AnySection[] | undefined
    if (subs) walkSections(subs, fn)
  }
}

function removeSection(secs: AnySection[], id: Ulid): boolean {
  for (let i = 0; i < secs.length; i++) {
    const s = secs[i]
    if (!s) continue
    if (s.id === id) {
      secs.splice(i, 1)
      return true
    }
    const subs = (s as SectionLevel1).subsections as AnySection[] | undefined
    if (subs && removeSection(subs, id)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Outline shape used by the modal panes
// ---------------------------------------------------------------------------

export interface OutlineNode {
  id: Ulid
  level: number
  title: string
  status: DiffStatus
  children: OutlineNode[]
  blockCount: number
  conflictId?: string
}

export function buildOutline(
  doc: DocumentJSONV10,
  patch: DocDiff | null,
  conflicts: ConflictNode[],
  side: 'mine' | 'base' | 'theirs',
): OutlineNode[] {
  const sectionDiffMap = new Map<Ulid, SectionDiff>(
    (patch?.sections ?? []).map((s) => [s.id, s]),
  )
  const conflictBySection = new Map<Ulid, ConflictNode>()
  for (const c of conflicts) {
    if (c.scope === 'section.title' || c.scope === 'section.level' || c.scope === 'section.presence') {
      const sid = c.path.split('/')[1] ?? ''
      conflictBySection.set(sid, c)
    }
  }
  const walk = (secs: AnySection[]): OutlineNode[] =>
    secs.map((s) => {
      const d = sectionDiffMap.get(s.id)
      const subs = (s as SectionLevel1).subsections as AnySection[] | undefined
      return {
        id: s.id,
        level: s.level,
        title: s.title,
        status: d?.status ?? 'unchanged',
        children: subs ? walk(subs) : [],
        blockCount: s.blocks.length,
        conflictId: conflictBySection.get(s.id)?.conflictId,
      }
    })
  // sections present only on this side (added/removed) need to surface too —
  // 'mine' should still show sections that were removed from base but kept on mine.
  const base = (patch?.sections ?? []).filter((s) => s.status === 'added' && side === 'mine')
  const visibleAdded = base.map((d) => ({
    id: d.id,
    level: (d.level ?? 1) as 1 | 2 | 3,
    title: d.newTitle ?? '',
    status: 'added' as DiffStatus,
    children: [],
    blockCount: d.blockDiffs.length,
  }))
  return [...walk(doc.sections as AnySection[]), ...visibleAdded.filter((v) => !doc.sections.some((s) => s.id === v.id))]
}
