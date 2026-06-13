import cssText from './pill.css?inline';
import { STATE_LABEL, type HealthState } from '../../core/health';
import { formatTokenCount } from '../../core/tokens';
import type { PillPersist } from '../../core/settings';
import type { HandoffView } from '../handoff';
import { detectDarkTheme } from './theme';
import { MEMOKO_STATUS, faceSvg, spriteSvg, type MemokoPose } from './avatar';

export interface PillStats {
  usagePct: number;
  /** Usage plus long-conversation adjustments; drives state and bar. */
  adjustedPct: number;
  state: HealthState;
  tokens: number;
  budget: number;
  messageCount: number;
  ageMs: number;
  streaming: boolean;
  /** Estimated avoidable tokens in near-duplicate large blocks. */
  dupTokens: number;
  dupBlocks: number;
  /** One-shot speech line from Memoko; shown when present. */
  bubble?: string;
  /** Token burn over the recent window; null until there's signal. */
  burnTokensPerMin?: number | null;
  /** Forecast minutes until Critical at the current pace. */
  minutesToCritical?: number | null;
  /** Share of estimated tokens written by the user (0–100). */
  userSharePct?: number | null;
  /** Heaviest message in the conversation, if any sizable one exists. */
  heaviest?: { ordinal: number; role: string; tokens: number } | null;
}

export interface PillUI {
  update(stats: PillStats): void;
  updateHandoff(view: HandoffView, canStart: boolean, enabled: boolean): void;
  /** First-run hint bubble; onDismiss fires exactly once. */
  showOnboarding(onDismiss: () => void): void;
  /** Same as clicking the pill (keyboard shortcut path). */
  togglePanel(): void;
  /** Count one more conversation toward the lifetime "chats watched" stat.
   *  Call from the monitor when a new conversation is detected (SPA nav). The
   *  pill also auto-detects new chats heuristically, so this is optional. */
  markChatWatched(): void;
  show(): void;
  hide(): void;
  destroy(): void;
}

export interface PillCallbacks {
  onHandoffStart(): void;
  onHandoffCancel(): void;
  onOpenNewChat(): void;
  /** Duplicates row clicked — scroll to / highlight a duplicate block. */
  onShowDuplicates?(): void;
  /** Heaviest row clicked — scroll to / highlight a heavy message. */
  onJumpToHeavy?(): void;
}

interface PillOptions {
  initial: PillPersist;
  onPersist: (state: PillPersist) => void;
  callbacks: PillCallbacks;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );

const DRAG_THRESHOLD_PX = 4;

const SPRITE_SIZE = 30; // M

/** How long the entrance choreography runs (matches pill.css timings, 1.25x). */
const INTRO_TOTAL_MS = 1700;
/** When the HP number starts counting up during the entrance. */
const INTRO_COUNT_AT_MS = 1000;

const seg = (n: number): string => '<span class="seg"></span>'.repeat(n);

const BURST = [-160, -120, -85, -50, -15, 165]
  .map((a) => `<i style="--a:${a}deg"></i>`)
  .join('');

const CONFETTI = [
  [-150, 0], [-118, 0.06], [-90, 0.02], [-62, 0.09],
  [-30, 0.04], [-135, 0.12], [-75, 0.14], [-45, 0.11],
]
  .map(([a, d]) => `<i style="--a:${a}deg;--d:${d}s"></i>`)
  .join('');

function formatAge(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

// ---- idle behaviors --------------------------------------------------------
/** Idle poses, in the order she drifts through. 'sit' opens; activities are
 *  shuffled; 'yawn' then 'nap' close it out. */
type IdleStage = 'sit' | 'laptop' | 'doodle' | 'kick' | 'peek' | 'yawn' | 'nap';
const IDLE_ACTIVITIES: IdleStage[] = ['laptop', 'doodle', 'kick', 'peek'];
const IDLE_SEATED: Record<IdleStage, true> = {
  sit: true, laptop: true, doodle: true, kick: true, peek: true, yawn: true, nap: true,
};
/** Inactivity before she settles in. Tamagotchi cadence — ~2 minutes. */
const IDLE_DELAY_MS = 120_000;
const IDLE_DWELL: Record<IdleStage, number> = {
  sit: 9_000, laptop: 16_000, doodle: 13_000, kick: 8_000, peek: 7_000, yawn: 1_700, nap: 0,
};

// ---- Konami easter egg -----------------------------------------------------
const KONAMI: string[] = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a',
];
const KONAMI_CONFETTI = ['#ff5d8f', '#ffd166', '#34d399', '#5db3e8', '#b794f6', '#ffffff'];

// ---- cursor attention ------------------------------------------------------
const ATTEND_ZONE_IN = 235;
const ATTEND_ZONE_OUT = 300; // hysteresis so the boundary doesn't flicker

// ---- lifetime stats --------------------------------------------------------
/** Stored in localStorage for the demo's parity. In the extension you may
 *  prefer to route these through chrome.storage / settings.ts so they survive
 *  across origins; swap loadStats/saveStats accordingly. */
const STATS_KEY = 'memoko-stats-v1';
interface MemokoStats { chats: number; handoffs: number; saved: number; lastChatKey: string; }
function loadStats(): MemokoStats {
  try {
    const raw = JSON.parse(localStorage.getItem(STATS_KEY) || '{}');
    return { chats: raw.chats | 0, handoffs: raw.handoffs | 0, saved: raw.saved | 0, lastChatKey: raw.lastChatKey || '' };
  } catch {
    return { chats: 0, handoffs: 0, saved: 0, lastChatKey: '' };
  }
}
function saveStats(s: MemokoStats): void {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
function fmtTok(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'k';
  return String(Math.round(n));
}

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

export function createPill(opts: PillOptions): PillUI {
  const persist: PillPersist = { ...opts.initial };
  // The expanded panel never opens by itself: always start collapsed on a
  // fresh page load (position still persists). It opens only on pill click.
  persist.collapsed = true;

  const host = document.createElement('div');
  host.setAttribute('data-chathp', '');
  host.style.cssText =
    'position:fixed;z-index:2147483646;display:none;' +
    `right:${persist.right}px;bottom:${persist.bottom}px;`;

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>${cssText}</style>
    <div class="root" data-state="fresh" data-theme="dark">
      <div class="hint" role="status" hidden>
        <div class="hint-text">Memoko tracks this chat's context health.
          Click the pill for details, drag to move her. <b>100% local.</b></div>
        <button class="hbtn hint-ok">Got it</button>
      </div>
      <div class="panel" hidden>
        <div class="panel-head">
          <span class="avatar"></span>
          <span class="title">MEMOKO</span>
          <span class="badge">Fresh</span>
        </div>
        <div class="hpline" title="Health remaining — drains as context fills. Uses adjusted load when long-conversation penalties apply.">
          <span>HP</span><b class="v-hp">–</b><i>/ 100</i></div>
        <div class="segbar large">${seg(10)}</div>
        <div class="status"></div>
        <div class="rows">
          <div class="row"><span>Context used</span><i class="dots"></i><b class="v-pct">–</b></div>
          <div class="row" hidden title="Context usage plus long-conversation adjustments: turns beyond 60 and duplicate content both degrade quality before the window is full. The health state and HP use this number.">
            <span>Adjusted load</span><i class="dots"></i><b class="v-adj">–</b></div>
          <div class="row"><span>Est. tokens</span><i class="dots"></i><b class="v-tokens">–</b></div>
          <div class="row"><span>Messages</span><i class="dots"></i><b class="v-msgs">–</b></div>
          <div class="row" title="Near-duplicate large blocks in this conversation (same content appearing more than once). Estimated tokens you could save by referencing instead of re-pasting.">
            <span>Duplicates</span><i class="dots"></i><b class="v-dup">–</b></div>
          <div class="row" title="How fast this chat is eating tokens (last 10 minutes), and the time until Critical at this pace.">
            <span>Burn</span><i class="dots"></i><b class="v-burn">–</b></div>
          <div class="row" title="Share of the estimated tokens written by you vs the assistant.">
            <span>You / AI</span><i class="dots"></i><b class="v-split">–</b></div>
          <div class="row v-top-row" hidden>
            <span>Heaviest</span><i class="dots"></i><b class="v-top">–</b></div>
          <div class="row"><span>Watching</span><i class="dots"></i><b class="v-age">–</b></div>
        </div>
        <div class="handoff-box"></div>
        <div class="stats">
          <div class="stats-cap">LIFETIME</div>
          <div class="srow"><span>Chats watched</span><i class="dots"></i><b class="s-chats">0</b></div>
          <div class="srow"><span>Handoffs done</span><i class="dots"></i><b class="s-hand">0</b></div>
          <div class="srow"><span>Tokens saved</span><i class="dots"></i><b class="s-saved">~0</b></div>
          <div class="stats-hero"><span class="heart">&#9829;</span><span class="hero-text">Memoko has saved you <b class="s-hero">~0</b> tokens.</span></div>
        </div>
        <div class="foot">Estimates only &middot; 100% local</div>
      </div>
      <div class="pillspot">
        <span class="speech" role="status" hidden><span class="speech-text"></span></span>
        <span class="zzz" aria-hidden="true"><i>z</i><i>z</i><i>z</i></span>
        <span class="cap" aria-hidden="true"><span class="cap-h cap-l"></span><span class="cap-h cap-r"></span></span>
        <span class="burst" aria-hidden="true">${BURST}</span>
        <span class="cheerburst" aria-hidden="true">${CONFETTI}</span>
        <span class="sprite" aria-hidden="true"><span class="pop"><span class="trk"><span class="flip"></span></span></span></span>
        <button class="pill" title="Memoko — estimated context health"
          aria-label="Memoko context health" aria-expanded="false">
          <span class="hp-tag">HP</span>
          <span class="segs">${seg(7)}</span>
          <span class="pct">–</span>
        </button>
      </div>
    </div>
  `;

  const $ = <T extends HTMLElement>(sel: string): T => {
    const el = shadow.querySelector<T>(sel);
    if (!el) throw new Error('chathp: missing element');
    return el;
  };

  const root = $('.root');
  const panel = $('.panel');
  const pill = $<HTMLButtonElement>('.pill');
  const badge = $('.badge');
  const pct = $('.pct');
  const avatar = $('.avatar');
  const sprite = $('.sprite');
  const trk = $('.trk');
  const flip = $('.flip');
  const statusEl = $('.status');
  const vHp = $('.v-hp');
  const vPct = $('.v-pct');
  const vAdj = $('.v-adj');
  const vTokens = $('.v-tokens');
  const vMsgs = $('.v-msgs');
  const vDup = $('.v-dup');
  const vBurn = $('.v-burn');
  const vSplit = $('.v-split');
  const vTop = $('.v-top');
  const vAge = $('.v-age');
  const pillspot = $('.pillspot');
  const pillSegs = $('.segs');
  const panelSegs = $('.segbar');
  const handoffBox = $('.handoff-box');
  const hint = $('.hint');
  const speech = $('.speech');
  const speechText = $('.speech-text');
  const sChats = $('.s-chats');
  const sHand = $('.s-hand');
  const sSaved = $('.s-saved');
  const sHero = $('.s-hero');

  // The bubble rides inside .trk so the patrol transform carries it with her.
  trk.appendChild(speech);

  const reducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- speech bubble -------------------------------------------------------
  let speechTimer = 0;

  const showBubble = (text: string) => {
    speechText.textContent = text;
    speech.hidden = false;
    speech.classList.remove('pop');
    void speech.offsetWidth; // restart the pop if re-triggered
    speech.classList.add('pop');
    window.clearTimeout(speechTimer);
    speechTimer = window.setTimeout(() => {
      speech.hidden = true;
    }, 6500);
  };

  speech.addEventListener('click', (e) => {
    e.stopPropagation(); // don't also pet her
    window.clearTimeout(speechTimer);
    speech.hidden = true;
  });

  // --- avatar pose handling ------------------------------------------------
  let spritePose: MemokoPose | null = null;
  let faceState: HealthState | null = null;
  let lastState: HealthState = 'fresh';
  let lastStreaming = false;
  let celebrating = false;
  let lastHp: number | null = null;

  // behavioral state layered on top of the health state
  let idleStage: IdleStage | null = null;
  let waving = false;
  let startling = false;
  let attentive = false;
  let petting = false;
  let konamiActive = false;
  let mkTrack: HTMLElement | null = null;
  let mkEyes: HTMLElement | null = null;
  const cursor = { x: -9999, y: -9999 };

  const setSprite = (pose: MemokoPose) => {
    if (pose === spritePose) return;
    spritePose = pose;
    // Wrapped in .mk-swap so each swap plays a soft settle, not a hard cut.
    flip.innerHTML = `<span class="mk-swap">${spriteSvg(pose, SPRITE_SIZE)}</span>`;
  };

  const setFace = (state: HealthState) => {
    if (state === faceState) return;
    faceState = state;
    avatar.innerHTML = faceSvg(state, 24);
  };

  /** Pose precedence: konami/celebration > startle > wave > idle > attentive
   *  > streaming-watch > health state. */
  const syncPose = () => {
    let pose: MemokoPose;
    if (konamiActive || celebrating) pose = 'cheer';
    else if (startling) pose = 'watch';
    else if (waving) pose = 'wave';
    else if (idleStage) pose = (idleStage === 'kick' || idleStage === 'peek') ? 'sit' : idleStage;
    else if (attentive) pose = 'watch';
    else if (lastStreaming && lastState !== 'critical') pose = 'watch';
    else pose = lastState;
    setSprite(pose);
    setFace(lastState);
    root.classList.toggle('idle', !!idleStage);
    root.classList.toggle('idle-nap', idleStage === 'nap');
    root.classList.toggle('idle-kick', idleStage === 'kick');
    root.classList.toggle('idle-peek', idleStage === 'peek');
  };
  syncPose();

  // --- handoff celebration ---------------------------------------------
  let celebrateTimer = 0;
  let damageTimer = 0;
  let criticalTimer = 0;

  const celebrate = () => {
    window.clearTimeout(celebrateTimer);
    root.classList.remove('celebrate');
    void root.offsetWidth; // restart confetti if re-triggered
    celebrating = true;
    root.classList.add('celebrate');
    syncPose();
    celebrateTimer = window.setTimeout(() => {
      celebrating = false;
      root.classList.remove('celebrate');
      syncPose();
    }, 1700);
  };

  const flashClass = (cls: string, timer: number, ms: number): number => {
    window.clearTimeout(timer);
    root.classList.remove(cls);
    void root.offsetWidth;
    root.classList.add(cls);
    return window.setTimeout(() => root.classList.remove(cls), ms);
  };

  // --- entrance ----------------------------------------------------------
  let entered = false;
  let shown = false;
  let introStart = 0;
  let hpRaf = 0;

  /** Sets the HP readout; during the entrance, counts 0 → hp instead. */
  const setHp = (hp: number) => {
    const sinceIntro = introStart ? performance.now() - introStart : Infinity;
    if (sinceIntro < INTRO_COUNT_AT_MS + 400) {
      cancelAnimationFrame(hpRaf);
      const startAt = introStart + INTRO_COUNT_AT_MS;
      const dur = 420;
      pct.textContent = '0';
      const tick = (now: number) => {
        if (now < startAt) {
          hpRaf = requestAnimationFrame(tick);
          return;
        }
        const p = Math.min(1, (now - startAt) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        const v = String(Math.round(hp * eased));
        pct.textContent = v;
        vHp.textContent = v;
        if (p < 1) hpRaf = requestAnimationFrame(tick);
      };
      hpRaf = requestAnimationFrame(tick);
    } else {
      pct.textContent = String(hp);
      vHp.textContent = String(hp);
    }
  };

  /** Fills HP segments; cells that just emptied on a drop play the drain. */
  const setSegs = (wrap: HTMLElement, hp: number) => {
    const cells = wrap.querySelectorAll<HTMLElement>('.seg');
    const filled = hp > 0 ? Math.max(1, Math.round((hp / 100) * cells.length)) : 0;
    cells.forEach((el, i) => {
      if (i < filled) {
        el.classList.remove('draining');
        el.classList.add('on');
      } else if (el.classList.contains('on') && !reducedMotion()) {
        el.classList.remove('on', 'draining');
        void el.offsetWidth;
        el.classList.add('draining');
        window.setTimeout(() => el.classList.remove('draining'), 640);
      } else {
        el.classList.remove('on', 'draining');
      }
    });
  };

  panel.hidden = persist.collapsed;

  // --- lifetime stats ------------------------------------------------------
  const stats = loadStats();

  const bumpStat = (el: HTMLElement) => {
    if (reducedMotion()) return;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  };
  const renderStats = (bumpKey?: 'chats' | 'handoffs' | 'saved') => {
    sChats.textContent = String(stats.chats);
    sHand.textContent = String(stats.handoffs);
    sSaved.textContent = '~' + fmtTok(stats.saved);
    sHero.textContent = '~' + fmtTok(stats.saved);
    if (bumpKey === 'chats') bumpStat(sChats);
    if (bumpKey === 'handoffs') bumpStat(sHand);
    if (bumpKey === 'saved') { bumpStat(sSaved); bumpStat(sHero); }
    saveStats(stats);
  };
  renderStats();

  // chats-watched: count each distinct conversation once, keyed by its URL path
  // so reloads of the same chat don't re-count. markChatWatched() can also be
  // called by the monitor on SPA navigation; it's idempotent per path.
  const markChatWatched = () => {
    const key = location.pathname;
    if (!key || key === stats.lastChatKey) return;
    stats.lastChatKey = key;
    stats.chats += 1;
    renderStats('chats');
  };

  // --- onboarding hint -----------------------------------------------------
  let hintDismiss: (() => void) | null = null;

  const dismissHint = () => {
    if (hint.hidden) return;
    hint.hidden = true;
    const cb = hintDismiss;
    hintDismiss = null;
    cb?.();
  };

  $('.hint-ok').addEventListener('click', dismissHint);

  const syncExpanded = () => {
    pill.setAttribute('aria-expanded', String(!persist.collapsed));
  };

  const togglePanel = () => {
    persist.collapsed = !persist.collapsed;
    panel.hidden = persist.collapsed;
    syncExpanded();
    opts.onPersist({ ...persist });
    dismissHint(); // interacting with the pill counts as onboarded
  };

  // Duplicates row: clickable when duplicates exist.
  const dupRow = vDup.parentElement as HTMLElement;
  dupRow.addEventListener('click', () => {
    if (dupRow.classList.contains('clickable')) opts.callbacks.onShowDuplicates?.();
  });

  // Heaviest row: clickable; cycles through the top token consumers.
  const topRow = vTop.parentElement as HTMLElement;
  topRow.addEventListener('click', () => {
    if (topRow.classList.contains('clickable')) opts.callbacks.onJumpToHeavy?.();
  });

  // RPG damage numbers: a floating "-N HP" when context takes a hit.
  const spawnDamage = (amount: number) => {
    if (reducedMotion()) return;
    const d = document.createElement('span');
    d.className = 'dmg';
    d.textContent = `-${amount} HP`;
    pillspot.appendChild(d);
    d.addEventListener('animationend', () => d.remove());
    window.setTimeout(() => d.remove(), 1600); // safety if animations are off
  };

  // =====================================================================
  // IDLE STATE MACHINE — sit → shuffled activities → yawn → nap
  // =====================================================================
  let idleTimer = 0;
  let stageTimer = 0;
  let idleActsLeft = 0;
  let suppressWakeUntil = 0;

  const clearIdleTimers = () => {
    window.clearTimeout(idleTimer);
    window.clearTimeout(stageTimer);
  };

  const enterStage = (stage: IdleStage, hold = false) => {
    setAttentive(false);
    const wasSeated = idleStage ? IDLE_SEATED[idleStage] : false;
    idleStage = stage;
    // The sit-down drop only plays going standing → seated, not on every
    // seated → seated swap (the .mk-swap cushion handles those).
    if (IDLE_SEATED[stage] && !wasSeated && stage !== 'nap' && stage !== 'yawn') {
      root.classList.remove('idle-enter');
      void root.offsetWidth;
      root.classList.add('idle-enter');
      window.setTimeout(() => root.classList.remove('idle-enter'), 600);
    }
    syncPose();
    if (Math.random() < 0.55) {
      if (stage === 'kick') showBubble('🎵 dum de dum…');
      else if (stage === 'peek') showBubble('still there? 👀');
      else if (stage === 'doodle') showBubble('just doodling ✏️');
    }
    window.clearTimeout(stageTimer);
    if (hold) return;
    if (stage === 'nap') return; // terminal
    if (stage === 'yawn') {
      stageTimer = window.setTimeout(() => enterStage('nap'), IDLE_DWELL.yawn);
      return;
    }
    stageTimer = window.setTimeout(nextIdle, IDLE_DWELL[stage]);
  };

  const nextIdle = () => {
    if (idleActsLeft <= 0) { enterStage('yawn'); return; }
    idleActsLeft -= 1;
    enterStage(pick(IDLE_ACTIVITIES));
  };

  const goIdle = () => {
    if (idleStage || !shown) return;
    idleActsLeft = 2 + Math.floor(Math.random() * 2); // 2–3 activities before bed
    enterStage('sit');
  };

  // --- welcome-back wave + wake-from-nap startle ---------------------------
  let waveTimer = 0;
  let startleTimer = 0;

  const spawnMark = (ch: string) => {
    if (reducedMotion()) return;
    const m = document.createElement('span');
    m.className = 'mark';
    m.textContent = ch;
    pillspot.appendChild(m);
    window.setTimeout(() => m.remove(), 1000);
  };

  const beginWave = (fromNap: boolean) => {
    waving = true;
    syncPose();
    showBubble(fromNap
      ? pick(['eep— oh, hi! 😳', 'huh—! you’re back!', 'oh! i dozed off… hi!'])
      : pick(['welcome back! 🌸', 'missed you~', 'oh, hi again!', 'yay, you’re back!']));
    window.clearTimeout(waveTimer);
    waveTimer = window.setTimeout(() => {
      waving = false;
      syncPose();
      scheduleIdle();
    }, 1300);
  };

  const playWave = (fromNap: boolean) => {
    if (fromNap) {
      // startle beat: she snaps awake (wide-eyed jump + "!") before waving
      spawnMark('!');
      root.classList.remove('startle');
      void root.offsetWidth;
      root.classList.add('startle');
      window.setTimeout(() => root.classList.remove('startle'), 440);
      startling = true;
      syncPose();
      window.clearTimeout(startleTimer);
      startleTimer = window.setTimeout(() => {
        startling = false;
        beginWave(true);
      }, 360);
    } else {
      beginWave(false);
    }
  };

  const wake = (force: boolean) => {
    if (!idleStage && !force) return;
    if (!force && Date.now() < suppressWakeUntil) return;
    const wasIdle = !!idleStage;
    const wasNap = idleStage === 'nap';
    clearIdleTimers();
    idleStage = null;
    syncPose();
    if (wasIdle && !force) playWave(wasNap);
    else scheduleIdle();
  };

  const scheduleIdle = () => {
    window.clearTimeout(idleTimer);
    if (shown) idleTimer = window.setTimeout(goIdle, IDLE_DELAY_MS);
  };

  const noteActivity = () => {
    if (!shown) return;
    if (idleStage) wake(false);
    else scheduleIdle();
  };

  // =====================================================================
  // CURSOR ATTENTION — she notices you, stops, and follows the pointer
  // =====================================================================
  const canAttend = () =>
    shown && !idleStage && !waving && !startling && !celebrating &&
    !konamiActive && !petting && lastState !== 'critical';

  const attTarget = () => {
    const r = host.getBoundingClientRect();
    return { x: r.right - 48, y: r.bottom - 46 };
  };

  const driveAttention = () => {
    if (!attentive || reducedMotion()) return;
    const t = attTarget();
    const dx = Math.max(-1, Math.min(1, (cursor.x - t.x) / 170));
    const dy = Math.max(-1, Math.min(1, (cursor.y - t.y) / 150));
    if (mkTrack) {
      mkTrack.style.transform =
        `rotate(${(dx * 12).toFixed(1)}deg) translate(${(dx * 1.4).toFixed(2)}px,${(dy * 1.0 - 0.2).toFixed(2)}px)`;
    }
    if (mkEyes) {
      mkEyes.style.transform = `translate(${(dx * 1.2).toFixed(2)}px,${(dy * 1.0).toFixed(2)}px)`;
    }
  };

  function setAttentive(on: boolean): void {
    if (on === attentive) return;
    attentive = on;
    root.classList.toggle('attentive', on);
    syncPose();
    if (on) {
      mkTrack = flip.querySelector('.mk-track');
      mkEyes = flip.querySelector('.mk-eyes');
      driveAttention();
    } else {
      if (mkTrack) mkTrack.style.transform = '';
      mkTrack = null;
      mkEyes = null;
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    noteActivity();
    cursor.x = e.clientX;
    cursor.y = e.clientY;
    if (canAttend()) {
      const t = attTarget();
      const dist = Math.hypot(cursor.x - t.x, cursor.y - t.y);
      const near = attentive ? dist < ATTEND_ZONE_OUT : dist < ATTEND_ZONE_IN;
      setAttentive(near);
      if (near) driveAttention();
    } else if (attentive) {
      setAttentive(false);
    }
  };

  // =====================================================================
  // PET — click the sprite for a state-aware response
  // =====================================================================
  let petTimer = 0;

  type PetClass = 'pet-bright' | 'pet-soft' | 'pet-tired' | 'pet-critical';

  const PET_CLASSES: PetClass[] = ['pet-bright', 'pet-soft', 'pet-tired', 'pet-critical'];
  const PET_REACTIONS: Record<HealthState, {
    className: PetClass;
    hearts: number;
    durationMs: number;
    lines: string[];
  }> = {
    fresh: {
      className: 'pet-bright',
      hearts: 4,
      durationMs: 720,
      lines: ['Ehehe~', 'Boop!', 'Ready to run.', 'Tiny boost received.'],
    },
    healthy: {
      className: 'pet-soft',
      hearts: 3,
      durationMs: 680,
      lines: ['Still doing okay.', 'Thanks, I am steady.', 'We have room.', 'Little morale bump.'],
    },
    heavy: {
      className: 'pet-tired',
      hearts: 1,
      durationMs: 760,
      lines: ['Thanks... I needed that.', 'Getting heavy now.', 'Maybe handoff soon?', 'I can keep going, slowly.'],
    },
    critical: {
      className: 'pet-critical',
      hearts: 0,
      durationMs: 900,
      lines: ['I am spent. Please hand this off.', 'Too full... fresh chat?', 'I cannot carry much more.', 'Handoff would help me breathe.'],
    },
  };

  const spawnHearts = (count: number) => {
    if (count <= 0 || reducedMotion()) return;
    for (let i = 0; i < count; i++) {
      const h = document.createElement('span');
      h.className = 'heart';
      h.textContent = '♥';
      h.style.left = `${(28 + (Math.random() * 26 - 13)).toFixed(0)}px`;
      h.style.animationDelay = `${(i * 0.08).toFixed(2)}s`;
      h.style.setProperty('--r', `${(Math.random() * 30 - 15).toFixed(0)}deg`);
      h.style.fontSize = `${(10 + Math.random() * 5).toFixed(0)}px`;
      pillspot.appendChild(h);
      window.setTimeout(() => h.remove(), 1500);
    }
  };

  const clearPetClasses = () => {
    root.classList.remove('petted', ...PET_CLASSES);
  };

  const pet = () => {
    const reaction = PET_REACTIONS[lastState];
    if (idleStage) { clearIdleTimers(); idleStage = null; }
    petting = true;
    setAttentive(false);
    syncPose();
    clearPetClasses();
    void root.offsetWidth;
    root.classList.add('petted', reaction.className);
    spawnHearts(reaction.hearts);
    showBubble(pick(reaction.lines));
    window.clearTimeout(petTimer);
    petTimer = window.setTimeout(() => {
      petting = false;
      clearPetClasses();
      scheduleIdle();
    }, reaction.durationMs);
  };

  sprite.style.pointerEvents = 'auto';
  sprite.addEventListener('click', (e) => {
    e.stopPropagation();
    pet();
  });

  // =====================================================================
  // KONAMI EASTER EGG — ↑↑↓↓←→←→ B A → 1-UP + confetti dance
  // =====================================================================
  let konamiIdx = 0;
  let konamiTimer = 0;

  const fireKonami = () => {
    clearIdleTimers();
    idleStage = null;
    konamiActive = true;
    root.classList.remove('konami');
    void root.offsetWidth;
    root.classList.add('konami');
    syncPose();
    showBubble('1-UP! ▲▲▼▼◀▶◀▶ B A — you found me ✨');

    if (!reducedMotion()) {
      const up = document.createElement('span');
      up.className = 'oneup';
      up.textContent = '1-UP!';
      pillspot.appendChild(up);
      window.setTimeout(() => up.remove(), 1600);

      const box = document.createElement('span');
      box.className = 'kfetti';
      const n = 18;
      for (let i = 0; i < n; i++) {
        const p = document.createElement('i');
        p.style.left = `${Math.round((i / (n - 1)) * 100)}%`;
        p.style.background = KONAMI_CONFETTI[i % KONAMI_CONFETTI.length];
        p.style.setProperty('--d', `${(Math.random() * 0.35).toFixed(2)}s`);
        p.style.setProperty('--fall', `${(52 + Math.random() * 34).toFixed(0)}px`);
        p.style.setProperty('--spin', `${(260 + Math.random() * 360).toFixed(0)}deg`);
        box.appendChild(p);
      }
      pillspot.appendChild(box);
      window.setTimeout(() => box.remove(), 2100);
    }

    window.clearTimeout(konamiTimer);
    konamiTimer = window.setTimeout(() => {
      konamiActive = false;
      root.classList.remove('konami');
      syncPose();
      scheduleIdle();
    }, 1700);
  };

  const onKonamiKey = (e: KeyboardEvent) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === KONAMI[konamiIdx]) {
      konamiIdx += 1;
      if (konamiIdx === KONAMI.length) {
        konamiIdx = 0;
        fireKonami();
      }
    } else {
      konamiIdx = k === KONAMI[0] ? 1 : 0;
    }
  };

  // --- handoff section ---------------------------------------------------
  let lastHandoff: HandoffView | null = null;

  const renderHandoff = (view: HandoffView, canStart: boolean) => {
    lastHandoff = view;
    switch (view.phase) {
      case 'idle':
        handoffBox.innerHTML = `<button class="hbtn primary" data-action="start" ${
          canStart ? '' : 'disabled'
        }>Generate handoff</button>`;
        break;
      case 'confirm-replace':
        handoffBox.innerHTML = `
          <div class="hnote">The chat input already has a draft.</div>
          <div class="hrow">
            <button class="hbtn" data-action="start">Replace it</button>
            <button class="hbtn" data-action="cancel">Keep it</button>
          </div>`;
        break;
      case 'armed':
        handoffBox.innerHTML = `
          <div class="hnote">Handoff prompt placed in the chat input — review it and press <b>send</b>. Memoko never sends for you.</div>
          <button class="hbtn" data-action="cancel">Cancel</button>`;
        break;
      case 'capturing':
        handoffBox.innerHTML = `
          <div class="hnote hwait">Waiting for the summary to finish&hellip;</div>
          <button class="hbtn" data-action="cancel">Cancel</button>`;
        break;
      case 'done': {
        const ratio =
          view.baselineTokens > 0
            ? `~${formatTokenCount(view.baselineTokens)} &rarr; ~${formatTokenCount(
                view.resultTokens
              )} tokens &middot; ${view.compressionPct.toFixed(1)}% compressed`
            : `~${formatTokenCount(view.resultTokens)} tokens`;
        handoffBox.innerHTML = `
          <div class="hratio">${ratio}</div>
          <div class="hpreview">${escapeHtml(view.resultText)}</div>
          <div class="hrow">
            <button class="hbtn primary" data-action="copy">Copy</button>
            <button class="hbtn" data-action="newchat">New chat</button>
            <button class="hbtn hx" data-action="dismiss" title="Dismiss">&#10005;</button>
          </div>`;
        break;
      }
    }
  };

  handoffBox.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-action]');
    if (!(btn instanceof HTMLElement) || btn.hasAttribute('disabled')) return;
    const action = btn.getAttribute('data-action');
    if (action === 'copy') {
      navigator.clipboard
        .writeText(lastHandoff?.resultText ?? '')
        .then(() => {
          btn.textContent = 'Copied ✓';
          setTimeout(() => {
            btn.textContent = 'Copy';
          }, 1500);
        })
        .catch(() => {});
    } else if (action === 'start') {
      opts.callbacks.onHandoffStart();
    } else if (action === 'cancel' || action === 'dismiss') {
      opts.callbacks.onHandoffCancel();
    } else if (action === 'newchat') {
      opts.callbacks.onOpenNewChat();
    }
  });

  renderHandoff(
    { phase: 'idle', resultText: '', baselineTokens: 0, resultTokens: 0, compressionPct: 0 },
    false
  );

  // --- drag / click handling -------------------------------------------
  let drag: {
    pointerId: number;
    startX: number;
    startY: number;
    startRight: number;
    startBottom: number;
    moved: boolean;
  } | null = null;

  const applyPosition = () => {
    const maxRight = Math.max(4, window.innerWidth - 80);
    const maxBottom = Math.max(4, window.innerHeight - 40);
    persist.right = Math.min(Math.max(4, persist.right), maxRight);
    persist.bottom = Math.min(Math.max(4, persist.bottom), maxBottom);
    host.style.right = `${persist.right}px`;
    host.style.bottom = `${persist.bottom}px`;
  };

  pill.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startRight: persist.right,
      startBottom: persist.bottom,
      moved: false,
    };
    pill.setPointerCapture(e.pointerId);
  });

  pill.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    persist.right = drag.startRight - dx;
    persist.bottom = drag.startBottom - dy;
    applyPosition();
  });

  pill.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const wasDrag = drag.moved;
    drag = null;
    if (wasDrag) {
      opts.onPersist({ ...persist });
    } else {
      togglePanel();
    }
  });

  pill.addEventListener('pointercancel', () => {
    drag = null;
  });

  // Global listeners (stored so destroy() can remove them).
  const onActivity = () => noteActivity();
  window.addEventListener('resize', applyPosition);
  window.addEventListener('pointerdown', onActivity, { passive: true });
  window.addEventListener('keydown', onActivity, { passive: true });
  window.addEventListener('scroll', onActivity, { passive: true });
  window.addEventListener('wheel', onActivity, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('keydown', onKonamiKey);

  syncExpanded();
  document.documentElement.appendChild(host);

  return {
    update(stats_: PillStats) {
      const usage = Math.max(0, stats_.usagePct);
      const adjusted = Math.max(usage, stats_.adjustedPct);
      const remaining = Math.max(0, Math.min(100, 100 - adjusted));
      const hp = Math.round(remaining);
      const usageLabel = `${Math.min(999, Math.round(usage))}%`;

      root.dataset.state = stats_.state;
      root.dataset.theme = detectDarkTheme() ? 'dark' : 'light';
      // Don't pulse "streaming" while she's off doing an idle thing.
      root.classList.toggle('streaming', stats_.streaming && !idleStage);

      if (!celebrating && lastHp !== null && hp < lastHp - 1) {
        damageTimer = flashClass('hp-drop', damageTimer, 820);
        spawnDamage(lastHp - hp);
      }
      if (!celebrating && lastState !== 'critical' && stats_.state === 'critical') {
        criticalTimer = flashClass('critical-enter', criticalTimer, 1200);
      }
      lastHp = hp;
      lastState = stats_.state;
      lastStreaming = stats_.streaming;
      syncPose();
      if (stats_.bubble) showBubble(stats_.bubble);

      // Lifetime "chats watched": once per distinct conversation (keyed by URL
      // path, so reloads don't re-count).
      if (stats_.messageCount > 0) markChatWatched();

      // HP counts DOWN as context fills; usage % stays in the panel rows.
      setSegs(pillSegs, hp);
      setSegs(panelSegs, hp);
      setHp(hp);
      statusEl.textContent = MEMOKO_STATUS[stats_.state];
      pill.title = `Memoko — ${STATE_LABEL[stats_.state]} · HP ${hp} · ~${usageLabel} of context used (estimate)`;

      badge.textContent = STATE_LABEL[stats_.state];
      vPct.textContent = `~${usageLabel}`;
      const adjRow = vAdj.parentElement!;
      if (adjusted - usage >= 1) {
        adjRow.hidden = false;
        vAdj.textContent = `~${Math.min(999, Math.round(adjusted))}%`;
      } else {
        adjRow.hidden = true;
      }
      vTokens.textContent = `~${formatTokenCount(stats_.tokens)} / ${formatTokenCount(stats_.budget)}`;
      vMsgs.textContent = String(stats_.messageCount);
      vDup.textContent =
        stats_.dupBlocks > 0
          ? `~${formatTokenCount(stats_.dupTokens)} tok · ${stats_.dupBlocks}×`
          : 'none';
      vDup.classList.toggle('warn', stats_.dupBlocks > 0);
      dupRow.classList.toggle('clickable', stats_.dupBlocks > 0);
      dupRow.title =
        stats_.dupBlocks > 0
          ? 'Click to jump to a duplicate block (click again for the next one).'
          : 'Near-duplicate large blocks in this conversation (same content appearing more than once).';
      vAge.textContent = `${formatAge(stats_.ageMs)} (this tab)`;

      const burn = stats_.burnTokensPerMin ?? null;
      if (burn === null) {
        vBurn.textContent = '–';
      } else {
        const eta =
          stats_.minutesToCritical != null && stats_.minutesToCritical <= 240
            ? ` · ${Math.max(1, Math.round(stats_.minutesToCritical))}m left`
            : '';
        vBurn.textContent = `~${formatTokenCount(Math.round(burn))}/min${eta}`;
      }

      const share = stats_.userSharePct ?? null;
      vSplit.textContent =
        share === null ? '–' : `${Math.round(share)}% / ${Math.round(100 - share)}%`;

      const heavy = stats_.heaviest ?? null;
      topRow.hidden = heavy === null;
      topRow.classList.toggle('clickable', heavy !== null);
      if (heavy) {
        vTop.textContent = `#${heavy.ordinal} (${heavy.role === 'user' ? 'you' : 'AI'}) · ~${formatTokenCount(heavy.tokens)}`;
        topRow.title = 'Click to jump to the heaviest messages (click again for the next one).';
      }
    },
    updateHandoff(view: HandoffView, canStart: boolean, enabled: boolean) {
      handoffBox.style.display = enabled ? '' : 'none';
      if (!enabled) return;
      // Celebrate + bank the lifetime stats exactly on the transition into 'done'.
      if (view.phase === 'done' && lastHandoff?.phase !== 'done') {
        celebrate();
        stats.handoffs += 1;
        const saved = Math.max(0, view.baselineTokens - view.resultTokens);
        stats.saved += saved;
        renderStats('saved');
        window.setTimeout(() => bumpStat(sHand), 60);
      }
      // Skip re-render when nothing changed — innerHTML writes would
      // destroy in-flight button feedback like "Copied ✓".
      if (
        lastHandoff &&
        lastHandoff.phase === view.phase &&
        lastHandoff.resultText === view.resultText &&
        handoffBox.childElementCount > 0
      ) {
        const startBtn = handoffBox.querySelector('[data-action="start"]');
        if (startBtn instanceof HTMLButtonElement) startBtn.disabled = !canStart;
        return;
      }
      renderHandoff(view, canStart);
    },
    showOnboarding(onDismiss: () => void) {
      hintDismiss = onDismiss;
      hint.hidden = false;
    },
    togglePanel,
    markChatWatched,
    show() {
      host.style.display = '';
      shown = true;
      applyPosition();
      scheduleIdle();
      // Entrance: capsule cracks open and Memoko pops out — first show only.
      if (!entered) {
        entered = true;
        if (!reducedMotion()) {
          introStart = performance.now();
          root.classList.add('intro');
          window.setTimeout(() => root.classList.remove('intro'), INTRO_TOTAL_MS);
        }
      }
    },
    hide() {
      host.style.display = 'none';
      shown = false;
      clearIdleTimers();
      window.clearTimeout(waveTimer);
      window.clearTimeout(startleTimer);
      window.clearTimeout(petTimer);
      idleStage = null;
      waving = false;
      startling = false;
      petting = false;
      clearPetClasses();
      setAttentive(false);
      syncPose();
    },
    destroy() {
      window.removeEventListener('resize', applyPosition);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('scroll', onActivity);
      window.removeEventListener('wheel', onActivity);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('keydown', onKonamiKey);
      window.clearTimeout(celebrateTimer);
      window.clearTimeout(damageTimer);
      window.clearTimeout(criticalTimer);
      window.clearTimeout(speechTimer);
      window.clearTimeout(idleTimer);
      window.clearTimeout(stageTimer);
      window.clearTimeout(waveTimer);
      window.clearTimeout(startleTimer);
      window.clearTimeout(petTimer);
      window.clearTimeout(konamiTimer);
      cancelAnimationFrame(hpRaf);
      host.remove();
    },
  };
}
