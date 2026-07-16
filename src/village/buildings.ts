import * as THREE from 'three';
import { VILLAGE } from '../core/constants.ts';
import type { Obstacle } from '../player/collision.ts';
import { heightAt } from '../world/terrain.ts';
import {
  villageLayout,
  type BuildingPlacement,
  type FenceSeg,
  type Path,
  type Point2,
} from './layout.ts';

// ---------------------------------------------------------------------------
// Procedural blocky village meshes (flat-shaded Lambert, warm palette). Built
// once from the pure layout and parented under a single group added to the
// scene. Buildings are wall shells with a door gap, window boxes and a pyramid
// roof; the barter stand is an open-front stall. Lamp posts get an emissive
// head + a point light so the hamlet glows. Dirt paths + a plaza disc + a
// fenced farm grid + home pens complete the scene. `villageObstacles()` exposes
// 2–3 collision circles per building (+ lamp posts) for the player controller.
// ---------------------------------------------------------------------------

const C = VILLAGE.colors;

type MatOpts = { emissive?: number; emissiveIntensity?: number };

function mat(color: number, opts: MatOpts = {}): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true });
  if (opts.emissive !== undefined) {
    m.emissive = new THREE.Color(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  return m;
}

function box(w: number, h: number, d: number, color: number, opts: MatOpts = {}): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
}

const DOOR_W = 1.2;
const DOOR_H = 2.0;
const WALL_T = 0.22;

/** Warm wall/roof colour pair for a building kind. */
function palette(kind: BuildingPlacement['kind']): { wall: number; roof: number } {
  if (kind === 'farmhouse') return { wall: C.farmhouseWall, roof: C.roofFarmhouse };
  if (kind === 'barter') return { wall: C.barterWall, roof: C.roofBarter };
  return { wall: C.homeWall, roof: C.roofHome };
}

/** A pyramid roof squared over a w×d footprint, sitting at wall-top `h`. */
function roof(w: number, d: number, h: number, color: number): THREE.Mesh {
  const radius = Math.hypot(w, d) / 2 + 0.15;
  const roofH = Math.max(w, d) * 0.42;
  const geo = new THREE.ConeGeometry(radius, roofH, 4);
  const mesh = new THREE.Mesh(geo, mat(color, { emissiveIntensity: 0 }));
  mesh.rotation.y = Math.PI / 4; // square the 4-sided cone onto the walls
  mesh.position.y = h + roofH / 2 - 0.05;
  return mesh;
}

/** A window box on a side wall (faint self-lit so it reads at distance). */
function windowBox(): THREE.Mesh {
  return box(0.02, 0.8, 0.8, C.window, { emissive: C.window, emissiveIntensity: 0.35 });
}

/** A dark foundation plinth slightly overhanging the footprint (grounds walls). */
function plinth(w: number, d: number): THREE.Mesh {
  const p = box(w + 0.35, 0.4, d + 0.35, C.trim);
  p.position.y = 0.16;
  return p;
}

/** Build a closed house (farmhouse / home): 4 walls, door gap, windows, roof. */
function buildHouse(b: BuildingPlacement): THREE.Group {
  const g = new THREE.Group();
  const { wall, roof: roofColor } = palette(b.kind);
  const h = VILLAGE.wallHeight[b.kind];
  const { w, d } = b;
  g.add(plinth(w, d));

  // Back + side walls (front is local −Z, toward the plaza — it gets the door).
  const back = box(w, h, WALL_T, wall);
  back.position.set(0, h / 2, d / 2);
  g.add(back);
  for (const sx of [-1, 1]) {
    const side = box(WALL_T, h, d, wall);
    side.position.set((sx * (w - WALL_T)) / 2, h / 2, 0);
    g.add(side);
    const win = windowBox();
    win.position.set((sx * w) / 2, h * 0.55, 0);
    g.add(win);
  }

  // Front wall with a door gap: two panels + a lintel over the door.
  const panelW = (w - DOOR_W) / 2;
  for (const sx of [-1, 1]) {
    const panel = box(panelW, h, WALL_T, wall);
    panel.position.set((sx * (DOOR_W + panelW)) / 2, h / 2, -d / 2);
    g.add(panel);
  }
  const lintel = box(DOOR_W, h - DOOR_H, WALL_T, wall);
  lintel.position.set(0, DOOR_H + (h - DOOR_H) / 2, -d / 2);
  g.add(lintel);
  const door = box(DOOR_W - 0.08, DOOR_H - 0.05, 0.1, C.door);
  door.position.set(0, DOOR_H / 2, -d / 2 - 0.02);
  g.add(door);

  g.add(roof(w, d, h, roofColor));
  return g;
}

/** Build the open-front barter stall: back+side walls, a counter and a canopy. */
function buildBarter(b: BuildingPlacement): THREE.Group {
  const g = new THREE.Group();
  const { wall, roof: roofColor } = palette(b.kind);
  const h = VILLAGE.wallHeight.barter;
  const { w, d } = b;
  g.add(plinth(w, d));

  const back = box(w, h, WALL_T, wall);
  back.position.set(0, h / 2, d / 2);
  g.add(back);
  for (const sx of [-1, 1]) {
    const side = box(WALL_T, h, d, wall);
    side.position.set((sx * (w - WALL_T)) / 2, h / 2, 0);
    g.add(side);
    // Front posts holding the canopy (open front — no wall).
    const post = box(0.2, h, 0.2, C.trim);
    post.position.set((sx * (w - 0.3)) / 2, h / 2, -d / 2 + 0.1);
    g.add(post);
  }
  // Counter across the open front.
  const counter = box(w - 0.5, 0.9, 0.5, C.trim);
  counter.position.set(0, 0.45, -d / 2 + 0.4);
  g.add(counter);
  // A sign board on the back wall.
  const sign = box(w * 0.5, 0.6, 0.06, C.door, { emissive: C.lampHead, emissiveIntensity: 0.15 });
  sign.position.set(0, h * 0.7, d / 2 - WALL_T);
  g.add(sign);

  g.add(roof(w, d, h, roofColor));
  return g;
}

function buildBuilding(b: BuildingPlacement): THREE.Group {
  const g = b.kind === 'barter' ? buildBarter(b) : buildHouse(b);
  g.position.set(b.x, heightAt(b.x, b.z), b.z);
  g.rotation.y = b.rot;
  g.name = `village-building ${b.id}`;
  return g;
}

/** Lamp post: dark pole + emissive head + a warm point light. */
function buildLamp(p: Point2): THREE.Group {
  const g = new THREE.Group();
  const H = VILLAGE.lampHeight;
  const gy = heightAt(p.x, p.z);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, H, 6), mat(C.lampPost));
  post.position.y = H / 2;
  g.add(post);
  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.34, 0),
    mat(C.lampHead, { emissive: C.lampHead, emissiveIntensity: 1.8 }),
  );
  head.position.y = H + 0.1;
  g.add(head);
  // A little cross-arm so the post reads as a lamp, not a pole.
  const arm = box(0.5, 0.08, 0.08, C.lampPost);
  arm.position.y = H - 0.2;
  g.add(arm);
  const light = new THREE.PointLight(0xffd27a, 7, 13, 1.8);
  light.position.set(0, H + 0.1, 0);
  g.add(light);
  g.position.set(p.x, gy, p.z);
  return g;
}

/** A flat ground patch (thin box) at world (x,z), sized w×d, colour c. */
function groundPatch(x: number, z: number, w: number, d: number, c: number, lift = 0.06): THREE.Mesh {
  const m = box(w, 0.1, d, c);
  m.position.set(x, heightAt(x, z) + lift, z);
  return m;
}

/** A dirt path polyline as a chain of thin oriented ribbons. */
function buildPath(path: Path): THREE.Group {
  const g = new THREE.Group();
  const pts = path.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    const cx = (a.x + b.x) / 2;
    const cz = (a.z + b.z) / 2;
    const ribbon = box(1.5, 0.08, len + 0.4, C.path);
    ribbon.position.set(cx, heightAt(cx, cz) + 0.04, cz);
    ribbon.rotation.y = Math.atan2(dx, dz);
    g.add(ribbon);
  }
  return g;
}

/** Repeated posts + two rails along a fence segment. */
function buildFence(seg: FenceSeg): THREE.Group {
  const g = new THREE.Group();
  const dx = seg.x2 - seg.x1;
  const dz = seg.z2 - seg.z1;
  const len = Math.hypot(dx, dz);
  const ang = Math.atan2(dx, dz);
  const nPosts = Math.max(2, Math.round(len / 1.6) + 1);
  for (let i = 0; i < nPosts; i++) {
    const t = i / (nPosts - 1);
    const x = seg.x1 + dx * t;
    const z = seg.z1 + dz * t;
    const post = box(0.12, 1.0, 0.12, C.fence);
    post.position.set(x, heightAt(x, z) + 0.5, z);
    g.add(post);
  }
  const cx = (seg.x1 + seg.x2) / 2;
  const cz = (seg.z1 + seg.z2) / 2;
  const gy = heightAt(cx, cz);
  for (const ry of [0.4, 0.8]) {
    const rail = box(0.06, 0.1, len, C.fence);
    rail.position.set(cx, gy + ry, cz);
    rail.rotation.y = ang;
    g.add(rail);
  }
  return g;
}

let _obstacles: Obstacle[] | null = null;

/** Cache-computed collision circles for buildings (2–3 each) + lamp posts. */
export function villageObstacles(): Obstacle[] {
  if (_obstacles) return _obstacles;
  const layout = villageLayout();
  const out: Obstacle[] = [];
  for (const b of layout.buildings) {
    // Full-footprint coverage with circles along the longer local axis: radius
    // r = 1.15 × (short/2) pads slightly past the walls (buildings have no
    // interiors), which buys each circle an interval of half-width
    // h = (short/2)·√(1.15² − 1) ≈ 0.568·(short/2) along the long edge where the
    // whole cross-section (corners included) is inside it. h is taken at 0.55
    // for margin; n = ceil(a/h) circles, ends inset h, then cover [−a, a].
    const long = Math.max(b.w, b.d);
    const a = long / 2;
    const bHalf = Math.min(b.w, b.d) / 2;
    const r = bHalf * 1.15;
    const h = bHalf * 0.55;
    const n = Math.max(1, Math.ceil(a / h));
    const alongX = b.w >= b.d;
    for (let i = 0; i < n; i++) {
      const off = n === 1 ? 0 : -(a - h) + (2 * (a - h) * i) / (n - 1);
      // local (off, 0) on the long axis → world, via the building's Y-rotation.
      const lx = alongX ? off : 0;
      const lz = alongX ? 0 : off;
      const wx = b.x + lx * Math.cos(b.rot) + lz * Math.sin(b.rot);
      const wz = b.z - lx * Math.sin(b.rot) + lz * Math.cos(b.rot);
      out.push({ x: wx, z: wz, r });
    }
  }
  for (const l of layout.lamps) out.push({ x: l.x, z: l.z, r: 0.25 });
  _obstacles = out;
  return out;
}

/**
 * Build the entire village as one group and add it to `scene`. Returns the
 * group (kept resident — the village is static and always near spawn).
 */
export function buildVillage(scene: THREE.Scene): THREE.Group {
  const layout = villageLayout();
  const root = new THREE.Group();
  root.name = 'village';

  // Plaza disc.
  const plaza = new THREE.Mesh(
    new THREE.CylinderGeometry(layout.plaza.r, layout.plaza.r + 0.3, 0.12, 20),
    mat(C.plaza),
  );
  plaza.position.set(layout.plaza.x, heightAt(layout.plaza.x, layout.plaza.z) + 0.05, layout.plaza.z);
  root.add(plaza);

  for (const path of layout.paths) root.add(buildPath(path));
  for (const b of layout.buildings) root.add(buildBuilding(b));
  for (const l of layout.lamps) root.add(buildLamp(l));
  for (const seg of layout.fences) root.add(buildFence(seg));

  // Farm plots — unlocked ones a richer tilled brown, locked ones greyed.
  for (const plot of layout.farm.plots) {
    root.add(
      groundPatch(
        plot.x,
        plot.z,
        VILLAGE.farm.tile,
        VILLAGE.farm.tile,
        plot.unlocked ? C.plot : C.plotLocked,
        0.07,
      ),
    );
  }

  // Home pens: a small fenced patch beside each home.
  for (const pen of layout.pens) {
    root.add(groundPatch(pen.x, pen.z, pen.w, pen.d, C.plaza, 0.04));
    const hw = pen.w / 2;
    const hd = pen.d / 2;
    const corners: FenceSeg[] = [
      { x1: pen.x - hw, z1: pen.z - hd, x2: pen.x + hw, z2: pen.z - hd },
      { x1: pen.x + hw, z1: pen.z - hd, x2: pen.x + hw, z2: pen.z + hd },
      { x1: pen.x + hw, z1: pen.z + hd, x2: pen.x - hw, z2: pen.z + hd },
      { x1: pen.x - hw, z1: pen.z + hd, x2: pen.x - hw, z2: pen.z - hd },
    ];
    for (const seg of corners) root.add(buildFence(seg));
  }

  scene.add(root);
  return root;
}
