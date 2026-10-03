// Pure input: raw sources in, one CombatInput intent per tick out. Nothing is buffered here (the action engine owns the input buffer).
import type { CombatInput, Tuple4, Vec3 } from './combat-types';

export type AimSource = CombatInput['aimSource'];
export interface InputSources {
  stickX: number; stickZ: number; keys: ReadonlySet<string>;
  chompHeld: boolean; chompTapped: boolean;
  riseHeld: boolean; riseTapped: boolean; diveHeld: boolean;
  /** The aim (a unit vector, world space) and where it came from (spec §8.4); default none. */
  aim?: Vec3 | null; aimSource?: AimSource;
  /** Slot buttons and the right mouse (slot 1). Keys Digit1–Digit4 also hold slots 1–4. */
  activeTapped?: Tuple4<boolean>; activeHeld?: Tuple4<boolean>; activeCanceled?: Tuple4<boolean>;
}

const OFF: Tuple4<boolean> = [false, false, false, false];
const SLOT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'] as const;
const four = <T>(f: (i: 0 | 1 | 2 | 3) => T): Tuple4<T> => [f(0), f(1), f(2), f(3)];

/** The all-empty intent. */
export const RELEASED: CombatInput = Object.freeze({
  move: Object.freeze({ x: 0, y: 0, z: 0 }), aim: null, aimSource: 'none', basicHeld: false, basicPressed: false,
  activePressed: [false, false, false, false], activeHeld: [false, false, false, false], activeReleased: [false, false, false, false], activeCanceled: [false, false, false, false], traversal: 'none',
}) as CombatInput;

export function readIntent(s: InputSources, previous: CombatInput, opts: { breachOnRiseTap: boolean }): CombatInput {
  const k = s.keys;
  let x = s.stickX + (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  let z = s.stickZ + (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }

  const tapped = s.activeTapped ?? OFF, canceled = s.activeCanceled ?? OFF;
  const held = four(i => (s.activeHeld ?? OFF)[i] || k.has(SLOT_KEYS[i]));
  const activePressed = four(i => tapped[i] || (held[i] && !previous.activeHeld[i]));
  const activeReleased = four(i => previous.activeHeld[i] && !held[i] && !canceled[i]);

  const basicHeld = s.chompHeld || k.has('Space');
  // T7 carry (amends spec §8.5): a same-tick slot press no longer hides the basic press here. The combat world suppresses the basic input
  // only when the slot move is accepted (it starts or is buffered); an empty, inactive, cooling or refused slot does not swallow a Bite.
  const basicPressed = s.chompTapped || (basicHeld && !previous.basicHeld);

  const rise = s.riseHeld || k.has('KeyE'), dive = s.diveHeld || k.has('KeyQ');
  const traversal: CombatInput['traversal'] = opts.breachOnRiseTap && s.riseTapped ? 'breach' : rise && !dive ? 'rise' : dive && !rise ? 'dive' : 'none';
  const aim = s.aim ?? null;
  return { move: { x, y: 0, z }, aim, aimSource: aim ? s.aimSource ?? 'none' : 'none', basicHeld, basicPressed, activePressed, activeHeld: held, activeReleased, activeCanceled: four(i => canceled[i]), traversal };
}

/** The one place the simulation asks for a bite. `slotAccepted`: a slot move was accepted this tick (started or buffered); it suppresses
 *  basic initiation for that tick only. */
export function basicRequested(intent: CombatInput, slotAccepted = false): boolean {
  return !slotAccepted && (intent.basicPressed || intent.basicHeld);
}

// ---- desktop mouse buttons (spec §8.1) ----
/** The mouse's basic (left) and slot 1 (right) state. */
export interface MouseState { basic: boolean; slot1: boolean }
export const NO_MOUSE: MouseState = Object.freeze({ basic: false, slot1: false });
/** The mouse state from a pointer event's `buttons` bitmask (1 left, 2 right, 4 middle), with the new presses. Chorded presses and releases
 *  arrive as pointermove events (only the first press is a pointerdown and only the last release a pointerup), so every mouse pointer
 *  event goes through this. `leftIsLook`: the left button drives an Alt + left camera drag, not the basic input. */
export function mouseButtons(prev: MouseState, buttons: number, leftIsLook = false): MouseState & { basicPressed: boolean; slot1Pressed: boolean } {
  const basic = !leftIsLook && (buttons & 1) !== 0, slot1 = (buttons & 2) !== 0;
  return { basic, slot1, basicPressed: basic && !prev.basic, slot1Pressed: slot1 && !prev.slot1 };
}

// ---- aim (spec §8.4) ----
/** The desktop pointer counts for this long after it last moved over the canvas; then the aim is the camera forward. */
export const POINTER_FRESH_SECONDS = 4;
/** The horizontal aim of the pointer ray (render or physical units, the caller's choice) with no creature under it (spec §8.4, final review C1):
 *  toward the first point of the ray beyond the player's depth along it (`t > t_player`) that is either on the horizontal plane through
 *  `origin` or blocked (`blocked`: the seabed or a solid, sampled every `reach` / 32 up to `reach` beyond the player). A point between the
 *  camera and the player is never used: with a target below or above the player that point lies behind it (the old rule aimed back at the
 *  camera, up to 165° off). With no such point, the ray's own horizontal direction. Null only for a vertical ray. */
export function pointerAim(origin: Vec3, rayOrigin: Vec3, rayDir: Vec3, blocked?: (p: Vec3) => boolean, reach = 0): Vec3 | null {
  const tp = (origin.x - rayOrigin.x) * rayDir.x + (origin.y - rayOrigin.y) * rayDir.y + (origin.z - rayOrigin.z) * rayDir.z;
  let best = Infinity;
  if (Math.abs(rayDir.y) > 1e-9) { const t = (origin.y - rayOrigin.y) / rayDir.y; if (t > Math.max(0, tp) + 1e-9) best = t; }
  if (blocked && reach > 0) {
    const t0 = Math.max(0, tp), step = reach / 32, p = { x: 0, y: 0, z: 0 };
    for (let k = 1; k <= 32; k++) {
      const t = t0 + k * step; if (t >= best) break;
      p.x = rayOrigin.x + rayDir.x * t; p.y = rayOrigin.y + rayDir.y * t; p.z = rayOrigin.z + rayDir.z * t;
      if (blocked(p)) { best = t; break; }
    }
  }
  if (Number.isFinite(best)) {
    const dx = rayOrigin.x + rayDir.x * best - origin.x, dz = rayOrigin.z + rayDir.z * best - origin.z, l = Math.hypot(dx, dz);
    if (l > 1e-6) return { x: dx / l, y: 0, z: dz / l };
  }
  const h = Math.hypot(rayDir.x, rayDir.z);
  return h > 1e-6 ? { x: rayDir.x / h, y: 0, z: rayDir.z / h } : null;
}
/** A pointer pick tolerance: with no hurtbox under the pointer, a creature whose projected hull centre is this close (CSS px) is picked. */
export const PICK_TOLERANCE_PX = 48;
/** A pick candidate: its hull centre, its hurtbox spheres (same units as the ray) and its projected centre (CSS px; null off screen). */
export interface PickCandidate { centre: Vec3; spheres: readonly { x: number; y: number; z: number; r: number }[]; screen: { x: number; y: number } | null }
/** The creature under the pointer (spec §8.4, final review C1): the candidate with the nearest hurtbox sphere the ray meets (in front of the
 *  ray origin), else the nearest projected centre within `tolerancePx` of `pointer`; its hull centre, or null. */
export function pickAimTarget(rayOrigin: Vec3, rayDir: Vec3, candidates: readonly PickCandidate[], pointer: { x: number; y: number }, tolerancePx = PICK_TOLERANCE_PX): Vec3 | null {
  let best: Vec3 | null = null, bestT = Infinity;
  for (const c of candidates) for (const s of c.spheres) {
    const ox = s.x - rayOrigin.x, oy = s.y - rayOrigin.y, oz = s.z - rayOrigin.z, b = ox * rayDir.x + oy * rayDir.y + oz * rayDir.z;
    const d2 = ox * ox + oy * oy + oz * oz - b * b; if (d2 > s.r * s.r) continue;
    const t = b - Math.sqrt(s.r * s.r - d2); if (t > 0 && t < bestT) { bestT = t; best = c.centre; }
  }
  if (best) return best;
  let bestPx = tolerancePx;
  for (const c of candidates) { if (!c.screen) continue; const d = Math.hypot(c.screen.x - pointer.x, c.screen.y - pointer.y); if (d <= bestPx) { bestPx = d; best = c.centre; } }
  return best;
}
/** The aim from `origin` at a picked `target`: its yaw, and for a free mover (`pitch`) its pitch clamped to ±`limit`; a ground mover aims
 *  level. Null when the target is straight above or below. */
export function aimToward(origin: Vec3, target: Vec3, pitch: boolean, limit: number): Vec3 | null {
  const dx = target.x - origin.x, dz = target.z - origin.z, h = Math.hypot(dx, dz); if (h < 1e-6) return null;
  const level = { x: dx / h, y: 0, z: dz / h };
  return pitch ? pitched(level, Math.max(-limit, Math.min(limit, Math.atan2(target.y - origin.y, h)))) : level;
}
/** The soft-lock cone (D9): a target within 30° of yaw of the aim sets the pitch. */
export const SOFT_LOCK_HALF_ANGLE = 30 * Math.PI / 180;
/** The aim pitch of a free mover (D9): toward the nearest target within SOFT_LOCK_HALF_ANGLE of yaw of the horizontal aim, else the creature's
 *  pitch; clamped to ±limit. */
export function aimPitch(origin: Vec3, aim: Vec3, targets: readonly Vec3[], creaturePitch: number, limit: number): number {
  const yaw = Math.atan2(aim.x, aim.z);
  let best: Vec3 | null = null, bestD = Infinity;
  for (const t of targets) {
    const dx = t.x - origin.x, dz = t.z - origin.z; if (Math.hypot(dx, dz) < 1e-9) continue;
    const d = Math.atan2(dx, dz) - yaw, off = Math.abs(Math.atan2(Math.sin(d), Math.cos(d))), dist = Math.hypot(dx, t.y - origin.y, dz);
    if (off <= SOFT_LOCK_HALF_ANGLE + 1e-9 && dist < bestD) { best = t; bestD = dist; }
  }
  const pitch = best ? Math.atan2(best.y - origin.y, Math.hypot(best.x - origin.x, best.z - origin.z)) : creaturePitch;
  return Math.max(-limit, Math.min(limit, pitch));
}
/** A horizontal aim tilted to `pitch` (positive is up). */
export const pitched = (aim: Vec3, pitch: number): Vec3 => ({ x: aim.x * Math.cos(pitch), y: Math.sin(pitch), z: aim.z * Math.cos(pitch) });
/** The aim chevron shows while a combat species is within this many body lengths (spec §8.4). */
export const AIM_CHEVRON_RANGE = 4;
/** Where the aim chevron goes: 1 L from `origin` along the aim, while a combat species (`combatants`, same units as `origin`) is within
 *  AIM_CHEVRON_RANGE × L; else null (hidden). */
export function aimChevron(origin: Vec3, aim: Vec3, L: number, combatants: readonly Vec3[]): Vec3 | null {
  const range = AIM_CHEVRON_RANGE * L, l = Math.hypot(aim.x, aim.y, aim.z);
  if (l < 1e-9 || !combatants.some(c => Math.hypot(c.x - origin.x, c.y - origin.y, c.z - origin.z) <= range)) return null;
  return { x: origin.x + aim.x / l * L, y: origin.y + aim.y / l * L, z: origin.z + aim.z / l * L };
}

// ---- phone aim (spec §8.4) ----
/** A drag on the basic button counts beyond this many CSS px from the press point. */
export const DRAG_DEAD_ZONE = 12;
/** The phone drag aim: screen up is the camera's horizontal forward, screen right its right. Null inside the dead zone. */
export function dragAim(dx: number, dy: number, cameraForward: Vec3): Vec3 | null {
  if (Math.hypot(dx, dy) <= DRAG_DEAD_ZONE) return null;
  const fl = Math.hypot(cameraForward.x, cameraForward.z); if (fl < 1e-9) return null;
  const fx = cameraForward.x / fl, fz = cameraForward.z / fl;   // right = (−fz, fx): forward (0, 0, −1) gives right (1, 0, 0)
  const x = fx * -dy - fz * dx, z = fz * -dy + fx * dx, l = Math.hypot(x, z);
  return l > 1e-9 ? { x: x / l + 0, y: 0, z: z / l + 0 } : null;
}
/** An auto-aim candidate: `rank` 0 an enemy in wind-up that targets the player, 1 hunters and fighters, 2 prey. */
export interface AimCandidate { position: Vec3; rank: 0 | 1 | 2 }
/** Phone auto-aim searches this half angle around the facing. */
export const AUTO_AIM_HALF_ANGLE = 60 * Math.PI / 180;
/** A bracing phone player's auto-aim searches 180° (± 90°) for an attacker in wind-up (review R16). */
export const BRACE_AUTO_AIM_HALF_ANGLE = Math.PI / 2;
/** Phone auto-aim (spec §8.4): the best candidate within `halfAngle` of the horizontal facing and within `maxDistance`, lowest rank first,
 *  then the nearest; a unit vector toward it, or null with none. */
export function autoAim(origin: Vec3, facing: Vec3, candidates: readonly AimCandidate[], maxDistance: number, halfAngle = AUTO_AIM_HALF_ANGLE): Vec3 | null {
  const fl = Math.hypot(facing.x, facing.z) || 1, fx = facing.x / fl, fz = facing.z / fl;
  let best: { c: AimCandidate; d: number } | null = null;
  for (const c of candidates) {
    const dx = c.position.x - origin.x, dy = c.position.y - origin.y, dz = c.position.z - origin.z, d = Math.hypot(dx, dy, dz), h = Math.hypot(dx, dz);
    if (d > maxDistance || h < 1e-9) continue;
    if (Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / h))) > halfAngle + 1e-9) continue;
    if (!best || c.rank < best.c.rank || (c.rank === best.c.rank && d < best.d)) best = { c, d };
  }
  if (!best) return null;
  const p = best.c.position, d = best.d;
  return { x: (p.x - origin.x) / d, y: (p.y - origin.y) / d, z: (p.z - origin.z) / d };
}
