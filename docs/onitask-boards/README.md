# onitask — /boards

React/TSX rebuild of the "Стол" (boards list) screen, matched pixel-by-pixel
against the reference screenshot and cross-checked against the
`onitask-desk-create` package's design system.

## What's new vs. what's reused

**New (this package):**
- `components/boards/StatBox.tsx` — small notched tile (summary stats + in-card pills)
- `components/boards/BoardCard.tsx` — large notched board card, with the active-board gradient frame
- `app/BoardsPage.tsx` — page composition
- `app/boards.example-data.ts` — mock data matching the reference screenshot
- `components/ui/Button.tsx` — **patched**, additive `corner` prop (default unchanged)
- `styles/globals.boards-addendum.css`, `tailwind.config.boards-addendum.js` — 2 new tokens to merge in

**Reused as-is from onitask-desk-create** (copied in for convenience — if
you already have these in your repo, skip the copies and just point the
imports at your existing files):
- `components/ui/NotchedPanel.tsx`
- `components/ui/SectionHeader.tsx`
- `lib/notch.ts`, `lib/cn.ts`

## The one thing that's different from desk-create's corner system

desk-create uses **four** corner styles (`panel`/`action`/`field`/`none`) to
carry semantic meaning (card vs. button vs. nested field). Pixel-measuring
the /boards screenshot corner-by-corner (all four corners, on the summary
tiles, the in-card pills, both CTA buttons, and all four board cards) found
**only one pattern used anywhere on this screen**: three corners at a plain
4px radius, and a single bottom-right chamfer — i.e. `corner="field"`
everywhere, just at two sizes:

| | radius | chamfer | used by |
|---|---|---|---|
| small container | 4px | 8px | summary tiles, in-card stat pills |
| large container | 4px | 16px | board cards, both CTA buttons |

This matches what you described in the brief. It's *simpler* than
desk-create's system, not an extension of it — so rather than stretching
`panel`/`action` to fit, every container on this screen is `NotchedPanel`
with `corner="field"` and `radius={4}`, at `notch={8}` or `notch={16}`.
`Button.tsx` picked up an additive `corner` prop for this (defaults to the
old `"action"`, so nothing elsewhere breaks).

## Active board = the gradient frame, not a separate treatment

The teal→gold gradient border (`--color-grad-add-from/to`) that
desk-create already uses for "Добавить…" actions is the *same* gradient
wrapped around the active board's card outline in the reference — so
`BoardCard`'s `isActive` prop just swaps `border` (flat hairline) for
`borderGradient` (that same two-color gradient), no new color introduced.

## Two new tokens

Pixel-sampled fill colors on this screen showed a real two-level elevation
system that desk-create's single-surface-token setup doesn't have:

- `#101010` — already `--color-surface` — stat pills, both buttons (recessed)
- `#202020` — **new** `--color-card` — the board card body itself (raised
  half a step above the pills sitting inside it)

Plus `--color-danger: #ff2b3a` for the one red count in the summary row
(only "Процессы" is red in the reference; the in-card pill numbers are all
plain white, including the "Эскалации"/"Перегружен" ones — confirmed by
direct pixel sampling, not assumed).

Merge `styles/globals.boards-addendum.css` into your `:root` block and
`tailwind.config.boards-addendum.js` into `theme.extend.colors`.

## Preview

`boards-preview.html` (plain HTML/CSS, no build step) is the same layout,
useful for a quick visual check in a browser without wiring up the TSX
into your Next.js app first. It's also what the pixel-comparison screenshot
was rendered from.

## Known simplifications

- Avatar uses an inline SVG placeholder — swap `avatarUrl` for real photo URLs.
- Font is Inter throughout; the reference screenshot's exact system font
  wasn't identifiable from a raster screenshot, so minor glyph-width
  differences (a few px here and there in text-heavy rows) are expected
  and not a structural mismatch.
