import { INPUT } from '../core/constants.ts';
import type { MoveInput } from '../core/types.ts';

// ---------------------------------------------------------------------------
// First-person input owner. Holds keyboard state, owns yaw/pitch (mouse look),
// and requests pointer lock on canvas click. The pure movement core wants the
// jump / dash / rocket flags as one-shot *edges*: a keypress latches the flag
// until the next `state()` read consumes it, so each press produces exactly one
// simulated edge regardless of frame/sim cadence.
//
// UI-level edges (interact, hotbar, Tab, C, Escape) queue separately and are
// drained via `consumeActions()` — reserved for later screens/HUD tasks.
//
// Key map (final): W/A/S/D move, ShiftLeft sprint, Space jump (hold = glide),
// KeyQ dash, KeyR rocket, KeyF interact, Digit1–4 hotbar, Tab/KeyC/Escape UI,
// LMB dart throw (Task 10), RMB grapple (Task 12; `rmbHeld` for the reel) —
// mouse buttons register only while pointer-locked.
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'interact' }
  | { type: 'hotbar'; slot: number }
  | { type: 'tab' }
  | { type: 'toggleC' }
  | { type: 'escape' }
  | { type: 'lmb' }
  | { type: 'rmb' };

export class Input {
  private readonly canvas: HTMLCanvasElement;
  private readonly held = new Set<string>();

  /** Mouse-owned view angles (radians). yaw = 0 faces -Z (three.js camera). */
  yaw = 0;
  pitch = 0;

  // Latched movement edges — set on keydown, cleared by the next state() read.
  private jumpEdge = false;
  private dashEdge = false;
  private rocketEdge = false;

  private readonly actions: Action[] = [];

  /** True while the right mouse button is held (grapple reel, Task 12). */
  private rmbDown = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
  }

  /** Detach all listeners (teardown / tests). */
  dispose(): void {
    this.canvas.removeEventListener('click', this.onClick);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
  }

  /** True while the canvas holds the pointer lock (mouse look active). */
  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  private readonly onClick = (): void => {
    if (!this.locked) void this.canvas.requestPointerLock();
  };

  private readonly onContextMenu = (e: Event): void => {
    // RMB is a game control (grapple) — never open the context menu on canvas.
    e.preventDefault();
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (!this.locked) return; // clicks outside lock are UI / lock acquisition
    if (e.button === 0) {
      this.actions.push({ type: 'lmb' });
    } else if (e.button === 2) {
      this.rmbDown = true;
      this.actions.push({ type: 'rmb' });
    }
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 2) this.rmbDown = false;
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    this.yaw -= e.movementX * INPUT.mouseSensitivity;
    this.pitch -= e.movementY * INPUT.mouseSensitivity;
    if (this.pitch > INPUT.pitchClamp) this.pitch = INPUT.pitchClamp;
    if (this.pitch < -INPUT.pitchClamp) this.pitch = -INPUT.pitchClamp;
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;
    // Ignore auto-repeat: edges fire only on the initial down transition.
    if (this.held.has(code)) return;
    this.held.add(code);

    switch (code) {
      case 'Space':
        this.jumpEdge = true;
        e.preventDefault();
        break;
      case 'KeyQ':
        this.dashEdge = true;
        break;
      case 'KeyR':
        this.rocketEdge = true;
        break;
      case 'KeyF':
        this.actions.push({ type: 'interact' });
        break;
      case 'Digit1':
        this.actions.push({ type: 'hotbar', slot: 1 });
        break;
      case 'Digit2':
        this.actions.push({ type: 'hotbar', slot: 2 });
        break;
      case 'Digit3':
        this.actions.push({ type: 'hotbar', slot: 3 });
        break;
      case 'Digit4':
        this.actions.push({ type: 'hotbar', slot: 4 });
        break;
      case 'Tab':
        this.actions.push({ type: 'tab' });
        e.preventDefault();
        break;
      case 'KeyC':
        this.actions.push({ type: 'toggleC' });
        break;
      case 'Escape':
        this.actions.push({ type: 'escape' });
        break;
      default:
        break;
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };

  /**
   * Current movement intent for one sim step. Reading consumes the latched
   * jump/dash/rocket edges so each keypress yields exactly one edge step.
   */
  state(): MoveInput {
    const forward = (this.held.has('KeyW') ? 1 : 0) - (this.held.has('KeyS') ? 1 : 0);
    // strafe > 0 = move right; right = (cos yaw, 0, -sin yaw). D is right, A left.
    const strafe = (this.held.has('KeyD') ? 1 : 0) - (this.held.has('KeyA') ? 1 : 0);

    const out: MoveInput = {
      forward,
      strafe,
      yaw: this.yaw,
      sprint: this.held.has('ShiftLeft') || this.held.has('ShiftRight'),
      jump: this.jumpEdge,
      jumpHeld: this.held.has('Space'),
      dash: this.dashEdge,
      rocket: this.rocketEdge,
    };

    this.jumpEdge = false;
    this.dashEdge = false;
    this.rocketEdge = false;
    return out;
  }

  /** True while the right mouse button is held and the pointer is locked. */
  get rmbHeld(): boolean {
    return this.rmbDown && this.locked;
  }

  /** Return and clear the queued UI-level action edges. */
  consumeActions(): Action[] {
    const drained = this.actions.slice();
    this.actions.length = 0;
    return drained;
  }
}
