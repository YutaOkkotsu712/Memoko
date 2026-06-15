/**
 * Site adapter interface. One implementation per supported chat site.
 *
 * Contract:
 *  - ALL DOM selectors for a site live in its adapter module, nowhere else.
 *    A host-site UI change must be fixable by editing that one file.
 *  - Adapters are read-only except for `prefillInput`, which writes text
 *    into the chat input and nothing else. They never click, send, or
 *    otherwise automate the host page — the user always presses send.
 *  - Adapters degrade silently: on unrecognized DOM shapes they return
 *    null/empty values and never throw or log.
 */

export type Role = 'user' | 'assistant';

export interface TranscriptMessage {
  role: Role;
  text: string;
  /** True while this message is still streaming in. */
  streaming: boolean;
  /** The message's DOM element (for scroll-to-highlight). */
  el?: HTMLElement;
  /**
   * Stable per-message id, if the site exposes one (ChatGPT's
   * data-message-id). Lets the monitor accumulate token counts across a
   * VIRTUALIZED message list — counting each message once and keeping it
   * counted after it scrolls out of the DOM — instead of fluctuating with
   * scroll position. Absent on sites that render the full transcript at
   * once (claude.ai), which don't need it.
   */
  id?: string;
}

export interface Transcript {
  messages: TranscriptMessage[];
  /** Total characters across all messages (input to token estimation). */
  charCount: number;
  anyStreaming: boolean;
}

export interface SiteAdapter {
  /** Stable id, used as the settings key (e.g. 'claude'). */
  readonly id: string;
  readonly label: string;

  /** Does this adapter handle the given location at all? */
  matches(loc: Location): boolean;

  /**
   * Stable identifier for the currently open conversation, or null when
   * not on a conversation page (home, settings, new chat…). Called on
   * every recompute — must be cheap. A change in this value is the
   * signal that the user navigated to a different chat (SPA nav).
   */
  conversationId(loc: Location): string | null;

  /**
   * Extract the visible transcript. Returns an empty transcript while
   * the page is still loading, and null only when the DOM is present
   * but unrecognizable (signal to hide our UI entirely).
   */
  /**
   * Extract the visible transcript. Adapters may cache per-message text
   * and only re-read messages that can still change (streaming/new
   * elements) — pass `fresh: true` to force a full DOM re-read (the
   * monitor does this periodically as a safety valve).
   */
  readTranscript(opts?: { fresh?: boolean }): Transcript | null;

  /** The chat input element, or null if not found. */
  findChatInput(): HTMLElement | null;

  /**
   * Raw model label shown in the page's model picker (e.g. "Claude Opus
   * 4.8", "ChatGPT 4o"), or null if not found. Optional — used to
   * auto-size the context budget; degrades to the manual budget.
   */
  detectModel?(): string | null;

  /** Current draft text in the chat input, '' if empty or not found. */
  readDraft(): string;

  /**
   * True when the host editor's DOM is likely rendering single newlines
   * as spaced paragraph blocks. Optional because most adapters don't need
   * layout-specific cleanup affordances.
   */
  hasSpaciousLineBreaks?(): boolean;

  /**
   * Replace the chat input's content with `text`. Resolves true only if
   * the text verifiably landed in the input. Async because rich-text
   * editors (ProseMirror) reconcile native editing commands through DOM
   * observation, which takes a tick. NEVER sends.
   */
  prefillInput(text: string): Promise<boolean>;

  /**
   * Optional layout rewrite for editors that need hard line breaks instead
   * of paragraph blocks. Like prefillInput, this only rewrites the draft.
   */
  compactInputLineBreaks?(text: string): Promise<boolean>;

  /** URL of a fresh conversation on this site. */
  newChatUrl(): string;

  /** Node to attach the MutationObserver to. */
  observeRoot(): Node;

  /**
   * The scrollable element holding the transcript, for the indexing sweep
   * (scrolling a virtualized list to render every message). Optional —
   * only sites that virtualize (chatgpt.com) need it; absent → no sweep.
   */
  scrollContainer?(): HTMLElement | null;
}
