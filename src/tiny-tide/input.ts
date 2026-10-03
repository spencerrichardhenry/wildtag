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
  const edge = s.chompTapped || (basicHeld && !previous.basicHeld);
  const basicPressed = edge && !activePressed.some(Boolean);

  const rise = s.riseHeld || k.has('KeyE'), dive = s.diveHeld || k.has('KeyQ');
  const traversal: CombatInput['traversal'] = opts.breachOnRiseTap && s.riseTapped ? 'breach' : rise && !dive ? 'rise' : dive && !rise ? 'dive' : 'none';
  const aim = s.aim ?? null;
  return { move: { x, y: 0, z }, aim, aimSource: aim ? s.aimSource ?? 'none' : 'none', basicHeld, basicPressed, activePressed, activeHeld: held, activeReleased, activeCanceled: four(i => canceled[i]), traversal };
}

/** The one place the simulation asks for a bite. An active press suppresses basic initiation for that tick only. */
export function basicRequested(intent: CombatInput): boolean {
  return !intent.activePressed.some(Boolean) && (intent.basicPressed || intent.basicHeld);
}
