/**
 * Per-conversation token ledger for VIRTUALIZED message lists (ChatGPT).
 *
 * ChatGPT mounts only a sliding window of messages into the DOM and
 * unmounts the rest as you scroll, so "sum the messages currently in the
 * DOM" bounces with scroll position (Memoko visibly took damage / healed
 * as the user scrolled). Instead we key each message by its stable id and
 * keep a running ledger: every message ever seen stays counted even after
 * it scrolls out, a double-mounted message counts once (same id), and a
 * streaming message's count updates in place. The total is then stable
 * and converges to the true conversation size as more of it is revealed.
 *
 * Persistence is handled by core/ledgerStore.ts; this module stays pure
 * and in-memory so merge/count behavior is easy to test.
 */

export interface LedgerEntry {
  tokens: number;
  role: 'user' | 'assistant';
}

export interface LedgerItem {
  id: string;
  tokens: number;
  role: 'user' | 'assistant';
}

const MAX_LEDGER_ID_LENGTH = 180;
const BLOCKED_LEDGER_IDS = new Set(['__proto__', 'constructor', 'prototype']);

export function isSafeLedgerId(id: string): boolean {
  return (
    id.length > 0 &&
    id.length <= MAX_LEDGER_ID_LENGTH &&
    !id.includes('\0') &&
    !BLOCKED_LEDGER_IDS.has(id)
  );
}

/** Upsert the currently-visible messages; never removes existing entries. */
export function upsertLedger(
  ledger: Map<string, LedgerEntry>,
  items: readonly LedgerItem[]
): void {
  for (const it of items) {
    if (!isSafeLedgerId(it.id)) continue;
    ledger.set(it.id, { tokens: it.tokens, role: it.role });
  }
}

export interface LedgerTotals {
  tokens: number;
  messages: number;
  userTokens: number;
}

export function ledgerTotals(ledger: Map<string, LedgerEntry>): LedgerTotals {
  let tokens = 0;
  let userTokens = 0;
  for (const e of ledger.values()) {
    tokens += e.tokens;
    if (e.role === 'user') userTokens += e.tokens;
  }
  return { tokens, messages: ledger.size, userTokens };
}
