// Unit checks for the effective-load heuristics. Run with:
//   node --experimental-strip-types scripts/test-health.mjs  (Node 22)
import {
  effectiveLoadPct,
  healthState,
  mergeReloadEstimate,
} from '../src/core/health.ts';

const T = { healthy: 30, heavy: 60, critical: 90 };
const base = { usagePct: 50, messageCount: 20, dupTokens: 0, budget: 200_000 };

const cases = [
  {
    name: 'short clean conversation → no adjustment',
    input: base,
    expect: (v) => v === 50,
  },
  {
    name: 'turn penalty kicks in past 60 messages',
    input: { ...base, messageCount: 160 },
    expect: (v) => v === 50 + 15, // (160-60)*0.15 = 15, capped at 15
  },
  {
    name: 'turn penalty caps at +15',
    input: { ...base, messageCount: 500 },
    expect: (v) => v === 65,
  },
  {
    name: 'duplicate penalty: half the dup budget share',
    input: { ...base, dupTokens: 20_000 }, // 10% of budget → +5
    expect: (v) => v === 55,
  },
  {
    name: 'duplicate penalty caps at +10',
    input: { ...base, dupTokens: 100_000 },
    expect: (v) => v === 60,
  },
  {
    name: 'adjustments can change the state, not just the number',
    input: { usagePct: 56, messageCount: 200, dupTokens: 0, budget: 200_000 },
    expect: (v) => healthState(v, T) === 'heavy' && healthState(56, T) === 'healthy',
  },
  {
    name: 'default bands map to HP 70 / 40 / 10',
    input: { usagePct: 0, messageCount: 20, dupTokens: 0, budget: 200_000 },
    expect: () =>
      healthState(29.9, T) === 'fresh' &&
      healthState(30, T) === 'healthy' &&
      healthState(59.9, T) === 'healthy' &&
      healthState(60, T) === 'heavy' &&
      healthState(89.9, T) === 'heavy' &&
      healthState(90, T) === 'critical',
  },
  {
    name: 'reload merge keeps restored conversation floor',
    input: null,
    expect: () => {
      const merged = mergeReloadEstimate(
        {
          observedTokens: 16_000,
          observedMessageCount: 12,
          observedDupTokens: 0,
          observedDupBlocks: 0,
        },
        { tokens: 72_000 }
      );
      return (
        merged.baseTokens === 72_000 &&
        merged.messageCount === 12 &&
        merged.dupTokens === 0 &&
        merged.dupBlocks === 0
      );
    },
  },
  {
    name: 'reload merge preserves restored structural penalties until live catches up',
    input: null,
    expect: () => {
      const merged = mergeReloadEstimate(
        {
          observedTokens: 16_000,
          observedMessageCount: 24,
          observedDupTokens: 0,
          observedDupBlocks: 0,
        },
        { tokens: 48_000, messageCount: 88, dupTokens: 18_000, dupBlocks: 3 }
      );
      return (
        merged.baseTokens === 48_000 &&
        merged.messageCount === 88 &&
        merged.dupTokens === 18_000 &&
        merged.dupBlocks === 3
      );
    },
  },
  {
    name: 'reload merge lets larger live counts win once the page catches up',
    input: null,
    expect: () => {
      const merged = mergeReloadEstimate(
        {
          observedTokens: 64_000,
          observedMessageCount: 120,
          observedDupTokens: 22_000,
          observedDupBlocks: 4,
        },
        { tokens: 48_000, messageCount: 88, dupTokens: 18_000, dupBlocks: 3 }
      );
      return (
        merged.baseTokens === 64_000 &&
        merged.messageCount === 120 &&
        merged.dupTokens === 22_000 &&
        merged.dupBlocks === 4
      );
    },
  },
];

let failed = 0;
for (const c of cases) {
  const v = c.input ? effectiveLoadPct(c.input) : NaN;
  const ok = c.expect(v);
  const out = Number.isFinite(v) ? `${v.toFixed(2)}%` : 'helper ok';
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  → ${out}`);
  if (!ok) failed++;
}

// ---- shouldUpdateEstimate (display-stability rule) -------------------------
import { shouldUpdateEstimate } from '../src/core/health.ts';
const E = (tokens, mode = 'p', charsPerToken = 3.6) => ({ tokens, mode, charsPerToken });
const stableCases = [
  { name: 'nothing stored → store', run: () => shouldUpdateEstimate(null, E(50)) === true },
  { name: 'partial re-render does NOT lower the locked-in count', run: () => shouldUpdateEstimate(E(49), E(38)) === false },
  { name: 'a larger full render advances it', run: () => shouldUpdateEstimate(E(49), E(55)) === true },
  { name: 'equal count is a no-op (no write)', run: () => shouldUpdateEstimate(E(49), E(49)) === false },
  { name: 'mode switch heuristic→precise replaces', run: () => shouldUpdateEstimate(E(38, 'h'), E(49, 'p')) === true },
  { name: 'precise→heuristic (precise failed) replaces', run: () => shouldUpdateEstimate(E(49, 'p'), E(38, 'h')) === true },
  { name: 'chars-per-token recalibration replaces even if smaller', run: () => shouldUpdateEstimate(E(49, 'p', 3.6), E(40, 'p', 4.2)) === true },
];
for (const c of stableCases) {
  const ok = c.run();
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  if (!ok) failed++;
}
process.exit(failed === 0 ? 0 : 1);
