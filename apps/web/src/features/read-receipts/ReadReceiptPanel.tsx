/**
 * ReadReceiptPanel — outreach surface for the doc author / reviewers.
 *
 * Mounts under WikiArticle for editor+ on the current doc:
 *   1. Top-10 readers (ordered by most-recent signal: ack > read).
 *   2. Each row shows name + last_read_at relative + ✅ if acknowledged.
 *   3. "전체 보기" opens a modal with the full list + "확인함만 / 모두" filter.
 *   4. Clicking a row fires a `read_ack_reminder` notification for that user
 *      and toasts the action (the "뒤집기" hand-off the spec calls for).
 *
 * Uses tanstack-query with a 30s staleTime so the panel doesn't re-fetch on
 * every section render. Loads silently — failure no-ops to a hidden panel
 * because reader lists shouldn't break article rendering.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  listReadReceipts,
  remindReader,
  type ReadReceipt,
} from './api'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { toast } from '@/components/ui/Toast'
import { formatRelative } from '@/features/activity/format'
import type { Slug } from '@/types/document'
import { toApiError } from '@/lib/api/envelope'

export interface ReadReceiptPanelProps {
  slug: Slug
}

export const readReceiptsKey = (slug: string) =>
  ['read-receipts', slug] as const

export function ReadReceiptPanel({ slug }: ReadReceiptPanelProps) {
  const q = useQuery<ReadReceipt[]>({
    queryKey: readReceiptsKey(slug),
    queryFn: () => listReadReceipts(slug),
    enabled: Boolean(slug),
    staleTime: 30_000,
    retry: false,
  })
  const [modalOpen, setModalOpen] = useState(false)

  const items = q.data ?? []
  const top = items.slice(0, 10)

  // Hide entirely when no readers + the load completed cleanly. We still
  // render the chrome on error so the component is testable / discoverable.
  if (q.isFetched && items.length === 0 && !q.isError) {
    return (
      <section
        data-testid="read-receipt-panel"
        className="rounded-md border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
      >
        <header className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            읽은 사람
          </h3>
        </header>
        <p
          className="rounded border border-dashed border-gray-200 px-3 py-3 text-center text-xs text-gray-500"
          data-testid="read-receipt-empty"
        >
          아직 이 문서를 열람한 사람이 없습니다.
        </p>
      </section>
    )
  }

  return (
    <section
      data-testid="read-receipt-panel"
      className="rounded-md border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          읽은 사람 ({items.length})
        </h3>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            data-testid="read-receipt-show-all"
            className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 hover:text-smsg-700"
          >
            전체 보기
          </button>
        )}
      </header>

      {q.isLoading && (
        <p className="text-xs text-gray-500">불러오는 중…</p>
      )}
      {q.isError && (
        <p
          className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700"
          data-testid="read-receipt-error"
        >
          독자 목록을 불러오지 못했습니다.
        </p>
      )}

      {top.length > 0 && (
        <ReceiptList
          items={top}
          slug={slug}
          dataTestId="read-receipt-top"
        />
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="문서를 읽은 사람"
        size="md"
      >
        <ReceiptModalBody items={items} slug={slug} />
      </Modal>
    </section>
  )
}

interface ReceiptListProps {
  items: ReadReceipt[]
  slug: Slug
  dataTestId?: string
}

function ReceiptList({ items, slug, dataTestId }: ReceiptListProps) {
  return (
    <ul
      className="space-y-1.5"
      data-testid={dataTestId ?? 'read-receipt-list'}
    >
      {items.map((r) => (
        <ReceiptRow key={r.user_id} reader={r} slug={slug} />
      ))}
    </ul>
  )
}

function ReceiptRow({
  reader,
  slug,
}: {
  reader: ReadReceipt
  slug: Slug
}) {
  const lastSignal = reader.acknowledged_at ?? reader.last_read_at
  const onClick = async () => {
    try {
      const res = await remindReader(slug, reader.user_id)
      if (res.notified) {
        toast.success('읽음 확인 리마인더를 보냈습니다.')
      } else {
        // 수신자가 in-app 알림을 차단한 경우 — 여전히 호출은 성공이지만
        // 실제 row 는 INSERT 되지 않았다.
        toast.info('수신자가 알림을 차단해 발송되지 않았습니다.')
      }
    } catch (err) {
      toast.error(toApiError(err).message)
    }
  }
  const ackd = !!reader.acknowledged_at
  return (
    <li>
      <button
        type="button"
        onClick={() => void onClick()}
        data-testid={`read-receipt-row-${reader.user_id}`}
        data-acked={ackd ? 'true' : 'false'}
        className="flex w-full items-center justify-between gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-1.5 text-left text-xs hover:bg-smsg-50 dark:border-gray-800 dark:bg-gray-950"
        title={`${reader.email ?? ''} — 클릭하면 리마인더 발송`}
      >
        <span className="flex-1 truncate font-medium text-gray-700 dark:text-gray-300">
          {reader.name || reader.email || reader.user_id}
        </span>
        <span className="shrink-0 text-[11px] text-gray-500">
          {formatRelative(lastSignal)}
        </span>
        {ackd && (
          <span
            aria-label="확인함"
            data-testid={`read-receipt-acked-${reader.user_id}`}
            className="shrink-0 text-emerald-600"
          >
            ✅
          </span>
        )}
      </button>
    </li>
  )
}

function ReceiptModalBody({
  items,
  slug,
}: {
  items: ReadReceipt[]
  slug: Slug
}) {
  type Filter = 'all' | 'acked'
  const [filter, setFilter] = useState<Filter>('all')
  const visible = useMemo(
    () =>
      filter === 'acked'
        ? items.filter((r) => !!r.acknowledged_at)
        : items,
    [items, filter],
  )
  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <FilterPill
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          testid="read-receipt-filter-all"
        >
          모두 ({items.length})
        </FilterPill>
        <FilterPill
          active={filter === 'acked'}
          onClick={() => setFilter('acked')}
          testid="read-receipt-filter-acked"
        >
          확인함만 ({items.filter((r) => r.acknowledged_at).length})
        </FilterPill>
      </div>
      {visible.length === 0 ? (
        <p
          className="rounded border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-500"
          data-testid="read-receipt-modal-empty"
        >
          해당하는 독자가 없습니다.
        </p>
      ) : (
        <ReceiptList
          items={visible}
          slug={slug}
          dataTestId="read-receipt-modal-list"
        />
      )}
    </div>
  )
}

function FilterPill({
  active,
  onClick,
  testid,
  children,
}: {
  active: boolean
  onClick: () => void
  testid: string
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'primary' : 'secondary'}
      onClick={onClick}
      data-testid={testid}
    >
      {children}
    </Button>
  )
}
