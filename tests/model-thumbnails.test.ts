import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ITEM_IDS } from '../src/craft/hotbar.ts';
import { buildItemThumbnailModel } from '../src/ui/model-thumbnails.ts';

function meshCount(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) count++;
  });
  return count;
}

describe('inventory item thumbnail models', () => {
  it('gives every assignable item a non-empty 3D object', () => {
    for (const item of ITEM_IDS) {
      const model = buildItemThumbnailModel(item);
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      expect(model.userData.itemId).toBe(item);
      expect(meshCount(model), item).toBeGreaterThan(0);
      expect(bounds.isEmpty(), item).toBe(false);
      expect(size.x, `${item} width`).toBeGreaterThan(0);
      expect(size.y, `${item} height`).toBeGreaterThan(0);
      expect(size.z, `${item} depth`).toBeGreaterThan(0);
    }
  });

  it('uses recognisable multi-part silhouettes for kits and projectiles', () => {
    expect(meshCount(buildItemThumbnailModel('darts'))).toBeGreaterThanOrEqual(5);
    expect(meshCount(buildItemThumbnailModel('purifiers'))).toBeGreaterThanOrEqual(5);
    expect(meshCount(buildItemThumbnailModel('charms'))).toBeGreaterThanOrEqual(2);
    expect(meshCount(buildItemThumbnailModel('kit:zipline'))).toBeGreaterThanOrEqual(5);
    expect(meshCount(buildItemThumbnailModel('kit:drone'))).toBeGreaterThanOrEqual(10);
  });
});
