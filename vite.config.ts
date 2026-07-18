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
  },
}));
