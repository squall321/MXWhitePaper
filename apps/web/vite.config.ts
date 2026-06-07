/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Served at the root by default; behind the HWAX portal it's reverse-proxied under a sub-path,
// so set VITE_BASE_PATH=/mx-white-paper/ (build AND dev) → assets/router/api all sit under it.
const BASE = process.env.VITE_BASE_PATH || '/'
const API_PREFIX = `${BASE}api`.replace(/\/{2,}/g, '/') // "/api" or "/mx-white-paper/api"

// Shared by both `server` (dev) and `preview` (serves the production build) — vite preview does
// NOT inherit server.proxy, so we reference the same object in both.
const API_PROXY = {
  [API_PREFIX]: {
    target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8800',
    changeOrigin: true,
    secure: false,
    rewrite: (p: string) => p.replace(new RegExp(`^${BASE}`), '/'),
  },
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
    proxy: API_PROXY,
  },
  // `vite preview` (used to serve the production build) does NOT inherit server.proxy, so the
  // same /api forwarding must be declared here too. This is how we run behind the HWAX portal:
  // build with VITE_BASE_PATH, then `vite preview` serves the prefixed dist + proxies /…/api.
  preview: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: API_PROXY,
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
          // ── First-party (src/) splits ────────────────────────────────────
          // The two giant chunks from the prior cycle were SectionEditor
          // (~1.3 MB) and BlockRenderer (~1.2 MB). Those stayed huge because
          // the heavy block editors (whiteboard / form / org-chart / chart /
          // math …) all rolled up into the same compile unit. Forcing the
          // SVG-heavy WhiteboardBlockEditor and the validation-heavy
          // FormBlockEditor into their own chunks lets Rollup keep their
          // dependency closure (DnD-kit subtrees, recharts in form preview)
          // out of the editor critical path. The `lazy()` calls in
          // BlockRenderer.tsx ensure those chunks are only fetched when a
          // user actually opens that block in edit mode.
          if (id.includes('/src/features/editor/blocks/WhiteboardBlockEditor')) return 'block-whiteboard'
          if (id.includes('/src/features/editor/blocks/FormBlockEditor')) return 'block-form'
          if (id.includes('/src/features/editor/blocks/OrgChartBlockEditor')) return 'block-org-chart'
          if (id.includes('/src/features/editor/blocks/FlowBlockEditor')) return 'block-flow'
          if (id.includes('/src/features/editor/blocks/GanttBlockEditor')) return 'block-gantt'
          if (id.includes('/src/features/editor/blocks/CalculatorBlockEditor')) return 'block-calculator'
          if (id.includes('/src/features/editor/blocks/DashboardEmbedBlockEditor')) return 'block-dashboard-embed'
          if (id.includes('/src/features/editor/blocks/DataSourceBlockEditor')) return 'block-data-source'
          if (id.includes('/src/features/editor/blocks/KpiCardsBlockEditor')) return 'block-kpi'
          if (id.includes('/src/features/editor/blocks/GalleryBlockEditor')) return 'block-gallery'
          if (id.includes('/src/features/editor/blocks/ChartBlockEditor')) return 'block-chart'
          if (id.includes('/src/features/editor/blocks/MathBlockEditor')) return 'block-math'
          // Presentation surface — only needed under /docs/:slug/present.
          if (id.includes('/src/features/presentation/') || id.includes('/src/pages/Presentation')) return 'presentation'
          // Rarely-shown editor modals — keep them off the critical path.
          if (
            id.includes('/src/features/editor/components/BulkActionsBar') ||
            id.includes('/src/features/editor/components/ConflictMergeModal') ||
            id.includes('/src/features/editor/components/KeyboardShortcutsModal') ||
            id.includes('/src/features/editor/components/FindReplaceModal') ||
            id.includes('/src/features/editor/components/SectionLinkPicker') ||
            id.includes('/src/features/block-library/SnippetPicker') ||
            id.includes('/src/features/block-library/SnippetSaveModal')
          ) {
            return 'editor-modals'
          }

          // ── Vendor splits (existing) ────────────────────────────────────
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@blocknote') || id.includes('@mantine')) return 'editor'
          if (id.includes('mermaid')) return 'mermaid'
          // Excalidraw ships its own giant runtime (~4 MB) for the headless
          // exportToSvg path used by FlowBlock. Isolate so the main
          // bundle / vendor chunk doesn't carry it for docs that never
          // touch an excalidraw flow.
          if (id.includes('@excalidraw/excalidraw') || id.includes('roughjs')) return 'excalidraw'
          // Cytoscape + cose-bilkent are heavy; isolate them so /dep-graph's
          // dynamic import can fetch them on demand without polluting the
          // editor critical path.
          if (id.includes('cytoscape') || id.includes('cose-base')) return 'graph-cytoscape'
          // recharts@3 has an internal redux store (redux/react-redux/reselect/@reduxjs/toolkit).
          // Those MUST land in the SAME chunk as recharts, or a recharts selector factory runs
          // before reselect is initialized → "legendSelectors.js: E is not a function". Route the
          // redux closure into 'charts' alongside recharts. (immer is pulled by @reduxjs/toolkit.)
          if (
            id.includes('recharts') || id.includes('d3-') ||
            id.includes('node_modules/redux/') || id.includes('react-redux') ||
            id.includes('reselect') || id.includes('@reduxjs/toolkit') || id.includes('node_modules/immer/')
          ) return 'charts'
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
