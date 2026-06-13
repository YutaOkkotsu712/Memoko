/**
 * Per-conversation attachment token ledger (in-memory, session-only).
 *
 * On claude.ai a large paste becomes a file attachment whose text never
 * enters the transcript we scrape — so the visible-transcript estimate
 * undercounts. The draft meter sees the paste's token cost at paste
 * time; we record it here, keyed by conversation, and the monitor folds
 * it into the health total.
 *
 * Conservative by design: entries are keyed by content hash (dedupes an
 * accidental re-paste) and never decremented. Removing an attachment
 * before sending will over-count — acceptable for a health *warning*,
 * which should err toward "you have more context than you can see."
 * Nothing is persisted; the ledger dies with the page.
 */

const ledgers = new Map<string, Map<number, number>>();

export function recordAttachment(convoId: string, contentHash: number, tokens: number): void {
  if (!convoId || tokens <= 0) return;
  let m = ledgers.get(convoId);
  if (!m) {
    m = new Map();
    ledgers.set(convoId, m);
  }
  m.set(contentHash, tokens);
}

export function attachmentTokens(convoId: string | null): number {
  if (!convoId) return 0;
  const m = ledgers.get(convoId);
  if (!m) return 0;
  let total = 0;
  for (const v of m.values()) total += v;
  return total;
}
