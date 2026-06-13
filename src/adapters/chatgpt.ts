import { prefillChatInput, readInputDraft } from './prefill';
import type { SiteAdapter, Transcript, TranscriptMessage } from './types';

/**
 * chatgpt.com adapter (v0.2). ALL chatgpt.com selectors live in this file.
 *
 * STATUS: built from ChatGPT's long-stable DOM contract but NOT yet
 * verified against the live site (automated probing of chatgpt.com was
 * unavailable). Per the degrade-silently principle, a mismatch means
 * ChatHP simply does nothing there — and any fix belongs in this file
 * only.
 *
 * Selector strategy:
 *  - Messages: data-message-author-role="user"|"assistant" — ChatGPT's
 *    own per-message attribute, stable for years and the hook every
 *    known extension relies on.
 *  - Streaming: the markdown body carries .result-streaming while
 *    generating; the visible stop button is a coarser page-level signal
 *    used as a fallback to flag the last assistant message.
 *  - Composer: #prompt-textarea (the id survived ChatGPT's migration
 *    from <textarea> to a ProseMirror contenteditable; prefill handles
 *    both element kinds).
 *
 * Conversation URLs look like /c/<uuid>; legacy chat.openai.com
 * redirects to chatgpt.com but is matched anyway.
 */

const USER_MESSAGE_SELECTORS = [
  '[data-message-author-role="user"]',
];

const ASSISTANT_MESSAGE_SELECTORS = [
  '[data-message-author-role="assistant"]',
];

const STREAMING_MARKER = '.result-streaming';
const STOP_BUTTON_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label*="Stop" i]',
];

const CHAT_INPUT_SELECTORS = [
  '#prompt-textarea',
  'div[contenteditable="true"].ProseMirror',
  'form textarea',
  'div[contenteditable="true"]',
];

const CONVO_PATH = /^\/c\/([0-9a-f][0-9a-f-]{7,})/i;

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

function hasSpaciousLineBreaks(input: HTMLElement | null): boolean {
  if (!input || input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    return false;
  }
  const blocks = Array.from(input.children).filter((el) => {
    const text = el.textContent ?? '';
    return text.trim().length > 0 || el.querySelector('br');
  });
  if (blocks.length < 2) return false;

  const nonEmpty = blocks.filter((el) => (el.textContent ?? '').trim().length > 0);
  if (nonEmpty.length < 2) return false;

  const plainLineBlocks = nonEmpty.filter(
    (el) =>
      !el.querySelector('br') &&
      !el.querySelector('p, div, li, pre, blockquote, ul, ol')
  );
  return plainLineBlocks.length / nonEmpty.length >= 0.8;
}

function isGenerating(): boolean {
  for (const sel of STOP_BUTTON_SELECTORS) {
    try {
      if (document.querySelector(sel)) return true;
    } catch {
      // skip
    }
  }
  return false;
}

export const chatgptAdapter: SiteAdapter = {
  id: 'chatgpt',
  label: 'ChatGPT',

  matches(loc: Location): boolean {
    return loc.hostname === 'chatgpt.com' || loc.hostname === 'chat.openai.com';
  },

  conversationId(loc: Location): string | null {
    const m = CONVO_PATH.exec(loc.pathname);
    return m ? m[1] : null;
  },

  readTranscript(opts?: { fresh?: boolean }): Transcript | null {
    const userSel = firstMatchingSelector(USER_MESSAGE_SELECTORS);
    const asstSel = firstMatchingSelector(ASSISTANT_MESSAGE_SELECTORS);

    if (!userSel && !asstSel) {
      return { messages: [], charCount: 0, anyStreaming: false };
    }

    const combined = [userSel, asstSel].filter(Boolean).join(', ');
    let nodes: HTMLElement[];
    try {
      nodes = Array.from(document.querySelectorAll<HTMLElement>(combined));
    } catch {
      return null;
    }

    const generating = isGenerating();
    const messages: TranscriptMessage[] = [];
    const accepted: HTMLElement[] = [];
    let charCount = 0;
    let anyStreaming = false;
    let lastAccepted: HTMLElement | null = null;

    for (const el of nodes) {
      if (lastAccepted && lastAccepted.contains(el)) continue;
      lastAccepted = el;

      const role =
        el.getAttribute('data-message-author-role') === 'user' ? 'user' : 'assistant';
      let streaming = false;
      if (role === 'assistant') {
        try {
          streaming = el.querySelector(STREAMING_MARKER) !== null;
        } catch {
          // marker gone — fall back below
        }
      }
      // Settled messages don't change on this SPA (edits remount), so
      // reuse cached text; only walk the DOM for new/streaming elements,
      // including one final read after a stream ends.
      const cached = opts?.fresh ? undefined : textCache.get(el);
      const text =
        cached && !cached.streaming && !streaming ? cached.text : (el.textContent ?? '');
      textCache.set(el, { text, streaming });

      messages.push({ role, text, streaming, el });
      accepted.push(el);
      charCount += text.length;
      anyStreaming = anyStreaming || streaming;
    }

    // Fallback: the stop button is showing but no message carries the
    // streaming marker — treat the last assistant message as in-flight
    // (and mark its cache entry so its text keeps being re-read).
    if (!anyStreaming && generating) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]!;
        if (m.role === 'assistant') {
          m.streaming = true;
          anyStreaming = true;
          textCache.set(accepted[i]!, { text: m.text, streaming: true });
          break;
        }
      }
    }

    return { messages, charCount, anyStreaming };
  },

  findChatInput(): HTMLElement | null {
    return findInput();
  },

  readDraft(): string {
    return readInputDraft(findInput());
  },

  hasSpaciousLineBreaks(): boolean {
    return hasSpaciousLineBreaks(findInput());
  },

  async prefillInput(text: string): Promise<boolean> {
    const input = findInput();
    if (!input) return false;
    return prefillChatInput(input, text, { preferInsertText: true });
  },

  async compactInputLineBreaks(text: string): Promise<boolean> {
    const input = findInput();
    if (!input) return false;
    return prefillChatInput(input, text, {
      preferLineBreakHtml: true,
      isLayoutOk: (el) => !hasSpaciousLineBreaks(el),
    });
  },

  newChatUrl(): string {
    return 'https://chatgpt.com/';
  },

  observeRoot(): Node {
    return document.body;
  },
};
