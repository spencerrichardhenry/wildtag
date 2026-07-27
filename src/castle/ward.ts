import { CASTLE, WARD } from '../core/constants.ts';
import { coverSegment } from './layout.ts';
import type { Point2 } from './layout.ts';
import type { Obstacle } from '../player/collision.ts';
import type { GrappleCollider } from '../player/grapple.ts';
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

/**
 * True when (x, z) sits under a roofed hall AND `y` is at or below the
 * hall's roof line (`CASTLE.padHeight + WARD.wallH`) — Castle Ward
 * final-review Fix 2. `inHall` alone is 2D and has no notion of height, so
 * wiring `PlayerController.movementCeiling` to it directly suppressed glide
 * for a player passing HIGH ABOVE a hall's roof too (there's no collider up
 * there to actually stop them), cutting their glide and dropping them
 * through the roof mid-air. Gated here so only a player at or below roof
 * height loses glide/grapple under a hall — exactly the "no sky in here"
 * case the feature is meant to cover.
 */
export function inHallBelowRoof(x: number, z: number, y: number): boolean {
  return inHall(x, z) && y < CASTLE.padHeight + WARD.wallH;
}

// ---------------------------------------------------------------------------
// Ward wall collision (Castle Ward Task 3): collision circles packed along
// every non-ring wall run, bucketed into a memoised spatial hash so player /
// goblin / elf steps only ever scan a handful of nearby circles instead of
// the whole maze.
//
// END-EXTENSION CONVENTION — binding for Task 4's mesh builder too: a wall
// run's `{x1,z1}` → `{x2,z2}` are the CELL CENTERS of its first/last member
// cell (see `mergeWallRuns` above). For the physical wall to actually reach
// the cell's outer edge — so two perpendicular runs meet flush at a shared
// corner instead of leaving a diagonal gap — every run is extended by
// `WARD.cellSize / 2` beyond EACH endpoint, along its own direction, before
// circles are packed over it with `coverSegment` (exported from
// `layout.ts` — reused verbatim, not duplicated). Task 4 MUST mesh over this
// same extended span (raw endpoint ± cellSize/2 along the run's direction),
// not the raw run endpoints, or its meshes will show gaps at every corner
// the collision circles don't have.
//
// A zero-length run (`x1 === x2 && z1 === z2`) is an isolated single-cell
// pillar — a `#` cell with no adjacent wall cell in any of the 4 directions
// (the ward map deliberately drops a few lone pillars into open
// intersections). It has no direction to extend along and no corner to
// meet, so it degenerates to a single circle centered on the cell.
//
// Ring exclusion: the outer `#` ring (map row/col 0 and 35) sits on the same
// world line as the curtain wall (`CASTLE.half` = 90 m — see the Task 2
// review's seam note), which already has its own colliders
// (`castleObstacles`/`castleGrappleColliders`, layout.ts). A run is "ring"
// when ALL its cells lie on that boundary; such runs are excluded from
// emission here so the curtain-wall line isn't double-collided.
// ---------------------------------------------------------------------------

export type WallRun = WardLayout['wallRuns'][number];
type Circle = { x: number; z: number; r: number };

const RING_EPS = 1e-6;
// World-space corners of the outer ring (grid col/row 0 and cols-1/rows-1),
// used to test whether a run's constant x (vertical run) or z (horizontal
// run) sits on the boundary line — see the ring-exclusion note above.
const _ringCorner0 = cellToWorld(0, 0);
const _ringCornerMax = cellToWorld(WARD.cols - 1, WARD.rows - 1);

/** True when every cell of `run` lies on the outer ring (row/col 0 or 35). */
function isRingRun(run: WallRun): boolean {
  const onRingX =
    Math.abs(run.x1 - run.x2) < RING_EPS &&
    (Math.abs(run.x1 - _ringCorner0.x) < RING_EPS || Math.abs(run.x1 - _ringCornerMax.x) < RING_EPS);
  const onRingZ =
    Math.abs(run.z1 - run.z2) < RING_EPS &&
    (Math.abs(run.z1 - _ringCorner0.z) < RING_EPS || Math.abs(run.z1 - _ringCornerMax.z) < RING_EPS);
  return onRingX || onRingZ;
}

/**
 * Non-ring wall runs — the only ones that emit ward collision circles.
 * Exported (Castle Ward Task 4) so `builders.ts` meshes exactly the same set
 * of runs the collision layer collides — the curtain wall already owns the
 * outer ring, so meshing it again here would double it up.
 */
export function nonRingRuns(): WallRun[] {
  return wardLayout().wallRuns.filter((run) => !isRingRun(run));
}

/**
 * A wall run's mesh-ready span: endpoints extended `WARD.cellSize / 2` beyond
 * each raw endpoint along the run's own direction (the END-EXTENSION
 * CONVENTION above), or — for a zero-length (isolated pillar) run — the raw
 * cell center with `isPillar: true` and no direction to extend along.
 * Exported so `builders.ts`'s mesh builder uses this EXACT same span as the
 * collision circles below, corner-for-corner.
 */
export function extendedWallSpan(run: WallRun): { x1: number; z1: number; x2: number; z2: number; isPillar: boolean } {
  const dx = run.x2 - run.x1;
  const dz = run.z2 - run.z1;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return { x1: run.x1, z1: run.z1, x2: run.x2, z2: run.z2, isPillar: true };
  const ux = dx / len;
  const uz = dz / len;
  const half = WARD.cellSize / 2;
  return {
    x1: run.x1 - ux * half,
    z1: run.z1 - uz * half,
    x2: run.x2 + ux * half,
    z2: run.z2 + uz * half,
    isPillar: false,
  };
}

/**
 * Circle positions of radius `r` solidly covering one wall run, extended
 * `WARD.cellSize / 2` beyond each endpoint (the END-EXTENSION CONVENTION
 * documented above). Degenerates to a single centered circle for a
 * zero-length (isolated pillar) run. Built on top of `extendedWallSpan` so
 * the collision circles and Task 4's meshes can never drift apart.
 */
function runCircles(run: WallRun, r: number): Circle[] {
  const span = extendedWallSpan(run);
  if (span.isPillar) return [{ x: span.x1, z: span.z1, r }];

  const dx = span.x2 - span.x1;
  const dz = span.z2 - span.z1;
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  return coverSegment(len, r).map((off) => ({ x: span.x1 + ux * off, z: span.z1 + uz * off, r }));
}

let _wardObstacles: Obstacle[] | null = null;

/** Memoised ward-wall obstacle circles (`r = WARD.wallT`), ring runs excluded. */
function wardObstacles(): Obstacle[] {
  if (_wardObstacles) return _wardObstacles;
  const yTop = CASTLE.padHeight + WARD.wallH;
  const out: Obstacle[] = [];
  for (const run of nonRingRuns()) {
    for (const c of runCircles(run, WARD.wallT)) out.push({ x: c.x, z: c.z, r: c.r, yTop });
  }
  _wardObstacles = out;
  return out;
}

let _wardGrapple: GrappleCollider[] | null = null;

/** Memoised ward-wall grapple cylinders (`r = WARD.wallT * 1.5`), ring runs excluded. */
function wardGrappleColliders(): GrappleCollider[] {
  if (_wardGrapple) return _wardGrapple;
  const yBase = CASTLE.padHeight;
  const yTop = CASTLE.padHeight + WARD.wallH;
  const out: GrappleCollider[] = [];
  for (const run of nonRingRuns()) {
    for (const c of runCircles(run, WARD.wallT * 1.5)) out.push({ x: c.x, z: c.z, r: c.r, yBase, yTop });
  }
  _wardGrapple = out;
  return out;
}

/**
 * Spatial hash bucketing (memoised, built once): every circle is inserted
 * into EVERY bucket its disc (center ± r) overlaps, so a near-query centered
 * anywhere along a shared bucket boundary still sees a circle that straddles
 * it. A circle can therefore live in several buckets' arrays;
 * `queryNear` gathers the 9-bucket neighborhood and dedupes by object
 * identity so a caller never receives the same circle twice.
 */
function buildHash<T extends Circle>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const minBX = Math.floor((item.x - item.r) / WARD.hashCell);
    const maxBX = Math.floor((item.x + item.r) / WARD.hashCell);
    const minBZ = Math.floor((item.z - item.r) / WARD.hashCell);
    const maxBZ = Math.floor((item.z + item.r) / WARD.hashCell);
    for (let bx = minBX; bx <= maxBX; bx++) {
      for (let bz = minBZ; bz <= maxBZ; bz++) {
        const key = `${bx},${bz}`;
        let bucket = map.get(key);
        if (!bucket) {
          bucket = [];
          map.set(key, bucket);
        }
        bucket.push(item);
      }
    }
  }
  return map;
}

/** 9-bucket (3×3) neighborhood around (x, z), deduped by identity. */
function queryNear<T>(map: Map<string, T[]>, x: number, z: number): T[] {
  const bx = Math.floor(x / WARD.hashCell);
  const bz = Math.floor(z / WARD.hashCell);
  const seen = new Set<T>();
  const out: T[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const bucket = map.get(`${bx + dx},${bz + dz}`);
      if (!bucket) continue;
      for (const item of bucket) {
        if (seen.has(item)) continue;
        seen.add(item);
        out.push(item);
      }
    }
  }
  return out;
}

let _obstacleHash: Map<string, Obstacle[]> | null = null;
let _grappleHash: Map<string, GrappleCollider[]> | null = null;

/** Ward-wall obstacle circles in the 3×3 hash-bucket neighborhood of (x, z). */
export function wardObstaclesNear(x: number, z: number): Obstacle[] {
  if (!_obstacleHash) _obstacleHash = buildHash(wardObstacles());
  return queryNear(_obstacleHash, x, z);
}

/** Ward-wall grapple cylinders in the 3×3 hash-bucket neighborhood of (x, z). */
export function wardGrappleNear(x: number, z: number): GrappleCollider[] {
  if (!_grappleHash) _grappleHash = buildHash(wardGrappleColliders());
  return queryNear(_grappleHash, x, z);
}

// ---------------------------------------------------------------------------
// Maze-aware daze-ejection retreat path (daze-eject-spires design spec §1).
// The old dazed stumble walked radially away from CASTLE.center — built for
// the pre-ward open courtyard — so inside the maze the ward walls + post-step
// pushout cancelled the motion and the player jittered in place. `retreatPath`
// instead BFS's a real corridor route from the player's cell to the gate.
//
// The BFS runs ONCE, rooted at the (2-cell) gate, over every open cell — this
// gives shortest paths from the gate to ALL reachable cells in one pass, so a
// per-call `retreatPath` query is just an O(path length) walk of a memoised
// parent map (each non-gate cell's parent is its neighbor one step closer to
// the gate) rather than a fresh BFS every knockout.
// ---------------------------------------------------------------------------

type Cell = { row: number; col: number };

/** Inverse of `cellToWorld`: nearest grid cell for a world (x, z). May land
 *  outside [0, cols)×[0, rows) for a position well beyond the ward map. */
function worldToCell(x: number, z: number): Cell {
  const halfW = (WARD.cols * WARD.cellSize) / 2;
  const halfH = (WARD.rows * WARD.cellSize) / 2;
  return {
    col: Math.round((x - (CASTLE.center.x - halfW + WARD.cellSize / 2)) / WARD.cellSize),
    row: Math.round((z - (CASTLE.center.z - halfH + WARD.cellSize / 2)) / WARD.cellSize),
  };
}

interface RetreatIndex {
  /** cellKey → the neighboring cell one step closer to the gate. Gate cells
   *  themselves have no entry (they're the BFS roots). */
  parent: Map<string, Cell>;
  /** cellKeys of every gate cell (the map's gate is a 2-cell span). */
  gateKeys: Set<string>;
}

function cellKey(c: Cell): string {
  return `${c.row},${c.col}`;
}

function edgeKey(a: Cell, b: Cell): string {
  const ka = cellKey(a);
  const kb = cellKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/**
 * The keep's ONE real door (review fix — Critical: BFS was routing retreat
 * paths straight through solid keep walls). `castleObstacles()`/
 * `castleGrappleColliders()` (`layout.ts`) build the keep as a hollow room
 * whose 4 perimeter walls are solid `Obstacle` circles EXCEPT a gap cut into
 * the gate-facing wall (`gateWallIndex`, same side as the main gate) — but
 * the ward map's ASCII grid doesn't encode this at all: the `K` block is just
 * marked open floor with no per-edge wall data, so a BFS that treats every
 * `K`/non-`K` cell boundary as walkable "phase-through-wall"s the other 3
 * (real, solid) faces. A dazed player whose corridor route crossed one of
 * those phantom doorways would ram a real wall for the rest of the daze
 * window — exactly the original "jitters in place" bug, relocated to the
 * keep instead of the curtain wall.
 *
 * This castle site's gate (and so the keep entrance) is fixed on the EAST
 * side — `layout.ts`'s `gateWallIndex` derives that from `CASTLE.center`,
 * and `wardMap.ts`'s own header comment independently documents "G ...
 * east edge". The keep footprint is the 4×4 `K` block at grid cells
 * [16..19]×[16..19] (`wardMap.ts`); its one real door is the 2-cell gap
 * directly east of it, at rows 17–18 (col 19 ↔ col 20) — found by scanning
 * `WARD_MAP` for every open (non-`#`) cell orthogonally adjacent to a `K`
 * cell: only these two sit on the gate-facing (east) face, the other 6
 * (north face at cols 16/18/19, west face at rows 16/17/19) are phantom
 * doorways the ASCII grid left un-walled by omission.
 *
 * Hardcoded rather than re-derived from `castleLayout()` at runtime (ward.ts
 * stays a plain grid-BFS over `WARD_MAP`, no per-call geometry math), but
 * the "keep door matches castleLayout()'s entrance" test in ward.test.ts
 * cross-checks these literal cells against the real 3D entrance geometry —
 * so a future change to `CASTLE.center`/the keep's size that actually moves
 * the door fails loudly instead of silently reopening a phantom wall.
 */
const KEEP_DOOR_EDGES: ReadonlySet<string> = new Set([
  edgeKey({ row: 17, col: 19 }, { row: 17, col: 20 }),
  edgeKey({ row: 18, col: 19 }, { row: 18, col: 20 }),
]);

/** Multi-source BFS rooted at every `G` cell, over `WARD_MAP`'s open cells
 *  (`. P H K G`) — a `K`/non-`K` crossing is only legal via `KEEP_DOOR_EDGES`
 *  (see its doc) — building the retreat parent map once. */
function buildRetreatIndex(): RetreatIndex {
  const map = WARD_MAP;
  const gateCells: Cell[] = [];
  for (let r = 0; r < map.length; r++) {
    for (let c = 0; c < map[r]!.length; c++) {
      if (map[r]![c] === 'G') gateCells.push({ row: r, col: c });
    }
  }

  const gateKeys = new Set(gateCells.map(cellKey));
  const parent = new Map<string, Cell>();
  const visited = new Set<string>(gateKeys);
  const queue: Cell[] = [...gateCells];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    const curSym = cellAt(map, cur.row, cur.col)!;
    for (const [dr, dc] of NEIGHBORS) {
      const next = { row: cur.row + dr, col: cur.col + dc };
      const key = cellKey(next);
      if (visited.has(key)) continue;
      const sym = cellAt(map, next.row, next.col);
      if (sym === undefined || !OPEN.has(sym)) continue;
      const isKeepCrossing = (curSym === 'K') !== (sym === 'K'); // XOR: exactly one side is K
      if (isKeepCrossing && !KEEP_DOOR_EDGES.has(edgeKey(cur, next))) continue; // solid keep wall
      visited.add(key);
      parent.set(key, cur); // one step closer to a gate cell
      queue.push(next);
    }
  }

  return { parent, gateKeys };
}

let _retreatIndex: RetreatIndex | null = null;

/** Memoised `buildRetreatIndex()` result — built once, reused by every call. */
function retreatIndex(): RetreatIndex {
  if (!_retreatIndex) _retreatIndex = buildRetreatIndex();
  return _retreatIndex;
}

/**
 * Pure corridor path (world-coord cell-center waypoints) from the ward cell
 * at (x, z) to just outside the gate, walking the memoised BFS parent chain
 * gate-ward. Returns `[]` when (x, z) is outside the map/on a wall, or
 * already at the gate — the caller (main.ts's dazed stumble) falls back to
 * the old radial retreat in that case (used outside the castle region, where
 * there's no maze to navigate).
 *
 * The returned path always ends with the gate cell followed by one extra
 * waypoint `WARD.cellSize` (~1 corridor width) beyond it, outward along the
 * gate's outward-facing axis (+x — the ward map's gate sits on the east wall,
 * see `wardMap.ts`), so following the path all the way through visibly clears
 * the curtain-wall line instead of stopping dead on top of it.
 */
export function retreatPath(x: number, z: number): Point2[] {
  const start = worldToCell(x, z);
  const sym = cellAt(WARD_MAP, start.row, start.col);
  if (sym === undefined || !OPEN.has(sym)) return [];

  const { parent, gateKeys } = retreatIndex();
  const startKey = cellKey(start);
  if (gateKeys.has(startKey)) return []; // already at the gate

  const cells: Cell[] = [start];
  let curKey = startKey;
  while (!gateKeys.has(curKey)) {
    const p = parent.get(curKey);
    if (!p) return []; // unreachable (shouldn't happen — every open cell connects to the gate)
    cells.push(p);
    curKey = cellKey(p);
  }

  const waypoints = cells.map((c) => cellToWorld(c.col, c.row));
  waypoints.push(gateOutsidePoint());
  return waypoints;
}

/**
 * World point ~8 m (`WARD.cellSize * 1.6`) outside the gate, along its
 * outward-facing axis (+x — the ward map's gate sits on the east wall, see
 * `wardMap.ts`). Shared by `retreatPath`'s final waypoint and main.ts's
 * blackout-drag eject teleport (design spec §1), so both land on exactly the
 * same spot just clear of the curtain wall.
 */
export function gateOutsidePoint(): Point2 {
  const gate = wardLayout().gate;
  return { x: gate.x + WARD.cellSize * 1.6, z: gate.z };
}
