/**
 * Local, deterministic draft cleanups for the paste auditor. Pure string
 * functions — no DOM, no network, trivially testable. Each is opt-in via
 * an explicit user click and applies to the whole draft.
 */

/** Trailing spaces/tabs at end of lines (never touches newlines). */
export function stripTrailingWhitespace(text: string): string {
  return text.replace(/[^\S\n]+$/gm, '');
}

/** Blank-only spacer rows are removed, preserving normal line breaks. */
export function collapseBlankLines(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n[^\S\n]*\n+/g, '\n');
}

/**
 * Editor-style line-number prefixes: digits followed by ':', '|', or
 * whitespace. Deliberately does NOT match "1. " so markdown numbered
 * lists survive.
 */
const LINE_NUMBER_PREFIX = /^\s*\d+(?::|\||\s)\s*/;

/** Heuristic: ≥5 non-empty lines and ≥60% of them carry a line-number prefix. */
export function looksLineNumbered(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 5) return false;
  const matched = lines.filter((l) => LINE_NUMBER_PREFIX.test(l)).length;
  return matched / lines.length >= 0.6;
}

export function stripLineNumbers(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(LINE_NUMBER_PREFIX, ''))
    .join('\n');
}
