import * as THREE from 'three';
import { mulberry32 } from '../core/rng.ts';
import { SPECIES } from './species.ts';
import { buildCritterModel, type CritterParts } from './models.ts';
import { animateCritter } from './animation.ts';

// Dev aid: `?preview=critters`. The complete roster is presented as a large,
// scrollable 3–4 column studio gallery. The canvas stays viewport-sized while
// scrolling moves the camera through the rows, avoiding a giant WebGL backing
// buffer. Middle-button dragging takes over the shared turntable angle and
// leaves every critter at the chosen view. `&focus=id[,id]` keeps the compact
// close-up mode used by model verification.

const MAX_GALLERY_COLS = 4;
const GALLERY_COL_SPACING = 3.3;
const GALLERY_ROW_SPACING = 5;
const CAMERA_Y = 4.5;
const CAMERA_Z_OFFSET = 8.5;
const CAMERA_TARGET_Y = 0.9;
const DRAG_RADIANS_PER_PX = 0.012;

interface Stand {
  group: THREE.Group;
  parts: CritterParts;
  walkSpeed: number;
  speciesId: string;
  label: HTMLDivElement;
  labelY: number;
  worldX: number;
  worldZ: number;
}

/**
 * Take over the given renderer with a self-contained critter showcase scene and
 * its own animation loop. Never returns.
 */
export function runCritterPreview(renderer: THREE.WebGLRenderer): void {
  const focusParam = new URLSearchParams(window.location.search).get('focus');
  const focusIds = focusParam
    ? focusParam.split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  const focusedRoster = focusIds
    ? focusIds.map((id) => SPECIES.find((s) => s.id === id)).filter((s): s is (typeof SPECIES)[number] => !!s)
    : null;
  const roster = focusedRoster?.length ? focusedRoster : SPECIES;
  const closeup = focusedRoster !== null && focusedRoster.length > 0 && focusedRoster.length <= 3;

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

  // The unit plane is scaled/recentred whenever the responsive column count
  // changes. It spans every row even though the fixed camera only sees a
  // viewport-sized slice at once.
  const stage = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshLambertMaterial({ color: 0x3d4a63 }),
  );
  stage.rotation.x = -Math.PI / 2;
  scene.add(stage);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  const canvas = renderer.domElement;

  // Override the game's fixed, overflow-hidden shell only for this preview.
  // The canvas remains fixed while an invisible spacer supplies real browser
  // scrolling; wheel/trackpad scrolling therefore works normally.
  document.documentElement.style.height = closeup ? '100%' : 'auto';
  document.documentElement.style.overflowX = 'hidden';
  document.documentElement.style.overflowY = closeup ? 'hidden' : 'auto';
  document.body.style.height = closeup ? '100%' : 'auto';
  document.body.style.minHeight = closeup ? '100%' : '0';
  document.body.style.overflowX = 'hidden';
  document.body.style.overflowY = closeup ? 'hidden' : 'auto';
  document.body.style.userSelect = 'none';
  canvas.style.cssText =
    'display:block;position:fixed;inset:0;width:100vw;height:100vh;' +
    'touch-action:pan-y;cursor:grab;';

  const scrollSpacer = document.createElement('div');
  scrollSpacer.setAttribute('aria-hidden', 'true');
  scrollSpacer.style.cssText = 'width:1px;pointer-events:none;';
  if (!closeup) document.body.appendChild(scrollSpacer);

  // Labels remain viewport-fixed and are hidden when their world anchor is
  // outside the camera frustum. Four columns leave ample room for every name.
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:10;';
  document.body.appendChild(overlay);

  const help = document.createElement('div');
  const defaultHelp = closeup
    ? 'Middle-drag to rotate'
    : 'Scroll to browse  •  Middle-drag to rotate';
  help.textContent = defaultHelp;
  help.style.cssText =
    'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:11;' +
    'pointer-events:none;white-space:nowrap;padding:8px 14px;border-radius:999px;' +
    'font:700 14px system-ui,sans-serif;letter-spacing:.01em;color:#dffcf3;' +
    'background:rgba(20,28,48,.82);border:1px solid rgba(134,242,209,.3);' +
    'box-shadow:0 6px 22px rgba(0,0,0,.22);';
  document.body.appendChild(help);

  const rng = mulberry32(20240808);
  const stands: Stand[] = roster.map((sp) => {
    const { group, parts } = buildCritterModel(sp.id, rng);
    scene.add(group);

    const label = document.createElement('div');
    label.textContent = sp.name;
    label.dataset.speciesId = sp.id;
    label.style.cssText =
      'position:absolute;transform:translate(-50%,-100%);font:700 16px system-ui,sans-serif;' +
      'color:#eaf2ff;background:rgba(20,28,48,.82);padding:4px 10px;border-radius:7px;' +
      'white-space:nowrap;text-shadow:0 1px 2px #000;will-change:left,top;';
    overlay.appendChild(label);

    return {
      group,
      parts,
      walkSpeed: sp.walkSpeed,
      speciesId: sp.id,
      label,
      // Tall species already publish a ringHeight; size is a useful fallback
      // for keeping every other label just above its silhouette.
      labelY: Math.max(1.7, (sp.ringHeight ?? sp.size * 1.5) + 0.5),
      worldX: 0,
      worldZ: 0,
    };
  });

  let columns = 1;
  let rows = 1;
  let rowSpacing = GALLERY_ROW_SPACING;
  let maxGalleryScroll = 0;
  let galleryTargetZ = 0;

  function responsiveColumns(): number {
    if (closeup) return Math.max(1, roster.length);
    return Math.max(2, Math.min(MAX_GALLERY_COLS, Math.floor(window.innerWidth / 360)));
  }

  function updateGalleryCamera(): void {
    if (closeup) return;
    const progress = maxGalleryScroll > 0
      ? THREE.MathUtils.clamp(window.scrollY / maxGalleryScroll, 0, 1)
      : 0;
    galleryTargetZ = -(rows - 1) * rowSpacing * progress;
    camera.position.set(0, CAMERA_Y, galleryTargetZ + CAMERA_Z_OFFSET);
    camera.lookAt(0, CAMERA_TARGET_Y, galleryTargetZ - 0.35);
    canvas.dataset.previewScrollProgress = progress.toFixed(4);
  }

  function layout(): void {
    columns = responsiveColumns();
    rows = Math.max(1, Math.ceil(roster.length / columns));
    const colSpacing = closeup ? 2.7 : GALLERY_COL_SPACING;
    rowSpacing = closeup ? 3.2 : GALLERY_ROW_SPACING;

    stands.forEach((stand, i) => {
      const row = Math.floor(i / columns);
      const col = i % columns;
      const inThisRow = Math.min(columns, roster.length - row * columns);
      const rowStartX = -((inThisRow - 1) * colSpacing) / 2;
      stand.worldX = rowStartX + col * colSpacing;
      stand.worldZ = -row * rowSpacing;
      stand.group.position.set(stand.worldX, 0, stand.worldZ);
    });

    const stageWidth = Math.max(18, (columns - 1) * colSpacing + 10);
    const stageDepth = Math.max(16, (rows - 1) * rowSpacing + 14);
    stage.scale.set(stageWidth, stageDepth, 1);
    stage.position.z = -((rows - 1) * rowSpacing) / 2;

    if (closeup) {
      camera.position.set(0, 1.7, 5.3);
      camera.lookAt(0, 1.0, -0.55);
    } else {
      const scrollPerRow = Math.max(420, window.innerHeight * 0.62);
      maxGalleryScroll = (rows - 1) * scrollPerRow;
      scrollSpacer.style.height = `${window.innerHeight + maxGalleryScroll}px`;
      updateGalleryCamera();
    }

    canvas.dataset.previewColumns = String(columns);
    canvas.dataset.previewRows = String(rows);
  }

  function resize(): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    // Keep the backing buffer viewport-sized. A document-height canvas would
    // become enormous on Retina displays and is unnecessary for this gallery.
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    layout();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('scroll', updateGalleryCamera, { passive: true });
  resize();

  // Auto-turn until the first middle-button drag. From then on the gallery
  // holds the user's shared angle exactly; horizontal dragging adjusts yaw.
  let manualYaw: number | null = null;
  let currentYaw = closeup ? -0.5 : 0;
  let dragPointer: number | null = null;
  let lastDragX = 0;

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    manualYaw ??= currentYaw;
    dragPointer = event.pointerId;
    lastDragX = event.clientX;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
    help.textContent = closeup
      ? 'Manual angle  •  Middle-drag to rotate'
      : 'Scroll to browse  •  Manual angle  •  Middle-drag to rotate';
  });
  canvas.addEventListener('pointermove', (event) => {
    if (dragPointer !== event.pointerId || manualYaw === null) return;
    const dx = event.clientX - lastDragX;
    lastDragX = event.clientX;
    manualYaw += dx * DRAG_RADIANS_PER_PX;
    event.preventDefault();
  });
  const endDrag = (event: PointerEvent): void => {
    if (dragPointer !== event.pointerId) return;
    dragPointer = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  // Chromium's native middle-click autoscroll is counterproductive here.
  canvas.addEventListener('auxclick', (event) => {
    if (event.button === 1) event.preventDefault();
  });

  const project = new THREE.Vector3();
  const start = performance.now();

  function frame(now: number): void {
    requestAnimationFrame(frame);
    const t = (now - start) / 1000;
    if (!closeup) updateGalleryCamera();

    currentYaw = manualYaw ?? (closeup ? -0.5 + Math.sin(t * 0.25) * 0.35 : t * 0.42);
    canvas.dataset.previewYaw = currentYaw.toFixed(4);
    canvas.dataset.previewManual = String(manualYaw !== null);

    for (const stand of stands) {
      // Keep the gallery readable instead of showing every distant row
      // converging near the horizon. Adjacent rows overlap briefly while the
      // camera crosses between them, so scrolling still feels continuous.
      const inGallerySlice = closeup || Math.abs(stand.worldZ - galleryTargetZ) <= rowSpacing * 0.62;
      stand.group.visible = inGallerySlice;
      stand.group.rotation.y = currentYaw;
      animateCritter(stand.parts, stand.walkSpeed, t, 1 / 60, stand.speciesId);

      project.set(stand.worldX, stand.labelY, stand.worldZ).project(camera);
      const visible =
        inGallerySlice &&
        project.z > -1 && project.z < 1 &&
        project.x > -1.08 && project.x < 1.08 &&
        project.y > -1.08 && project.y < 1.08;
      stand.label.style.display = visible ? 'block' : 'none';
      if (!visible) continue;
      stand.label.style.left = `${(project.x * 0.5 + 0.5) * window.innerWidth}px`;
      stand.label.style.top = `${(-project.y * 0.5 + 0.5) * window.innerHeight}px`;
    }

    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
