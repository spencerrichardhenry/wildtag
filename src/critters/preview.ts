import * as THREE from 'three';
import { mulberry32 } from '../core/rng.ts';
import { SPECIES } from './species.ts';
import { buildCritterModel, type CritterParts } from './models.ts';
import { animateCritter } from './animation.ts';

// Dev aid: `?preview=critters`. Lines up all 8 species on a flat stage before a
// fixed camera, each on a slow turntable and animated at its walk speed, with a
// floating DOM name label projected above it. Skips the normal player spawn.
// Kept intentionally — the turntable + labels make model/animation regressions
// obvious at a glance, and it's what the Task 8 verification screenshot uses.

interface Stand {
  group: THREE.Group;
  parts: CritterParts;
  walkSpeed: number;
  label: HTMLDivElement;
  worldX: number;
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
  const spacing = 2.9;
  const startX = -((SPECIES.length - 1) * spacing) / 2;
  const stands: Stand[] = [];

  SPECIES.forEach((sp, i) => {
    const { group, parts } = buildCritterModel(sp.id, rng);
    const worldX = startX + i * spacing;
    group.position.set(worldX, 0, 0);
    scene.add(group);

    const label = document.createElement('div');
    label.textContent = sp.name;
    label.style.cssText =
      'position:absolute;transform:translate(-50%,-100%);font:600 14px system-ui,sans-serif;' +
      'color:#eaf2ff;background:rgba(20,28,48,0.72);padding:2px 8px;border-radius:6px;' +
      'white-space:nowrap;text-shadow:0 1px 2px #000;';
    overlay.appendChild(label);

    stands.push({ group, parts, walkSpeed: sp.walkSpeed, label, worldX });
  });

  // Frame the whole lineup. Tallest critters (~2.4 with antlers) are the
  // bellowbuck and lumenstag at the ends — sit low and pull back enough that
  // the full row (incl. the wide-antlered stag) fits with margin.
  camera.position.set(0, 1.7, 16);
  camera.lookAt(0, 0.9, 0);

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
      s.group.rotation.y = t * 0.5; // slow turntable
      animateCritter(s.parts, s.walkSpeed, t);

      // Project a point above the critter to place its label.
      project.set(s.worldX, 2.6, 0).project(camera);
      const x = (project.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-project.y * 0.5 + 0.5) * window.innerHeight;
      s.label.style.left = `${x}px`;
      s.label.style.top = `${y}px`;
    }

    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
