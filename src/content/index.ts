import { pickAdapter } from '../adapters/registry';
import { startMonitor } from './monitor';

(() => {
  try {
    const FLAG = '__chathp_loaded__';
    const w = window as unknown as Record<string, unknown>;
    if (w[FLAG]) return;
    w[FLAG] = true;

    const adapter = pickAdapter(location);
    if (!adapter) return;

    void startMonitor(adapter).catch(() => {
      // degrade silently
    });
  } catch {
    // degrade silently
  }
})();
