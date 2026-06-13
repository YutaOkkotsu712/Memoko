# Chrome Web Store listing — Memoko

## Name
Memoko — Context Health for AI Chats

## Summary (≤132 chars)
Memoko keeps watch on your AI chats — she runs while context is fresh and collapses when it's full. 100% local.

## Category
Productivity → Developer Tools

## Description

Long AI conversations silently degrade: the context window fills, quality
drops, and you have no idea until it's too late. Memoko gives every
claude.ai and chatgpt.com conversation a game-style HP bar — with a tiny
companion who lives on it.

**Meet Memoko** — she stands on your context-health pill and acts out the
state of your chat. Fresh context: she sprints laps. Healthy: an easy
stroll. Heavy: a hunched trudge with a sweat drop. Critical: she's flat on
her back with her soul drifting out — time for a handoff.

**Context health pill** — a draggable, collapsible HP meter showing
estimated health remaining, with four states: Fresh, Healthy, Heavy,
Critical. Click it for the full status screen: HP readout, token
estimates, message count, duplicate-content detection, and session age.

**One-click handoff** — when Memoko is exhausted, the extension pre-fills
a prompt asking the assistant to compress everything that matters
(decisions, current state, open threads, key facts) into a dense summary.
You press send. Memoko captures the result with Copy and Open-new-chat
buttons and reports the compression ratio
("~182k → ~2.1k tokens · 98.8% compressed").

**Draft cost meter** — see what your message costs in tokens before you
send it.

**Paste auditor** — large pastes get flagged with their token cost and %
of context, with optional one-click local cleanups: trim trailing
whitespace, collapse blank lines, strip line numbers from pasted code.

**Privacy is the whole point:**
- 100% local. No backend, no API keys, no accounts, no analytics.
- Conversation content never leaves your browser and is never stored.
- The only permission is `storage`, for your settings.
- Read-only: Memoko never sends messages or clicks anything for you.

All token counts are estimates (~3.7 characters/token heuristic), clearly
labeled as such. Context budget and thresholds are configurable.

v0.2 supports claude.ai and chatgpt.com.

## Permission justifications

- **storage** — persists user settings (context budget, thresholds,
  feature toggles) and the meter's screen position. No conversation
  content is ever stored.
- **Host access (claude.ai, chatgpt.com content script)** — required to
  read the conversation transcript in the page DOM for local token
  estimation and to pre-fill (never send) the chat input for the handoff
  feature.

## Privacy practices disclosure

- Single purpose: show local context-usage estimates for AI chat pages.
- No data collected, transmitted, or sold. All processing is in-page.
- No remote code.

## Assets checklist

- [x] Icon 128×128: `public/icons/icon128.png` (regenerate: `npm run icons`)
- [ ] Screenshots 1280×800 (3–5): take on a DEMO conversation (never real
      user content): pill with Memoko sprinting, panel expanded (RPG
      status screen), Memoko collapsed at Critical, handoff result with
      compression ratio, settings popup.
- [ ] Promo tile 440×280 (optional) — Memoko running on the HP bar.
