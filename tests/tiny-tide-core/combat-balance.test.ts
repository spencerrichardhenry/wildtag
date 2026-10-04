// tests/tiny-tide-core/combat-balance.test.ts — spec §14.3: the combat balance probe. The full probe (P0–P8) is long and runs only with
// TIDE_COMBAT_PROBE=1; it writes .codex-drafts/tiny-tide-qa/combat-probe.json and combat-probe.md. A smoke version always runs.
// TIDE_PROBE_PARTS=p0,p1,… runs some parts only and writes combat-probe-part-<parts>.json as rows complete (several processes can run in
// parallel); TIDE_PROBE_MERGE=1 merges every part file into the report and checks the bars.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { attackSetup, attackTrial, makeRun, hostileAttacks, isProbeHunter, P5_HUNTER_FLOOR, P9_BUILDS, p9Spread, ttkPass, journey, mergeReports, newWatch, onScreenFrom, probeMarkdown, PROBE_PARTS, runProbe, timeToKill, FULL_PROBE, P9_MATCHED, P9_TARGETED, p9Bar, type ProbePart, type ProbeReport } from '../../src/tiny-tide/combat-probe';

const FULL = process.env.TIDE_COMBAT_PROBE === '1';
const OUT = '.codex-drafts/tiny-tide-qa';
describe('combat probe (smoke)', () => {
  it('sees a point in front of the camera and not one behind it', () => {
    expect(onScreenFrom({ x: 0, y: 0, z: 0 }, 0, 1, { x: 0, y: 0, z: 3 })).toBe(true);
    expect(onScreenFrom({ x: 0, y: 0, z: 0 }, 0, 1, { x: 0, y: 0, z: -8 })).toBe(false);
  });
  it('lists every hostile attack at sizes 0 and 1, and measures a chain-only attack through its parent', () => {
    const ids = hostileAttacks().map(a => `${a.size}:${a.attackId}`);
    expect(ids).toContain('0:crab-lunge'); expect(ids).toContain('1:squid-grab'); expect(ids).toContain('0:mother-pinch');
    expect(attackSetup('1:clawmother', 'mother-pinch-2')).toMatchObject({ startId: 'mother-pinch', bandSource: 'parent' });
    expect(attackSetup('1:clawmother', 'mother-pinch-rage')).toMatchObject({ startId: 'mother-sweep', phase: 2, band: [0, .4] });   // the sweep band, cut at the rage pinch's reach
  });
  it('merges part files, reading a stored Infinity (null in JSON) back as Infinity', () => {
    const part = JSON.parse(JSON.stringify({ p8: { maxTokens: 2, minActiveGap: Infinity, minOffScreenWindup: Infinity, windups: 3, offScreen: 0, gapPair: '', pass: true } })) as Partial<ProbeReport>;
    const p8 = mergeReports([part, { p8: { maxTokens: 1, minActiveGap: .3, minOffScreenWindup: Infinity, windups: 1, offScreen: 0, gapPair: 'a → b', pass: true } }]).p8;
    expect(p8).toMatchObject({ maxTokens: 2, minActiveGap: .3, minOffScreenWindup: Infinity, windups: 4, pass: true });
  });
  // Final review I1: P5 has a lower bar for the hunters so the stun-lock cannot come back: with the skilled meat bot, each hunter's median
  // time to kill is at least 8 s and the hunter starts at least one attack after its first stagger (median over fights).
  it('applies the P5 hunter floor to the hunters only', () => {
    expect(['1:crab', '2:squid', '2:eel'].every(isProbeHunter)).toBe(true);
    expect(['1:puffer', '1:sardine', '0:drifter', '1:clawmother', '2:reef_tyrant'].some(isProbeHunter)).toBe(false);
    expect(P5_HUNTER_FLOOR).toEqual({ minMedianSeconds: 8, minAttacksAfterStagger: 1 });
    expect(ttkPass('1:crab', 20, 5.5, 3)).toBe(false);    // too quick: the review's stun-lock median
    expect(ttkPass('1:crab', 20, 9, 0)).toBe(false);      // no attack after the first stagger
    expect(ttkPass('1:crab', 20, 9, 1)).toBe(true);
    expect(ttkPass('1:crab', 20, 21, 1)).toBe(false);     // the upper bar still holds
    expect(ttkPass('1:puffer', 10, 3, 0)).toBe(true);     // not a hunter: upper bar only
  });
  it('P9 (final review I6): builds every tradeoff build at sizes 0 and 1 and reports the damage spread per hunter', () => {
    for (const b of P9_BUILDS) expect(() => makeRun(11000, b.build(1))).not.toThrow();
    for (const b of P9_BUILDS) try { makeRun(11000, b.build(0)); } catch (e) { expect(String(e)).toMatch(/^Error: probe build /); }   // the size-0 body may refuse a part (locked, too complex)
    const row = (build: string, species: string, damage: number) => ({ build, species, size: 0, trials: 1, damage, ttk: 5, wins: 1, faints: 0 });
    expect(p9Spread([row('starter body', '1:crab', 4), row('brace (shell)', '1:crab', 2)]).find(x => x.species === '1:crab')).toEqual({ species: '1:crab', best: 'brace (shell)', worst: 'starter body', spread: 1 });
  });
  // Owner 2026-10-03 (follow-up F2, spec §11.8): per hunter, the matched build beats the worst build by ≥ 25 % in median time to kill or in
  // damage taken, and every build wins with at most 1 loss (a faint or the 90 s cap) per 10 fights.
  // Follow-up fix round 1 (review Important 2): also (a) the matched build is the fastest single-part build or within 10 % of it, (b) the build
  // the enemy's strength targets is at least 15 % slower than the matched one, (c) the Grab build has no Bite bonus, (d) the damage half needs a
  // difference of at least .5 half-heart.
  it('P9 bar: 25 % over the worst (time, or damage by ≥ .5 ½♥), (a) within 10 % of the fastest, (b) targeted ≥ 15 % slower, ≤ 1 loss in 10', () => {
    expect(P9_MATCHED).toEqual({ '1:crab': 'counter (spike)', '2:squid': 'sweep (fan tail)', '2:eel': 'counter (spike)' });
    expect(P9_TARGETED).toEqual({ '1:crab': 'starter body', '2:squid': 'brace (shell)', '2:eel': 'grab (pincer)' });
    const row = (build: string, ttk: number, damage: number, trials = 60, wins = 60) => ({ build, species: '1:crab', size: 0, trials, damage, ttk, wins, faints: trials - wins });
    const crab = (rows: ReturnType<typeof row>[]) => p9Bar(rows).find(x => x.species === '1:crab')!;
    const base = [row('starter body', 10, 0), row('dash (side fins)', 10.6, 0), row('grab (pincer)', 5.4, 0)];
    expect(crab([...base, row('counter (spike)', 5.0, 0)])).toMatchObject({ matched: 'counter (spike)', worst: 'dash (side fins)', fastest: 'counter (spike)', pass: true });
    expect(crab([...base, row('counter (spike)', 6.0, 0)]).pass).toBe(false);                                     // (a): 11 % over Grab 5.4
    expect(crab([row('starter body', 5.6, 0), row('dash (side fins)', 10.6, 0), row('counter (spike)', 5, 0)]).pass).toBe(false);   // (b): starter only 12 % slower
    expect(crab([row('starter body', 9.5, 2), row('counter (spike)', 8, 1.4)]).pass).toBe(true);                  // .6 ½♥ and 30 % less damage; (b) 18.75 %
    expect(crab([row('starter body', 9.5, .4), row('counter (spike)', 8, 0)]).pass).toBe(false);                  // (d): 100 % less, but only .4 ½♥
    expect(crab([...base, row('counter (spike)', 5, 0, 60, 53)]).pass).toBe(false);                               // 7 losses in 60
    expect(crab([...base, row('all four (shell, spike, pincer, tail Dash)', 3, 0), row('counter (spike)', 5, 0)]).pass).toBe(true);   // all four is not a single-part build
  });
  it('runs one trial of each measure', () => {
    const watch = newWatch();
    const dash = { label: 'dash', stage: 1 as const, line: 'swimmer' as const, mouths: ['mouth_nibbler', 'mouth_nibbler'] as [string, string], add: [{ id: 'fin_side', mirror: true }] };
    expect(attackTrial(1000, dash, '2:squid', 'squid-lunge', { reaction: .25, useMoves: false, still: true }, watch)).toBe('hit');
    expect(['avoided', 'mitigated', 'countered', 'hit']).toContain(attackTrial(1000, dash, '2:squid', 'squid-lunge', { reaction: .25, useMoves: true }, watch));
    const t = timeToKill(11000, { label: 'meat', stage: 0, line: 'swimmer', mouths: ['mouth_snapper', 'mouth_snapper'], add: [] }, '0:drifter', 18, watch);
    expect(t).toBeGreaterThan(0); expect(t).toBeLessThan(18);
    const j = journey('swimmer', 'carnivore', 11, 5, watch);
    expect(j.sizes[0]!.activeSeconds).toBeGreaterThan(4.9);
    expect(watch.maxTokens).toBeLessThanOrEqual(2);
    expect(watch.windups).toBeGreaterThan(0);
  }, 60_000);
});
const partsEnv = process.env.TIDE_PROBE_PARTS, merge = process.env.TIDE_PROBE_MERGE === '1';
describe.skipIf(!FULL)('combat probe (full, TIDE_COMBAT_PROBE=1)', () => {
  it('meets P0–P8', () => {
    mkdirSync(OUT, { recursive: true });
    let report: ProbeReport;
    if (merge) {
      const files = PROBE_PARTS.map(p => `${OUT}/combat-probe-part-${p}.json`).filter(f => existsSync(f));
      report = mergeReports(files.map(f => JSON.parse(readFileSync(f, 'utf8')) as Partial<ProbeReport>));
    } else {
      const parts = (partsEnv ? partsEnv.split(',') : PROBE_PARTS) as ProbePart[];
      report = runProbe(FULL_PROBE, parts, (part, partial) => writeFileSync(`${OUT}/combat-probe-part-${part}.json`, JSON.stringify(partial, null, 1)));
      if (partsEnv) return;   // a part run writes its part file only; the merge run checks the bars
    }
    writeFileSync(`${OUT}/combat-probe.json`, JSON.stringify(report, null, 1));
    writeFileSync(`${OUT}/combat-probe.md`, probeMarkdown(report));
    expect(report.p8.pass, 'P8 director invariants').toBe(true);
    expect(report.p0.filter(r => !r.pass).map(r => `${r.attackId}@${r.size}: ${r.near}/${r.mid}/${r.far}`), 'P0').toEqual([]);
    expect([...report.p1, ...report.p2, ...report.p3].filter(r => !r.pass).map(r => `${r.attackId}@${r.size}: ${r.share}`), 'P1–P3').toEqual([]);
    expect([...report.p5, ...report.p6].filter(r => !r.pass).map(r => `${r.build} ${r.species}: ${r.median}`), 'P5–P6').toEqual([]);
    expect(report.p7.filter(j => !j.pass).map(j => `${j.line} ${j.diet} ${j.seed}`), 'P7').toEqual([]);
    if (report.p9?.length) expect(p9Bar(report.p9).filter(x => !x.pass).map(x => `${x.species}: ${x.why}`), 'P9').toEqual([]);
  }, 12 * 60 * 60_000);
});
