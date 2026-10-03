// The director (spec §9.4): attack tokens, the limits on wind-ups that target the player. Pure.
import type { ActorId } from './combat-types';

/** At most MAX_TOKENS wind-ups at the player; their active starts at least ACTIVE_GAP apart (by extension, at most MAX_EXTENSION);
 *  an off-screen wind-up lasts at least OFF_SCREEN_WINDUP; a refused request retries after RETRY_SECONDS. */
export const MAX_TOKENS = 2, ACTIVE_GAP = .25, MAX_EXTENSION = .5, OFF_SCREEN_WINDUP = .6, RETRY_SECONDS = .2;
/** `activeStart`: world time of the action's active start (an estimate; `update` moves it when a hit-stop delays the attacker). */
export interface Token { actionInstanceId: string; attackerId: ActorId; activeStart: number; grab: boolean }
/** `delay` (plan review R6): world time before the wind-up clock runs — the attacker's remaining hit-stop and one tick (the action starts
 *  on the next combat tick). It moves the estimated active start; it is not part of the wind-up (the off-screen minimum ignores it). */
export interface TokenRequest { actionInstanceId: string; attackerId: ActorId; windupSeconds: number; now: number; grab: boolean; onScreen: boolean; playerHeld: boolean; delay?: number }
export type TokenRefusal = 'held' | 'full' | 'grab' | 'spacing';
export type TokenAnswer = { ok: true; extension: number } | { ok: false; reason: TokenRefusal; retryAt: number };
const EPS = 1e-9;

/** The extension (≥ `ext`) that puts `base + extension` at least ACTIVE_GAP from every start in `others`; it only grows. */
export function spacedExtension(base: number, ext: number, others: readonly number[]): number {
  for (let changed = true, pass = 0; changed && pass <= others.length; pass++) {
    changed = false;
    for (const t of others) if (Math.abs(base + ext - t) < ACTIVE_GAP - EPS) { ext = Math.max(ext, t + ACTIVE_GAP - base); changed = true; }
  }
  return ext;
}

export class Director {
  readonly tokens: Token[] = [];
  /** A token for a wind-up at the player, with the extension that keeps active starts apart; or a refusal (retry after RETRY_SECONDS). */
  request(r: TokenRequest): TokenAnswer {
    const refuse = (reason: TokenRefusal): TokenAnswer => ({ ok: false, reason, retryAt: r.now + RETRY_SECONDS });
    if (r.playerHeld) return refuse('held');
    if (this.tokens.length >= MAX_TOKENS) return refuse('full');
    if (r.grab && this.tokens.length > 0) return refuse('grab');
    const base = r.now + (r.delay ?? 0) + r.windupSeconds;
    const ext = spacedExtension(base, r.onScreen ? 0 : Math.max(0, OFF_SCREEN_WINDUP - r.windupSeconds), this.tokens.map(t => t.activeStart));
    if (ext > MAX_EXTENSION + EPS) return refuse('spacing');
    this.tokens.push({ actionInstanceId: r.actionInstanceId, attackerId: r.attackerId, activeStart: base + ext, grab: r.grab });
    return { ok: true, extension: ext };
  }
  holds(actionInstanceId: string): boolean { return this.tokens.some(t => t.actionInstanceId === actionInstanceId); }
  /** The token returns (the action's active ended, a grab's hold ended, or it was interrupted). */
  release(actionInstanceId: string): void { const i = this.tokens.findIndex(t => t.actionInstanceId === actionInstanceId); if (i >= 0) this.tokens.splice(i, 1); }
  /** Every token returns (faint, evolve, reset). */
  releaseAll(): void { this.tokens.length = 0; }
  /** A hit-stop or a spacing extension moved an action's active start. */
  update(actionInstanceId: string, activeStart: number): void { const t = this.tokens.find(x => x.actionInstanceId === actionInstanceId); if (t) t.activeStart = activeStart; }
}
