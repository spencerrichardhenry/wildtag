import * as THREE from 'three';
import { ENV } from '../core/constants.ts';
import { heightAt } from './terrain.ts';

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
 * Water 1.5 — a translucent Phong plane with an animated shader (F2 P2):
 *  • two-tone vertex colours (shallow centre → deep edge, a cheap depth read);
 *  • a per-vertex shore-fade alpha baked from the seabed depth (waterY −
 *    heightAt) at each vertex, so the shoreline dissolves instead of a hard cut
 *    (the plane is subdivided ENV.waterSegments² so the fade has resolution);
 *  • two scrolling procedural ripples perturbing the surface normal in the
 *    fragment shader → the sun specular shimmers;
 *  • a view-angle (fresnel-ish) rim that lifts opacity at grazing angles.
 * True planar reflections stay OFF (P3/high). The scroll clock is advanced by
 * `updateWater` from the main loop; the compiled shader is stashed on
 * `material.userData.shader` on first compile.
 */
function makeWater(): THREE.Mesh {
  const seg = ENV.waterSegments;
  const geo = new THREE.PlaneGeometry(ENV.waterSize, ENV.waterSize, seg, seg);
  const shallow = new THREE.Color(ENV.waterColor);
  const deep = new THREE.Color(ENV.waterColorDeep);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const shore = new Float32Array(pos.count); // per-vertex shore-fade alpha [0,1]
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // Plane is built in its local XY then rotated flat below: local (x, y) maps
    // to world (x, 0, -y). Radius (for the tone ramp) is invariant under that.
    const lx = pos.getX(i);
    const ly = pos.getY(i);
    const r = Math.hypot(lx, ly);
    const t = THREE.MathUtils.clamp(r / ENV.waterToneRadius, 0, 1);
    c.copy(shallow).lerp(deep, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    // Shore fade: 0 where the seabed meets the surface (no water depth), ramping
    // to 1 over ENV.waterShoreFade metres of depth.
    const depth = ENV.waterY - heightAt(lx, -ly);
    shore[i] = THREE.MathUtils.clamp(depth / ENV.waterShoreFade, 0, 1);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aShore', new THREE.BufferAttribute(shore, 1));

  const mat = new THREE.MeshPhongMaterial({
    vertexColors: true,
    transparent: true,
    opacity: ENV.waterOpacity,
    depthWrite: false,
    specular: new THREE.Color(ENV.waterSpecular),
    shininess: ENV.waterShininess,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uRippleAmp = { value: ENV.waterRippleAmp };
    shader.uniforms.uRippleFreq = { value: ENV.waterRippleFreq };
    shader.uniforms.uRippleSpeed = { value: ENV.waterRippleSpeed };
    shader.uniforms.uFresnel = { value: ENV.waterFresnel };

    // Vertex: carry the shore-fade alpha + the world XZ to the fragment shader.
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aShore;\nvarying float vShore;\nvarying vec2 vWXZ;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvShore = aShore;\nvWXZ = (modelMatrix * vec4(position, 1.0)).xz;',
      );

    // Fragment: perturb the geometric normal with two scrolling procedural
    // ripples (specular shimmer), then a fresnel-ish rim + shore fade on alpha.
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nuniform float uRippleAmp;\nuniform float uRippleFreq;\nuniform float uRippleSpeed;\nuniform float uFresnel;\nvarying float vShore;\nvarying vec2 vWXZ;',
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        {
          float t = uTime * uRippleSpeed;
          float f = uRippleFreq;
          // Two scrolling procedural reads → a normal-space gradient.
          float rx = sin(vWXZ.x * f + t) + sin(vWXZ.y * f * 0.8 - t * 1.3);
          float rz = sin(vWXZ.y * f + t * 0.9) + sin(vWXZ.x * f * 0.7 + t * 0.6);
          normal = normalize(normal + vec3(rx, 0.0, rz) * uRippleAmp);
        }`,
      )
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.0);
        gl_FragColor.a = clamp(gl_FragColor.a * vShore + fres * uFresnel, 0.0, 1.0);`,
      );

    mat.userData.shader = shader;
  };

  const water = new THREE.Mesh(geo, mat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = ENV.waterY;
  water.name = 'water';
  return water;
}

/** Advance the water surface's ripple clock (called each frame from main). */
export function updateWater(scene: THREE.Scene, time: number): void {
  const water = scene.getObjectByName('water') as THREE.Mesh | null;
  const shader = (water?.material as THREE.Material | undefined)?.userData?.shader as
    | { uniforms: { uTime: { value: number } } }
    | undefined;
  if (shader) shader.uniforms.uTime.value = time;
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
