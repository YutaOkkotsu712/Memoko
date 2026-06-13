# Memoko patch — finalized design drop-in

Finalized: **rose-hair chibi · M sprite (30px) · P4 RPG panel · Q3 pill (HP readout + state-tinted glow)**.

## Files

| File | Action |
|---|---|
| `src/content/ui/avatar.ts` | **NEW** — Memoko's face + full-body sprite as inline SVG strings, plus `MEMOKO_STATUS` copy |
| `src/content/ui/pill.ts` | **REPLACE** — same logic/interfaces, new markup + Memoko copy |
| `src/content/ui/pill.css` | **REPLACE** — Q3 pill, P4 panel, sprite animation rigs |
| `scripts/gen-icons.mjs` | **REPLACE** — heart → Memoko face (fresh) + HP bar; run `npm run icons` after — see `icon-preview.png` for expected output |
| `manifest.config.ts` | **REPLACE** — name + description → Memoko (132-char limit respected) |
| `src/popup/index.html` | **REPLACE** — title/h1 → Memoko, ver bumped to v0.2 |
| `store/listing.md` | **REPLACE** — listing rewritten around Memoko (incl. mascot blurb + screenshot list) |

Copy the files over the originals (same paths), then `npm run icons && npm run build`.

## What changed (UI only — zero logic changes)

- **Collapsed pill (Q3):** heart icon → Memoko sprite standing ON the pill's top border (absolutely positioned, `pointer-events: none`, so drag/click are untouched). Smooth bar → 7-segment HP bar; number is now **HP remaining** (mono digits); border + soft glow tinted by state color. Usage % remains in the panel and in the pill's hover title.
- **Sprite poses:** Fresh = sprints laps along the border · Healthy = strolls · Heavy = hunched trudge with sweat drop · Critical = lying KO, knee twitch, soul escaping her mouth. All movement stops under `prefers-reduced-motion`.
- **Panel (P4):** RPG status screen — `MEMOKO` letterspaced header with her face avatar, `HP 45 / 100` readout, 10-segment bar, status tidbit ("Memoko is exhausted — hand off this chat."), dotted-leader stat rows with mono values. All rows, tooltips, the hidden Adjusted-load row, duplicate warning color, and the whole handoff flow are intact.
- **Copy:** "ChatHP" → "Memoko" in the pill title/aria-label, onboarding hint, and handoff note. `MEMOKO_STATUS` lives in `avatar.ts` if you want the tidbits elsewhere.

## Untouched

Adapters, monitor, health/tokens/waste logic, settings, draft meter, paste auditor, popup, manifest. `PillStats`/`PillUI`/`PillCallbacks` interfaces are byte-identical, so `monitor.ts` needs no changes.

## Caveats / verify

- Run `npm run typecheck` — written against your existing types but not compiled here.
- The sprite's run track is a fixed 64px (`--run-w` in `pill.css`); if you ever widen the pill, bump it.
- The sprite adds ~26px of visual height above the pill; position clamping (`applyPosition`) is unchanged and still measures the button itself.

## Suggested follow-ups (not included)

- Search remaining "ChatHP" strings: `grep -ri chathp src/ README.md` — internal attrs like `data-chathp` and the repo/package name are safe to keep (or rename at your leisure; `package.json` name affects the `npm run package` zip filename).
- README.md intro still says ChatHP.
