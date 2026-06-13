import type { Thresholds } from './health';
// .ts extension so Node's type-stripping test runner can resolve it too
import { PROSE_CHARS_PER_TOKEN } from './tokens.ts';

/**
 * All persistence is chrome.storage.local — settings and UI state only,
 * never conversation content. Every accessor is failure-tolerant: if the
 * extension context is invalidated or storage is unavailable, we fall
 * back to defaults and stay silent.
 */

export interface Settings {
  /**
   * Assumed context window per site, in tokens. claude.ai is a stable
   * 200k; chatgpt.com varies by plan (8k–128k), defaulting to 128k.
   */
  budgets: Record<string, number>;
  charsPerToken: number;
  thresholds: Thresholds;
  /** Per-site enable, keyed by adapter id. Missing key = enabled. */
  sites: Record<string, boolean>;
  /** Draft cost meter appears at/above this many estimated tokens. */
  draftMinTokens: number;
  /** Pastes at/above this many estimated tokens get audited. */
  pasteAuditMinTokens: number;
  /** Per-feature toggles (the health pill itself is the core feature). */
  features: {
    handoff: boolean;
    draftMeter: boolean;
    pasteAudit: boolean;
    /** Memoko's one-shot speech bubbles on health-state transitions. */
    bubbles: boolean;
    /** Usage % badge on the toolbar icon for the active tab. */
    badge: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  budgets: { claude: 200_000, chatgpt: 128_000 },
  charsPerToken: PROSE_CHARS_PER_TOKEN,
  thresholds: { healthy: 40, heavy: 70, critical: 90 },
  sites: { claude: true, chatgpt: true },
  draftMinTokens: 10,
  pasteAuditMinTokens: 1000,
  features: { handoff: true, draftMeter: true, pasteAudit: true, bubbles: true, badge: true },
};

const SETTINGS_KEY = 'settings';

export function mergeSettings(raw: unknown): Settings {
  const merged = structuredClone(DEFAULT_SETTINGS);
  if (!raw || typeof raw !== 'object') return merged;
  const r = raw as Partial<Settings>;
  // legacy (≤0.2.1): a single global contextBudget — carry it to claude,
  // the only site it was calibrated against; explicit budgets below win
  const legacyBudget = (raw as { contextBudget?: unknown }).contextBudget;
  if (typeof legacyBudget === 'number' && legacyBudget > 0) {
    merged.budgets['claude'] = legacyBudget;
  }
  if (r.budgets && typeof r.budgets === 'object') {
    for (const [site, v] of Object.entries(r.budgets)) {
      if (typeof v === 'number' && v > 0) merged.budgets[site] = v;
    }
  }
  if (typeof r.charsPerToken === 'number' && r.charsPerToken > 0) {
    merged.charsPerToken = r.charsPerToken;
  }
  if (r.thresholds && typeof r.thresholds === 'object') {
    for (const key of ['healthy', 'heavy', 'critical'] as const) {
      const v = r.thresholds[key];
      if (typeof v === 'number' && v >= 0 && v <= 100) merged.thresholds[key] = v;
    }
  }
  if (r.sites && typeof r.sites === 'object') {
    Object.assign(merged.sites, r.sites);
  }
  if (typeof r.draftMinTokens === 'number' && r.draftMinTokens >= 0) {
    merged.draftMinTokens = r.draftMinTokens;
  }
  if (typeof r.pasteAuditMinTokens === 'number' && r.pasteAuditMinTokens > 0) {
    merged.pasteAuditMinTokens = r.pasteAuditMinTokens;
  }
  if (r.features && typeof r.features === 'object') {
    for (const key of ['handoff', 'draftMeter', 'pasteAudit', 'bubbles', 'badge'] as const) {
      const v = r.features[key];
      if (typeof v === 'boolean') merged.features[key] = v;
    }
  }
  return merged;
}

export async function loadSettings(): Promise<Settings> {
  try {
    const got = await chrome.storage.local.get(SETTINGS_KEY);
    return mergeSettings(got?.[SETTINGS_KEY]);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function budgetFor(s: Settings, siteId: string): number {
  const b = s.budgets[siteId];
  return typeof b === 'number' && b > 0 ? b : 200_000;
}

export async function saveSettings(s: Settings): Promise<void> {
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: s });
  } catch {
    // non-fatal
  }
}

export function onSettingsChanged(cb: (s: Settings) => void): void {
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[SETTINGS_KEY]) {
        cb(mergeSettings(changes[SETTINGS_KEY].newValue));
      }
    });
  } catch {
    // storage unavailable — keep defaults
  }
}

/** Pill position + collapsed state, persisted separately from settings. */
export interface PillPersist {
  right: number;
  bottom: number;
  collapsed: boolean;
}

export const DEFAULT_PILL_STATE: PillPersist = {
  right: 16,
  bottom: 88, // clears claude.ai's own bottom-right floating controls
  collapsed: true,
};

const PILL_KEY = 'pill';

export async function loadPillState(): Promise<PillPersist> {
  try {
    const got = await chrome.storage.local.get(PILL_KEY);
    const raw = got?.[PILL_KEY] as Partial<PillPersist> | undefined;
    const merged = { ...DEFAULT_PILL_STATE };
    if (raw && typeof raw === 'object') {
      if (typeof raw.right === 'number') merged.right = raw.right;
      if (typeof raw.bottom === 'number') merged.bottom = raw.bottom;
      if (typeof raw.collapsed === 'boolean') merged.collapsed = raw.collapsed;
    }
    return merged;
  } catch {
    return { ...DEFAULT_PILL_STATE };
  }
}

export function savePillState(state: PillPersist): void {
  try {
    void chrome.storage.local.set({ [PILL_KEY]: state });
  } catch {
    // non-fatal
  }
}

/** First-run onboarding hint: shown once, then never again. */
const ONBOARD_KEY = 'onboarded';

export async function loadOnboarded(): Promise<boolean> {
  try {
    const got = await chrome.storage.local.get(ONBOARD_KEY);
    return got?.[ONBOARD_KEY] === true;
  } catch {
    return false;
  }
}

export function saveOnboarded(): void {
  try {
    void chrome.storage.local.set({ [ONBOARD_KEY]: true });
  } catch {
    // non-fatal
  }
}

/** First-ever-Heavy coach mark: shown once, then never again. */
const COACH_KEY = 'coachedHeavy';

export async function loadCoachMark(): Promise<boolean> {
  try {
    const got = await chrome.storage.local.get(COACH_KEY);
    return got?.[COACH_KEY] === true;
  } catch {
    return true; // can't persist → don't risk nagging on every load
  }
}

export function saveCoachMark(): void {
  try {
    void chrome.storage.local.set({ [COACH_KEY]: true });
  } catch {
    // non-fatal
  }
}

/**
 * Adapter health heartbeat: the content script reports whether its
 * selectors matched the page, so the popup can surface silent breakage
 * ("no match — selectors may be stale"). Status + timestamp only, never
 * content.
 */

export type AdapterStatus = 'ok' | 'no-match';

export interface AdapterHealth {
  status: AdapterStatus;
  at: number;
}

const HEALTH_PREFIX = 'health:';

export function reportAdapterHealth(siteId: string, status: AdapterStatus): void {
  try {
    void chrome.storage.local.set({
      [HEALTH_PREFIX + siteId]: { status, at: Date.now() } satisfies AdapterHealth,
    });
  } catch {
    // non-fatal
  }
}

export async function loadAdapterHealth(
  siteIds: string[]
): Promise<Record<string, AdapterHealth | null>> {
  const out: Record<string, AdapterHealth | null> = {};
  for (const id of siteIds) out[id] = null;
  try {
    const got = await chrome.storage.local.get(siteIds.map((id) => HEALTH_PREFIX + id));
    for (const id of siteIds) {
      const v = got?.[HEALTH_PREFIX + id] as AdapterHealth | undefined;
      if (v && typeof v.at === 'number' && (v.status === 'ok' || v.status === 'no-match')) {
        out[id] = v;
      }
    }
  } catch {
    // defaults stand
  }
  return out;
}

/**
 * Session-only estimate floor: chat sites may remount only part of a long
 * transcript after reload, so a DOM-only count can suddenly undercount. Store
 * numeric high-water marks per conversation, never message text.
 */
export interface ConversationEstimate {
  siteId: string;
  conversationId: string;
  tokens: number;
  charsPerToken: number;
  messageCount: number;
  charCount: number;
  dupTokens: number;
  dupBlocks: number;
  at: number;
}

const ESTIMATE_PREFIX = 'estimate:';
const ESTIMATE_TTL_MS = 24 * 60 * 60_000;

const estimateKey = (siteId: string, conversationId: string): string =>
  `${ESTIMATE_PREFIX}${siteId}:${conversationId}`;

function validConversationEstimate(
  value: Partial<ConversationEstimate> | undefined,
  siteId: string,
  conversationId: string
): ConversationEstimate | null {
  if (!value || value.siteId !== siteId || value.conversationId !== conversationId) return null;
  if (
    typeof value.tokens !== 'number' ||
    typeof value.charsPerToken !== 'number' ||
    typeof value.messageCount !== 'number' ||
    typeof value.charCount !== 'number' ||
    typeof value.dupTokens !== 'number' ||
    typeof value.dupBlocks !== 'number' ||
    typeof value.at !== 'number'
  ) {
    return null;
  }
  if (Date.now() - value.at > ESTIMATE_TTL_MS) return null;
  return {
    siteId,
    conversationId,
    tokens: Math.max(0, Math.round(value.tokens)),
    charsPerToken: value.charsPerToken,
    messageCount: Math.max(0, Math.round(value.messageCount)),
    charCount: Math.max(0, Math.round(value.charCount)),
    dupTokens: Math.max(0, Math.round(value.dupTokens)),
    dupBlocks: Math.max(0, Math.round(value.dupBlocks)),
    at: value.at,
  };
}

export async function loadConversationEstimate(
  siteId: string,
  conversationId: string
): Promise<ConversationEstimate | null> {
  try {
    const key = estimateKey(siteId, conversationId);
    const got = await chrome.storage.session.get(key);
    return validConversationEstimate(
      got?.[key] as Partial<ConversationEstimate> | undefined,
      siteId,
      conversationId
    );
  } catch {
    return null;
  }
}

export function saveConversationEstimate(estimate: ConversationEstimate): void {
  try {
    void chrome.storage.session.set({
      [estimateKey(estimate.siteId, estimate.conversationId)]: estimate,
    });
  } catch {
    // session storage unavailable — estimates remain DOM-only
  }
}

/**
 * Handoff stash: carries a generated handoff summary from "New chat"
 * into the fresh conversation's input. This is the ONE place
 * conversation-derived content touches extension storage, so it is as
 * ephemeral as the platform allows: chrome.storage.session (memory-
 * backed, cleared when the browser closes), single-use (deleted on
 * read), and time-limited. On Chromes where content scripts can't reach
 * storage.session, it falls back to a self-deleting local entry with the
 * same TTL.
 */

interface HandoffStash {
  siteId: string;
  text: string;
  at: number;
}

const STASH_KEY = 'handoffStash';
const STASH_TTL_MS = 10 * 60_000;

export async function stashHandoff(siteId: string, text: string): Promise<void> {
  const entry: HandoffStash = { siteId, text, at: Date.now() };
  try {
    await chrome.storage.session.set({ [STASH_KEY]: entry });
    return;
  } catch {
    // session area unavailable from this context — fall back below
  }
  try {
    await chrome.storage.local.set({ [STASH_KEY]: entry });
  } catch {
    // non-fatal: "New chat" still opens; the user copies manually
  }
}

/** Single-use take: removes the stash whether or not it matches. */
export async function takeHandoffStash(siteId: string): Promise<string | null> {
  for (const area of ['session', 'local'] as const) {
    try {
      const got = await chrome.storage[area].get(STASH_KEY);
      const e = got?.[STASH_KEY] as Partial<HandoffStash> | undefined;
      if (!e || typeof e.text !== 'string') continue;
      await chrome.storage[area].remove(STASH_KEY);
      if (e.siteId === siteId && typeof e.at === 'number' && Date.now() - e.at < STASH_TTL_MS) {
        return e.text;
      }
    } catch {
      // keep trying the other area
    }
  }
  return null;
}
