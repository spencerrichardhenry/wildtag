// tests/tiny-tide-core/combat-hud.test.ts — T9: the slot views (label and cooldown fraction on the action clock) and the ring step that
// decides when a slot button is redrawn (a cooldown that is almost over must still differ from a ready slot).
import { describe, expect, it } from 'vitest';
import { alphaView, edgeArrowAt, faintMessage, FLOATER_COLOURS, floaterClass, floaterText, ringStep, slotViews } from '../../src/tiny-tide/combat-hud';
import { playerMoves } from '../../src/tiny-tide/sim';
import { speck } from './combat-fixture-world';
import { BEHAVIOURS } from '../../src/tiny-tide/bestiary';
import { newAiState } from '../../src/tiny-tide/combat-ai';
import type { EntityCombat } from '../../src/tiny-tide/combat-world';
import { Ecosystem } from '../../src/tiny-tide/ecosystem';

describe('the slot HUD', () => {
  it('shows the slot moves and their cooldown left as a fraction of the action clock', () => {
    const s = speck(), m = playerMoves(s), dash = m.set.byKind.dash!;
    expect(slotViews(m.slots, m.set, s.rt).map(v => v.kind)).toEqual(['dash', null, null, null]);
    expect(slotViews(m.slots, m.set, s.rt)[0]).toMatchObject({ label: dash.resolved.label, cooldown: 0 });
    s.rt.cooldowns.set(`player:${dash.partUid}:${dash.grantId}`, s.rt.actionClock + dash.resolved.cooldownSeconds / 2);
    expect(slotViews(m.slots, m.set, s.rt)[0]!.cooldown).toBeCloseTo(.5);
  });
  it('a cooldown that is almost over is a different ring step from a ready slot', () => {
    expect(ringStep(0)).toBe(0); expect(ringStep(.001)).toBeGreaterThan(0); expect(ringStep(1)).toBe(40);
  });
});

describe('combat floaters and edge arrows (T12)', () => {
  it('a number only for damage above 0; a word for a block, counter, dodge or immunity; nothing for a 0-damage hit (T8 carry)', () => {
    expect(floaterText('hit', 'hp', 4)).toBe('−4'); expect(floaterText('hit', 'half-heart', 3)).toBe('−1½ ♥');
    expect(floaterText('hit', 'hp', 0)).toBeNull(); expect(floaterText('hit', 'half-heart', 0)).toBeNull(); expect(floaterText('grabbed', 'half-heart', 0)).toBeNull();
    expect(floaterText('blocked', 'half-heart', 0)).toBe('BLOCK'); expect(floaterText('countered', 'hp', 0)).toBe('COUNTER!');
    expect(floaterText('evaded', 'half-heart', 0)).toBe('DODGE'); expect(floaterText('immune', 'hp', 0)).toBe('IMMUNE');
    expect(floaterText('guard-broken', 'half-heart', 2)).toBe('−1 ♥'); expect(floaterText('guard-broken', 'half-heart', 0)).toBeNull();
  });
  it('damage the player deals and damage it takes have clearly different colours (T16b fix round 1)', () => {
    expect(floaterClass('player', 'e93')).toBe('dealt'); expect(floaterClass('e93', 'player')).toBe('taken'); expect(floaterClass('e1', 'e2')).toBe('dealt');
    const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
    const [tr, tg, tb] = rgb(FLOATER_COLOURS.taken), [dr, dg, db] = rgb(FLOATER_COLOURS.dealt);
    expect(tr).toBeGreaterThan(200); expect(tg).toBeLessThan(100); expect(tb).toBeLessThan(100);   // taken: red
    expect(Math.min(dr, dg)).toBeGreaterThan(200); expect(db).toBeLessThan(dg);                     // dealt: pale yellow
    expect(dg - tg).toBeGreaterThan(120);                                                           // far apart in green, not two warm tints
  });
  it('an edge arrow sits inside the screen edge toward the point; a point behind the camera is mirrored', () => {
    const right = edgeArrowAt({ x: 2000, y: 300, visible: true }, 800, 600);
    expect(right.angle).toBeCloseTo(0); expect(right.x).toBeCloseTo(800 - 36); expect(right.y).toBeCloseTo(300);
    const behind = edgeArrowAt({ x: 2000, y: 300, visible: false }, 800, 600);
    expect(Math.abs(behind.angle)).toBeCloseTo(Math.PI); expect(behind.x).toBeCloseTo(36);
  });
});
describe('the faint overlay (T15 fix round 1)', () => {
  it('shows the true loss (wallet and part credit at risk), or a neutral line when it is not known', () => {
    expect(faintMessage(24)).toEqual({ title: 'Fainted!', line: 'You lost 24 DNA. Your body and parts stay.' });
    expect(faintMessage(0)).toEqual({ title: 'Fainted!', line: 'No DNA was lost. Your body and parts stay.' });
    expect(faintMessage(null)).toEqual({ title: 'Fainted!', line: 'Waking up at the start. Your body and parts stay.' });
  });
});

describe('the alpha bar (spec §9.3)', () => {
  it('shows the name, the HP fraction and the phase while the player is inside 1.5 x the lair radius of the alpha\'s lair', () => {
    const eco = new Ecosystem(5), mother = eco.entities.find(e => e.spec.key === '1:clawmother')!, ai = newAiState(1, mother.id);
    ai.home = { x: mother.x, y: mother.y, z: mother.z }; ai.phase = 1; mother.hp = 40;
    const c = { entity: mother, maxHp: 80, behaviour: BEHAVIOURS.clawmother!, ai } as unknown as EntityCombat, edge = 1.5 * 1.2 * 10.08;
    const at = (d: number) => ({ x: mother.x + d, y: mother.y, z: mother.z });
    expect(alphaView([c], at(edge - .1))).toEqual({ name: 'Old Clawmother', fraction: .5, phase: 1, phases: 3 });
    expect(alphaView([c], at(edge + .1))).toBeNull();
    mother.eaten = true; expect(alphaView([c], at(1))).toBeNull();
    mother.eaten = false; ai.home = null; expect(alphaView([c], at(1))).toBeNull();   // before its first AI tick
    const crab = eco.entities.find(e => e.spec.key === '1:crab')!; expect(alphaView([{ ...c, entity: crab, behaviour: BEHAVIOURS.crab! } as unknown as EntityCombat], { x: crab.x, z: crab.z })).toBeNull();
  });
});

// Final review M4 / item i: a threat marker never sits on the depth label or the growth card; it moves the shortest way off them, inside bounds.
import { avoidKeepOut } from '../../src/tiny-tide/combat-hud';
describe('threat marker keep-out (final review M4)', () => {
  const depth = { left: 280, top: 200, right: 316, bottom: 214 }, bounds = { minX: 20, maxX: 300, minY: 100, maxY: 508 };
  const overlaps = (x: number, y: number, half: number, h: number, b: typeof depth) => x - half < b.right && b.left < x + half && y - h < b.bottom && b.top < y;
  it('moves a marker off the depth label by the shortest way and keeps it in bounds', () => {
    const p = avoidKeepOut(290, 230, 20, 52, [depth], bounds);
    expect(overlaps(p.x, p.y, 20, 52, depth)).toBe(false);
    expect(p.x).toBeGreaterThanOrEqual(bounds.minX); expect(p.x).toBeLessThanOrEqual(bounds.maxX); expect(p.y).toBeGreaterThanOrEqual(bounds.minY); expect(p.y).toBeLessThanOrEqual(bounds.maxY);
    expect(Math.hypot(p.x - 290, p.y - 230)).toBeLessThan(70);
  });
  it('leaves a clear marker where it is, and clears two boxes at once', () => {
    expect(avoidKeepOut(100, 300, 20, 52, [depth], bounds)).toEqual({ x: 100, y: 300 });
    const card = { left: 150, top: 100, right: 300, bottom: 160 }, p = avoidKeepOut(290, 210, 20, 52, [depth, card], bounds);
    expect(overlaps(p.x, p.y, 20, 52, depth) || overlaps(p.x, p.y, 20, 52, card)).toBe(false);
  });
});
