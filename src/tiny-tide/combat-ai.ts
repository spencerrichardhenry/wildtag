// Combat AI (spec §11.2): one state machine per behaviour type. Each tick it returns a move intent and may ask for an attack; the ecosystem
// moves the entity by the intent through resolveMotion and the combat world starts the attack (with a director token at the player).
// Pure: the RNG is seeded per entity from (run seed, entity id); every time is world time.
import { random } from './biomes';
import { BURROW, LAPS, type AttackChoice, type BehaviourPhase, type SpeciesBehaviour } from './bestiary';
import type { Vec3 } from './combat-types';

export type MoveIntent =
  | { kind: 'ambient'; speedFactor: number }
  | { kind: 'toward'; point: Vec3; speedFactor: number }
  | { kind: 'away'; point: Vec3; speedFactor: number }
  | { kind: 'hold' };
export type AiStateName = 'idle' | 'flee' | 'rest' | 'face' | 'attack' | 'back-off' | 'notice' | 'approach' | 'reposition' | 'return'
  | 'den' | 'ambush' | 'out' | 'retreat' | 'roar' | 'sink' | 'burrowed' | 'emerge' | 'lap' | 'lap-rest' | 'reset' | 'held' | 'staggered';
export interface AiState {
  name: AiStateName;
  /** World time the state began. */
  since: number;
  rng: () => number;
  /** prey-fighter: where the fight started; hunter-ambush: the den; alpha: the lair centre. */
  home: Vec3 | null;
  /** No new attack before this (the gap after an action). */
  gapUntil: number;
  /** A refused token retries at this time. */
  retryAt: number;
  until: number; strafe: 1 | -1;
  /** hunter-ambush: out of the den until this (den.outSeconds after its last landed hit). */
  outUntil: number;
  /** prey-flee/school: the player has been near since; prey-fighter: the player has been in the trigger radius since. */
  nearSince: number | null;
  fleeDir: Vec3 | null;
  /** A started choice: its chain follows when the action ends. */
  current: AttackChoice | null;
  /** `expires`: a chain that is refused until then is dropped (the hunter repositions). */
  chain: { attackId: string; at: number; expires: number } | null;
  /** hunter engagements (the survivor bonus, spec §10.4). */
  engagedSince: number | null; windups: number;
  /** alpha */
  phase: number; outsideSince: number | null; emerges: number; charges: number; lapAngle: number;
}
export const newAiState = (runSeed: number, entityId: number, now = 0): AiState => ({ name: 'idle', since: now, rng: random((runSeed ^ Math.imul(entityId + 1, 0x9e3779b1)) >>> 0),
  home: null, gapUntil: 0, retryAt: 0, until: 0, strafe: 1, outUntil: 0, nearSince: null, fleeDir: null, current: null, chain: null, engagedSince: null, windups: 0,
  phase: 0, outsideSince: null, emerges: 0, charges: 0, lapAngle: 0 });

/** What the AI sees this tick (positions: physical; `d`: the distance from the entity's centre to the nearest player hurtbox, minus its hull
 *  radius, in its body lengths L). */
export interface AiInput {
  now: number;
  /** `speed`: the species' top speed (physical units per second). */
  self: { position: Vec3; L: number; forward: Vec3; hp: number; maxHp: number; staggered: boolean; held: boolean; busy: boolean; speed: number };
  player: { position: Vec3; d: number; visible: boolean; targetable: boolean };
  /** The species is hostile at the player's size (spec §11.1). */
  hostile: boolean;
  /** The ecosystem's pursuit mode (spec §10): `hunt`/`angry` engaged, `return` giving up, `calm` idle. */
  pursuit: 'calm' | 'flee' | 'hunt' | 'angry' | 'return';
  /** The player damaged this entity this tick. */
  hit: boolean;
  /** Today's prey flee distance: 7 × max(size, SIZES[stage]) × stealth (physical units). */
  fleeDistance: number;
  ready(attackId: string): boolean;
  /** prey-school: the centroid of the school. */
  schoolCentre?: Vec3;
  /** The player is inside the alpha's lair disc (radius × L). */
  inLair?: boolean;
  /** The combat world's `EntityCombat.tokenRetryAt` (world time): no attack at the player is asked for before it; a hunter repositions
   *  meanwhile instead of re-asking every tick (controller binding, T11 carry). */
  tokenRetryAt?: number;
}
export interface AttackRequest { attackId: string; aim: Vec3; targetPlayer: boolean }
export interface AiOutput {
  intent: MoveIntent; attack: AttackRequest | null;
  /** The "!" marker (a hunter noticed the player). */
  marker: boolean;
  /** alpha: under the sand (untargetable); healing (fraction of max HP per second); a phase change roar (ring flash, hint toast). */
  untargetable: boolean; heal: number; roar: boolean;
  /** A hunter engagement ended with the player alive (the caller checks the survivor bonus). */
  engagementEnded: { seconds: number; windups: number } | null;
}
const out = (intent: MoveIntent, more: Partial<AiOutput> = {}): AiOutput => ({ intent, attack: null, marker: false, untargetable: false, heal: 0, roar: false, engagementEnded: null, ...more });
const AMBIENT: MoveIntent = { kind: 'ambient', speedFactor: 1 }, HOLD: MoveIntent = { kind: 'hold' };
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const unit = (v: Vec3): Vec3 => { const l = len(v); return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: 1 }; };
const set = (s: AiState, name: AiStateName, now: number) => { s.name = name; s.since = now; };
/** A target outside the disc around `centre` is pulled to its rim (horizontal). */
export function clampToDisc(p: Vec3, centre: Vec3, radius: number): Vec3 {
  const dx = p.x - centre.x, dz = p.z - centre.z, h = Math.hypot(dx, dz);
  return h <= radius ? p : { x: centre.x + dx / h * radius, y: p.y, z: centre.z + dz / h * radius };
}
/** The attack to start (spec §11.2): among the choices whose band holds `d` and whose cooldown is ready, by weight (flankWeight when the player
 *  is more than 40° off the forward). Null when none fits. */
export function chooseAttack(choices: readonly AttackChoice[], d: number, flank: boolean, ready: (id: string) => boolean, rng: () => number): AttackChoice | null {
  const fit = choices.filter(c => d >= c.band[0] && d <= c.band[1] && ready(c.attackId));
  const total = fit.reduce((n, c) => n + (flank ? c.flankWeight ?? c.weight : c.weight), 0);
  if (!fit.length || total <= 0) return null;
  let r = rng() * total;
  for (const c of fit) { r -= flank ? c.flankWeight ?? c.weight : c.weight; if (r <= 0) return c; }
  return fit[fit.length - 1]!;
}
export const FLANK_ANGLE = 40 * Math.PI / 180;
const flanked = (i: AiInput) => { const to = unit(sub(i.player.position, i.self.position)), f = unit(i.self.forward); return Math.acos(Math.max(-1, Math.min(1, to.x * f.x + to.y * f.y + to.z * f.z))) > FLANK_ANGLE; };
const aimAtPlayer = (i: AiInput): Vec3 => unit(sub(i.player.position, i.self.position));
/** The attack the caller should start; `aiStarted` or `aiRefused` reports the answer. */
function request(s: AiState, i: AiInput, choice: AttackChoice | null, attackId: string): AttackRequest {
  s.current = choice; return { attackId, aim: aimAtPlayer(i), targetPlayer: true };
}
/** The combat world started the requested attack. */
export function aiStarted(s: AiState, now: number): void {
  s.windups++; s.chain = null;
  set(s, s.name === 'den' ? 'ambush' : s.name === 'burrowed' ? 'emerge' : 'attack', now);
}
/** The director refused the token (or a start rule): retry after .2 s, or at `retryAt` (the director's `tokenRetryAt`) when that is later.
 *  A hunter that was approaching repositions (strafes by its reposition data) until then; it never re-asks in place every tick. */
export function aiRefused(s: AiState, now: number, retryAt = -Infinity): void {
  s.retryAt = Math.max(now + .2, retryAt); s.chain = s.chain ? { ...s.chain, at: s.retryAt } : null;
  if (s.name === 'approach') { set(s, 'reposition', now); s.until = s.retryAt; s.strafe = s.rng() < .5 ? 1 : -1; }
}
/** The time before which the AI asks for no attack at the player. */
const waitUntil = (s: AiState, i: AiInput) => Math.max(s.retryAt, i.tokenRetryAt ?? -Infinity);

/** One AI tick. */
export function aiStep(b: SpeciesBehaviour, s: AiState, i: AiInput): AiOutput {
  const now = i.now;
  if (i.self.held) { if (s.name !== 'held') set(s, 'held', now); return out(HOLD); }
  if (s.name === 'held') set(s, 'idle', now);
  if (i.self.staggered) return out(HOLD);
  switch (b.type) {
    case 'prey-flee': case 'prey-school': return preyFlee(b, s, i);
    case 'prey-fighter': return preyFighter(b, s, i);
    case 'hunter': return hunter(b, s, i, b.attacks, b.gapSeconds, 1);
    case 'hunter-ambush': return ambusher(b, s, i);
    case 'alpha': return alpha(b, s, i);
  }
}

// ---- prey (spec §11.2 prey-flee, prey-school, prey-fighter) ----
function preyFlee(b: SpeciesBehaviour, s: AiState, i: AiInput): AiOutput {
  const f = b.flee!, now = i.now, near = len(sub(i.player.position, i.self.position)) <= i.fleeDistance && i.player.targetable;
  if (s.name === 'idle') {
    s.nearSince = near ? s.nearSince ?? now : null;
    if (i.hit || (s.nearSince !== null && now - s.nearSince >= b.reactionSeconds - 1e-9)) { startFlee(s, i, now); }
    else return out(AMBIENT);
  }
  if (s.name === 'flee') {
    if (now - s.since >= f.seconds - 1e-9) { set(s, 'rest', now); s.fleeDir = null; }
    else { const dir = s.fleeDir ?? unit(sub(i.self.position, i.player.position)); return out({ kind: 'away', point: { x: i.self.position.x - dir.x, y: i.self.position.y - dir.y, z: i.self.position.z - dir.z }, speedFactor: f.speedFactor }); }
  }
  if (s.name === 'rest') {
    if (now - s.since >= f.restSeconds - 1e-9) { set(s, 'idle', now); s.nearSince = null; return out(AMBIENT); }
    return out(b.type === 'prey-school' && i.schoolCentre ? { kind: 'toward', point: i.schoolCentre, speedFactor: .35 } : { kind: 'ambient', speedFactor: .35 });
  }
  set(s, 'idle', now); return out(AMBIENT);
}
function startFlee(s: AiState, i: AiInput, now: number, dir?: Vec3) { set(s, 'flee', now); s.fleeDir = dir ?? unit(sub(i.self.position, i.player.position)); }
/** prey-school (spec §11.2): when one member enters flee, every member within the school radius that is not resting flees on the same tick, in
 *  one shared direction: away from the player, from the members' centroid. */
export function schoolFlee(members: readonly { state: AiState; position: Vec3; L: number }[], player: Vec3, radiusBodyLengths: number, now: number): void {
  const starters = members.filter(m => m.state.name === 'flee' && m.state.since === now);
  for (const st of starters) {
    const group = members.filter(m => len(sub(m.position, st.position)) <= radiusBodyLengths * m.L && (m.state.name === 'idle' || m === st || (m.state.name === 'flee' && m.state.since === now)));
    const c = group.reduce((a, m) => ({ x: a.x + m.position.x / group.length, y: a.y + m.position.y / group.length, z: a.z + m.position.z / group.length }), { x: 0, y: 0, z: 0 });
    const dir = unit(sub(c, player));
    for (const m of group) { set(m.state, 'flee', now); m.state.fleeDir = dir; }
  }
}
function preyFighter(b: SpeciesBehaviour, s: AiState, i: AiInput): AiOutput {
  const t = b.trigger!, now = i.now, L = i.self.L, choice = b.attacks[0]!;
  const near = i.hostile && i.player.targetable && i.player.d <= t.radiusBodyLengths;
  // It never moves more than .5 L from where it started the fight.
  const leash = (intent: MoveIntent): MoveIntent => s.home && len(sub(i.self.position, s.home)) > .5 * L ? { kind: 'toward', point: s.home, speedFactor: 1 } : intent;
  switch (s.name) {
    case 'idle': {
      s.nearSince = near ? s.nearSince ?? now : null;
      if ((i.hit && i.hostile) || (s.nearSince !== null && now - s.nearSince >= t.seconds - 1e-9)) { set(s, 'face', now); s.home ??= { ...i.self.position }; return out(HOLD); }
      return out(AMBIENT);
    }
    case 'face': {
      if (i.player.d > choice.band[1] || !i.player.targetable) { set(s, 'idle', now); s.nearSince = null; return out(AMBIENT); }
      if (now - s.since < .2 - 1e-9 || now < s.gapUntil || now < waitUntil(s, i) || !i.ready(choice.attackId)) return out(HOLD);
      return out(HOLD, { attack: request(s, i, choice, choice.attackId) });
    }
    case 'attack': {
      if (i.self.busy) return out(HOLD);
      set(s, 'back-off', now); s.gapUntil = now + b.gapSeconds;
      return out(leash({ kind: 'away', point: i.player.position, speedFactor: .5 }));
    }
    case 'back-off': {
      if (now - s.since >= 2 - 1e-9) { set(s, 'idle', now); s.nearSince = null; return out(AMBIENT); }
      return out(leash({ kind: 'away', point: i.player.position, speedFactor: .5 }));
    }
    default: set(s, 'idle', now); return out(AMBIENT);
  }
}

// ---- hunters (spec §11.2 hunter, hunter-ambush) ----
/** One hunter tick with `choices`, `gap` and `speed` (an alpha's phase passes its own). `bound` keeps targets in a disc (an alpha's lair). */
function hunter(b: SpeciesBehaviour, s: AiState, i: AiInput, choices: readonly AttackChoice[], gap: number, speed: number, bound?: (p: Vec3) => Vec3): AiOutput {
  const now = i.now, engaged = i.pursuit === 'hunt' || i.pursuit === 'angry';
  const pull = (p: Vec3) => bound ? bound(p) : p;
  if (!engaged && s.name !== 'idle' && s.name !== 'return' && !(s.name === 'attack' && i.self.busy)) {
    const ended = s.engagedSince !== null ? { seconds: now - s.engagedSince, windups: s.windups } : null;
    s.engagedSince = null; s.windups = 0; s.chain = null; set(s, i.pursuit === 'return' ? 'return' : 'idle', now);
    return out(AMBIENT, { engagementEnded: ended });
  }
  if (s.name === 'idle' || s.name === 'return') {
    if (!engaged) { if (s.name === 'return' && i.pursuit === 'calm') set(s, 'idle', now); return out(AMBIENT); }
    set(s, 'notice', now); s.engagedSince = now; s.windups = 0;
    return out(HOLD, { marker: true });
  }
  // Notice: the pursuit mode comes from the ecosystem's acquisition, which must give line of sight (T16: `visibility()`/`segmentClear`,
  // review I9); the hunter itself does not test it again.
  if (s.name === 'notice') {
    if (now - s.since < b.reactionSeconds - 1e-9) return out(HOLD, { marker: true });
    set(s, 'approach', now);
  }
  if (s.name === 'attack') {
    if (i.self.busy) return out(HOLD);
    const next = s.current?.chainNextId;
    if (next && !s.chain) { const at = now + (s.current?.chainGapSeconds ?? 0); s.chain = { attackId: next, at, expires: at + CHAIN_WAIT_SECONDS }; }
    if (s.chain && now >= s.chain.expires - 1e-9) s.chain = null;   // refused for too long: drop it
    if (s.chain) {
      if (now < s.chain.at || now < waitUntil(s, i)) return out(HOLD);
      s.current = null;
      return out(HOLD, { attack: { attackId: s.chain.attackId, aim: aimAtPlayer(i), targetPlayer: true } });
    }
    s.gapUntil = now + gap; s.current = null; set(s, 'reposition', now);
    s.until = now + b.repositionSeconds[0] + s.rng() * (b.repositionSeconds[1] - b.repositionSeconds[0]); s.strafe = s.rng() < .5 ? 1 : -1;
  }
  if (s.name === 'reposition') {
    if (now < s.until) return out(strafe(b, s, i, pull));
    set(s, 'approach', now);
  }
  if (s.name !== 'approach') set(s, 'approach', now);
  const chase: MoveIntent = { kind: 'toward', point: pull(i.player.position), speedFactor: speed * (i.pursuit === 'angry' ? 1.15 : 1) };
  if (now >= s.gapUntil && i.player.targetable) {
    const wait = waitUntil(s, i);
    // Waiting on a token with the player in reach: reposition until the retry time instead of pressing in and re-asking.
    if (now < wait) {
      if (i.player.d <= Math.max(0, ...choices.map(c => c.band[1]))) { set(s, 'reposition', now); s.until = wait; s.strafe = s.rng() < .5 ? 1 : -1; return out(strafe(b, s, i, pull)); }
      return out(chase);
    }
    const c = chooseAttack(choices, i.player.d, flanked(i), i.ready, s.rng);
    if (c) return out(chase, { attack: request(s, i, c, c.attackId) });
  }
  return out(chase);
}
/** A refused chain is dropped after this wait (fix round 1, M-b). */
const CHAIN_WAIT_SECONDS = 1;
/** Strafe around the player at `repositionSpeedFactor`, keeping d in [.4, .9] L. */
function strafe(b: SpeciesBehaviour, s: AiState, i: AiInput, pull: (p: Vec3) => Vec3): MoveIntent {
  const p = i.player.position, from = sub(i.self.position, p), h = Math.hypot(from.x, from.z) || 1, a = Math.atan2(from.x, from.z) + s.strafe * .6;
  const r = h + (Math.max(.4, Math.min(.9, i.player.d)) - i.player.d) * i.self.L;
  return { kind: 'toward', point: pull({ x: p.x + Math.sin(a) * r, y: i.self.position.y, z: p.z + Math.cos(a) * r }), speedFactor: b.repositionSpeedFactor };
}
function ambusher(b: SpeciesBehaviour, s: AiState, i: AiInput): AiOutput {
  const den = b.den!, now = i.now;
  s.home ??= { ...i.self.position };
  switch (s.name) {
    case 'idle': case 'den': {
      if (s.name !== 'den') set(s, 'den', now);
      const close = len(sub(i.player.position, s.home)) <= den.triggerBodyLengths * i.self.L + i.self.L * .5;
      if (close && i.player.visible && i.player.targetable && i.hostile && now >= waitUntil(s, i) && i.ready(den.attackId)) { s.engagedSince = now; s.windups = 0; return out(HOLD, { attack: request(s, i, null, den.attackId) }); }
      return out(HOLD);
    }
    case 'ambush': {
      if (i.self.busy) return out(HOLD);
      set(s, 'out', now); s.outUntil = now + den.outSeconds; s.gapUntil = now + b.gapSeconds;
      return out({ kind: 'toward', point: i.player.position, speedFactor: 1 });
    }
    case 'retreat': {
      if (len(sub(i.self.position, s.home)) <= .3 * i.self.L) { set(s, 'den', now); const ended = s.engagedSince !== null ? { seconds: now - s.engagedSince, windups: s.windups } : null; s.engagedSince = null; return out(HOLD, { engagementEnded: ended }); }
      return out({ kind: 'toward', point: s.home, speedFactor: 1 });
    }
    default: {
      // out: as a hunter for den.outSeconds after its last hit lands (the caller moves `until` on a landed hit), then back to the den.
      if (s.name === 'out') set(s, 'approach', now);
      // The pursuit policy (review R12: leash, give-up, the 6 s give-up after a faint) ends the outing: back to the den.
      const giveUp = i.pursuit === 'return' || i.pursuit === 'calm';
      if (giveUp && !i.self.busy && s.name !== 'attack') { set(s, 'retreat', now); s.chain = null; s.current = null; return out({ kind: 'toward', point: s.home, speedFactor: 1 }); }
      if (now >= s.outUntil && !i.self.busy && (s.name === 'approach' || s.name === 'reposition')) { set(s, 'retreat', now); return out({ kind: 'toward', point: s.home, speedFactor: 1 }); }
      return hunter(b, s, { ...i, pursuit: 'hunt' }, b.attacks, b.gapSeconds, 1);
    }
  }
}
/** An eel's landed hit keeps it out for another den.outSeconds. */
export function aiLandedHit(b: SpeciesBehaviour, s: AiState, now: number): void { if (b.den) s.outUntil = Math.max(s.outUntil, now + b.den.outSeconds); }

// ---- alphas (spec §11.2 alpha, §11.6) ----
/** The phase: the first whose aboveHpFraction is below hp / maxHp. */
export function alphaPhase(phases: readonly BehaviourPhase[], hp: number, maxHp: number): number {
  const f = hp / maxHp, i = phases.findIndex(p => p.aboveHpFraction < f);
  return i < 0 ? phases.length - 1 : i;
}
export const ROAR_SECONDS = .8;
function alpha(b: SpeciesBehaviour, s: AiState, i: AiInput): AiOutput {
  const lair = b.lair!, phases = b.phases!, now = i.now, L = i.self.L, centre = s.home ??= { ...i.self.position };
  const radius = lair.radiusBodyLengths * L, distance = Math.hypot(i.player.position.x - centre.x, i.player.position.z - centre.z);
  // Reset: the player outside resetOutsideFactor × the lair for resetDelaySeconds → back to the lair centre, healing; full HP → phase 1.
  s.outsideSince = distance > lair.resetOutsideFactor * radius ? s.outsideSince ?? now : null;
  if (s.name === 'reset' || (s.outsideSince !== null && now - s.outsideSince >= lair.resetDelaySeconds - 1e-9 && !i.self.busy)) {
    if (s.name !== 'reset') { set(s, 'reset', now); s.chain = null; s.current = null; }
    if (i.self.hp >= i.self.maxHp) { set(s, 'idle', now); s.phase = 0; s.outsideSince = null; return out(AMBIENT); }
    if (s.outsideSince === null && i.inLair) { set(s, 'approach', now); }
    else return out({ kind: 'toward', point: centre, speedFactor: 1 }, { heal: lair.healPerSecond });
  }
  const phase = alphaPhase(phases, i.self.hp, i.self.maxHp);
  // The roar starts at once, even during an action: the caller cancels a busy action when `roar` is set (T17).
  if (phase > s.phase) { s.phase = phase; set(s, 'roar', now); s.chain = null; s.current = null; s.emerges = 0; s.charges = 0; return out(HOLD, { roar: true }); }
  if (s.name === 'roar') { if (now - s.since < ROAR_SECONDS - 1e-9) return out(HOLD); set(s, 'approach', now); }
  const p = phases[s.phase]!, bound = (q: Vec3) => clampToDisc(q, centre, radius * (p.lairFraction ?? 1));
  if (s.name === 'idle') {
    if (!i.inLair || !i.hostile || !i.player.targetable) return out({ kind: 'toward', point: centre, speedFactor: .5 });
    set(s, 'notice', now); return out(HOLD, { marker: true });
  }
  // An alpha does not follow the pursuit policy: its lair rules are its leash (targets clamped to the lair disc, the slow reset outside
  // resetOutsideFactor × the lair), so its hunter steps run with pursuit 'hunt'.
  if (p.pattern === 'burrow') return burrow(b, s, i, p, bound);
  if (p.pattern === 'laps') return laps(s, i, p, centre, radius);
  return hunter(b, s, { ...i, pursuit: 'hunt' }, p.attacks, p.gapSeconds, p.speedFactor, bound);
}
/** A refused emerge surfaces after this wait (fix round 1, M-b). */
const EMERGE_WAIT_SECONDS = 1;
/** Burrow (spec §11.6): sink .4 s, travel 1.2 s at × 1.6 under the sand toward the player (untargetable, inside the lair), then emerge at the
 *  player's position; two emerges, then one pinch combo; repeat. */
function burrow(b: SpeciesBehaviour, s: AiState, i: AiInput, p: BehaviourPhase, bound: (q: Vec3) => Vec3): AiOutput {
  const now = i.now;
  if (s.emerges >= BURROW.emerges) {
    const wasAttack = s.name === 'attack', o = hunter(b, s, { ...i, pursuit: 'hunt' }, p.attacks, p.gapSeconds, p.speedFactor, bound);
    if (wasAttack && s.name === 'reposition') s.emerges = 0;   // the combo is over (a refused ask also repositions: the combo stays due)
    return o;
  }
  switch (s.name) {
    case 'sink': if (now - s.since >= BURROW.sinkSeconds - 1e-9) set(s, 'burrowed', now); return out(HOLD, { untargetable: true });
    case 'burrowed': {
      // Refused for EMERGE_WAIT_SECONDS after the travel: surface in place (a spent emerge), never untargetable for long.
      if (now - s.since >= BURROW.travelSeconds + EMERGE_WAIT_SECONDS - 1e-9) { s.emerges++; s.gapUntil = now + p.gapSeconds; set(s, s.emerges >= BURROW.emerges ? 'approach' : 'reposition', now); return out(HOLD); }
      if (now - s.since < BURROW.travelSeconds - 1e-9 || now < waitUntil(s, i)) return out({ kind: 'toward', point: bound(i.player.position), speedFactor: p.speedFactor * BURROW.speedFactor }, { untargetable: true });
      return out(HOLD, { untargetable: true, attack: request(s, i, null, p.patternAttackId!) });
    }
    case 'emerge': {
      if (i.self.busy) return out(HOLD);
      s.emerges++; s.gapUntil = now + p.gapSeconds; set(s, s.emerges >= BURROW.emerges ? 'approach' : 'reposition', now);
      return out(HOLD);
    }
    default: { if (now < s.gapUntil) return out(HOLD); set(s, 'sink', now); return out(HOLD, { untargetable: true }); }
  }
}
/** Laps (spec §11.6): circle at .8 × the lair radius at the phase speed; a charge every half lap, aimed through the player's position (fixed at
 *  start); two charges, then a 1.5 s rest. A half lap takes π r / (speed × speedFactor). */
function laps(s: AiState, i: AiInput, p: BehaviourPhase, centre: Vec3, radius: number): AiOutput {
  const now = i.now, r = LAPS.radiusFraction * radius, v = Math.max(1e-6, i.self.speed * p.speedFactor), half = Math.PI * r / v;
  if (s.name === 'lap-rest') { if (now - s.since < LAPS.restSeconds - 1e-9) return out(HOLD); set(s, 'lap', now); s.charges = 0; s.until = now + half; }
  if (s.name === 'attack') {
    if (i.self.busy) return out(HOLD);
    s.charges++; const rest = s.charges >= LAPS.charges;
    set(s, rest ? 'lap-rest' : 'lap', now); s.until = now + half;
    if (rest) return out(HOLD);
  }
  if (s.name !== 'lap') { set(s, 'lap', now); s.until = now + half; }
  const a = Math.atan2(i.self.position.x - centre.x, i.self.position.z - centre.z) + .5, point = { x: centre.x + Math.sin(a) * r, y: i.self.position.y, z: centre.z + Math.cos(a) * r };
  const move: MoveIntent = { kind: 'toward', point, speedFactor: p.speedFactor };
  if (now >= s.until && now >= waitUntil(s, i) && i.ready(p.patternAttackId!) && i.player.targetable) return out(move, { attack: request(s, i, null, p.patternAttackId!) });
  return out(move);
}
