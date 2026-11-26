# Owner dashboard and customer pages

Scope: owner dashboard (/app/*), Operate mode; customer pages (/book, /c/*), Operate mode, phone-first.
Audience and job: owner/office manager running the day (board, approvals, money, traces, copilot); homeowners on phones booking, tracking, choosing quotes.
Constraints: shadcn/ui components, mobile-friendly customer pages, demo honesty (PRODUCT.md). Dark-first with a light variant behind the toggle.

## Direction contract

THESIS: The office runs on a dark workbench canvas: raised charcoal panels float over a dotted grid, so every work area reads as an object you can pick up, not a flat admin table. It refuses the category default of white cards on grey with a blue sidebar.

OWN-WORLD: Near-black charcoal ground (cool, low chroma) with a fine dot grid; panels are softly raised charcoal slabs with a light top edge and deep soft shadow; inner wells are recessed (darker, inset shadow). One teal accent for primary actions, selection and live state; warm amber-to-orange gradient tiles mark items that need a person (requests, approvals); state colours only where they mean something. Geist, medium weights, generous 16-20px radii, pill segmented controls.

STORY: The owner opens the board, sees each tech's day as a row of raised visit tiles on the canvas, spots what needs them (orange tiles, badges), and acts from the floating dock: re-plan, change day, jump to inbox. Customers see the same calm dark slab system on their phone with one big teal action.

FIRST VIEWPORT: Left: a 64px icon rail (logo tile, nav icons with tooltips, active icon in a raised teal-tinted tile, theme toggle and customer-page link at the bottom). Top bar: page title with live dot, search-style command field on the right. Main: dotted canvas; KPI slabs across the top, the technician timeline as the dominant raised panel with visit tiles, activity feed panel at right. Bottom centre: floating pill dock with the board's primary actions; the teal Re-plan button is the primary action.

FORM: pinned by the user's reference image; Operate mode; signature move: the day as a dotted canvas with raised visit tiles and a floating action dock. seed: none (pinned) "i like this design i attached can we use it"

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
