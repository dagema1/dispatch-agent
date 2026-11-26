# Design: Night Dispatch

Dispatch software for a trades office, open all day on a big monitor and checked on a phone between jobs. The look is a night dispatch desk: near-black canvas lit by electric-blue light from the top edge, a faint street grid with a tech's route drawn in it, frosted glass panels over it. One electric-blue accent for what the system does, gold for what needs a person, red for danger. Dark is the primary theme; light mirrors it. Source of truth: `src/styles.css`.

## Surfaces

| Layer | Class / slot | Dark | Light | Use |
|---|---|---|---|---|
| Canvas | `.canvas` | `--background` `oklch(0.085 0 0)` + top blue glow | `oklch(0.97 0 0)` | Ground behind every working area |
| Glass | `[data-slot=card]`, `.slab`, sidebar, segmented tracks, outline buttons | `--glass` `oklch(0.17 0 0 / 0.62)` + `backdrop-blur(18px)` | `oklch(1 0 0 / 0.72)` | Panels. 1px `--edge` top highlight |
| Strong glass | select, dialog, alert dialog, sheet, tooltip | `--glass-strong` `oklch(0.19 0 0 / 0.82)` + blur 24px | `oklch(1 0 0 / 0.86)` | Overlays, so text stays readable over anything |
| Well | `.well`, inputs, textarea | `--well` `oklch(0.12 0 0)` | `oklch(0.945 0 0)` | Recessed: fields, timeline rows, quoted text |

Shadows stay soft. No heavy drop shadows, no coloured glows on components (the top light belongs to the canvas only).

## Signature: the route motif

`src/ui/RouteMotif.tsx`. A 60px street grid at 6% ink with one dashed blue route through four stops ending at the van (filled ring = "now"), masked to fade downward. It sits behind the top of the app canvas (`h-56`, 60% opacity) and inside `Backdrop` on signed-out pages (sign-in, book). It comes from the work itself, a tech's day on the map. It is the only decoration: never repeat it inside cards, never animate it, never add a second motif.

## Colour roles

- **Electric blue** (`--primary`, dark `oklch(0.62 0.21 272)`, light `oklch(0.5 0.24 268)`, white ink): primary buttons, active nav icon, live dot, focus ring, the route motif, the customer "Call" pill.
- **Gold** (`--attn-1/2`): needs a person: approvals, unassigned visits, undelivered replies, P2.
- **Red** (`--destructive`): emergencies (P1), the customer safety strip, destructive actions.
- **Quiet** (`--muted`): routine agent activity, P4.
- **Priority tiles** (`PriorityTile` in `bits.tsx`): P1 red, P2 gold, P3 blue, P4 quiet. Same mapping everywhere a request shows.
- **Technician colours** appear only on the timeline and map, where they identify a person. Five distinct hues, none blue or red, so a tech never reads as an action or an emergency (Carlos #2563eb is the one blue; keep it off the primary hue).

## Tiles

`.tile` + one of `tile-action | tile-attn | tile-red | tile-quiet | tile-solid`. Flat icon chips: soft tint with the glyph in the role colour. `tile-solid` (filled blue) only for the brand mark and the agent's own orb.

## Controls

- Buttons: `rounded-full`, press scale 0.97, focus ring offset. `default` solid blue; `outline` glass with edge; `secondary` `foreground/8`; `ghost` muted. Sizes: xs h-7, sm h-8, default h-9 `gap-2 px-4`, lg h-10 `gap-2.5 px-5`.
- Segmented controls (tabs, toggle groups, Settings sections, Agents Team | Traces): glass pill track, active segment a neutral lighter pill (`foreground/11`). No colour on the active state.
- Nav: active item neutral pill (`foreground/8`) with a blue icon. Collapsed-rail tooltips use the popover pill.
- Status text: sentence case (`Status` in `bits.tsx`). A customer message with no channel connected says "· not delivered" in gold, never "sent".
- Display accent: `.font-display` (Instrument Serif italic) for one blue word in a headline (sign-in, book hero, "Hi, I'm Riley"). Never for UI text.
- Confirmations: one shared alert dialog (`useConfirm`) for anything customer-facing, destructive or that widens agent autonomy.
- Icons: lucide only. No emoji or unicode glyphs as icons.

## Layout

- **Sidebar** (md+): a floating panel inset 0.75rem from the edges, `.rail-glass` (glass mixed in oklab with 8% blue in dark, 4% in light, blur 22px; never mix in oklch, which swings the hue through pink) so the canvas and route motif show through. 5rem icon rail with tooltips, expands to 16rem with labels and a title. Stored in `localStorage.rail`; the boot script mirrors it to `html[data-rail]` so skeletons match before hydration (`rail-open:` variant). The customer page is a quiet link card at the foot (globe tile, "Book, call, track"), never a second primary button.
- **Phones**: no sidebar. Logo in the header; a bottom tab bar (Board, Inbox, Approvals, Money, More). More opens a sheet with the rest, customer page, theme and sign out. Tables become stacked cards (`RichTable`).
- **Top bar**: company + live status left, "Ask Riley" field right (hidden on Agent chat, which has its own composer).
- **Board is a bento**: Needs you (2/3) beside Unassigned (1/3); KPI tiles; the timeline full width; the map (2/3) beside Live activity (1/3).
- **Needs you** (board, top): the one list of things only the owner can do: P1 emergencies waiting (Call back), undelivered replies (Connect), visits past their window (Re-plan), pending approvals (Review). Empty state says so plainly.
- **Floating dock**: page controls bottom centre (board: day picker + Re-plan). Sits above the phone tab bar and the safe area.
- **Page widths**: cap 1600px; settings and inbox `max-w-5xl`, approvals `max-w-4xl`, agent chat `max-w-3xl`, team and ROI `max-w-6xl`. The board stays wide. Grids that collapse on phones use `grid-cols-[minmax(0,1fr)]` so wide children (timeline) scroll inside their card instead of widening the page.
- Radius 0.875rem base. Type: Geist Variable; tabular numerals for counts and money.

## Customer pages

Phone first. `CustomerShell`: glass header with company, theme toggle and a blue "Call" pill (`tel:` link). Under it a red safety strip on every page except payment confirmation: gas smell or CO alarm → leave, call 911 or the utility from outside. Copy speaks to the homeowner in their words ("You told us …"). Unknown links show an empty state with the phone number and a link to book.

## Demo tools

- **Setup** (`/setup`): first run and after a reset. Four steps (start, company, integrations, ready) on the signed-out backdrop. Demo uses the server's keys; "My company" shows the key fields.
- **Simulators** (`/app/sim`): Technicians (play a tech: accept, take, drive, arrive, late, note, done, duty) and Email & texts (the customer's mailbox and phone; customer's own messages on the right in blue, ours on the left; each line says how it was delivered).
- **Price book** (Settings): how prices reach a customer in four steps, then the items by trade, edited in a dialog.
- **Voices** (Settings → persona): eight cards, each with a play button that speaks the opening line.

## Live data

One EventSource per browser, not per tab: a Web Locks leader owns it and relays over `BroadcastChannel('dispatch-events')` (`src/ui/live.tsx`). Keeps tabs under the 6-connection limit.

## Motion

All inside `prefers-reduced-motion: no-preference`. Overlays: dialogs and alert dialogs fade, rise 0.75rem and settle from 97% scale in 260ms; sheets slide the full way in 380ms (`cubic-bezier(0.32,0.72,0,1)`); closing is 180ms; backdrops fade with a 2px blur. Radix marks state with `data-state`, so `data-open:` / `data-closed:` are custom variants in `styles.css`. Press scale 0.97; new feed items slide in with a brief blue wash (`.arrive`); re-planned visits glide (`.job-block`, 450ms); route change settles up (`.route-in`); theme switch cross-fades via View Transitions. Ease `cubic-bezier(0.16, 1, 0.3, 1)`, no bounce.

## Don'ts

No coloured glows on components, no one-sided accent bars on rounded boxes, no pulsing eyebrow labels, no emoji icons, no heavy drop shadows, no internal jargon in owner copy (say "AI cost", not tokens; "Requested", not `new`), no second decorative motif.
