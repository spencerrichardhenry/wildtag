import type { Vec3 } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Grapple anchor registry. Deployable structures (Task 13's drones) register a
// tracked sphere here — `getPos` is polled per raycast so a moving/bobbing
// drone stays grappleable without re-registering. The controller raycasts this
// alongside the terrain march when a grapple is fired and takes the nearest.
//
// Pure of `three`: anchors are plain { x, y, z } spheres. A ray is tested
// against every sphere; the nearest forward intersection within `maxDist`
// wins. Firing from inside a sphere counts as an immediate (t = 0) hit.
// ---------------------------------------------------------------------------

interface Anchor {
  getPos: () => Vec3;
  radius: number;
}

export interface AnchorHit {
  point: Vec3;
  anchorId: string;
}

export class AnchorRegistry {
  private readonly anchors = new Map<string, Anchor>();

  /** Register (or replace) an anchor sphere; `getPos` is polled per raycast. */
  registerAnchor(id: string, getPos: () => Vec3, radius: number): void {
    this.anchors.set(id, { getPos, radius });
  }

  unregisterAnchor(id: string): void {
    this.anchors.delete(id);
  }

  /** Number of live anchors (debug / tests). */
  get size(): number {
    return this.anchors.size;
  }

  /**
   * Nearest sphere intersection along `dir` from `origin` within `maxDist`, or
   * null. `dir` need not be unit — it is normalized internally.
   */
  raycastAnchors(origin: Vec3, dir: Vec3, maxDist: number): AnchorHit | null {
    const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const dx = dir.x / dl;
    const dy = dir.y / dl;
    const dz = dir.z / dl;

    let best: AnchorHit | null = null;
    let bestT = Infinity;

    for (const [id, anchor] of this.anchors) {
      const c = anchor.getPos();
      const mx = origin.x - c.x;
      const my = origin.y - c.y;
      const mz = origin.z - c.z;
      const b = mx * dx + my * dy + mz * dz;
      const cc = mx * mx + my * my + mz * mz - anchor.radius * anchor.radius;
      const disc = b * b - cc;
      if (disc < 0) continue; // ray misses the sphere

      const sq = Math.sqrt(disc);
      let t = -b - sq; // near root
      if (t < 0) t = -b + sq; // origin inside/behind: take the far root
      if (t < 0) t = 0; // origin inside the sphere → immediate hit
      if (t > maxDist || t >= bestT) continue;

      bestT = t;
      best = {
        point: { x: origin.x + dx * t, y: origin.y + dy * t, z: origin.z + dz * t },
        anchorId: id,
      };
    }

    return best;
  }
}
