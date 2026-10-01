// The one orientation convention: yaw turns about +Y, pitch > 0 is nose up.
// orientationMatrix(o) = Ry(yaw) · Rx(−pitch); forwardOf(o) is that matrix times (0, 0, 1).
import * as T from 'three';
import type { Capsule, MutVec3, Orientation, Vec3 } from './combat-types';

/** (sin yaw cos pitch, sin pitch, cos yaw cos pitch). */
export function forwardOf(o: Orientation, out: MutVec3 = { x: 0, y: 0, z: 0 }): MutVec3 {
  const cp = Math.cos(o.pitch);
  out.x = Math.sin(o.yaw) * cp; out.y = Math.sin(o.pitch); out.z = Math.cos(o.yaw) * cp;
  return out;
}

/** Ry(yaw) · Rx(−pitch) as a rotation-only Matrix4. */
export function orientationMatrix(o: Orientation, out: T.Matrix4 = new T.Matrix4()): T.Matrix4 {
  const cy = Math.cos(o.yaw), sy = Math.sin(o.yaw), cp = Math.cos(o.pitch), sp = Math.sin(o.pitch);
  // Rx(−p) = [[1,0,0],[0,cp,sp],[0,−sp,cp]]; Ry(y) = [[cy,0,sy],[0,1,0],[−sy,0,cy]].
  return out.set(
    cy, -sy * sp, sy * cp, 0,
    0, cp, sp, 0,
    -sy, -cy * sp, cy * cp, 0,
    0, 0, 0, 1,
  );
}

/** Rotates a body-space point by o into out (no allocation). */
export function rotateInto(o: Orientation, p: Vec3, out: MutVec3): MutVec3 {
  const cy = Math.cos(o.yaw), sy = Math.sin(o.yaw), cp = Math.cos(o.pitch), sp = Math.sin(o.pitch);
  const x = p.x, y = p.y, z = p.z;
  out.x = cy * x - sy * sp * y + sy * cp * z;
  out.y = cp * y + sp * z;
  out.z = -sy * x - cy * sp * y + cy * cp * z;
  return out;
}

/** World-aligned envelope of a body-frame envelope: sway' = sway + heave|sin p|, heave' = heave|cos p| + sway|sin p|. */
export const orientedSway = (sway: number, heave: number, pitch: number) => sway + heave * Math.abs(Math.sin(pitch));
export const orientedHeave = (sway: number, heave: number, pitch: number) => heave * Math.abs(Math.cos(pitch)) + sway * Math.abs(Math.sin(pitch));

/** Rotates both ends of each capsule, keeps the radius, and converts the envelope to world-aligned axes. */
export function orientHull(hull: readonly Capsule[], o: Orientation): Capsule[] {
  return hull.map(c => {
    const w = c.sway ?? 0, v = c.heave ?? 0;
    return { start: rotateInto(o, c.start, { x: 0, y: 0, z: 0 }), end: rotateInto(o, c.end, { x: 0, y: 0, z: 0 }), radius: c.radius,
      sway: orientedSway(w, v, o.pitch), heave: orientedHeave(w, v, o.pitch) };
  });
}
