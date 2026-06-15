// Unit checks for the ChatGPT indexing sweep driver. Run with:
//   node --experimental-strip-types scripts/test-indexer.mjs  (Node 22)
import { createIndexer } from '../src/content/indexer.ts';

const fakeContainer = ({ top = 40, height = 100, scrollHeight = 100 } = {}) => ({
  scrollTop: top,
  clientHeight: height,
  scrollHeight,
  scrollTo({ top: nextTop }) {
    this.scrollTop = nextTop;
  },
});

const cases = [
  {
    name: 'refuses to run while already streaming',
    run: async () => {
      const phases = [];
      const indexer = createIndexer({
        scrollContainer: () => fakeContainer(),
        capture: () => {
          throw new Error('should not capture');
        },
        size: () => 0,
        streaming: () => true,
        onProgress: (p) => phases.push(p.phase),
      });
      await indexer.run();
      return phases.length === 1 && phases[0] === 'unavailable';
    },
  },
  {
    name: 'streaming mid-sweep cancels instead of marking done',
    run: async () => {
      const phases = [];
      const container = fakeContainer({ top: 60, height: 100, scrollHeight: 300 });
      let streaming = false;
      let captures = 0;
      const indexer = createIndexer({
        scrollContainer: () => container,
        capture: () => {
          captures++;
          streaming = true;
        },
        size: () => captures,
        streaming: () => streaming,
        onProgress: (p) => phases.push(p.phase),
      });
      await indexer.run();
      return captures === 1 && phases[phases.length - 1] === 'cancelled' && container.scrollTop === 60;
    },
  },
  {
    name: 'successful sweep restores the original scroll position',
    run: async () => {
      const phases = [];
      const container = fakeContainer({ top: 75 });
      let captures = 0;
      const indexer = createIndexer({
        scrollContainer: () => container,
        capture: () => {
          captures++;
        },
        size: () => captures,
        streaming: () => false,
        onProgress: (p) => phases.push(p.phase),
      });
      await indexer.run();
      return captures === 2 && phases[phases.length - 1] === 'done' && container.scrollTop === 75;
    },
  },
];

let failed = 0;
for (const c of cases) {
  const ok = await c.run();
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  if (!ok) failed++;
}
process.exit(failed === 0 ? 0 : 1);
