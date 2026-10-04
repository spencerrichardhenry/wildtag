// The action engine (spec §5): one set of rules for the player and every combat species. Action clocks and hit-stop, phase timelines,
// start rules, aim tracking and lock, hold moves, cancel and interrupt, the input buffer, stagger and poise. Pure: it mutates only the
// runtime and the actions it is given, and never moves a body (motion goes through resolveMotion in the callers).
import type { ActionState, ActiveSlot, ActorId, CombatRuntime, EmitterSource, MovementMode, MutVec3, ResolvedMove, Vec3 } from './combat-types';

/** The input buffer window (spec §5.7): a press in the last BUFFER_SECONDS of a recovery or in a hit-stop is kept this long. */
export const BUFFER_SECONDS = .12;
/** A species' poise meter decays by this much per second of its action clock (spec §5.8). */
export const POISE_DECAY = 4;

/** §5.1: the clock advances by clamp((t + dt) − max(t, hitStopUntil), 0, dt). Returns Δτ. */
export function advanceClock(rt: CombatRuntime, t: number, dt: number): number {
  const d = Math.max(0, Math.min(dt, t + dt - Math.max(t, rt.hitStopUntil)));
  rt.actionClock += d;
  return d;
}
/** §5.9: overlapping hit-stops keep the later end. */
export function applyHitStop(rt: CombatRuntime, now: number, seconds: number): void { if (seconds > 0) rt.hitStopUntil = Math.max(rt.hitStopUntil, now + seconds); }

// ---- phase lengths (spec §5.2) ----
export function windupLength(a: ActionState): number {
  const r = a.resolved;
  return (r.attack ? r.attack.windupSeconds : r.guard ? r.guard.startupSeconds : r.evasion?.startupSeconds ?? 0) + a.windupExtension;
}
const isBrace = (a: ActionState) => a.resolved.guard?.kind === 'brace';
const isCounter = (a: ActionState) => a.resolved.guard?.kind === 'counter';
/** Brace: Infinity while held; after a release (or a release in windup), `minActiveSeconds`. */
export function activeLength(a: ActionState): number {
  const r = a.resolved;
  if (r.attack) return r.attack.activeSeconds;
  if (r.guard) return r.guard.kind === 'counter' ? r.guard.windowSeconds ?? 0 : a.released ? r.guard.minActiveSeconds : Infinity;
  return r.evasion?.travelSeconds ?? 0;
}
export const holdLength = (a: ActionState): number => a.resolved.attack?.hold?.seconds ?? 0;
export function recoveryLength(a: ActionState): number {
  const r = a.resolved;
  if (r.attack) return r.attack.hold && !a.connected ? r.attack.whiffRecoverySeconds ?? r.attack.recoverySeconds : r.attack.recoverySeconds;
  if (r.guard) return r.guard.kind === 'counter' ? (a.countered ? 0 : r.guard.whiffRecoverySeconds) : r.guard.recoverySeconds;
  return r.evasion?.recoverySeconds ?? 0;
}
/** The cooldown that starts when the action ends: a successful Counter's `successCooldownSeconds`, else the move's own. */
export const cooldownLength = (a: ActionState): number => a.countered && a.resolved.guard ? a.resolved.guard.successCooldownSeconds : a.resolved.cooldownSeconds;
/** Seconds of action clock left in the current phase (Infinity for a held Brace). */
export function phaseRemaining(a: ActionState, tau: number): number {
  const elapsed = tau - a.phaseStartedAt;
  switch (a.phase) {
    case 'windup': return windupLength(a) - elapsed;
    case 'active': return activeLength(a) - elapsed;
    case 'hold': return holdLength(a) - elapsed;
    case 'recovery': return recoveryLength(a) - elapsed;
    default: return 0;
  }
}
/** The game time at which an action in its active phase became active (spec §9.4, T11 fix round 1: the director's spacing rule is
 *  defined in game time). `clockTime`: the game time up to which `rt.actionClock` has run (the end of the last tick). Exact while no
 *  hit-stop froze the clock since the active start; null outside the active phase. */
export const activeStartedAt = (rt: CombatRuntime, a: ActionState, clockTime: number): number | null =>
  a.phase === 'active' ? clockTime - (rt.actionClock - a.phaseStartedAt) : null;
/** The action-clock time at which the action becomes active, from now (for the director and telegraph fill). */
export const activeStartsIn = (a: ActionState, tau: number): number => a.phase === 'windup' ? Math.max(0, windupLength(a) - (tau - a.phaseStartedAt)) : 0;

// ---- start (spec §5.3, §5.6) ----
export type StartRefusal = 'not-playing' | 'staggered' | 'held' | 'hit-stop' | 'busy' | 'cooldown' | 'mode' | 'token';
export interface StartCheck {
  /** Rule 1: the game mode is `playing` (player) or the entity is active. */
  playing: boolean; isPlayer: boolean; kind: ResolvedMove['kind']; cooldownKey: string;
  mode: MovementMode; allowedModes: readonly MovementMode[]; inBreachArc: boolean;
  /** Rule 7: a species attack that targets the player has a token (always true otherwise). */
  token: boolean; worldNow: number;
}
/** The actions that have not ended. */
export const liveActions = (rt: CombatRuntime): ActionState[] => rt.actions.filter(a => a.phase !== 'interrupted');
/** `replaces`: an action to end first (a recovery the Dash cancels, or a grab hold that another move releases). */
export type StartDecision = { ok: true; replaces: ActionState | null } | { ok: false; reason: StartRefusal };
/** D11: the player's moves that cancel its own Bite or Sweep recovery. */
export const RECOVERY_CANCELS: ReadonlySet<string> = new Set(['dash', 'brace', 'counter']);
export function canStart(rt: CombatRuntime, c: StartCheck): StartDecision {
  if (!c.playing) return { ok: false, reason: 'not-playing' };
  if (rt.actionClock < rt.staggerUntil) return { ok: false, reason: 'staggered' };
  if (rt.heldBy !== null && !(c.isPlayer && c.kind === 'bite')) return { ok: false, reason: 'held' };
  if (c.worldNow < rt.hitStopUntil) return { ok: false, reason: 'hit-stop' };
  const live = liveActions(rt);
  let replaces: ActionState | null = null;
  if (live.length) {
    const hold = live.find(a => a.phase === 'hold');
    if (hold && live.length === 1) { if (c.kind !== 'bite') replaces = hold; }   // the grabber may Bite during the hold; any other move ends it
    // D11 (extended, follow-up fix round 1): a Dash, Brace or Counter cancels the player's own Bite or Sweep recovery.
    else if (c.isPlayer && RECOVERY_CANCELS.has(c.kind) && live.length === 1 && live[0]!.phase === 'recovery' && (live[0]!.resolved.kind === 'bite' || live[0]!.resolved.kind === 'sweep')) replaces = live[0]!;
    else return { ok: false, reason: 'busy' };
  }
  if ((rt.cooldowns.get(c.cooldownKey) ?? -Infinity) > rt.actionClock + 1e-9) return { ok: false, reason: 'cooldown' };
  if (!c.allowedModes.includes(c.mode) || (c.kind === 'dash' && c.inBreachArc)) return { ok: false, reason: 'mode' };
  if (!c.token) return { ok: false, reason: 'token' };
  return { ok: true, replaces };
}
export interface StartSpec { instanceId: string; definitionId: string; grantId: string; source: EmitterSource; resolved: ResolvedMove; aim: Vec3; targetId: ActorId | null; cooldownKey: string; worldNow: number }
/** Starts an action at the actor's clock. `fixed-at-start` and `centre` lock at once (spec §5.4). */
export function startAction(rt: CombatRuntime, s: StartSpec): ActionState {
  const mode = s.resolved.attack?.aimMode, l = Math.hypot(s.aim.x, s.aim.y, s.aim.z) || 1;
  const a: ActionState = { instanceId: s.instanceId, definitionId: s.definitionId, grantId: s.grantId, source: s.source, phase: 'windup', startedAt: s.worldNow,
    aim: { x: s.aim.x / l, y: s.aim.y / l, z: s.aim.z / l }, committedPose: null, hitCounts: new Map(), lastHitAt: new Map(), phaseStartedAt: rt.actionClock,
    aimLocked: mode === 'fixed-at-start' || mode === 'centre', resolved: s.resolved, targetId: s.targetId, heldTarget: null, windupExtension: 0, released: false, countered: false,
    connected: false, lungeDone: 0, lockedShapes: null, squeezes: 0, cooldownKey: s.cooldownKey };
  rt.actions.push(a);
  return a;
}
/** Ends an action now: it is interrupted, and its cooldown starts at this clock time (`cooldown` overrides the length). */
export function endNow(rt: CombatRuntime, a: ActionState, cooldown = cooldownLength(a)): void {
  if (a.phase === 'interrupted') return;
  a.phase = 'interrupted'; a.phaseStartedAt = rt.actionClock;
  rt.cooldowns.set(a.cooldownKey, Math.max(rt.cooldowns.get(a.cooldownKey) ?? -Infinity, rt.actionClock + cooldown));
  if (a.resolved.guard?.kind === 'brace') rt.guardProfileId = null;
}
/** Removes interrupted actions at the end of a tick; returns them (their tokens go back to the director). */
export function sweepEnded(rt: CombatRuntime): ActionState[] {
  const ended = rt.actions.filter(a => a.phase === 'interrupted');
  if (ended.length) rt.actions = rt.actions.filter(a => a.phase !== 'interrupted');
  return ended;
}
/** A hold ends (break-free, a blocked grab motion, a stagger): the grabber goes to recovery now. A catch in the active phase (before the
 *  hold phase starts) ends the same way. Returns the released target id. */
export function endHold(rt: CombatRuntime, a: ActionState): ActorId | null {
  if (a.phase !== 'hold' && !(a.phase === 'active' && a.heldTarget !== null)) return null;
  const target = a.heldTarget; a.heldTarget = null; a.phase = 'recovery'; a.phaseStartedAt = rt.actionClock;
  return target;
}
/** The action of `rt` that holds `who` (a catch in active, or the hold phase). */
export const holdingAction = (rt: CombatRuntime, who: ActorId): ActionState | undefined => rt.actions.find(a => (a.phase === 'hold' || a.phase === 'active') && a.heldTarget === who);

// ---- tick (spec §5.2, §5.4, §5.5) ----
/** Turns `aim` toward `wanted` on the great circle by at most `maxAngle` radians. */
export function turnToward(aim: MutVec3, wanted: Vec3, maxAngle: number): void {
  const wl = Math.hypot(wanted.x, wanted.y, wanted.z); if (wl < 1e-9) return;
  const w = { x: wanted.x / wl, y: wanted.y / wl, z: wanted.z / wl }, c = Math.max(-1, Math.min(1, aim.x * w.x + aim.y * w.y + aim.z * w.z)), angle = Math.acos(c);
  if (angle <= maxAngle + 1e-12) { aim.x = w.x; aim.y = w.y; aim.z = w.z; return; }
  // The unit vector in the plane of aim and w, orthogonal to aim (a fixed perpendicular when w is opposite).
  let px = w.x - aim.x * c, py = w.y - aim.y * c, pz = w.z - aim.z * c, pl = Math.hypot(px, py, pz);
  if (pl < 1e-9) { px = -aim.z; py = 0; pz = aim.x; pl = Math.hypot(px, py, pz) || 1; if (pl < 1e-9) { px = 1; py = 0; pz = 0; pl = 1; } }
  const s = Math.sin(maxAngle), k = Math.cos(maxAngle);
  const x = aim.x * k + px / pl * s, y = aim.y * k + py / pl * s, z = aim.z * k + pz / pl * s, l = Math.hypot(x, y, z);
  aim.x = x / l; aim.y = y / l; aim.z = z / l;
}
export interface ActionInput {
  /** The wanted aim: the input aim (player), the direction to the target (species), or null to keep the aim. */
  wantedAim: Vec3 | null;
  /** Brace: the input is held. */
  held: boolean;
  /** The body's horizontal forward ('body-back' aims at its reverse). */
  bodyForward: Vec3;
}
export interface TickResult {
  /** The action was in its active phase at some point in this tick (hits are tested). */
  wasActive: boolean;
  /** The aim locked in this tick: the caller samples the pose once and fixes the world shapes. */
  locked: boolean; enteredActive: boolean; enteredHold: boolean; enteredRecovery: boolean;
  /** The action ended in this tick (its cooldown is set). */
  ended: boolean;
  /** The hold ended at `hold.seconds` in this tick: the target is released. */
  releasedTarget: ActorId | null;
}
/** Advances one action by the actor's Δτ (rt.actionClock is already advanced). Phase changes land at their exact clock times. */
export function tickAction(rt: CombatRuntime, a: ActionState, dTau: number, input: ActionInput): TickResult {
  const out: TickResult = { wasActive: a.phase === 'active', locked: false, enteredActive: false, enteredHold: false, enteredRecovery: false, ended: false, releasedTarget: null };
  if (a.phase === 'interrupted') return out;
  const tau = rt.actionClock, before = tau - dTau, attack = a.resolved.attack;
  // Brace (spec §5.5): a release (or a touch cancel) ends active at once when min active has passed, else at min active.
  if (isBrace(a) && !input.held && !a.released) {
    a.released = true;
    if (a.phase === 'active' && tau - a.phaseStartedAt >= a.resolved.guard!.minActiveSeconds - 1e-9) { a.phase = 'recovery'; a.phaseStartedAt = tau; rt.guardProfileId = null; out.enteredRecovery = true; }
  }
  for (let guard = 0; guard < 6; guard++) {
    const elapsed = tau - a.phaseStartedAt;
    if (a.phase === 'windup') {
      if (!a.aimLocked && attack) {
        const lockAt = attack.aimLockAtSeconds, from = Math.max(0, before - a.phaseStartedAt), until = Math.min(elapsed, lockAt);
        const wanted = attack.aimMode === 'body-back' ? { x: -input.bodyForward.x, y: 0, z: -input.bodyForward.z } : input.wantedAim;
        if (wanted && until > from) turnToward(a.aim, wanted, attack.maxTrackingRadiansPerSecond * (until - from));
        if (elapsed >= lockAt - 1e-9) { a.aimLocked = true; out.locked = true; }
      }
      const len = windupLength(a);
      if (elapsed < len - 1e-9) break;
      a.phase = 'active'; a.phaseStartedAt += len; out.enteredActive = true; out.wasActive = true;
      if (isBrace(a)) rt.guardProfileId = a.resolved.guard!.id;   // a Brace guards only while active, not in its startup
      if (!a.aimLocked) { a.aimLocked = true; out.locked = true; }
      continue;
    }
    if (a.phase === 'active') {
      if (isCounter(a) && a.countered) { endNow(rt, a); out.ended = true; break; }
      const len = activeLength(a);
      if (elapsed < len - 1e-9) break;
      const next = a.heldTarget !== null && attack?.hold ? 'hold' : 'recovery';
      a.phase = next; a.phaseStartedAt += len;
      if (next === 'hold') out.enteredHold = true; else out.enteredRecovery = true;
      if (isBrace(a)) rt.guardProfileId = null;
      continue;
    }
    if (a.phase === 'hold') {
      const len = holdLength(a);
      if (elapsed < len - 1e-9) break;
      out.releasedTarget = a.heldTarget; a.heldTarget = null; a.phase = 'recovery'; a.phaseStartedAt += len; out.enteredRecovery = true;
      continue;
    }
    if (a.phase === 'recovery') {
      const len = recoveryLength(a);
      if (elapsed < len - 1e-9) break;
      const end = a.phaseStartedAt + len;
      rt.cooldowns.set(a.cooldownKey, Math.max(rt.cooldowns.get(a.cooldownKey) ?? -Infinity, end + cooldownLength(a)));
      a.phase = 'interrupted'; a.phaseStartedAt = end; out.ended = true;
      break;
    }
    break;
  }
  return out;
}

// ---- stagger, interrupt and poise (spec §5.6, §5.8) ----
/** Brace, Counter and Dash are not interruptible; an attack only when `interruptible`, in windup or active (a lunge in windup only). */
export function interruptible(a: ActionState): boolean {
  const attack = a.resolved.attack;
  if (!attack || !attack.interruptible) return false;
  return a.phase === 'windup' || (a.phase === 'active' && !attack.lunge);
}
export interface StaggerResult { interrupted: ActionState[]; releasedTargets: ActorId[] }
/** Staggers for `seconds` of action clock. Interrupts what may be interrupted (`force`: everything, a counter); ends a grab hold. */
export function stagger(rt: CombatRuntime, seconds: number, force = false): StaggerResult {
  const out: StaggerResult = { interrupted: [], releasedTargets: [] };
  rt.staggerUntil = Math.max(rt.staggerUntil, rt.actionClock + seconds);
  for (const a of rt.actions) {
    if (a.phase === 'interrupted') continue;
    if (a.phase === 'hold' || (a.phase === 'active' && a.heldTarget !== null)) { const t = endHold(rt, a); if (t !== null) out.releasedTargets.push(t); if (force) { endNow(rt, a); out.interrupted.push(a); } continue; }
    if (force ? a.phase === 'windup' || a.phase === 'active' : interruptible(a)) { endNow(rt, a); out.interrupted.push(a); }
  }
  return out;
}
export interface PoiseMeter { value: number; at: number }
export const newPoise = (): PoiseMeter => ({ value: 0, at: 0 });
/** Adds `amount` after the decay since the last hit (action clock). True when the meter reached `max`: it goes to 0 (the caller staggers). */
export function addPoise(m: PoiseMeter, amount: number, tau: number, max: number): boolean {
  m.value = Math.max(0, m.value - POISE_DECAY * Math.max(0, tau - m.at)) + amount; m.at = tau;
  if (m.value + 1e-9 < max) return false;
  m.value = 0; return true;
}

// ---- input buffer (spec §5.7) ----
/** Keeps a press that failed only because the actor is busy: in the last BUFFER_SECONDS of a recovery, or during a hit-stop. One entry; a newer press replaces it. */
export function bufferPress(rt: CombatRuntime, input: 'basic' | ActiveSlot, worldNow: number): boolean {
  const recovering = rt.actions.some(a => a.phase === 'recovery' && phaseRemaining(a, rt.actionClock) <= BUFFER_SECONDS + 1e-9);
  if (!recovering && worldNow >= rt.hitStopUntil) return false;
  rt.buffered = { input, at: rt.actionClock };
  return true;
}
/** The buffered press while it is fresh (at most BUFFER_SECONDS of action clock old), else null (and the entry is dropped). */
export function bufferedPress(rt: CombatRuntime): 'basic' | ActiveSlot | null {
  const b = rt.buffered; if (!b) return null;
  if (rt.actionClock - b.at > BUFFER_SECONDS + 1e-9) { rt.buffered = null; return null; }
  return b.input;
}
/** Spec §5.7: the buffer is cleared when the game pauses. The game calls it through simSuspend on pause, help and edit (T9). */
export function clearBuffer(rt: CombatRuntime): void { rt.buffered = null; }
/** Velocity (physical units per second) of a lunge during active: distance × L / activeSeconds along the aim. */
export function lungeSpeed(a: ActionState, L: number): number {
  const at = a.resolved.attack; return at?.lunge && at.activeSeconds > 0 ? at.lunge.distanceBodyLengths * L / at.activeSeconds : 0;
}
/** Speed of a dash during active: distance × L / travelSeconds. */
export function dashSpeed(a: ActionState, L: number): number {
  const e = a.resolved.evasion; return e && e.travelSeconds > 0 ? e.distanceBodyLengths * L / e.travelSeconds : 0;
}
