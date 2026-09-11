/* The page's one line chart, as arithmetic (owner directive, 2026-09-11, the
 * six-card board). The component draws whatever this returns and computes
 * nothing of its own, so every edge a daily series can present — a single
 * day, a window that recorded nothing, a day nobody measured — is decided
 * here, in a function node executes directly.
 *
 * THE COORDINATE SPACE IS A PERCENTAGE SPACE. The chart is drawn with
 * `preserveAspectRatio="none"` so it spans its card edge to edge whatever
 * that card's width turns out to be, which means the viewBox units are
 * already proportions of the box rather than pixels: a point at x = 50 is
 * halfway across the card at every viewport. The caller passes the box so the
 * unit suite can drive other sizes and prove the arithmetic scales, but the
 * one box the page uses is sparkBox below.
 *
 * A DAY NOBODY MEASURED IS NOT A ZERO. A null entry draws no point, and the
 * line runs from the day before it to the day after — the absence moves no
 * ink downward, which a zero would. Its x position is still spent, so a gap
 * in the middle of a window reads as a longer segment rather than as a
 * compressed series. A series with nothing plottable at all returns null: the
 * caller then draws no chart, which is the honest-states floor at the one
 * place a chart would otherwise draw a flat line along its own floor and
 * claim it measured that. An EMPTY series is the same statement made with no
 * days at all, and it takes the same exit. */

export interface SparkBox {
  readonly width: number;
  readonly height: number;
}

/* One plotted point, in the box's own units. */
export interface SparkPoint {
  readonly x: number;
  readonly y: number;
}

export interface SparkPath {
  /* The line itself, as an SVG path. */
  readonly line: string;
  /* The same line closed down to the baseline and back, for the fill under
     it. One path each rather than one path drawn twice: a stroked area path
     would draw the closing edges too. */
  readonly area: string;
  /* Where the newest reading sits, so the caller can mark it. Kept as a POINT
     in the same units rather than as a rendered element, because the mark is
     drawn outside the squashed coordinate space — a circle inside a
     `preserveAspectRatio="none"` viewBox is an ellipse whose eccentricity is
     the card's aspect ratio. */
  readonly last: SparkPoint;
  /* How many days actually carried a reading. The caller words its own
     accessible label from this; nothing here writes copy. */
  readonly plotted: number;
}

/* The box the page draws in: a pure percentage space, so x and y are already
 * the proportions the card's own width and height resolve. */
export const sparkBox: SparkBox = { width: 100, height: 100 };

/* How much of the box the line keeps clear at each end, in the same units.
 *
 * THE DRAWING CONTAINS ITS OWN MARK. Neither the stroke nor the dot on the
 * newest reading scales with the box — the stroke because
 * `vector-effect: non-scaling-stroke` keeps its width, the mark because it is
 * a real element positioned over the plot rather than a circle inside the
 * squashed space — so a point drawn at y = 0 or y = 100 would put half of
 * each outside the box. Half of the mark is the larger of the two, and since
 * the box is a PERCENTAGE space the reserve has to be stated as a percentage
 * of the height the sheet gives it: --spark-mark-size is 6px in a
 * --spark-height of 3rem, so three pixels of reserve is 6.25%, and this is
 * that with room to spare. A frontend test reads both tokens out of
 * styles.css and holds this number against them, so shrinking the box or
 * growing the mark is a red build rather than two pixels of the card's
 * content quietly hidden behind its own edge. */
export const sparkInset = 8;
const topInset = sparkInset;
const baseInset = sparkInset;

/* sparklinePath plots one daily series. `totals` is indexed by day, oldest
 * first, and a null entry is a day the source reported nothing for. */
export function sparklinePath(
  totals: readonly (number | null)[],
  box: SparkBox
): SparkPath | null {
  const span = totals.length;
  /* ONE refusal, not two. An empty array carries no readings either, so a
     separate length check would be a guard no input could reach independently
     — and a guard nothing can redden is decoration. */
  const readings = totals.filter((value): value is number => value !== null);
  if (readings.length === 0) {
    return null;
  }
  /* The denominator is never zero and never negative: a window whose every
     day recorded nothing still has a real shape to draw — a line along its
     own floor — and that is a different picture from a window nobody
     measured, which returned null above. */
  const ceiling = Math.max(1, ...readings);
  const floor = box.height - baseInset;
  const rise = box.height - topInset - baseInset;
  /* A one-day series has no interval to divide by, so its single point sits
     at the start edge and the segment below stretches it across the box. */
  const step = span === 1 ? 0 : box.width / (span - 1);
  const points: SparkPoint[] = [];
  for (let day = 0; day < span; day += 1) {
    const value = totals[day];
    if (value === null) {
      continue;
    }
    points.push({ x: round(day * step), y: round(floor - (value / ceiling) * rise) });
  }
  const first = points[0];
  const last = points[points.length - 1];
  const line =
    points.length === 1
      ? `M0 ${first.y} L${round(box.width)} ${first.y}`
      : points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
  const from = points.length === 1 ? 0 : first.x;
  const to = points.length === 1 ? round(box.width) : last.x;
  const area = `${line} L${to} ${round(box.height)} L${from} ${round(box.height)} Z`;
  return {
    line,
    area,
    last: points.length === 1 ? { x: round(box.width), y: first.y } : last,
    plotted: points.length
  };
}

/* Two decimals is the whole precision an SVG path needs at this size, and
 * fixing it keeps the emitted markup — and therefore every test that reads
 * it — free of the trailing float noise that differs between engines. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
