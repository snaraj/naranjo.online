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
  tokenUsage: 'token-usage/v1',
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

export interface PanelIndexEntry {
  id: string;
  kind: string;
  title: string;
  status: PanelStatus;
}

export interface PanelIndex {
  panels: PanelIndexEntry[];
}

/* token-usage/v1 — token consumption windows grouped per labeled source.
 * Source labels are data supplied by the origin, never frontend constants. */
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
export type TokenStatUnit = 'tokens' | 'days' | 'seconds';

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

export interface TokenUsageData {
  sources: TokenUsageSource[];
}

/* vcs-activity/v1 — contribution weeks, totals, streak, recent commits. */
export interface VCSCommit {
  repo: string;
  message: string;
  at: string;
}

export interface VCSActivityData {
  totalContributions: number;
  weeks: number[][];
  streak: number;
  recentCommits: VCSCommit[];
}

/* boss-log/v1 — one game account's boss tallies. kc and rank are null when
 * the account is unranked for that boss; null is data and renders as "--". */
export interface BossLogEntry {
  name: string;
  kc: number | null;
  rank: number | null;
  score?: number | null;
}

export interface BossLogData {
  account: string;
  bosses: BossLogEntry[];
}

/* panelsIndexUrl and panelUrl are the only URL shapes the panel API accepts,
 * kept behind helpers exactly like mediaUrl in media.ts so components never
 * assemble API paths by hand. */
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

export function parsePanelIndex(document: unknown): PanelIndex {
  if (!isRecord(document) || !Array.isArray(document.panels)) {
    throw new Error('panel index must carry a panels array');
  }
  const panels = document.panels.map((entry): PanelIndexEntry => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== 'string' ||
      typeof entry.kind !== 'string' ||
      typeof entry.title !== 'string' ||
      typeof entry.status !== 'string' ||
      !panelStatuses.has(entry.status)
    ) {
      throw new Error('panel index entry must carry id, kind, title, and a known status');
    }
    return {
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      status: entry.status as PanelStatus
    };
  });
  return { panels };
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

/* The wrapper keeps fetch called as a plain global (never an unbound method)
 * and gives tests a seam to inject fakes without touching globals. */
const defaultFetcher: PanelFetcher = (url) => globalThis.fetch(url);

/* loadPanel performs exactly one same-origin request — no retries, no
 * backoff; the origin already serves prepared bytes and a failure simply
 * renders as unavailable until the next natural page load. */
export async function loadPanel<Data = unknown>(
  id: string,
  fetcher: PanelFetcher = defaultFetcher
): Promise<PanelEnvelope<Data>> {
  const url = panelUrl(id);
  try {
    const response = await fetcher(url);
    if (!response.ok) {
      return unavailablePanel(id);
    }
    return parsePanelEnvelope(await response.json()) as PanelEnvelope<Data>;
  } catch {
    return unavailablePanel(id);
  }
}

export async function loadPanelIndex(fetcher: PanelFetcher = defaultFetcher): Promise<PanelIndex> {
  try {
    const response = await fetcher(panelsIndexUrl);
    if (!response.ok) {
      return { panels: [] };
    }
    return parsePanelIndex(await response.json());
  } catch {
    return { panels: [] };
  }
}

/* panelRefreshIntervalMs is how often a mounted panel re-reads its envelope.
 * One minute is the deliberate compromise: the origin refreshes fetch-backed
 * panels on a 45-minute TTL, so a visitor sees new data within a minute of it
 * existing while a long-open tab costs the origin one conditional GET a
 * minute per panel — and every one of those is a 304 with no body while the
 * data is unchanged, because the panel API serves digest ETags. */
export const panelRefreshIntervalMs = 60_000;

/* panelClockIntervalMs is how often the freshness badge re-reads the clock.
 * The age it prints is coarse (minutes, then hours), so half a minute keeps
 * "just now" from lingering without waking anything meaningful. */
export const panelClockIntervalMs = 30_000;

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

/* watchPanel keeps one panel current: an immediate first read, then one read
 * per interval, then a stop function that ends the loop for good. Three rules
 * make it cheap and safe to leave running:
 *
 *   - A hidden page is not polled. A background tab produces no requests at
 *     all, and becoming visible again triggers an immediate catch-up read
 *     rather than waiting out the remaining interval.
 *   - At most one request is in flight per panel. A slow origin can never
 *     stack requests behind itself.
 *   - After stop() nothing is delivered, even from a read already in flight,
 *     so an unmounted component can never write to a dead state. */
export function watchPanel<Data = unknown>(
  id: string,
  onEnvelope: (envelope: PanelEnvelope<Data>) => void,
  options: PanelWatchOptions = {}
): () => void {
  const host = { ...defaultWatchHost, ...options.host };
  let stopped = false;
  let inFlight = false;
  const read = (force: boolean) => {
    if (stopped || inFlight || (!force && host.hidden())) {
      return;
    }
    inFlight = true;
    loadPanel<Data>(id, host.fetcher)
      .catch(() => unavailablePanel(id) as PanelEnvelope<Data>)
      .then((envelope) => {
        inFlight = false;
        if (!stopped) {
          onEnvelope(envelope);
        }
      });
  };
  read(true);
  const handle = host.schedule(() => read(false), options.intervalMs ?? panelRefreshIntervalMs);
  const unsubscribe = host.onVisible(() => read(true));
  return () => {
    stopped = true;
    host.cancel(handle);
    unsubscribe();
  };
}

/* watchClock ticks a shared wall clock so a rendered age keeps telling the
 * truth. Without it a badge computed once at mount reads "just now" forever,
 * which is worse than no badge: it is a freshness claim that quietly becomes
 * false. Same host seam, same stop contract. */
export function watchClock(onTick: (now: Date) => void, options: PanelWatchOptions = {}): () => void {
  const host = { ...defaultWatchHost, ...options.host };
  let stopped = false;
  const handle = host.schedule(() => {
    if (!stopped) {
      onTick(new Date());
    }
  }, options.intervalMs ?? panelClockIntervalMs);
  return () => {
    stopped = true;
    host.cancel(handle);
  };
}

/* panelAge renders generatedAt as the coarse human age the status badge
 * shows. Coarse on purpose: freshness is a glance, not a clock — the ticking
 * happens in watchClock, which re-invokes this with a fresh instant. */
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
