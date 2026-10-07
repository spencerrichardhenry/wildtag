/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// GitHub Pages serves the site at https://<user>.github.io/wildtag/, so
// production builds and their local preview need the repo-name base path.
// Dev and tests stay at '/'.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/wildtag/' : '/',
  build: {
    rollupOptions: {
      input: {
        wildtag: 'index.html', wildtagAlias: 'wildtag.html', grandpa: 'grandpa.html',
      },
    },
  },
  server: {
    port: 5199,
  },
  preview: {
    port: 5199,
  },
  test: {
    // Agent worktrees live under .claude/worktrees and contain full copies of
    // the suite, and .codex-drafts holds stale draft copies — exclude them so
    // `npm test` runs each test exactly once.
    exclude: ['**/node_modules/**', '.claude/**', '.codex-drafts/**'],
  },
}));
