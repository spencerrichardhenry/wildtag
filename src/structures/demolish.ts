import type { Vec3 } from '../core/types.ts';
import { pieceAtRayHit, type BuildPiece, type PieceKind } from './buildmath.ts';
import type { PlacedZipline } from './ziplines.ts';

// ---------------------------------------------------------------------------
// Destruction ("demolish") mode — playtest Task 9. Unifies aim-and-click
// target selection for the two RAY-testable reclaimable systems: build
// pieces (`pieceAtRayHit`'s existing AABB sweep) and zipline posts (tested
// here as generous spheres, since neither system tracks per-instance mesh
// geometry precise enough to hit exactly). Pure/three-free like
// `buildmath.ts` so "nearest target wins" is directly unit-testable; main.ts
// gathers the live snapshots (`build.pieces()`, `ziplines.list()`) and calls
// `demolishTargetAt` fresh whenever it needs the current aim (both the LMB
// reclaim handler and the HUD prompt/crosshair label call it independently —
// the same redundant-but-cheap pattern main.ts already uses for
// `build.aimedPiece`, see its call sites in render()/update()).
//
// DRONES ARE DELIBERATELY NOT HANDLED HERE. A drone station-keeps at
// `STRUCTURES.droneHover` (25 m) above the ground it was placed over — far
// past any distance a player can stand from it while still aiming a short
// ray at it from the ground (`DEMOLISH.range` is 10 m). Like the pre-existing
// hold-F recall, a drone reclaims by PROXIMITY instead: main.ts checks
// `DroneSystem.recallableIdNear(player.pos)` (standing beneath one, within
// `STRUCTURES.droneRecallRange`) as a separate, higher-priority branch before
// ever calling into this module — see main.ts's `tryDemolishReclaim`.
// ---------------------------------------------------------------------------

export type DemolishHit =
  | { system: 'build'; id: number; kind: PieceKind; label: string; dist: number }
  | { system: 'zipline'; id: string; end: 'a' | 'b'; label: string; dist: number };

const PIECE_LABEL: Record<PieceKind, string> = { wall: 'Wall', ramp: 'Ramp', cube: 'Cube' };

/**
 * Nearest ray-sphere intersection distance (t along the normalized `dir`) of
 * a sphere centred at `center`, or `null` on a miss or beyond `maxDist`. Same
 * near-root-then-far-root-then-clamp-to-0 formula as
 * `AnchorRegistry.raycastAnchors` (firing from inside the sphere counts as an
 * immediate hit) — duplicated rather than imported because that class is a
 * *registry* (owns its own anchor map + polled `getPos` callbacks with no
 * caller-visible "just test this one point" entry point); this is a one-shot
 * pure query over a caller-supplied point, with no registry lifecycle to
 * share.
 */
export function raySphereT(
  origin: Vec3,
  dir: Vec3,
  center: Vec3,
  radius: number,
  maxDist: number,
): number | null {
  const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const dx = dir.x / dl;
  const dy = dir.y / dl;
  const dz = dir.z / dl;
  const mx = origin.x - center.x;
  const my = origin.y - center.y;
  const mz = origin.z - center.z;
  const b = mx * dx + my * dy + mz * dz;
  const cc = mx * mx + my * my + mz * mz - radius * radius;
  const disc = b * b - cc;
  if (disc < 0) return null; // ray misses the sphere entirely
  const sq = Math.sqrt(disc);
  let t = -b - sq; // near root
  if (t < 0) t = -b + sq; // origin inside/behind: take the far root
  if (t < 0) t = 0; // origin inside the sphere → immediate hit
  if (t > maxDist) return null;
  return t;
}

/**
 * Nearest reclaimable target along the aim ray — a build piece or a zipline
 * post — or `null` if nothing is within `maxDist`. "Nearest wins": the
 * piece-AABB entry distance and the zipline-post sphere-hit distances are
 * both plain distances along the same normalized ray, so they compare
 * directly despite the different underlying tests.
 */
export function demolishTargetAt(
  origin: Vec3,
  dir: Vec3,
  pieces: readonly BuildPiece[],
  ziplines: readonly PlacedZipline[],
  maxDist: number,
  zipRadius: number,
): DemolishHit | null {
  let best: DemolishHit | null = null;
  let bestDist = maxDist;

  const pieceHit = pieceAtRayHit(pieces, origin, dir, bestDist);
  if (pieceHit) {
    bestDist = pieceHit.dist;
    best = {
      system: 'build',
      id: pieceHit.piece.id,
      kind: pieceHit.piece.kind,
      label: PIECE_LABEL[pieceHit.piece.kind],
      dist: pieceHit.dist,
    };
  }

  for (const z of ziplines) {
    for (const end of ['a', 'b'] as const) {
      const t = raySphereT(origin, dir, end === 'a' ? z.a : z.b, zipRadius, bestDist);
      if (t !== null && t < bestDist) {
        bestDist = t;
        best = { system: 'zipline', id: z.id, end, label: 'Zipline', dist: t };
      }
    }
  }

  return best;
}
