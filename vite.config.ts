/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
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
});
