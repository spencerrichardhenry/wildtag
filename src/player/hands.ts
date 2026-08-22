import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HANDS } from '../core/constants.ts';
import { makeSurfaceMaterial } from '../core/materials.ts';
import type { ItemId } from '../craft/hotbar.ts';

// ---------------------------------------------------------------------------
// First-person hands (Inventory+Building Task 6). Two low-poly mitten+forearm
// groups parented directly to the camera, tucked into the bottom corners of
// the view: right permanently carries the grapple-hook viewmodel (resting in
// the mitten whenever the hook is unlocked and not currently out); left shows
// a tiny model of whatever hotbar item is selected (or an empty open mitten).
// Purely cosmetic — no gameplay reads this class at all; main.ts feeds it a
// snapshot each render() frame and it only ever mutates its own meshes.
//
// Render-on-top: a camera-child group positioned close (z ≈ -0.82) with
// ordinary depth-tested materials. At that distance the near clip plane
// (CAMERA.near = 0.1) and normal scene geometry (nothing solid renders inside
// arm's reach) mean depth testing alone keeps the hands from clipping through
// nearby walls — no renderOrder/depthTest-off hack needed. If a future change
// introduces close-up geometry that clips the hands, switch to
// `renderOrder = 999` + `depthTest = false` on every material here (documented
// so the next person doesn't have to rediscover this).
//
// IMPORTANT — camera must be IN the scene graph: `WebGLRenderer.render(scene,
// camera)` builds its draw list by traversing from `scene`, not from `camera`.
// `camera.updateMatrixWorld()` keeps a camera-child's matrixWorld correct
// regardless (that part "just works"), but nothing parented only to the
// camera is ever actually drawn unless the camera itself is reachable from
// `scene` (main.ts does `scene.add(camera)` right after constructing it, with
// a comment pointing back here). Every mesh built below is named 'handsView'
// so `flagShadowCasters` (main.ts) can skip it by name, same as it already
// does for skyDome/water — a camera-relative viewmodel casting a shadow into
// the world would look broken.
//
// Draw-call budget: every mesh below is only present in the render list while
// visible, and the two "only one visible at a time" mesh sets (the grapple
// hook; the five held-item meshes) mean the worst case — hook resting AND a
// non-empty item held — is 4 meshes per hand (forearm, cuff, mitten, hook/
// item), 8 total. Materials are shared across both hands (one skin material,
// one sleeve/cuff material) and the item meshes share materials where the
// same look just needs a re-tint (darts/purifiers one material, the two kits
// another) — see `buildItemMeshes` below.
// ---------------------------------------------------------------------------

/** Per-frame snapshot main.ts feeds `HandsView.update()`. */
export interface HandsUpdateOpts {
  /** Horizontal ground speed (m/s) — drives the walk-bob amplitude. */
  speed: number;
  /**
   * The currently-held hotbar item, or `null` for "show nothing" — an empty
   * slot AND a slot whose owned count is 0 both resolve to `null` upstream
   * (main.ts: `const item = hotbar.slots[selected]; selectedItem: item &&
   * itemCount(inventory, item) > 0 ? item : null`), so this class never has to
   * know about `Inventory`/`itemCount` itself.
   */
  selectedItem: ItemId | null;
  /** True once the grapple recipe is unlocked (`player.unlocks.has('grapple')`). */
  grappleUnlocked: boolean;
  /** True while a grapple rope is currently out (`player.isGrappling()`). */
  hookLive: boolean;
  /** True while mounted (`player.mounted`) — the right hand hides regardless. */
  riding: boolean;
  /** Screens open, daze blackout, `?debug=`/`?preview=` framing shots, riding —
   *  hide the WHOLE view model (`root.visible = false`), both hands. */
  hidden: boolean;
}

/** Every hand mesh gets this name so `flagShadowCasters` (main.ts) can skip
 *  it — a camera-relative viewmodel casting a shadow into the world would
 *  read as broken. Also explicitly zeroes `castShadow`/`receiveShadow` so the
 *  behavior doesn't depend solely on that name-based skip. */
function tagMesh<T extends THREE.Mesh>(mesh: T): T {
  mesh.name = 'handsView';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

const ITEM_IDS_WITH_MESH: readonly ItemId[] = [
  'darts',
  'slowDarts',
  'purifiers',
  'charms',
  'kit:zipline',
  'kit:drone',
  'wall',
  'ramp',
  'cube',
];

/** Merge cylinder-shaft + fanned cone-prongs into one BufferGeometry so the
 *  resting hook viewmodel costs a single draw call. Falls back to a bare
 *  shaft if the merge ever fails (mismatched attributes) — same defensive
 *  pattern as `village/buildings.ts`/`castle/builders.ts`. */
function buildHookGeometry(): THREE.BufferGeometry {
  const shaft = new THREE.CylinderGeometry(
    HANDS.hookShaft.topR,
    HANDS.hookShaft.bottomR,
    HANDS.hookShaft.len,
    6,
  );
  shaft.translate(0, HANDS.hookShaft.len / 2, 0); // base at the local origin, tip up +y
  const parts: THREE.BufferGeometry[] = [shaft];
  const tipY = HANDS.hookShaft.len;
  for (let i = 0; i < HANDS.hookProng.count; i++) {
    const ang = (i / HANDS.hookProng.count) * Math.PI * 2;
    const prong = new THREE.ConeGeometry(HANDS.hookProng.r, HANDS.hookProng.len, 4);
    prong.rotateX(Math.PI * 0.32); // splay outward from the shaft's axis
    prong.translate(Math.cos(ang) * HANDS.hookProng.fanR, tipY, Math.sin(ang) * HANDS.hookProng.fanR);
    parts.push(prong);
  }
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return merged ?? new THREE.CylinderGeometry(HANDS.hookShaft.topR, HANDS.hookShaft.bottomR, HANDS.hookShaft.len, 6);
}

/** A right-triangle prism (width × run × rise) — the mini ramp wedge. */
function buildRampGeometry(): THREE.BufferGeometry {
  const { w, run, rise } = HANDS.rampWedge;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(run, 0);
  shape.lineTo(run, rise);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  geo.center();
  return geo;
}

/** One hand's forearm+cuff+mitten, plus a `THREE.Vector3` unit direction the
 *  forearm/cuff recede along (down, back toward the camera, and laterally
 *  outward toward this hand's OWN bottom screen corner). */
function buildArm(
  group: THREE.Group,
  mirror: 1 | -1,
  skinMat: THREE.Material,
  sleeveMat: THREE.Material,
  cuffMat: THREE.Material,
  ownGeometries: THREE.BufferGeometry[],
): void {
  const armDir = new THREE.Vector3(HANDS.armLateral * mirror, -HANDS.armDown, HANDS.armBack).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), armDir);

  const forearmGeo = new THREE.CylinderGeometry(
    HANDS.forearmRadii.top,
    HANDS.forearmRadii.bottom,
    HANDS.forearmLen,
    HANDS.forearmSegments,
  );
  forearmGeo.translate(0, HANDS.forearmLen / 2, 0); // near end (wrist) at the mesh's own origin
  const forearm = tagMesh(new THREE.Mesh(forearmGeo, sleeveMat));
  forearm.quaternion.copy(q);
  forearm.position.copy(armDir).multiplyScalar(HANDS.mittenRadius * 0.55);
  group.add(forearm);

  // The reference's dark band sits directly at the wrist. It overlays the
  // sleeve's near end and tucks slightly into the palm so no skin/sleeve seam
  // opens while the hands bob.
  const cuffGeo = new THREE.CylinderGeometry(HANDS.cuffRadii.top, HANDS.cuffRadii.bottom, HANDS.cuffLen, HANDS.forearmSegments);
  const cuff = tagMesh(new THREE.Mesh(cuffGeo, cuffMat));
  cuff.quaternion.copy(q);
  cuff.position.copy(armDir).multiplyScalar(HANDS.mittenRadius * 0.55 + HANDS.cuffLen * 0.42);
  group.add(cuff);

  // Palm + compact claw lobes + opposing thumb, merged into ONE geometry.
  // The shallow seams suggest a hand while preserving the reference's cute,
  // toy-like pincer silhouette instead of exposing anatomical fingers.
  const handGeo = buildHandGeometry(mirror);
  const hand = tagMesh(new THREE.Mesh(handGeo, skinMat));
  hand.rotation.z = mirror * 0.18; // both claws lean gently toward screen-centre
  group.add(hand);

  ownGeometries.push(forearmGeo, cuffGeo, handGeo);
}

/** Low-poly claw lobe whose local Y axis follows `dir`. */
function clawLobe(
  r: number,
  len: number,
  start: THREE.Vector3,
  dir: THREE.Vector3,
): THREE.BufferGeometry {
  const unit = dir.clone().normalize();
  const geometry = new THREE.CapsuleGeometry(r, len, 2, 5);
  geometry.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), unit),
  );
  geometry.translate(
    start.x + unit.x * len * 0.5,
    start.y + unit.y * len * 0.5,
    start.z + unit.z * len * 0.5,
  );
  return geometry;
}

/** Palm + three overlapping upper lobes + one opposing thumb as one merged
 *  geometry. `mirror` flips the pincer so the pair reads as left/right hands.
 *  Falls back to the bare palm if a merge ever fails. */
function buildHandGeometry(mirror: 1 | -1): THREE.BufferGeometry {
  const R = HANDS.mittenRadius;
  const palm = new THREE.SphereGeometry(R, 8, 6);
  palm.scale(HANDS.mittenScale.x, HANDS.mittenScale.y, HANDS.mittenScale.z);

  const parts: THREE.BufferGeometry[] = [palm];
  const C = HANDS.claw;
  for (let i = -1; i <= 1; i++) {
    parts.push(clawLobe(
      C.r * (i === 0 ? 1.04 : 1),
      C.len * (i === 0 ? 1.05 : 0.94),
      new THREE.Vector3(
        i * C.spread + mirror * R * 0.08,
        R * 0.34 - Math.abs(i) * R * 0.035,
        -R * HANDS.mittenScale.z * 0.52,
      ),
      new THREE.Vector3(-mirror * 0.17, 0.78, -0.61),
    ));
  }

  const T = HANDS.thumb;
  parts.push(clawLobe(
    T.r,
    T.len,
    new THREE.Vector3(-mirror * R * 0.78, -R * 0.08, -R * 0.14),
    new THREE.Vector3(mirror * 0.38, 0.72, -0.58),
  ));

  const merged = mergeGeometries(
    parts.map((g) => (g.index ? g.toNonIndexed() : g)),
    false,
  );
  if (!merged) return palm; // defensive: mismatched attributes
  for (const g of parts) g.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** Build the five distinct held-item meshes (darts/purifiers and the two kits
 *  each share one mesh, re-tinted on select), all parented to `group`, hidden
 *  until `setLeftItem` picks one. Returns the per-`ItemId` mesh lookup. */
function buildItemMeshes(group: THREE.Group): Record<ItemId, THREE.Mesh> {
  const dartGeo = new THREE.CylinderGeometry(HANDS.dart.r, HANDS.dart.r, HANDS.dart.len, 6);
  dartGeo.rotateX(Math.PI / 2); // lie lengthwise, pointing away from the camera
  const dartMesh = new THREE.Mesh(dartGeo, makeSurfaceMaterial({ color: HANDS.itemColor.darts }));
  dartMesh.position.set(0, HANDS.mittenRadius * 0.55, -HANDS.mittenRadius * 0.5);

  const kitGeo = new THREE.BoxGeometry(HANDS.kitBox, HANDS.kitBox, HANDS.kitBox);
  const kitMesh = new THREE.Mesh(kitGeo, makeSurfaceMaterial({ color: HANDS.itemColor['kit:zipline'] }));
  kitMesh.position.set(0, HANDS.mittenRadius * 0.65, -HANDS.mittenRadius * 0.4);

  const charmGeo = new THREE.SphereGeometry(HANDS.charmRadius, 10, 8);
  const charmMesh = new THREE.Mesh(
    charmGeo,
    makeSurfaceMaterial({
      color: HANDS.itemColor.charms,
      emissive: HANDS.itemColor.charms,
      emissiveIntensity: 0.7,
    }),
  );
  charmMesh.position.set(0, HANDS.mittenRadius * 0.7, -HANDS.mittenRadius * 0.4);

  const wallGeo = new THREE.BoxGeometry(HANDS.wallSlab.w, HANDS.wallSlab.h, HANDS.wallSlab.t);
  const wallMesh = new THREE.Mesh(wallGeo, makeSurfaceMaterial({ color: HANDS.itemColor.wall }));
  wallMesh.position.set(0, HANDS.mittenRadius * 0.75, -HANDS.mittenRadius * 0.35);

  const rampMesh = new THREE.Mesh(buildRampGeometry(), makeSurfaceMaterial({ color: HANDS.itemColor.ramp }));
  rampMesh.position.set(0, HANDS.mittenRadius * 0.55, -HANDS.mittenRadius * 0.3);
  rampMesh.rotation.y = Math.PI / 5;

  // Mini cube-block viewmodel (playtest Task 8) — a small cube, same tint
  // family as the wall slab (both read as stone).
  const cubeGeo = new THREE.BoxGeometry(HANDS.cubeBlock, HANDS.cubeBlock, HANDS.cubeBlock);
  const cubeMesh = new THREE.Mesh(cubeGeo, makeSurfaceMaterial({ color: HANDS.itemColor.cube }));
  cubeMesh.position.set(0, HANDS.mittenRadius * 0.75, -HANDS.mittenRadius * 0.35);

  for (const m of [dartMesh, kitMesh, charmMesh, wallMesh, rampMesh, cubeMesh]) {
    tagMesh(m);
    m.visible = false;
    group.add(m);
  }

  return {
    darts: dartMesh,
    slowDarts: dartMesh,
    purifiers: dartMesh,
    charms: charmMesh,
    'kit:zipline': kitMesh,
    'kit:drone': kitMesh,
    wall: wallMesh,
    ramp: rampMesh,
    cube: cubeMesh,
  };
}

export class HandsView {
  private readonly root = new THREE.Group();
  private readonly right = new THREE.Group();
  private readonly left = new THREE.Group();
  private readonly hook: THREE.Mesh;
  private readonly items: Record<ItemId, THREE.Mesh>;
  private readonly ownMaterials: THREE.Material[] = [];
  private readonly ownGeometries: THREE.BufferGeometry[] = [];
  private t = 0;
  /** The item mesh currently shown (or null) — avoids re-touching material
   *  color/visibility every single frame when the selection hasn't changed. */
  private shownItem: ItemId | null = null;

  constructor(camera: THREE.Camera) {
    this.root.name = 'handsView';
    this.right.position.set(HANDS.rightOffset.x, HANDS.rightOffset.y, HANDS.rightOffset.z);
    this.left.position.set(HANDS.leftOffset.x, HANDS.leftOffset.y, HANDS.leftOffset.z);
    this.root.add(this.right, this.left);

    const skinMat = makeSurfaceMaterial({ color: HANDS.skinColor });
    const sleeveMat = makeSurfaceMaterial({ color: HANDS.sleeveColor });
    const cuffMat = makeSurfaceMaterial({ color: HANDS.cuffColor });
    this.ownMaterials.push(skinMat, sleeveMat, cuffMat);

    buildArm(this.right, 1, skinMat, sleeveMat, cuffMat, this.ownGeometries);
    buildArm(this.left, -1, skinMat, sleeveMat, cuffMat, this.ownGeometries);

    const hookGeo = buildHookGeometry();
    const hookMat = makeSurfaceMaterial({ color: HANDS.hookColor, metalness: 0.6, roughness: 0.4 });
    this.ownGeometries.push(hookGeo);
    this.ownMaterials.push(hookMat);
    this.hook = tagMesh(new THREE.Mesh(hookGeo, hookMat));
    this.hook.position.set(0, HANDS.mittenRadius * 0.5, -HANDS.mittenRadius * 0.4);
    this.hook.rotation.x = -1.0; // tip pointing forward/up, resting in the mitten
    this.hook.visible = false;
    this.right.add(this.hook);

    this.items = buildItemMeshes(this.left);
    for (const item of ITEM_IDS_WITH_MESH) {
      const mesh = this.items[item];
      if (!this.ownGeometries.includes(mesh.geometry as THREE.BufferGeometry)) {
        this.ownGeometries.push(mesh.geometry as THREE.BufferGeometry);
      }
      if (!this.ownMaterials.includes(mesh.material as THREE.Material)) {
        this.ownMaterials.push(mesh.material as THREE.Material);
      }
    }

    camera.add(this.root);
  }

  update(dt: number, opts: HandsUpdateOpts): void {
    this.root.visible = !opts.hidden;
    if (opts.hidden) return;

    this.t += dt;
    const speedFactor = Math.min(Math.max(opts.speed, 0) / HANDS.bobSpeedCap, 1);
    const swayT = this.t * HANDS.swayFreq;
    const bobT = this.t * HANDS.bobFreq;

    this.applyHandPose(this.right, HANDS.rightOffset, swayT, bobT, speedFactor, 0);
    this.applyHandPose(this.left, HANDS.leftOffset, swayT, bobT, speedFactor, Math.PI);

    this.hook.visible = opts.grappleUnlocked && !opts.hookLive && !opts.riding;
    this.setLeftItem(opts.selectedItem);
  }

  /** Idle sway (sin of time, phase-offset per hand) + walk bob (scaled by
   *  horizontal speed, opposite phase per hand for an alternating swing). */
  private applyHandPose(
    group: THREE.Group,
    base: { x: number; y: number; z: number },
    swayT: number,
    bobT: number,
    speedFactor: number,
    phase: number,
  ): void {
    const sway = Math.sin(swayT + phase) * HANDS.swayAmp;
    const swayY = Math.cos(swayT * 0.7 + phase) * HANDS.swayAmp * 0.6;
    const bob = Math.sin(bobT + phase) * HANDS.bobAmp * speedFactor;
    group.position.set(base.x + sway, base.y + swayY + bob, base.z);
  }

  private setLeftItem(item: ItemId | null): void {
    if (item === this.shownItem) return;
    if (this.shownItem !== null) this.items[this.shownItem].visible = false;
    this.shownItem = item;
    if (item === null) return;
    const mesh = this.items[item];
    mesh.visible = true;
    // darts/purifiers share one mesh, as do the two kits — re-tint on select
    // rather than swapping geometry (wall/ramp/charms each own a fixed color).
    if (
      item === 'darts' ||
      item === 'slowDarts' ||
      item === 'purifiers' ||
      item === 'kit:zipline' ||
      item === 'kit:drone'
    ) {
      (mesh.material as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial).color.setHex(HANDS.itemColor[item]);
    }
  }

  /** Debug/verification snapshot (Inventory+Building Task 6 headless checks):
   *  live visibility + world position of the right/left groups. */
  debugState(): {
    rootVisible: boolean;
    rightVisible: boolean;
    hookVisible: boolean;
    leftItem: ItemId | null;
    rightWorldPos: [number, number, number];
    leftWorldPos: [number, number, number];
  } {
    const rp = new THREE.Vector3();
    const lp = new THREE.Vector3();
    this.right.getWorldPosition(rp);
    this.left.getWorldPosition(lp);
    return {
      rootVisible: this.root.visible,
      rightVisible: this.right.visible,
      hookVisible: this.hook.visible,
      leftItem: this.shownItem,
      rightWorldPos: [rp.x, rp.y, rp.z],
      leftWorldPos: [lp.x, lp.y, lp.z],
    };
  }

  /** Tear down every owned mesh/geometry/material and detach from the camera.
   *  Not currently called anywhere (no app-wide teardown path exists yet —
   *  matches `GrappleVisuals`, which has no `dispose()` either), kept for
   *  hygiene/future reload paths. */
  dispose(): void {
    this.root.removeFromParent();
    for (const g of this.ownGeometries) g.dispose();
    for (const m of this.ownMaterials) m.dispose();
  }
}
