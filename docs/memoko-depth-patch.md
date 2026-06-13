# Memoko depth patch — entrance + streaming watch + handoff celebration + theme tint

Builds on the finalized Memoko drop-in (rose-hair chibi · M sprite · P4 panel · Q3 pill).
Adds the approved **capsule-split entrance (A, 1.25× speed)** and three depth behaviors.
Demo: `Memoko Pill Entrance v2.html` in this project.

## Files

| File | Action |
|---|---|
| `src/content/ui/avatar.ts` | **REPLACE** — adds `MemokoPose` (`watch` / `cheer` poses); palette routed through `--mk-*` CSS vars so the sprite re-tints with the host theme |
| `src/content/ui/pill.ts` | **REPLACE** — entrance on first `show()` (+ HP count-up), watch pose while `stats.streaming`, celebration on handoff `done`. `PillStats`/`PillUI`/`PillCallbacks` byte-identical |
| `src/content/ui/pill.css` | **REPLACE** — entrance keyframes (1.25× baked in), watch/cheer rigs, confetti, light/dark sprite palettes |

Copy over the originals (same paths), then `npm run typecheck && npm run build`.

## What changed (UI only — zero logic changes)

- **Entrance (first `show()` per page load):** a pink-and-cream capsule drops in,
  wiggles, cracks open with a sparkle burst — Memoko pops out, the real pill
  springs to size beneath her, segments cascade in and the HP number counts
  0 → current. ~1.45s total at the approved 1.25× speed. Re-shows after tab
  switches stay instant (`entered` flag). Under `prefers-reduced-motion` the
  pill simply appears.
- **Streaming watch pose:** while `stats.streaming`, the patrol pauses
  (`animation-play-state`) wherever she is and the sprite swaps to `watch` —
  hands clasped, head tipped up at the reply, wide sparkly eyes, pulsing
  attention spark. Segments keep their existing pulse. Critical (KO) Memoko
  stays down. Patrol resumes when streaming ends.
- **Handoff celebration:** on the transition into the `done` phase, she throws
  both arms up (`cheer` pose), does two hops with waving arms and a confetti
  pop above the pill. One-shot, ~1.7s, then back to the pose the stats dictate.
  Won't re-trigger while the result card sits open (transition-edge detection).
- **Theme tint sync:** every sprite/face color now reads `var(--mk-*)`.
  `data-theme` (already set from `detectDarkTheme()` on every update) selects
  the palette: dark keeps the original pastels; light deepens each tone a notch
  so she doesn't wash out on white pages.
- **Panel never opens by itself:** `createPill` now forces `collapsed: true`
  on creation, so the expanded status panel always starts closed on a page
  load (drag position still persists) and opens only on pill click.
- **Full-pill patrol:** `--run-w` bumped 64px → 96px so her laps span the
  whole pill instead of the left half.

## Structural note

The sprite moved from inside the `.pill` button to a new `.pillspot` wrapper
(sibling, same geometry, `z-index` above the button). This lets the entrance
animate the button's opacity without hiding her. Drag/click handlers are
unchanged — they were always on the button.

## Untouched

Adapters, monitor, health/tokens/waste logic, settings, draft meter, popup,
manifest, hint, panel, handoff flow. The three exported interfaces are
byte-identical, so `monitor.ts` needs no changes.

## Caveats / verify

- Run `npm run typecheck` — written against your existing types but not compiled here.
- When the `intro` class is removed (1.7s in), the patrol animation's delay
  reverts, which restarts her run-track phase — in practice a one-time ~13px
  position snap right as she starts running. Invisible in testing; noted for honesty.
- The entrance fires once per content-script injection. SPA navigation between
  chats won't replay it; a full page reload will. If you'd rather have
  once-per-tab-session, gate `entered` behind `sessionStorage` instead.
- The capsule prop sticks out ~36px above the pill during the drop; position
  clamping (`applyPosition`) is unchanged and still measures the button.
- `--mk-*` vars live on `.root` in `pill.css`; tweak the light palette there
  if chatgpt.com's light surfaces change.
- The patrol track (`--run-w: 96px`) is sized for the current pill content
  (HP tag + 7 segments + 2-digit readout ≈ 143px wide). If the pill ever gets
  wider/narrower, adjust it: `pill width − sprite (≈28px) − left offset (8px)
  − ~8px right margin`.
