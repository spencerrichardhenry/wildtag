// Player moves (spec §7): Bite rows by mouth, Sweep, Grab, Counter, Brace and Dash; size scaling and mirrored pairs (`resolveMove`), the
// moves of a design (`movesOf`) and the four slots (`assignSlots`). Pure data and pure functions.
import { MOVE_PRIORITY, type AbilitySpec, type AttackSpec, type EvasionProfile, type GuardProfile, type MoveKind, type MovementMode, type PairBonus, type ResolvedMove, type SlotPin, type Tuple4 } from './combat-types';
import { uidSerial, type Genome } from './genome';
import { PARTS, type PartSpec } from './parts';
export { KIND_SOCKETS, MOUTH_BITES, PART_ABILITIES } from './parts';
export type { ResolvedMove };

const DEG = Math.PI / 180;
export const ALL_MODES: readonly MovementMode[] = ['ground', 'swim', 'surface', 'glide', 'fly', 'burrow', 'space'];
const playerAttack = (over: Partial<AttackSpec> & Pick<AttackSpec, 'id' | 'shape' | 'windupSeconds' | 'activeSeconds' | 'recoverySeconds' | 'aimLockAtSeconds' | 'maxTrackingRadiansPerSecond' | 'damage'>): AttackSpec => ({
  poseProfileId: 'rest', cooldownSeconds: 0, impulse: 1, staggerSeconds: .35, blockable: true, parryable: true, interruptible: true, maxTargets: 1, hitGroup: 'shared-grant', maxHitsPerTarget: 1,
  repeatHitSeconds: 0, crossing: 'same-medium', obstruction: 'terrain-and-cover', telegraphProfileId: 'none', damageUnit: 'hp', aimMode: 'input', moveSpeedFactor: 1, poiseDamageMultiplier: 1, ...over });
/** Bite (spec §7.4): a cone at the `bite` socket; the numbers at scale 1. Active .08 s and the half angle do not scale. */
const bite = (id: string, damage: number, range: number, halfAngleDeg: number, windup: number, recovery: number, lock: number, tracking: number): AttackSpec => playerAttack({
  id, shape: { kind: 'cone', range, halfAngle: halfAngleDeg * DEG }, windupSeconds: windup, activeSeconds: .08, recoverySeconds: recovery, aimLockAtSeconds: lock, maxTrackingRadiansPerSecond: tracking, damage,
  scaling: { damage: .5, 'shape.range': .25, windupSeconds: .25, recoverySeconds: .25, aimLockAtSeconds: .25 }, pair: null });
/** Sweep (spec §7.4): a cone at the `slap` socket, behind the body. The aim follows the body until .15 s (plan decision: the spec gives no lock). */
const sweep = (id: string, damage: number, range: number, impulse: number, windup: number, recovery: number): AttackSpec => playerAttack({
  id, shape: { kind: 'cone', range, halfAngle: 75 * DEG }, windupSeconds: windup, activeSeconds: .12, recoverySeconds: recovery, aimLockAtSeconds: .15, maxTrackingRadiansPerSecond: 12, damage, impulse,
  aimMode: 'body-back', maxTargets: 4, staggerSeconds: .6, poiseDamageMultiplier: 2, moveSpeedFactor: .5 });
/** Grab (spec §7.4): a cone at the `pinch` socket. Unblockable; Counter and Dash beat it. */
const pinch = (id: string, damage: number, range: number, holdSeconds: number, sizeFactor: number): AttackSpec => playerAttack({
  id, shape: { kind: 'cone', range, halfAngle: 35 * DEG }, windupSeconds: .18, activeSeconds: .10, recoverySeconds: .30, aimLockAtSeconds: .10, maxTrackingRadiansPerSecond: 8, damage,
  impulse: 0, staggerSeconds: 0, blockable: false, moveSpeedFactor: .7, whiffRecoverySeconds: .45,
  hold: { seconds: holdSeconds, sizeFactor, startHalfHearts: 0, squeezeHalfHearts: 0, squeezeEverySeconds: 0 } });
export const PLAYER_ATTACKS: Record<string, AttackSpec> = Object.fromEntries([
  bite('bite-nibbler', 2, .55, 40, .10, .14, .06, 12), bite('bite-snapper', 4, .60, 30, .16, .22, .10, 10), bite('bite-beak', 3, .60, 35, .13, .18, .08, 11), bite('bite-tyrant', 6, .70, 30, .20, .26, .12, 9),
  sweep('sweep-fan', 3, .9, 9, .22, .30), sweep('sweep-fluke', 4, 1.0, 10, .24, .32),
  pinch('pinch-pincer', 2, .55, 1.0, 1.0), pinch('pinch-clawmother', 3, .65, 1.3, 1.5),
].map(a => [a.id, a]));

const guard = (over: Partial<GuardProfile> & Pick<GuardProfile, 'id' | 'kind'>): GuardProfile => ({ startupSeconds: 0, minActiveSeconds: 0, windowSeconds: null, frontHalfAngle: null, blockFraction: 0,
  breakHalfHearts: null, breakStaggerSeconds: 0, brokenCooldownSeconds: 0, moveSpeedFactor: 1, yawRateFactor: 1, reflectDamage: 0, attackerStaggerSeconds: 0, recoverySeconds: 0, whiffRecoverySeconds: 0, successCooldownSeconds: 0, ...over });
export const GUARDS: Record<string, GuardProfile> = {
  'counter-spike': guard({ id: 'counter-spike', kind: 'counter', startupSeconds: .04, windowSeconds: .22, blockFraction: 1, reflectDamage: 3, attackerStaggerSeconds: 1.0, whiffRecoverySeconds: .40, successCooldownSeconds: .3 }),
  'brace-shell': guard({ id: 'brace-shell', kind: 'brace', startupSeconds: .10, minActiveSeconds: .25, frontHalfAngle: 70 * DEG, blockFraction: .75, breakHalfHearts: 4, breakStaggerSeconds: .5,
    brokenCooldownSeconds: 2.0, moveSpeedFactor: .45, yawRateFactor: .5, recoverySeconds: .15, whiffRecoverySeconds: .15 }),
};
const evasion = (id: string, distance: number, travel: number, recovery: number, plane: EvasionProfile['plane']): EvasionProfile =>
  ({ id, distanceBodyLengths: distance, startupSeconds: .03, travelSeconds: travel, recoverySeconds: recovery, plane, endSpeedCarry: .3 });
export const EVASIONS: Record<string, EvasionProfile> = Object.fromEntries([
  evasion('dash-side-fin', 1.6, .18, .12, 'free'), evasion('dash-dorsal-fin', 1.4, .18, .12, 'free'), evasion('dash-frill-fin', 1.5, .18, .12, 'free'), evasion('dash-paddle-tail', 1.8, .20, .14, 'free'),
  evasion('scuttle-little-leg', 1.3, .16, .10, 'horizontal'), evasion('scuttle-crab-leg', 1.4, .18, .10, 'horizontal'),
].map(e => [e.id, e]));

const DASH_SCALING = { 'evasion.distanceBodyLengths': .3, 'evasion.travelSeconds': .2, 'evasion.recoverySeconds': .3, cooldownSeconds: .3 };
const DASH_PAIR: PairBonus = { multiply: { 'evasion.distanceBodyLengths': 1.2, cooldownSeconds: .85 }, add: {} };
const ability = (over: Partial<AbilitySpec> & Pick<AbilitySpec, 'id' | 'kind' | 'label' | 'cooldownSeconds' | 'effectProfileId'>): AbilitySpec =>
  ({ allowedMotionModes: ALL_MODES, input: 'press', scaling: {}, pair: null, ...over });
const dash = (id: string, label: string, cooldown: number, pair: boolean) => ability({ id, kind: 'dash', label, cooldownSeconds: cooldown, effectProfileId: 'dash', evasionProfileId: id, scaling: DASH_SCALING, pair: pair ? DASH_PAIR : null });
const grab = (id: string, attackId: string) => ability({ id, kind: 'grab', label: 'Grab', cooldownSeconds: 3.0, effectProfileId: 'grab', attackId,
  scaling: { 'attack.damage': .5, 'attack.shape.range': .3, 'attack.hold.seconds': .35, 'attack.hold.sizeFactor': .35, 'attack.windupSeconds': .2, cooldownSeconds: .2 },
  pair: { multiply: { 'attack.hold.seconds': 1.3, 'attack.damage': 1.5 }, add: { 'attack.hold.sizeFactor': .25 } } });
const sweepAbility = (id: string, attackId: string, cooldown: number) => ability({ id, kind: 'sweep', label: 'Sweep', cooldownSeconds: cooldown, effectProfileId: 'hit', attackId,
  scaling: { 'attack.damage': .6, 'attack.shape.range': .3, 'attack.impulse': .5, 'attack.windupSeconds': .2, 'attack.recoverySeconds': .2, cooldownSeconds: .25 } });
export const PLAYER_ABILITIES: Record<string, AbilitySpec> = Object.fromEntries([
  grab('grab-pincer', 'pinch-pincer'), grab('grab-clawmother', 'pinch-clawmother'),
  ability({ id: 'counter-spike', kind: 'counter', label: 'Counter', cooldownSeconds: 1.2, effectProfileId: 'counter', guardProfileId: 'counter-spike',
    scaling: { 'guard.windowSeconds': .3, 'guard.reflectDamage': .6, 'guard.attackerStaggerSeconds': .3, 'guard.whiffRecoverySeconds': .3, cooldownSeconds: .25 } }),
  ability({ id: 'brace-shell', kind: 'brace', label: 'Brace', input: 'hold', cooldownSeconds: .4, effectProfileId: 'block', guardProfileId: 'brace-shell',
    scaling: { 'guard.blockFraction': .2, 'guard.breakHalfHearts': .6, 'guard.moveSpeedFactor': -.25, 'guard.startupSeconds': .3 } }),
  dash('dash-side-fin', 'Dash', 1.1, true), dash('dash-dorsal-fin', 'Dash', 1.0, false), dash('dash-frill-fin', 'Dash', 1.1, true), dash('dash-paddle-tail', 'Dash', 1.3, false),
  dash('scuttle-little-leg', 'Scuttle', .9, true), dash('scuttle-crab-leg', 'Scuttle', 1.0, true),
  sweepAbility('sweep-fan-tail', 'sweep-fan', 2.2), sweepAbility('sweep-fluke', 'sweep-fluke', 2.4),
].map(a => [a.id, a]));
export interface MoveCatalogs { attacks: Record<string, AttackSpec>; abilities: Record<string, AbilitySpec>; guards: Record<string, GuardProfile>; evasions: Record<string, EvasionProfile> }
export const MOVE_CATALOGS: MoveCatalogs = { attacks: PLAYER_ATTACKS, abilities: PLAYER_ABILITIES, guards: GUARDS, evasions: EVASIONS };

const INT_FIELDS = new Set(['damage', 'reflectDamage', 'breakHalfHearts', 'startHalfHearts', 'squeezeHalfHearts']);
/** The one rounding (spec §7.3): HP and half-hearts to an integer of at least 1; impulses to .1; seconds, body lengths and fractions to .01
 *  (a block fraction at most .95). */
export function roundMoveValue(key: string, v: number): number {
  const last = key.split('.').at(-1)!;
  if (INT_FIELDS.has(last)) return Math.max(1, Math.round(v));
  if (last === 'impulse') return Math.round(v * 10) / 10;
  const r = Math.round(v * 100) / 100;
  return last === 'blockFraction' ? Math.min(.95, r) : r;
}
function pathNumber(root: Record<string, unknown>, path: string): number {
  let v: unknown = root;
  for (const k of path.split('.')) v = (v as Record<string, unknown>)[k];
  if (typeof v !== 'number') throw new Error(`moves: no number at ${path}`);
  return v;
}
function setPath(root: Record<string, unknown>, path: string, value: number) {
  const keys = path.split('.'), last = keys.pop()!;
  let o = root;
  for (const k of keys) o = o[k] as Record<string, unknown>;
  o[last] = value;
}
/** value = base × (1 + k × (s − 1)); a mirrored pair then × multiply + add; then one rounding. Keys that only the pair names have k = 0. */
function scaleInto(root: Record<string, unknown>, scaling: Readonly<Record<string, number>>, pair: PairBonus | null, s: number, mirrored: boolean) {
  const usePair = mirrored && pair !== null, keys = new Set([...Object.keys(scaling), ...(usePair ? [...Object.keys(pair!.multiply), ...Object.keys(pair!.add)] : [])]);
  for (const key of keys) {
    let v = pathNumber(root, key) * (1 + (scaling[key] ?? 0) * (s - 1));
    if (usePair) v = v * (pair!.multiply[key] ?? 1) + (pair!.add[key] ?? 0);
    setPath(root, key, roundMoveValue(key, v));
  }
}
export type MoveRef = { attackId: string } | { abilityId: string };
/** The numbers of a move at part scale `scale` (spec §7.3). A Bite adds floor(nonMouthBite). The pair bonus applies only when `mirrored`. */
export function resolveMove(ref: MoveRef, scale: number, opts: { mirrored?: boolean; nonMouthBite?: number } = {}, c: MoveCatalogs = MOVE_CATALOGS): ResolvedMove {
  if ('attackId' in ref) {
    const spec = c.attacks[ref.attackId]; if (!spec) throw new Error(`moves: unknown attack ${ref.attackId}`);
    const attack = structuredClone(spec);
    scaleInto(attack as unknown as Record<string, unknown>, attack.scaling ?? {}, attack.pair ?? null, scale, !!opts.mirrored);
    attack.damage += Math.floor((opts.nonMouthBite ?? 0) + 1e-9);
    return { kind: 'bite', abilityId: null, label: 'Bite', input: 'press', attack, guard: null, evasion: null, cooldownSeconds: attack.cooldownSeconds, allowedMotionModes: ALL_MODES };
  }
  const a = c.abilities[ref.abilityId]; if (!a) throw new Error(`moves: unknown ability ${ref.abilityId}`);
  const root: Record<string, unknown> = { cooldownSeconds: a.cooldownSeconds };
  if (a.attackId) root.attack = structuredClone(c.attacks[a.attackId]!);
  if (a.guardProfileId) root.guard = structuredClone(c.guards[a.guardProfileId]!);
  if (a.evasionProfileId) root.evasion = structuredClone(c.evasions[a.evasionProfileId]!);
  scaleInto(root, a.scaling, a.pair, scale, !!opts.mirrored);
  return { kind: a.kind, abilityId: a.id, label: a.label, input: a.input, attack: (root.attack as AttackSpec | undefined) ?? null, guard: (root.guard as GuardProfile | undefined) ?? null,
    evasion: (root.evasion as EvasionProfile | undefined) ?? null, cooldownSeconds: root.cooldownSeconds as number, allowedMotionModes: a.allowedMotionModes };
}
/** A species attack as a resolved move (the spec itself). */
export const speciesMove = (attack: AttackSpec): ResolvedMove => ({ kind: 'species', abilityId: null, label: attack.id, input: 'press', attack, guard: null, evasion: null, cooldownSeconds: attack.cooldownSeconds, allowedMotionModes: ALL_MODES });

/** One part's move. `grantId` is the grant on the part; `scale` and `mirrored` come from the placed part. */
export interface GrantedMove { kind: MoveKind | 'bite'; partUid: string; partId: string; grantId: string; scale: number; mirrored: boolean; resolved: ResolvedMove }
export interface MoveSet {
  /** The mouth's Bite, or null without a mouth. */
  basic: GrantedMove | null;
  /** The representative move of each granted kind (spec §7.2). */
  byKind: Partial<Record<MoveKind, GrantedMove>>;
  /** Every part's move of each kind, the representative first. */
  candidates: Partial<Record<MoveKind, GrantedMove[]>>;
}
/** B: the `bite` stat of the non-mouth parts, with the stat factor of core spec §5 (a pair counts twice; × (.75 + .25 scale)). */
export function nonMouthBite(g: Genome, catalog: readonly PartSpec[] = PARTS): number {
  let b = 0;
  for (const placed of g.parts) {
    const spec = catalog.find(s => s.id === placed.id); if (!spec || spec.kind === 'mouth') continue;
    b += (spec.stats.bite ?? 0) * (placed.mirror ? 2 : 1) * (.75 + .25 * placed.scale);
  }
  return b;
}
/** The primary number of a kind (spec §7.2): Grab hold seconds, Counter window, Brace block fraction, Dash distance, Sweep damage. */
export function primaryOf(m: GrantedMove): number {
  const r = m.resolved;
  switch (m.kind) {
    case 'grab': return r.attack?.hold?.seconds ?? 0;
    case 'counter': return r.guard?.windowSeconds ?? 0;
    case 'brace': return r.guard?.blockFraction ?? 0;
    case 'dash': return r.evasion?.distanceBodyLengths ?? 0;
    case 'sweep': return r.attack?.damage ?? 0;
    default: return r.attack?.damage ?? 0;
  }
}
/** Larger primary number, then larger scale, then the mirrored part, then the lower uid. */
const better = (a: GrantedMove, b: GrantedMove) => primaryOf(b) - primaryOf(a) || b.scale - a.scale || Number(b.mirrored) - Number(a.mirrored) || uidSerial(a.partUid) - uidSerial(b.partUid);
export function movesOf(g: Genome, catalog: readonly PartSpec[] = PARTS, c: MoveCatalogs = MOVE_CATALOGS): MoveSet {
  const out: MoveSet = { basic: null, byKind: {}, candidates: {} }, b = nonMouthBite(g, catalog);
  for (const placed of g.parts) {
    const spec = catalog.find(s => s.id === placed.id); if (!spec) continue;
    const basic = spec.basicAttacks[0];
    if (spec.kind === 'mouth' && basic && !out.basic)
      out.basic = { kind: 'bite', partUid: placed.uid, partId: spec.id, grantId: basic.id, scale: placed.scale, mirrored: false, resolved: resolveMove({ attackId: basic.attackId }, placed.scale, { nonMouthBite: b }, c) };
    for (const grant of spec.activeGrants) {
      const ability = c.abilities[grant.abilityId]; if (!ability) continue;
      const move: GrantedMove = { kind: ability.kind, partUid: placed.uid, partId: spec.id, grantId: grant.id, scale: placed.scale, mirrored: placed.mirror,
        resolved: resolveMove({ abilityId: ability.id }, placed.scale, { mirrored: placed.mirror }, c) };
      (out.candidates[ability.kind] ??= []).push(move);
    }
  }
  for (const kind of MOVE_PRIORITY) { const list = out.candidates[kind]; if (list) { list.sort(better); out.byKind[kind] = list[0]!; } }
  return out;
}
export const grantedKinds = (m: MoveSet): MoveKind[] => MOVE_PRIORITY.filter(k => m.byKind[k]);
export const NO_PINS: Readonly<Tuple4<SlotPin>> = Object.freeze([null, null, null, null]) as unknown as Readonly<Tuple4<SlotPin>>;
export interface SlotAssignment { slots: Tuple4<MoveKind | null>; inactive: MoveKind[] }
/** R1 (spec §7.2): pins of granted kinds go in their slots; the empty slots fill in index order with the other kinds in priority order;
 *  the kinds that are left are inactive. A kind pinned twice keeps its first pin. */
export function placeKinds(granted: readonly MoveKind[], pins: Readonly<Tuple4<SlotPin>>): SlotAssignment {
  const kinds = MOVE_PRIORITY.filter(k => granted.includes(k)), slots: Tuple4<MoveKind | null> = [null, null, null, null], placed = new Set<MoveKind>();
  pins.forEach((pin, i) => { if (pin && kinds.includes(pin) && !placed.has(pin)) { slots[i] = pin; placed.add(pin); } });
  const rest = kinds.filter(k => !placed.has(k));
  for (let i = 0; i < 4 && rest.length; i++) if (slots[i] === null) { const k = rest.shift()!; slots[i] = k; placed.add(k); }
  return { slots, inactive: rest };
}
export const assignSlots = (g: Genome, pins: Readonly<Tuple4<SlotPin>>, catalog: readonly PartSpec[] = PARTS): SlotAssignment => placeKinds(grantedKinds(movesOf(g, catalog)), pins);
/** Clears the pins of kinds the design no longer grants (commit; spec §7.2). */
export function clearMissingPins(pins: Readonly<Tuple4<SlotPin>>, granted: readonly MoveKind[]): { pins: Tuple4<SlotPin>; cleared: MoveKind[] } {
  const cleared: MoveKind[] = [], out = pins.map(p => { if (p && !granted.includes(p)) { cleared.push(p); return null; } return p; }) as Tuple4<SlotPin>;
  return { pins: out, cleared };
}

// ---- editor text (spec §12) ----
const f2 = (v: number) => v.toFixed(2).replace(/^0\./, '.');
const KIND_NAMES: Readonly<Record<MoveKind, string>> = { grab: 'Grab', counter: 'Counter', brace: 'Brace', dash: 'Dash', sweep: 'Sweep' };
/** A move's key numbers, in display order: label, value and text (the details panel and the size slider's "old → new"). */
export function moveNumbers(r: ResolvedMove): { label: string; value: number; text: string }[] {
  const out: { label: string; value: number; text: string }[] = [], n = (label: string, value: number, text: string) => { out.push({ label, value, text }); };
  const a = r.attack, g = r.guard, e = r.evasion;
  if (a) {
    n('Damage', a.damage, String(a.damage));
    if (a.shape.kind === 'cone') n('Range', a.shape.range, `${f2(a.shape.range)} L`);
    n('Wind-up', a.windupSeconds, `${f2(a.windupSeconds)} s`); n('Recovery', a.recoverySeconds, `${f2(a.recoverySeconds)} s`);
    if (a.hold) { n('Hold', a.hold.seconds, `${f2(a.hold.seconds)} s`); n('Size limit', a.hold.sizeFactor, `× ${f2(a.hold.sizeFactor)}`); }
    if (r.kind === 'sweep') n('Knockback', a.impulse, String(a.impulse));
  }
  if (g?.kind === 'counter') { n('Window', g.windowSeconds ?? 0, `${f2(g.windowSeconds ?? 0)} s`); n('Reflect', g.reflectDamage, String(g.reflectDamage)); n('Stagger', g.attackerStaggerSeconds, `${f2(g.attackerStaggerSeconds)} s`); }
  if (g?.kind === 'brace') { n('Block', g.blockFraction, `${Math.round(g.blockFraction * 100)} %`); n('Breaks at', g.breakHalfHearts ?? 0, `${g.breakHalfHearts ?? 0} ½♥`); n('Move speed', g.moveSpeedFactor, `× ${f2(g.moveSpeedFactor)}`); n('Startup', g.startupSeconds, `${f2(g.startupSeconds)} s`); }
  if (e) { n('Distance', e.distanceBodyLengths, `${f2(e.distanceBodyLengths)} L`); n('Dodge', e.travelSeconds, `${f2(e.travelSeconds)} s`); }
  if (r.kind !== 'bite') n('Cooldown', r.cooldownSeconds, `${f2(r.cooldownSeconds)} s`);
  return out;
}
/** The short line of a move (a chip, a part card): "Dash · 1.60 L · .18 s dodge". */
export function moveLine(r: ResolvedMove): string {
  const a = r.attack, g = r.guard, e = r.evasion;
  if (e) return `${r.label} · ${f2(e.distanceBodyLengths)} L · ${f2(e.travelSeconds)} s dodge`;
  if (g?.kind === 'brace') return `${r.label} · blocks ${Math.round(g.blockFraction * 100)} % · breaks at ${g.breakHalfHearts ?? 0} ½♥`;
  if (g?.kind === 'counter') return `${r.label} · ${f2(g.windowSeconds ?? 0)} s window · reflects ${g.reflectDamage}`;
  if (a?.hold) return `${r.label} · holds ${f2(a.hold.seconds)} s · ${a.damage} damage`;
  if (a && a.shape.kind === 'cone') return `${r.label} · ${a.damage} damage · reach ${f2(a.shape.range)} L · wind-up ${f2(a.windupSeconds)} s`;
  return r.label;
}
/** The size slider's comparison (spec §12.2): the numbers that changed, "Range .60 → .66 L · Wind-up .16 → .17 s". */
export function moveDiff(before: ResolvedMove, after: ResolvedMove): string {
  const a = moveNumbers(before), b = moveNumbers(after);
  return a.flatMap((x, i) => { const y = b[i]; return y && y.label === x.label && y.value !== x.value ? [`${x.label} ${x.text.replace(/ (L|s)$/, '')} → ${y.text}`] : []; }).join(' · ');
}
/** The tradeoff line of a move kind (spec §12.1 item 4). */
export const TRADEOFF: Readonly<Record<MoveKind | 'bite', string>> = {
  bite: 'Bigger: more reach and damage, slower wind-up.', sweep: 'Bigger: more reach and knockback, slower swing and longer cooldown.',
  grab: 'Bigger: longer hold and bigger prey, slower grab and longer cooldown.', counter: 'Bigger: wider window and harder reflect, longer cooldown.',
  brace: 'Bigger: blocks more and breaks later, but you move slower.', dash: 'Bigger: dashes farther and stays safe longer, longer cooldown.',
};
/** The move line of a catalog part at scale 1 (spec §12.2), or null for a part that gives no move. */
export function partMoveLine(spec: PartSpec, c: MoveCatalogs = MOVE_CATALOGS): string | null {
  const g = spec.activeGrants[0], b = spec.basicAttacks[0];
  if (g && c.abilities[g.abilityId]) return `Move: ${moveLine(resolveMove({ abilityId: g.abilityId }, 1, {}, c))}`;
  if (b && c.attacks[b.attackId]) return `Move: ${moveLine(resolveMove({ attackId: b.attackId }, 1, {}, c))}`;
  return null;
}
/** Why a kind is lost (spec §12.2): the move name and the parts that give it, by part kind (a kind with several parts is named by its
 *  kind), the larger groups first: "Dash (no fin, leg or Paddle tail left)". Rare parts are not named. */
export function lostMoveText(kind: MoveKind, catalog: readonly PartSpec[] = PARTS): string {
  const givers = catalog.filter(p => !p.rare && p.activeGrants[0]?.id === kind), groups = new Map<string, PartSpec[]>();
  for (const p of givers) groups.set(p.kind, [...(groups.get(p.kind) ?? []), p]);
  const names = [...groups.values()].sort((x, y) => y.length - x.length).map(g => g.length > 1 ? g[0]!.kind : g[0]!.name);
  return `${KIND_NAMES[kind]} (no ${names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0] ?? 'part'} left)`;
}
/** The basic line of the moves panel (spec §12.1 item 1): "Bite (Snapper): 4 damage · reach .60 L · wind-up .16 s". */
export function basicLine(r: ResolvedMove, partName: string): string {
  const a = r.attack!; return `Bite (${partName}): ${a.damage} damage · reach ${f2(a.shape.kind === 'cone' ? a.shape.range : 0)} L · wind-up ${f2(a.windupSeconds)} s`;
}
/** Spec §7.2 swap: the dragged kind goes to `slot`; the kind shown there moves to the dragged kind's old slot (or is unpinned when the
 *  dragged kind was inactive). */
export function swapPins(pins: Readonly<Tuple4<SlotPin>>, shown: Readonly<Tuple4<MoveKind | null>>, kind: MoveKind, slot: number): Tuple4<SlotPin> {
  const from = shown.indexOf(kind), occupant = shown[slot] ?? null, out = pins.map(p => p === kind || p === occupant ? null : p) as Tuple4<SlotPin>;
  out[slot] = kind;
  if (occupant && occupant !== kind && from >= 0) out[from] = occupant;
  return out;
}
/** Repairs saved pins (T20 carry): four entries; a pin that is not a granted kind, or a kind pinned a second time, becomes null. */
export function repairPins(slots: readonly unknown[], granted: readonly MoveKind[]): Tuple4<SlotPin> {
  const seen = new Set<MoveKind>(), out: Tuple4<SlotPin> = [null, null, null, null];
  for (let i = 0; i < 4; i++) {
    const k = slots[i];
    if (typeof k === 'string' && (granted as readonly string[]).includes(k) && !seen.has(k as MoveKind)) { out[i] = k as MoveKind; seen.add(k as MoveKind); }
  }
  return out;
}
