import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { ApiError } from '@/lib/api/envelope'
import {
  listDomains,
  proposeGlossaryTerm,
  type GlossaryDomain,
  type GlossaryTerm,
  type ProposeTermInput,
} from '../api'

/**
 * Hard maxima mirror the BE schema (`TermProposeIn`): term ≤ 200,
 * definition ≤ 5000, term_en ≤ 200, subdomain ≤ 100, aliases ≤ 20 items.
 * We surface them as counter hints rather than hard cutoffs in the input
 * (`maxLength`) so a paste that's slightly over the limit doesn't silently
 * truncate user content — the validator below catches the overflow.
 */
const MAX = {
  term: 200,
  definition: 5000,
  subdomain: 100,
  termEn: 200,
  alias: 100,
  aliasCount: 20,
} as const

export interface ProposeTermModalProps {
  /** Controlled open state. */
  open: boolean
  /** Pre-fill the `term` input — used by the wiki redlink hook. */
  initialTerm?: string
  /** Pre-select a domain (slug). Falls back to first domain in the list. */
  initialDomain?: string | null
  /** Backdrop / Esc / Cancel — caller decides what to do (usually unmount). */
  onClose: () => void
  /** Fired after a successful POST. Caller can navigate / refresh other lists. */
  onSuccess?: (created: GlossaryTerm) => void
}

interface DuplicateInfo {
  existingId: string
  existingStatus: string
}

/**
 * 용어 제안 모달 (FR-01).
 *
 * Two entry points share this modal:
 *   1. `/glossary` 페이지의 "용어 제안" 버튼
 *   2. 본문의 `[[미등록용어]]` redlink 길게-누르기 (WikiLink.tsx)
 *
 * Submits to `POST /api/v1/glossary/propose`. On success: toast + invalidate
 * the `['glossary']` / `['glossary-pending']` queries + close. On 409 CONFLICT
 * (duplicate (term, domain)) we show an inline error with a link to the
 * existing proposal so the user can vote / amend instead of double-filing.
 *
 * Keyboard: Esc closes, Cmd/Ctrl + Enter submits. The shared `Modal`
 * primitive already implements focus trap + Esc + backdrop click + restore
 * focus on close.
 */
export function ProposeTermModal({
  open,
  initialTerm,
  initialDomain,
  onClose,
  onSuccess,
}: ProposeTermModalProps) {
  const qc = useQueryClient()
  const domainsQuery = useQuery<GlossaryDomain[]>({
    queryKey: ['glossary-domains'],
    queryFn: listDomains,
    staleTime: 5 * 60_000,
    // Only fetch while the modal is open — the domain master is otherwise
    // unused on most pages.
    enabled: open,
  })

  // Initial state uses `initialTerm` directly so SSR (and the first paint
  // after the modal mounts) already shows the pre-filled value — useEffect
  // resets are reserved for the *re-open* case, where the user has closed
  // the modal and re-opened it with possibly different inputs.
  const [term, setTerm] = useState(initialTerm ?? '')
  const [definition, setDefinition] = useState('')
  const [domain, setDomain] = useState<string>(initialDomain ?? '')
  const [subdomain, setSubdomain] = useState('')
  const [termEn, setTermEn] = useState('')
  const [aliasesRaw, setAliasesRaw] = useState('')
  const [touched, setTouched] = useState(false)
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Reset whenever the modal re-opens so a previous draft doesn't bleed in.
  // We deliberately key off `open` (not `initialTerm`) — re-renders that
  // change `initialTerm` while the modal is already open shouldn't blow
  // away whatever the user has typed.
  useEffect(() => {
    if (!open) return
    setTerm(initialTerm ?? '')
    setDefinition('')
    setSubdomain('')
    setTermEn('')
    setAliasesRaw('')
    setTouched(false)
    setDuplicate(null)
    setSubmitError(null)
    // Domain default: prefer `initialDomain`, fall back to '' (placeholder).
    setDomain(initialDomain ?? '')
  }, [open, initialTerm, initialDomain])

  // If the BE returned domains *after* we opened, auto-pick the first one
  // when no domain has been chosen yet — saves a click without overwriting
  // an explicit selection.
  useEffect(() => {
    if (!open) return
    if (domain) return
    const items = domainsQuery.data ?? []
    if (items.length === 0) return
    if (initialDomain && items.some((d) => d.slug === initialDomain)) {
      setDomain(initialDomain)
    } else {
      setDomain(items[0]?.slug ?? '')
    }
  }, [open, domain, domainsQuery.data, initialDomain])

  const aliases = useMemo(() => parseAliases(aliasesRaw), [aliasesRaw])

  const termTrim = term.trim()
  const defTrim = definition.trim()
  const errors: Record<string, string> = {}
  if (!termTrim) errors.term = '용어를 입력해 주세요.'
  else if (termTrim.length > MAX.term)
    errors.term = `최대 ${MAX.term}자까지 가능합니다.`
  if (!defTrim) errors.definition = '정의를 입력해 주세요.'
  else if (defTrim.length > MAX.definition)
    errors.definition = `최대 ${MAX.definition}자까지 가능합니다.`
  if (subdomain.length > MAX.subdomain)
    errors.subdomain = `최대 ${MAX.subdomain}자까지 가능합니다.`
  if (termEn.length > MAX.termEn)
    errors.term_en = `최대 ${MAX.termEn}자까지 가능합니다.`
  if (aliases.length > MAX.aliasCount)
    errors.aliases = `alias 는 최대 ${MAX.aliasCount}개까지 가능합니다.`
  else if (aliases.some((a) => a.length > MAX.alias))
    errors.aliases = `alias 각 항목은 최대 ${MAX.alias}자입니다.`

  const hasErrors = Object.keys(errors).length > 0

  const proposeMutation = useMutation({
    mutationFn: (input: ProposeTermInput) => proposeGlossaryTerm(input),
    onSuccess: (created) => {
      // Invalidate every glossary-keyed query so the new row appears in
      // /glossary, the admin pending queue, and the tooltip lookup map.
      void qc.invalidateQueries({ queryKey: ['glossary'] })
      void qc.invalidateQueries({ queryKey: ['glossary-pending'] })
      toast.success('제안 등록됨. admin 승인 대기')
      onSuccess?.(created)
      onClose()
    },
    onError: (err) => {
      // 409 CONFLICT from `propose_term()` carries `details = {existing_id,
      // existing_status}`. Surface it inline with a link to the existing row.
      if (err instanceof ApiError && err.status === 409) {
        const det = err.details as
          | { existing_id?: string; existing_status?: string }
          | undefined
        if (det?.existing_id) {
          setDuplicate({
            existingId: det.existing_id,
            existingStatus: det.existing_status ?? 'proposed',
          })
          setSubmitError(null)
          return
        }
      }
      setSubmitError(
        err instanceof Error ? err.message : '제안 등록에 실패했습니다.',
      )
    },
  })

  const submit = useCallback(() => {
    setTouched(true)
    setSubmitError(null)
    setDuplicate(null)
    if (hasErrors || proposeMutation.isPending) return
    proposeMutation.mutate({
      term: termTrim,
      definition: defTrim,
      domain: domain || null,
      subdomain: subdomain.trim() || null,
      term_en: termEn.trim() || null,
      aliases,
    })
  }, [
    hasErrors,
    proposeMutation,
    termTrim,
    defTrim,
    domain,
    subdomain,
    termEn,
    aliases,
  ])

  const onTextareaKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        submit()
      }
    },
    [submit],
  )

  // Same Cmd/Ctrl+Enter shortcut on text inputs — paste-and-submit flow.
  const onInputKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        submit()
      }
    },
    [submit],
  )

  // Auto-focus the first empty field. Behaves like a re-entry helper when
  // `initialTerm` is pre-filled (redlink flow) — the user lands on
  // `definition` directly.
  const definitionRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!open) return
    if (!initialTerm) return
    const r = requestAnimationFrame(() => definitionRef.current?.focus())
    return () => cancelAnimationFrame(r)
  }, [open, initialTerm])

  const domains = domainsQuery.data ?? []
  const showDomainError = touched && domains.length > 0 && !domain
  const showTermError = touched && Boolean(errors.term)
  const showDefError = touched && Boolean(errors.definition)
  const showSubmitErrors = touched && hasErrors

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="용어 제안"
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-gray-500">
            단축키: <kbd className="rounded bg-gray-100 px-1">Esc</kbd> 닫기 ·{' '}
            <kbd className="rounded bg-gray-100 px-1">⌘/Ctrl + Enter</kbd> 제출
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={onClose}
              data-testid="propose-cancel"
            >
              취소
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={proposeMutation.isPending}
              loading={proposeMutation.isPending}
              data-testid="propose-submit"
            >
              제안 등록
            </Button>
          </div>
        </div>
      }
    >
      <div
        className="space-y-4 p-5"
        data-testid="propose-term-modal"
      >
        <p className="text-xs text-gray-500">
          제안된 용어는 admin 승인 후 검색/툴팁에 반영됩니다. 같은 분야에 동일
          용어가 이미 있으면 등록되지 않습니다.
        </p>

        <Field
          label="용어"
          required
          error={showTermError ? errors.term : undefined}
          hint={`${termTrim.length} / ${MAX.term}`}
        >
          <Input
            value={term}
            onChange={(e) => {
              setTerm(e.target.value)
              setDuplicate(null)
            }}
            onBlur={() => setTouched(true)}
            onKeyDown={onInputKeyDown}
            placeholder="예: 다공성 매질"
            aria-label="용어"
            aria-required="true"
            aria-invalid={showTermError || undefined}
            data-testid="propose-term-input"
            autoFocus={!initialTerm}
          />
        </Field>

        <Field
          label="정의"
          required
          error={showDefError ? errors.definition : undefined}
          hint={`${defTrim.length} / ${MAX.definition}`}
        >
          <Textarea
            ref={definitionRef}
            value={definition}
            onChange={(e) => setDefinition(e.target.value)}
            onBlur={() => setTouched(true)}
            onKeyDown={onTextareaKeyDown}
            rows={4}
            placeholder="용어의 정의를 한두 문장으로 설명하세요."
            aria-label="정의"
            aria-required="true"
            aria-invalid={showDefError || undefined}
            data-testid="propose-definition-input"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="분야 (domain)"
            required={domains.length > 0}
            error={showDomainError ? '분야를 선택해 주세요.' : undefined}
            hint={
              domainsQuery.isPending
                ? '분야 목록 불러오는 중…'
                : domains.length === 0
                  ? '등록된 분야가 없습니다. admin 에게 요청해 주세요.'
                  : undefined
            }
          >
            <Select
              value={domain}
              onChange={(e) => {
                setDomain(e.target.value)
                setDuplicate(null)
              }}
              aria-label="분야"
              aria-required={domains.length > 0 || undefined}
              aria-invalid={showDomainError || undefined}
              data-testid="propose-domain-select"
              disabled={domains.length === 0 || domainsQuery.isPending}
            >
              <option value="">— 선택 —</option>
              {domains.map((d) => (
                <option key={d.id} value={d.slug}>
                  {d.name} ({d.slug})
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="하위 분야 (subdomain)"
            hint="선택 — 자유 입력"
            error={errors.subdomain}
          >
            <Input
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="예: 다공성-유체"
              aria-label="하위 분야"
              data-testid="propose-subdomain-input"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="영문 표기 (term_en)" hint="선택" error={errors.term_en}>
            <Input
              value={termEn}
              onChange={(e) => setTermEn(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="예: Porous Media"
              aria-label="영문 표기"
              data-testid="propose-term-en-input"
            />
          </Field>

          <Field
            label="별칭 (aliases)"
            hint={`쉼표(,)로 구분 · 현재 ${aliases.length}개`}
            error={errors.aliases}
          >
            <Input
              value={aliasesRaw}
              onChange={(e) => setAliasesRaw(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="예: porous-media, 다공성 물질"
              aria-label="별칭"
              data-testid="propose-aliases-input"
            />
          </Field>
        </div>

        {duplicate && (
          <div
            role="alert"
            className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
            data-testid="propose-duplicate"
          >
            <strong>이미 제안되어 있습니다</strong>{' '}
            <span className="text-amber-700">
              (상태: {duplicate.existingStatus})
            </span>{' '}
            —{' '}
            <a
              href={`/glossary?focus=${encodeURIComponent(duplicate.existingId)}`}
              className="underline hover:text-amber-700"
              data-testid="propose-duplicate-link"
            >
              기존 제안 보기
            </a>
          </div>
        )}

        {submitError && !duplicate && (
          <p
            role="alert"
            className="rounded bg-red-50 px-3 py-2 text-xs text-red-700"
            data-testid="propose-submit-error"
          >
            {submitError}
          </p>
        )}

        {showSubmitErrors && !duplicate && !submitError && (
          <p
            role="alert"
            className="text-[11px] text-red-600"
            data-testid="propose-validation-error"
          >
            누락된 필드가 있습니다. 빨간 표시를 확인해 주세요.
          </p>
        )}
      </div>
    </Modal>
  )
}

/**
 * Split the comma-separated aliases input into a clean string[]. Trims
 * whitespace, drops empties, deduplicates while preserving entry order so
 * the user sees the same order they typed.
 */
function parseAliases(raw: string): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(',')) {
    const t = part.trim()
    if (!t) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

export const PROPOSE_TERM_MAX = MAX
