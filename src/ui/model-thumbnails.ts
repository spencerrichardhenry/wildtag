import { refineArt } from '../art/library.ts';
import * as THREE from 'three';
import { BUILD, HANDS } from '../core/constants.ts';
import { makeSurfaceMaterial, ROUGHNESS } from '../core/materials.ts';
import { mulberry32 } from '../core/rng.ts';
import type { ItemId } from '../craft/hotbar.ts';
import { buildCritterModel } from '../critters/models.ts';

// ---------------------------------------------------------------------------
// Minecraft-style inventory / roster thumbnails.
//
// These are not hand-drawn approximations or a second asset set. A tiny,
// transparent Three.js studio renders the same code-native geometry family as
// the in-world objects and critters to a PNG data URL. URLs are cached for the
// session, so opening a screen again is just an <img> lookup and never creates
// one WebGL context per card.
//
// Critter thumbnails use the bonded entry's original wild-slot id as their RNG
// seed. CritterManager uses that exact seed when it builds the wild actor, so a
// bonded critter keeps its individual hue/scale/weathering variation in the B
// menu portrait instead of collapsing to a generic species swatch.
// ---------------------------------------------------------------------------

const THUMBNAIL_PX = 160;
const ITEM_PADDING = 1.24;
const CRITTER_PADDING = 1.18;

function surface(
  color: number,
  opts: { emissive?: number; emissiveIntensity?: number; metalness?: number; roughness?: number } = {},
): THREE.Material {
  return makeSurfaceMaterial({
    color,
    flatShading: true,
    roughness: opts.roughness ?? 0.72,
    metalness: opts.metalness ?? 0,
    ...(opts.emissive !== undefined
      ? { emissive: opts.emissive, emissiveIntensity: opts.emissiveIntensity ?? 0.55 }
      : {}),
  });
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const out = new THREE.Mesh(geometry, material);
  out.castShadow = false;
  out.receiveShadow = false;
  return out;
}

function buildDart(color: number, glow: boolean): THREE.Group {
  const root = new THREE.Group();
  const mat = surface(
    color,
    glow ? { emissive: color, emissiveIntensity: 0.65, roughness: 0.42 } : { roughness: 0.46 },
  );
  const dark = surface(0x26313a, { metalness: 0.25, roughness: 0.5 });

  const shaft = mesh(new THREE.CylinderGeometry(0.075, 0.075, 1.15, 8), mat);
  root.add(shaft);
  const tip = mesh(new THREE.ConeGeometry(0.13, 0.3, 8), dark);
  tip.position.y = 0.72;
  root.add(tip);

  // Three little tail vanes make the slim projectile readable at 64 CSS px.
  for (let i = 0; i < 3; i++) {
    const vane = mesh(new THREE.BoxGeometry(0.28, 0.22, 0.035), mat);
    vane.position.y = -0.48;
    vane.rotation.y = (i / 3) * Math.PI;
    root.add(vane);
  }
  root.rotation.z = -0.48;
  return root;
}

function buildCharm(): THREE.Group {
  const root = new THREE.Group();
  const color = HANDS.itemColor.charms;
  const gemMat = surface(color, { emissive: color, emissiveIntensity: 0.72, roughness: 0.3 });
  const ringMat = surface(0xe7ca70, { metalness: 0.5, roughness: 0.35 });
  const gem = mesh(new THREE.IcosahedronGeometry(0.5, 1), gemMat);
  gem.scale.set(0.82, 1, 0.42);
  root.add(gem);
  const loop = mesh(new THREE.TorusGeometry(0.2, 0.055, 6, 16), ringMat);
  loop.position.y = 0.58;
  root.add(loop);
  return root;
}

function buildZipline(): THREE.Group {
  const root = new THREE.Group();
  const postMat = surface(0x5a4936, { metalness: 0.05, roughness: 0.85 });
  const cableMat = surface(0xd7b75d, { metalness: 0.4, roughness: 0.5 });
  for (const x of [-0.78, 0.78]) {
    const post = mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.35, 8), postMat);
    post.position.set(x, 0, 0);
    root.add(post);
    const cap = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.09, 8), cableMat);
    cap.position.set(x, 0.68, 0);
    root.add(cap);
  }
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.78, 0.7, 0),
    new THREE.Vector3(-0.38, 0.5, 0),
    new THREE.Vector3(0, 0.43, 0),
    new THREE.Vector3(0.38, 0.5, 0),
    new THREE.Vector3(0.78, 0.7, 0),
  ]);
  root.add(mesh(new THREE.TubeGeometry(curve, 18, 0.035, 5, false), cableMat));
  return root;
}

function buildDrone(): THREE.Group {
  // Mirrors structures/drones.ts's live quad-rotor: centre body, four corner
  // booms/rotors, and the cyan status lamp underneath.
  const root = new THREE.Group();
  const bodyMat = surface(0x2b3038, { metalness: 0.4, roughness: 0.5 });
  const rotorMat = surface(0x9aa4ad, { metalness: 0.6, roughness: 0.4 });
  root.add(mesh(new THREE.BoxGeometry(0.7, 0.25, 0.7), bodyMat));
  const arm = 0.55;
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    const boom = mesh(new THREE.BoxGeometry(0.08, 0.06, 0.08), bodyMat);
    boom.position.set(sx * arm, 0.02, sz * arm);
    root.add(boom);
    const rotor = mesh(new THREE.BoxGeometry(0.5, 0.03, 0.06), rotorMat);
    rotor.position.set(sx * arm, 0.14, sz * arm);
    rotor.rotation.y = sx === sz ? 0.32 : -0.32;
    root.add(rotor);
  }
  const light = mesh(
    new THREE.SphereGeometry(0.09, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x66ddff }),
  );
  light.position.set(0, -0.18, 0);
  root.add(light);
  return root;
}

/** The exact right-triangular-prism dimensions used by BuildSystem. */
function buildRampGeometry(): THREE.BufferGeometry {
  const hu = BUILD.ramp.w / 2;
  const halfRun = BUILD.ramp.run / 2;
  const rise = BUILD.ramp.rise;
  const a = [-hu, 0, -halfRun];
  const b = [hu, 0, -halfRun];
  const c = [-hu, 0, halfRun];
  const d = [hu, 0, halfRun];
  const e = [-hu, rise, halfRun];
  const f = [hu, rise, halfRun];
  const positions: number[] = [];
  const tri = (p0: number[], p1: number[], p2: number[]): void => {
    positions.push(...p0, ...p1, ...p2);
  };
  tri(a, b, d);
  tri(a, d, c);
  tri(c, d, f);
  tri(c, f, e);
  tri(a, f, b);
  tri(a, e, f);
  tri(a, c, e);
  tri(b, f, d);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Build one inventory object's code-native display model. Exported so the
 * geometry contract can be covered without needing WebGL in the unit suite.
 */
export function buildItemThumbnailModel(item: ItemId): THREE.Group {
  const root = new THREE.Group();
  root.userData.itemId = item;
  switch (item) {
    case 'darts':
      root.add(buildDart(HANDS.itemColor.darts, false));
      break;
    case 'slowDarts':
      root.add(buildDart(HANDS.itemColor.slowDarts, true));
      break;
    case 'tideDarts':
      root.add(buildDart(HANDS.itemColor.tideDarts, true));
      break;
    case 'purifiers':
      root.add(buildDart(HANDS.itemColor.purifiers, true));
      break;
    case 'charms':
      root.add(buildCharm());
      break;
    case 'kit:zipline':
      root.add(buildZipline());
      break;
    case 'kit:drone':
      root.add(buildDrone());
      break;
    case 'kit:trampoline':
    case 'kit:skytramp': {
      // Mini trampoline: horn-purple frame ring + croc-hide membrane; the sky
      // variant floats a little drone above each side.
      const ring = mesh(
        new THREE.TorusGeometry(0.5, 0.09, 5, 8),
        surface(0x7a5fa8, { roughness: 0.85 }),
      );
      ring.rotation.x = Math.PI / 2;
      root.add(ring);
      const pad = mesh(
        new THREE.CylinderGeometry(0.46, 0.46, 0.06, 9),
        surface(HANDS.itemColor['kit:trampoline'], { roughness: 0.9 }),
      );
      root.add(pad);
      if (item === 'kit:skytramp') {
        for (const sx of [-1, 1]) {
          const rotor = mesh(
            new THREE.BoxGeometry(0.22, 0.05, 0.22),
            surface(HANDS.itemColor['kit:skytramp'], { roughness: 0.8 }),
          );
          rotor.position.set(sx * 0.5, 0.3, 0);
          root.add(rotor);
        }
      }
      break;
    }
    case 'wall':
      root.add(
        mesh(
          new THREE.BoxGeometry(BUILD.wall.w, BUILD.wall.h, BUILD.wall.t),
          surface(HANDS.itemColor.wall, { roughness: 0.93 }),
        ),
      );
      break;
    case 'ramp':
      root.add(
        mesh(
          buildRampGeometry(),
          surface(HANDS.itemColor.ramp, { roughness: ROUGHNESS.village }),
        ),
      );
      break;
    case 'cube':
      root.add(
        mesh(
          new THREE.BoxGeometry(BUILD.cube.w, BUILD.cube.h, BUILD.cube.d),
          surface(HANDS.itemColor.cube, { roughness: 0.93 }),
        ),
      );
      break;
  }
  refineArt(root, `item_${item.replace(':','_')}`);
  return root;
}

function disposeOwnedModel(root: THREE.Object3D, disposeMaterials: boolean): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line)) return;
    geometries.add(object.geometry as THREE.BufferGeometry);
    const material = object.material as THREE.Material | THREE.Material[];
    if (Array.isArray(material)) for (const m of material) materials.add(m);
    else materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  if (disposeMaterials) for (const material of materials) material.dispose();
}

class ThumbnailStudio {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.01, 1000);

  constructor() {
    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(THUMBNAIL_PX, THUMBNAIL_PX, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene.add(new THREE.HemisphereLight(0xf1f6ff, 0x27323c, 1.65));
    const key = new THREE.DirectionalLight(0xfff1d5, 2.15);
    key.position.set(4, 7, 6);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x90baff, 0.85);
    rim.position.set(-5, 3, -4);
    this.scene.add(rim);
  }

  render(root: THREE.Object3D, padding: number): string | null {
    const stage = new THREE.Group();
    stage.add(root);
    this.scene.add(stage);
    try {
      const bounds = new THREE.Box3().setFromObject(stage);
      if (bounds.isEmpty()) return null;
      const center = bounds.getCenter(new THREE.Vector3());
      stage.position.copy(center).multiplyScalar(-1);
      stage.updateMatrixWorld(true);

      const centredBounds = new THREE.Box3().setFromObject(stage);
      const sphere = centredBounds.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(sphere.radius, 0.08);
      const fov = THREE.MathUtils.degToRad(this.camera.fov);
      const distance = (radius * padding) / Math.sin(fov / 2);
      const view = new THREE.Vector3(1.25, 0.82, 2).normalize();
      this.camera.position.copy(view).multiplyScalar(distance);
      this.camera.near = Math.max(0.01, distance - radius * 2.2);
      this.camera.far = distance + radius * 3.5;
      this.camera.lookAt(0, 0, 0);
      this.camera.updateProjectionMatrix();

      this.renderer.clear(true, true, true);
      this.renderer.render(this.scene, this.camera);
      const url = this.renderer.domElement.toDataURL('image/png');
      return url.startsWith('data:image/png') ? url : null;
    } finally {
      this.scene.remove(stage);
      stage.remove(root);
    }
  }
}

let studio: ThumbnailStudio | null | undefined;
const itemCache = new Map<ItemId, string | null>();
const critterCache = new Map<string, string | null>();

function getStudio(): ThumbnailStudio | null {
  if (studio !== undefined) return studio;
  try {
    studio = new ThumbnailStudio();
  } catch {
    // A second WebGL context can be unavailable on very old/mobile devices.
    // Callers retain a CSS fallback, and null is cached so we never retry-loop.
    studio = null;
  }
  return studio;
}

/** Transparent PNG data URL for an inventory item, cached after first use. */
export function itemThumbnailUrl(item: ItemId): string | null {
  if (itemCache.has(item)) return itemCache.get(item) ?? null;
  const model = buildItemThumbnailModel(item);
  let url: string | null = null;
  try {
    url = getStudio()?.render(model, ITEM_PADDING) ?? null;
  } catch {
    url = null;
  } finally {
    disposeOwnedModel(model, true);
  }
  itemCache.set(item, url);
  return url;
}

/** Transparent PNG data URL for one bonded critter's exact seeded variation. */
export function critterThumbnailUrl(speciesId: string, critterId: number): string | null {
  const key = `${speciesId}:${critterId}`;
  if (critterCache.has(key)) return critterCache.get(key) ?? null;
  let model: THREE.Group | null = null;
  let url: string | null = null;
  try {
    model = buildCritterModel(speciesId, mulberry32(critterId >>> 0)).group;
    url = getStudio()?.render(model, CRITTER_PADDING) ?? null;
  } catch {
    url = null;
  } finally {
    if (model) {
      // Critter materials come from models.ts's game-wide shared cache. Keep
      // them alive; only the per-build merged geometries belong to this model.
      disposeOwnedModel(model, false);
    }
  }
  critterCache.set(key, url);
  return url;
}
