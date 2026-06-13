// Generates self-contained HTML previews of ChatHP's UI surfaces into
// design-sync/, for upload to a claude.ai/design design-system project.
// Previews inline the REAL production CSS (pill.css / meter.css /
// popup.css) so the design project can't drift from shipped styles.
// Usage: node scripts/build-design-previews.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'design-sync');

const pillCss = readFileSync(join(root, 'src/content/ui/pill.css'), 'utf8');
const meterCss = readFileSync(join(root, 'src/content/ui/meter.css'), 'utf8');
const popupCss = readFileSync(join(root, 'src/popup/popup.css'), 'utf8');

const page = (card, title, css, body, extraCss = '') => `<!-- @dsCard ${card} -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>ChatHP — ${title}</title>
<style>
${css}
body { margin: 0; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 0;
  font-family: ui-sans-serif, system-ui, sans-serif; }
.surface { flex: 1 1 260px; min-height: 100%; padding: 24px;
  display: flex; flex-direction: column; align-items: center; gap: 18px; box-sizing: border-box; }
.surface.dark { background: #262624; }
.surface.light { background: #faf9f5; }
.caption { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
.dark .caption { color: #9aa1ad; }
.light .caption { color: #5c6470; }
${extraCss}
</style>
</head>
<body>
${body}
</body>
</html>
`;

// ---- shared markup builders ------------------------------------------------

const pill = (state, pct, opts = {}) => `
<div class="root${opts.streaming ? ' streaming' : ''}" data-state="${state}" data-theme="${opts.theme ?? 'dark'}">
  <button class="pill"><span class="hp-ico">&#10084;</span><span class="hpbar"><span class="fill" style="width:${100 - pct}%"></span></span><span class="pct">${pct}%</span></button>
</div>`;

const panel = (theme) => `
<div class="root" data-state="heavy" data-theme="${theme}">
  <div class="panel">
    <div class="panel-head"><span class="title">ChatHP</span><span class="badge">Heavy</span></div>
    <div class="hpbar large"><div class="fill" style="width:18%"></div></div>
    <div class="rows">
      <div class="row"><span>Context used</span><b class="v-pct">~71%</b></div>
      <div class="row"><span>Adjusted load</span><b class="v-adj">~82%</b></div>
      <div class="row"><span>Est. tokens</span><b class="v-tokens">~142k / 200k</b></div>
      <div class="row"><span>Messages</span><b class="v-msgs">142</b></div>
      <div class="row"><span>Duplicates</span><b class="v-dup warn">~9.2k tok · 3×</b></div>
      <div class="row"><span>Watching</span><b class="v-age">2h 14m (this tab)</b></div>
    </div>
    <div class="handoff-box"><button class="hbtn primary">Generate handoff</button></div>
    <div class="foot">Estimates only · 100% local</div>
  </div>
</div>`;

const handoffPanel = (theme, inner) => `
<div class="root" data-state="healthy" data-theme="${theme}">
  <div class="panel"><div class="handoff-box">${inner}</div></div>
</div>`;

const HANDOFF_STATES = {
  idle: `<button class="hbtn primary">Generate handoff</button>`,
  'confirm-replace': `
    <div class="hnote">The chat input already has a draft.</div>
    <div class="hrow"><button class="hbtn">Replace it</button><button class="hbtn">Keep it</button></div>`,
  armed: `
    <div class="hnote">Handoff prompt placed in the chat input — review it and press <b>send</b>. ChatHP never sends for you.</div>
    <button class="hbtn">Cancel</button>`,
  capturing: `
    <div class="hnote hwait">Waiting for the summary to finish&hellip;</div>
    <button class="hbtn">Cancel</button>`,
  done: `
    <div class="hratio">~182k &rarr; ~2.1k tokens &middot; 98.8% compressed</div>
    <div class="hpreview">=== HANDOFF SUMMARY ===
**Goal** — Build a local job-application autofill tool for Mac (8GB) as a browser extension + FastAPI backend.
**Decisions** — Ollama qwen2.5:3b; profile.yaml as source of truth; SQLite logging; three-tier field mapping.
**Open threads** — profile.yaml schema design is the immediate next step.</div>
    <div class="hrow">
      <button class="hbtn primary">Copy</button>
      <button class="hbtn">New chat</button>
      <button class="hbtn hx">&#10005;</button>
    </div>`,
};

const hint = (theme) => `
<div class="root" data-state="fresh" data-theme="${theme}">
  <div class="hint">
    <div class="hint-text">ChatHP tracks this chat's context health. Click the pill for details, drag it to move it. <b>100% local.</b></div>
    <button class="hbtn hint-ok">Got it</button>
  </div>
</div>`;

const chip = (theme, text, big) => `
<div class="meter" data-theme="${theme}">
  <div class="chip${big ? ' big' : ''}"><span class="glyph">&#9998;</span><span class="chip-text">${text}</span></div>
</div>`;

const audit = (theme, variant) => `
<div class="meter" data-theme="${theme}">
  <div class="audit">${
    variant === 'cleanups'
      ? `
    <div class="audit-title">Large paste: ~1.4k tokens</div>
    <div class="audit-sub">&asymp;0.7% of context &middot; optional local cleanups (whole draft):</div>
    <button class="abtn">Trim trailing spaces<span class="save">&minus;~89 tok</span></button>
    <button class="abtn">Collapse blank lines<span class="save">&minus;~16 tok</span></button>
    <button class="abtn">Strip line numbers<span class="save">&minus;~179 tok</span></button>
    <button class="abtn dismiss">Dismiss</button>`
      : `
    <div class="audit-title">Large paste: ~1.4k tokens</div>
    <div class="audit-sub">&asymp;0.7% of context. It was attached as a file, so it still costs this much when sent &mdash; text cleanups don't apply to attachments.</div>
    <button class="abtn dismiss">Dismiss</button>`
  }</div>
</div>`;

const sw = (name, hex, on) => `
<div class="swatch"><div class="chip-color" style="background:${hex}"></div>
  <div class="sw-name" style="color:${on}">${name}</div>
  <div class="sw-hex" style="color:${on}">${hex}</div></div>`;

// ---- pages -----------------------------------------------------------------

mkdirSync(join(OUT, 'foundations'), { recursive: true });
mkdirSync(join(OUT, 'components'), { recursive: true });

writeFileSync(
  join(OUT, 'foundations/colors.html'),
  page(
    'group="Foundations"',
    'Color tokens',
    '',
    `
<div class="surface dark"><div class="caption">Health states (both themes)</div>
  <div class="grid">
    ${sw('--hp fresh', '#34d399', '#e7e9ee')}${sw('--hp healthy', '#a3e635', '#e7e9ee')}
    ${sw('--hp heavy', '#f59e0b', '#e7e9ee')}${sw('--hp critical', '#ef4444', '#e7e9ee')}
    ${sw('warn accents', '#f59e0b', '#e7e9ee')}
  </div>
  <div class="caption">Dark surface</div>
  <div class="grid">
    ${sw('--bg', 'rgba(22,24,28,.92)', '#e7e9ee')}${sw('--fg', '#e7e9ee', '#e7e9ee')}
    ${sw('--muted', '#9aa1ad', '#e7e9ee')}${sw('--border', 'rgba(255,255,255,.12)', '#e7e9ee')}
  </div>
</div>
<div class="surface light"><div class="caption">Light surface</div>
  <div class="grid">
    ${sw('--bg', 'rgba(255,255,255,.96)', '#1c1f24')}${sw('--fg', '#1c1f24', '#1c1f24')}
    ${sw('--muted', '#5c6470', '#1c1f24')}${sw('--border', 'rgba(0,0,0,.12)', '#1c1f24')}
  </div>
  <div class="caption">Type</div>
  <div style="color:#1c1f24;font:12px/1.35 ui-sans-serif,system-ui,sans-serif">
    UI text 12px &middot; chips 11px &middot; footers 10.5px<br/>
    <b style="font-variant-numeric:tabular-nums">tabular numerals 0123456789</b>
  </div>
</div>`,
    `.grid { display:flex; flex-wrap:wrap; gap:12px; justify-content:center; }
.swatch { width:104px; text-align:center; font-size:11px; }
.chip-color { height:44px; border-radius:10px; border:1px solid rgba(127,127,127,.35); }
.sw-name { margin-top:5px; font-weight:600; } .sw-hex { opacity:.7; }`
  )
);

const pillRow = (theme) =>
  `<div class="caption">${theme} · fresh / healthy / heavy / critical / streaming</div>` +
  pill('fresh', 12, { theme }) +
  pill('healthy', 55, { theme }) +
  pill('heavy', 78, { theme }) +
  pill('critical', 94, { theme }) +
  pill('healthy', 57, { theme, streaming: true });

writeFileSync(
  join(OUT, 'components/pill-states.html'),
  page(
    'group="Health Pill"',
    'Pill states',
    pillCss,
    `<div class="surface dark">${pillRow('dark')}</div>
<div class="surface light">${pillRow('light')}</div>`
  )
);

writeFileSync(
  join(OUT, 'components/panel.html'),
  page(
    'group="Health Pill"',
    'Expanded panel',
    pillCss,
    `<div class="surface dark"><div class="caption">dark</div>${panel('dark')}</div>
<div class="surface light"><div class="caption">light</div>${panel('light')}</div>`
  )
);

writeFileSync(
  join(OUT, 'components/onboarding-hint.html'),
  page(
    'group="Health Pill"',
    'Onboarding hint',
    pillCss,
    `<div class="surface dark"><div class="caption">dark</div>${hint('dark')}</div>
<div class="surface light"><div class="caption">light</div>${hint('light')}</div>`
  )
);

writeFileSync(
  join(OUT, 'components/handoff-flow.html'),
  page(
    'group="Handoff"',
    'Handoff flow states',
    pillCss,
    `<div class="surface dark">${Object.entries(HANDOFF_STATES)
      .map(([k, v]) => `<div class="caption">${k}</div>${handoffPanel('dark', v)}`)
      .join('')}</div>
<div class="surface light">${Object.entries(HANDOFF_STATES)
      .map(([k, v]) => `<div class="caption">${k}</div>${handoffPanel('light', v)}`)
      .join('')}</div>`
  )
);

writeFileSync(
  join(OUT, 'components/draft-meter.html'),
  page(
    'group="Composer"',
    'Draft cost meter',
    meterCss,
    `<div class="surface dark"><div class="caption">dark · normal / over 2% budget</div>
  ${chip('dark', '~123 tok', false)}${chip('dark', '~8.2k tok · 4.1%', true)}</div>
<div class="surface light"><div class="caption">light</div>
  ${chip('light', '~123 tok', false)}${chip('light', '~8.2k tok · 4.1%', true)}</div>`
  )
);

writeFileSync(
  join(OUT, 'components/paste-audit.html'),
  page(
    'group="Composer"',
    'Paste audit card',
    meterCss,
    `<div class="surface dark"><div class="caption">inline paste · cleanups</div>${audit('dark', 'cleanups')}
  <div class="caption">attached as file</div>${audit('dark', 'attachment')}</div>
<div class="surface light"><div class="caption">light</div>${audit('light', 'cleanups')}${audit('light', 'attachment')}</div>`
  )
);

// settings popup: real popup.css, body selector rescoped so previews can
// place two instances side by side; dark forced via re-declared vars.
const popupScoped = popupCss
  .replace(/body \{/g, '.popup-body {')
  .replace(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}\s*\}/m, '.theme-dark {$1}');

writeFileSync(
  join(OUT, 'components/settings-popup.html'),
  page(
    'group="Popup"',
    'Settings popup',
    popupScoped,
    `
<div class="surface light"><div class="caption">light</div><div class="popup-body">${popupMarkup()}</div></div>
<div class="surface dark"><div class="caption">dark</div><div class="popup-body theme-dark">${popupMarkup()}</div></div>`,
    `.popup-body { border: 1px solid rgba(127,127,127,.3); border-radius: 10px; overflow: hidden; }
.theme-dark { background: #16181c; color: #e7e9ee; }`
  )
);

function popupMarkup() {
  return `
<main>
  <header><h1>ChatHP</h1><span class="ver">v0.2.0</span></header>
  <section><h2>Sites</h2>
    <label class="row"><span>claude.ai</span><input type="checkbox" checked /></label>
    <label class="row"><span>chatgpt.com</span><input type="checkbox" checked /></label></section>
  <section><h2>Features</h2>
    <label class="row"><span>Handoff generator</span><input type="checkbox" checked /></label>
    <label class="row"><span>Draft cost meter</span><input type="checkbox" checked /></label>
    <label class="row"><span>Paste auditor</span><input type="checkbox" checked /></label></section>
  <section><h2>Estimates</h2>
    <label class="row"><span>Context budget <small>tokens</small></span><input type="number" value="200000" /></label>
    <label class="row"><span>Characters per token</span><input type="number" value="3.7" /></label>
    <label class="row"><span>Audit pastes over <small>tokens</small></span><input type="number" value="1000" /></label></section>
  <section><h2>Health thresholds <small>% of context used</small></h2>
    <div class="thresholds">
      <label>Healthy &ge; <input type="number" value="40" /></label>
      <label>Heavy &ge; <input type="number" value="70" /></label>
      <label>Critical &ge; <input type="number" value="90" /></label></div></section>
  <footer><button id="reset" type="button">Reset defaults</button><span id="status">Saved ✓</span></footer>
  <div class="privacy">Estimates only &middot; 100% local &middot; nothing leaves your browser</div>
</main>`;
}

console.log('previews written to design-sync/');
