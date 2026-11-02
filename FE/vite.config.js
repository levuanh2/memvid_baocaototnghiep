import { execSync } from 'node:child_process'
import process from 'node:process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Commit this bundle was built from, published as
// <meta name="studymap-build" content="<sha>"> so release probes can compare
// the frontend with /health's `revision` instead of guessing from bundle
// hashes. Render and GitHub Actions provide the SHA; local builds ask git.
// Anything that is not a bare hex SHA becomes "unknown".
function buildRevision() {
  let value = process.env.VITE_BUILD_SHA || process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA
  if (!value) {
    try { value = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString() } catch { value = '' }
  }
  value = value.trim().toLowerCase()
  return /^[0-9a-f]{7,40}$/.test(value) ? value : 'unknown'
}

const buildRevisionMeta = () => ({
  name: 'studymap-build-revision',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'studymap-build', content: buildRevision() }, injectTo: 'head' }],
})

export default defineConfig({
  plugins: [react(), buildRevisionMeta()],
  test: {
    testTimeout: 15000,
    // FE/e2e/**/*.spec.js and FE/e2e-fixture/**/*.spec.js are Playwright
    // specs (run via `npx playwright test`, see playwright.config.js /
    // playwright.fixture.config.js) — Vitest's default include glob
    // (**/*.spec.js) would otherwise pick them up too and crash trying to
    // run Playwright's `test()` outside its own runner. Vitest's own
    // defaults (node_modules, dist, .git, config files, ...) are kept and
    // `e2e/**` / `e2e-fixture/**` are added on top, rather than replaced.
    exclude: [
      '**/node_modules/**', '**/dist/**', '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      'e2e/**',
      'e2e-fixture/**',
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
