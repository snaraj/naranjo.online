# Design iteration

How to change what the page shows, where it shows it, and how it looks —
without touching anything else (issue #165). The page is three strictly
separated layers, and each kind of change lives in exactly one of them:

| Layer | Lives in | Owns |
| --- | --- | --- |
| Information | `frontend/src/lib/*.ts` data modules and the panel API (`lib/panels.ts`) | Domain payloads, captured rows, adapters |
| Components | `frontend/src/lib/components/` | Generic presentation with **no domain knowledge** |
| Feed | `frontend/src/page.ts` | The one ordered manifest of sections and blocks |

A **block** binds a generic component to an information source through a
small adapter (payload in, props out). Domain labels — a game, a vendor, a
host — appear only in adapters and in the binding modules under
`frontend/src/lib/blocks/`; they never appear in a component, and tests pin
that.

## Move a block

Edit `frontend/src/page.ts`. Each section is one `section(id, label,
[blocks…])` call; the blocks render in array order and the section nav
derives from the same array. Moving a block is moving one name; reordering
sections reorders the nav with them. `tests/sections.test.mjs` and
`tests/panels-ui.test.mjs` pin the current order, so update the pinned
listing in the same change — that is the test asking "did you mean to?", not
an obstacle.

## Add an information source

1. **Data + adapter** — put the data (or the panel parsing) in a module
   under `frontend/src/lib/`, and beside it a pure adapter that returns one
   of the props shapes in `frontend/src/lib/blocks.ts` (`StatTrackerProps`,
   `EntryLogProps`, …). Pure means node can execute it: the unit suites
   drive adapters directly.
2. **Binding** — add a module under `frontend/src/lib/blocks/` that calls
   `staticBlock(...)` (build-time data) or `panelBlock(...)` (a live panel
   id plus the adapter). This is the one place the component, the data and
   the domain name meet.
3. **Mount** — add the block to a section in `frontend/src/page.ts`.

If no existing component fits, that is the moment to extend `blocks.ts`
with a new props contract and add one more generic component — never to
teach an existing component a domain.

## Change how it looks

`frontend/src/styles.css` is the hand-tuning surface — the file says so at
the top. Palettes, reading modes, layout, type, card/feed/panel dimensions
are all custom properties there; components consume tokens and state no
values of their own. Change the token, and every consumer moves at once. A
per-instance tweak is a local token override at the call site, never a
second rule.

## The dev loop

The repository `Makefile` wraps the loop: `make run` serves the full app
locally, `make dev` adds Vite hot reload; README's "Local development"
section documents both. The full pre-push battery stays canonical in
AGENTS.md ("Quality gates — exact commands and patterns"), and rendering
changes also run the browser-lane matrix listed there.
