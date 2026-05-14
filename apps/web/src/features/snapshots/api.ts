/**
 * Snapshot management API client.
 *
 * Full-server snapshots are created by the host script
 * `infra/scripts/snapshot.sh` (the API itself can't reach `pg_dump` or
 * apptainer from inside its sandbox). This module talks to the
 * read/manage endpoints in `apps/api/app/routers/snapshots.py`.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export interface SnapshotBucket {
  name: string
  object_count: number
  size_bytes: number
}

export interface Snapshot {
  /** Compact id, e.g. "20260513-211429Z" — embeds second-precision UTC. */
  id: string
  filename: string
  size_bytes: number | null
  mtime: string | null
  sha256: string | null
  /** ISO timestamp, second precision. */
  created_at: string | null
  created_at_epoch: number | null
  note: string | null
  host: string | null
  git_rev: string | null
  schema: {
    postgres_db: string
    minio_buckets: SnapshotBucket[]
  } | null
  files: Record<string, { size_bytes: number; sha256: string }> | null
}

export interface SnapshotListResponse {
  items: Snapshot[]
  count: number
}

export async function listSnapshots(): Promise<SnapshotListResponse> {
  const res = await apiClient.get<ApiEnvelope<SnapshotListResponse>>(
    '/snapshots',
  )
  return unwrap(res)
}

export async function getSnapshot(id: string): Promise<Snapshot> {
  const res = await apiClient.get<ApiEnvelope<Snapshot>>(
    `/snapshots/${encodeURIComponent(id)}`,
  )
  return unwrap(res)
}

/** Build a direct download URL — used as an `<a href>` so the browser
 *  handles the save dialog instead of buffering bytes in JS memory. */
export function snapshotDownloadUrl(id: string): string {
  return `/api/v1/snapshots/${encodeURIComponent(id)}/download`
}

export async function deleteSnapshot(id: string): Promise<void> {
  await apiClient.delete<void>(`/snapshots/${encodeURIComponent(id)}`)
}
