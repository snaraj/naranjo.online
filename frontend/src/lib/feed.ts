/* The feed primitive's logic, kept out of the component so the decisions that
 * carry meaning are plain functions a node test executes rather than branches a
 * regex claims to have found.
 *
 * The page is becoming a feed (owner directive, issue 134): one vertical column
 * of cards, each card one piece of content, whatever that content turns out to
 * be — a photograph today, a repository row, a job entry, a track, a post. The
 * card is therefore a SHAPE with regions rather than a layout for one kind of
 * thing: a header that can carry a title, a byline and a date; a media region
 * that runs to the card's own edges; a body; a footer for tags and meta.
 *
 * Today the art cards pass none of the header data — the owner does not want
 * titles yet — and that is exactly why the regions and their absence are
 * modelled here instead of being written into the markup: a component that
 * renders an empty header box for content with no title, or that would need
 * surgery to gain one later, has failed the requirement. Both branches of every
 * region are executed in tests/sections.test.mjs. */

/* The looks a card can take. A new content type is a new variant plus its
 * tokens, never a new component and never a pile of booleans:
 *
 *   framed  — the default: a border, a radius, a raised surface.
 *   flat    — no frame at all, for content that must not read as a card.
 *   media   — media-led: the picture runs to the card's edges and the chrome
 *             gets out of its way. The art feed's variant.
 *   compact — the framed card at a tighter rhythm, for dense rows.
 *
 * The last four are the ledger's (owner directive, 2026-09-03, issue 287).
 * They are variants rather than a second primitive for exactly the reason
 * this list exists: the redesign changes what a card LOOKS like — no radius,
 * no shadow, a rule instead of a border, the page's own paper instead of a
 * raised surface — and changes nothing about what a card IS. Every one of
 * them is a token remap on the card element and nothing else:
 *
 *   ledger  — a ruled block on the page's own paper: hairline rules between
 *             rows, no frame around them, no radius, no shadow.
 *   table   — the ledger with a column head over it; same paper, same rules.
 *   board   — an edge-to-edge grid of squares, so the card's padding gets out
 *             of the grid's way.
 *   strip   — a full-bleed band the ticker runs inside, ruled top and bottom.
 *
 * Exported as a list so a test can prove every variant the type admits is
 * actually styled; a variant that maps to no rule is a silent no-op. */
export const feedCardVariants = [
  'framed',
  'flat',
  'media',
  'compact',
  'ledger',
  'table',
  'board',
  'strip'
] as const;

export type FeedCardVariant = (typeof feedCardVariants)[number];

/* What a call site supplied, reduced to what the card has to decide. The
 * snippet-valued regions arrive here as booleans because whether a snippet
 * EXISTS is the only thing this decision depends on. */
export interface FeedCardContent {
  readonly title?: string;
  readonly byline?: string;
  readonly date?: string;
  /* A header snippet, which replaces the title/byline/date rendering. */
  readonly header?: boolean;
  readonly media?: boolean;
  readonly body?: boolean;
  readonly footer?: boolean;
}

/* Which regions the card draws. Every one of them is optional and every one of
 * them is drawn only when it has something in it — an empty region still costs
 * its padding and its gap, which is how a card with no title ends up with a
 * blank band where a title would go. */
export interface FeedCardRegions {
  readonly header: boolean;
  readonly meta: boolean;
  readonly media: boolean;
  readonly body: boolean;
  readonly footer: boolean;
}

/* feedCardRegions decides what a card renders.
 *
 * An empty string is ABSENT, deliberately: a title of '' is a call site that
 * has no title, and treating it as present is how a feed grows a row of empty
 * heading boxes. A supplied header snippet takes the region over completely —
 * the projects feed puts a link and its counts up there, which no title string
 * could express. */
export function feedCardRegions(content: FeedCardContent): FeedCardRegions {
  const meta = Boolean(content.byline) || Boolean(content.date);
  return {
    header: Boolean(content.header) || Boolean(content.title) || meta,
    meta,
    media: Boolean(content.media),
    body: Boolean(content.body),
    footer: Boolean(content.footer)
  };
}

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

/* formatIsoDate renders an ISO calendar date as words, for a card's date line
 * and for any other out-of-band capture the page has to be honest about.
 *
 * Written out rather than left to Intl on purpose: the origin serves one
 * document to every visitor, and a locale-dependent rendering would make this
 * string depend on whose browser asked. An unparseable input returns unchanged
 * rather than inventing a day. */
export function formatIsoDate(iso: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parts) {
    return iso;
  }
  const month = monthNames[Number(parts[2]) - 1];
  if (month === undefined) {
    return iso;
  }
  return `${Number(parts[3])} ${month} ${parts[1]}`;
}
