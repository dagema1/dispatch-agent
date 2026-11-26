---
version: 2
slug: "src-routes-app-tsx"
primary_target: "src/routes/app.tsx"
related_targets: ["src/routes/app/index.tsx","src/routes/book.tsx","src/ui/CustomerShell.tsx","src/ui/NeedsYou.tsx","src/ui/RouteMotif.tsx"]
---

# Owner dashboard and customer pages

Scope: owner dashboard (/app/*), Operate mode; customer pages (/book, /c/*), Operate mode, phone-first.
Audience and job: owner/office manager running the day (board, approvals, money, agents); homeowners on phones booking, tracking, choosing quotes, sometimes in an emergency.
Constraints: shadcn/ui components, demo honesty (PRODUCT.md). Dark-first with a light variant behind the toggle. System details live in DESIGN.md.

## Direction contract

THESIS: A night dispatch desk. Frosted glass panels over a near-black canvas lit blue from the top, with a dispatcher's route drawn faintly in the street grid behind. It refuses the category default of white cards on grey with a blue sidebar, and the AI-category default of gradients and sparkles.

OWN-WORLD: Near-black ground, electric-blue top light, glass panels with a light top edge, one blue accent, gold for needs-a-person, red for danger. Route motif is the single decoration. Geist, pill controls.

STORY: The owner opens the board and the first thing is "Needs you": what only they can do, each with its action. Then each tech's day on the timeline, then the map. On a phone the same board with a bottom tab bar. Customers get a calm glass page with one blue Call action and a red safety line always in reach.

FIRST VIEWPORT: Icon rail left (md+), top bar with company, live status and Ask Riley. Route motif fades in behind the top. Needs-you card, KPI tiles, timeline. Floating dock bottom centre with day picker and Re-plan.

FINISH: critique 2026-11-26 (22/40) fixes applied: customer safety + call, needs-you, truthful delivery status, shared live stream, phone layout, plain copy, nav distilled, route motif.
