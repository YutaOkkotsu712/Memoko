import {
  budgetFor,
  DEFAULT_SETTINGS,
  loadAdapterHealth,
  loadSettings,
  saveSettings,
  type AdapterHealth,
  type Settings,
} from '../core/settings';

const $ = (id: string): HTMLInputElement => {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement)) throw new Error(`chathp popup: #${id}`);
  return el;
};

const statusEl = document.getElementById('status')!;
let statusTimer: ReturnType<typeof setTimeout> | null = null;

function flash(text: string): void {
  statusEl.textContent = text;
  if (statusTimer !== null) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusEl.textContent = '';
  }, 1200);
}

function populate(s: Settings): void {
  $('site-claude').checked = s.sites['claude'] !== false;
  $('site-chatgpt').checked = s.sites['chatgpt'] !== false;
  $('feat-handoff').checked = s.features.handoff;
  $('feat-meter').checked = s.features.draftMeter;
  $('feat-audit').checked = s.features.pasteAudit;
  $('feat-bubbles').checked = s.features.bubbles;
  $('feat-badge').checked = s.features.badge;
  $('feat-autobudget').checked = s.features.autoBudget;
  $('feat-precise').checked = s.features.preciseTokens;
  $('budget-claude').value = String(budgetFor(s, 'claude'));
  $('budget-chatgpt').value = String(budgetFor(s, 'chatgpt'));
  $('cpt').value = String(s.charsPerToken);
  $('audit-min').value = String(s.pasteAuditMinTokens);
  $('t-healthy').value = String(s.thresholds.healthy);
  $('t-heavy').value = String(s.thresholds.heavy);
  $('t-critical').value = String(s.thresholds.critical);
}

function num(input: HTMLInputElement, fallback: number, min: number, max: number): number {
  const v = Number(input.value);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function collect(): Settings {
  const d = DEFAULT_SETTINGS;
  // thresholds are sorted so the three states always stay in order no
  // matter what was typed
  const [healthy, heavy, critical] = [
    num($('t-healthy'), d.thresholds.healthy, 1, 100),
    num($('t-heavy'), d.thresholds.heavy, 1, 100),
    num($('t-critical'), d.thresholds.critical, 1, 100),
  ].sort((a, b) => a - b) as [number, number, number];

  return {
    budgets: {
      claude: Math.round(num($('budget-claude'), budgetFor(d, 'claude'), 1000, 100_000_000)),
      chatgpt: Math.round(num($('budget-chatgpt'), budgetFor(d, 'chatgpt'), 1000, 100_000_000)),
    },
    charsPerToken: num($('cpt'), d.charsPerToken, 1, 10),
    thresholds: { healthy, heavy, critical },
    sites: {
      claude: $('site-claude').checked,
      chatgpt: $('site-chatgpt').checked,
    },
    draftMinTokens: d.draftMinTokens,
    pasteAuditMinTokens: Math.round(num($('audit-min'), d.pasteAuditMinTokens, 50, 1_000_000)),
    features: {
      handoff: $('feat-handoff').checked,
      draftMeter: $('feat-meter').checked,
      pasteAudit: $('feat-audit').checked,
      bubbles: $('feat-bubbles').checked,
      badge: $('feat-badge').checked,
      autoBudget: $('feat-autobudget').checked,
      preciseTokens: $('feat-precise').checked,
    },
  };
}

async function save(): Promise<void> {
  await saveSettings(collect());
  flash('Saved ✓');
}

function describeHealth(id: string, health: AdapterHealth | null): void {
  const el = document.getElementById(`health-${id}`);
  if (!el) return;
  if (!health) {
    el.textContent = 'not checked yet — open a conversation there';
    el.className = 'sitehealth';
    return;
  }
  const mins = Math.round((Date.now() - health.at) / 60_000);
  const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
  if (health.status === 'ok') {
    const model =
      health.model && health.budget
        ? ` · ${health.model} (${Math.round(health.budget / 1000)}k)`
        : '';
    el.textContent = `✓ working${model} · ${ago}`;
    el.className = 'sitehealth ok';
  } else {
    el.textContent = `⚠ loaded but found no conversation — selectors may be stale · ${ago}`;
    el.className = 'sitehealth warn';
  }
}

async function renderHealth(): Promise<void> {
  const health = await loadAdapterHealth(['claude', 'chatgpt']);
  describeHealth('claude', health['claude'] ?? null);
  describeHealth('chatgpt', health['chatgpt'] ?? null);
}

async function init(): Promise<void> {
  try {
    const ver = chrome.runtime.getManifest().version;
    const verEl = document.querySelector('.ver');
    if (verEl) verEl.textContent = `v${ver}`;
  } catch {
    // keep the hardcoded fallback
  }
  void renderHealth();
  populate(await loadSettings());
  document.addEventListener('change', () => {
    void save();
  });
  document.getElementById('reset')?.addEventListener('click', () => {
    populate(structuredClone(DEFAULT_SETTINGS));
    void save();
  });
}

void init();
