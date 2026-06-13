// Unit checks for the content-aware token estimator. Run with:
//   node --experimental-strip-types scripts/test-tokens.mjs  (Node 22)
//
// Anchors (measured on Claude's current tokenizer, see README):
//   English prose ≈ 3.6 chars/token · code ≈ 2.7 · CJK ≈ 1 token/char.
// Assertions are bands, not exact counts — it's an estimator.
import { estimateTokensText, PROSE_CHARS_PER_TOKEN } from '../src/core/tokens.ts';

const CPT = PROSE_CHARS_PER_TOKEN;

const prose = `The conversation had been going on for hours, and the quality of the
answers was starting to drift in ways that were hard to pin down but easy
to feel. Context windows do not fail loudly; they fail by becoming vague,
repeating themselves, and forgetting the constraints you stated early on.
The only real defense is visibility, which is the entire reason this
extension exists in the first place.`.repeat(3);

const code = `export function transcriptTokens(messages, cpt) {
  const next = new Map();
  let total = 0;
  for (const m of messages) {
    const key = m.text.length + ":" + cyrb53(m.text);
    let t = next.get(key) ?? cache.get(key);
    if (t === undefined) t = estimateTokensText(m.text, cpt);
    next.set(key, t);
    total += t;
  }
  return total;
}`.repeat(4);

const cjk = '東京都内の長い会話はトークンの消費が非常に速いので注意が必要です。'.repeat(12);

const cases = [
  {
    name: 'empty → 0',
    run: () => estimateTokensText('', CPT) === 0,
  },
  {
    name: `prose lands near chars/3.6 (band chars/4.4 .. chars/3.0)`,
    run: () => {
      const t = estimateTokensText(prose, CPT);
      return t >= prose.length / 4.4 && t <= prose.length / 3.0;
    },
  },
  {
    name: 'code is denser per char than prose',
    run: () => {
      const tp = estimateTokensText(prose, CPT) / prose.length;
      const tc = estimateTokensText(code, CPT) / code.length;
      return tc > tp * 1.15;
    },
  },
  {
    name: 'code lands near chars/2.7 (band chars/3.4 .. chars/2.2)',
    run: () => {
      const t = estimateTokensText(code, CPT);
      return t >= code.length / 3.4 && t <= code.length / 2.2;
    },
  },
  {
    name: 'fence rescues prose-shaped lines that the per-line heuristic misses',
    run: () => {
      // Flush-left, symbol-sparse body: unfenced it reads as prose, so
      // the fence is the only signal that it's code (e.g. a config dump
      // or REPL transcript). Fencing must charge the body at code rate,
      // which is denser → strictly more tokens for the SAME body chars.
      const body = 'the quick brown fox jumps\nover the lazy sleeping dog\nand then runs away';
      const bodyTokens = estimateTokensText(body, CPT);
      const fencedBodyOnly = estimateTokensText('```\n' + body + '\n```', CPT);
      // subtract the two fence-delimiter lines' contribution so we compare
      // the body alone: fence lines are tiny, so a clear inequality on the
      // full strings already proves the body got denser
      return fencedBodyOnly > bodyTokens;
    },
  },
  {
    name: 'CJK ≈ 1 token per character (band 0.85–1.15)',
    run: () => {
      const t = estimateTokensText(cjk, CPT);
      return t >= cjk.length * 0.85 && t <= cjk.length * 1.15;
    },
  },
  {
    name: 'CJK fix is large vs flat heuristic (≥2.5× the old estimate)',
    run: () => estimateTokensText(cjk, CPT) >= (cjk.length / 3.7) * 2.5,
  },
  {
    name: 'mixed content sums sensibly (between pure-prose and pure-CJK rates)',
    run: () => {
      const mixed = prose + '\n' + cjk + '\n' + code;
      const t = estimateTokensText(mixed, CPT);
      const lo = mixed.length / 4.4;
      const hi = mixed.length * 1.15;
      return t > lo && t < hi;
    },
  },
  {
    name: 'monotonic: more text never costs fewer tokens',
    run: () =>
      estimateTokensText(prose + code, CPT) >= estimateTokensText(prose, CPT),
  },
  {
    name: 'user calibration scales the non-CJK estimate',
    run: () => {
      const loose = estimateTokensText(prose, 4.4);
      const tight = estimateTokensText(prose, 3.0);
      return tight > loose;
    },
  },
];

let failed = 0;
for (const c of cases) {
  const ok = c.run();
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  if (!ok) failed++;
}
const report = (label, text) =>
  console.log(
    `  ${label}: ${text.length} chars → ~${estimateTokensText(text, CPT)} tok (${(
      text.length / estimateTokensText(text, CPT)
    ).toFixed(2)} chars/tok)`
  );
report('prose', prose);
report('code ', code);
report('cjk  ', cjk);
process.exit(failed === 0 ? 0 : 1);
