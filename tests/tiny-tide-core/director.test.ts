// tests/tiny-tide-core/director.test.ts — spec §9.4 and plan review R6 (the grant estimate's delay).
import { describe, expect, it } from 'vitest';
import { Director, type TokenRequest } from '../../src/tiny-tide/director';

const req = (id: string, over: Partial<TokenRequest> = {}): TokenRequest => ({ actionInstanceId: id, attackerId: `e-${id}`, windupSeconds: .5, now: 0, grab: false, onScreen: true, playerHeld: false, ...over });
describe('director', () => {
  it('at most two tokens', () => {
    const d = new Director();
    expect(d.request(req('a')).ok).toBe(true); expect(d.request(req('b', { now: .3 })).ok).toBe(true);
    expect(d.request(req('c', { now: .6 }))).toEqual({ ok: false, reason: 'full', retryAt: .8 });
    d.release('a'); expect(d.request(req('c', { now: .6 })).ok).toBe(true);
  });
  it('active starts at least .25 s apart by extension', () => {
    const d = new Director(); d.request(req('a'));   // active at .5
    expect(d.request(req('b', { now: .1 }))).toEqual({ ok: true, extension: expect.closeTo(.15, 9) });   // .6 → .75
    expect(d.tokens.map(t => t.activeStart)).toEqual([.5, expect.closeTo(.75, 9)]);
    const e = new Director(); e.request(req('a', { windupSeconds: .6 }));   // active at .6
    expect(e.request(req('b', { windupSeconds: .45, now: 0 }))).toEqual({ ok: true, extension: expect.closeTo(.4, 9) });   // .45 is before .6: pushed to .85
  });
  it('extension never shortens and is at most .5 s', () => {
    // Off-screen .4 s wind-up: .6 s at least (ext .2, active .6); a token at .7 pushes it to .95: ext .55 > .5, refused.
    const d = new Director(); d.request(req('a', { windupSeconds: .7 }));
    expect(d.request(req('b', { windupSeconds: .4, onScreen: false }))).toEqual({ ok: false, reason: 'spacing', retryAt: .2 });
    const e = new Director(); e.request(req('a'));
    const r = e.request(req('b', { now: .5 }));   // active at 1.0, far from .5: no extension
    expect(r).toEqual({ ok: true, extension: 0 });
  });
  it('off-screen wind-up at least .6 s', () => {
    const d = new Director();
    expect(d.request(req('a', { windupSeconds: .45, onScreen: false }))).toEqual({ ok: true, extension: expect.closeTo(.15, 9) });
    expect(d.request(req('b', { windupSeconds: .7, onScreen: false, now: 2 }))).toEqual({ ok: true, extension: 0 });
  });
  it('grab only alone; none while held', () => {
    const d = new Director(); d.request(req('a'));
    expect(d.request(req('g', { grab: true, now: 1 }))).toEqual({ ok: false, reason: 'grab', retryAt: 1.2 });
    d.release('a'); expect(d.request(req('g', { grab: true, now: 1 })).ok).toBe(true);
    expect(new Director().request(req('x', { playerHeld: true }))).toEqual({ ok: false, reason: 'held', retryAt: .2 });
  });
  it('refused requests retry', () => {
    const d = new Director(); d.request(req('a')); d.request(req('b', { now: .3 }));
    const refused = d.request(req('c', { now: .4 }));
    expect(refused.ok).toBe(false); if (refused.ok) return;
    d.release('a');
    expect(d.request(req('c', { now: refused.retryAt })).ok).toBe(true);   // retried .2 s later
    d.releaseAll(); expect(d.tokens).toEqual([]);
  });
  it('R6: the estimate adds the delay (remaining hit-stop and one tick) to the active start; the off-screen minimum does not count it', () => {
    const d = new Director(), tick = 1 / 60;
    expect(d.request(req('a', { delay: tick }))).toEqual({ ok: true, extension: 0 });
    expect(d.tokens[0]!.activeStart).toBeCloseTo(.5 + tick, 9);
    // b without a delay would be active at .7, .2 s after a's real start (.5 + tick + .25 needs ext .0667); with it, the same gap holds.
    expect(d.request(req('b', { windupSeconds: .45, delay: tick }))).toEqual({ ok: true, extension: expect.closeTo(.3, 9) });
    expect(d.tokens[1]!.activeStart - d.tokens[0]!.activeStart).toBeCloseTo(.25, 9);
    const off = new Director();
    expect(off.request(req('c', { windupSeconds: .45, onScreen: false, delay: .1 }))).toEqual({ ok: true, extension: expect.closeTo(.15, 9) });
  });
  it('update moves a held token; holds and release follow the instance id', () => {
    const d = new Director(); d.request(req('a'));
    expect(d.holds('a')).toBe(true); expect(d.holds('b')).toBe(false);
    d.update('a', .7); expect(d.tokens[0]!.activeStart).toBe(.7);
    d.release('a'); expect(d.holds('a')).toBe(false);
  });
});
