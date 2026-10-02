// The one Node API the Tiny Tide core tests use (the tests tsconfig has no Node types): reading a shipped GLB.
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
}
