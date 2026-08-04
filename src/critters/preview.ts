import * as THREE from 'three';
import { mulberry32 } from '../core/rng.ts';
import { SPECIES } from './species.ts';
import { buildCritterModel, type CritterParts } from './models.ts';
import { animateCritter } from './animation.ts';

// Dev aid: `?preview=critters`. Lays out all 15 species on a flat stage before
// a fixed camera in a 2×8 grid, each on a slow turntable and animated at its
// walk speed, with a floating DOM name label projected above it. Skips the
// normal player spawn. Kept intentionally — the turntable + labels make
// model/animation regressions obvious at a glance, and it's what the
// verification screenshot uses.

interface Stand {
  group: THREE.Group;
  parts: CritterParts;
  walkSpeed: number;
  speciesId: string;
  label: HTMLDivElement;
  worldX: number;
  worldZ: number;
}

/**
 * Take over the given renderer with a self-contained critter showcase scene and
 * its own animation loop. Never returns.
 */
export function runCritterPreview(renderer: THREE.WebGLRenderer): void {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a3550);

  // Soft studio lighting: a hemisphere fill plus a key light so flat-shaded
  // facets and the emissive glows (lumenstag antlers, emberpup tips) read.
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x30303a, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(4, 8, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88aaff, 0.5);
  rim.position.set(-6, 4, -4);
  scene.add(rim);

  // Flat stage.
  const stage = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 20),
    new THREE.MeshLambertMaterial({ color: 0x3d4a63 }),
  );
  stage.rotation.x = -Math.PI / 2;
  scene.add(stage);

  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    200,
  );

  // Overlay for DOM labels.
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:10;';
  document.body.appendChild(overlay);

  const rng = mulberry32(20240808);
  // Dev close-up: `?preview=critters&focus=<id>` builds just one species big and
  // centred so charm reads at arm's length (verification aid). `focusList` lets
  // a few be lined up (comma-separated ids). Empty = the full 2×8 roster grid.
  const focusParam = new URLSearchParams(window.location.search).get('focus');
  const focusIds = focusParam
    ? focusParam.split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  const roster = focusIds
    ? focusIds.map((id) => SPECIES.find((s) => s.id === id)).filter((s): s is (typeof SPECIES)[number] => !!s)
    : SPECIES;

  // 2 rows × 8 columns for the 15-species roster (15 → 8 front + 7 back). The
  // back row is staggered half a column into the front row's gaps and pushed
  // well back so tall front-row critters never occlude it; the camera looks
  // down from a height.
  const cols = focusIds ? Math.min(roster.length, 3) : 8;
  // Tightened from 3.6 (the 7-col era) so the extra 8th column still fits the
  // camera frustum without clipping the outermost critters (puffle/lumenstag).
  const colSpacing = focusIds ? 2.6 : 3.0;
  const rowZ = focusIds ? [0, -3] : [3.5, -5.5]; // [front, back]
  const rowXOffset = [0, colSpacing / 2]; // stagger the back row into the gaps
  const startX = -((cols - 1) * colSpacing) / 2;
  const stands: Stand[] = [];

  roster.forEach((sp, i) => {
    const { group, parts } = buildCritterModel(sp.id, rng);
    const rowi = Math.floor(i / cols);
    const coli = i % cols;
    const worldX = startX + coli * colSpacing + (rowXOffset[rowi] ?? 0);
    const worldZ = rowZ[rowi] ?? 0;
    group.position.set(worldX, 0, worldZ);
    scene.add(group);

    const label = document.createElement('div');
    label.textContent = sp.name;
    label.style.cssText =
      'position:absolute;transform:translate(-50%,-100%);font:600 14px system-ui,sans-serif;' +
      'color:#eaf2ff;background:rgba(20,28,48,0.72);padding:2px 8px;border-radius:6px;' +
      'white-space:nowrap;text-shadow:0 1px 2px #000;';
    overlay.appendChild(label);

    stands.push({ group, parts, walkSpeed: sp.walkSpeed, speciesId: sp.id, label, worldX, worldZ });
  });

  // Frame the whole 2×8 grid from a raised vantage so both rows read without
  // the back row hiding behind the tall front-row critters. Focus mode pulls
  // the camera in close and low so the eyes/features read at arm's length.
  if (focusIds) {
    camera.position.set(0, 1.6, 5.2);
    camera.lookAt(0, 1.0, -0.8);
  } else {
    camera.position.set(0, 9, 18);
    camera.lookAt(0, 0.6, -1.5);
  }

  function resize(): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', resize);
  resize();

  const project = new THREE.Vector3();
  const start = performance.now();

  function frame(now: number): void {
    requestAnimationFrame(frame);
    const t = (now - start) / 1000;

    for (const s of stands) {
      // Full grid: slow full turntable. Focus close-up: hold a flattering
      // front-3/4 view (gentle wobble) so the faces/eyes read for judging.
      s.group.rotation.y = focusIds ? -0.5 + Math.sin(t * 0.25) * 0.35 : t * 0.5;
      animateCritter(s.parts, s.walkSpeed, t, 1 / 60, s.speciesId);

      // Project a point above the critter to place its label.
      project.set(s.worldX, 3.0, s.worldZ).project(camera);
      const x = (project.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-project.y * 0.5 + 0.5) * window.innerHeight;
      s.label.style.left = `${x}px`;
      s.label.style.top = `${y}px`;
    }

    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
