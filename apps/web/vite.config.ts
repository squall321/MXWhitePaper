/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Served at the root by default; behind the HWAX portal it's reverse-proxied under a sub-path,
// so set VITE_BASE_PATH=/mx-white-paper/ (build AND dev) → assets/router/api all sit under it.
//
// Audit fix H2 — VITE_BASE_PATH 끝슬래시 정규화. 사용자가 '/mx-white-paper'
// (trailing slash 없이) 로 잘못 설정하면 vite 의 `base` 가 broken (asset
// URL 생성 깨짐) + API_PREFIX 가 '/mx-white-paperapi' 가 되어 proxy match
// 실패. 입력을 항상 trailing slash 로 정규화 → 한 가지 silent foot-gun 제거.
function normalizeBase(input: string | undefined): string {
  const v = (input || '/').trim()
  return v.endsWith('/') ? v : v + '/'
}

const BASE = normalizeBase(process.env.VITE_BASE_PATH)
const API_PREFIX = `${BASE}api`.replace(/\/{2,}/g, '/') // "/api" or "/mx-white-paper/api"

// Shared between `server` (dev) and `preview` (production build serve) — vite preview does NOT
// inherit server.proxy, so each must have its own proxy config.
//
// Audit fix M2 — `http-proxy` 가 옵션 객체를 *내부에서 mutate* (listener 등록 등) 한다.
// 같은 ref 를 server + preview 둘 다 받으면 listener 중복 등록 risk. factory 로 매번
// 새 객체를 만들어 둘 다 *깨끗한 옵션* 을 받게.
function makeApiProxy() {
  return {
    [API_PREFIX]: {
      target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8800',
      changeOrigin: true,
      secure: false,
      rewrite: (p: string) => p.replace(new RegExp(`^${BASE}`), '/'),
    },
  }
}

export default defineConfig({
  base: BASE,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@mx/shared/super-domains': path.resolve(__dirname, '../../packages/shared/src/super-domains.ts'),
    },
  },
  test: {
    // Vitest defaults pick up tests/**/*.spec.ts; the e2e folder uses
    // @playwright/test which is incompatible. Keep them out of vitest.
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    // Default: host loopback. On installs where Apptainer puts each instance into its own netns,
    // the web container can't reach 127.0.0.1:8800 — set VITE_PROXY_TARGET in .env (e.g.
    // http://<server-public-ip>:8800) to dial the host's external interface instead.
    // Match the base-prefixed path (e.g. /mx-white-paper/api) and strip the base back to /api
    // before forwarding, so the backend (which serves /api/v1) is reached either way.
    proxy: makeApiProxy(),
  },
  // `vite preview` (used to serve the production build) does NOT inherit server.proxy, so the
  // same /api forwarding must be declared here too. This is how we run behind the HWAX portal:
  // build with VITE_BASE_PATH, then `vite preview` serves the prefixed dist + proxies /…/api.
  preview: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: makeApiProxy(),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // After granular block-editor splits below the heaviest individual chunk
    // should sit comfortably under 700kB; raising the warning threshold from
    // the Vite default (500kB) avoids noise on the still-large `editor`
    // bundle while keeping the ceiling tight enough to flag regressions.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // ── First-party (src/) splits: NONE ──────────────────────────────
          // We used to force the heavy block editors / presentation / modals into named manual
          // chunks. But those app modules import shared vendor libs (recharts, react-query, router)
          // AND each other, so a manual split created cross-chunk CIRCULAR dependencies
          // (vendor↔block-chart↔editor-modals↔query/router, vendor↔presentation↔router) that crash
          // at runtime with init-order errors: "Cannot access 'L_'/'W_' before initialization",
          // "E is not a function", "index.mjs:1". The blocks are ALREADY lazy()-imported in
          // BlockRenderer.tsx, so Rollup code-splits them on its own — let it, and don't force any
          // src/ chunk. (Vendor libs below are still split; node_modules has no app-level cycles.)
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@blocknote') || id.includes('@mantine')) return 'editor'
          // NOTE: mermaid / excalidraw / cytoscape are NOT force-chunked. They're heavy but they
          // import shared vendor libs and each other, so a manual chunk created cross-chunk circular
          // deps (vendor↔mermaid↔excalidraw↔vendor) → runtime init-order crashes. They're already
          // dynamically import()-ed where used, so Rollup splits them on demand on its own — forcing
          // a named chunk only re-introduces the cycle. Let them fall through to 'vendor'.
          // recharts@3 + its internal redux store and d3 form a tight circular-dependency cluster.
          // Splitting ANY of it into a separate chunk creates a cross-chunk circular dep that breaks
          // module init order ("legendSelectors: E is not a function" / "Cannot access W_ before
          // initialization" / "Circular chunk: vendor -> charts -> vendor"). So do NOT split charts
          // at all — let recharts/d3/redux bundle into 'vendor' with their whole closure.
          if (id.includes('katex')) return 'math'
          if (id.includes('@dnd-kit')) return 'dnd'
          if (id.includes('@tanstack')) return 'query'
          if (id.includes('react-hook-form') || id.includes('@hookform') || id.includes('zod')) return 'forms'
          if (id.includes('react-router')) return 'router'
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('scheduler')) return 'react'
          if (id.includes('axios')) return 'http'
          return 'vendor'
        },
      },
    },
  },
})
