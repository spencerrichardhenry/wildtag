import * as T from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
export const HERO_ASSETS = ['hero_shrimp', 'hero_fish', 'hero_orca', 'hero_fortress', 'hero_cosmic'] as const;
export const FOOD_ASSETS = ['plant', 'kelp_snack', 'seagrape', 'lettuce', 'shrimp', 'crab', 'jellyfish', 'snail', 'fish', 'squid', 'ray', 'bird', 'tree', 'boat', 'plane', 'balloon', 'lighthouse'] as const;
export const SCENERY_ASSETS = ['reef_rock_0', 'reef_rock_1', 'reef_arch', 'reef_coral_0', 'reef_coral_1', 'reef_coral_2', 'reef_coral_3', 'reef_kelp', 'reef_grass', 'reef_shell', 'reef_starfish', 'island', 'cloud', 'seabed_0', 'seabed_1', 'seabed_2'] as const;
export const ASSET_NAMES = [...HERO_ASSETS, ...FOOD_ASSETS, ...SCENERY_ASSETS, ...Array.from({ length: 12 }, (_, i) => `planet_${String(i).padStart(2, '0')}`)];
const library = new Map<string, GLTF>();
const materials = new Map<string, T.Material>();
export async function loadAssets(progress: (fraction: number) => void) {
  const loader = new GLTFLoader(); let cursor = 0, done = 0;
  async function worker() {
    while (cursor < ASSET_NAMES.length) {
      const name = ASSET_NAMES[cursor++]!;
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}tiny-tide/models/${name}.glb`);
      gltf.scene.traverse(obj => {
        if (!(obj instanceof T.Mesh)) return;
        obj.castShadow = true; obj.receiveShadow = true;
        const canonical = (m: T.Material) => {
          const key = m.name + ':' + (m as T.MeshStandardMaterial).vertexColors;
          const existing = materials.get(key);
          if (existing) { if (m !== existing) m.dispose(); return existing; }
          if (m instanceof T.MeshStandardMaterial) m.envMapIntensity = .65;
          materials.set(key, m); return m;
        };
        obj.material = Array.isArray(obj.material) ? obj.material.map(canonical) : canonical(obj.material);
        obj.userData.blenderAsset = name;
      });
      library.set(name, gltf); progress(++done / ASSET_NAMES.length);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
}
export function asset(name: string): T.Group {
  const gltf = library.get(name);
  if (!gltf) throw new Error(`Blender asset was not loaded: ${name}`);
  const group = gltf.scene.clone(true); group.userData.assetName = name;
  return group;
}
export function animations(name: string) { return library.get(name)?.animations || []; }
export function assetDiagnostics() { return { loaded: library.size, expected: ASSET_NAMES.length, source: 'Blender MCP', names: [...library.keys()] }; }
