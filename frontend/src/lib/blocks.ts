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
import type { FeedCardVariant } from './feed.ts';
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

/* --- StatTracker: dense grids of icon-and-figure cells ------------------- */

/* One cell: a small icon (or its initials fallback), a right-aligned figure,
 * the whole row as its accessible name, and the hover detail. */
export type StatCell = {
  readonly key: string;
  /* Content-hashed asset URL; absent renders the glyph tile instead. */
  readonly icon?: string;
  /* The initials drawn when no icon ships for this row. */
  readonly glyph: string;
  readonly figure: string;
  readonly label: string;
  readonly detail: TipDetail;
  /* A row its source lists without ranking it; muted, never hidden. */
  readonly muted?: boolean;
};

/* A cell that closes the grid's last row with a captioned total: a short
 * caption where an icon would sit, sized to fit the narrowest column. */
export type StatClosingCell = {
  readonly key: string;
  readonly caption: string;
  readonly figure: string;
  readonly label: string;
  readonly detail: TipDetail;
};

export type StatGrid = {
  readonly key: string;
  /* The grid's accessible name. */
  readonly label: string;
  /* Cell scale: compact is the fixed-height readout grid (18px icons),
   * roomy the taller tally grid (26px icons). */
  readonly size: 'compact' | 'roomy';
  readonly cells: readonly StatCell[];
  readonly closing?: readonly StatClosingCell[];
  /* Rendered instead of the grid when it has no cells; a grid without one
   * renders empty rather than vanishing, so its box is never a surprise. */
  readonly emptyNote?: string;
};

export type StatTrackerProps = {
  readonly title: string;
  readonly status: PanelStatus;
  readonly generatedAt?: string;
  readonly grids: readonly StatGrid[];
  /* The loading or unavailable line, when there are no grids to render. */
  readonly note?: string;
};

/* --- ActivityTracker: headline figures, a strip, an entry log ------------ */

/* One headline figure: the emphasized number and the words that carry it —
 * the rest includes its own joining space or hyphen, so the two render as
 * one phrase. */
export type ActivityFigure = {
  readonly key: string;
  readonly lead: string;
  readonly rest: string;
};

/* One half of an entry row. A null href renders as plain text — the honest
 * state for a destination the information layer could not vouch for. */
export type ActivityLink = {
  readonly text: string;
  readonly href: string | null;
  /* The accessible name the anchor carries; unused on the text branch. */
  readonly label: string;
};

export type ActivityEntry = {
  readonly source: ActivityLink;
  readonly title: ActivityLink;
  /* Already rendered as coarse relative age ("2h ago"). */
  readonly age: string;
};

export type ActivityTrackerProps = {
  readonly title: string;
  readonly status: PanelStatus;
  readonly generatedAt?: string;
  readonly figures: readonly ActivityFigure[];
  /* Rendered in the figures row when there are none. */
  readonly figuresNote: string;
  readonly strip: {
    readonly columns: GridCell[][];
    readonly noun: string;
    readonly label: string;
    readonly emptyNote: string;
  };
  readonly entries: readonly ActivityEntry[];
  /* Rendered as the log's one row when there are no entries. */
  readonly entriesNote: string;
};

/* --- UsageTracker: per-source tiles, meters, series, insights ------------ */

export type UsageTile = {
  readonly key: string;
  readonly figure: string;
  readonly label: string;
  /* Marked figures carry the provenance-by-exception suffix. */
  readonly marked: boolean;
};

export type UsageMeter = {
  /* The drawn fill, already saturated at the track. */
  readonly fillPct: number;
  readonly severity: 'ok' | 'warning' | 'critical';
  /* The true value beside the fill, so severity is never color alone. */
  readonly reading: string;
};

/* One figure of a window's pair row: a named glyph, the compact figure, and
 * the word the glyph replaced. The component draws the glyph and clips the
 * word (owner directive, 2026-08-31: "week  in 5.4B  out 7.3M ... see how
 * weird that reads? instead use icons") — same split the entry counters
 * made at issue 268: the visible channel is glyph plus figure, the words
 * stay in the accessibility tree. The glyph is a NAME, not a drawing, so
 * this type stays domain-free the way EntryCount's glyph field is. */
export type UsagePair = {
  readonly key: string;
  readonly glyph: 'flow-in' | 'flow-out';
  readonly label: string;
  readonly figure: string;
};

export type UsageWindow = {
  readonly period: string;
  /* "resets in 3h", or '' when the source reports no reset. */
  readonly reset: string;
  readonly meter?: UsageMeter;
  readonly pairs: readonly UsagePair[];
  /* The exact-figures tooltip the compacted pair row carries. */
  readonly pairsLabel: string;
};

export type UsageInsight = {
  readonly key: string;
  readonly label: string;
  readonly marked: boolean;
  /* The drawn fill, or NULL when the proportion is unknown. Null is not zero:
   * a zero-width bar is pixel-identical to a measured 0%, so a row whose
   * denominator never existed would have drawn the same picture as one that
   * genuinely contributed nothing. A null draws no bar at all, and the
   * reading beside it carries the dash. */
  readonly fillPct: number | null;
  readonly reading: string;
};

/* A daily series the component re-reads through its own lens toggle; the
 * lens math is lib/grid.ts, which knows no source either. */
export type UsageSeries = {
  readonly startDate: string;
  readonly totals: readonly number[];
};

/* One accounting category of a source's series: the same days re-read
 * through one class of usage. Key, label, palette slot, dailies, and the
 * lens's own noun are all adapter-built data, so the component names no
 * category and formats no figure. The slot is the fixed palette slot the
 * ENTITY owns (--usage-cat-N), never its position in this payload, so a
 * category keeps its hue whichever subset a source reports. */
export type UsageCategory = {
  readonly key: string;
  readonly label: string;
  readonly slot: number;
  readonly totals: readonly number[];
  /* The SINGULAR noun the reading under the strip uses while this lens is
   * active — "input token", pluralized by the reading builder exactly as the
   * region's own noun is.
   *
   * A noun rather than a finished SENTENCE, and that is the whole shape of
   * the reconciliation between the category lens and the range control: an
   * adapter cannot see which trailing window a reader chose, so a sentence
   * built here would describe the entire capture while the graph above it
   * drew ninety days of it. lib/periods.ts builds every reading from the
   * cells actually drawn — one implementation, whichever lens is active —
   * and this field is the only thing the category has to contribute to it. */
  readonly noun: string;
};

/* One row of the composition strip: how the series' grand total divides
 * across categories. Weight drives the bar segment's flex share (the
 * category's own series total — the same integers the grid draws); figure
 * and tooltip carry the written count and share, so identity is never color
 * alone. */
export type UsageCompositionRow = {
  readonly key: string;
  readonly label: string;
  readonly slot: number;
  readonly weight: number;
  readonly figure: string;
  readonly tooltip: string;
};

export type UsageActivity = {
  readonly heading: string;
  /* The strip's accessible name; the component appends the active lens. */
  readonly label: string;
  readonly noun: string;
  readonly series: UsageSeries;
  /* Present exactly when the source's series carries an admitted per-day
   * category breakdown: the category lens options, in served order. */
  readonly categories?: readonly UsageCategory[];
  /* The composition strip's rows, present exactly when categories are. */
  readonly composition?: readonly UsageCompositionRow[];
};

export type UsageSection = {
  readonly key: string;
  readonly label: string;
  readonly sublabel?: string;
  readonly tiles?: readonly UsageTile[];
  /* The honest line for a source reporting no windows and no tiles. */
  readonly note?: string;
  readonly windows?: readonly UsageWindow[];
  /* Present exactly when there is a series to draw: a heading and a lens
   * toggle over nothing would be the hole the owner's ruling removed. */
  readonly activity?: UsageActivity;
  readonly insights?: {
    readonly heading: string;
    /* The range the proportions were measured over, when they were measured
       at all: a live-derived set covers a declared window of the series and
       says which, and a frozen release-time set carries no note because there
       is no window it can honestly name. */
    readonly note?: string;
    readonly rows: readonly UsageInsight[];
  };
};

export type UsageTrackerProps = {
  /* The wire id, carried as a data attribute for audits and lanes. */
  readonly id: string;
  readonly title: string;
  readonly status: PanelStatus;
  readonly generatedAt?: string;
  readonly sections: readonly UsageSection[];
  readonly emptyNote: string;
  /* The honest data-through line, present exactly when the envelope itself
   * proves the payload has stopped advancing (issue #276: a stalled capture
   * pipeline used to render fresh-looking tiles with nothing anywhere saying
   * the data was days old). Adapter-built, so the component renders words it
   * never composes. */
  readonly staleNote?: string;
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
};

/* --- EntryLog: a feed of titled entries ---------------------------------- */

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

export type EntryLogEntry = {
  readonly key: string;
  readonly title: string;
  /* A place, a source — whatever names the entry's origin. */
  readonly byline?: string;
  /* A linked entry renders its title as outbound navigation IN PLACE OF the
   * card's own header: a mark, the name, and counters beside it. That shape
   * carries no byline, which is exactly right for a repository card and wrong
   * for anything whose meta line matters. */
  readonly href?: string;
  readonly linkLabel?: string;
  /* The OTHER way a title can be navigation (issue 243): the ordinary card,
   * byline and all, with its heading pointing somewhere. An entry declares one
   * or the other; declaring `href` wins, because that branch renders the whole
   * header itself and there is no heading left for this to reach. */
  readonly titleHref?: string;
  /* The mark drawn before a linked title; omitted means none. */
  readonly glyph?: 'code';
  readonly counts?: readonly EntryCount[];
  /* The entry's paragraph, where it has one. */
  readonly summary?: string;
  /* The entry's own list of points, where a paragraph is the wrong shape:
   * a role's accomplishments, a release's changes. Optional exactly like the
   * paragraph is, and for the same reason — a card draws a region only when
   * it has something in it — and an entry carrying neither is a call site
   * with nothing to say, which tests/sections.test.mjs refuses for every
   * entry this site actually ships. */
  readonly points?: readonly string[];
  /* Placeholder entries say so in the DOM, honest-states floor. */
  readonly placeholder?: boolean;
};

export type EntryLogProps = {
  readonly entries: readonly EntryLogEntry[];
  /* The card look every entry shares (feed-card doctrine, issue 136). */
  readonly variant?: FeedCardVariant;
  /* The heading depth entries sit at in the document outline. */
  readonly titleLevel?: 2 | 3 | 4 | 5 | 6;
  /* The honest staleness line, present exactly when the adapter proved the
   * log's information source is not current (issue 281 defect 2: an envelope
   * honestly said stale while the rendered cards looked fresh). The same
   * contract UsageTrackerProps.staleNote carries: adapter-built words the
   * component renders and never composes, above the entries so the reader
   * meets the caveat before the figures it qualifies. A static log — the
   * work history — passes none and renders exactly as it always did. */
  readonly staleNote?: string;
};
