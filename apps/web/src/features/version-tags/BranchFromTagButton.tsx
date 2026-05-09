import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBranchFromTag, useVersionTags } from './hooks'

interface BranchFromTagButtonProps {
  /** Source document slug. */
  slug: string
  className?: string
}

/**
 * "🌿 분기 만들기" — opens a modal that lets the user pick one of the doc's
 * named tags + type a new doc slug, then POSTs branch-from-tag and
 * navigates the SPA to the freshly minted document on success.
 *
 * Mounted on the version diff page next to the version selector.
 */
export function BranchFromTagButton({
  slug,
  className,
}: BranchFromTagButtonProps) {
  const tagsQ = useVersionTags(slug)
  const branch = useBranchFromTag(slug)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [tagName, setTagName] = useState('')
  const [target, setTarget] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const slugRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    slugRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Pre-select the first available tag whenever the list arrives.
  useEffect(() => {
    const first = tagsQ.data?.[0]
    if (first && !tagName) {
      setTagName(first.tag_name)
    }
  }, [tagsQ.data, tagName])

  const submit = () => {
    const t = target.trim()
    const tn = tagName.trim()
    if (!t || !tn) return
    setErr(null)
    branch.mutate(
      { tag_name: tn, target_slug: t },
      {
        onSuccess: (r) => {
          setOpen(false)
          setTarget('')
          navigate(`/docs/${encodeURIComponent(r.slug)}`)
        },
        onError: (e) => {
          setErr((e as Error).message ?? '분기 실패')
        },
      },
    )
  }

  const tags = tagsQ.data ?? []
  const noTags = !tagsQ.isPending && tags.length === 0

  return (
    <div
      data-testid="branch-from-tag-button"
      className={`relative inline-flex items-center ${className ?? ''}`}
    >
      <button
        type="button"
        data-testid="branch-from-tag-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="태그된 버전에서 새 문서로 분기"
        className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:border-smsg-700 hover:text-smsg-700"
      >
        <span aria-hidden="true">🌿</span>
        <span>분기 만들기</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="태그에서 분기"
          data-testid="branch-from-tag-dialog"
          className="absolute right-0 top-full z-popover mt-1 w-80 rounded-md border border-gray-200 bg-white p-3 shadow-md"
        >
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            태그된 버전에서 새 문서 만들기
          </p>
          {noTags ? (
            <p className="mb-2 text-xs text-gray-600">
              먼저 버전 패널에서 태그를 추가해 주세요.
            </p>
          ) : (
            <label className="mb-2 block text-xs text-gray-700">
              <span className="mb-0.5 block font-semibold">소스 태그</span>
              <select
                data-testid="branch-from-tag-select"
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm"
              >
                {tags.map((t) => (
                  <option key={t.id} value={t.tag_name}>
                    {t.tag_name} (v{t.version})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="mb-3 block text-xs text-gray-700">
            <span className="mb-0.5 block font-semibold">새 문서 slug</span>
            <input
              ref={slugRef}
              type="text"
              data-testid="branch-from-tag-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="예: month-end-closing-v1-1"
              maxLength={200}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          {err && (
            <p className="mb-2 text-[11px] text-red-600" data-testid="branch-from-tag-error">
              {err}
            </p>
          )}
          <div className="flex justify-end gap-1">
            <button
              type="button"
              data-testid="branch-from-tag-cancel"
              onClick={() => setOpen(false)}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="button"
              data-testid="branch-from-tag-submit"
              onClick={submit}
              disabled={
                noTags || !target.trim() || !tagName.trim() || branch.isPending
              }
              className="rounded bg-smsg-700 px-2 py-1 text-xs font-semibold text-white hover:bg-smsg-900 disabled:opacity-40"
            >
              {branch.isPending ? '분기 중…' : '분기 만들기'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
