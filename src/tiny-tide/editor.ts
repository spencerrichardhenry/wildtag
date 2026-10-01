// The creature editor: body, parts and paint. It runs in its own small
// renderer on top of the paused game. It follows the body plan (regions,
// bans, segment rules), the diet lock and the DNA ledger (quoteDesign).
import * as T from 'three';
import './editor.css';
import { asset } from './assets';
import { CreatureModel, locate, profile, zAt } from './creature';
import { adaptToPlan, badMirror, cloneGenome, derive, effectiveStats, instanceCount, isUnlocked, nextUid, PART_LIMITS, PATTERNS, partCost, partSlots, problems, SCALE_RANGE, SPINE_RANGE, type GenomeProblem, type Genome, type PlacedPart } from './genome';
import { quoteDesign, walletTotal, type Economy, type Quote } from './economy';
import { designDelta } from './design-delta';
import type { CombatLoadout } from './combat-types';
import { regionOf, segmentRule, type BodyPlan, type Region } from './plans';
import { KIND_LABELS, PARTS, part, type Diet, type PartKind, type PartSpec, type Stats } from './parts';
import { STAGES, type Build } from './state';

export interface EditorOptions {
  /** The design the editor starts from (in evolve mode, the automatic proposal). */
  genome: Genome;
  /** The committed design. The ledger prices the draft against it, and Undo all restores it. */
  original: Genome;
  /** The proposal's change list (evolve mode). */
  changes: string[];
  name: string; plan: BodyPlan; unlocked: readonly string[];
  economy: Economy; mode: 'edit' | 'evolve';
  /** The locked diet (edit mode). Evolve mode leaves it free. */
  diet?: Diet;
  /** First unused part serial. The editor only moves it forward. */
  nextSerial: number;
  /** The caller's build. The anchor check runs only on Done, inside `onSubmit`. */
  build: Build;
  /** The current ability bindings, for the lost-abilities preview. */
  loadout: CombatLoadout;
  /** The part catalog for problems and ability grants (tests pass a synthetic one). */
  catalog?: readonly PartSpec[];
  /** Done calls this. On `{ ok: false }` the editor stays open with its draft, undo history and
   *  gesture state, and shows the reason in `.ed-submit-error`. It closes only after `{ ok: true }` or Cancel. */
  onSubmit(result: EditorResult): Promise<SubmitOutcome>;
}
export interface EditorResult { genome: Genome; name: string; nextSerial: number }
export type SubmitOutcome = { ok: true } | { ok: false; reason: string };
type Tab = 'parts' | 'body' | 'paint';
type Gesture = 'none' | 'turn' | 'part-drag' | 'handle-drag' | 'card-drag';
interface Snapshot { genome: Genome; changes: string[] }
const SWATCHES = ['#ffad92', '#ffc769', '#ffe1b8', '#ef8a80', '#d4b1f5', '#bfc0ff', '#b4e7ed', '#7fd1b9', '#9fd36b', '#f6e27a', '#f59ac0', '#8fb3ff', '#6c7bd9', '#4d9c8e', '#3b5b6e', '#fff6e3'];
const STAT_ROWS: [keyof Stats, string, number][] = [['speed', 'Speed', 6], ['bite', 'Bite', 6], ['reach', 'Reach', 3], ['armor', 'Armor', 6], ['health', 'Health', 6], ['sense', 'Sense', 8], ['stealth', 'Stealth', 4]];
const KIND_ORDER: PartKind[] = ['mouth', 'eye', 'fin', 'tail', 'leg', 'arm', 'armor', 'sense', 'wing', 'jet', 'cosmic'];
const REGIONS: readonly Region[] = ['head', 'middle', 'tail'];
const REGION_T: Record<Region, number> = { head: .12, middle: .5, tail: .92 };
const REGION_LABEL: Record<Region, string> = { head: 'Head', middle: 'Middle', tail: 'Tail' };
const DIET_LOCK = 'Diet is set until your next evolution.';
const MAX_HANDLES = 8;
const thumbnails = new Map<string, string>();
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

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

/** Slots used per region: the sum of `partSlots` of the parts whose `t` lies in it. */
function regionUse(g: Genome): Record<Region, number> {
  const used: Record<Region, number> = { head: 0, middle: 0, tail: 0 };
  for (const p of g.parts) used[regionOf(p.t)] += partSlots(p);
  return used;
}

class Editor {
  private draft: Genome;
  private readonly original: Genome;
  private changes: string[];
  /** The part serial allocator. It only moves forward (also across undo). */
  private serial: number;
  private name: string;
  private history: Snapshot[] = [];
  /** A snapshot taken when a drag or slider gesture starts; it enters the history on the first real change. */
  private pending: Snapshot | null = null;
  private tab: Tab = 'parts';
  private kind: PartKind = 'mouth';
  private selected: string | null = null;
  private vertebra = 1;
  private placing: string | null = null;
  private pairPrompt: PlacedPart | null = null;
  private dragging: { uid: string } | null = null;
  private handleDrag: { index: number; y: number; start: { radius: number; height: number } } | null = null;
  private cardDrag: { id: string; x: number; y: number } | null = null;
  private orbit: { x: number; y: number; id: number; moved: boolean } | null = null;
  private yaw = .75; private pitch = .32; private zoom = 1;
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: T.WebGLRenderer;
  private scene = new T.Scene();
  private camera = new T.PerspectiveCamera(36, 1, .05, 80);
  private model: CreatureModel;
  private readonly handleGeometry = new T.SphereGeometry(.09, 16, 10);
  private readonly handleMaterials = [new T.MeshBasicMaterial({ color: '#7fe3d1', depthTest: false, transparent: true }), new T.MeshBasicMaterial({ color: '#fff2b3', depthTest: false, transparent: true })] as const;
  private readonly handles: T.Mesh[] = [];
  private readonly ringGeometry: T.BufferGeometry;
  private readonly ringMaterial = new T.LineBasicMaterial({ color: '#fff2b3', transparent: true, opacity: .7, depthTest: false });
  private readonly rings: T.LineLoop[] = [];
  private readonly floor: T.Mesh;
  private raycaster = new T.Raycaster();
  private pointer = new T.Vector2();
  private frame = 0;
  private closed = false;
  /** True while `onSubmit` runs. Done, Cancel and Escape wait for it. */
  private submitting = false;
  private viewData = new Map<string, string>();
  private readonly catalog: readonly PartSpec[];
  private readonly onResize = () => this.resize();
  private readonly onKey = (event: KeyboardEvent) => this.key(event);

  constructor(private options: EditorOptions, private done: (result: EditorResult | null) => void) {
    this.draft = cloneGenome(options.genome); this.original = cloneGenome(options.original); this.name = options.name;
    this.changes = [...options.changes]; this.catalog = options.catalog ?? PARTS;
    this.serial = options.nextSerial;
    renderThumbnails();
    const evolve = options.mode === 'evolve', plan = options.plan;
    this.root = document.createElement('section'); this.root.id = 'editor'; this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'true'); this.root.setAttribute('aria-label', 'Creature editor');
    this.root.innerHTML = `
      <canvas class="ed-view" aria-label="Your creature. Drag to turn it. Tap a part to select it."></canvas>
      <header class="ed-top">
        <div class="ed-title"><span class="eyebrow">${evolve ? `EVOLVE · ${esc(plan.name.toUpperCase())} · ${STAGES[plan.size]?.size ?? ''}` : 'CREATURE EDITOR'}</span>
          <input class="ed-name" maxlength="24" aria-label="Creature name" value=""></div>
        <div class="ed-dna" aria-live="polite"><small>DNA LEFT</small><strong class="ed-dna-value"></strong></div>
        <div class="ed-actions"><button class="ed-undo ghost-button" aria-label="Undo">Undo</button><button class="ed-cancel ghost-button">${evolve ? 'Back' : 'Cancel'}</button><button class="ed-done primary">${evolve ? 'Evolve!' : 'Done'}</button></div>
      </header>
      <nav class="ed-tabs" role="tablist">${(['parts', 'body', 'paint'] as Tab[]).map(t => `<button role="tab" data-tab="${t}">${t[0]!.toUpperCase() + t.slice(1)}</button>`).join('')}</nav>
      <div class="ed-panel"></div>
      <aside class="ed-stats"><div class="ed-stats-body"></div>${evolve ? `
        <section class="ed-evolve" aria-label="Changes for a ${esc(plan.name)}">
          <details class="ed-changes-box"${innerWidth > 900 ? ' open' : ''}><summary>Changes</summary><ul class="ed-changes"></ul></details>
          <div class="ed-evolve-actions"><button class="ed-undo-all ghost-button">Undo all</button><button class="ed-fix ghost-button">Fix for me</button></div>
        </section>` : ''}</aside>
      <div class="ed-regions" aria-label="Slots per body region">${REGIONS.map(r => `<span class="ed-region" data-region="${r}"></span>`).join('')}</div>
      <div class="ed-alerts">
        <p class="ed-problem-line" role="status" hidden></p>
        <div class="ed-lost-abilities" hidden></div>
        <p class="ed-submit-error" role="alert" hidden></p>
      </div>
      <div class="ed-tool" hidden></div>
      <div class="ed-confirm" role="alertdialog" aria-live="assertive" hidden><p></p><button class="ed-confirm-yes primary">Place one</button><button class="ed-confirm-no ghost-button">Cancel</button></div>
      <div class="ed-hint" aria-live="polite"></div>`;
    document.querySelector('#app')!.append(this.root);
    this.canvas = this.root.querySelector('.ed-view')!;
    this.renderer = new T.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65)); this.renderer.outputColorSpace = T.SRGBColorSpace; this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.scene.add(new T.HemisphereLight('#d6fbf6', '#3d6d6d', 2.2));
    const key = new T.DirectionalLight('#fff0cb', 2.4); key.position.set(-3, 6, 4); this.scene.add(key);
    const rim = new T.DirectionalLight('#84e7ea', 1.2); rim.position.set(3, 2, -5); this.scene.add(rim);
    this.floor = new T.Mesh(new T.CircleGeometry(3.2, 48), new T.MeshBasicMaterial({ color: '#0f3c43', transparent: true, opacity: .35 })); this.floor.rotation.x = -Math.PI / 2; this.floor.position.y = -1.25; this.floor.name = 'floor'; this.scene.add(this.floor);
    // One persistent model, two region rings and a pool of vertebra handles for the whole session.
    this.model = new CreatureModel(this.draft); this.scene.add(this.model.group);
    const circle: number[] = []; for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2; circle.push(Math.sin(a), Math.cos(a), 0); }
    this.ringGeometry = new T.BufferGeometry(); this.ringGeometry.setAttribute('position', new T.Float32BufferAttribute(circle, 3));
    for (let i = 0; i < 2; i++) { const ring = new T.LineLoop(this.ringGeometry, this.ringMaterial); ring.renderOrder = 4; ring.visible = false; this.rings.push(ring); this.scene.add(ring); }
    for (let i = 0; i < MAX_HANDLES; i++) { const handle = new T.Mesh(this.handleGeometry, this.handleMaterials[0]); handle.renderOrder = 5; handle.visible = false; handle.userData.vertebra = i; this.handles.push(handle); this.scene.add(handle); }
    const nameInput = this.root.querySelector<HTMLInputElement>('.ed-name')!; nameInput.value = this.name;
    nameInput.addEventListener('input', () => { this.name = nameInput.value; });
    this.root.querySelector<HTMLButtonElement>('.ed-undo')!.onclick = () => this.undo();
    this.root.querySelector<HTMLButtonElement>('.ed-cancel')!.onclick = () => { if (!this.submitting) this.close(null); };
    this.root.querySelector<HTMLButtonElement>('.ed-done')!.onclick = () => void this.finish();
    const undoAll = this.root.querySelector<HTMLButtonElement>('.ed-undo-all'), fix = this.root.querySelector<HTMLButtonElement>('.ed-fix');
    if (undoAll) undoAll.onclick = () => this.replace(cloneGenome(this.original), []);
    if (fix) fix.onclick = () => this.fixForMe();
    this.root.querySelector<HTMLButtonElement>('.ed-confirm-yes')!.onclick = () => { const placed = this.pairPrompt; this.showPairPrompt(null); if (placed) this.addPart({ ...placed, mirror: false }); };
    this.root.querySelector<HTMLButtonElement>('.ed-confirm-no')!.onclick = () => this.showPairPrompt(null);
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(button => button.onclick = () => { this.tab = button.dataset.tab as Tab; this.disarm(); this.selected = null; this.render(); });
    this.canvas.addEventListener('pointerdown', e => this.pointerDown(e));
    this.canvas.addEventListener('pointermove', e => this.pointerMove(e));
    this.canvas.addEventListener('pointerup', e => this.pointerUp(e));
    this.canvas.addEventListener('pointercancel', () => { this.orbit = null; this.dragging = null; this.handleDrag = null; this.pending = null; });
    this.canvas.addEventListener('wheel', e => { e.preventDefault(); this.zoom = T.MathUtils.clamp(this.zoom * (1 + Math.sign(e.deltaY) * .08), .55, 2); }, { passive: false });
    addEventListener('resize', this.onResize); addEventListener('keydown', this.onKey);
    this.resize(); this.render();
    const loop = () => { if (this.closed) return; this.frame = requestAnimationFrame(loop); this.draw(); };
    loop();
    this.root.querySelector<HTMLButtonElement>('.ed-done')!.focus();
  }

  // ----- the ledger and the rules -----
  private quote(g: Genome = this.draft): Quote { return quoteDesign(this.options.economy, this.original, g); }
  private dnaLeft(q: Quote) { return walletTotal(this.options.economy) - q.net; }
  private issues(g: Genome = this.draft, q = this.quote(g)): GenomeProblem[] {
    const out = problems(g, this.options.plan, { unlocked: this.options.unlocked, diet: this.options.diet }, this.catalog);
    if (!q.affordable) out.push({ code: 'dna', message: `Short by ${q.shortfall} DNA` });
    return out;
  }
  private get limit() { return PART_LIMITS[this.options.plan.size]!; }
  private allowedIn(r: Region, kind: PartKind) { return !this.options.plan.bans.includes(kind) && this.options.plan.regions[r].kinds.includes(kind); }
  private kindAllowed(kind: PartKind) { return REGIONS.some(r => this.allowedIn(r, kind)); }
  /** Why `candidate` is worse than the draft (more DNA short, a region or the body over its slots), or null. */
  private refusal(candidate: Genome): string | null {
    const now = this.quote(), next = this.quote(candidate);
    if (next.shortfall > now.shortfall) return `Not enough DNA. Short by ${next.shortfall} DNA.`;
    const before = regionUse(this.draft), after = regionUse(candidate), plan = this.options.plan;
    for (const r of REGIONS) if (after[r] > plan.regions[r].slots && after[r] > before[r]) return `The ${r} is full: ${plan.regions[r].slots} slots.`;
    const count = instanceCount(candidate);
    if (count > this.limit && count > instanceCount(this.draft)) return `Too complex. ${this.limit} slots at this size.`;
    return null;
  }
  private with(change: (g: Genome) => void): Genome { const g = cloneGenome(this.draft); change(g); return g; }
  private placedBy(uid: string | null) { return uid === null ? undefined : this.draft.parts.find(p => p.uid === uid); }

  // ----- history -----
  /** A discrete edit: it may change the topology, so the model is re-bound here, outside the animation loop. */
  private commit(change: (g: Genome) => void) {
    this.pushHistory(); change(this.draft); this.afterEdit();
  }
  private replace(genome: Genome, changes: string[]) {
    this.pushHistory(); this.draft = genome; this.changes = changes; this.afterEdit();
  }
  private pushHistory() {
    this.pending = null;
    this.history.push({ genome: cloneGenome(this.draft), changes: [...this.changes] }); if (this.history.length > 60) this.history.shift();
  }
  /** Starts a gesture: its snapshot enters the history only if the gesture changes something. */
  private beginGesture() { this.pending = { genome: cloneGenome(this.draft), changes: [...this.changes] }; }
  private touchGesture() {
    if (this.pending) { this.history.push(this.pending); if (this.history.length > 60) this.history.shift(); this.pending = null; }
    this.showSubmitError(null);
  }
  private afterEdit() {
    this.model.setGenome(this.draft);
    if (this.selected !== null && !this.placedBy(this.selected)) this.selected = null;
    this.showSubmitError(null); this.render();
  }
  private undo() {
    const prior = this.history.pop(); if (!prior) return;
    this.pending = null; this.draft = prior.genome; this.changes = prior.changes; this.afterEdit();
  }
  private fixForMe() {
    const a = adaptToPlan(this.draft, this.options.plan, { unlocked: this.options.unlocked, diet: this.options.diet }, this.serial);
    if (!a.ok) { this.hint(a.reasons[0] ?? 'No automatic fix found.'); return; }
    this.serial = Math.max(this.serial, a.nextSerial);
    this.replace(a.genome, a.changes);
    this.hint(a.changes.length ? 'Fixed. Check the changes.' : 'Nothing to fix.');
  }
  private async finish() {
    if (this.submitting || this.closed) return;
    const issue = this.issues()[0];
    if (issue) { this.hint(issue.message); return; }
    const result: EditorResult = { genome: cloneGenome(this.draft), name: this.name.trim() || this.options.name, nextSerial: this.serial };
    this.submitting = true; this.showSubmitError(null); this.renderStatsOnly();
    let outcome: SubmitOutcome;
    try { outcome = await this.options.onSubmit(result); }
    catch (error) { outcome = { ok: false, reason: error instanceof Error ? error.message : 'Something went wrong. Try again.' }; }
    this.submitting = false;
    if (outcome.ok) { this.close(result); return; }
    // The draft, the undo history and the gesture state stay as they are.
    this.showSubmitError(outcome.reason); this.renderStatsOnly();
  }
  private showSubmitError(reason: string | null) {
    const el = this.root.querySelector<HTMLElement>('.ed-submit-error')!;
    if (reason === null && el.hidden) return;
    el.hidden = reason === null; el.textContent = reason ?? '';
  }
  private close(result: EditorResult | null) {
    if (this.closed) return;
    this.closed = true; cancelAnimationFrame(this.frame);
    removeEventListener('resize', this.onResize); removeEventListener('keydown', this.onKey);
    this.model.dispose();
    this.handleGeometry.dispose(); for (const m of this.handleMaterials) m.dispose();
    this.ringGeometry.dispose(); this.ringMaterial.dispose();
    this.floor.geometry.dispose(); (this.floor.material as T.Material).dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.root.remove();
    this.done(result);
  }
  private disarm() { this.placing = null; this.model.setGhost(null); this.showPairPrompt(null); }
  private key(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === 'Escape') {
      event.preventDefault(); if (this.submitting) return;
      if (this.pairPrompt) this.showPairPrompt(null);
      else if (this.placing || this.selected !== null) { this.disarm(); this.selected = null; this.render(); }
      else this.close(null);
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selected !== null) this.removeSelected();
    if (event.key === 'z' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); this.undo(); }
  }
  private hint(text: string) { const el = this.root.querySelector<HTMLElement>('.ed-hint')!; el.textContent = text; el.classList.add('show'); clearTimeout(Number(el.dataset.timer)); el.dataset.timer = String(setTimeout(() => el.classList.remove('show'), 2600)); }

  // ----- 3D -----
  private resize() {
    const width = innerWidth, height = innerHeight; this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
  }
  private draw() {
    const model = this.model, g = this.draft;
    // Body-shape changes rebuild the mesh at most once per frame.
    if (model.bodyStale) model.rebuildBody();
    model.animate(performance.now() / 1000, 0, 0);
    const l = model.layout, n = g.spine.length;
    this.handles.forEach((handle, i) => {
      const s = g.spine[i], show = this.tab === 'body' && !!s && !segmentRule(this.options.plan, i, n).locked;
      handle.visible = show; if (!show || !s) return;
      handle.position.set(0, s.lift + s.height + .28, l.z[i]!); handle.material = this.handleMaterials[i === this.vertebra ? 1 : 0];
    });
    const ringsOn = this.placing !== null || this.dragging !== null;
    this.rings.forEach((ring, i) => {
      ring.visible = ringsOn; if (!ringsOn) return;
      const z = zAt(l, i === 0 ? .25 : .75), p = profile(g, l, z);
      ring.position.set(0, p.lift, z); ring.scale.set(p.r * 1.08 + .02, p.h * 1.08 + .02, 1);
    });
    // Fit the whole creature in the narrower field of view, so phones see all of it.
    const radius = model.length / 2 + .6, vertical = T.MathUtils.degToRad(this.camera.fov), horizontal = 2 * Math.atan(Math.tan(vertical / 2) * this.camera.aspect);
    const distance = radius / Math.sin(Math.min(vertical, horizontal) / 2) * this.zoom;
    this.camera.position.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(distance);
    this.camera.lookAt(0, 0, 0);
    // Desktop layouts put the panel on the left; nudge the creature to the free space.
    const wide = innerWidth > 900; this.camera.setViewOffset(innerWidth, innerHeight, wide ? -innerWidth * .08 : 0, wide ? 0 : innerHeight * .12, innerWidth, innerHeight);
    this.renderer.render(this.scene, this.camera);
    this.syncViewData();
  }
  /** Read-only test data on `.ed-view`. Attributes are written only when they change. */
  private syncViewData() {
    const c = this.model.counters, sel = this.placedBy(this.selected);
    const gesture: Gesture = this.handleDrag ? 'handle-drag' : this.dragging ? 'part-drag' : this.cardDrag ? 'card-drag' : this.orbit ? 'turn' : 'none';
    const data: Record<string, string> = {
      'data-created-geometries': String(c.createdGeometries), 'data-disposed-geometries': String(c.disposedGeometries),
      'data-created-materials': String(c.createdMaterials), 'data-disposed-materials': String(c.disposedMaterials), 'data-rebuilds': String(c.rebuilds),
      'data-yaw': this.yaw.toFixed(4), 'data-zoom': this.zoom.toFixed(4), 'data-gesture': gesture, 'data-selected': sel ? `${sel.uid}|${sel.t}|${sel.angle}` : '',
    };
    for (const name in data) if (this.viewData.get(name) !== data[name]) { this.viewData.set(name, data[name]!); this.canvas.setAttribute(name, data[name]!); }
  }
  private pick(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const handle = this.raycaster.intersectObjects(this.handles.filter(h => h.visible), false)[0];
    const hits = this.raycaster.intersectObject(this.model.group, true);
    let partUid: string | null = null, bodyPoint: T.Vector3 | null = null;
    for (const hit of hits) {
      let node: T.Object3D | null = hit.object;
      while (node && node.userData.partUid === undefined && !node.userData.ghost) node = node.parent;
      if (node && (node.userData.ghost || !node.visible)) continue;   // the placement preview is never picked
      if (node) { if (partUid === null && !bodyPoint) partUid = node.userData.partUid as string; continue; }
      if (hit.object === this.model.body && !bodyPoint) bodyPoint = hit.point;
    }
    return { handle: handle?.object.userData.vertebra as number | undefined, partUid, bodyPoint };
  }
  private placement(point: T.Vector3, id: string): PlacedPart {
    const spec = part(id)!, { t, angle } = locate(this.draft, this.model.layout, point);
    // Mouths and tails snap to the tips; everything else sits where it was dropped.
    // A drop away from the head puts the mouth on the front tip; a tail goes on the rear tip.
    const snapped = spec.kind === 'mouth' ? (t > .15 ? { t: 0, angle: 0 } : { t, angle }) : spec.kind === 'tail' ? (t < .85 ? { t: 1, angle: 0 } : { t, angle }) : { t, angle };
    const placed: PlacedPart = { uid: 'ghost', id, t: snapped.t, angle: snapped.angle, scale: 1, mirror: spec.mirror, roll: 0 };
    if (placed.mirror && badMirror(placed)) placed.mirror = false;
    return placed;
  }
  private pointerDown(event: PointerEvent) {
    this.canvas.setPointerCapture(event.pointerId);
    const { handle, partUid } = this.pick(event);
    if (handle !== undefined && this.tab === 'body') {
      const s = this.draft.spine[handle]!;
      this.vertebra = handle; this.beginGesture(); this.handleDrag = { index: handle, y: event.clientY, start: { radius: s.radius, height: s.height } };
      this.render(); return;
    }
    if (!this.placing && partUid !== null && this.tab === 'parts') {
      this.selected = partUid; this.beginGesture(); this.dragging = { uid: partUid }; this.render(); return;
    }
    this.orbit = { x: event.clientX, y: event.clientY, id: event.pointerId, moved: false };
  }
  private pointerMove(event: PointerEvent) {
    if (this.handleDrag) {
      // Drag a vertebra handle up or down to make the body fatter or thinner there.
      const { index, start } = this.handleDrag, factor = 1 + (this.handleDrag.y - event.clientY) / 160, s = this.draft.spine[index]!;
      const rule = segmentRule(this.options.plan, index, this.draft.spine.length);
      const radius = T.MathUtils.clamp(start.radius * factor, ...rule.radius), height = T.MathUtils.clamp(start.height * factor, ...rule.height);
      if (radius === s.radius && height === s.height) return;
      this.touchGesture(); s.radius = radius; s.height = height;
      this.renderStatsOnly(); this.syncBodySliders(); return;
    }
    if (this.dragging) {
      const current = this.placedBy(this.dragging.uid); if (!current) return;
      const { bodyPoint } = this.pick(event); if (!bodyPoint) return;
      const next = this.placement(bodyPoint, current.id);
      // A drag never changes the topology: a pair stays a pair, so it cannot move to a pole or a tip.
      if (current.mirror && badMirror({ ...current, t: next.t, angle: next.angle })) return;
      if (next.t === current.t && next.angle === current.angle) return;
      this.touchGesture(); current.t = next.t; current.angle = next.angle;
      this.model.updatePart(current.uid); this.renderStatsOnly(); return;
    }
    if (this.placing) {
      const { bodyPoint } = this.pick(event);
      this.model.setGhost(bodyPoint ? this.placement(bodyPoint, this.placing) : null); return;
    }
    if (this.orbit && event.pointerId === this.orbit.id) {
      const dx = event.clientX - this.orbit.x, dy = event.clientY - this.orbit.y;
      if (Math.hypot(dx, dy) > 3) this.orbit.moved = true;
      this.yaw -= dx * .008; this.pitch = T.MathUtils.clamp(this.pitch + dy * .006, -.9, 1.3);
      this.orbit.x = event.clientX; this.orbit.y = event.clientY;
    }
  }
  private pointerUp(event: PointerEvent) {
    if (this.handleDrag) { this.handleDrag = null; this.orbit = null; this.pending = null; this.render(); return; }
    if (this.dragging) { this.dragging = null; this.pending = null; this.render(); return; }
    // A card dragged onto the body is placed by the panel's pointerup handler.
    if (this.cardDrag) return;
    if (this.placing) {
      const { bodyPoint } = this.pick(event);
      if (bodyPoint) this.addPart(this.placement(bodyPoint, this.placing));
      return;
    }
    const tap = this.orbit && !this.orbit.moved; this.orbit = null;
    if (tap && this.selected !== null) { this.selected = null; this.render(); }
  }

  // ----- parts -----
  private mouth() { return this.draft.parts.find(p => part(p.id)?.kind === 'mouth'); }
  /** Why a card can't be used now, or null. */
  private cardReason(spec: PartSpec): string | null {
    if (!isUnlocked(spec.id, this.options.plan.size, this.options.unlocked)) return `Not found yet. Reach ${STAGES[spec.stage]?.title ?? 'a bigger'} size or explore.`;
    if (spec.kind === 'mouth' && this.options.diet && spec.diet !== this.options.diet) return DIET_LOCK;
    if (spec.kind === 'mouth' && this.mouth()) return null;   // a mouth swap needs no room
    const used = regionUse(this.draft);
    if (!REGIONS.some(r => this.allowedIn(r, spec.kind) && used[r] < this.options.plan.regions[r].slots)) return `No room for a ${spec.name.toLowerCase()}: every region it fits is full.`;
    return null;
  }
  /** Swaps the mouth's part id in place: the uid, `t` and `angle` stay. False when there is no mouth to swap. */
  private replaceMouth(id: string) {
    const mouth = this.mouth(); if (!mouth) return false;
    if (this.options.diet && part(id)?.diet !== this.options.diet) { this.hint(DIET_LOCK); return true; }
    if (mouth.id === id) { this.disarm(); this.selected = mouth.uid; this.render(); return true; }
    const why = this.refusal(this.with(g => { g.parts.find(p => p.uid === mouth.uid)!.id = id; }));
    if (why) { this.hint(why); return true; }
    this.disarm(); this.selected = mouth.uid;
    this.commit(g => { g.parts.find(p => p.uid === mouth.uid)!.id = id; });
    this.hint(`${part(id)!.name} fitted.`);
    return true;
  }
  private addPart(placed: PlacedPart) {
    const spec = part(placed.id)!;
    if (spec.kind === 'mouth' && this.replaceMouth(placed.id)) return;
    const region = regionOf(placed.t);
    if (!this.allowedIn(region, spec.kind)) { this.hint(`${spec.name} doesn't fit in the ${region}.`); return; }
    if (placed.mirror && badMirror(placed)) placed.mirror = false;
    const candidate = (p: PlacedPart) => this.with(g => { g.parts.push({ ...p, uid: nextUid(this.serial) }); });
    const why = this.refusal(candidate(placed));
    if (why) {
      if (placed.mirror && !this.refusal(candidate({ ...placed, mirror: false }))) { this.showPairPrompt(placed); return; }
      this.hint(why); return;
    }
    this.disarm();
    const uid = nextUid(this.serial++);
    this.selected = uid;
    this.commit(g => { g.parts.push({ ...placed, uid }); });
    this.hint(`${spec.name} added. Drag it to move it.`);
  }
  private showPairPrompt(placed: PlacedPart | null) {
    this.pairPrompt = placed;
    const box = this.root.querySelector<HTMLElement>('.ed-confirm')!;
    box.hidden = !placed;
    if (placed) { box.querySelector('p')!.textContent = `Only room for one ${part(placed.id)!.name}. Place one?`; box.querySelector<HTMLButtonElement>('.ed-confirm-yes')!.focus(); }
  }
  /** Keyboard and quick taps: the part's usual spot, or the nearest region that takes it and has room. */
  private quickAdd(spec: PartSpec) {
    const used = regionUse(this.draft), home = regionOf(spec.t);
    const fits = (r: Region) => this.allowedIn(r, spec.kind) && used[r] < this.options.plan.regions[r].slots;
    const target = fits(home) ? null : REGIONS.filter(fits).sort((a, b) => Math.abs(REGION_T[a] - REGION_T[home]) - Math.abs(REGION_T[b] - REGION_T[home]))[0];
    this.addPart({ uid: 'ghost', id: spec.id, t: target ? REGION_T[target] : spec.t, angle: spec.angle, scale: 1, mirror: spec.mirror, roll: 0 });
  }
  private removeSelected() {
    const uid = this.selected; if (uid === null) return;
    this.selected = null;
    this.commit(g => { g.parts = g.parts.filter(p => p.uid !== uid); });
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
    const present = KIND_ORDER.filter(kind => PARTS.some(p => p.kind === kind));
    const kinds = present.filter(kind => this.kindAllowed(kind)), hidden = present.filter(kind => !this.kindAllowed(kind));
    if (!kinds.includes(this.kind) && kinds[0]) this.kind = kinds[0];
    panel.innerHTML = `<div class="ed-kinds" role="tablist" aria-label="Part types">${kinds.map(kind => `<button data-kind="${kind}" aria-selected="${kind === this.kind}">${KIND_LABELS[kind]}</button>`).join('')}</div>
      ${hidden.length ? `<p class="ed-kind-note">${esc(this.options.plan.name)}s can't use: ${hidden.map(k => KIND_LABELS[k].toLowerCase()).join(', ')}.</p>` : ''}
      <div class="ed-cards">${PARTS.filter(p => p.kind === this.kind).map(spec => {
        const reason = this.cardReason(spec), found = isUnlocked(spec.id, this.options.plan.size, this.options.unlocked), early = found && spec.stage > this.options.plan.size;
        return `<button class="ed-card ${this.placing === spec.id ? 'active' : ''}" data-part="${spec.id}" ${reason ? `disabled data-reason="${esc(reason)}"` : ''} aria-label="${esc(spec.name)}, ${spec.cost} DNA${reason ? `. ${esc(reason)}` : ''}">
          <img src="${thumbnails.get(spec.id) ?? ''}" alt=""><strong>${esc(spec.name)}</strong><span class="ed-cost">${found ? `${spec.cost} DNA` : `🔒 ${STAGES[spec.stage]!.title}`}</span>
          <small>${reason && found ? `<span class="ed-reason">${esc(reason)}</span>` : `${statLine(spec.stats)}${spec.diet ? ` · ${spec.diet}` : ''}`}</small>${early ? '<em>FOUND!</em>' : ''}</button>`;
      }).join('')}</div>
      <p class="ed-tip">${this.placing ? 'Tap your creature to place it. Tap the card again to stop.' : 'Choose a part, then tap your creature. Drag the empty space to turn around.'}</p>`;
    panel.querySelectorAll<HTMLButtonElement>('[data-kind]').forEach(button => button.onclick = () => { this.kind = button.dataset.kind as PartKind; this.disarm(); this.render(); });
    panel.querySelectorAll<HTMLButtonElement>('[data-part]').forEach(button => {
      button.onclick = click => {
        const id = button.dataset.part!, spec = part(id)!;
        if (button.disabled) return;
        if (spec.kind === 'mouth' && this.replaceMouth(id)) return;
        if (this.placing === id) { this.disarm(); this.render(); return; }
        this.placing = id; this.selected = null; this.model.setGhost(null); this.render();
        // Keyboard and quick taps place the part at its usual spot right away.
        if (matchMedia('(pointer: coarse)').matches || click.detail === 0) this.quickAdd(spec);
      };
      // Drag a card onto the creature to place it.
      button.addEventListener('pointerdown', e => { if (button.disabled) return; this.cardDrag = { id: button.dataset.part!, x: e.clientX, y: e.clientY }; });
    });
    this.root.onpointermove = e => {
      if (!this.cardDrag || Math.hypot(e.clientX - this.cardDrag.x, e.clientY - this.cardDrag.y) < 12) return;
      if (part(this.cardDrag.id)?.kind === 'mouth' && this.mouth()) return;
      this.placing = this.cardDrag.id; const { bodyPoint } = this.pick(e);
      this.model.setGhost(bodyPoint ? this.placement(bodyPoint, this.placing) : null);
    };
    this.root.onpointerup = e => {
      const drag = this.cardDrag; this.cardDrag = null;
      if (!drag || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 12) return;
      const { bodyPoint } = this.pick(e);
      if (bodyPoint) this.addPart(this.placement(bodyPoint, drag.id)); else { this.disarm(); this.render(); }
    };
  }
  private sizeCost(p: PlacedPart) { const slots = partSlots(p); return `${partCost(p)} DNA · ${slots} slot${slots === 1 ? '' : 's'}`; }
  private renderTool() {
    const tool = this.root.querySelector<HTMLElement>('.ed-tool')!;
    const placed = this.placedBy(this.selected);
    tool.hidden = !placed || this.tab !== 'parts'; if (!placed || tool.hidden) return;
    const spec = part(placed.id)!, uid = placed.uid;
    const refund = this.quote().net - this.quote(this.with(g => { g.parts = g.parts.filter(p => p.uid !== uid); })).net;
    tool.innerHTML = `<strong>${esc(spec.name)}</strong>
      <label>Size<input type="range" class="ed-scale" min="${SCALE_RANGE[0]}" max="${SCALE_RANGE[1]}" step=".05" value="${placed.scale}"></label>
      <span class="ed-size-cost">${this.sizeCost(placed)}</span>
      <label>Turn<input type="range" class="ed-roll" min="${-Math.PI}" max="${Math.PI}" step=".05" value="${placed.roll}"></label>
      ${spec.mirror ? `<button class="ed-mirror ghost-button" aria-pressed="${placed.mirror}">${placed.mirror ? 'Pair ✓' : 'Pair'}</button>` : ''}
      <button class="ed-delete ghost-button">Remove${refund > 0 ? ` (+${refund})` : ''}</button>`;
    const scale = tool.querySelector<HTMLInputElement>('.ed-scale')!, roll = tool.querySelector<HTMLInputElement>('.ed-roll')!, cost = tool.querySelector<HTMLElement>('.ed-size-cost')!;
    for (const input of [scale, roll]) { input.addEventListener('pointerdown', () => this.beginGesture()); input.addEventListener('keydown', () => this.beginGesture()); input.addEventListener('change', () => { this.pending = null; }); }
    scale.oninput = () => {
      const current = this.placedBy(uid); if (!current) return;
      const value = Number(scale.value);
      if (!this.pending) this.beginGesture();
      // A size the region or the DNA can't take keeps the old value.
      const why = this.refusal(this.with(g => { g.parts.find(p => p.uid === uid)!.scale = value; }));
      if (why) { scale.value = String(current.scale); cost.textContent = this.sizeCost(current); this.hint(why); return; }
      this.touchGesture(); current.scale = value; cost.textContent = this.sizeCost(current);
      this.model.updatePart(uid); this.renderStatsOnly();
    };
    roll.oninput = () => {
      const current = this.placedBy(uid); if (!current) return;
      if (!this.pending) this.beginGesture();
      this.touchGesture(); current.roll = Number(roll.value); this.model.updatePart(uid);
    };
    const mirror = tool.querySelector<HTMLButtonElement>('.ed-mirror');
    if (mirror) mirror.onclick = () => {
      const current = this.placedBy(uid); if (!current) return;
      if (!current.mirror) {
        if (badMirror({ ...current, mirror: true })) { this.hint('Pairs go on the sides, not at the top, the bottom or the tips.'); return; }
        const why = this.refusal(this.with(g => { g.parts.find(p => p.uid === uid)!.mirror = true; }));
        if (why) { this.hint(`No room for a pair. ${why}`); return; }
      }
      this.commit(g => { const p = g.parts.find(x => x.uid === uid)!; p.mirror = !p.mirror; });
    };
    tool.querySelector<HTMLButtonElement>('.ed-delete')!.onclick = () => this.removeSelected();
  }
  private renderBody(panel: HTMLElement) {
    const spine = this.draft.spine, plan = this.options.plan, n = spine.length;
    this.vertebra = Math.min(this.vertebra, n - 1);
    const rule = segmentRule(plan, this.vertebra, n), locked = !!rule.locked;
    panel.innerHTML = `<div class="ed-vertebrae" role="group" aria-label="Body segments">${spine.map((_, i) => {
      const lock = !!segmentRule(plan, i, n).locked, label = i === 0 ? 'Head' : i === n - 1 ? 'Tail' : String(i);
      return `<button data-v="${i}" aria-pressed="${i === this.vertebra}"${lock ? ` data-locked="true" aria-label="${label}, fixed shape"` : ''}>${lock ? '<span aria-hidden="true">🔒 </span>' : ''}${label}</button>`;
    }).join('')}</div>
      <label class="ed-slider">Width<input type="range" data-key="radius" min="${rule.radius[0]}" max="${rule.radius[1]}" step=".01"${locked ? ' disabled' : ''}></label>
      <label class="ed-slider">Height<input type="range" data-key="height" min="${rule.height[0]}" max="${rule.height[1]}" step=".01"${locked ? ' disabled' : ''}></label>
      <label class="ed-slider">Arch<input type="range" data-key="lift" min="${SPINE_RANGE.lift[0]}" max="${SPINE_RANGE.lift[1]}" step=".01"></label>
      <div class="ed-row"><button class="ed-add ghost-button" ${n >= plan.spine.max ? 'disabled' : ''}>+ Longer</button><button class="ed-remove ghost-button" ${n <= plan.spine.min ? 'disabled' : ''}>− Shorter</button></div>
      <p class="ed-tip">${locked ? `A ${esc(plan.name)} has a fixed shape here. ` : 'Drag a glowing dot up or down to shape the body. '}${n} / ${plan.spine.max} segments.</p>`;
    panel.querySelectorAll<HTMLButtonElement>('[data-v]').forEach(button => button.onclick = () => { this.vertebra = Number(button.dataset.v); this.render(); });
    panel.querySelectorAll<HTMLInputElement>('[data-key]').forEach(input => {
      input.addEventListener('pointerdown', () => this.beginGesture());
      input.addEventListener('keydown', () => this.beginGesture());
      input.addEventListener('change', () => { this.pending = null; });
      input.oninput = () => {
        if (!this.pending) this.beginGesture();
        this.touchGesture();
        (this.draft.spine[this.vertebra]! as unknown as Record<string, number>)[input.dataset.key!] = Number(input.value);
        this.renderStatsOnly();
      };
    });
    this.syncBodySliders();
    // Part positions are relative to the body length, so they stay in place. A new segment follows its segment rule.
    panel.querySelector<HTMLButtonElement>('.ed-add')!.onclick = () => this.commit(g => {
      const at = Math.min(Math.max(1, this.vertebra), g.spine.length - 1), copy = { ...g.spine[at]! };
      g.spine.splice(at, 0, copy);
      const r = segmentRule(plan, at, g.spine.length);
      copy.radius = r.locked ? r.radius[0] : T.MathUtils.clamp(copy.radius, ...r.radius);
      copy.height = r.locked ? r.height[0] : T.MathUtils.clamp(copy.height, ...r.height);
      this.vertebra = at;
    });
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
    const plan = this.options.plan, q = this.quote(), issues = this.issues(this.draft, q);
    const stats = effectiveStats(this.draft, plan), derived = derive(stats), count = instanceCount(this.draft), left = this.dnaLeft(q);
    this.root.querySelector('.ed-dna-value')!.textContent = String(Math.floor(left));
    this.root.querySelector('.ed-dna')!.classList.toggle('low', left < 0);
    const mouth = this.mouth(), diet = (mouth && part(mouth.id)?.diet) || 'omnivore';
    this.root.querySelector<HTMLElement>('.ed-stats-body')!.innerHTML = `<div class="ed-diet"><span>DIET${this.options.diet ? ' <b aria-label="locked">🔒</b>' : ''}</span><strong>${diet}</strong></div>
      ${STAT_ROWS.map(([key, label, max]) => `<div class="ed-stat"><span>${label}</span><i><b style="width:${Math.max(0, Math.min(100, stats[key] / max * 100))}%"></b></i><em>${stats[key]}</em></div>`).join('')}
      <div class="ed-stat"><span>Hearts</span><em>${derived.maxHealth}</em></div>
      <div class="ed-complexity"><span>COMPLEXITY</span><i><b style="width:${Math.min(100, count / this.limit * 100)}%"></b></i><em>${count} / ${this.limit}</em></div>
      ${issues.length ? `<p class="ed-problem">${esc(issues[0]!.message)}</p>` : ''}`;
    const line = this.root.querySelector<HTMLElement>('.ed-problem-line')!;
    line.hidden = !issues.length; line.textContent = issues[0]?.message ?? '';
    // Region chips: Σ partSlots per region.
    const used = regionUse(this.draft);
    this.root.querySelectorAll<HTMLElement>('.ed-region').forEach(chip => {
      const r = chip.dataset.region as Region, slots = plan.regions[r].slots;
      chip.textContent = `${REGION_LABEL[r]} ${used[r]} / ${slots}`; chip.classList.toggle('over', used[r] >= slots);
    });
    // Abilities whose binding this design would clear.
    const cleared = designDelta(this.original, this.draft, this.options.loadout, this.catalog).clearedBindings, lost = this.root.querySelector<HTMLElement>('.ed-lost-abilities')!;
    lost.hidden = !cleared.length;
    lost.innerHTML = cleared.length ? `<strong>You lose these abilities:</strong><ul>${cleared.map(c => `<li>Slot ${c.slot + 1}: ${esc(this.grantName(c.binding.grantId, c.binding.partUid))} (${c.reason})</li>`).join('')}</ul>` : '';
    const changes = this.root.querySelector<HTMLElement>('.ed-changes');
    if (changes) {
      changes.innerHTML = (this.changes.length ? this.changes : ['No changes from your design.']).map(c => `<li><span aria-hidden="true">• </span>${esc(c)}</li>`).join('');
      this.root.querySelector('.ed-changes-box summary')!.textContent = `Changes (${this.changes.length})`;
      this.root.querySelector<HTMLButtonElement>('.ed-undo-all')!.disabled = this.submitting || JSON.stringify(this.draft) === JSON.stringify(this.original);
      const fix = this.root.querySelector<HTMLButtonElement>('.ed-fix')!;
      fix.hidden = !issues.some(i => i.code !== 'dna'); fix.disabled = this.submitting;
    }
    this.model.setHighlight(this.selected === null ? [] : [this.selected], 'selected');
    this.model.setHighlight(issues.flatMap(i => i.uid ? [i.uid] : []), 'problem');
    this.root.querySelector<HTMLButtonElement>('.ed-done')!.disabled = issues.length > 0 || this.submitting;
    this.root.querySelector<HTMLButtonElement>('.ed-cancel')!.disabled = this.submitting;
    this.root.querySelector<HTMLButtonElement>('.ed-undo')!.disabled = !this.history.length || this.submitting;
  }
  private grantName(grantId: string, partUid: string) {
    const placed = this.original.parts.find(p => p.uid === partUid), spec = placed && this.catalog.find(s => s.id === placed.id);
    return spec ? `${spec.name} ${grantId}` : grantId;
  }
}
function statLine(stats: Partial<Stats>) {
  return Object.entries(stats).map(([key, value]) => `${value! > 0 ? '+' : ''}${value} ${key}`).join(' · ');
}
