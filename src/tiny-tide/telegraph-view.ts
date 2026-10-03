// The telegraph view (spec §9.1): for each species action in windup or active, a translucent volume of its exact world shape, an outline
// drawn twice (with the depth test, and without it at 35 % as an x-ray through rocks and the creature), an inner copy that fills from the
// origin, a depth ring on the seabed with a dashed line up to the centroid, and amber solid or red striped colour.
// No per-frame allocation: the unit geometries are cached per shape kind (a cone per half angle, a capsule per length-to-radius ratio, so one
// per attack), and the meshes and materials of each slot are created once and reused. The layer lives in the world's `universe` group, so
// all positions are physical units.
import * as T from 'three';
import type { WorldShape } from './combat-types';
import type { TelegraphView } from './combat-world';

const AMBER = new T.Color('#ffb347'), RED = new T.Color('#ff4d4d');
const Z = new T.Vector3(0, 0, 1);
/** Segments of the drawn surfaces (around the axis and along the cap arcs). */
const AROUND = 32, ARC = 10;
type Capsule = Extract<WorldShape, { kind: 'capsule' }>;
const capsuleLength = (s: Capsule) => Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y, s.end.z - s.start.z);
/** The cache key of a shape's unit geometry: a cone by its half angle, a capsule by its length over its radius. */
const keyOf = (s: WorldShape) => s.kind === 'cone' ? `cone:${Math.min(Math.PI, s.halfAngle).toFixed(6)}` : `capsule:${(capsuleLength(s) / Math.max(1e-9, s.radius)).toFixed(4)}`;
const ratioOf = (key: string) => Number(key.slice(key.indexOf(':') + 1));
const volumes = new Map<string, T.BufferGeometry>(), outlines = new Map<string, T.BufferGeometry>();

/** The shape's surface in its own frame, unit size, along +z from the origin: a cone is the spherical sector of radius 1 (the hit test's
 *  `range` and `halfAngle`, spec §5.11: the side cone and the spherical cap); a capsule has radius 1 and starts at the origin. Cached. */
export function unitGeometry(s: WorldShape): T.BufferGeometry {
  const key = keyOf(s); let g = volumes.get(key);
  if (g) return g;
  const r = ratioOf(key);
  if (s.kind === 'cone') {
    const points = [new T.Vector2(0, 0)];
    for (let k = 0; k <= ARC; k++) { const t = r * (1 - k / ARC); points.push(new T.Vector2(Math.sin(t), Math.cos(t))); }
    g = new T.LatheGeometry(points, AROUND).rotateX(Math.PI / 2);   // the lathe's +y axis becomes +z
  } else g = new T.CapsuleGeometry(1, r, ARC, AROUND).rotateX(Math.PI / 2).translate(0, 0, r / 2);
  volumes.set(key, g); return g;
}
/** The outline in the same frame (line segment pairs): a cone's rim and four meridians over its cap; a capsule's two end rings, four side
 *  lines and four arcs over each cap. Cached. */
export function outlineGeometry(s: WorldShape): T.BufferGeometry {
  const key = keyOf(s); let g = outlines.get(key);
  if (g) return g;
  const r = ratioOf(key), out: number[] = [];
  const polyline = (f: (i: number) => [number, number, number], n: number) => { for (let i = 0; i < n; i++) out.push(...f(i), ...f(i + 1)); };
  const ring = (radius: number, z: number) => polyline(i => [radius * Math.cos(i / AROUND * 2 * Math.PI), radius * Math.sin(i / AROUND * 2 * Math.PI), z], AROUND);
  if (s.kind === 'cone') {
    ring(Math.sin(r), Math.cos(r));
    for (let q = 0; q < 4; q++) {
      const c = Math.cos(q * Math.PI / 2), d = Math.sin(q * Math.PI / 2);
      out.push(0, 0, 0, c * Math.sin(r), d * Math.sin(r), Math.cos(r));
      polyline(i => { const t = r * (1 - i / ARC); return [c * Math.sin(t), d * Math.sin(t), Math.cos(t)]; }, ARC);
    }
  } else {
    ring(1, 0); ring(1, r);
    for (let q = 0; q < 4; q++) {
      const c = Math.cos(q * Math.PI / 2), d = Math.sin(q * Math.PI / 2);
      out.push(c, d, 0, c, d, r);
      polyline(i => { const t = i / ARC * Math.PI / 2; return [c * Math.cos(t), d * Math.cos(t), -Math.sin(t)]; }, ARC);
      polyline(i => { const t = i / ARC * Math.PI / 2; return [c * Math.cos(t), d * Math.cos(t), r + Math.sin(t)]; }, ARC);
    }
  }
  // Line distances for the dashed (red) outline, per segment pair as LineSegments.computeLineDistances writes them.
  const dist: number[] = [];
  for (let i = 0; i < out.length; i += 6) { const from = i === 0 ? 0 : dist[dist.length - 1]!; dist.push(from, from + Math.hypot(out[i + 3]! - out[i]!, out[i + 4]! - out[i + 1]!, out[i + 5]! - out[i + 2]!)); }
  g = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(out, 3)).setAttribute('lineDistance', new T.Float32BufferAttribute(dist, 1));
  outlines.set(key, g); return g;
}
const q = new T.Quaternion(), p = new T.Vector3(), d = new T.Vector3(), sc = new T.Vector3();
/** The matrix that puts a unit geometry on the world shape: at the apex (cone) or start (capsule), +z along the axis, scaled by the range
 *  (cone) or radius (capsule) × `fraction` (the fill grows from the origin). */
export function telegraphMatrix(s: WorldShape, fraction: number, target: T.Matrix4): T.Matrix4 {
  if (s.kind === 'cone') { p.set(s.apex.x, s.apex.y, s.apex.z); d.set(s.axis.x, s.axis.y, s.axis.z); }
  else { p.set(s.start.x, s.start.y, s.start.z); d.set(s.end.x - s.start.x, s.end.y - s.start.y, s.end.z - s.start.z); }
  if (d.lengthSq() < 1e-18) d.copy(Z); else d.normalize();
  q.setFromUnitVectors(Z, d);
  const size = (s.kind === 'cone' ? s.range : s.radius) * fraction;
  return target.compose(p, q, sc.setScalar(Math.max(1e-9, size)));
}

/** Diagonal stripes for unblockable attacks (made on first use: tests run without a DOM): white and near-black, so the pattern stays clear
 *  in greyscale and for colour-blind players (the stripes, not the hue, say "cannot be blocked"). */
let stripeTexture: T.Texture | null = null;
function stripes(): T.Texture {
  if (stripeTexture) return stripeTexture;
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#111';
  for (let i = -64; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 8, 0); g.lineTo(i + 72, 64); g.lineTo(i + 64, 64); g.fill(); }
  stripeTexture = new T.CanvasTexture(c); stripeTexture.wrapS = stripeTexture.wrapT = T.RepeatWrapping; stripeTexture.repeat.set(3, 3);
  return stripeTexture;
}
const surface = (opacity: number) => new T.MeshBasicMaterial({ color: AMBER, transparent: true, opacity, depthWrite: false, side: T.DoubleSide });
/** One drawn shape: its volume, the fill, and the outline with and without the depth test. A red (striped) telegraph puts the stripes on
 *  the volume and the fill and draws its outlines dashed. */
interface ShapeSlot { volume: T.Mesh; fill: T.Mesh; outline: T.LineSegments; xray: T.LineSegments; solid: [T.LineBasicMaterial, T.LineBasicMaterial]; dashed: [T.LineDashedMaterial, T.LineDashedMaterial]; striped: boolean }
/** One telegraph's depth ring and its dashed line. */
interface RingSlot { ring: T.Mesh; line: T.Line }
const ringGeometry = new T.RingGeometry(.92, 1, 48).rotateX(-Math.PI / 2);
const lineGeometry = new T.BufferGeometry().setFromPoints([new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0)]);

export class TelegraphLayer {
  readonly root = new T.Group();
  private readonly shapes: ShapeSlot[] = [];
  private readonly rings: RingSlot[] = [];
  constructor(parent: T.Object3D) { this.root.name = 'telegraphs'; parent.add(this.root); }
  private shapeSlot(i: number): ShapeSlot {
    let s = this.shapes[i];
    if (s) return s;
    const empty = unitGeometry({ kind: 'cone', apex: { x: 0, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, range: 1, halfAngle: .5 });
    const volume = new T.Mesh(empty, surface(.16)), fill = new T.Mesh(empty, surface(.3));
    const solid: ShapeSlot['solid'] = [new T.LineBasicMaterial({ color: AMBER, transparent: true, opacity: .9 }), new T.LineBasicMaterial({ color: AMBER, transparent: true, opacity: .35, depthTest: false, depthWrite: false })];
    const dash = { dashSize: .12, gapSize: .08 };
    const dashed: ShapeSlot['dashed'] = [new T.LineDashedMaterial({ color: AMBER, transparent: true, opacity: .9, ...dash }), new T.LineDashedMaterial({ color: AMBER, transparent: true, opacity: .35, depthTest: false, depthWrite: false, ...dash })];
    const outline = new T.LineSegments(empty, solid[0]), xray = new T.LineSegments(empty, solid[1]);
    for (const o of [volume, fill, outline, xray]) { o.matrixAutoUpdate = false; o.frustumCulled = false; this.root.add(o); }
    volume.renderOrder = 6; fill.renderOrder = 6; outline.renderOrder = 7; xray.renderOrder = 8;
    s = { volume, fill, outline, xray, solid, dashed, striped: false }; this.shapes[i] = s; return s;
  }
  private ringSlot(i: number): RingSlot {
    let r = this.rings[i];
    if (r) return r;
    const ring = new T.Mesh(ringGeometry, surface(.55));
    const line = new T.Line(lineGeometry, new T.LineDashedMaterial({ color: AMBER, dashSize: .08, gapSize: .06, transparent: true, opacity: .7, depthWrite: false }));
    line.computeLineDistances(); ring.renderOrder = 6; line.renderOrder = 6;
    this.root.add(ring, line); r = { ring, line }; this.rings[i] = r; return r;
  }
  /** Draws this frame's telegraphs; unused pooled meshes hide. `lift`: the ring's height above the seabed (physical units). */
  update(views: readonly TelegraphView[], lift: number): void {
    let n = 0;
    views.forEach((v, i) => {
      const color = v.color === 'red' ? RED : AMBER, striped = v.pattern === 'stripes';
      for (const shape of v.shapes) {
        const s = this.shapeSlot(n++), volume = unitGeometry(shape), outline = outlineGeometry(shape);
        s.volume.geometry = volume; s.fill.geometry = volume; s.outline.geometry = outline; s.xray.geometry = outline;
        telegraphMatrix(shape, 1, s.volume.matrix); s.outline.matrix.copy(s.volume.matrix); s.xray.matrix.copy(s.volume.matrix);
        telegraphMatrix(shape, Math.max(.02, v.fill), s.fill.matrix);
        if (s.striped !== striped) {
          // Stripes darken half the surface: a striped volume and fill are more opaque so the pattern reads under water.
          for (const [o, plain, ruled] of [[s.volume, .16, .3], [s.fill, .3, .5]] as const) { const m = o.material as T.MeshBasicMaterial; m.map = striped ? stripes() : null; m.opacity = striped ? ruled : plain; m.needsUpdate = true; }
          [s.outline.material, s.xray.material] = striped ? s.dashed : s.solid; s.striped = striped;
        }
        for (const o of [s.volume, s.fill, s.outline, s.xray]) { (o.material as T.MeshBasicMaterial | T.LineBasicMaterial).color.copy(color); o.visible = true; }
      }
      const r = this.ringSlot(i), c = v.centroid, ground = v.groundY + lift;
      r.ring.position.set(c.x, ground, c.z); r.ring.scale.setScalar(Math.max(lift, v.ringRadius));
      r.line.position.set(c.x, ground, c.z); r.line.scale.set(1, Math.max(lift, c.y - ground), 1);
      for (const o of [r.ring, r.line]) { (o.material as T.MeshBasicMaterial | T.LineDashedMaterial).color.copy(color); o.visible = true; }
    });
    for (let i = n; i < this.shapes.length; i++) { const s = this.shapes[i]!; s.volume.visible = s.fill.visible = s.outline.visible = s.xray.visible = false; }
    for (let i = views.length; i < this.rings.length; i++) { const r = this.rings[i]!; r.ring.visible = r.line.visible = false; }
  }
  /** Diagnostics: the slots in use and created (pooled: created grows only with the most telegraphs at once). */
  get counts() { return { shapes: this.shapes.filter(s => s.volume.visible).length, created: this.shapes.length, rings: this.rings.length }; }
}
