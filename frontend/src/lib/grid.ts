/* Pure helpers behind ContributionGrid.svelte — the ONE contribution-heatmap
 * implementation this site has. Two panels render one: token consumption per
 * day and version-control contributions per day. They differ only in the noun
 * they count, so the grid takes prepared cells and knows nothing about either
 * source.
 *
 * Everything here is a plain function so a node test can drive the bucketing,
 * the view transforms, and the month axis directly, with no browser. */

/* A grid column is one week: seven stacked cells, oldest day at the top. */
export const gridRows = 7;

/* Magnitude buckets: level 0 is "nothing happened" and levels 1..4 are
 * quartiles of the window's peak, so a single unit of activity is always
 * visible and the peak cell is always the brightest. The component declares
 * exactly one color custom property per level. */
export const gridLevels = 5;

export interface GridCell {
  /* The measured magnitude for this day. */
  value: number;
  /* ISO calendar date (YYYY-MM-DD), or '' when the source cannot date it. */
  date: string;
  /* True for a padding cell that stands for a day the window does not cover —
   * a future day in the current week, or a lead-in day before the series
   * starts. Absent cells render as holes and carry no count. */
  absent?: boolean;
}

/* The three ways the same daily series can be read. Daily is the raw day,
 * weekly re-reads every day as its week's total, and cumulative re-reads it
 * as the running total to that point — one series, three lenses, no extra
 * payload. */
export const seriesViews = ['daily', 'weekly', 'cumulative'] as const;
export type SeriesView = (typeof seriesViews)[number];

export function isSeriesView(value: unknown): value is SeriesView {
  return typeof value === 'string' && (seriesViews as readonly string[]).includes(value);
}

/* viewValues re-reads a daily series through one lens. Weekly buckets align
 * with the grid's own columns, so a weekly column renders as one flat block
 * of its total — which is exactly what a weekly reading means. */
export function viewValues(totals: number[], view: SeriesView): number[] {
  if (view === 'daily') {
    return [...totals];
  }
  if (view === 'cumulative') {
    let running = 0;
    return totals.map((total) => {
      running += total;
      return running;
    });
  }
  const values = new Array<number>(totals.length).fill(0);
  for (let start = 0; start < totals.length; start += gridRows) {
    let sum = 0;
    for (let offset = 0; offset < gridRows && start + offset < totals.length; offset += 1) {
      sum += totals[start + offset];
    }
    for (let offset = 0; offset < gridRows && start + offset < totals.length; offset += 1) {
      values[start + offset] = sum;
    }
  }
  return values;
}

/* gridLevel buckets one cell into 0..gridLevels-1 against the window's peak. */
export function gridLevel(value: number, peak: number): number {
  if (value <= 0 || peak <= 0) {
    return 0;
  }
  return Math.min(gridLevels - 1, Math.ceil((value / peak) * (gridLevels - 1)));
}

/* peakValue is the anchor the levels quantize against. */
export function peakValue(cells: GridCell[]): number {
  let peak = 0;
  for (const cell of cells) {
    if (!cell.absent && cell.value > peak) {
      peak = cell.value;
    }
  }
  return peak;
}

/* toColumns slices a day-ordered cell list into grid columns of gridRows,
 * padding the final column with absent cells so every column is full height
 * and the grid's geometry never depends on where the window happens to end. */
export function toColumns(cells: GridCell[]): GridCell[][] {
  const columns: GridCell[][] = [];
  for (let start = 0; start < cells.length; start += gridRows) {
    const column = cells.slice(start, start + gridRows);
    while (column.length < gridRows) {
      column.push({ value: 0, date: '', absent: true });
    }
    columns.push(column);
  }
  return columns;
}

/* The width of an empty graph, in columns: one year, the same window the
 * contribution calendar covers, so a panel still waiting for its series
 * renders the same shaped box the panel beside it renders full. */
export const pendingWeeks = 53;

/* pendingColumns is the graph's CHROME with no data in it: every cell absent,
 * valueless and undated. It exists because "no series yet" was rendering as a
 * line of text where a graph belongs, which reads as a broken panel rather
 * than as a panel waiting; an outlined empty grid says the same thing in the
 * shape the reader is looking for.
 *
 * Absent is the whole point. An absent cell is drawn as a hole and labelled
 * as having no data — the identical rendering a day outside a real window
 * gets — so this fills a graph with EXACTLY as much information as the source
 * has reported, which is none. A zero would be a datapoint, and inventing one
 * per day for a year would be a doctrine violation with a very tidy look. */
export function pendingColumns(weeks: number = pendingWeeks): GridCell[][] {
  return Array.from({ length: Math.max(0, weeks) }, () =>
    Array.from({ length: gridRows }, () => ({ value: 0, date: '', absent: true }))
  );
}

/* addDays walks a calendar date forward in UTC. Dates in this file are plain
 * calendar labels, never instants, so UTC arithmetic keeps them stable in
 * every visitor's time zone. */
export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const moved = new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate() + days)
  );
  return moved.toISOString().slice(0, 10);
}

/* seriesCells turns a start date plus daily magnitudes into grid cells. */
export function seriesCells(startDate: string, totals: number[]): GridCell[] {
  return totals.map((value, index) => ({ value, date: addDays(startDate, index) }));
}

/* monthInitials indexes month numbers 1..12; the axis prints one letter per
 * month so a year of columns stays readable at grid density. */
const monthInitials = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

export interface MonthTick {
  /* Zero-based column the month's first covered day falls in. */
  column: number;
  /* The month's initial, e.g. 'A' for August. */
  initial: string;
  /* The full month name, for the axis's accessible text. */
  name: string;
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

/* monthTicks marks the column where each new month begins, so the axis can
 * label the grid without a date on every cell. Columns whose cells carry no
 * date (a source that cannot date its series) simply produce no ticks. */
export function monthTicks(columns: GridCell[][]): MonthTick[] {
  const ticks: MonthTick[] = [];
  let previous = '';
  columns.forEach((column, index) => {
    const dated = column.find((cell) => !cell.absent && cell.date.length >= 7);
    if (!dated) {
      return;
    }
    const month = dated.date.slice(0, 7);
    if (month === previous) {
      return;
    }
    previous = month;
    const ordinal = Number(dated.date.slice(5, 7));
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 12) {
      return;
    }
    ticks.push({ column: index, initial: monthInitials[ordinal - 1], name: monthNames[ordinal - 1] });
  });
  return ticks;
}

/* cellLabel is the one accessible text a cell carries — tooltip and
 * aria-label alike — so a magnitude is never encoded by color alone. */
export function cellLabel(cell: GridCell, noun: string, view: SeriesView = 'daily'): string {
  if (cell.absent) {
    return 'no data for this day';
  }
  const scope = view === 'daily' ? '' : ` (${view})`;
  const counted = `${formatWhole(cell.value)} ${cell.value === 1 ? noun : `${noun}s`}${scope}`;
  return cell.date ? `${counted} on ${cell.date}` : counted;
}

/* formatWhole groups thousands by hand so the output is identical in every
 * runtime locale — a rendered figure is part of the tested contract and must
 * never depend on the visitor's environment. */
export function formatWhole(value: number): string {
  const digits = String(Math.round(value));
  let grouped = '';
  for (let index = 0; index < digits.length; index += 1) {
    const fromEnd = digits.length - index;
    if (index > 0 && fromEnd % 3 === 0 && digits[index - 1] !== '-') {
      grouped += ',';
    }
    grouped += digits[index];
  }
  return grouped;
}
