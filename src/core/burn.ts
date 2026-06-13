/**
 * Context burn rate: how fast this conversation is eating tokens, from a
 * rolling window of in-session samples. Pure math, no DOM, no storage —
 * samples live in memory and die with the page.
 */

export interface BurnSample {
  at: number;
  tokens: number;
}

/** Samples older than this fall out of the window. */
export const BURN_WINDOW_MS = 10 * 60_000;
/** Need at least this much elapsed time before a rate is meaningful. */
export const BURN_MIN_SPAN_MS = 90_000;

export function pruneSamples(samples: readonly BurnSample[], now: number): BurnSample[] {
  return samples.filter((s) => now - s.at <= BURN_WINDOW_MS);
}

/** Tokens per minute across the window, or null if too little signal. */
export function burnPerMin(samples: readonly BurnSample[]): number | null {
  if (samples.length < 2) return null;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const spanMs = last.at - first.at;
  if (spanMs < BURN_MIN_SPAN_MS) return null;
  const rate = (last.tokens - first.tokens) / (spanMs / 60_000);
  return rate > 0 ? rate : null;
}

/** Minutes until `target` tokens at the given pace, or null if n/a. */
export function minutesUntil(
  tokensNow: number,
  target: number,
  perMin: number | null
): number | null {
  if (perMin === null || perMin <= 0 || target <= tokensNow) return null;
  return (target - tokensNow) / perMin;
}
