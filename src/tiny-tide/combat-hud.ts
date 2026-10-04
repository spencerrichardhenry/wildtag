// The combat HUD (spec §8, §9.2–§9.3): the four slot buttons with their move icons, key labels and cooldown rings; the combat overlay (HP bars,
// edge arrows toward off-screen telegraphs, the break-free prompt) and the damage floater text. DOM only; elements are pooled.
import './controls.css';
import type { CombatRuntime, HitOutcome, MoveKind, SpeciesTraits, TraitEffect } from './combat-types';
import { damageText } from './combat-profiles';
import { PLAYER_ID, type EntityCombat, type TelegraphView } from './combat-world';
import { speciesActor } from './mount';
import type { MoveSet, SlotAssignment } from './moves';

const svg = (body: string) => `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
/** Inline move icons (spec §11.7: art debt none). */
export const MOVE_ICONS: Readonly<Record<MoveKind, string>> = {
  brace: svg('<path d="M20 5 33 11v9c0 8-6 13-13 15C13 33 7 28 7 20v-9Z"/>'),
  counter: svg('<path d="M20 4v8M20 28v8M4 20h8M28 20h8M9 9l6 6M25 25l6 6M31 9l-6 6M9 31l6-6"/><circle cx="20" cy="20" r="4"/>'),
  dash: svg('<path d="M6 14h18M10 20h22M6 26h18M26 12l8 8-8 8"/>'),
  grab: svg('<path d="M10 30c-4-8 0-18 9-20l4 7-6 3 2 4 7-3 4 7c-5 6-15 8-20 2Z"/>'),
  sweep: svg('<path d="M8 28c4-14 18-18 26-10M34 18l-1-8M34 18l-8 1"/>'),
};
/** What a slot button shows: the move, its name and the cooldown left as a fraction (0 = ready). */
export interface SlotView { kind: MoveKind | null; label: string; cooldown: number }
/** The slot views of the assignment: the representative move's label and its cooldown on the player's action clock (the key is the one
 *  CombatWorld.tryStart writes). */
export function slotViews(slots: SlotAssignment, moves: MoveSet, rt: CombatRuntime): SlotView[] {
  return slots.slots.map(kind => {
    const m = kind ? moves.byKind[kind] : undefined;
    if (!kind || !m) return { kind: null, label: '', cooldown: 0 };
    const ready = rt.cooldowns.get(`${PLAYER_ID}:${m.partUid}:${m.grantId}`) ?? 0, total = m.resolved.cooldownSeconds;
    return { kind, label: m.resolved.label, cooldown: total > 0 ? Math.max(0, Math.min(1, (ready - rt.actionClock) / total)) : 0 };
  });
}
/** The ring is redrawn in RING_STEPS steps. A cooldown above 0 is at least step 1, so the last sliver of a cooldown never looks like a ready
 *  slot to `sync` (the button would keep its cooldown look). */
export const RING_STEPS = 40;
export const ringStep = (cooldown: number): number => cooldown > 0 ? Math.max(1, Math.round(cooldown * RING_STEPS)) : 0;
export class CombatHud {
  readonly buttons: HTMLButtonElement[] = [];
  private shown: string[] = ['', '', '', ''];
  constructor(host: HTMLElement) {
    for (let i = 0; i < 4; i++) {
      const b = document.createElement('button');
      b.id = `slot-${i + 1}`; b.className = 'slot-button'; b.hidden = true;
      b.innerHTML = `<i class="slot-ring"></i><span class="slot-icon"></span><b class="slot-name"></b><kbd>${i + 1}</kbd>`;
      host.append(b); this.buttons.push(b);
    }
  }
  /** Writes only what changed: an empty slot is hidden; the ring is a conic gradient of the cooldown left. */
  sync(views: readonly SlotView[]): void {
    views.forEach((v, i) => {
      const b = this.buttons[i]!, key = `${v.kind}:${v.label}:${ringStep(v.cooldown)}`;
      if (this.shown[i] === key) return;
      this.shown[i] = key; b.hidden = v.kind === null;
      if (!v.kind) return;
      b.querySelector('.slot-icon')!.innerHTML = MOVE_ICONS[v.kind]; b.querySelector('.slot-name')!.textContent = v.label.toUpperCase();
      b.setAttribute('aria-label', `${v.label} (slot ${i + 1})`); b.dataset.kind = v.kind;
      (b.querySelector('.slot-ring') as HTMLElement).style.background = v.cooldown > 0 ? `conic-gradient(#0e2f3acc ${v.cooldown * 360}deg, transparent 0)` : 'none';
      b.classList.toggle('cooldown', v.cooldown > 0);
    });
  }
}

/** The floater of one hit outcome (spec §9.2, T8 carry): a word for a block, a counter, a dodge or an immunity; else the damage when it is
 *  above 0; else none (a 0-damage hit, catch or guard break shows nothing, never "−0" or "− ♥"). */
/** The faint overlay (spec §10.3, T15 fix round 1): the true loss (at-risk wallet and part credit), or a neutral line when it is not
 *  known (a save loaded during a faint). */
export function faintMessage(lost: number | null): { title: string; line: string } {
  const head = lost === null ? 'Waking up at the start.' : lost > 0 ? `You lost ${lost} DNA.` : 'No DNA was lost.';
  return { title: 'Fainted!', line: `${head} Your body and parts stay.` };
}
export function floaterText(outcome: HitOutcome, unit: 'hp' | 'half-heart', amount: number, trait: TraitEffect | null = null): string | null {
  // Spec §11.8: a trait names what happened.
  if (trait === 'shell') return `SHELL ${damageText(outcome, unit, amount)}`;
  if (trait === 'slip') return 'SLIPPED FREE';
  if (trait === 'bounce') return 'BOUNCED!';
  if (trait === 'stun') return 'STUNNED!';
  if (outcome === 'blocked' || outcome === 'countered' || outcome === 'evaded') return damageText(outcome, unit, amount);
  if (outcome === 'immune') return 'IMMUNE';
  return amount > 0 ? damageText(outcome, unit, amount) : null;
}
/** The break-free prompt (spec §6.6, §11.8): mash Chomp, or (the squid's hold) a Dash or Counter press. */
export function breakPromptText(escape: SpeciesTraits['grabEscape'] | 'mash', touch: boolean): string {
  return escape === 'dash-or-counter' ? `${touch ? 'Tap ' : ''}Dash or Counter to slip free!` : 'Wiggle free! Tap CHOMP';
}
/** Damage numbers (T16b fix round 1, readability): the damage the player deals and the damage it takes have clearly different colours.
 *  `dealt`: a pale yellow; `taken`: a strong red. Any other event (species on species) is `dealt`'s neutral twin. */
export const FLOATER_COLOURS = { dealt: '#fff3a8', taken: '#ff4b4b' } as const;
export type FloaterClass = keyof typeof FLOATER_COLOURS;
export const floaterClass = (attackerId: string, targetId: string): FloaterClass => targetId === 'player' && attackerId !== 'player' ? 'taken' : 'dealt';
/** A combat species shows its HP bar for this long after its last damage (spec §9.3). */
export const HP_BAR_SECONDS = 4;
/** Screen pixels; `fraction` is HP left. */
export interface HpBar { x: number; y: number; fraction: number }
/** Screen pixels; `fill` is the telegraph's fill (the ring fills like the shape). */
export interface EdgeArrow { x: number; y: number; angle: number; color: 'amber' | 'red'; fill: number }
/** The overlay: HP bars above damaged species, edge arrows toward off-screen telegraphs, and the break-free prompt with its progress ring. */
export class CombatOverlay {
  private readonly root = document.createElement('div');
  private readonly bars: HTMLElement[] = [];
  private readonly arrows: HTMLElement[] = [];
  readonly prompt = document.createElement('div');
  private readonly ring: HTMLElement;
  private shownBreak = -1;
  constructor(host: HTMLElement) {
    this.root.id = 'combat-overlay'; this.root.setAttribute('aria-hidden', 'true');
    this.prompt.id = 'break-free'; this.prompt.hidden = true; this.prompt.setAttribute('role', 'status');
    this.prompt.innerHTML = '<i class="break-ring"></i><span>Wiggle free! Tap CHOMP</span>';
    this.ring = this.prompt.querySelector('.break-ring')!;
    host.append(this.root, this.prompt);
  }
  private pooled(list: HTMLElement[], i: number, cls: string): HTMLElement {
    let e = list[i]; if (!e) { e = document.createElement('div'); e.className = cls; this.root.append(e); list[i] = e; }
    e.hidden = false; return e;
  }
  private shownPrompt = 'Wiggle free! Tap CHOMP';
  /** `breakProgress`: null when the player is not held. `prompt`: the break-free text (breakPromptText). */
  sync(bars: readonly HpBar[], arrows: readonly EdgeArrow[], breakProgress: number | null, prompt = 'Wiggle free! Tap CHOMP'): void {
    if (prompt !== this.shownPrompt) { this.shownPrompt = prompt; this.prompt.querySelector('span')!.textContent = prompt; }
    bars.forEach((b, i) => { const e = this.pooled(this.bars, i, 'hp-bar'); e.style.left = `${b.x}px`; e.style.top = `${b.y}px`; e.style.setProperty('--hp', `${Math.max(0, Math.min(1, b.fraction)) * 100}%`); });
    for (let i = bars.length; i < this.bars.length; i++) this.bars[i]!.hidden = true;
    arrows.forEach((a, i) => {
      const e = this.pooled(this.arrows, i, 'edge-arrow'); e.style.left = `${a.x}px`; e.style.top = `${a.y}px`; e.style.rotate = `${a.angle}rad`; e.dataset.color = a.color;
      e.style.setProperty('--fill', `${Math.max(0, Math.min(1, a.fill)) * 360}deg`);
    });
    for (let i = arrows.length; i < this.arrows.length; i++) this.arrows[i]!.hidden = true;
    this.prompt.hidden = breakProgress === null;
    const step = breakProgress === null ? -1 : Math.round(Math.min(1, breakProgress) * 40);
    if (step !== this.shownBreak) { this.shownBreak = step; if (step >= 0) this.ring.style.background = `conic-gradient(#fff2b3 ${step * 9}deg, #ffffff33 0)`; }
  }
}
/** The alpha bar's content (spec §9.3): the name, the HP fraction and the phase (0-based) of `phases`. */
export interface AlphaView { name: string; fraction: number; phase: number; phases: number }
/** The alpha the player is near: inside resetOutsideFactor (1.5) × the lair radius of its lair centre (horizontal; physical units). An alpha
 *  before its first AI tick has no lair centre yet and shows no bar. */
export function alphaView(combats: Iterable<EntityCombat>, player: { x: number; z: number }): AlphaView | null {
  for (const c of combats) {
    const e = c.entity, lair = c.behaviour.lair, home = c.ai?.home;
    if (!e.spec.alpha || !lair || !home || e.eaten) continue;
    if (Math.hypot(player.x - home.x, player.z - home.z) > lair.resetOutsideFactor * lair.radiusBodyLengths * speciesActor(e).bodyLength) continue;
    return { name: e.spec.label, fraction: Math.max(0, e.hp / c.maxHp), phase: c.ai?.phase ?? 0, phases: c.behaviour.phases?.length ?? 1 };
  }
  return null;
}
/** The alpha bar at the top centre: the name, the HP bar and the phase pips (the current phase and those before it lit). Writes on a change. */
export class AlphaBar {
  readonly root = document.createElement('div');
  private shown = '';
  constructor(host: HTMLElement) {
    this.root.id = 'alpha-bar'; this.root.hidden = true; this.root.setAttribute('role', 'status');
    this.root.innerHTML = '<strong></strong><i class="alpha-hp"><b></b></i><span class="alpha-pips"></span>';
    host.append(this.root);
  }
  sync(v: AlphaView | null): void {
    const key = v ? `${v.name}|${Math.round(v.fraction * 200)}|${v.phase}|${v.phases}` : '';
    if (key === this.shown) return; this.shown = key;
    this.root.hidden = v === null; if (!v) return;
    this.root.querySelector('strong')!.textContent = v.name;
    (this.root.querySelector('.alpha-hp b') as HTMLElement).style.width = `${Math.max(0, Math.min(1, v.fraction)) * 100}%`;
    this.root.querySelector('.alpha-pips')!.innerHTML = Array.from({ length: v.phases }, (_, i) => `<i class="${i <= v.phase ? 'on' : ''}"></i>`).join('');
  }
}
/** Where an edge arrow sits (screen pixels): on an ellipse 36 px inside the screen edge, toward the off-screen point; a point behind the
 *  camera (not `visible`) projects mirrored, so its direction is flipped. `angle` points from the screen centre toward the point. */
export function edgeArrowAt(point: { x: number; y: number; visible: boolean }, width: number, height: number): { x: number; y: number; angle: number } {
  const cx = width / 2, cy = height / 2, k = point.visible ? 1 : -1, angle = Math.atan2((point.y - cy) * k, (point.x - cx) * k);
  return { x: cx + Math.cos(angle) * (cx - 36), y: cy + Math.sin(angle) * (cy - 36), angle };
}
/** Which telegraphs show their edge arrow (spec §9.1): one whose centroid went off-screen at some time in its windup keeps the arrow to
 *  the end of its active phase (a profile without an edge arrow never shows one). Presentation memory (main.ts), not combat state. */
export class EdgeArrowMemory {
  private readonly gone = new Set<string>();
  /** Call once per frame with all of this frame's telegraphs; returns the ids whose arrow shows. Forgets telegraphs that ended. */
  update(views: readonly TelegraphView[]): Set<string> {
    const live = new Set<string>(), out = new Set<string>();
    for (const v of views) {
      live.add(v.actionId);
      if (v.phase === 'windup' && !v.onScreen) this.gone.add(v.actionId);
      if (v.edgeArrow && this.gone.has(v.actionId)) out.add(v.actionId);
    }
    for (const id of [...this.gone]) if (!live.has(id)) this.gone.delete(id);
    return out;
  }
}

// ---- threat marker keep-out (final review M4 / item i) ----
export interface ScreenBox { left: number; top: number; right: number; bottom: number }
/** A threat marker (centre `x`, bottom `y`, half width `half`, height `h`; CSS px) moved off every keep-out box (the depth label, the growth
 *  card) by the shortest move that stays inside `bounds` (`x` in [minX, maxX], the bottom `y` in [minY, maxY]) and clears every box; unchanged
 *  when it clears them already (or when no such move exists). */
export function avoidKeepOut(x: number, y: number, half: number, h: number, keepOut: readonly ScreenBox[], bounds: { minX: number; maxX: number; minY: number; maxY: number }): { x: number; y: number } {
  const clear = (px: number, py: number) => keepOut.every(b => !(px - half < b.right && b.left < px + half && py - h < b.bottom && b.top < py));
  if (clear(x, y)) return { x, y };
  const candidates: { x: number; y: number }[] = [];
  for (const b of keepOut) candidates.push({ x, y: b.top - 2 }, { x, y: b.bottom + h + 2 }, { x: b.left - half - 2, y }, { x: b.right + half + 2, y });
  // Two boxes side by side or stacked: also the corners past both.
  for (const a of keepOut) for (const b of keepOut) if (a !== b) candidates.push({ x: a.left - half - 2, y: b.bottom + h + 2 }, { x: a.right + half + 2, y: b.bottom + h + 2 }, { x: a.left - half - 2, y: b.top - 2 }, { x: a.right + half + 2, y: b.top - 2 });
  let best: { x: number; y: number } | null = null, bestD = Infinity;
  for (const c of candidates) {
    if (c.x < bounds.minX || c.x > bounds.maxX || c.y < bounds.minY || c.y > bounds.maxY || !clear(c.x, c.y)) continue;
    const d = Math.hypot(c.x - x, c.y - y); if (d < bestD) { bestD = d; best = c; }
  }
  return best ?? { x, y };
}
