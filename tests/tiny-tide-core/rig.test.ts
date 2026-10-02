// tests/tiny-tide-core/rig.test.ts
import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { boneMatricesInto, createRigPose, PART_RIG, pivotToPart, restBoneMatrices, restPivotToPart, restRig, rigPoseInto } from '../../src/tiny-tide/rig';
import { starterGenome } from '../../src/tiny-tide/genome';

describe('rig data', () => {
  it('keys pivots by kind and index, with the tail chain from root to tip', () => {
    const paddle = PART_RIG.tail_paddle!;
    expect(paddle['seg:0']!.parent).toBeNull(); expect(paddle['seg:1']!.parent).toBe('seg:0');
    expect(paddle['seg:2']!.parent).toBe('seg:1'); expect(paddle['seg:3']!.parent).toBe('seg:2');
    expect(PART_RIG.mouth_nibbler!['jaw:0']).toBeTruthy(); expect(PART_RIG.claw_pincer!['swing:0']).toBeTruthy();
  });
  it('composes rest chains that agree with the independent Python matrices', () => {
    for (const [part, nodes] of Object.entries(PART_RIG)) for (const key of Object.keys(nodes)) {
      const mine = restPivotToPart(part, key).elements, python = nodes[key]!.rest;
      for (let i = 0; i < 16; i++) expect(mine[i]!, `${part} ${key} ${i}`).toBeCloseTo(python[i]!, 5);
    }
  });
  it('moves a tail tip when the root segment bends', () => {
    const rest = restPivotToPart('tail_paddle', 'seg:3'), out = new T.Matrix4();
    const bent = pivotToPart('tail_paddle', 'seg:3', k => k === 'seg:0' ? { x: 0, y: 0, z: .5 } : undefined, out);
    const a = new T.Vector3().setFromMatrixPosition(rest), b = new T.Vector3().setFromMatrixPosition(bent);
    expect(a.distanceTo(b)).toBeGreaterThan(.1);   // seg:3 sits well above seg:0, so a .5 rad bend moves it
  });
});
describe('rig pose', () => {
  it('matches the renderer formulas', () => {
    const g = starterGenome(), pose = rigPoseInto(createRigPose(g), g, 1, 1, .5), n = 4;
    expect(pose.chomp).toBe(.5);
    expect(pose.boneYaw[2]!).toBeCloseTo(.22 * Math.sin(7.7 - 1.8) * 2 / (n - 1));   // −.0548352441751
    expect(pose.pivots.get('p1:0:jaw:0')!.x).toBeCloseTo(-.325);                        // −.5 × .65
    const swing = (copy: 0 | 1) => Math.sin(1 * 7.7 * 1.4 + .45 * 4 + (copy ? Math.PI : 0)) * (.06 + .45);
    expect(pose.pivots.get('p4:0:swing:0')!.x).toBeCloseTo(swing(0)); expect(pose.pivots.get('p4:1:swing:0')!.x).toBeCloseTo(swing(1));
  });
  it('reuses its buffers and refuses another genome', () => {
    const g = starterGenome(), out = createRigPose(g), map = out.pivots;
    rigPoseInto(out, g, 2, 0, 0); expect(out.pivots).toBe(map);
    expect(() => rigPoseInto(out, starterGenome(), 0, 0, 0)).toThrow();
  });
  it('has a true rest pose', () => {
    const g = starterGenome(), r = restRig(g);
    expect([...r.boneYaw].every(v => v === 0)).toBe(true); expect([...r.pivots.values()].every(o => o.x === 0 && o.y === 0 && o.z === 0)).toBe(true);
  });
  it('nods only the head: bone 1 and later keep a vertical yaw axis', () => {
    const g = starterGenome(), pose = rigPoseInto(createRigPose(g), g, 0, 0, 1), m = boneMatricesInto(restBoneMatrices(g).map(x => x.clone()), g, pose);
    const up = new T.Vector3(0, 1, 0).transformDirection(m[2]!); expect(up.y).toBeCloseTo(1);
    const headUp = new T.Vector3(0, 1, 0).transformDirection(m[0]!); expect(headUp.y).toBeCloseTo(Math.cos(.12));
  });
  it('keeps the tail wave smooth while swim ramps at a late game time', () => {
    // swim ramps 0 → 1 and 1 → 0 over .3 s at 60 Hz, at time 1000 s. The tail yaw must not change faster per frame than
    // 1.5 × the largest per-frame change of steady swimming.
    const g = starterGenome(), tail = g.spine.length - 1, dt = 1 / 60, frames = 18;
    const stepsOf = (swimAt: (i: number) => number, count: number) => {
      const pose = createRigPose(g); let t = 1000, last = rigPoseInto(pose, g, t, swimAt(0), 0).boneYaw[tail]!, max = 0;
      for (let i = 1; i <= count; i++) { t += dt; const y = rigPoseInto(pose, g, t, swimAt(i), 0).boneYaw[tail]!; max = Math.max(max, Math.abs(y - last)); last = y; }
      return max;
    };
    const steady = stepsOf(() => 1, 240);
    expect(steady).toBeGreaterThan(.01);
    expect(stepsOf(i => Math.min(1, i / frames), 60)).toBeLessThanOrEqual(steady * 1.5);
    expect(stepsOf(i => Math.max(0, 1 - i / frames), 60)).toBeLessThanOrEqual(steady * 1.5);
  });
  it('keeps one phase per pose: two models at different swim levels do not share it', () => {
    const g = starterGenome(), a = createRigPose(g), b = createRigPose(g);
    for (let i = 0; i <= 60; i++) { rigPoseInto(a, g, 5 + i / 60, 1, 0); rigPoseInto(b, g, 5 + i / 60, 0, 0); }
    const fresh = rigPoseInto(createRigPose(g), g, 6, 0, 0);   // a fresh pose starts at phase = time × speed
    expect(fresh.boneYaw[2]!).toBeCloseTo(.05 * Math.sin(6 * 2.2 - 1.8) * 2 / 3);
    expect(b.boneYaw[2]!).toBeCloseTo(fresh.boneYaw[2]!, 9);   // b's phase did not advance with a's swim
  });
});
