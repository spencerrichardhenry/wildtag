import * as THREE from 'three';
import { ENV } from '../core/constants.ts';

// ---------------------------------------------------------------------------
// Static scene environment: lighting, fog, a gradient sky dome and a
// translucent water plane. All tuning lives in ENV (constants.ts). Called once
// at boot; chunk meshes stream in on top of this.
// ---------------------------------------------------------------------------

/** Vertical-gradient sky dome: a large sphere rendered from the inside. */
function makeSkyDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(ENV.skyRadius, 32, 16);

  // Per-vertex gradient from horizon (y ≈ 0) up to the zenith (y = 1).
  const top = new THREE.Color(ENV.skyTop);
  const horizon = new THREE.Color(ENV.skyHorizon);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // Normalize height over the sphere to [0, 1]; bias toward horizon.
    const t = THREE.MathUtils.clamp(pos.getY(i) / ENV.skyRadius, 0, 1);
    c.copy(horizon).lerp(top, Math.pow(t, 0.6));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.name = 'skyDome';
  return dome;
}

/** Translucent water plane sitting just above sea level. */
function makeWater(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(ENV.waterSize, ENV.waterSize);
  const mat = new THREE.MeshLambertMaterial({
    color: ENV.waterColor,
    transparent: true,
    opacity: ENV.waterOpacity,
    depthWrite: false,
  });
  const water = new THREE.Mesh(geo, mat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = ENV.waterY;
  water.name = 'water';
  return water;
}

/**
 * Install lighting, fog, sky dome and water into `scene`. Returns nothing; all
 * objects are parented to the scene.
 */
export function setupEnvironment(scene: THREE.Scene): void {
  const hemi = new THREE.HemisphereLight(ENV.hemiSky, ENV.hemiGround, ENV.hemiIntensity);
  hemi.name = 'hemiLight';
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(ENV.sunColor, ENV.sunIntensity);
  sun.position.set(ENV.sunPos.x, ENV.sunPos.y, ENV.sunPos.z);
  sun.name = 'sunLight';
  scene.add(sun);

  scene.fog = new THREE.Fog(ENV.fogColor, ENV.fogNear, ENV.fogFar);
  scene.background = new THREE.Color(ENV.fogColor);

  scene.add(makeSkyDome());
  scene.add(makeWater());
}
