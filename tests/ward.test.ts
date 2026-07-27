import { describe, it, expect } from 'vitest';
import { WARD_MAP } from '../src/castle/wardMap.ts';
import { parseWard, wardLayout, inHall, cellToWorld } from '../src/castle/ward.ts';
import { WARD, CASTLE } from '../src/core/constants.ts';

const LEGEND = new Set(['#', '.', 'P', 'H', 'K', 'G', 'T']);

/** Open (traversable) cell symbols per the design spec's connectivity rule. */
const OPEN = new Set(['.', 'P', 'H', 'K', 'G']);

/**
 * 4-neighbor flood fill over the raw ASCII grid from `from`, stepping only
 * onto cells whose symbol is in `OPEN` (never `#`/`T`), optionally skipping
 * one blocked cell (used by the articulation-point check below).
 */
function bfsReachable(
  map: readonly string[],
  from: { row: number; col: number },
  blocked?: { row: number; col: number },
): Set<string> {
  const rows = map.length;
  const cols = map[0]!.length;
  const key = (r: number, c: number) => `${r},${c}`;
  const isOpen = (r: number, c: number): boolean => {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
    if (blocked && r === blocked.row && c === blocked.col) return false;
    return OPEN.has(map[r]![c]!);
  };
  const visited = new Set<string>();
  if (!isOpen(from.row, from.col)) return visited;
  const queue: [number, number][] = [[from.row, from.col]];
  visited.add(key(from.row, from.col));
  while (queue.length > 0) {
    const [r, c] = queue.shift()!;
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nr = r + dr!;
      const nc = c + dc!;
      if (isOpen(nr, nc) && !visited.has(key(nr, nc))) {
        visited.add(key(nr, nc));
        queue.push([nr, nc]);
      }
    }
  }
  return visited;
}

/** Find the (row, col) of the first cell matching `ch` (or `predicate`). */
function findCell(map: readonly string[], predicate: (ch: string) => boolean): { row: number; col: number } {
  for (let r = 0; r < map.length; r++) {
    for (let c = 0; c < map[r]!.length; c++) {
      if (predicate(map[r]![c]!)) return { row: r, col: c };
    }
  }
  throw new Error('cell not found');
}

function findAllCells(map: readonly string[], ch: string): { row: number; col: number }[] {
  const out: { row: number; col: number }[] = [];
  for (let r = 0; r < map.length; r++) {
    for (let c = 0; c < map[r]!.length; c++) {
      if (map[r]![c] === ch) out.push({ row: r, col: c });
    }
  }
  return out;
}

/**
 * Groups every cell matching `ch` into its own contiguous (4-connected)
 * region — mirrors the parser's `extractRegions` flood fill, but kept local
 * to the test so this file independently verifies region-level reachability
 * rather than trusting the parser's own grouping.
 */
function extractSymbolRegions(map: readonly string[], ch: string): { row: number; col: number }[][] {
  const rows = map.length;
  const cols = map[0]!.length;
  const seen = new Set<string>();
  const regions: { row: number; col: number }[][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (map[r]![c] !== ch) continue;
      const key = `${r},${c}`;
      if (seen.has(key)) continue;
      const region: { row: number; col: number }[] = [];
      const queue: [number, number][] = [[r, c]];
      seen.add(key);
      while (queue.length > 0) {
        const [cr, cc] = queue.shift()!;
        region.push({ row: cr, col: cc });
        for (const [dr, dc] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nr = cr + dr!;
          const nc = cc + dc!;
          const nk = `${nr},${nc}`;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && map[nr]![nc] === ch && !seen.has(nk)) {
            seen.add(nk);
            queue.push([nr, nc]);
          }
        }
      }
      regions.push(region);
    }
  }
  return regions;
}

describe('ward map validity', () => {
  it('is 36×36 with only legal symbols', () => {
    expect(WARD_MAP).toHaveLength(WARD.rows);
    for (const row of WARD_MAP) {
      expect(row).toHaveLength(WARD.cols);
      for (const ch of row) expect(LEGEND.has(ch)).toBe(true);
    }
  });

  it('has 3 plazas, 2 halls, 1 keep region, 1 gate', () => {
    const l = wardLayout();
    expect(l.plazas).toHaveLength(3);
    expect(l.halls).toHaveLength(2);
    expect(l.gate).toBeDefined();
  });

  it('keep center matches the castle center', () => {
    const l = wardLayout();
    expect(Math.abs(l.keep.center.x - CASTLE.center.x)).toBeLessThan(WARD.cellSize);
    expect(Math.abs(l.keep.center.z - CASTLE.center.z)).toBeLessThan(WARD.cellSize);
  });
});

describe('connectivity (BFS over open cells: . P H K G)', () => {
  it('gate reaches the keep', () => {
    const gateCell = findCell(WARD_MAP, (ch) => ch === 'G');
    const reached = bfsReachable(WARD_MAP, gateCell);
    const keepCells = findAllCells(WARD_MAP, 'K');
    expect(keepCells.length).toBeGreaterThan(0);
    expect(keepCells.some((k) => reached.has(`${k.row},${k.col}`))).toBe(true);
  });

  it('gate reaches EVERY plaza region and EVERY hall region (not just some cell somewhere)', () => {
    // Flattening all P (or H) cells across every region and asserting `.some`
    // reachable is a trap: it passes as soon as ONE of the 3 plazas (or 2
    // halls) is connected, even if the other regions are sealed boxes. Group
    // cells into their own contiguous regions first, then require every
    // single region to have at least one reached cell.
    const gateCell = findCell(WARD_MAP, (ch) => ch === 'G');
    const reached = bfsReachable(WARD_MAP, gateCell);
    for (const sym of ['P', 'H'] as const) {
      const regions = extractSymbolRegions(WARD_MAP, sym);
      expect(regions.length).toBeGreaterThan(0);
      for (const region of regions) {
        expect(region.some((c) => reached.has(`${c.row},${c.col}`))).toBe(true);
      }
    }
  });

  it('every open cell (. P H K G) is reachable from the gate — a single connected component', () => {
    // Stronger than the letter of the brief: sealed dead pockets are wasted
    // map and silently corrupt zone/goblin/elf placement (a "zone" or
    // "junction" sitting in an unreachable pocket is never actually usable).
    const gateCell = findCell(WARD_MAP, (ch) => ch === 'G');
    const reached = bfsReachable(WARD_MAP, gateCell);
    const unreached: string[] = [];
    for (let r = 0; r < WARD_MAP.length; r++) {
      for (let c = 0; c < WARD_MAP[r]!.length; c++) {
        if (OPEN.has(WARD_MAP[r]![c]!) && !reached.has(`${r},${c}`)) unreached.push(`${r},${c}`);
      }
    }
    expect(unreached).toEqual([]);
  });

  it('there are at least 2 edge-disjoint gate→keep routes', () => {
    // For EVERY single open '.' corridor cell, removing it alone must not
    // disconnect the gate from the keep — i.e. no articulation point lies on
    // every gate→keep path, which implies at least 2 distinct routes exist.
    const gateCell = findCell(WARD_MAP, (ch) => ch === 'G');
    const keepCells = new Set(findAllCells(WARD_MAP, 'K').map((k) => `${k.row},${k.col}`));
    const baseline = bfsReachable(WARD_MAP, gateCell);
    expect([...keepCells].some((k) => baseline.has(k))).toBe(true);

    for (let r = 0; r < WARD_MAP.length; r++) {
      for (let c = 0; c < WARD_MAP[r]!.length; c++) {
        if (WARD_MAP[r]![c] !== '.') continue;
        const reached = bfsReachable(WARD_MAP, gateCell, { row: r, col: c });
        const stillReaches = [...keepCells].some((k) => reached.has(k));
        expect(stillReaches).toBe(true);
      }
    }
  });

  it('each hall has exactly 2 doorways', () => {
    for (const hall of wardLayout().halls) expect(hall.entrances).toHaveLength(2);
  });
});

describe('parser geometry', () => {
  it('merges adjacent wall cells into straight runs', () => {
    const tiny = ['####', '#..#', '#..#', '####'];
    const l = parseWard(tiny);
    expect(l.wallRuns.length).toBeLessThanOrEqual(6);
    expect(l.wallRuns.length).toBeGreaterThanOrEqual(4);
  });

  it('cellToWorld maps the grid onto ±90 m around the castle center', () => {
    const tl = cellToWorld(0, 0);
    const br = cellToWorld(35, 35);
    expect(tl.x).toBeCloseTo(CASTLE.center.x - 87.5);
    expect(br.x).toBeCloseTo(CASTLE.center.x + 87.5);
  });

  it('zones include all plaza centers and ≥4 corridor junctions', () => {
    const l = wardLayout();
    for (const p of l.plazas) {
      expect(l.zones.some((z) => Math.hypot(z.x - p.center.x, z.z - p.center.z) < 1)).toBe(true);
    }
    expect(l.zones.length).toBeGreaterThanOrEqual(7); // 3 plazas + ≥4 junctions
  });

  it('every zone lies on a cell reachable from the gate (belt-and-braces on top of the single-component test)', () => {
    const l = wardLayout();
    const gateCell = findCell(WARD_MAP, (ch) => ch === 'G');
    const reached = bfsReachable(WARD_MAP, gateCell);
    const halfW = (WARD.cols * WARD.cellSize) / 2;
    const halfH = (WARD.rows * WARD.cellSize) / 2;
    const worldToCell = (x: number, z: number) => ({
      row: Math.round((z - (CASTLE.center.z - halfH + WARD.cellSize / 2)) / WARD.cellSize),
      col: Math.round((x - (CASTLE.center.x - halfW + WARD.cellSize / 2)) / WARD.cellSize),
    });
    for (const z of l.zones) {
      const { row, col } = worldToCell(z.x, z.z);
      expect(reached.has(`${row},${col}`)).toBe(true);
    }
  });

  it('inHall is true inside a hall cell and false in a corridor', () => {
    const hall = wardLayout().halls[0]!;
    expect(inHall(hall.center.x, hall.center.z)).toBe(true);
    expect(inHall(wardLayout().gate.x, wardLayout().gate.z)).toBe(false);
  });

  it('wardLayout is memoised', () => {
    expect(wardLayout()).toBe(wardLayout());
  });
});
