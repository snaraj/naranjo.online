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
 *            nothing, which is how a block waits for its first envelope. */
export type BlockBinding =
  | { readonly source: 'static'; readonly props: BlockProps }
  | {
      readonly source: 'panel';
      readonly panelId: string;
      readonly adapt: (envelope: PanelEnvelope | null) => BlockProps | null;
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

/* One labelled figure of a window's pair row. */
export type UsagePair = {
  readonly key: string;
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
  readonly fillPct: number;
  readonly reading: string;
};

/* A daily series the component re-reads through its own lens toggle; the
 * lens math is lib/grid.ts, which knows no source either. */
export type UsageSeries = {
  readonly startDate: string;
  readonly totals: readonly number[];
};

export type UsageActivity = {
  readonly heading: string;
  /* The strip's accessible name; the component appends the active lens. */
  readonly label: string;
  readonly noun: string;
  readonly series: UsageSeries;
  /* The whole-series sentence under the strip, lens-independent. */
  readonly summary: string;
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
  readonly insights?: { readonly heading: string; readonly rows: readonly UsageInsight[] };
};

export type UsageTrackerProps = {
  /* The wire id, carried as a data attribute for audits and lanes. */
  readonly id: string;
  readonly title: string;
  readonly status: PanelStatus;
  readonly generatedAt?: string;
  readonly sections: readonly UsageSection[];
  readonly emptyNote: string;
};

/* --- MediaGallery: one visible frame, prev/next, a click-to-enlarge lightbox
 * (issue 176) --------------------------------------------------------------- */

/* An outbound link an item may carry. Href and label travel together: the
 * component renders the label and never invents one. */
export type MediaGalleryLink = {
  readonly href: string;
  readonly label: string;
};

export type MediaGalleryItem = {
  readonly key: string;
  /* The small derivative the feed frame shows; loaded eagerly-lazy like any
   * other card. */
  readonly previewSrc: string;
  /* The full-resolution derivative, loaded for the first time only when a
   * reader enlarges the frame. */
  readonly fullSrc: string;
  readonly alt: string;
  /* Optional per-item metadata (owner directive 2026-08-25, issue 202).
   * Every one of the three is independently optional, and ABSENT MEANS
   * NOTHING RENDERS: no empty row, no placeholder dash, no reserved band.
   * The component decides only WHERE each renders, never whether an item
   * "should" have one — that is the manifest's call (lib/gallery.ts), so a
   * media-volume item and a vendored bootstrap item carry metadata the same
   * way (issue 182). */
  readonly title?: string;
  readonly description?: string;
  readonly link?: MediaGalleryLink;
};

export type MediaGalleryProps = {
  readonly items: readonly MediaGalleryItem[];
  /* The intrinsic box every frame declares, so arrival moves nothing. */
  readonly width: number;
  readonly height: number;
};

/* --- EntryLog: a feed of titled entries ---------------------------------- */

/* One counter beside a linked entry's title: a small drawn glyph and the
 * visible words that carry the figure (never the glyph alone). */
export type EntryCount = {
  readonly key: string;
  readonly glyph: 'node' | 'star';
  readonly label: string;
};

export type EntryLogEntry = {
  readonly key: string;
  readonly title: string;
  /* A place, a source — whatever names the entry's origin. */
  readonly byline?: string;
  /* A linked entry renders its title as outbound navigation. */
  readonly href?: string;
  readonly linkLabel?: string;
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
};

/* --- EmptyNote: one flat card stating an honest empty state -------------- */

export type EmptyNoteProps = {
  readonly note: string;
};
