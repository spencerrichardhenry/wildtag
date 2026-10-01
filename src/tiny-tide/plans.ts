// The evolution tree. A body plan sets habitat, movement, body rules, part
// rules and the lineage commitments a run keeps to the end.
import type { PartKind, Stats } from './parts';

export type Medium = 'water' | 'air' | 'land' | 'burrow' | 'space';
export type Region = 'head' | 'middle' | 'tail';
export type Commitment = 'no-flight' | 'no-swim' | 'no-land' | 'seabed-bound' | 'no-legs';
export interface SegmentRule { radius: readonly [number, number]; height: readonly [number, number]; locked?: boolean }
export interface RegionRule { kinds: readonly PartKind[]; slots: number }
export interface CapabilityRule { stat: 'armor' | 'speed'; min: number; label: string }
export interface Foraging { habitat: string; dnaMultiplier: number }
export interface BodyPlan {
  id: string; name: string; blurb: string; size: number; parents: readonly string[]; line: string; habitat: string; movement: string;
  spine: { min: number; max: number; head: SegmentRule; middle: SegmentRule; tail: SegmentRule };
  regions: Record<Region, RegionRule>; requiresKinds: readonly PartKind[]; requiresCapabilities: readonly CapabilityRule[]; bans: readonly PartKind[];
  bonuses: Partial<Stats>; foraging: readonly Foraging[]; physics: { massPerBodyLength: number; knockbackResistance: number };
  commits: readonly Commitment[]; keystone?: { closesLines: readonly string[]; note: string }; needs?: 'coast'; feedingStrategy: 'bite';
}
/** Habitat facts for comparison and commitments (body lengths; null = unlimited). Plan B's profiles.ts owns the full profiles. */
export const HABITAT_FACTS: Record<string, { media: readonly Medium[]; maxDepth: number | null; floorGap: number | null; wading: number | null; surfaceBand: number | null }> = {
  seabed: { media: ['water'], maxDepth: null, floorGap: 1.1, wading: 1.1, surfaceBand: null }, 'open-water': { media: ['water'], maxDepth: null, floorGap: null, wading: null, surfaceBand: null },
  'shallow-shore': { media: ['water', 'land'], maxDepth: 2.5, floorGap: null, wading: 1.1, surfaceBand: null }, land: { media: ['land'], maxDepth: null, floorGap: null, wading: null, surfaceBand: null },
  'seabed-land': { media: ['water', 'land'], maxDepth: null, floorGap: 1.1, wading: 1.1, surfaceBand: null }, 'sky-sea': { media: ['water', 'air'], maxDepth: null, floorGap: null, wading: null, surfaceBand: null },
  space: { media: ['space'], maxDepth: null, floorGap: null, wading: null, surfaceBand: null },
};
type Mode = 'ground' | 'swim' | 'surface' | 'glide' | 'fly' | 'burrow' | 'space';
/** speed = multiplier; acceleration/braking in stage-local units/s²; yaw/pitch in rad/s. */
export const MOVEMENT_FACTS: Record<string, { mode: Mode; speed: number; acceleration: number; braking: number; yaw: number; pitch: number }> = {
  speck: { mode: 'ground', speed: 1, acceleration: 30, braking: 30, yaw: 10, pitch: 0 }, swimmer: { mode: 'swim', speed: 1, acceleration: 24, braking: 18, yaw: 8, pitch: 3 },
  darter: { mode: 'swim', speed: 1.15, acceleration: 40, braking: 30, yaw: 12, pitch: 5 }, bulk: { mode: 'swim', speed: .9, acceleration: 14, braking: 10, yaw: 5, pitch: 2 },
  crawler: { mode: 'ground', speed: 1, acceleration: 26, braking: 26, yaw: 9, pitch: 0 }, shellback: { mode: 'ground', speed: .8, acceleration: 16, braking: 20, yaw: 6, pitch: 0 },
  burrower: { mode: 'ground', speed: .95, acceleration: 24, braking: 24, yaw: 9, pitch: 0 }, shore: { mode: 'ground', speed: 1, acceleration: 24, braking: 24, yaw: 8, pitch: 0 },
  flyer: { mode: 'fly', speed: 1, acceleration: 20, braking: 14, yaw: 6, pitch: 3 }, colossus: { mode: 'ground', speed: .85, acceleration: 14, braking: 16, yaw: 5, pitch: 0 },
  space: { mode: 'space', speed: 1, acceleration: 16, braking: 12, yaw: 4, pitch: 3 }, 'space-slow': { mode: 'space', speed: .85, acceleration: 12, braking: 10, yaw: 3.5, pitch: 2.5 },
};
export const COAST_READY = false;
export const ROOT_PLAN = 'speck';
const ANY: SegmentRule = { radius: [.25, 1.2], height: [.25, 1.2] };
const HEAD: readonly PartKind[] = ['mouth', 'eye', 'sense', 'arm', 'armor'];
const ALL: readonly PartKind[] = ['mouth', 'eye', 'fin', 'tail', 'leg', 'wing', 'jet', 'arm', 'armor', 'sense', 'cosmic'];
const not = (kinds: readonly PartKind[], drop: readonly PartKind[]) => kinds.filter(k => !drop.includes(k));
const R = (head: readonly PartKind[], hs: number, middle: readonly PartKind[], ms: number, tail: readonly PartKind[], ts: number): Record<Region, RegionRule> => ({ head: { kinds: head, slots: hs }, middle: { kinds: middle, slots: ms }, tail: { kinds: tail, slots: ts } });
const spine = (min: number, max: number, middle = ANY, head = ANY, tail = ANY) => ({ min, max, head, middle, tail });
type Draft = Pick<BodyPlan, 'id' | 'name' | 'blurb' | 'size' | 'parents' | 'line' | 'habitat' | 'movement' | 'spine' | 'regions'> & Partial<BodyPlan>;
const P = (d: Draft): BodyPlan => ({ requiresKinds: [], requiresCapabilities: [], bans: [], bonuses: {}, foraging: [], physics: { massPerBodyLength: 1, knockbackResistance: 0 }, commits: [], feedingStrategy: 'bite', ...d });
const SEABED_FOOD = (m: number): Foraging[] => [{ habitat: 'sp-seabed', dnaMultiplier: m }];
const BIG_HEAD = not(ALL, ['tail', 'leg', 'wing', 'jet']);

export const PLANS: readonly BodyPlan[] = [
  P({ id: 'speck', name: 'Speck', blurb: 'A tiny start on the seabed.', size: 0, parents: [], line: 'root', habitat: 'seabed', movement: 'speck', spine: spine(3, 5),
    regions: R(HEAD, 4, ['fin', 'leg', 'armor', 'sense', 'arm'], 4, ['tail', 'fin', 'armor', 'sense'], 2) }),
  P({ id: 'swimmer', name: 'Swimmer', blurb: 'Leave the sand. The whole water column is yours.', size: 1, parents: ['speck'], line: 'swimmer', habitat: 'open-water', movement: 'swimmer', spine: spine(3, 6),
    regions: R(HEAD, 4, ['fin', 'armor', 'sense', 'arm'], 5, ['tail', 'fin', 'armor'], 2), requiresKinds: ['tail'], bans: ['leg'], commits: ['no-legs'] }),
  P({ id: 'crawler', name: 'Crawler', blurb: 'Low and steady. Feast on the seabed.', size: 1, parents: ['speck'], line: 'crawler', habitat: 'seabed', movement: 'crawler', spine: spine(3, 6),
    regions: R(HEAD, 4, ['leg', 'armor', 'arm', 'sense', 'fin'], 6, ['tail', 'armor', 'sense'], 2), requiresKinds: ['leg'], foraging: SEABED_FOOD(1.25), commits: ['seabed-bound'] }),
  P({ id: 'shore_walker', name: 'Shore-walker', blurb: 'Breathe air. Walk the beach. Stay out of the deep.', size: 1, parents: ['speck'], line: 'shore', habitat: 'shallow-shore', movement: 'shore', spine: spine(3, 6), needs: 'coast',
    regions: R(HEAD, 4, ['leg', 'armor', 'arm', 'sense', 'fin'], 5, ['tail', 'armor', 'sense'], 2), requiresKinds: ['leg'], commits: ['no-flight'] }),
  P({ id: 'darter', name: 'Darter', blurb: 'Small and quick. Built for speed.', size: 2, parents: ['swimmer'], line: 'swimmer', habitat: 'open-water', movement: 'darter',
    spine: spine(3, 5, { radius: [.25, .7], height: [.25, .7] }, { radius: [.25, .7], height: [.25, .7] }, { radius: [.25, .6], height: [.25, .6] }),
    regions: R(HEAD, 4, ['fin', 'sense', 'arm', 'armor'], 4, ['tail', 'fin'], 4), requiresKinds: ['tail'], bans: ['leg'] }),
  P({ id: 'bulk', name: 'Bulk', blurb: 'Big, round and hard to push around.', size: 2, parents: ['swimmer'], line: 'swimmer', habitat: 'open-water', movement: 'bulk',
    spine: spine(4, 7, { radius: [.6, 1.2], height: [.6, 1.2] }), regions: R(HEAD, 5, ['fin', 'armor', 'sense', 'arm'], 8, ['tail', 'fin', 'armor'], 2),
    requiresKinds: ['tail'], bans: ['leg'], bonuses: { health: 2 }, physics: { massPerBodyLength: 1.5, knockbackResistance: .6 } }),
  P({ id: 'shellback', name: 'Shellback', blurb: 'A fixed shell body. Slow, safe and stubborn.', size: 2, parents: ['crawler'], line: 'crawler', habitat: 'seabed', movement: 'shellback',
    spine: spine(4, 6, { radius: [.9, .9], height: [.7, .7], locked: true }), regions: R(HEAD, 4, ['leg', 'armor', 'arm', 'sense'], 8, ['tail', 'armor', 'sense'], 2),
    requiresKinds: ['leg'], requiresCapabilities: [{ stat: 'armor', min: 2, label: 'armor 2 or more from parts' }], bonuses: { armor: 2 }, foraging: SEABED_FOOD(1.25), physics: { massPerBodyLength: 1.3, knockbackResistance: .4 } }),
  P({ id: 'burrower', name: 'Burrower', blurb: 'Quiet and thrifty. Eat what others miss.', size: 2, parents: ['crawler'], line: 'crawler', habitat: 'seabed', movement: 'burrower', spine: spine(3, 7),
    regions: R(HEAD, 4, ['leg', 'arm', 'sense', 'armor'], 6, ['tail', 'sense'], 2), requiresKinds: ['leg'], bonuses: { stealth: 2, health: -1 }, foraging: SEABED_FOOD(1.4) }),
  P({ id: 'strider', name: 'Strider', blurb: 'Long legs on dry land. You give up the water.', size: 2, parents: ['shore_walker'], line: 'shore', habitat: 'land', movement: 'shore', spine: spine(3, 6), needs: 'coast',
    regions: R(HEAD, 4, ['leg', 'armor', 'arm', 'sense'], 6, ['tail', 'armor', 'sense'], 2), requiresKinds: ['leg'], bans: ['fin'], commits: ['no-swim'] }),
  P({ id: 'mudskipper', name: 'Mudskipper', blurb: 'At home in the shallows and on the shore.', size: 2, parents: ['shore_walker'], line: 'shore', habitat: 'shallow-shore', movement: 'shore', spine: spine(3, 5), needs: 'coast',
    regions: R(HEAD, 4, ['leg', 'fin', 'armor', 'arm', 'sense'], 6, ['tail', 'fin', 'armor'], 2), requiresKinds: ['leg'], bonuses: { stealth: 1 } }),
  P({ id: 'sky_drifter', name: 'Sky drifter', blurb: 'Rise out of the sea and take the sky.', size: 3, parents: ['darter', 'bulk'], line: 'swimmer', habitat: 'sky-sea', movement: 'flyer', spine: spine(3, 7),
    regions: R(BIG_HEAD, 6, not(ALL, ['mouth', 'leg']), 10, ['tail', 'fin', 'armor', 'jet', 'sense'], 4), bans: ['leg'] }),
  P({ id: 'colossus', name: 'Colossus', blurb: 'Wade the seabed and walk the shore. Too heavy to fly.', size: 3, parents: ['shellback', 'burrower'], line: 'crawler', habitat: 'seabed-land', movement: 'colossus', spine: spine(3, 8),
    regions: R(BIG_HEAD, 6, not(ALL, ['mouth', 'wing', 'jet']), 10, ['tail', 'armor', 'sense', 'arm'], 4), requiresKinds: ['leg'], bans: ['wing', 'jet'], bonuses: { armor: 1, health: 1 }, physics: { massPerBodyLength: 1.6, knockbackResistance: .5 } }),
  P({ id: 'dune_giant', name: 'Dune giant', blurb: 'Stride over the island. The sea is behind you.', size: 3, parents: ['strider'], line: 'shore', habitat: 'land', movement: 'colossus', spine: spine(3, 8), needs: 'coast',
    regions: R(BIG_HEAD, 6, not(ALL, ['mouth', 'wing', 'jet', 'fin']), 10, ['tail', 'armor', 'sense', 'arm'], 4), requiresKinds: ['leg'], bans: ['wing', 'jet', 'fin'], bonuses: { armor: 1 } }),
  P({ id: 'shore_giant', name: 'Shore giant', blurb: 'Stride from beach to shallows.', size: 3, parents: ['mudskipper'], line: 'shore', habitat: 'shallow-shore', movement: 'colossus', spine: spine(3, 8), needs: 'coast',
    regions: R(BIG_HEAD, 6, not(ALL, ['mouth', 'wing', 'jet']), 10, ['tail', 'armor', 'sense', 'arm'], 4), requiresKinds: ['leg'], bans: ['wing', 'jet'], bonuses: { stealth: 1 } }),
  P({ id: 'star_swimmer', name: 'Star swimmer', blurb: 'Swim between the planets.', size: 4, parents: ['sky_drifter'], line: 'swimmer', habitat: 'space', movement: 'space', spine: spine(3, 8),
    regions: R(BIG_HEAD, 7, not(ALL, ['mouth', 'leg']), 12, ['tail', 'fin', 'armor', 'jet', 'sense', 'cosmic'], 5), bans: ['leg'] }),
  P({ id: 'star_crawler', name: 'Star crawler', blurb: 'Haul yourself through the void. Slow, but hard to stop.', size: 4, parents: ['colossus'], line: 'crawler', habitat: 'space', movement: 'space-slow', spine: spine(3, 8),
    regions: R(BIG_HEAD, 7, not(ALL, ['mouth', 'wing']), 12, ['tail', 'armor', 'sense', 'cosmic', 'arm'], 5), bans: ['wing'], bonuses: { armor: 1, health: 1 }, physics: { massPerBodyLength: 1.6, knockbackResistance: .5 } }),
  P({ id: 'star_walker', name: 'Star walker', blurb: 'Step from world to world.', size: 4, parents: ['dune_giant', 'shore_giant'], line: 'shore', habitat: 'space', movement: 'space-slow', spine: spine(3, 8), needs: 'coast',
    regions: R(BIG_HEAD, 7, not(ALL, ['mouth', 'wing', 'fin']), 12, ['tail', 'armor', 'sense', 'cosmic', 'arm'], 5), bans: ['wing', 'fin'], bonuses: { stealth: 1 } }),
];
const byId = new Map(PLANS.map(p => [p.id, p]));
export const plan = (id: string) => byId.get(id);
export const regionOf = (t: number): Region => t < .25 ? 'head' : t > .75 ? 'tail' : 'middle';
export const segmentRule = (p: BodyPlan, index: number, count: number) => index === 0 ? p.spine.head : index === count - 1 ? p.spine.tail : p.spine.middle;
const lookup = (plans: readonly BodyPlan[]) => (id: string) => plans === PLANS ? byId.get(id) : plans.find(p => p.id === id);
export const commitmentsOf = (path: readonly string[], plans: readonly BodyPlan[] = PLANS) => [...new Set(path.flatMap(id => lookup(plans)(id)?.commits ?? []))];
export const closedLinesOf = (path: readonly string[], plans: readonly BodyPlan[] = PLANS) => [...new Set(path.flatMap(id => lookup(plans)(id)?.keystone?.closesLines ?? []))];
const flies = (p: BodyPlan) => HABITAT_FACTS[p.habitat]!.media.includes('air') && ['glide', 'fly'].includes(MOVEMENT_FACTS[p.movement]!.mode);
const allowsKind = (p: BodyPlan, kind: PartKind) => !p.bans.includes(kind) && Object.values(p.regions).some(r => r.kinds.includes(kind));
export function violates(p: BodyPlan, c: Commitment): boolean {
  const h = HABITAT_FACTS[p.habitat]!;
  switch (c) {
    case 'no-flight': return flies(p);
    case 'no-swim': return h.media.includes('water');
    case 'no-land': return h.media.includes('land');
    case 'seabed-bound': return flies(p) || (h.media.includes('water') && h.floorGap === null);
    case 'no-legs': return allowsKind(p, 'leg');
  }
}
export function eligibleChildren(path: readonly string[], build: { coast: boolean }, plans: readonly BodyPlan[] = PLANS) {
  const current = path.at(-1)!, commits = commitmentsOf(path, plans), closed = closedLinesOf(path, plans);
  return plans.filter(p => p.parents.includes(current) && (build.coast || p.needs !== 'coast') && !closed.includes(p.line) && !commits.some(c => violates(p, c)));
}
export const leadsTo = (p: BodyPlan, path: readonly string[], build: { coast: boolean }) => eligibleChildren([...path, p.id], build).map(c => c.name);

export type WaterAccess = 'none' | 'seabed' | 'shallow' | 'free';
export type CapabilityChange = { good: boolean; text: string } & (
  | { field: 'water'; from: WaterAccess; to: WaterAccess }
  | { field: 'medium'; medium: 'land' | 'air' | 'space'; from: boolean; to: boolean }
  | { field: 'depthLimit' | 'floorGap' | 'wading' | 'surfaceBand'; from: number | null; to: number | null }
  | { field: 'speed' | 'acceleration' | 'braking' | 'yaw' | 'pitch'; from: number; to: number }
  | { field: 'slots'; region: Region; from: number; to: number }
  | { field: 'kind'; region: Region; kind: PartKind; from: boolean; to: boolean }
  | { field: 'range'; segment: Region; dim: 'radius' | 'height'; bound: 'min' | 'max'; from: number; to: number }
  | { field: 'locked'; segment: Region; from: boolean; to: boolean }
  | { field: 'segments'; bound: 'min' | 'max'; from: number; to: number }
  | { field: 'bonus'; stat: keyof Stats; from: number; to: number }
  | { field: 'forage'; habitat: string; from: number; to: number }
  | { field: 'requiresKind'; kind: PartKind; from: boolean; to: boolean }
  | { field: 'requiresCapability'; stat: 'armor' | 'speed'; from: number; to: number }
  | { field: 'commit'; commitment: Commitment });
const KIND_TEXT: Record<PartKind, string> = { mouth: 'mouths', eye: 'eyes', fin: 'fins', tail: 'tails', leg: 'legs', wing: 'wings', jet: 'jets', arm: 'arms', armor: 'armor', sense: 'senses', cosmic: 'cosmic parts' };
const STAT_TEXT: Record<keyof Stats, string> = { health: 'Hearts', armor: 'Armor', stealth: 'Stealth', speed: 'Speed', bite: 'Bite', reach: 'Reach', sense: 'Sense' };
export const COMMIT_TEXT: Record<Commitment, string> = { 'no-flight': 'Can never fly', 'no-swim': 'Can never swim again', 'no-land': 'Can never walk on land', 'seabed-bound': 'Never swims freely or flies', 'no-legs': 'Can never grow legs again' };
const WATER_TEXT: Record<WaterAccess, string> = { none: 'No swimming', seabed: 'Lives on the seabed', shallow: 'Swims in shallow water', free: 'Swims freely in open water' };
const WATER_RANK: Record<WaterAccess, number> = { none: 0, seabed: 1, shallow: 1, free: 2 };
const fmt = (n: number) => String(Math.round(n * 100) / 100);
const sign = (n: number) => n > 0 ? `+${fmt(n)}` : `−${fmt(-n)}`;
const cap = (t: string) => t[0]!.toUpperCase() + t.slice(1);
export const waterAccess = (p: BodyPlan): WaterAccess => { const h = HABITAT_FACTS[p.habitat]!; return !h.media.includes('water') ? 'none' : h.floorGap !== null ? 'seabed' : h.maxDepth !== null ? 'shallow' : 'free'; };
/** Field-by-field comparison with values; text is rendered here but callers may re-render from the typed fields. */
export function compareCapabilities(a: BodyPlan, b: BodyPlan): CapabilityChange[] {
  const out: CapabilityChange[] = [], ha = HABITAT_FACTS[a.habitat]!, hb = HABITAT_FACTS[b.habitat]!, ma = MOVEMENT_FACTS[a.movement]!, mb = MOVEMENT_FACTS[b.movement]!;
  const wa = waterAccess(a), wb = waterAccess(b);
  if (wa !== wb) {
    if (WATER_RANK[wb] > WATER_RANK[wa]) out.push({ field: 'water', from: wa, to: wb, good: true, text: WATER_TEXT[wb] });
    else if (WATER_RANK[wb] < WATER_RANK[wa]) out.push({ field: 'water', from: wa, to: wb, good: false, text: wb === 'none' ? `Lose: ${WATER_TEXT[wa].toLowerCase()}` : `Only ${WATER_TEXT[wb].toLowerCase()}` });
    else { out.push({ field: 'water', from: wa, to: wb, good: true, text: WATER_TEXT[wb] }); out.push({ field: 'water', from: wa, to: wb, good: false, text: `No longer ${WATER_TEXT[wa].toLowerCase()}` }); }
  }
  for (const medium of ['land', 'air', 'space'] as const) {
    const from = ha.media.includes(medium), to = hb.media.includes(medium), label = medium === 'land' ? 'walk on land' : medium === 'air' ? 'fly' : 'move through space';
    if (from !== to) out.push({ field: 'medium', medium, from, to, good: to, text: to ? cap(label) : `Can't ${label}` });
  }
  // A limit of null means unlimited; a larger limit is always more freedom.
  const freedom = (x: number | null) => x === null ? Number.POSITIVE_INFINITY : x;
  const limit = (field: 'depthLimit' | 'floorGap', from: number | null, to: number | null, gain: string, loss: string) => {
    if (from === to) return; const better = freedom(to) > freedom(from);
    out.push({ field, from, to, good: better, text: better ? gain : loss });
  };
  if (ha.media.includes('water') && hb.media.includes('water')) limit('depthLimit', ha.maxDepth, hb.maxDepth, hb.maxDepth === null ? 'Any water depth' : `Water up to ${hb.maxDepth} body lengths deep`, `Water no deeper than ${hb.maxDepth} body lengths`);
  if (ha.floorGap !== null && hb.floorGap !== null) limit('floorGap', ha.floorGap, hb.floorGap, 'Can rise further from the floor', 'Must stay closer to the floor');
  // For wading and surface bands, null means "none" (not unlimited); a larger band is more freedom.
  const band = (field: 'wading' | 'surfaceBand', from: number | null, to: number | null, gain: string, loss: string, more: string, less: string) => {
    if (from === to) return;
    if (from === null || to === null) { out.push({ field, from, to, good: to !== null, text: to !== null ? gain : loss }); return; }
    out.push({ field, from, to, good: to > from, text: to > from ? more : less });
  };
  band('wading', ha.wading, hb.wading, 'Wades with its head above the water', "Can't wade", 'Wades in deeper water', 'Wades only in shallower water');
  band('surfaceBand', ha.surfaceBand, hb.surfaceBand, 'Floats at the surface', "Can't float at the surface", 'Rises higher at the surface', 'Stays lower at the surface');
  const num = (field: 'speed' | 'acceleration' | 'braking' | 'yaw' | 'pitch', from: number, to: number, up: string, down: string) => { if (from !== to) out.push({ field, from, to, good: to > from, text: to > from ? up : down }); };
  num('speed', ma.speed, mb.speed, `Faster (×${fmt(mb.speed)}, was ×${fmt(ma.speed)})`, `Slower (×${fmt(mb.speed)}, was ×${fmt(ma.speed)})`);
  num('acceleration', ma.acceleration, mb.acceleration, 'Quicker to get going', 'Slower to get going');
  num('braking', ma.braking, mb.braking, 'Stops faster', 'Stops slower');
  num('yaw', ma.yaw, mb.yaw, 'Turns faster', 'Turns slower');
  num('pitch', ma.pitch, mb.pitch, ma.pitch === 0 ? 'Can tilt up and down' : 'Tilts faster', mb.pitch === 0 ? "Can't tilt up and down" : 'Tilts slower');
  for (const region of ['head', 'middle', 'tail'] as const) {
    const d = b.regions[region].slots - a.regions[region].slots;
    if (d) out.push({ field: 'slots', region, from: a.regions[region].slots, to: b.regions[region].slots, good: d > 0, text: `${sign(d)} ${region} slot${Math.abs(d) > 1 ? 's' : ''}` });
    const kinds = new Set([...a.regions[region].kinds, ...b.regions[region].kinds]);
    for (const kind of kinds) {
      const from = allowsIn(a, region, kind), to = allowsIn(b, region, kind);
      if (from !== to) out.push({ field: 'kind', region, kind, from, to, good: to, text: to ? `${cap(KIND_TEXT[kind])} allowed in the ${region}` : `No ${KIND_TEXT[kind]} in the ${region}` });
    }
    for (const dim of ['radius', 'height'] as const) {
      const ra = a.spine[region][dim], rb = b.spine[region][dim], word = dim === 'radius' ? 'wide' : 'tall', seg = cap(region);
      if (rb[0] !== ra[0]) out.push({ field: 'range', segment: region, dim, bound: 'min', from: ra[0], to: rb[0], good: rb[0] < ra[0], text: rb[0] < ra[0] ? `${seg} can be as thin as ${fmt(rb[0])}` : `${seg} at least ${fmt(rb[0])} ${word}` });
      if (rb[1] !== ra[1]) out.push({ field: 'range', segment: region, dim, bound: 'max', from: ra[1], to: rb[1], good: rb[1] > ra[1], text: rb[1] > ra[1] ? `${seg} up to ${fmt(rb[1])} ${word}` : `${seg} at most ${fmt(rb[1])} ${word}` });
    }
    const la = !!a.spine[region].locked, lb = !!b.spine[region].locked;
    if (la !== lb) out.push({ field: 'locked', segment: region, from: la, to: lb, good: !lb, text: lb ? `Fixed ${region} shape` : `Free ${region} shape` });
  }
  if (b.spine.max !== a.spine.max) out.push({ field: 'segments', bound: 'max', from: a.spine.max, to: b.spine.max, good: b.spine.max > a.spine.max, text: b.spine.max > a.spine.max ? `Up to ${b.spine.max} segments` : `At most ${b.spine.max} segments` });
  if (b.spine.min !== a.spine.min) out.push({ field: 'segments', bound: 'min', from: a.spine.min, to: b.spine.min, good: b.spine.min < a.spine.min, text: b.spine.min < a.spine.min ? `As few as ${b.spine.min} segments` : `At least ${b.spine.min} segments` });
  for (const stat of new Set([...Object.keys(a.bonuses), ...Object.keys(b.bonuses)]) as Set<keyof Stats>) {
    const from = a.bonuses[stat] ?? 0, to = b.bonuses[stat] ?? 0, d = to - from;
    if (d) out.push({ field: 'bonus', stat, from, to, good: d > 0, text: `${STAT_TEXT[stat]} ${sign(d)}${stat === 'health' ? ` (${Math.max(3, 6 + to)} base)` : ''}` });
  }
  for (const habitat of new Set([...a.foraging, ...b.foraging].map(f => f.habitat))) {
    const from = a.foraging.find(f => f.habitat === habitat)?.dnaMultiplier ?? 1, to = b.foraging.find(f => f.habitat === habitat)?.dnaMultiplier ?? 1;
    if (from !== to) out.push({ field: 'forage', habitat, from, to, good: to > from, text: to === 1 ? `Lose: seabed food bonus (was ×${fmt(from)})` : `Seabed food ×${fmt(to)}${from !== 1 ? ` (was ×${fmt(from)})` : ''}` });
  }
  for (const kind of new Set([...a.requiresKinds, ...b.requiresKinds])) {
    const from = a.requiresKinds.includes(kind), to = b.requiresKinds.includes(kind);
    if (from !== to) out.push({ field: 'requiresKind', kind, from, to, good: !to, text: to ? `Needs ${KIND_TEXT[kind]}` : `No longer needs ${KIND_TEXT[kind]}` });
  }
  for (const stat of ['armor', 'speed'] as const) {
    const from = a.requiresCapabilities.find(c => c.stat === stat)?.min ?? 0, rule = b.requiresCapabilities.find(c => c.stat === stat), to = rule?.min ?? 0;
    if (from !== to) out.push({ field: 'requiresCapability', stat, from, to, good: to < from, text: to > from ? `Needs ${rule!.label}` : `No longer needs ${stat}` });
  }
  for (const c of b.commits) if (!a.commits.includes(c)) out.push({ field: 'commit', commitment: c, good: false, text: COMMIT_TEXT[c] });
  return out;
}
const allowsIn = (p: BodyPlan, region: Region, kind: PartKind) => !p.bans.includes(kind) && p.regions[region].kinds.includes(kind);
const GAIN_ORDER = ['water', 'medium', 'wading', 'forage', 'speed', 'bonus', 'acceleration', 'yaw', 'slots'];
const COST_ORDER = ['bonus', 'kindAll', 'requiresCapability', 'requiresKind', 'speed', 'acceleration', 'yaw', 'slots', 'range', 'locked', 'water', 'medium'];
/** Card lines (spec §7). `path` is the path up to and including `a`. */
export function cardSummary(a: BodyPlan, b: BodyPlan, path: readonly string[] = [a.id]) {
  const c = compareCapabilities(a, b), rank = (order: string[], f: string) => { const i = order.indexOf(f); return i < 0 ? order.length : i; };
  const gains = c.filter(x => x.good).sort((x, y) => rank(GAIN_ORDER, x.field) - rank(GAIN_ORDER, y.field)).slice(0, 3).map(x => x.text);
  // A kind lost in every region it was allowed in becomes one "No <kind>" line.
  const lostEverywhere = [...new Set(c.filter(x => x.field === 'kind' && !x.good).map(x => (x as { kind: PartKind }).kind))].filter(k => !(['head', 'middle', 'tail'] as const).some(r => allowsIn(b, r, k)));
  const costs = [...lostEverywhere.map(k => ({ field: 'kindAll', text: `No ${KIND_TEXT[k]}` })), ...c.filter(x => !x.good && x.field !== 'commit' && !(x.field === 'kind' && lostEverywhere.includes((x as { kind: PartKind }).kind)))]
    .sort((x, y) => rank(COST_ORDER, x.field) - rank(COST_ORDER, y.field)).slice(0, 2).map(x => x.text);
  const added = b.commits.filter(x => !a.commits.includes(x)), inherited = commitmentsOf(path);
  const sacrifice = added.length ? added.map(x => COMMIT_TEXT[x]).join('; ') : inherited.length ? `None new — still: ${inherited.map(x => COMMIT_TEXT[x].toLowerCase()).join('; ')}` : 'None';
  return { playstyle: gains.join('; '), cost: costs.join('; ') || 'Nothing', sacrifice };
}
