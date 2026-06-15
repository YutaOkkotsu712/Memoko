/**
 * Indexing sweep for virtualized chats (ChatGPT). User-triggered.
 *
 * A never-before-seen old chat only mounts a scroll window into the DOM,
 * so Memoko can't know its hidden history. On request, this saves the
 * user's scroll position, slow-scrolls the conversation from top to
 * bottom pausing at each window so it renders, lets the monitor's normal
 * capture upsert every message into the ledger by id, then restores the
 * original scroll position. Cancellable; runs only when not streaming.
 *
 * It does NOT count tokens itself — it just drives the scroll and calls
 * `capture()` (the monitor's read+upsert) at each step, reusing the exact
 * same counting path so totals stay consistent.
 */

export type IndexPhase = 'running' | 'done' | 'cancelled' | 'unavailable';

export interface IndexProgress {
  phase: IndexPhase;
  /** Messages in the ledger so far (grows as windows render). */
  found: number;
}

export interface Indexer {
  run(): Promise<void>;
  cancel(): void;
  running(): boolean;
}

interface IndexerDeps {
  scrollContainer: () => HTMLElement | null;
  /** Read the visible transcript and upsert it into the ledger. */
  capture: () => void;
  /** Current ledger size, for progress reporting. */
  size: () => number;
  /** True while a response is streaming (don't sweep then). */
  streaming: () => boolean;
  onProgress: (p: IndexProgress) => void;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const SETTLE_MS = 450; // let a freshly-scrolled window render
const STEP_FRACTION = 0.75; // scroll ~75% of a viewport per step (overlap)
const MAX_STEPS = 400; // hard safety bound

export function createIndexer(deps: IndexerDeps): Indexer {
  let cancelled = false;
  let active = false;

  const run = async (): Promise<void> => {
    if (active) return;
    const container = deps.scrollContainer();
    if (!container || deps.streaming()) {
      deps.onProgress({ phase: 'unavailable', found: deps.size() });
      return;
    }
    active = true;
    cancelled = false;
    let interrupted = false;
    const startTop = container.scrollTop;
    try {
      deps.onProgress({ phase: 'running', found: deps.size() });
      container.scrollTo({ top: 0 });
      await wait(SETTLE_MS + 200);

      let pos = 0;
      const maxTop = () => Math.max(0, container.scrollHeight - container.clientHeight);
      for (let step = 0; step < MAX_STEPS; step++) {
        if (cancelled) break;
        if (deps.streaming()) {
          interrupted = true;
          break;
        }
        deps.capture();
        deps.onProgress({ phase: 'running', found: deps.size() });
        if (pos >= maxTop()) break; // reached the bottom (scrollHeight may grow as it renders)
        pos = Math.min(pos + container.clientHeight * STEP_FRACTION, maxTop());
        container.scrollTo({ top: pos });
        await wait(SETTLE_MS);
      }
      if (!cancelled && !interrupted) deps.capture(); // final window
    } catch {
      // degrade silently
    } finally {
      try {
        container.scrollTo({ top: startTop });
      } catch {
        // ignore
      }
      active = false;
      deps.onProgress({
        phase: cancelled || interrupted ? 'cancelled' : 'done',
        found: deps.size(),
      });
    }
  };

  return {
    run,
    cancel: () => {
      cancelled = true;
    },
    running: () => active,
  };
}
