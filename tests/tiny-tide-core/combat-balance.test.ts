// tests/tiny-tide-core/combat-balance.test.ts — spec §14.3: the combat balance probe. The full probe (P0–P8) is long and runs only with
// TIDE_COMBAT_PROBE=1; it writes .codex-drafts/tiny-tide-qa/combat-probe.json and combat-probe.md. A smoke version always runs.
// TIDE_PROBE_PARTS=p0,p1,… runs some parts only and writes combat-probe-part-<parts>.json as rows complete (several processes can run in
// parallel); TIDE_PROBE_MERGE=1 merges every part file into the report and checks the bars.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { attackSetup, attackTrial, hostileAttacks, journey, mergeReports, newWatch, onScreenFrom, probeMarkdown, PROBE_PARTS, runProbe, timeToKill, FULL_PROBE, type ProbePart, type ProbeReport } from '../../src/tiny-tide/combat-probe';

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
    expect(attackSetup('1:clawmother', 'mother-pinch-rage')).toMatchObject({ startId: 'mother-sweep', phase: 2 });
  });
  it('merges part files, reading a stored Infinity (null in JSON) back as Infinity', () => {
    const part = JSON.parse(JSON.stringify({ p8: { maxTokens: 2, minActiveGap: Infinity, minOffScreenWindup: Infinity, windups: 3, offScreen: 0, gapPair: '', pass: true } })) as Partial<ProbeReport>;
    const p8 = mergeReports([part, { p8: { maxTokens: 1, minActiveGap: .3, minOffScreenWindup: Infinity, windups: 1, offScreen: 0, gapPair: 'a → b', pass: true } }]).p8;
    expect(p8).toMatchObject({ maxTokens: 2, minActiveGap: .3, minOffScreenWindup: Infinity, windups: 4, pass: true });
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
  }, 12 * 60 * 60_000);
});
