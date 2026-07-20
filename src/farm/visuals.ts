import * as THREE from 'three';
import { FARM, VILLAGE } from '../core/constants.ts';
import type { ResourceKind } from '../core/types.ts';
import { mulberry32 } from '../core/rng.ts';
import { buildCritterModel, isSharedCritterMaterial, type CritterParts } from '../critters/models.ts';
import { animateCritter } from '../critters/animation.ts';
import { heightAt } from '../world/terrain.ts';
import { villageLayout } from '../village/layout.ts';
import { makeSurfaceMaterial } from '../core/materials.ts';
import type { FarmState } from './farm.ts';
import type { RosterEntry } from '../critters/roster.ts';

// ---------------------------------------------------------------------------
// Farm visuals (Haven V5). The fenced dirt plots already exist as static meshes
// from V3 (buildings.ts); this layer adds the *dynamic* dressing driven by the
// live FarmState + roster each frame:
//   • an assigned bonded critter puppet (buildCritterModel at FARM.puppetScale)
//     standing on the plot, idle-animated; created/removed on assign/unassign;
//   • a hopper indicator — a floating stack of colour-coded cubes above a corner
//     post, one cube per FARM.itemsPerCube items;
//   • a faded "deed" sign on each still-locked plot.
// `nearestCollectable` powers the F-collect interaction (a plot within range
// whose hopper holds something). Nothing here mutates game state.
// ---------------------------------------------------------------------------

interface PlotVis {
  group: THREE.Group;
  /** World position of the plot centre (ground height cached). */
  x: number;
  y: number;
  z: number;
  /** Live-tinted ground tile overlay (unlocked ⇄ locked colour, see update). */
  tile: THREE.Mesh;
  tileUnlocked: boolean | null;
  puppet: THREE.Group | null;
  puppetParts: CritterParts | null;
  puppetSpecies: string | null;
  /** Roster id currently modelled (so we rebuild only on change). */
  puppetFor: number | null;
  cubes: THREE.Group | null;
  cubeCount: number;
  cubeResource: ResourceKind | null;
  sign: THREE.Group | null;
}

/** The resource holding the most items in a hopper (drives the cube colour). */
function dominantResource(hopper: Partial<Record<ResourceKind, number>>): {
  resource: ResourceKind | null;
  total: number;
} {
  let resource: ResourceKind | null = null;
  let best = 0;
  let total = 0;
  for (const k of Object.keys(hopper) as ResourceKind[]) {
    const n = hopper[k] ?? 0;
    total += n;
    if (n > best) {
      best = n;
      resource = k;
    }
  }
  return { resource, total };
}

/** Dispose every geometry/material under `group` (manager.ts disposeGroup
 *  pattern). Puppets are built from critter models whose materials are shared
 *  via models.ts's cache — those are skipped; farm-owned materials dispose. */
function disposeGroup(group: THREE.Object3D): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const m = mesh.material;
    if (Array.isArray(m)) m.forEach((x) => !isSharedCritterMaterial(x) && x.dispose());
    else if (m && !isSharedCritterMaterial(m)) m.dispose();
  });
}

function mat(color: number, opts: { emissive?: number; opacity?: number } = {}): THREE.Material {
  // Quality-gated (Standard on medium+, Lambert on low): farm dirt/wood/signs
  // match the material model of the village merge they sit beside.
  const m = makeSurfaceMaterial({ color, roughness: 0.95, opacity: opts.opacity }) as
    | THREE.MeshStandardMaterial
    | THREE.MeshLambertMaterial;
  if (opts.emissive !== undefined) {
    m.emissive = new THREE.Color(opts.emissive);
    m.emissiveIntensity = 0.4;
  }
  // (transparent/opacity handled inside makeSurfaceMaterial when provided)
  return m;
}

/** A faded post + board "deed" sign for a locked plot. */
function buildSign(): THREE.Group {
  const g = new THREE.Group();
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, FARM.signPostH, 5),
    mat(VILLAGE.colors.penPost, { opacity: 0.75 }),
  );
  post.position.y = FARM.signPostH / 2;
  g.add(post);
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(FARM.signBoardW, FARM.signBoardH, 0.05),
    mat(VILLAGE.colors.plotLocked, { opacity: 0.75 }),
  );
  board.position.y = FARM.signPostH;
  g.add(board);
  return g;
}

export class FarmVisuals {
  private readonly root = new THREE.Group();
  private readonly plots: PlotVis[] = [];

  constructor(scene: THREE.Scene) {
    this.root.name = 'farmVisuals';
    scene.add(this.root);
    // One vis slot per layout plot (index === FarmState plot id).
    for (const p of villageLayout().farm.plots) {
      const group = new THREE.Group();
      const y = heightAt(p.x, p.z);
      group.position.set(p.x, y, p.z);
      this.root.add(group);
      // Live-tinted tile overlay: buildings.ts bakes a static plot patch from the
      // layout's snapshot unlock flags, so plots unlocked LATER (Plot Deeds) would
      // keep the locked colour forever. This thin overlay sits just above that
      // baked patch and is recoloured from the live FarmState each frame it
      // changes — the cheap, self-contained fix (Haven V7 polish 2a).
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(VILLAGE.farm.tile, 0.06, VILLAGE.farm.tile),
        mat(VILLAGE.colors.plotLocked),
      );
      tile.position.y = 0.11; // above the baked +0.07 patch (no z-fight)
      group.add(tile);
      this.plots.push({
        group,
        x: p.x,
        y,
        z: p.z,
        tile,
        tileUnlocked: null,
        puppet: null,
        puppetParts: null,
        puppetSpecies: null,
        puppetFor: null,
        cubes: null,
        cubeCount: 0,
        cubeResource: null,
        sign: null,
      });
    }
  }

  /** Reconcile meshes with the live farm/roster, then idle-animate the puppets. */
  update(farm: FarmState, roster: readonly RosterEntry[], t: number, dt: number): void {
    const rosterById = new Map<number, RosterEntry>();
    for (const e of roster) rosterById.set(e.id, e);

    for (const plot of farm.plots) {
      const vis = this.plots[plot.id];
      if (!vis) continue;

      // Live tile tint: recolour only when the unlock flag actually flips.
      if (vis.tileUnlocked !== plot.unlocked) {
        vis.tileUnlocked = plot.unlocked;
        (vis.tile.material as THREE.MeshLambertMaterial).color.setHex(
          plot.unlocked ? VILLAGE.colors.plot : VILLAGE.colors.plotLocked,
        );
      }

      // Locked-plot deed sign.
      if (!plot.unlocked) {
        if (!vis.sign) {
          vis.sign = buildSign();
          vis.group.add(vis.sign);
        }
      } else if (vis.sign) {
        vis.group.remove(vis.sign);
        disposeGroup(vis.sign);
        vis.sign = null;
      }

      // Assigned critter puppet.
      const entry = plot.assigned !== null ? rosterById.get(plot.assigned) : undefined;
      const wantFor = entry ? entry.id : null;
      const wantSpecies = entry ? entry.speciesId : null;
      if (wantFor !== vis.puppetFor || wantSpecies !== vis.puppetSpecies) {
        if (vis.puppet) {
          vis.group.remove(vis.puppet);
          disposeGroup(vis.puppet);
          vis.puppet = null;
          vis.puppetParts = null;
        }
        vis.puppetFor = wantFor;
        vis.puppetSpecies = wantSpecies;
        if (wantSpecies) {
          const { group, parts } = buildCritterModel(wantSpecies, mulberry32((plot.id + 1) * 0x9e37));
          group.scale.setScalar(FARM.puppetScale);
          vis.puppet = group;
          vis.puppetParts = parts;
          vis.group.add(group);
        }
      }
      if (vis.puppet && vis.puppetParts) {
        animateCritter(vis.puppetParts, 0, t, dt, vis.puppetSpecies ?? undefined);
      }

      // Hopper indicator (one cube per FARM.itemsPerCube items).
      const { resource, total } = dominantResource(plot.hopper);
      const wantCubes = Math.ceil(total / FARM.itemsPerCube);
      if (wantCubes !== vis.cubeCount || resource !== vis.cubeResource) {
        if (vis.cubes) {
          vis.group.remove(vis.cubes);
          disposeGroup(vis.cubes);
          vis.cubes = null;
        }
        vis.cubeCount = wantCubes;
        vis.cubeResource = resource;
        if (wantCubes > 0 && resource) {
          const color = FARM.cubeColors[resource];
          const stack = new THREE.Group();
          const half = VILLAGE.farm.tile / 2;
          stack.position.set(half, FARM.hopperFloat, half); // above a corner post
          for (let i = 0; i < wantCubes; i++) {
            const cube = new THREE.Mesh(
              new THREE.BoxGeometry(FARM.cubeSize, FARM.cubeSize, FARM.cubeSize),
              mat(color, { emissive: color }),
            );
            cube.position.y = i * FARM.cubeGap;
            stack.add(cube);
          }
          vis.cubes = stack;
          vis.group.add(stack);
        }
      }
    }
  }

  /**
   * The id of the nearest unlocked plot within `FARM.collectRange` of `pos`
   * whose hopper holds something, or null. Drives the F-collect interaction.
   */
  nearestCollectable(farm: FarmState, pos: { x: number; z: number }): number | null {
    let best: number | null = null;
    let bestD: number = FARM.collectRange;
    for (const plot of farm.plots) {
      if (!plot.unlocked) continue;
      const { total } = dominantResource(plot.hopper);
      if (total <= 0) continue;
      const vis = this.plots[plot.id];
      if (!vis) continue;
      const d = Math.hypot(vis.x - pos.x, vis.z - pos.z);
      if (d <= bestD) {
        bestD = d;
        best = plot.id;
      }
    }
    return best;
  }
}
