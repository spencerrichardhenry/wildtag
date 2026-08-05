import * as THREE from 'three';
import { STRUCTURES } from '../core/constants.ts';
import type { GroundQuery, Vec3 } from '../core/types.ts';
import { raycastTerrain } from '../player/grapple.ts';
import { toast } from '../ui/toasts.ts';
import { validateZipline, zipPoint, type ZiplineSystem } from './ziplines.ts';
import type { DroneSystem } from './drones.ts';
import type { Inventory } from '../craft/inventory.ts';

// ---------------------------------------------------------------------------
// Structure placement mode (Task 13). Entered from the hotbar: selecting the
// 'kit:zipline' item places a zipline (two stages — A then B), 'kit:drone'
// places a drone — whichever SLOT those items happen to be assigned to (since
// Inventory+Building Task 3, hotbar slots are a flexible loadout the player
// assigns freely, not fixed slot numbers; main.ts's `syncHotbarPlacement`
// drives entry/exit off the selected ITEM, not a slot index). A ghost mesh
// tracks the terrain aim point (raycast from the camera, capped at
// STRUCTURES.placeRange) and turns green when the current placement is valid,
// red when not. LMB confirms (a zipline stage A only stages the near post —
// no kit spent — and stage B validates against A and spends the kit; a drone
// spends on confirm). Esc or re-selecting the same tool's item cancels. Every
// transition toasts.
//
// The ghost group is disposed on every exit (place OR cancel, including
// cancel-by-hotbar) so no preview geometry leaks into the scene.
// ---------------------------------------------------------------------------

type Tool = 'zipline' | 'drone';
type Stage = 'a' | 'b';

const GHOST_SEGMENTS = 20;
const VALID_COLOR = 0x36e07a;
const INVALID_COLOR = 0xe0463a;

export class PlacementSystem {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly ground: GroundQuery;
  private readonly inventory: Inventory;
  private readonly ziplines: ZiplineSystem;
  private readonly drones: DroneSystem;

  private tool: Tool | null = null;
  private stage: Stage = 'a';
  private stagedA: Vec3 | null = null;

  private aim: Vec3 | null = null;
  private valid = false;

  private ghost: THREE.Group | null = null;
  private marker: THREE.Mesh | null = null;
  private markerMat: THREE.MeshStandardMaterial | null = null;
  private preview: THREE.Line | null = null;
  private previewMat: THREE.LineBasicMaterial | null = null;

  private readonly _dir = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    ground: GroundQuery,
    inventory: Inventory,
    ziplines: ZiplineSystem,
    drones: DroneSystem,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.ground = ground;
    this.inventory = inventory;
    this.ziplines = ziplines;
    this.drones = drones;
  }

  /** True while a placement is in progress (main routes LMB/Esc here). */
  get active(): boolean {
    return this.tool !== null;
  }

  /**
   * Hotbar toggle: re-selecting the active tool's item cancels; selecting the
   * OTHER tool's item switches tools; otherwise it enters placement (if a kit
   * is held). Driven by the selected ITEM ('kit:zipline' → 'zipline',
   * 'kit:drone' → 'drone' — see main.ts's `syncHotbarPlacement`), not a fixed
   * slot number.
   */
  toggle(tool: Tool): void {
    if (this.tool === tool) {
      this.cancel();
      return;
    }
    if (this.tool) this.exit(); // switching tools mid-placement
    this.enter(tool);
  }

  private enter(tool: Tool): void {
    if (this.inventory.kits[tool] <= 0) {
      toast(`No ${tool} kit`);
      return;
    }
    this.tool = tool;
    this.stage = 'a';
    this.stagedA = null;
    this.buildGhost();
    toast(tool === 'zipline' ? 'Zipline: place near post' : 'Drone: pick a spot');
  }

  /** Cancel placement (Esc or same-slot hotbar). Staged A held no kit — nothing refunds. */
  cancel(): void {
    if (!this.tool) return;
    this.exit();
    toast('Placement cancelled');
  }

  /** LMB confirm at the current aim point. */
  confirm(): void {
    if (!this.tool || !this.aim) return;

    if (this.tool === 'drone') {
      if (!this.valid) {
        toast(this.drones.count >= STRUCTURES.maxDrones ? 'Drone limit reached' : 'Invalid spot');
        return;
      }
      const res = this.drones.place(this.aim);
      if (res.ok) {
        toast('Drone deployed');
        this.exit();
      }
      return;
    }

    // Zipline: stage A stages the near post; stage B validates + places.
    if (this.stage === 'a') {
      this.stagedA = this.postTop(this.aim);
      this.stage = 'b';
      toast('Zipline: place far post');
      return;
    }
    if (!this.valid || !this.stagedA) {
      const why = this.zipReason();
      toast(why);
      return;
    }
    const res = this.ziplines.place(this.stagedA, this.postTop(this.aim));
    if (res.ok) {
      toast('Zipline placed');
      this.exit();
    } else {
      toast(this.zipReason(res.reason));
    }
  }

  /** Per-frame ghost update: raycast the aim, recolour, reposition/preview. */
  update(_dt: number): void {
    if (!this.tool || !this.ghost) return;
    const eye = this.camera.position;
    this.camera.getWorldDirection(this._dir);
    const hit = raycastTerrain(
      { x: eye.x, y: eye.y, z: eye.z },
      { x: this._dir.x, y: this._dir.y, z: this._dir.z },
      this.ground.heightAt,
      STRUCTURES.placeRange,
    );
    this.aim = hit;
    this.valid = this.computeValid();

    this.ghost.visible = hit !== null;
    if (!hit) return;

    // Marker post sits on the terrain at the aim.
    if (this.marker) this.marker.position.set(hit.x, hit.y + STRUCTURES.postHeight / 2, hit.z);
    const color = this.valid ? VALID_COLOR : INVALID_COLOR;
    this.markerMat?.color.setHex(color);
    if (this.markerMat) this.markerMat.emissive.setHex(color);

    // Zipline stage B: draw the candidate cable from the staged near post.
    if (this.tool === 'zipline' && this.stage === 'b' && this.stagedA && this.preview) {
      const end = this.postTop(hit);
      const attr = this.preview.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i <= GHOST_SEGMENTS; i++) {
        const p = zipPoint(i / GHOST_SEGMENTS, this.stagedA, end);
        arr[i * 3] = p.x;
        arr[i * 3 + 1] = p.y;
        arr[i * 3 + 2] = p.z;
      }
      attr.needsUpdate = true;
      this.preview.visible = true;
      this.previewMat?.color.setHex(color);
    } else if (this.preview) {
      this.preview.visible = false;
    }
  }

  /** Elevated endpoint atop a post planted at a ground point. */
  private postTop(p: Vec3): Vec3 {
    return { x: p.x, y: p.y + STRUCTURES.postHeight, z: p.z };
  }

  private computeValid(): boolean {
    if (!this.aim) return false;
    if (this.tool === 'drone') {
      return this.drones.count < STRUCTURES.maxDrones && this.inventory.kits.drone > 0;
    }
    // zipline
    if (this.ziplines.count >= STRUCTURES.maxZiplines || this.inventory.kits.zipline <= 0) {
      return false;
    }
    if (this.stage === 'a') return true;
    if (!this.stagedA) return false;
    return validateZipline(this.stagedA, this.postTop(this.aim), this.ground.heightAt).ok;
  }

  private zipReason(reason?: 'max' | 'nokit' | 'length' | 'los' | 'low'): string {
    if (reason === 'length') return 'Too far apart';
    if (reason === 'los') return 'Blocked by terrain';
    if (reason === 'low') return 'Too low — a rider would drag';
    if (this.ziplines.count >= STRUCTURES.maxZiplines) return 'Zipline limit reached';
    if (this.inventory.kits.zipline <= 0) return 'No zipline kit';
    if (this.stagedA && !validateZipline(this.stagedA, this.postTop(this.aim!), this.ground.heightAt).ok) {
      return 'Blocked by terrain';
    }
    return 'Invalid placement';
  }

  private buildGhost(): void {
    const group = new THREE.Group();
    this.markerMat = new THREE.MeshStandardMaterial({
      color: VALID_COLOR,
      emissive: VALID_COLOR,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.marker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.25, STRUCTURES.postHeight, 8),
      this.markerMat,
    );
    group.add(this.marker);

    this.previewMat = new THREE.LineBasicMaterial({ color: VALID_COLOR, transparent: true, opacity: 0.85 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((GHOST_SEGMENTS + 1) * 3), 3));
    this.preview = new THREE.Line(geo, this.previewMat);
    this.preview.frustumCulled = false;
    this.preview.visible = false;
    group.add(this.preview);

    group.visible = false;
    this.scene.add(group);
    this.ghost = group;
  }

  /** Tear down placement state + dispose the ghost so no geometry leaks. */
  private exit(): void {
    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.ghost.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | undefined;
        if (mat) mat.dispose();
      });
    }
    this.ghost = null;
    this.marker = null;
    this.markerMat = null;
    this.preview = null;
    this.previewMat = null;
    this.tool = null;
    this.stage = 'a';
    this.stagedA = null;
    this.aim = null;
    this.valid = false;
  }
}

// ---------------------------------------------------------------------------
// Persistence-shaped state (Task 14 consumes). Dumb JSON: cable endpoints +
// drone placement points. Round-trips through the systems' own serialize /
// deserialize so meshes + anchors are rebuilt on load.
// ---------------------------------------------------------------------------

export interface StructuresSave {
  ziplines: ReturnType<ZiplineSystem['serialize']>;
  drones: ReturnType<DroneSystem['serialize']>;
}

export function serializeStructures(ziplines: ZiplineSystem, drones: DroneSystem): StructuresSave {
  return { ziplines: ziplines.serialize(), drones: drones.serialize() };
}

export function deserializeStructures(
  save: StructuresSave,
  ziplines: ZiplineSystem,
  drones: DroneSystem,
): void {
  ziplines.deserialize(save.ziplines);
  drones.deserialize(save.drones);
}
