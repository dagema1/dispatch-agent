# Design: Workbench

Dispatch software for a trades office that is open all day on a big monitor. The look is a dark workbench: charcoal panels on a dotted canvas, one violet accent for what the system does, gold for what needs a person. Dark is the primary theme; light mirrors it. Source of truth: `src/styles.css`.

## Surfaces

| Layer | Class / slot | Dark | Light | Use |
|---|---|---|---|---|
| Canvas | `.canvas` | `oklch(0.165 0.005 260)` + 1px dot grid every 20px (`--dot`) | `oklch(0.955 0.004 255)` | Page ground behind every working area (app, customer pages, landing) |
| Slab | `[data-slot=card]`, `.slab` | `--card` `oklch(0.215 0.006 260)` | near-white | Raised panels. 1px `--edge` top highlight + soft `--slab-shadow` |
| Well | `.well`, inputs, textarea, select, default tabs list, outline toggle group | `--well` `oklch(0.18 0.005 260)` | `oklch(0.935 …)` | Recessed: fields, segmented tracks, timeline rows, quoted text |

Shadows stay soft (`0 1px 2px` + `0 6px 16px -10px`). No glass, no blur, no glow.

## Colour roles

- **Violet** (`--primary`, dark `oklch(0.72 0.15 280)`, light `oklch(0.55 0.19 275)`): primary buttons (gradient `--action-1 → --action-2`), active nav, live dot, focus ring, selection, caret.
- **Gold** (`--attn-1/2`): things that need a person — pending approvals badge, unassigned jobs, owner alerts, P2. Dark ink in light theme for contrast.
- **Red** (`--destructive`): emergencies (P1), safety flags, destructive actions.
- **Quiet** (`--muted`): routine agent activity.
- Technician colours appear only on the timeline and map, where they identify a person.

## Tiles

`.tile` + one of `tile-action | tile-attn | tile-red | tile-quiet | tile-solid`. Flat icon chips: soft tint of the role colour with the glyph in that colour, no shadow, no gradient. `tile-solid` (filled violet) only for the brand mark and the agent's own mark (its initials orb on the Agent page). Used for: inbox channel icons (tinted by triage priority), feed event icons, unassigned-job priority.

## Controls

- Buttons: radix-nova shapes. `default` = violet gradient with white text; `outline` = slab with edge highlight.
- Segmented controls (tabs, toggle groups): a well track with the active segment raised as a small slab. Permission levels add a colour dot to the active segment only (violet on its own, gold ask first, grey never).
- Confirmations: one shared alert dialog (`useConfirm`) for anything customer-facing, destructive or that widens agent autonomy.
- Icons: lucide only. No emoji or unicode glyphs as icons.

## Layout

- **Sidebar**: 4.5rem icon rail (tooltips) by default; expands to 15rem with labels. Choice stored in `localStorage.rail`. Width published as `--rail` on `<html>`. On mobile it becomes a top scrollable icon bar.
- **Top bar**: company + live status left, "ask the copilot" field right (navigates to `/app/copilot?q=…`, which sends once).
- **Floating dock**: page-level controls float at bottom centre of the work area (board: day picker + Re-plan). Rendered via portal; full-width at phone sizes. Main content has bottom padding so it never sits under the dock.
- **Page widths**: everything caps at 1600px; reading and form pages narrow further (settings and inbox `max-w-5xl`, approvals `max-w-4xl`, agent chat `max-w-3xl`, team and ROI `max-w-6xl`). The board stays wide for the timeline and map.
- Radius 0.875rem base; panels ~1rem, tiles/controls step down.
- Type: Geist Variable; tabular numerals for counts and money.

## Motion

Defined in `styles.css`, all inside `prefers-reduced-motion: no-preference`. Press scale 0.97; new items from the live feed slide in with a brief violet wash (`.arrive`, driven by `useArrivals`); re-planned visits glide to new slots (`.job-block`, 450ms); route change settles up (`.route-in`); theme switch cross-fades via View Transitions. Ease `cubic-bezier(0.16, 1, 0.3, 1)`, no bounce.

## Don'ts

No glass/blur, no coloured glows, no one-sided accent bars on rounded boxes, no eyebrow labels, no emoji icons, no heavy drop shadows.
