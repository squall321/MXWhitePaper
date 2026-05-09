import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useDeleteSavedView,
  usePatchSavedView,
  useSavedViews,
} from './hooks'
import type { SavedView } from './api'
import { SavedViewCountBadge } from './SavedViewCountBadge'

/**
 * 좌측 레일 "📂 내 보기" 섹션 — AppShell 의 OrgTreeBlock 아래에 마운트된다.
 *
 *   - 사용자의 저장된 뷰를 ordering ASC 순으로 나열.
 *   - 각 항목 = 아이콘 + 이름 + 카운트 배지(throttled 1m).
 *   - 클릭 → /views/:id (디테일 페이지).
 *   - hover 의 ⋯ 버튼 = 수정 / 삭제 / 미리보기 메뉴.
 *   - 드래그(HTML5 native) 로 ordering 재배치 — dnd-kit 미설치 환경을 위해
 *     의존성 없는 native draggable 로 구현. (mandate: "no new deps")
 */
export function SavedViewsList() {
  const { data, isLoading } = useSavedViews()
  const items = data ?? []
  const patch = usePatchSavedView()
  const [draggedId, setDraggedId] = useState<string | null>(null)

  if (isLoading) {
    return (
      <section data-testid="saved-views-section" className="px-3 py-2 text-xs text-gray-400">
        불러오는 중…
      </section>
    )
  }

  const onDragStart = (id: string) => setDraggedId(id)
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }
  const onDrop = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return
    const src = items.find((it) => it.id === draggedId)
    const dst = items.find((it) => it.id === targetId)
    if (!src || !dst) return
    // Simple swap of ordering values — good enough for a per-user rail with
    // ~20 max entries. Heavy reordering would do a full re-index.
    patch.mutate({ id: src.id, body: { ordering: dst.ordering } })
    patch.mutate({ id: dst.id, body: { ordering: src.ordering } })
    setDraggedId(null)
  }

  return (
    <section data-testid="saved-views-section" className="mt-4 border-t border-gray-100 pt-3">
      <h2 className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        <span aria-hidden="true">📂 </span>내 보기
      </h2>
      {items.length === 0 ? (
        <p className="px-3 py-1 text-xs text-gray-400" data-testid="saved-views-empty">
          저장된 뷰가 없습니다
        </p>
      ) : (
        <ul className="space-y-0.5" data-testid="saved-views-list">
          {items.map((view) => (
            <SavedViewRow
              key={view.id}
              view={view}
              onDragStart={() => onDragStart(view.id)}
              onDragOver={onDragOver}
              onDrop={() => onDrop(view.id)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

interface RowProps {
  view: SavedView
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
}

function SavedViewRow({ view, onDragStart, onDragOver, onDrop }: RowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const wrapRef = useRef<HTMLLIElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  return (
    <li
      ref={wrapRef}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenuOpen((v) => !v)
      }}
      data-testid="saved-view-row"
      data-view-id={view.id}
      className="group relative flex items-center gap-2 rounded px-3 py-1 text-sm hover:bg-smsg-50"
    >
      <Link
        to={`/views/${encodeURIComponent(view.id)}`}
        className="flex min-w-0 flex-1 items-center gap-2 hover:no-underline"
      >
        <span aria-hidden="true" className="shrink-0">
          {view.icon || '📂'}
        </span>
        <span className="truncate text-smsg-900">{view.name}</span>
      </Link>
      <SavedViewCountBadge id={view.id} />
      <button
        type="button"
        data-testid="saved-view-menu"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={`${view.name} 메뉴`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="invisible shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 group-hover:visible"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {menuOpen && (
        <SavedViewContextMenu
          view={view}
          onClose={() => setMenuOpen(false)}
          onEdit={() => {
            setEditOpen(true)
            setMenuOpen(false)
          }}
        />
      )}
      {editOpen && (
        <SavedViewEditModal view={view} onClose={() => setEditOpen(false)} />
      )}
    </li>
  )
}

function SavedViewContextMenu({
  view,
  onClose,
  onEdit,
}: {
  view: SavedView
  onClose: () => void
  onEdit: () => void
}) {
  const del = useDeleteSavedView()
  const onDelete = () => {
    if (!window.confirm(`"${view.name}" 뷰를 삭제할까요?`)) return
    del.mutate(view.id, { onSuccess: onClose })
  }
  return (
    <div
      role="menu"
      data-testid="saved-view-context-menu"
      className="absolute right-2 top-full z-popover mt-0.5 w-40 rounded-md border border-gray-200 bg-white py-1 shadow-md"
    >
      <button
        type="button"
        role="menuitem"
        data-testid="saved-view-edit"
        onClick={onEdit}
        className="block w-full px-3 py-1 text-left text-sm hover:bg-smsg-50"
      >
        수정
      </button>
      <Link
        to={`/views/${encodeURIComponent(view.id)}`}
        role="menuitem"
        onClick={onClose}
        className="block px-3 py-1 text-sm hover:bg-smsg-50 hover:no-underline"
      >
        보기 결과 미리보기
      </Link>
      <button
        type="button"
        role="menuitem"
        data-testid="saved-view-delete"
        onClick={onDelete}
        className="block w-full px-3 py-1 text-left text-sm text-red-600 hover:bg-red-50"
      >
        삭제
      </button>
    </div>
  )
}

/**
 * Minimal inline edit modal — name + icon. Filter editing happens on the
 * detail page (`/views/:id`) where the user has more room.
 */
function SavedViewEditModal({
  view,
  onClose,
}: {
  view: SavedView
  onClose: () => void
}) {
  const [name, setName] = useState(view.name)
  const [icon, setIcon] = useState(view.icon ?? '📂')
  const patch = usePatchSavedView()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    patch.mutate(
      { id: view.id, body: { name: trimmed, icon: icon || null } },
      { onSuccess: onClose },
    )
  }

  return (
    <div
      role="dialog"
      aria-label="저장된 뷰 수정"
      data-testid="saved-view-edit-dialog"
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="w-80 rounded-md bg-white p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 text-sm font-semibold">저장된 뷰 수정</h3>
        <label className="mb-2 block text-xs text-gray-700">
          <span className="mb-0.5 block font-semibold">이름</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            data-testid="saved-view-edit-name"
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        <label className="mb-3 block text-xs text-gray-700">
          <span className="mb-0.5 block font-semibold">아이콘</span>
          <input
            type="text"
            value={icon}
            onChange={(e) => setIcon(e.target.value.slice(0, 4))}
            maxLength={4}
            data-testid="saved-view-edit-icon"
            className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-base"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!name.trim() || patch.isPending}
            data-testid="saved-view-edit-save"
            className="rounded bg-smsg-700 px-3 py-1 text-xs font-semibold text-white hover:bg-smsg-900 disabled:opacity-60"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  )
}
