import * as T from 'three';
import { batch, coral, foodModel, kelp, material, sceneryAsset } from './models';
import { biomeAt, PLAYER_HALF, random, seabedHeight, SIZES, WATER_LEVEL, type Biome } from './biomes';
import { EDGE_SOFT_START } from './edge';
import { CreatureModel } from './creature';
import { Ecosystem, type Entity } from './ecosystem';
import type { Vec3 } from './combat-types';
import type { Genome } from './genome';
import type { FoodKind } from './species';

export { seabedHeight };
/** Gameplay view of an entity, in the current stage's local units. */
export interface Food { id: number; kind: FoodKind; tier: number; x: number; y: number; z: number; eaten: boolean; phase: number }
export interface FoodObject { data: Food; entity: Entity; model: T.Group; tier: number }
interface Particle { mesh: T.Mesh; life: number; velocity: T.Vector3 }
const particleGeometry = new T.SphereGeometry(.09, 6, 4);
const circleGeometry = new T.CircleGeometry(1, 40);
const ringGeometry = new T.RingGeometry(1, 1.025, 56);
const shadowMaterial = new T.MeshBasicMaterial({ color: '#103e4f', transparent: true, opacity: .2, depthWrite: false });
const ringMaterial = new T.MeshBasicMaterial({ color: '#e0f6ad', transparent: true, opacity: .75, side: T.DoubleSide, depthWrite: false });
const UP = new T.Vector3(0, 1, 0);
// The soft world edge (edge.ts): in the push zone the water gets darker and foggier, and scenery past the hard bound
// (render units = stage-local units, so the bound is at ±PLAYER_HALF) fades into the fog colour.
/** Fog density at the full edge fog (the clear-water density is .014). */
const EDGE_FOG_DENSITY = .045;
/** The fog colour mixes this far toward EDGE_DARK at the full edge fog. */
const EDGE_DARKEN = .6;
const EDGE_DARK = new T.Color('#0b2f3a');
/** Scenery fades into the fog between these Chebyshev distances from the centre (render units). */
const EDGE_FADE_FROM = PLAYER_HALF, EDGE_FADE_TO = PLAYER_HALF * 1.16;
/** Shared by every scenery material: the fade strength (off in space) and the height (render units) above which nothing fades (clouds). */
const edgeUniforms = { edgeFade: { value: 1 }, edgeTop: { value: 200 } };
function edgeFadeShader(shader: T.WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, edgeUniforms);
  shader.vertexShader = shader.vertexShader.replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\nvarying vec3 vEdgeWorld;')
    .replace('#include <fog_vertex>', `#include <fog_vertex>
vec4 edgeP = vec4(transformed, 1.);
#ifdef USE_BATCHING
edgeP = batchingMatrix * edgeP;
#endif
#ifdef USE_INSTANCING
edgeP = instanceMatrix * edgeP;
#endif
vEdgeWorld = (modelMatrix * edgeP).xyz;`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <fog_pars_fragment>', '#include <fog_pars_fragment>\nuniform float edgeFade;\nuniform float edgeTop;\nvarying vec3 vEdgeWorld;')
    .replace('#include <fog_fragment>', `#include <fog_fragment>
#ifdef USE_FOG
if (vEdgeWorld.y < edgeTop) gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, edgeFade * smoothstep(${EDGE_FADE_FROM.toFixed(2)}, ${EDGE_FADE_TO.toFixed(2)}, max(abs(vEdgeWorld.x), abs(vEdgeWorld.z))));
#endif`);
}
function ownMesh(geometry: T.BufferGeometry, mat: T.Material, ownsMaterial = false) {
  const mesh = new T.Mesh(geometry, mat); mesh.userData.ownedGeometry = true; mesh.userData.ownedMaterial = ownsMaterial; return mesh;
}
export class TideWorld {
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(55, 1, .08, 340);
  readonly renderer: T.WebGLRenderer;
  readonly universe = new T.Group();
  readonly environment = new T.Group();
  readonly actors = new T.Group();
  readonly effects = new T.Group();
  readonly player = new T.Group();
  readonly shadow = new T.Mesh(circleGeometry, shadowMaterial);
  readonly biteRing = new T.Mesh(ringGeometry, ringMaterial);
  readonly targetRing = new T.Mesh(ringGeometry, ringMaterial);
  creature: CreatureModel | null = null;
  avatar = new T.Group();
  foods: FoodObject[] = [];
  eco: Ecosystem;
  stage = 0;
  scale = 1;
  yaw = .1;
  pitch = .22;
  transitioning = false;
  transitionProgress = 0;
  private fromScale = 1;
  private fromPhysical = new T.Vector3();
  private toPhysical = new T.Vector3();
  private toScale = 1;
  private previousCreature: CreatureModel | null = null;
  private reef = new T.Group();
  private islands = new T.Group();
  private sceneryMaterialMap = new Map<T.Material, T.Material>();
  private shake = 0;
  private swim = 0;
  private tint = new T.Color('#267a89');
  private particles: Particle[] = [];
  private sun: T.DirectionalLight;
  private focus = new T.Vector3();
  private cameraPosition = new T.Vector3();
  private width = 1;
  private height = 1;
  private caustics: T.ShaderMaterial;
  private waterMaterial: T.ShaderMaterial;
  private stars: T.Points;
  private bubbles: T.Points;
  private lods: { group: T.Group; size: number }[] = [];
  private sunSphere: T.Mesh;
  private isMenu = true;
  private spaceMix = 0;
  private surfaceMesh: T.Mesh;
  private scenery: T.Group;
  private sceneryMaterials: T.Material[] = [];
  private homePlanetMaterials: T.Material[] = [];
  private instances: { mesh: T.InstancedMesh; foods: FoodObject[]; local: T.Matrix4 }[] = [];
  private instanceMatrix = new T.Matrix4();
  private homePlanet: FoodObject | null = null;
  /** 0–1: how far the edge fog has closed in (diagnostics). */
  private edgeFog = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.outputColorSpace = T.SRGBColorSpace; this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.scene.add(new T.HemisphereLight('#c3f5f4', '#396c6c', 2));
    this.sun = new T.DirectionalLight('#fff0cb', 2.6); this.sun.position.set(-12, 28, 14); this.sun.castShadow = true; this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -23, right: 23, top: 23, bottom: -23, near: .1, far: 90 }); this.sun.shadow.normalBias = .035; this.sun.shadow.bias = -.001;
    this.scene.add(this.sun, this.sun.target);
    const rim = new T.DirectionalLight('#84e7ea', 1.1); rim.position.set(8, 5, -20); this.scene.add(rim);
    this.scene.add(this.universe, this.effects, this.player, this.shadow, this.biteRing, this.targetRing);
    this.universe.add(this.environment, this.actors);
    this.shadow.rotation.x = -Math.PI / 2; this.biteRing.rotation.x = -Math.PI / 2; this.targetRing.rotation.x = -Math.PI / 2;
    this.biteRing.visible = false; this.targetRing.visible = false;
    this.scene.fog = new T.FogExp2('#247e8b', .017);
    const rand = random(71829);
    this.scenery = new T.Group(); this.environment.add(this.scenery);
    // The seabed is a continuous height field, with finer tessellation nearby.
    for (let index = 0; index < 3; index++) {
      const ground = sceneryAsset(`seabed_${index}`);
      ground.traverse(obj => { if (obj instanceof T.Mesh) { obj.castShadow = false; obj.receiveShadow = true; } });
      this.scenery.add(ground);
    }
    this.scenery.add(this.reef, this.islands);
    this.caustics = new T.ShaderMaterial({ uniforms: { time: { value: 0 }, fade: { value: 1 } }, transparent: true, depthWrite: false,
      vertexShader: 'varying vec2 p; void main(){p=position.xz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'varying vec2 p;uniform float time;uniform float fade;void main(){vec2 q=p*.9;float a=sin(q.x+sin(q.y*1.4+time*.2)*1.8+time*.15);float b=sin(q.y+sin(q.x*1.2-time*.12)*1.7);float c=pow(1.-abs(a*b),22.);float edge=1.-smoothstep(45.,65.,length(p));gl_FragColor=vec4(.83,1.,.83,c*.15*edge*fade);}' });
    const causticSource = sceneryAsset('seabed_0'); causticSource.updateMatrixWorld(true);
    let causticGeometry: T.BufferGeometry | null = null;
    causticSource.traverse(obj => { if (obj instanceof T.Mesh && !causticGeometry) causticGeometry = obj.geometry.clone().applyMatrix4(obj.matrixWorld); });
    if (causticGeometry) { const glow = ownMesh(causticGeometry, this.caustics, true); glow.position.y = .035; this.scenery.add(glow); }
    this.waterMaterial = new T.ShaderMaterial({ uniforms: { time: { value: 0 }, above: { value: 0 }, fade: { value: 1 } }, transparent: true, depthWrite: false, side: T.DoubleSide,
      vertexShader: 'varying vec2 p;varying vec2 e;void main(){p=position.xy;e=(modelMatrix*vec4(position,1.)).xz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      // Past the hard bound the surface fades out like the scenery (edgeFade is 0 in space).
      fragmentShader: `varying vec2 p;varying vec2 e;uniform float time;uniform float above;uniform float fade;uniform float edgeFade;void main(){float w=sin(p.x*.023+sin(p.y*.035+time*.17)*2.+time*.24)*sin(p.y*.03-time*.15);float line=pow(1.-abs(w),20.);vec3 color=mix(vec3(.26,.76,.79),vec3(.14,.48,.62),above);float edge=1.-edgeFade*smoothstep(${EDGE_FADE_FROM.toFixed(2)},${EDGE_FADE_TO.toFixed(2)},max(abs(e.x),abs(e.y)));gl_FragColor=vec4(color+line*.17,(mix(.22,.63,above)+line*.08)*fade*edge);}` });
    this.waterMaterial.uniforms.edgeFade = edgeUniforms.edgeFade;
    this.surfaceMesh = ownMesh(new T.PlaneGeometry(16000, 16000), this.waterMaterial, true); this.surfaceMesh.rotation.x = -Math.PI / 2; this.surfaceMesh.position.y = WATER_LEVEL; this.environment.add(this.surfaceMesh);
    // Shafts and suspended particles make the depth of the water readable.
    const rayMat = new T.MeshBasicMaterial({ color: '#c1f9df', transparent: true, opacity: .035, depthWrite: false, side: T.DoubleSide });
    for (let i = 0; i < 10; i++) { const shaft = ownMesh(new T.ConeGeometry(7 + i % 3 * 3, WATER_LEVEL, 12, 1, true), rayMat); shaft.position.set((rand() - .5) * 180, WATER_LEVEL / 2, (rand() - .5) * 180); shaft.rotation.z = -.13; this.scenery.add(shaft); }
    const bp: number[] = []; for (let i = 0; i < 800; i++) bp.push((rand() - .5) * 460, rand() * WATER_LEVEL, (rand() - .5) * 460);
    const bg = new T.BufferGeometry(); bg.setAttribute('position', new T.Float32BufferAttribute(bp, 3));
    this.bubbles = new T.Points(bg, new T.PointsMaterial({ color: '#c4f3e5', size: .23, transparent: true, opacity: .45, sizeAttenuation: true, depthWrite: false })); this.scenery.add(this.bubbles);
    // Round points, and the same fade past the bound as the scenery.
    (this.bubbles.material as T.PointsMaterial).onBeforeCompile = shader => { edgeFadeShader(shader); shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'void main() { if (length(gl_PointCoord - vec2(0.5)) > 0.5) discard;'); };
    const sky = new T.Group();
    for (let i = 0; i < 35; i++) {
      const x = (rand() - .5) * 6000, z = (rand() - .5) * 6000, y = 300 + rand() * 180;
      const cloud = sceneryAsset('cloud'); cloud.position.set(x, y, z); cloud.scale.set(42, 38, 40); sky.add(cloud);
    }
    this.scenery.add(batch(sky));
    this.sunSphere = ownMesh(new T.SphereGeometry(70, 24, 16), new T.MeshBasicMaterial({ color: '#fff4cb', fog: false }), true); this.sunSphere.position.set(-300, 680, -1100); this.environment.add(this.sunSphere);
    const starsPos: number[] = [];
    for (let i = 0; i < 1700; i++) { const a = rand() * Math.PI * 2, b = Math.acos(2 * rand() - 1), r = 180; starsPos.push(Math.sin(b) * Math.cos(a) * r, Math.cos(b) * r, Math.sin(b) * Math.sin(a) * r); }
    const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.Float32BufferAttribute(starsPos, 3));
    this.stars = new T.Points(sg, new T.PointsMaterial({ color: '#e4deff', size: .28, transparent: true, opacity: 0, fog: false, depthWrite: false })); this.scene.add(this.stars);
    this.eco = new Ecosystem(71829);
    this.createUniverse();
    this.buildReef(rand);
    this.scenery.traverse(obj => this.fadeable(obj));
    this.build(0, { seed: 71829, eatenPlanets: [] }); this.resize();
  }
  /** Scenery materials fade out together as the creature reaches space. */
  private fadeable(obj: T.Object3D) {
    if (!(obj instanceof T.Mesh) || Array.isArray(obj.material) || obj.material instanceof T.ShaderMaterial) return;
    if (!this.sceneryMaterialMap.has(obj.material)) {
      const clone = obj.material.clone(); clone.userData.initialOpacity = clone.opacity;
      clone.userData.initialTransparent = clone.transparent; clone.userData.initialDepthWrite = clone.depthWrite;
      clone.forceSinglePass = true; clone.onBeforeCompile = edgeFadeShader; this.sceneryMaterialMap.set(obj.material, clone); this.sceneryMaterialMap.set(clone, clone);
      this.sceneryMaterials.push(clone);
    }
    obj.material = this.sceneryMaterialMap.get(obj.material)!;
  }
  /** Reef details follow the run's biomes: kelp forests, coral gardens, rocky flats and open sand. */
  private buildReef(rand: () => number) {
    for (const lod of this.lods) { lod.group.traverse(o => { if (o instanceof T.Mesh) o.geometry.dispose(); }); }
    this.reef.clear(); this.lods = [];
    // Reef details at several physical sizes are present together, before any evolution.
    [1, 5, 20].forEach((size, tier) => {
      const raw = new T.Group(), biomes = this.eco.biomes[tier]!, tierSize = SIZES[tier]!;
      for (let i = 0; i < 70; i++) {
        const a = rand() * Math.PI * 2, r = (7 + rand() * 47) * size, x = Math.cos(a) * r, z = Math.sin(a) * r, y = seabedHeight(x, z);
        const decor = biomeAt(biomes, x / tierSize, z / tierSize).decor;
        if (decor === 'sand' && rand() < .65) continue;
        const decoration = decor === 'coral' || (decor !== 'kelp' && i % 3 === 0) ? coral(i) : kelp(i); decoration.scale.setScalar(size * (.8 + rand())); decoration.position.set(x, y, z); raw.add(decoration);
        const rock = sceneryAsset(`reef_rock_${i % 2}`), heavy = decor === 'rock' ? 1.7 : 1; rock.position.set(x, y - .2 * size, z); rock.scale.set(size * (.8 + rand()) * heavy, size * (.7 + rand() * .4) * heavy, size * (1 + rand()) * heavy); rock.rotation.y = a; raw.add(rock);
        if (i % 7 === 0 || (decor === 'rock' && i % 3 === 0)) {
          const arch = sceneryAsset('reef_arch'); arch.position.set(x + size, y, z); arch.scale.setScalar(size * .7); arch.rotation.y = a; raw.add(arch);
        }
      }
      if (size === 1) for (let i = 0; i < 42; i++) {
        const x = (rand() - .5) * 85, z = (rand() - .5) * 85, y = seabedHeight(x, z);
        const decoration = sceneryAsset(i % 3 === 0 ? 'reef_starfish' : 'reef_shell'); decoration.position.set(x, y + .03, z); decoration.rotation.y = rand() * Math.PI * 2; raw.add(decoration);
      }
      // Small spatial batches let the camera discard reef sections behind it.
      // One enormous batch would draw the whole ocean for a phone-sized view.
      const chunks = new Map<string, T.Group>();
      for (const object of [...raw.children]) {
        const key = `${Math.floor(object.position.x / (24 * size))}:${Math.floor(object.position.z / (24 * size))}`;
        const chunk = chunks.get(key) || new T.Group(); chunk.add(object); chunks.set(key, chunk);
      }
      const g = new T.Group(); for (const chunk of chunks.values()) g.add(batch(chunk));
      g.traverse(obj => this.fadeable(obj));
      this.reef.add(g); this.lods.push({ group: g, size });
    });
  }
  private disposeUniverse() {
    for (const set of this.instances) { this.actors.remove(set.mesh); set.mesh.dispose(); }
    this.instances = [];
    for (const f of this.foods) if (f.model.parent) f.model.removeFromParent();
    this.foods = [];
    this.islands.traverse(o => { if (o instanceof T.Mesh) o.geometry.dispose(); }); this.islands.clear();
  }
  private createUniverse() {
    const prefabs = new Map<string, T.Group>(), islands = new T.Group();
    for (const entity of this.eco.entities) {
      const spec = entity.spec, size = SIZES[spec.tier]!, kind = spec.kind, home = kind === 'planet' && this.eco.planetIndex(entity) === 0;
      if (kind !== 'planet' && !prefabs.has(kind)) prefabs.set(kind, foodModel(kind));
      const model = kind === 'planet' ? foodModel(kind, this.eco.planetIndex(entity)) : prefabs.get(kind)!.clone(true);
      model.scale.multiplyScalar(size * (home ? 1.35 : 1)); model.position.set(entity.x, entity.y, entity.z); model.rotation.y = entity.phase;
      if (home) {
        const materials = new Map<T.Material, T.Material>();
        model.traverse(object => {
          if (!(object instanceof T.Mesh) || Array.isArray(object.material)) return;
          if (!materials.has(object.material)) { const clone = object.material.clone(); clone.forceSinglePass = true; materials.set(object.material, clone); }
          object.material = materials.get(object.material)!;
        });
        this.homePlanetMaterials = [...materials.values()];
      }
      if (kind === 'planet') this.actors.add(model);
      const food: FoodObject = { entity, model, tier: spec.tier, data: { id: entity.id, kind, tier: spec.tier, x: 0, y: 0, z: 0, eaten: false, phase: entity.phase } };
      this.foods.push(food); if (home) this.homePlanet = food;
      if (kind === 'tree' || kind === 'lighthouse') {
        const island = sceneryAsset('island'); island.position.set(entity.hx, WATER_LEVEL - 1, entity.hz); island.scale.setScalar(64); islands.add(island);
      }
    }
    const merged = batch(islands); merged.traverse(obj => this.fadeable(obj)); this.islands.add(merged);
    for (const [kind, prefab] of prefabs) {
      const foods = this.foods.filter(f => f.data.kind === kind);
      prefab.updateMatrixWorld(true);
      prefab.traverse(child => {
        if (!(child instanceof T.Mesh) || Array.isArray(child.material)) return;
        const mesh = new T.InstancedMesh(child.geometry, child.material, foods.length);
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
        this.actors.add(mesh); this.instances.push({ mesh, foods, local: child.matrixWorld.clone() });
      });
    }
  }
  resize() { this.width = innerWidth; this.height = innerHeight; this.renderer.setSize(this.width, this.height); this.camera.aspect = this.width / this.height; this.camera.updateProjectionMatrix(); }
  get surface() { return WATER_LEVEL / this.scale; }
  groundAt(x: number, z: number) { return seabedHeight(x * this.scale, z * this.scale) / this.scale; }
  /** Live food and creatures of the player's own tier. */
  get edibleFoods() { return this.foods.filter(f => f.tier === this.stage && !f.entity.eaten); }
  /** Creatures that are hunting or attacking the player. */
  get threats() { return this.foods.filter(f => !f.entity.eaten && (f.entity.mode === 'hunt' || f.entity.mode === 'angry') && Math.abs(f.tier - this.stage) <= 1); }
  get biome(): Biome { const tier = this.stage, size = SIZES[tier]!, p = this.player.position; return biomeAt(this.eco.biomes[tier]!, p.x * this.scale / size, p.z * this.scale / size); }
  /** Player position in physical units. */
  physical(target = new T.Vector3()) { return target.copy(this.player.position).multiplyScalar(this.scale); }
  /** Rebuilds the world for a run. A new seed makes a new layout; evolution never rebuilds it. */
  build(stage: number, run: { seed: number; eatenPlanets: readonly number[]; genome?: Genome }) {
    if (run.seed !== this.eco.seed) {
      this.disposeUniverse(); this.eco = new Ecosystem(run.seed); this.createUniverse(); this.buildReef(random(run.seed ^ 0x2f6b));
    }
    this.eco.reset(run.eatenPlanets);
    this.stage = stage; this.scale = SIZES[stage]!; this.toScale = this.scale; this.fromScale = this.scale; this.transitioning = false; this.transitionProgress = 0;
    if (run.genome) this.setCreature(run.genome);
    this.spaceMix = stage === 4 ? 1 : 0;
    this.placePlayerAt(new T.Vector3());
    this.yaw = .1; this.pitch = .22; this.targetRing.visible = false;
    this.particles.forEach(p => this.effects.remove(p.mesh)); this.particles = [];
    // Gameplay can chomp before the next render update. Reset collision
    // coordinates together with scale so replay never uses the space scale.
    this.syncFoods();
  }
  /** Puts the player root at a local point (the simulation chose it) and snaps the camera there. */
  placePlayerAt(local: T.Vector3) {
    this.player.position.copy(local); this.player.rotation.set(0, 0, 0); this.player.scale.setScalar(1);
    this.universe.scale.setScalar(1 / this.scale); this.focus.copy(this.player.position).add(new T.Vector3(0, .7, 0)); this.cameraPosition.copy(this.focus).add(new T.Vector3(0, 6, 12));
    this.avatar.rotation.set(0, 0, 0);
  }
  /** Replaces the creature model right away (new run or editor change). */
  setCreature(genome: Genome) {
    this.creature?.dispose(); this.previousCreature?.dispose(); this.previousCreature = null;
    this.creature = new CreatureModel(genome); this.avatar.add(this.creature.group);
    if (!this.avatar.parent) this.player.add(this.avatar);
  }
  /** Presentation only: eases the world scale and moves the body from where it is to `targetPhysical` (already admitted by the simulation). */
  transform(stage: number, genome: Genome, targetPhysical: Vec3) {
    this.physical(this.fromPhysical); this.toPhysical.set(targetPhysical.x, targetPhysical.y, targetPhysical.z);
    this.stage = stage; this.fromScale = this.scale; this.toScale = SIZES[stage]!; this.transitionProgress = 0; this.transitioning = true;
    this.previousCreature?.dispose();
    this.previousCreature = this.creature; this.creature = new CreatureModel(genome); this.creature.group.scale.setScalar(.001); this.avatar.add(this.creature.group);
    this.burst(this.player.position.x, this.player.position.y, this.player.position.z, '#f4e2b9', 50);
  }
  /** A hit: red sparks and a short camera shake. */
  hurt() { const p = this.player.position; this.burst(p.x, p.y + .3, p.z, '#ff8f7a', 14); this.shake = 1; }
  private syncFoods() {
    for (const f of this.foods) {
      const e = f.entity; f.data.eaten = e.eaten; f.data.x = e.x / this.scale; f.data.y = e.y / this.scale; f.data.z = e.z / this.scale;
    }
  }
  look(dx: number, dy: number) { this.yaw -= dx * .006; this.pitch = T.MathUtils.clamp(this.pitch + dy * .005, -.8, 1.05); }
  moveVector(x: number, z: number, swim: boolean) {
    const pitch = swim ? Math.sign(this.pitch) * Math.max(0, Math.abs(this.pitch) - .23) : 0;
    return new T.Vector3(x * Math.cos(this.yaw) + z * Math.sin(this.yaw) * Math.cos(pitch), z * Math.sin(pitch), -x * Math.sin(this.yaw) + z * Math.cos(this.yaw) * Math.cos(pitch));
  }
  burst(x: number, y: number, z: number, color: string, count = 12) {
    for (let i = 0; i < count; i++) { const mesh = new T.Mesh(particleGeometry, material(color, .4)); mesh.position.set(x, y, z); mesh.scale.setScalar(.7 + Math.random() * 1.6); this.effects.add(mesh); this.particles.push({ mesh, life: .6 + Math.random() * .55, velocity: new T.Vector3((Math.random() - .5) * 5, 1 + Math.random() * 3, (Math.random() - .5) * 5) }); }
  }
  removeFood(food: FoodObject) { food.model.visible = false; this.burst(food.data.x, food.data.y, food.data.z, this.stage === 4 ? '#e3c5ff' : '#e8efaf'); }
  screenPoint(position: T.Vector3) {
    const v = position.clone().project(this.camera); const forward = position.clone().sub(this.camera.position).dot(this.camera.getWorldDirection(new T.Vector3()));
    return { x: (v.x + 1) * this.width / 2, y: (1 - v.y) * this.height / 2, visible: v.z < 1 && forward > 0 };
  }
  groundPoint(x: number, y: number): T.Vector3 | null { const ray = new T.Raycaster(); ray.setFromCamera(new T.Vector2(x / this.width * 2 - 1, -y / this.height * 2 + 1), this.camera); return ray.ray.intersectPlane(new T.Plane(UP, -this.player.position.y), new T.Vector3()); }
  update(dt: number, time: number, menu: boolean, moving: boolean, chomping: number, growth: number) {
    this.isMenu = menu; const p = this.player.position;
    if (this.transitioning && dt > 0) {
      this.transitionProgress = Math.min(1, this.transitionProgress + dt / 3.4);
      const t = this.transitionProgress, ease = t * t * (3 - 2 * t), previous = this.scale;
      this.scale = t >= 1 ? this.toScale : this.fromScale * (this.toScale / this.fromScale) ** ease;
      p.lerpVectors(this.fromPhysical, this.toPhysical, ease).divideScalar(this.scale); this.focus.multiplyScalar(previous / this.scale); this.cameraPosition.multiplyScalar(previous / this.scale);
      this.universe.scale.setScalar(1 / this.scale);
      this.creature?.group.scale.setScalar(Math.max(.001, T.MathUtils.smoothstep(t, .15, .8)));
      this.previousCreature?.group.scale.setScalar(Math.max(.001, 1 - T.MathUtils.smoothstep(t, .2, .65)));
      if (Math.random() < .45) this.burst(p.x, p.y + .2, p.z, '#fff1bf', 2);
      if (t >= 1) { this.transitioning = false; this.previousCreature?.dispose(); this.previousCreature = null; this.creature?.group.scale.setScalar(1); }
    }
    if (menu) {
      const mobile = this.width / this.height < .8;
      p.set(mobile ? 0 : 6.4, mobile ? 1.75 : 1.9, mobile ? 1 : 1.5); this.player.rotation.y = -.34 + Math.sin(time * .25) * .08; this.player.scale.setScalar(mobile ? 2.15 : 2.55);
      const focus = new T.Vector3(mobile ? 0 : .4, mobile ? 0 : .4, mobile ? 0 : -.7); this.focus.copy(focus);
      this.camera.fov = 39; this.camera.position.copy(focus).add(new T.Vector3(0, mobile ? 27 : 23, mobile ? 32 : 28)); this.camera.lookAt(focus); this.camera.updateProjectionMatrix();
    } else {
      // The simulation owns the root: exact growth, no easing (the hull is admitted at this scale).
      this.player.scale.setScalar(growth);
      const distance = this.width / this.height < .8 ? 10.5 : 9;
      const targetFocus = p.clone().add(new T.Vector3(0, .8 * growth, 0));
      this.focus.lerp(targetFocus, 1 - Math.exp(-dt * 6));
      const targetCam = this.focus.clone().add(new T.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch) * distance, Math.sin(this.pitch) * distance, Math.cos(this.yaw) * Math.cos(this.pitch) * distance));
      if (this.stage < 4) targetCam.y = Math.max(targetCam.y, this.groundAt(targetCam.x, targetCam.z) + .6);
      this.cameraPosition.lerp(targetCam, 1 - Math.exp(-dt * 8)); this.camera.position.copy(this.cameraPosition);
      if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 3); this.camera.position.add(new T.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(this.shake * .35)); } this.camera.fov = T.MathUtils.damp(this.camera.fov, this.width / this.height < .8 ? 64 : 59, 3, dt); this.camera.updateProjectionMatrix(); this.camera.lookAt(this.focus);
    }
    this.swim = T.MathUtils.damp(this.swim, moving ? 1 : 0, 6, dt);
    this.creature?.animate(time, this.swim, chomping); this.previousCreature?.animate(time, this.swim, chomping);
    this.sun.position.copy(p).add(new T.Vector3(-14, 27, 13)); this.sun.target.position.copy(p);
    const groundY = this.groundAt(p.x, p.z); this.shadow.visible = this.stage < 4 && p.y - groundY < 9;
    this.shadow.position.set(p.x, groundY + .06, p.z); this.shadow.scale.setScalar(menu ? 3.2 : 1.2 * growth + (p.y - groundY) * .04);
    this.biteRing.position.copy(p); this.biteRing.position.y -= .45; this.biteRing.scale.setScalar((this.stage === 0 ? 1.7 : 2.3) * growth * (1 + chomping * .2)); this.biteRing.visible = !menu && chomping > .1;
    this.caustics.uniforms.time!.value = time;
    const spaceTarget = T.MathUtils.smoothstep(this.scale, 90, 240);
    this.spaceMix = T.MathUtils.damp(this.spaceMix, spaceTarget, 2, dt);
    const above = T.MathUtils.smoothstep(p.y, this.surface - .4, this.surface + .6);
    // Each biome tints the water a little, so the habitat changes as you explore.
    if (this.stage <= 2 && !menu) this.tint.lerp(new T.Color(this.biome.tint), 1 - Math.exp(-dt * 1.5)); else this.tint.lerp(new T.Color('#267a89'), 1 - Math.exp(-dt * 1.5));
    const color = this.tint.clone().lerp(new T.Color('#88bbcb'), above).lerp(new T.Color('#141a36'), this.spaceMix);
    // The soft edge: 0 at the push zone's start, full at half way to the hard bound (where creatures settle); off in space.
    // Damped, so a teleport (respawn, recovery, evolution rescale) does not change the fog in one frame.
    const soft = EDGE_SOFT_START * PLAYER_HALF, edgeU = menu ? 0 : T.MathUtils.clamp((Math.max(Math.abs(p.x), Math.abs(p.z)) - soft) / (PLAYER_HALF - soft), 0, 1);
    this.edgeFog = T.MathUtils.damp(this.edgeFog, T.MathUtils.smoothstep(edgeU, 0, .5) * (1 - this.spaceMix), 4, dt);
    color.lerp(EDGE_DARK, EDGE_DARKEN * this.edgeFog);
    this.scene.background = color; const fog = this.scene.fog as T.FogExp2; fog.color.copy(color);
    fog.density = T.MathUtils.lerp(T.MathUtils.lerp(above > .5 ? .005 : .014, .002, this.spaceMix), EDGE_FOG_DENSITY, this.edgeFog);
    edgeUniforms.edgeFade.value = 1 - this.spaceMix; edgeUniforms.edgeTop.value = 200 / this.scale;
    this.caustics.uniforms.fade!.value = 1 - this.spaceMix;
    // The coarse home globe replaces the detailed habitat as we reach space.
    // Its continents must not poke through the shrimp's centimeter-scale sand.
    for (const mat of this.homePlanetMaterials) { mat.opacity = this.spaceMix; mat.transparent = this.spaceMix < .999; mat.depthWrite = this.spaceMix > .98; }
    for (const mat of this.sceneryMaterials) {
      mat.opacity = Number(mat.userData.initialOpacity) * (1 - this.spaceMix);
      mat.transparent = Boolean(mat.userData.initialTransparent) || this.spaceMix > .001;
      // Light shafts must never write depth: an almost transparent cone would
      // otherwise hide the reef behind it and leave large triangular gaps.
      mat.depthWrite = Boolean(mat.userData.initialDepthWrite) && this.spaceMix < .02;
    }
    const bubbleMat = this.bubbles.material as T.PointsMaterial; bubbleMat.size = .23 / this.scale; bubbleMat.opacity = .4 * (1 - this.spaceMix);
    this.waterMaterial.uniforms.time!.value = time; this.waterMaterial.uniforms.above!.value = above; this.waterMaterial.uniforms.fade!.value = 1 - this.spaceMix;
    this.surfaceMesh.visible = this.spaceMix < .995; this.scenery.visible = this.spaceMix < .995; this.sunSphere.visible = this.spaceMix < .9;
    (this.stars.material as T.PointsMaterial).opacity = this.spaceMix; this.stars.position.copy(p);
    this.bubbles.rotation.y = Math.sin(time * .015) * .04;
    for (const lod of this.lods) {
      lod.group.visible = this.scale / lod.size < 18;
      const shadow = this.scale / lod.size > .45;
      lod.group.traverse(object => { if (object instanceof T.Mesh) object.castShadow = shadow; });
    }
    // The menu keeps the ecosystem moving in the background with its ambient motion.
    if (menu && dt > 0) this.eco.step({ stage: this.stage, dt, now: time, player: { x: 1e7, y: 0, z: 1e7 }, playerHull: [], perceivable: false, stealthFactor: 1 });
    this.syncFoods();
    for (const f of this.foods) {
      const e = f.entity;
      if (e.eaten) { f.model.visible = false; continue; }
      const size = SIZES[f.tier]!, kind = f.data.kind;
      f.model.position.set(e.x, e.y, e.z);
      if (kind !== 'planet' && e.spec.behavior !== 'still') f.model.rotation.y = T.MathUtils.lerp(f.model.rotation.y, f.model.rotation.y + Math.atan2(Math.sin(e.heading - f.model.rotation.y), Math.cos(e.heading - f.model.rotation.y)), 1 - Math.exp(-dt * 6));
      // Angry creatures puff up a little so the player can see the danger.
      const angry = e.mode === 'hunt' || e.mode === 'angry';
      f.model.scale.setScalar(size * (f === this.homePlanet ? 1.35 : 1) * (angry ? 1.12 + Math.sin(time * 9) * .04 : 1));
      const distance = p.distanceTo(new T.Vector3(f.data.x, f.data.y, f.data.z));
      f.model.visible = size / this.scale > .07 && distance < 230 + size / this.scale * 2 && !(f.tier < 4 && this.spaceMix > .99);
      if (f === this.homePlanet) f.model.visible = f.model.visible && this.spaceMix > .001;
      if (f.tier === 0) f.model.rotation.z = Math.sin(time * 1.7 + f.data.phase) * .1;
      else if (kind === 'planet') f.model.rotation.y += dt * .07;
      else if (kind === 'boat') f.model.rotation.z = Math.sin(time * 1.1 + f.data.phase) * .04;
    }
    for (const set of this.instances) {
      // Future giants remain visible without casting an ocean-sized shadow
      // across the tiny player's entire habitat.
      set.mesh.castShadow = set.foods[0]!.tier <= this.stage;
      let count = 0;
      for (const food of set.foods) {
        const model = food.model;
        if (!model.visible) continue;
        model.updateMatrix(); this.instanceMatrix.multiplyMatrices(model.matrix, set.local);
        set.mesh.setMatrixAt(count++, this.instanceMatrix);
      }
      set.mesh.count = count; set.mesh.visible = count > 0; set.mesh.instanceMatrix.needsUpdate = true;
    }
    for (let i = this.particles.length - 1; i >= 0; i--) { const particle = this.particles[i]!; particle.life -= dt; particle.mesh.position.addScaledVector(particle.velocity, dt); particle.velocity.y -= dt * 2; particle.mesh.scale.multiplyScalar(Math.exp(-dt * 1.8)); if (particle.life <= 0) { this.effects.remove(particle.mesh); this.particles.splice(i, 1); } }
    this.renderer.render(this.scene, this.camera);
  }
  get diagnostics() { return { worldId: this.universe.uuid, seed: this.eco.seed, biome: this.biome.name, consumedByTier: SIZES.map((_, i) => this.foods.filter(f => f.tier === i && f.data.eaten).length), scale: this.scale, surface: this.surface, yaw: this.yaw, pitch: this.pitch, menu: this.isMenu, transitioning: this.transitioning, edgeFog: this.edgeFog, physicalPosition: { x: this.player.position.x * this.scale, y: this.player.position.y * this.scale, z: this.player.position.z * this.scale } }; }
}
