// Dev-only: bundles the content script (and popup logic) into single-file
// IIFEs for page-injection testing. Not part of the shipped build.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const inlineCss = {
  name: 'inline-css',
  setup(b) {
    b.onResolve({ filter: /\.css\?inline$/ }, (args) => ({
      path: join(args.resolveDir, args.path.replace('?inline', '')),
      namespace: 'inline-css',
    }));
    b.onLoad({ filter: /.*/, namespace: 'inline-css' }, (args) => ({
      contents: `export default ${JSON.stringify(readFileSync(args.path, 'utf8'))}`,
      loader: 'js',
    }));
  },
};

await build({
  entryPoints: [join(root, 'src/content/index.ts')],
  bundle: true,
  format: 'iife',
  minify: true,
  outfile: '/tmp/chathp-content.iife.js',
  plugins: [inlineCss],
});

await build({
  entryPoints: [join(root, 'src/popup/main.ts')],
  bundle: true,
  format: 'iife',
  minify: true,
  outfile: '/tmp/chathp-popup.iife.js',
});

console.log('bundled: /tmp/chathp-content.iife.js, /tmp/chathp-popup.iife.js');
