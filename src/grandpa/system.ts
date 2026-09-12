import * as THREE from 'three';
import { GRANDPA } from '../core/constants.ts';
import type { Vec3 } from '../core/types.ts';
import type { Input } from '../player/input.ts';
import type { PlayerController } from '../player/controller.ts';
import { raycastTerrain } from '../player/grapple.ts';
import { blip, chime } from '../ui/audio.ts';
import { toast } from '../ui/toasts.ts';
import { createGrandpa, createChase, earnStatue, parseReward, REST_INPUT, stepChase, stepGrandpa, tagGrandpa, updraftImpulse, type GrandpaReward, type GrandpaState, type GrandpaWorld } from './core.ts';
import type { GrandpaNetwork, GrandpaSnapshot } from './network.ts';
import type { GrandpaUI } from './ui.ts';
import { GrandpaModel, makeChildAvatar } from './model.ts';
import { GrandpaControls } from './controls.ts';

interface GrandpaDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  input: Input;
  player: PlayerController;
  world: GrandpaWorld;
  net: GrandpaNetwork;
  ui: GrandpaUI;
  reward?: GrandpaReward;
  hostSnapshot(): Omit<GrandpaSnapshot, 'grandpa' | 'chase' | 'paused'>;
  raycast(a: Vec3, b: Vec3): Vec3 | null;
  save(): void;
}
export class GrandpaSystem {
  state: GrandpaState | null = null;
  chase = createChase();
  reward: GrandpaReward;
  readonly model = new GrandpaModel();
  private readonly child = makeChildAvatar();
  private statue: GrandpaModel | null = null;
  private ghost: GrandpaModel | null = null;
  private placePoint: Vec3 | null = null;
  private placeYaw = 0;
  private placementLabel = document.createElement('div');
  private label = document.createElement('div');
  private wind = new THREE.Group();
  private windRings: THREE.Mesh[] = [];
  private dartPoints: THREE.Points;
  private rope: THREE.Line;
  private accumulator = 0;
  private worldAccumulator = 0;
  private time = 0;
  private correction = new THREE.Vector3();
  private latestSneeze = 0;
  private latestCaught = 0;
  private close = false;
  private paused = false;
  private guestInput = { ...REST_INPUT };
  private visitCode = '';
  private readonly controls: GrandpaControls | null;

  constructor(private readonly d: GrandpaDeps) {
    this.controls = d.net.guest ? new GrandpaControls(d.input, () => !d.ui.isOpen, () => this.state) : null;
    this.reward = parseReward(d.reward);
    d.scene.add(this.model.root, this.child, this.wind);
    this.model.root.visible = false; this.child.visible = false;
    const windMat = new THREE.MeshBasicMaterial({ color: 0xb6f7df, transparent: true, opacity: .4, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 8; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(GRANDPA.updraftRadius * .75, .035, 3, 32), windMat);
      ring.rotation.x = Math.PI / 2; this.windRings.push(ring); this.wind.add(ring);
    }
    const dartGeometry = new THREE.BufferGeometry(); dartGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(300), 3)); dartGeometry.setDrawRange(0, 0);
    this.dartPoints = new THREE.Points(dartGeometry, new THREE.PointsMaterial({ color: 0xffdc69, size: .18 })); this.dartPoints.frustumCulled = false;
    this.rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xedd59b })); this.rope.frustumCulled = false;
    d.scene.add(this.dartPoints, this.rope); this.rope.visible = false;
    this.label.className = 'gp-name'; document.body.append(this.label);
    this.placementLabel.className = 'gp-placement'; this.placementLabel.hidden = true; this.placementLabel.textContent = 'Place Grandpa statue · Click to place · R to turn · Esc to cancel'; document.body.append(this.placementLabel);
    d.ui.onPlace = () => this.startPlacement();
    d.ui.setReward(this.reward);
    d.ui.onToggle = () => d.input.clearEdges();
    d.net.onJoin = () => {
      if (!d.net.guest && (!this.state || this.visitCode !== d.net.code)) {
        this.visitCode = d.net.code; this.state = this.spawnNearChild(); this.chase = createChase();
      }
    };
    d.net.onLeave = () => {
      this.model.root.visible = false; this.child.visible = false; this.wind.visible = false; this.rope.visible = false; this.dartPoints.geometry.setDrawRange(0, 0); this.label.hidden = true;
      if (d.net.status === 'idle') { this.state = null; this.chase = createChase(); }
    };
    d.net.onSnapshot = snap => {
      if (!d.net.guest) return;
      if (this.state) this.correction.add(new THREE.Vector3(this.state.pos.x - snap.grandpa.pos.x, this.state.pos.y - snap.grandpa.pos.y, this.state.pos.z - snap.grandpa.pos.z));
      if (this.correction.length() > 8) this.correction.set(0, 0, 0);
      this.state = structuredClone(snap.grandpa); this.chase = { ...snap.chase }; this.paused = snap.paused;
    };
    if (d.net.guest && d.net.latest) d.net.onSnapshot(d.net.latest);
    this.updateStatue();
  }
  private spawnNearChild(): GrandpaState {
    const p = this.d.player.pos;
    for (let radius = 9; radius <= 21; radius += 3) {
      for (let k = 0; k < 16; k++) {
        const angle = this.d.input.yaw + k * Math.PI / 8;
        const x = p.x - Math.sin(angle) * radius, z = p.z - Math.cos(angle) * radius;
        const y = this.d.world.ground.heightBelow?.(x, z, p.y + .5) ?? this.d.world.ground.heightAt(x, z);
        if (Math.abs(y - p.y) > 3 || this.d.world.obstacles({ x, y, z }).some(o => Math.hypot(o.x - x, o.z - z) < o.r + GRANDPA.radius && y < (o.yTop ?? Infinity))) continue;
        return createGrandpa({ x, y, z }, angle + Math.PI);
      }
    }
    return createGrandpa({ ...p, y: p.y + 5 }, this.d.input.yaw + Math.PI);
  }
  targets(): { id: number; pos: Vec3; size: number }[] {
    if (!this.state || !this.d.net.connected) return [];
    const p = this.state.pos;
    return [{ id: -900000001, pos: { x: p.x, y: p.y + 3.3, z: p.z }, size: 1.6 }, { id: -900000002, pos: { x: p.x, y: p.y + 1.5, z: p.z }, size: 1.05 }];
  }
  tag(): void {
    if (!this.state || !this.d.net.connected || this.d.net.guest) return;
    const prev = this.chase;
    this.chase = tagGrandpa(this.chase);
    if (prev !== this.chase) { toast('Grandpa tagged! Keep close to catch him.'); blip(920, .12); }
  }
  step(dt: number, paused: boolean): void {
    const { net, input, player, world } = this.d;
    this.time += dt;
    if (net.guest) {
      input.state(); // Drain the ordinary player's unused movement edges.
      this.guestInput = this.controls!.read();
      for (const action of input.consumeActions()) if (action.type === 'escape') this.d.ui.toggle();
      if (this.state && net.connected && !this.paused) this.state = stepGrandpa(this.state, this.guestInput, dt, world, this.chase.phase === 'caught');
      this.accumulator += dt;
      if (this.accumulator >= 1 / GRANDPA.inputHz) { this.accumulator = 0; net.sendInput(this.guestInput); }
      if (this.state) player.rideStep(this.state.pos, this.state.vel);
    } else if (net.connected && this.state) {
      // Sharing the invite or opening the child's inventory must not disable
      // Grandpa's controls. Only a backgrounded host suspends his simulation;
      // chase progress still pauses with the child's menus below.
      this.paused = document.hidden;
      if (!this.paused) this.state = stepGrandpa(this.state, net.remoteInput, dt, world, this.chase.phase === 'caught');
      if (!paused) {
        const target = { ...this.state.pos, y: this.state.pos.y + 2.5 };
        const child = { ...player.pos, y: player.pos.y + 1.5 };
        this.close = Math.hypot(child.x - target.x, child.y - target.y, child.z - target.z) <= GRANDPA.trackRadius && !this.d.raycast(child, target);
        const before = this.chase;
        this.chase = stepChase(this.chase, dt, this.close);
        if (before.phase !== 'caught' && this.chase.phase === 'caught') {
          const first = !this.reward.caught;
          this.reward = earnStatue(this.reward);
          this.d.ui.setReward(this.reward);
          if (first) { toast('Caught Grandpa! Open Invite Grandpa to place your statue.'); this.d.save(); }
          else toast('Caught you, Grandpa!');
        }
        const lift = updraftImpulse(this.state.updraft, player.pos, player.vel.y, dt);
        if (lift) player.applyImpulse(lift);
      }
      this.accumulator += dt; this.worldAccumulator += dt;
      if (this.accumulator >= 1 / GRANDPA.snapshotHz) {
        this.accumulator = 0;
        net.sendSnapshot({ ...this.d.hostSnapshot(), grandpa: this.state, chase: this.chase, paused: this.paused });
      }
      if (this.worldAccumulator >= 1) { this.worldAccumulator = 0; net.syncWorld(); }
    }
    if (this.ghost) this.updatePlacement();
  }
  /** Called at display cadence, after the regular first-person camera interpolation. */
  render(dt: number): void {
    const { camera, net, player, input, ui } = this.d;
    const s = this.state;
    this.model.root.visible = !!s && net.connected;
    this.child.visible = net.guest && net.connected;
    const childPos = net.guest ? net.latest?.child.pos ?? player.pos : player.pos;
    const distance = s ? Math.hypot(childPos.x - s.pos.x, childPos.y - s.pos.y, childPos.z - s.pos.z) : 0;
    ui.update(s, this.chase, distance, net.connected, this.paused);
    if (!s || !net.connected) { this.label.hidden = true; return; }
    this.correction.multiplyScalar(Math.exp(-dt * 12));
    this.model.root.position.set(s.pos.x, s.pos.y, s.pos.z);
    if (net.guest) this.model.root.position.add(this.correction);
    this.model.animate(s, this.time, this.chase.phase === 'caught', dt, this.d.world.ground);
    if (net.guest) {
      const yaw = input.yaw + (input.rmbHeld ? Math.PI : 0);
      const focus = this.model.root.position.clone().add(new THREE.Vector3(0, 2.8, 0));
      const pitch = Math.max(-.65, Math.min(.75, input.pitch));
      const desired = focus.clone().add(new THREE.Vector3(Math.sin(yaw) * 9 * Math.cos(pitch), 2.5 - Math.sin(pitch) * 7, Math.cos(yaw) * 9 * Math.cos(pitch)));
      const hit = this.d.raycast(focus, desired);
      if (hit) desired.copy(new THREE.Vector3(hit.x, hit.y, hit.z).lerp(focus, .12));
      desired.y = Math.max(desired.y, this.d.world.ground.heightAt(desired.x, desired.z) + .5);
      camera.position.copy(desired); camera.lookAt(focus); camera.updateMatrixWorld();
      const child = net.latest?.child;
      if (child) {
        const target = new THREE.Vector3(child.pos.x, child.pos.y, child.pos.z);
        this.child.position.lerp(target, this.child.position.distanceTo(target) > 20 ? 1 : 1 - Math.exp(-dt * 18));
        this.child.rotation.y = child.yaw;
        const legs = this.child.userData.legs as THREE.Group[];
        for (let i = 0; i < legs.length; i++) legs[i]!.rotation.x = Math.sin(this.time * 10 + i * Math.PI) * Math.min(.55, Math.hypot(child.vel.x, child.vel.z) * .08);
        this.rope.visible = !!child.grapple;
        if (child.grapple) { const a = this.rope.geometry.getAttribute('position') as THREE.BufferAttribute; a.setXYZ(0, child.pos.x, child.pos.y + 1.3, child.pos.z); a.setXYZ(1, child.grapple.x, child.grapple.y, child.grapple.z); a.needsUpdate = true; }
      }
      const darts = net.latest?.darts ?? []; const attr = this.dartPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
      darts.slice(0, 100).forEach((p, i) => attr.setXYZ(i, p.x, p.y, p.z)); attr.needsUpdate = true; this.dartPoints.geometry.setDrawRange(0, Math.min(100, darts.length));
    }
    this.wind.visible = !!s.updraft;
    if (s.updraft) {
      this.wind.position.set(s.updraft.pos.x, s.updraft.pos.y, s.updraft.pos.z);
      this.windRings.forEach((ring, i) => { ring.position.y = ((this.time * 6 + i * 3) % GRANDPA.updraftHeight); const scale = .6 + .4 * Math.sin(i + this.time); ring.scale.setScalar(scale); });
    }
    if (s.sneezeSerial > this.latestSneeze) { this.latestSneeze = s.sneezeSerial; blip(170, .22); setTimeout(() => blip(430, .09), 120); }
    if (this.chase.rounds > this.latestCaught) { this.latestCaught = this.chase.rounds; chime(); }
    const point = (net.guest ? this.child.position : this.model.root.position).clone(); point.y += net.guest ? 2.5 : 5.2;
    point.project(camera); this.label.hidden = point.z > 1 || point.z < -1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1 || ui.isOpen;
    this.label.style.left = `${(point.x * .5 + .5) * innerWidth}px`; this.label.style.top = `${(-point.y * .5 + .5) * innerHeight}px`;
    this.label.textContent = net.guest ? 'Your grandchild' : 'Grandpa Featherfoot';
  }
  get placing(): boolean { return this.ghost !== null; }
  startPlacement(): void {
    if (!this.reward.caught || this.d.net.guest) return;
    this.cancelPlacement(); this.ghost = new GrandpaModel(true); this.ghost.root.scale.setScalar(.23); this.d.scene.add(this.ghost.root);
    this.ghost.root.traverse(o => { if (o instanceof THREE.Mesh) { const m = o.material as THREE.MeshStandardMaterial; m.transparent = true; m.opacity = .5; } });
    this.placeYaw = this.d.input.yaw; this.placementLabel.hidden = false;
  }
  rotatePlacement(): void { this.placeYaw += Math.PI / 2; }
  private updatePlacement(): void {
    const dir = new THREE.Vector3(); this.d.camera.getWorldDirection(dir);
    const hit = raycastTerrain(this.d.camera.position, dir, (x, z) => this.d.world.ground.heightBelow?.(x, z, this.d.player.pos.y + 3) ?? this.d.world.ground.heightAt(x, z), GRANDPA.statueRange);
    this.placePoint = hit;
    if (this.ghost) {
      this.ghost.root.visible = !!this.placePoint;
      if (this.placePoint) this.ghost.root.position.set(this.placePoint.x, this.placePoint.y, this.placePoint.z);
      this.ghost.root.rotation.y = this.placeYaw;
    }
  }
  confirmPlacement(): void {
    if (!this.placePoint || !this.reward.caught) return;
    this.reward = { caught: true, statue: { pos: { ...this.placePoint }, yaw: this.placeYaw } };
    this.cancelPlacement(); this.updateStatue(); this.d.ui.setReward(this.reward); this.d.save();
    toast('Grandpa has a place in your world.');
  }
  cancelPlacement(): void { this.ghost?.dispose(); this.ghost = null; this.placePoint = null; this.placementLabel.hidden = true; }
  restoreReward(reward: GrandpaReward | undefined): void {
    const next = parseReward(reward);
    if (JSON.stringify(next) === JSON.stringify(this.reward)) return;
    this.reward = next; this.updateStatue(); this.d.ui.setReward(next);
  }
  private updateStatue(): void {
    this.statue?.dispose(); this.statue = null;
    if (!this.reward.statue) return;
    this.statue = new GrandpaModel(true); this.statue.root.scale.setScalar(.23);
    const { pos, yaw } = this.reward.statue; this.statue.root.position.set(pos.x, pos.y, pos.z); this.statue.root.rotation.y = yaw;
    this.d.scene.add(this.statue.root);
  }
}
