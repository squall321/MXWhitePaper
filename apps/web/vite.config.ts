/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
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
    proxy: {
      // Apptainer host network: api는 호스트의 8800 포트에 직접 listen.
      // 'api:8000'(docker DNS)은 더 이상 유효하지 않다. 환경변수 API_PORT 따름.
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8800',
        changeOrigin: true,
      },
    },
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
          if (id.includes('recharts') || id.includes('d3-')) return 'charts'
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
