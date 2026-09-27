import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // FE/e2e/**/*.spec.js are Playwright specs (run via `npx playwright
    // test`, see playwright.config.js) — Vitest's default include glob
    // (**/*.spec.js) would otherwise pick them up too and crash trying to
    // run Playwright's `test()` outside its own runner. Vitest's own
    // defaults (node_modules, dist, .git, config files, ...) are kept and
    // `e2e/**` is added on top, rather than replaced.
    exclude: [
      '**/node_modules/**', '**/dist/**', '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      'e2e/**',
    ],
  },
  build: {
    rollupOptions: {
      output: {
        // Tách vendor ổn định khỏi code app: react/markdown đổi rất hiếm →
        // cache trúng lâu dài; mind-elixir/snapdom đi cùng lazy chunk mindmap
        // (chỉ tải khi user mở modal). Không tách nhỏ hơn — chunk tí hon chỉ
        // thêm request.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          markdown: ['react-markdown', 'remark-gfm', 'remark-breaks'],
          mindmap: ['mind-elixir', '@zumer/snapdom'],
        },
      },
    },
  },
})
