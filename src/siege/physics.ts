import RAPIER from '@dimforge/rapier3d-compat';
import { ammoAt, DEMO_QUEUE, fortressLayout, GRAVITY, LAUNCH, launchVelocity, normalizePull, trajectory, TURN_SECONDS, WIN_PERCENT, type BuildingSpec, type AmmoId, type ProjectileKind, type Pull, type StoneSpec, type Vector3 } from './layout';

import { MATERIALS, damageToMaterial, type MaterialId } from './materials';

export interface Stone { spec: StoneSpec; body: RAPIER.RigidBody; original: Vector3; destroyed: boolean; shattered: boolean; health: number }
export interface BuildingState { spec: BuildingSpec; stones: Stone[]; awarded: boolean }
export interface BonusEvent extends Vector3 { name: string; points: number }
export interface Shot {
  id: number; kind: ProjectileKind; body: RAPIER.RigidBody; age: number;
  lastVelocity: Vector3; usedSpecial: boolean; impacted: boolean; expired: boolean; contacts: number;
  hitColliders: Set<number>;
}
export interface Burst extends Vector3 { kind: ProjectileKind | MaterialId; strength: number }
export interface RoundOptions { shotLimit?: number; sequence?: readonly AmmoId[] }
interface Impact { shot: Shot; ground: boolean; stone?: Stone; energy: number }

type ExplosiveKind = 'bomb' | 'rocket' | 'watermelon' | 'powder';
const DAMAGE_MULTIPLIER = 2;
const BLASTS: Record<ExplosiveKind, { radius: number; force: number }> = {
  bomb: { radius: 5.2, force: 28 },
  watermelon: { radius: 6.2, force: 42 },
  rocket: { radius: 4, force: 22 },
  powder: { radius: 2.8, force: 11 },
};
// A cow can knock out light walls, but should lose momentum against masonry.
const PROJECTILE_RADIUS: Record<ProjectileKind, number> = {
  cow: .78, rocket: .68, bomb: .68, catapult: .8, watermelon: .5, bowling: .68,
};
const COW_DENSITY = 3;
const PROJECTILE_DENSITY: Record<ProjectileKind, number> = {
  cow: COW_DENSITY, rocket: 2, bomb: 2.5, watermelon: 1, bowling: 14,
  // Account for collider volume so the actual mass, not just density, is 75%.
  catapult: COW_DENSITY * .75 * (PROJECTILE_RADIUS.cow / PROJECTILE_RADIUS.catapult) ** 3,
};

export class SiegeSimulation {
  world: RAPIER.World;
  events = new RAPIER.EventQueue(true);
  stones: Stone[] = [];
  shots: Shot[] = [];
  bursts: Burst[] = [];
  bonuses: BonusEvent[] = [];
  buildings: BuildingState[] = [];
  score = 0;
  private stoneHandles = new Map<number, Stone>();
  private pendingPowder: Vector3[] = [];
  private pendingImpacts: Impact[] = [];
  layout: ReturnType<typeof fortressLayout>;
  shotCount = 0;
  time = 0;
  readonly shotLimit: number | null;
  readonly sequence: readonly AmmoId[];
  private nextId = 0;
  private cooldown = 0;
  private projectileHandles = new Map<number, Shot>();
  private groundHandle: number;

  constructor(seed: number, options: RoundOptions = {}) {
    this.shotLimit = Number.isFinite(options.shotLimit) && options.shotLimit! > 0 ? Math.floor(options.shotLimit!) : null;
    this.sequence = options.sequence?.length ? options.sequence : DEMO_QUEUE;
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = 1 / 60;
    this.world.numSolverIterations = 12;
    this.groundHandle = this.world.createCollider(RAPIER.ColliderDesc.cuboid(100, 1, 100).setTranslation(0, -1, 0).setFriction(.85)).handle;
    this.layout = fortressLayout(seed);
    for (const spec of this.layout.stones) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spec.x, spec.y, spec.z).setLinearDamping(.3).setAngularDamping(.5));
      const substance = MATERIALS[spec.material];
      const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(spec.w / 2 - .008, spec.h / 2 - .008, spec.d / 2 - .008)
        .setDensity(substance.density).setFriction(substance.friction).setRestitution(.04), body);
      const stone: Stone = { spec, body, original: { x: spec.x, y: spec.y, z: spec.z }, destroyed: false, shattered: false, health: substance.integrity };
      this.stones.push(stone); this.stoneHandles.set(collider.handle, stone);
    }
    this.buildings = this.layout.buildings.map(spec => ({ spec, stones: this.stones.filter(s => s.spec.building === spec.id), awarded: false }));
    for (let n = 0; n < 180; n++) this.world.step();
    for (const stone of this.stones) { stone.original = { ...stone.body.translation() }; stone.body.sleep(); }
  }

  get destruction() { return Math.round(this.stones.filter(s => s.destroyed).length / this.stones.length * 100); }
  get won() { return this.destruction >= WIN_PERCENT; }
  get currentAmmo() { return ammoAt(this.shotCount, this.sequence); }
  get nextAmmo() { return this.shotsLeft === 0 || this.shotsLeft === 1 ? null : ammoAt(this.shotCount + 1, this.sequence); }
  get shotsLeft() { return this.shotLimit === null ? null : Math.max(0, this.shotLimit - this.shotCount); }
  get turnReady() { return this.cooldown <= 0; }
  get canFire() { return this.turnReady && this.shotsLeft !== 0; }
  get exhausted() { return this.turnReady && this.shotsLeft === 0 && !this.won; }
  get activeShot() { return [...this.shots].reverse().find(s => !s.expired && !s.usedSpecial && !s.impacted && ['rocket', 'bomb', 'catapult'].includes(s.kind)); }

  launch(input: Pull, power = 75) {
    const pull = normalizePull(input.x, input.y);
    if (!this.canFire || Math.hypot(pull.x, pull.y) < .12) return false;
    this.spawnShot(this.currentAmmo, LAUNCH, launchVelocity(pull, power));
    this.shotCount++; this.cooldown = TURN_SECONDS;
    return true;
  }

  private spawnShot(kind: ProjectileKind, position: Vector3, velocity: Vector3) {
    const radius = PROJECTILE_RADIUS[kind];
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z).setLinvel(velocity.x, velocity.y, velocity.z)
      .setCcdEnabled(true).setAngularDamping(.1));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.ball(radius)
      .setDensity(PROJECTILE_DENSITY[kind])
      .setFriction(.65).setRestitution(kind === 'cow' ? .28 : .08)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    const shot: Shot = { id: this.nextId++, kind, body, age: 0, lastVelocity: { ...velocity }, usedSpecial: false, impacted: false, expired: false, contacts: 0, hitColliders: new Set() };
    if (kind !== 'rocket' && kind !== 'bowling') body.setAngvel({ x: -1.7, y: .3, z: .2 }, true);
    this.projectileHandles.set(collider.handle, shot); this.shots.push(shot);
    return shot;
  }

  special() { const shot = this.activeShot; if (!shot) return false; this.activate(shot); return true; }
  private activate(shot: Shot) {
    if (shot.usedSpecial || shot.expired) return;
    shot.usedSpecial = true;
    const p = shot.body.translation(), v = shot.body.linvel();
    if (shot.kind === 'bomb') { this.explode(p, 'bomb'); this.expire(shot); }
    else if (shot.kind === 'rocket') {
      shot.body.setGravityScale(.2, true);
      shot.body.setLinvel({ x: v.x * 1.6, y: v.y * .28, z: v.z * 1.6 }, true);
      this.bursts.push({ ...p, kind: 'rocket', strength: .35 });
    } else if (shot.kind === 'catapult') {
      const remaining = this.stones.filter(s => !s.destroyed && s.spec.building === 'keep');
      const target = remaining.reduce((sum, s) => { const q = s.body.translation(); return { x: sum.x + q.x / remaining.length, y: 3, z: sum.z + q.z / remaining.length }; }, { x: 0, y: 3, z: 0 });
      if (!remaining.length) target.z = -12;
      const dx = target.x - p.x, dz = target.z - p.z, d = Math.max(.1, Math.hypot(dx, dz));
      this.spawnShot('watermelon', { x: p.x + dx / d * 1.4, y: p.y + 1.2, z: p.z + dz / d * 1.4 }, { x: dx / d * 23, y: 6, z: dz / d * 23 });
      this.bursts.push({ ...p, y: p.y + 1, kind: 'catapult', strength: .6 });
      shot.body.applyImpulse({ x: -dx / d * 12, y: -8, z: -dz / d * 12 }, true);
    }
  }
  private expire(shot: Shot) { shot.expired = true; shot.body.setEnabled(false); }

  explode(position: Vector3, kind: ExplosiveKind) {
    const { radius, force } = BLASTS[kind];
    this.bursts.push({ ...position, kind, strength: radius / 6 });
    const effects: { stone: Stone; damage: number; impulse: Vector3 }[] = [];
    for (const stone of this.stones) {
      if (stone.shattered) continue;
      const p = stone.body.translation(), dx = p.x - position.x, dy = p.y - position.y, dz = p.z - position.z;
      const centerDistance = Math.hypot(dx, dy, dz);
      const surface = stone.body.collider(0).projectPoint(position, true)!.point;
      const distance = Math.hypot(surface.x - position.x, surface.y - position.y, surface.z - position.z);
      if (distance >= radius) continue;
      const divisor = Math.max(centerDistance, .1);
      let exposure = 1;
      if (centerDistance > .1) {
        const hit = this.world.castRay(new RAPIER.Ray(position, { x: dx / centerDistance, y: dy / centerDistance, z: dz / centerDistance }), centerDistance, true, undefined, undefined, stone.body.collider(0), undefined,
          collider => { const obstacle = this.stoneHandles.get(collider.handle); return !!obstacle && !obstacle.shattered; });
        const obstacle = hit && this.stoneHandles.get(hit.collider.handle);
        if (obstacle) exposure = obstacle.spec.material === 'iron' || obstacle.spec.material === 'stone' ? .2 : obstacle.spec.material === 'glass' ? .8 : .5;
      }
      // No minimum force at the edge, and intact walls shield pieces behind them.
      const strength = (1 - distance / radius) ** 2 * exposure;
      const area = Math.pow(stone.spec.w * stone.spec.h * stone.spec.d, 2 / 3);
      const impulse = Math.min(8 * stone.body.mass(), force * strength * area * .9) * MATERIALS[stone.spec.material].blastImpulse;
      effects.push({ stone, damage: DAMAGE_MULTIPLIER * force * strength * 4, impulse: { x: dx / divisor * impulse, y: (dy / divisor + .3) * impulse, z: dz / divisor * impulse } });
    }
    // Resolve visibility before breaking anything so block order cannot amplify a blast.
    for (const effect of effects) {
      this.damage(effect.stone, effect.damage, 'blast');
      if (!effect.stone.shattered) effect.stone.body.applyImpulse(effect.impulse, true);
    }
  }

  private markDestroyed(stone: Stone) {
    if (stone.destroyed) return;
    stone.destroyed = true; this.score += MATERIALS[stone.spec.material].points;
  }

  damage(stone: Stone, energy: number, source: 'impact' | 'blast') {
    if (stone.shattered) return;
    stone.health -= damageToMaterial(stone.spec.material, energy, source);
    if (stone.health > 0) return;
    const p = { ...stone.body.translation() };
    stone.shattered = true; this.markDestroyed(stone); stone.body.setEnabled(false);
    if (stone.spec.material === 'powder') this.pendingPowder.push(p);
    else if (this.bursts.length < 18) this.bursts.push({ ...p, kind: stone.spec.material, strength: .2 });
  }

  aimTarget(pull: Pull, power: number) {
    let previous = LAUNCH;
    for (let i = 1; i <= 90; i++) {
      const p = trajectory(pull, i * .045, power);
      const delta = { x: p.x - previous.x, y: p.y - previous.y, z: p.z - previous.z };
      const length = Math.hypot(delta.x, delta.y, delta.z);
      const hit = this.world.castRay(new RAPIER.Ray(previous, { x: delta.x / length, y: delta.y / length, z: delta.z / length }), length, true, undefined, undefined, undefined, undefined, c => c.handle === this.groundHandle || this.stoneHandles.has(c.handle));
      if (hit) {
        const stone = this.stoneHandles.get(hit.collider.handle);
        return stone ? { stone, building: this.buildings.find(b => b.spec.id === stone.spec.building)!, point: { x: previous.x + delta.x / length * hit.toi, y: previous.y + delta.y / length * hit.toi, z: previous.z + delta.z / length * hit.toi } } : null;
      }
      if (p.y < 0) break;
      previous = p;
    }
    return null;
  }

  step() {
    this.shots = this.shots.filter(shot => {
      if (!shot.expired) return true;
      this.projectileHandles.delete(shot.body.collider(0).handle); this.world.removeRigidBody(shot.body); return false;
    });
    this.time += this.world.timestep; this.cooldown -= this.world.timestep;
    for (const shot of this.shots) if (!shot.expired) shot.lastVelocity = { ...shot.body.linvel() };
    // CCD reports first contact before its impulse is solved. Keep the bodies
    // intact for the next physics step so a heavy wall actually stops a shot.
    const impacts = this.pendingImpacts; this.pendingImpacts = [];
    this.world.step(this.events);
    this.events.drainCollisionEvents((a, b, started) => {
      if (!started) return;
      const shot = this.projectileHandles.get(a) ?? this.projectileHandles.get(b);
      if (!shot || shot.expired || shot.age <= .08) return;
      const other = this.projectileHandles.has(a) ? b : a;
      if (shot.hitColliders.has(other)) return;
      shot.hitColliders.add(other);
      const stone = this.stoneHandles.get(other);
      let energy = 0;
      if (stone) {
        // Local contact damage uses both masses and the speed into the surface.
        // Rapier handles momentum transfer; there is no extra radial shove.
        const v = shot.lastVelocity, projectileMass = shot.body.mass(), targetMass = stone.body.mass();
        let normalSpeed = 0;
        this.world.contactPair(shot.body.collider(0), stone.body.collider(0), manifold => {
          const n = manifold.normal();
          normalSpeed = Math.max(normalSpeed, Math.abs(v.x * n.x + v.y * n.y + v.z * n.z));
        });
        const effectiveMass = projectileMass * targetMass / (projectileMass + targetMass);
        energy = DAMAGE_MULTIPLIER * .065 * effectiveMass * normalSpeed ** 2;
      }
      this.pendingImpacts.push({ shot, ground: other === this.groundHandle, stone, energy });
    });
    for (const { shot, ground, stone, energy } of impacts) {
      if (shot.expired) continue;
      const p = shot.body.translation(); shot.contacts++; shot.impacted = true;
      // Soft/wooden ammunition sheds energy after its first thud instead of
      // rolling through the village like a perfectly rigid steel bearing.
      if (shot.kind === 'cow') { shot.body.setLinearDamping(3.2); shot.body.setAngularDamping(2); }
      else if (shot.kind === 'catapult') shot.body.setLinearDamping(1.5);
      else if (shot.kind === 'bowling' && ground) shot.body.setLinearDamping(.35);
      if (stone) this.damage(stone, energy, 'impact');
      if (shot.kind === 'bomb') this.activate(shot);
      else if (shot.kind === 'rocket') { this.explode(p, 'rocket'); this.expire(shot); }
      else if (shot.kind === 'watermelon') { this.explode(p, 'watermelon'); this.expire(shot); }
      else if (shot.kind === 'catapult') this.activate(shot);
      else if (!ground) this.bursts.push({ ...p, kind: shot.kind, strength: .4 });
      else if (shot.contacts === 1) this.bursts.push({ ...p, y: .2, kind: 'stone', strength: .5 });
    }
    for (const shot of this.shots) {
      if (shot.expired) continue;
      shot.age += this.world.timestep;
      const p = shot.body.translation();
      if (shot.kind === 'catapult' && !shot.usedSpecial && (p.z < 4 || shot.age > 2.2)) this.activate(shot);
      if (shot.kind === 'rocket' && !shot.usedSpecial && shot.age > .8) this.activate(shot);
      if (shot.age > 12 || Math.abs(p.x) > 85 || Math.abs(p.z) > 85 || p.y < -10 || p.y > 85) this.expire(shot);
    }
    // A queue bounds chain reactions: each powder barrel can detonate only once.
    while (this.pendingPowder.length) this.explode(this.pendingPowder.shift()!, 'powder');
    for (const stone of this.stones) {
      if (stone.destroyed) continue;
      const p = stone.body.translation(), r = stone.body.rotation();
      if (Math.hypot(p.x - stone.original.x, p.y - stone.original.y, p.z - stone.original.z) > .85 || Math.hypot(r.x, r.z) > .22) this.markDestroyed(stone);
    }
    this.awardBonuses();
  }
  private awardBonuses() {
    for (const building of this.buildings) {
      if (building.awarded || !building.spec.bonus || !building.stones.length) continue;
      const demolished = building.stones.filter(s => s.destroyed).length;
      const chest = building.spec.kind === 'treasury' && building.stones.some(s => s.spec.style === 'treasure' && s.destroyed);
      if (!chest && demolished / building.stones.length < .55) continue;
      building.awarded = true; this.score += building.spec.bonus;
      this.bonuses.push({ x: building.spec.x, y: building.spec.height, z: building.spec.z, name: building.spec.name, points: building.spec.bonus });
    }
  }
  dispose() { this.events.free(); this.world.free(); }
}
