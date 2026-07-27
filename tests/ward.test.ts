import { describe, it, expect } from 'vitest';
import { WARD_MAP } from '../src/castle/wardMap.ts';
import {
  parseWard,
  wardLayout,
  inHall,
  inHallBelowRoof,
  cellToWorld,
  wardObstaclesNear,
  wardGrappleNear,
  retreatPath,
  gateOutsidePoint,
} from '../src/castle/ward.ts';
import { WARD, CASTLE, HEALTH } from '../src/core/constants.ts';
import { resolveCollision } from '../src/player/collision.ts';

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

  // Castle Ward final-review Fix 2: gliding OVER a hall roof used to still
  // trip the 2D `inHall` ceiling check and cut the glide mid-air (there's no
  // collider up there, so losing lift just dropped the player through the
  // roof). `inHallBelowRoof` adds the missing height gate — this is the
  // pure part of the fix; the full behavioral check (glide actually persists
  // while crossing above a hall, in the real headless build) is a separate
  // e2e/manual spot-check noted in the fix report.
  describe('inHallBelowRoof (final-review Fix 2: height-gated hall ceiling)', () => {
    it('suppresses (true) at a hall cell, at ground level (y = 102, below roof)', () => {
      const hall = wardLayout().halls[0]!;
      expect(inHallBelowRoof(hall.center.x, hall.center.z, 102)).toBe(true);
    });

    it('does NOT suppress (false) at the same (x, z), gliding above the roof (y = 110)', () => {
      const hall = wardLayout().halls[0]!;
      expect(inHallBelowRoof(hall.center.x, hall.center.z, 110)).toBe(false);
    });

    it('is false outside any hall footprint regardless of height', () => {
      const gate = wardLayout().gate;
      expect(inHallBelowRoof(gate.x, gate.z, 102)).toBe(false);
      expect(inHallBelowRoof(gate.x, gate.z, 110)).toBe(false);
    });

    it('the roof-height threshold is exactly CASTLE.padHeight + WARD.wallH', () => {
      const hall = wardLayout().halls[0]!;
      const roofY = CASTLE.padHeight + WARD.wallH;
      expect(inHallBelowRoof(hall.center.x, hall.center.z, roofY - 0.01)).toBe(true);
      expect(inHallBelowRoof(hall.center.x, hall.center.z, roofY + 0.01)).toBe(false);
    });
  });

  it('wardLayout is memoised', () => {
    expect(wardLayout()).toBe(wardLayout());
  });
});

describe('ward wall collision (Castle Ward Task 3)', () => {
  /** A genuinely interior (non-ring) multi-cell run: the outer ring's runs
   *  span most of the 36-cell grid (>= 165 m), so a length cap well below
   *  that reliably picks a real maze wall instead of the boundary. */
  function interiorRun(): { x1: number; z1: number; x2: number; z2: number } {
    const run = wardLayout().wallRuns.find((r) => {
      const isMulti = r.x1 !== r.x2 || r.z1 !== r.z2;
      if (!isMulti) return false;
      const len = Math.hypot(r.x2 - r.x1, r.z2 - r.z1);
      return len > 4 && len < 50;
    });
    if (!run) throw new Error('no interior multi-cell wall run found');
    return run;
  }

  it('near-query returns every circle within 10 m and nothing beyond 3 buckets', () => {
    const l = wardLayout();
    const run = l.wallRuns.find((r) => r.x1 !== r.x2 || r.z1 !== r.z2)!;
    const near = wardObstaclesNear(run.x1, run.z1);
    expect(near.length).toBeGreaterThan(0);
    for (const o of near) {
      expect(Math.hypot(o.x - run.x1, o.z - run.z1)).toBeLessThan(WARD.hashCell * 2.2);
    }

    // Exhaustive containment: every circle any nearby query point can see
    // within 10 m of (run.x1, run.z1) must also show up in `near` — sampled
    // via 8 neighbor points 10 m out (still inside the queried 3x3-bucket
    // neighborhood), so a circle the original query missed but a neighbor
    // catches would be exposed here.
    const offsets = [-10, 0, 10];
    const seenElsewhere = new Map<string, { x: number; z: number }>();
    for (const dx of offsets) {
      for (const dz of offsets) {
        if (dx === 0 && dz === 0) continue;
        for (const o of wardObstaclesNear(run.x1 + dx, run.z1 + dz)) {
          if (Math.hypot(o.x - run.x1, o.z - run.z1) < 10) {
            seenElsewhere.set(`${o.x.toFixed(3)},${o.z.toFixed(3)}`, o);
          }
        }
      }
    }
    const nearKeys = new Set(near.map((o) => `${o.x.toFixed(3)},${o.z.toFixed(3)}`));
    for (const key of seenElsewhere.keys()) expect(nearKeys.has(key)).toBe(true);
  });

  it('ward wall circles carry yTop = padHeight + wallH', () => {
    const gate = wardLayout().gate;
    const maze = interiorRun();
    const any = wardObstaclesNear(gate.x, gate.z).concat(wardObstaclesNear(maze.x1, maze.z1));
    expect(any.length).toBeGreaterThan(0);
    for (const o of any) expect(o.yTop).toBeCloseTo(CASTLE.padHeight + WARD.wallH);
  });

  it('ward grapple cylinders carry r = wallT * 1.5 and the same yBase/yTop band', () => {
    const maze = interiorRun();
    const near = wardGrappleNear(maze.x1, maze.z1);
    expect(near.length).toBeGreaterThan(0);
    for (const c of near) {
      expect(c.r).toBeCloseTo(WARD.wallT * 1.5);
      expect(c.yBase).toBeCloseTo(CASTLE.padHeight);
      expect(c.yTop).toBeCloseTo(CASTLE.padHeight + WARD.wallH);
    }
  });

  it('a walker cannot cross a ward wall', () => {
    const run = interiorRun();
    const isHoriz = run.z1 === run.z2;
    const midx = (run.x1 + run.x2) / 2;
    const midz = (run.z1 + run.z2) / 2;
    const normal = isHoriz ? { x: 0, z: 1 } : { x: 1, z: 0 };
    const signedSide = (p: { x: number; z: number }) =>
      Math.sign(normal.x * (p.x - midx) + normal.z * (p.z - midz));

    // Start a couple metres off the wall centerline, then step 0.05 m at a
    // time straight toward (and, if unblocked, through) the wall for 200
    // steps, resolving collision against the ward near-query each step.
    let pos = { x: midx + normal.x * 3, y: CASTLE.padHeight + 1, z: midz + normal.z * 3 };
    const startSide = signedSide(pos);
    expect(startSide).not.toBe(0);
    for (let i = 0; i < 200; i++) {
      const next = { x: pos.x - normal.x * 0.05, y: pos.y, z: pos.z - normal.z * 0.05 };
      pos = resolveCollision(next, 0.4, wardObstaclesNear(next.x, next.z));
    }
    expect(signedSide(pos)).toBe(startSide);
  });

  it('outer ring emits no ward circles (curtain wall owns it)', () => {
    // Query several ring-row/col cell centers (row 0, row 35, col 0) — none
    // should have a ward circle within half a cell of it; the curtain wall
    // (castleObstacles/castleGrappleColliders) already covers that line.
    const ringPoints = [cellToWorld(10, 0), cellToWorld(20, 35), cellToWorld(0, 15)];
    for (const p of ringPoints) {
      const near = wardObstaclesNear(p.x, p.z);
      for (const o of near) {
        expect(Math.hypot(o.x - p.x, o.z - p.z)).toBeGreaterThanOrEqual(WARD.cellSize / 2);
      }
    }
  });

  it('the gate is walkable — no ward circle within 2 m of the gate center', () => {
    const gate = wardLayout().gate;
    const near = wardObstaclesNear(gate.x, gate.z);
    for (const o of near) {
      expect(Math.hypot(o.x - gate.x, o.z - gate.z)).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('retreatPath (daze-eject-spires design spec §1: maze-aware daze ejection)', () => {
  // Row 1, col 1 is a '.' corridor cell deep in the NW of the map, about as
  // far from the gate (row 17/18, col 35, east edge) as the maze gets.
  const deepCell = { row: 1, col: 1 };
  const deepWorld = cellToWorld(deepCell.col, deepCell.row);

  it('is deterministic and memoised (same result every call)', () => {
    const a = retreatPath(deepWorld.x, deepWorld.z);
    const b = retreatPath(deepWorld.x, deepWorld.z);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it('from a deep corridor cell, returns a non-empty path ending outside the wall line', () => {
    const path = retreatPath(deepWorld.x, deepWorld.z);
    expect(path.length).toBeGreaterThan(1);
    const last = path[path.length - 1]!;
    // Outside the curtain wall's Chebyshev square (CASTLE.half).
    expect(Math.max(Math.abs(last.x - CASTLE.center.x), Math.abs(last.z - CASTLE.center.z))).toBeGreaterThan(
      CASTLE.half,
    );
    expect(last).toEqual(gateOutsidePoint());
  });

  it('every consecutive pair of cell waypoints (all but the final outside-gate leg) are adjacent open cells', () => {
    const path = retreatPath(deepWorld.x, deepWorld.z);
    // The last waypoint is the outside-gate point, not a cell center — check
    // adjacency over every OTHER consecutive pair (cell-to-cell hops).
    for (let i = 0; i < path.length - 2; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const dist = Math.hypot(b.x - a.x, b.z - a.z);
      expect(dist).toBeCloseTo(WARD.cellSize);
    }
  });

  it('starting already at the gate returns []', () => {
    const gate = wardLayout().gate;
    expect(retreatPath(gate.x, gate.z)).toEqual([]);
  });

  it('a position outside the map/walls returns []', () => {
    // Well beyond the ±90 m ward interior.
    expect(retreatPath(CASTLE.center.x + 500, CASTLE.center.z + 500)).toEqual([]);
    // On a wall cell (row 0, col 10 is part of the outer `#` ring).
    const wallPoint = cellToWorld(10, 0);
    expect(retreatPath(wallPoint.x, wallPoint.z)).toEqual([]);
  });

  it('gateOutsidePoint sits ~8m outside the gate along its outward (+x) axis', () => {
    const gate = wardLayout().gate;
    const out = gateOutsidePoint();
    expect(out.z).toBeCloseTo(gate.z);
    expect(out.x - gate.x).toBeCloseTo(WARD.cellSize * 1.6);
  });
});

describe('daze stumble kinematics (regression: maze-aware retreat actually makes progress)', () => {
  // Row 1, col 1 — the same deep NW corridor cell as above.
  const startCell = { row: 1, col: 1 };

  it('steering along retreatPath waypoints at HEALTH.stumbleSpeed, with wardObstaclesNear collision resolved every step, ends meaningfully closer to the gate with no step pinned', () => {
    const start = cellToWorld(startCell.col, startCell.row);
    const path = retreatPath(start.x, start.z);
    expect(path.length).toBeGreaterThan(2);

    const gate = wardLayout().gate;
    const startDistToGate = Math.hypot(start.x - gate.x, start.z - gate.z);

    let pos = { x: start.x, z: start.z };
    let waypointIdx = 0;
    const dt = 1 / 60;
    const steps = Math.round(4 / dt); // 4 s daze window
    let totalDisplacement = 0;

    for (let i = 0; i < steps; i++) {
      let target = path[waypointIdx]!;
      let dx = target.x - pos.x;
      let dz = target.z - pos.z;
      while (Math.hypot(dx, dz) < 1 && waypointIdx < path.length - 1) {
        waypointIdx++;
        target = path[waypointIdx]!;
        dx = target.x - pos.x;
        dz = target.z - pos.z;
      }
      const len = Math.hypot(dx, dz) || 1;
      const vx = (dx / len) * HEALTH.stumbleSpeed;
      const vz = (dz / len) * HEALTH.stumbleSpeed;
      const next = { x: pos.x + vx * dt, y: CASTLE.padHeight + 1, z: pos.z + vz * dt };
      const resolved = resolveCollision(next, 0.4, wardObstaclesNear(next.x, next.z));
      totalDisplacement += Math.hypot(resolved.x - pos.x, resolved.z - pos.z);
      pos = { x: resolved.x, z: resolved.z };
    }

    // Waypoint index advanced several steps along the route (not stuck at 0).
    expect(waypointIdx).toBeGreaterThanOrEqual(4);
    // Net motion isn't a stalled jitter — averages well above a stroll.
    const avgPerSecond = totalDisplacement / 4;
    expect(avgPerSecond).toBeGreaterThan(3);
    // Actually closer to the gate than the start, not just churning in place.
    const endDistToGate = Math.hypot(pos.x - gate.x, pos.z - gate.z);
    expect(endDistToGate).toBeLessThan(startDistToGate - 10);
  });
});
