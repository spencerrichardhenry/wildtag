import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { asset, animations, HERO_ASSETS } from './assets';
import type { FoodKind } from './state';

const effectMaterials = new Map<string, T.MeshStandardMaterial>();
/** Small runtime particles use an effect material; all game models are GLBs. */
export function material(color: string, glow = 0) {
  const key = color + glow;
  if (!effectMaterials.has(key)) effectMaterials.set(key, new T.MeshStandardMaterial({ color, roughness: .75, emissive: color, emissiveIntensity: glow }));
  return effectMaterials.get(key)!;
}
export function batch(group: T.Group): T.Group {
  group.updateMatrixWorld(true);
  const buckets = new Map<T.Material, T.BufferGeometry[]>();
  group.traverse(obj => {
    if (!(obj instanceof T.Mesh) || Array.isArray(obj.material)) return;
    const geometry = obj.geometry.clone().applyMatrix4(obj.matrixWorld);
    // Exported meshes all have painted colors. Normalize optional attributes
    // so distinct Blender assets can share a single static draw per material.
    for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'color'].includes(name)) geometry.deleteAttribute(name);
    if (!geometry.attributes.color) {
      const colors = new Float32Array(geometry.attributes.position!.count * 4).fill(1); geometry.setAttribute('color', new T.BufferAttribute(colors, 4));
    } else if (geometry.attributes.color.itemSize === 3) {
      const a = geometry.attributes.color, colors = new Float32Array(a.count * 4);
      for (let i = 0; i < a.count; i++) colors.set([a.getX(i), a.getY(i), a.getZ(i), 1], i * 4);
      geometry.setAttribute('color', new T.BufferAttribute(colors, 4));
    }
    if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.attributes.position!.count }, (_, i) => i));
    const list = buckets.get(obj.material) || []; list.push(geometry); buckets.set(obj.material, list);
  });
  const result = new T.Group();
  for (const [mat, geoms] of buckets) {
    const merged = mergeGeometries(geoms, false);
    if (!merged) throw new Error('Could not batch Blender scenery');
    const m = new T.Mesh(merged, mat); m.castShadow = true; m.receiveShadow = true; m.userData.ownedGeometry = true; result.add(m);
    for (const geometry of geoms) geometry.dispose();
  }
  return result;
}
interface Motion { mixer: T.AnimationMixer; idle?: T.AnimationAction; swim?: T.AnimationAction; chomp?: T.AnimationAction; lastTime: number; lastBite: number }
const motions = new WeakMap<T.Group, Motion>();
export function creature(stage: number): T.Group {
  const name = HERO_ASSETS[stage]!, group = asset(name), mixer = new T.AnimationMixer(group);
  const clips = animations(name), idleClip = clips.find(c => c.name === 'Idle'), swimClip = clips.find(c => c.name === 'Swim'), chompClip = clips.find(c => c.name === 'Chomp');
  const idle = idleClip ? mixer.clipAction(idleClip).play() : undefined, swim = swimClip ? mixer.clipAction(swimClip).play() : undefined;
  if (swim) swim.setEffectiveWeight(0);
  const chomp = chompClip ? mixer.clipAction(chompClip).setLoop(T.LoopOnce, 1) : undefined;
  motions.set(group, { mixer, idle, swim, chomp, lastTime: -1, lastBite: 0 }); return group;
}
export function animateCreature(group: T.Group, time: number, moving: boolean, chomping: number, _stage: number) {
  const motion = motions.get(group); if (!motion) return;
  const dt = motion.lastTime < 0 ? 0 : Math.min(.05, Math.max(0, time - motion.lastTime)); motion.lastTime = time;
  if (motion.idle) motion.idle.setEffectiveWeight(T.MathUtils.damp(motion.idle.getEffectiveWeight(), moving ? 0 : 1, 6, dt));
  if (motion.swim) motion.swim.setEffectiveWeight(T.MathUtils.damp(motion.swim.getEffectiveWeight(), moving ? 1 : 0, 6, dt));
  if (chomping > motion.lastBite + .2 && motion.chomp) motion.chomp.reset().play();
  motion.lastBite = chomping; motion.mixer.update(dt);
}
export function foodModel(kind: FoodKind, id = 0): T.Group { return asset(kind === 'planet' ? `planet_${String(id).padStart(2, '0')}` : kind); }
export function coral(seed: number) { return asset(`reef_coral_${seed % 4}`); }
export function kelp(seed: number) { return asset(seed % 3 === 0 ? 'reef_grass' : 'reef_kelp'); }
export { asset as sceneryAsset };
