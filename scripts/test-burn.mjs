// Unit checks for the burn-rate math. Run with:
//   node --experimental-strip-types scripts/test-burn.mjs  (Node 22)
import {
  burnPerMin,
  minutesUntil,
  pruneSamples,
  BURN_WINDOW_MS,
} from '../src/core/burn.ts';

const m = (mins) => mins * 60_000;

const cases = [
  {
    name: 'one sample → no rate',
    run: () => burnPerMin([{ at: 0, tokens: 100 }]) === null,
  },
  {
    name: 'too short a span → no rate',
    run: () =>
      burnPerMin([
        { at: 0, tokens: 100 },
        { at: m(1), tokens: 2100 },
      ]) === null,
  },
  {
    name: 'steady growth → tokens/min',
    run: () =>
      burnPerMin([
        { at: 0, tokens: 1000 },
        { at: m(2), tokens: 2000 },
        { at: m(4), tokens: 5000 },
      ]) === 1000,
  },
  {
    name: 'shrinking transcript (edit/regen) → null, not negative',
    run: () =>
      burnPerMin([
        { at: 0, tokens: 5000 },
        { at: m(4), tokens: 1000 },
      ]) === null,
  },
  {
    name: 'prune drops samples outside the window',
    run: () => {
      const now = BURN_WINDOW_MS + m(5);
      const kept = pruneSamples(
        [
          { at: 0, tokens: 1 },
          { at: now - m(3), tokens: 2 },
        ],
        now
      );
      return kept.length === 1 && kept[0].tokens === 2;
    },
  },
  {
    name: 'forecast: 10k to go at 1k/min → 10 minutes',
    run: () => minutesUntil(170_000, 180_000, 1000) === 10,
  },
  {
    name: 'forecast: already past target → null',
    run: () => minutesUntil(190_000, 180_000, 1000) === null,
  },
  {
    name: 'forecast: no rate → null',
    run: () => minutesUntil(0, 180_000, null) === null,
  },
];

let failed = 0;
for (const c of cases) {
  const ok = c.run();
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  if (!ok) failed++;
}
process.exit(failed === 0 ? 0 : 1);
