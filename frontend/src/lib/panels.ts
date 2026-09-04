/* Same-origin data layer for the panel API served by internal/panels. Every
 * shape here mirrors the Go contract in internal/panels/types.go: the stable
 * panel/v1 envelope plus one payload type per versioned kind. Components never
 * build URLs or touch fetch results directly — they call loadPanel and render
 * whatever envelope comes back, so a data fault degrades one panel and can
 * never break the page. */

import { formatDateRange } from './periods.ts';

export type PanelStatus = 'ok' | 'stale' | 'unavailable';

/* The envelope schema is stable forever by design (see internal/panels);
 * evolution happens inside kind-versioned payloads, never out here. */
export const panelEnvelopeSchema = 'panel/v1';

/* Versioned panel kinds. A breaking payload change mints a new kind version;
 * it never mutates an existing one. */
export const panelKinds = {
  tokenUsage: 'token-usage/v2',
  vcsActivity: 'vcs-activity/v1',
  bossLog: 'boss-log/v1',
  codingProjects: 'coding-projects/v1'
} as const;

export interface PanelEnvelope<Data = unknown> {
  schema: string;
  id: string;
  kind: string;
  title: string;
  generatedAt?: string;
  status: PanelStatus;
  /* null whenever the panel is unavailable — identity intact, data absent. */
  data: Data | null;
}

/* token-usage/v2 — token consumption windows grouped per labeled source.
 * Source labels are data supplied by the origin, never frontend constants.
 *
 * v2 is a strict superset of v1: it adds a per-day MODEL partition of each
 * source's series and an optional window on either breakdown. It is a new
 * KIND rather than another optional section because the models section binds
 * CROSS-FIELD rules — a window contained in the series, and an exact per-day
 * partition of its totals — that a consumer cannot skip and still be telling
 * the truth about what it renders. The breaking change is what a compliant
 * consumer must CHECK, not the shape. */
export interface TokenUsageWindow {
  period: string;
  inputTokens: number;
  outputTokens: number;
  utilizationPct?: number;
  resetsAt?: string;
}

/* Stat tiles, the activity series, and insights were added to token-usage/v1
 * after it shipped. Every one of them is optional, so a payload written before
 * they existed still renders — an additive extension inside the same kind
 * version, exactly as the envelope contract requires. `recorded` marks a
 * figure captured out of band rather than fetched live, so a tile can say
 * where it came from instead of implying a freshness it does not have. */
export type TokenStatUnit = 'tokens' | 'days' | 'seconds' | 'count';

export interface TokenUsageStat {
  key: string;
  label: string;
  value: number | null;
  unit: TokenStatUnit;
  recorded?: boolean;
}

export interface TokenUsageSeries {
  startDate: string;
  totals: number[];
  /* True when the series was captured out of band — the sealed one-way push
   * rather than a live fetch. It is the series' own provenance, and it is
   * what the insight rows derived from the series inherit, so a derived
   * figure says where it came from exactly as a tile does. */
  recorded?: boolean;
  /* Optional per-day breakdown of the same series by accounting category
   * (input, output, cache reads, ...). The origin guarantees the categories
   * PARTITION the totals — per day they sum exactly to the total — and
   * serves them in one canonical order; the panel admission re-checks the
   * structure and the machine-shaped keys. */
  categories?: TokenUsageCategory[];
  /* Optional per-day breakdown of the same series by MODEL, under exactly
   * the same partition guarantee and re-checked exactly as strictly. It is
   * the section that made this kind v2. Unlike the categories it is normally
   * WINDOWED: one integer per day per model across the full history would
   * outweigh the whole payload ceiling, so the origin serves a declared
   * trailing window and every row says which one. */
  models?: TokenUsageCategory[];
}

export interface TokenUsageCategory {
  /* Stable machine-shaped identifier (lowercase letters, digits, hyphens). */
  key: string;
  /* The calendar date this row's first value falls on, when the breakdown
   * covers only a TRAILING WINDOW of the owning series; absent when it is
   * aligned with the series, which is what every breakdown produced before
   * windows existed says by omission. Repeated per row so a row is
   * self-describing to a consumer that admits rows one at a time. */
  startDate?: string;
  /* Per-day counts, indexed from startDate when one is declared and from the
   * owning series' startDate when it is not. */
  totals: number[];
}

export interface TokenUsageInsight {
  label: string;
  pct: number | null;
  recorded?: boolean;
}

export interface TokenUsageSource {
  label: string;
  account?: string;
  windows: TokenUsageWindow[];
  stats?: TokenUsageStat[];
  series?: TokenUsageSeries;
  insights?: TokenUsageInsight[];
}

/* vcs-activity/v1 — contribution weeks, totals, streak, recent commits. */
export interface VCSCommit {
  repo: string;
  /* The commit's full lowercase-hex identity, carried through so a subject
   * line that resolves no pull-request reference still has a real
   * destination to link to (issue 157). The embedded snapshot predates this
   * field and may still serve an empty string for old rows; that is
   * truthful absence, not a decode fault. */
  sha: string;
  message: string;
  at: string;
}

/* Which producer answered for the calendar. The two count different things
 * while both being live and both being true: 'public' is what an anonymous
 * reader may see, 'complete' is the account holder's own record with private
 * repositories included. Absent means the payload declared none, which is what
 * the embedded snapshot and every payload written before this field existed
 * say by omission. */
export type VCSCoverage = 'public' | 'complete';

export interface VCSActivityData {
  totalContributions: number;
  weeks: number[][];
  streak: number;
  /* See VCSCoverage. Optional: additive inside the same kind version, so a
   * payload from a replica that predates it still renders — this chart runs a
   * RollingUpdate, and a browser holding the new frontend can reach an old
   * replica mid-rollout. */
  coverage?: VCSCoverage;
  /* The calendar date (YYYY-MM-DD) of the last day the window covers. The
   * final week is padded to seven days like every other, so without this the
   * padding is indistinguishable from real quiet days. Optional: added after
   * the kind shipped, so a payload without it still renders. */
  endDate?: string;
  recentCommits: VCSCommit[];
}

/* boss-log/v1 — one game account's skill table and boss tallies. Every figure
 * is nullable because the hiscores legitimately report none below their
 * listing threshold; null is data and renders as "--", never as a zero. */
export interface BossLogEntry {
  name: string;
  kc: number | null;
  rank: number | null;
  score?: number | null;
}

/* One skill row. Optional on the payload because skills were added to
 * boss-log/v1 after it shipped — an additive extension inside the same kind
 * version, exactly like the token panel's tiles, so a payload written before
 * they existed still renders. */
export interface BossLogSkill {
  name: string;
  level: number | null;
  rank: number | null;
  xp?: number | null;
}

export interface BossLogData {
  account: string;
  skills?: BossLogSkill[];
  bosses: BossLogEntry[];
}

/* coding-projects/v1 — the owner's repositories as their host describes them
 * RIGHT NOW. Every figure is nullable and every row carries its own
 * provenance, so a row whose live read failed serves the shipped values and
 * says so rather than borrowing the freshness of the rows beside it. */
export interface CodingProjectRow {
  name: string;
  /* The repository's own description. Empty is a real state — a repository
   * with no description has none — never a placeholder. */
  description: string;
  /* Null means the host reported no tally, rendered as a dash. */
  stars: number | null;
  /* The last push, as an ISO instant; absent when unreported. The page turns
   * it into a sentence against the reader's own clock, and ORDERS the feed by
   * it (issue 252). */
  pushedAt?: string;
  /* Open issues and open pull requests. ABSENT rather than null when unknown,
   * because the producer omits the keys — which is exactly what makes them
   * additive: a payload written before they existed decodes here unchanged and
   * renders unchanged. Absent draws a dash; a reported zero is a figure and
   * draws as one. They arrive and leave together, because the issue tally
   * exists only as a subtraction against the pull-request one. */
  openIssues?: number;
  openPulls?: number;
  /* True when this row came from the shipped snapshot rather than a live
   * read, exactly as `recorded` marks a token-usage tile. */
  recorded?: boolean;
}

export interface CodingProjectsData {
  repos: CodingProjectRow[];
}

/* The panel API's base path, and the ONE place it is written down: panelUrl
 * builds every per-panel URL from it, kept behind a helper exactly like
 * mediaUrl in media.ts so components never assemble API paths by hand.
 *
 * The origin also SERVES this path as a registry listing, but no client reads
 * it — every panel is mounted by hardcoded id from its binding module under
 * lib/blocks/. The reading half was removed rather than left as an unused
 * import surface, so adding a discovery caller back means writing a parser
 * again. */
export const panelsIndexUrl = '/api/panels';

/* Panel ids are lowercase hyphenated registry identifiers; anything else can
 * only produce the origin's opaque 404, so it is rejected before a request
 * exists. */
const safePanelId = /^[a-z0-9][a-z0-9-]*$/;

export function panelUrl(id: string): string {
  if (!safePanelId.test(id)) {
    throw new Error('panel id must be a lowercase hyphenated identifier');
  }
  return `${panelsIndexUrl}/${id}`;
}

const panelStatuses: ReadonlySet<string> = new Set(['ok', 'stale', 'unavailable']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* parsePanelEnvelope admits only documents carrying the exact envelope
 * contract: schema pin, string identity fields, a known status, and a data
 * key that may be null but must exist. Anything else throws, and loadPanel
 * turns that throw into an unavailable envelope. */
export function parsePanelEnvelope(document: unknown): PanelEnvelope {
  if (!isRecord(document)) {
    throw new Error('panel envelope must be a JSON object');
  }
  const { schema, id, kind, title, status, generatedAt } = document;
  if (schema !== panelEnvelopeSchema) {
    throw new Error(`panel envelope schema must be ${panelEnvelopeSchema}`);
  }
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('panel envelope id must be a non-empty string');
  }
  if (typeof kind !== 'string' || kind.length === 0) {
    throw new Error('panel envelope kind must be a non-empty string');
  }
  if (typeof title !== 'string') {
    throw new Error('panel envelope title must be a string');
  }
  if (typeof status !== 'string' || !panelStatuses.has(status)) {
    throw new Error('panel envelope status must be ok, stale, or unavailable');
  }
  if (generatedAt !== undefined && typeof generatedAt !== 'string') {
    throw new Error('panel envelope generatedAt must be a string when present');
  }
  if (!('data' in document)) {
    throw new Error('panel envelope must carry a data key, null included');
  }
  const envelope: PanelEnvelope = {
    schema,
    id,
    kind,
    title,
    status: status as PanelStatus,
    data: document.data ?? null
  };
  if (typeof generatedAt === 'string') {
    envelope.generatedAt = generatedAt;
  }
  return envelope;
}

/* unavailablePanel is the fail-soft envelope a component receives when the
 * request itself failed: same shape, honest status, null data. */
export function unavailablePanel(id: string, title = ''): PanelEnvelope<never> {
  return {
    schema: panelEnvelopeSchema,
    id,
    kind: '',
    title,
    status: 'unavailable',
    data: null
  };
}

export type PanelFetcher = (url: string) => Promise<Response>;

/* EVERY PANEL READ REVALIDATES, stated on this side rather than assumed from
 * the other. The origin already sends `Cache-Control: no-cache` on every panel
 * envelope (internal/panels/handler.go, pinned by its own Go test) — but that
 * is a fact about the SERVER, and a refresh gesture depending on it is one
 * upstream stale-while-revalidate policy or freshness-rewriting edge away from
 * resolving out of a memory cache with no request leaving the page.
 *
 * `no-cache` and NOT `no-store`: `no-store` also refuses to send the
 * validators, so every read would download the whole envelope — up to 104,508
 * bytes for the token-usage panel — instead of the empty 304 the panel API's
 * digest ETags exist to produce. */
const defaultFetcher: PanelFetcher = (url) => globalThis.fetch(url, { cache: 'no-cache' });

/* loadPanel performs exactly one same-origin request — no retries, no
 * backoff; the origin already serves prepared bytes and a failure simply
 * renders as unavailable until the next natural page load. It also logs why
 * (owner directive, issue 179): the page carries no manual refresh control
 * any more, so a failure has to say so somewhere instead of silently
 * degrading and waiting for a visitor to notice and press a button that no
 * longer exists. The non-ok branch throws into the same catch precisely so
 * there is one call site for that, not two. */
export async function loadPanel<Data = unknown>(
  id: string,
  fetcher: PanelFetcher = defaultFetcher
): Promise<PanelEnvelope<Data>> {
  const url = panelUrl(id);
  try {
    const response = await fetcher(url);
    if (!response.ok) {
      throw new Error(`panel "${id}" responded ${response.status}`);
    }
    return parsePanelEnvelope(await response.json()) as PanelEnvelope<Data>;
  } catch (error) {
    console.error(`panel "${id}" failed to load`, error);
    return unavailablePanel(id);
  }
}

/* panelRefreshIntervalMs is how often a mounted panel re-reads its envelope.
 * Thirty seconds is the owner's documented freshness floor. The origin now
 * wakes fetch-backed panels each minute and the sealed data root every thirty
 * seconds, so a long-open tab sees the first prepared answer after either
 * source advances. Hidden tabs still make no requests, and unchanged visible
 * reads are conditional 304s with no response body because the API serves
 * digest ETags. */
export const panelRefreshIntervalMs = 30_000;

/* panelsPendingAttribute is where the page says how many mounted panels have
 * not yet received their FIRST envelope (issue 210). It is an honest state,
 * not test scaffolding: between mount and arrival the document is genuinely
 * mid-answer, and anything measuring the page must tell "nothing is happening
 * yet" from "nothing is happening any more" — a paused height cannot, and the
 * rendering lane that snapshotted in that gap blamed a reading-mode swap for a
 * panel's own 1071px of growth.
 *
 * FIRST envelope only. Counting a later background refresh would make the
 * attribute mean "a request is open", a different and much weaker claim. */
export const panelsPendingAttribute = 'data-panels-pending';

let panelsPending = 0;

/* Reflected onto the document root, or nowhere at all outside a browser —
 * this module is executed by the dependency-free runner, which has no
 * document and needs none. Stamped once at module scope so the attribute
 * EXISTS from the moment the bundle runs: an absent attribute and a zero one
 * mean opposite things, and a reader that cannot tell them apart would treat
 * a page whose panels have not started as a page whose panels have finished. */
function reflectPanelsPending(): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.setAttribute(panelsPendingAttribute, String(panelsPending));
}

reflectPanelsPending();

/* PanelWatchHost is the seam between the polling loop and the browser: the
 * transport, the timer, and the page's visibility state. Production binds it
 * to the globals; tests inject fakes and drive the loop by hand, so nothing
 * in this file's behavior depends on a real timer or a real document. */
export interface PanelWatchHost {
  fetcher: PanelFetcher;
  schedule(callback: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
  hidden(): boolean;
  onVisible(callback: () => void): () => void;
}

/* The default host degrades cleanly outside a browser: with no document there
 * is no visibility to honor, so the page counts as visible and the
 * subscription is a no-op. */
export const defaultWatchHost: PanelWatchHost = {
  fetcher: defaultFetcher,
  schedule: (callback, ms) => globalThis.setInterval(callback, ms),
  cancel: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
  hidden: () => (typeof document === 'undefined' ? false : document.hidden),
  onVisible: (callback) => {
    if (typeof document === 'undefined') {
      return () => {};
    }
    const listener = () => {
      if (!document.hidden) {
        callback();
      }
    };
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  }
};

export interface PanelWatchOptions {
  intervalMs?: number;
  host?: Partial<PanelWatchHost>;
}

/* PanelWatcher is what watchPanel hands back. Calling it stops the loop for
 * good; refresh() forces one immediate read past both the cadence and the
 * hidden-page check, and resolves only once that read has settled, so a caller
 * can stay busy for exactly as long as the request is. It is a callable
 * carrying a method rather than an object so no existing call site changes
 * shape. */
export interface PanelWatcher {
  (): void;
  refresh(): Promise<void>;
}

/* watchPanel keeps one panel current: an immediate first read, then one read
 * per interval, plus any forced read a caller asks for, then a stop that ends
 * the loop for good. Four rules make it cheap and safe to leave running:
 *
 *   - A hidden page is not polled. A background tab produces no requests at
 *     all, and becoming visible again triggers an immediate catch-up read
 *     rather than waiting out the remaining interval.
 *   - At most one request is in flight per panel. A slow origin can never
 *     stack requests behind itself.
 *   - A forced read that arrives while one is already in flight JOINS it
 *     instead of queueing a second: a visitor hammering refresh costs the
 *     origin exactly one request, and still sees the control settle when real
 *     data lands.
 *   - After stop() nothing is delivered, even from a read already in flight,
 *     so an unmounted component can never write to a dead state. */
/* ONE LOOP PER PANEL PER HOST (owner directive, 2026-09-03, issue 287). Two
 * blocks can read the same panel — the commits cycler and the token board both
 * read token-usage — and the origin should hear from this page once per tick
 * per panel, not once per block. So watchPanel hands the second reader the
 * loop the first one started: same fetcher, same tick, same last envelope
 * delivered on subscription, and the loop stops when its last reader does.
 * The share is keyed on the host object as well as the id, so a caller that
 * brings its own host — every test does — never hears another host's
 * fetcher, and refreshPanels still refreshes each real loop exactly once. */
type SharedLoop = {
  readonly subscribers: Set<(envelope: PanelEnvelope) => void>;
  last: PanelEnvelope | null;
  stop: PanelWatcher;
};
const sharedLoops = new WeakMap<object, Map<string, SharedLoop>>();

export function watchPanel<Data = unknown>(
  id: string,
  onEnvelope: (envelope: PanelEnvelope<Data>) => void,
  options: PanelWatchOptions = {}
): PanelWatcher {
  const hostKey: object = options.host ?? defaultWatchHost;
  const loops = sharedLoops.get(hostKey) ?? new Map<string, SharedLoop>();
  sharedLoops.set(hostKey, loops);
  const key = `${options.intervalMs ?? ''}|${id}`;
  let loop = loops.get(key);
  if (loop === undefined) {
    const subscribers = new Set<(envelope: PanelEnvelope) => void>();
    const started: SharedLoop = { subscribers, last: null, stop: undefined as unknown as PanelWatcher };
    started.stop = startWatch<unknown>(
      id,
      (envelope) => {
        started.last = envelope;
        for (const subscriber of [...subscribers]) {
          subscriber(envelope);
        }
      },
      options
    );
    loops.set(key, started);
    loop = started;
  }
  const subscriber = onEnvelope as (envelope: PanelEnvelope) => void;
  loop.subscribers.add(subscriber);
  if (loop.last !== null) {
    subscriber(loop.last);
  }
  const shared = loop;
  return Object.assign(
    () => {
      shared.subscribers.delete(subscriber);
      if (shared.subscribers.size === 0 && loops.get(key) === shared) {
        loops.delete(key);
        shared.stop();
      }
    },
    { refresh: () => shared.stop.refresh() }
  );
}

function startWatch<Data = unknown>(
  id: string,
  onEnvelope: (envelope: PanelEnvelope<Data>) => void,
  options: PanelWatchOptions = {}
): PanelWatcher {
  const host = { ...defaultWatchHost, ...options.host };
  let stopped = false;
  let inFlight = false;
  let pending: Promise<void> = Promise.resolve();
  /* The last envelope the origin served WITH data. A read that fails in
     transport after one that succeeded delivers this, marked stale, rather
     than blanking a rendered panel for a whole interval (issue 285): it is
     the origin's own rule for its upstreams — the last good payload keeps
     serving and says it is stale — applied at the page's boundary, and a
     phone on a flaky connection is exactly where a background read fails.
     loadPanel's fail-soft envelope is told apart by its EMPTY kind, which
     parsePanelEnvelope admits from no origin, so an envelope the origin
     genuinely served as unavailable is still delivered as the origin said,
     and forgets the last good one with it. */
  let lastGood: PanelEnvelope<Data> | null = null;
  /* This panel joins the pending count the moment it is watched and leaves it
     on its first delivery — or on stop(), because a panel torn down before it
     ever answered is no longer something the page is waiting for. `settled`
     makes both exits idempotent, so the count can never drift below zero or
     be decremented twice by a stop that races its own delivery. */
  let settled = false;
  const settle = (): void => {
    if (settled) {
      return;
    }
    settled = true;
    panelsPending -= 1;
    reflectPanelsPending();
  };
  panelsPending += 1;
  reflectPanelsPending();
  const read = (force: boolean): Promise<void> => {
    if (stopped) {
      return Promise.resolve();
    }
    if (inFlight) {
      return pending;
    }
    if (!force && host.hidden()) {
      return Promise.resolve();
    }
    inFlight = true;
    pending = loadPanel<Data>(id, host.fetcher)
      .catch(() => unavailablePanel(id) as PanelEnvelope<Data>)
      .then((envelope) => {
        inFlight = false;
        // Settled on ARRIVAL, whatever arrived: a refused fetch delivers an
        // unavailable envelope, the block renders it, and the page has
        // finished waiting for this panel exactly as much as if it had
        // succeeded. Counting only successes would leave a broken origin
        // looking like a page that never finished loading.
        settle();
        if (stopped) {
          return;
        }
        if (envelope.kind === '' && lastGood !== null) {
          onEnvelope({ ...lastGood, status: 'stale' });
          return;
        }
        if (envelope.kind !== '') {
          lastGood = envelope.status === 'unavailable' ? null : envelope;
        }
        onEnvelope(envelope);
      });
    return pending;
  };
  read(true);
  const handle = host.schedule(() => read(false), options.intervalMs ?? panelRefreshIntervalMs);
  const unsubscribe = host.onVisible(() => read(true));
  const watcher: PanelWatcher = Object.assign(
    () => {
      stopped = true;
      settle();
      host.cancel(handle);
      unsubscribe();
    },
    { refresh: () => read(true) }
  );
  return watcher;
}

/* No page-wide fan-out any more. refreshPanels() and the live registry that
 * backed it existed for one caller, the pull-to-refresh gesture (issue 219);
 * with that gesture gone (owner ruling, 2026-09-04, issue 294) a fan-out
 * nothing fans out to is the dead code issue 179 removed once already, so it
 * is removed again rather than kept warm. Each watcher's own refresh() —
 * the thirty-second poll and the visibility catch-up — is what refreshes a
 * panel, exactly as before. */

/* panelStaleAfterMs is how far behind the wall clock an ok envelope's own
 * generatedAt may fall before a panel must SAY its data has stopped advancing
 * (issue #276; the observability half of #267). Two full days: the usage
 * pipeline pushes each minute and the origin re-reads every thirty seconds,
 * the fetched panels refresh on a minute TTL, and a workstation
 * legitimately sleeps overnight — a day-granularity series cannot honestly
 * alarm at sub-day lag, while two days of silence is a stalled producer. */
export const panelStaleAfterMs = 48 * 60 * 60 * 1000;

/* panelStaleNote is the honest data-through line every panel renders in ONE
 * idiom, or undefined while the payload is fresh. Exactly two states produce
 * it, both proven by the envelope rather than inferred: the origin already
 * SAYS stale (it refused a newer document, kept its last good one past a
 * failed refresh, or is serving its cold-start snapshot), or the origin says
 * ok but its generatedAt has fallen beyond panelStaleAfterMs — the stalled
 * producer the origin structurally cannot tell from quiet. `through` is the
 * newest calendar day the payload's data reaches; absent, the capture age
 * stands alone. The unavailable state is not this line's business: that
 * renders the panel's empty face, and a note under it would date data nobody
 * is shown. No invented freshness either way — every word restates a field
 * the envelope carries. */
export function panelStaleNote(
  status: PanelStatus,
  generatedAt: string | undefined,
  through: string | undefined,
  now: Date = new Date()
): string | undefined {
  if (status === 'unavailable') {
    return undefined;
  }
  const at = generatedAt === undefined ? Number.NaN : Date.parse(generatedAt);
  const aged = !Number.isNaN(at) && now.getTime() - at > panelStaleAfterMs;
  if (status !== 'stale' && !aged) {
    return undefined;
  }
  const parts: string[] = [];
  const day = through === undefined ? '' : formatDateRange(through, through);
  if (day !== '') {
    parts.push(`data through ${day}`);
  }
  const age = panelAge(generatedAt, now);
  if (age !== '') {
    parts.push(`last capture ${age}`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/* panelAge renders an ISO instant as a coarse human age. Its one live caller
 * is lib/activity.ts, which stamps each recent-commit row with how long ago
 * that commit landed.
 *
 * Coarse on purpose and NOT ticked: an age is recomputed when its row is
 * rebuilt, which watchPanel already does every thirty seconds — faster than a
 * "3m ago" would need — so there is no second timer and no rendered age can
 * outlive its own panel's data. */
export function panelAge(generatedAt: string | undefined, now: Date = new Date()): string {
  if (!generatedAt) {
    return '';
  }
  const at = Date.parse(generatedAt);
  if (Number.isNaN(at)) {
    return '';
  }
  const seconds = Math.floor((now.getTime() - at) / 1000);
  if (seconds < 0) {
    return '';
  }
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}
