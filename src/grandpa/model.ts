import * as THREE from 'three';
import { buildCritterModel, type CritterParts } from '../critters/models.ts';
import { animateCritter } from '../critters/animation.ts';
import { mulberry32 } from '../core/rng.ts';
import type { GrandpaState } from './core.ts';

/** Existing Wildtag art used for gameplay verification pending concept approval. */
export class GrandpaModel {
  readonly root = new THREE.Group();
  private readonly creature: THREE.Group;
  private readonly parts: CritterParts;
  constructor(statue = false) {
    const model = buildCritterModel('cragdrake', mulberry32(92317));
    this.creature = model.group; this.parts = model.parts;
    this.creature.scale.setScalar(1.8); this.root.add(this.creature);
    this.root.name = statue ? 'grandpa-statue' : 'grandpa-provisional-cragdrake';
    this.root.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      o.material = (o.material as THREE.MeshStandardMaterial).clone();
      const m = o.material as THREE.MeshStandardMaterial;
      if (statue) { m.color.setHex(0xbc9561); m.metalness = .5; m.roughness = .45; m.vertexColors = false; }
      o.castShadow = true; o.receiveShadow = true;
    });
    if (statue) {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, .3, 8), new THREE.MeshStandardMaterial({ color: 0x536857, roughness: .9, flatShading: true }));
      base.position.y = .15; this.root.add(base);
    }
  }
  animate(s: GrandpaState, time: number, caught: boolean): void {
    animateCritter(this.parts, Math.hypot(s.vel.x, s.vel.z), time, 1 / 60, 'cragdrake');
    this.root.rotation.y = s.yaw + Math.PI;
    this.creature.scale.y = caught ? .8 : s.charge > 0 ? 1.1 : 1.8;
    this.creature.rotation.z = s.drifting ? -.18 : s.recovery > 0 ? Math.sin(time * 18) * .07 : 0;
  }
  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
  }
}

/** A visible ranger represents the ordinarily first-person child to their guest. */
export function makeChildAvatar(): THREE.Group {
  const root = new THREE.Group(); root.name = 'visiting-child';
  const cloth = new THREE.MeshStandardMaterial({ color: 0x38879a, flatShading: true });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe9b886, flatShading: true });
  const leather = new THREE.MeshStandardMaterial({ color: 0x725640, flatShading: true });
  const gold = new THREE.MeshStandardMaterial({ color: 0xe9be67, flatShading: true });
  function mass(parent: THREE.Group, material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), material); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.castShadow = true; parent.add(mesh);
  }
  mass(root, cloth, 0, 1.1, 0, .38, .52, .24);
  mass(root, skin, 0, 1.72, 0, .23, .27, .23);
  mass(root, gold, 0, 1.93, 0, .34, .13, .34);
  mass(root, leather, 0, 1.22, .24, .28, .32, .15);
  const legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(side * .18, .7, 0); root.add(leg); legs.push(leg);
    mass(leg, leather, 0, -.25, 0, .13, .37, .13);
    mass(root, skin, side * .45, 1.1, -.02, .12, .33, .12);
  }
  root.userData.legs = legs;
  return root;
}
