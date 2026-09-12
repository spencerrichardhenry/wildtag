import type { Input } from '../player/input.ts';
import { REST_INPUT, type GrandpaInput, type GrandpaState } from './core.ts';

/** Numbered presses survive a quick tap between network sends or prediction
 * corrections. Holding Space/Shift never repeatedly fires the action. */
export class GrandpaControls {
  private held = new Set<string>();
  private jumpId = 0;
  private sprintId = 0;
  constructor(private readonly input: Input, private readonly enabled: () => boolean, private readonly state: () => GrandpaState | null) {
    document.addEventListener('keydown', this.down);
    document.addEventListener('keyup', this.up);
    window.addEventListener('blur', this.clear);
    document.addEventListener('pointerlockchange', this.clear);
  }
  private down = (e: KeyboardEvent): void => {
    if (!this.enabled() || !this.input.locked || e.repeat || this.held.has(e.code)) return;
    this.held.add(e.code);
    if (e.code === 'Space') this.jumpId = Math.max(this.jumpId, this.state()?.jumpId ?? 0) + 1;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.sprintId = Math.max(this.sprintId, this.state()?.sprintId ?? 0) + 1;
  };
  private up = (e: KeyboardEvent): void => { this.held.delete(e.code); };
  private clear = (): void => { this.held.clear(); };
  read(): GrandpaInput {
    if (!this.enabled() || !this.input.locked || document.hidden) return { ...REST_INPUT, yaw: this.input.yaw };
    return {
      forward: Number(this.held.has('KeyW')) - Number(this.held.has('KeyS')),
      strafe: Number(this.held.has('KeyD')) - Number(this.held.has('KeyA')),
      yaw: this.input.yaw, jumpId: this.jumpId, sprintId: this.sprintId,
      vault: this.held.has('KeyE'), sneeze: this.held.has('KeyQ'),
    };
  }
}
