// tests/tiny-tide-core/mount.test.ts
import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { bodyHull, bodyLengthOf, hullOffsets, massFor, resolveMount, sampleCombatPose, speciesActor, speciesCombatPose } from '../../src/tiny-tide/mount';
import { species } from '../../src/tiny-tide/species';
import { boneMatricesInto, createRigPose, restBoneMatrices, restRig, rigPoseInto, type RigPose } from '../../src/tiny-tide/rig';
import { layout, surface, SPACING } from '../../src/tiny-tide/body-geometry';
import { starterGenome, type Genome } from '../../src/tiny-tide/genome';
import { plan } from '../../src/tiny-tide/plans';
import type { Capsule } from '../../src/tiny-tide/combat-types';

const withPart = (id: string, t: number, angle: number, mirror = true, roll = 0): Genome => ({ ...starterGenome(), parts: [...starterGenome().parts, { uid: 'p9', id, t, angle, scale: 1, mirror, roll }] });
const pose = (g: Genome, rig: RigPose = restRig(g), world = new T.Matrix4()) => sampleCombatPose({ actorId: 'player', genome: g, plan: plan('speck')!, world, rig, physicalLength: bodyLengthOf(g) });
const ems = (g: Genome, rig?: RigPose, world?: T.Matrix4) => pose(g, rig, world).emitters.filter(e => e.source.kind === 'part' && e.source.partUid === 'p9');
/** Inside the capsule swept by any offset with |horizontal| ≤ sway and |vertical| ≤ heave. */
const inside = (p: T.Vector3, c: Capsule) => {
  for (let k = 0; k <= 64; k++) {
    const f = k / 64, s = new T.Vector3(c.start.x + (c.end.x - c.start.x) * f, c.start.y + (c.end.y - c.start.y) * f, c.start.z + (c.end.z - c.start.z) * f), d = p.clone().sub(s);
    const dh = Math.max(0, Math.hypot(d.x, d.z) - (c.sway ?? 0)), dv = Math.max(0, Math.abs(d.y) - (c.heave ?? 0));
    if (Math.hypot(dh, dv) <= c.radius + 1e-6) return true;
  }
  return false;
};
const extreme: Genome = { ...starterGenome(), spine: [{ radius: 1.2, height: .25, lift: .5 }, { radius: .25, height: 1.2, lift: -.5 }, { radius: 1.2, height: 1.2, lift: 0 }, { radius: .25, height: .25, lift: .5 }] };
const long: Genome = { ...starterGenome(), spine: Array.from({ length: 8 }, (_, i) => ({ radius: .3 + .1 * (i % 3), height: .3 + .1 * ((i + 1) % 3), lift: i % 2 ? .2 : -.2 })) };
/** The renderer's skinned vertices (bodyGeometry: 44 rings × 29 sides, linear blend of two bones). */
const skinned = (g: Genome, rig: RigPose) => {
  const l = layout(g), n = g.spine.length, rest = restBoneMatrices(g), posed = boneMatricesInto(rest.map(m => m.clone()), g, rig), out: T.Vector3[] = [];
  for (let ring = 0; ring <= 44; ring++) for (let side = 0; side <= 28; side++) {
    const t = (1 - Math.cos(Math.PI * ring / 44)) / 2, v = surface(g, l, t, side / 28 * Math.PI * 2).position;
    const f = (l.z[0]! - v.z) / SPACING, i = Math.max(0, Math.min(n - 2, Math.floor(f))), w = Math.max(0, Math.min(1, f - i));
    const a = v.clone().applyMatrix4(rest[i]!.clone().invert()).applyMatrix4(posed[i]!), b = v.clone().applyMatrix4(rest[i + 1]!.clone().invert()).applyMatrix4(posed[i + 1]!);
    out.push(a.multiplyScalar(1 - w).add(b.multiplyScalar(w)));
  }
  return out;
};

describe('mounts and combat poses', () => {
  it('places front mounts ahead and rear mounts behind', () => { expect(ems(withPart('claw_pincer', .1, 2))[0]!.origin.z).toBeGreaterThan(0); expect(ems(withPart('claw_pincer', .9, 2))[0]!.origin.z).toBeLessThan(0); });
  it('mirrors the second copy exactly at the rest pose, with reflection', () => {
    const [a, b] = ems(withPart('claw_pincer', .3, 2));
    expect(a!.origin.x).toBeCloseTo(-b!.origin.x); expect(a!.origin.y).toBeCloseTo(b!.origin.y); expect(a!.origin.z).toBeCloseTo(b!.origin.z); expect(a!.forward.x).toBeCloseTo(-b!.forward.x);
    expect(new T.Matrix4().fromArray([...b!.localToWorld]).determinant()).toBeLessThan(0);
  });
  it('animates each copy with its own phase', () => {
    const g = withPart('claw_pincer', .3, 2), rig = rigPoseInto(createRigPose(g), g, .7, 1, 0), [a, b] = ems(g, rig), [ra, rb] = ems(g);
    expect(Math.hypot(a!.origin.x - ra!.origin.x, a!.origin.y - ra!.origin.y, a!.origin.z - ra!.origin.z)).toBeGreaterThan(.01);
    expect(Math.abs(a!.origin.x + b!.origin.x)).toBeGreaterThan(1e-4);   // phases differ by π, so the animated copies are not mirror images
    expect(Math.hypot(b!.origin.x - rb!.origin.x, b!.origin.y - rb!.origin.y, b!.origin.z - rb!.origin.z)).toBeGreaterThan(.01);
  });
  it('keeps a tail socket at its authored point at rest, and moves it when the root segment bends', () => {
    const g = withPart('tail_paddle', 1, 0, false), m = resolveMount(g, g.parts[4]!, 0), authored = new T.Vector3(0, 1.1, 0).applyMatrix4(m.body);
    const rest = ems(g)[0]!; expect(rest.origin.x).toBeCloseTo(authored.x); expect(rest.origin.y).toBeCloseTo(authored.y); expect(rest.origin.z).toBeCloseTo(authored.z);
    const bent = restRig(g); bent.pivots.get('p9:0:seg:0')!.z = .5; const b = ems(g, bent)[0]!;
    expect(Math.hypot(b.origin.x - rest.origin.x, b.origin.y - rest.origin.y, b.origin.z - rest.origin.z)).toBeGreaterThan(.1);
  });
  it('rolls the part around its normal', () => {
    const a = ems(withPart('claw_pincer', .3, Math.PI / 2, false, 0))[0]!, b = ems(withPart('claw_pincer', .3, Math.PI / 2, false, Math.PI / 2))[0]!;
    expect(Math.hypot(a.forward.x - b.forward.x, a.forward.y - b.forward.y, a.forward.z - b.forward.z)).toBeGreaterThan(.5);
  });
  it('points the mouth forward and applies world scale once', () => {
    const bite = pose(starterGenome()).emitters.find(e => e.source.kind === 'part' && e.source.socketId === 'bite')!; expect(bite.forward.z).toBeCloseTo(1);
    const one = ems(withPart('claw_pincer', .1, 2))[0]!, four = ems(withPart('claw_pincer', .1, 2), undefined, new T.Matrix4().makeScale(4, 4, 4))[0]!;
    expect(four.origin.z).toBeCloseTo(one.origin.z * 4);
  });
  it('encloses the rest surface, including the starter regression point', () => {
    for (const g of [starterGenome(), extreme, long]) {
      const l = layout(g), hull = bodyHull(g);
      for (let i = 0; i <= 40; i++) for (let j = 0; j < 24; j++) { const p = surface(g, l, i / 40, j / 24 * Math.PI * 2).position; expect(hull.some(c => inside(p, { ...c, sway: 0, heave: 0 })), `t=${i / 40}`).toBe(true); }
    }
    const p = surface(starterGenome(), layout(starterGenome()), .425, Math.PI / 2).position;   // ≈ (.62010, .01966, .26768): outside a two-endpoint capsule by 1e-4
    expect(bodyHull(starterGenome()).some(c => inside(p, { ...c, sway: 0, heave: 0 }))).toBe(true);
  });
  it('encloses every skinned vertex in the animation envelope', () => {
    for (const g of [starterGenome(), extreme, long]) { const hull = bodyHull(g);
      for (const time of [0, .37, 1.3, 2.9]) for (const swim of [0, 1]) for (const chomp of [0, 1]) {
        const rig = rigPoseInto(createRigPose(g), g, time, swim, chomp);
        for (const v of skinned(g, rig)) expect(hull.some(c => inside(v, c)), `${g.spine.length} ${time} ${swim} ${chomp}`).toBe(true);
      }
    }
    expect(hullOffsets(starterGenome(), 2)[1]!.radius).toBeCloseTo(bodyHull(starterGenome())[1]!.radius * 2);
  });
  it('derives mass and resistance from the plan', () => {
    expect(massFor(plan('bulk')!, starterGenome(), 10)).toBeCloseTo(15); expect(pose(starterGenome()).knockbackResistance).toBe(0);
  });
  it('gives the renderer a reflected local transform for copy 1', () => {
    const g = withPart('claw_pincer', .3, 2), p = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3();
    resolveMount(g, g.parts[4]!, 1).local.decompose(p, q, s); expect(s.x).toBeLessThan(0);
  });
  it('scales a species actor by bodyScale and gives its pose a centre emitter at the hull centre (spec §5.10, §11.3)', () => {
    const crab = species(1, 'crab'), big = { id: 7, spec: { ...crab, bodyScale: 1.5 } };
    expect(speciesActor(big).hull[0]!.radius).toBeCloseTo(.35 * 4 * 1.5); expect(speciesActor(big).bodyLength).toBeCloseTo(4 * 1.5 * 1.4);
    expect(speciesActor({ id: 8, spec: crab }).hull[0]!.radius).toBeCloseTo(.35 * 4);
    const pose = speciesCombatPose({ ...big, x: 1, y: 2, z: 3, heading: Math.PI / 2 }, 0), centre = pose.emitters.find(e => e.source.kind === 'actor' && e.source.socketId === 'centre')!;
    expect(centre.origin).toEqual(pose.hull[0]!.start); expect(centre.origin.y).toBeCloseTo(2 + .35 * 6);
    expect(centre.forward.x).toBeCloseTo(1); expect(new T.Vector3().setFromMatrixPosition(new T.Matrix4().fromArray([...centre.localToWorld])).y).toBeCloseTo(centre.origin.y);
    expect(pose.emitters.map(e => e.source.kind === 'actor' && e.source.socketId)).toEqual(['root', 'centre']);
  });
});
