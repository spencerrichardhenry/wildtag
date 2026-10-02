// Measures the visible gap between the rendered body and the seabed (owner playtest P3, tighter swim fit).
// The body vertices come from the renderer's own data: `bodyGeometry` (positions and skin weights) and the shared rig.
import * as T from 'three';
import { bodyGeometry } from '../../src/tiny-tide/creature';
import { layout } from '../../src/tiny-tide/body-geometry';
import type { Orientation, Vec3 } from '../../src/tiny-tide/combat-types';
import type { Genome } from '../../src/tiny-tide/genome';
import { rotateInto } from '../../src/tiny-tide/orientation';
import { boneMatricesInto, createRigPose, restBoneMatrices, restRig, rigPoseInto, type RigPose } from '../../src/tiny-tide/rig';

export interface BodyMesh { genome: Genome; vertices: T.Vector3[]; tail: boolean[] }

/** The renderer's skinned body vertices in body space at unit scale. Tail = rest z behind the second-last spine point. */
export function skinnedBody(g: Genome, rig: RigPose = restRig(g)): BodyMesh {
  const geo = bodyGeometry(g), pos = geo.getAttribute('position'), si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight');
  const rest = restBoneMatrices(g), inv = rest.map(m => m.clone().invert()), posed = boneMatricesInto(rest.map(m => m.clone()), g, rig);
  const skin = posed.map((m, i) => m.clone().multiply(inv[i]!)), l = layout(g), tailZ = l.z[g.spine.length - 2]!;
  const vertices: T.Vector3[] = [], tail: boolean[] = [];
  for (let k = 0; k < pos.count; k++) {
    const v = new T.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)), out = new T.Vector3();
    for (let j = 0; j < 2; j++) { const w = sw.getComponent(k, j); if (w > 0) out.addScaledVector(v.clone().applyMatrix4(skin[si.getComponent(k, j)]!), w); }
    vertices.push(out); tail.push(v.z < tailZ);
  }
  geo.dispose();
  return { genome: g, vertices, tail };
}

/** Full-swim poses at `phases` points of one wave cycle (the tail at its sway extremes among them). */
export function swimPoses(g: Genome, phases = 12): BodyMesh[] {
  const speed = 2.2 + 5.5;   // the full-swim wave speed of rig.ts
  return Array.from({ length: phases }, (_, i) => { const rig = createRigPose(g); rigPoseInto(rig, g, (i / phases) * 2 * Math.PI / speed, 1, 0); return skinnedBody(g, rig); });
}

export interface Gap { all: number; torso: number; tail: number }
const sa = { x: 0, y: 0, z: 0 };
/** Smallest height of the posed body above the ground (negative: below it), for all vertices, the torso and the tail. */
export function gapOf(mesh: BodyMesh, scale: number, at: Vec3, o: Orientation, groundAt: (x: number, z: number) => number): Gap {
  let torso = Infinity, tail = Infinity;
  mesh.vertices.forEach((v, k) => {
    rotateInto(o, { x: v.x * scale, y: v.y * scale, z: v.z * scale }, sa);
    const x = at.x + sa.x, y = at.y + sa.y, z = at.z + sa.z, h = y - groundAt(x, z);
    if (mesh.tail[k]) tail = Math.min(tail, h); else torso = Math.min(torso, h);
  });
  return { all: Math.min(torso, tail), torso, tail };
}
