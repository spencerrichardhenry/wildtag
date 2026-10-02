// tests/tiny-tide-core/avoidance.test.ts
import { describe, expect, it } from 'vitest';
import { edgeEncounter, findEncounters, simulateEscape } from '../../src/tiny-tide/avoidance';
import { PLAYER_HALF, SIZES } from '../../src/tiny-tide/biomes';
import { EDGE_SOFT_START } from '../../src/tiny-tide/edge';
import { eligibleChildren, plan, ROOT_PLAN } from '../../src/tiny-tide/plans';
import { SPECIES } from '../../src/tiny-tide/species';

const visible = () => { const out: string[] = []; const walk = (path: string[]) => { out.push(path.at(-1)!); for (const c of eligibleChildren(path, { coast: false })) walk([...path, c.id]); }; walk([ROOT_PLAN]); return [...new Set(out)]; };
const never = { id: 'x', memorySeconds: 1e9, blockedWaitSeconds: 1e9, reacquireSeconds: 0, leashBodyLengths: 1e9, giveUpBodyLengths: 1e9 };
describe('avoidance', () => {
  it('fails against a much faster hunter that never forgets, on a verified encounter (negative control)', () => {
    const [e] = findEncounters('speck', '1:crab', 1); expect(e, 'no crab encounter for a Speck').toBeTruthy();
    expect(simulateEscape(e!, { speedScale: 3, policy: never })).toMatchObject({ ok: false, reason: 'hit' });
  });
  it('lets every visible plan run from every hunter of its size, in three real encounters', () => {
    const report: string[] = [];
    for (const id of visible()) { const p = plan(id)!; if (p.size === 4) continue;
      for (const s of SPECIES.filter(x => x.hunts.includes(p.size))) {
        const found = findEncounters(id, s.key, 3); expect(found.length, `${id} vs ${s.key}: only ${found.length} encounters`).toBe(3);
        for (const e of found) { const r = simulateEscape(e); report.push(`${id} vs ${s.key} seed ${e.seed} entity ${e.entityId}: ${r.reason} at ${r.seconds.toFixed(1)}s`); expect(r.ok, report.at(-1)).toBe(true); }
      }
    }
    console.log(report.join('\n'));
  }, 60_000);   // about 10 s alone: the crawler search recovers many mid-water candidates
  it('a player that flees outward from x = 38 into the edge current escapes: the hunter gives up at the push zone (owner ruling M11)', () => {
    const report: string[] = [];
    for (const [planId, hunterKey] of [['speck', '1:crab'], ['swimmer', '2:squid'], ['crawler', '2:squid'], ['darter', '2:squid']] as const) {
      let tried = 0;
      for (const seed of [1, 2, 3, 4]) {
        const e = edgeEncounter(planId, hunterKey, seed); if (!e) continue;
        tried++;
        const r = simulateEscape(e), size = SIZES[plan(planId)!.size]!;
        report.push(`${planId} vs ${hunterKey} seed ${seed}: start x ${(e.start.x / size).toFixed(1)}, hunter x ${(e.hunterStart.x / size).toFixed(1)}: ${r.reason} at ${r.seconds.toFixed(1)}s`);
        expect(e.start.x / size).toBeLessThan(EDGE_SOFT_START * PLAYER_HALF);
        expect(r.ok, report.at(-1)).toBe(true);
      }
      expect(tried, `${planId} vs ${hunterKey}: no edge encounter`).toBeGreaterThan(0);
    }
    console.log(report.join('\n'));
  }, 60_000);
});
