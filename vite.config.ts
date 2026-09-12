/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';

// GitHub Pages serves the site at https://<user>.github.io/wildtag/, so
// production builds and their local preview need the repo-name base path.
// Dev and tests stay at '/'.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/wildtag/' : '/',
  build: {
    rollupOptions: {
      input: {
        wildtag: 'index.html', tide: 'tiny-tide.html', siege: 'royal-yeet.html', wildtagAlias: 'wildtag.html', grandpa: 'grandpa.html',
        ...(existsSync('mineral-wage.html') ? { miner: 'mineral-wage.html' } : {}),
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
    // the suite — exclude them so `npm test` runs each test exactly once.
    exclude: ['**/node_modules/**', '.claude/**'],
  },
}));
