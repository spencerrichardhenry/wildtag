// tests/tiny-tide-core/feeding.test.ts — spec §8.3: the basic dispatch rule and today's chomp.
import { describe, expect, it } from 'vitest';
import { SIZES } from '../../src/tiny-tide/biomes';
import { biteDispatch, biteTargets, chomp } from '../../src/tiny-tide/feeding';
import { derive, effectiveStats } from '../../src/tiny-tide/genome';
import { currentPlan } from '../../src/tiny-tide/state';
import { species } from '../../src/tiny-tide/species';
import { speciesCombatPose } from '../../src/tiny-tide/mount';
import { FX_FLEER, FX_HUNTER } from './combat-fixture';
import { entity, speck, tick } from './combat-fixture-world';

describe('feeding', () => {
  it('bite when a combat species is in the cone, else chomp', () => {
    const s = speck(), front = entity(1, FX_HUNTER, { x: 0, y: 1 - .35 * SIZES[1]!, z: 3 }), behind = entity(2, FX_HUNTER, { x: 0, y: 1 - .35 * SIZES[1]!, z: -6 });
    expect(tick(s, [front], 0, { basicPressed: true, basicHeld: true })).toMatchObject({ r: { started: ['bite'], chomp: false } });
    const t = speck();
    expect(tick(t, [behind], 0, { basicPressed: true, basicHeld: true })).toMatchObject({ r: { started: [], chomp: true } });
    // The cone is the Bite range × 1.25: the Snapper reaches .6 L (L 2.43, from the bite socket at z 1.61); × 1.25 → 1.82. A tier-0 body
    // (hull radius .35) at 1.61 + 1.82 + .3 is inside; at 1.61 + 1.82 + .4 it is not.
    for (const [z, chomps] of [[1.61 + 1.82 + .3, false], [1.61 + 1.82 + .4, true]] as const) {
      const u = speck(), prey = entity(3, FX_FLEER, { x: 0, y: .65, z });
      expect(tick(u, [prey], 0, { basicPressed: true, basicHeld: true }).r.chomp, `z ${z}`).toBe(chomps);
    }
  });
  it('the dispatch takes only a live combat species of the stage or the stage + 1', () => {
    const cone = { kind: 'cone' as const, apex: { x: 0, y: 1, z: 0 }, axis: { x: 0, y: 0, z: 1 }, range: 10, halfAngle: 1 }, hurt = (e: Parameters<typeof speciesCombatPose>[0]) => speciesCombatPose(e, 0).hurtboxes;
    const at = (id: number, spec = FX_HUNTER) => entity(id, spec, { x: 0, y: 0, z: 4 });
    expect(biteDispatch(cone, [at(1)], 0, () => true, hurt)?.id).toBe(1);
    expect(biteDispatch(cone, [at(1)], 0, () => false, hurt)).toBeNull();
    expect(biteDispatch(cone, [{ ...at(2), eaten: true }, { ...at(3), active: false }, at(4, { ...FX_HUNTER, tier: 2 })], 0, () => true, hurt)).toBeNull();
    expect(biteDispatch(cone, [at(5, FX_FLEER)], 1, () => true, hurt)).toBeNull();
    expect(biteDispatch({ ...cone, axis: { x: 0, y: 0, z: -1 } }, [at(6)], 0, () => true, hurt)).toBeNull();
  });
  it('combat species are never chomp targets', () => {
    const s = speck(), prey = entity(4, FX_FLEER, { x: 0, y: .65, z: 1.8 }), d = derive(effectiveStats(s.run.genome, currentPlan(s.run)));
    expect(biteTargets(s.run, [prey], s.physical, 1, d).targets).toEqual([]);
    const legacy = entity(5, species(0, 'copepod'), { x: 0, y: .65, z: 1.8 });
    expect(biteTargets(s.run, [legacy], s.physical, 1, d).targets.map(t => t.entity.id)).toEqual([5]);
  });
  it('legacy species keep chomp damage', () => {
    // A bigger legacy fighter that is attacking (the ray, until 3b) takes max(1, floor(bite / 2)) from a chomp.
    const s = speck(), d = derive(effectiveStats(s.run.genome, currentPlan(s.run))); s.run.stage = 1; s.physical = { x: 0, y: 4, z: 0 };
    const ray = entity(6, species(2, 'ray'), { x: 0, y: 4, z: 4 }); ray.mode = 'angry';
    const eco = { entities: [ray], consume: () => undefined, planetIndex: () => 0 };
    expect(chomp(s.run, eco, s.physical, 1, d, 0, [])).toMatchObject({ kind: 'bitten', damage: Math.max(1, Math.floor(d.bite / 2)) });
    expect(ray.hp).toBe(species(2, 'ray').hp - Math.max(1, Math.floor(d.bite / 2)));
  });
});
