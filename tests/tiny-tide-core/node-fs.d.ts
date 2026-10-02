// The Node APIs the Tiny Tide core tests use (the tests tsconfig has no Node types): reading a shipped GLB or a source file, and
// the environment (TIDE_SLOW, the slow tier).
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
declare const process: { env: Record<string, string | undefined> };
