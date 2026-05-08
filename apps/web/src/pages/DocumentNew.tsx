import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import type { DocumentJSONV10 } from '@/types/document'
import { ulid } from '@/features/editor/ulid'
import { postDocument } from '@/features/editor/api'
import { useOrgTree } from '@/features/org/hooks/useOrgTree'
import { useAuthStore } from '@/features/auth/store'
import { Button, Card, Field, Input, Select, cn } from '@/components/ui'
import type { AppOutletContext } from '@/App'

/**
 * 새 문서 생성 마법사 — 슬러그 + 제목 + 소속 파트 + 기밀도.
 *
 * Visual: stepper at the top (1 정보 → 2 게시), restyled fields using the new
 * primitives. Form is a single screen but the stepper hints the next stage
 * is the full editor.
 */
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

  const [slug, setSlug] = useState(params.get('slug') ?? '')
  const [title, setTitle] = useState('')
  const [partId, setPartId] = useState<string>('')
  const [confidentiality, setConf] = useState<'internal' | 'public' | 'restricted'>('internal')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Default to the first available part once tree loads.
  useEffect(() => {
    if (!partId && partOptions.length > 0) {
      setPartId(partOptions[0]!.id)
    }
  }, [partOptions, partId])

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
      const doc: DocumentJSONV10 = {
        schema_version: '1.0',
        id: ulid(),
        slug: slug.trim(),
        title: title.trim(),
        summary: '',
        metadata: {
          division: 'MX',
          owners: [user?.id ?? 'admin'],
          tags: [],
          confidentiality,
        },
        sections: [
          {
            id: ulid(),
            level: 1,
            number: '1',
            title: '개요',
            blocks: [],
            subsections: [],
          },
        ],
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
    <div className="mx-auto max-w-2xl space-y-6 py-6 sm:py-10">
      <header>
        <Stepper steps={['기본 정보', '본문 편집']} current={0} />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-smsg-900 sm:text-3xl">
          새 문서 작성
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          기본 정보를 입력하면 즉시 편집 모드로 진입합니다. 본문은 다음 화면의 BlockNote
          편집기에서 작성하세요.
        </p>
      </header>

      <Card padded="lg" className="space-y-5">
        <Field
          label="슬러그 (URL)"
          htmlFor="doc-slug"
          required
          hint="소문자, 숫자, 하이픈, 한글 음절을 사용할 수 있습니다."
          error={!slugIsValid && slug ? '소문자/숫자/하이픈/한글만 가능합니다' : undefined}
        >
          <Input
            id="doc-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="monthly-finance-closing"
            prefix={<span className="text-gray-400">/docs/</span>}
            invalid={!!slug && !slugIsValid}
          />
        </Field>

        <Field label="제목" htmlFor="doc-title" required>
          <Input
            id="doc-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 월결산 프로세스"
            autoFocus
            invalid={!titleOk && title.length > 0}
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

        {error && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse items-stretch justify-end gap-2 pt-2 sm:flex-row sm:items-center">
          <Button variant="outline" onClick={() => navigate(-1)} className="sm:w-auto">취소</Button>
          <Button onClick={() => void create()} disabled={!canSubmit} loading={busy} className="sm:w-auto">
            생성하고 편집 시작
          </Button>
        </div>
      </Card>
    </div>
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
