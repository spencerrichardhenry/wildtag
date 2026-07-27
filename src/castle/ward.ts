import { CASTLE, WARD } from '../core/constants.ts';
import type { Point2 } from './layout.ts';
import { WARD_MAP } from './wardMap.ts';

// ---------------------------------------------------------------------------
// Castle Ward maze — PURE parser over the hand-authored ASCII map
// (`src/castle/wardMap.ts`). No `three` import; every consumer (builders,
// obstacle near-queries, goblin zone assignment, `inHall`) reads from the
// memoised `wardLayout()`.
//
// Legend: # wall · . corridor · P plaza · H roofed hall · K keep footprint ·
// G gate opening · T corner tower anchor.
//
// Grid → world: cell (col, row) maps onto a `WARD.cellSize`-metre square
// centered on `CASTLE.center`, col→x (east), row→z (south), matching the
// project's +x East / +z South convention used throughout `layout.ts`.
// ---------------------------------------------------------------------------

const OPEN = new Set(['.', 'P', 'H', 'K', 'G']);
const LEGEND = new Set(['#', '.', 'P', 'H', 'K', 'G', 'T']);

export interface WardLayout {
  /** Merged straight runs of adjacent `#` wall cells, in world coords. */
  wallRuns: { x1: number; z1: number; x2: number; z2: number }[];
  /** 3 plazas: member cells (world coords of cell centers) + centroid. */
  plazas: { cells: Point2[]; center: Point2 }[];
  /** 2 halls: member cells + centroid + the open cells adjacent through a doorway gap. */
  halls: { cells: Point2[]; center: Point2; entrances: Point2[] }[];
  keep: { center: Point2 };
  /** Goblin zone homes: plaza centers + corridor-junction cells. */
  zones: Point2[];
  /** World position of the (single, 2-cell-span) gate. */
  gate: Point2;
}

/**
 * Maps a grid cell (col, row) to its world-space center, spanning
 * ±(WARD.cols * WARD.cellSize) / 2 around `CASTLE.center` — col→x (east),
 * row→z (south). Exported for tests; also used internally by the parser.
 */
export function cellToWorld(col: number, row: number): Point2 {
  const halfW = (WARD.cols * WARD.cellSize) / 2;
  const halfH = (WARD.rows * WARD.cellSize) / 2;
  return {
    x: CASTLE.center.x - halfW + WARD.cellSize / 2 + col * WARD.cellSize,
    z: CASTLE.center.z - halfH + WARD.cellSize / 2 + row * WARD.cellSize,
  };
}

const NEIGHBORS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function inBounds(map: readonly string[], row: number, col: number): boolean {
  return row >= 0 && row < map.length && col >= 0 && col < (map[0]?.length ?? 0);
}

function cellAt(map: readonly string[], row: number, col: number): string | undefined {
  return inBounds(map, row, col) ? map[row]![col] : undefined;
}

/** Flood-fill every contiguous region of cells matching `sym` (4-connected). */
function extractRegions(map: readonly string[], sym: string): { row: number; col: number }[][] {
  const rows = map.length;
  const cols = map[0]?.length ?? 0;
  const seen = new Set<string>();
  const regions: { row: number; col: number }[][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (map[r]![c] !== sym) continue;
      const key = `${r},${c}`;
      if (seen.has(key)) continue;
      const region: { row: number; col: number }[] = [];
      const queue: [number, number][] = [[r, c]];
      seen.add(key);
      while (queue.length > 0) {
        const [cr, cc] = queue.shift()!;
        region.push({ row: cr, col: cc });
        for (const [dr, dc] of NEIGHBORS) {
          const nr = cr + dr;
          const nc = cc + dc;
          const nk = `${nr},${nc}`;
          if (cellAt(map, nr, nc) === sym && !seen.has(nk)) {
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

function regionCenter(region: { row: number; col: number }[]): Point2 {
  let sx = 0;
  let sz = 0;
  for (const { row, col } of region) {
    const w = cellToWorld(col, row);
    sx += w.x;
    sz += w.z;
  }
  return { x: sx / region.length, z: sz / region.length };
}

/**
 * Merged straight runs of `#` wall cells. A horizontal pass finds runs of
 * length >= 2 along a row; whatever `#` cells aren't claimed by a horizontal
 * run are grouped into vertical runs (length >= 1, so a lone `#` still
 * becomes its own 1-cell run — every wall cell belongs to exactly one run).
 */
function mergeWallRuns(map: readonly string[]): { x1: number; z1: number; x2: number; z2: number }[] {
  const rows = map.length;
  const cols = map[0]?.length ?? 0;
  const claimed = new Set<string>();
  const runs: { x1: number; z1: number; x2: number; z2: number }[] = [];

  // Horizontal runs (length >= 2).
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      if (map[r]![c] !== '#') {
        c++;
        continue;
      }
      let end = c;
      while (end + 1 < cols && map[r]![end + 1] === '#') end++;
      if (end > c) {
        for (let k = c; k <= end; k++) claimed.add(`${r},${k}`);
        const a = cellToWorld(c, r);
        const b = cellToWorld(end, r);
        runs.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z });
      }
      c = end + 1;
    }
  }

  // Vertical runs over whatever `#` cells a horizontal run didn't claim
  // (length >= 1 — a lone unclaimed `#` becomes its own 1-cell run).
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      if (map[r]![c] !== '#' || claimed.has(`${r},${c}`)) {
        r++;
        continue;
      }
      let end = r;
      while (end + 1 < rows && map[end + 1]![c] === '#' && !claimed.has(`${end + 1},${c}`)) end++;
      for (let k = r; k <= end; k++) claimed.add(`${k},${c}`);
      const a = cellToWorld(c, r);
      const b = cellToWorld(c, end);
      runs.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z });
      r = end + 1;
    }
  }

  return runs;
}

/**
 * For a hall region, find its doorways: open non-`H` cells orthogonally
 * adjacent to an `H` cell of this region (a gap in the hall's `#`
 * perimeter — if the perimeter were solid there'd be no open cell to find).
 */
function findHallEntrances(map: readonly string[], region: { row: number; col: number }[]): Point2[] {
  const memberKeys = new Set(region.map((c) => `${c.row},${c.col}`));
  const seen = new Set<string>();
  const entrances: Point2[] = [];
  for (const { row, col } of region) {
    for (const [dr, dc] of NEIGHBORS) {
      const nr = row + dr;
      const nc = col + dc;
      const key = `${nr},${nc}`;
      if (memberKeys.has(key) || seen.has(key)) continue;
      const sym = cellAt(map, nr, nc);
      if (sym !== undefined && sym !== 'H' && OPEN.has(sym)) {
        seen.add(key);
        entrances.push(cellToWorld(nc, nr));
      }
    }
  }
  return entrances;
}

/** True when an open cell has >= `min` orthogonal open neighbors. */
function openNeighborCount(map: readonly string[], row: number, col: number): number {
  let n = 0;
  for (const [dr, dc] of NEIGHBORS) {
    const sym = cellAt(map, row + dr, col + dc);
    if (sym !== undefined && OPEN.has(sym)) n++;
  }
  return n;
}

/**
 * Pure builder: parse an arbitrary rectangular ASCII map into a WardLayout.
 * Accepts any rectangular map (tests use tiny fixtures) — only the
 * `WARD_MAP` validity test enforces the real 36×36 dimensions. Throws if the
 * map isn't rectangular or contains a symbol outside the legend.
 */
export function parseWard(map: readonly string[]): WardLayout {
  if (map.length === 0) throw new Error('parseWard: empty map');
  const width = map[0]!.length;
  for (const row of map) {
    if (row.length !== width) throw new Error('parseWard: map rows must all share one width');
    for (const ch of row) {
      if (!LEGEND.has(ch)) throw new Error(`parseWard: illegal symbol "${ch}"`);
    }
  }

  const wallRuns = mergeWallRuns(map);

  const plazaRegions = extractRegions(map, 'P');
  const plazas = plazaRegions.map((region) => ({
    cells: region.map((c) => cellToWorld(c.col, c.row)),
    center: regionCenter(region),
  }));

  const hallRegions = extractRegions(map, 'H');
  const halls = hallRegions.map((region) => ({
    cells: region.map((c) => cellToWorld(c.col, c.row)),
    center: regionCenter(region),
    entrances: findHallEntrances(map, region),
  }));

  const keepRegions = extractRegions(map, 'K');
  const keepCenter =
    keepRegions.length > 0
      ? regionCenter(keepRegions.flat())
      : { x: CASTLE.center.x, z: CASTLE.center.z };
  const keep = { center: keepCenter };

  const gateRegions = extractRegions(map, 'G');
  const gateCells = gateRegions.flat();
  const gate =
    gateCells.length > 0
      ? regionCenter(gateCells)
      : { x: CASTLE.center.x, z: CASTLE.center.z };

  // Junctions: open '.' cells with >= 3 open orthogonal neighbors. Capped to
  // a deterministic subset if huge: every junction if < 40, else every 2nd
  // in row-major scan order (keeps `zones` a manageable goblin-home count
  // without losing determinism or even coverage across the map).
  const junctionCells: Point2[] = [];
  let junctionCount = 0;
  for (let r = 0; r < map.length; r++) {
    for (let c = 0; c < width; c++) {
      if (map[r]![c] !== '.') continue;
      if (openNeighborCount(map, r, c) >= 3) junctionCount++;
    }
  }
  const stride = junctionCount < 40 ? 1 : 2;
  let seenJunctions = 0;
  for (let r = 0; r < map.length; r++) {
    for (let c = 0; c < width; c++) {
      if (map[r]![c] !== '.') continue;
      if (openNeighborCount(map, r, c) < 3) continue;
      if (seenJunctions % stride === 0) junctionCells.push(cellToWorld(c, r));
      seenJunctions++;
    }
  }

  const zones = [...plazas.map((p) => p.center), ...junctionCells];

  return { wallRuns, plazas, halls, keep, zones, gate };
}

let _cached: WardLayout | null = null;

/** Memoised `parseWard(WARD_MAP)` — the real, hand-authored ward layout. */
export function wardLayout(): WardLayout {
  if (!_cached) {
    _cached = parseWard(WARD_MAP);
  }
  return _cached;
}

/** True when (x, z) falls inside any hall region's cell footprint. */
export function inHall(x: number, z: number): boolean {
  const l = wardLayout();
  const half = WARD.cellSize / 2;
  for (const hall of l.halls) {
    for (const cell of hall.cells) {
      if (Math.abs(x - cell.x) <= half && Math.abs(z - cell.z) <= half) return true;
    }
  }
  return false;
}
