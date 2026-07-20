import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { QualityFlags } from '../core/quality.ts';

// ---------------------------------------------------------------------------
// Post pipeline (Fidelity-2 P3, deliverable 3) — HIGH preset only. An
// EffectComposer chain: RenderPass → SSAO (subtle contact occlusion) → Unreal
// bloom (gentle emissive glow) → OutputPass (tone-map + colour-space encode).
//
// Tone mapping: the renderer keeps `toneMapping = ACESFilmic` + `outputColorSpace
// = sRGB`. RenderPass renders the scene into the composer's linear HDR target
// (NOT the drawing buffer → three does NOT tone-map there), the SSAO/bloom
// passes work in linear HDR, and OutputPass applies ACES + sRGB LAST, reading
// those exact settings off the renderer. So bloom's threshold sees the true
// pre-tone-map HDR (emissives that overshoot 1.0 bloom; lit surfaces near ~1.0
// mostly don't), which is why the threshold sits at ~0.85 rather than a
// post-ACES value. Leaving the renderer flags set is REQUIRED — OutputPass has
// no other source for which curve to apply.
//
// Medium/low never build a composer: `render()` in main.ts falls back to the
// plain `renderer.render(scene, camera)` direct path, byte-identical to pre-P3.
// The composer is also skipped on software backends (SwiftShader/e2e) unless a
// dev `forceFx` override is set, so the headless suite stays on the direct path.
// ---------------------------------------------------------------------------

export interface PostPipeline {
  composer: EffectComposer;
  setSize(width: number, height: number): void;
  render(): void;
  dispose(): void;
}

/**
 * Build the high-preset post composer, or return null when the preset doesn't
 * request post (medium/low: `ssao`/`bloom` both false). Both flags gate together
 * on high; either being on builds the chain.
 */
export function buildPostPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  flags: QualityFlags,
): PostPipeline | null {
  if (!flags.ssao && !flags.bloom) return null;

  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(size.x, size.y);

  composer.addPass(new RenderPass(scene, camera));

  let ssao: SSAOPass | null = null;
  if (flags.ssao) {
    // Subtle contact occlusion. kernelRadius is in view-space metres (~0.7 m);
    // min/max clamp the depth range so only near-surface concavities darken.
    ssao = new SSAOPass(scene, camera, size.x, size.y);
    ssao.kernelRadius = 0.7;
    ssao.minDistance = 0.0015;
    ssao.maxDistance = 0.06;
    ssao.output = SSAOPass.OUTPUT.Default;
    composer.addPass(ssao);
  }

  let bloom: UnrealBloomPass | null = null;
  if (flags.bloom) {
    // Gentle emissive glow: threshold ~0.85 against the pre-tone-map HDR (see
    // header), low strength, moderate radius. Crystals/lamps/antlers overshoot
    // the threshold and bloom softly; lit terrain sits below it.
    bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.5, 0.85);
    composer.addPass(bloom);
  }

  // OutputPass applies tone mapping + colour-space encode LAST (reads them off
  // the renderer). Must be the final pass in the chain.
  composer.addPass(new OutputPass());

  return {
    composer,
    setSize(width: number, height: number): void {
      composer.setSize(width, height);
      ssao?.setSize(width, height);
      bloom?.setSize(width, height);
    },
    render(): void {
      composer.render();
    },
    dispose(): void {
      composer.dispose();
    },
  };
}
