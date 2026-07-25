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
// KeyQ dash, KeyR rocket, KeyF interact, Digit1–5 hotbar, Tab/KeyC/Escape UI,
// LMB dart throw (Task 10), RMB grapple (Task 12; `rmbHeld` for the reel) —
// mouse buttons register only while pointer-locked.
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'interact' }
  | { type: 'hotbar'; slot: number }
  | { type: 'tab' }
  | { type: 'toggleC' }
  | { type: 'roster' }
  | { type: 'mount' }
  | { type: 'escape' }
  | { type: 'lmb' }
  | { type: 'rmb' };

/**
 * Pure key-code → queued-UI-action mapping (Digit1–5 hotbar, F/Tab/C/B/V/Esc),
 * extracted from `Input.onKeyDown` so this mapping is unit-testable without
 * DOM (same spirit as `EdgeLatch` below). Movement keys, modifiers and the
 * one-shot edge keys (Space/KeyQ/KeyR, owned by `EdgeLatch`) return null —
 * `onKeyDown` handles those separately (it also needs `preventDefault` on
 * Space/Tab, which stays there since it needs the real event).
 */
export function actionForCode(code: string): Action | null {
  switch (code) {
    case 'KeyF':
      return { type: 'interact' };
    case 'Digit1':
      return { type: 'hotbar', slot: 1 };
    case 'Digit2':
      return { type: 'hotbar', slot: 2 };
    case 'Digit3':
      return { type: 'hotbar', slot: 3 };
    case 'Digit4':
      return { type: 'hotbar', slot: 4 };
    case 'Digit5':
      return { type: 'hotbar', slot: 5 };
    case 'Tab':
      return { type: 'tab' };
    case 'KeyC':
      return { type: 'toggleC' };
    case 'KeyB':
      return { type: 'roster' };
    case 'KeyV':
      return { type: 'mount' };
    case 'Escape':
      return { type: 'escape' };
    default:
      return null;
  }
}

/**
 * The one-shot movement-edge latch (jump/dash/rocket), extracted from Input
 * so it is unit-testable without DOM. A keydown latches an edge; `consume()`
 * returns and clears all three (exactly-one-edge-per-press); `clear()` drops
 * any pending edges without firing them — called by the screen manager on
 * both screen open AND close, because `Input.state()` is not read while a
 * screen is open (main.ts skips `player.update`), so a press made just
 * before opening — or while the screen is open, since the keydown listeners
 * stay live — would otherwise stay latched the whole time and fire a stale
 * dash/jump/rocket on the first sim step after closing.
 */
export class EdgeLatch {
  private jump = false;
  private dash = false;
  private rocket = false;

  latch(kind: 'jump' | 'dash' | 'rocket'): void {
    this[kind] = true;
  }

  /** Return the pending edges and clear them (one edge per press). */
  consume(): { jump: boolean; dash: boolean; rocket: boolean } {
    const out = { jump: this.jump, dash: this.dash, rocket: this.rocket };
    this.jump = false;
    this.dash = false;
    this.rocket = false;
    return out;
  }

  /** Drop any pending edges without firing them. */
  clear(): void {
    this.jump = false;
    this.dash = false;
    this.rocket = false;
  }
}

export class Input {
  private readonly canvas: HTMLCanvasElement;
  private readonly held = new Set<string>();

  /** Mouse-owned view angles (radians). yaw = 0 faces -Z (three.js camera). */
  yaw = 0;
  pitch = 0;

  // Latched movement edges — set on keydown, cleared by the next state() read
  // (or dropped by clearEdges() when a screen opens/closes).
  private readonly edges = new EdgeLatch();

  private readonly actions: Action[] = [];

  /** True while the right mouse button is held (grapple fire/hold, Task 12). */
  private rmbDown = false;

  /** True while the left mouse button is held (grapple reel while attached). */
  private lmbDown = false;

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
      this.lmbDown = true;
      this.actions.push({ type: 'lmb' });
    } else if (e.button === 2) {
      this.rmbDown = true;
      this.actions.push({ type: 'rmb' });
    }
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.lmbDown = false;
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
        this.edges.latch('jump');
        e.preventDefault();
        return;
      case 'KeyQ':
        this.edges.latch('dash');
        return;
      case 'KeyR':
        this.edges.latch('rocket');
        return;
      case 'Tab':
        // Tab would otherwise shift focus off the canvas — still needs the
        // real event, so this stays here rather than in actionForCode.
        e.preventDefault();
        break;
      default:
        break;
    }
    const action = actionForCode(code);
    if (action) this.actions.push(action);
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

    const edges = this.edges.consume();
    return {
      forward,
      strafe,
      yaw: this.yaw,
      sprint: this.held.has('ShiftLeft') || this.held.has('ShiftRight'),
      jump: edges.jump,
      jumpHeld: this.held.has('Space'),
      dash: edges.dash,
      rocket: edges.rocket,
    };
  }

  /**
   * Drop any latched jump/dash/rocket edges without firing them. Called by
   * the ScreenManager on both screen open and close so presses made just
   * before opening, or while a screen is open, never fire a stale edge on
   * the first sim step after the screen closes.
   */
  clearEdges(): void {
    this.edges.clear();
  }

  /** True while the right mouse button is held and the pointer is locked. */
  get rmbHeld(): boolean {
    return this.rmbDown && this.locked;
  }

  /** True while the left mouse button is held and the pointer is locked. */
  get lmbHeld(): boolean {
    return this.lmbDown && this.locked;
  }

  /**
   * Raw held-key getters (Task 13 structures): the zipline ride reads held F
   * (mount tap / recall hold) and held Space (jump-off) directly rather than
   * through the one-shot edge latch, since the controller skips `state()`
   * while riding. Gated on pointer lock to match the mouse-button getters.
   */
  get interactHeld(): boolean {
    return this.held.has('KeyF') && this.locked;
  }
  get spaceHeld(): boolean {
    return this.held.has('Space') && this.locked;
  }

  /** Return and clear the queued UI-level action edges. */
  consumeActions(): Action[] {
    const drained = this.actions.slice();
    this.actions.length = 0;
    return drained;
  }
}
