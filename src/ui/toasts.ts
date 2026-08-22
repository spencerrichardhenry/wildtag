// ---------------------------------------------------------------------------
// Bottom-centre toast queue (Task 10): plain-DOM notifications that stack and
// auto-fade — used for "Linked <Critter>! +N sparks +M RP". A single injected
// <style> block and one container appended to #hud on first use. Kept in its
// own module (not screens.ts) to minimise merge surface with parallel work.
// No-op under any non-DOM environment (tests).
// ---------------------------------------------------------------------------

let container: HTMLDivElement | null = null;
let stylesInjected = false;

function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .wt-toasts {
      position: fixed;
      left: 50%;
      bottom: 48px;
      transform: translateX(-50%);
      z-index: 15;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      pointer-events: none;
    }
    .wt-toast {
      font: 600 13.5px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      color: #eef6fa;
      background: rgba(18, 25, 32, 0.82);
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 10px;
      padding: 9px 16px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 0.25s ease, transform 0.25s ease;
      white-space: nowrap;
    }
    .wt-toast.wt-toast-in {
      opacity: 1;
      transform: translateY(0);
    }
  `;
  document.head.appendChild(style);
}

function ensureContainer(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  if (container) return container;
  injectStyles();
  const host = document.getElementById('hud') ?? document.body;
  container = document.createElement('div');
  container.className = 'wt-toasts';
  host.appendChild(container);
  return container;
}

/** Show `msg` bottom-centre; it fades in, holds, then fades out and is removed. */
export function toast(msg: string, holdMs = 2600): void {
  const box = ensureContainer();
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'wt-toast';
  el.textContent = msg;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('wt-toast-in'));
  setTimeout(() => {
    el.classList.remove('wt-toast-in');
    setTimeout(() => el.remove(), 300);
  }, holdMs);
}
