import { describe, expect, it } from 'vitest';
import { createChase, createGrandpa, earnStatue, parseReward, REST_INPUT, stepChase, stepGrandpa, tagGrandpa, updraftImpulse, type GrandpaInput, type GrandpaState, type GrandpaWorld } from '../src/grandpa/core.ts';
import { GRANDPA, TERRAIN, STRUCTURES } from '../src/core/constants.ts';
import * as THREE from 'three';
import { TrampolineSystem } from '../src/structures/trampolines.ts';
import { decodeSave, encodeSave, type SaveV3 } from '../src/core/save.ts';
import { createInventory } from '../src/craft/inventory.ts';
import { dartHitCritter, spawnDart, stepDart } from '../src/tracking/darts.ts';
const floor = TERRAIN.seaLevel + 10;
const start = { x: 0, y: floor, z: 0 };
const world: GrandpaWorld = { ground: { heightAt: () => floor, normalAt: () => ({ x: 0, y: 1, z: 0 }) }, obstacles: () => [] };
function run(state: GrandpaState, seconds: number, input: Partial<GrandpaInput> = {}, env = world): GrandpaState {
  for (let t = 0; t < seconds - .0001; t += 1 / 60) state = stepGrandpa(state, { ...REST_INPUT, ...input }, 1 / 60, env);
  return state;
}
describe('Grandpa movement through real fixed steps', () => {
  it('waddles slower than the child, with normalized diagonal speed', () => {
    const straight = run(createGrandpa(start), 3, { forward: 1 });
    const diagonal = run(createGrandpa(start), 3, { forward: 1, strafe: 1 });
    expect(Math.hypot(straight.vel.x, straight.vel.z)).toBeCloseTo(GRANDPA.walkSpeed);
    expect(Math.hypot(diagonal.vel.x, diagonal.vel.z)).toBeCloseTo(GRANDPA.walkSpeed);
    expect(straight.pos.z).toBeLessThan(-10);
  });
  it('charges, launches on release, travels, and lands with finite recovery', () => {
    const crouch = run(createGrandpa(start), .8, { vault: true });
    expect(crouch.grounded).toBe(true); expect(crouch.charge).toBeGreaterThan(.7);
    const flight = run(crouch, .7, { forward: 1 });
    expect(flight.pos.y - floor).toBeGreaterThan(8); expect(flight.pos.z).toBeLessThan(-8);
    expect(flight.updraft).toBeNull();
    const landed = run(flight, 4);
    expect(landed.grounded).toBe(true); expect(landed.pos.y).toBe(floor); expect(landed.energy).toBeLessThanOrEqual(100);
  });
  it('launches a fully charged vault at twice the original 21 m/s', () => {
    const charged = run(createGrandpa(start), 1, { vault: true });
    const launched = run(charged, 1 / 60, { forward: 1 });
    expect(Math.hypot(launched.vel.x, launched.vel.z)).toBeCloseTo(42);
    expect(run(launched, .5).pos.z).toBeLessThan(-20);
  });
  it('normal jumps are free, do not accelerate to stunt speed, and do not stumble on landing', () => {
    let s = run(createGrandpa(start), .5, { forward: 1 });
    let peak = floor;
    for (let i = 0; i < 150; i++) {
      s = run(s, 1 / 60, { jumpId: 1, forward: 1 });
      peak = Math.max(peak, s.pos.y);
      expect(s.charge).toBe(0); expect(s.recovery).toBe(0);
      expect(Math.hypot(s.vel.x, s.vel.z)).toBeCloseTo(GRANDPA.walkSpeed);
    }
    expect(peak - floor).toBeGreaterThan(1.6); expect(peak - floor).toBeLessThan(2);
    expect(s.grounded).toBe(true); expect(s.energy).toBe(100);
    expect(run(s, .15, { jumpId: 2 }).grounded).toBe(false);
  });
  it('buffers a fresh jump just before landing and tolerates a late edge at a ledge', () => {
    const dropping = { ...createGrandpa({ ...start, y: floor + .3 }), grounded: false, vel: { x: 0, y: -5, z: 0 } };
    const jumped = run(dropping, .1, { jumpId: 1 });
    expect(jumped.vel.y).toBeGreaterThan(7); expect(jumped.recovery).toBe(0);
    const env = { ...world, ground: { ...world.ground, heightAt: (_x: number, z: number) => z > -2 ? floor + 6 : floor } };
    let s = run(createGrandpa({ ...start, y: floor + 6 }), .5, { forward: 1 }, env);
    expect(s.grounded).toBe(false);
    s = run(s, 1 / 60, { jumpId: 1, forward: 1 }, env);
    expect(s.vel.y).toBeGreaterThan(8);
  });
  it('walks continuous mountain slopes without repeatedly stumbling and can charge downhill', () => {
    for (const slope of [-1.4, -.4, .4, 1.4]) {
      const h = (x: number, z: number) => floor + 40 + slope * z + Math.sin(z * 3) * .12 + x * .2;
      const env = { ...world, ground: { ...world.ground, heightAt: h } };
      let s = createGrandpa({ x: 0, y: h(0, 0), z: 0 });
      for (let n = 0; n < 180; n++) {
        s = stepGrandpa(s, { ...REST_INPUT, forward: 1 }, 1 / 60, env);
        expect(s.grounded).toBe(true);
        expect(s.recovery).toBe(0);
        expect(s.pos.y).toBeCloseTo(h(s.pos.x, s.pos.z));
      }
      expect(s.pos.z).toBeLessThan(-14);
      s = run(s, .8, { forward: 1, vault: true }, env);
      expect(s.charge).toBeGreaterThan(.75);
      const launched = run(s, .2, { forward: 1 }, env);
      expect(launched.grounded).toBe(false);
      expect(launched.vel.y).toBeGreaterThan(0);
      expect(launched.pos.y).toBeGreaterThanOrEqual(h(launched.pos.x, launched.pos.z));
    }
  });
  it('falls off real ledges and does not magnetize airborne stunts to the floor', () => {
    const env = { ...world, ground: { ...world.ground, heightAt: (_x: number, z: number) => z > -2 ? floor + 6 : floor } };
    let s = run(createGrandpa({ ...start, y: floor + 6 }), .6, { forward: 1 }, env);
    expect(s.pos.z).toBeLessThan(-2); expect(s.grounded).toBe(false); expect(s.pos.y).toBeGreaterThan(floor + 4);
    s = run(s, 1, { forward: 1 }, env);
    expect(s.grounded).toBe(true); expect(s.pos.y).toBe(floor);
    const descending = { ...createGrandpa({ ...start, y: floor + .5 }), grounded: false, vel: { x: 0, y: -1, z: 0 } };
    expect(run(descending, 1 / 60).grounded).toBe(false);
  });
  it('rewards a timed landing press with one smaller rebound', () => {
    let s = run(createGrandpa(start), .8, { vault: true }); s = run(s, .1);
    while (!(s.vel.y < 0 && s.pos.y < floor + 1.5)) s = run(s, 1 / 60);
    let rebounded = false;
    for (let n = 0; n < 30; n++) { const old = s.vel.y; s = run(s, 1 / 60, { vault: true }); if (old < 0 && s.vel.y > 0) rebounded = true; }
    expect(rebounded).toBe(true); expect(s.canRebound).toBe(false);
  });
  it('sneezes backward after a readable windup, then its updraft expires', () => {
    let s = run(createGrandpa(start), .3, { sneeze: true });
    expect(s.sneezeWindup).toBeGreaterThan(0); expect(s.pos.z).toBeCloseTo(0);
    s = run(s, .7, { sneeze: true });
    expect(s.pos.z).toBeGreaterThan(2); expect(s.pos.y).toBeGreaterThan(floor + 2);
    expect(s.updraft).not.toBeNull(); expect(s.sneezeSerial).toBe(1);
    expect(updraftImpulse(s.updraft, start, 0, 1 / 60)?.y).toBeGreaterThan(0);
    expect(updraftImpulse(s.updraft, { ...start, x: 20 }, 0, 1 / 60)).toBeNull();
    s = run(s, 8, { sneeze: true }); expect(s.updraft).toBeNull(); expect(s.sneezeSerial).toBe(1);
  });
  it('zooms at four times running speed for six seconds, can jump, and requires a fresh press after 30 seconds', () => {
    let s = run({ ...createGrandpa(start), energy: 0 }, .3, { sprintId: 1, forward: 1 });
    expect(s.sprintRemaining).toBeCloseTo(5.7167, 3);
    expect(Math.hypot(s.vel.x, s.vel.z)).toBeCloseTo(20.8);
    s = run(s, .2, { sprintId: 1, forward: 1, jumpId: 1 });
    expect(s.grounded).toBe(false); expect(s.vel.z).toBeCloseTo(-20.8);
    s = run(s, 5.6, { sprintId: 1, forward: 1 });
    expect(s.sprintRemaining).toBe(0); expect(s.sprintCooldown).toBeGreaterThan(23);
    expect(s.vel.z).toBeCloseTo(-5.2); expect(s.recovery).toBe(0);
    s = run(s, 24, { sprintId: 1, forward: 1 });
    expect(s.sprintCooldown).toBe(0); expect(s.sprintRemaining).toBe(0);
    s = run(s, .1, { sprintId: 2, forward: 1 }); expect(s.sprintRemaining).toBeGreaterThan(5.8);
    expect(s.updraft).toBeNull();
  });
  it('respects obstacles and shared architectural collision', () => {
    const env = { ...world, obstacles: () => [{ x: 0, z: -5, r: 2, yTop: floor + 10 }] };
    const s = run(createGrandpa(start), 2, { forward: 1 }, env);
    expect(s.pos.z).toBeGreaterThanOrEqual(-5 + 2 + GRANDPA.radius - .01);
    let calls = 0;
    run(s, .2, { forward: 1 }, { ...world, resolve: (_a, b) => { calls++; return b; } });
    expect(calls).toBe(12);
  });
  it('cannot keep climbing by holding all movement abilities', () => {
    const s = run(createGrandpa(start), 20, { vault: true, sneeze: true, sprintId: 1, jumpId: 1 });
    expect(s.energy).toBeGreaterThanOrEqual(0); expect(s.pos.y).toBeLessThan(floor + 30);
    expect(s.sneezeSerial).toBe(1);
  });
  it('a normal jump lands on a real trampoline and repeated bounces reach the same apex', () => {
    const tramps = new TrampolineSystem(new THREE.Scene(), world.ground, { kits: { trampoline: 1, skytramp: 1 } });
    tramps.place(start, 'ground');
    const env = { ...world, bounce: (a: typeof start, b: typeof start, vy: number) => tramps.sweptBounce(a, b, vy, GRANDPA.gravity) };
    let s = createGrandpa(start), peak = floor;
    for (let n = 0; n < 900; n++) {
      s = run(s, 1 / 60, { jumpId: 1 }, env); peak = Math.max(peak, s.pos.y);
    }
    expect(s.bounceSerial).toBeGreaterThan(3); expect(s.energy).toBe(100);
    expect(peak).toBeCloseTo(floor + .9 + STRUCTURES.trampolineBounceFactor * STRUCTURES.droneHover, 0);
    tramps.place({ ...start, x: 10 }, 'sky');
    const fastFall = { ...createGrandpa({ x: 10, y: floor + STRUCTURES.droneHover + .4, z: 0 }), grounded: false, vel: { x: 0, y: -100, z: 0 } };
    const bounced = run(fastFall, 1 / 60, {}, env);
    expect(bounced.bounceSerial).toBe(1); expect(bounced.vel.y).toBeGreaterThan(40);
    expect(bounced.pos.y).toBe(floor + STRUCTURES.droneHover);
    expect(tramps.sweptBounce({ ...start, y: floor }, { ...start, y: floor - 1 }, -10, GRANDPA.gravity)).toBeNull();
    expect(tramps.sweptBounce({ ...start, y: floor }, { ...start, y: floor + 2 }, 10, GRANDPA.gravity)).toBeNull();
  });
});
describe('tag, track, surrender, and one permanent statue', () => {
  it('requires a tag and holds progress across escapes', () => {
    expect(stepChase(createChase(), 100, true).phase).toBe('roaming');
    const tagged = tagGrandpa(createChase());
    const partial = stepChase(tagged, 3, true);
    expect(stepChase(partial, 100, false)).toEqual(partial);
    expect(tagGrandpa(partial)).toEqual(partial);
    const caught = stepChase(partial, 30, true);
    expect(caught.phase).toBe('caught'); expect(tagGrandpa(caught)).toEqual(caught);
    const again = stepChase(caught, 5, false);
    expect(again.phase).toBe('roaming'); expect(tagGrandpa(again).progress).toBe(0);
  });
  it('actual dart ballistics intersect the creature body', () => {
    let dart = spawnDart({ x: 0, y: floor + 1.65, z: 0 }, { x: 0, y: .2, z: -1 });
    let hit: number | null = null;
    for (let i = 0; i < 60 && hit === null; i++) { dart = stepDart(dart, 1 / 60, world.ground); hit = dartHitCritter(dart, [{ id: -900000001, pos: { x: 0, y: floor + 3.3, z: -9 }, size: 1.6 }]); }
    expect(hit).toBe(-900000001);
  });
  it('never duplicates or replaces an already placed reward on repeat catches', () => {
    const reward = { caught: true, statue: { pos: start, yaw: .3 } };
    expect(earnStatue(reward)).toBe(reward);
    expect(earnStatue({ caught: false, statue: null })).toEqual({ caught: true, statue: null });
    expect(parseReward({ caught: true, statue: { pos: { x: NaN, y: 0, z: 0 }, yaw: 0 } })).toEqual({ caught: true, statue: null });
  });
  it('round-trips the trophy and shared trampolines without changing legacy saves', () => {
    const legacy: SaveV3 = { v: 3, inventory: createInventory(), unlocks: [], critterPersist: {}, structures: { ziplines: [], drones: [] }, player: { pos: start, yaw: 0 }, hints: [] };
    expect(decodeSave(encodeSave(legacy))?.grandpa).toBeUndefined();
    const save = { ...legacy, grandpa: { caught: true, statue: { pos: start, yaw: .3 } }, structures: { ...legacy.structures, trampolines: [{ id: 't0', kind: 'ground' as const, x: 5, z: 6 }] } };
    const loaded = decodeSave(encodeSave(save));
    expect(loaded?.grandpa).toEqual(save.grandpa); expect(loaded?.structures.trampolines).toEqual(save.structures.trampolines);
  });
});
