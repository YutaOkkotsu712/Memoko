// Unit checks for settings merge/migration and per-site budgets. Run with:
//   node --experimental-strip-types scripts/test-settings.mjs  (Node 22)
import { mergeSettings, budgetFor, DEFAULT_SETTINGS } from '../src/core/settings.ts';

const cases = [
  {
    name: 'defaults: claude 200k, chatgpt 128k',
    run: () => {
      const s = mergeSettings(undefined);
      return budgetFor(s, 'claude') === 200_000 && budgetFor(s, 'chatgpt') === 128_000;
    },
  },
  {
    name: 'defaults: HP bands are 70 / 40 / 10',
    run: () => {
      const s = mergeSettings(undefined);
      return s.thresholds.healthy === 30 && s.thresholds.heavy === 60 && s.thresholds.critical === 90;
    },
  },
  {
    name: 'defaults: paste auditor starts at 150 tokens',
    run: () => mergeSettings(undefined).pasteAuditMinTokens === 150,
  },
  {
    name: 'legacy default thresholds migrate to new HP bands',
    run: () => {
      const s = mergeSettings({ thresholds: { healthy: 40, heavy: 70, critical: 90 } });
      return s.thresholds.healthy === 30 && s.thresholds.heavy === 60 && s.thresholds.critical === 90;
    },
  },
  {
    name: 'legacy paste audit default migrates to 150',
    run: () => mergeSettings({ pasteAuditMinTokens: 1000 }).pasteAuditMinTokens === 150,
  },
  {
    name: 'custom paste audit threshold is preserved',
    run: () => mergeSettings({ pasteAuditMinTokens: 300 }).pasteAuditMinTokens === 300,
  },
  {
    name: 'custom thresholds are preserved',
    run: () => {
      const s = mergeSettings({ thresholds: { healthy: 25, heavy: 55, critical: 85 } });
      return s.thresholds.healthy === 25 && s.thresholds.heavy === 55 && s.thresholds.critical === 85;
    },
  },
  {
    name: 'legacy global contextBudget migrates to claude only',
    run: () => {
      const s = mergeSettings({ contextBudget: 150_000 });
      return budgetFor(s, 'claude') === 150_000 && budgetFor(s, 'chatgpt') === 128_000;
    },
  },
  {
    name: 'explicit per-site budgets win over legacy value',
    run: () => {
      const s = mergeSettings({ contextBudget: 150_000, budgets: { claude: 90_000 } });
      return budgetFor(s, 'claude') === 90_000;
    },
  },
  {
    name: 'unknown site falls back to 200k',
    run: () => budgetFor(mergeSettings(undefined), 'gemini') === 200_000,
  },
  {
    name: 'garbage budget values are ignored',
    run: () => {
      const s = mergeSettings({ budgets: { claude: -5, chatgpt: 'lots' } });
      return budgetFor(s, 'claude') === 200_000 && budgetFor(s, 'chatgpt') === 128_000;
    },
  },
  {
    name: 'merge never mutates DEFAULT_SETTINGS',
    run: () => {
      mergeSettings({ budgets: { claude: 1_000 } });
      return DEFAULT_SETTINGS.budgets['claude'] === 200_000;
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
