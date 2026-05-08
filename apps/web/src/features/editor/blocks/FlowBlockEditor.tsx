import { useState } from 'react'
import type { FlowBlock, Slug } from '@/types/document'
import { Button, Field, Select } from '@/components/ui'
import { useEditorStore } from '@/features/editor/state'
import { patchBlock, isPreconditionFailed } from '@/features/editor/api'
import { FlowBlockView } from '@/components/blocks/FlowBlock'

interface Props {
  slug: Slug
  block: FlowBlock
}

export interface FlowTemplate {
  id: string
  label: string
  source: string
}

/**
 * Six starter snippets: 순서도 / 시퀀스 / 클래스 / 상태 / 간트 / ER. Selecting a
 * template overwrites `source` with the snippet so the user can iterate.
 */
export const FLOW_TEMPLATES: ReadonlyArray<FlowTemplate> = [
  {
    id: 'flowchart',
    label: '순서도',
    source: ['flowchart TD', '  A[시작] --> B{조건?}', '  B -- 예 --> C[처리]', '  B -- 아니오 --> D[종료]'].join('\n'),
  },
  {
    id: 'sequence',
    label: '시퀀스',
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
    label: '클래스',
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
    label: '상태',
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
    label: '간트',
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
    id: 'er',
    label: 'ER',
    source: [
      'erDiagram',
      '  CUSTOMER ||--o{ ORDER : places',
      '  ORDER ||--|{ LINE-ITEM : contains',
    ].join('\n'),
  },
]

export function FlowBlockEditor({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const [local, setLocal] = useState<FlowBlock>(block)
  const [error, setError] = useState<string | null>(null)
  const [templateId, setTemplateId] = useState<string>('')

  const push = async (next: FlowBlock) => {
    setLocal(next)
    if (!etag) return
    try {
      const result = await patchBlock(slug, block.id, next, etag, '플로우 편집')
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) setError('충돌 — 새로고침 필요')
      else setError((err as Error).message)
    }
  }

  const applyTemplate = (id: string) => {
    setTemplateId(id)
    if (!id) return
    const tpl = FLOW_TEMPLATES.find((t) => t.id === id)
    if (!tpl) return
    void push({ ...local, engine: 'mermaid', source: tpl.source })
  }

  return (
    <div className="space-y-3 rounded border border-smsg-100 bg-smsg-100/40 p-3">
      <div className="flex items-end gap-2">
        <Field label="템플릿">
          <Select
            value={templateId}
            onChange={(e) => applyTemplate(e.target.value)}
            aria-label="flow template"
          >
            <option value="">선택…</option>
            {FLOW_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </Select>
        </Field>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() => void push({ ...local, source: '' })}
        >
          비우기
        </Button>
      </div>

      <Field label="Mermaid 소스">
        <textarea
          value={local.source}
          onChange={(e) => setLocal({ ...local, source: e.target.value })}
          onBlur={() => void push(local)}
          rows={8}
          aria-label="flow source"
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs"
        />
      </Field>

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      <div className="rounded border border-gray-200 bg-white p-2">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          미리보기
        </p>
        <FlowBlockView block={local} />
      </div>
    </div>
  )
}
