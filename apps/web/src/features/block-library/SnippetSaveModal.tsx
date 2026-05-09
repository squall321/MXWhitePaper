import { useState } from 'react'
import type { Block } from '@/types/document'
import { TagAutocomplete } from '@/features/tags/TagAutocomplete'
import { createSnippet, type SnippetScope } from './api'

/**
 * 선택된 블록 N개를 이름/설명/스코프/태그와 함께 저장하는 작은 모달.
 *
 * - BulkActionsBar 의 "📚 스니펫으로 저장" 버튼 또는 SnippetSaveButton 에서 호출.
 * - 저장 성공 시 onSaved(snippet_id) 를 호출하고 자동으로 모달을 닫는다.
 */
export interface SnippetSaveModalProps {
  blocks: Block[]
  onClose: () => void
  onSaved?: (snippetId: string) => void
}

export function SnippetSaveModal({ blocks, onClose, onSaved }: SnippetSaveModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<SnippetScope>('private')
  const [tags, setTags] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSave() {
    if (!name.trim()) {
      setErr('이름을 입력해주세요.')
      return
    }
    if (blocks.length === 0) {
      setErr('저장할 블록이 없습니다.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const result = await createSnippet({
        name: name.trim(),
        description: description.trim() || undefined,
        blocks,
        scope,
        tags,
      })
      onSaved?.(result.snippet_id)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '저장에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="스니펫으로 저장"
      data-testid="snippet-save-modal"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-24"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-lg rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
        <header className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-smsg-900 dark:text-smsg-100">
            📚 스니펫으로 저장
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {blocks.length}개 블록을 라이브러리에 저장합니다.
          </p>
        </header>
        <div className="space-y-3 px-4 py-3">
          <div>
            <label
              htmlFor="snippet-name"
              className="block text-xs font-medium text-gray-700 dark:text-gray-200"
            >
              이름
            </label>
            <input
              id="snippet-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 월말 결산 보고 서두"
              maxLength={200}
              autoFocus
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-smsg-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
              data-testid="snippet-save-name"
            />
          </div>
          <div>
            <label
              htmlFor="snippet-description"
              className="block text-xs font-medium text-gray-700 dark:text-gray-200"
            >
              설명 (선택)
            </label>
            <textarea
              id="snippet-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="언제 사용하는 스니펫인지 짧게 설명해보세요."
              maxLength={2000}
              rows={2}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-smsg-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
              data-testid="snippet-save-description"
            />
          </div>
          <fieldset>
            <legend className="block text-xs font-medium text-gray-700 dark:text-gray-200">
              공유 범위
            </legend>
            <div className="mt-1 flex gap-3 text-xs text-gray-700 dark:text-gray-200">
              {(['private', 'team', 'org'] as const).map((opt) => (
                <label key={opt} className="inline-flex items-center gap-1">
                  <input
                    type="radio"
                    name="snippet-scope"
                    value={opt}
                    checked={scope === opt}
                    onChange={() => setScope(opt)}
                    data-testid={`snippet-save-scope-${opt}`}
                  />
                  {opt === 'private' ? '나만 보기' : opt === 'team' ? '팀' : '조직 전체'}
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-200">
              태그
            </label>
            <div className="mt-1">
              <TagAutocomplete
                value={tags}
                onChange={setTags}
                placeholder="태그 입력 후 Enter"
                data-testid="snippet-save-tags"
              />
            </div>
          </div>
          {err && (
            <p
              role="alert"
              className="rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-200"
            >
              {err}
            </p>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            data-testid="snippet-save-cancel"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy || !name.trim()}
            className="rounded bg-smsg-700 px-3 py-1 text-xs font-medium text-white hover:bg-smsg-800 disabled:opacity-50"
            data-testid="snippet-save-submit"
          >
            {busy ? '저장 중…' : '저장'}
          </button>
        </footer>
      </div>
    </div>
  )
}
