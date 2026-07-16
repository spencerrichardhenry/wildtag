import * as THREE from 'three';
import type { Vec3 } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Grapple rope + hook rendering, kept out of the pure `grapple.ts` core. Owns a
// thin tube from the player's hand to the anchor (with a subtle quadratic sag
// when the rope is slack) and a small hook mesh sitting at the anchor. The
// controller drives `update()` each frame with the current rope geometry. The
// tube geometry is rebuilt per update — cheap for a single low-segment rope.
// ---------------------------------------------------------------------------

const SEGMENTS = 20;
const RADIUS = 0.05;

export class GrappleVisuals {
  private readonly group = new THREE.Group();
  private readonly ropeMat: THREE.MeshStandardMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly hook: THREE.Mesh;
  private geometry: THREE.TubeGeometry | null = null;

  constructor(scene: THREE.Scene) {
    this.ropeMat = new THREE.MeshStandardMaterial({
      color: 0x3a2a1a,
      roughness: 0.9,
      metalness: 0,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.ropeMat);
    this.mesh.frustumCulled = false;

    const hookGeo = new THREE.ConeGeometry(0.18, 0.6, 6);
    const hookMat = new THREE.MeshStandardMaterial({ color: 0xb8a678, metalness: 0.7, roughness: 0.4 });
    this.hook = new THREE.Mesh(hookGeo, hookMat);

    this.group.add(this.mesh);
    this.group.add(this.hook);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Show the rope from `from` (hand) to `anchor`, sagging by the slack. */
  update(from: Vec3, anchor: Vec3, length: number): void {
    this.group.visible = true;

    const dist = Math.hypot(anchor.x - from.x, anchor.y - from.y, anchor.z - from.z);
    // Slack = rope not currently taut; droop the midpoint proportionally (plus a
    // hair of constant droop so a taut rope isn't a perfectly straight ruler).
    const slack = Math.max(0, length - dist);
    const sag = 0.04 * dist + 0.5 * slack;

    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const dip = sag * (4 * t * (1 - t)); // quadratic, peaks at the midpoint
      pts.push(
        new THREE.Vector3(
          from.x + (anchor.x - from.x) * t,
          from.y + (anchor.y - from.y) * t - dip,
          from.z + (anchor.z - from.z) * t,
        ),
      );
    }

    const curve = new THREE.CatmullRomCurve3(pts);
    const next = new THREE.TubeGeometry(curve, SEGMENTS, RADIUS, 6, false);
    this.mesh.geometry = next;
    this.geometry?.dispose();
    this.geometry = next;

    this.hook.position.set(anchor.x, anchor.y, anchor.z);
  }

  hide(): void {
    this.group.visible = false;
  }
}
