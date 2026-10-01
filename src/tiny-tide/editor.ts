// The creature editor: body, parts and paint. It runs in its own small
// renderer on top of the paused game.
import * as T from 'three';
import './editor.css';
import { asset } from './assets';
import { CreatureModel, locate } from './creature';
import { cloneGenome, derive, dietOf, genomeCost, instanceCount, isUnlocked, nextUid, PART_LIMITS, PATTERNS, partSlots, problems, SCALE_RANGE, SPINE_LIMITS, SPINE_RANGE, STARTER_NEXT_SERIAL, statsOf, uidSerial, type Genome, type PlacedPart } from './genome';
import type { BodyPlan } from './plans';
import { KIND_LABELS, PARTS, part, type PartKind, type Stats } from './parts';
import { STAGES } from './state';

export interface EditorOptions {
  genome: Genome; name: string; stage: number; plan: BodyPlan; unlocked: readonly string[];
  /** Current DNA plus the refund value of the current design. */
  budget: number; mode: 'edit' | 'evolve';
}
export interface EditorResult { genome: Genome; name: string }
type Tab = 'parts' | 'body' | 'paint';
const SWATCHES = ['#ffad92', '#ffc769', '#ffe1b8', '#ef8a80', '#d4b1f5', '#bfc0ff', '#b4e7ed', '#7fd1b9', '#9fd36b', '#f6e27a', '#f59ac0', '#8fb3ff', '#6c7bd9', '#4d9c8e', '#3b5b6e', '#fff6e3'];
const STAT_ROWS: [keyof Stats, string, number][] = [['speed', 'Speed', 6], ['bite', 'Bite', 6], ['reach', 'Reach', 3], ['armor', 'Armor', 6], ['health', 'Health', 6], ['sense', 'Sense', 8], ['stealth', 'Stealth', 4]];
const KIND_ORDER: PartKind[] = ['mouth', 'eye', 'fin', 'tail', 'leg', 'arm', 'armor', 'sense', 'wing', 'jet', 'cosmic'];
const thumbnails = new Map<string, string>();

function renderThumbnails() {
  if (thumbnails.size) return;
  const canvas = document.createElement('canvas'), renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(112, 112, false); renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping;
  const scene = new T.Scene(), camera = new T.PerspectiveCamera(30, 1, .01, 50);
  scene.add(new T.HemisphereLight('#ffffff', '#5b8a8a', 2.4)); const key = new T.DirectionalLight('#fff3d6', 2.2); key.position.set(2, 4, 3); scene.add(key);
  for (const spec of PARTS) {
    const object = asset(`part_${spec.id}`);
    object.traverse(node => { if (node instanceof T.Mesh && !Array.isArray(node.material) && node.material.name === 'Tide_tint') { const m = (node.material as T.MeshStandardMaterial).clone(); m.color.set('#ffb59a'); node.material = m; } });
    scene.add(object);
    const box = new T.Box3().setFromObject(object), center = box.getCenter(new T.Vector3()), size = box.getSize(new T.Vector3()).length() || 1;
    camera.position.copy(center).add(new T.Vector3(.9, .55, 1.1).normalize().multiplyScalar(size * 1.6)); camera.lookAt(center);
    renderer.render(scene, camera); thumbnails.set(spec.id, canvas.toDataURL('image/png'));
    scene.remove(object);
    object.traverse(node => { if (node instanceof T.Mesh && !Array.isArray(node.material) && node.material.name === 'Tide_tint') node.material.dispose(); });
  }
  renderer.dispose(); renderer.forceContextLoss();
}

export function openEditor(options: EditorOptions): Promise<EditorResult | null> {
  return new Promise(resolve => new Editor(options, resolve));
}

class Editor {
  private draft: Genome;
  private serial: number;
  private name: string;
  private history: Genome[] = [];
  private tab: Tab = 'parts';
  private kind: PartKind = 'mouth';
  private selected: number | null = null;
  private vertebra = 1;
  private placing: string | null = null;
  private ghost: PlacedPart | null = null;
  private dragging: { index: number; moved: boolean } | null = null;
  private orbit: { x: number; y: number; id: number; moved: boolean } | null = null;
  private yaw = .75; private pitch = .32; private zoom = 1;
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: T.WebGLRenderer;
  private scene = new T.Scene();
  private camera = new T.PerspectiveCamera(36, 1, .05, 80);
  private model: CreatureModel | null = null;
  private handles = new T.Group();
  private raycaster = new T.Raycaster();
  private frame = 0;
  private closed = false;
  private readonly onResize = () => this.resize();
  private readonly onKey = (event: KeyboardEvent) => this.key(event);

  constructor(private options: EditorOptions, private done: (result: EditorResult | null) => void) {
    this.draft = cloneGenome(options.genome); this.name = options.name;
    this.serial = Math.max(STARTER_NEXT_SERIAL, ...this.draft.parts.map(p => uidSerial(p.uid) + 1));
    renderThumbnails();
    this.root = document.createElement('section'); this.root.id = 'editor'; this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'true'); this.root.setAttribute('aria-label', 'Creature editor');
    const stage = STAGES[options.stage]!;
    this.root.innerHTML = `
      <canvas class="ed-view" aria-label="Your creature. Drag to turn it. Tap a part to select it."></canvas>
      <header class="ed-top">
        <div class="ed-title"><span class="eyebrow">${options.mode === 'evolve' ? `EVOLVE · ${stage.title.toUpperCase()} · ${stage.size}` : 'CREATURE EDITOR'}</span>
          <input class="ed-name" maxlength="24" aria-label="Creature name" value=""></div>
        <div class="ed-dna" aria-live="polite"><small>DNA LEFT</small><strong class="ed-dna-value"></strong></div>
        <div class="ed-actions"><button class="ed-undo ghost-button" aria-label="Undo">Undo</button><button class="ed-cancel ghost-button">${options.mode === 'evolve' ? 'Not yet' : 'Cancel'}</button><button class="ed-done primary">${options.mode === 'evolve' ? 'Evolve!' : 'Done'}</button></div>
      </header>
      <nav class="ed-tabs" role="tablist">${(['parts', 'body', 'paint'] as Tab[]).map(t => `<button role="tab" data-tab="${t}">${t[0]!.toUpperCase() + t.slice(1)}</button>`).join('')}</nav>
      <div class="ed-panel"></div>
      <aside class="ed-stats"></aside>
      <div class="ed-tool" hidden></div>
      <div class="ed-hint" aria-live="polite"></div>`;
    document.querySelector('#app')!.append(this.root);
    this.canvas = this.root.querySelector('.ed-view')!;
    this.renderer = new T.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65)); this.renderer.outputColorSpace = T.SRGBColorSpace; this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.scene.add(new T.HemisphereLight('#d6fbf6', '#3d6d6d', 2.2));
    const key = new T.DirectionalLight('#fff0cb', 2.4); key.position.set(-3, 6, 4); this.scene.add(key);
    const rim = new T.DirectionalLight('#84e7ea', 1.2); rim.position.set(3, 2, -5); this.scene.add(rim);
    const floor = new T.Mesh(new T.CircleGeometry(3.2, 48), new T.MeshBasicMaterial({ color: '#0f3c43', transparent: true, opacity: .35 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -1.25; floor.name = 'floor'; this.scene.add(floor);
    this.scene.add(this.handles);
    const nameInput = this.root.querySelector<HTMLInputElement>('.ed-name')!; nameInput.value = this.name;
    nameInput.addEventListener('input', () => { this.name = nameInput.value; });
    this.root.querySelector<HTMLButtonElement>('.ed-undo')!.onclick = () => this.undo();
    this.root.querySelector<HTMLButtonElement>('.ed-cancel')!.onclick = () => this.close(null);
    this.root.querySelector<HTMLButtonElement>('.ed-done')!.onclick = () => this.finish();
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => button.onclick = () => { this.tab = button.dataset.tab as Tab; this.placing = null; this.ghost = null; this.selected = null; this.rebuild(); this.render(); });
    this.canvas.addEventListener('pointerdown', e => this.pointerDown(e));
    this.canvas.addEventListener('pointermove', e => this.pointerMove(e));
    this.canvas.addEventListener('pointerup', e => this.pointerUp(e));
    this.canvas.addEventListener('pointercancel', () => { this.orbit = null; this.dragging = null; });
    this.canvas.addEventListener('wheel', e => { e.preventDefault(); this.zoom = T.MathUtils.clamp(this.zoom * (1 + Math.sign(e.deltaY) * .08), .55, 2); }, { passive: false });
    addEventListener('resize', this.onResize); addEventListener('keydown', this.onKey);
    this.resize(); this.rebuild(); this.render();
    const loop = () => { if (this.closed) return; this.frame = requestAnimationFrame(loop); this.draw(); };
    loop();
    this.root.querySelector<HTMLButtonElement>('.ed-done')!.focus();
  }
  // ----- state -----
  private get budget() { return this.options.budget; }
  private get remaining() { return this.budget - genomeCost(this.draft); }
  private commit(change: (g: Genome) => void) {
    this.history.push(cloneGenome(this.draft)); if (this.history.length > 60) this.history.shift();
    change(this.draft); this.rebuild(); this.render();
  }
  private undo() { const prior = this.history.pop(); if (!prior) return; this.draft = prior; this.selected = null; this.rebuild(); this.render(); }
  private finish() {
    if (problems(this.draft, this.options.plan, { unlocked: this.options.unlocked, budget: this.budget }).length) { this.hint(problems(this.draft, this.options.plan, { unlocked: this.options.unlocked, budget: this.budget })[0]!.message); return; }
    this.close({ genome: cloneGenome(this.draft), name: this.name.trim() || this.options.name });
  }
  private close(result: EditorResult | null) {
    if (this.closed) return;
    this.closed = true; cancelAnimationFrame(this.frame);
    removeEventListener('resize', this.onResize); removeEventListener('keydown', this.onKey);
    this.model?.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss(); this.root.remove();
    this.done(result);
  }
  private key(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === 'Escape') { event.preventDefault(); if (this.placing || this.selected !== null) { this.placing = null; this.ghost = null; this.selected = null; this.rebuild(); this.render(); } else this.close(null); }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selected !== null) this.removeSelected();
    if (event.key === 'z' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); this.undo(); }
  }
  private hint(text: string) { const el = this.root.querySelector<HTMLElement>('.ed-hint')!; el.textContent = text; el.classList.add('show'); clearTimeout(Number(el.dataset.timer)); el.dataset.timer = String(setTimeout(() => el.classList.remove('show'), 2600)); }

  // ----- 3D -----
  private resize() {
    const width = innerWidth, height = innerHeight; this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
  }
  private rebuild() {
    this.model?.dispose();
    const preview = cloneGenome(this.draft);
    if (this.ghost) preview.parts.push(this.ghost);
    this.model = new CreatureModel(preview); this.scene.add(this.model.group);
    if (this.selected !== null) this.model.group.traverse(node => {
      if (node.userData.placedIndex === this.selected && node.userData.partId) node.traverse(child => { if (child instanceof T.Mesh) { const m = (child.material as T.MeshStandardMaterial).clone(); m.emissive = new T.Color('#fff2b3'); m.emissiveIntensity = .35; child.material = m; child.userData.ownedMaterial = true; } });
    });
    this.handles.clear();
    if (this.tab === 'body') this.model.layout.z.forEach((z, i) => {
      const s = this.draft.spine[i]!, handle = new T.Mesh(new T.SphereGeometry(.09, 16, 10), new T.MeshBasicMaterial({ color: i === this.vertebra ? '#fff2b3' : '#7fe3d1', depthTest: false, transparent: true }));
      handle.position.set(0, s.lift + s.height + .28, z); handle.renderOrder = 5; handle.userData.vertebra = i; this.handles.add(handle);
    });
  }
  private draw() {
    const target = new T.Vector3(0, 0, 0);
    // Fit the whole creature in the narrower field of view, so phones see all of it.
    const radius = (this.model?.length ?? 2.5) / 2 + .6, vertical = T.MathUtils.degToRad(this.camera.fov), horizontal = 2 * Math.atan(Math.tan(vertical / 2) * this.camera.aspect);
    const distance = radius / Math.sin(Math.min(vertical, horizontal) / 2) * this.zoom;
    this.camera.position.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(distance).add(target);
    this.camera.lookAt(target);
    // Desktop layouts put the panel on the left; nudge the creature to the free space.
    const wide = innerWidth > 900; this.camera.setViewOffset(innerWidth, innerHeight, wide ? -innerWidth * .08 : 0, wide ? 0 : innerHeight * .12, innerWidth, innerHeight);
    this.renderer.render(this.scene, this.camera);
  }
  private pick(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), this.camera);
    const handle = this.raycaster.intersectObjects(this.handles.children, false)[0];
    const hits = this.model ? this.raycaster.intersectObject(this.model.group, true) : [];
    let partIndex: number | null = null, bodyPoint: T.Vector3 | null = null;
    for (const hit of hits) {
      let node: T.Object3D | null = hit.object;
      while (node && node.userData.partId === undefined) node = node.parent;
      if (node && node.userData.placedIndex !== undefined && node.userData.placedIndex < this.draft.parts.length) { if (partIndex === null && !bodyPoint) partIndex = node.userData.placedIndex; continue; }
      if (hit.object === this.model!.body && !bodyPoint) bodyPoint = hit.point.clone();
    }
    return { handle: handle?.object.userData.vertebra as number | undefined, partIndex, bodyPoint };
  }
  private placement(point: T.Vector3, id: string): PlacedPart {
    const spec = part(id)!, { t, angle } = locate(this.draft, this.model!.layout, point);
    // Mouths and tails snap to the tips; everything else sits where it was dropped.
    // A drop away from the head puts the mouth on the front tip; a tail goes on the rear tip.
    const snapped = spec.kind === 'mouth' ? (t > .15 ? { t: 0, angle: 0 } : { t, angle }) : spec.kind === 'tail' ? (t < .85 ? { t: 1, angle: 0 } : { t, angle }) : { t, angle };
    const side = Math.abs(Math.sin(snapped.angle)) > .3;
    return { uid: 'ghost', id, t: snapped.t, angle: snapped.angle, scale: 1, mirror: spec.mirror && side, roll: 0 };
  }
  private pointerDown(event: PointerEvent) {
    this.canvas.setPointerCapture(event.pointerId);
    const { handle, partIndex } = this.pick(event);
    if (handle !== undefined && this.tab === 'body') { this.vertebra = handle; this.orbit = { x: event.clientX, y: event.clientY, id: event.pointerId, moved: false }; this.dragging = null; this.history.push(cloneGenome(this.draft)); this.rebuild(); this.render(); this.handleDrag = { y: event.clientY, start: { ...this.draft.spine[handle]! } }; return; }
    if (!this.placing && partIndex !== null && this.tab === 'parts') { this.selected = partIndex; this.dragging = { index: partIndex, moved: false }; this.rebuild(); this.render(); return; }
    this.orbit = { x: event.clientX, y: event.clientY, id: event.pointerId, moved: false };
  }
  private handleDrag: { y: number; start: { radius: number; height: number; lift: number } } | null = null;
  private pointerMove(event: PointerEvent) {
    if (this.handleDrag) {
      // Drag a vertebra handle up or down to make the body fatter or thinner there.
      const factor = 1 + (this.handleDrag.y - event.clientY) / 160, s = this.draft.spine[this.vertebra]!, start = this.handleDrag.start;
      s.radius = T.MathUtils.clamp(start.radius * factor, ...SPINE_RANGE.radius); s.height = T.MathUtils.clamp(start.height * factor, ...SPINE_RANGE.height);
      this.rebuild(); this.renderStatsOnly(); this.syncBodySliders(); return;
    }
    if (this.dragging) {
      const { bodyPoint } = this.pick(event); if (!bodyPoint) return;
      if (!this.dragging.moved) { this.history.push(cloneGenome(this.draft)); this.dragging.moved = true; }
      const current = this.draft.parts[this.dragging.index]!, next = this.placement(bodyPoint, current.id);
      Object.assign(current, { t: next.t, angle: next.angle, mirror: current.mirror && Math.abs(Math.sin(next.angle)) > .3 });
      this.rebuild(); return;
    }
    if (this.placing) {
      const { bodyPoint } = this.pick(event);
      this.ghost = bodyPoint ? this.placement(bodyPoint, this.placing) : null; this.rebuild(); return;
    }
    if (this.orbit && event.pointerId === this.orbit.id) {
      const dx = event.clientX - this.orbit.x, dy = event.clientY - this.orbit.y;
      if (Math.hypot(dx, dy) > 3) this.orbit.moved = true;
      this.yaw -= dx * .008; this.pitch = T.MathUtils.clamp(this.pitch + dy * .006, -.9, 1.3);
      this.orbit.x = event.clientX; this.orbit.y = event.clientY;
    }
  }
  private pointerUp(event: PointerEvent) {
    if (this.handleDrag) { this.handleDrag = null; this.orbit = null; this.render(); return; }
    if (this.dragging) { this.dragging = null; this.render(); return; }
    // A card dragged onto the body is placed by the panel's pointerup handler.
    if (this.cardDrag) return;
    if (this.placing) {
      const { bodyPoint } = this.pick(event);
      if (bodyPoint) this.addPart(this.placement(bodyPoint, this.placing));
      return;
    }
    const tap = this.orbit && !this.orbit.moved; this.orbit = null;
    if (tap && this.selected !== null) { this.selected = null; this.rebuild(); this.render(); }
  }
  // ----- parts -----
  private canAfford(id: string, mirror: boolean) { return (part(id)!.cost * (mirror ? 2 : 1)) <= this.remaining; }
  private addPart(placed: PlacedPart) {
    const spec = part(placed.id)!;
    const replacingMouth = spec.kind === 'mouth' ? this.draft.parts.findIndex(p => part(p.id)?.kind === 'mouth') : -1;
    const refund = replacingMouth >= 0 ? part(this.draft.parts[replacingMouth]!.id)!.cost : 0;
    if (placed.mirror && !this.canAfford(placed.id, true) && this.canAfford(placed.id, false)) placed.mirror = false;
    if (spec.cost * (placed.mirror ? 2 : 1) > this.remaining + refund) { this.hint('Not enough DNA for that part.'); return; }
    const count = instanceCount(this.draft) + partSlots(placed) - (replacingMouth >= 0 ? 1 : 0);
    if (count > PART_LIMITS[this.options.stage]!) { this.hint(`Too complex. ${PART_LIMITS[this.options.stage]} parts at this size.`); return; }
    this.ghost = null; this.placing = null;
    this.commit(g => {
      if (replacingMouth >= 0) g.parts.splice(replacingMouth, 1);
      placed.uid = nextUid(this.serial++); g.parts.push(placed); this.selected = g.parts.length - 1;
    });
    this.hint(`${spec.name} added. Drag it to move it.`);
  }
  private removeSelected() {
    if (this.selected === null) return;
    const index = this.selected; this.selected = null;
    this.commit(g => { g.parts.splice(index, 1); });
  }
  // ----- panels -----
  private render() {
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => { button.setAttribute('aria-selected', String(button.dataset.tab === this.tab)); });
    const panel = this.root.querySelector<HTMLElement>('.ed-panel')!;
    if (this.tab === 'parts') this.renderParts(panel);
    else if (this.tab === 'body') this.renderBody(panel);
    else this.renderPaint(panel);
    this.renderTool(); this.renderStatsOnly();
  }
  private renderParts(panel: HTMLElement) {
    const kinds = KIND_ORDER.filter(kind => PARTS.some(p => p.kind === kind));
    panel.innerHTML = `<div class="ed-kinds" role="tablist" aria-label="Part types">${kinds.map(kind => `<button data-kind="${kind}" aria-selected="${kind === this.kind}">${KIND_LABELS[kind]}</button>`).join('')}</div>
      <div class="ed-cards">${PARTS.filter(p => p.kind === this.kind).map(spec => {
        const open = isUnlocked(spec.id, this.options.stage, this.options.unlocked), early = open && spec.stage > this.options.stage;
        return `<button class="ed-card ${this.placing === spec.id ? 'active' : ''}" data-part="${spec.id}" ${open ? '' : 'disabled'} aria-label="${spec.name}, ${spec.cost} DNA${open ? '' : ', locked'}">
          <img src="${thumbnails.get(spec.id) ?? ''}" alt=""><strong>${spec.name}</strong><span class="ed-cost">${open ? `${spec.cost} DNA` : `🔒 ${STAGES[spec.stage]!.title}`}</span>
          <small>${statLine(spec.stats)}${spec.diet ? ` · ${spec.diet}` : ''}</small>${early ? '<em>FOUND!</em>' : ''}</button>`;
      }).join('')}</div>
      <p class="ed-tip">${this.placing ? 'Tap your creature to place it. Tap the card again to stop.' : 'Choose a part, then tap your creature. Drag the empty space to turn around.'}</p>`;
    panel.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(button => button.onclick = () => { this.kind = button.dataset.kind as PartKind; this.placing = null; this.ghost = null; this.render(); });
    panel.querySelectorAll<HTMLButtonElement>('[data-part]').forEach(button => {
      button.onclick = click => {
        const id = button.dataset.part!;
        if (this.placing === id) { this.placing = null; this.ghost = null; this.rebuild(); this.render(); return; }
        if (!this.canAfford(id, false) && part(id)!.kind !== 'mouth') { this.hint('Not enough DNA. Eat more to earn DNA.'); return; }
        this.placing = id; this.selected = null; this.render();
        // Keyboard and quick taps place the part at its usual spot right away.
        const spec = part(id)!;
        this.ghost = null;
        if (matchMedia('(pointer: coarse)').matches || click.detail === 0) this.addPart({ uid: 'ghost', id, t: spec.t, angle: spec.angle, scale: 1, mirror: spec.mirror, roll: 0 });
      };
      // Drag a card onto the creature to place it.
      button.addEventListener('pointerdown', e => { if (button.disabled) return; this.cardDrag = { id: button.dataset.part!, x: e.clientX, y: e.clientY }; });
    });
    this.root.onpointermove = e => {
      if (!this.cardDrag || Math.hypot(e.clientX - this.cardDrag.x, e.clientY - this.cardDrag.y) < 12) return;
      this.placing = this.cardDrag.id; const { bodyPoint } = this.pick(e);
      this.ghost = bodyPoint ? this.placement(bodyPoint, this.placing) : null; this.rebuild();
    };
    this.root.onpointerup = e => {
      const drag = this.cardDrag; this.cardDrag = null;
      if (!drag || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 12) return;
      const { bodyPoint } = this.pick(e);
      if (bodyPoint) this.addPart(this.placement(bodyPoint, drag.id)); else { this.placing = null; this.ghost = null; this.rebuild(); this.render(); }
    };
  }
  private cardDrag: { id: string; x: number; y: number } | null = null;
  private renderTool() {
    const tool = this.root.querySelector<HTMLElement>('.ed-tool')!;
    const placed = this.selected !== null ? this.draft.parts[this.selected] : undefined;
    tool.hidden = !placed || this.tab !== 'parts'; if (!placed) return;
    const spec = part(placed.id)!;
    tool.innerHTML = `<strong>${spec.name}</strong>
      <label>Size<input type="range" class="ed-scale" min="${SCALE_RANGE[0]}" max="${SCALE_RANGE[1]}" step=".05" value="${placed.scale}"></label>
      <label>Turn<input type="range" class="ed-roll" min="${-Math.PI}" max="${Math.PI}" step=".05" value="${placed.roll}"></label>
      ${spec.mirror ? `<button class="ed-mirror ghost-button" aria-pressed="${placed.mirror}">${placed.mirror ? 'Pair ✓' : 'Pair'}</button>` : ''}
      <button class="ed-delete ghost-button">Remove (+${spec.cost * (placed.mirror ? 2 : 1)})</button>`;
    const slider = (selector: string, key: 'scale' | 'roll') => {
      const input = tool.querySelector<HTMLInputElement>(selector)!;
      input.addEventListener('pointerdown', () => this.history.push(cloneGenome(this.draft)));
      input.addEventListener('keydown', () => this.history.push(cloneGenome(this.draft)));
      input.oninput = () => { placed[key] = Number(input.value); this.rebuild(); this.renderStatsOnly(); };
    };
    slider('.ed-scale', 'scale'); slider('.ed-roll', 'roll');
    const mirror = tool.querySelector<HTMLButtonElement>('.ed-mirror');
    if (mirror) mirror.onclick = () => {
      if (!placed.mirror && (!this.canAfford(placed.id, false) || instanceCount(this.draft) + 1 > PART_LIMITS[this.options.stage]!)) { this.hint('Not enough DNA or room for a pair.'); return; }
      this.commit(() => { placed.mirror = !placed.mirror; if (placed.mirror && Math.abs(Math.sin(placed.angle)) < .3) placed.angle = Math.PI / 2; });
    };
    tool.querySelector<HTMLButtonElement>('.ed-delete')!.onclick = () => this.removeSelected();
  }
  private renderBody(panel: HTMLElement) {
    const spine = this.draft.spine, max = SPINE_LIMITS.max[this.options.stage]!;
    this.vertebra = Math.min(this.vertebra, spine.length - 1);
    panel.innerHTML = `<div class="ed-vertebrae" role="group" aria-label="Body segments">${spine.map((_, i) => `<button data-v="${i}" aria-pressed="${i === this.vertebra}">${i === 0 ? 'Head' : i === spine.length - 1 ? 'Tail' : i}</button>`).join('')}</div>
      <label class="ed-slider">Width<input type="range" data-key="radius" min="${SPINE_RANGE.radius[0]}" max="${SPINE_RANGE.radius[1]}" step=".01"></label>
      <label class="ed-slider">Height<input type="range" data-key="height" min="${SPINE_RANGE.height[0]}" max="${SPINE_RANGE.height[1]}" step=".01"></label>
      <label class="ed-slider">Arch<input type="range" data-key="lift" min="${SPINE_RANGE.lift[0]}" max="${SPINE_RANGE.lift[1]}" step=".01"></label>
      <div class="ed-row"><button class="ed-add ghost-button" ${spine.length >= max ? 'disabled' : ''}>+ Longer</button><button class="ed-remove ghost-button" ${spine.length <= SPINE_LIMITS.min ? 'disabled' : ''}>− Shorter</button></div>
      <p class="ed-tip">Drag a glowing dot up or down to shape the body. ${spine.length} / ${max} segments.</p>`;
    panel.querySelectorAll<HTMLButtonElement>('[data-v]').forEach(button => button.onclick = () => { this.vertebra = Number(button.dataset.v); this.rebuild(); this.render(); });
    panel.querySelectorAll<HTMLInputElement>('[data-key]').forEach(input => {
      input.addEventListener('pointerdown', () => this.history.push(cloneGenome(this.draft)));
      input.addEventListener('keydown', () => this.history.push(cloneGenome(this.draft)));
      input.oninput = () => { (this.draft.spine[this.vertebra]! as unknown as Record<string, number>)[input.dataset.key!] = Number(input.value); this.rebuild(); this.renderStatsOnly(); };
    });
    this.syncBodySliders();
    // Part positions are relative to the body length, so they stay in place.
    panel.querySelector<HTMLButtonElement>('.ed-add')!.onclick = () => this.commit(g => { const at = Math.max(1, this.vertebra); g.spine.splice(at, 0, { ...g.spine[at]! }); this.vertebra = at; });
    panel.querySelector<HTMLButtonElement>('.ed-remove')!.onclick = () => this.commit(g => { const at = Math.min(Math.max(1, this.vertebra), g.spine.length - 2); g.spine.splice(at, 1); this.vertebra = Math.min(at, g.spine.length - 1); });
  }
  private syncBodySliders() {
    const s = this.draft.spine[this.vertebra]; if (!s) return;
    this.root.querySelectorAll<HTMLInputElement>('.ed-panel [data-key]').forEach(input => { input.value = String((s as unknown as Record<string, number>)[input.dataset.key!]); });
  }
  private renderPaint(panel: HTMLElement) {
    const row = (slot: 'base' | 'belly' | 'accent', label: string) => `<div class="ed-paint-row"><span>${label}</span><div class="ed-swatches">${SWATCHES.map(c => `<button class="ed-swatch" data-slot="${slot}" data-color="${c}" style="--c:${c}" aria-label="${label} ${c}" aria-pressed="${this.draft.paint[slot] === c}"></button>`).join('')}<input type="color" data-slot="${slot}" value="${this.draft.paint[slot]}" aria-label="Custom ${label.toLowerCase()} color"></div></div>`;
    panel.innerHTML = `${row('base', 'Body')}${row('belly', 'Belly')}${row('accent', 'Accent')}
      <div class="ed-paint-row"><span>Pattern</span><div class="ed-patterns">${PATTERNS.map(p => `<button data-pattern="${p}" aria-pressed="${this.draft.paint.pattern === p}">${p[0]!.toUpperCase() + p.slice(1)}</button>`).join('')}</div></div>
      <p class="ed-tip">Paint is free. Parts use your accent, body or belly color.</p>`;
    panel.querySelectorAll<HTMLButtonElement>('.ed-swatch').forEach(button => button.onclick = () => this.commit(g => { g.paint[button.dataset.slot as 'base'] = button.dataset.color!; }));
    panel.querySelectorAll<HTMLInputElement>('input[type=color]').forEach(input => input.onchange = () => this.commit(g => { g.paint[input.dataset.slot as 'base'] = input.value; }));
    panel.querySelectorAll<HTMLButtonElement>('[data-pattern]').forEach(button => button.onclick = () => this.commit(g => { g.paint.pattern = button.dataset.pattern as Genome['paint']['pattern']; }));
  }
  private renderStatsOnly() {
    const stats = statsOf(this.draft), derived = derive(stats), issues = problems(this.draft, this.options.plan, { unlocked: this.options.unlocked, budget: this.budget });
    const count = instanceCount(this.draft), limit = PART_LIMITS[this.options.stage]!;
    this.root.querySelector('.ed-dna-value')!.textContent = String(Math.floor(this.remaining));
    this.root.querySelector('.ed-dna')!.classList.toggle('low', this.remaining < 0);
    this.root.querySelector<HTMLElement>('.ed-stats')!.innerHTML = `<div class="ed-diet"><span>DIET</span><strong>${dietOf(this.draft)}</strong></div>
      ${STAT_ROWS.map(([key, label, max]) => `<div class="ed-stat"><span>${label}</span><i><b style="width:${Math.max(0, Math.min(100, stats[key] / max * 100))}%"></b></i><em>${stats[key]}</em></div>`).join('')}
      <div class="ed-stat"><span>Hearts</span><em>${derived.maxHealth}</em></div>
      <div class="ed-complexity"><span>COMPLEXITY</span><i><b style="width:${count / limit * 100}%"></b></i><em>${count} / ${limit}</em></div>
      ${issues.length ? `<p class="ed-problem">${issues[0]!.message}</p>` : ''}`;
    this.root.querySelector<HTMLButtonElement>('.ed-done')!.disabled = issues.length > 0;
    this.root.querySelector<HTMLButtonElement>('.ed-undo')!.disabled = !this.history.length;
  }
}
function statLine(stats: Partial<Stats>) {
  return Object.entries(stats).map(([key, value]) => `${value! > 0 ? '+' : ''}${value} ${key}`).join(' · ');
}
