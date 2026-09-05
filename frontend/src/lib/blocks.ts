/* The vocabulary of the page's block architecture (owner directive, issue
 * 165): what a section and a block ARE, and the props each block component
 * renders. Three strictly separated layers meet here, and this module is the
 * contract between them:
 *
 *   information — the domain payloads: the panel API (lib/panels.ts) and the
 *                 captured data modules (work.ts, projects.ts, gallery.ts).
 *   components  — generic presentation primitives with no domain knowledge
 *                 (lib/components/): a stat tracker, an activity tracker, a
 *                 usage tracker, an entry log, a media gallery. Each renders
 *                 one of the props shapes below and nothing else, so the
 *                 stat tracker that shows game stats today shows fitness
 *                 stats tomorrow without an edit.
 *   the feed    — src/page.ts, one ordered manifest of sections and blocks.
 *                 A block is a component bound to an information source
 *                 through a small adapter; reordering the page is moving one
 *                 line there.
 *
 * Domain labels (a game's name, a vendor, a host) live ONLY in the adapters
 * and the block modules under lib/blocks/ — never in a component, and never
 * in a props FIELD NAME. Everything a component renders arrives as data
 * through one of these shapes.
 *
 * This module is deliberately pure — types, constructors, and the nav helper;
 * no component import ever lands here — so node tests execute it directly. */

import type { Component } from 'svelte';
import type { GridCell } from './grid.ts';
import type { PanelEnvelope, PanelStatus } from './panels';
import type { TipDetail } from './tooltip.ts';

/* Every block component's props are, structurally, a plain bag of named
 * values: that is what lets one manifest hold blocks of different shapes and
 * one host component spread whichever bag its block carries. The PER-BLOCK
 * shapes below are what the constructors actually hold an adapter and its
 * component to. */
export type BlockProps = Record<string, unknown>;

/* The component slot is type-erased at the manifest boundary; the generic
 * constructors below are what hold a component and its information source to
 * the same props shape, so the erasure can never admit a mismatched pair. */
export type BlockComponent = Component<BlockProps>;

/* How a block reaches its information source.
 *
 *   static — the props are data the build already carries (captured rows,
 *            placeholder copy). Nothing is fetched.
 *   panel  — the props derive from a live panel envelope. The Block host
 *            keeps the envelope current through watchPanel and re-runs the
 *            adapter on every delivery; an adapter returning null renders
 *            nothing, which is how a block waits for its first envelope.
 *   runtime — the build carries a complete set of props AND a one-shot read
 *            of something that exists only at run time (issue 207: the media
 *            volume's gallery manifest). The build's props render first and
 *            immediately, so there is no loading state and nothing is
 *            reserved for late content; if the read answers with props they
 *            replace them, and if it answers null — absent, unreachable,
 *            malformed — the build's own props simply stay. That null branch
 *            is the honest-states floor made structural: the fallback is a
 *            true thing to show, not a placeholder pretending to be one. */
export type BlockBinding =
  | { readonly source: 'static'; readonly props: BlockProps }
  | {
      readonly source: 'panel';
      readonly panelId: string;
      readonly adapt: (envelope: PanelEnvelope | null) => BlockProps | null;
    }
  | {
      /* panels — one block reading SEVERAL live panels (owner directive,
         2026-09-03, issue 287). The commits section cycles one calendar
         between the version-control contributions and each token source's
         daily series, which is one picture built from two envelopes; a block
         that could only bind one panel would have forced either a second
         section the owner did not ask for or a component that fetched for
         itself. The envelopes arrive in the order panelIds names them, each
         null until its own first delivery, so an adapter always receives a
         complete array and decides for itself what a partial set renders as —
         which is what keeps a slow second panel from blanking a section whose
         first panel has already answered. */
      readonly source: 'panels';
      readonly panelIds: readonly string[];
      readonly adapt: (envelopes: readonly (PanelEnvelope | null)[]) => BlockProps | null;
    }
  | {
      readonly source: 'runtime';
      readonly fallback: BlockProps;
      readonly load: () => Promise<BlockProps | null>;
    };

/* What a block may say about itself to the section around it. The heading
 * opens a subsection; the intro and note are the page's established
 * secondary lines (`.subsection-intro`, `.section-note` in styles.css). */
export interface BlockPresentation {
  readonly heading?: string;
  readonly intro?: string;
  readonly note?: string;
}

/* One block of the page: a component bound to its information source. */
export interface PageBlock extends BlockPresentation {
  /* Stable identity for the keyed render; never displayed. */
  readonly key: string;
  readonly component: BlockComponent;
  readonly binding: BlockBinding;
}

/* One section of the page. The nav derives from these — the id is the
 * fragment a nav link jumps to AND the id the rendered section carries, so a
 * link can never point at a section nobody rendered: both come from the same
 * manifest entry.
 *
 *   flow  — blocks render in the section's own grid, each with its declared
 *           heading and notes.
 *   stack — blocks share the page's tracker stack (`.panel-stack`), which
 *           owns their column width and the gap between cards. */
export interface PageSection {
  readonly id: string;
  readonly label: string;
  readonly layout: 'flow' | 'stack';
  readonly blocks: readonly PageBlock[];
}

/* The three constructors the manifest is written in. Generic over the
 * component's own props so a block module that binds a component to the wrong
 * adapter output fails to compile rather than failing to render. */

export function section(
  id: string,
  label: string,
  blocks: readonly PageBlock[],
  options: { layout?: 'stack' } = {}
): PageSection {
  return { id, label, layout: options.layout ?? 'flow', blocks };
}

export function staticBlock<P extends BlockProps>(
  key: string,
  component: Component<P>,
  props: P,
  presentation: BlockPresentation = {}
): PageBlock {
  return {
    key,
    /* Sound by construction: the generic signature just proved these props
       fit this component, and the erased slot is only ever spread with them. */
    component: component as unknown as BlockComponent,
    binding: { source: 'static', props },
    ...presentation
  };
}

/* A block whose props the build already carries AND which may be replaced
 * once, by a read that can only happen at run time. Generic over the same P
 * on both halves, so a fallback and a runtime result can never be different
 * shapes — the swap is a change of CONTENT, never of contract. */
export function runtimeBlock<P extends BlockProps>(
  key: string,
  component: Component<P>,
  fallback: P,
  load: () => Promise<P | null>,
  presentation: BlockPresentation = {}
): PageBlock {
  return {
    key,
    component: component as unknown as BlockComponent,
    binding: { source: 'runtime', fallback, load },
    ...presentation
  };
}

export function panelBlock<P extends BlockProps>(
  key: string,
  component: Component<P>,
  panelId: string,
  adapt: (envelope: PanelEnvelope | null) => P | null,
  presentation: BlockPresentation = {}
): PageBlock {
  return {
    key,
    component: component as unknown as BlockComponent,
    binding: { source: 'panel', panelId, adapt },
    ...presentation
  };
}

/* A block whose props derive from SEVERAL live panels at once. Generic over
 * the component's own props exactly as panelBlock is, so an adapter that
 * returns the wrong shape fails to compile rather than failing to render. */
export function panelsBlock<P extends BlockProps>(
  key: string,
  component: Component<P>,
  panelIds: readonly string[],
  adapt: (envelopes: readonly (PanelEnvelope | null)[]) => P | null,
  presentation: BlockPresentation = {}
): PageBlock {
  return {
    key,
    component: component as unknown as BlockComponent,
    binding: { source: 'panels', panelIds, adapt },
    ...presentation
  };
}

/* The href one nav link carries. Trivial by design: it exists so the '#' is
 * written once, in a function a test can execute, rather than concatenated
 * inside a template where a lost character renders a link to the page root. */
export function sectionHref(target: Pick<PageSection, 'id'>): string {
  return `#${target.id}`;
}

/* ===========================================================================
 * Component-layer props contracts, one block component each. Field names are
 * the reader's vocabulary — a figure, a caption, a detail — never a domain's.
 * ======================================================================== */

/* --- The ledger shapes (owner directive, 2026-09-03, issue 287) ---------
 *
 * The redesign made the page a ruled sheet: rows that open, a table, a
 * cycling calendar over a commit log, a board of squares, a scrolling strip.
 * Every one of those is a new PRESENTATION, so each gets its own props
 * contract here and its own generic component — and not one of them names a
 * job, a repository, a vendor or a game. The vocabulary below is the
 * reader's: a span, a name, a place, a figure, a face, an item.
 * ------------------------------------------------------------------------ */

/* One half of a linked row. A null href renders as plain text — the honest
 * state for a destination the information layer could not vouch for, and the
 * reason every link on this page is a pair rather than a string: the accessible
 * name travels with the address, so a component never invents one. */
export type ActivityLink = {
  readonly text: string;
  readonly href: string | null;
  /* The accessible name the anchor carries; unused on the text branch. */
  readonly label: string;
};

/* One openable row of a ledger: four columns of fact and a drawer of points.
 * The row itself is the disclosure control, so nothing inside it may be
 * interactive — the entry's outbound link therefore rides INSIDE the drawer
 * (`link`), where it is a link in its own right rather than a control nested
 * in a control, which is invalid and unreachable by a keyboard alike. */
export type LedgerRow = {
  readonly key: string;
  /* The years, already written the way the source writes them. */
  readonly span: string;
  /* The short name the row leads with. */
  readonly name: string;
  /* The one-line description under (or beside) the name. */
  readonly role: string;
  /* Where it happened. */
  readonly place: string;
  /* What the drawer holds, one point each. */
  readonly points: readonly string[];
  /* The entry's own home on the web, rendered inside the drawer. */
  readonly link?: ActivityLink;
};

export type LedgerLogProps = {
  readonly rows: readonly LedgerRow[];
  /* Rendered instead of the rows when there are none. */
  readonly emptyNote: string;
  /* The accessible words the chevron carries, in both states. Adapter-built
   * so the component composes no sentence of its own. */
  readonly expandLabel: string;
  readonly collapseLabel: string;
};

/* One counter in a table row: a drawn glyph, its bare figure, the words the
 * glyph replaced (kept for the accessibility tree, exactly as EntryCount keeps
 * them), and the detail every figure on this page carries.
 *
 * `marked` and `detail` are the provenance-by-exception channel (issue 268),
 * carried through the redesign unchanged: a figure captured out of band says
 * so in its detail, in the page's one sentence for it, and never on the
 * visible line. A counter that dropped them would be a figure quietly claiming
 * a freshness the payload never promised. */
export type LedgerCount = {
  readonly key: string;
  readonly glyph: 'star' | 'issue' | 'pull' | 'clock';
  readonly value: string;
  readonly label: string;
  readonly detail: TipDetail;
  readonly marked?: boolean;
};

export type LedgerTableRow = {
  readonly key: string;
  /* The row's leading cell, as navigation the information layer validated. */
  readonly link: ActivityLink;
  /* The single-line description; an empty string renders the honest dash. */
  readonly summary: string;
  /* How long since the row's own last change — the same counter the other
   * three are, so its provenance and its exact instant reach a reader the same
   * way theirs do. It sits in its own column rather than in the cluster. */
  readonly updated: LedgerCount;
  readonly counts: readonly LedgerCount[];
};

export type LedgerTableProps = {
  /* Absent for a table whose section head already names it (owner directive,
   * 2026-09-04, issue 292): the shell renders no label and keeps the row. */
  readonly title?: string;
  readonly status: PanelStatus;
  readonly generatedAt?: string;
  /* The column heads, in column order, exactly as they render. */
  readonly heads: readonly string[];
  readonly rows: readonly LedgerTableRow[];
  readonly emptyNote: string;
  readonly staleNote?: string;
};

/* One selectable calendar in the commits block: a heatmap and the sentence
 * that reads it. Three of these render as one grid with a segmented control
 * over it, so a set carries everything the shared grid needs. */
export type CommitLogSet = {
  readonly key: string;
  readonly label: string;
  readonly columns: GridCell[][];
  /* The set's own reading, under the grid. */
  readonly caption: string;
  /* What one cell counts, singular. */
  readonly noun: string;
  /* The grid's accessible name. */
  readonly stripLabel: string;
  readonly emptyNote: string;
  /* How this set's figures are written out — exact digits for a count,
   * compacted for a nine-digit total. A function rather than a flag, because
   * the component must format nothing itself. */
  readonly format: (value: number) => string;
};

export type CommitLogRow = {
  readonly key: string;
  readonly age: string;
  readonly source: ActivityLink;
  readonly title: ActivityLink;
  /* The short identity, display-only; the full one rides the href. */
  readonly mark: string;
};

/* No `title`: the block renders no panel label (owner directive, 2026-09-04,
 * issue 294). The envelope's title names one source — the version-control
 * host — and the calendar now opens on a token series, so a label over it
 * would be false; the segments underneath name every source themselves. */
export type CommitLogProps = {
  readonly status: PanelStatus;
  readonly generatedAt?: string;
  readonly sets: readonly CommitLogSet[];
  readonly rows: readonly CommitLogRow[];
  readonly rowsNote: string;
  readonly staleNote?: string;
};

/* One proportional bar on a square's face: a label, a fill and the reading
 * beside it. A NULL fill draws no bar at all — a zero-width bar is
 * pixel-identical to a measured 0%, so an unknown proportion would look like
 * a measured one (the same rule UsageInsight carries). */
export type LedgerBar = {
  readonly key: string;
  readonly label: string;
  readonly fillPct: number | null;
  readonly reading: string;
  readonly marked: boolean;
};

/* One line of a square's back face. The optional slot is the fixed palette
 * slot the ENTITY owns (--usage-cat-N), never its position in this list, so a
 * category keeps its swatch whichever subset a source reports; a fact with no
 * slot draws no swatch. Identity is never the swatch alone — the term is
 * printed beside it, always. */
export type LedgerFact = {
  readonly key: string;
  readonly term: string;
  readonly value: string;
  readonly slot?: number;
};

/* A proportional reading with a SEVERITY: a window's utilization, drawn as a
 * fill and printed as a figure beside it. The severity union is the page's
 * whole severity vocabulary — the token layer declares one ink per member and
 * a test closes the status-ink family over exactly this list, so adding a
 * fourth state here demands a fourth declared ink on the same day. Colour is
 * never the channel: the reading is printed next to the bar, always. */
export type LedgerMeter = {
  readonly fillPct: number;
  readonly severity: 'ok' | 'warning' | 'critical';
  readonly reading: string;
  /* What the reading is OF — a period, already worded by the adapter. */
  readonly label: string;
};

/* One square of the board: a front face and the face behind it. A square
 * whose source said nothing renders dashes and its own note — never a zero,
 * and never nothing. */
export type LedgerSquare = {
  readonly key: string;
  readonly label: string;
  /* The front's headline, when the square has one. */
  readonly figure?: string;
  /* The line under it. */
  readonly sub?: string;
  /* A front made of bars instead of a headline figure. */
  readonly bars?: readonly LedgerBar[];
  /* A window's utilization, under the figure. Present exactly when the source
   * reported a window with one; a source that reports no window draws no
   * meter rather than a bar at zero. */
  readonly meter?: LedgerMeter;
  /* The whole square's accessible name, front and back together. */
  readonly ariaLabel: string;
  readonly back: {
    readonly label: string;
    readonly facts?: readonly LedgerFact[];
    readonly bars?: readonly LedgerBar[];
    readonly note?: string;
  };
};

export type LedgerBoardProps = {
  readonly title: string;
  readonly status: PanelStatus;
  readonly generatedAt?: string;
  readonly squares: readonly LedgerSquare[];
  readonly emptyNote: string;
  readonly staleNote?: string;
  /* The words a square's own button carries in each state. */
  readonly turnLabel: string;
  readonly returnLabel: string;
};

/* One item of the scrolling strip: a small icon (or its initials fallback),
 * a figure, and the hover detail every figure on this page carries. */
export type TickerItem = {
  readonly key: string;
  readonly icon?: string;
  readonly glyph: string;
  readonly figure: string;
  readonly label: string;
  readonly detail: TipDetail;
  /* The largest figure in the strip: the page's one highlight. */
  readonly peak?: boolean;
  /* A figure of zero — dimmed, never hidden, because a row its source lists
   * with nothing against it is information. */
  readonly quiet?: boolean;
};

export type TickerProps = {
  /* The origin-served name of the thing the strip counts. */
  readonly title: string;
  readonly status: PanelStatus;
  readonly generatedAt?: string;
  readonly items: readonly TickerItem[];
  readonly emptyNote: string;
  readonly staleNote?: string;
  /* The strip's accessible name. */
  readonly label: string;
  /* The lead item's picture, if the collection has one: a same-origin URL the
   * binding layer resolved, with the file's own dimensions so the lead can
   * reserve the box. Decorative — the title beside it is the name. */
  readonly mark?: TickerMark;
};

export type TickerMark = {
  readonly url: string;
  readonly width: number;
  readonly height: number;
};

/* --- MediaGallery: one visible frame, prev/next, a click-to-enlarge lightbox
 * (issue 176) --------------------------------------------------------------- */

/* An outbound link an item may carry. Href and label travel together: the
 * component renders the label and never invents one. */
export type MediaGalleryLink = {
  readonly href: string;
  readonly label: string;
};

/* One playable rendition of a moving item. `type` is the browser's whole
 * basis for choosing — a plain media type, or one carrying a codecs
 * parameter when several rungs share it — and the ORDER of the list is the
 * preference, because a browser takes the first source it can play. */
export type MediaGallerySource = {
  readonly src: string;
  readonly type: string;
  /* The viewport this rung is offered to, when the ladder has more than one
   * SIZE to choose between (issue 241). Absent means "always eligible", which
   * is what the smallest rung always carries — so some source always matches.
   * The value is derived from the manifest's own rung heights and item aspect
   * by galleryVideoSourceMedia (lib/galleryManifest.ts); nothing here or in
   * the component invents a breakpoint. */
  readonly media?: string;
};

/* What makes an item MOVE (issue 207). Its presence is the discriminator:
 * an item without it is a still, and every still renders exactly as it did
 * before this field existed. Nothing here autoplays — `preload` is metadata
 * and no autoplay attribute exists anywhere in the component — so a reader
 * who has asked for reduced motion gets none until they press play
 * themselves. */
export type MediaGalleryVideo = {
  /* The frame shown before play. Distinct from fullSrc so the operator can
   * publish a dedicated poster, and defaulted to fullSrc by the adapter when
   * they have not. */
  readonly posterSrc: string;
  /* One to three renditions, best first. */
  readonly sources: readonly MediaGallerySource[];
};

export type MediaGalleryItem = {
  readonly key: string;
  /* The small derivative the feed frame shows; loaded eagerly-lazy like any
   * other card. A STILL's stage shows it. A moving item's stage mounts its
   * player instead (issue 233), so for a film this is the small derivative
   * the manifest published and the strip does not render it. */
  readonly previewSrc: string;
  /* The full-resolution derivative, loaded for the first time only when a
   * reader enlarges the frame — which only a still can be. */
  readonly fullSrc: string;
  readonly alt: string;
  /* Optional per-item metadata (owner directive 2026-08-25, issue 202).
   * Every one of the three is independently optional, and ABSENT MEANS
   * NOTHING RENDERS: no empty row, no placeholder dash, no reserved band.
   * The component decides only WHERE each renders, never whether an item
   * "should" have one — that is the manifest's call (lib/gallery.ts for the
   * vendored bootstrap set, lib/galleryManifest.ts for the media volume), so
   * a volume item and a vendored item carry metadata the same way. */
  readonly title?: string;
  readonly description?: string;
  readonly link?: MediaGalleryLink;
  /* The named set the gallery's dropdown groups this item under (owner
   * sketch, 2026-08-31, issue 275). Optional: an item without one falls
   * into the component's kind-derived default set, so every existing
   * caller renders exactly as it did. */
  readonly set?: string;
  /* Present exactly when the item moves; see MediaGalleryVideo. */
  readonly video?: MediaGalleryVideo;
  /* This item's own intrinsic box, when it differs from the gallery's
   * declared one. It is the element's intrinsic-size HINT, not the reserved
   * box: the frame's reservation is token-driven and identical for every
   * item, which is why swapping the vendored set for a runtime one shifts
   * nothing. */
  readonly width?: number;
  readonly height?: number;
  /* The PREVIEW derivative's own intrinsic width, when the source of the item
   * declares one (issue 241). It is the only number the enlarged surface needs
   * to offer a reader the small rendition instead of the master: above it the
   * preview would be upscaled, below it the master is bytes nobody can see.
   * Absent means the item's source published no dimensions for its preview —
   * the vendored bootstrap set — and the lightbox then loads the full
   * derivative exactly as it always did, because guessing a breakpoint from a
   * file nobody measured is how a reader gets a blurry enlargement. */
  readonly previewWidth?: number;
};

export type MediaGalleryProps = {
  readonly items: readonly MediaGalleryItem[];
  /* The intrinsic box every frame declares, so arrival moves nothing. */
  readonly width: number;
  readonly height: number;
  /* How many tiles the row shows of the chosen set (owner mock: four). */
  readonly tiles?: number;
};

/* --- Counters, and the one word for a figure captured out of band -------- */

/* The provenance-by-exception wording, spelled ONCE for the whole page (owner
 * directive, issue 268). A figure captured out of band says so, and it says so
 * in these exact words wherever it appears — the usage tiles' visible suffix
 * and the entry log's detail row are the same sentence rather than two
 * sentences somebody keeps in step. A reader learns one mark for "this was
 * recorded out of band", not one per panel. */
export const recordedOutOfBand = 'recorded out of band, not fetched live';

/* One counter beside a linked entry's title: a small drawn glyph, the bare
 * figure it counts, and the detail that spells the whole thing out.
 *
 * TERSE IS NOW THE ONLY SHAPE (issue 268, owner directive: "just remove it",
 * of the label text and the inline provenance mark alike). Issue 252 made two
 * of these counters terse; the owner extended that to every one of them, so
 * `value` is required rather than optional and the words no longer have a
 * visible branch to come back through. They have not left the DOM: `label` is
 * the counter's whole meaning in words, rendered into a clipped span every
 * screen reader still reads, and it is what `detail` shows a sighted reader on
 * hover, touch or focus. The dataviz floor is intact — a value here is carried
 * by glyph PLUS number, never by the glyph alone — and so is the accessible
 * name.
 *
 * `detail` is the same primitive and the same grammar the stat tiles use
 * (DetailTip, issue 136 rule 1): the detail's NAME is the full phrase, and its
 * rows carry whatever else the counter can vouch for — the absolute instant
 * behind a live age, the provenance row behind a recorded figure. */
export type EntryCount = {
  readonly key: string;
  readonly glyph: 'node' | 'star' | 'clock' | 'issue' | 'pull';
  readonly label: string;
  readonly value: string;
  readonly detail: TipDetail;
  /* An ISO instant this counter is a LIVE AGE of (issue 268). Its presence is
   * the whole discriminator: a counter that declares one has its figure, its
   * words and its detail re-derived against the reader's own clock on a
   * minute-aligned tick, so "3h" becomes "4h" while the page is open instead
   * of freezing at whatever the render happened to catch. A counter without
   * one renders exactly the value, label and detail the adapter built. */
  readonly since?: string;
  /* Whether this figure was recorded out of band. It no longer stamps a mark
   * on the visible row — it drives the provenance row inside the detail, which
   * is where the owner asked for it to live. */
  readonly marked?: boolean;
};
