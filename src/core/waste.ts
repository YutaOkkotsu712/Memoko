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

export function detectWaste(messages: ReadonlyArray<{ text: string }>): WasteReport {
  const seen = new Set<number>();
  let avoidableChars = 0;
  let blocks = 0;
  const refs: DupBlockRef[] = [];

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const msg = messages[messageIndex]!;
    const lines = msg.text
      .split('\n')
      .map((l) => l.trim().replace(/\s+/g, ' '))
      .filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    const dup: boolean[] = new Array(lines.length).fill(false);

    for (let i = 0; i + WINDOW <= lines.length; i++) {
      const joined = lines.slice(i, i + WINDOW).join('\n');
      if (joined.length < MIN_WINDOW_CHARS) continue;
      const h = cyrb53(joined);
      if (seen.has(h)) {
        for (let j = i; j < i + WINDOW; j++) dup[j] = true;
      } else {
        seen.add(h);
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.length < LONG_LINE_CHARS) continue;
      const h = cyrb53('L:' + line);
      if (seen.has(h)) dup[i] = true;
      else seen.add(h);
    }

    let run = 0;
    for (let i = 0; i <= lines.length; i++) {
      if (i < lines.length && dup[i]) {
        run += lines[i]!.length + 1;
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

  return { avoidableChars, blocks, refs };
}
