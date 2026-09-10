import { UNDERWATER } from '../core/constants.ts';
import type { Vec3 } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Pure authored layout for the Atlantis shelf. Fixed ids are part of the save
// contract: purified clam id 2003 must still be turtle 2003 after a reload.
// ---------------------------------------------------------------------------

/** True inside the turquoise lagoon where vertical swimming is allowed. */
export function inDiveZone(x: number, z: number): boolean {
  return Math.hypot(x - UNDERWATER.center.x, z - UNDERWATER.center.z) <= UNDERWATER.diveRadius;
}
/** Smooth [0,1] basin authoring weight: 1 on the castle shelf, 0 outside. */
export function basinWeight(x: number, z: number): number {
  const d = Math.hypot(x - UNDERWATER.center.x, z - UNDERWATER.center.z);
  if (d <= UNDERWATER.basinFlatRadius) return 1;
  if (d >= UNDERWATER.basinBlendRadius) return 0;
  const t = (d - UNDERWATER.basinFlatRadius) /
    (UNDERWATER.basinBlendRadius - UNDERWATER.basinFlatRadius);
  const smooth = t * t * t * (t * (t * 6 - 15) + 10);
  return 1 - smooth;
}

/** Safe surface point at the island-facing edge of the marked lagoon. */
export function diveEntryPoint(): Vec3 {
  const c = UNDERWATER.center;
  const len = Math.hypot(c.x, c.z) || 1;
  const r = UNDERWATER.diveRadius - 18;
  return {
    x: c.x - (c.x / len) * r,
    y: UNDERWATER.surfaceY,
    z: c.z - (c.z / len) * r,
  };
}

export interface UnderwaterSpawn {
  id: number;
  x: number;
  z: number;
  /** Height above the authored seabed (not world Y). */
  lift: number;
  yaw: number;
}

/** Clam guards ring the palace doors, broken arches, and treasure court. */
export function clamSpawns(): UnderwaterSpawn[] {
  const c = UNDERWATER.center;
  const local: [number, number, number][] = [
    [-28, -24, 0.2],
    [0, -34, 0],
    [28, -24, -0.2],
    [-47, 6, Math.PI / 2],
    [42, 4, -Math.PI / 2],
    [-34, 48, Math.PI],
    [0, 45, Math.PI],
    [28, 38, Math.PI],
  ];
  return local.slice(0, UNDERWATER.clamCount).map(([x, z, yaw], i) => ({
    id: 2000 + i,
    x: c.x + x,
    z: c.z + z,
    lift: 1.05,
    yaw,
  }));
}

/** Crocodiles patrol the outer reef approaches rather than the palace floor. */
export function crocSpawns(): UnderwaterSpawn[] {
  const c = UNDERWATER.center;
  const local: [number, number, number, number][] = [
    [-92, -66, 5, 0.4],
    [96, -58, 7, -0.8],
    [-112, 44, 4, 1.8],
    [92, 76, 6, -2.2],
    [8, 118, 8, Math.PI],
  ];
  return local.slice(0, UNDERWATER.crocCount).map(([x, z, lift, yaw], i) => ({
    id: 3000 + i,
    x: c.x + x,
    z: c.z + z,
    lift,
    yaw,
  }));
}
