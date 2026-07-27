/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// GitHub Pages serves the site at https://<user>.github.io/wildtag/, so
// production builds need the repo-name base path for asset URLs. Dev and
// tests stay at '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/wildtag/' : '/',
  server: {
    port: 5199,
  },
  preview: {
    port: 5199,
  },
  test: {
    // Agent worktrees live under .claude/worktrees and contain full copies of
    // the suite — exclude them so `npm test` runs each test exactly once.
    exclude: ['**/node_modules/**', '.claude/**'],
    // GitHub's shared runners become CPU-bound when the chunk benchmarks and
    // long collision simulations execute beside the rest of the suite. That
    // contention inflates benchmark timings and can exhaust otherwise ample
    // test timeouts. Keep fast file-level parallelism for local development,
    // but give each test file the runner exclusively in CI.
    fileParallelism: !process.env.CI,
  },
}));
