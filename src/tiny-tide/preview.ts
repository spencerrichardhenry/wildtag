// Small creature renders for the path cards. One offscreen renderer is reused
// and disposed after 30 seconds without a render.
import * as T from 'three';
import { CreatureModel } from './creature';
import type { Genome } from './genome';

const IDLE_MS = 30000;
let renderer: T.WebGLRenderer | null = null, idle = 0;
const scene = new T.Scene(), camera = new T.PerspectiveCamera(32, 1, .05, 80);
scene.add(new T.HemisphereLight('#d6fbf6', '#3d6d6d', 2.2));
const key = new T.DirectionalLight('#fff0cb', 2.4); key.position.set(-3, 6, 4); scene.add(key);
const box = new T.Box3(), center = new T.Vector3(), extent = new T.Vector3();

/** A PNG data URL of the creature, `size` CSS pixels square. */
export function renderPreview(genome: Genome, size = 160): string {
  renderer ??= new T.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(size, size, false);
  renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping;
  const model = new CreatureModel(genome); scene.add(model.group);
  // Frame the whole creature from a three-quarter view.
  box.setFromObject(model.group); box.getCenter(center); const radius = box.getSize(extent).length() / 2 || 1;
  const distance = radius / Math.sin(T.MathUtils.degToRad(camera.fov) / 2) * .8;
  camera.position.copy(center).add(new T.Vector3(.75, .45, 1).normalize().multiplyScalar(distance)); camera.lookAt(center);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(model.group); model.dispose();
  clearTimeout(idle);
  idle = window.setTimeout(() => { renderer?.dispose(); renderer?.forceContextLoss(); renderer = null; }, IDLE_MS);
  return url;
}
