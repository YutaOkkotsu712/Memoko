import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Memoko — Context Health for AI Chats',
  version: '0.6.0',
  description:
    'A health-bar companion for AI chats: Memoko runs while context is fresh, collapses when full. 100% local. claude.ai + chatgpt.com.',
  permissions: ['storage'],
  background: {
    service_worker: 'src/background.ts',
    type: 'module',
  },
  commands: {
    'toggle-panel': {
      suggested_key: { default: 'Alt+M' },
      description: "Toggle Memoko's status panel",
    },
    'generate-handoff': {
      suggested_key: { default: 'Alt+Shift+M' },
      description: 'Generate a handoff summary for the current chat',
    },
  },
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
    },
  },
  content_scripts: [
    {
      matches: [
        'https://claude.ai/*',
        'https://chatgpt.com/*',
        'https://chat.openai.com/*',
      ],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
});
