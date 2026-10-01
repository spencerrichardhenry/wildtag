import { part, PARTS, type Diet, type PartSpec, type Stats } from './parts';
import { regionOf, segmentRule, type BodyPlan, type Region } from './plans';

export interface SpinePoint { radius: number; height: number; lift: number }
export interface PlacedPart { uid: string; id: string; t: number; angle: number; scale: number; mirror: boolean; roll: number }
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
      { uid: 'p1', id: 'mouth_nibbler', t: 0, angle: 0, scale: .8, mirror: false, roll: 0 },
      { uid: 'p2', id: 'eye_stalk', t: .16, angle: .5, scale: .75, mirror: true, roll: 0 },
      { uid: 'p3', id: 'tail_paddle', t: 1, angle: 0, scale: .8, mirror: false, roll: 0 },
      { uid: 'p4', id: 'leg_little', t: .45, angle: Math.PI / 2 + .9, scale: .7, mirror: true, roll: 0 },
    ],
    paint: { base: '#ffad92', belly: '#ffe1b8', accent: '#ef8a80', pattern: 'freckles' },
  };
}
export const STARTER_NEXT_SERIAL = 5;
export const uidSerial = (uid: string) => /^p(\d+)$/.test(uid) ? Number(uid.slice(1)) : NaN;
export const nextUid = (serial: number) => `p${serial}`;
export const slotWeight = (scale: number) => scale > 1.4 ? 2 : 1;
export const copies = (p: PlacedPart) => p.mirror ? 2 : 1;
export const partSlots = (p: PlacedPart) => copies(p) * slotWeight(p.scale);
export const partCost = (p: PlacedPart) => Math.round((part(p.id)?.cost ?? 0) * copies(p) * (.5 + .5 * p.scale));
export const instanceCount = (g: Genome) => g.parts.reduce((n, p) => n + partSlots(p), 0);
export const genomeCost = (g: Genome) => g.parts.reduce((n, p) => n + partCost(p), 0);
export const badMirror = (p: PlacedPart) => p.mirror && (Math.abs(Math.sin(p.angle)) < .3 || p.t < .05 || p.t > .95);
export function mouthOf(g: Genome): PartSpec | undefined { return g.parts.map(placed => part(placed.id)).find(spec => spec?.kind === 'mouth'); }
export function dietOf(g: Genome): Diet { return mouthOf(g)?.diet ?? 'omnivore'; }

/** Stats come from parts. A mirrored pair counts both parts. Bigger parts are a little stronger. */
export function partStats(g: Genome): Stats {
  const stats: Stats = { speed: 0, bite: 0, reach: 0, armor: 0, health: 0, sense: 0, stealth: 0 };
  for (const placed of g.parts) {
    const spec = part(placed.id); if (!spec) continue;
    const factor = (placed.mirror ? 2 : 1) * (.75 + .25 * placed.scale);
    for (const [key, value] of Object.entries(spec.stats) as [keyof Stats, number][]) stats[key] += value * factor;
  }
  for (const key of Object.keys(stats) as (keyof Stats)[]) stats[key] = Math.round(stats[key] * 10) / 10;
  return stats;
}
export const statsOf = partStats;
export function effectiveStats(g: Genome, p: BodyPlan): Stats {
  const s = partStats(g);
  for (const [k, v] of Object.entries(p.bonuses) as [keyof Stats, number][]) s[k] = Math.round((s[k] + v) * 10) / 10;
  return s;
}
export interface Derived { speedFactor: number; reach: number; maxHealth: number; armor: number; bite: number; senseRange: number; stealthFactor: number }
/** Gameplay numbers from stats. Reach and sense are in stage-local units. */
export function derive(stats: Stats): Derived {
  return {
    speedFactor: clamp(.85 + stats.speed * .075, .7, 1.65),
    reach: Math.max(0, stats.reach) * .45,
    maxHealth: Math.max(3, 6 + Math.round(stats.health)),
    armor: Math.max(0, Math.floor(stats.armor)),
    bite: 1 + Math.max(0, Math.floor(stats.bite)),
    senseRange: 18 + Math.max(0, stats.sense) * 6,
    stealthFactor: Math.max(.35, 1 - Math.max(0, stats.stealth) * .14),
  };
}

export interface DesignContext { unlocked: readonly string[]; diet?: Diet; budget?: number; anchorCheck?: (g: Genome, p: BodyPlan) => boolean }
export type ProblemCode = 'mouth' | 'parts' | 'segment' | 'locked' | 'unknown' | 'uid' | 'banned' | 'region' | 'required' | 'capability' | 'diet' | 'dna' | 'mirror' | 'placement' | 'anchor';
export interface GenomeProblem { code: ProblemCode; message: string; uid?: string; segment?: number; region?: Region }
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
export function problems(g: Genome, p: BodyPlan, ctx: DesignContext, catalog: readonly PartSpec[] = PARTS): GenomeProblem[] {
  const part = (id: string) => catalog.find(s => s.id === id);   // the catalog seam (synthetic grants in tests)
  const out: GenomeProblem[] = [], stage = p.size, seen = new Set<string>();
  for (const x of g.parts) if (!Number.isSafeInteger(uidSerial(x.uid)) || uidSerial(x.uid) < 1) { out.push({ code: 'uid', message: `Part id ${x.uid} is not valid.`, uid: x.uid }); }
  for (const x of g.parts) { if (seen.has(x.uid)) out.push({ code: 'uid', message: `Part id ${x.uid} is used twice.`, uid: x.uid }); seen.add(x.uid); }
  const mouths = g.parts.filter(x => part(x.id)?.kind === 'mouth');
  if (mouths.length !== 1) out.push({ code: 'mouth', message: mouths.length ? 'Only one mouth, please.' : 'Your creature needs a mouth.' });
  if (ctx.diet && mouths[0] && part(mouths[0].id)!.diet !== ctx.diet) out.push({ code: 'diet', message: 'Diet is set until your next evolution.', uid: mouths[0].uid });
  if (instanceCount(g) > PART_LIMITS[stage]!) out.push({ code: 'parts', message: `Too complex: ${instanceCount(g)} / ${PART_LIMITS[stage]} slots.` });
  if (g.spine.length < p.spine.min || g.spine.length > p.spine.max) out.push({ code: 'segment', message: `${p.name}s have ${p.spine.min}–${p.spine.max} segments.` });
  g.spine.forEach((s, i) => {
    const r = segmentRule(p, i, g.spine.length);
    const finite = [s.radius, s.height, s.lift].every(Number.isFinite) && s.lift >= SPINE_RANGE.lift[0] && s.lift <= SPINE_RANGE.lift[1];
    const ok = finite && s.radius >= r.radius[0] - 1e-6 && s.radius <= r.radius[1] + 1e-6 && s.height >= r.height[0] - 1e-6 && s.height <= r.height[1] + 1e-6 && (!r.locked || (near(s.radius, r.radius[0]) && near(s.height, r.height[0])));
    if (!ok) out.push({ code: 'segment', message: `Segment ${i + 1} is out of shape for a ${p.name}.`, segment: i });
  });
  const used: Record<Region, number> = { head: 0, middle: 0, tail: 0 };
  for (const x of g.parts) {
    const spec = part(x.id), region = regionOf(x.t);
    if (!spec) { out.push({ code: 'unknown', message: `Unknown part "${x.id}".`, uid: x.uid }); continue; }
    if (!isUnlocked(x.id, stage, ctx.unlocked)) out.push({ code: 'locked', message: `${spec.name} is still locked.`, uid: x.uid });
    if (badMirror(x) || (x.mirror && !spec.mirror)) out.push({ code: 'mirror', message: `${spec.name} can't be paired there.`, uid: x.uid });
    if (![x.t, x.angle, x.scale, x.roll].every(Number.isFinite) || x.t < 0 || x.t > 1 || x.angle <= -Math.PI || x.angle > Math.PI || x.scale < SCALE_RANGE[0] || x.scale > SCALE_RANGE[1] || Math.abs(x.roll) > Math.PI)
      out.push({ code: 'placement', message: `${spec.name} is placed out of range.`, uid: x.uid });
    if (p.bans.includes(spec.kind)) { out.push({ code: 'banned', message: `${p.name}s can't use ${spec.name.toLowerCase()}.`, uid: x.uid }); continue; }
    if (!p.regions[region].kinds.includes(spec.kind)) { out.push({ code: 'region', message: `${spec.name} doesn't fit in the ${region}.`, uid: x.uid, region }); continue; }
    used[region] += partSlots(x);
    if (used[region] > p.regions[region].slots) out.push({ code: 'region', message: `The ${region} is full: ${p.regions[region].slots} slots.`, uid: x.uid, region });
  }
  for (const kind of p.requiresKinds) if (!g.parts.some(x => part(x.id)?.kind === kind)) out.push({ code: 'required', message: `${p.name}s need ${kind === 'leg' ? 'legs' : `a ${kind}`}.` });
  const ps = partStats(g);
  for (const c of p.requiresCapabilities) if (ps[c.stat] < c.min) out.push({ code: 'capability', message: `${p.name}s need ${c.label}.` });
  if (ctx.anchorCheck && !out.length && !ctx.anchorCheck(g, p)) out.push({ code: 'anchor', message: "This body can't fit anywhere at this size." });
  if (genomeCost(g) > (ctx.budget ?? Infinity)) out.push({ code: 'dna', message: 'Not enough DNA.' });
  return out;
}
export const validateDesign = problems;
export function isUnlocked(id: string, stage: number, unlocked: readonly string[]) { const spec = part(id); return !!spec && (spec.stage <= stage || unlocked.includes(id)); }
export const availableParts = (stage: number, unlocked: readonly string[]) => PARTS.filter(spec => isUnlocked(spec.id, stage, unlocked));

const exactKeys = (o: object, keys: readonly string[]) => { const k = Object.keys(o); return k.length === keys.length && keys.every(key => k.includes(key)); };
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const inRange = (v: number, r: readonly [number, number] | readonly number[]) => v >= r[0]! && v <= r[1]!;
function readPaint(raw: unknown): Paint | null {
  if (!raw || typeof raw !== 'object' || !exactKeys(raw, ['base', 'belly', 'accent', 'pattern'])) return null;
  const paint = raw as Paint;
  if (![paint.base, paint.belly, paint.accent].every(c => typeof c === 'string' && HEX.test(c)) || !PATTERNS.includes(paint.pattern)) return null;
  return { base: paint.base, belly: paint.belly, accent: paint.accent, pattern: paint.pattern };
}
function frame(raw: unknown): { spine: unknown[]; parts: unknown[]; paint: Paint } | null {
  if (!raw || typeof raw !== 'object' || !exactKeys(raw, ['spine', 'parts', 'paint'])) return null;
  const value = raw as Record<string, unknown>, paint = readPaint(value.paint);
  if (!Array.isArray(value.spine) || !Array.isArray(value.parts) || !paint || value.spine.length < SPINE_LIMITS.min || value.spine.length > 8 || value.parts.length > 24) return null;
  return { spine: value.spine, parts: value.parts, paint };
}
/** Strict reader for v4 data. It returns the genome unchanged or null. It never clamps, assigns ids or unpairs. */
export function sanitizeGenome(raw: unknown): Genome | null {
  const f = frame(raw); if (!f) return null;
  const spine: SpinePoint[] = [];
  for (const s of f.spine) {
    if (!s || typeof s !== 'object' || !exactKeys(s, ['radius', 'height', 'lift'])) return null;
    const { radius, height, lift } = s as SpinePoint;
    if (![radius, height, lift].every(isNum) || !inRange(radius, SPINE_RANGE.radius) || !inRange(height, SPINE_RANGE.height) || !inRange(lift, SPINE_RANGE.lift)) return null;
    spine.push({ radius, height, lift });
  }
  const parts: PlacedPart[] = [], seen = new Set<string>();
  for (const x of f.parts) {
    if (!x || typeof x !== 'object' || !exactKeys(x, ['uid', 'id', 't', 'angle', 'scale', 'mirror', 'roll'])) return null;
    const q = x as PlacedPart;
    if (typeof q.uid !== 'string' || !Number.isSafeInteger(uidSerial(q.uid)) || uidSerial(q.uid) < 1 || seen.has(q.uid)) return null;
    seen.add(q.uid);
    if (typeof q.id !== 'string' || !part(q.id) || typeof q.mirror !== 'boolean' || ![q.t, q.angle, q.scale, q.roll].every(isNum)) return null;
    if (!inRange(q.t, [0, 1]) || q.angle <= -Math.PI || q.angle > Math.PI || !inRange(q.scale, SCALE_RANGE) || !inRange(q.roll, [-Math.PI, Math.PI])) return null;
    parts.push({ uid: q.uid, id: q.id, t: q.t, angle: q.angle, scale: q.scale, mirror: q.mirror, roll: q.roll });
  }
  return { spine, parts, paint: f.paint };
}
/** Reads a v1/v2 genome that has no part ids. It assigns p1..pn, clamps values into range and unpairs parts that cannot mirror. */
export function repairLegacyGenome(raw: unknown): Genome | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>, paint = readPaint(value.paint);
  if (!Array.isArray(value.spine) || !Array.isArray(value.parts) || !paint || value.spine.length < SPINE_LIMITS.min || value.spine.length > 8 || value.parts.length > 24) return null;
  const spine: SpinePoint[] = [];
  for (const s of value.spine as SpinePoint[]) {
    if (!s || !isNum(s.radius) || !isNum(s.height) || !isNum(s.lift)) return null;
    spine.push({ radius: clamp(s.radius, ...SPINE_RANGE.radius), height: clamp(s.height, ...SPINE_RANGE.height), lift: clamp(s.lift, ...SPINE_RANGE.lift) });
  }
  const parts: PlacedPart[] = [];
  for (const x of value.parts as (Partial<PlacedPart> | null)[]) {
    if (!x || typeof x !== 'object' || 'uid' in x || typeof x.id !== 'string' || !part(x.id) || typeof x.mirror !== 'boolean' || ![x.t, x.angle, x.scale, x.roll].every(isNum)) return null;
    const placed: PlacedPart = { uid: nextUid(parts.length + 1), id: x.id, t: clamp(x.t!, 0, 1), angle: Math.atan2(Math.sin(x.angle!), Math.cos(x.angle!)), scale: clamp(x.scale!, ...SCALE_RANGE), mirror: x.mirror, roll: clamp(x.roll!, -Math.PI, Math.PI) };
    if (placed.angle <= -Math.PI) placed.angle = Math.PI;
    if (!part(x.id)!.mirror || badMirror(placed)) placed.mirror = false;
    parts.push(placed);
  }
  return { spine, parts, paint };
}
export const cloneGenome = (g: Genome): Genome => structuredClone(g);
