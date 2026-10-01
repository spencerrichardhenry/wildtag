// Every combat registry in one place, and the full enumerated validation of the contract.
import type { AbilitySpec, AttackSpec, ContactHazard, HabitatProfile, MovementProfile, PursuitPolicy } from './combat-types';
import { EFFECTS, EVASIONS, GUARDS, HABITATS, HULLS, MOUNTS, MOVEMENTS, POSES, PURSUITS, TELEGRAPHS } from './profiles';
import { PARTS, type PartSpec } from './parts';
import { PLANS, type BodyPlan } from './plans';
import { SPECIES, type Species } from './species';
import { PART_RIG, type RigNode } from './rig';

type Entry = Record<string, { id: string }>;
export interface Catalogs {
  habitats: Record<string, HabitatProfile>; movements: Record<string, MovementProfile>; pursuits: Record<string, PursuitPolicy>;
  hulls: Entry; mounts: Entry; poses: Entry; telegraphs: Entry; effects: Entry; evasions: Entry; guards: Entry;
  attacks: Record<string, AttackSpec>; abilities: Record<string, AbilitySpec>; hazards: Record<string, ContactHazard>;
  parts: PartSpec[]; species: Species[]; plans: BodyPlan[]; rig: Record<string, Record<string, RigNode>>;
}
export const ATTACKS: Record<string, AttackSpec> = {};
export const ABILITIES: Record<string, AbilitySpec> = {};
const hazard = (id: string, damage: number, cadenceSeconds: number): ContactHazard => ({ id, damage, cadenceSeconds, invulnerabilitySeconds: .8, impulse: 0 });
export const HAZARDS: Record<string, ContactHazard> = Object.fromEntries([hazard('jelly-sting', 1, 1.8), hazard('ray-sting', 1, 1.8), hazard('crab-pinch', 2, 1.4), hazard('squid-grab', 2, 1.4), hazard('plane-buzz', 2, 1.4)].map(h => [h.id, h]));
export const defaultCatalogs = (): Catalogs => structuredClone({ habitats: HABITATS, movements: MOVEMENTS, pursuits: PURSUITS, hulls: HULLS, mounts: MOUNTS, poses: POSES, telegraphs: TELEGRAPHS,
  effects: EFFECTS, evasions: EVASIONS, guards: GUARDS, attacks: ATTACKS, abilities: ABILITIES, hazards: HAZARDS, parts: [...PARTS], species: [...SPECIES], plans: [...PLANS], rig: PART_RIG });

const MEDIA = ['water', 'air', 'land', 'burrow', 'space'], MODES = ['ground', 'swim', 'surface', 'glide', 'fly', 'burrow', 'space'], FACINGS = ['move', 'aim', 'lock-during-action'];
const TRAITS = ['weapon', 'protection', 'locomotion', 'concealment'];
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonNeg = (v: unknown) => fin(v) && v >= 0;
const nullOrNonNeg = (v: unknown) => v === null || nonNeg(v);
const isInt = (v: unknown): v is number => fin(v) && Number.isInteger(v);
const vec = (v: { x: number; y: number; z: number } | undefined) => !!v && fin(v.x) && fin(v.y) && fin(v.z);

export function validateContract(c: Catalogs = defaultCatalogs()): string[] {
  const out: string[] = [];
  const ids = (name: string, reg: Record<string, { id: string }>) => { for (const [k, v] of Object.entries(reg)) if (v.id !== k) out.push(`${name} ${k}: id`); };
  ids('habitat', c.habitats); ids('movement', c.movements); ids('pursuit', c.pursuits); ids('hull', c.hulls); ids('mount', c.mounts); ids('pose', c.poses); ids('telegraph', c.telegraphs);
  ids('effect', c.effects); ids('evasion', c.evasions); ids('guard', c.guards); ids('attack', c.attacks); ids('ability', c.abilities); ids('hazard', c.hazards);

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
  }
  for (const [k, a] of Object.entries(c.abilities)) {
    if (!nonNeg(a.cooldownSeconds)) out.push(`ability ${k}: cooldownSeconds`);
    for (const m of a.allowedMotionModes) if (!MODES.includes(m)) out.push(`ability ${k}: mode ${m}`);
    if (!c.effects[a.effectProfileId]) out.push(`ability ${k}: effect ${a.effectProfileId}`);
  }
  for (const p of c.parts) {
    for (const t of p.traits) if (!TRAITS.includes(t)) out.push(`part ${p.id}: trait ${t}`);
    const sockets = new Set<string>();
    for (const s of p.sockets) {
      if (sockets.has(s.id)) out.push(`part ${p.id}: duplicate socket ${s.id}`); sockets.add(s.id);
      if (!vec(s.origin)) out.push(`part ${p.id}: socket ${s.id} origin`);
      if (!vec(s.forward) || Math.abs(Math.hypot(s.forward.x, s.forward.y, s.forward.z) - 1) > 1e-6) out.push(`part ${p.id}: socket ${s.id} forward`);
      if (s.pivot && !c.rig[p.id]?.[`${s.pivot.kind}:${s.pivot.index}`]) out.push(`part ${p.id}: socket ${s.id} pivot`);
    }
    const grants = new Set<string>();
    for (const g of [...p.basicAttacks, ...p.activeGrants]) {
      if (grants.has(g.id)) out.push(`part ${p.id}: duplicate grant ${g.id}`); grants.add(g.id);
      for (const s of g.socketIds) if (!sockets.has(s)) out.push(`part ${p.id}: grant ${g.id} socket ${s}`);
    }
    for (const g of p.basicAttacks) if (!c.attacks[g.attackId]) out.push(`part ${p.id}: attack ${g.attackId}`);
    for (const g of p.activeGrants) { if (!c.abilities[g.abilityId]) out.push(`part ${p.id}: ability ${g.abilityId}`); if (g.mirrorPolicy !== 'shared-cast') out.push(`part ${p.id}: mirrorPolicy ${g.id}`); }
  }
  for (const s of c.species) {
    if (!c.habitats[s.habitatProfileId]) out.push(`species ${s.key}: habitat ${s.habitatProfileId}`);
    if (!c.movements[s.movementProfileId]) out.push(`species ${s.key}: movement ${s.movementProfileId}`);
    if (!c.pursuits[s.pursuitId]) out.push(`species ${s.key}: pursuit ${s.pursuitId}`);
    if (!c.hulls[s.hullProfileId]) out.push(`species ${s.key}: hull ${s.hullProfileId}`);
    if (!c.mounts[s.attackMountProfileId]) out.push(`species ${s.key}: mount ${s.attackMountProfileId}`);
    if (s.contactHazardId !== undefined && !c.hazards[s.contactHazardId]) out.push(`species ${s.key}: hazard ${s.contactHazardId}`);
    for (const a of s.attackIds) if (!c.attacks[a]) out.push(`species ${s.key}: attack ${a}`);
    if ((s.hunts.length || s.stingsStages.length) && s.contactHazardId === undefined) out.push(`species ${s.key}: hazard missing`);
    if (s.fights && s.pursuitId === 'none') out.push(`species ${s.key}: fights without pursuit`);
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
