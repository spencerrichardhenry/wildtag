import { CHUNKS, SCATTER } from '../core/constants.ts';
import type { Obstacle } from '../player/collision.ts';
import { reservedForCuriosity } from '../discoveries/world.ts';
import { placementObstacle, scatterForChunk } from '../world/scatter.ts';

/** A visitor can outrun the child's rendered chunks. Both peers must collide
 * with the same scenery, including chunks neither camera has loaded yet. */
export class GrandpaScenery {
  private chunks = new Map<string, Obstacle[]>();
  private currentKey = '';
  private current: Obstacle[] = [];
  near(x: number, z: number): Obstacle[] {
    const cx = Math.floor(x / CHUNKS.size), cz = Math.floor(z / CHUNKS.size);
    const key = `${cx},${cz}`;
    if (key === this.currentKey) return this.current;
    const obstacles: Obstacle[] = [];
    const radius = SCATTER.obstacleRangeChunks;
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      const id = `${cx + dx},${cz + dz}`;
      let chunk = this.chunks.get(id);
      if (!chunk) {
        chunk = scatterForChunk(cx + dx, cz + dz).flatMap(p => {
          if (reservedForCuriosity(p.x, p.y, p.z)) return [];
          const obstacle = placementObstacle(p); return obstacle ? [obstacle] : [];
        });
        this.chunks.set(id, chunk);
      }
      obstacles.push(...chunk);
    }
    while (this.chunks.size > 128) this.chunks.delete(this.chunks.keys().next().value!);
    this.currentKey = key; this.current = obstacles;
    return obstacles;
  }
}
