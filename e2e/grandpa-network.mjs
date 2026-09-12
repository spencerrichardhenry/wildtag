import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.VERIFY_URL ?? 'http://localhost:5199';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pages = [];
async function peer(guest) {
  const page = await browser.newPage(); pages.push(page);
  if (process.env.VERIFY_RELAY === '1') await page.addInitScript(() => {
    const NativePeerConnection = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeerConnection {
      constructor(config) { super({ ...config, iceTransportPolicy: 'relay' }); }
    };
  });
  await page.route('**/grandpa-network-harness.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Grandpa WebRTC verification</title>' }));
  await page.goto(`${base}/grandpa-network-harness.html`);
  await page.evaluate(async guest => {
    const { GrandpaNetwork } = await import('/src/grandpa/network.ts');
    const { createInventory } = await import('/src/craft/inventory.ts');
    const { createGrandpa, createChase } = await import('/src/grandpa/core.ts');
    const world = { v: 3, inventory: createInventory(), unlocks: ['grapple'], structures: { ziplines: [], drones: [], trampolines: [{ id: 't0', kind: 'ground', x: 5, z: 10 }] }, builds: [], player: { pos: { x: 3, y: 10, z: 4 }, yaw: 0 }, critterPersist: {}, hints: [], grandpa: { caught: true, statue: null } };
    window.n = new GrandpaNetwork(guest, () => world);
    window.snap = { grandpa: createGrandpa({ x: 10, y: 10, z: 10 }), chase: createChase(), child: { pos: world.player.pos, yaw: 0, vel: { x: 0, y: 0, z: 0 }, grapple: null, mounted: false }, critters: [], clock: 100, paused: false, darts: [] };
    window.events = []; n.onChange = () => events.push({ status: n.status, message: n.message });
  }, guest);
  return page;
}
try {
  const host = await peer(false), guest = await peer(true);
  await host.evaluate(() => n.host());
  await host.waitForFunction(() => n.status === 'waiting' || n.status === 'error', { timeout: 25000 });
  const hosting = await host.evaluate(() => ({ status: n.status, code: n.code, message: n.message }));
  assert.equal(hosting.status, 'waiting', hosting.message);
  await guest.evaluate(code => n.join(code), hosting.code);
  await guest.waitForFunction(() => n.connected || n.status === 'error', { timeout: 25000 });
  const joined = await guest.evaluate(() => ({ connected: n.connected, world: n.initialWorld, message: n.message }));
  assert(joined.connected, joined.message);
  assert.deepEqual(joined.world.unlocks, ['grapple']);
  assert.equal(joined.world.structures.trampolines.length, 1);
  await guest.evaluate(() => n.sendInput({ forward: 1, strafe: 0, yaw: .2, vault: true, drift: false, sneeze: false }));
  await host.waitForFunction(() => n.remoteInput.vault);
  await host.evaluate(() => n.sendSnapshot(snap));
  await guest.waitForFunction(() => n.latest?.clock === 100);
  assert.equal(await guest.evaluate(() => n.latest.grandpa.pos.x), 10);
  await host.waitForFunction(() => n.remoteInput.vault === false);
  const intruder = await peer(true);
  await intruder.evaluate(code => n.join(code), hosting.code);
  await intruder.waitForFunction(() => n.status === 'error' || n.status === 'disconnected', { timeout: 20000 });
  assert.equal(await guest.evaluate(() => n.connected), true, 'a second guest must not displace Grandpa');
  await guest.evaluate(() => n.stop());
  await host.waitForFunction(() => n.status === 'waiting');
  await guest.evaluate(code => n.join(code), hosting.code);
  await guest.waitForFunction(() => n.connected, { timeout: 20000 });
  const rtc = await guest.evaluate(async () => {
    const stats = await n.connection.peerConnection.getStats();
    return [...stats.values()].filter(s => s.type === 'candidate-pair' && s.state === 'succeeded').map(s => ({ state: s.state, nominated: s.nominated, localType: stats.get(s.localCandidateId)?.candidateType, remoteType: stats.get(s.remoteCandidateId)?.candidateType }));
  });
  assert(rtc.length > 0, 'a real ICE candidate pair should connect');
  if (process.env.VERIFY_RELAY === '1') assert(rtc.some(p => p.localType === 'relay'), 'forced relay should use TURN');
  console.log(JSON.stringify({ result: 'passed', transport: 'public PeerJS + real WebRTC data channel', checks: ['host code', 'join world', 'trampoline state', 'input', 'snapshot', 'stale input stops', 'one guest only', 'rejoin'], rtc }));
} catch (err) {
  for (let i = 0; i < pages.length; i++) console.error(`peer ${i}`, await pages[i].evaluate(() => window.events));
  throw err;
} finally { await browser.close(); }
