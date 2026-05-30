import { useRef, useState, type ChangeEvent } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { GalleryBlock, Slug } from '@/types/document'
import { useImage } from '@/features/upload/hooks/useImage'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import {
  ImageDropzone,
  type ImageDropzoneHandle,
} from '@/features/upload/components/ImageDropzone'
import { useT } from '@/lib/i18n'

interface GalleryBlockEditorProps {
  slug: Slug
  block: GalleryBlock
}

type GalleryItem = GalleryBlock['items'][number]

/**
 * Editable gallery. Each tile can be reordered (drag handle), gets its own
 * caption input, and the `+ 추가` button appends more images via the shared
 * dropzone.
 */
export function GalleryBlockEditor({ slug, block }: GalleryBlockEditorProps) {
  const t = useT()
  const etag = useEditorStore((s) => s.etag)
  const applySnapshot = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dropzoneRef = useRef<ImageDropzoneHandle>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const persist = async (
    items: GalleryItem[],
    layout?: GalleryBlock['layout'],
  ) => {
    if (!etag) return
    if (items.length < 1) return // schema says minItems = 1
    setBusy(true)
    setError(null)
    try {
      const result = await patchBlock(
        slug,
        block.id,
        {
          items: items as GalleryBlock['items'],
          layout: layout ?? block.layout,
        },
        etag,
        t('editor.gallery.changeLog'),
      )
      applySnapshot(result.document, result.etag)
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setConflict(null)
        setError(t('editor.common.conflict'))
      } else {
        setError((err as Error).message)
      }
    } finally {
      setBusy(false)
    }
  }

  const onLayout = (layout: GalleryBlock['layout']) => {
    void persist(block.items as GalleryItem[], layout)
  }

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = block.items.map((it) => it.imageId)
    const from = ids.indexOf(active.id as string)
    const to = ids.indexOf(over.id as string)
    if (from < 0 || to < 0) return
    const next = arrayMove(block.items as GalleryItem[], from, to)
    void persist(next)
  }

  const onCaption = (idx: number, caption: string) => {
    const next = block.items.map((it, i) =>
      i === idx ? { ...it, caption: caption || undefined } : it,
    )
    void persist(next)
  }

  const onAlt = (idx: number, alt: string) => {
    const next = block.items.map((it, i) =>
      i === idx ? { ...it, alt: alt || undefined } : it,
    )
    void persist(next)
  }

  const onRemove = (idx: number) => {
    if (block.items.length <= 1) return
    const next = block.items.filter((_, i) => i !== idx)
    void persist(next)
  }

  return (
    <div data-gallery-block-editor data-block-id={block.id} className="my-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-gray-700">
        <label htmlFor={`gallery-layout-${block.id}`}>
          {t('editor.gallery.layout')}
        </label>
        <select
          id={`gallery-layout-${block.id}`}
          data-gallery-layout
          value={block.layout}
          onChange={(e) => onLayout(e.target.value as GalleryBlock['layout'])}
          disabled={busy}
          className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs"
        >
          <option value="grid">{t('editor.gallery.layoutGrid')}</option>
          <option value="carousel">{t('editor.gallery.layoutCarousel')}</option>
        </select>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={block.items.map((it) => it.imageId)}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {block.items.map((item, i) => (
              <SortableTile
                key={item.imageId}
                item={item}
                onCaption={(v) => onCaption(i, v)}
                onAlt={(v) => onAlt(i, v)}
                onRemove={() => onRemove(i)}
                disabled={busy}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => dropzoneRef.current?.openFilePicker()}
          className="rounded border border-dashed border-smsg-300 px-3 py-1 text-xs text-smsg-700 hover:bg-smsg-100"
        >
          {t('editor.gallery.add')}
        </button>
        {error && (
          <span role="status" aria-live="polite" className="text-xs text-red-600">
            {error}
          </span>
        )}
      </div>

      {/* Hidden dropzone for + 추가. */}
      <ImageDropzone
        ref={dropzoneRef}
        mode="gallery"
        onImageReady={(rec) => {
          const next: GalleryItem[] = [
            ...block.items,
            { imageId: rec.image_id },
          ]
          void persist(next)
        }}
      />
    </div>
  )
}

interface SortableTileProps {
  item: GalleryItem
  onCaption: (v: string) => void
  onAlt: (v: string) => void
  onRemove: () => void
  disabled: boolean
}

function SortableTile({ item, onCaption, onAlt, onRemove, disabled }: SortableTileProps) {
  const t = useT()
  const sortable = useSortable({ id: item.imageId })
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable
  const { data: image } = useImage(item.imageId || undefined)
  const src = image?.urls.thumb ?? `/api/v1/images/${encodeURIComponent(item.imageId)}`
  const bg = image?.dominant_color ?? '#f3f4f6'

  return (
    <figure
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      className="overflow-hidden rounded border border-smsg-100 bg-white"
    >
      <div className="relative" style={{ backgroundColor: bg }}>
        <img
          src={src}
          alt={item.alt ?? item.caption ?? ''}
          loading="lazy"
          className="aspect-square w-full object-cover"
        />
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={t('editor.gallery.reorder')}
          className="absolute left-1 top-1 cursor-grab rounded bg-white/80 px-1 text-xs shadow"
        >
          <span aria-hidden="true">⠿</span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('editor.gallery.removeItem')}
          disabled={disabled}
          className="absolute right-1 top-1 rounded bg-white/80 px-1 text-xs shadow hover:text-red-600"
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
      <div className="space-y-1 px-2 py-1 text-xs">
        <input
          type="text"
          defaultValue={item.caption ?? ''}
          onBlur={(e: ChangeEvent<HTMLInputElement>) => {
            const v = e.target.value
            if (v !== (item.caption ?? '')) onCaption(v)
          }}
          placeholder={t('editor.gallery.captionPlaceholder')}
          aria-label={t('editor.image.captionLabel')}
          className="w-full rounded border border-transparent px-1 py-0.5 hover:border-gray-200 focus:border-smsg-500 focus:outline-none"
        />
        <input
          type="text"
          defaultValue={item.alt ?? ''}
          onBlur={(e: ChangeEvent<HTMLInputElement>) => {
            const v = e.target.value
            if (v !== (item.alt ?? '')) onAlt(v)
          }}
          placeholder="alt"
          aria-label={t('editor.image.altLabel')}
          className="w-full rounded border border-transparent px-1 py-0.5 text-gray-500 hover:border-gray-200 focus:border-smsg-500 focus:outline-none"
        />
      </div>
    </figure>
  )
}
