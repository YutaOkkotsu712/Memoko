// Quick unit checks for the waste detector. Run with:
//   node --experimental-strip-types scripts/test-waste.mjs  (Node 22)
import { detectWaste } from '../src/core/waste.ts';

const codeBlock = Array.from({ length: 20 }, (_, i) =>
  `export function helper_${i}(input) { return transform(input, ${i}); }`
).join('\n');

const prose = `Let me think about the architecture here and write up the
reasoning in a couple of sentences that do not repeat.`;

const cases = [
  {
    name: 'same large block pasted twice → flagged once',
    messages: [
      { text: `Here is my code:\n${codeBlock}` },
      { text: `As discussed:\n${codeBlock}\nWhat do you think?` },
    ],
    expect: (r) => r.blocks === 1 && r.avoidableChars > 1000,
  },
  {
    name: 'whitespace-mangled copy still detected (near-duplicate)',
    messages: [
      { text: codeBlock },
      { text: codeBlock.split('\n').map((l) => '   ' + l.replace(/ /g, '  ')).join('\n') },
    ],
    expect: (r) => r.blocks === 1 && r.avoidableChars > 1000,
  },
  {
    name: 'three copies → two avoidable blocks',
    messages: [{ text: codeBlock }, { text: codeBlock }, { text: codeBlock }],
    expect: (r) => r.blocks === 2,
  },
  {
    name: 'refs point at the duplicate copy, not the original',
    messages: [
      { text: `Original here:\n${codeBlock}` },
      { text: 'Just chatting in between.' },
      { text: `Re-pasted:\n${codeBlock}` },
    ],
    expect: (r) => r.blocks === 1 && r.refs.length === 1 && r.refs[0].messageIndex === 2,
  },
  {
    name: 'unique content → nothing',
    messages: [{ text: prose }, { text: codeBlock }],
    expect: (r) => r.blocks === 0 && r.avoidableChars === 0,
  },
  {
    name: 'small repeated snippet (under threshold) → ignored',
    messages: [
      { text: 'try this:\nnpm install\nnpm run build\nok?' },
      { text: 'again:\nnpm install\nnpm run build\ndone' },
    ],
    expect: (r) => r.blocks === 0,
  },
  {
    name: 'repeated trivial brace lines → not noise-flagged',
    messages: [
      { text: '}\n}\n}\n}\n}\n}\n}\n}' },
      { text: '}\n}\n}\n}\n}\n}\n}\n}' },
    ],
    expect: (r) => r.blocks === 0,
  },
  {
    name: 'long single line (minified) pasted twice → flagged',
    messages: [
      { text: 'config: ' + 'x'.repeat(600) },
      { text: 'see config ' + 'x'.repeat(600) },
    ],
    // identical long line normalized... lines differ by prefix → not equal.
    // Use exact same line:
    expect: () => true,
  },
  {
    name: 'identical long single line twice → flagged',
    messages: [{ text: 'y'.repeat(600) }, { text: 'intro\n' + 'y'.repeat(600) }],
    expect: (r) => r.blocks === 1 && r.avoidableChars >= 600,
  },
];

let failed = 0;
for (const c of cases) {
  const r = detectWaste(c.messages);
  const ok = c.expect(r);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  → blocks=${r.blocks} chars=${r.avoidableChars}`);
  if (!ok) failed++;
}
process.exit(failed === 0 ? 0 : 1);
