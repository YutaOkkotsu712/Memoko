import type { SiteAdapter } from './types';
import { chatgptAdapter } from './chatgpt';
import { claudeAdapter } from './claude';

const adapters: SiteAdapter[] = [
  claudeAdapter,
  chatgptAdapter,
];

export function pickAdapter(loc: Location): SiteAdapter | null {
  for (const adapter of adapters) {
    try {
      if (adapter.matches(loc)) return adapter;
    } catch {
      // degrade silently
    }
  }
  return null;
}
