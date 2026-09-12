import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { registerArtAsset } from '../src/art/library.ts';
import { GrandpaModel } from '../src/grandpa/model.ts';
import { createGrandpa } from '../src/grandpa/core.ts';
import { GrandpaScenery } from '../src/grandpa/scenery.ts';
import { PropManager } from '../src/world/props.ts';

it('uses the same obstacle field before and after scenery is rendered around a distant visitor', () => {
  const scene = new THREE.Scene(), props = new PropManager(scene), scenery = new GrandpaScenery();
  const x = -366, z = -300;
  expect(props.getObstacles(x, z)).toHaveLength(0);
  const remote = scenery.near(x, z);
  expect(remote.length).toBeGreaterThan(10);
  props.primeAround(x, z, 0);
  const stable = (list: typeof remote) => list.map(o => JSON.stringify(o)).sort();
  expect(stable(remote)).toEqual(stable(props.getObstacles(x, z)));
  props.dispose();
});

it('plants the exported Blender feet on flat and sloping ground while walking', async () => {
  const file = readFileSync('public/wildtag/models/grandpa_featherfoot.glb');
  const { scene } = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '');
  registerArtAsset('grandpa_featherfoot', scene);
  for (const slope of [0, .5, -.5]) {
    const bird = new GrandpaModel();
    const ground = { heightAt: (x: number, z: number) => 20 + x * slope + z * .2 };
    const s = createGrandpa({ x: 0, y: 20, z: 0 }); s.vel.z = -5.2;
    for (let n = 0; n < 120; n++) {
      s.pos.z -= 5.2 / 60; s.pos.y = ground.heightAt(s.pos.x, s.pos.z);
      bird.root.position.set(s.pos.x, s.pos.y, s.pos.z);
      bird.animate(s, n / 60, false, 1 / 60, ground);
      bird.root.updateMatrixWorld(true);
      const gaps = ['left', 'right'].map(side => {
        const ankle = bird.root.getObjectByName(`gp_foot_${side}`)!;
        const toe = ankle.localToWorld(new THREE.Vector3(0, -.2, 0));
        return toe.y - ground.heightAt(toe.x, toe.z);
      });
      expect(Math.min(...gaps)).toBeGreaterThan(-.06);
      expect(Math.min(...gaps)).toBeLessThan(.10);
      expect(Math.max(...gaps)).toBeLessThan(.45);
    }
    bird.dispose();
  }
});
