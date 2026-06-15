/**
 * Tiny self-contained UI for the indexing sweep: a top-centre chip that
 * offers "Index chat" when a virtualized conversation looks unindexed,
 * shows progress while sweeping, and lets the user cancel. Kept separate
 * from the pill (which design drops replace) so it survives, and placed
 * away from the bottom composer + bottom-right pill.
 */

import { detectDarkTheme } from './ui/theme';

export interface IndexUI {
  showPrompt(): void;
  showProgress(found: number): void;
  flash(text: string): void;
  hide(): void;
  destroy(): void;
}

interface IndexUICallbacks {
  onIndex: () => void;
  onCancel: () => void;
}

const CSS = `
.wrap {
  position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
  z-index: 2147483646; display: none;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 12px; line-height: 1.3;
}
.chip {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 12px; border-radius: 999px;
  background: var(--bg); color: var(--fg);
  border: 1px solid color-mix(in srgb, #e893a8 45%, var(--border));
  box-shadow: 0 4px 16px rgba(0,0,0,0.28);
}
.wrap[data-theme="dark"]  { --bg: rgba(22,24,28,0.94); --fg: #e7e9ee; --border: rgba(255,255,255,0.14); }
.wrap[data-theme="light"] { --bg: rgba(255,255,255,0.97); --fg: #1c1f24; --border: rgba(0,0,0,0.14); }
.btn {
  border: 1px solid color-mix(in srgb, #34d399 55%, var(--border));
  background: transparent; color: var(--fg); font: inherit; font-weight: 600;
  padding: 3px 9px; border-radius: 8px; cursor: pointer;
}
.btn:hover { background: color-mix(in srgb, var(--fg) 8%, transparent); }
.btn.x { color: var(--fg); border-color: var(--border); font-weight: 400; }
.muted { color: color-mix(in srgb, var(--fg) 60%, transparent); }
.spin {
  width: 11px; height: 11px; border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--fg) 25%, transparent);
  border-top-color: #34d399; display: inline-block;
  animation: idx-spin 0.8s linear infinite;
}
@keyframes idx-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
`;

export function createIndexUI(cb: IndexUICallbacks): IndexUI {
  const host = document.createElement('div');
  host.setAttribute('data-chathp-index', '');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>${CSS}</style><div class="wrap" data-theme="dark"><div class="chip"></div></div>`;
  const wrap = shadow.querySelector<HTMLElement>('.wrap')!;
  const chip = shadow.querySelector<HTMLElement>('.chip')!;
  document.documentElement.appendChild(host);

  let flashTimer = 0;

  const open = () => {
    wrap.dataset.theme = detectDarkTheme() ? 'dark' : 'light';
    wrap.style.display = '';
  };

  chip.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t) return;
    if (t.dataset.act === 'index') cb.onIndex();
    else if (t.dataset.act === 'cancel') cb.onCancel();
  });

  return {
    showPrompt() {
      window.clearTimeout(flashTimer);
      chip.innerHTML = `<span class="muted">Memoko: partial estimate</span><button class="btn" data-act="index">Index chat</button>`;
      open();
    },
    showProgress(found: number) {
      window.clearTimeout(flashTimer);
      const safeFound = Math.max(0, Math.round(found));
      chip.innerHTML = `<span class="spin"></span><span>Indexing&hellip; ${safeFound} messages</span><button class="btn x" data-act="cancel">Cancel</button>`;
      open();
    },
    flash(text: string) {
      chip.textContent = text;
      open();
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => {
        wrap.style.display = 'none';
      }, 2500);
    },
    hide() {
      window.clearTimeout(flashTimer);
      wrap.style.display = 'none';
    },
    destroy() {
      window.clearTimeout(flashTimer);
      host.remove();
    },
  };
}
