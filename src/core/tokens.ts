/**
 * Token estimation. Everything here is an ESTIMATE — all UI surfaces
 * must label it as such (the "~" prefix).
 *
 * `estimateTokensText` is the content-aware estimator (v0.2.1). The flat
 * chars-per-token heuristic has two measured failure modes:
 *
 *  - CJK: Chinese/Japanese/Korean tokenize at roughly 1 token PER
 *    CHARACTER on modern BPE vocabularies — a flat 3.7 chars/token
 *    undercounts CJK conversations 3–4×.
 *  - Code: measured ~2.7 chars/token (TypeScript on Claude's current
 *    tokenizer) vs ~3.6 for English prose — flat division undercounts
 *    code-heavy chats by ~25%.
 *
 * So: CJK-range characters cost 1 token each; the remaining text is
 * classified per line as code-ish (dense) or prose, using indentation
 * and symbol density. The user's charsPerToken setting stays meaningful
 * as the PROSE anchor; the code rate scales with it (2.69/3.60 ≈ 0.75×).
 */

/** Density anchors measured on Claude's current tokenizer. */
export const PROSE_CHARS_PER_TOKEN = 3.6;
const CODE_DENSITY_RATIO = 2.69 / 3.6; // code cpt = prose cpt × this

/** Legacy flat estimate — for callers that only have a char count. */
export function estimateTokens(charCount: number, charsPerToken: number): number {
  if (charCount <= 0 || charsPerToken <= 0) return 0;
  return Math.round(charCount / charsPerToken);
}

function isCjk(code: number): boolean {
  return (
    (code >= 0x3040 && code <= 0x30ff) || // hiragana + katakana
    (code >= 0x3400 && code <= 0x4dbf) || // CJK ext A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK unified
    (code >= 0xac00 && code <= 0xd7af) || // hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility
    (code >= 0xff00 && code <= 0xffef) // full/half-width forms
  );
}

function isAsciiSymbol(code: number): boolean {
  // printable ASCII that is not alphanumeric or space
  return (
    (code >= 0x21 && code <= 0x2f) ||
    (code >= 0x3a && code <= 0x40) ||
    (code >= 0x5b && code <= 0x60) ||
    (code >= 0x7b && code <= 0x7e)
  );
}

/** Per-line code-ish signal: deep indent or symbol-dense content. */
const CODE_INDENT = 4;
const CODE_SYMBOL_RATIO = 0.08;

export function estimateTokensText(text: string, proseCharsPerToken: number): number {
  if (!text || proseCharsPerToken <= 0) return 0;
  const codeCpt = proseCharsPerToken * CODE_DENSITY_RATIO;

  let tokens = 0;
  let lineStart = 0;
  const len = text.length;
  // Markdown fenced code blocks (``` or ~~~) often carry no indentation,
  // so the per-line indent/symbol heuristic misses them. Track fence
  // state and charge everything between fences — and the fence lines
  // themselves — at the code rate.
  let inFence = false;

  while (lineStart <= len) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = len;

    let cjk = 0;
    let symbols = 0;
    let nonSpace = 0;
    let indent = 0;
    let inIndent = true;
    for (let i = lineStart; i < lineEnd; i++) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x09) {
        if (inIndent) indent++;
        continue;
      }
      inIndent = false;
      nonSpace++;
      if (isCjk(c)) cjk++;
      else if (isAsciiSymbol(c)) symbols++;
    }

    // Fence delimiters: a (possibly indented) line whose first non-space
    // run is ``` or ~~~. The delimiter line counts as code on both edges.
    const firstCh = text.charCodeAt(lineStart + indent);
    let isFence = false;
    if (firstCh === 0x60 /* ` */ || firstCh === 0x7e /* ~ */) {
      const b = lineStart + indent;
      if (text.charCodeAt(b + 1) === firstCh && text.charCodeAt(b + 2) === firstCh) {
        isFence = true;
        inFence = !inFence;
      }
    }
    const forceCode = inFence || isFence;

    // The density anchors are measured over TOTAL characters including
    // inter-word spaces (a typical BPE token is " word"), so charge the
    // whole line at the class rate — except leading indentation, which
    // tokenizers compress hard (~8 chars/token), and CJK at 1 tok/char.
    const charge = lineEnd - lineStart - indent - cjk;
    if (charge > 0) {
      const codeish =
        forceCode ||
        indent >= CODE_INDENT ||
        symbols / Math.max(1, nonSpace) > CODE_SYMBOL_RATIO;
      tokens += charge / (codeish ? codeCpt : proseCharsPerToken);
    }
    tokens += indent / 8;
    tokens += cjk; // ~1 token per CJK character
    if (lineEnd < len) tokens += 0.25; // newline share

    lineStart = lineEnd + 1;
  }

  return Math.round(tokens);
}

export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1_000_000) return Math.round(n / 1000) + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}
