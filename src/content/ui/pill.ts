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
  /** Tokens from paste-attachments not visible in the transcript. */
  attachedTokens?: number;
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

// Rank title ladder — the panel "class" evolves with LV. Derived from lifetime
// tokens saved (no extra persistence), mirrors the LV math in renderStats().
const RANK_TITLES: Array<[number, string]> = [
  [1, 'Token Sprout'], [5, 'Note Taker'], [10, 'Context Keeper'],
  [20, 'Memory Archivist'], [35, 'Lore Warden'], [50, 'Grand Archivist'],
];
const rankTitle = (lv: number): string =>
  RANK_TITLES.reduce((acc, [min, name]) => (lv >= min ? name : acc), RANK_TITLES[0][1]);

/** How long the entrance choreography runs (matches pill.css timings, 1.25x). */
const INTRO_TOTAL_MS = 1700;
/** When the HP number starts counting up during the entrance. */
const INTRO_COUNT_AT_MS = 1000;

const seg = (n: number): string => '<span class="seg"></span>'.repeat(n);

let pixelFontsRequested = false;
/** Load the bundled pixel fonts via the FontFace API from ArrayBuffers, which
 *  sidesteps host-page CSP font-src/url() restrictions on claude.ai /
 *  chatgpt.com (fetching an extension resource is same-origin to us). Declare
 *  the files in manifest web_accessible_resources. Fonts added to document.fonts
 *  are visible inside the shadow DOM. On ANY failure the CSS monospace fallback
 *  stands, so the panel never blocks on this. */
async function loadPixelFonts(): Promise<void> {
  if (pixelFontsRequested) return;
  pixelFontsRequested = true;
  const faces: Array<[string, string, string]> = [
    ['MemokoPixel', 'fonts/PressStart2P-Regular.woff2', '400'],
    ['MemokoPixelText', 'fonts/Silkscreen-Regular.woff2', '400'],
    ['MemokoPixelText', 'fonts/Silkscreen-Bold.woff2', '700'],
  ];
  await Promise.all(
    faces.map(async ([family, path, weight]) => {
      try {
        const buf = await (await fetch(chrome.runtime.getURL(path))).arrayBuffer();
        const ff = new FontFace(family, buf, { weight, display: 'swap' });
        await ff.load();
        document.fonts.add(ff);
      } catch {
        /* monospace fallback stays */
      }
    })
  );
}

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
type IdleStage = 'sit' | 'laptop' | 'book' | 'doodle' | 'kick' | 'peek' | 'yawn' | 'nap';
const IDLE_ACTIVITIES: IdleStage[] = ['laptop', 'book', 'doodle', 'kick', 'peek'];
const IDLE_SEATED: Record<IdleStage, true> = {
  sit: true, laptop: true, book: true, doodle: true, kick: true, peek: true, yawn: true, nap: true,
};
/** Inactivity before she settles in. Tamagotchi cadence — ~2 minutes. */
const IDLE_DELAY_MS = 120_000;
const IDLE_DWELL: Record<IdleStage, number> = {
  sit: 9_000, laptop: 16_000, book: 14_000, doodle: 13_000, kick: 8_000, peek: 7_000, yawn: 1_700, nap: 0,
};

// ---- Konami easter egg -----------------------------------------------------
const KONAMI: string[] = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a',
];
const KONAMI_CONFETTI = ['#ff5d8f', '#ffd166', '#34d399', '#5db3e8', '#b794f6', '#ffffff'];
const BERRY_PET_COMBO = 4;
const PET_COMBO_WINDOW_MS = 1_600;
const HURT_POSE_MS = 480;
const SUMMIT_SAVED_TOKENS = 50_000;

// ---- cursor attention ------------------------------------------------------
const ATTEND_ZONE_IN = 235;
const ATTEND_ZONE_OUT = 300; // hysteresis so the boundary doesn't flicker

// ---- lifetime stats --------------------------------------------------------
/** Persisted in chrome.storage.local — extension-private. NOT the host
 *  page's localStorage, which the claude.ai / chatgpt.com page can read:
 *  that would leak usage stats and breaks the "only settings persisted"
 *  privacy guarantee. Hydrate via hydrateStats() before createPill so the
 *  in-memory object the pill mutates starts from stored values. */
const STATS_KEY = 'memoko-stats-v1';
interface MemokoStats { chats: number; handoffs: number; saved: number; lastChatKey: string; }
const statsCache: MemokoStats = { chats: 0, handoffs: 0, saved: 0, lastChatKey: '' };

function coerceStats(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const r = raw as Record<string, unknown>;
  statsCache.chats = Math.max(0, (r.chats as number) | 0);
  statsCache.handoffs = Math.max(0, (r.handoffs as number) | 0);
  statsCache.saved = Math.max(0, (r.saved as number) | 0);
  statsCache.lastChatKey = typeof r.lastChatKey === 'string' ? r.lastChatKey : '';
}

/** Load stored stats into the cache; await before the first loadStats(). */
export async function hydrateStats(): Promise<void> {
  try {
    const got = await chrome.storage.local.get(STATS_KEY);
    if (got?.[STATS_KEY] !== undefined) {
      coerceStats(got[STATS_KEY]);
      return;
    }
    // one-time migration off the host-origin localStorage, then erase it
    const legacy = localStorage.getItem(STATS_KEY);
    if (legacy) {
      coerceStats(JSON.parse(legacy));
      try { localStorage.removeItem(STATS_KEY); } catch { /* ignore */ }
      void chrome.storage.local.set({ [STATS_KEY]: { ...statsCache } });
    }
  } catch {
    // defaults stand
  }
}

function loadStats(): MemokoStats {
  return statsCache;
}
function saveStats(s: MemokoStats): void {
  try {
    void chrome.storage.local.set({ [STATS_KEY]: { ...s } });
  } catch {
    // ignore
  }
}
function fmtTok(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'k';
  return String(Math.round(n));
}

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

const isPatrolPose = (pose: MemokoPose | null): pose is HealthState =>
  pose === 'fresh' || pose === 'healthy' || pose === 'heavy';

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
  void loadPixelFonts();
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
          <div class="head-mid">
            <span class="title">MEMOKO</span>
            <span class="name-sub"><span class="lv">LV 1</span><span class="class-tag">Context Keeper</span></span>
          </div>
          <span class="badge">Fresh</span>
        </div>
        <div class="hpline" title="Health remaining — drains as context fills. Uses adjusted load when long-conversation penalties apply.">
          <span>HP</span><b class="v-hp">–</b><i>/ 100</i></div>
        <div class="segbar large">${seg(20)}</div>
        <div class="xp-row" title="Lifetime tokens saved toward Memoko's next rank (every ~100k saved is a rank).">
          <span>NEXT RANK</span><span class="xp-track"><span class="xp-fill"></span></span><b class="v-xp">0%</b></div>
        <div class="dialogue"><span class="d-cursor" aria-hidden="true">&#9656;</span><span class="status"></span></div>
        <div class="section-cap">STATUS</div>
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
          <div class="section-cap">RECORDS</div>
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
  const vLv = $('.lv');
  const xpFill = $<HTMLElement>('.xp-fill');
  const vXp = $('.v-xp');
  const classTag = $('.class-tag');

  let spritePose: MemokoPose | null = null;
  let lastPatrolSpriteWidth = 0;

  const renderedSpriteWidth = () => {
    const svg = flip.querySelector<SVGSVGElement>('svg.sp');
    return (
      svg?.getBoundingClientRect().width ||
      flip.getBoundingClientRect().width ||
      sprite.getBoundingClientRect().width ||
      0
    );
  };

  const syncRunWidth = () => {
    const pillWidth = pill.getBoundingClientRect().width || pill.offsetWidth || pillspot.offsetWidth;
    if (pillWidth <= 0) return;

    const measuredSpriteWidth = renderedSpriteWidth();
    // Cursor-attention and other paused poses should not rewrite the patrol
    // distance from their own footprint; keep the last standing patrol width
    // so resuming continues from the same edge-to-edge travel budget.
    if (isPatrolPose(spritePose) && measuredSpriteWidth > 0) {
      lastPatrolSpriteWidth = measuredSpriteWidth;
    }
    const spriteWidth =
      lastPatrolSpriteWidth > 0 ? lastPatrolSpriteWidth : measuredSpriteWidth || SPRITE_SIZE;
    const leftInset = Number.parseFloat(getComputedStyle(sprite).left || '0') || 0;
    const containedRunWidth = pillWidth - spriteWidth - leftInset * 2;
    if (containedRunWidth <= 0) return;

    sprite.style.setProperty('--run-w', `${containedRunWidth.toFixed(1)}px`);
    sprite.style.setProperty('--run-w-fresh', `${containedRunWidth.toFixed(1)}px`);
    sprite.style.setProperty('--run-w-healthy', `${containedRunWidth.toFixed(1)}px`);
    sprite.style.setProperty('--run-w-heavy', `${containedRunWidth.toFixed(1)}px`);
  };

  const runResizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(syncRunWidth);
  runResizeObserver?.observe(pill);
  runResizeObserver?.observe(sprite);

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
  let berryActive = false;
  let healActive = false;
  let starActive = false;
  let hurting = false;
  let casting = false;
  let castPose: MemokoPose = 'watch';
  let resumeFlipTime: CSSNumberish | null = null;
  let resumeFlipRaf = 0;
  let mkTrack: HTMLElement | null = null;
  let mkEyes: HTMLElement | null = null;
  const cursor = { x: -9999, y: -9999 };

  const patrolFlipAnimation = (): CSSAnimation | null =>
    flip
      .getAnimations()
      .find((candidate): candidate is CSSAnimation =>
        candidate instanceof CSSAnimation &&
        candidate.animationName.startsWith('memoko-flip-')
      ) ?? null;

  const restoreFlipPhase = () => {
    if (resumeFlipTime == null || !isPatrolPose(spritePose)) return;
    const anim = patrolFlipAnimation();
    if (!anim) {
      resumeFlipRaf = window.requestAnimationFrame(restoreFlipPhase);
      return;
    }
    anim.currentTime = resumeFlipTime;
    resumeFlipTime = null;
    resumeFlipRaf = 0;
  };

  const setSprite = (pose: MemokoPose) => {
    if (pose === spritePose) return;
    spritePose = pose;
    // Wrapped in .mk-swap so each swap plays a soft settle, not a hard cut.
    flip.innerHTML = `<span class="mk-swap">${spriteSvg(pose, SPRITE_SIZE)}</span>`;
    syncRunWidth();
  };

  const setFace = (state: HealthState) => {
    if (state === faceState) return;
    faceState = state;
    avatar.innerHTML = faceSvg(state, 24);
  };

  /** Pose precedence: big easter eggs / celebration > berry/heal > hurt >
   *  startle > wave > idle > attentive > streaming-watch > health state. */
  const syncPose = () => {
    let pose: MemokoPose;
    if (casting) pose = castPose;
    else if (konamiActive || celebrating || starActive) pose = 'cheer';
    else if (berryActive) pose = 'wave';
    else if (healActive) pose = 'wave';
    else if (hurting) pose = 'hurt';
    else if (startling) pose = 'watch';
    else if (waving) pose = 'wave';
    else if (idleStage) {
      pose =
        idleStage === 'kick' || idleStage === 'peek' ? 'sit' : idleStage;
    }
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
  // Track rank across renders so a genuine level-up (rank increase, e.g. after a
  // handoff bumps lifetime tokens saved) fires a one-shot celebration. Seeded
  // from the current rank so the initial render never fires.
  let lastRank = Math.floor(stats.saved / 100_000) + 1;

  const levelUp = (rank: number, title: string) => {
    celebrate(); // reuse the handoff confetti + cheer pose
    if (!reducedMotion()) {
      const toast = document.createElement('span');
      toast.className = 'lvlup';
      toast.textContent = 'LEVEL UP!';
      pillspot.appendChild(toast);
      window.setTimeout(() => toast.remove(), 1800);
    }
    // Full sparkle overlay inside the panel when it's open.
    if (!panel.hidden && !reducedMotion()) {
      const ov = document.createElement('div');
      ov.className = 'levelup';
      ov.innerHTML =
        '<div class="lu-burst">' +
        [0, 1, 2, 3, 4, 5]
          .map((i) => `<span style="--i:${i}">${i % 2 ? '&#10023;' : '&#10022;'}</span>`)
          .join('') +
        '</div>' +
        '<div class="lu-title">LEVEL UP!</div>' +
        `<div class="lu-rank">LV ${rank}</div>` +
        `<div class="lu-sub">${title} unlocked</div>`;
      ov.addEventListener('click', () => ov.remove());
      panel.appendChild(ov);
      window.setTimeout(() => ov.remove(), 2600);
    }
  };

  const renderStats = (bumpKey?: 'chats' | 'handoffs' | 'saved') => {
    sChats.textContent = String(stats.chats);
    sHand.textContent = String(stats.handoffs);
    sSaved.textContent = '~' + fmtTok(stats.saved);
    sHero.textContent = '~' + fmtTok(stats.saved);
    // RPG rank: every ~100k lifetime tokens saved is a level; the thread shows
    // progress toward the next one. The class title evolves with rank. Derived
    // only — no extra persistence.
    const rank = Math.floor(stats.saved / 100_000) + 1;
    const title = rankTitle(rank);
    vLv.textContent = 'LV ' + rank;
    classTag.textContent = title;
    const xpPct = Math.min(100, Math.round(((stats.saved % 100_000) / 100_000) * 100));
    xpFill.style.width = xpPct + '%';
    vXp.textContent = xpPct + '%';
    if (bumpKey === 'chats') bumpStat(sChats);
    if (bumpKey === 'handoffs') bumpStat(sHand);
    if (bumpKey === 'saved') { bumpStat(sSaved); bumpStat(sHero); }
    if (rank > lastRank) levelUp(rank, title);
    lastRank = rank;
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

  let hurtTimer = 0;

  const triggerHurt = () => {
    setAttentive(false);
    window.clearTimeout(hurtTimer);
    hurting = true;
    syncPose();
    hurtTimer = window.setTimeout(() => {
      hurting = false;
      syncPose();
    }, HURT_POSE_MS);
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
      else if (stage === 'book') showBubble('one more chapter 📖');
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
    !konamiActive && !berryActive && !hurting && !petting && lastState !== 'critical';

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
    window.cancelAnimationFrame(resumeFlipRaf);
    if (on) resumeFlipTime = patrolFlipAnimation()?.currentTime ?? null;
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
      restoreFlipPhase();
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
  let petComboTimer = 0;
  let petCombo = 0;
  let berryTimer = 0;
  let summitTimer = 0;
  let secretWaveTimer = 0;
  let healTimer = 0;
  let starTimer = 0;
  let letterCharmTimer = 0;
  const ALPHA_CLASSES = [
    'alpha-aces',
    'alpha-berry',
    'alpha-cheer',
    'alpha-dodge',
    'alpha-energy',
    'alpha-flag',
    'alpha-glint',
    'alpha-heal',
    'alpha-inspect',
    'alpha-jump',
    'alpha-kart',
    'alpha-loot',
    'alpha-guide',
    'alpha-ocarina',
    'alpha-adapt',
    'alpha-getsuga',
    'alpha-cyclops',
    'alpha-instinct',
    'alpha-saiyan',
    'alpha-fuga',
    'alpha-gin',
    'alpha-hollow',
    'alpha-cowl',
    'alpha-stand',
    'alpha-rengoku',
    'alpha-nika',
    'alpha-domain',
    'alpha-subaru',
    'alpha-rika',
    'alpha-pain',
    'alpha-harley',
    'alpha-zoro',
    'alpha-saitama',
    'alpha-itachi',
    'alpha-susanoo',
    'alpha-flash',
    'alpha-zawarudo',
    'alpha-exodia',
    'alpha-kqueen',
    'alpha-zenitsu',
  ] as const;

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

  const clearAlphaClasses = () => {
    root.classList.remove(...ALPHA_CLASSES, 'letter-charm');
    root.style.removeProperty('--secret-color');
  };

  const spawnStrawberry = () => {
    if (reducedMotion()) return;
    const berry = document.createElement('span');
    berry.className = 'berry-drop';
    berry.innerHTML = '<i class="berry-fruit"></i><i class="berry-leaf"></i>';
    pillspot.appendChild(berry);
    window.setTimeout(() => berry.remove(), 1600);
  };

  const spawnBerryBurst = () => {
    if (reducedMotion()) return;
    for (let i = 0; i < 4; i++) {
      const berry = document.createElement('span');
      berry.className = 'berry-drop berry-mini';
      berry.innerHTML = '<i class="berry-fruit"></i><i class="berry-leaf"></i>';
      berry.style.left = `${16 + i * 9}px`;
      berry.style.setProperty('--d', `${(i * 0.07).toFixed(2)}s`);
      berry.style.setProperty('--x', `${(i - 1.5) * 10}px`);
      berry.style.setProperty('--spin', `${i % 2 ? 28 : -24}deg`);
      pillspot.appendChild(berry);
      window.setTimeout(() => berry.remove(), 1500);
    }
  };

  const spawnSummitFlag = () => {
    if (reducedMotion()) return;
    const flag = document.createElement('span');
    flag.className = 'summit-flag';
    flag.innerHTML = '<i class="summit-pole"></i><i class="summit-cloth"></i><i class="summit-star"></i>';
    pillspot.appendChild(flag);
    window.setTimeout(() => flag.remove(), 1900);
  };

  const spawnStarBits = () => {
    if (reducedMotion()) return;
    const colors = ['#ffd166', '#fff7d6', '#5db3e8', '#ff5d8f', '#34d399'];
    for (let i = 0; i < 12; i++) {
      const bit = document.createElement('span');
      bit.className = 'star-bit';
      bit.textContent = i % 3 === 0 ? '★' : '✦';
      bit.style.left = `${Math.round((i / 11) * 100)}%`;
      bit.style.color = colors[i % colors.length]!;
      bit.style.setProperty('--d', `${(Math.random() * 0.24).toFixed(2)}s`);
      bit.style.setProperty('--fall', `${(40 + Math.random() * 30).toFixed(0)}px`);
      bit.style.setProperty('--spin', `${(120 + Math.random() * 260).toFixed(0)}deg`);
      pillspot.appendChild(bit);
      window.setTimeout(() => bit.remove(), 1700);
    }
  };

  // ---- Anime Ultimates: pixel-art props (Memoko's blocky rect style) ------
  const rect = (x: number, y: number, w: number, h: number, f: string): string =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"/>`;

  // Mahoraga's wheel: hub + 4 crossing spoke-bars (= 8 spokes) + 8 rim blocks.
  const wheelSVG = (): string => {
    const O = '#5e421c', M = '#c79a45', H = '#f2d889', HUB = '#7a5a26';
    let s =
      '<svg class="mh-svg" viewBox="0 0 18 18" width="24" height="24" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    [0, 45, 90, 135].forEach((r) => {
      s += `<g transform="rotate(${r} 9 9)">${rect(8, 2, 2, 14, M)}${rect(8.4, 2, 0.6, 14, H)}</g>`;
    });
    s += rect(7, 0, 4, 2, H) + rect(7, 16, 4, 2, H) + rect(0, 7, 2, 4, H) + rect(16, 7, 2, 4, H);
    s += rect(2, 2, 2, 2, M) + rect(14, 2, 2, 2, M) + rect(2, 14, 2, 2, M) + rect(14, 14, 2, 2, M);
    s += rect(6, 6, 6, 6, O) + rect(7, 7, 4, 4, HUB) + rect(8, 8, 2, 2, H);
    return s + '</svg>';
  };

  // Zangetsu-style cleaver: black blade, bright edge, dark guard + wrapped hilt.
  const swordSVG = (): string => {
    const BLADE = '#16191f', EDGE = '#dfe6ee', GUARD = '#0c0d10', HILT = '#7a4a2a', WRAP = '#c0c6cf';
    return (
      '<svg class="gt-sword-svg" viewBox="0 0 6 22" width="9" height="33" shape-rendering="crispEdges" style="display:block;overflow:visible">' +
      rect(1, 0, 4, 15, BLADE) + rect(4, 0, 1, 15, EDGE) + rect(1, 0, 1, 1, EDGE) +
      rect(0, 14, 6, 2, GUARD) +
      rect(2, 16, 2, 6, HILT) + rect(2, 17, 2, 1, WRAP) + rect(2, 19, 2, 1, WRAP) +
      '</svg>'
    );
  };

  // Pixel crescent slash — blocky C opening to the right.
  const crescentSVG = (): string => {
    const C = '#2fc3e0', L = '#6ee6f5', W = '#eafcff';
    return (
      '<svg class="gt-cres-svg" viewBox="0 0 13 20" width="26" height="40" shape-rendering="crispEdges" style="display:block;overflow:visible">' +
      rect(5, 0, 4, 2, C) + rect(3, 2, 4, 2, C) + rect(1, 4, 4, 3, C) + rect(0, 7, 4, 6, C) +
      rect(1, 13, 4, 3, C) + rect(3, 16, 4, 2, C) + rect(5, 18, 4, 2, C) +
      rect(6, 2, 2, 2, L) + rect(4, 4, 2, 3, L) + rect(3, 7, 2, 6, L) + rect(4, 13, 2, 3, L) + rect(6, 16, 2, 2, L) +
      rect(7, 4, 1, 2, W) + rect(5, 8, 1, 4, W) + rect(7, 14, 1, 2, W) +
      '</svg>'
    );
  };

  // Two-frame pixel flame aura (gold); the two frames are alternated by CSS.
  const flameSVG = (frame: number): string => {
    const O = '#ff8a00', M = '#ffc21f', C = '#fff3c4';
    let s =
      '<svg viewBox="0 0 22 30" width="44" height="60" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(4, 20, 14, 10, O) + rect(6, 14, 10, 16, M) + rect(8, 18, 6, 12, C);
    if (frame === 0) {
      s += rect(5, 8, 3, 12, O) + rect(10, 4, 3, 16, M) + rect(15, 10, 3, 10, O) + rect(11, 6, 1, 10, C) + rect(6, 12, 1, 6, C);
    } else {
      s += rect(6, 11, 3, 9, O) + rect(10, 2, 3, 18, M) + rect(14, 7, 3, 13, O) + rect(11, 4, 1, 12, C) + rect(15, 10, 1, 6, C);
    }
    return s + '</svg>';
  };

  // Sukuna's furnace — billowing pixel fire that gouts to the right (2 frames).
  const fireCloudSVG = (frame: number): string => {
    const D = '#7a1606', R = '#ff4a1a', O = '#ff9a1f', Y = '#ffd24a';
    let s =
      '<svg viewBox="0 0 30 26" width="60" height="52" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(2, 8, 20, 12, D) + rect(4, 6, 19, 16, R) + rect(7, 9, 15, 10, O) + rect(10, 11, 11, 6, Y);
    if (frame === 0) {
      s += rect(22, 6, 4, 4, R) + rect(24, 12, 4, 4, O) + rect(22, 16, 4, 4, R) + rect(26, 10, 2, 4, Y) + rect(3, 5, 3, 3, R);
    } else {
      s += rect(22, 9, 4, 4, O) + rect(25, 12, 4, 4, R) + rect(23, 15, 4, 4, O) + rect(27, 11, 2, 3, Y) + rect(4, 18, 3, 3, R);
    }
    return s + '</svg>';
  };

  // Gintama — Elizabeth mascot holding a placard.
  const elizaSVG = (): string => {
    const W = '#f2f4f7', INK = '#23272f', WOOD = '#caa86a', WD = '#8a6e3c';
    let s =
      '<svg viewBox="0 0 26 32" width="39" height="48" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(15, 6, 2, 12, WD);
    s += rect(6, 0, 18, 8, WOOD) + rect(6, 0, 18, 1, WD) + rect(6, 7, 18, 1, WD) + rect(6, 0, 1, 8, WD) + rect(23, 0, 1, 8, WD);
    s += rect(9, 2, 12, 1, INK) + rect(9, 4, 9, 1, INK);
    s += rect(7, 16, 12, 14, W) + rect(6, 19, 1, 8, W) + rect(19, 19, 1, 8, W);
    s += rect(8, 30, 3, 2, INK) + rect(14, 30, 3, 2, INK);
    s += rect(9, 20, 2, 3, INK) + rect(14, 20, 2, 3, INK);
    s += rect(11, 24, 3, 1, INK);
    return s + '</svg>';
  };

  // A jagged pixel lightning bolt in the given colour.
  const boltSVG = (color: string): string => {
    let s =
      '<svg viewBox="0 0 8 22" width="12" height="33" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(3, 0, 2, 5, color) + rect(2, 4, 2, 4, color) + rect(4, 7, 2, 5, color) + rect(2, 11, 2, 5, color) + rect(3, 15, 2, 7, color);
    s += rect(0, 8, 2, 2, color) + rect(6, 13, 2, 2, color);
    return s + '</svg>';
  };

  // A Star-Platinum-style pixel stand: broad humanoid, headband, raised fist.
  const standSVG = (): string => {
    const P = '#6b5bd6', PD = '#473a99', SK = '#57c9bd', G = '#ffd23f', INK = '#241a3a', W = '#eae6ff';
    let s =
      '<svg viewBox="0 0 26 40" width="34" height="52" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(9, 1, 8, 2, PD) + rect(9, 3, 8, 6, SK) + rect(8, 4, 10, 2, G);
    s += rect(10, 5, 2, 2, INK) + rect(14, 5, 2, 2, INK);
    s += rect(7, 9, 12, 12, P) + rect(8, 10, 10, 8, PD) + rect(10, 10, 6, 7, SK);
    s += rect(4, 9, 3, 9, P) + rect(19, 9, 3, 9, P);
    s += rect(8, 21, 4, 12, P) + rect(14, 21, 4, 12, P) + rect(8, 33, 4, 3, INK) + rect(14, 33, 4, 3, INK);
    s += rect(20, 6, 5, 5, SK) + rect(20, 6, 5, 1, W);
    return s + '</svg>';
  };

  // ---- Anime Ultimates K–O: pixel-art props -----------------------------
  // Rengoku: flame-wreathed katana.
  const katanaSVG = (): string => {
    const ST = '#e6ecf2', ST2 = '#aeb6c0', GD = '#2a1a0a', HL = '#8a2a1a', F = '#ff8a00', F2 = '#ffd24a';
    let s = '<svg viewBox="0 0 10 28" width="15" height="42" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(4, 2, 2, 16, ST) + rect(6, 2, 1, 16, ST2) + rect(4, 2, 1, 1, '#fff');
    s += rect(2, 18, 6, 1, GD);
    s += rect(4, 19, 2, 7, HL) + rect(4, 20, 2, 1, '#caa86a') + rect(4, 23, 2, 1, '#caa86a');
    s += rect(3, 3, 1, 4, F) + rect(6, 5, 1, 4, F) + rect(2, 8, 1, 3, F2) + rect(7, 9, 1, 4, F) + rect(3, 12, 1, 3, F2) + rect(6, 14, 1, 3, F2);
    return s + '</svg>';
  };
  const flameSlashSVG = (): string => {
    const R = '#ff3a0f', O = '#ff9a1f', Y = '#ffe06a';
    let s = '<svg viewBox="0 0 13 22" width="30" height="50" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(5, 0, 4, 2, R) + rect(3, 2, 4, 2, R) + rect(1, 4, 4, 3, R) + rect(0, 7, 4, 8, R) + rect(1, 15, 4, 3, R) + rect(3, 18, 4, 2, R) + rect(5, 20, 4, 2, R);
    s += rect(6, 2, 2, 2, O) + rect(4, 4, 2, 3, O) + rect(3, 7, 2, 8, O) + rect(4, 15, 2, 3, O) + rect(6, 18, 2, 2, O);
    s += rect(7, 5, 1, 3, Y) + rect(5, 9, 1, 4, Y) + rect(7, 14, 1, 3, Y);
    return s + '</svg>';
  };
  // Nika: white open-jacket collar.
  const jacketSVG = (): string => {
    const W = '#ffffff', SH = '#d8dde6', INK = '#9aa3b0';
    let s = '<svg viewBox="0 0 24 16" width="36" height="24" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(2, 2, 6, 13, W) + rect(16, 2, 6, 13, W) + rect(2, 2, 6, 1, SH) + rect(16, 2, 6, 1, SH);
    s += rect(7, 3, 2, 12, INK) + rect(15, 3, 2, 12, INK);
    return s + '</svg>';
  };
  // A blocky reaching hand (Mahito domain + Subaru shadow).
  const handSVG = (color: string): string => {
    let s = '<svg viewBox="0 0 12 14" width="18" height="21" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(2, 6, 8, 6, color) + rect(2, 2, 2, 5, color) + rect(5, 1, 2, 6, color) + rect(8, 2, 2, 5, color) + rect(0, 8, 2, 3, color);
    return s + '</svg>';
  };
  // Subaru: pixel pocket-watch.
  const clockSVG = (): string => {
    const G = '#ffd23f', D = '#2a2030', W = '#fff';
    let s = '<svg viewBox="0 0 18 18" width="27" height="27" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(6, 0, 6, 2, G) + rect(6, 16, 6, 2, G) + rect(0, 6, 2, 6, G) + rect(16, 6, 2, 6, G) + rect(2, 2, 2, 2, G) + rect(14, 2, 2, 2, G) + rect(2, 14, 2, 2, G) + rect(14, 14, 2, 2, G);
    s += rect(4, 4, 10, 10, D) + rect(8, 5, 2, 4, W) + rect(8, 8, 4, 2, W) + rect(8, 8, 2, 2, G);
    return s + '</svg>';
  };
  // Rika: monstrous cursed-spirit head.
  const rikaSVG = (): string => {
    const D = '#2a1830', D2 = '#46264f', T = '#f0e8f5', E = '#ff5d8f', H = '#1a0f20';
    let s = '<svg viewBox="0 0 30 28" width="48" height="45" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(4, 6, 22, 18, D) + rect(6, 4, 18, 4, D) + rect(3, 10, 2, 10, D) + rect(25, 10, 2, 10, D);
    s += rect(7, 7, 16, 11, D2);
    s += rect(5, 0, 3, 5, H) + rect(22, 0, 3, 5, H);
    s += rect(11, 9, 8, 5, T) + rect(13, 10, 4, 3, E) + rect(14, 10, 2, 3, H);
    s += rect(6, 22, 3, 4, T) + rect(11, 22, 3, 5, T) + rect(16, 22, 3, 4, T) + rect(21, 22, 3, 5, T);
    return s + '</svg>';
  };

  // ---- Anime Ultimates P–T: pixel-art props -----------------------------
  const planetSVG = (): string => {
    const D = '#3a3340', D2 = '#56505e', L = '#7a7486', P = '#a07ad0';
    let s = '<svg viewBox="0 0 20 20" width="34" height="34" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(6, 1, 8, 1, D) + rect(4, 2, 12, 1, D) + rect(3, 3, 14, 1, D) + rect(2, 4, 16, 2, D2) + rect(1, 6, 18, 8, D2) + rect(2, 14, 16, 2, D2) + rect(3, 16, 14, 1, D) + rect(4, 17, 12, 1, D) + rect(6, 18, 8, 1, D);
    s += rect(5, 5, 3, 2, L) + rect(12, 8, 2, 2, L) + rect(7, 11, 4, 2, D) + rect(13, 5, 2, 3, D);
    s += rect(9, 8, 3, 3, P) + rect(10, 9, 1, 1, '#e6c8ff');
    return s + '</svg>';
  };
  const rockSVG = (): string => {
    const D = '#56505e', L = '#7a7486';
    return '<svg viewBox="0 0 6 6" width="9" height="9" shape-rendering="crispEdges" style="display:block;overflow:visible">' +
      rect(1, 0, 4, 1, D) + rect(0, 1, 6, 4, D) + rect(1, 5, 4, 1, D) + rect(1, 1, 2, 2, L) + '</svg>';
  };
  const malletSVG = (): string => {
    const R = '#e63a4a', RD = '#9a1f2c', BK = '#2a2030', W = '#ffffff';
    let s = '<svg viewBox="0 0 20 30" width="30" height="45" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(2, 0, 16, 7, R) + rect(2, 7, 16, 6, RD);
    s += rect(2, 0, 16, 1, W) + rect(2, 0, 1, 13, '#ff8a96') + rect(17, 0, 1, 13, RD);
    s += rect(9, 13, 2, 15, BK) + rect(8, 27, 4, 3, BK);
    return s + '</svg>';
  };
  const fistSVG = (): string => {
    const SK = '#ffd9c4', SD = '#e0a884', INK = '#7a4a36';
    let s = '<svg viewBox="0 0 16 14" width="30" height="26" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(2, 2, 12, 10, SK) + rect(2, 2, 12, 1, '#fff') + rect(2, 11, 12, 1, INK);
    s += rect(13, 3, 2, 2, SD) + rect(13, 6, 2, 2, SD) + rect(13, 9, 2, 2, SD);
    s += rect(4, 4, 8, 1, SD) + rect(4, 7, 8, 1, SD) + rect(0, 4, 2, 6, SD);
    return s + '</svg>';
  };
  const sharinganSVG = (): string => {
    const R = '#c0142a', RD = '#7a0c1a', BK = '#140206', W = '#ffd6dd';
    let s = '<svg viewBox="0 0 18 18" width="30" height="30" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(5, 1, 8, 1, W) + rect(3, 2, 12, 1, W) + rect(2, 3, 14, 2, W) + rect(1, 5, 16, 8, W) + rect(2, 13, 14, 2, W) + rect(3, 15, 12, 1, W) + rect(5, 16, 8, 1, W);
    s += rect(5, 4, 8, 2, R) + rect(4, 6, 10, 6, R) + rect(5, 12, 8, 2, R) + rect(7, 6, 4, 6, RD) + rect(8, 8, 2, 2, BK);
    s += rect(8, 4, 2, 2, BK) + rect(12, 8, 2, 2, BK) + rect(6, 11, 2, 2, BK);
    return s + '</svg>';
  };
  const crowSVG = (): string => {
    const B = '#0c0a10';
    return '<svg viewBox="0 0 10 6" width="14" height="9" shape-rendering="crispEdges" style="display:block;overflow:visible">' +
      rect(4, 2, 2, 3, B) + rect(0, 1, 4, 1, B) + rect(6, 1, 4, 1, B) + rect(1, 0, 2, 1, B) + rect(7, 0, 2, 1, B) + '</svg>';
  };

  // ---- Anime Ultimates U–Z: pixel-art props -----------------------------
  const susanooSVG = (): string => {
    const A = '#5fc8ff', A2 = '#8fdcff', D = '#2f6fb0', BL = '#d6f4ff', H = '#1c4f86';
    let s = '<svg viewBox="0 0 40 46" width="64" height="74" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(16, 2, 8, 6, A) + rect(17, 3, 6, 3, H) + rect(13, 0, 3, 4, A2) + rect(24, 0, 3, 4, A2);
    s += rect(17, 4, 2, 1, BL) + rect(21, 4, 2, 1, BL);
    s += rect(10, 9, 20, 14, A) + rect(8, 10, 3, 9, D) + rect(29, 10, 3, 9, D);
    s += rect(13, 12, 14, 9, H) + rect(14, 13, 12, 1, A2) + rect(14, 16, 12, 1, A2) + rect(14, 19, 12, 1, A2);
    s += rect(12, 23, 16, 8, A) + rect(13, 31, 14, 4, D);
    s += rect(6, 11, 4, 12, A) + rect(6, 23, 4, 5, A2);
    s += rect(30, 6, 4, 10, A) + rect(31, 2, 3, 6, A2);
    s += rect(33, -12, 3, 18, BL) + rect(34, -12, 1, 18, '#ffffff') + rect(32, 4, 5, 2, D);
    return s + '</svg>';
  };
  const exodiaSVG = (): string => {
    const G = '#e9c44c', GD = '#a9801f', SK = '#f0d98a', INK = '#3a2a08', GL = '#fff3c0';
    let s = '<svg viewBox="0 0 34 40" width="52" height="61" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(11, 4, 12, 8, SK) + rect(13, 6, 8, 4, GD) + rect(8, 1, 4, 5, G) + rect(22, 1, 4, 5, G);
    s += rect(13, 6, 2, 2, INK) + rect(19, 6, 2, 2, INK);
    s += rect(7, 12, 20, 16, G) + rect(5, 13, 3, 11, GD) + rect(26, 13, 3, 11, GD);
    s += rect(10, 15, 14, 10, GD) + rect(14, 17, 6, 6, GL);
    s += rect(2, 14, 3, 9, SK) + rect(29, 14, 3, 9, SK);
    s += rect(11, 28, 5, 10, G) + rect(18, 28, 5, 10, G);
    return s + '</svg>';
  };
  const killerQueenSVG = (): string => {
    const P = '#f04d8f', PD = '#b32560', SK = '#ffe0ec', INK = '#3a1020', G = '#ffd23f';
    let s = '<svg viewBox="0 0 26 38" width="38" height="56" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(8, 0, 10, 3, G) + rect(7, 3, 12, 8, P) + rect(9, 5, 8, 4, SK);
    s += rect(10, 6, 2, 2, INK) + rect(14, 6, 2, 2, INK) + rect(11, 9, 4, 1, INK);
    s += rect(6, 11, 14, 12, P) + rect(8, 13, 10, 8, PD);
    s += rect(3, 12, 3, 10, P) + rect(20, 12, 3, 10, P) + rect(2, 21, 3, 4, SK) + rect(21, 21, 3, 4, SK);
    s += rect(8, 23, 4, 13, P) + rect(14, 23, 4, 13, P);
    return s + '</svg>';
  };
  const thunderSVG = (color: string, white: string): string => {
    let s = '<svg viewBox="0 0 10 26" width="15" height="39" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(4, 0, 3, 6, color) + rect(2, 5, 3, 5, color) + rect(5, 9, 3, 6, color) + rect(2, 14, 3, 6, color) + rect(4, 19, 3, 7, color);
    s += rect(5, 1, 1, 5, white) + rect(3, 6, 1, 4, white) + rect(6, 10, 1, 5, white) + rect(3, 15, 1, 5, white);
    s += rect(0, 9, 2, 2, color) + rect(8, 16, 2, 2, color);
    return s + '</svg>';
  };
  const standDioSVG = (): string => {
    const Y = '#ffd23f', YD = '#b8901f', SK = '#ffe6c4', INK = '#3a2a10', G = '#d6a020';
    let s = '<svg viewBox="0 0 24 38" width="34" height="54" shape-rendering="crispEdges" style="display:block;overflow:visible">';
    s += rect(8, 0, 8, 3, Y) + rect(7, 3, 10, 7, SK) + rect(9, 5, 2, 2, INK) + rect(13, 5, 2, 2, INK);
    s += rect(6, 10, 12, 12, Y) + rect(8, 12, 8, 8, YD);
    s += rect(3, 11, 3, 10, Y) + rect(18, 11, 3, 10, Y) + rect(2, 6, 3, 6, SK) + rect(19, 6, 3, 6, SK);
    s += rect(8, 22, 4, 14, Y) + rect(14, 22, 4, 14, Y) + rect(6, 8, 12, 1, G);
    return s + '</svg>';
  };

  // ===================================================================
  // ANIME ULTIMATES — Alt+Shift A–E. Each freezes her patrol (CSS pins
  // .trk/.flip while the alpha-* class is on) so she PAUSES IN PLACE,
  // sets a held pose via casting/castPose, and layers pixel-art props.
  // ===================================================================

  // A — Mahoraga's adapting wheel spins over her head.
  const fireAdapt = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'smug';
    root.classList.remove('alpha-adapt');
    void root.offsetWidth;
    root.classList.add('alpha-adapt');
    syncPose();
    showBubble("Naah, I'd Adapt.");
    if (!reducedMotion()) {
      const wheel = document.createElement('span');
      wheel.className = 'mh-wheel';
      wheel.innerHTML = wheelSVG();
      pillspot.appendChild(wheel);
      window.setTimeout(() => wheel.remove(), 1950);
      for (let i = 0; i < 7; i++) {
        const sp = document.createElement('span');
        sp.className = 'adapt-spark';
        sp.style.left = `${14 + i * 4}px`;
        sp.style.setProperty('--d', `${(0.2 + Math.random() * 0.5).toFixed(2)}s`);
        sp.style.setProperty('--x', `${(i - 3) * 6}px`);
        sp.style.setProperty('--y', `${(-14 - Math.random() * 14).toFixed(0)}px`);
        pillspot.appendChild(sp);
        window.setTimeout(() => sp.remove(), 1500);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1900);
  };

  // B — pixel cleaver in hand throws the Getsuga Tenshō crescent.
  const fireGetsuga = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'swing';
    root.classList.remove('alpha-getsuga');
    void root.offsetWidth;
    root.classList.add('alpha-getsuga');
    syncPose();
    showBubble('Getsuga… Tenshō!');
    if (!reducedMotion()) {
      const sword = document.createElement('span');
      sword.className = 'gt-sword';
      sword.innerHTML = swordSVG();
      pillspot.appendChild(sword);
      window.setTimeout(() => sword.remove(), 1200);
      const cres = document.createElement('span');
      cres.className = 'gt-cres';
      cres.innerHTML = crescentSVG();
      pillspot.appendChild(cres);
      window.setTimeout(() => cres.remove(), 1500);
      for (let i = 0; i < 7; i++) {
        const sp = document.createElement('span');
        sp.className = 'gt-spark';
        sp.style.left = `${16 + i * 4}px`;
        sp.style.setProperty('--d', `${(0.5 + i * 0.04).toFixed(2)}s`);
        sp.style.setProperty('--x', `${20 + i * 7}px`);
        sp.style.setProperty('--y', `${((i % 2 ? -1 : 1) * (4 + Math.random() * 7)).toFixed(0)}px`);
        pillspot.appendChild(sp);
        window.setTimeout(() => sp.remove(), 1500);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1450);
  };

  // C — optic eye-beams.
  const fireCyclops = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'visor';
    root.classList.remove('alpha-cyclops');
    void root.offsetWidth;
    root.classList.add('alpha-cyclops');
    syncPose();
    showBubble('Hands off the visor.');
    if (!reducedMotion()) {
      const visor = document.createElement('span');
      visor.className = 'optic-visor';
      pillspot.appendChild(visor);
      window.setTimeout(() => visor.remove(), 1150);
      for (let i = 0; i < 2; i++) {
        const beam = document.createElement('span');
        beam.className = 'optic-beam';
        beam.style.bottom = `calc(100% + ${i === 0 ? 15 : 11}px)`;
        beam.style.setProperty('--d', `${(0.12 + i * 0.05).toFixed(2)}s`);
        pillspot.appendChild(beam);
        window.setTimeout(() => beam.remove(), 1100);
      }
      for (let i = 0; i < 6; i++) {
        const imp = document.createElement('span');
        imp.className = 'optic-impact';
        imp.style.left = `${88 + (i % 3) * 8}px`;
        imp.style.bottom = `calc(100% + ${10 + (i % 2) * 4}px)`;
        imp.style.setProperty('--d', `${(0.34 + i * 0.05).toFixed(2)}s`);
        pillspot.appendChild(imp);
        window.setTimeout(() => imp.remove(), 1100);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1150);
  };

  // D — Ultra-Instinct dodge with silver pixel after-images.
  const fireInstinct = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'dodge';
    root.classList.remove('alpha-instinct');
    void root.offsetWidth;
    root.classList.add('alpha-instinct');
    syncPose();
    showBubble('…you missed.');
    if (!reducedMotion()) {
      const spriteHtml = flip.innerHTML;
      for (let i = 0; i < 4; i++) {
        const ghost = document.createElement('span');
        ghost.className = 'ui-ghost';
        ghost.innerHTML = spriteHtml;
        ghost.style.setProperty('--d', `${(i * 0.09).toFixed(2)}s`);
        ghost.style.setProperty('--x', `${(i % 2 ? 1 : -1) * (12 + i * 7)}px`);
        pillspot.appendChild(ghost);
        window.setTimeout(() => ghost.remove(), 1300);
      }
      for (let i = 0; i < 9; i++) {
        const sp = document.createElement('span');
        sp.className = 'ui-spark';
        sp.style.left = `${12 + i * 4}px`;
        sp.style.setProperty('--d', `${(Math.random() * 0.6).toFixed(2)}s`);
        sp.style.setProperty('--x', `${(i - 4) * 5}px`);
        sp.style.setProperty('--y', `${(-12 - Math.random() * 14).toFixed(0)}px`);
        pillspot.appendChild(sp);
        window.setTimeout(() => sp.remove(), 1500);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1500);
  };

  // E — Super Saiyan: hair flips gold (CSS) and a pixel flame aura erupts.
  const fireSaiyan = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'cheer';
    root.classList.remove('alpha-saiyan');
    void root.offsetWidth;
    root.classList.add('alpha-saiyan');
    syncPose();
    showBubble('Haaaa—!!');
    if (!reducedMotion()) {
      const aura = document.createElement('span');
      aura.className = 'ss-aura';
      aura.innerHTML =
        `<span class="ss-frame ss-f0">${flameSVG(0)}</span>` +
        `<span class="ss-frame ss-f1">${flameSVG(1)}</span>`;
      pillspot.appendChild(aura);
      window.setTimeout(() => aura.remove(), 2000);
      const flash = document.createElement('span');
      flash.className = 'ss-flash';
      pillspot.appendChild(flash);
      window.setTimeout(() => flash.remove(), 600);
      for (let i = 0; i < 14; i++) {
        const sp = document.createElement('span');
        sp.className = 'ss-spark';
        sp.style.left = `${(8 + i * 2.6).toFixed(0)}px`;
        sp.style.setProperty('--d', `${(Math.random() * 1.1).toFixed(2)}s`);
        sp.style.setProperty('--x', `${(i - 7) * 4}px`);
        sp.style.setProperty('--y', `${(-26 - Math.random() * 28).toFixed(0)}px`);
        pillspot.appendChild(sp);
        window.setTimeout(() => sp.remove(), 2200);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1950);
  };

  // F — Sukuna's Fuga (furnace): a forward gout of pixel fire.
  const fireFuga = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'roar';
    root.classList.remove('alpha-fuga');
    void root.offsetWidth;
    root.classList.add('alpha-fuga');
    syncPose();
    showBubble('Fuga.');
    if (!reducedMotion()) {
      const blast = document.createElement('span');
      blast.className = 'fuga-blast';
      blast.innerHTML =
        `<span class="fuga-frame fuga-f0">${fireCloudSVG(0)}</span>` +
        `<span class="fuga-frame fuga-f1">${fireCloudSVG(1)}</span>`;
      pillspot.appendChild(blast);
      window.setTimeout(() => blast.remove(), 1750);
      for (let i = 0; i < 11; i++) {
        const e = document.createElement('span');
        e.className = 'fuga-ember';
        e.style.left = `${40 + i * 4}px`;
        e.style.bottom = `calc(100% + ${3 + (i % 3) * 6}px)`;
        e.style.setProperty('--d', `${(0.15 + Math.random() * 0.5).toFixed(2)}s`);
        e.style.setProperty('--x', `${(24 + Math.random() * 30).toFixed(0)}px`);
        e.style.setProperty('--y', `${((i % 2 ? -1 : 1) * (6 + Math.random() * 14)).toFixed(0)}px`);
        pillspot.appendChild(e);
        window.setTimeout(() => e.remove(), 1700);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1700);
  };

  // G — Gintama: Elizabeth pops up with a placard, deadpan.
  const fireGin = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'deadpan';
    root.classList.remove('alpha-gin');
    void root.offsetWidth;
    root.classList.add('alpha-gin');
    syncPose();
    showBubble('…five more minutes.');
    if (!reducedMotion()) {
      const eliza = document.createElement('span');
      eliza.className = 'gin-eliza';
      eliza.innerHTML = elizaSVG();
      pillspot.appendChild(eliza);
      window.setTimeout(() => eliza.remove(), 1650);
      for (let i = 0; i < 3; i++) {
        const m = document.createElement('span');
        m.className = 'gin-mark';
        m.textContent = '…';
        m.style.left = `${16 + i * 11}px`;
        m.style.setProperty('--d', `${(i * 0.2).toFixed(2)}s`);
        pillspot.appendChild(m);
        window.setTimeout(() => m.remove(), 1500);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1600);
  };

  // I — Deku Full Cowl: red + green pixel lightning and a faint green aura.
  const fireCowl = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'charge';
    root.classList.remove('alpha-cowl');
    void root.offsetWidth;
    root.classList.add('alpha-cowl');
    syncPose();
    showBubble('Full Cowl!');
    if (!reducedMotion()) {
      const aura = document.createElement('span');
      aura.className = 'cowl-aura';
      pillspot.appendChild(aura);
      window.setTimeout(() => aura.remove(), 1550);
      for (let i = 0; i < 9; i++) {
        const b = document.createElement('span');
        b.className = 'cowl-bolt';
        b.innerHTML = boltSVG(i % 2 === 0 ? '#5dff7a' : '#ff5a5a');
        b.style.left = `${7 + i * 4}px`;
        b.style.bottom = `calc(100% - ${2 + (i % 4) * 9}px)`;
        b.style.transform = `rotate(${(i % 2 ? 1 : -1) * (10 + i * 7)}deg)`;
        b.style.setProperty('--d', `${(0.08 + i * 0.11).toFixed(2)}s`);
        pillspot.appendChild(b);
        window.setTimeout(() => b.remove(), 1500);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1500);
  };

  // J — JoJo stand (Star Platinum-style) with an ORA flurry.
  const fireStand = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'point';
    root.classList.remove('alpha-stand');
    void root.offsetWidth;
    root.classList.add('alpha-stand');
    syncPose();
    showBubble('Your stand has the same ability as mine.');
    if (!reducedMotion()) {
      const stand = document.createElement('span');
      stand.className = 'stand-body';
      stand.innerHTML = standSVG();
      pillspot.appendChild(stand);
      window.setTimeout(() => stand.remove(), 1950);
      for (let i = 0; i < 6; i++) {
        const f = document.createElement('span');
        f.className = 'stand-fist';
        f.style.left = `${44 + i * 5}px`;
        f.style.bottom = `calc(100% + ${6 + (i % 3) * 7}px)`;
        f.style.setProperty('--d', `${(0.5 + i * 0.08).toFixed(2)}s`);
        pillspot.appendChild(f);
        window.setTimeout(() => f.remove(), 1900);
      }
      for (let i = 0; i < 4; i++) {
        const o = document.createElement('span');
        o.className = 'ora-bit';
        o.textContent = 'ORA';
        o.style.left = `${50 + i * 9}px`;
        o.style.bottom = `calc(100% + ${14 + i * 5}px)`;
        o.style.setProperty('--d', `${(0.6 + i * 0.13).toFixed(2)}s`);
        pillspot.appendChild(o);
        window.setTimeout(() => o.remove(), 1900);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1900);
  };

  // U — Madara's Perfect Susanoo + a blade slash.
  const fireSusanoo = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'point';
    root.classList.remove('alpha-susanoo');
    void root.offsetWidth;
    root.classList.add('alpha-susanoo');
    syncPose();
    showBubble('Susanoo.');
    if (!reducedMotion()) {
      const body = document.createElement('span');
      body.className = 'su-body';
      body.innerHTML = susanooSVG();
      pillspot.appendChild(body);
      window.setTimeout(() => body.remove(), 2000);
      const slash = document.createElement('span');
      slash.className = 'su-slash';
      pillspot.appendChild(slash);
      window.setTimeout(() => slash.remove(), 1950);
      for (let i = 0; i < 9; i++) {
        const sp = document.createElement('span');
        sp.className = 'su-spark';
        sp.style.left = `${54 + i * 5}px`;
        sp.style.bottom = `calc(100% + ${4 + (i % 3) * 8}px)`;
        sp.style.setProperty('--d', `${(0.6 + i * 0.04).toFixed(2)}s`);
        sp.style.setProperty('--x', `${18 + i * 5}px`);
        sp.style.setProperty('--y', `${((i % 2 ? -1 : 1) * (5 + Math.random() * 9)).toFixed(0)}px`);
        pillspot.appendChild(sp);
        window.setTimeout(() => sp.remove(), 1950);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1950);
  };

  // V — Vegeta's Final Flash (charge + huge beam).
  const fireFinalFlash = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'flash';
    root.classList.remove('alpha-flash');
    void root.offsetWidth;
    root.classList.add('alpha-flash');
    syncPose();
    showBubble('Final… Flash!');
    if (!reducedMotion()) {
      (['ff-charge', 'ff-beam', 'ff-core'] as const).forEach((cls) => {
        const n = document.createElement('span');
        n.className = cls;
        pillspot.appendChild(n);
        window.setTimeout(() => n.remove(), cls === 'ff-charge' ? 1000 : 1850);
      });
      for (let i = 0; i < 12; i++) {
        const sp = document.createElement('span');
        sp.className = 'ff-spark';
        sp.style.left = `${36 + i * 2}px`;
        sp.style.bottom = `calc(100% + ${4 + (i % 4) * 6}px)`;
        sp.style.setProperty('--d', `${(0.7 + Math.random() * 0.6).toFixed(2)}s`);
        sp.style.setProperty('--x', `${(24 + Math.random() * 28).toFixed(0)}px`);
        sp.style.setProperty('--y', `${((i % 2 ? -1 : 1) * (4 + Math.random() * 12)).toFixed(0)}px`);
        pillspot.appendChild(sp);
        window.setTimeout(() => sp.remove(), 1850);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1850);
  };

  // W — Dio: ZA WARUDO, time freezes.
  const fireZaWarudo = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'menace';
    root.classList.remove('alpha-zawarudo');
    void root.offsetWidth;
    root.classList.add('alpha-zawarudo');
    syncPose();
    showBubble('ZA WARUDO!');
    if (!reducedMotion()) {
      const freeze = document.createElement('span');
      freeze.className = 'zw-freeze';
      pillspot.appendChild(freeze);
      window.setTimeout(() => freeze.remove(), 2050);
      const dio = document.createElement('span');
      dio.className = 'zw-dio';
      dio.innerHTML = standDioSVG();
      pillspot.appendChild(dio);
      window.setTimeout(() => dio.remove(), 2050);
      for (let i = 0; i < 7; i++) {
        const t = document.createElement('span');
        t.className = 'zw-tick';
        t.textContent = '|';
        t.style.left = `${10 + i * 14}px`;
        t.style.bottom = `calc(100% + ${8 + (i % 2) * 10}px)`;
        t.style.setProperty('--d', `${(0.3 + i * 0.05).toFixed(2)}s`);
        pillspot.appendChild(t);
        window.setTimeout(() => t.remove(), 2050);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 2000);
  };

  // X — summons Exodia, "Obliterate" flash + cards + rays.
  const fireExodia = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'raise';
    root.classList.remove('alpha-exodia');
    void root.offsetWidth;
    root.classList.add('alpha-exodia');
    syncPose();
    showBubble('Exodia — Obliterate!');
    if (!reducedMotion()) {
      const body = document.createElement('span');
      body.className = 'ex-body';
      body.innerHTML = exodiaSVG();
      pillspot.appendChild(body);
      window.setTimeout(() => body.remove(), 2050);
      const flash = document.createElement('span');
      flash.className = 'ex-flash';
      pillspot.appendChild(flash);
      window.setTimeout(() => flash.remove(), 1200);
      for (let i = 0; i < 5; i++) {
        const c = document.createElement('span');
        c.className = 'ex-card';
        c.style.left = `${8 + i * 7}px`;
        c.style.setProperty('--d', `${(0.1 + i * 0.1).toFixed(2)}s`);
        c.style.setProperty('--r', `${(i - 2) * 9}deg`);
        pillspot.appendChild(c);
        window.setTimeout(() => c.remove(), 2050);
      }
      for (let i = 0; i < 8; i++) {
        const r = document.createElement('span');
        r.className = 'ex-ray';
        r.style.left = `${4 + i * 7}px`;
        r.style.setProperty('--d', `${(0.6 + i * 0.04).toFixed(2)}s`);
        pillspot.appendChild(r);
        window.setTimeout(() => r.remove(), 2050);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 2000);
  };

  // Y — Killer Queen detonation (blast + debris).
  const fireKillerQueen = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'point';
    root.classList.remove('alpha-kqueen');
    void root.offsetWidth;
    root.classList.add('alpha-kqueen');
    syncPose();
    showBubble('Killer Queen. Touch it… boom.');
    if (!reducedMotion()) {
      const kq = document.createElement('span');
      kq.className = 'kq-body';
      kq.innerHTML = killerQueenSVG();
      pillspot.appendChild(kq);
      window.setTimeout(() => kq.remove(), 1850);
      (['kq-blast', 'kq-ring'] as const).forEach((cls) => {
        const n = document.createElement('span');
        n.className = cls;
        pillspot.appendChild(n);
        window.setTimeout(() => n.remove(), 1800);
      });
      for (let i = 0; i < 10; i++) {
        const b = document.createElement('span');
        b.className = 'kq-bit';
        b.style.left = `${78 + (i % 4) * 4}px`;
        b.style.bottom = `calc(100% + ${6 + (i % 3) * 7}px)`;
        b.style.setProperty('--d', `${(0.72 + i * 0.02).toFixed(2)}s`);
        b.style.setProperty('--x', `${((i % 2 ? 1 : -1) * (10 + Math.random() * 22)).toFixed(0)}px`);
        b.style.setProperty('--y', `${(-10 - Math.random() * 20).toFixed(0)}px`);
        pillspot.appendChild(b);
        window.setTimeout(() => b.remove(), 1800);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1800);
  };

  // Z — Zenitsu's Seventh Form: Flaming Thunder God.
  const fireZenitsu = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'swing';
    root.classList.remove('alpha-zenitsu');
    void root.offsetWidth;
    root.classList.add('alpha-zenitsu');
    syncPose();
    showBubble('Seventh Form: Flaming Thunder God!');
    if (!reducedMotion()) {
      const sword = document.createElement('span');
      sword.className = 'zn-sword';
      sword.innerHTML = thunderSVG('#ffe24a', '#fff');
      pillspot.appendChild(sword);
      window.setTimeout(() => sword.remove(), 1300);
      const dash = document.createElement('span');
      dash.className = 'zn-dash';
      pillspot.appendChild(dash);
      window.setTimeout(() => dash.remove(), 1700);
      for (let i = 0; i < 8; i++) {
        const b = document.createElement('span');
        b.className = 'zn-bolt';
        b.innerHTML = thunderSVG(i % 3 === 0 ? '#fff6c0' : '#ffe24a', '#ffffff');
        b.style.left = `${16 + i * 9}px`;
        b.style.bottom = `calc(100% - ${2 + (i % 4) * 9}px)`;
        b.style.transform = `rotate(${(i % 2 ? 1 : -1) * (12 + i * 6)}deg)`;
        b.style.setProperty('--d', `${(0.1 + i * 0.1).toFixed(2)}s`);
        pillspot.appendChild(b);
        window.setTimeout(() => b.remove(), 1700);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1700);
  };

  // K — Flame Breathing Ninth Form: Rengoku (flaming katana + fire slash).
  const fireRengoku = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'swing';
    root.classList.remove('alpha-rengoku');
    void root.offsetWidth;
    root.classList.add('alpha-rengoku');
    syncPose();
    showBubble('Ninth Form: Rengoku!');
    if (!reducedMotion()) {
      const sword = document.createElement('span');
      sword.className = 'rg-sword';
      sword.innerHTML = katanaSVG();
      pillspot.appendChild(sword);
      window.setTimeout(() => sword.remove(), 1300);
      const slash = document.createElement('span');
      slash.className = 'rg-slash';
      slash.innerHTML = flameSlashSVG();
      pillspot.appendChild(slash);
      window.setTimeout(() => slash.remove(), 1600);
      for (let i = 0; i < 10; i++) {
        const e = document.createElement('span');
        e.className = 'rg-ember';
        e.style.left = `${30 + i * 5}px`;
        e.style.bottom = `calc(100% + ${4 + (i % 3) * 7}px)`;
        e.style.setProperty('--d', `${(0.42 + i * 0.05).toFixed(2)}s`);
        e.style.setProperty('--x', `${(24 + Math.random() * 28).toFixed(0)}px`);
        e.style.setProperty('--y', `${((i % 2 ? -1 : 1) * (4 + Math.random() * 12)).toFixed(0)}px`);
        pillspot.appendChild(e);
        window.setTimeout(() => e.remove(), 1600);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1600);
  };

  // L — Gear 5 Nika: white jacket, toon-white look, liberation rings.
  const fireNika = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'cheer';
    root.classList.remove('alpha-nika');
    void root.offsetWidth;
    root.classList.add('alpha-nika');
    syncPose();
    showBubble('Drums of Liberation!');
    if (!reducedMotion()) {
      const jacket = document.createElement('span');
      jacket.className = 'nika-jacket';
      jacket.innerHTML = jacketSVG();
      pillspot.appendChild(jacket);
      window.setTimeout(() => jacket.remove(), 1700);
      for (let i = 0; i < 3; i++) {
        const r = document.createElement('span');
        r.className = 'nika-ring';
        r.style.setProperty('--d', `${(i * 0.22).toFixed(2)}s`);
        pillspot.appendChild(r);
        window.setTimeout(() => r.remove(), 1700);
      }
      for (let i = 0; i < 6; i++) {
        const p = document.createElement('span');
        p.className = 'nika-pop';
        p.style.left = `${12 + i * 5}px`;
        p.style.setProperty('--d', `${(Math.random() * 0.5).toFixed(2)}s`);
        p.style.setProperty('--x', `${((i - 3) * 7).toFixed(0)}px`);
        p.style.setProperty('--y', `${(-16 - Math.random() * 16).toFixed(0)}px`);
        pillspot.appendChild(p);
        window.setTimeout(() => p.remove(), 1700);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1700);
  };

  // M — Mahito Domain Expansion: Self-Embodiment of Perfection.
  const fireDomain = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'cast';
    root.classList.remove('alpha-domain');
    void root.offsetWidth;
    root.classList.add('alpha-domain');
    syncPose();
    showBubble('Self-Embodiment of Perfection.');
    if (!reducedMotion()) {
      ['dom-sphere', 'dom-sphere dom-sphere2', 'dom-eye'].forEach((cls) => {
        const n = document.createElement('span');
        n.className = cls;
        pillspot.appendChild(n);
        window.setTimeout(() => n.remove(), 1950);
      });
      for (let i = 0; i < 5; i++) {
        const h = document.createElement('span');
        h.className = 'dom-hand';
        h.innerHTML = handSVG(i % 2 ? '#b8a0a8' : '#9a8088');
        h.style.left = `${8 + i * 9}px`;
        h.style.bottom = `calc(100% + ${(i % 3) * 11}px)`;
        h.style.setProperty('--d', `${(0.4 + i * 0.12).toFixed(2)}s`);
        h.style.setProperty('--r', `${(i % 2 ? 1 : -1) * 14}deg`);
        pillspot.appendChild(h);
        window.setTimeout(() => h.remove(), 1900);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1900);
  };

  // N — Return by Death: rewinding clock + the Witch's shadow hand.
  const fireSubaru = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'clutch';
    root.classList.remove('alpha-subaru');
    void root.offsetWidth;
    root.classList.add('alpha-subaru');
    syncPose();
    showBubble('Return by Death.');
    if (!reducedMotion()) {
      const clock = document.createElement('span');
      clock.className = 'rbd-clock';
      clock.innerHTML = clockSVG();
      pillspot.appendChild(clock);
      window.setTimeout(() => clock.remove(), 1700);
      const hand = document.createElement('span');
      hand.className = 'rbd-hand';
      hand.innerHTML = handSVG('#120a16');
      pillspot.appendChild(hand);
      window.setTimeout(() => hand.remove(), 1700);
      for (let i = 0; i < 8; i++) {
        const m = document.createElement('span');
        m.className = 'rbd-mist';
        m.style.left = `${6 + i * 4}px`;
        m.style.bottom = `calc(100% - ${4 + (i % 3) * 8}px)`;
        m.style.setProperty('--d', `${(Math.random() * 0.6).toFixed(2)}s`);
        m.style.setProperty('--y', `${(-12 - Math.random() * 14).toFixed(0)}px`);
        pillspot.appendChild(m);
        window.setTimeout(() => m.remove(), 1700);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1700);
  };

  // O — summons Rika and fires the love beam.
  const fireRika = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'point';
    root.classList.remove('alpha-rika');
    void root.offsetWidth;
    root.classList.add('alpha-rika');
    syncPose();
    showBubble('Rika — love beam!');
    if (!reducedMotion()) {
      const rika = document.createElement('span');
      rika.className = 'rika-body';
      rika.innerHTML = rikaSVG();
      pillspot.appendChild(rika);
      window.setTimeout(() => rika.remove(), 1850);
      const beam = document.createElement('span');
      beam.className = 'rika-beam';
      pillspot.appendChild(beam);
      window.setTimeout(() => beam.remove(), 1800);
      for (let i = 0; i < 7; i++) {
        const h = document.createElement('span');
        h.className = 'rika-heart';
        h.textContent = '♥';
        h.style.left = `${52 + i * 5}px`;
        h.style.bottom = `calc(100% + ${6 + (i % 3) * 7}px)`;
        h.style.setProperty('--d', `${(0.5 + i * 0.06).toFixed(2)}s`);
        h.style.setProperty('--x', `${18 + i * 5}px`);
        pillspot.appendChild(h);
        window.setTimeout(() => h.remove(), 1800);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1800);
  };

  // P — Pain's Planetary Devastation (forming planetoid + rising debris).
  const firePlanetary = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'raise';
    root.classList.remove('alpha-pain');
    void root.offsetWidth;
    root.classList.add('alpha-pain');
    syncPose();
    showBubble('Chibaku Tensei.');
    if (!reducedMotion()) {
      const planet = document.createElement('span');
      planet.className = 'pn-planet';
      planet.innerHTML = planetSVG();
      pillspot.appendChild(planet);
      window.setTimeout(() => planet.remove(), 1950);
      for (let i = 0; i < 9; i++) {
        const r = document.createElement('span');
        r.className = 'pn-rock';
        r.innerHTML = rockSVG();
        r.style.left = `${8 + i * 6}px`;
        r.style.setProperty('--d', `${(0.2 + i * 0.06).toFixed(2)}s`);
        r.style.setProperty('--x', `${((4 - i) * 3).toFixed(0)}px`);
        pillspot.appendChild(r);
        window.setTimeout(() => r.remove(), 1900);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1900);
  };

  // Q — Harley Quinn hammer bash (mallet swing + BAM).
  const fireHarley = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'smash';
    root.classList.remove('alpha-harley');
    void root.offsetWidth;
    root.classList.add('alpha-harley');
    syncPose();
    showBubble('Hammer time!');
    if (!reducedMotion()) {
      const mallet = document.createElement('span');
      mallet.className = 'hq-mallet';
      mallet.innerHTML = malletSVG();
      pillspot.appendChild(mallet);
      window.setTimeout(() => mallet.remove(), 1100);
      const bam = document.createElement('span');
      bam.className = 'hq-bam';
      bam.textContent = 'BAM!';
      pillspot.appendChild(bam);
      window.setTimeout(() => bam.remove(), 1100);
      for (let i = 0; i < 6; i++) {
        const st = document.createElement('span');
        st.className = 'hq-star';
        st.textContent = i % 2 ? '✦' : '★';
        st.style.left = `${30 + i * 6}px`;
        st.style.bottom = `calc(100% + ${2 + (i % 3) * 6}px)`;
        st.style.setProperty('--d', `${(0.42 + i * 0.04).toFixed(2)}s`);
        st.style.setProperty('--x', `${10 + i * 5}px`);
        st.style.setProperty('--y', `${(i % 2 ? -1 : 1) * 10}px`);
        pillspot.appendChild(st);
        window.setTimeout(() => st.remove(), 1200);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1300);
  };

  // R — Zoro's Demon Onigiri, green-tinted triple slash.
  const fireZoro = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'swing';
    root.classList.remove('alpha-zoro');
    void root.offsetWidth;
    root.classList.add('alpha-zoro');
    syncPose();
    showBubble('Oni Giri!');
    if (!reducedMotion()) {
      for (let i = 0; i < 3; i++) {
        const sl = document.createElement('span');
        sl.className = `zo-slash zo-${i}`;
        sl.style.setProperty('--d', `${(i * 0.08).toFixed(2)}s`);
        pillspot.appendChild(sl);
        window.setTimeout(() => sl.remove(), 1000);
      }
      const flash = document.createElement('span');
      flash.className = 'zo-flash';
      pillspot.appendChild(flash);
      window.setTimeout(() => flash.remove(), 700);
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1200);
  };

  // S — Saitama's serious punch (fist + shockwave).
  const fireSaitama = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'punch';
    root.classList.remove('alpha-saitama');
    void root.offsetWidth;
    root.classList.add('alpha-saitama');
    syncPose();
    showBubble('Serious punch.');
    if (!reducedMotion()) {
      const fist = document.createElement('span');
      fist.className = 'st-fist';
      fist.innerHTML = fistSVG();
      pillspot.appendChild(fist);
      window.setTimeout(() => fist.remove(), 1000);
      const shock = document.createElement('span');
      shock.className = 'st-shock';
      pillspot.appendChild(shock);
      window.setTimeout(() => shock.remove(), 1100);
      for (let i = 0; i < 6; i++) {
        const ln = document.createElement('span');
        ln.className = 'st-line';
        ln.style.bottom = `calc(100% - ${(i % 3) * 9}px)`;
        ln.style.setProperty('--d', `${(0.2 + i * 0.03).toFixed(2)}s`);
        pillspot.appendChild(ln);
        window.setTimeout(() => ln.remove(), 1100);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1300);
  };

  // T — Itachi's Tsukuyomi (Sharingan, red moon, crows).
  const fireItachi = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'genjutsu';
    root.classList.remove('alpha-itachi');
    void root.offsetWidth;
    root.classList.add('alpha-itachi');
    syncPose();
    showBubble('Tsukuyomi.');
    if (!reducedMotion()) {
      const eye = document.createElement('span');
      eye.className = 'it-eye';
      eye.innerHTML = sharinganSVG();
      pillspot.appendChild(eye);
      window.setTimeout(() => eye.remove(), 1850);
      const moon = document.createElement('span');
      moon.className = 'it-moon';
      pillspot.appendChild(moon);
      window.setTimeout(() => moon.remove(), 1850);
      for (let i = 0; i < 6; i++) {
        const c = document.createElement('span');
        c.className = 'it-crow';
        c.innerHTML = crowSVG();
        c.style.left = `${8 + i * 9}px`;
        c.style.bottom = `calc(100% + ${4 + (i % 3) * 9}px)`;
        c.style.setProperty('--d', `${(Math.random() * 0.7).toFixed(2)}s`);
        c.style.setProperty('--x', `${-18 - i * 4}px`);
        c.style.setProperty('--y', `${((i % 2 ? -1 : 1) * (6 + Math.random() * 10)).toFixed(0)}px`);
        pillspot.appendChild(c);
        window.setTimeout(() => c.remove(), 1850);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1850);
  };

  // H — Hollow Purple: red + blue orbs converge into a purple sphere + beam.
  const fireHollow = () => {
    clearIdleTimers();
    idleStage = null;
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    casting = true;
    castPose = 'cast';
    root.classList.remove('alpha-hollow');
    void root.offsetWidth;
    root.classList.add('alpha-hollow');
    syncPose();
    showBubble('Hollow… Purple.');
    if (!reducedMotion()) {
      ['hp-orb hp-red', 'hp-orb hp-blue', 'hp-purple', 'hp-beam'].forEach((cls) => {
        const n = document.createElement('span');
        n.className = cls;
        pillspot.appendChild(n);
        window.setTimeout(() => n.remove(), 1600);
      });
      for (let i = 0; i < 9; i++) {
        const sp = document.createElement('span');
        sp.className = 'hp-spark';
        sp.style.left = `${58 + i * 5}px`;
        sp.style.bottom = `calc(100% + ${5 + (i % 3) * 6}px)`;
        sp.style.setProperty('--d', `${(0.62 + i * 0.04).toFixed(2)}s`);
        sp.style.setProperty('--x', `${16 + i * 5}px`);
        sp.style.setProperty('--y', `${((i % 2 ? -1 : 1) * (4 + Math.random() * 8)).toFixed(0)}px`);
        pillspot.appendChild(sp);
        window.setTimeout(() => sp.remove(), 1650);
      }
    }
    letterCharmTimer = window.setTimeout(() => {
      casting = false;
      clearAlphaClasses();
      syncPose();
      scheduleIdle();
    }, 1550);
  };

  const fireStarPower = () => {
    clearIdleTimers();
    idleStage = null;
    petting = false;
    clearPetClasses();
    setAttentive(false);
    starActive = true;
    root.classList.remove('star-power');
    void root.offsetWidth;
    root.classList.add('star-power');
    syncPose();
    spawnStarBits();
    showBubble(pick([
      'Star power!',
      'Invincible for exactly zero seconds.',
      'Secret sparkle mode.',
      'Tiny power-up dance.',
    ]));
    window.clearTimeout(starTimer);
    starTimer = window.setTimeout(() => {
      starActive = false;
      root.classList.remove('star-power');
      syncPose();
      scheduleIdle();
    }, 1650);
  };

  const fireBerrySnack = () => {
    clearIdleTimers();
    idleStage = null;
    petting = false;
    clearPetClasses();
    setAttentive(false);
    clearAlphaClasses();
    window.clearTimeout(letterCharmTimer);
    berryActive = true;
    root.classList.remove('berry');
    void root.offsetWidth;
    root.classList.add('berry', 'alpha-berry');
    syncPose();
    spawnStrawberry();
    spawnBerryBurst();
    if (lastState !== 'critical') spawnHearts(lastState === 'heavy' ? 1 : 2);
    showBubble(pick([
      'strawberry break! 🍓',
      'tiny snack buff.',
      'foraging success.',
      'berry nice.',
    ]));
    window.clearTimeout(berryTimer);
    berryTimer = window.setTimeout(() => {
      berryActive = false;
      root.classList.remove('berry', 'alpha-berry');
      syncPose();
      scheduleIdle();
    }, 1450);
  };

  const fireSummitClear = () => {
    root.classList.remove('summit');
    void root.offsetWidth;
    root.classList.add('summit');
    spawnSummitFlag();
    showBubble(pick([
      'summit clear! 🏁',
      'huge save. nice climb.',
      'that handoff was a mountain.',
      'peak efficiency reached.',
    ]));
    window.clearTimeout(summitTimer);
    summitTimer = window.setTimeout(() => root.classList.remove('summit'), 1900);
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
    if (!e.isTrusted) return;
    e.stopPropagation();
    if (e.shiftKey) {
      e.preventDefault();
      petCombo = 0;
      fireStarPower();
      return;
    }
    petCombo += 1;
    window.clearTimeout(petComboTimer);
    petComboTimer = window.setTimeout(() => { petCombo = 0; }, PET_COMBO_WINDOW_MS);
    if (petCombo >= BERRY_PET_COMBO) {
      petCombo = 0;
      fireBerrySnack();
      return;
    }
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
    if (!e.isTrusted) return;
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

  let spaceHeld = false;
  const isEditableTarget = (el: EventTarget | null): boolean => {
    const node = el as HTMLElement | null;
    if (!node || !node.tagName) return false;
    const tag = node.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable === true;
  };
  // Track whether Space is held so it can act as a chord modifier.
  const onSpaceTrack = (e: KeyboardEvent) => {
    if (!e.isTrusted) return;
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (e.type === 'keydown') {
      if (!isEditableTarget(e.target)) spaceHeld = true;
    } else {
      spaceHeld = false;
    }
  };

  // Hold Space + tap a letter (A–Z) to fire each Anime Ultimate. Space is the
  // chord modifier so it works on macOS (where Alt types special characters).
  const onSecretKey = (e: KeyboardEvent) => {
    if (!e.isTrusted) return;
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!spaceHeld || isEditableTarget(e.target)) return;
    if (e.code === 'Space' || e.key === ' ') return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    // Note: Space+M fires the Domain animation (independent of any host command).
    const actions: Partial<Record<string, () => void>> = {
      a: fireAdapt,
      b: fireGetsuga,
      c: fireCyclops,
      d: fireInstinct,
      e: fireSaiyan,
      f: fireFuga,
      g: fireGin,
      h: fireHollow,
      i: fireCowl,
      j: fireStand,
      k: fireRengoku,
      l: fireNika,
      m: fireDomain,
      n: fireSubaru,
      o: fireRika,
      p: firePlanetary,
      q: fireHarley,
      r: fireZoro,
      s: fireSaitama,
      t: fireItachi,
      u: fireSusanoo,
      v: fireFinalFlash,
      w: fireZaWarudo,
      x: fireExodia,
      y: fireKillerQueen,
      z: fireZenitsu,
    };
    const action = actions[k];
    if (!action) return;
    e.preventDefault();
    action();
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
    if (!e.isTrusted) return;
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
    if (!e.isTrusted) return;
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
  window.addEventListener('keydown', onSpaceTrack);
  window.addEventListener('keyup', onSpaceTrack);
  window.addEventListener('keydown', onSecretKey);
  window.addEventListener('blur', () => { spaceHeld = false; });

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
        if (stats_.state !== 'critical') triggerHurt();
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
      vTokens.textContent =
        `~${formatTokenCount(stats_.tokens)} / ${formatTokenCount(stats_.budget)}` +
        (stats_.attachedTokens && stats_.attachedTokens > 0
          ? ` (+${formatTokenCount(stats_.attachedTokens)} attached)`
          : '');
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
        if (saved >= SUMMIT_SAVED_TOKENS) fireSummitClear();
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
      syncRunWidth();
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
      window.clearTimeout(hurtTimer);
      window.clearTimeout(petComboTimer);
      window.clearTimeout(berryTimer);
      window.clearTimeout(summitTimer);
      window.clearTimeout(secretWaveTimer);
      window.clearTimeout(healTimer);
      window.clearTimeout(starTimer);
      window.clearTimeout(letterCharmTimer);
      idleStage = null;
      waving = false;
      startling = false;
      petting = false;
      berryActive = false;
      healActive = false;
      starActive = false;
      hurting = false;
      casting = false;
      clearPetClasses();
      root.classList.remove('berry', 'summit', 'secret-wave', 'heal', 'star-power');
      clearAlphaClasses();
      setAttentive(false);
      syncPose();
    },
    destroy() {
      runResizeObserver?.disconnect();
      window.removeEventListener('resize', applyPosition);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('scroll', onActivity);
      window.removeEventListener('wheel', onActivity);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('keydown', onKonamiKey);
      window.removeEventListener('keydown', onSecretKey);
      window.clearTimeout(celebrateTimer);
      window.clearTimeout(damageTimer);
      window.clearTimeout(criticalTimer);
      window.clearTimeout(speechTimer);
      window.clearTimeout(idleTimer);
      window.clearTimeout(stageTimer);
      window.clearTimeout(waveTimer);
      window.clearTimeout(startleTimer);
      window.clearTimeout(petTimer);
      window.clearTimeout(hurtTimer);
      window.clearTimeout(petComboTimer);
      window.clearTimeout(berryTimer);
      window.clearTimeout(summitTimer);
      window.clearTimeout(konamiTimer);
      window.clearTimeout(secretWaveTimer);
      window.clearTimeout(healTimer);
      window.clearTimeout(starTimer);
      window.clearTimeout(letterCharmTimer);
      cancelAnimationFrame(hpRaf);
      window.cancelAnimationFrame(resumeFlipRaf);
      hurting = false;
      host.remove();
    },
  };
}
