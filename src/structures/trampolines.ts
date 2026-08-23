import * as THREE from 'three';
import { STRUCTURES } from '../core/constants.ts';
import type { GroundQuery, Vec3 } from '../core/types.ts';
import { buildDroneMesh, hoverAltitude } from './drones.ts';

// ---------------------------------------------------------------------------
// Trampolines (Bounce Wave, Spencer 2026-08-22): a croc-hide membrane laced
// onto a cragdrake-horn frame. Two kinds:
//  - 'ground': a pad on legs at terrain height;
//  - 'sky': the same pad held at DRONE altitude by four mini drones at its
//    corners (crafted by combining a trampoline kit with 4 drone kits — the
//    visual is literally the recipe).
// Landing on the membrane while falling launches the player to an apex of
// STRUCTURES.trampolineBounceFactor × droneHover ABOVE THE PAD. The impulse
// is a single ballistic launch per contact with a fixed apex relative to the
// pad, so chained bounces plateau — the free-flight invariant holds.
// ---------------------------------------------------------------------------

export type TrampKind = 'ground' | 'sky';

export interface TrampData {
  id: string;
  kind: TrampKind;
  x: number;
  z: number;
}

interface Tramp {
  id: string;
  kind: TrampKind;
  x: number;
  z: number;
  /** Membrane surface height (world Y). */
  padY: number;
  age: number;
  group: THREE.Group;
  membrane: THREE.Mesh;
  rotors: THREE.Mesh[];
}

const FRAME_COLOR = 0x7a5fa8; // cragdrake horn purple
const MEMBRANE_COLOR = 0x7bb662; // croc-hide green
const LEG_COLOR = 0x5a4636;

/** Launch velocity that reaches `apex` metres above the pad under gravity g. */
export function bounceLaunchVelocity(gravity: number, apex: number): number {
  return Math.sqrt(2 * Math.abs(gravity) * apex);
}

function buildTrampMesh(kind: TrampKind): { group: THREE.Group; membrane: THREE.Mesh; rotors: THREE.Mesh[] } {
  const g = new THREE.Group();
  const R = STRUCTURES.trampolinePadR;
  const mat = (color: number) =>
    new THREE.MeshLambertMaterial({ color, flatShading: true });

  // Horn frame: a ring of curved segments (8 low-seg cylinders in a circle).
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, R * 0.82, 5), mat(FRAME_COLOR));
    seg.rotation.z = Math.PI / 2;
    seg.rotation.y = a + Math.PI / 2;
    seg.position.set(Math.cos(a) * R, 0, Math.sin(a) * R);
    g.add(seg);
  }
  // Taut croc-hide membrane.
  const membrane = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.97, R * 0.97, 0.09, 9), mat(MEMBRANE_COLOR));
  membrane.position.y = 0.02;
  g.add(membrane);

  const rotors: THREE.Mesh[] = [];
  if (kind === 'ground') {
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.85, 5), mat(LEG_COLOR));
      leg.position.set(sx * R * 0.62, -0.45, sz * R * 0.62);
      g.add(leg);
    }
  } else {
    // Sky variant: four mini drones gripping the frame corners.
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
      const { group: droneG, rotors: droneRotors } = buildDroneMesh();
      droneG.scale.setScalar(0.55);
      droneG.position.set(sx * R * 0.95, 0.55, sz * R * 0.95);
      g.add(droneG);
      rotors.push(...droneRotors);
    }
  }
  return { group: g, membrane, rotors };
}

export class TrampolineSystem {
  private readonly scene: THREE.Scene;
  private readonly ground: GroundQuery;
  private readonly inventory: { kits: { trampoline: number; skytramp: number } };
  private readonly tramps = new Map<string, Tramp>();
  private nextId = 0;

  constructor(
    scene: THREE.Scene,
    ground: GroundQuery,
    inventory: { kits: { trampoline: number; skytramp: number } },
  ) {
    this.scene = scene;
    this.ground = ground;
    this.inventory = inventory;
  }

  get count(): number {
    return this.tramps.size;
  }

  /** Deploy a trampoline of `kind` at (x, z). Consumes the matching kit. */
  place(
    point: Vec3,
    kind: TrampKind,
    opts?: { free?: boolean },
  ): { ok: boolean; reason?: 'max' | 'nokit'; id?: string } {
    if (this.tramps.size >= STRUCTURES.maxTrampolines) return { ok: false, reason: 'max' };
    const kit = kind === 'ground' ? 'trampoline' : 'skytramp';
    if (!opts?.free) {
      if (this.inventory.kits[kit] <= 0) return { ok: false, reason: 'nokit' };
      this.inventory.kits[kit] -= 1;
    }
    const groundY = this.ground.heightAt(point.x, point.z);
    const padY = kind === 'ground' ? groundY + 0.9 : hoverAltitude(groundY);
    const id = `tramp${this.nextId++}`;
    const { group, membrane, rotors } = buildTrampMesh(kind);
    group.position.set(point.x, padY, point.z);
    this.scene.add(group);
    this.tramps.set(id, { id, kind, x: point.x, z: point.z, padY, age: 0, group, membrane, rotors });
    return { ok: true, id };
  }

  /** Remove a trampoline and refund its kit. */
  recall(id: string): boolean {
    const t = this.tramps.get(id);
    if (!t) return false;
    this.scene.remove(t.group);
    t.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.tramps.delete(id);
    this.inventory.kits[t.kind === 'ground' ? 'trampoline' : 'skytramp'] += 1;
    return true;
  }

  /** Nearest reclaimable trampoline id within reach of `pos` (demolish aim). */
  reclaimableIdNear(pos: Vec3): string | null {
    let best: string | null = null;
    let bestD = STRUCTURES.trampolinePadR + 2.2;
    for (const t of this.tramps.values()) {
      const d = Math.hypot(pos.x - t.x, pos.z - t.z);
      const dy = Math.abs(pos.y - t.padY);
      if (d < bestD && dy < 4) {
        bestD = d;
        best = t.id;
      }
    }
    return best;
  }

  /**
   * Bounce query: if `pos` is over a pad, within the contact band above the
   * membrane and descending, return the launch velocity (apex =
   * bounceFactor × droneHover above the pad). One impulse per contact.
   */
  bounceVelocity(pos: Vec3, velY: number, gravity: number): number | null {
    if (velY > 0) return null;
    for (const t of this.tramps.values()) {
      const d = Math.hypot(pos.x - t.x, pos.z - t.z);
      if (d > STRUCTURES.trampolinePadR) continue;
      const above = pos.y - t.padY;
      if (above < -0.3 || above > STRUCTURES.trampolineContactBand) continue;
      const apex = STRUCTURES.trampolineBounceFactor * STRUCTURES.droneHover;
      const membrane = t.membrane;
      membrane.scale.y = 0.4; // squash; update() relaxes it
      return bounceLaunchVelocity(gravity, apex);
    }
    return null;
  }

  /** Cosmetic: membrane relax + sky-rotor spin. */
  update(dt: number): void {
    for (const t of this.tramps.values()) {
      t.age += dt;
      t.membrane.scale.y += (1 - t.membrane.scale.y) * Math.min(1, dt * 6);
      for (const r of t.rotors) r.rotation.y += dt * 20;
      if (t.kind === 'sky') t.group.position.y = t.padY + Math.sin(t.age * 1.3) * 0.15;
    }
  }

  /** Save-shape data for every placed trampoline. */
  data(): TrampData[] {
    return [...this.tramps.values()].map(({ id, kind, x, z }) => ({ id, kind, x, z }));
  }

  /** Rebuild from save data (kits were already spent when placed). */
  load(entries: readonly TrampData[]): void {
    for (const e of entries) {
      this.place({ x: e.x, y: 0, z: e.z }, e.kind, { free: true });
    }
  }
}
