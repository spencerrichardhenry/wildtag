import { part, PARTS, type Diet, type PartKind, type PartSpec, type Stats } from './parts';
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

// ---- adaptToPlan: the automatic proposal that fits a creature to a new body plan ----
const REGIONS: readonly Region[] = ['head', 'middle', 'tail'];
const REGION_T: Record<Region, number> = { head: .12, middle: .5, tail: .92 };
const regionGap = (a: Region, b: Region) => Math.abs(REGION_T[a] - REGION_T[b]);
const hasStats = (spec: PartSpec) => Object.values(spec.stats).some(v => v !== 0);
export type Adaptation = { ok: true; genome: Genome; changes: string[]; nextSerial: number } | { ok: false; reasons: string[] };

export function adaptToPlan(g: Genome, p: BodyPlan, ctx: DesignContext, nextSerial: number): Adaptation {
  const out = cloneGenome(g), changes: string[] = [], added: PlacedPart[] = [];
  let serial = nextSerial;
  const kindOf = (x: PlacedPart) => part(x.id)!.kind;
  const nameOf = (x: PlacedPart) => part(x.id)!.name;
  const drop = (x: PlacedPart, why: string) => { out.parts = out.parts.filter(q => q !== x); changes.push(`${nameOf(x)} removed: ${why}`); };
  const allows = (r: Region, kind: PartKind) => p.regions[r].kinds.includes(kind);
  const pending = new Set<PlacedPart>();   // parts waiting for a new region (step 5)
  const usedIn = (r: Region) => out.parts.reduce((n, x) => n + (!pending.has(x) && regionOf(x.t) === r ? partSlots(x) : 0), 0);
  const room = (r: Region) => p.regions[r].slots - usedIn(r);

  // 2. unknown, locked and banned parts
  for (const x of [...out.parts]) {
    const spec = part(x.id);
    if (!spec) { out.parts = out.parts.filter(q => q !== x); changes.push(`${x.id} removed: unknown part.`); }
    else if (!isUnlocked(x.id, p.size, ctx.unlocked)) drop(x, 'still locked.');
  }
  for (const x of [...out.parts]) if (p.bans.includes(kindOf(x))) drop(x, `${p.name}s can't use it.`);

  // 3. unpair bad mirrors
  for (const x of out.parts) if (x.mirror && (badMirror(x) || !part(x.id)!.mirror)) { x.mirror = false; changes.push(`${nameOf(x)} unpaired.`); }

  // 4. exactly one mouth
  let mouthSpot: { t: number; angle: number } | undefined;
  const mouths = out.parts.filter(x => kindOf(x) === 'mouth');
  if (ctx.diet && mouths.length && !mouths.some(x => part(x.id)!.diet === ctx.diet)) {
    mouthSpot = { t: mouths[0]!.t, angle: mouths[0]!.angle };
    for (const x of mouths) drop(x, `your diet is now ${ctx.diet}.`);
  } else if (mouths.length > 1) {
    const keep = mouths.find(x => part(x.id)!.diet === ctx.diet) ?? mouths[0]!;
    for (const x of mouths) if (x !== keep) drop(x, 'only one mouth.');
  }

  // 5. region fit
  for (const x of out.parts) if (!allows(regionOf(x.t), kindOf(x))) pending.add(x);
  for (const x of [...pending]) {
    const from = regionOf(x.t), slots = partSlots(x);
    const target = REGIONS.filter(r => allows(r, kindOf(x))).sort((a, b) => regionGap(from, a) - regionGap(from, b)).find(r => room(r) >= slots);
    pending.delete(x);
    if (!target) { drop(x, `no room for it on a ${p.name}.`); continue; }
    x.t = REGION_T[target]; changes.push(`${nameOf(x)} moved to the ${target}.`);
  }

  // 6. requirements
  const choices = (match: (s: PartSpec) => boolean) => PARTS.filter(s => match(s) && isUnlocked(s.id, p.size, ctx.unlocked) && !p.bans.includes(s.kind) && REGIONS.some(r => allows(r, s.kind))).sort((a, b) => a.cost - b.cost)[0];
  const add = (spec: PartSpec, t0: number, angle: number) => {
    const x: PlacedPart = { uid: nextUid(serial++), id: spec.id, t: Math.min(1, t0), angle, scale: 1, mirror: false, roll: 0 };
    const home = regionOf(x.t), byGap = REGIONS.filter(r => allows(r, spec.kind)).sort((a, b) => regionGap(home, a) - regionGap(home, b));
    if (!(allows(home, spec.kind) && room(home) >= 1)) {
      const target = byGap.find(r => room(r) >= 1) ?? byGap[0];
      if (target && (target !== home || room(target) >= 1)) x.t = REGION_T[target];
    }
    out.parts.push(x); added.push(x); changes.push(`${spec.name} added: ${p.name}s need it.`);
  };
  if (!out.parts.some(x => kindOf(x) === 'mouth')) {
    const spec = choices(s => s.kind === 'mouth' && s.diet === (ctx.diet ?? 'herbivore'));
    if (spec) add(spec, mouthSpot?.t ?? 0, mouthSpot?.angle ?? 0);
  }
  for (const kind of p.requiresKinds) if (!out.parts.some(x => kindOf(x) === kind)) { const spec = choices(s => s.kind === kind); if (spec) add(spec, spec.t, spec.angle); }
  for (const c of p.requiresCapabilities) {
    const spec = choices(s => (s.stats[c.stat] ?? 0) > 0);
    for (let k = 0; spec && k < 40 && partStats(out)[c.stat] < c.min; k++) add(spec, spec.t + .06 * k, spec.angle);
  }

  // 7. make room
  const optional = (pool: PlacedPart[]) => pool.filter(x => {
    if (kindOf(x) === 'mouth' || p.requiresKinds.includes(kindOf(x))) return false;
    const rest = { ...out, parts: out.parts.filter(q => q !== x) }, st = partStats(rest);
    return p.requiresCapabilities.every(c => st[c.stat] >= c.min || partStats(out)[c.stat] < c.min);
  }).sort((a, b) => Number(hasStats(part(a.id)!)) - Number(hasStats(part(b.id)!)) || partCost(a) - partCost(b) || uidSerial(b.uid) - uidSerial(a.uid))[0];
  for (const r of REGIONS) while (usedIn(r) > p.regions[r].slots) {
    const victim = optional(out.parts.filter(x => regionOf(x.t) === r));
    if (!victim) return { ok: false, reasons: [`The ${r} can't hold the parts a ${p.name} needs.`] };
    drop(victim, `the ${r} is full.`);
  }
  while (instanceCount(out) > PART_LIMITS[p.size]!) {
    const victim = optional(out.parts);
    if (!victim) return { ok: false, reasons: [`A ${p.name} can't hold the parts it needs.`] };
    drop(victim, 'the body is full.');
  }

  // 8. spine
  const spineBefore = JSON.stringify(out.spine);
  while (out.spine.length > p.spine.max) out.spine.splice(Math.floor(out.spine.length / 2), 1);
  while (out.spine.length < p.spine.min) out.spine.splice(1, 0, { ...out.spine[1]! });
  out.spine.forEach((s, i) => {
    const r = segmentRule(p, i, out.spine.length);
    s.radius = r.locked ? r.radius[0] : clamp(s.radius, r.radius[0], r.radius[1]);
    s.height = r.locked ? r.height[0] : clamp(s.height, r.height[0], r.height[1]);
    s.lift = clamp(s.lift, SPINE_RANGE.lift[0], SPINE_RANGE.lift[1]);
  });
  if (JSON.stringify(out.spine) !== spineBefore) changes.push(`Body reshaped for a ${p.name}.`);

  // 9. fresh ids for the additions that survived
  let next = nextSerial;
  for (const x of added) if (out.parts.includes(x)) x.uid = nextUid(next++);

  // 10. validate
  const found = problems(out, p, { unlocked: ctx.unlocked, diet: ctx.diet, anchorCheck: ctx.anchorCheck }).filter(q => q.code !== 'dna');
  if (found.length) return { ok: false, reasons: found.map(q => q.message) };
  return { ok: true, genome: out, changes, nextSerial: next };
}

export function starterFor(p: BodyPlan): Genome {
  const a = adaptToPlan(starterGenome(), p, { unlocked: [] }, STARTER_NEXT_SERIAL);
  if (!a.ok) throw new Error(`No starter for ${p.id}`);
  return a.genome;
}
