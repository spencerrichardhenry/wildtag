// Builds a player creature from its genome: a skinned, lofted body with one
// bone for each spine point, and Blender parts attached to the bones.
import * as T from 'three';
import { asset } from './assets';
import { part, type PartSpec } from './parts';
import type { Genome, PlacedPart } from './genome';
import { layout, partFrame, PART_SCALE, SPACING, surface, type Layout } from './body-geometry';
export * from './body-geometry';

const RINGS = 44, SIDES = 28;

function hash(n: number) { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }
function bodyColor(g: Genome, t: number, rawAngle: number, z: number, out: T.Color) {
  const angle = Math.atan2(Math.sin(rawAngle), Math.cos(rawAngle)), base = new T.Color(g.paint.base), belly = new T.Color(g.paint.belly), accent = new T.Color(g.paint.accent);
  const up = Math.cos(angle), bellyMix = T.MathUtils.smoothstep(-up, .05, .6);
  out.copy(base).lerp(belly, bellyMix).multiplyScalar(.82 + .18 * (up * .5 + .5));
  const pattern = g.paint.pattern;
  if (pattern === 'stripes' && up > -.2 && Math.sin(z * 11) > .45) out.lerp(accent, .85);
  if (pattern === 'spots') for (let i = 0; i < 9; i++) {
    const st = .15 + hash(i) * .75, sa = (hash(i + 20) - .5) * 2.6;
    if (Math.hypot((t - st) * 3, Math.atan2(Math.sin(Math.abs(angle) - Math.abs(sa)), Math.cos(Math.abs(angle) - Math.abs(sa)))) < .32) out.lerp(accent, .9);
  }
  if (pattern === 'freckles' && t < .45 && up > -.1) for (let i = 0; i < 7; i++) {
    const st = .12 + hash(i + 40) * .28, sa = .5 + hash(i + 60) * .9;
    if (Math.hypot((t - st) * 5, Math.abs(angle) - sa) < .09) out.lerp(accent, .8);
  }
  return out;
}
export function bodyGeometry(g: Genome, l = layout(g)) {
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], skinIndex: number[] = [], skinWeight: number[] = [], index: number[] = [];
  const color = new T.Color(), n = g.spine.length;
  for (let ring = 0; ring <= RINGS; ring++) {
    const u = ring / RINGS, t = (1 - Math.cos(Math.PI * u)) / 2;
    for (let side = 0; side <= SIDES; side++) {
      const angle = side / SIDES * Math.PI * 2, { position, normal } = surface(g, l, t, angle);
      positions.push(position.x, position.y, position.z); normals.push(normal.x, normal.y, normal.z);
      bodyColor(g, t, angle, position.z, color); colors.push(color.r, color.g, color.b);
      const f = (l.z[0]! - position.z) / SPACING, i = Math.max(0, Math.min(n - 2, Math.floor(f))), w = Math.max(0, Math.min(1, f - i));
      skinIndex.push(i, i + 1, 0, 0); skinWeight.push(1 - w, w, 0, 0);
    }
  }
  for (let ring = 0; ring < RINGS; ring++) for (let side = 0; side < SIDES; side++) {
    const a = ring * (SIDES + 1) + side, b = a + SIDES + 1;
    index.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(skinWeight, 4));
  geometry.setIndex(index); geometry.computeBoundingSphere();
  return geometry;
}

interface Pivot { node: T.Object3D; kind: 'jaw' | 'seg' | 'flap' | 'swing'; index: number; rest: T.Euler }
interface AttachedPart { placed: PlacedPart; spec: PartSpec; object: T.Group; pivots: Pivot[]; mirrored: boolean; phase: number }
export class CreatureModel {
  readonly group = new T.Group();
  readonly bones: T.Bone[] = [];
  readonly parts: AttachedPart[] = [];
  readonly layout: Layout;
  readonly body: T.SkinnedMesh;
  private materials: T.Material[] = [];
  constructor(readonly genome: Genome) {
    this.layout = layout(genome);
    const l = this.layout, s = genome.spine;
    s.forEach((point, i) => {
      const bone = new T.Bone(); bone.name = `spine_${i}`;
      if (i === 0) bone.position.set(0, point.lift, l.z[0]!); else bone.position.set(0, point.lift - s[i - 1]!.lift, -SPACING);
      if (i > 0) this.bones[i - 1]!.add(bone);
      this.bones.push(bone);
    });
    const bodyMaterial = new T.MeshStandardMaterial({ vertexColors: true, roughness: .43, envMapIntensity: .65 });
    this.materials.push(bodyMaterial);
    this.body = new T.SkinnedMesh(bodyGeometry(genome, l), bodyMaterial);
    this.body.castShadow = true; this.body.receiveShadow = true; this.body.userData.ownedGeometry = true; this.body.name = 'Creature body';
    this.body.add(this.bones[0]!); this.body.bind(new T.Skeleton(this.bones));
    this.body.frustumCulled = false;
    this.group.add(this.body);
    const tints = new Map<string, T.MeshStandardMaterial>();
    for (const placed of genome.parts) {
      this.attach(placed, false, tints);
      if (placed.mirror) this.attach(placed, true, tints);
    }
  }
  private attach(placed: PlacedPart, mirrored: boolean, tints: Map<string, T.MeshStandardMaterial>) {
    const spec = part(placed.id); if (!spec) return;
    const l = this.layout, angle = mirrored ? -placed.angle : placed.angle;
    const { position, normal } = surface(this.genome, l, placed.t, angle);
    const object = asset(`part_${placed.id}`);
    // The nearest bone carries the part, so it follows the swimming body.
    const f = (l.z[0]! - position.z) / SPACING, boneIndex = Math.max(0, Math.min(this.bones.length - 1, Math.round(f)));
    const bone = this.bones[boneIndex]!, bonePosition = new T.Vector3(0, this.genome.spine[boneIndex]!.lift, l.z[boneIndex]!);
    object.position.copy(position).sub(bonePosition);
    object.quaternion.copy(partFrame(normal, mirrored ? -placed.roll : placed.roll));
    object.scale.setScalar(placed.scale * PART_SCALE); if (mirrored) object.scale.x *= -1;
    const pivots: Pivot[] = [];
    object.traverse(node => {
      if (node instanceof T.Mesh && !Array.isArray(node.material) && node.material.name === 'Tide_tint') {
        const slot = spec.tint, key = slot;
        if (!tints.has(key)) {
          const m = (node.material as T.MeshStandardMaterial).clone(); m.color.set(this.genome.paint[slot]); tints.set(key, m); this.materials.push(m);
        }
        node.material = tints.get(key)!;
      }
      const kind = node.userData.tt_pivot as Pivot['kind'] | undefined;
      if (kind) pivots.push({ node, kind, index: Number(node.userData.tt_index ?? 0), rest: node.rotation.clone() });
    });
    object.userData.partId = placed.id; object.userData.mirrored = mirrored; object.userData.placedIndex = this.genome.parts.indexOf(placed);
    bone.add(object);
    this.parts.push({ placed, spec, object, pivots, mirrored, phase: placed.t * 4 + (mirrored ? Math.PI : 0) });
  }
  /** Procedural motion. `chomp` is 0–1, `swim` is 0 when idle and 1 when moving. */
  animate(time: number, swim: number, chomp: number) {
    const n = this.bones.length, amp = .05 + swim * .17, speed = 2.2 + swim * 5.5;
    for (let i = 1; i < n; i++) this.bones[i]!.rotation.y = amp * Math.sin(time * speed - i * .9) * (i / (n - 1));
    this.bones[0]!.rotation.x = -chomp * .12;
    for (const attached of this.parts) for (const pivot of attached.pivots) {
      const r = pivot.rest, phase = attached.phase;
      switch (pivot.kind) {
        case 'jaw': pivot.node.rotation.set(r.x - chomp * .65, r.y, r.z); break;
        case 'seg': pivot.node.rotation.set(r.x, r.y, r.z + Math.sin(time * speed * .9 - pivot.index * .8 + phase) * (.1 + swim * .22)); break;
        case 'flap': pivot.node.rotation.set(r.x, r.y, r.z + Math.sin(time * (speed + 1) + phase) * (.08 + swim * .32)); break;
        case 'swing': pivot.node.rotation.set(r.x + Math.sin(time * speed * 1.4 + phase) * (.06 + swim * .45), r.y, r.z); break;
      }
    }
  }
  /** The body length in creature units, for camera framing. */
  get length() { return this.layout.front - this.layout.rear; }
  dispose() {
    this.body.geometry.dispose(); this.body.skeleton.dispose();
    this.group.traverse(node => { if (node instanceof T.Mesh && node.userData.ownedMaterial) (node.material as T.Material).dispose(); });
    for (const m of this.materials) m.dispose();
    this.group.removeFromParent();
  }
}
