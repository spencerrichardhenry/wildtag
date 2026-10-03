// Telegraph and effect profiles, hit-stop durations and feedback constants (spec §5.9, §9). Pure data and pure functions.
import type { EffectProfile, HitOutcome, TelegraphProfile } from './combat-types';

/** The flash before active (spec §9.1 item 5). */
export const FLASH_LEAD_SECONDS = .12;
const telegraph = (id: string, color: TelegraphProfile['color'], poseCue: TelegraphProfile['poseCue']): TelegraphProfile =>
  ({ id, color, pattern: color === 'red' ? 'stripes' : 'solid', poseCue, flashLeadSeconds: color === 'none' ? 0 : FLASH_LEAD_SECONDS, edgeArrow: color !== 'none' });
/** Amber solid: can be blocked. Red stripes: cannot be blocked. 'none': player attacks (no telegraph). */
export const TELEGRAPHS: Record<string, TelegraphProfile> = Object.fromEntries([
  telegraph('none', 'none', 'none'),
  telegraph('amber-rear', 'amber', 'rear'), telegraph('amber-crouch', 'amber', 'crouch'), telegraph('amber-spin', 'amber', 'spin'),
  telegraph('amber-inflate', 'amber', 'inflate'), telegraph('amber-coil', 'amber', 'coil'),
  telegraph('red-coil', 'red', 'coil'), telegraph('red-burrow', 'red', 'burrow'), telegraph('red-spin', 'red', 'spin'),
].map(t => [t.id, t]));
const feedback = (id: string, sound: EffectProfile['sound'], particles: string): EffectProfile => ({ id, kind: 'feedback', sound, particles });
export const EFFECTS: Record<string, EffectProfile> = {
  hit: feedback('hit', 'hit', '#ffd9a8'), block: feedback('block', 'block', '#cfe3ff'), counter: feedback('counter', 'counter', '#fff2b3'),
  dash: feedback('dash', 'dash', '#d6fff1'), grab: feedback('grab', 'grab', '#ffd9a8'), break: feedback('break', 'break', '#cfe3ff'),
  ink: { id: 'ink', kind: 'status', status: { id: 'inked', seconds: 1.5, speedFactor: .7 }, sound: 'none', particles: '#2b1f3a' },
};

/** Impact particle colours by outcome (spec §9.2). */
export const IMPACT_COLOURS = { hit: '#ffd9a8', hurt: '#ff8f7a', block: '#cfe3ff', counter: '#fff2b3' } as const;
export const IMPACT_PARTICLES = 10;
/** The hurt actor's white flash. */
export const FLASH_SECONDS = .08;

/** Hit-stop in seconds (spec §5.9). `amount`: half-hearts dealt to a player target, else HP dealt by a player attacker. */
export function hitStopFor(outcome: HitOutcome, side: { targetIsPlayer: boolean; amount: number }): number {
  switch (outcome) {
    case 'countered': return .09;
    case 'blocked': case 'guard-broken': return .06;
    case 'grabbed': return .07;
    case 'evaded': case 'immune': return 0;
    case 'hit': return side.targetIsPlayer
      ? Math.min(90, Math.max(60, 60 + 10 * (side.amount - 1))) / 1000
      : (60 + Math.round(30 * Math.min(1, side.amount / 8))) / 1000;
  }
}
/** Camera shake (world.shake units, 1 = today's hurt shake). Only hits on the player and the player's Sweep and Counter shake. */
export const shakeForPlayerHit = (halfHearts: number) => Math.min(1, .35 * halfHearts);
export const shakeForPlayerStrike = (hp: number) => Math.min(.6, .1 * hp);
/** Damage number text (spec §9.2). */
export function damageText(outcome: HitOutcome, unit: 'hp' | 'half-heart', amount: number): string {
  if (outcome === 'blocked') return 'BLOCK';
  if (outcome === 'countered') return 'COUNTER!';
  if (outcome === 'evaded') return 'DODGE';
  if (unit === 'hp') return `−${amount}`;
  const hearts = Math.floor(amount / 2), half = amount % 2 === 1;
  return `−${hearts === 0 ? '' : hearts}${half ? '½' : ''} ♥`;
}
