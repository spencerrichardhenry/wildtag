// Hit resolution (spec §6): one hit request at a time, in the contract order — validity, guard and counter, immunity, damage, stagger,
// impulse, ledger and event. Pure: it changes the fighters' runtimes, health and ledgers it is given and returns combat events; it never
// moves a body (an impulse only changes `externalVelocity`).
import { addPoise, applyHitStop, endHold, endNow, interruptible, stagger, type PoiseMeter } from './action-engine';
import { hitStopFor } from './combat-profiles';
import type { ActionState, ActorId, AttackSpec, CombatRuntime, HitOutcome, Vec3 } from './combat-types';
import { damageAfterArmor } from './state';

/** One side of a hit. `health`: hearts for the player, HP for a species; the resolver lowers it. */
export interface Fighter {
  id: ActorId; isPlayer: boolean; rt: CombatRuntime;
  centre: Vec3;
  /** The 3D forward (Brace's front test). */
  forward: Vec3;
  /** Body length L. */
  L: number; mass: number; knockbackResistance: number;
  /** Player armor (derived.armor); species have none in 3a. */
  armor: number;
  /** A ground mover: its impulse is made horizontal. */
  ground: boolean; grabbable: boolean;
  /** Species: the poise meter and the behaviour's poise and stagger resistance. The player: null. */
  poise: PoiseMeter | null; poiseMax: number; staggerResist: number;
  health: number;
}
export interface HitRequestIn {
  attacker: Fighter; target: Fighter; action: ActionState;
  /** The resolved attack of the action. */
  attack: AttackSpec; hitGroupId: string;
  /** The shape origin and the hit point (combat-shapes.ts). */
  origin: Vec3; point: Vec3;
  /** Crossing and obstruction passed (spec §5.11). */
  geometryOk: boolean;
}
export interface CombatEvent {
  outcome: HitOutcome; attackerId: ActorId; targetId: ActorId; attackId: string; actionInstanceId: string; point: Vec3;
  /** Damage dealt to the target: HP for a species target, half-hearts for the player. A counter's reflection is in `reflect` (HP). */
  amount: number; unit: 'hp' | 'half-heart'; reflect: number;
  /** Seconds of hit-stop given to both actors. */
  hitStop: number; impulse: Vec3;
  status: 'inked' | null;
  /** The first hit of a grab (a catch), and whether it holds the target. */
  caught: boolean; held: boolean;
  /** A species at 0 HP: the attacker (reflection) or the target. */
  killed: ActorId | null;
  time: number;
}
/** Post-hit invulnerability after damage (D15), the grab size-rule break stagger and the break-free invulnerability. */
export const POST_HIT_INVULNERABLE = .4, BREAK_FREE_STAGGER = .3, BREAK_FREE_INVULNERABLE = .5;
/** Brace multiplies the impulse: blocked × .3, guard broken × .6. */
export const BLOCK_IMPULSE = .3, BROKEN_IMPULSE = .6;
/** A knock is at most KNOCKBACK_CAP × L_t per second (plan decision, review R8): with EXTERNAL_DECAY 6/s it carries the target at most 1.5 of its
 *  body lengths. The spec's J = impulse × L_a × min(m_a, 2 m_t) scales with the attacker, so a big alpha would throw a small player across the map. */
export const KNOCKBACK_CAP = 9;

/** §6.1: by action start time (world time), then attacker id, then target id. */
export function compareRequests(a: HitRequestIn, b: HitRequestIn): number {
  const s = a.action.startedAt - b.action.startedAt;
  if (s !== 0) return s;
  if (a.attacker.id !== b.attacker.id) return a.attacker.id < b.attacker.id ? -1 : 1;
  return a.target.id < b.target.id ? -1 : a.target.id > b.target.id ? 1 : 0;
}
export const ledgerKey = (a: ActionState, hitGroupId: string, targetId: ActorId) => `${a.instanceId}:${hitGroupId}:${targetId}`;
/** The distinct targets an action has hit (its ledger). */
export function targetsHit(a: ActionState): Set<ActorId> {
  const out = new Set<ActorId>();
  for (const key of a.hitCounts.keys()) out.add(key.slice(key.lastIndexOf(':') + 1));
  return out;
}
function record(a: ActionState, key: string, now: number) { a.hitCounts.set(key, (a.hitCounts.get(key) ?? 0) + 1); a.lastHitAt.set(key, now); }
/** A guard counts only while its action is active (a Brace in its startup or recovery does not block). */
const guardAction = (rt: CombatRuntime, kind: 'brace' | 'counter') => rt.actions.find(a => a.phase === 'active' && a.resolved.guard?.kind === kind);
/** Review R5 (amends spec §6.3): a Counter whose window is open when a parryable action enters `active` is armed against that action. The
 *  caller (combat world) calls this for each possible target on the tick the attacker's action enters active. */
export function armCounters(a: ActionState, target: CombatRuntime): void {
  if (!a.resolved.attack?.parryable) return;
  const counter = guardAction(target, 'counter');
  if (counter && !(counter.armedAgainst ??= []).includes(a.instanceId)) counter.armedAgainst.push(a.instanceId);
}
/** The Counter that answers a contact of `a`: an open one, else one (not ended) that was armed against `a` at its active start. */
const counterFor = (rt: CombatRuntime, a: ActionState) => guardAction(rt, 'counter')
  ?? rt.actions.find(c => c.phase !== 'interrupted' && c.resolved.guard?.kind === 'counter' && !c.countered && c.armedAgainst?.includes(a.instanceId));
const dashing = (rt: CombatRuntime) => rt.actions.some(a => a.phase === 'active' && a.resolved.evasion);
const unit = (v: Vec3): Vec3 => { const l = Math.hypot(v.x, v.y, v.z); return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: 0 }; };
function inFront(target: Fighter, origin: Vec3, halfAngle: number): boolean {
  const d = unit({ x: origin.x - target.centre.x, y: origin.y - target.centre.y, z: origin.z - target.centre.z }), f = unit(target.forward);
  return Math.acos(Math.max(-1, Math.min(1, d.x * f.x + d.y * f.y + d.z * f.z))) <= halfAngle + 1e-9;
}
const event = (r: HitRequestIn, outcome: HitOutcome, now: number, over: Partial<CombatEvent> = {}): CombatEvent => ({ outcome, attackerId: r.attacker.id, targetId: r.target.id, attackId: r.attack.id,
  actionInstanceId: r.action.instanceId, point: r.point, amount: 0, unit: r.target.isPlayer ? 'half-heart' : 'hp', reflect: 0, hitStop: 0, impulse: { x: 0, y: 0, z: 0 }, status: null,
  caught: false, held: false, killed: null, time: now, ...over });

/** Resolves one hit request (spec §6.2). Null: dropped at validity, with no ledger entry. `statusOf` gives an attack's status effect. */
export function resolveHit(r: HitRequestIn, now: number, statusOf: (id: string) => { seconds: number; speedFactor: number } | null = () => null): CombatEvent | null {
  const { attacker, target, action, attack } = r, key = ledgerKey(action, r.hitGroupId, target.id);
  // 1. Validity.
  if (!target.rt.targetable || target.id === attacker.id || !r.geometryOk) return null;
  if ((action.hitCounts.get(key) ?? 0) >= attack.maxHitsPerTarget || now - (action.lastHitAt.get(key) ?? -Infinity) < attack.repeatHitSeconds - 1e-9) return null;
  const hit = targetsHit(action);
  if (!hit.has(target.id) && hit.size >= attack.maxTargets) return null;
  // 2. Guard and counter.
  const counter = attack.parryable ? counterFor(target.rt, action) : undefined;
  if (counter) {
    const g = counter.resolved.guard!, reflect = g.reflectDamage;
    counter.countered = true; endNow(target.rt, counter);
    attacker.health -= reflect;
    stagger(attacker.rt, g.attackerStaggerSeconds, true);
    record(action, key, now);
    const stop = hitStopFor('countered', { targetIsPlayer: target.isPlayer, amount: 0 });
    applyHitStop(attacker.rt, now, stop); applyHitStop(target.rt, now, stop);
    return event(r, 'countered', now, { reflect, hitStop: stop, killed: !attacker.isPlayer && attacker.health <= 0 ? attacker.id : null });
  }
  let guard: 'blocked' | 'guard-broken' | null = null, blockFraction = 0;
  const brace = guardAction(target.rt, 'brace');
  if (brace && attack.blockable && inFront(target, r.origin, brace.resolved.guard!.frontHalfAngle ?? 0)) {
    const g = brace.resolved.guard!;
    blockFraction = g.blockFraction;
    guard = g.breakHalfHearts !== null && damageAfterArmor(attack.damage, target.armor) >= g.breakHalfHearts ? 'guard-broken' : 'blocked';
    if (guard === 'guard-broken') { endNow(target.rt, brace, g.brokenCooldownSeconds); stagger(target.rt, g.breakStaggerSeconds); }
  }
  // 3. Immunity (a blocked hit goes on to damage).
  if (!guard && (!target.rt.damageable || now < target.rt.invulnerableUntil || dashing(target.rt))) {
    record(action, key, now);
    return event(r, dashing(target.rt) ? 'evaded' : 'immune', now);
  }
  // 4. Damage.
  const catchHold = attack.hold && !guard ? attack.hold : null;
  let amount: number;
  if (target.isPlayer) {
    const raw = catchHold && attack.damageUnit === 'half-heart' ? catchHold.startHalfHearts : attack.damage, hh = damageAfterArmor(raw, target.armor);
    amount = guard === 'blocked' ? Math.floor(hh * (1 - blockFraction)) : guard === 'guard-broken' ? Math.floor(hh * (1 - blockFraction / 2)) : hh;
    target.health -= amount / 2;
    if (amount > 0) { target.rt.invulnerableUntil = now + POST_HIT_INVULNERABLE; target.rt.lastDamageAt = now; }
  } else { amount = attack.damage; target.health -= amount; }
  action.connected = true;
  // 6 (grab). A catch: held when the target fits and is grabbable, else it breaks free at once (spec §6.6).
  if (catchHold) {
    record(action, key, now);
    const fits = target.L <= catchHold.sizeFactor * attacker.L + 1e-9 && target.grabbable && target.rt.heldBy === null && target.health > 0;
    if (fits) {
      action.heldTarget = target.id; target.rt.heldBy = attacker.id; target.rt.breakProgress = 0;
      for (const a of target.rt.actions) if (interruptible(a)) endNow(target.rt, a);
    } else stagger(target.rt, BREAK_FREE_STAGGER);
    const stop = hitStopFor('grabbed', { targetIsPlayer: target.isPlayer, amount });
    applyHitStop(attacker.rt, now, stop); applyHitStop(target.rt, now, stop);
    return event(r, fits ? 'grabbed' : 'hit', now, { amount, hitStop: stop, caught: true, held: fits, killed: !target.isPlayer && target.health <= 0 ? target.id : null });
  }
  // 5. Stagger (not when blocked).
  if (guard !== 'blocked') {
    if (target.isPlayer) { if (attack.staggerSeconds > 0) stagger(target.rt, attack.staggerSeconds); }
    else if (target.poise && addPoise(target.poise, amount * attack.poiseDamageMultiplier, target.rt.actionClock, target.poiseMax)) stagger(target.rt, attack.staggerSeconds * (1 - target.staggerResist));
  }
  // 6. Impulse: J = impulse × L_a × min(m_a, 2 m_t) along origin → point (horizontal for ground targets); Δv = J / m_t × (1 − kr).
  let dir = { x: r.point.x - r.origin.x, y: target.ground ? 0 : r.point.y - r.origin.y, z: r.point.z - r.origin.z };
  dir = unit(dir);
  // The knock after resistance is capped at KNOCKBACK_CAP × L_t; the guard then scales the capped knock.
  const J = attack.impulse * attacker.L * Math.min(attacker.mass, 2 * target.mass);
  const k = Math.min(KNOCKBACK_CAP * target.L, J / target.mass * (1 - target.knockbackResistance)) * (guard === 'blocked' ? BLOCK_IMPULSE : guard === 'guard-broken' ? BROKEN_IMPULSE : 1);
  const impulse = { x: dir.x * k, y: dir.y * k, z: dir.z * k };
  target.rt.externalVelocity.x += impulse.x; target.rt.externalVelocity.y += impulse.y; target.rt.externalVelocity.z += impulse.z;
  // Status (ink): not when blocked.
  let status: CombatEvent['status'] = null;
  const s = attack.statusEffectId && guard !== 'blocked' ? statusOf(attack.statusEffectId) : null;
  if (s) { target.rt.status = { id: 'inked', until: now + s.seconds, speedFactor: s.speedFactor }; status = 'inked'; }
  // 7. Ledger and event.
  record(action, key, now);
  const outcome: HitOutcome = guard ?? 'hit', stop = hitStopFor(outcome, { targetIsPlayer: target.isPlayer, amount });
  applyHitStop(attacker.rt, now, stop); applyHitStop(target.rt, now, stop);
  return event(r, outcome, now, { amount, hitStop: stop, impulse, status, killed: !target.isPlayer && target.health <= 0 ? target.id : null });
}
/** Resolves every request in the contract order; one accepted event can make a later one immune. */
export function resolveAll(requests: HitRequestIn[], now: number, statusOf?: (id: string) => { seconds: number; speedFactor: number } | null): CombatEvent[] {
  const out: CombatEvent[] = [];
  for (const r of [...requests].sort(compareRequests)) { const e = resolveHit(r, now, statusOf); if (e) out.push(e); }
  return out;
}

// ---- grabs (spec §6.6) ----
export const BREAK_BASIC = .25, BREAK_DASH = .35, BREAK_FLICK = .2, FLICK_LENGTH = .6;
/** A move-stick flick: the stick turns more than 90° with length > .6 (both readings). */
export function isFlick(prev: Vec3, cur: Vec3): boolean {
  const a = Math.hypot(prev.x, prev.z), b = Math.hypot(cur.x, cur.z);
  return a > FLICK_LENGTH && b > FLICK_LENGTH && (prev.x * cur.x + prev.z * cur.z) / (a * b) < 0;
}
/** Adds break-free progress for this tick's inputs. True when it reached 1. */
export function addBreakProgress(rt: CombatRuntime, input: { basicPressed: boolean; dashPressed: boolean; flick: boolean }): boolean {
  rt.breakProgress += (input.basicPressed ? BREAK_BASIC : 0) + (input.dashPressed ? BREAK_DASH : 0) + (input.flick ? BREAK_FLICK : 0);
  return rt.breakProgress >= 1 - 1e-9;
}
/** Ends a hold: the grabber's action goes to recovery and the target is free; a player that broke free gets .5 s of world-time invulnerability. */
export function releaseHold(grabber: CombatRuntime, a: ActionState, target: CombatRuntime, now: number, brokeFree: boolean): void {
  endHold(grabber, a); target.heldBy = null; target.breakProgress = 0;
  if (brokeFree) target.invulnerableUntil = Math.max(target.invulnerableUntil, now + BREAK_FREE_INVULNERABLE);
}
/** Squeezes due in a hold on the grabber's clock: one every `squeezeEverySeconds` of hold. Counts them on the action and returns how many are new. */
export function squeezesDue(a: ActionState, tau: number): number {
  const h = a.resolved.attack?.hold;
  if (a.phase !== 'hold' || !h || h.squeezeHalfHearts <= 0 || h.squeezeEverySeconds <= 0) return 0;
  const due = Math.floor((tau - a.phaseStartedAt) / h.squeezeEverySeconds + 1e-9), fresh = Math.max(0, due - a.squeezes);
  a.squeezes = Math.max(a.squeezes, due);
  return fresh;
}
