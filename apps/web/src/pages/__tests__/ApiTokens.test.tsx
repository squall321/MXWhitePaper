import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ApiTokenRow } from '@/features/api-tokens/api'

vi.mock('@/features/api-tokens/api', async () => {
  const actual = await vi.importActual<typeof import('@/features/api-tokens/api')>(
    '@/features/api-tokens/api',
  )
  return {
    ...actual,
    listApiTokens: vi.fn(async () => [] as ApiTokenRow[]),
    createApiToken: vi.fn(),
    revokeApiToken: vi.fn(),
    rotateApiToken: vi.fn(),
  }
})

import { ApiTokensPage } from '../ApiTokens'
import {
  buildMcpDesktopConfig,
  buildMcpHttpCommand,
  expiresInToISO,
  mcpApiBaseUrl,
} from '@/features/api-tokens/api'

function render(seed: ApiTokenRow[]): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['api-tokens'], seed)
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/me/api-tokens']}>
        <ApiTokensPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<ApiTokensPage />', () => {
  it('renders the empty state when there are no tokens', () => {
    const html = render([])
    expect(html).toContain('개인 API 토큰')
    expect(html).toContain('data-testid="api-tokens-empty"')
    expect(html).toContain('data-testid="api-token-add"')
  })

  it('renders one row per token with masked prefix + scope badges', () => {
    const html = render([
      {
        id: 'tok-1',
        user_id: 'u-1',
        name: 'ci-deploy-bot',
        token_prefix: 'ABCD1234',
        scopes: ['read', 'write'],
        last_used_at: '2026-05-08T12:00:00Z',
        expires_at: null,
        revoked_at: null,
        created_at: '2026-05-01T00:00:00Z',
        masked_token: 'mxwp_ABCD1234…',
      },
      {
        id: 'tok-2',
        user_id: 'u-1',
        name: 'old-revoked',
        token_prefix: 'ZZZZ9999',
        scopes: ['read'],
        last_used_at: null,
        expires_at: null,
        revoked_at: '2026-05-02T00:00:00Z',
        created_at: '2026-04-01T00:00:00Z',
        masked_token: 'mxwp_ZZZZ9999…',
      },
    ])
    expect(html).toContain('ci-deploy-bot')
    expect(html).toContain('mxwp_ABCD1234…')
    expect(html).toContain('data-testid="api-token-row-tok-1"')
    expect(html).toContain('data-testid="api-token-row-tok-2"')
    expect(html).toContain('data-status="active"')
    expect(html).toContain('data-status="revoked"')
    // active row has both rotate + revoke buttons
    expect(html).toContain('data-testid="api-token-rotate-tok-1"')
    expect(html).toContain('data-testid="api-token-revoke-tok-1"')
    // revoked row hides them
    expect(html).not.toContain('data-testid="api-token-rotate-tok-2"')
    expect(html).not.toContain('data-testid="api-token-revoke-tok-2"')
    // scope label translation
    expect(html).toContain('읽기')
    expect(html).toContain('쓰기')
  })

  it('flags expired tokens as warn-toned', () => {
    const html = render([
      {
        id: 'tok-x',
        user_id: 'u-1',
        name: 'expired-one',
        token_prefix: 'XXXXXXXX',
        scopes: ['read'],
        last_used_at: null,
        expires_at: '2000-01-01T00:00:00Z',
        revoked_at: null,
        created_at: '2000-01-01T00:00:00Z',
        masked_token: 'mxwp_XXXXXXXX…',
      },
    ])
    expect(html).toContain('data-status="expired"')
    expect(html).toContain('만료')
  })
})

describe('expiresInToISO', () => {
  const NOW = new Date('2026-05-09T00:00:00Z')

  it('returns null for "never"', () => {
    expect(expiresInToISO('never', NOW)).toBeNull()
  })

  it('shifts the month for "1m" / "3m"', () => {
    const oneMonth = expiresInToISO('1m', NOW)
    expect(oneMonth).not.toBeNull()
    expect(new Date(oneMonth!).getUTCMonth()).toBe(5) // June (0-indexed)

    const threeMonths = expiresInToISO('3m', NOW)
    expect(threeMonths).not.toBeNull()
    expect(new Date(threeMonths!).getUTCMonth()).toBe(7) // August
  })

  it('shifts the year for "1y"', () => {
    const oneYear = expiresInToISO('1y', NOW)
    expect(oneYear).not.toBeNull()
    expect(new Date(oneYear!).getUTCFullYear()).toBe(2027)
  })
})

// 이 파일은 SSR (node) 환경이라 window 가 없다. 헬퍼는 브라우저용이므로
// origin 만 stub 한다 (BASE_URL 은 빌드 시 '/' 로 주입됨).
// MXWP_API_URL 은 origin (+ 서브경로) 까지만 — api_client 가 `/api/v1/...` 를 붙임.
describe('mcpApiBaseUrl', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns origin without an /api/v1 suffix (api_client appends it)', () => {
    vi.stubGlobal('window', {
      location: { origin: 'https://hwax.sec.samsung.net' },
    })
    // BASE_URL is '/' in test → bare origin, no trailing slash.
    expect(mcpApiBaseUrl()).toBe('https://hwax.sec.samsung.net')
  })
})

describe('buildMcpDesktopConfig', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('embeds the token + origin-only API url under mcpServers."mxwp-rag"', () => {
    vi.stubGlobal('window', {
      location: { origin: 'https://hwax.sec.samsung.net' },
    })
    const json = buildMcpDesktopConfig('mxwp_SECRET123')
    const parsed = JSON.parse(json)
    const srv = parsed.mcpServers['mxwp-rag']
    expect(srv.env.MXWP_API_TOKEN).toBe('mxwp_SECRET123')
    // no /api/v1 — the MCP api_client adds full paths itself.
    expect(srv.env.MXWP_API_URL).toBe('https://hwax.sec.samsung.net')
    expect(srv.env.MXWP_API_URL).not.toMatch(/\/api\/v1/)
    // command stays a placeholder the user edits to their unpacked binary.
    expect(srv.command).toContain('mxwp-mcp')
  })

  it('is valid, pretty-printed JSON', () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost' } })
    const json = buildMcpDesktopConfig('t')
    expect(() => JSON.parse(json)).not.toThrow()
    expect(json).toContain('\n  ') // 2-space indented
  })
})

describe('buildMcpHttpCommand', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('builds a register-once command with the token + MCP_URL prefix', () => {
    vi.stubGlobal('window', {
      location: { origin: 'https://hwax.sec.samsung.net' },
    })
    const cmd = buildMcpHttpCommand('mxwp_SECRET123')
    expect(cmd).toContain('claude mcp add --transport http mxwp')
    // MCP_URL = origin (+ sub-path) + /mcp; BASE_URL is '/' in test → /mcp.
    expect(cmd).toContain('https://hwax.sec.samsung.net/mcp')
    // token is carried as an Authorization: Bearer header.
    expect(cmd).toContain('--header "Authorization: Bearer mxwp_SECRET123"')
  })
})
