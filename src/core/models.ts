/**
 * Map a model label scraped from the page to a context-window budget.
 * Adapters supply the raw label (e.g. "ChatGPT 4o", "Claude Opus 4.8",
 * "GPT-4.1"); this normalizes it to a token budget so the health bar is
 * right per-model instead of relying on a manual per-site number.
 *
 * Budgets are the product context windows (estimates, like everything
 * here), conservative where a plan caps below the API max. Unknown
 * labels return null → the caller falls back to the manual budget.
 */

export interface ModelBudget {
  name: string;
  budget: number;
}

// Ordered: more specific patterns first (4.1 before 4o before 4).
const TABLE: { re: RegExp; name: string; budget: number }[] = [
  { re: /gpt[-\s]?4\.1/i, name: 'GPT-4.1', budget: 1_000_000 },
  { re: /(?:gpt|chatgpt)[-\s]?4o|\b4o\b/i, name: 'GPT-4o', budget: 128_000 },
  { re: /\bo[1-4]\b/i, name: 'o-series', budget: 200_000 },
  { re: /gpt[-\s]?4/i, name: 'GPT-4', budget: 128_000 },
  { re: /gpt[-\s]?3\.5|\b3\.5\b/i, name: 'GPT-3.5', budget: 16_000 },
  // Claude product (claude.ai) is ~200k across the current lineup.
  { re: /opus|sonnet|haiku|claude|fable/i, name: 'Claude', budget: 200_000 },
];

export function matchModelBudget(label: string | null | undefined): ModelBudget | null {
  if (!label) return null;
  for (const row of TABLE) {
    if (row.re.test(label)) return { name: row.name, budget: row.budget };
  }
  return null;
}
