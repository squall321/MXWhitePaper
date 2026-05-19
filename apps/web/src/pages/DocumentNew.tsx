import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import type { DocumentJSONV10, SectionLevel1 } from '@/types/document'
import { ulid } from '@/features/editor/ulid'
import { postDocument } from '@/features/editor/api'
import { useOrgTree } from '@/features/org/hooks/useOrgTree'
import { useAuthStore } from '@/features/auth/store'
import { Button, Card, Field, Input, Select, cn } from '@/components/ui'
import type { AppOutletContext } from '@/App'
import { TemplateGallery } from '@/features/templates/TemplateGallery'
import { findTemplate, templateToSections, type TemplateDef } from '@/features/templates/templates'
import {
  getServerTemplate,
  type ServerTemplateSummary,
} from '@/features/templates/serverApi'
import { TagAutocomplete } from '@/features/tags/TagAutocomplete'
import { slugify } from '@/lib/slugify'

/**
 * 새 문서 생성 마법사 — 슬러그 + 제목 + 소속 파트 + 기밀도.
 *
 * Visual: tabs at the top toggle between "빈 문서" and "템플릿에서 시작".
 * Picking a template pre-fills the title and uses the template's blocks as
 * the initial sections array; the user can still tweak title/slug/part
 * before submitting.
 */
type Mode = 'blank' | 'template'

export function DocumentNewPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const user = useAuthStore((s) => s.user)
  const { data: tree } = useOrgTree()
  const { setLeftRail, setRightRail } = useOutletContext<AppOutletContext>()
  useEffect(() => {
    setLeftRail(null)
    setRightRail(null)
    return () => {
      setLeftRail(undefined)
      setRightRail(null)
    }
  }, [setLeftRail, setRightRail])

  const partOptions = useMemo(() => {
    const opts: Array<{ id: string; label: string; slug: string }> = []
    for (const div of tree ?? []) {
      for (const team of div.teams) {
        for (const group of team.groups) {
          for (const part of group.parts) {
            opts.push({
              id: part.id,
              slug: part.slug,
              label: `${div.name} / ${team.name} / ${group.name} / ${part.name}`,
            })
          }
        }
      }
    }
    return opts
  }, [tree])

  const initialMode: Mode = params.get('template') ? 'template' : 'blank'
  const [mode, setMode] = useState<Mode>(initialMode)
  const [templateId, setTemplateId] = useState<string>(params.get('template') ?? '')
  // When the user picks a server (org-published) template we fetch its
  // sections eagerly and stash them here. The bump of `use_count` happens on
  // that GET. On submit we just spread these into the new doc payload.
  const [serverSections, setServerSections] =
    useState<SectionLevel1[] | null>(null)

  const [slug, setSlug] = useState(params.get('slug') ?? '')
  const [title, setTitle] = useState('')
  // 사용자가 slug 를 *직접* 만지면 더 이상 자동으로 덮어쓰지 않음.
  // URL ?slug= 로 들어왔으면 처음부터 dirty 로 간주.
  const [slugDirty, setSlugDirty] = useState(!!params.get('slug'))
  const [partId, setPartId] = useState<string>('')
  const [confidentiality, setConf] = useState<'internal' | 'public' | 'restricted'>('internal')
  const [tags, setTags] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // title 입력 시 slug 자동 채우기 — 사용자가 slug 안 만진 경우만.
  // 빈 title → slug 도 비움 (auto fill 의 자연스러운 reset).
  const onTitleChange = (newTitle: string) => {
    setTitle(newTitle)
    if (!slugDirty) {
      setSlug(newTitle ? slugify(newTitle) : '')
    }
  }

  const onSlugChange = (newSlug: string) => {
    setSlug(newSlug)
    setSlugDirty(true)
  }

  // Default to the first available part once tree loads.
  useEffect(() => {
    if (!partId && partOptions.length > 0) {
      setPartId(partOptions[0]!.id)
    }
  }, [partOptions, partId])

  // When a template is selected pre-fill the title (only if user hasn't typed
  // their own yet) so the form feels like a one-click action. slug 도 자동
  // 갱신 (slugDirty 아닌 경우만, onTitleChange 로 일관 처리).
  const onPickTemplate = (tpl: TemplateDef) => {
    setTemplateId(tpl.id)
    setServerSections(null)
    if (!title.trim()) onTitleChange(tpl.title)
  }

  const onPickServerTemplate = async (tpl: ServerTemplateSummary) => {
    setError(null)
    try {
      // GET bumps use_count on the server. We tag the selection with a
      // `server:<slug>` id so the existing highlight/CTA logic keeps working.
      const full = await getServerTemplate(tpl.slug)
      setTemplateId(`server:${full.slug}`)
      setServerSections(full.sections as SectionLevel1[])
      if (!title.trim()) onTitleChange(full.title)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // Polish D — slug 에 한글 음절(가-힣)도 허용. 백엔드 JSON Schema 와 동일.
  const slugIsValid = /^[a-z0-9가-힣][a-z0-9가-힣-]{0,99}$/.test(slug)
  const titleOk = !!title.trim()
  const canSubmit = slugIsValid && titleOk && !busy

  const create = async () => {
    if (!slugIsValid) {
      setError('slug는 소문자/숫자/하이픈/한글만 가능합니다 (예: monthly-report, 월결산)')
      return
    }
    if (!title.trim()) {
      setError('제목을 입력하세요')
      return
    }
    setBusy(true)
    setError(null)
    try {
      let sections: SectionLevel1[]
      if (mode === 'template' && serverSections) {
        // Re-issue ULIDs on every section + block so two docs from the same
        // server template never share IDs (mirrors `templateToSections`).
        sections = serverSections.map((sec, i) => ({
          ...sec,
          id: ulid(),
          number: String(i + 1),
          blocks: (sec.blocks ?? []).map((b) => ({ ...b, id: ulid() })),
          subsections: [],
        }))
      } else if (mode === 'template' && templateId) {
        const tpl = findTemplate(templateId)
        if (!tpl) {
          setError('선택한 템플릿을 찾을 수 없습니다.')
          setBusy(false)
          return
        }
        sections = templateToSections(tpl)
      } else {
        sections = [
          {
            id: ulid(),
            level: 1,
            number: '1',
            title: '개요',
            blocks: [],
            subsections: [],
          },
        ]
      }
      const doc: DocumentJSONV10 = {
        schema_version: '1.0',
        id: ulid(),
        slug: slug.trim(),
        title: title.trim(),
        summary: '',
        metadata: {
          division: 'MX',
          owners: [user?.id ?? 'admin'],
          tags: tags.slice(),
          confidentiality,
        },
        sections,
      }
      const selected = partOptions.find((p) => p.id === partId)
      if (selected) doc.metadata.part = selected.slug
      await postDocument(doc)
      navigate(`/docs/${encodeURIComponent(slug.trim())}?fullEdit=1`)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message
      if (status === 409) {
        setError(`이미 사용 중인 슬러그입니다: '${slug.trim()}'. 다른 이름을 입력하세요.`)
      } else if (status === 403) {
        setError('이 영역에 문서를 만들 권한이 없습니다. 권한 관리자에게 문의하세요.')
      } else if (status === 422) {
        setError(msg ?? '입력값이 올바르지 않습니다. 슬러그/제목을 다시 확인하세요.')
      } else {
        setError(msg ?? (err as Error).message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6 sm:py-10">
      <header>
        <Stepper steps={['기본 정보', '본문 편집']} current={0} />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-smsg-900 sm:text-3xl">
          새 문서 작성
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          빈 문서로 시작하거나, 미리 만들어진 템플릿을 골라 즉시 본문 편집으로 진입하세요.
        </p>
      </header>

      <div role="tablist" aria-label="문서 시작 방식" className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        <TabButton active={mode === 'blank'} onClick={() => setMode('blank')}>
          빈 문서
        </TabButton>
        <TabButton active={mode === 'template'} onClick={() => setMode('template')}>
          템플릿에서 시작
        </TabButton>
      </div>

      {mode === 'template' && (
        <Card padded="lg" className="space-y-3">
          <p className="text-xs text-gray-500">
            마음에 드는 템플릿을 고르면 제목과 본문이 자동으로 채워집니다. 제목·슬러그는 아래에서 자유롭게 변경 가능합니다.
          </p>
          <TemplateGallery
            onPick={onPickTemplate}
            selectedId={templateId}
            onPickServer={(t) => void onPickServerTemplate(t)}
          />
        </Card>
      )}

      <Card padded="lg" className="space-y-5">
        {/* 제목 먼저 — 사용자가 입력 시 slug 자동 채우기. 의도된 순서 */}
        <Field label="제목" htmlFor="doc-title" required>
          <Input
            id="doc-title"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="예: 월결산 프로세스"
            autoFocus
            invalid={!titleOk && title.length > 0}
          />
        </Field>

        <Field
          label="슬러그 (URL)"
          htmlFor="doc-slug"
          required
          hint={
            slugDirty
              ? '소문자, 숫자, 하이픈, 한글 음절만 사용 가능합니다.'
              : '제목에서 자동 생성됨. 직접 편집하면 그 후엔 자동으로 안 바뀝니다.'
          }
          error={!slugIsValid && slug ? '소문자/숫자/하이픈/한글만 가능합니다' : undefined}
        >
          <Input
            id="doc-slug"
            value={slug}
            onChange={(e) => onSlugChange(e.target.value.toLowerCase())}
            placeholder="monthly-finance-closing"
            prefix={<span className="text-gray-400">/docs/</span>}
            invalid={!!slug && !slugIsValid}
          />
        </Field>

        <Field label="소속 파트" htmlFor="doc-part" hint="왼쪽 트리 어느 위치에 표시될지 결정합니다.">
          <Select id="doc-part" value={partId} onChange={(e) => setPartId(e.target.value)}>
            <option value="">(미지정)</option>
            {partOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </Select>
        </Field>

        <Field label="기밀도" htmlFor="doc-conf">
          <Select id="doc-conf" value={confidentiality} onChange={(e) => setConf(e.target.value as 'internal' | 'public' | 'restricted')}>
            <option value="internal">internal — 사내 공개</option>
            <option value="public">public — 사외 공개 가능</option>
            <option value="restricted">restricted — 지정 인원만</option>
          </Select>
        </Field>

        <Field label="태그" htmlFor="doc-tags" hint="입력 후 Enter 또는 쉼표로 추가 — 기존 태그가 자동완성됩니다.">
          <TagAutocomplete
            id="doc-tags"
            value={tags}
            onChange={setTags}
            placeholder="예: kpi, monthly"
            data-testid="doc-tags-input"
          />
        </Field>

        {error && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse items-stretch justify-end gap-2 pt-2 sm:flex-row sm:items-center">
          <Button variant="outline" onClick={() => navigate(-1)} className="sm:w-auto">취소</Button>
          <Button onClick={() => void create()} disabled={!canSubmit} loading={busy} className="sm:w-auto">
            {mode === 'template' && templateId ? '템플릿으로 생성' : '생성하고 편집 시작'}
          </Button>
        </div>
      </Card>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-smsg-700 text-smsg-900 dark:text-gray-100'
          : 'border-transparent text-gray-500 hover:text-smsg-900 dark:hover:text-gray-100',
      )}
    >
      {children}
    </button>
  )
}

function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 text-xs text-gray-500">
      {steps.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          <span
            className={cn(
              'inline-grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold transition-colors',
              i < current
                ? 'bg-emerald-500 text-white'
                : i === current
                  ? 'bg-smsg-700 text-white'
                  : 'bg-gray-200 text-gray-500',
            )}
          >
            {i + 1}
          </span>
          <span className={cn(i === current ? 'font-semibold text-smsg-900' : '')}>{label}</span>
          {i < steps.length - 1 && <span className="mx-1 h-px w-8 bg-gray-300" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  )
}
