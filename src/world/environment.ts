import * as THREE from 'three';
import { ENV } from '../core/constants.ts';

// ---------------------------------------------------------------------------
// Static scene environment: lighting, fog, a 3-stop gradient sky dome (with a
// soft sun disc + additive glow sprite along the sun direction) and a two-tone
// translucent water plane. All tuning lives in ENV (constants.ts). Called once
// at boot; chunk meshes stream in on top of this. The directional sun is
// configured here for an optional shadow map — whether it actually renders is
// gated on measured fps by main.ts (`renderer.shadowMap.enabled`).
// ---------------------------------------------------------------------------

/**
 * Vertical-gradient sky dome: a large sphere rendered from the inside. Three
 * colour stops (horizon → mid → zenith) give a richer sky than a flat two-stop
 * ramp. A soft sun disc + broad additive glow sprite are parented under the
 * dome along the sun direction (billboarded, far) so they track the camera with
 * the dome and never parallax.
 */
function makeSkyDome(): THREE.Object3D {
  const geo = new THREE.SphereGeometry(ENV.skyRadius, 32, 16);

  // Per-vertex 3-stop gradient: horizon (y≈0) → mid (ENV.skyMidStop) → zenith.
  const top = new THREE.Color(ENV.skyTop);
  const mid = new THREE.Color(ENV.skyMid);
  const horizon = new THREE.Color(ENV.skyHorizon);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const stop = ENV.skyMidStop;
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / ENV.skyRadius, 0, 1);
    if (t < stop) {
      c.copy(horizon).lerp(mid, t / stop);
    } else {
      // Ease the mid→zenith leg so the upper dome deepens smoothly.
      const u = Math.pow((t - stop) / (1 - stop), 0.8);
      c.copy(mid).lerp(top, u);
    }
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

  // Sun disc + glow along the sun direction, seated just inside the dome.
  const dir = new THREE.Vector3(ENV.sunPos.x, ENV.sunPos.y, ENV.sunPos.z).normalize();
  const at = dir.multiplyScalar(ENV.skyRadius * 0.92);
  dome.add(makeSunSprite(ENV.sunGlowColor, ENV.sunGlowSize, at, 0.55)); // broad glow
  dome.add(makeSunSprite(ENV.sunDiscColor, ENV.sunDiscSize, at, 0.95)); // tight disc
  return dome;
}

/** A soft radial billboard (additive) for the sun disc / glow. */
function makeSunSprite(color: number, size: number, at: THREE.Vector3, alpha: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: radialTexture(),
    color,
    transparent: true,
    opacity: alpha,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.position.copy(at);
  sprite.scale.set(size, size, 1);
  return sprite;
}

/** A cached white radial-falloff texture (opaque centre → transparent edge). */
let _radial: THREE.CanvasTexture | null = null;
function radialTexture(): THREE.CanvasTexture {
  if (_radial) return _radial;
  const s = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  _radial = new THREE.CanvasTexture(canvas);
  _radial.colorSpace = THREE.SRGBColorSpace;
  return _radial;
}

/**
 * Two-tone translucent water plane: vertex colours ramp from a shallow tone at
 * the centre to a deeper tone toward the edges (a cheap depth read), sitting
 * just above sea level. (A true distance-from-shore fresnel alpha would be
 * fiddlier for little gain at this fidelity, so it is intentionally skipped.)
 */
function makeWater(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(ENV.waterSize, ENV.waterSize, 24, 24);
  const shallow = new THREE.Color(ENV.waterColor);
  const deep = new THREE.Color(ENV.waterColorDeep);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // Plane is built in its local XY (rotated flat below), so radius uses x/y.
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    const t = THREE.MathUtils.clamp(r / ENV.waterToneRadius, 0, 1);
    c.copy(shallow).lerp(deep, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
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
 * objects are parented to the scene. The sun light is pre-configured for a
 * shadow map (main.ts gates whether it renders on measured fps).
 */
export function setupEnvironment(scene: THREE.Scene): void {
  const hemi = new THREE.HemisphereLight(ENV.hemiSky, ENV.hemiGround, ENV.hemiIntensity);
  hemi.name = 'hemiLight';
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(ENV.sunColor, ENV.sunIntensity);
  sun.position.set(ENV.sunPos.x, ENV.sunPos.y, ENV.sunPos.z);
  sun.name = 'sunLight';
  // Shadow config (rendered only when renderer.shadowMap.enabled — perf-gated).
  sun.castShadow = true;
  sun.shadow.mapSize.set(ENV.shadowMapSize, ENV.shadowMapSize);
  const cam = sun.shadow.camera as THREE.OrthographicCamera;
  cam.left = -ENV.shadowFrustum;
  cam.right = ENV.shadowFrustum;
  cam.top = ENV.shadowFrustum;
  cam.bottom = -ENV.shadowFrustum;
  cam.near = ENV.shadowNear;
  cam.far = ENV.shadowFar;
  cam.updateProjectionMatrix();
  sun.shadow.bias = ENV.shadowBias;
  scene.add(sun);
  scene.add(sun.target); // the follow-target is moved to the player each frame

  scene.fog = new THREE.Fog(ENV.fogColor, ENV.fogNear, ENV.fogFar);
  scene.background = new THREE.Color(ENV.fogColor);

  scene.add(makeSkyDome());
  scene.add(makeWater());
}
