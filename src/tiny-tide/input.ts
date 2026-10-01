// Pure input: raw sources in, one CombatInput intent per tick out. Nothing is buffered.
import type { CombatInput, Vec3 } from './combat-types';

export interface InputSources {
  stickX: number; stickZ: number; keys: ReadonlySet<string>;
  chompHeld: boolean; chompTapped: boolean;
  riseHeld: boolean; riseTapped: boolean; diveHeld: boolean;
  aim?: Vec3 | null;
  activeTapped?: [boolean, boolean]; activeHeld?: [boolean, boolean]; activeCanceled?: [boolean, boolean];
}

const OFF: [boolean, boolean] = [false, false];

/** The all-empty intent. */
export const RELEASED: CombatInput = Object.freeze({
  move: Object.freeze({ x: 0, y: 0, z: 0 }), aim: null, basicHeld: false, basicPressed: false,
  activePressed: [false, false] as [boolean, boolean], activeHeld: [false, false] as [boolean, boolean],
  activeReleased: [false, false] as [boolean, boolean], activeCanceled: [false, false] as [boolean, boolean], traversal: 'none',
}) as CombatInput;

export function readIntent(s: InputSources, previous: CombatInput, opts: { breachOnRiseTap: boolean }): CombatInput {
  const k = s.keys;
  let x = s.stickX + (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  let z = s.stickZ + (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }

  const tapped = s.activeTapped ?? OFF, held = s.activeHeld ?? OFF, canceled = s.activeCanceled ?? OFF;
  const activePressed: [boolean, boolean] = [0, 1].map(i => tapped[i] || (held[i] && !previous.activeHeld[i])) as [boolean, boolean];
  const activeReleased: [boolean, boolean] = [0, 1].map(i => previous.activeHeld[i] && !held[i] && !canceled[i]) as [boolean, boolean];

  const basicHeld = s.chompHeld || k.has('Space');
  const edge = s.chompTapped || (basicHeld && !previous.basicHeld);
  const basicPressed = edge && !activePressed.some(Boolean);

  const rise = s.riseHeld || k.has('KeyE'), dive = s.diveHeld || k.has('KeyQ');
  const traversal: CombatInput['traversal'] = opts.breachOnRiseTap && s.riseTapped ? 'breach' : rise && !dive ? 'rise' : dive && !rise ? 'dive' : 'none';

  return { move: { x, y: 0, z }, aim: s.aim ?? null, basicHeld, basicPressed, activePressed, activeHeld: [held[0], held[1]], activeReleased, activeCanceled: [canceled[0], canceled[1]], traversal };
}

/** The one place the simulation asks for a bite. An active press suppresses basic initiation for that tick only. */
export function basicRequested(intent: CombatInput): boolean {
  return !intent.activePressed.some(Boolean) && (intent.basicPressed || intent.basicHeld);
}
