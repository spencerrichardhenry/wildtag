// Every combat registry in one place, and the full enumerated validation of the contract.
import { MOVE_PRIORITY, type AbilitySpec, type AttackSpec, type ContactHazard, type EffectProfile, type EvasionProfile, type GuardProfile, type HabitatProfile, type MovementProfile, type PursuitPolicy, type TelegraphProfile } from './combat-types';
import { HABITATS, HULLS, MOUNTS, MOVEMENTS, POSES, PURSUITS } from './profiles';
import { EFFECTS, TELEGRAPHS } from './combat-profiles';
import { BEHAVIOUR_TYPES, BEHAVIOURS, hostileSizes, minWindup, SPECIES_ATTACKS, type SpeciesBehaviour } from './bestiary';
import { PART_MOVES, PARTS, type PartSpec } from './parts';
import { EVASIONS, GUARDS, PLAYER_ABILITIES, PLAYER_ATTACKS } from './moves';
import { PLANS, type BodyPlan } from './plans';
import { FOOD_GLBS, SPECIES, type Species } from './species';
import { PART_RIG, type RigNode } from './rig';
import { forwardReach } from './combat-shapes';

type Entry = Record<string, { id: string }>;
export interface Catalogs {
  habitats: Record<string, HabitatProfile>; movements: Record<string, MovementProfile>; pursuits: Record<string, PursuitPolicy>;
  hulls: Entry; mounts: Entry; poses: Entry; telegraphs: Record<string, TelegraphProfile>; effects: Record<string, EffectProfile>;
  evasions: Record<string, EvasionProfile>; guards: Record<string, GuardProfile>;
  attacks: Record<string, AttackSpec>; abilities: Record<string, AbilitySpec>; hazards: Record<string, ContactHazard>; behaviours: Record<string, SpeciesBehaviour>;
  parts: PartSpec[]; species: Species[]; plans: BodyPlan[]; rig: Record<string, Record<string, RigNode>>;
}
/** Player attacks (moves.ts, Task 2) and species attacks (bestiary.ts), merged; a duplicate id throws at load. */
function merged(...sources: Record<string, AttackSpec>[]): Record<string, AttackSpec> {
  const out: Record<string, AttackSpec> = {};
  for (const src of sources) for (const [k, v] of Object.entries(src)) { if (out[k]) throw new Error(`duplicate attack id ${k}`); out[k] = v; }
  return out;
}
export const ATTACKS: Record<string, AttackSpec> = merged(PLAYER_ATTACKS, SPECIES_ATTACKS);
export const ABILITIES: Record<string, AbilitySpec> = PLAYER_ABILITIES;
export { EVASIONS, GUARDS };
const hazard = (id: string, damage: number, cadenceSeconds: number): ContactHazard => ({ id, damage, cadenceSeconds, invulnerabilitySeconds: .8, impulse: 0 });
export const HAZARDS: Record<string, ContactHazard> = Object.fromEntries([hazard('jelly-sting', 1, 1.8), hazard('ray-sting', 1, 1.8), hazard('crab-pinch', 2, 1.4), hazard('squid-grab', 2, 1.4), hazard('plane-buzz', 2, 1.4)].map(h => [h.id, h]));
export const defaultCatalogs = (): Catalogs => structuredClone({ habitats: HABITATS, movements: MOVEMENTS, pursuits: PURSUITS, hulls: HULLS, mounts: MOUNTS, poses: POSES, telegraphs: TELEGRAPHS,
  effects: EFFECTS, evasions: EVASIONS, guards: GUARDS, attacks: ATTACKS, abilities: ABILITIES, hazards: HAZARDS, behaviours: BEHAVIOURS, parts: [...PARTS], species: [...SPECIES], plans: [...PLANS], rig: PART_RIG });

const MEDIA = ['water', 'air', 'land', 'burrow', 'space'], MODES = ['ground', 'swim', 'surface', 'glide', 'fly', 'burrow', 'space'], FACINGS = ['move', 'aim', 'lock-during-action'];
const TRAITS = ['weapon', 'protection', 'locomotion', 'concealment'];
const AIM_MODES = ['input', 'body-back', 'centre', 'fixed-at-start'], COLORS = ['amber', 'red', 'none'], PATTERNS = ['solid', 'stripes'];
const CUES = ['rear', 'crouch', 'inflate', 'coil', 'burrow', 'spin', 'none'], SOUNDS = ['hit', 'block', 'counter', 'dash', 'grab', 'break', 'none'];
/** The number at a dotted path ('damage', 'shape.range', 'hold.seconds'), or undefined. */
export function numberAt(o: unknown, path: string): number | undefined {
  let v: unknown = o;
  for (const k of path.split('.')) { if (!v || typeof v !== 'object') return undefined; v = (v as Record<string, unknown>)[k]; }
  return typeof v === 'number' ? v : undefined;
}
/** A pair is stronger, never weaker: a multiplier is ≥ 1, except a cooldown's, which is in (0, 1] (the Dash pair's × .85; spec defect: V10 said ≥ 1). */
const pairMultiplierOk = (key: string, v: number) => key.endsWith('cooldownSeconds') ? v > 0 && v <= 1 : v >= 1;
/** Attack paths may start with `shape.`, `lunge.` or `hold.`, or name a top-level number. */
const attackPathOk = (a: AttackSpec, key: string) => { const head = key.split('.')[0]!; return (key.includes('.') ? ['shape', 'lunge', 'hold'].includes(head) : true) && numberAt(a, key) !== undefined; };

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonNeg = (v: unknown) => fin(v) && v >= 0;
const nullOrNonNeg = (v: unknown) => v === null || nonNeg(v);
const isInt = (v: unknown): v is number => fin(v) && Number.isInteger(v);
const vec = (v: { x: number; y: number; z: number } | undefined) => !!v && fin(v.x) && fin(v.y) && fin(v.z);

export function validateContract(c: Catalogs = defaultCatalogs()): string[] {
  const out: string[] = [];
  const ids = (name: string, reg: Record<string, { id: string }>) => { for (const [k, v] of Object.entries(reg)) if (v.id !== k) out.push(`${name} ${k}: id`); };
  ids('habitat', c.habitats); ids('movement', c.movements); ids('pursuit', c.pursuits); ids('hull', c.hulls); ids('mount', c.mounts); ids('pose', c.poses); ids('telegraph', c.telegraphs);
  ids('effect', c.effects); ids('evasion', c.evasions); ids('guard', c.guards); ids('attack', c.attacks); ids('ability', c.abilities); ids('hazard', c.hazards); ids('behaviour', c.behaviours);

  for (const [k, h] of Object.entries(c.habitats)) {
    if (!Array.isArray(h.media) || !h.media.length || !h.media.every(m => MEDIA.includes(m))) out.push(`habitat ${k}: media`);
    for (const f of ['maxWaterDepthBodyLengths', 'maxFloorGapBodyLengths', 'surfaceBandBodyLengths', 'wadingSupportBodyLengths'] as const) if (!nullOrNonNeg(h[f])) out.push(`habitat ${k}: ${f}`);
    if (!fin(h.maxLandSlopeRadians) || h.maxLandSlopeRadians < 0 || h.maxLandSlopeRadians > Math.PI / 2) out.push(`habitat ${k}: maxLandSlopeRadians`);
    if (!Array.isArray(h.refugeTags) || !h.refugeTags.every(t => typeof t === 'string')) out.push(`habitat ${k}: refugeTags`);
    if (h.isStaticProp !== undefined && typeof h.isStaticProp !== 'boolean') out.push(`habitat ${k}: isStaticProp`);
  }
  for (const [k, m] of Object.entries(c.movements)) {
    if (!MODES.includes(m.mode)) out.push(`movement ${k}: mode`);
    for (const f of ['speedMultiplier', 'acceleration', 'braking', 'maxYawRate', 'maxPitchRate'] as const) if (!nonNeg(m[f])) out.push(`movement ${k}: ${f}`);
    if (!FACINGS.includes(m.facing)) out.push(`movement ${k}: facing`);
    if (m.evasionProfileId !== undefined && !c.evasions[m.evasionProfileId]) out.push(`movement ${k}: evasion ${m.evasionProfileId}`);
  }
  for (const [k, p] of Object.entries(c.pursuits)) for (const f of ['memorySeconds', 'blockedWaitSeconds', 'reacquireSeconds', 'leashBodyLengths', 'giveUpBodyLengths'] as const) if (!nonNeg(p[f])) out.push(`pursuit ${k}: ${f}`);
  for (const [k, h] of Object.entries(c.hazards)) {
    for (const f of ['damage', 'invulnerabilitySeconds', 'impulse'] as const) if (!nonNeg(h[f])) out.push(`hazard ${k}: ${f}`);
    if (!fin(h.cadenceSeconds) || h.cadenceSeconds <= 0) out.push(`hazard ${k}: cadenceSeconds`);
  }
  for (const [k, a] of Object.entries(c.attacks)) {
    for (const f of ['windupSeconds', 'activeSeconds', 'recoverySeconds', 'cooldownSeconds', 'aimLockAtSeconds', 'maxTrackingRadiansPerSecond', 'damage', 'impulse', 'staggerSeconds', 'repeatHitSeconds'] as const) if (!nonNeg(a[f])) out.push(`attack ${k}: ${f}`);
    if (nonNeg(a.aimLockAtSeconds) && nonNeg(a.windupSeconds) && a.aimLockAtSeconds > a.windupSeconds) out.push(`attack ${k}: aimLockAtSeconds`);
    for (const f of ['maxTargets', 'maxHitsPerTarget'] as const) if (!isInt(a[f]) || a[f] < 1) out.push(`attack ${k}: ${f}`);
    const s = a.shape;
    const shapeOk = s.kind === 'cone' ? fin(s.range) && s.range > 0 && fin(s.halfAngle) && s.halfAngle > 0 && s.halfAngle <= Math.PI
      : s.kind === 'capsule' ? fin(s.radius) && s.radius > 0 && vec(s.start) && vec(s.end) : false;
    if (!shapeOk) out.push(`attack ${k}: shape`);
    if (!['shared-grant', 'per-emitter'].includes(a.hitGroup)) out.push(`attack ${k}: hitGroup`);
    if (!['same-medium', 'water-surface', 'any-medium'].includes(a.crossing)) out.push(`attack ${k}: crossing`);
    if (a.obstruction !== 'terrain-and-cover') out.push(`attack ${k}: obstruction`);
    if (!c.poses[a.poseProfileId]) out.push(`attack ${k}: pose ${a.poseProfileId}`);
    if (!c.telegraphs[a.telegraphProfileId]) out.push(`attack ${k}: telegraph ${a.telegraphProfileId}`);
    // V2
    if (a.damageUnit !== 'hp' && a.damageUnit !== 'half-heart') out.push(`attack ${k}: damageUnit`);
    if (!AIM_MODES.includes(a.aimMode)) out.push(`attack ${k}: aimMode`);
    if (a.origin !== undefined && (a.origin !== 'target' || a.aimMode !== 'fixed-at-start')) out.push(`attack ${k}: origin`);   // V2 (review R4)
    if (!fin(a.moveSpeedFactor) || a.moveSpeedFactor < 0 || a.moveSpeedFactor > 1) out.push(`attack ${k}: moveSpeedFactor`);
    if (!nonNeg(a.poiseDamageMultiplier)) out.push(`attack ${k}: poiseDamageMultiplier`);
    // V3
    if (a.lunge && !(fin(a.lunge.distanceBodyLengths) && a.lunge.distanceBodyLengths > 0)) out.push(`attack ${k}: lunge`);
    if (a.hold) {
      const h = a.hold;
      if (!(fin(h.seconds) && h.seconds > 0) || !(fin(h.sizeFactor) && h.sizeFactor > 0) || ![h.startHalfHearts, h.squeezeHalfHearts, h.squeezeEverySeconds].every(nonNeg)
        || (h.squeezeHalfHearts > 0 && !(h.squeezeEverySeconds > 0))) out.push(`attack ${k}: hold`);
    }
    if (a.whiffRecoverySeconds !== undefined && !nonNeg(a.whiffRecoverySeconds)) out.push(`attack ${k}: whiffRecoverySeconds`);
    // V4
    if (a.statusEffectId !== undefined && c.effects[a.statusEffectId]?.kind !== 'status') out.push(`attack ${k}: status ${a.statusEffectId}`);
    // V5
    const pair = a.pair ?? null;
    for (const [key, v] of [...Object.entries(a.scaling ?? {}), ...Object.entries(pair?.multiply ?? {}), ...Object.entries(pair?.add ?? {})]) {
      if (!attackPathOk(a, key)) out.push(`attack ${k}: scaling key ${key}`); else if (!fin(v)) out.push(`attack ${k}: scaling value ${key}`);
    }
    for (const [key, v] of Object.entries(pair?.multiply ?? {})) if (fin(v) && !pairMultiplierOk(key, v)) out.push(`attack ${k}: pair multiplier ${key}`);
    // V6
    const tg = c.telegraphs[a.telegraphProfileId];
    if (tg) {
      const species = a.damageUnit === 'half-heart';
      if (!species && tg.color !== 'none') out.push(`attack ${k}: telegraph colour`);
      else if (species && !a.blockable && (tg.color !== 'red' || tg.pattern !== 'stripes')) out.push(`attack ${k}: telegraph colour`);
      else if (species && a.blockable && (tg.color !== 'amber' || tg.pattern !== 'solid')) out.push(`attack ${k}: telegraph colour`);
    }
    // V7
    if (a.damageUnit === 'half-heart') {
      const fixed = a.aimMode === 'centre' || a.aimMode === 'fixed-at-start';
      if (fixed ? a.aimLockAtSeconds !== 0 : a.aimLockAtSeconds > a.windupSeconds - .2 + 1e-9) out.push(`attack ${k}: lock before active`);
    }
  }
  // V8: the minimum wind-up at every size at which a species that uses the attack is hostile.
  for (const s of c.species) for (const id of s.attackIds) {
    const a = c.attacks[id]; if (!a) continue;
    for (const size of hostileSizes(s)) if (a.windupSeconds < minWindup(size, !!s.alpha) - 1e-9) out.push(`attack ${id}: windup below ${minWindup(size, !!s.alpha)} at size ${size} (${s.key})`);
  }
  for (const [k, a] of Object.entries(c.abilities)) {
    if (!nonNeg(a.cooldownSeconds)) out.push(`ability ${k}: cooldownSeconds`);
    for (const m of a.allowedMotionModes) if (!MODES.includes(m)) out.push(`ability ${k}: mode ${m}`);
    if (!c.effects[a.effectProfileId]) out.push(`ability ${k}: effect ${a.effectProfileId}`);
    // V9
    if (!MOVE_PRIORITY.includes(a.kind)) { out.push(`ability ${k}: kind`); continue; }
    if (a.input !== (a.kind === 'brace' ? 'hold' : 'press')) out.push(`ability ${k}: input`);
    const wantsAttack = a.kind === 'grab' || a.kind === 'sweep', wantsGuard = a.kind === 'brace' || a.kind === 'counter', wantsEvasion = a.kind === 'dash';
    if (wantsAttack ? !(a.attackId && c.attacks[a.attackId]) : a.attackId !== undefined) out.push(`ability ${k}: attack ${a.attackId}`);
    if (wantsGuard ? !(a.guardProfileId && c.guards[a.guardProfileId]?.kind === a.kind) : a.guardProfileId !== undefined) out.push(`ability ${k}: guard ${a.guardProfileId}`);
    if (wantsEvasion ? !(a.evasionProfileId && c.evasions[a.evasionProfileId]) : a.evasionProfileId !== undefined) out.push(`ability ${k}: evasion ${a.evasionProfileId}`);
    // V10: 'cooldownSeconds' (the ability) or 'guard.<field>', 'evasion.<field>', 'attack.<path>'.
    const target = (key: string): boolean => {
      if (key === 'cooldownSeconds') return true;
      const [head, ...rest] = key.split('.'), path = rest.join('.');
      if (!path) return false;
      if (head === 'guard') return numberAt(a.guardProfileId ? c.guards[a.guardProfileId] : undefined, path) !== undefined;
      if (head === 'evasion') return numberAt(a.evasionProfileId ? c.evasions[a.evasionProfileId] : undefined, path) !== undefined;
      if (head === 'attack') { const at = a.attackId ? c.attacks[a.attackId] : undefined; return !!at && attackPathOk(at, path); }
      return false;
    };
    for (const [key, v] of [...Object.entries(a.scaling), ...Object.entries(a.pair?.multiply ?? {}), ...Object.entries(a.pair?.add ?? {})]) {
      if (!target(key)) out.push(`ability ${k}: scaling key ${key}`); else if (!fin(v)) out.push(`ability ${k}: scaling value ${key}`);
    }
    for (const [key, v] of Object.entries(a.pair?.multiply ?? {})) if (fin(v) && !pairMultiplierOk(key, v)) out.push(`ability ${k}: pair multiplier ${key}`);
  }
  // V11
  for (const [k, g] of Object.entries(c.guards)) {
    if (g.kind !== 'brace' && g.kind !== 'counter') { out.push(`guard ${k}: kind`); continue; }
    for (const f of ['blockFraction', 'moveSpeedFactor', 'yawRateFactor'] as const) if (!fin(g[f]) || g[f] < 0 || g[f] > 1) out.push(`guard ${k}: ${f}`);
    for (const f of ['startupSeconds', 'minActiveSeconds', 'breakStaggerSeconds', 'brokenCooldownSeconds', 'reflectDamage', 'attackerStaggerSeconds', 'recoverySeconds', 'whiffRecoverySeconds', 'successCooldownSeconds'] as const)
      if (!nonNeg(g[f])) out.push(`guard ${k}: ${f}`);
    const counter = g.kind === 'counter';
    if (counter ? !nonNeg(g.windowSeconds) : g.windowSeconds !== null) out.push(`guard ${k}: windowSeconds`);
    if (counter ? g.frontHalfAngle !== null : !(fin(g.frontHalfAngle) && g.frontHalfAngle > 0 && g.frontHalfAngle <= Math.PI)) out.push(`guard ${k}: frontHalfAngle`);
    if (counter ? g.breakHalfHearts !== null : !nonNeg(g.breakHalfHearts)) out.push(`guard ${k}: breakHalfHearts`);
  }
  // V12
  for (const [k, e] of Object.entries(c.evasions)) {
    for (const f of ['startupSeconds', 'recoverySeconds'] as const) if (!nonNeg(e[f])) out.push(`evasion ${k}: ${f}`);
    if (!(fin(e.travelSeconds) && e.travelSeconds > 0)) out.push(`evasion ${k}: travelSeconds`);
    if (!(fin(e.distanceBodyLengths) && e.distanceBodyLengths > 0)) out.push(`evasion ${k}: distanceBodyLengths`);
    if (!fin(e.endSpeedCarry) || e.endSpeedCarry < 0 || e.endSpeedCarry > 1) out.push(`evasion ${k}: endSpeedCarry`);
    if (e.plane !== 'free' && e.plane !== 'horizontal') out.push(`evasion ${k}: plane`);
  }
  // V13
  for (const [k, t] of Object.entries(c.telegraphs)) {
    if (!COLORS.includes(t.color) || !PATTERNS.includes(t.pattern) || !CUES.includes(t.poseCue) || typeof t.edgeArrow !== 'boolean') out.push(`telegraph ${k}: enum`);
    if (!fin(t.flashLeadSeconds) || t.flashLeadSeconds < 0 || t.flashLeadSeconds > .3) out.push(`telegraph ${k}: flashLeadSeconds`);
  }
  for (const [k, e] of Object.entries(c.effects)) {
    if ((e.kind !== 'feedback' && e.kind !== 'status') || !SOUNDS.includes(e.sound) || typeof e.particles !== 'string') out.push(`effect ${k}: enum`);
    if (e.kind === 'status' && !(e.status && e.status.id === 'inked' && fin(e.status.seconds) && e.status.seconds > 0 && fin(e.status.speedFactor) && e.status.speedFactor > 0 && e.status.speedFactor <= 1)) out.push(`effect ${k}: status`);
  }
  // V14, V15
  for (const [k, b] of Object.entries(c.behaviours)) {
    if (!BEHAVIOUR_TYPES.includes(b.type)) { out.push(`behaviour ${k}: type`); continue; }
    const users = c.species.filter(s => s.behaviourId === k), refs = new Set<string>();
    const ref = (id: string | undefined, where: string) => {
      if (id === undefined) return;
      refs.add(id);
      const a = c.attacks[id];
      if (!a) out.push(`behaviour ${k}: ${where} ${id} missing`);
      else if (a.damageUnit !== 'half-heart') out.push(`behaviour ${k}: ${where} ${id} unit`);
      for (const s of users) if (!s.attackIds.includes(id)) out.push(`behaviour ${k}: ${id} not in ${s.key} attackIds`);
    };
    const choices = (list: readonly { attackId: string; band: readonly [number, number]; weight: number; flankWeight?: number; chainNextId?: string; chainGapSeconds?: number }[], where: string) => {
      for (const ch of list) {
        ref(ch.attackId, where); ref(ch.chainNextId, `${where} chain`);
        if (!(fin(ch.band[0]) && fin(ch.band[1]) && ch.band[0] >= 0 && ch.band[0] < ch.band[1])) out.push(`behaviour ${k}: band ${ch.attackId}`);
        // V21 (review R2): the shape starts at the hull front, so the band's far end must lie within its forward reach.
        const at = c.attacks[ch.attackId];
        if (at && fin(ch.band[1]) && ch.band[1] > forwardReach(at.shape) + 1e-9) out.push(`behaviour ${k}: reach ${ch.attackId}`);
        if (!(fin(ch.weight) && ch.weight > 0) || (ch.flankWeight !== undefined && !(fin(ch.flankWeight) && ch.flankWeight > 0))) out.push(`behaviour ${k}: weight ${ch.attackId}`);
        if (ch.chainGapSeconds !== undefined && !nonNeg(ch.chainGapSeconds)) out.push(`behaviour ${k}: chainGapSeconds`);
      }
    };
    choices(b.attacks, 'attack');
    ref(b.den?.attackId, 'den');
    for (const [i, ph] of (b.phases ?? []).entries()) { choices(ph.attacks, `phase ${i}`); ref(ph.patternAttackId, `phase ${i} pattern`); if (!nonNeg(ph.gapSeconds) || !nonNeg(ph.speedFactor)) out.push(`behaviour ${k}: phase ${i} numbers`); }
    for (const s of users) for (const id of s.attackIds) if (!refs.has(id)) out.push(`behaviour ${k}: ${s.key} attack ${id} unused`);
    const durations = [b.reactionSeconds, b.gapSeconds, b.repositionSeconds[0], b.repositionSeconds[1], b.repositionSpeedFactor, b.poise, b.flee?.seconds ?? 0, b.flee?.restSeconds ?? 0, b.flee?.speedFactor ?? 0,
      b.trigger?.seconds ?? 0, b.trigger?.radiusBodyLengths ?? 0, b.den?.outSeconds ?? 0, b.den?.triggerBodyLengths ?? 0, b.lair?.resetDelaySeconds ?? 0, b.lair?.healPerSecond ?? 0, b.lair?.radiusBodyLengths ?? 0, b.lair?.resetOutsideFactor ?? 0,
      b.school?.radiusBodyLengths ?? 0, b.school?.groupSize ?? 0];
    if (!durations.every(nonNeg)) out.push(`behaviour ${k}: durations`);
    if (b.repositionSeconds[0] > b.repositionSeconds[1]) out.push(`behaviour ${k}: repositionSeconds`);
    for (const f of ['staggerResist', 'knockbackResistance'] as const) if (!fin(b[f]) || b[f] < 0 || b[f] > 1) out.push(`behaviour ${k}: ${f}`);
    if (typeof b.grabbable !== 'boolean') out.push(`behaviour ${k}: grabbable`);
    // V15
    const t = b.type;
    if ((t === 'prey-flee' || t === 'prey-school') !== !!b.flee) out.push(`behaviour ${k}: flee`);
    if ((t === 'prey-school') !== !!b.school) out.push(`behaviour ${k}: school`);
    if ((t === 'prey-fighter') !== !!b.trigger) out.push(`behaviour ${k}: trigger`);
    if ((t === 'hunter-ambush') !== !!b.den) out.push(`behaviour ${k}: den`);
    if ((t === 'alpha') !== !!b.lair) out.push(`behaviour ${k}: lair`);
    if ((t === 'alpha') !== !!b.phases) out.push(`behaviour ${k}: phases`);
    if (b.phases) {
      const f = b.phases.map(p => p.aboveHpFraction);
      const ok = f.length > 0 && f.at(-1) === 0 && f.slice(0, -1).every(v => fin(v) && v > 0 && v < 1) && f.every((v, i) => i === 0 || v < f[i - 1]!);
      if (!ok) out.push(`behaviour ${k}: phase order`);
      for (const [i, ph] of b.phases.entries()) if ((ph.pattern === 'burrow' || ph.pattern === 'laps') !== (ph.patternAttackId !== undefined)) out.push(`behaviour ${k}: phase ${i} pattern`);
    }
  }
  for (const p of c.parts) {
    for (const t of p.traits) if (!TRAITS.includes(t)) out.push(`part ${p.id}: trait ${t}`);
    const sockets = new Set<string>();
    for (const s of p.sockets) {
      if (sockets.has(s.id)) out.push(`part ${p.id}: duplicate socket ${s.id}`); sockets.add(s.id);
      if (!vec(s.origin)) out.push(`part ${p.id}: socket ${s.id} origin`);
      if (!vec(s.forward) || Math.abs(Math.hypot(s.forward.x, s.forward.y, s.forward.z) - 1) > 1e-6) out.push(`part ${p.id}: socket ${s.id} forward`);
      if (s.pivot && !c.rig[p.model ?? p.id]?.[`${s.pivot.kind}:${s.pivot.index}`]) out.push(`part ${p.id}: socket ${s.id} pivot`);
    }
    const grants = new Set<string>();
    for (const g of [...p.basicAttacks, ...p.activeGrants]) {
      if (grants.has(g.id)) out.push(`part ${p.id}: duplicate grant ${g.id}`); grants.add(g.id);
      for (const s of g.socketIds) if (!sockets.has(s)) out.push(`part ${p.id}: grant ${g.id} socket ${s}`);
    }
    for (const g of p.basicAttacks) if (!c.attacks[g.attackId]) out.push(`part ${p.id}: attack ${g.attackId}`);
    for (const g of p.activeGrants) { if (!c.abilities[g.abilityId]) out.push(`part ${p.id}: ability ${g.abilityId}`); if (g.mirrorPolicy !== 'shared-cast') out.push(`part ${p.id}: mirrorPolicy ${g.id}`); }
    // V16: one grant per move-giving part, of its kind (spec §7.1); one Bite per mouth; no other basic grant.
    const kind = PART_MOVES[p.id];
    if (kind ? p.activeGrants.length !== 1 : p.activeGrants.length !== 0) out.push(`part ${p.id}: grants`);
    else if (kind && c.abilities[p.activeGrants[0]!.abilityId] && c.abilities[p.activeGrants[0]!.abilityId]!.kind !== kind) out.push(`part ${p.id}: move kind`);
    if (p.kind === 'mouth') {
      const b = p.basicAttacks[0], a = b && c.attacks[b.attackId];
      if (p.basicAttacks.length !== 1 || !a || a.aimMode !== 'input' || a.damageUnit !== 'hp') out.push(`part ${p.id}: basic`);
    } else if (p.basicAttacks.length) out.push(`part ${p.id}: basic`);
    // V17
    if (p.rare && c.species.filter(s => s.alpha?.rewardPartId === p.id).length !== 1) out.push(`part ${p.id}: rare without one alpha`);
    if (p.model !== undefined && !c.parts.some(q => q.id === p.model && !q.rare)) out.push(`part ${p.id}: model ${p.model}`);
  }
  for (const s of c.species) {
    if (!c.habitats[s.habitatProfileId]) out.push(`species ${s.key}: habitat ${s.habitatProfileId}`);
    if (!c.movements[s.movementProfileId]) out.push(`species ${s.key}: movement ${s.movementProfileId}`);
    if (!c.pursuits[s.pursuitId]) out.push(`species ${s.key}: pursuit ${s.pursuitId}`);
    if (!c.hulls[s.hullProfileId]) out.push(`species ${s.key}: hull ${s.hullProfileId}`);
    if (!c.mounts[s.attackMountProfileId]) out.push(`species ${s.key}: mount ${s.attackMountProfileId}`);
    if (s.contactHazardId !== undefined && !c.hazards[s.contactHazardId]) out.push(`species ${s.key}: hazard ${s.contactHazardId}`);
    for (const a of s.attackIds) if (!c.attacks[a]) out.push(`species ${s.key}: attack ${a}`);
    if (s.fights && s.pursuitId === 'none') out.push(`species ${s.key}: fights without pursuit`);
    // V18
    const behaviour = s.behaviourId === undefined ? undefined : c.behaviours[s.behaviourId];
    if (s.behaviourId !== undefined && !behaviour) out.push(`species ${s.key}: behaviour ${s.behaviourId}`);
    if (s.behaviourId !== undefined && s.contactHazardId !== undefined) out.push(`species ${s.key}: behaviour and hazard`);
    if ((s.hunts.length || s.stingsStages.length) && s.contactHazardId === undefined && !(behaviour && ['hunter', 'hunter-ambush', 'alpha'].includes(behaviour.type))) out.push(`species ${s.key}: hazard missing`);
    // V19
    if (s.bodyScale !== undefined && !(fin(s.bodyScale) && s.bodyScale >= .3 && s.bodyScale <= 3)) out.push(`species ${s.key}: bodyScale`);
    if (s.alpha) {
      const a = s.alpha;
      if (!(isInt(a.size) && a.size >= 0 && a.size <= 4) || !(Number.isSafeInteger(a.rewardDna) && a.rewardDna >= 0)) out.push(`species ${s.key}: alpha`);
      if (s.count !== 1 || behaviour?.type !== 'alpha') out.push(`species ${s.key}: alpha count or behaviour`);
      if (!c.parts.some(p => p.id === a.rewardPartId && p.rare)) out.push(`species ${s.key}: reward ${a.rewardPartId}`);
    } else if (behaviour?.type === 'alpha') out.push(`species ${s.key}: alpha count or behaviour`);
    // V20
    if (s.kind !== 'planet' && !FOOD_GLBS.includes(s.model ?? s.kind)) out.push(`species ${s.key}: model ${s.model ?? s.kind}`);
  }
  for (const p of c.plans) {
    if (!c.habitats[p.habitat]) out.push(`plan ${p.id}: habitat`);
    if (!c.movements[p.movement]) out.push(`plan ${p.id}: movement`);
    if (!c.hulls[p.hullProfile]) out.push(`plan ${p.id}: hull ${p.hullProfile}`);
    if (!fin(p.physics.massPerBodyLength) || p.physics.massPerBodyLength <= 0) out.push(`plan ${p.id}: mass`);
    if (!fin(p.physics.knockbackResistance) || p.physics.knockbackResistance < 0 || p.physics.knockbackResistance > 1) out.push(`plan ${p.id}: resistance`);
  }
  const matrix = (m: unknown) => Array.isArray(m) && m.length === 16 && m.every(fin) && m[3] === 0 && m[7] === 0 && m[11] === 0 && m[15] === 1;   // column-major: the bottom row is 3, 7, 11, 15
  for (const [pid, nodes] of Object.entries(c.rig)) for (const [k, n] of Object.entries(nodes)) {
    const at = `rig ${pid} ${k}`;
    if (n.parent !== null && !nodes[n.parent]) out.push(`${at}: parent`);
    else { const seen = new Set([k]); for (let q = n.parent; q !== null && nodes[q]; q = nodes[q]!.parent) { if (seen.has(q)) { out.push(`${at}: cycle`); break; } seen.add(q); } }
    if (!matrix(n.pre)) out.push(`${at}: pre`);
    if (!matrix(n.rest)) out.push(`${at}: rest`);
    if (!Array.isArray(n.t) || n.t.length !== 3 || !n.t.every(fin)) out.push(`${at}: t`);
    if (!Array.isArray(n.s) || n.s.length !== 3 || !n.s.every(v => fin(v) && v !== 0)) out.push(`${at}: s`);
    if (!Array.isArray(n.q) || n.q.length !== 4 || !n.q.every(fin) || Math.abs(Math.hypot(...n.q) - 1) > 1e-6) out.push(`${at}: q`);
  }
  return out;
}
