/**
 * Waste detection (M5): find near-duplicate LARGE blocks across the
 * transcript — the same code/doc pasted multiple times — and estimate
 * how many tokens are avoidable. Pure string analysis, no DOM.
 *
 * Method: lines are whitespace-normalized per message; fingerprints are
 * hashes of WINDOW consecutive non-empty lines (plus single very long
 * lines, to catch e.g. minified JSON). A fingerprint seen before marks
 * that occurrence's lines as duplicates — the first occurrence stays
 * free. Contiguous duplicate runs shorter than MIN_BLOCK_CHARS are
 * ignored ("large blocks" only), and trivial windows (braces, blank-ish
 * filler) are never fingerprinted.
 *
 * "Near"-duplicate here means: identical after whitespace normalization,
 * allowing surrounding context to differ. Costs one pass over the
 * transcript; the caller is expected to gate it (e.g. only when not
 * streaming and the char count changed).
 */

// .ts extension so Node's type-stripping test runner can resolve it too
import { cyrb53 } from './hash.ts';

const WINDOW = 5;
/** Windows whose joined text is shorter than this are noise, not content. */
const MIN_WINDOW_CHARS = 60;
/** Single lines at least this long are fingerprinted on their own. */
const LONG_LINE_CHARS = 200;
/** A contiguous duplicate region must be at least this big to count. */
const MIN_BLOCK_CHARS = 400;

export interface DupBlockRef {
  /** Index into the analyzed messages array where the duplicate sits. */
  messageIndex: number;
}

export interface WasteReport {
  /** Chars in duplicate copies beyond each block's first occurrence. */
  avoidableChars: number;
  /** Number of contiguous duplicate regions found. */
  blocks: number;
  /** Where the duplicate copies live (capped), for scroll-to-highlight. */
  refs: DupBlockRef[];
}

export const EMPTY_WASTE: WasteReport = { avoidableChars: 0, blocks: 0, refs: [] };

const MAX_REFS = 12;

/**
 * The expensive per-message work (normalize lines, join+hash every
 * window) cached by message text. Phase-independent: the global dup pass
 * replays the seen-set logic over these, so output is identical whether
 * or not a fingerprint came from cache.
 */
interface MsgFingerprint {
  lineLens: number[];
  /** Windows that qualify (joined length ≥ MIN_WINDOW_CHARS). */
  windows: { start: number; hash: number }[];
  /** Long lines fingerprinted on their own. */
  longLines: { idx: number; hash: number }[];
}

function fingerprint(text: string): MsgFingerprint | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .filter((l) => l.length > 0);
  if (lines.length === 0) return null;

  const lineLens = lines.map((l) => l.length);
  const windows: { start: number; hash: number }[] = [];
  for (let i = 0; i + WINDOW <= lines.length; i++) {
    const joined = lines.slice(i, i + WINDOW).join('\n');
    if (joined.length < MIN_WINDOW_CHARS) continue;
    windows.push({ start: i, hash: cyrb53(joined) });
  }
  const longLines: { idx: number; hash: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lineLens[i]! < LONG_LINE_CHARS) continue;
    longLines.push({ idx: i, hash: cyrb53('L:' + lines[i]!) });
  }
  return { lineLens, windows, longLines };
}

// Cache rebuilt each call (mirrors the token cache): can't grow beyond
// the current transcript, and unchanged messages skip re-fingerprinting.
let fpCache = new Map<string, MsgFingerprint | null>();

export function detectWaste(messages: ReadonlyArray<{ text: string }>): WasteReport {
  const seen = new Set<number>();
  let avoidableChars = 0;
  let blocks = 0;
  const refs: DupBlockRef[] = [];
  const nextCache = new Map<string, MsgFingerprint | null>();

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const text = messages[messageIndex]!.text;
    let fp = nextCache.get(text);
    if (fp === undefined) {
      fp = fpCache.has(text) ? fpCache.get(text)! : fingerprint(text);
      nextCache.set(text, fp);
    }
    if (!fp) continue;

    const { lineLens, windows, longLines } = fp;
    const dup: boolean[] = new Array(lineLens.length).fill(false);

    for (const w of windows) {
      if (seen.has(w.hash)) {
        for (let j = w.start; j < w.start + WINDOW; j++) dup[j] = true;
      } else {
        seen.add(w.hash);
      }
    }

    for (const l of longLines) {
      if (seen.has(l.hash)) dup[l.idx] = true;
      else seen.add(l.hash);
    }

    let run = 0;
    for (let i = 0; i <= lineLens.length; i++) {
      if (i < lineLens.length && dup[i]) {
        run += lineLens[i]! + 1;
      } else if (run > 0) {
        if (run >= MIN_BLOCK_CHARS) {
          avoidableChars += run;
          blocks++;
          if (refs.length < MAX_REFS) refs.push({ messageIndex });
        }
        run = 0;
      }
    }
  }

  fpCache = nextCache;
  return { avoidableChars, blocks, refs };
}
