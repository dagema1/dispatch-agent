# Design: Workbench

Dispatch software for a trades office that is open all day on a big monitor. The look is a dark workbench: near-black canvas lit by an electric-blue glow from the top edge (no dot grid), neutral charcoal panels, one electric-blue accent for what the system does, gold for what needs a person. Dark is the primary theme; light mirrors it. Source of truth: `src/styles.css`.

## Surfaces

| Layer | Class / slot | Dark | Light | Use |
|---|---|---|---|---|
| Canvas | `.canvas` | `oklch(0.12 0.002 165)` near-black + 1px dot grid every 20px (`--dot`) | `oklch(0.965 0.003 160)` | Page ground behind every working area (app, customer pages, landing) |
| Slab | `[data-slot=card]`, `.slab` | `--card` `oklch(0.165 0.003 165)` | near-white | Raised panels. 1px `--edge` top highlight + soft `--slab-shadow` |
| Well | `.well`, inputs, textarea, select, default tabs list, outline toggle group | `--well` `oklch(0.135 0.002 165)` | `oklch(0.935 …)` | Recessed: fields, segmented tracks, timeline rows, quoted text |

Shadows stay soft (`0 1px 2px` + `0 6px 16px -10px`). No glass, no blur, no glow.

## Colour roles

- **Emerald** (`--primary`, dark `oklch(0.77 0.14 163)` with dark ink on it, light `oklch(0.5 0.12 163)` with white ink): primary buttons (gradient `--action-1 → --action-2`), active nav, live dot, focus ring, selection, caret. Also the phone green on the customer call screen and the On state of integrations.
- **Gold** (`--attn-1/2`): things that need a person — pending approvals badge, unassigned jobs, owner alerts, P2. Dark ink in light theme for contrast.
- **Red** (`--destructive`): emergencies (P1), safety flags, destructive actions.
- **Quiet** (`--muted`): routine agent activity.
- Technician colours appear only on the timeline and map, where they identify a person.

## Tiles

`.tile` + one of `tile-action | tile-attn | tile-red | tile-quiet | tile-solid`. Flat icon chips: soft tint of the role colour with the glyph in that colour, no shadow, no gradient. `tile-solid` (filled blue) only for the brand mark and the agent's own mark (its initials orb on the Agent page). Used for: inbox channel icons (tinted by triage priority), feed event icons, unassigned-job priority.

## Controls

- Buttons: pills (`rounded-full`). `default` = electric-blue gradient with a lighter blue rim and white ink; `outline` = slab with edge highlight. Light-grey pill for the landing secondary.
- Nav: active item is a neutral grey pill (`bg-foreground/8`) with a blue icon.
- Display accent: `.font-display` (Instrument Serif italic) for one blue word in a headline (landing hero, “Hi, I’m Riley”). Never for UI text.
- Segmented controls (tabs, toggle groups): a well track with the active segment raised as a small slab. Permission levels add a colour dot to the active segment only (blue on its own, gold ask first, grey never).
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

Defined in `styles.css`, all inside `prefers-reduced-motion: no-preference`. Press scale 0.97; new items from the live feed slide in with a brief blue wash (`.arrive`, driven by `useArrivals`); re-planned visits glide to new slots (`.job-block`, 450ms); route change settles up (`.route-in`); theme switch cross-fades via View Transitions. Ease `cubic-bezier(0.16, 1, 0.3, 1)`, no bounce.

## Don'ts

No glass/blur, no coloured glows, no one-sided accent bars on rounded boxes, no eyebrow labels, no emoji icons, no heavy drop shadows.
