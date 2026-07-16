import * as THREE from 'three';
import type { Vec3 } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Grapple rope + hook rendering, kept out of the pure `grapple.ts` core. Owns a
// thin tube from the player's hand to the anchor (with a subtle quadratic sag
// when the rope is slack), a hook mesh at the anchor and a pulsing latch light
// so the attach point reads clearly at range. The controller drives `update()`
// each frame with the current rope geometry. The tube geometry is rebuilt per
// update — cheap for a single low-segment rope.
// ---------------------------------------------------------------------------

const SEGMENTS = 20;
const RADIUS = 0.06;

export class GrappleVisuals {
  private readonly group = new THREE.Group();
  private readonly ropeMat: THREE.MeshStandardMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly hook: THREE.Mesh;
  private readonly latchLight: THREE.Mesh;
  private readonly latchMat: THREE.MeshBasicMaterial;
  private geometry: THREE.TubeGeometry | null = null;
  private t = 0;

  constructor(scene: THREE.Scene) {
    // Warm bright rope with a slight self-glow so it reads against terrain
    // and sky alike (the old dark-brown rope vanished against hillsides).
    this.ropeMat = new THREE.MeshStandardMaterial({
      color: 0xe8b464,
      emissive: 0x7a4f1e,
      emissiveIntensity: 0.55,
      roughness: 0.8,
      metalness: 0,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.ropeMat);
    this.mesh.frustumCulled = false;

    const hookGeo = new THREE.ConeGeometry(0.26, 0.8, 6);
    const hookMat = new THREE.MeshStandardMaterial({
      color: 0xf0d9a0,
      emissive: 0x9a6a20,
      emissiveIntensity: 0.5,
      metalness: 0.7,
      roughness: 0.4,
    });
    this.hook = new THREE.Mesh(hookGeo, hookMat);

    // Pulsing marker sphere at the latch point — the "yes, you're attached
    // HERE" signal visible even when the hook silhouette is lost at range.
    this.latchMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.9,
    });
    this.latchLight = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), this.latchMat);

    this.group.add(this.mesh);
    this.group.add(this.hook);
    this.group.add(this.latchLight);
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
    this.latchLight.position.set(anchor.x, anchor.y, anchor.z);
    // Pulse the latch marker (~2.4 Hz) — driven off update cadence, cosmetic.
    this.t += 1 / 60;
    const pulse = 0.65 + 0.35 * Math.sin(this.t * 15);
    this.latchMat.opacity = pulse;
    const s = 1 + 0.5 * pulse;
    this.latchLight.scale.set(s, s, s);
  }

  hide(): void {
    this.group.visible = false;
  }
}
