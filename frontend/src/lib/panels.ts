/* Same-origin data layer for the panel API served by internal/panels. Every
 * shape here mirrors the Go contract in internal/panels/types.go: the stable
 * panel/v1 envelope plus one payload type per versioned kind. Components never
 * build URLs or touch fetch results directly — they call loadPanel and render
 * whatever envelope comes back, so a data fault degrades one panel and can
 * never break the page. */

export type PanelStatus = 'ok' | 'stale' | 'unavailable';

/* The envelope schema is stable forever by design (see internal/panels);
 * evolution happens inside kind-versioned payloads, never out here. */
export const panelEnvelopeSchema = 'panel/v1';

/* Versioned panel kinds. A breaking payload change mints a new kind version;
 * it never mutates an existing one. */
export const panelKinds = {
  tokenUsage: 'token-usage/v2',
  vcsActivity: 'vcs-activity/v1',
  bossLog: 'boss-log/v1'
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

export interface VCSActivityData {
  totalContributions: number;
  weeks: number[][];
  streak: number;
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

/* The panel API's base path, and the ONE place it is written down: panelUrl
 * builds every per-panel URL from it, kept behind a helper exactly like
 * mediaUrl in media.ts so components never assemble API paths by hand.
 *
 * The origin also SERVES this path as a registry listing, but no client reads
 * it: every panel is mounted by hardcoded id from its binding module under
 * lib/blocks/, so the page never needs to ask which panels exist. The reading
 * half of that endpoint was removed rather than left as an unused import
 * surface; adding a discovery caller back means writing a parser again, which
 * is the honest cost of a listing nothing consumes today. */
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

/* EVERY PANEL READ REVALIDATES, and it is stated on this side rather than
 * assumed from the other (2026-08-28, alongside the pull-to-refresh repair).
 *
 * The origin already sends `Cache-Control: no-cache` on every panel envelope
 * (internal/panels/handler.go, pinned by its own Go test), so a default fetch
 * does revalidate today. That is a fact about the SERVER, and a refresh
 * gesture whose honesty depends on a header written in another language, in
 * another repository directory, is one deployment away from silently becoming
 * a no-op: a stale-while-revalidate policy added upstream, or an edge that
 * rewrites freshness, and the reader's pull would resolve out of a memory
 * cache without a request ever leaving the page. `no-cache` on the REQUEST
 * removes that dependency — the client refuses to reuse a stored response
 * without asking.
 *
 * `no-cache` and NOT `no-store`, deliberately. Both would defeat a cache, but
 * `no-store` also refuses to send the validators, so every read would download
 * the whole envelope — MEASURED at up to 104,508 bytes for the token-usage
 * panel (AGENTS.md, "Perf budgets are tests") against the 304 with no body
 * that the panel API's digest ETags exist to produce. `no-cache` keeps the
 * conditional GET and only removes the possibility of skipping it. */
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
 * One minute is the deliberate compromise: the origin refreshes fetch-backed
 * panels on a five-minute TTL (ttlMinutes in internal/panels/config/fetch.json,
 * pinned to the same 30s-5m band from the Go side), so a visitor sees new data
 * within a minute of it existing while a long-open tab costs the origin one
 * conditional GET a minute per panel — and every one of those is a 304 with no
 * body while the data is unchanged, because the panel API serves digest
 * ETags. */
export const panelRefreshIntervalMs = 60_000;

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
 * good — the whole contract every caller had before — and refresh() forces
 * one immediate read past both the cadence and the hidden-page check; the
 * watcher rides it itself for the visibility catch-up, and it is exposed so
 * any future caller with a reason to force a read can join the same
 * single-flight request rather than opening a second one. It is a callable
 * carrying a method rather than an object so no existing call site changes
 * shape, and refresh() resolves only when the read it is riding has settled,
 * so a caller can stay busy for exactly as long as the request is. */
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
export function watchPanel<Data = unknown>(
  id: string,
  onEnvelope: (envelope: PanelEnvelope<Data>) => void,
  options: PanelWatchOptions = {}
): PanelWatcher {
  const host = { ...defaultWatchHost, ...options.host };
  let stopped = false;
  let inFlight = false;
  let pending: Promise<void> = Promise.resolve();
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
        if (!stopped) {
          onEnvelope(envelope);
        }
      });
    return pending;
  };
  read(true);
  const handle = host.schedule(() => read(false), options.intervalMs ?? panelRefreshIntervalMs);
  const unsubscribe = host.onVisible(() => read(true));
  const watcher: PanelWatcher = Object.assign(
    () => {
      stopped = true;
      live.delete(watcher);
      host.cancel(handle);
      unsubscribe();
    },
    { refresh: () => read(true) }
  );
  live.add(watcher);
  return watcher;
}

/* THE LIVE REGISTRY, restored with a caller (issue 219).
 *
 * This existed once and was deleted at issue 179 — correctly, because the only
 * thing that called it was the manual refresh button the owner had just had
 * removed, and a fan-out nothing fans out to is dead code. The owner's ruling
 * there was that the site must stay current ON ITS OWN rather than depending
 * on a visitor noticing a control, and the per-panel loop above is what keeps
 * that true; nothing below changes it.
 *
 * What is different now is that there IS a caller, and it is a gesture rather
 * than a button: a pull-to-refresh asks for the panels the reader is looking
 * at to be re-read NOW. That is not the site depending on a control — the
 * minute loop still runs, and a reader who never pulls sees exactly what they
 * saw before — it is a reader who has decided not to wait out the remaining
 * interval, which is the same intent the visibility catch-up already honours.
 *
 * Every live watcher registers itself and deregisters on stop, so a panel that
 * has unmounted can never be refreshed into a dead component: `stopped`
 * already refuses delivery, and leaving the set is what keeps the set from
 * growing across a long session. */
const live = new Set<PanelWatcher>();

/* refreshPanels forces one immediate read of every mounted panel and resolves
 * when they have all settled — which is what lets a caller stay busy for
 * exactly as long as the work is, rather than for a guessed animation. Each
 * watcher's own single-flight rule still holds, so a reader pulling twice
 * costs the origin no more requests than pulling once. It never rejects: a
 * panel that fails degrades to its honest unavailable envelope inside
 * loadPanel, and a gesture is not the place to surface a transport fault. */
export async function refreshPanels(): Promise<void> {
  await Promise.all([...live].map((watcher) => watcher.refresh()));
}

/* panelAge renders an ISO instant as a coarse human age. Its one live caller
 * is lib/activity.ts, which stamps each recent-commit row with how long ago
 * that commit landed.
 *
 * Coarse on purpose, and NOT ticked: an age is recomputed when the row it
 * sits in is rebuilt — which watchPanel already does once a minute, at the
 * same cadence a "3m ago" would need — so there is no second timer here and
 * no rendered age can outlive its own panel's data. The panel freshness badge
 * this once fed, and the shared wall clock that ticked it, went with the
 * manual refresh control at issue 179. */
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
