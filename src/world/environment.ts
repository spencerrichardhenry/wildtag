import * as THREE from 'three';
import { ENV, DAYLIGHT, WORLD_SEED } from '../core/constants.ts';
import { heightAt } from './terrain.ts';
import { lerpColorHex, type DaylightSample } from '../core/daylight.ts';
import { mulberry32 } from '../core/rng.ts';

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
/**
 * Per-vertex 3-stop vertical gradient (horizon y≈0 → mid `midStop` → zenith)
 * over a sphere's position attribute. Shared by the day dome build and the
 * daylight rig's precomputed night-stop colors so both blend from/to
 * identically-shaped gradients (`world/daylight` lerps day↔night per vertex).
 */
function skyGradientColors(
  pos: THREE.BufferAttribute,
  radius: number,
  midStop: number,
  top: THREE.Color,
  mid: THREE.Color,
  horizon: THREE.Color,
): Float32Array {
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / radius, 0, 1);
    if (t < midStop) {
      c.copy(horizon).lerp(mid, t / midStop);
    } else {
      // Ease the mid→zenith leg so the upper dome deepens smoothly.
      const u = Math.pow((t - midStop) / (1 - midStop), 0.8);
      c.copy(mid).lerp(top, u);
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  return colors;
}

function makeSkyDome(): THREE.Object3D {
  const geo = new THREE.SphereGeometry(ENV.skyRadius, 32, 16);

  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = skyGradientColors(
    pos,
    ENV.skyRadius,
    ENV.skyMidStop,
    new THREE.Color(ENV.skyTop),
    new THREE.Color(ENV.skyMid),
    new THREE.Color(ENV.skyHorizon),
  );
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
  // Named so the daylight rig (setupDaylight) can fade them out at night.
  const dir = new THREE.Vector3(ENV.sunPos.x, ENV.sunPos.y, ENV.sunPos.z).normalize();
  const at = dir.multiplyScalar(ENV.skyRadius * 0.92);
  dome.add(makeSunSprite(ENV.sunGlowColor, ENV.sunGlowSize, at, 0.55, 'sunGlowSprite')); // broad glow
  dome.add(makeSunSprite(ENV.sunDiscColor, ENV.sunDiscSize, at, 0.95, 'sunDiscSprite')); // tight disc
  return dome;
}

/** A soft radial billboard (additive) for the sun disc / glow / moon. */
function makeSunSprite(
  color: number,
  size: number,
  at: THREE.Vector3,
  alpha: number,
  name?: string,
): THREE.Sprite {
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
  if (name) sprite.name = name;
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

/**
 * Drives the visible day/night cycle: sun/hemi intensity + sun color, fog +
 * background color, the sky dome's vertex gradient, sun disc/glow fade, and a
 * moon + starfield that fade in at night. Call `setupDaylight(scene)` ONCE
 * right after `setupEnvironment(scene)`; feed it a `daylightAt(worldClock)`
 * sample every frame via `update()`.
 */
export interface DaylightRig {
  /**
   * Apply a daylight sample to the scene's lights/sky/fog/stars. Cheap no-op
   * when darkness + phase haven't meaningfully moved since the last call.
   */
  update(sample: DaylightSample): void;
  /**
   * Sun intensity scale factor for the current sample: 1 at full day, ramping
   * toward `DAYLIGHT.night.sunIntensity / ENV.sunIntensity` at full night.
   * main.ts feeds this into `ShadowRig.setSunScale` each frame so the cascade
   * intensity shares stay proportionally correct instead of this rig fighting
   * the per-cascade `baseIntensity * share` split with a direct intensity set.
   */
  readonly sunScale: number;
}

/** Install the day/night rig's moon/star geometry and wire per-frame `update`. */
export function setupDaylight(scene: THREE.Scene): DaylightRig {
  const sun = scene.getObjectByName('sunLight') as THREE.DirectionalLight | null;
  const hemi = scene.getObjectByName('hemiLight') as THREE.HemisphereLight | null;
  const dome = scene.getObjectByName('skyDome') as THREE.Mesh | null;
  const N = DAYLIGHT.night;

  const domeGeo = dome?.geometry as THREE.BufferGeometry | undefined;
  const domePos = domeGeo?.getAttribute('position') as THREE.BufferAttribute | undefined;
  const domeColorAttr = domeGeo?.getAttribute('color') as THREE.BufferAttribute | undefined;
  // Snapshot the day gradient once so the night blend always lerps from the
  // ORIGINAL day colors, never from a previously-blended (already darkened) one.
  const dayColors = domeColorAttr ? (domeColorAttr.array as Float32Array).slice() : null;
  const nightColors =
    domePos && domeColorAttr
      ? skyGradientColors(
          domePos,
          ENV.skyRadius,
          ENV.skyMidStop,
          new THREE.Color(N.skyTop),
          new THREE.Color(N.skyMid),
          new THREE.Color(N.skyHorizon),
        )
      : null;

  const sunDisc = dome?.getObjectByName('sunDiscSprite') as THREE.Sprite | undefined;
  const sunGlow = dome?.getObjectByName('sunGlowSprite') as THREE.Sprite | undefined;
  const sunDiscBaseAlpha = (sunDisc?.material as THREE.SpriteMaterial | undefined)?.opacity ?? 0.95;
  const sunGlowBaseAlpha = (sunGlow?.material as THREE.SpriteMaterial | undefined)?.opacity ?? 0.55;

  // Moon: a sprite mirrored roughly opposite the sun direction, parented under
  // the dome (same billboard-along-direction pattern as the sun disc/glow).
  const moonDir = new THREE.Vector3(-ENV.sunPos.x, ENV.sunPos.y * 0.9, -ENV.sunPos.z).normalize();
  const moonAt = moonDir.multiplyScalar(ENV.skyRadius * 0.92);
  const moon = makeSunSprite(N.moonColor, N.moonSize, moonAt, 0, 'moonSprite');
  dome?.add(moon);

  // Stars: a deterministic THREE.Points cloud on the upper hemisphere, seeded
  // off WORLD_SEED so the sky reads the same across reloads.
  const starGeo = new THREE.BufferGeometry();
  const starPositions = new Float32Array(N.starCount * 3);
  const rand = mulberry32(WORLD_SEED ^ 0x57a75);
  const starRadius = ENV.skyRadius * 0.95;
  for (let i = 0; i < N.starCount; i++) {
    // Uniform-ish point on the upper hemisphere: random azimuth + a uniform y
    // in [0,1] (upper half only), ring radius from the unit-sphere equation.
    const az = rand() * Math.PI * 2;
    const y = rand();
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    starPositions[i * 3] = Math.cos(az) * ring * starRadius;
    starPositions[i * 3 + 1] = y * starRadius;
    starPositions[i * 3 + 2] = Math.sin(az) * ring * starRadius;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: N.starSize,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.name = 'stars';
  dome?.add(stars);

  let lastK = -1;
  let lastPhase: DaylightSample['phase'] | null = null;
  let lastDomeK = -1;
  let sunScale = 1;

  return {
    get sunScale(): number {
      return sunScale;
    },
    update(sample: DaylightSample): void {
      const k = sample.darkness;
      // Cheap no-op when nothing meaningfully changed since the last call.
      if (Math.abs(k - lastK) < 0.005 && sample.phase === lastPhase) return;
      lastK = k;
      lastPhase = sample.phase;

      sunScale = THREE.MathUtils.lerp(1, N.sunIntensity / ENV.sunIntensity, k);
      if (sun) sun.color.setHex(lerpColorHex(ENV.sunColor, N.sunColor, k));
      if (hemi) hemi.intensity = THREE.MathUtils.lerp(ENV.hemiIntensity, N.hemiIntensity, k);

      const fogColor = lerpColorHex(ENV.fogColor, N.fogColor, k);
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.color.setHex(fogColor);
        scene.fog.near = THREE.MathUtils.lerp(ENV.fogNear, N.fogNear, k);
        scene.fog.far = THREE.MathUtils.lerp(ENV.fogFar, N.fogFar, k);
      }
      if (scene.background instanceof THREE.Color) scene.background.setHex(fogColor);
      else scene.background = new THREE.Color(fogColor);

      // Sky dome vertex rewrite is the priciest part (561 verts) — gated at a
      // coarser 0.01 delta on top of the outer 0.005 early-return.
      if (dayColors && nightColors && domeColorAttr && Math.abs(k - lastDomeK) >= 0.01) {
        lastDomeK = k;
        const arr = domeColorAttr.array as Float32Array;
        for (let i = 0; i < arr.length; i++) {
          const d = dayColors[i]!;
          arr[i] = d + (nightColors[i]! - d) * k;
        }
        domeColorAttr.needsUpdate = true;
      }

      if (sunDisc) (sunDisc.material as THREE.SpriteMaterial).opacity = sunDiscBaseAlpha * (1 - k);
      if (sunGlow) (sunGlow.material as THREE.SpriteMaterial).opacity = sunGlowBaseAlpha * (1 - k);
      (moon.material as THREE.SpriteMaterial).opacity = k * 0.95;
      starMat.opacity = k;
    },
  };
}
