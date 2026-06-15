// Unit checks for the virtualized-list token ledger. Run with:
//   node --experimental-strip-types scripts/test-ledger.mjs  (Node 22)
import { upsertLedger, ledgerTotals } from '../src/core/ledger.ts';

const cases = [
  {
    name: 'sums distinct messages by id',
    run: () => {
      const l = new Map();
      upsertLedger(l, [
        { id: 'a', tokens: 100, role: 'user' },
        { id: 'b', tokens: 200, role: 'assistant' },
      ]);
      const t = ledgerTotals(l);
      return t.tokens === 300 && t.messages === 2 && t.userTokens === 100;
    },
  },
  {
    name: 'a double-mounted id counts once',
    run: () => {
      const l = new Map();
      upsertLedger(l, [
        { id: 'a', tokens: 100, role: 'user' },
        { id: 'a', tokens: 100, role: 'user' },
      ]);
      return ledgerTotals(l).tokens === 100 && ledgerTotals(l).messages === 1;
    },
  },
  {
    name: 'scroll-out keeps prior messages counted (no fluctuation)',
    run: () => {
      const l = new Map();
      // window 1: messages a,b visible
      upsertLedger(l, [
        { id: 'a', tokens: 100, role: 'user' },
        { id: 'b', tokens: 150, role: 'assistant' },
      ]);
      // window 2: scrolled — only c,d in the DOM now (a,b unmounted)
      upsertLedger(l, [
        { id: 'c', tokens: 120, role: 'user' },
        { id: 'd', tokens: 180, role: 'assistant' },
      ]);
      const t = ledgerTotals(l);
      // total reflects ALL four, not just the visible two
      return t.tokens === 550 && t.messages === 4;
    },
  },
  {
    name: 'streaming message count updates in place',
    run: () => {
      const l = new Map();
      upsertLedger(l, [{ id: 'x', tokens: 10, role: 'assistant' }]);
      upsertLedger(l, [{ id: 'x', tokens: 250, role: 'assistant' }]); // grew
      const t = ledgerTotals(l);
      return t.tokens === 250 && t.messages === 1;
    },
  },
  {
    name: 'monotonic as a virtualized chat is scrolled through',
    run: () => {
      const l = new Map();
      let prev = 0;
      for (let win = 0; win < 5; win++) {
        upsertLedger(l, [
          { id: `m${win * 2}`, tokens: 100, role: 'user' },
          { id: `m${win * 2 + 1}`, tokens: 100, role: 'assistant' },
        ]);
        const t = ledgerTotals(l).tokens;
        if (t < prev) return false; // never decreases
        prev = t;
      }
      return prev === 1000;
    },
  },
  {
    name: 'items without an id are skipped',
    run: () => {
      const l = new Map();
      upsertLedger(l, [{ id: '', tokens: 100, role: 'user' }]);
      return ledgerTotals(l).messages === 0;
    },
  },
  {
    name: 'unsafe ids are skipped',
    run: () => {
      const l = new Map();
      upsertLedger(l, [
        { id: '__proto__', tokens: 100, role: 'user' },
        { id: 'x'.repeat(181), tokens: 100, role: 'assistant' },
        { id: 'safe-id', tokens: 25, role: 'user' },
      ]);
      const t = ledgerTotals(l);
      return t.messages === 1 && t.tokens === 25;
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
