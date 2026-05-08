/**
 * Centralized envelope unwrap helpers.
 *
 * Every BE response uses the shape `{ data, meta?, error? }`. `data` is
 * sometimes a list, sometimes an object, sometimes contains a nested keyed
 * list (e.g. `{ data: { divisions: [...] } }`).
 *
 * These helpers exist so feature `api.ts` files never have to write
 * ad-hoc `res.data.data?.xxx ?? []` defenses again. Each helper:
 *   1. Normalises `res.data` so a totally missing envelope still resolves.
 *   2. Throws an `ApiError` when `error` is non-null — message in the form
 *      `<ERROR_CODE> — <message>` so call sites and toasts get a useful
 *      string for free.
 *   3. Provides type-narrowing without any `any`.
 */
import type { AxiosError, AxiosResponse } from 'axios'

export interface ApiErrorBody {
  code: string
  message: string
  details?: unknown
}

export interface ApiEnvelope<T> {
  data?: T
  meta?: Record<string, unknown>
  error?: ApiErrorBody | null
}

/**
 * Domain error thrown by `unwrap*`. Use `toApiError(err)` to coerce arbitrary
 * `catch` payloads into one of these so toasts / boundaries can format it.
 */
export class ApiError extends Error {
  readonly code: string
  readonly status?: number
  readonly details?: unknown

  constructor(code: string, message: string, status?: number, details?: unknown) {
    super(`${code} — ${message}`)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

/** True when the axios error reports a 404. */
export function isNotFound(err: unknown): boolean {
  const ax = err as AxiosError | undefined
  return ax?.response?.status === 404
}

/** True for 4xx that the BE classifies as "client must fix" (skip retry). */
export function isClientError(err: unknown): boolean {
  const ax = err as AxiosError | undefined
  const s = ax?.response?.status
  return s != null && s >= 400 && s < 500
}

/**
 * Coerce arbitrary thrown values into an `ApiError`. Honours envelope
 * `{ error: { code, message } }` if the BE shipped one; otherwise falls back
 * to the axios message.
 */
export function toApiError(err: unknown, fallbackCode = 'UNKNOWN'): ApiError {
  if (err instanceof ApiError) return err
  const ax = err as AxiosError<ApiEnvelope<unknown>> | undefined
  const status = ax?.response?.status
  const body = ax?.response?.data
  if (body && typeof body === 'object' && 'error' in body && body.error) {
    const e = body.error as ApiErrorBody
    return new ApiError(e.code ?? fallbackCode, e.message ?? String(err), status, e.details)
  }
  const msg = (err as Error)?.message ?? '요청을 처리하지 못했습니다.'
  return new ApiError(fallbackCode, msg, status)
}

/**
 * Unwrap a non-list envelope: returns `data` or throws when the BE reported
 * a non-null `error`. Also throws when `data` is missing — callers that want
 * to tolerate a missing payload should use `unwrapMaybe` instead.
 */
export function unwrap<T = unknown>(
  res: AxiosResponse<ApiEnvelope<T>> | undefined,
): T {
  const body = res?.data
  if (body && body.error) {
    const e = body.error
    throw new ApiError(e.code ?? 'API_ERROR', e.message ?? 'API error', res?.status)
  }
  if (!body || body.data === undefined || body.data === null) {
    throw new ApiError('EMPTY_ENVELOPE', '응답 본문이 비어 있습니다.', res?.status)
  }
  return body.data as T
}

/**
 * Unwrap a list envelope. Handles both shapes:
 *
 *   { data: T[] }                        // straight array
 *   { data: { [key]: T[] } }             // keyed (e.g. /orgs/tree → divisions)
 *
 * When `data` is an array we return it. When `data` is an object and `key` is
 * supplied, we return `data[key]` if it's an array. Falls back to `[]`.
 */
export function unwrapList<T = unknown>(
  res: AxiosResponse<ApiEnvelope<T[] | Record<string, unknown>>> | undefined,
  key?: string,
): T[] {
  const body = res?.data
  if (body && body.error) {
    const e = body.error
    throw new ApiError(e.code ?? 'API_ERROR', e.message ?? 'API error', res?.status)
  }
  const data = body?.data
  if (Array.isArray(data)) return data as T[]
  if (key && data && typeof data === 'object') {
    const value = (data as Record<string, unknown>)[key]
    if (Array.isArray(value)) return value as T[]
  }
  return []
}

/**
 * Tolerant unwrap: returns `fallback` when the request 404s, when the
 * envelope is empty, or when `data` is missing. Other errors still throw
 * so the toast layer can surface them.
 */
export async function unwrapMaybe<T = unknown>(
  promise: Promise<AxiosResponse<ApiEnvelope<T>>>,
  fallback: T,
): Promise<T> {
  try {
    const res = await promise
    const body = res?.data
    if (body && body.error) {
      const e = body.error
      throw new ApiError(e.code ?? 'API_ERROR', e.message ?? 'API error', res?.status)
    }
    if (!body || body.data === undefined || body.data === null) return fallback
    return body.data as T
  } catch (err) {
    if (isNotFound(err)) return fallback
    throw toApiError(err)
  }
}

/**
 * List counterpart of `unwrapMaybe` — never throws on 404, never throws on
 * a missing envelope. Resolves to an empty array (or the keyed list).
 */
export async function unwrapListMaybe<T = unknown>(
  promise: Promise<AxiosResponse<ApiEnvelope<T[] | Record<string, unknown>>>>,
  key?: string,
): Promise<T[]> {
  try {
    const res = await promise
    return unwrapList<T>(res, key)
  } catch (err) {
    if (isNotFound(err)) return []
    throw toApiError(err)
  }
}

/** Read meta of an envelope without forcing the data shape. */
export function readMeta<M = Record<string, unknown>>(
  res: AxiosResponse<ApiEnvelope<unknown>> | undefined,
): M {
  return (res?.data?.meta ?? {}) as M
}
