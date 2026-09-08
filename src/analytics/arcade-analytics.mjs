/** Small, dependency-free tracker. No cookies, fingerprints, key logs or player profiles. */
export function createAnalytics({ game, endpoint, isPlaying, idleMs = 120000, sessionGapMs = 1800000 }) {
  const storageKey = `arcade-session-v1:${game}`, preferenceKey = 'arcade-analytics-disabled';
  let session = null, queue = [], pendingMs = 0, interacted = false, lastInput = -Infinity;
  let previous = performance.now(), wasPlaying = false, inFlight = false, retryAt = 0, stopped = false;
  const held = new Set(), removers = [];
  const read = () => { try { return JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { return null; } };
  const saved = read();
  if (saved?.session && typeof saved.session.id === 'string') session = saved.session;
  if (Array.isArray(saved?.queue)) queue = saved.queue.filter(e => validAge(e));
  function validAge(e) { return e && Number.isFinite(e.at) && Date.now() - e.at < 300000 && e.at <= Date.now() + 60000; }
  function disabled() {
    if (!endpoint || navigator.webdriver || navigator.globalPrivacyControl || navigator.doNotTrack === '1') return true;
    try { return localStorage.getItem(preferenceKey) === '1'; } catch { return false; }
  }
  function persist() { try { sessionStorage.setItem(storageKey, JSON.stringify({ session, queue })); } catch { /* Storage is optional. */ } }
  function enqueue(ms) {
    if (!session) return;
    queue.push({ id: crypto.randomUUID(), session: session.id, ms, at: Date.now() });
    queue = queue.filter(validAge).slice(-24); persist();
  }
  function collect() {
    const ms = Math.floor(pendingMs);
    if (ms > 0) { pendingMs -= ms; enqueue(ms); }
  }
  function ensureSession() {
    if (!session || Date.now() - session.lastActive > sessionGapMs) {
      collect(); session = { id: crypto.randomUUID(), lastActive: Date.now() }; enqueue(0);
    }
    session.lastActive = Date.now();
  }
  function sample() {
    if (stopped) return;
    const now = performance.now(), elapsed = Math.max(0, Math.min(2000, now - previous));
    if (disabled()) {
      queue = []; session = null; pendingMs = 0; wasPlaying = false; previous = now;
      try { sessionStorage.removeItem(storageKey); } catch { /* Optional storage. */ }
      return;
    }
    const visible = !document.hidden && document.hasFocus();
    if (visible && held.size) lastInput = now;
    let gamePlaying = false;
    try { gamePlaying = !!isPlaying(); } catch { /* A game that has not finished booting isn't playing. */ }
    const active = visible && interacted && gamePlaying && now - lastInput < idleMs;
    if (wasPlaying && session) {
      const untilIdle = Math.max(0, lastInput + idleMs - previous);
      pendingMs += Math.min(elapsed, untilIdle);
    }
    if (active) ensureSession();
    if (pendingMs >= 20000 || wasPlaying && !active) collect();
    wasPlaying = active; previous = now;
    if (queue.length) void flush();
  }
  function batch() {
    queue = queue.filter(validAge);
    if (!queue.length) return null;
    const first = queue[0].session, events = queue.filter(e => e.session === first).slice(0, 12);
    return { ids: new Set(events.map(e => e.id)), body: JSON.stringify({ game, session: first,
      events: events.map(({ id, ms, at }) => ({ id, ms, at })) }) };
  }
  async function flush() {
    if (inFlight || disabled() || Date.now() < retryAt || stopped) return;
    const packet = batch(); if (!packet) return;
    inFlight = true;
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: packet.body, credentials: 'omit', keepalive: true, signal: AbortSignal.timeout(10000) });
      if (response.ok || response.status === 400) {
        queue = queue.filter(e => !packet.ids.has(e.id)); persist(); retryAt = 0;
      } else retryAt = Date.now() + 60000;
    } catch { retryAt = Date.now() + 20000; }
    finally { inFlight = false; }
  }
  function activity(event) {
    if (!event.isTrusted) return;
    if (event.target instanceof Element && event.target.closest('[data-analytics-ignore]')) return;
    sample(); interacted = true; lastInput = performance.now();
    sample();
  }
  function leaving() {
    sample(); collect(); held.clear(); wasPlaying = false; persist();
    if (disabled()) return;
    const packet = batch();
    if (packet && navigator.sendBeacon) {
      try { navigator.sendBeacon(endpoint, new Blob([packet.body], { type: 'text/plain' })); } catch { /* Retry on return. */ }
    }
  }
  function on(target, event, handler, options) {
    target.addEventListener(event, handler, options); removers.push(() => target.removeEventListener(event, handler, options));
  }
  on(window, 'pointerdown', e => { activity(e); if (e.isTrusted) held.add(`p${e.pointerId}`); }, { passive: true });
  on(window, 'pointerup', e => { activity(e); held.delete(`p${e.pointerId}`); }, { passive: true });
  on(window, 'pointercancel', e => held.delete(`p${e.pointerId}`), { passive: true });
  on(window, 'keydown', e => { activity(e); if (e.isTrusted) held.add(`k${e.code}`); }, { passive: true });
  on(window, 'keyup', e => { activity(e); held.delete(`k${e.code}`); }, { passive: true });
  on(window, 'wheel', activity, { passive: true });
  on(window, 'blur', leaving);
  on(window, 'pagehide', leaving);
  on(document, 'visibilitychange', () => { if (document.hidden) leaving(); else { previous = performance.now(); void flush(); } });
  on(window, 'pageshow', () => { previous = performance.now(); retryAt = 0; void flush(); });
  on(window, 'storage', e => { if (e.key === preferenceKey) sample(); });
  const timer = setInterval(sample, 1000);
  return {
    flush() { sample(); collect(); return flush(); },
    stop() { leaving(); stopped = true; clearInterval(timer); removers.forEach(remove => remove()); },
  };
}

/** A discoverable privacy link on title/pause screens, without covering active play. */
export function installPrivacyNotice(isPlaying) {
  if (document.getElementById('arcade-analytics-privacy')) return;
  const link=document.createElement('a');link.id='arcade-analytics-privacy';link.dataset.analyticsIgnore='true';
  link.href='https://spencerrichardhenry.github.io/privacy/';link.target='_blank';link.rel='noopener';
  link.textContent='Playtime analytics · Privacy';
  link.style.cssText='position:fixed;bottom:max(6px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);z-index:10000;white-space:nowrap;padding:6px 11px;border-radius:12px;background:#243532eb;color:#fffdf6;font:11px/1.3 system-ui,sans-serif;text-decoration:underline;letter-spacing:0;pointer-events:auto';
  document.body.append(link);
  let played=false;
  const interact=event=>{if(event.isTrusted&&!(event.target instanceof Element&&event.target.closest('[data-analytics-ignore]')))played=true;};
  addEventListener('pointerdown',interact,{passive:true});addEventListener('keydown',interact,{passive:true});
  setInterval(()=>{try{link.hidden=played&&isPlaying();}catch{link.hidden=false;}},500);
}
