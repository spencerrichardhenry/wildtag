// One rig pose for the renderer and for gameplay. Part pivot data comes from
// part-rig.json, which check_assets.py exports from the Blender GLBs.
import * as T from 'three';
import rigJson from './part-rig.json';
import type { Genome, PlacedPart } from './genome';
import { layout, SPACING } from './body-geometry';

export interface RigNode { parent: string | null; pre: number[]; t: [number, number, number]; q: [number, number, number, number]; s: [number, number, number]; rest: number[] }
export const PART_RIG = rigJson as unknown as Record<string, Record<string, RigNode>>;

/** Largest spine yaw amplitude (swim = 1), and the head pitch per unit of chomp. */
export const SWIM_AMP_MAX = .22, CHOMP_PITCH = .12;

type Offset = { x: number; y: number; z: number };
export interface RigPose { genome: Genome; boneYaw: Float64Array; chomp: number; pivots: Map<string, Offset> }

type PivotKind = 'jaw' | 'seg' | 'flap' | 'swing';
interface PivotSlot { placed: PlacedPart; copy: 0 | 1; kind: PivotKind; index: number; offset: Offset }
const slots = new WeakMap<RigPose, PivotSlot[]>();

/** A zero pose with one offset per pivot of every attached part copy, keyed `${uid}:${copy}:${kind}:${index}`. */
export function createRigPose(g: Genome): RigPose {
  const pivots = new Map<string, Offset>(), list: PivotSlot[] = [];
  for (const placed of g.parts) {
    const nodes = PART_RIG[placed.id]; if (!nodes) continue;
    for (const copy of placed.mirror ? [0, 1] as const : [0] as const) for (const key of Object.keys(nodes)) {
      const [kind, index] = key.split(':'), offset = { x: 0, y: 0, z: 0 };
      pivots.set(`${placed.uid}:${copy}:${key}`, offset);
      list.push({ placed, copy, kind: kind as PivotKind, index: Number(index), offset });
    }
  }
  const pose: RigPose = { genome: g, boneYaw: new Float64Array(g.spine.length), chomp: 0, pivots };
  slots.set(pose, list);
  return pose;
}

/** Writes the renderer's procedural motion into `out`. `swim` is 0 idle, 1 moving; `chomp` is 0–1. */
export function rigPoseInto(out: RigPose, g: Genome, time: number, swim: number, chomp: number): RigPose {
  if (out.genome !== g) throw new Error('rigPoseInto: the pose was created for another genome');
  const n = g.spine.length, amp = .05 + swim * .17, speed = 2.2 + swim * 5.5;
  out.chomp = chomp; out.boneYaw[0] = 0;
  for (let i = 1; i < n; i++) out.boneYaw[i] = amp * Math.sin(time * speed - i * .9) * (i / (n - 1));
  for (const s of slots.get(out)!) {
    const o = s.offset, phase = s.placed.t * 4 + (s.copy ? Math.PI : 0);
    o.x = 0; o.y = 0; o.z = 0;
    switch (s.kind) {
      case 'jaw': o.x = -chomp * .65; break;
      case 'seg': o.z = Math.sin(time * speed * .9 - s.index * .8 + phase) * (.1 + swim * .22); break;
      case 'flap': o.z = Math.sin(time * (speed + 1) + phase) * (.08 + swim * .32); break;
      case 'swing': o.x = Math.sin(time * speed * 1.4 + phase) * (.06 + swim * .45); break;
    }
  }
  return out;
}

/** The rest pose: every value is 0. */
export const restRig = (g: Genome): RigPose => createRigPose(g);

interface NodeCache { pre: T.Matrix4; rest: T.Euler; t: T.Vector3; s: T.Vector3 }
const nodeCache = new Map<string, NodeCache>();
function cached(partId: string, key: string, node: RigNode) {
  const id = `${partId}/${key}`;
  let c = nodeCache.get(id);
  if (!c) {
    c = { pre: new T.Matrix4().fromArray(node.pre), rest: new T.Euler().setFromQuaternion(new T.Quaternion(...node.q), 'XYZ'),
      t: new T.Vector3(...node.t), s: new T.Vector3(...node.s) };
    nodeCache.set(id, c);
  }
  return c;
}
function rigNode(partId: string, key: string) {
  const node = PART_RIG[partId]?.[key];
  if (!node) throw new Error(`No rig pivot ${key} on part ${partId}`);
  return node;
}
const local = new T.Matrix4(), euler = new T.Euler();
/** The matrix from a pivot's frame to its part root, with optional per-pivot Euler offsets (keyed `<kind>:<index>`). */
export function pivotToPart(partId: string, key: string, offsets: (key: string) => Offset | undefined, out: T.Matrix4): T.Matrix4 {
  const node = rigNode(partId, key), c = cached(partId, key, node);
  if (node.parent === null) out.identity(); else pivotToPart(partId, node.parent, offsets, out);
  const o = offsets(key), r = c.rest;
  euler.set(r.x + (o?.x ?? 0), r.y + (o?.y ?? 0), r.z + (o?.z ?? 0), 'XYZ');
  local.makeRotationFromEuler(euler).scale(c.s).setPosition(c.t);
  return out.multiply(c.pre).multiply(local);
}
const restCache = new Map<string, T.Matrix4>();
const noOffsets = () => undefined;
/** The rest pivot-to-part matrix. Cached and shared: do not modify it. */
export function restPivotToPart(partId: string, key: string): T.Matrix4 {
  const id = `${partId}/${key}`;
  let m = restCache.get(id);
  if (!m) { m = pivotToPart(partId, key, noOffsets, new T.Matrix4()); restCache.set(id, m); }
  return m;
}

const boneLocal = new T.Matrix4(), boneEuler = new T.Euler(), bonePosition = new T.Vector3();
/** Body-space world matrices of the spine bones, built like CreatureModel. `out` needs one matrix per spine point. */
export function boneMatricesInto(out: T.Matrix4[], g: Genome, pose: RigPose): T.Matrix4[] {
  const s = g.spine, z0 = layout(g).z[0]!;
  for (let i = 0; i < s.length; i++) {
    const m = out[i]; if (!m) throw new Error('boneMatricesInto: one output matrix per spine point');
    if (i === 0) { bonePosition.set(0, s[0]!.lift, z0); boneEuler.set(-pose.chomp * CHOMP_PITCH, 0, 0, 'XYZ'); }
    else { bonePosition.set(0, s[i]!.lift - s[i - 1]!.lift, -SPACING); boneEuler.set(i === 1 ? pose.chomp * CHOMP_PITCH : 0, pose.boneYaw[i]!, 0, 'XYZ'); }
    boneLocal.makeRotationFromEuler(boneEuler).setPosition(bonePosition);
    if (i === 0) m.copy(boneLocal); else m.multiplyMatrices(out[i - 1]!, boneLocal);
  }
  return out;
}
export const restBoneMatrices = (g: Genome): T.Matrix4[] => boneMatricesInto(g.spine.map(() => new T.Matrix4()), g, restRig(g));
