import * as THREE from 'three';
import { BUILD } from '../core/constants.ts';
import type { GroundQuery, Vec3 } from '../core/types.ts';
import type { Inventory } from '../craft/inventory.ts';
import type { Obstacle } from '../player/collision.ts';
import type { GrappleCollider } from '../player/grapple.ts';
import { toast } from '../ui/toasts.ts';
import {
  buildTopAt,
  freeformSnap,
  pieceAtRay,
  pieceGrapple,
  pieceHeight,
  pieceObstacles,
  placementValid,
  resolveSnap,
  type BuildPiece,
  type PieceKind,
} from './buildmath.ts';
import type { BuildPersistEntry } from '../core/save.ts';

// ---------------------------------------------------------------------------
// BuildSystem (Inventory+Building Task 5): the three.js presentation layer
// over the pure `buildmath.ts` core — ghost placement, pickup, mesh spawn/
// dispose, the mutable piece list + its spatial hash, and persistence.
// Modeled on `src/structures/placement.ts` (ghost tracking, VALID/INVALID
// tint, confirm-toasts) with one deliberate deviation: `update`/`beginPickup`/
// `tickPickup` all take the aim point (or origin+look) as PLAIN PARAMETERS
// rather than owning a `THREE.Camera` internally — main.ts does the one
// raycast (against the COMPOSED ground, so a ghost can sit on an existing
// piece's top) and hands the result in. That keeps this class trivially
// testable with plain `{x,y,z}` points and no camera mock, mirroring how
// `buildmath.ts` itself stays three-free.
//
// `ground` here is the RAW terrain query (heightAt = natural terrain only,
// NOT the composed effectiveGroundAt) — `placementValid`'s height-cap check
// measures a stack's total height above the natural terrain, so composing it
// here would make the cap moot the moment a piece already occupies (x, z)
// (composed heightAt would just read back the candidate's own base). Ghost
// AIMING still wants the composed surface (so freeform aim can land on an
// existing piece's top without a snap candidate) — that composition is
// main.ts's job (it already owns the composed `ground`), not this class's.
// ---------------------------------------------------------------------------

const VALID_COLOR = 0x36e07a;
const INVALID_COLOR = 0xe0463a;

const WALL_COLOR = 0x8f8f92; // stone grey
const RAMP_COLOR = 0x8a5a35; // wood brown — "ramps read wood" (design spec §3)

/** Capitalized display names, for toasts ("Wall placed", "+1 Cube reclaimed"). */
const KIND_LABEL: Record<PieceKind, string> = { wall: 'Wall', ramp: 'Ramp', cube: 'Cube' };

/** Vertical offset (m) from a piece's stored `y` (base) to its MESH's local
 *  origin: a wall/cube's shared BoxGeometry is centred, so its mesh sits half
 *  its height above the base; a ramp's geometry starts at local y=0 (its own
 *  base), so no offset is needed. */
function baseYOffset(kind: PieceKind): number {
  return kind === 'ramp' ? 0 : pieceHeight(kind) / 2;
}

/**
 * Shared ramp wedge geometry (Task 5): a right triangular prism in the local
 * (x = u/width, y = height, z = w/run) frame `buildmath.ts`'s file header
 * documents — low edge at z = -run/2 (y=0), high edge at z = +run/2 (y=0..rise).
 * Built once (module scope) and reused by every ramp mesh/ghost; non-indexed
 * so `computeVertexNormals()` yields correct flat per-face shading without
 * any vertex sharing across faces.
 */
function buildRampGeometry(): THREE.BufferGeometry {
  const hu = BUILD.ramp.w / 2;
  const halfRun = BUILD.ramp.run / 2;
  const rise = BUILD.ramp.rise;

  const A = [-hu, 0, -halfRun];
  const B = [hu, 0, -halfRun];
  const C = [-hu, 0, halfRun];
  const D = [hu, 0, halfRun];
  const E = [-hu, rise, halfRun];
  const F = [hu, rise, halfRun];

  const positions: number[] = [];
  const tri = (p0: number[], p1: number[], p2: number[]): void => {
    positions.push(...p0, ...p1, ...p2);
  };

  tri(A, B, D); // bottom
  tri(A, D, C);
  tri(C, D, F); // back riser (high end, +z)
  tri(C, F, E);
  tri(A, F, B); // slanted top surface
  tri(A, E, F);
  tri(A, C, E); // side (u = -hu)
  tri(B, F, D); // side (u = +hu)

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

const wallGeo = new THREE.BoxGeometry(BUILD.wall.w, BUILD.wall.h, BUILD.wall.t);
const rampGeo = buildRampGeometry();
// Cube (playtest Task 8) shares the wall's stone-grey material — the brief's
// "stone-gray cube, shared material" — only the geometry differs.
const cubeGeo = new THREE.BoxGeometry(BUILD.cube.w, BUILD.cube.h, BUILD.cube.d);
const wallMat = new THREE.MeshStandardMaterial({ color: WALL_COLOR });
const rampMat = new THREE.MeshStandardMaterial({ color: RAMP_COLOR });

function geometryFor(kind: PieceKind): THREE.BufferGeometry {
  if (kind === 'ramp') return rampGeo;
  if (kind === 'cube') return cubeGeo;
  return wallGeo;
}

function materialFor(kind: PieceKind): THREE.MeshStandardMaterial {
  return kind === 'ramp' ? rampMat : wallMat;
}

function reasonToast(kind: PieceKind, reason: 'height' | 'overlap' | 'max' | 'stock'): string {
  if (reason === 'max') return 'Build limit reached!';
  if (reason === 'stock') return `No ${kind}s left`;
  if (reason === 'height') return 'Too high — 4-piece stack limit';
  return 'Blocked — overlapping another piece';
}

/** 3×3 hash-bucket near-query, same convention as `castle/ward.ts`'s
 *  `queryNear`/`buildHash`, but REBUILT wholesale on every place/pickup
 *  rather than memoised forever — pieces are dynamic (≤ BUILD.maxPieces =
 *  200, so a full rebuild is cheap). */
function bucketKey(x: number, z: number): string {
  return `${Math.floor(x / BUILD.hashCell)},${Math.floor(z / BUILD.hashCell)}`;
}

export class BuildSystem {
  private readonly scene: THREE.Scene;
  private readonly ground: GroundQuery;
  private readonly inventory: Inventory;

  private readonly piecesList: BuildPiece[] = [];
  private nextId = 0;
  private hash = new Map<string, BuildPiece[]>();
  private readonly meshes = new Map<number, THREE.Mesh>();

  // --- Ghost placement -----------------------------------------------------
  private kind: PieceKind | null = null;
  private ghost: THREE.Mesh | null = null;
  private ghostMat: THREE.MeshStandardMaterial | null = null;
  private pending: BuildPiece | null = null;
  private pendingReason: 'height' | 'overlap' | 'max' | 'stock' | null = null;
  private valid = false;
  /**
   * Accumulated +90°-step rotation offset (radians, playtest Task 8) applied
   * ON TOP of whatever yaw `resolveSnap`/`freeformSnap` resolved — additive,
   * so it combines with both camera-yaw-stepped freeform placement AND a
   * snap candidate's own inherited yaw (e.g. rotating a piece that's
   * top-snapped onto an existing stack). Reset whenever a fresh ghost is
   * entered or the ghost exits (place/cancel) — a rotation never carries
   * over to the NEXT ghost session.
   */
  private ghostYawOffset = 0;

  // --- Pickup (hold-F reclaim) ----------------------------------------------
  private pickupId: number | null = null;
  private pickupElapsed = 0;

  constructor(scene: THREE.Scene, ground: GroundQuery, inventory: Inventory) {
    this.scene = scene;
    this.ground = ground;
    this.inventory = inventory;
  }

  /** True while a ghost is active (a wall/ramp/cube hotbar slot is selected). */
  get active(): boolean {
    return this.kind !== null;
  }

  /** Rotate the active ghost +90° (accumulating). No-op with no ghost active.
   *  Playtest Task 8: KeyR while a ghost is active — see main.ts's dispatch. */
  rotateGhost(): void {
    if (!this.kind) return;
    this.ghostYawOffset += Math.PI / 2;
  }

  /** Live placed pieces (read-only snapshot reference — not copied). */
  pieces(): readonly BuildPiece[] {
    return this.piecesList;
  }

  // -------------------------------------------------------------------------
  // Ghost placement
  // -------------------------------------------------------------------------

  /** Hotbar selection entered a placeable slot: 'wall', 'ramp' or 'cube'.
   *  No-ops (toasts) with an empty stock so the ghost never enters with
   *  nothing to place. */
  enter(kind: PieceKind): void {
    if (this.stock(kind) <= 0) {
      toast(`No ${kind}s`);
      return;
    }
    this.kind = kind;
    this.pending = null;
    this.pendingReason = null;
    this.valid = false;
    this.ghostYawOffset = 0;
    this.buildGhost(kind);
    toast(`${KIND_LABEL[kind]} — aim and click to place`);
  }

  /** Cancel the active ghost (Esc, or the hotbar selection moving away). */
  cancel(): void {
    if (!this.kind) return;
    this.exit();
    toast('Placement cancelled');
  }

  /**
   * Per-frame ghost update. `aim` is the already-raycast world point (against
   * the COMPOSED ground — main.ts's job) or `null` on a total miss; `camYawDeg`
   * is the camera yaw in DEGREES (the one non-radians input `resolveSnap`
   * takes, per its own doc). `snapHeld` (playtest Task 8 — explicit Ctrl-
   * snap): snap candidates are only consulted while true; while false, the
   * ghost is pure freeform (`freeformSnap` — camera-yaw-stepped, never
   * anchored to an existing piece) regardless of aim proximity to one.
   * Gated HERE rather than in `buildmath.ts` so that module stays pure/
   * unconditional and its own `resolveSnap` unit tests need no changes.
   * No-ops when no ghost is active.
   */
  update(_dt: number, aim: Vec3 | null, camYawDeg: number, snapHeld: boolean): void {
    const kind = this.kind;
    if (!kind || !this.ghost) return;

    if (!aim) {
      this.ghost.visible = false;
      this.pending = null;
      this.pendingReason = null;
      this.valid = false;
      return;
    }

    const snap = snapHeld
      ? resolveSnap(this.piecesList, kind, aim, camYawDeg)
      : freeformSnap(aim, camYawDeg);
    // The ghost-rotation offset (KeyR) applies ADDITIVELY on top of whichever
    // yaw resolveSnap/freeformSnap resolved — see `rotateGhost`'s doc.
    const yaw = snap.yaw + this.ghostYawOffset;
    const candidate: BuildPiece = { id: -1, kind, x: snap.x, y: snap.y, z: snap.z, yaw };
    const terrainY = this.ground.heightAt(candidate.x, candidate.z);
    const maxed = this.piecesList.length >= BUILD.maxPieces;
    const outOfStock = this.stock(kind) <= 0;
    const check = placementValid(this.piecesList, candidate, terrainY);

    this.pending = candidate;
    this.pendingReason = maxed ? 'max' : outOfStock ? 'stock' : (check.reason ?? null);
    this.valid = !maxed && !outOfStock && check.ok;

    this.ghost.visible = true;
    this.ghost.position.set(candidate.x, candidate.y + baseYOffset(kind), candidate.z);
    this.ghost.rotation.y = candidate.yaw;
    const color = this.valid ? VALID_COLOR : INVALID_COLOR;
    this.ghostMat?.color.setHex(color);
    this.ghostMat?.emissive.setHex(color);
  }

  /** LMB confirm: validity + inventory decrement + mesh spawn + registration. */
  confirm(): boolean {
    const kind = this.kind;
    if (!kind) return false;
    if (!this.pending) {
      toast('Nothing to place there');
      return false;
    }
    if (!this.valid) {
      toast(reasonToast(kind, this.pendingReason ?? 'overlap'));
      return false;
    }
    const remaining = this.stock(kind) - 1;
    this.setStock(kind, remaining);
    const piece: BuildPiece = { ...this.pending, id: this.nextId++ };
    this.piecesList.push(piece);
    this.rebuildHash();
    this.spawnMesh(piece);
    toast(`${KIND_LABEL[kind]} placed`);
    // Auto-exit the ghost the moment stock hits zero — otherwise it lingers
    // active-but-permanently-red (every future update() reads 'stock' as the
    // invalid reason) until the player notices and backs out themselves.
    if (remaining <= 0) this.exit();
    return true;
  }

  // -------------------------------------------------------------------------
  // Pickup (hold F while aiming at a placed piece)
  // -------------------------------------------------------------------------

  /** Pure aim query (no side effects) — used both by `beginPickup` and by
   *  main.ts's HUD prompt (independent of whether F is actually held). */
  aimedPiece(origin: Vec3, look: Vec3): BuildPiece | null {
    return pieceAtRay(this.piecesList, origin, look, BUILD.pickupRange);
  }

  /** Lock in the pickup target from the current aim. Call on interact's
   *  rising edge (F just pressed down). Idempotent to call again mid-hold —
   *  it would just re-lock the same target if the aim hasn't moved. */
  beginPickup(origin: Vec3, look: Vec3): void {
    const target = this.aimedPiece(origin, look);
    this.pickupId = target?.id ?? null;
    this.pickupElapsed = 0;
  }

  /** Advance the locked-in pickup by `dt`; true the exact frame it completes
   *  (piece reclaimed into inventory). False (no-op) if nothing is locked in. */
  tickPickup(dt: number): boolean {
    if (this.pickupId === null) return false;
    this.pickupElapsed += dt;
    if (this.pickupElapsed < BUILD.pickupHoldS) return false;
    this.completePickup(this.pickupId);
    this.pickupId = null;
    this.pickupElapsed = 0;
    return true;
  }

  /** F released before completing — clears the in-progress pickup. */
  cancelPickup(): void {
    this.pickupId = null;
    this.pickupElapsed = 0;
  }

  /** Hold progress [0, 1] for the HUD prompt bar/percentage; 0 when idle. */
  pickupProgress(): number {
    if (this.pickupId === null) return 0;
    return Math.min(1, this.pickupElapsed / BUILD.pickupHoldS);
  }

  private completePickup(id: number): void {
    const idx = this.piecesList.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const piece = this.piecesList[idx]!;
    this.disposeMesh(piece.id);
    this.piecesList.splice(idx, 1);
    this.rebuildHash();
    this.setStock(piece.kind, this.stock(piece.kind) + 1);
    toast(`+1 ${KIND_LABEL[piece.kind]} reclaimed`);
  }

  // -------------------------------------------------------------------------
  // Ground extension / physics near-queries (chunk-hash, mirrors ward.ts)
  // -------------------------------------------------------------------------

  /** Analytic ground-extension query: highest walkable top any piece
   *  contributes at (x, z), or `-Infinity` on a fast-miss (no piece anywhere
   *  near the query's hash bucket — main.ts's composed `heightAt` then just
   *  falls back to raw terrain). */
  topAt(x: number, z: number): number {
    const near = this.near(x, z);
    if (near.length === 0) return -Infinity;
    return buildTopAt(near, x, z);
  }

  /**
   * Obstacle pushout circles for player/goblin/elf collision near (x, z) —
   * same 3×3 near-query convention as ward/spire obstacles, but with TWO
   * deliberate departures from `pieceObstacles`'s raw output (discovered by
   * hands-on verification, not by `buildmath.ts`'s own unit tests, which only
   * check the pure geometry in isolation — never composed with
   * `resolveCollision`):
   *
   * 1. RAMPS ARE EXCLUDED. `resolveCollision`'s obstacle model is a plain
   *    XZ-distance-vs-radius test gated ONLY by `pos.y > yTop` (see
   *    collision.ts) — it has no notion of a sloped walkable surface. A
   *    ramp's single centred circle (r=0.9, `pieceCircles`) has
   *    `r + player.radius = 1.3` — LARGER than the footprint's own half-run
   *    (1.0) — so it covers the ENTIRE climbable surface, and `pos.y` stays
   *    below `yTop` (the ramp's HIGH-end height) for virtually the whole
   *    climb. Net effect verified empirically: a player walking onto a ramp
   *    is shoved straight back off it every step, never climbing at all. A
   *    ramp's whole point is to BE the walkable path (its only real "wall"
   *    is the high-end riser, which is flush against whatever it was
   *    snapped to and already has ITS OWN wall obstacle) — so it contributes
   *    no obstacle to player-class movement at all. It still grapples
   *    (`grappleNear` below, unaffected — a different mechanic with no
   *    walking-through-it problem) and still blocks nothing it shouldn't.
   *
   * 2. WALL/CUBE yTop IS LOWERED BY `BUILD.standClearance`. The height-cap
   *    gate is `pos.y > ob.yTop` (STRICT). A player standing on a flat top
   *    has `pos.y` set to EXACTLY that top (the ground-resolve snap in
   *    movement.ts), so `pos.y > yTop` is false at that exact value and the
   *    "glide over" skip never triggers — the piece's own side-collision
   *    circles keep shoving a standing player off their own platform (an
   *    empirically observed ~1.5 m/step drift verified during hands-on
   *    testing, not caught by any prior unit test since none composed
   *    obstaclesNear with resolveCollision + the ground-resolve snap
   *    together). Lowering the ceiling by a few centimetres — well under
   *    `wall.h`/`cube.h` — costs nothing: walking into the piece's SIDE
   *    happens at ground level, far below `yTop - standClearance` either way.
   *    Cubes (playtest Task 8) get the exact same treatment as walls — same
   *    flat-topped-box shape, just bigger — so a player can stand on one.
   */
  obstaclesNear(x: number, z: number): Obstacle[] {
    return this.near(x, z)
      .filter((p) => p.kind === 'wall' || p.kind === 'cube')
      .flatMap(pieceObstacles)
      .map((o) => ({ ...o, yTop: (o.yTop ?? 0) - BUILD.standClearance }));
  }

  /** Grapple-latch cylinders for every piece near (x, z). */
  grappleNear(x: number, z: number): GrappleCollider[] {
    return this.near(x, z).flatMap(pieceGrapple);
  }

  private near(x: number, z: number): BuildPiece[] {
    if (this.hash.size === 0) return [];
    const bx = Math.floor(x / BUILD.hashCell);
    const bz = Math.floor(z / BUILD.hashCell);
    const out: BuildPiece[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = this.hash.get(`${bx + dx},${bz + dz}`);
        if (bucket) out.push(...bucket);
      }
    }
    return out;
  }

  private rebuildHash(): void {
    this.hash = new Map();
    for (const p of this.piecesList) {
      const key = bucketKey(p.x, p.z);
      let bucket = this.hash.get(key);
      if (!bucket) {
        bucket = [];
        this.hash.set(key, bucket);
      }
      bucket.push(p);
    }
  }

  // -------------------------------------------------------------------------
  // Debug (e2e): route a direct placement through the SAME placementValid
  // path confirm() uses, bypassing inventory (a debug convenience, like every
  // other __game.grant-style hook) but still respecting overlap/height/cap —
  // so a headless script can build a physically-valid stack without first
  // crafting/selecting through the hotbar. Returns false on any rejection.
  // -------------------------------------------------------------------------
  debugPlace(kind: string, x: number, y: number, z: number, yaw: number): boolean {
    const k = kind === 'wall' || kind === 'ramp' || kind === 'cube' ? kind : null;
    if (!k) return false;
    if (this.piecesList.length >= BUILD.maxPieces) return false;
    const candidate: BuildPiece = { id: -1, kind: k, x, y, z, yaw };
    const terrainY = this.ground.heightAt(x, z);
    if (!placementValid(this.piecesList, candidate, terrainY).ok) return false;
    const piece: BuildPiece = { ...candidate, id: this.nextId++ };
    this.piecesList.push(piece);
    this.rebuildHash();
    this.spawnMesh(piece);
    return true;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  serialize(): BuildPersistEntry[] {
    return this.piecesList.map((p) => ({
      k: p.kind === 'wall' ? 'w' : p.kind === 'cube' ? 'c' : 'r',
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: p.yaw,
    }));
  }

  /**
   * Replace every placed piece with `entries` (load path). Truncated to
   * `BUILD.maxPieces` in case a hand-edited/legacy save carries more —
   * unlike `confirm()`'s live 'Build limit reached!' toast, a silent load-
   * time drop would be invisible to the player (their fort just... has
   * fewer pieces than they left it with). Toasts when truncation actually
   * happens and returns `true` for that case too, so the signal is directly
   * testable without a toast spy.
   */
  deserialize(entries: readonly BuildPersistEntry[]): boolean {
    const truncated = entries.length > BUILD.maxPieces;
    for (const id of [...this.meshes.keys()]) this.disposeMesh(id);
    this.piecesList.length = 0;
    this.nextId = 0;
    for (const e of entries.slice(0, BUILD.maxPieces)) {
      const piece: BuildPiece = {
        id: this.nextId++,
        kind: e.k === 'w' ? 'wall' : e.k === 'c' ? 'cube' : 'ramp',
        x: e.x,
        y: e.y,
        z: e.z,
        yaw: e.yaw,
      };
      this.piecesList.push(piece);
      this.spawnMesh(piece);
    }
    this.rebuildHash();
    if (truncated) {
      toast(`Build limit reached — only the first ${BUILD.maxPieces} pieces loaded`);
    }
    return truncated;
  }

  // -------------------------------------------------------------------------

  private stock(kind: PieceKind): number {
    if (kind === 'wall') return this.inventory.walls;
    if (kind === 'cube') return this.inventory.cubes;
    return this.inventory.ramps;
  }

  private setStock(kind: PieceKind, n: number): void {
    if (kind === 'wall') this.inventory.walls = n;
    else if (kind === 'cube') this.inventory.cubes = n;
    else this.inventory.ramps = n;
  }

  private spawnMesh(piece: BuildPiece): void {
    const mesh = new THREE.Mesh(geometryFor(piece.kind), materialFor(piece.kind));
    mesh.position.set(piece.x, piece.y + baseYOffset(piece.kind), piece.z);
    mesh.rotation.y = piece.yaw;
    this.scene.add(mesh);
    this.meshes.set(piece.id, mesh);
  }

  private disposeMesh(id: number): void {
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    // Geometry/material are shared (module-level) — never disposed per-piece.
    this.scene.remove(mesh);
    this.meshes.delete(id);
  }

  private buildGhost(kind: PieceKind): void {
    this.disposeGhost();
    const mat = new THREE.MeshStandardMaterial({
      color: VALID_COLOR,
      emissive: VALID_COLOR,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometryFor(kind), mat);
    mesh.visible = false;
    this.scene.add(mesh);
    this.ghost = mesh;
    this.ghostMat = mat;
  }

  private disposeGhost(): void {
    if (!this.ghost) return;
    this.scene.remove(this.ghost);
    this.ghostMat?.dispose();
    this.ghost = null;
    this.ghostMat = null;
  }

  /** Tear down ghost state (place OR cancel) so no preview geometry leaks. */
  private exit(): void {
    this.disposeGhost();
    this.kind = null;
    this.pending = null;
    this.pendingReason = null;
    this.valid = false;
    this.ghostYawOffset = 0;
  }
}
