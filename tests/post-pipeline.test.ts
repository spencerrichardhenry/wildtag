import * as THREE from 'three';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { describe, expect, it } from 'vitest';
import { buildPostPipeline } from '../src/world/post.ts';
import { QUALITY } from '../src/core/quality.ts';

describe('post pipeline resource budgets', () => {
  it('keeps beauty at native resolution and AO at half resolution on boot and resize', () => {
    for (const dpr of [1, 1.5, 2]) {
      const renderer = { getPixelRatio:()=>dpr, getSize:(v:THREE.Vector2)=>v.set(1200,800) } as THREE.WebGLRenderer;
      const pipeline = buildPostPipeline(renderer,new THREE.Scene(),new THREE.PerspectiveCamera(),QUALITY.high)!;
      const ssao = pipeline.composer.passes.find(p=>p instanceof SSAOPass) as SSAOPass;
      expect(pipeline.composer.readBuffer.width).toBe(1200*dpr);
      expect(ssao.normalRenderTarget.width).toBe(600*dpr);
      pipeline.setSize(900,500);
      expect(pipeline.composer.readBuffer.width).toBe(900*dpr);
      expect(ssao.normalRenderTarget.width).toBe(450*dpr);
      expect(ssao.ssaoRenderTarget.height).toBe(250*dpr);
      pipeline.dispose();
    }
  });
  it('disposes the AO targets and composer targets when a pipeline is removed', () => {
    const renderer = { getPixelRatio:()=>1, getSize:(v:THREE.Vector2)=>v.set(800,600) } as THREE.WebGLRenderer;
    const pipeline = buildPostPipeline(renderer,new THREE.Scene(),new THREE.PerspectiveCamera(),QUALITY.high)!;
    const ssao = pipeline.composer.passes.find(p=>p instanceof SSAOPass) as SSAOPass;
    const targets = [ssao.normalRenderTarget,ssao.ssaoRenderTarget,ssao.blurRenderTarget,
      pipeline.composer.renderTarget1,pipeline.composer.renderTarget2];
    const disposed = new Set();
    for (const target of targets) target.addEventListener('dispose',()=>disposed.add(target));
    pipeline.dispose();
    expect(disposed.size).toBe(targets.length);
  });
});
