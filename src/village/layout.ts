import { VILLAGE, WORLD_SEED } from '../core/constants.ts';
import { mulberry32 } from '../core/rng.ts';
import { biomeAt, heightAt } from '../world/terrain.ts';

// ---------------------------------------------------------------------------
// Haven Village layout — PURE, deterministic from WORLD_SEED. No `three` import:
// this is plain-data placement that both the mesh layer (buildings.ts / npcs.ts)
// and the tests consume. The village centre is snapped to the flattest meadow
// pocket near VILLAGE.nominalCenter (sampling the ground-truth `heightAt`), then
// 5 buildings are ringed around a central plaza with dirt paths, lamp posts, a
// fenced farm plot grid and a pen beside each home. Everything is computed once
// and memoised (`villageLayout()`); `computeVillageLayout()` is the pure builder
// the determinism test calls twice.
// ---------------------------------------------------------------------------

export type BuildingKind = 'farmhouse' | 'barter' | 'home';

export interface Point2 {
  x: number;
  z: number;
}

export interface BuildingPlacement {
  id: string;
  kind: BuildingKind;
  /** Footprint centre (m). */
  x: number;
  z: number;
  /** Yaw (rad): the +Z (front / door) face turns toward the plaza. */
  rot: number;
  /** Footprint width (local X) and depth (local Z), m. */
  w: number;
  d: number;
  /** Door position (m) on the plaza-facing wall — where a path meets the building. */
  door: Point2;
}

export interface Pen {
  homeId: string;
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface FarmPlot {
  index: number;
  x: number;
  z: number;
  unlocked: boolean;
}

export interface Path {
  /** Polyline from a building door to the plaza; last point is the plaza centre. */
  points: Point2[];
}

export interface FenceSeg {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export interface VillageLayout {
  center: Point2;
  plaza: { x: number; z: number; r: number };
  buildings: BuildingPlacement[];
  pens: Pen[];
  farm: { origin: Point2; plots: FarmPlot[] };
  paths: Path[];
  lamps: Point2[];
  fences: FenceSeg[];
}

/** Height range (max − min) over a square window sampled on a coarse stencil. */
function heightRange(cx: number, cz: number, half: number, samples: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < samples; j++) {
      const x = cx - half + (2 * half * i) / (samples - 1);
      const z = cz - half + (2 * half * j) / (samples - 1);
      const h = heightAt(x, z);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  return hi - lo;
}

/**
 * Snap the nominal centre to the flattest meadow pocket within searchRadius —
 * pure & deterministic (samples `heightAt`/`biomeAt`, no PRNG). Candidates that
 * aren't meadow are skipped; the min-variance meadow candidate wins (nominal
 * centre as the guaranteed fallback).
 */
export function findVillageCenter(): Point2 {
  const { nominalCenter: n, searchRadius, searchStep, flatWindow, flatSamples } = VILLAGE;
  let best: Point2 = { ...n };
  let bestRange = heightRange(n.x, n.z, flatWindow, flatSamples);
  for (let dx = -searchRadius; dx <= searchRadius; dx += searchStep) {
    for (let dz = -searchRadius; dz <= searchRadius; dz += searchStep) {
      const x = n.x + dx;
      const z = n.z + dz;
      if (biomeAt(x, z) !== 'meadow') continue;
      const range = heightRange(x, z, flatWindow, flatSamples);
      if (range < bestRange) {
        bestRange = range;
        best = { x, z };
      }
    }
  }
  return best;
}

/** Yaw whose +Z (front) face points from `pos` toward `target`. */
function faceYaw(pos: Point2, target: Point2): number {
  // Model forward is (−sin yaw, −cos yaw) (critter/manager convention); solve for
  // yaw so forward aligns with (target − pos) in the XZ plane.
  const dx = target.x - pos.x;
  const dz = target.z - pos.z;
  return Math.atan2(-dx, -dz);
}

/** The 5 buildings, ringed at fixed base angles (even 72° spacing). */
const SLOTS: { id: string; kind: BuildingKind; angle: number }[] = [
  { id: 'farmhouse', kind: 'farmhouse', angle: Math.PI / 2 }, // south of plaza (+z)
  { id: 'home1', kind: 'home', angle: Math.PI / 2 + (2 * Math.PI) / 5 },
  { id: 'barter', kind: 'barter', angle: Math.PI / 2 + (4 * Math.PI) / 5 },
  { id: 'home2', kind: 'home', angle: Math.PI / 2 + (6 * Math.PI) / 5 },
  { id: 'home3', kind: 'home', angle: Math.PI / 2 + (8 * Math.PI) / 5 },
];

/** Pure builder: recompute the whole layout from WORLD_SEED (memoised below). */
export function computeVillageLayout(): VillageLayout {
  const center = findVillageCenter();
  const rng = mulberry32((WORLD_SEED ^ 0x5a11a6e) >>> 0);
  const plaza = { x: center.x, z: center.z, r: VILLAGE.plazaRadius };

  const buildings: BuildingPlacement[] = [];
  const pens: Pen[] = [];
  const paths: Path[] = [];

  for (const slot of SLOTS) {
    const fp = VILLAGE.footprints[slot.kind];
    const angle = slot.angle + (rng() - 0.5) * 2 * VILLAGE.angleJitter;
    const radius = VILLAGE.ringRadius + (rng() - 0.5) * 2 * VILLAGE.radiusJitter;
    const x = center.x + Math.cos(angle) * radius;
    const z = center.z + Math.sin(angle) * radius;
    const rot = faceYaw({ x, z }, plaza);
    // Door sits on the +Z (front) face, i.e. along the model-forward toward plaza.
    const fwdX = -Math.sin(rot);
    const fwdZ = -Math.cos(rot);
    const door: Point2 = { x: x + fwdX * (fp.d / 2), z: z + fwdZ * (fp.d / 2) };
    buildings.push({ id: slot.id, kind: slot.kind, x, z, rot, w: fp.w, d: fp.d, door });

    // A gently kinked dirt path from the door to the plaza centre.
    const mid: Point2 = { x: (door.x + plaza.x) / 2, z: (door.z + plaza.z) / 2 };
    paths.push({ points: [{ ...door }, mid, { x: plaza.x, z: plaza.z }] });

    // Home pens sit just outward (away from the plaza) of each home.
    if (slot.kind === 'home') {
      const outX = Math.cos(angle);
      const outZ = Math.sin(angle);
      const dist = fp.d / 2 + VILLAGE.pen.gap + VILLAGE.pen.d / 2;
      pens.push({
        homeId: slot.id,
        x: x + outX * dist,
        z: z + outZ * dist,
        w: VILLAGE.pen.w,
        d: VILLAGE.pen.d,
      });
    }
  }

  // Farm plot grid outward of the farmhouse.
  const farmhouse = buildings.find((b) => b.kind === 'farmhouse')!;
  const fAngle = Math.atan2(farmhouse.z - center.z, farmhouse.x - center.x);
  const origin: Point2 = {
    x: farmhouse.x + Math.cos(fAngle) * VILLAGE.farm.offset,
    z: farmhouse.z + Math.sin(fAngle) * VILLAGE.farm.offset,
  };
  const { cols, rows, spacing, unlocked } = VILLAGE.farm;
  const plots: FarmPlot[] = [];
  const gw = (cols - 1) * spacing;
  const gd = (rows - 1) * spacing;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const index = r * cols + c;
      plots.push({
        index,
        x: origin.x - gw / 2 + c * spacing,
        z: origin.z - gd / 2 + r * spacing,
        unlocked: index < unlocked,
      });
    }
  }

  // Fence loop around the plot grid bounding box.
  const m = VILLAGE.farm.fenceMargin + VILLAGE.farm.tile / 2;
  const minX = origin.x - gw / 2 - m;
  const maxX = origin.x + gw / 2 + m;
  const minZ = origin.z - gd / 2 - m;
  const maxZ = origin.z + gd / 2 + m;
  const fences: FenceSeg[] = [
    { x1: minX, z1: minZ, x2: maxX, z2: minZ },
    { x1: maxX, z1: minZ, x2: maxX, z2: maxZ },
    { x1: maxX, z1: maxZ, x2: minX, z2: maxZ },
    { x1: minX, z1: maxZ, x2: minX, z2: minZ },
  ];

  // Lamp posts ringed around the plaza (offset so they sit between the paths).
  const lamps: Point2[] = [];
  for (let i = 0; i < VILLAGE.lampCount; i++) {
    const a = (i / VILLAGE.lampCount) * Math.PI * 2 + Math.PI / VILLAGE.lampCount;
    lamps.push({
      x: center.x + Math.cos(a) * VILLAGE.lampRadius,
      z: center.z + Math.sin(a) * VILLAGE.lampRadius,
    });
  }

  return { center, plaza, buildings, pens, farm: { origin, plots }, paths, lamps, fences };
}

let _cached: VillageLayout | null = null;

/** Memoised village layout (computed once per session). */
export function villageLayout(): VillageLayout {
  if (!_cached) _cached = computeVillageLayout();
  return _cached;
}

/** The (snapped) village centre. */
export function villageCenter(): Point2 {
  return villageLayout().center;
}

/** True when (x, z) lies within the village influence radius (spawn exclusion). */
export function inVillage(x: number, z: number): boolean {
  const c = villageCenter();
  return Math.hypot(x - c.x, z - c.z) <= VILLAGE.radius;
}
