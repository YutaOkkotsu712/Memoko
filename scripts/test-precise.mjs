// Exercises the precise-tokenizer module end-to-end (its dynamic imports
// resolve in Node too, so this verifies the load path + API usage; the
// browser dynamic-import/CSP path can only be confirmed in the extension).
//   node --experimental-strip-types scripts/test-precise.mjs  (Node 22)
import {
  ensurePreciseEncoder,
  preciseReady,
  preciseFailed,
  countPrecise,
} from '../src/core/preciseTokenizer.ts';

await ensurePreciseEncoder();

const cases = [
  { name: 'encoder loads (ready, not failed)', run: () => preciseReady() && !preciseFailed() },
  { name: 'empty string → 0', run: () => countPrecise('') === 0 },
  { name: '"hello world" → 2 tokens (exact o200k)', run: () => countPrecise('hello world') === 2 },
  {
    name: 'counts are positive integers',
    run: () => {
      const n = countPrecise('export function transcriptTokens(messages, cpt) { return 0; }');
      return Number.isInteger(n) && n > 0;
    },
  },
  {
    name: 'CJK counts below 1 token/char (o200k corrects the 1:1 heuristic)',
    run: () => {
      const cjk = '東京都内の長い会話はトークンの消費が速い';
      const n = countPrecise(cjk);
      return n !== null && n < cjk.length;
    },
  },
  {
    name: 'idempotent re-load is a no-op (cached)',
    run: async () => {
      await ensurePreciseEncoder();
      return preciseReady();
    },
  },
];

let failed = 0;
for (const c of cases) {
  const ok = await c.run();
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  if (!ok) failed++;
}
process.exit(failed === 0 ? 0 : 1);
