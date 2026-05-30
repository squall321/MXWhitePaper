import { useEffect, useMemo, useRef, useState } from 'react'
import type { FlowBlock, Slug } from '@/types/document'
import { Field, Select } from '@/components/ui'
import { useEditorStore } from '@/features/editor/state'
import { patchBlock, isPreconditionFailed } from '@/features/editor/api'
import { FlowBlockView } from '@/components/blocks/FlowBlock'
import { useT } from '@/lib/i18n'

interface Props {
  slug: Slug
  block: FlowBlock
}

/**
 * Mermaid diagram kinds we expose in the dropdown. The schema only stores
 * `engine` + `source`, so the active "kind" is derived from the source's first
 * non-empty token. Selecting a kind rewrites `source` with the matching
 * starter snippet.
 */
export interface FlowKind {
  id: string
  /** i18n key for the visible label (e.g. `editor.flow.kind.flowchart`). */
  labelKey: string
  /** Token that starts a Mermaid block of this kind (used to detect kind from source). */
  detect: string[]
  source: string
}

export const FLOW_KINDS: ReadonlyArray<FlowKind> = [
  {
    id: 'flowchart',
    labelKey: 'editor.flow.kind.flowchart',
    detect: ['flowchart', 'graph'],
    source: ['flowchart TD', '  A[시작] --> B{조건?}', '  B -- 예 --> C[처리]', '  B -- 아니오 --> D[종료]'].join('\n'),
  },
  {
    id: 'sequence',
    labelKey: 'editor.flow.kind.sequence',
    detect: ['sequenceDiagram'],
    source: [
      'sequenceDiagram',
      '  participant U as 사용자',
      '  participant S as 서버',
      '  U->>S: 요청',
      '  S-->>U: 응답',
    ].join('\n'),
  },
  {
    id: 'class',
    labelKey: 'editor.flow.kind.class',
    detect: ['classDiagram'],
    source: [
      'classDiagram',
      '  class Animal {',
      '    +String name',
      '    +eat()',
      '  }',
      '  class Dog {',
      '    +bark()',
      '  }',
      '  Animal <|-- Dog',
    ].join('\n'),
  },
  {
    id: 'state',
    labelKey: 'editor.flow.kind.state',
    detect: ['stateDiagram', 'stateDiagram-v2'],
    source: [
      'stateDiagram-v2',
      '  [*] --> 대기',
      '  대기 --> 진행: 시작',
      '  진행 --> 완료: 끝',
      '  완료 --> [*]',
    ].join('\n'),
  },
  {
    id: 'gantt',
    labelKey: 'editor.flow.kind.gantt',
    detect: ['gantt'],
    source: [
      'gantt',
      '  title 일정',
      '  dateFormat YYYY-MM-DD',
      '  section 단계',
      '  설계 :a1, 2026-05-01, 5d',
      '  구현 :after a1, 7d',
    ].join('\n'),
  },
  {
    id: 'mindmap',
    labelKey: 'editor.flow.kind.mindmap',
    detect: ['mindmap'],
    source: [
      'mindmap',
      '  root((중심))',
      '    A',
      '      A1',
      '      A2',
      '    B',
      '    C',
    ].join('\n'),
  },
  {
    id: 'pie',
    labelKey: 'editor.flow.kind.pie',
    detect: ['pie'],
    source: [
      'pie title 분포',
      '  "A" : 40',
      '  "B" : 30',
      '  "C" : 30',
    ].join('\n'),
  },
  {
    id: 'journey',
    labelKey: 'editor.flow.kind.journey',
    detect: ['journey'],
    source: [
      'journey',
      '  title 사용자 여정',
      '  section 가입',
      '    가입하기: 5: 사용자',
      '  section 첫 방문',
      '    탐색: 3: 사용자',
    ].join('\n'),
  },
]

/**
 * Three short ready-to-paste samples for the cheat-sheet pane. Kept tiny on
 * purpose so the right column doesn't dwarf the editor.
 */
export interface FlowExample {
  /** i18n key for the visible label. */
  labelKey: string
  source: string
}

export const FLOW_EXAMPLES: ReadonlyArray<FlowExample> = [
  {
    labelKey: 'editor.flow.example.basic',
    source: ['flowchart LR', '  A --> B --> C'].join('\n'),
  },
  {
    labelKey: 'editor.flow.example.sequence',
    source: ['sequenceDiagram', '  A->>B: 안녕', '  B-->>A: 응'].join('\n'),
  },
  {
    labelKey: 'editor.flow.example.gantt',
    source: [
      'gantt',
      '  dateFormat YYYY-MM-DD',
      '  section work',
      '  task1 :a1, 2026-05-01, 3d',
    ].join('\n'),
  },
]

/** Detect the kind id from the current Mermaid source (first non-empty token). */
export function detectKind(source: string): string | null {
  const first = source
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!first) return null
  // grab the first whitespace-delimited token
  const tok = first.split(/\s+/)[0] ?? ''
  for (const k of FLOW_KINDS) {
    if (k.detect.includes(tok)) return k.id
  }
  return null
}

/** Persist debounce. Slightly higher than the inline text editor (800 vs 300)
 * because Mermaid render also runs on every change in preview. */
const PERSIST_MS = 800
const PREVIEW_MS = 300

/**
 * FLOW-02 — Excalidraw 엔진 read-only 게이트.
 *
 * 이전 구현의 persist() 는 무조건 engine='mermaid' 로 PATCH 해 Excalidraw
 * 블록을 silent 하게 mermaid 로 재작성하는 데이터 손실 경로가 있었다.
 * 사용자 데이터 보호를 위해 mermaid 가 아닌 엔진은 편집기를 마운트하지
 * 않고 read-only notice 만 노출한다. Sprint-7 에서 본격 Excalidraw 편집기가
 * 추가되면 여기서 분기.
 */
function FlowExcalidrawReadonly({ block }: { block: FlowBlock }) {
  const t = useT()
  return (
    <div
      role="status"
      aria-live="polite"
      data-flow-block-editor
      data-block-id={block.id}
      data-engine={block.engine}
      className="my-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
    >
      {t('editor.flow.excalidrawReadonly')}
    </div>
  )
}

export function FlowBlockEditor({ slug, block }: Props) {
  if (block.engine !== 'mermaid') {
    return <FlowExcalidrawReadonly block={block} />
  }
  return <FlowMermaidEditor slug={slug} block={block} />
}

function FlowMermaidEditor({ slug, block }: Props) {
  const t = useT()
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const [source, setSource] = useState<string>(block.source)
  const [previewSource, setPreviewSource] = useState<string>(block.source)
  const [error, setError] = useState<string | null>(null)
  const [savedOnce, setSavedOnce] = useState(false)
  const persistTimer = useRef<number | null>(null)
  const previewTimer = useRef<number | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const lineNumRef = useRef<HTMLDivElement>(null)

  // Sync local source if the snapshot updates from another tab.
  useEffect(() => {
    if (!savedOnce) {
      setSource(block.source)
      setPreviewSource(block.source)
    }
  }, [block.source, savedOnce])

  // Debounced live preview.
  useEffect(() => {
    if (previewTimer.current) window.clearTimeout(previewTimer.current)
    previewTimer.current = window.setTimeout(() => {
      setPreviewSource(source)
    }, PREVIEW_MS)
    return () => {
      if (previewTimer.current) window.clearTimeout(previewTimer.current)
    }
  }, [source])

  const persist = async (next: string) => {
    if (!etag) return
    try {
      const result = await patchBlock(
        slug,
        block.id,
        { ...block, source: next },
        etag,
        t('editor.flow.changeLog'),
      )
      apply(result.document, result.etag)
      setError(null)
      setSavedOnce(true)
    } catch (err) {
      if (isPreconditionFailed(err)) setError(t('editor.common.conflict'))
      else setError((err as Error).message)
    }
  }

  const onSourceChange = (next: string) => {
    setSource(next)
    if (persistTimer.current) window.clearTimeout(persistTimer.current)
    persistTimer.current = window.setTimeout(() => {
      void persist(next)
    }, PERSIST_MS)
  }

  const activeKind = useMemo(() => detectKind(source) ?? '', [source])

  const onPickKind = (id: string) => {
    if (!id) return
    const kind = FLOW_KINDS.find((k) => k.id === id)
    if (!kind) return
    onSourceChange(kind.source)
  }

  const onPickExample = (ex: FlowExample) => {
    onSourceChange(ex.source)
  }

  const onClear = () => onSourceChange('')

  // Keep the line-number column scroll in sync with the textarea.
  const onScroll = () => {
    if (taRef.current && lineNumRef.current) {
      lineNumRef.current.scrollTop = taRef.current.scrollTop
    }
  }

  const lines = useMemo(() => {
    // Always emit at least one line so the gutter renders even when empty.
    const count = Math.max(1, source.split('\n').length)
    return Array.from({ length: count }, (_, i) => i + 1)
  }, [source])

  // Build a synthetic FlowBlock for the preview using the debounced source
  // so we don't re-render Mermaid on every keystroke.
  const previewBlock: FlowBlock = useMemo(
    () => ({ ...block, engine: 'mermaid', source: previewSource }),
    [block, previewSource],
  )

  return (
    <div
      className="space-y-3 rounded border border-smsg-100 bg-smsg-100/40 p-3"
      data-flow-block-editor
      data-block-id={block.id}
    >
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('editor.flow.kindLabel')}>
          <Select
            value={activeKind}
            onChange={(e) => onPickKind(e.target.value)}
            aria-label={t('editor.flow.kindLabel')}
          >
            <option value="">{t('editor.flow.kindPick')}</option>
            {FLOW_KINDS.map((k) => (
              <option key={k.id} value={k.id}>{t(k.labelKey)}</option>
            ))}
          </Select>
        </Field>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
        >
          {t('editor.flow.clear')}
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="space-y-3">
          <Field label={t('editor.flow.sourceLabel')}>
            <div className="flex overflow-hidden rounded-md border border-gray-300 bg-white font-mono text-xs">
              <div
                ref={lineNumRef}
                aria-hidden="true"
                className="flex w-10 flex-col overflow-hidden border-r border-gray-200 bg-gray-50 px-1 py-2 text-right text-gray-400 select-none"
                style={{ lineHeight: '1.5rem' }}
                data-flow-line-numbers
              >
                {lines.map((n) => (
                  <span key={n} className="block leading-6">{n}</span>
                ))}
              </div>
              <textarea
                ref={taRef}
                value={source}
                onChange={(e) => onSourceChange(e.target.value)}
                onScroll={onScroll}
                rows={Math.min(20, Math.max(8, lines.length + 1))}
                aria-label={t('editor.flow.sourceLabel')}
                spellCheck={false}
                className="block w-full resize-y bg-white px-3 py-2 leading-6 text-gray-900 outline-none"
                style={{ lineHeight: '1.5rem' }}
              />
            </div>
          </Field>

          {error && (
            <p role="status" aria-live="polite" className="text-[11px] text-red-600">
              {error}
            </p>
          )}

          <div className="rounded border border-gray-200 bg-white p-2">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              {t('editor.flow.preview')}
            </p>
            <FlowBlockView block={previewBlock} />
          </div>
        </div>

        <aside
          className="rounded border border-gray-200 bg-white p-2 text-[11px]"
          aria-label={t('editor.flow.cheatSheet')}
        >
          <p className="mb-1 font-semibold uppercase tracking-wide text-gray-500">
            {t('editor.flow.cheatSheet')}
          </p>
          <ul className="space-y-2">
            {FLOW_EXAMPLES.map((ex) => {
              const exLabel = t(ex.labelKey)
              return (
                <li key={ex.labelKey}>
                  <button
                    type="button"
                    onClick={() => onPickExample(ex)}
                    className="block w-full rounded border border-gray-200 bg-gray-50 px-2 py-1 text-left hover:border-smsg-300 hover:bg-smsg-50"
                    aria-label={t('editor.flow.exampleFill', { label: exLabel })}
                    data-flow-example={ex.labelKey}
                  >
                    <span className="block font-semibold text-gray-700">{exLabel}</span>
                    <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] text-gray-600">
                      {ex.source}
                    </pre>
                  </button>
                </li>
              )
            })}
          </ul>
        </aside>
      </div>
    </div>
  )
}

/**
 * @deprecated kept as an alias so existing imports keep compiling. New code
 * should use `FLOW_KINDS`.
 */
export const FLOW_TEMPLATES = FLOW_KINDS
