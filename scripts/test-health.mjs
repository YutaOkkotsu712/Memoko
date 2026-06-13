// Unit checks for the effective-load heuristics. Run with:
//   node --experimental-strip-types scripts/test-health.mjs  (Node 22)
import { effectiveLoadPct, healthState } from '../src/core/health.ts';

const T = { healthy: 40, heavy: 70, critical: 90 };
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
    input: { usagePct: 66, messageCount: 200, dupTokens: 0, budget: 200_000 },
    expect: (v) => healthState(v, T) === 'heavy' && healthState(66, T) === 'healthy',
  },
];

let failed = 0;
for (const c of cases) {
  const v = effectiveLoadPct(c.input);
  const ok = c.expect(v);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  → ${v.toFixed(2)}%`);
  if (!ok) failed++;
}
process.exit(failed === 0 ? 0 : 1);
