// Unit checks for model→budget matching and the attachment ledger.
//   node --experimental-strip-types scripts/test-models.mjs  (Node 22)
import { matchModelBudget } from '../src/core/models.ts';
import { recordAttachment, attachmentTokens } from '../src/core/attachments.ts';

const cases = [
  { name: 'null / empty → no match', run: () => matchModelBudget(null) === null && matchModelBudget('') === null },
  { name: 'GPT-4o → 128k', run: () => matchModelBudget('ChatGPT 4o')?.budget === 128_000 },
  { name: 'GPT-4.1 → 1M (beats the 4o/4 rules)', run: () => matchModelBudget('GPT-4.1')?.budget === 1_000_000 },
  { name: 'plain GPT-4 → 128k', run: () => matchModelBudget('GPT-4')?.budget === 128_000 },
  { name: 'GPT-3.5 → 16k', run: () => matchModelBudget('GPT-3.5 Turbo')?.budget === 16_000 },
  { name: 'o3 → o-series 200k', run: () => matchModelBudget('o3')?.name === 'o-series' },
  { name: '"4o" is GPT-4o, not o-series', run: () => matchModelBudget('GPT-4o')?.name === 'GPT-4o' },
  { name: 'Claude Opus → 200k', run: () => matchModelBudget('Claude Opus 4.8')?.budget === 200_000 },
  { name: 'Fable → Claude 200k', run: () => matchModelBudget('Fable 5')?.budget === 200_000 },
  { name: 'gibberish → no match (falls back)', run: () => matchModelBudget('SomeRandomThing') === null },

  // ---- attachment ledger ----
  {
    name: 'ledger sums per conversation',
    run: () => {
      recordAttachment('conv-A', 111, 5000);
      recordAttachment('conv-A', 222, 3000);
      return attachmentTokens('conv-A') === 8000;
    },
  },
  {
    name: 'same content hash dedupes (accidental re-paste)',
    run: () => {
      recordAttachment('conv-B', 999, 4000);
      recordAttachment('conv-B', 999, 4000);
      return attachmentTokens('conv-B') === 4000;
    },
  },
  {
    name: 'conversations are isolated; unknown convo → 0',
    run: () => attachmentTokens('conv-A') === 8000 && attachmentTokens('nope') === 0,
  },
  { name: 'null convo / non-positive tokens ignored', run: () => {
      recordAttachment('', 1, 100);
      recordAttachment('conv-C', 1, 0);
      return attachmentTokens(null) === 0 && attachmentTokens('conv-C') === 0;
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
