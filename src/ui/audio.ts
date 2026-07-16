// ---------------------------------------------------------------------------
// Tiny WebAudio helper (Task 10): synthesised blips only, no assets. Used for
// the dart throw/hit ticks and the Link chime. The AudioContext is created
// lazily on first use (browsers require a user gesture before audio, which the
// pointer-lock click satisfies) and every call is guarded so this is a no-op
// under test / any non-DOM environment.
// ---------------------------------------------------------------------------

type Ctx = AudioContext;

let ctx: Ctx | null = null;
let unavailable = false;

function context(): Ctx | null {
  if (unavailable) return null;
  if (ctx) return ctx;
  const Ctor =
    typeof window !== 'undefined'
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext)
      : undefined;
  if (!Ctor) {
    unavailable = true;
    return null;
  }
  ctx = new Ctor();
  return ctx;
}

/** Play a short sine blip at `freq` Hz for `dur` seconds (no-op if no audio). */
export function blip(freq: number, dur: number, gain = 0.08): void {
  const ac = context();
  if (!ac) return;
  const now = ac.currentTime;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(gain, now);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(amp).connect(ac.destination);
  osc.start(now);
  osc.stop(now + dur);
}

/** Two rising blips — the "critter Linked" reward chime. */
export function chime(): void {
  blip(660, 0.12);
  setTimeout(() => blip(990, 0.16), 110);
}
