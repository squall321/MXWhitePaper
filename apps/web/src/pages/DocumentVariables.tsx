import { useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useDocument } from '@/features/document/hooks/useDocument'
import { useEditorStore } from '@/features/editor/state'
import { patchVariables, isPreconditionFailed } from '@/features/editor/api'
import type {
  DocumentJSONV10,
  Block,
  SectionLevel1,
  SectionLevel2,
  SectionLevel3,
} from '@/types/document'

/** Variable token regex used by both the renderer and this page's collector. */
const VAR_TOKEN_RE = /\{\{([A-Za-z0-9_-]+)(?:\|[^}]*)?\}\}/g

/**
 * Walk every textual field in `doc` and emit each `{{name}}` (or
 * `{{name|fallback}}`) it finds. Order is insertion order — first-seen wins
 * so the editor sees variables grouped by the section/block they appear in.
 */
export function collectVariables(doc: DocumentJSONV10): string[] {
  const seen = new Set<string>()
  const push = (s: string | undefined | null) => {
    if (!s) return
    let m: RegExpExecArray | null
    VAR_TOKEN_RE.lastIndex = 0
    while ((m = VAR_TOKEN_RE.exec(s)) !== null) {
      seen.add(m[1]!)
    }
  }
  const walkBlock = (b: Block) => {
    // Skip code blocks — variable substitution doesn't run there at render
    // time so we should also hide them from the editor list.
    if (b.type === 'code') return
    if ('text' in b) push((b as { text?: string }).text)
    if ('title' in b) push((b as { title?: string }).title)
    if (b.type === 'list') {
      for (const it of b.items) {
        if (typeof it === 'string') push(it)
        else if (it && typeof it === 'object' && 'text' in it) push((it as { text?: string }).text)
      }
    }
    if (b.type === 'table') {
      for (const h of b.headers ?? []) push(h)
      for (const row of b.rows ?? []) for (const c of row) push(c)
    }
    if (b.type === 'callout' || b.type === 'quote') {
      // text already covered above
    }
    if (b.type === 'columns') {
      for (const col of b.columns) for (const sub of col) walkBlock(sub)
    }
    if (b.type === 'tabs') {
      for (const t of b.tabs) for (const sub of t.blocks) walkBlock(sub)
    }
    if (b.type === 'accordion') {
      for (const it of b.items) for (const sub of it.blocks) walkBlock(sub)
    }
  }
  type AnySection = SectionLevel1 | SectionLevel2 | SectionLevel3
  const walkSection = (sec: AnySection) => {
    push(sec.title)
    for (const b of sec.blocks) walkBlock(b)
    if ('subsections' in sec && sec.subsections) {
      for (const s of sec.subsections) walkSection(s as AnySection)
    }
  }
  for (const sec of doc.sections) walkSection(sec)
  return Array.from(seen)
}

/**
 * Document variables editor. Lists every `{{var}}` discovered in the document
 * body and lets the editor (or admin) set per-doc fill-ins. Save persists via
 * `PATCH /documents/:slug/variables` reusing the standard If-Match flow.
 */
export function DocumentVariablesPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const { data, isPending, isError } = useDocument(slug)
  const draft = useEditorStore((s) => s.draft)
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const live = draft ?? data?.document
  const tokens = useMemo(
    () => (live ? collectVariables(live) : []),
    [live],
  )

  // Editable map — seeded from the doc's existing variables on first render
  // so server-side rendering shows the current values immediately. Tokens not
  // yet defined start as empty string so the user can fill them in.
  const seed = useMemo<Record<string, string>>(() => {
    if (!live) return {}
    // Schema-regen types optional `additionalProperties` as `string | undefined`;
    // strip undefined so downstream uses a clean Record<string, string>.
    const m: Record<string, string> = {}
    for (const [k, v] of Object.entries(live.variables ?? {})) {
      if (typeof v === 'string') m[k] = v
    }
    for (const t of tokens) if (!(t in m)) m[t] = ''
    return m
  }, [live, tokens])
  const [values, setValues] = useState<Record<string, string>>(seed)

  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (isPending) return <p className="text-sm text-gray-500">불러오는 중…</p>
  if (isError || !live || !slug) return <p className="text-sm text-error">문서를 불러올 수 없습니다.</p>

  const onChange = (name: string, v: string) => {
    setValues((prev) => ({ ...prev, [name]: v }))
  }

  const onSave = async () => {
    if (!etag) return
    setSaveErr(null)
    setSaving(true)
    try {
      // Drop empty values to keep the persisted map tight — unfilled vars
      // surface via the `var-unfilled` marker at render time.
      const trimmed: Record<string, string> = {}
      for (const [k, v] of Object.entries(values)) if (v.length > 0) trimmed[k] = v
      const result = await patchVariables(slug, trimmed, etag, '변수 갱신')
      apply(result.document, result.etag)
      navigate(`/docs/${encodeURIComponent(slug)}`)
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setConflict(null)
        setSaveErr('다른 사용자가 먼저 저장했습니다. 새로 고침 후 다시 시도하세요.')
      } else {
        setSaveErr('저장에 실패했습니다.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4" data-testid="doc-variables">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">변수 관리 — {live.title}</h1>
        <button
          type="button"
          onClick={() => navigate(`/docs/${encodeURIComponent(slug)}`)}
          className="text-xs text-gray-600 hover:underline"
        >
          돌아가기
        </button>
      </header>

      <p className="text-xs text-gray-500">
        본문에서 발견된 {`{{var}}`} 토큰을 채울 수 있습니다. 비워 두면 렌더 시
        {' '}<code>var-unfilled</code> 표시가 노출됩니다.
      </p>

      {tokens.length === 0 ? (
        <p className="text-sm text-gray-500">정의된 변수가 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {tokens.map((name) => (
            <li key={name} className="grid grid-cols-[10rem_1fr] items-center gap-2">
              <label
                htmlFor={`var-${name}`}
                className="font-mono text-xs text-gray-700"
                data-testid={`var-label-${name}`}
              >
                {`{{${name}}}`}
              </label>
              <input
                id={`var-${name}`}
                data-testid={`var-input-${name}`}
                type="text"
                value={values[name] ?? ''}
                onChange={(e) => onChange(name, e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none focus:ring-2 focus:ring-smsg-300"
              />
            </li>
          ))}
        </ul>
      )}

      {saveErr && (
        <p className="text-xs text-error" role="alert">{saveErr}</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={saving || !etag}
          data-testid="save-variables"
          className="inline-flex h-8 items-center rounded-md bg-smsg-700 px-3 text-xs font-semibold text-white disabled:opacity-40"
        >
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>
    </div>
  )
}
