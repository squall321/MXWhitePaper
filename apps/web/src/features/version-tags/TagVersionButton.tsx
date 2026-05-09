import { useEffect, useRef, useState } from 'react'
import { useCreateVersionTag } from './hooks'

interface TagVersionButtonProps {
  /** Document slug — passed straight through to POST .../tags. */
  slug: string
  /** The numeric version this button is attached to. */
  version: number
  className?: string
}

/**
 * "🏷 태그 추가" — opens an inline modal that POSTs a new version_tags row
 * and triggers a react-query invalidation so neighboring badges refresh.
 *
 * Mounted next to each row in `VersionHistoryPanel`. Editor-only (the BE
 * gates with `require_editor`); reader callers receive a 403 toast and the
 * dialog stays open so they can dismiss.
 */
export function TagVersionButton({
  slug,
  version,
  className,
}: TagVersionButtonProps) {
  const create = useCreateVersionTag(slug)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isLocked, setIsLocked] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setErr(null)
    create.mutate(
      {
        version,
        body: {
          tag_name: trimmed,
          description: description.trim() || null,
          is_locked: isLocked,
        },
      },
      {
        onSuccess: () => {
          setOpen(false)
          setName('')
          setDescription('')
          setIsLocked(false)
        },
        onError: (e) => {
          setErr((e as Error).message ?? '태그 생성 실패')
        },
      },
    )
  }

  return (
    <div
      data-testid="tag-version-button"
      data-version={version}
      className={`relative inline-flex items-center ${className ?? ''}`}
    >
      <button
        type="button"
        data-testid="tag-version-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`v${version} 에 태그 추가`}
        className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 transition-colors duration-fast hover:border-smsg-700 hover:text-smsg-700"
      >
        <span aria-hidden="true">🏷</span>
        <span>태그 추가</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="버전 태그 만들기"
          data-testid="tag-version-dialog"
          className="absolute right-0 top-full z-popover mt-1 w-72 rounded-md border border-gray-200 bg-white p-3 shadow-md"
        >
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            v{version} 에 태그 붙이기
          </p>
          <label className="mb-2 block text-xs text-gray-700">
            <span className="mb-0.5 block font-semibold">태그 이름</span>
            <input
              ref={inputRef}
              type="text"
              data-testid="tag-version-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: v1.0 release / RC1"
              maxLength={80}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <label className="mb-2 block text-xs text-gray-700">
            <span className="mb-0.5 block font-semibold">설명 (선택)</span>
            <textarea
              data-testid="tag-version-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={2}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs"
            />
          </label>
          <label className="mb-3 inline-flex items-center gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              data-testid="tag-version-locked"
              checked={isLocked}
              onChange={(e) => setIsLocked(e.target.checked)}
            />
            <span>잠금 (admin 만 삭제 가능)</span>
          </label>
          {err && (
            <p className="mb-2 text-[11px] text-red-600" data-testid="tag-version-error">
              {err}
            </p>
          )}
          <div className="flex justify-end gap-1">
            <button
              type="button"
              data-testid="tag-version-cancel"
              onClick={() => setOpen(false)}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
            >
              취소
            </button>
            <button
              type="button"
              data-testid="tag-version-submit"
              onClick={submit}
              disabled={!name.trim() || create.isPending}
              className="rounded bg-smsg-700 px-2 py-1 text-xs font-semibold text-white hover:bg-smsg-900 disabled:opacity-40"
            >
              {create.isPending ? '저장 중…' : '태그 만들기'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
