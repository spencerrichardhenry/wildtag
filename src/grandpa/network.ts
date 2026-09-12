import { Peer, type DataConnection } from 'peerjs';
import { decodeSave, type SaveV3 } from '../core/save.ts';
import type { Vec3 } from '../core/types.ts';
import type { CritterView } from '../critters/manager.ts';
import { GRANDPA, WORLD_SEED } from '../core/constants.ts';
import { finiteVec, REST_INPUT, type ChaseState, type GrandpaInput, type GrandpaState } from './core.ts';
import { peerOptions } from './ice.ts';

export const GRANDPA_PROTOCOL = 1;
const PREFIX = 'wildtag-grandpa-v1-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export type ConnectionStatus = 'idle' | 'opening' | 'waiting' | 'connecting' | 'connected' | 'disconnected' | 'error';
export interface GrandpaSnapshot {
  grandpa: GrandpaState;
  chase: ChaseState;
  child: { pos: Vec3; yaw: number; vel: Vec3; grapple: Vec3 | null; mounted: boolean };
  critters: CritterView[];
  clock: number;
  paused: boolean;
  darts: Vec3[];
}
export function normalizeCode(code: string): string { return code.toUpperCase().replace(/[\s-]/g, ''); }
export function validCode(code: string): boolean { return /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(normalizeCode(code)); }
export function makeCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, b => CODE_CHARS[b % CODE_CHARS.length]).join('');
}
export function displayCode(code: string): string { return `${code.slice(0, 4)}-${code.slice(4)}`; }
export function inviteLink(code: string, base = window.location.href): string {
  const url = new URL('grandpa.html', base);
  url.search = '';
  url.hash = `join=${normalizeCode(code)}`;
  return url.href;
}
export function readGrandpaInput(value: unknown): GrandpaInput | null {
  if (!value || typeof value !== 'object') return null;
  const i = value as GrandpaInput;
  if (![i.forward, i.strafe, i.yaw].every(Number.isFinite) || Math.abs(i.forward) > 1 || Math.abs(i.strafe) > 1 || Math.abs(i.yaw) > 1e6 || ![i.vault, i.drift, i.sneeze].every(v => typeof v === 'boolean')) return null;
  return { forward: i.forward, strafe: i.strafe, yaw: i.yaw, vault: i.vault, drift: i.drift, sneeze: i.sneeze };
}
function validSnapshot(v: unknown): v is GrandpaSnapshot {
  if (!v || typeof v !== 'object') return false;
  const s = v as GrandpaSnapshot;
  return !!s.grandpa && finiteVec(s.grandpa.pos) && finiteVec(s.grandpa.vel) && Number.isFinite(s.grandpa.yaw) &&
    !!s.child && finiteVec(s.child.pos) && finiteVec(s.child.vel) && Number.isFinite(s.child.yaw) &&
    !!s.chase && ['roaming', 'tracking', 'caught'].includes(s.chase.phase) && Number.isFinite(s.chase.progress) &&
    Number.isFinite(s.clock) && Array.isArray(s.critters) && s.critters.length <= 200 && Array.isArray(s.darts) && s.darts.length <= 100;
}

/** PeerJS's public service brokers the room; WebRTC carries game state. */
export class GrandpaNetwork {
  readonly guest: boolean;
  status: ConnectionStatus = 'idle';
  code = '';
  message = '';
  peer: Peer | null = null;
  connection: DataConnection | null = null;
  initialWorld: SaveV3 | null = null;
  latest: GrandpaSnapshot | null = null;
  onChange: () => void = () => {};
  onJoin: () => void = () => {};
  onLeave: () => void = () => {};
  onSnapshot: (s: GrandpaSnapshot) => void = () => {};
  onWorld: (s: SaveV3) => void = () => {};
  world: () => SaveV3;
  private pending: DataConnection | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastReceived = 0;
  private lastInputAt = 0;
  private input = { ...REST_INPUT };
  private generation = 0;
  private lastWorld = '';
  private heartbeat: ReturnType<typeof setInterval>;

  constructor(guest: boolean, world: () => SaveV3 = () => { throw new Error('World not ready'); }) {
    this.guest = guest;
    this.world = world;
    this.heartbeat = setInterval(() => {
      if (this.status !== 'connected') return;
      if (performance.now() - this.lastReceived > 12000) this.fail('Connection lost. Use Rejoin to return to the same world.');
      else this.send({ t: 'ping' });
    }, 3000);
    window.addEventListener('pagehide', () => this.dispose(), { once: true });
  }
  private change(status: ConnectionStatus, message: string): void {
    this.status = status; this.message = message; this.onChange();
  }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private fail(message: string): void {
    this.clearTimer();
    this.connection?.close(); this.pending?.close();
    this.connection = null; this.pending = null;
    this.input = { ...REST_INPUT };
    this.change('error', message);
    this.onLeave();
  }
  get connected(): boolean { return this.status === 'connected'; }
  get remoteInput(): GrandpaInput {
    return performance.now() - this.lastInputAt < GRANDPA.staleInputMs ? this.input : { ...REST_INPUT, yaw: this.input.yaw };
  }
  async host(): Promise<void> { await this.open(false, makeCode()); }
  join(raw: string): void {
    const code = normalizeCode(raw);
    if (!validCode(code)) { this.change('error', 'Enter the eight-character invite code from the child’s game.'); return; }
    void this.open(true, code);
  }
  private async open(guest: boolean, code: string): Promise<void> {
    this.stop(false);
    const generation = ++this.generation;
    this.code = code;
    this.change(guest ? 'connecting' : 'opening', guest ? 'Finding your grandchild’s world…' : 'Creating invite…');
    // Keep mobademo's free signaling, replacing the library's retired TURN list.
    const options = await peerOptions();
    if (generation !== this.generation) return;
    const peer = guest ? new Peer(options) : new Peer(PREFIX + code, options);
    this.peer = peer;
    this.timer = setTimeout(() => this.fail(guest ? 'Could not join. Check that the child’s game is open and the invite code is current.' : 'Could not create an invite. Check your connection and try again.'), GRANDPA.connectionTimeoutMs);
    peer.on('open', () => {
      if (generation !== this.generation) return;
      if (guest) this.wire(peer.connect(PREFIX + code, { reliable: true, metadata: { role: 'grandpa', version: GRANDPA_PROTOCOL } }), generation);
      else { this.clearTimer(); this.change('waiting', 'Share the code or link with Grandpa.'); }
    });
    peer.on('connection', conn => {
      if (guest || this.connection || this.pending) { conn.on('open', () => { conn.send({ t: 'error', message: 'Grandpa is already visiting this world.' }); setTimeout(() => conn.close(), 250); }); return; }
      this.wire(conn, generation);
    });
    peer.on('error', err => {
      if (generation !== this.generation) return;
      if (!guest && err.type === 'unavailable-id') { void this.host(); return; }
      const friendly: Record<string, string> = { 'peer-unavailable': 'That invite is no longer open. Ask the child for a new code.', 'network': 'The connection service is unavailable. Try again shortly.', 'browser-incompatible': 'This browser cannot connect. Try a current Chrome, Edge, Firefox, or Safari.' };
      this.fail(friendly[err.type] ?? 'Could not connect. Check that both games are open, then try again.');
    });
    peer.on('disconnected', () => { if (generation === this.generation && !peer.destroyed) peer.reconnect(); });
  }
  private wire(conn: DataConnection, generation: number): void {
    this.pending = conn;
    const handshake = setTimeout(() => { if (this.pending === conn) { this.pending = null; conn.close(); } }, GRANDPA.connectionTimeoutMs);
    conn.on('open', () => {
      if (generation !== this.generation) { conn.close(); return; }
      conn.send({ t: 'hello', version: GRANDPA_PROTOCOL, seed: WORLD_SEED, role: this.guest ? 'grandpa' : 'child' });
    });
    conn.on('data', raw => {
      if (generation !== this.generation || !raw || typeof raw !== 'object') return;
      const msg = raw as Record<string, unknown>;
      this.lastReceived = performance.now();
      if (msg.t === 'error') { this.fail(typeof msg.message === 'string' ? msg.message.slice(0, 200) : 'Unable to join.'); return; }
      if (msg.t === 'hello') {
        if (msg.version !== GRANDPA_PROTOCOL || msg.seed !== WORLD_SEED || msg.role !== (this.guest ? 'child' : 'grandpa')) {
          conn.send({ t: 'error', message: 'The games are different versions. Refresh both pages, then create a new invite.' });
          setTimeout(() => conn.close(), 250); return;
        }
        this.connection = conn; this.pending = null;
        clearTimeout(handshake);
        if (!this.guest) {
          this.clearTimer();
          this.onJoin();
          conn.send({ t: 'world', initial: true, world: this.world() });
          this.lastWorld = '';
          this.change('connected', 'Grandpa is here! Tag him to start a chase.');
        }
        return;
      }
      if (this.connection !== conn) return;
      if (msg.t === 'ping') { conn.send({ t: 'pong' }); return; }
      if (this.guest && msg.t === 'world') {
        let world: SaveV3 | null = null;
        try { const json = JSON.stringify(msg.world); if (json.length < 2_000_000) world = decodeSave(json); } catch { /* malformed peer packet */ }
        if (!world) { this.fail('The world could not load. Refresh both games and try again.'); return; }
        const first = !this.initialWorld;
        this.clearTimer();
        this.initialWorld = world;
        this.onWorld(world);
        this.change('connected', 'You’re Grandpa! Click the world to play.');
        if (first) this.onJoin();
      } else if (this.guest && msg.t === 'snapshot' && validSnapshot(msg.snapshot)) {
        this.latest = msg.snapshot; this.onSnapshot(msg.snapshot);
      } else if (!this.guest && msg.t === 'input') {
        const input = readGrandpaInput(msg.input);
        if (input) { this.input = input; this.lastInputAt = performance.now(); }
      }
    });
    conn.on('close', () => {
      clearTimeout(handshake);
      if (generation !== this.generation) return;
      if (this.pending === conn) this.pending = null;
      if (this.connection !== conn) return;
      this.connection = null; this.input = { ...REST_INPUT };
      this.change(this.guest ? 'disconnected' : 'waiting', this.guest ? 'The visit disconnected. Rejoin when the child’s game is ready.' : 'Grandpa left. The invite still works while this game stays open.');
      this.onLeave();
    });
    conn.on('error', () => { if (generation === this.generation) this.fail('The visit disconnected. Try joining again.'); });
  }
  sendInput(input: GrandpaInput): void { if (this.connected) this.send({ t: 'input', input }); }
  sendSnapshot(snapshot: GrandpaSnapshot): void { if (this.connected) this.send({ t: 'snapshot', snapshot }, true); }
  syncWorld(): void {
    if (!this.connected || this.guest) return;
    const world = this.world();
    // Clock, live progress, and player movement are already in snapshots.
    const key = JSON.stringify({ ...world, player: null, daylightT: null, critterPersist: null });
    if (key === this.lastWorld) return;
    this.lastWorld = key;
    this.send({ t: 'world', world });
  }
  private send(message: unknown, droppable = false): void {
    const conn = this.connection;
    if (!conn?.open || (droppable && conn.dataChannel.bufferedAmount > 32000)) return;
    try { conn.send(message); } catch { this.fail('The visit disconnected. Try joining again.'); }
  }
  stop(notify = true): void {
    ++this.generation; this.clearTimer();
    this.connection?.close(); this.pending?.close(); this.peer?.destroy();
    this.connection = null; this.pending = null; this.peer = null;
    this.input = { ...REST_INPUT }; this.initialWorld = null; this.latest = null;
    if (notify) { this.change('idle', 'Visit ended.'); this.onLeave(); }
  }
  dispose(): void { clearInterval(this.heartbeat); this.stop(false); }
}
