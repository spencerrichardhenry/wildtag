import { part, PARTS, type Diet, type PartSpec, type Stats } from './parts';

export interface SpinePoint { radius: number; height: number; lift: number }
export interface PlacedPart { id: string; t: number; angle: number; scale: number; mirror: boolean; roll: number }
export type Pattern = 'plain' | 'stripes' | 'spots' | 'freckles';
export interface Paint { base: string; belly: string; accent: string; pattern: Pattern }
export interface Genome { spine: SpinePoint[]; parts: PlacedPart[]; paint: Paint }

export const PATTERNS: readonly Pattern[] = ['plain', 'stripes', 'spots', 'freckles'];
export const SPINE_LIMITS = { min: 3, max: [5, 6, 7, 8, 8] as const };
/** Complexity: placed instances, where a mirrored part counts twice. */
export const PART_LIMITS = [8, 12, 16, 20, 24] as const;
export const SPINE_RANGE = { radius: [.25, 1.2], height: [.25, 1.2], lift: [-.5, .5] } as const;
export const SCALE_RANGE = [.4, 1.8] as const;
const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function starterGenome(): Genome {
  return {
    spine: [{ radius: .5, height: .48, lift: .05 }, { radius: .62, height: .58, lift: .02 }, { radius: .52, height: .48, lift: 0 }, { radius: .32, height: .3, lift: .04 }],
    parts: [
      { id: 'mouth_nibbler', t: 0, angle: 0, scale: .8, mirror: false, roll: 0 },
      { id: 'eye_stalk', t: .16, angle: .5, scale: .75, mirror: true, roll: 0 },
      { id: 'tail_paddle', t: 1, angle: 0, scale: .8, mirror: false, roll: 0 },
      { id: 'leg_little', t: .45, angle: Math.PI / 2 + .9, scale: .7, mirror: true, roll: 0 },
    ],
    paint: { base: '#ffad92', belly: '#ffe1b8', accent: '#ef8a80', pattern: 'freckles' },
  };
}
export const instanceCount = (g: Genome) => g.parts.reduce((n, placed) => n + (placed.mirror ? 2 : 1), 0);
export function mouthOf(g: Genome): PartSpec | undefined { return g.parts.map(placed => part(placed.id)).find(spec => spec?.kind === 'mouth'); }
export function dietOf(g: Genome): Diet { return mouthOf(g)?.diet ?? 'omnivore'; }
export function genomeCost(g: Genome) { return g.parts.reduce((sum, placed) => sum + (part(placed.id)?.cost ?? 0) * (placed.mirror ? 2 : 1), 0); }

/** Stats come from parts. A mirrored pair counts both parts. Bigger parts are a little stronger. */
export function statsOf(g: Genome): Stats {
  const stats: Stats = { speed: 0, bite: 0, reach: 0, armor: 0, health: 0, sense: 0, stealth: 0 };
  for (const placed of g.parts) {
    const spec = part(placed.id); if (!spec) continue;
    const factor = (placed.mirror ? 2 : 1) * (.75 + .25 * placed.scale);
    for (const [key, value] of Object.entries(spec.stats) as [keyof Stats, number][]) stats[key] += value * factor;
  }
  for (const key of Object.keys(stats) as (keyof Stats)[]) stats[key] = Math.round(stats[key] * 10) / 10;
  return stats;
}
export interface Derived { speedFactor: number; reach: number; maxHealth: number; armor: number; bite: number; senseRange: number; stealthFactor: number }
/** Gameplay numbers from stats. Reach and sense are in stage-local units. */
export function derive(stats: Stats): Derived {
  return {
    speedFactor: clamp(.85 + stats.speed * .075, .7, 1.65),
    reach: Math.max(0, stats.reach) * .45,
    maxHealth: 6 + Math.max(0, Math.round(stats.health)),
    armor: Math.max(0, Math.floor(stats.armor)),
    bite: 1 + Math.max(0, Math.floor(stats.bite)),
    senseRange: 18 + Math.max(0, stats.sense) * 6,
    stealthFactor: Math.max(.35, 1 - Math.max(0, stats.stealth) * .14),
  };
}

export interface GenomeProblem { code: 'mouth' | 'parts' | 'spine' | 'locked' | 'dna'; message: string }
/** Checks a design against a stage. `unlocked` holds early unlocks from defeated species. */
export function problems(g: Genome, stage: number, unlocked: readonly string[], budget = Infinity): GenomeProblem[] {
  const out: GenomeProblem[] = [];
  const mouths = g.parts.filter(placed => part(placed.id)?.kind === 'mouth');
  if (mouths.length !== 1) out.push({ code: 'mouth', message: mouths.length ? 'Only one mouth, please.' : 'Your creature needs a mouth.' });
  if (instanceCount(g) > PART_LIMITS[stage]!) out.push({ code: 'parts', message: `Too complex: ${instanceCount(g)} / ${PART_LIMITS[stage]} parts.` });
  if (g.spine.length < SPINE_LIMITS.min || g.spine.length > SPINE_LIMITS.max[stage]!) out.push({ code: 'spine', message: 'Body length is out of range.' });
  for (const placed of g.parts) if (!isUnlocked(placed.id, stage, unlocked)) out.push({ code: 'locked', message: `${part(placed.id)?.name ?? placed.id} is still locked.` });
  if (genomeCost(g) > budget) out.push({ code: 'dna', message: 'Not enough DNA.' });
  return out;
}
export function isUnlocked(id: string, stage: number, unlocked: readonly string[]) { const spec = part(id); return !!spec && (spec.stage <= stage || unlocked.includes(id)); }
export const availableParts = (stage: number, unlocked: readonly string[]) => PARTS.filter(spec => isUnlocked(spec.id, stage, unlocked));

/** Returns a clean copy, or null if the value is not a genome. Values are clamped into range. */
export function sanitizeGenome(raw: unknown): Genome | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<Genome>;
  if (!Array.isArray(value.spine) || !Array.isArray(value.parts) || !value.paint || typeof value.paint !== 'object') return null;
  if (value.spine.length < SPINE_LIMITS.min || value.spine.length > 8 || value.parts.length > 24) return null;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const spine: SpinePoint[] = [];
  for (const s of value.spine) {
    if (!s || !num(s.radius) || !num(s.height) || !num(s.lift)) return null;
    spine.push({ radius: clamp(s.radius, ...SPINE_RANGE.radius), height: clamp(s.height, ...SPINE_RANGE.height), lift: clamp(s.lift, ...SPINE_RANGE.lift) });
  }
  const parts: PlacedPart[] = [];
  for (const placed of value.parts) {
    if (!placed || typeof placed.id !== 'string' || !part(placed.id) || !num(placed.t) || !num(placed.angle) || !num(placed.scale) || typeof placed.mirror !== 'boolean' || !num(placed.roll)) return null;
    parts.push({ id: placed.id, t: clamp(placed.t, 0, 1), angle: Math.atan2(Math.sin(placed.angle), Math.cos(placed.angle)), scale: clamp(placed.scale, ...SCALE_RANGE), mirror: placed.mirror && part(placed.id)!.mirror, roll: clamp(placed.roll, -Math.PI, Math.PI) });
  }
  const paint = value.paint as Partial<Paint>;
  if (![paint.base, paint.belly, paint.accent].every(c => typeof c === 'string' && HEX.test(c)) || !PATTERNS.includes(paint.pattern as Pattern)) return null;
  return { spine, parts, paint: { base: paint.base!, belly: paint.belly!, accent: paint.accent!, pattern: paint.pattern as Pattern } };
}
export const cloneGenome = (g: Genome): Genome => structuredClone(g);
