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
      '/api': {
        target: 'http://api:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
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
