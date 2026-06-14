# Memoko

**A health-bar companion for your AI conversations.** Memoko is a tiny
pixel sprite who lives on your claude.ai and chatgpt.com chats: she
sprints while context is fresh, strolls as it fills, trudges when it gets
heavy, and collapses when the conversation is cooked. Click her pill for
an RPG-style status screen — token estimates, duplicate-content waste,
and a one-click handoff to a fresh chat.

(Working name during development: ChatHP. Internal attrs like
`data-chathp` keep that name. Design drop-in notes live in `docs/`.)

## Privacy (the whole point)

- **100% local.** No backend, no API keys, no accounts, no analytics.
- **Nothing leaves your browser.** Conversation content is read from the
  page DOM, used for token estimates, and discarded. Message text is never
  stored and never transmitted.
- **Persisted on disk**: your settings and the pill's position, in
  `chrome.storage.local` on your machine.
- **Session-only estimate memory**: Memoko keeps numeric high-water counts
  per conversation (tokens, messages, duplicates; no text) in
  `chrome.storage.session` so reloads cannot make a long chat look cheap.
- **Read-only.** Memoko never sends messages or automates actions on
  your behalf. The handoff feature *pre-fills* the chat input — you
  always click send.
- **One deliberate exception**: when you click "New chat" on a finished
  handoff, the generated summary is stashed so the fresh chat can be
  prefilled with it. The stash is memory-backed (`chrome.storage.session`
  — never written to disk, cleared when the browser closes), single-use
  (deleted the moment it's read), and expires after 10 minutes. On older
  Chromes without session-storage access it falls back to a local entry
  with the same single-use TTL semantics.

## Install (unpacked)

1. `npm install && npm run build` (Node 18+; this produces `dist/`)
2. Open `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the `dist/` folder
5. Open a conversation on [claude.ai](https://claude.ai) or
   [chatgpt.com](https://chatgpt.com) — Memoko appears bottom-right.
   Click the pill to expand, drag it to move it.

## Features

- **Health pill**: Memoko + a segmented HP bar. Four states — Fresh /
  Healthy / Heavy / Critical — driven by an *adjusted load*: estimated
  context usage plus a turn-count penalty (quality degrades past ~60
  messages, capped +15%) and a duplicate-content penalty (capped +10%).
- **Status panel**: HP readout, token estimate, message count,
  duplicate-waste report ("~9k tok · 3×" — click it to jump to each
  duplicate block with a highlight), session watch time, **burn rate
  with a forecast** ("~1.2k/min · 38m left" until Critical at the
  current pace), a **You / AI token split**, and a clickable
  **Heaviest** row that cycles through the biggest messages in the
  chat. When context takes a hit, a floating "−N HP" damage number pops
  off the pill, RPG-style.
- **Keyboard shortcuts**: Alt+M toggles the panel, Alt+Shift+M starts a
  handoff (rebindable at `chrome://extensions/shortcuts`).
- **Handoff**: pre-fills a prompt asking the model to compress the
  conversation's decisions, state, open threads, and key facts. You press
  send; Memoko captures the finished summary with Copy / New-chat buttons
  and reports the compression ratio ("~182k → ~2.1k tokens · 98.8%
  compressed"). "New chat" carries the summary into the fresh
  conversation's input automatically.
- **Speech bubbles**: Memoko pipes up once when a conversation's health
  state worsens ("Memoko is getting tired…"), rate-limited and
  click-dismissible; the first time a chat ever goes Heavy she points at
  the handoff feature — once, then never again. Toggleable.
- **Toolbar badge**: the extension icon shows the active tab's usage %
  tinted by health state (state + number only, never content).
  Toggleable.
- **Draft cost meter**: live token estimate of your message before you
  send it, anchored to the chat input.
- **Paste auditor**: pastes over a configurable threshold get flagged
  with their cost and % of context, plus opt-in local cleanups (trim
  trailing whitespace, collapse blank lines, strip line numbers — never
  offered for markdown numbered lists). On claude.ai, large pastes become
  file attachments; Memoko reports their cost and offers cleanups only
  when the paste stays inline.
- **Settings popup**: per-site enable with a live **adapter health row**
  ("✓ working · 2m ago" / "⚠ no match — selectors may be stale") so a
  host-site UI change is visible instead of silently breaking; per-site
  context budgets (claude.ai 200k, chatgpt.com 128k by default — set it
  to your plan's window); feature toggles, thresholds, estimator
  calibration. Changes apply live.

## How the estimate works

Token counts are estimated from visible transcript text with a
content-aware heuristic, always labeled with `~`. Per line:

- **CJK characters** (Chinese, Japanese, Korean, full-width forms) cost
  ~1 token each — modern BPE vocabularies tokenize them near 1:1, so a
  flat chars-per-token rule undercounts CJK conversations 3–4×.
- **Code-ish lines** (deep indentation or high symbol density) are
  charged at ~2.7 chars/token; **prose** at ~3.6 — both anchors measured
  on Claude's current tokenizer. Leading indentation is discounted
  (tokenizers compress it to roughly 8 chars/token).
- The popup's "characters per token" setting calibrates the prose
  anchor; the code rate scales with it.

Performance: adapters cache each settled message's text per DOM element
(only new or streaming messages are re-read; a full re-read runs every
30s as a safety valve), token counts are reused by reference equality,
and the duplicate-content scan runs in browser idle time. Long
transcripts cost roughly one message's worth of work per update.

**Model-aware budget**: when "Auto budget" is on (default), Memoko reads
the page's model picker and uses that model's context window
(claude.ai ~200k; chatgpt.com 16k–1M by model) instead of the manual
per-site number, which becomes the fallback. The detected model shows in
the popup's per-site health row.

**Attachment ledger**: on claude.ai a large paste becomes a file
attachment whose text never enters the transcript — so the
visible-transcript estimate undercounts. Memoko records each such
paste's token cost (in memory, per conversation) and folds it into the
health total, shown as "(+~12k attached)" on the tokens line. It's
conservative — keyed by content hash and never decremented — so it errs
toward warning early.

It still can't see server-side context it never observed (system prompt,
tool definitions, file-picker uploads, artifacts), so treat it as a
lower bound.

## Architecture notes

- `src/adapters/` — one module per supported site behind a single
  `SiteAdapter` interface. **Every DOM selector for a site lives in its
  adapter file** with defensive fallback chains, so a host UI change is
  a one-file fix. claude.ai is live-verified; the chatgpt.com adapter is
  built on ChatGPT's stable `data-message-author-role` hooks.
- `src/content/` — adapter-agnostic monitor (debounced MutationObserver,
  SPA-navigation aware), Shadow-DOM pill UI with the Memoko sprite
  (`ui/avatar.ts`), draft meter, handoff controller. Vanilla TS + CSS,
  no framework. All sprite movement stops under
  `prefers-reduced-motion`.
- `src/core/` — token estimator, health heuristics, waste detection,
  settings.
- `src/background.ts` — minimal service worker: exposes session storage
  to content scripts (handoff stash) and relays the per-tab badge.
- On pages or DOM shapes it doesn't recognize, Memoko does nothing and
  logs nothing.

## Animation and easter egg trigger map

The animation system is split three ways:

- `src/content/ui/pill.ts` — runtime state machine, event listeners, and
  one-shot effect triggers.
- `src/content/ui/avatar.ts` — the actual sprite poses (`fresh`,
  `healthy`, `heavy`, `critical`, `watch`, `cheer`, `hurt`, `sit`,
  `laptop`, `book`, `doodle`, `yawn`, `nap`, `wave`).
- `src/content/ui/pill.css` — motion classes and keyframes for patrol,
  idle, reactions, damage flashes, confetti, berry, summit, wake-up,
  and reduced-motion fallbacks.

The local playground in `patrol-harness.html` mirrors these states so
you can force each pose/effect without waiting for the live extension
logic.

### Pose precedence

`syncPose()` in `src/content/ui/pill.ts` resolves the live sprite in this
order:

`konami / celebrate -> berry -> hurt -> startle -> wave -> idle stage -> attentive watch -> streaming watch -> health state`

That means a one-shot effect like Konami or wake-up will temporarily win
over normal patrol/streaming state until its timer clears.

### Trigger map

| Trigger | Result | Code path |
| --- | --- | --- |
| Health state update from the monitor | Patrol pose switches between `fresh`, `healthy`, `heavy`, or `critical` | `update(stats_)` stores `lastState`, then `syncPose()` falls back to the health pose |
| Model is currently streaming | Memoko uses the `watch` pose unless she is idle or critical | `update(stats_)` stores `lastStreaming`; `syncPose()` picks `watch` when `lastStreaming` is true |
| Pointer comes near the pill | Memoko pauses patrol and does live head/eye tracking | `onPointerMove()` -> `setAttentive(true)` when `canAttend()` and the pointer is inside the attention radius |
| No activity for `IDLE_DELAY_MS` (`120_000`) | Idle sequence begins | `scheduleIdle()` -> `goIdle()` -> `enterStage('sit')` |
| Idle sequence continues | She cycles through seated idles, then yawns, then naps | `nextIdle()` randomly picks from `IDLE_ACTIVITIES` (`laptop`, `book`, `doodle`, `kick`, `peek`); `kick` and `peek` reuse the `sit` pose plus CSS classes; then `enterStage('yawn')` -> `enterStage('nap')` |
| Any user activity while idle | Idle is cleared and she wakes up | `noteActivity()` -> `wake(false)` |
| Waking specifically from nap | Startle beat (`watch` + `!`) then a wave | `wake(false)` detects `idleStage === 'nap'`; `playWave(true)` sets `startling`, then `beginWave(true)` |
| Waking from a non-nap idle | Friendly wave | `wake(false)` -> `playWave(false)` -> `beginWave(false)` |
| Clicking the sprite once | Pet reaction based on current health, with hearts/bubble | `sprite.addEventListener('click', ...)` -> `pet()` |
| Clicking the sprite rapidly 4 times within `PET_COMBO_WINDOW_MS` (`1_600`) | Berry snack easter egg | Same click handler increments `petCombo`; when `petCombo >= BERRY_PET_COMBO` (`4`), it calls `fireBerrySnack()` |
| Entering the Konami sequence `↑ ↑ ↓ ↓ ← → ← → B A` | 1-UP + confetti dance | `window.addEventListener('keydown', onKonamiKey)`; a full match calls `fireKonami()` |
| Handoff transitions into `done` | Cheer / celebration burst | `updateHandoff()` detects `view.phase === 'done'` and calls `celebrate()` |
| Handoff saves at least `SUMMIT_SAVED_TOKENS` (`50_000`) | Summit clear flag/glow easter egg | Inside the same `updateHandoff()` transition, `saved >= SUMMIT_SAVED_TOKENS` calls `fireSummitClear()` |
| HP drops by more than 1 point | Hurt flinch pose + damage flash + floating `-N HP` | `update(stats_)` -> `flashClass('hp-drop', ...)` + `spawnDamage(...)` + `triggerHurt()` |
| Entering `critical` from another state | Critical-entry flash | `update(stats_)` -> `flashClass('critical-enter', ...)` |
| First show after injection | Entrance animation | `show()` adds the one-time intro classes/timers before normal idle scheduling resumes |

### Tuning knobs

The easiest numbers to tweak live near the top of
`src/content/ui/pill.ts`:

- `IDLE_DELAY_MS` — how long before the idle routine starts.
- `IDLE_DWELL` — how long each idle stage holds.
- `BERRY_PET_COMBO` and `PET_COMBO_WINDOW_MS` — how hard the berry
  combo is to trigger.
- `SUMMIT_SAVED_TOKENS` — minimum token savings for the summit-clear
  effect.
- `ATTEND_ZONE_IN` / `ATTEND_ZONE_OUT` — how close the pointer must get
  before Memoko notices you.

All motion has reduced-motion fallbacks in `src/content/ui/pill.css`, so
if you add a new effect, wire it into the `prefers-reduced-motion`
section too.

## Dev

```sh
npm run build      # typecheck + production build to dist/
npm run typecheck  # tsc only
npm test           # cleanups / waste / health / tokens / settings suites
npm run icons      # regenerate public/icons/*.png (Memoko face + HP bar)
npm run package    # build + test + chathp-vX.Y.Z.zip for the store
```
