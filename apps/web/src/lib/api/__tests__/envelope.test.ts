import { describe, it, expect } from 'vitest'
import type { AxiosResponse } from 'axios'
import {
  ApiError,
  isClientError,
  isNotFound,
  readMeta,
  toApiError,
  unwrap,
  unwrapList,
  unwrapListMaybe,
  unwrapMaybe,
  type ApiEnvelope,
} from '../envelope'

/** Build a fake AxiosResponse so we can stay framework-free here. */
function res<T>(data: ApiEnvelope<T>, status = 200): AxiosResponse<ApiEnvelope<T>> {
  return {
    data,
    status,
    statusText: 'OK',
    headers: {},
    config: {} as never,
  }
}

describe('envelope.unwrap', () => {
  it('returns data when the envelope is well-formed', () => {
    expect(unwrap(res({ data: { a: 1 } }))).toEqual({ a: 1 })
  })

  it('throws ApiError when error is non-null', () => {
    expect(() =>
      unwrap(res({ data: undefined, error: { code: 'BAD', message: 'no good' } })),
    ).toThrowError(ApiError)
    try {
      unwrap(res({ data: undefined, error: { code: 'BAD', message: 'no good' } }))
    } catch (e) {
      const err = e as ApiError
      expect(err.code).toBe('BAD')
      expect(err.message).toBe('BAD — no good')
    }
  })

  it('throws when data is missing', () => {
    expect(() => unwrap(res({}))).toThrowError(/EMPTY_ENVELOPE/)
  })

  it('throws on null response', () => {
    expect(() => unwrap(undefined as never)).toThrowError(/EMPTY_ENVELOPE/)
  })
})

describe('envelope.unwrapList', () => {
  it('returns array data directly', () => {
    expect(unwrapList<number>(res({ data: [1, 2, 3] }))).toEqual([1, 2, 3])
  })

  it('reads keyed nested list when key supplied', () => {
    const r = res({ data: { divisions: [{ id: 'd1' }] } as Record<string, unknown> })
    expect(unwrapList<{ id: string }>(r, 'divisions')).toEqual([{ id: 'd1' }])
  })

  it('returns [] when key is missing or not an array', () => {
    const r = res({ data: { divisions: 'oops' } as Record<string, unknown> })
    expect(unwrapList(r, 'divisions')).toEqual([])
  })

  it('returns [] when data is missing entirely', () => {
    expect(unwrapList(res<unknown[]>({}), 'divisions')).toEqual([])
  })

  it('throws when error envelope is set', () => {
    expect(() =>
      unwrapList(
        res<unknown[]>({ data: undefined, error: { code: 'X', message: 'y' } }),
      ),
    ).toThrowError(ApiError)
  })
})

describe('envelope.unwrapMaybe', () => {
  it('resolves to data on success', async () => {
    await expect(
      unwrapMaybe(Promise.resolve(res({ data: 'hello' })), 'fallback'),
    ).resolves.toBe('hello')
  })

  it('returns fallback when 404 thrown', async () => {
    const err = { response: { status: 404 } }
    await expect(unwrapMaybe(Promise.reject(err), 'FB')).resolves.toBe('FB')
  })

  it('returns fallback when data is missing', async () => {
    await expect(unwrapMaybe(Promise.resolve(res({})), 'FB')).resolves.toBe('FB')
  })

  it('rethrows non-404 errors as ApiError', async () => {
    const err = { response: { status: 500 } }
    await expect(unwrapMaybe(Promise.reject(err), 'FB')).rejects.toBeInstanceOf(ApiError)
  })
})

describe('envelope.unwrapListMaybe', () => {
  it('returns array data', async () => {
    await expect(
      unwrapListMaybe<number>(Promise.resolve(res({ data: [9] }))),
    ).resolves.toEqual([9])
  })

  it('returns keyed list', async () => {
    await expect(
      unwrapListMaybe<{ id: string }>(
        Promise.resolve(res({ data: { divisions: [{ id: 'a' }] } as Record<string, unknown> })),
        'divisions',
      ),
    ).resolves.toEqual([{ id: 'a' }])
  })

  it('returns [] on 404', async () => {
    await expect(
      unwrapListMaybe(Promise.reject({ response: { status: 404 } })),
    ).resolves.toEqual([])
  })
})

describe('envelope.readMeta / helpers', () => {
  it('reads the meta object', () => {
    expect(readMeta(res({ data: 1, meta: { etag: 'W/"x-1"' } }))).toEqual({ etag: 'W/"x-1"' })
  })

  it('isNotFound and isClientError detect status', () => {
    expect(isNotFound({ response: { status: 404 } })).toBe(true)
    expect(isNotFound({ response: { status: 500 } })).toBe(false)
    expect(isClientError({ response: { status: 422 } })).toBe(true)
    expect(isClientError({ response: { status: 503 } })).toBe(false)
  })

  it('toApiError pulls the BE error envelope code/message', () => {
    const err = {
      response: {
        status: 409,
        data: { error: { code: 'CONFLICT', message: '동일 슬러그' } },
      },
    }
    const api = toApiError(err)
    expect(api.code).toBe('CONFLICT')
    expect(api.message).toBe('CONFLICT — 동일 슬러그')
    expect(api.status).toBe(409)
  })

  it('toApiError falls back to unknown when nothing useful is present', () => {
    const api = toApiError(new Error('boom'))
    expect(api.code).toBe('UNKNOWN')
    expect(api.message).toBe('UNKNOWN — boom')
  })
})
