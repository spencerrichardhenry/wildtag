import data from './layout-data.json';
import type { Vec3 } from '../core/types.ts';

export const SKY = data;
export const SKY_CENTER: Vec3 = SKY.center;
export type SkyFloor = (typeof SKY.floors)[number];
const ZONES_BY_PRIORITY=[...SKY.zones].reverse();
export function skyWorld(x: number, y: number, z: number): Vec3 {
  return {x: x + SKY_CENTER.x, y: y + SKY_CENTER.y, z: z + SKY_CENTER.z};
}
export function inSkyBounds(p: Vec3, margin = 0): boolean {
  return Math.abs(p.x - SKY_CENTER.x) < 100 + margin && Math.abs(p.z - SKY_CENTER.z) < 100 + margin && p.y > SKY_CENTER.y - 14;
}
export function floorHeight(f: SkyFloor, x: number, z: number): number {
  const t = f.axis === 'x' ? (x - f.x) / f.w + .5 : f.axis === '-z' ? (z - f.z) / f.d + .5 : .5 - (z - f.z) / f.d;
  return SKY_CENTER.y + f.y + f.rise * Math.max(0, Math.min(1, t));
}
/** Highest actual surface beneath the feet. A roof never lifts someone below it. */
export function skyFloorBelow(x: number, z: number, maxY: number): number {
  x -= SKY_CENTER.x; z -= SKY_CENTER.z;
  if (Math.abs(x) > 100 || Math.abs(z) > 100 || maxY < SKY_CENTER.y - 1) return -Infinity;
  let top = -Infinity;
  for (const f of SKY.floors) {
    if (Math.abs(x - f.x) > f.w / 2 || Math.abs(z - f.z) > f.d / 2) continue;
    const y = floorHeight(f, x, z);
    if (y <= maxY + .0001) top = Math.max(top, y);
  }
  return top;
}
export function skyZone(p: Vec3): (typeof SKY.zones)[number] | undefined {
  if (!inSkyBounds(p)) return;
  // Small rooms override the larger square that surrounds them.
  return ZONES_BY_PRIORITY.find(z => Math.abs(p.x - SKY_CENTER.x - z.x) <= z.w / 2 && Math.abs(p.z - SKY_CENTER.z - z.z) <= z.d / 2 && Math.abs(p.y - SKY_CENTER.y - z.y) < 5);
}
/** Reserve the approach pads and a walking trail from Haven, before scattering trees. */
export function inSkyApproach(x: number, z: number): boolean {
  for (const p of [SKY.launch.ground, SKY.launch.drone]) if (Math.hypot(x-p.x,z-p.z)<6) return true;
  const a={x:68,z:-48}, b=SKY.launch.ground;
  const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));
  return Math.hypot(x-a.x-t*dx,z-a.z-t*dz)<3;
}
export const SKY_CRITTER_SLOTS = [
  {species:'suncresteagle',home:skyWorld(40,6,-18),flightHeight:0},
  {species:'suncresteagle',home:skyWorld(48,7,-7),flightHeight:0},
  {species:'suncresteagle',home:skyWorld(47,9,-22),flightHeight:0},
  {species:'seraphlet',home:skyWorld(9,15,-29),flightHeight:0},
  {species:'seraphlet',home:skyWorld(20,7,12),flightHeight:0},
];
