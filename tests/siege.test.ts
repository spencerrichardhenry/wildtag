import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { AMMO, fortressLayout, LAUNCH, launchVelocity, normalizePull, trajectory } from '../src/siege/layout';
import { MATERIALS, damageToMaterial, type MaterialId } from '../src/siege/materials';
import { SiegeSimulation } from '../src/siege/physics';

beforeAll(async () => { await RAPIER.init(); });
const advance = (sim: SiegeSimulation, seconds: number) => { for (let i = 0; i < seconds * 60; i++) sim.step(); };
function isolatedSimulation() {
  const sim = new SiegeSimulation(42);
  for (const stone of sim.stones) stone.body.setEnabled(false);
  return sim;
}
function placeBlock(sim: SiegeSimulation, material: MaterialId, x: number, y: number, z: number, w = 1, h = 1, d = 1) {
  const stone = sim.stones.find(s => s.spec.material === material && !s.body.isEnabled())!;
  stone.body.setEnabled(true); stone.body.collider(0).setShape(new RAPIER.Cuboid(w / 2, h / 2, d / 2));
  stone.body.setTranslation({ x, y, z }, true); stone.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  stone.body.setGravityScale(0, true); stone.original = { x, y, z };
  Object.assign(stone.spec, { w, h, d });
  return stone;
}

describe('Royal Yeet 3D slingshot', () => {
  it('reproduces a seeded fortress with real depth and four towers', () => {
    expect(fortressLayout(42)).toEqual(fortressLayout(42));
    const { stones } = fortressLayout(42);
    expect(new Set(stones.map(s => s.z)).size).toBeGreaterThan(5);
    expect(stones.filter(s => s.flag)).toHaveLength(5);
    expect(new Set([1, 2, 3, 4, 5, 6].map(seed => JSON.stringify(fortressLayout(seed).stones))).size).toBe(6);
  });
  it('keeps generated castles upright before a shot', () => {
    for (const seed of [1, 42, 1234, 55555, 99999]) {
      const sim = new SiegeSimulation(seed); advance(sim, 8);
      expect(sim.destruction, `seed ${seed}`).toBe(0);
      const roof = sim.stones.find(s => s.spec.style === 'roof')!;
      expect(roof.body.translation().y).toBeGreaterThan(8);
      sim.dispose();
    }
  }, 30000);
  it('uses drag for direction and the separate slider for speed', () => {
    expect(launchVelocity({ x: -.5, y: .42 }).x).toBeGreaterThan(0);
    expect(launchVelocity({ x: .5, y: .42 }).x).toBeLessThan(0);
    const low = launchVelocity({ x: -.3, y: .3 }, 40), high = launchVelocity({ x: -.3, y: .3 }, 90);
    expect(Math.hypot(high.x, high.y, high.z)).toBeGreaterThan(Math.hypot(low.x, low.y, low.z));
    expect(Math.atan2(low.x, -low.z)).toBeCloseTo(Math.atan2(high.x, -high.z));
    const otherDirection = launchVelocity({ x: .5, y: .6 }, 90);
    expect(Math.hypot(otherDirection.x, otherDirection.y, otherDirection.z)).toBeCloseTo(Math.hypot(high.x, high.y, high.z));
    expect(normalizePull(Infinity, NaN)).toEqual({ x: 0, y: 0 });
  });
  it('matches the guide to a projectile moving across all three coordinates', () => {
    const sim = new SiegeSimulation(42);
    const pull = { x: -.4, y: .42 };
    expect(sim.launch(pull)).toBe(true); advance(sim, .5);
    const p = sim.shots[0]!.body.translation(), preview = trajectory(pull, .5);
    expect(Math.abs(p.x - preview.x)).toBeLessThan(.1);
    expect(Math.abs(p.y - preview.y)).toBeLessThan(.1);
    expect(Math.abs(p.z - preview.z)).toBeLessThan(.1);
    expect(p.z).toBeLessThan(LAUNCH.z); expect(p.x).toBeGreaterThan(1);
    sim.dispose();
  });
  it('advances current and next only after a valid launch, with unlimited demo shots', () => {
    const sim = new SiegeSimulation(42);
    expect(sim.currentAmmo).toBe('cow'); expect(sim.nextAmmo).toBe('rocket');
    expect(sim.launch({ x: .03, y: .05 })).toBe(false);
    expect(sim.currentAmmo).toBe('cow'); expect(sim.shotCount).toBe(0);
    expect(sim.launch({ x: 0, y: .42 })).toBe(true);
    expect(sim.currentAmmo).toBe('rocket'); expect(sim.nextAmmo).toBe('bomb');
    expect(sim.launch({ x: 0, y: .42 })).toBe(false);
    expect(sim.shotCount).toBe(1); advance(sim, 4);
    expect(sim.canFire).toBe(true); expect(sim.shotsLeft).toBeNull();
    sim.dispose();
  });
  it.each(AMMO.map(a => a.id))('%s can damage the castle from the slingshot', kind => {
    const sim = new SiegeSimulation(42, { sequence: [kind] });
    sim.launch({ x: -.18, y: .42 }); advance(sim, 8);
    expect(sim.stones.some(s => s.destroyed || s.health < MATERIALS[s.spec.material].integrity)).toBe(true);
    expect(sim.destruction).toBeLessThan(12); expect(sim.shotCount).toBe(1);
    sim.dispose();
  });
  it('fires a secondary watermelon toward the fortress without using another queue item', () => {
    const sim = new SiegeSimulation(42, { sequence: ['catapult', 'bomb'] });
    sim.launch({ x: -.2, y: .42 }); advance(sim, .5);
    expect(sim.special()).toBe(true); expect(sim.special()).toBe(false);
    const melon = sim.shots.find(s => s.kind === 'watermelon')!;
    expect(melon.body.linvel().z).toBeLessThan(0);
    expect(sim.shotCount).toBe(1); expect(sim.currentAmmo).toBe('bomb');
    advance(sim, 5); expect(sim.bursts.some(b => b.kind === 'watermelon')).toBe(true);
    sim.dispose();
  });
  it('gives the catapult 75% of the cow mass despite its larger collider', () => {
    const sim = new SiegeSimulation(42, { sequence: ['cow', 'catapult'] });
    sim.launch({ x: 1, y: .25 });
    const cowMass = sim.shots[0]!.body.mass();
    advance(sim, 4); sim.launch({ x: 1, y: .25 });
    expect(sim.shots.find(s => s.kind === 'catapult')!.body.mass() / cowMass).toBeCloseTo(.75, 5);
    sim.dispose();
  });
  it('detonates the secondary watermelon once on impact and blasts nearby blocks', () => {
    const sim = new SiegeSimulation(42, { sequence: ['catapult', 'bomb'] });
    for (const stone of sim.stones) stone.body.setEnabled(false);
    const target = placeBlock(sim, 'iron', 42, .5, 40);
    sim.launch({ x: 0, y: .42 }); advance(sim, .5); sim.special();
    const melon = sim.shots.find(s => s.kind === 'watermelon')!;
    // Drop the fired melon beside an isolated block, outside direct contact.
    melon.body.setTranslation({ x: 40, y: 2, z: 40 }, true);
    melon.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    advance(sim, 2);
    expect(target.health).toBeLessThan(MATERIALS.iron.integrity);
    expect(sim.bursts.filter(b => b.kind === 'watermelon')).toHaveLength(1);
    expect(sim.shots.some(s => s.kind === 'watermelon')).toBe(false);
    expect(sim.shotCount).toBe(1); expect(sim.currentAmmo).toBe('bomb');
    sim.dispose();
  });
  it('makes watermelon blasts stronger and wider than classic bombs', () => {
    const results = (['bomb', 'watermelon'] as const).map(kind => {
      const sim = isolatedSimulation();
      const close = placeBlock(sim, 'iron', 42, 5, 40);
      const outer = placeBlock(sim, 'timber', 40, 5, 46);
      sim.step(); sim.explode({ x: 40, y: 5, z: 40 }, kind);
      const result = { damage: MATERIALS.iron.integrity - close.health, push: Math.hypot(...Object.values(close.body.linvel())), outerDamage: MATERIALS.timber.integrity - outer.health };
      sim.dispose(); return result;
    });
    expect(results[1]!.damage).toBeGreaterThan(results[0]!.damage * 1.5);
    expect(results[1]!.push).toBeGreaterThan(results[0]!.push);
    expect(results[0]!.outerDamage).toBe(0);
    expect(results[1]!.outerDamage).toBeGreaterThan(0);
  });
  it('stops a cow at the first market stall instead of bowling through the buildings behind it', () => {
    const sim = new SiegeSimulation(42);
    const stall = sim.buildings.find(b => b.spec.kind === 'market')!;
    const dx = stall.spec.x, dz = stall.spec.z + stall.spec.depth / 2 - LAUNCH.z;
    const range = Math.hypot(dx, dz), dy = 1.3 - LAUNCH.y, speed = 36;
    const elevation = Math.atan((speed ** 2 - Math.sqrt(speed ** 4 - 12 * (12 * range ** 2 + 2 * dy * speed ** 2))) / (12 * range));
    sim.launch({ x: -Math.atan2(dx, -dz) / .68, y: (elevation - .05) / .8 }, 100);
    advance(sim, 6);
    expect(stall.stones.some(s => s.destroyed)).toBe(true);
    expect(sim.buildings.filter(b => b.stones.some(s => s.destroyed)).map(b => b.spec.id)).toEqual([stall.spec.id]);
    const v = sim.shots[0]!.body.linvel();
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(1);
    sim.dispose();
  });
  it('stops at a finite shot budget and resolves the final shot before exhaustion', () => {
    const sim = new SiegeSimulation(42, { shotLimit: 2 });
    expect(sim.shotsLeft).toBe(2);
    sim.launch({ x: 1, y: .25 }); advance(sim, 4);
    expect(sim.shotsLeft).toBe(1); expect(sim.nextAmmo).toBeNull();
    sim.launch({ x: 1, y: .25 }); expect(sim.exhausted).toBe(false);
    expect(sim.shotsLeft).toBe(0); advance(sim, 5);
    expect(sim.canFire).toBe(false); expect(sim.exhausted).toBe(true);
    expect(sim.launch({ x: 0, y: .42 })).toBe(false); expect(sim.shotCount).toBe(2);
    sim.dispose();
  });
  it('can win using the actual queue and pull gestures', () => {
    const sim = new SiegeSimulation(42);
    for (let i = 0; i < 80 && !sim.won; i++) {
      const groups = sim.buildings.filter(b => b.stones.some(s => !s.destroyed));
      const group = groups[i % groups.length]!;
      const remaining = group.stones.filter(s => !s.destroyed);
      // Work through exposed supports now that a shot cannot blast through rows of buildings.
      remaining.sort((a, b) => a.body.translation().y - b.body.translation().y || b.body.translation().z - a.body.translation().z);
      const support = remaining[Math.min(i % 3, remaining.length - 1)]!;
      const target = { ...support.body.translation() }; target.z += support.spec.d / 2;
      const dx = target.x - LAUNCH.x, dz = target.z - LAUNCH.z, range = Math.hypot(dx, dz), dy = target.y - LAUNCH.y;
      const speed = 36, discriminant = speed ** 4 - 12 * (12 * range ** 2 + 2 * dy * speed ** 2);
      if (discriminant < 0) continue;
      const elevation = Math.atan((speed ** 2 - Math.sqrt(discriminant)) / (12 * range));
      sim.launch({ x: -Math.atan2(dx, -dz) / .68, y: (elevation - .05) / .8 }, 100);
      advance(sim, 4.5);
    }
    expect(sim.won, `damage: ${sim.destruction}`).toBe(true); sim.dispose();
  }, 90000);
  it('generates a varied village with different structural materials', () => {
    const layout = fortressLayout(42);
    expect(layout.buildings.length).toBe(10);
    expect(new Set(layout.buildings.map(b => b.kind)).size).toBeGreaterThanOrEqual(9);
    expect(new Set(layout.stones.map(s => s.material)).size).toBe(5);
    expect(layout.buildings.some(b => b.kind === 'treasury' && b.bonus === 600)).toBe(true);
    const other = fortressLayout(43);
    expect(layout.buildings.find(b => b.kind === 'windmill')!.x).not.toBe(other.buildings.find(b => b.kind === 'windmill')!.x);
  });
  it('models distinct material weights and blast resistance', () => {
    const sim = new SiegeSimulation(42);
    for (const id of ['timber', 'stone', 'iron', 'glass'] as const) {
      const s = sim.stones.find(s => s.spec.material === id)!;
      expect(s.body.collider(0).density()).toBeCloseTo(MATERIALS[id].density);
      sim.damage(s, 90, 'blast');
      expect(s.shattered).toBe(id === 'timber' || id === 'glass');
    }
    expect(damageToMaterial('iron', 100, 'blast')).toBeLessThan(damageToMaterial('iron', 100, 'impact'));
    sim.dispose();
  });
  it('lets heavy walls slow a cow before they break, without damaging off-path blocks', () => {
    const forwardSpeeds: number[] = [];
    for (const material of ['timber', 'stone', 'iron'] as const) {
      const sim = isolatedSimulation();
      const wall = placeBlock(sim, material, 0, 3.6, 12, 3, 4, 2);
      const bystander = placeBlock(sim, 'timber', 4, 3.6, 12);
      sim.launch({ x: 0, y: .13 });
      for (let i = 0; i < 120 && !sim.shots[0]!.impacted; i++) sim.step();
      const cow = sim.shots[0]!;
      expect(cow.impacted).toBe(true);
      forwardSpeeds.push(-cow.body.linvel().z);
      expect(wall.shattered).toBe(true);
      expect(bystander.health).toBe(MATERIALS.timber.integrity);
      expect(bystander.body.linvel()).toEqual({ x: 0, y: 0, z: 0 });
      sim.dispose();
    }
    expect(forwardSpeeds[0]).toBeGreaterThan(10);
    expect(forwardSpeeds[1]).toBeLessThan(10);
    expect(forwardSpeeds[2]).toBeLessThan(2);
    expect(forwardSpeeds[0]).toBeGreaterThan(forwardSpeeds[1]!);
    expect(forwardSpeeds[1]).toBeGreaterThan(forwardSpeeds[2]!);
  });
  it('shatters fragile materials near a bomb while iron and distant blocks survive', () => {
    const sim = isolatedSimulation();
    const timber = placeBlock(sim, 'timber', 41.5, 5, 40);
    const glass = placeBlock(sim, 'glass', 38.5, 5, 40);
    const iron = placeBlock(sim, 'iron', 40, 5, 38.5);
    const distant = placeBlock(sim, 'timber', 40, 5, 46);
    sim.step(); sim.explode({ x: 40, y: 5, z: 40 }, 'bomb');
    expect(timber.shattered).toBe(true); expect(glass.shattered).toBe(true);
    expect(iron.shattered).toBe(false); expect(iron.health).toBeGreaterThan(100);
    expect(Math.hypot(...Object.values(iron.body.linvel()))).toBeLessThan(2.5);
    expect(distant.health).toBe(MATERIALS.timber.integrity);
    expect(distant.body.linvel()).toEqual({ x: 0, y: 0, z: 0 });
    sim.dispose();
  });
  it('lets intact masonry shield timber behind it from a blast', () => {
    for (const shielded of [false, true]) {
      const sim = isolatedSimulation();
      const timber = placeBlock(sim, 'timber', 44, 5, 40);
      if (shielded) placeBlock(sim, 'stone', 41.1, 5, 40, .6, 3, 3);
      sim.step(); sim.explode({ x: 40, y: 5, z: 40 }, 'bomb');
      expect(timber.shattered).toBe(!shielded);
      if (shielded) expect(timber.health).toBeGreaterThan(0);
      sim.dispose();
    }
  });
  it('chains powder explosions once and awards building bonuses once', () => {
    const sim = new SiegeSimulation(42);
    const barrels = sim.stones.filter(s => s.spec.material === 'powder');
    sim.damage(barrels[0]!, 100, 'impact'); sim.step();
    expect(barrels.every(s => s.shattered)).toBe(true);
    expect(sim.bursts.filter(b => b.kind === 'powder')).toHaveLength(3);
    advance(sim, 4);
    expect(sim.destruction).toBeLessThan(12);
    expect(sim.buildings.filter(b => b.awarded).every(b => b.spec.kind === 'powder-store')).toBe(true);
    const treasury = sim.buildings.find(b => b.spec.kind === 'treasury')!;
    const chest = treasury.stones.find(s => s.spec.style === 'treasure')!;
    sim.damage(chest, 10000, 'impact'); sim.step();
    expect(treasury.awarded).toBe(true);
    expect(sim.bonuses.filter(b => b.name === treasury.spec.name)).toHaveLength(1);
    const score = sim.score; sim.damage(chest, 10000, 'impact'); sim.step();
    expect(sim.bonuses.filter(b => b.name === treasury.spec.name)).toHaveLength(1);
    expect(sim.score).toBeGreaterThanOrEqual(score);
    expect(sim.bursts.filter(b => b.kind === 'powder')).toHaveLength(3);
    sim.dispose();
  });
  it('cleans up projectile bodies during repeated turns', () => {
    const sim = new SiegeSimulation(42, { sequence: ['bomb'] }); const bodies = sim.world.bodies.len();
    for (let i = 0; i < 8; i++) { sim.launch({ x: 0, y: .25 }); advance(sim, .2); sim.special(); advance(sim, 4); }
    expect(sim.shots).toHaveLength(0); expect(sim.world.bodies.len()).toBe(bodies); expect(sim.shotCount).toBe(8);
    sim.dispose();
  });
});
