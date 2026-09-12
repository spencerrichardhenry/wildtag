import * as THREE from 'three';
import { cloneArtAsset, hasArtAsset } from '../art/library.ts';
import { GRANDPA } from '../core/constants.ts';
import type { GrandpaState } from './core.ts';

/** Original Blender MCP bird, with named pivots for the exaggerated stunt kit. */
export class GrandpaModel {
  readonly root = new THREE.Group();
  private readonly creature: THREE.Group;
  private readonly body: THREE.Object3D;
  private readonly head: THREE.Object3D;
  private readonly tail: THREE.Object3D;
  private readonly legs: { hip: THREE.Object3D; knee: THREE.Object3D; foot: THREE.Object3D; wing: THREE.Object3D }[];
  constructor(statue = false) {
    if (!hasArtAsset('grandpa_featherfoot')) throw new Error('Grandpa Featherfoot art has not loaded');
    this.creature = cloneArtAsset('grandpa_featherfoot');
    this.creature.position.y = -.1; this.root.add(this.creature);
    this.root.name = statue ? 'grandpa-statue' : 'grandpa-featherfoot';
    const part = (name: string): THREE.Object3D => {
      const found = this.creature.getObjectByName(name);
      if (!found) throw new Error(`Grandpa rig is missing ${name}`);
      return found;
    };
    this.body = part('gp_body'); this.head = part('gp_head'); this.tail = part('gp_tail');
    this.legs = ['left', 'right'].map(side => ({ hip: part(`gp_leg_${side}`), knee: part(`gp_knee_${side}`), foot: part(`gp_foot_${side}`), wing: part(`gp_wing_${side}`) }));
    this.root.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      const tint = (material: THREE.Material) => {
        const m = material.clone() as THREE.MeshStandardMaterial;
        if (statue) { m.color.setHex(0xbc9561); m.metalness = .5; m.roughness = .45; m.vertexColors = false; }
        return m;
      };
      o.material = Array.isArray(o.material) ? o.material.map(tint) : tint(o.material);
      o.castShadow = true; o.receiveShadow = true;
    });
    if (statue) {
      this.creature.position.y = .2;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, .3, 8), new THREE.MeshStandardMaterial({ color: 0x536857, roughness: .9, flatShading: true }));
      base.position.y = .15; this.root.add(base);
    }
  }
  animate(s: GrandpaState, time: number, caught: boolean): void {
    const speed = Math.hypot(s.vel.x, s.vel.z);
    const stride = s.grounded && !s.drifting && !caught ? Math.min(1, speed / GRANDPA.walkSpeed) : 0;
    const phase = time * (5 + Math.min(speed, 12) * .8);
    const charge = s.charge / GRANDPA.vaultCharge;
    const windup = s.sneezeWindup > 0 ? 1 - s.sneezeWindup / GRANDPA.sneezeWindup : 0;
    const air = !s.grounded ? 1 : 0;
    this.root.rotation.y = s.yaw + Math.PI;
    this.body.position.y = 2.55 - charge * .48 - (caught ? .45 : 0) + Math.abs(Math.sin(phase)) * .08 * stride;
    this.body.rotation.set((caught ? .28 : 0) + charge * .16 + windup * -.16 + (s.drifting ? .2 : 0), 0, s.drifting ? -.19 : Math.sin(phase) * .035 * stride);
    this.head.rotation.set(caught ? .4 : -windup * .4 + air * -.1 + Math.sin(phase) * .045 * stride, Math.sin(time * 1.2) * .045, s.recovery > 0 ? Math.sin(time * 18) * .08 : 0);
    this.tail.rotation.set(charge * .25 - air * .2, Math.sin(time * 3) * .08 + Math.sin(phase) * .07 * stride, 0);
    this.legs.forEach((leg, i) => {
      const side = i === 0 ? -1 : 1;
      const gait = Math.sin(phase + i * Math.PI) * stride;
      leg.hip.position.y = 2.3 - charge * .34 - (caught ? .28 : 0);
      leg.hip.rotation.x = -gait * .45 - charge * .48 + air * .4;
      leg.knee.rotation.x = Math.max(0, gait) * .55 + charge * .95 + air * .9;
      leg.foot.rotation.x = -(leg.hip.rotation.x + leg.knee.rotation.x) * .7;
      leg.wing.rotation.z = side * -(caught ? 1.1 : air ? .85 + Math.sin(time * 17) * .15 : .08 + charge * .28 + windup * .4);
      leg.wing.rotation.x = s.drifting ? -.4 : 0;
    });
  }
  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose(); } });
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
