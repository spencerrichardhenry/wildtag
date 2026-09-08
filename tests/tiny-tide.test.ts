import { describe, expect, it } from 'vitest';
import { canEat, DIETS, eat, freshRun, makeFood, parseSave, STAGES } from '../src/tiny-tide/state';

describe('Tiny Tide progression', () => {
  it('provides enough reachable food for every evolution', () => {
    for (let stage = 0; stage < 5; stage++) {
      const food = makeFood(stage);
      expect(food.length).toBeGreaterThanOrEqual(STAGES[stage]!.goal);
      expect(food.every(f => Math.abs(f.x) < 34 && Math.abs(f.z) < 34)).toBe(true);
      expect(new Set(food.map(f => f.id)).size).toBe(food.length);
    }
  });
  it('offers distinct edible choices in every habitat, with only planets in space', () => {
    for (let stage = 0; stage < 5; stage++) {
      const foods = makeFood(stage), kinds = new Set(foods.map(f => f.kind));
      expect([...kinds]).toEqual(DIETS[stage]);
      expect(kinds.size).toBeGreaterThanOrEqual(stage === 4 ? 1 : 4);
      for (const kind of kinds) {
        const food = foods.find(f => f.kind === kind)!;
        const run = { ...freshRun(), stage };
        expect(canEat(stage, food, food)).toBe(true);
        eat(run, food); expect(run.bites).toBe(1);
      }
    }
    expect(DIETS[4]).toEqual(['planet']);
  });
  it('requires proximity, the correct diet, and matching altitude', () => {
    const plant = makeFood(0)[0]!;
    expect(canEat(0, plant, plant)).toBe(true);
    expect(canEat(1, plant, plant)).toBe(false);
    expect(canEat(0, { x: 30, y: .7, z: 30 }, plant)).toBe(false);
    const bird = makeFood(2).find(f => f.kind === 'bird')!;
    expect(canEat(2, { ...bird, y: 2.2 }, bird)).toBe(false);
    expect(canEat(2, { ...bird, y: 8.3 }, bird)).toBe(true);
    const plane = makeFood(3).find(f => f.kind === 'plane')!;
    expect(canEat(3, { ...plane, y: 1.2 }, plane)).toBe(false);
    expect(canEat(3, { ...plane, y: 7 }, plane)).toBe(true);
  });
  it('evolves through every stage and wins only when every planet is eaten', () => {
    const run = freshRun();
    for (let stage = 0; stage < 5; stage++) {
      const foods = makeFood(stage).slice(0, STAGES[stage]!.goal);
      for (let i = 0; i < foods.length; i++) {
        expect(eat(run, foods[i]!)).toBe(i === foods.length - 1 ? stage === 4 ? 'win' : 'evolve' : 'bite');
        const total = run.total; eat(run, foods[i]!); expect(run.total).toBe(total);
      }
      if (stage < 4) { expect(run.completed).toBe(false); run.stage++; run.bites = 0; }
    }
    expect(run.completed).toBe(true); expect(run.total).toBe(64); expect(run.eatenPlanets).toHaveLength(12);
  });
  it('restores partial planet consumption without creating new planets', () => {
    const run = { ...freshRun(), stage: 4 };
    for (const f of makeFood(4).slice(0, 7)) eat(run, f);
    const restored = parseSave(JSON.stringify(run))!;
    expect(restored).toEqual(run);
    const remaining = makeFood(4).filter(f => !restored.eatenPlanets.includes(f.id));
    expect(remaining).toHaveLength(5);
    for (const f of remaining) eat(restored, f);
    expect(restored.completed).toBe(true);
  });
  it('ignores corrupt and inconsistent saves', () => {
    for (const value of [null, 'oops', '{}', JSON.stringify({ ...freshRun(), stage: -1 }), JSON.stringify({ ...freshRun(), stage: 8 }), JSON.stringify({ ...freshRun(), elapsed: -3 }), JSON.stringify({ ...freshRun(), completed: true }), JSON.stringify({ ...freshRun(), stage: 4, bites: 2, eatenPlanets: [0, 0] }), JSON.stringify({ ...freshRun(), stage: 4, bites: 2, eatenPlanets: [0, 13] }), JSON.stringify({ ...freshRun(), stage: 4, bites: 2, eatenPlanets: [] })]) expect(parseSave(value)).toBeNull();
  });
});
