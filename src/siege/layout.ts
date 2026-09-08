import type { MaterialId } from './materials';
export type AmmoId = 'cow' | 'rocket' | 'bomb' | 'catapult' | 'bowling';
export type ProjectileKind = AmmoId | 'watermelon';
export interface Vector3 { x: number; y: number; z: number }
export interface Pull { x: number; y: number }

export const AMMO: { id: AmmoId; name: string; subtitle: string; special: string }[] = [
  { id: 'cow', name: 'The cow', subtitle: 'Udder destruction', special: 'A bouncy bovine battering ram.' },
  { id: 'rocket', name: 'Rocket ship', subtitle: 'Space, meet stone', special: 'Boosts forward. Explodes on impact.' },
  { id: 'bomb', name: 'Old faithful', subtitle: 'A classic for a reason', special: 'Tap in flight to detonate early.' },
  { id: 'catapult', name: 'Catapult²', subtitle: 'Yes, it launches too', special: 'A lighter launcher. Its watermelon packs a bigger blast than the bomb.' },
  { id: 'bowling', name: 'Kingpin', subtitle: 'Medieval bowling', special: 'A very heavy ball. Roll through the walls.' },
];
export const DEMO_QUEUE: readonly AmmoId[] = AMMO.map(a => a.id);
export const LAUNCH: Vector3 = { x: 0, y: 3.6, z: 22 };
export const GRAVITY = 12;
export const WIN_PERCENT = 75;
export const TURN_SECONDS = 3.6;
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export const ammoAt = (index: number, sequence = DEMO_QUEUE) => sequence[index % sequence.length] ?? 'cow';

export function randomFrom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let n = Math.imul(value ^ (value >>> 15), 1 | value);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export type BuildingKind = 'fortress' | 'keep' | 'cottage' | 'barn' | 'windmill' | 'forge' | 'treasury' | 'greenhouse' | 'powder-store' | 'market';
export interface BuildingSpec { id: string; name: string; kind: BuildingKind; x: number; z: number; width: number; depth: number; height: number; bonus: number; material: MaterialId }

export interface StoneSpec {
  id: number;
  x: number; y: number; z: number;
  w: number; h: number; d: number;
  style: 'stone' | 'trim' | 'roof' | 'merlon' | 'beam' | 'panel' | 'barrel' | 'mill' | 'treasure';
  material: MaterialId;
  building: string;
  roofColor?: string;
  tone: number;
  window?: boolean;
  flag?: boolean;
}

export function fortressLayout(seed: number) {
  const random = randomFrom(seed);
  const stones: StoneSpec[] = [];
  const buildings: BuildingSpec[] = [{ id: 'fortress', name: 'Castle walls', kind: 'fortress', x: 0, z: -12.6, width: 17, depth: 16, height: 9, bonus: 0, material: 'stone' }];
  let building = 'fortress';
  const W = 1.4, H = .75;
  const wallRows = 4 + Math.floor(random() * 2);
  const keepRows = 11 + Math.floor(random() * 3);
  const add = (x: number, y: number, z: number, w: number, h: number, d: number, style: StoneSpec['style'] = 'stone', extra: Partial<StoneSpec> = {}) => {
    stones.push({ id: stones.length, x, y, z, w, h, d, style, material: style === 'roof' ? 'timber' : 'stone', building, tone: Math.floor(random() * 5), ...extra });
  };
  // Four independent towers enclose a real courtyard, with a keep inside it.
  for (const z of [-7, -18.2]) for (const x of [-6.3, 6.3]) {
    const rows = 9 + Math.floor(random() * 3);
    for (let row = 0; row < rows; row++) for (let col = 0; col < 3; col++) {
      add(x + (col - 1) * W, H * (row + .5), z, W, H, 3.7, 'stone', { window: col === 1 && (row === 3 || row === 7) });
    }
    add(x, rows * H + .2, z, 4.55, .4, 4.05, 'trim');
    // Each crown is open in the middle, so the top reads from above as well.
    for (const side of [-1, 1]) for (let col = 0; col < 3; col++) {
      add(x + (col - 1) * 1.72, rows * H + .8, z + side * 1.53, .9, .8, .94, 'merlon', { flag: side === -1 && col === 1 });
    }
  }
  for (const z of [-7, -18.2]) {
    for (let row = 0; row < wallRows; row++) for (let col = 0; col < 6; col++) {
      if (z === -7 && row < 3 && (col === 2 || col === 3)) continue;
      if (z === -7 && row === 3 && col >= 1 && col <= 4) continue;
      add(-3.5 + col * W, H * (row + .5), z, W, H, 1.5);
    }
    if (z === -7) add(0, H * 3.5, z, 5.6, H, 1.5, 'trim');
    for (let col = 0; col < 6; col++) add(-3.5 + col * W, wallRows * H + .3, z, .72, .6, 1.5, 'merlon');
  }
  for (const x of [-6.3, 6.3]) for (let row = 0; row < wallRows; row++) {
    for (let col = 0; col < 5; col++) add(x, H * (row + .5), -9.6 - col * 1.5, 1.5, H, 1.5);
  }
  building = 'keep';
  buildings.push({ id: building, name: 'Royal keep', kind: 'keep', x: 0, z: -12.6, width: 6.2, depth: 4.9, height: keepRows * H + 3.25, bonus: 800, material: 'stone' });
  for (let row = 0; row < keepRows; row++) for (let col = 0; col < 4; col++) {
    add(-2.1 + col * W, H * (row + .5), -12.6, W, H, 4.2, 'stone', { window: (col === 1 || col === 2) && (row === 5 || row === keepRows - 3) });
  }
  add(0, keepRows * H + .18, -12.6, 6.05, .36, 4.6, 'trim');
  add(0, keepRows * H + 1.8, -12.6, 6.2, 2.88, 4.9, 'roof', { flag: true });
  // Shuffle distinct building types between spaced plots; jitter stays within each plot.
  const kinds: BuildingKind[] = ['barn', 'treasury', 'windmill', 'forge', 'greenhouse', 'powder-store'];
  for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j]!, kinds[i]!]; }
  const plots = [[-5.7, 3], [5.7, 3], [-11.4, -10], [11.4, -10], [-12.6, -23], [12.6, -23]];
  const descriptions: Record<string, { name: string; material: MaterialId; bonus: number; roof: string }> = {
    barn: { name: 'Timber barn', material: 'timber', bonus: 180, roof: '#895743' },
    treasury: { name: 'Royal treasury', material: 'stone', bonus: 600, roof: '#478b82' },
    windmill: { name: 'Windmill', material: 'timber', bonus: 350, roof: '#b86a45' },
    forge: { name: 'Ironworks', material: 'iron', bonus: 450, roof: '#52646b' },
    greenhouse: { name: 'Glass gardens', material: 'glass', bonus: 250, roof: '#8dc7b5' },
    'powder-store': { name: 'Powder magazine', material: 'timber', bonus: 400, roof: '#aa4739' },
    market: { name: 'Market stall', material: 'timber', bonus: 100, roof: '#dfa44a' },
    cottage: { name: 'Village cottage', material: 'timber', bonus: 120, roof: '#c87b55' },
  };
  const house = (kind: BuildingKind, px: number, pz: number, index: number) => {
    const config = descriptions[kind]!;
    const x = px + (random() - .5) * .75, z = pz + (random() - .5) * .75;
    const rows = kind === 'market' ? 2 : kind === 'windmill' ? 6 : 3 + Math.floor(random() * 2);
    const w = kind === 'market' ? 2.4 : 3.6 + random() * .4, d = kind === 'market' ? 2 : 3.6;
    const h = rows * .7;
    building = `village-${index}`;
    buildings.push({ id: building, name: config.name, kind, x, z, width: w + .35, depth: d + .35, height: h + 1.5, bonus: config.bonus, material: config.material });
    const baseMaterial: MaterialId = kind === 'greenhouse' ? 'stone' : config.material;
    // Solid courses are split into multiple pieces; removing a wall releases its roof.
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < 3; col++) {
        const material: MaterialId = row === 0 ? baseMaterial : config.material;
        for (const side of [-1, 1]) {
          if (kind === 'market' && row > 0 && col === 1) continue;
          add(x + (col - 1) * w / 3, (row + .5) * .7, z + side * (d / 2 - .25), w / 3, .7, .5, kind === 'windmill' && row === rows - 1 && col === 1 && side === 1 ? 'mill' : material === 'glass' ? 'panel' : 'beam', { material, window: side === 1 && col === 1 && row === 1 && kind !== 'greenhouse' });
        }
      }
      for (const side of [-1, 1]) add(x + side * (w / 2 - .25), (row + .5) * .7, z, .5, .7, d - 1, 'beam', { material: config.material });
    }
    add(x, h + .65, z, w + .35, 1.3, d + .35, 'roof', { material: kind === 'forge' ? 'iron' : kind === 'greenhouse' ? 'glass' : 'timber', roofColor: config.roof });
    if (kind === 'treasury') add(x, .55, z + d / 2 + .7, 1.45, 1.1, .9, 'treasure', { material: 'iron' });
    if (kind === 'forge') {
      for (let row = 0; row < rows + 4; row++) add(x + w / 2 + .6, row * .55 + .275, z - .9, .7, .55, .7, 'stone', { material: 'stone' });
    }
    if (kind === 'powder-store') {
      for (let n = 0; n < 3; n++) add(x + (n - 1) * 1.05, .65, z + d / 2 + .8, .84, 1.3, .84, 'barrel', { material: 'powder' });
    }
  };
  plots.forEach(([x, z], i) => house(kinds[i]!, x!, z!, i));
  house('market', -3.8 - random(), 10, 6);
  house(random() > .5 ? 'cottage' : 'market', 3.8 + random(), 10, 7);
  const names = ['Fort Flimsy', 'Castle Crumble', 'Keep It Together', 'Dun For', 'Château Kaboom', 'Fort Oops'];
  return { stones, buildings, name: names[Math.floor(random() * names.length)]!, seed };
}

// Dragging controls direction only. The independent slider determines launch speed.
export function normalizePull(x: number, y: number): Pull {
  return { x: clamp(Number.isFinite(x) ? x : 0, -1, 1), y: clamp(Number.isFinite(y) ? y : 0, -1, 1) };
}
export function launchVelocity(input: Pull, power = 75): Vector3 {
  const pull = normalizePull(input.x, input.y);
  const yaw = -pull.x * .68;
  const elevation = .05 + pull.y * .8;
  const speed = 14 + clamp(Number.isFinite(power) ? power : 75, 25, 100) * .22;
  const forward = Math.cos(elevation) * speed;
  return { x: Math.sin(yaw) * forward, y: Math.sin(elevation) * speed, z: -Math.cos(yaw) * forward };
}
export function trajectory(pull: Pull, time: number, power = 75): Vector3 {
  const v = launchVelocity(pull, power);
  return { x: LAUNCH.x + v.x * time, y: LAUNCH.y + v.y * time - GRAVITY * time * time / 2, z: LAUNCH.z + v.z * time };
}
