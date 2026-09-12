import type { PeerOptions } from 'peerjs';

/** PeerJS still provides free signaling; its former free TURN relays are retired. */
const DEFAULT_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
export function parseIceServers(value: unknown): RTCIceServer[] {
  const list = Array.isArray(value) ? value : (value as { iceServers?: unknown } | null)?.iceServers;
  if (!Array.isArray(list) || list.length > 20) return [];
  return list.flatMap(raw => {
    if (!raw || typeof raw !== 'object') return [];
    const s = raw as RTCIceServer;
    const urls = typeof s.urls === 'string' ? [s.urls] : s.urls;
    if (!Array.isArray(urls) || urls.length > 12 || !urls.every(u => typeof u === 'string' && /^(stun|stuns|turn|turns):[^\s]+$/.test(u))) return [];
    return [{ urls, ...(typeof s.username === 'string' ? { username: s.username } : {}), ...(typeof s.credential === 'string' ? { credential: s.credential } : {}) }];
  });
}
export async function peerOptions(): Promise<PeerOptions> {
  const endpoint = import.meta.env.VITE_GRANDPA_ICE_ENDPOINT as string | undefined;
  let relays: RTCIceServer[] = [];
  if (endpoint) {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000), credentials: 'same-origin' });
      if (!response.ok) throw new Error('Relay service unavailable');
      relays = parseIceServers(await response.json());
    } catch { console.warn('[grandpa] Relay credentials unavailable; trying a direct connection.'); }
  }
  return { config: { iceServers: [...DEFAULT_ICE, ...relays] } };
}
