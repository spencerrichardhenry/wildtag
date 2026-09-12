import * as THREE from 'three';
import { cloneArtAsset, hasArtAsset } from '../art/library.ts';
import { GRANDPA } from '../core/constants.ts';
import type { GrandpaState } from './core.ts';
import type { GroundQuery } from '../core/types.ts';

type BirdLeg = { hip: THREE.Object3D; knee: THREE.Object3D; foot: THREE.Object3D; wing: THREE.Object3D };
const upperBone = new THREE.Vector3(0, -.78, .2);
const lowerBone = new THREE.Vector3(0, -1.2, -.22);
/** Preserve the Blender joint lengths while planting the toes on the ground. */
function plantLeg(leg: BirdLeg, target: THREE.Vector3): void {
  const upper = upperBone.length(), lower = lowerBone.length();
  const distance = THREE.MathUtils.clamp(target.length(), Math.abs(upper - lower) + .01, upper + lower - .003);
  const direction = target.clone().normalize();
  const along = (upper * upper + distance * distance - lower * lower) / (2 * distance);
  const bend = new THREE.Vector3(0, 0, 1).addScaledVector(direction, -direction.z).normalize();
  const knee = direction.clone().multiplyScalar(along).addScaledVector(bend, Math.sqrt(Math.max(0, upper * upper - along * along)));
  leg.hip.quaternion.setFromUnitVectors(upperBone.clone().normalize(), knee.clone().normalize());
  const shin = direction.multiplyScalar(distance).sub(knee).applyQuaternion(leg.hip.quaternion.clone().invert()).normalize();
  leg.knee.quaternion.setFromUnitVectors(lowerBone.clone().normalize(), shin);
  leg.foot.quaternion.copy(leg.hip.quaternion).multiply(leg.knee.quaternion).invert();
}

/** Original Blender MCP bird, with named pivots for the exaggerated stunt kit. */
export class GrandpaModel {
  readonly root = new THREE.Group();
  private readonly creature: THREE.Group;
  private readonly body: THREE.Object3D;
  private readonly head: THREE.Object3D;
  private readonly tail: THREE.Object3D;
  private readonly legs: BirdLeg[];
  private gait = 0;
  private lastPosition: THREE.Vector3 | null = null;
  private moving = 0;
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
  animate(s: GrandpaState, time: number, caught: boolean, dt = 1 / 60, ground?: GroundQuery): void {
    const speed = Math.hypot(s.vel.x, s.vel.z);
    let distance = this.lastPosition ? Math.hypot(s.pos.x - this.lastPosition.x, s.pos.z - this.lastPosition.z) : speed * dt;
    if (distance > 3) distance = 0;
    (this.lastPosition ??= new THREE.Vector3()).set(s.pos.x, s.pos.y, s.pos.z);
    const strideLength = s.sprintRemaining > 0 ? 2.8 : 2.4;
    if (s.grounded && !caught) this.gait = (this.gait + distance / strideLength) % 1;
    const moving = s.grounded && !caught ? Math.min(1, distance / Math.max(.001, dt) / 3) : 0;
    this.moving += (moving - this.moving) * (1 - Math.exp(-dt * 15));
    const stride = this.moving;
    const phase = this.gait * Math.PI * 2;
    const charge = s.charge / GRANDPA.vaultCharge;
    const windup = s.sneezeWindup > 0 ? 1 - s.sneezeWindup / GRANDPA.sneezeWindup : 0;
    const air = !s.grounded ? 1 : 0;
    this.root.rotation.y = s.yaw + Math.PI;
    const zoom = s.sprintRemaining > 0 && stride > .1;
    const cos = Math.cos(this.root.rotation.y), sin = Math.sin(this.root.rotation.y);
    const travel = speed > .1 ? new THREE.Vector3((cos * s.vel.x - sin * s.vel.z) / speed, 0, (sin * s.vel.x + cos * s.vel.z) / speed) : new THREE.Vector3(0, 0, 1);
    const feet = this.legs.map((_, i) => {
      const cycle = (this.gait + i * .5) % 1;
      const swing = Math.max(0, (cycle - .6) / .4);
      const offset = (cycle < .6 ? .5 - cycle / .6 : -.5 + swing) * strideLength * .6 * stride;
      const foot = new THREE.Vector3((i === 0 ? -.52 : .52) + travel.x * offset, 0, -.02 + travel.z * offset);
      const x = this.root.position.x + cos * foot.x + sin * foot.z;
      const z = this.root.position.z - sin * foot.x + cos * foot.z;
      const y = ground ? ground.heightBelow?.(x, z, s.pos.y + 1.2) ?? ground.heightAt(x, z) : s.pos.y;
      foot.y = THREE.MathUtils.clamp(y - this.root.position.y, -.9, .9) + Math.sin(swing * Math.PI) * (zoom ? .5 : .3) * stride;
      return foot;
    });
    const slopeCrouch = s.grounded ? Math.min(.65, Math.max(0, -Math.min(...feet.map(p => p.y))) * .9) : 0;
    this.body.position.y = 2.55 - stride * .2 - slopeCrouch - charge * .48 - (caught ? .45 : 0) + Math.abs(Math.sin(phase)) * .045 * stride;
    this.body.rotation.set((caught ? .28 : 0) + charge * .16 - windup * .16 + (zoom ? .24 : 0), 0, Math.sin(phase) * .035 * stride);
    this.head.rotation.set(caught ? .4 : -windup * .4 + air * -.1 + Math.sin(phase) * .045 * stride, Math.sin(time * 1.2) * .045, s.recovery > 0 ? Math.sin(time * 18) * .08 : 0);
    this.tail.rotation.set(charge * .25 - air * .2, Math.sin(time * 3) * .08 + Math.sin(phase) * .07 * stride, 0);
    this.legs.forEach((leg, i) => {
      const side = i === 0 ? -1 : 1;
      leg.hip.position.y = 2.3 - stride * .2 - slopeCrouch - charge * .34 - (caught ? .28 : 0);
      if (s.grounded) {
        const foot = feet[i]!;
        plantLeg(leg, new THREE.Vector3(foot.x - leg.hip.position.x, foot.y + .3 - leg.hip.position.y, foot.z - leg.hip.position.z));
      } else {
        const tuck = s.stunt === 'jump' ? .45 : 1;
        leg.hip.rotation.set(.4 * tuck, 0, 0); leg.knee.rotation.set(.9 * tuck, 0, 0); leg.foot.rotation.set(-.9 * tuck, 0, 0);
      }
      leg.wing.rotation.z = side * -(caught ? 1.1 : air ? .85 + Math.sin(time * 17) * .15 : .08 + charge * .28 + windup * .4);
      leg.wing.rotation.x = zoom ? -.6 : 0;
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
