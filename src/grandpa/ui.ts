import { GRANDPA } from '../core/constants.ts';
import type { ChaseState, GrandpaReward, GrandpaState } from './core.ts';
import { displayCode, inviteLink, type GrandpaNetwork } from './network.ts';
import './style.css';

function button(label: string, action: () => void, className = ''): HTMLButtonElement {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = className; b.onclick = action; return b;
}
export class GrandpaUI {
  readonly root = document.createElement('div');
  readonly panel = document.createElement('div');
  readonly launch: HTMLButtonElement;
  readonly meter = document.createElement('div');
  readonly controls = document.createElement('div');
  readonly status = document.createElement('p');
  readonly codeInput = document.createElement('input');
  readonly joinButton: HTMLButtonElement;
  private room = document.createElement('div');
  private inviteActions = document.createElement('div');
  private rewardBox = document.createElement('div');
  private progress = document.createElement('div');
  private meterText = document.createElement('span');
  private stamina = document.createElement('div');
  private actionText = document.createElement('div');
  private opened = false;
  private reward: GrandpaReward = { caught: false, statue: null };
  onPlace: () => void = () => {};
  onToggle: () => void = () => {};
  onRejoin: () => void = () => {};
  private booted = false;

  constructor(readonly net: GrandpaNetwork) {
    this.root.className = `gp-ui ${net.guest ? 'gp-guest' : 'gp-host'}`;
    this.panel.className = 'gp-overlay';
    this.panel.setAttribute('role', 'dialog'); this.panel.setAttribute('aria-modal', 'true'); this.panel.setAttribute('aria-label', net.guest ? 'Join as Grandpa' : 'Invite Grandpa');
    const card = document.createElement('section'); card.className = 'gp-card';
    const eyebrow = document.createElement('div'); eyebrow.className = 'gp-eyebrow'; eyebrow.textContent = 'WILDTAG · A FAMILY VISIT';
    const title = document.createElement('h1'); title.textContent = net.guest ? 'Grandpa Featherfoot' : 'Here comes Grandpa';
    const intro = document.createElement('p'); intro.className = 'gp-intro';
    intro.textContent = net.guest ? 'Big legs. Tiny wings. Absolutely no intention of behaving.' : 'Invite Grandpa into your world. Land a tracker dart to start the chase.';
    this.status.className = 'gp-status'; this.status.setAttribute('role', 'status');
    card.append(eyebrow, title, intro);
    this.codeInput.placeholder = 'ABCD-EFGH'; this.codeInput.maxLength = 12; this.codeInput.autocomplete = 'off'; this.codeInput.spellcheck = false;
    this.codeInput.setAttribute('aria-label', 'Invite code'); this.codeInput.className = 'gp-code-input';
    this.codeInput.value = new URLSearchParams(location.hash.slice(1)).get('join') ?? '';
    this.joinButton = button('Join their world', () => { if (this.booted) this.onRejoin(); else net.join(this.codeInput.value); }, 'gp-primary');
    this.codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.joinButton.click(); } });
    if (net.guest) {
      const label = document.createElement('label'); label.textContent = 'YOUR INVITE CODE'; label.className = 'gp-label'; label.append(this.codeInput);
      card.append(label, this.joinButton);
      const how = document.createElement('div'); how.className = 'gp-how';
      how.innerHTML = '<div><kbd>Space</kbd><span><b>Accordion Vault</b>Hold to crouch. Release to leap. Tap just before landing to rebound.</span></div><div><kbd>Shift</kbd><span><b>Turkey Drift</b>Hold and steer with the mouse. Release to burst out of a turn.</span></div><div><kbd>Q</kbd><span><b>Sneeze Launch</b>Aim your face. The sneeze throws you backward and leaves an updraft.</span></div><p>WASD to waddle · Mouse to look · Hold RMB to look behind · Esc for this menu</p>';
      card.append(how);
    } else {
      this.room.className = 'gp-room';
      this.inviteActions.className = 'gp-actions';
      this.inviteActions.append(button('Copy invite link', () => { void this.copy(inviteLink(net.code)); }), button('Copy code', () => { void this.copy(displayCode(net.code)); }));
      card.append(button('Create invite', () => { void net.host(); }, 'gp-primary gp-create'), this.room, this.inviteActions);
      this.rewardBox.className = 'gp-reward'; card.append(this.rewardBox);
    }
    card.append(this.status);
    const actions = document.createElement('div'); actions.className = 'gp-actions gp-bottom';
    actions.append(button(net.guest ? 'Back to the visit' : 'Back to the world', () => this.close(), 'gp-resume'));
    actions.append(button(net.guest ? 'Leave visit' : 'End visit', () => { net.stop(); if (net.guest) location.href = new URL('grandpa.html', location.href).href; }, 'gp-end'));
    card.append(actions); this.panel.append(card); this.root.append(this.panel);
    this.launch = button(net.guest ? 'Esc · Visit menu' : 'Invite Grandpa', () => this.toggle(), 'gp-launch');
    this.launch.setAttribute('aria-label', net.guest ? 'Open Grandpa visit menu' : 'Invite Grandpa');
    this.meter.className = 'gp-tracking';
    const track = document.createElement('div'); track.className = 'gp-track'; this.progress.className = 'gp-progress'; track.append(this.progress);
    this.meter.append(this.meterText, track);
    this.controls.className = 'gp-controls';
    const energy = document.createElement('div'); energy.className = 'gp-energy'; this.stamina.className = 'gp-energy-fill'; energy.append(this.stamina);
    this.controls.innerHTML = '<div class="gp-control-keys"><span><kbd>Space</kbd> Vault</span><span><kbd>Shift</kbd> Drift</span><span><kbd>Q</kbd> Sneeze</span></div>';
    this.actionText.className = 'gp-action-text'; this.controls.append(energy, this.actionText);
    this.root.append(this.launch, this.meter, this.controls); document.body.append(this.root);
    net.onChange = () => this.refresh();
    this.opened = net.guest; this.refresh();
  }
  private async copy(text: string): Promise<void> {
    try { await navigator.clipboard.writeText(text); this.status.textContent = 'Copied! Send it to Grandpa.'; }
    catch { this.status.textContent = 'Select and copy the invite code above.'; const range = document.createRange(); range.selectNodeContents(this.room); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); }
  }
  get isOpen(): boolean { return this.opened; }
  ready(): void { this.booted = true; this.close(false); }
  open(): void { this.opened = true; document.exitPointerLock?.(); this.onToggle(); this.refresh(); this.codeInput.focus(); }
  close(lock = true): void {
    if (this.net.guest && !this.booted) return;
    this.opened = false; this.onToggle(); this.refresh();
    if (lock) void (document.getElementById('game') as HTMLCanvasElement)?.requestPointerLock()?.catch(() => {});
  }
  toggle(): void { if (this.opened) this.close(); else this.open(); }
  setReward(reward: GrandpaReward): void { this.reward = reward; this.refreshReward(); }
  private refreshReward(): void {
    this.rewardBox.replaceChildren();
    if (!this.reward.caught || this.net.guest) return;
    const text = document.createElement('p'); text.textContent = 'You caught Grandpa! Your statue belongs in this world.';
    this.rewardBox.append(text, button(this.reward.statue ? 'Move Grandpa statue' : 'Place Grandpa statue', () => { this.close(); this.onPlace(); }, 'gp-primary'));
  }
  refresh(): void {
    this.status.textContent = this.net.message || (this.net.guest ? 'Enter the code from your grandchild’s game.' : 'Your first catch earns a little Grandpa statue.');
    if (this.net.guest && this.booted && !this.net.connected) this.opened = true;
    this.panel.hidden = !this.opened;
    this.launch.hidden = this.net.guest && !this.booted;
    this.room.textContent = this.net.code ? displayCode(this.net.code) : '';
    const hasInvite = !this.net.guest && ['waiting', 'connected'].includes(this.net.status);
    this.room.hidden = !hasInvite; this.inviteActions.hidden = !hasInvite;
    const create = this.panel.querySelector<HTMLButtonElement>('.gp-create');
    if (create) { create.hidden = hasInvite; create.disabled = this.net.status === 'opening'; }
    this.joinButton.disabled = this.net.status === 'connecting';
    this.joinButton.textContent = this.booted ? 'Rejoin their world' : this.net.status === 'connecting' ? 'Joining…' : 'Join their world';
    this.joinButton.hidden = this.net.guest && this.booted && this.net.connected;
    this.codeInput.readOnly = this.booted;
    const resume = this.panel.querySelector<HTMLButtonElement>('.gp-resume'); if (resume) resume.hidden = this.net.guest && !this.booted;
    const end = this.panel.querySelector<HTMLButtonElement>('.gp-end'); if (end) end.hidden = !this.net.peer;
    this.refreshReward();
  }
  update(s: GrandpaState | null, chase: ChaseState, distance: number, connected: boolean, paused: boolean): void {
    this.meter.hidden = !connected || this.opened;
    this.controls.hidden = !this.net.guest || !connected || this.opened;
    if (!s) return;
    const distanceText = `${Math.round(distance)} m`;
    this.meterText.textContent = paused ? 'Visit paused' : chase.phase === 'caught' ? 'Caught you, Grandpa!' : chase.phase === 'tracking' ? `${this.net.guest ? 'They’re tracking you' : 'Tracking Grandpa'} · ${Math.round(chase.progress * 100)}% · ${distanceText}` : this.net.guest ? `Make an entrance · Your grandchild is ${distanceText} away` : `Grandpa is here · ${distanceText} · Tag him to start`;
    this.progress.style.width = `${chase.progress * 100}%`;
    this.meter.dataset.close = String(distance <= GRANDPA.trackRadius);
    this.stamina.style.width = `${s.energy}%`;
    this.actionText.textContent = s.sneezeWindup > 0 ? 'Ah… ah… aim your sneeze!' : s.charge > 0 ? `Vault charged ${Math.round(s.charge / GRANDPA.vaultCharge * 100)}% · Release Space` : s.drifting ? 'Carve your turn · Release Shift for a burst' : s.recovery > 0 ? 'Finding your feet…' : s.sneezeCooldown > 0 ? `Sneeze ready in ${s.sneezeCooldown.toFixed(1)}s · Feet on the ground restore energy` : 'Sneeze ready · Feet on the ground restore energy';
  }
}
