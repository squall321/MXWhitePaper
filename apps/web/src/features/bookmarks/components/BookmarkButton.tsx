import { useEffect, useRef, useState } from 'react'
import {
  useBookmarkBySlug,
  useBookmarkFolders,
  useCreateBookmark,
  useDeleteBookmark,
  usePatchBookmark,
} from '../hooks/useBookmarks'

interface BookmarkButtonProps {
  slug: string
  title: string
  size?: 'sm' | 'md'
  className?: string
}

/**
 * 서버 영속 책갈피 토글 + 폴더/메모 드롭다운.
 *
 *   - 좌클릭 = on/off 토글
 *   - 우클릭 또는 ⋯ 호버 메뉴 = 폴더/메모 picker 열기
 *
 * `즐겨찾기 (FavoriteStar)` 와 함께 노출되며, 두 기능은 의도적으로 공존한다.
 * favorites = 로컬 스토리지 빠른 토글, bookmarks = 서버 영속 + 폴더 + 메모.
 */
export function BookmarkButton({ slug, title, size = 'md', className }: BookmarkButtonProps) {
  const { bookmark, isBookmarked } = useBookmarkBySlug(slug)
  const create = useCreateBookmark()
  const del = useDeleteBookmark()
  const patch = usePatchBookmark()
  const [pickerOpen, setPickerOpen] = useState(false)
  const dim = size === 'sm' ? 14 : 18
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // close picker on outside click / Escape
  useEffect(() => {
    if (!pickerOpen) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [pickerOpen])

  const onToggle = () => {
    if (isBookmarked && bookmark) {
      del.mutate(bookmark.id)
    } else {
      create.mutate({ document_id: slug })
    }
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!isBookmarked) {
      // First add the bookmark, then open the picker once it lands.
      create.mutate({ document_id: slug }, { onSuccess: () => setPickerOpen(true) })
    } else {
      setPickerOpen((v) => !v)
    }
  }

  return (
    <div ref={wrapRef} className={`relative inline-flex items-center ${className ?? ''}`}>
      <button
        type="button"
        aria-pressed={isBookmarked}
        aria-label={isBookmarked ? `${title} 책갈피 해제` : `${title} 책갈피 추가`}
        data-testid="bookmark-button"
        data-slug={slug}
        onClick={onToggle}
        onContextMenu={onContextMenu}
        title={isBookmarked ? '책갈피 (우클릭: 폴더/메모)' : '책갈피'}
        className={[
          'inline-grid place-items-center rounded transition-colors duration-fast',
          size === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
          isBookmarked
            ? 'text-smsg-700 hover:text-smsg-900'
            : 'text-gray-300 hover:text-smsg-700',
        ].join(' ')}
      >
        {isBookmarked ? (
          <svg width={dim} height={dim} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M5 3h10a1 1 0 011 1v14l-6-3.5L4 18V4a1 1 0 011-1z" />
          </svg>
        ) : (
          <svg width={dim} height={dim} viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M5 3h10a1 1 0 011 1v14l-6-3.5L4 18V4a1 1 0 011-1z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      <button
        type="button"
        aria-label="책갈피 옵션"
        data-testid="bookmark-options"
        onClick={(e) => {
          e.preventDefault()
          if (!isBookmarked) {
            create.mutate({ document_id: slug }, { onSuccess: () => setPickerOpen(true) })
          } else {
            setPickerOpen((v) => !v)
          }
        }}
        className="ml-0.5 hidden h-7 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-50 hover:text-smsg-700 group-hover:flex"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
          <circle cx="8" cy="8" r="1.2" fill="currentColor" />
          <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
        </svg>
      </button>

      {pickerOpen && bookmark && (
        <BookmarkFolderPicker
          bookmarkId={bookmark.id}
          currentFolder={bookmark.folder}
          currentNotes={bookmark.notes}
          onClose={() => setPickerOpen(false)}
          onPatch={(body) => patch.mutate({ id: bookmark.id, body })}
        />
      )}
    </div>
  )
}

interface BookmarkFolderPickerProps {
  bookmarkId: string
  currentFolder: string | null
  currentNotes: string | null
  onClose: () => void
  onPatch: (body: { folder?: string | null; notes?: string | null }) => void
}

function BookmarkFolderPicker({
  bookmarkId: _bookmarkId,
  currentFolder,
  currentNotes,
  onClose,
  onPatch,
}: BookmarkFolderPickerProps) {
  const folders = useBookmarkFolders()
  const [newFolder, setNewFolder] = useState('')
  const [notes, setNotes] = useState(currentNotes ?? '')

  const folderItems = (folders.data ?? []).filter((f) => f.folder !== null)

  return (
    <div
      role="dialog"
      aria-label="책갈피 폴더/메모 선택"
      data-testid="bookmark-folder-picker"
      className="absolute right-0 top-full z-popover mt-1 w-64 rounded-md border border-gray-200 bg-white p-2 shadow-md"
    >
      <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        폴더
      </p>
      <ul className="max-h-40 overflow-y-auto py-1">
        <li>
          <button
            type="button"
            onClick={() => onPatch({ folder: null })}
            className={[
              'block w-full rounded px-2 py-1 text-left text-sm hover:bg-smsg-50',
              currentFolder === null ? 'bg-smsg-50 text-smsg-700' : 'text-gray-700',
            ].join(' ')}
          >
            기본 (폴더 없음)
          </button>
        </li>
        {folderItems.map((f) => (
          <li key={f.folder ?? '__null__'}>
            <button
              type="button"
              onClick={() => onPatch({ folder: f.folder })}
              className={[
                'block w-full rounded px-2 py-1 text-left text-sm hover:bg-smsg-50',
                currentFolder === f.folder ? 'bg-smsg-50 text-smsg-700' : 'text-gray-700',
              ].join(' ')}
            >
              <span>{f.folder}</span>
              <span className="ml-2 text-[11px] text-gray-400">{f.count}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-gray-100 pt-1.5">
        <label className="flex items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          + 새 폴더
        </label>
        <form
          className="flex gap-1 px-2 pb-1.5 pt-0.5"
          onSubmit={(e) => {
            e.preventDefault()
            const v = newFolder.trim()
            if (!v) return
            onPatch({ folder: v })
            setNewFolder('')
          }}
        >
          <input
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            placeholder="폴더 이름"
            maxLength={120}
            className="min-w-0 flex-1 rounded border border-gray-200 px-1.5 py-1 text-xs"
          />
          <button
            type="submit"
            disabled={!newFolder.trim()}
            className="rounded bg-smsg-700 px-2 py-1 text-xs font-semibold text-white hover:bg-smsg-900 disabled:opacity-40"
          >
            추가
          </button>
        </form>
      </div>
      <div className="border-t border-gray-100 px-2 pt-1.5">
        <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          메모
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={2000}
          className="mt-1 block w-full resize-none rounded border border-gray-200 px-1.5 py-1 text-xs"
        />
        <div className="mt-1 flex justify-end gap-1 pb-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            닫기
          </button>
          <button
            type="button"
            onClick={() => {
              const v = notes.trim()
              onPatch({ notes: v ? v : null })
              onClose()
            }}
            className="rounded bg-smsg-700 px-2 py-1 text-xs font-semibold text-white hover:bg-smsg-900"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  )
}
