/**
 * Persistence for the per-conversation token ledger (see core/ledger.ts).
 *
 * Why persist: ChatGPT virtualizes its message list, so on reload the DOM
 * only holds a scroll window. A persisted ledger lets a previously-seen
 * chat show its full total instantly on reload instead of re-accumulating
 * from the window as you scroll.
 *
 * Privacy: stores ONLY id → [role, tokenEstimate] plus a per-chat
 * timestamp. No message text, no content. chrome.storage.local (survives
 * restarts), bounded by an LRU byte cap with oldest-chat eviction so it
 * can't grow into a storage attic.
 */

// .ts extension so Node's type-stripping test runner can resolve it too
import { isSafeLedgerId, type LedgerEntry } from './ledger.ts';

const PREFIX = 'cl:'; // conversation-ledger key prefix
const IDX_PREFIX = 'cli:'; // "chat fully indexed at" marker prefix
/** Keep total persisted ledgers under this; local quota is ~10MB. */
export const LEDGER_CAP_BYTES = 8 * 1024 * 1024;

const keyFor = (siteId: string, convoId: string): string => `${PREFIX}${siteId}:${convoId}`;
const idxKeyFor = (siteId: string, convoId: string): string =>
  `${IDX_PREFIX}${siteId}:${convoId}`;

/** Compact on-disk shape: id → [role 'u'|'a', tokenEstimate]. */
type CompactEntries = Record<string, [string, number]>;
interface StoredLedger {
  e: CompactEntries;
  at: number; // last write (used for LRU eviction)
}

export function serializeLedger(entries: Map<string, LedgerEntry>): CompactEntries {
  const e = Object.create(null) as CompactEntries;
  for (const [id, v] of entries) {
    if (!isSafeLedgerId(id)) continue;
    e[id] = [v.role === 'user' ? 'u' : 'a', Math.max(0, Math.round(v.tokens))];
  }
  return e;
}

export function deserializeLedger(e: CompactEntries | undefined): Map<string, LedgerEntry> {
  const m = new Map<string, LedgerEntry>();
  if (e && typeof e === 'object') {
    for (const [id, v] of Object.entries(e)) {
      if (!isSafeLedgerId(id)) continue;
      if (Array.isArray(v) && v.length === 2) {
        m.set(id, { role: v[0] === 'u' ? 'user' : 'assistant', tokens: Number(v[1]) || 0 });
      }
    }
  }
  return m;
}

/** Oldest-first eviction: returns the keys to drop to get under the cap. */
export function planEviction(
  metas: ReadonlyArray<{ key: string; at: number; bytes: number }>,
  capBytes: number
): string[] {
  let total = 0;
  for (const m of metas) total += m.bytes;
  if (total <= capBytes) return [];
  const byOldest = [...metas].sort((a, b) => a.at - b.at);
  const evict: string[] = [];
  for (const m of byOldest) {
    if (total <= capBytes) break;
    evict.push(m.key);
    total -= m.bytes;
  }
  return evict;
}

export function indexedKeysForLedgerKeys(keys: readonly string[]): string[] {
  return keys
    .filter((key) => key.startsWith(PREFIX))
    .map((key) => `${IDX_PREFIX}${key.slice(PREFIX.length)}`);
}

export async function loadLedger(
  siteId: string,
  convoId: string
): Promise<Map<string, LedgerEntry>> {
  try {
    const key = keyFor(siteId, convoId);
    const got = await chrome.storage.local.get(key);
    return deserializeLedger((got?.[key] as StoredLedger | undefined)?.e);
  } catch {
    return new Map();
  }
}

export async function saveLedger(
  siteId: string,
  convoId: string,
  entries: Map<string, LedgerEntry>
): Promise<void> {
  if (entries.size === 0) return;
  const key = keyFor(siteId, convoId);
  const payload: StoredLedger = { e: serializeLedger(entries), at: Date.now() };
  try {
    await chrome.storage.local.set({ [key]: payload });
    await enforceLedgerCap();
  } catch {
    // If storage was already near quota, evict old ledgers once and retry.
    try {
      await enforceLedgerCap();
      await chrome.storage.local.set({ [key]: payload });
      await enforceLedgerCap();
    } catch {
      // non-fatal: the in-memory ledger still works this session
    }
  }
}

/** Timestamp a chat was fully swept by the indexer, or null. */
export async function loadIndexedAt(siteId: string, convoId: string): Promise<number | null> {
  try {
    const key = idxKeyFor(siteId, convoId);
    const got = await chrome.storage.local.get(key);
    const v = got?.[key];
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}

export async function markIndexed(siteId: string, convoId: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [idxKeyFor(siteId, convoId)]: Date.now() });
  } catch {
    // non-fatal
  }
}

/** Scan all persisted ledgers and evict the oldest if over the cap. */
export async function enforceLedgerCap(): Promise<void> {
  try {
    const all = await chrome.storage.local.get(null);
    const metas: { key: string; at: number; bytes: number }[] = [];
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith(PREFIX)) continue;
      const at = (v as StoredLedger)?.at ?? 0;
      metas.push({ key: k, at, bytes: k.length + JSON.stringify(v).length });
    }
    const evict = planEviction(metas, LEDGER_CAP_BYTES);
    if (evict.length) {
      await chrome.storage.local.remove([...evict, ...indexedKeysForLedgerKeys(evict)]);
    }
  } catch {
    // non-fatal
  }
}
