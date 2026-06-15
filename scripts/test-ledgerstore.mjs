// Unit checks for ledger persistence (pure parts: serialize / deserialize /
// eviction). Run with:
//   node --experimental-strip-types scripts/test-ledgerstore.mjs  (Node 22)
import {
  serializeLedger,
  deserializeLedger,
  planEviction,
  planExpiry,
  indexedKeysForLedgerKeys,
} from '../src/core/ledgerStore.ts';

const DAY = 24 * 60 * 60 * 1000;

const mk = (pairs) => new Map(pairs.map(([id, role, tokens]) => [id, { role, tokens }]));

const cases = [
  {
    name: 'serialize → compact [role, tokens] keyed by id',
    run: () => {
      const c = serializeLedger(mk([['a', 'user', 100], ['b', 'assistant', 200]]));
      return c.a[0] === 'u' && c.a[1] === 100 && c.b[0] === 'a' && c.b[1] === 200;
    },
  },
  {
    name: 'round-trips through deserialize',
    run: () => {
      const orig = mk([['a', 'user', 100], ['b', 'assistant', 200]]);
      const back = deserializeLedger(serializeLedger(orig));
      return back.size === 2 && back.get('a').tokens === 100 && back.get('b').role === 'assistant';
    },
  },
  {
    name: 'serialize ignores prototype-pollution ids',
    run: () => {
      const compact = serializeLedger(mk([['__proto__', 'user', 999], ['safe', 'assistant', 12]]));
      const back = deserializeLedger(compact);
      return back.size === 1 && back.get('safe').tokens === 12 && !back.has('__proto__');
    },
  },
  {
    name: 'deserialize tolerates garbage',
    run: () => {
      return (
        deserializeLedger(undefined).size === 0 &&
        deserializeLedger({ x: 'nope', y: [1, 2, 3] }).size === 0
      );
    },
  },
  {
    name: 'compact entry stays small (~bytes per message)',
    run: () => {
      // 1000 messages should serialize to well under 80 KB
      const big = new Map();
      for (let i = 0; i < 1000; i++) big.set(`msg-${i}-uuid`, { role: 'user', tokens: 1234 });
      const bytes = JSON.stringify(serializeLedger(big)).length;
      return bytes < 80_000;
    },
  },
  {
    name: 'eviction: under cap → nothing dropped',
    run: () => planEviction([{ key: 'a', at: 1, bytes: 100 }], 1000).length === 0,
  },
  {
    name: 'eviction: over cap drops oldest first until under',
    run: () => {
      const metas = [
        { key: 'new', at: 300, bytes: 600 },
        { key: 'old', at: 100, bytes: 600 },
        { key: 'mid', at: 200, bytes: 600 },
      ];
      const evict = planEviction(metas, 1000); // total 1800, cap 1000 → drop oldest
      return evict[0] === 'old' && evict.includes('mid') && !evict.includes('new');
    },
  },
  {
    name: 'expiry: drops only chats untouched beyond the TTL',
    run: () => {
      const now = 100 * DAY;
      const metas = [
        { key: 'fresh', at: now - 5 * DAY },
        { key: 'stale', at: now - 31 * DAY },
        { key: 'edge', at: now - 30 * DAY }, // exactly at TTL → kept
      ];
      const expired = planExpiry(metas, now, 30 * DAY);
      return expired.length === 1 && expired[0] === 'stale';
    },
  },
  {
    name: 'expiry: nothing stale → empty',
    run: () => planExpiry([{ key: 'a', at: 100 * DAY }], 100 * DAY, 30 * DAY).length === 0,
  },
  {
    name: 'eviction removes matching indexed markers too',
    run: () => {
      const keys = indexedKeysForLedgerKeys(['cl:chatgpt:abc', 'nope', 'cl:chatgpt:def']);
      return keys.length === 2 && keys[0] === 'cli:chatgpt:abc' && keys[1] === 'cli:chatgpt:def';
    },
  },
];

let failed = 0;
for (const c of cases) {
  const ok = c.run();
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  if (!ok) failed++;
}
process.exit(failed === 0 ? 0 : 1);
