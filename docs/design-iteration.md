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
   of the props shapes in `frontend/src/lib/blocks.ts` (`LedgerLogProps`,
   `LedgerTableProps`, `CommitLogProps`, `LedgerBoardProps`, `TickerProps`,
   `MediaGalleryProps`). Pure means node can execute it: the unit suites
   drive adapters directly.
2. **Binding** — add a module under `frontend/src/lib/blocks/` that calls
   `staticBlock(...)` (build-time data), `panelBlock(...)` (a live panel id
   plus the adapter), `panelsBlock(...)` (SEVERAL panel ids plus an adapter
   that receives their envelopes in that order — the commits section reads
   two), or `runtimeBlock(...)` (build-time props plus a one-shot runtime
   read). This is the one place the component, the data and the domain name
   meet.
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

## Rules a later directive superseded

A directive that stops being true has to say so where the next reader looks,
or the code keeps half-implementing it and the next change re-litigates a
decision the owner already made.

**The per-panel coverage window is superseded (owner directive, 2026-09-03,
issue 287).** Issue 268 gave each panel ONE window sized to what its sources
had actually captured, so a fortnight of history drew a fortnight of columns
rather than three columns against fifty weeks of dated emptiness. The ledger
redesign replaces that rule for the commits block, on the owner's own
instruction: the block owns three `columns` arrays — the contribution
calendar and both token series — placed into the SAME 52/53-week window,
with one grid bound to whichever segment the reader has selected. A window
sized per set is incompatible with a single grid the reader cycles: the box
would change width on every segment switch, which breaks the zero-CLS floor,
and the sets would stop being comparable, which is the whole reason the cycle
exists. The half of issue 268 that answered the misread is kept intact — the
window's own dated absent cells, its month axis, and a per-set caption
stating how many of the window's days that source captured. `grid.ts`'s
`gridMinColumns` comment already recorded issue 189 superseding data-sizing
"for any series `calendarColumns` can date"; this extends it to the token
series now that they share the contributions calendar. `coverageWindow` and
`coverageColumns` left `frontend/src/lib/periods.ts` with their tests rather
than sitting dead behind a rule nothing applies.

## The dev loop

The repository `Makefile` wraps the loop: `make run` serves the full app
locally, `make dev` adds Vite hot reload; README's "Local development"
section documents both. The full pre-push battery stays canonical in
AGENTS.md ("Quality gates — exact commands and patterns"), and rendering
changes also run the browser-lane matrix listed there.
