// Builds a player creature from its genome: a skinned, lofted body with one
// bone for each spine point, and Blender parts attached to the bones.
import * as T from 'three';
import { asset } from './assets';
import { part, type PartSpec, type TintSlot } from './parts';
import type { Genome, PlacedPart } from './genome';
import { layout, SPACING, surface, type Layout } from './body-geometry';
import { CHOMP_PITCH, createRigPose, rigPoseInto, type RigPose } from './rig';
import { resolveMount } from './mount';
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

interface Pivot { node: T.Object3D; kind: 'jaw' | 'seg' | 'flap' | 'swing'; index: number; rest: T.Euler; key: string }
interface AttachedPart { placed: PlacedPart; spec: PartSpec; object: T.Group; pivots: Pivot[]; mirrored: boolean; copy: 0 | 1 }
/** Cumulative counts (never decremented) of the geometries and materials this model created and disposed, and of body rebuilds. */
export interface CreatureCounters { createdGeometries: number; disposedGeometries: number; createdMaterials: number; disposedMaterials: number; rebuilds: number }
/** Highlight styles. `selected` wins over `problem`; `ghost` is the placement preview. */
export type HighlightStyle = 'selected' | 'problem' | 'ghost';
const HIGHLIGHT_ORDER: readonly HighlightStyle[] = ['selected', 'problem'];
const bodyKey = (g: Genome) => JSON.stringify(g.spine) + JSON.stringify(g.paint);

/**
 * A creature model that can follow edits without being rebuilt. Topology changes (parts added or removed, pair
 * toggles, segment count) go through `setGenome`, outside the animation loop; numeric changes go through
 * `updatePart` and `rebuildBody`. Part geometries are shared with the asset library and never disposed here.
 */
export class CreatureModel {
  readonly group = new T.Group();
  bones: T.Bone[] = [];
  readonly parts: AttachedPart[] = [];
  layout: Layout;
  readonly body: T.SkinnedMesh;
  readonly counters: CreatureCounters = { createdGeometries: 0, disposedGeometries: 0, createdMaterials: 0, disposedMaterials: 0, rebuilds: 0 };
  private readonly bodyMaterial: T.MeshStandardMaterial;
  private readonly tints = new Map<TintSlot, T.MeshStandardMaterial>();
  /** Highlight materials keyed `${style}:${sourceMaterialId}`. */
  private readonly styled = new Map<string, T.MeshStandardMaterial>();
  private readonly highlights = new Map<HighlightStyle, ReadonlySet<string>>();
  /** One preview object per part id and copy, reused for every hover. */
  private readonly ghostPool = new Map<string, T.Group[]>();
  private ghost: { placed: PlacedPart; objects: T.Group[] } | null = null;
  private pose: RigPose;
  /** Cumulative count of animated pivots with no key in the rig pose (a stale genome binding). Stays 0. */
  missingPivots = 0;
  private builtKey: string;
  constructor(public genome: Genome) {
    this.layout = layout(genome);
    this.pose = createRigPose(genome);
    this.makeBones();
    this.bodyMaterial = this.countMaterial(new T.MeshStandardMaterial({ vertexColors: true, roughness: .43, envMapIntensity: .65 }));
    this.body = new T.SkinnedMesh(this.countGeometry(bodyGeometry(genome, this.layout)), this.bodyMaterial);
    this.body.castShadow = true; this.body.receiveShadow = true; this.body.name = 'Creature body';
    this.body.add(this.bones[0]!); this.body.bind(new T.Skeleton(this.bones));
    this.body.frustumCulled = false;
    this.group.add(this.body);
    this.builtKey = bodyKey(genome);
    for (const placed of genome.parts) {
      this.attach(placed, 0);
      if (placed.mirror) this.attach(placed, 1);
    }
  }
  private countGeometry<G extends T.BufferGeometry>(g: G): G { this.counters.createdGeometries++; return g; }
  private countMaterial<M extends T.Material>(m: M): M { this.counters.createdMaterials++; return m; }
  private makeBones() {
    const l = this.layout, s = this.genome.spine;
    this.bones = s.map((_, i) => { const bone = new T.Bone(); bone.name = `spine_${i}`; return bone; });
    this.bones.forEach((bone, i) => { if (i > 0) this.bones[i - 1]!.add(bone); });
    this.restBones(l);
  }
  private restBones(l: Layout) {
    const s = this.genome.spine;
    this.bones.forEach((bone, i) => {
      if (i === 0) bone.position.set(0, s[0]!.lift, l.z[0]!); else bone.position.set(0, s[i]!.lift - s[i - 1]!.lift, -SPACING);
      bone.rotation.set(0, 0, 0);
    });
  }
  private tint(slot: TintSlot, source: T.MeshStandardMaterial) {
    let m = this.tints.get(slot);
    if (!m) { m = this.countMaterial(source.clone()); m.color.set(this.genome.paint[slot]); this.tints.set(slot, m); }
    return m;
  }
  /** Clones `object`'s tint meshes onto the model's tint materials and records each mesh's base material. */
  private prepare(object: T.Group, spec: PartSpec) {
    object.traverse(node => {
      if (!(node instanceof T.Mesh) || Array.isArray(node.material)) return;
      if (node.material.name === 'Tide_tint') node.material = this.tint(spec.tint, node.material as T.MeshStandardMaterial);
      node.userData.baseMaterial = node.material;
    });
  }
  private mount(object: T.Object3D, placed: PlacedPart, copy: 0 | 1) {
    // The nearest bone carries the part, so it follows the swimming body (the same mount gameplay uses).
    const mount = resolveMount(this.genome, placed, copy, this.layout);
    this.bones[mount.boneIndex]!.add(object);
    mount.local.decompose(object.position, object.quaternion, object.scale);
  }
  private attach(placed: PlacedPart, copy: 0 | 1) {
    const spec = part(placed.id); if (!spec) return;
    const object = asset(`part_${placed.id}`);
    this.prepare(object, spec);
    const pivots: Pivot[] = [];
    object.traverse(node => {
      const kind = node.userData.tt_pivot as Pivot['kind'] | undefined;
      if (kind) {
        const index = Number(node.userData.tt_index ?? 0);
        pivots.push({ node, kind, index, rest: node.rotation.clone(), key: `${placed.uid}:${copy}:${kind}:${index}` });
      }
    });
    object.userData.partId = placed.id; object.userData.partUid = placed.uid; object.userData.copy = copy; object.userData.mirrored = copy === 1;
    this.mount(object, placed, copy);
    const attached: AttachedPart = { placed, spec, object, pivots, mirrored: copy === 1, copy };
    this.parts.push(attached); this.style(attached);
  }
  /**
   * Binds the model to `g` after a topology change: parts added or removed, pair toggles, a changed part id or a
   * changed segment count. Keeps every attached object whose uid, copy and id survive; refreshes the rig key map and
   * bone buffers. Call it outside the animation loop.
   */
  setGenome(g: Genome) {
    this.genome = g;
    if (g.spine.length !== this.bones.length) this.rebuildBody();
    else this.layout = layout(g);
    const wanted = new Map<string, PlacedPart>();
    for (const placed of g.parts) for (const copy of placed.mirror ? [0, 1] : [0]) wanted.set(`${placed.uid}:${copy}`, placed);
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const a = this.parts[i]!, placed = wanted.get(`${a.placed.uid}:${a.copy}`);
      if (placed && placed.id === a.placed.id) { a.placed = placed; wanted.delete(`${placed.uid}:${a.copy}`); this.mount(a.object, placed, a.copy); continue; }
      a.object.removeFromParent(); this.parts.splice(i, 1);
    }
    for (const [key, placed] of wanted) this.attach(placed, key.endsWith(':1') ? 1 : 0);
    // Keep the genome's part order, so callers can rely on it.
    const order = new Map(g.parts.map((p, i) => [p.uid, i]));
    this.parts.sort((a, b) => order.get(a.placed.uid)! - order.get(b.placed.uid)! || a.copy - b.copy);
    this.pose = createRigPose(g);
    if (this.ghost) this.setGhost(this.ghost.placed);
  }
  /** Moves the attached copies of `uid` to `placed` (or to the genome's part). Numbers only: no new objects. */
  updatePart(uid: string, placed?: PlacedPart) {
    for (const a of this.parts) if (a.placed.uid === uid) { if (placed) a.placed = placed; this.mount(a.object, a.placed, a.copy); }
  }
  /** True when the spine or the paint changed since the body was last built. */
  get bodyStale() { return bodyKey(this.genome) !== this.builtKey; }
  /** Rebuilds the body mesh for the current spine and paint, disposes the old geometry and re-mounts every part. */
  rebuildBody() {
    const g = this.genome;
    this.layout = layout(g);
    if (g.spine.length !== this.bones.length) {
      this.bones[0]?.removeFromParent();
      const old = this.body.skeleton;
      this.makeBones(); this.body.add(this.bones[0]!);
      this.body.bind(new T.Skeleton(this.bones)); old.dispose();
    } else { this.restBones(this.layout); this.body.bind(this.body.skeleton); }
    const previous = this.body.geometry;
    this.body.geometry = this.countGeometry(bodyGeometry(g, this.layout));
    previous.dispose(); this.counters.disposedGeometries++;
    for (const [slot, m] of this.tints) m.color.set(g.paint[slot]);
    for (const a of this.parts) this.mount(a.object, a.placed, a.copy);
    if (this.ghost) this.setGhost(this.ghost.placed);
    this.builtKey = bodyKey(g); this.counters.rebuilds++;
  }
  /** Shows a translucent preview of `placed` (not part of the genome), or hides it. Objects come from a pool per part id. */
  setGhost(placed: PlacedPart | null) {
    if (this.ghost) for (const o of this.ghost.objects) o.visible = false;
    this.ghost = null;
    if (!placed) return;
    const spec = part(placed.id); if (!spec) return;
    let pool = this.ghostPool.get(placed.id);
    if (!pool) { pool = []; this.ghostPool.set(placed.id, pool); }
    const copies = placed.mirror ? 2 : 1;
    while (pool.length < copies) {
      const object = asset(`part_${placed.id}`);
      this.prepare(object, spec);
      object.userData.ghost = true;
      object.traverse(node => { if (node instanceof T.Mesh && !Array.isArray(node.material)) node.material = this.styledMaterial('ghost', node.userData.baseMaterial as T.Material); });
      pool.push(object);
    }
    const objects = pool.slice(0, copies);
    objects.forEach((o, copy) => { this.mount(o, placed, copy as 0 | 1); o.visible = true; });
    this.ghost = { placed, objects };
  }
  /** Sets the parts drawn in `style` (replacing that style's previous set). Materials come from a cache. */
  setHighlight(uids: Iterable<string>, style: Exclude<HighlightStyle, 'ghost'>) {
    this.highlights.set(style, new Set(uids));
    for (const a of this.parts) this.style(a);
  }
  private style(a: AttachedPart) {
    const style = HIGHLIGHT_ORDER.find(s => this.highlights.get(s)?.has(a.placed.uid)) ?? null;
    a.object.traverse(node => {
      if (!(node instanceof T.Mesh) || !node.userData.baseMaterial) return;
      const base = node.userData.baseMaterial as T.Material;
      node.material = style ? this.styledMaterial(style, base) : base;
    });
  }
  private styledMaterial(style: HighlightStyle, source: T.Material): T.Material {
    if (!(source instanceof T.MeshStandardMaterial)) return source;
    const key = `${style}:${source.uuid}`;
    let m = this.styled.get(key);
    if (!m) {
      m = this.countMaterial(source.clone());
      if (style === 'selected') { m.emissive.set('#fff2b3'); m.emissiveIntensity = .35; }
      else if (style === 'problem') { m.emissive.set('#ff6b57'); m.emissiveIntensity = .45; }
      else { m.transparent = true; m.opacity = .55; m.depthWrite = false; m.emissive.set('#bff7ec'); m.emissiveIntensity = .25; }
      this.styled.set(key, m);
    }
    m.color.copy(source.color);   // tints follow paint changes
    return m;
  }
  /** Procedural motion. `chomp` is 0–1, `swim` is 0 when idle and 1 when moving. */
  animate(time: number, swim: number, chomp: number) {
    const pose = rigPoseInto(this.pose, this.genome, time, swim, chomp), n = this.bones.length;
    for (let i = 1; i < n; i++) this.bones[i]!.rotation.y = pose.boneYaw[i]!;
    // Only the head nods: bone 1 undoes the pitch, so later bones keep a vertical yaw axis.
    this.bones[0]!.rotation.x = -chomp * CHOMP_PITCH;
    if (n > 1) this.bones[1]!.rotation.x = chomp * CHOMP_PITCH;
    for (const attached of this.parts) for (const pivot of attached.pivots) {
      const r = pivot.rest, o = pose.pivots.get(pivot.key);   // `${uid}:${copy}:${kind}:${index}`
      if (!o) { this.missingPivots++; continue; }
      pivot.node.rotation.set(r.x + o.x, r.y + o.y, r.z + o.z);
    }
  }
  /** Read-only: the rig pose of the last `animate` (gameplay samples the same pose). Do not modify it. */
  get rigPose(): Readonly<RigPose> { return this.pose; }
  /** The body length in creature units, for camera framing. */
  get length() { return this.layout.front - this.layout.rear; }
  dispose() {
    this.body.geometry.dispose(); this.counters.disposedGeometries++; this.body.skeleton.dispose();
    for (const m of [this.bodyMaterial, ...this.tints.values(), ...this.styled.values()]) { m.dispose(); this.counters.disposedMaterials++; }
    this.tints.clear(); this.styled.clear();
    this.group.removeFromParent();
  }
}
