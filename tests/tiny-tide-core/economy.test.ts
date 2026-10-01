// tests/tiny-tide-core/economy.test.ts
import { describe, expect, it } from 'vitest';
import { bankAll, commitDesign, earn, faintCombat, faintLegacy, legacyEconomy, quoteDesign, validateLedger, walletTotal, type Economy } from '../../src/tiny-tide/economy';
import { partCost, starterGenome, type Genome } from '../../src/tiny-tide/genome';
import { PARTS } from '../../src/tiny-tide/parts';

const fin = (scale = 1, uid = 'p9'): Genome['parts'][number] => ({ uid, id: 'fin_side', t: .5, angle: 1.8, scale, mirror: true, roll: 0 });
const withParts = (g: Genome, ...parts: Genome['parts']) => ({ ...g, parts: [...g.parts, ...parts] });
const resize = (g: Genome, uid: string, scale: number) => ({ ...g, parts: g.parts.map(p => p.uid === uid ? { ...p, scale } : p) });
const commit = (e: Economy, a: Genome, b: Genome) => { const r = commitDesign(e, a, b); if (!r.ok) throw new Error(`short ${r.shortfall}`); return r.economy; };
describe('DNA ledger', () => {
  it('grandfathers legacy parts as banked credit equal to their cost', () => {
    const g = starterGenome(), e = legacyEconomy(20, g);
    expect(e.wallet).toEqual({ banked: 20, atRisk: 0 });
    expect(e.parts.p2).toEqual({ basis: 18, credit: { banked: 18, atRisk: 0 } }); expect(validateLedger(e, g)).toEqual([]);
  });
  it('puts rewards at risk and spends at-risk credit first', () => {
    const g = starterGenome(), e = commit(earn(legacyEconomy(20, g), 15), g, withParts(g, fin()));   // fin pair costs 20
    expect(e.wallet).toEqual({ banked: 15, atRisk: 0 }); expect(e.parts.p9).toEqual({ basis: 20, credit: { banked: 5, atRisk: 15 } });
  });
  it('does not charge an unchanged design, even after a combat faint forfeits its credit', () => {
    const g = starterGenome(), bought = commit(earn(legacyEconomy(0, g), 20), g, withParts(g, fin())), after = faintCombat(bought);
    expect(after.parts.p9).toEqual({ basis: 20, credit: { banked: 0, atRisk: 0 } });
    expect(quoteDesign(after, withParts(g, fin()), withParts(g, fin()))).toMatchObject({ spend: 0, release: 0, net: 0, affordable: true });
    const removed = commit(after, withParts(g, fin()), g); expect(walletTotal(removed)).toBe(0);   // nothing to refund
    expect(quoteDesign(after, withParts(g, fin()), withParts(g, fin(1.8))).spend).toBe(8);          // 28 − 20
  });
  it('cross-finances a resize independent of array order (zero wallet)', () => {
    const g = starterGenome(), e = legacyEconomy(0, g);
    // tail p3: scale .8 (9) → 1.4 (12): buy 3. legs p4: .7 (14) → .4 (11): release floor(14 × 3/14) = 3.
    const to = resize(resize(g, 'p3', 1.4), 'p4', .4), reversed = { ...to, parts: [...to.parts].reverse() };
    for (const target of [to, reversed]) {
      const r = commit(e, g, target);
      expect(r.wallet).toEqual({ banked: 0, atRisk: 0 }); expect(r.parts.p3).toEqual({ basis: 12, credit: { banked: 12, atRisk: 0 } }); expect(r.parts.p4).toEqual({ basis: 11, credit: { banked: 11, atRisk: 0 } });
    }
    expect(quoteDesign(e, g, to)).toMatchObject({ spend: 3, release: 3, net: 0, affordable: true });
  });
  it('swaps two pair sizes without leaking DNA', () => {
    const g = withParts(starterGenome(), fin(.4, 'p9'), fin(1.8, 'p10')), e = legacyEconomy(0, g);   // 14 and 28
    const r = commit(e, g, resize(resize(g, 'p9', 1.8), 'p10', .4));    // p9 buys 14; p10 releases floor(28 × .5) = 14
    expect(walletTotal(r)).toBe(0); expect(r.parts.p9!.credit.banked + r.parts.p9!.credit.atRisk).toBe(28); expect(r.parts.p10!.basis).toBe(14);
  });
  it('rejects a short transaction with the shortfall and changes nothing', () => {
    const g = starterGenome(), e = legacyEconomy(5, g), r = commitDesign(e, g, withParts(g, fin()));
    expect(r).toEqual({ ok: false, shortfall: 15 }); expect(e.wallet).toEqual({ banked: 5, atRisk: 0 });
  });
  it('releases exactly the price difference on every fully credited shrink, for every part, pairing and size step', () => {
    for (const spec of PARTS) for (const mirror of spec.mirror ? [false, true] : [false]) for (let a = 40; a <= 180; a += 5) for (let b = 40; b < a; b += 5) {
      const at = (scale: number): Genome => ({ ...starterGenome(), parts: [{ uid: 'p9', id: spec.id, t: .5, angle: 1.6, scale: scale / 100, mirror, roll: 0 }] });
      const from = at(a), to = at(b), r = commit(legacyEconomy(0, from), from, to);
      expect(validateLedger(r, to), `${spec.id} ${mirror} ${a}→${b}`).toEqual([]);
      expect(walletTotal(r)).toBe(partCost(from.parts[0]!) - partCost(to.parts[0]!));
    }
  });
  it('handles the reported floating-point cases: 20→18, 15→14, 28→27', () => {
    for (const [a, b] of [[1, .8], [.5, .4], [1.8, 1.7]] as const) {
      const g = starterGenome(), from = withParts(g, fin(a)), to = withParts(g, fin(b)), r = commit(legacyEconomy(0, from), from, to);
      expect(validateLedger(r, to)).toEqual([]); expect(r.parts.p9!.credit.banked).toBe(r.parts.p9!.basis);
    }
  });
  it('releases shrink credit at-risk first', () => {
    const g = starterGenome(), e = commit(earn(legacyEconomy(20, g), 15), g, withParts(g, fin()));   // p9 credit {5, 15}
    const r = commit(e, withParts(g, fin()), withParts(g, fin(.4)));   // 20 → 14: release floor(20 × 6/20) = 6, all at risk
    expect(r.parts.p9).toEqual({ basis: 14, credit: { banked: 5, atRisk: 9 } }); expect(r.wallet).toEqual({ banked: 15, atRisk: 6 });
  });
  it('banks everything on evolution; legacy faint keeps 70% of each wallet part; combat faint zeroes at-risk credit', () => {
    const g = starterGenome(), e = commit(earn(legacyEconomy(50, g), 30), g, withParts(g, fin()));   // wallet {50, 10}, p9 {0, 20}
    expect(bankAll(e).wallet).toEqual({ banked: 60, atRisk: 0 }); expect(bankAll(e).parts.p9!.credit).toEqual({ banked: 20, atRisk: 0 });
    expect(faintLegacy(e).wallet).toEqual({ banked: 35, atRisk: 7 });
    const c = faintCombat(e); expect(c.wallet).toEqual({ banked: 50, atRisk: 0 }); expect(c.parts.p9!.credit).toEqual({ banked: 0, atRisk: 0 });
  });
  it('validates the ledger against the design', () => {
    const g = starterGenome(), e = legacyEconomy(0, g);
    expect(validateLedger({ ...e, parts: { ...e.parts, p2: { basis: 18, credit: { banked: 9999, atRisk: 0 } } } }, g)).toContain('ledger credit p2');
    const { p2: _p2, ...missing } = e.parts; expect(validateLedger({ ...e, parts: missing }, g)).toContain('ledger missing p2');
    expect(validateLedger({ ...e, parts: { ...e.parts, p9: { basis: 1, credit: { banked: 0, atRisk: 0 } } } }, g)).toContain('ledger extra p9');
    expect(validateLedger({ ...e, wallet: { banked: Number.NaN, atRisk: 0 } }, g)).toContain('ledger wallet');
    expect(validateLedger({ ...e, parts: { ...e.parts, p3: { basis: 4, credit: { banked: 4, atRisk: 0 } } } }, g)).toContain('ledger basis p3');
    expect(validateLedger({ ...e, wallet: { banked: .5, atRisk: 0 } }, g)).toContain('ledger wallet');
    expect(validateLedger({ ...e, wallet: { banked: Number.MAX_SAFE_INTEGER + 1, atRisk: 0 } }, g)).toContain('ledger wallet');
    expect(validateLedger({ ...e, parts: { ...e.parts, p3: { basis: 9, credit: { banked: 8.5, atRisk: 0 } } } }, g)).toContain('ledger credit p3');
  });
  it('never refunds an invalid existing ledger', () => {
    const g = starterGenome(), e = legacyEconomy(20, g), forged = { ...e, parts: { ...e.parts, p2: { basis: 18, credit: { banked: 9999, atRisk: 0 } } } };
    const noEyes = { ...g, parts: g.parts.filter(p => p.uid !== 'p2') }, r = commitDesign(forged, g, noEyes);
    expect(r).toMatchObject({ ok: false, shortfall: 0, invalid: ['ledger credit p2'] }); expect(forged.wallet).toEqual({ banked: 20, atRisk: 0 });
  });
});
