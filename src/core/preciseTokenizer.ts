/**
 * Optional precise tokenizer — a real BPE encoder (o200k_base, the
 * tokenizer GPT-4o actually uses) for exact counts on ChatGPT and a
 * much closer proxy for Claude than the character heuristic.
 *
 * IMPORTANT framing:
 *  - ChatGPT/GPT models use o200k_base → counts are essentially EXACT.
 *  - Claude's tokenizer is NOT public. o200k is a strong proxy (modern
 *    BPE tokenizers correlate within a few percent on English/code, and
 *    it handles CJK ~1:1), so it's a real upgrade over chars/token — but
 *    Claude's number stays a labeled estimate.
 *
 * The ~2.3 MB rank data is dynamically imported, so it only loads when
 * precise mode is actually on — the base content script stays small.
 * Everything degrades to the heuristic on any failure: a blocked dynamic
 * import, an encode error, anything. 100% local; no network.
 */

type Encoder = { encode(text: string): unknown[] };

let encoder: Encoder | null = null;
let state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
let loadPromise: Promise<void> | null = null;

export function preciseReady(): boolean {
  return state === 'ready' && encoder !== null;
}

export function preciseFailed(): boolean {
  return state === 'failed';
}

/** Load the encoder once. Resolves whether it succeeded or fell back. */
export function ensurePreciseEncoder(): Promise<void> {
  if (loadPromise) return loadPromise;
  state = 'loading';
  loadPromise = (async () => {
    try {
      const [lite, ranks] = await Promise.all([
        import('js-tiktoken/lite'),
        import('js-tiktoken/ranks/o200k_base'),
      ]);
      const rankData = (ranks as { default?: unknown }).default ?? ranks;
      encoder = new lite.Tiktoken(rankData as never) as unknown as Encoder;
      // smoke-test: a failed/incompatible build should fall back, not throw later
      encoder.encode('chathp');
      state = 'ready';
    } catch {
      encoder = null;
      state = 'failed';
    }
  })();
  return loadPromise;
}

/** Exact token count, or null if the encoder isn't available / errors. */
export function countPrecise(text: string): number | null {
  if (!encoder) return null;
  if (text.length === 0) return 0;
  try {
    return encoder.encode(text).length;
  } catch {
    return null;
  }
}
