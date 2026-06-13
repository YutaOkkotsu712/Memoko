import { prefillChatInput, readInputDraft } from './prefill';
import type { SiteAdapter, Transcript, TranscriptMessage } from './types';

/**
 * claude.ai adapter. ALL claude.ai selectors live in this file.
 *
 * Selector strategy (most specific / most stable first, fallbacks after):
 *
 *  - User turns: claude.ai marks them with data-testid="user-message".
 *    data-testid attributes are test hooks and survive styling refactors
 *    far better than class names.
 *
 *  - Assistant turns: the rendered response body carries a
 *    .font-claude-* class (renamed once already, so both known names are
 *    listed). User messages are NOT nested inside assistant containers
 *    (verified live), so role classification by selector is safe. Last
 *    resort is the [data-is-streaming] container that wraps
 *    each assistant response group — it's an app-logic attribute, likely
 *    to survive, but it wraps more chrome (thumbs, retry buttons) so it's
 *    a coarser text source.
 *
 *  - Streaming state: data-is-streaming="true" on the response container.
 *
 *  - Chat input: claude.ai uses a ProseMirror contenteditable. The chain
 *    falls back to progressively looser contenteditable queries.
 *
 * Per-selector-list resolution: for each list we use the FIRST selector
 * that matches anything in the current document, so a rename upstream
 * automatically falls through to the next candidate.
 */

const USER_MESSAGE_SELECTORS = [
  '[data-testid="user-message"]',
];

// Verified against live claude.ai DOM 2026-06-11: .font-claude-response
// is current; .font-claude-message is its pre-rename ancestor, kept as a
// fallback in case of a revert.
const ASSISTANT_MESSAGE_SELECTORS = [
  'div.font-claude-response',
  'div.font-claude-message',
  'div[data-is-streaming]',
];

const STREAMING_CONTAINER = '[data-is-streaming="true"]';

const CHAT_INPUT_SELECTORS = [
  'div[contenteditable="true"].ProseMirror',
  'div[contenteditable="true"][aria-label]',
  'fieldset div[contenteditable="true"]',
  'div[contenteditable="true"]',
];

/** Conversation URLs look like /chat/<uuid>. */
const CONVO_PATH = /^\/chat\/([0-9a-f][0-9a-f-]{7,})/i;

/** Per-element text cache; entries die with their nodes. */
const textCache = new WeakMap<Element, { text: string; streaming: boolean }>();

function firstMatchingSelector(selectors: string[]): string | null {
  for (const sel of selectors) {
    try {
      if (document.querySelector(sel)) return sel;
    } catch {
      // malformed selector — skip
    }
  }
  return null;
}

function isVisible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0;
}

function findInput(): HTMLElement | null {
  for (const sel of CHAT_INPUT_SELECTORS) {
    try {
      const candidates = document.querySelectorAll<HTMLElement>(sel);
      for (const el of candidates) {
        if (isVisible(el)) return el;
      }
    } catch {
      // skip
    }
  }
  return null;
}

export const claudeAdapter: SiteAdapter = {
  id: 'claude',
  label: 'Claude',

  matches(loc: Location): boolean {
    return loc.hostname === 'claude.ai';
  },

  conversationId(loc: Location): string | null {
    const m = CONVO_PATH.exec(loc.pathname);
    return m ? m[1] : null;
  },

  readTranscript(opts?: { fresh?: boolean }): Transcript | null {
    const userSel = firstMatchingSelector(USER_MESSAGE_SELECTORS);
    const asstSel = firstMatchingSelector(ASSISTANT_MESSAGE_SELECTORS);

    if (!userSel && !asstSel) {
      // Either still loading or an empty conversation. Report an empty
      // transcript rather than "unrecognized" — the monitor stays quiet
      // but ready. We only return null if the page claims to be a
      // conversation yet we can't even find the input (handled upstream).
      return { messages: [], charCount: 0, anyStreaming: false };
    }

    const combined = [userSel, asstSel].filter(Boolean).join(', ');
    let nodes: HTMLElement[];
    try {
      nodes = Array.from(document.querySelectorAll<HTMLElement>(combined));
    } catch {
      return null;
    }

    const messages: TranscriptMessage[] = [];
    let charCount = 0;
    let anyStreaming = false;
    // querySelectorAll returns document order, so a container always
    // precedes anything nested inside it: skipping nodes contained in the
    // last accepted node dedupes container/content double-matches.
    let lastAccepted: HTMLElement | null = null;

    for (const el of nodes) {
      if (lastAccepted && lastAccepted.contains(el)) continue;
      lastAccepted = el;

      const role = userSel && el.matches(userSel) ? 'user' : 'assistant';
      const streaming =
        role === 'assistant' && el.closest(STREAMING_CONTAINER) !== null;
      // Settled messages don't change on this SPA (edits remount the
      // element), so reuse cached text and only walk the DOM for new or
      // streaming elements — including one final read after a stream
      // ends. textContent, not innerText: innerText forces layout.
      const cached = opts?.fresh ? undefined : textCache.get(el);
      const text =
        cached && !cached.streaming && !streaming ? cached.text : (el.textContent ?? '');
      textCache.set(el, { text, streaming });

      messages.push({ role, text, streaming, el });
      charCount += text.length;
      anyStreaming = anyStreaming || streaming;
    }

    return { messages, charCount, anyStreaming };
  },

  findChatInput(): HTMLElement | null {
    return findInput();
  },

  readDraft(): string {
    return readInputDraft(findInput());
  },

  async prefillInput(text: string): Promise<boolean> {
    const input = findInput();
    if (!input) return false;
    return prefillChatInput(input, text);
  },

  newChatUrl(): string {
    return 'https://claude.ai/new';
  },

  observeRoot(): Node {
    return document.body;
  },
};
