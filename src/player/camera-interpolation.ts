import type { Vec3 } from '../core/types.ts';

/** Interpolate the eye between fixed simulation steps. Physics/aiming retain
 * the current simulation pose; mouse rotation is applied separately each frame. */
export class CameraInterpolation {
  private previous: Vec3;
  readonly current: Vec3;
  readonly lastRendered: Vec3;
  private revision: number;

  constructor(position: Vec3, revision: number) {
    this.previous = { ...position };
    this.current = { ...position };
    this.lastRendered = { ...position };
    this.revision = revision;
  }

  reset(position: Vec3, revision: number): void {
    Object.assign(this.previous, position);
    Object.assign(this.current, position);
    this.revision = revision;
  }

  syncTeleport(position: Vec3, revision: number): void {
    if (revision !== this.revision) this.reset(position, revision);
  }

  record(position: Vec3, revision: number): void {
    if (revision !== this.revision) { this.reset(position, revision); return; }
    Object.assign(this.previous, this.current);
    Object.assign(this.current, position);
  }

  sample(alpha: number, out: Vec3): void {
    const t = Math.max(0, Math.min(1, alpha));
    out.x = this.previous.x + (this.current.x - this.previous.x) * t;
    out.y = this.previous.y + (this.current.y - this.previous.y) * t;
    out.z = this.previous.z + (this.current.z - this.previous.z) * t;
    Object.assign(this.lastRendered, out);
  }
}
