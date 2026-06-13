/**
 * Minimal service worker. Its only job is to make chrome.storage.session
 * accessible from content scripts, which the handoff stash uses to carry
 * a generated summary into a fresh chat (memory-backed, cleared when the
 * browser closes). No listeners with logic, no data access, no network.
 */

function allowSessionStorageInContentScripts(): void {
  try {
    void chrome.storage.session.setAccessLevel({
      accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
    });
  } catch {
    // older Chrome — content scripts fall back to a self-deleting
    // local stash with the same TTL
  }
}

allowSessionStorageInContentScripts();
chrome.runtime.onInstalled.addListener(allowSessionStorageInContentScripts);
chrome.runtime.onStartup.addListener(allowSessionStorageInContentScripts);

/**
 * Toolbar badge: per-tab usage % sent by the content script (state +
 * percentage only — never content). Content scripts can't touch
 * chrome.action, so this is the relay.
 */
const BADGE_COLORS: Record<string, string> = {
  fresh: '#34d399',
  healthy: '#a3e635',
  heavy: '#f59e0b',
  critical: '#ef4444',
};

/** Keyboard shortcuts → relay to the active tab's content script. */
chrome.commands?.onCommand.addListener((command) => {
  chrome.tabs
    .query({ active: true, currentWindow: true })
    .then(([tab]) => {
      if (typeof tab?.id !== 'number') return;
      return chrome.tabs.sendMessage(tab.id, { type: 'chathp:command', command });
    })
    .catch(() => {
      // no Memoko on that tab — nothing to do
    });
});

chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
  try {
    const m = msg as { type?: string; text?: string; state?: string };
    if (!m || m.type !== 'chathp:badge') return;
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') return;
    void chrome.action.setBadgeText({ tabId, text: typeof m.text === 'string' ? m.text : '' });
    void chrome.action.setBadgeBackgroundColor({
      tabId,
      color: BADGE_COLORS[String(m.state)] ?? '#9aa1ad',
    });
    chrome.action.setBadgeTextColor?.({ tabId, color: '#16181c' });
  } catch {
    // degrade silently
  }
});
