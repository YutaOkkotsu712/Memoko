// Unit checks for local draft cleanup helpers. Run with:
//   node --experimental-strip-types scripts/test-cleanups.mjs  (Node 22)
import {
  collapseBlankLines,
  stripLineNumbers,
  stripTrailingWhitespace,
} from '../src/core/cleanups.ts';

const cases = [
  {
    name: 'collapse removes a single blank spacer row',
    run: () => collapseBlankLines('alpha\n\nbeta') === 'alpha\nbeta',
  },
  {
    name: 'collapse removes multiple blank spacer rows',
    run: () => collapseBlankLines('alpha\n\n\nbeta') === 'alpha\nbeta',
  },
  {
    name: 'collapse handles whitespace-only blank rows',
    run: () => collapseBlankLines('alpha\n  \t\nbeta') === 'alpha\nbeta',
  },
  {
    name: 'collapse normalizes CRLF while removing spacer rows',
    run: () => collapseBlankLines('alpha\r\n\r\nbeta') === 'alpha\nbeta',
  },
  {
    name: 'trim only removes trailing horizontal whitespace',
    run: () => stripTrailingWhitespace('alpha  \n beta\t') === 'alpha\n beta',
  },
  {
    name: 'line-number cleanup preserves markdown numbered lists',
    run: () => stripLineNumbers('1. keep\n2: drop') === '1. keep\ndrop',
  },
];

let failed = 0;
for (const c of cases) {
  const ok = c.run();
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  if (!ok) failed++;
}
process.exit(failed === 0 ? 0 : 1);
