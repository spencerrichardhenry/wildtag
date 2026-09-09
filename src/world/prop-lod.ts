import type { QualityId } from '../core/quality.ts';

export type PropDetail = 0 | 1 | 2;
const BANDS: Record<QualityId, readonly [number, number]> = {
  high: [32, 88], medium: [24, 64], low: [16, 48],
};

/** Distance in metres, with 8 m hysteresis to prevent flickering at a boundary. */
export function propDetail(distance: number, previous: PropDetail, quality: QualityId): PropDetail {
  const [near, mid] = BANDS[quality];
  if (distance < near - (previous > 0 ? 4 : 0)) return 0;
  if (distance > mid + (previous < 2 ? 4 : 0)) return 2;
  if (previous === 0 && distance <= near + 4) return 0;
  if (previous === 2 && distance >= mid - 4) return 2;
  return 1;
}
