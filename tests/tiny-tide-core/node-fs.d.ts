// The Node APIs the Tiny Tide core tests use (the tests tsconfig has no Node types): reading a shipped GLB or a source file, the sim golden
// and the probe reports, and the environment switches (TIDE_SLOW, the slow tier; TIDE_SIM_RECORD; TIDE_COMBAT_PROBE).
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
}
declare const process: { env: Record<string, string | undefined> };
