/* Drives the shared contribution-grid helpers directly: the three series
 * lenses, the magnitude bucketing, the column padding, the month axis, and
 * the accessible cell text both panels depend on. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  addDays,
  cellLabel,
  formatWhole,
  gridLevel,
  gridLevels,
  gridMinColumns,
  gridRows,
  isSeriesView,
  monthTicks,
  peakValue,
  pendingColumns,
  pendingWeeks,
  seriesCells,
  seriesViews,
  stripColumns,
  toColumns,
  viewValues
} from '../src/lib/grid.ts';

const grid = await readFile(
  new URL('../src/lib/components/ContributionGrid.svelte', import.meta.url),
  'utf8'
);

test('the three series lenses read one daily series three ways', () => {
  const totals = [1, 2, 3, 4, 5, 6, 7, 10, 0, 0, 0, 0, 0, 0];

  assert.deepEqual(viewValues(totals, 'daily'), totals, 'the daily lens is the series itself');
  assert.notEqual(viewValues(totals, 'daily'), totals, 'the daily lens must copy, never alias the payload');

  // Weekly buckets align with the grid's own columns, so a column renders as
  // one flat block of its week total.
  assert.deepEqual(
    viewValues(totals, 'weekly'),
    [28, 28, 28, 28, 28, 28, 28, 10, 10, 10, 10, 10, 10, 10],
    'every day in a column must carry that column total'
  );

  assert.deepEqual(
    viewValues([1, 2, 3], 'cumulative'),
    [1, 3, 6],
    'the cumulative lens is the running total'
  );

  // A short trailing week must not be dropped or mis-summed.
  assert.deepEqual(viewValues([5, 5], 'weekly'), [10, 10]);
  assert.deepEqual(viewValues([], 'weekly'), []);
});

test('series views are a closed set', () => {
  assert.deepEqual([...seriesViews], ['daily', 'weekly', 'cumulative']);
  for (const view of seriesViews) {
    assert.ok(isSeriesView(view));
  }
  for (const rogue of ['hourly', '', null, 7, undefined]) {
    assert.equal(isSeriesView(rogue), false, `${String(rogue)} must not pass as a view`);
  }
});

test('levels quantize against the peak, and nothing is level 0 by accident', () => {
  assert.equal(gridLevel(0, 100), 0, 'no activity is level 0');
  assert.equal(gridLevel(5, 0), 0, 'a peakless window cannot rank anything');
  assert.equal(gridLevel(1, 100), 1, 'a single unit of activity must still be visible');
  assert.equal(gridLevel(100, 100), gridLevels - 1, 'the peak day is always the brightest');
  assert.equal(gridLevel(50, 100), 2);
  assert.equal(gridLevel(1000, 100), gridLevels - 1, 'a level can never exceed the ramp');
});

test('peakValue ignores padding cells', () => {
  assert.equal(peakValue([{ value: 3, date: '' }, { value: 9, date: '', absent: true }]), 3);
  assert.equal(peakValue([]), 0);
});

test('columns are always full height, padded with dated-less absent cells', () => {
  const columns = toColumns(seriesCells('2026-08-01', [1, 2, 3, 4, 5, 6, 7, 8, 9]));
  assert.equal(columns.length, 2);
  for (const column of columns) {
    assert.equal(column.length, gridRows, 'every column must be full height so the grid never reflows');
  }
  assert.equal(columns[0][0].date, '2026-08-01');
  assert.equal(columns[1][1].date, '2026-08-09');
  assert.equal(columns[1][2].absent, true, 'days the window does not cover are holes, not zeros');
  assert.equal(toColumns([]).length, 0);
});

test('day arithmetic is UTC calendar arithmetic and survives month ends', () => {
  assert.equal(addDays('2026-08-30', 3), '2026-09-02');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29', 'leap days are real days');
  assert.equal(addDays('not-a-date', 1), '');
});

test('the month axis marks each month once, at the column it starts in', () => {
  const ticks = monthTicks(toColumns(seriesCells('2026-08-01', new Array(70).fill(1))));
  assert.deepEqual(
    ticks.map((tick) => tick.initial),
    ['A', 'S', 'O'],
    'August, September, October, each marked once'
  );
  assert.equal(ticks[0].column, 0);
  assert.equal(ticks[0].name, 'August');
  assert.ok(ticks[1].column > 0);
  // A grid whose cells carry no dates simply has no axis.
  assert.deepEqual(monthTicks([[{ value: 1, date: '' }]]), []);
});

test('cell text always carries the count, so color is never the only encoding', () => {
  assert.equal(cellLabel({ value: 1, date: '2026-08-12' }, 'contribution'), '1 contribution on 2026-08-12');
  assert.equal(cellLabel({ value: 0, date: '2026-08-12' }, 'contribution'), '0 contributions on 2026-08-12');
  assert.equal(cellLabel({ value: 12000, date: '' }, 'token'), '12,000 tokens');
  assert.equal(
    cellLabel({ value: 5, date: '2026-08-12' }, 'token', 'cumulative'),
    '5 tokens (cumulative) on 2026-08-12',
    'an aggregated reading must say which reading it is'
  );
  assert.equal(cellLabel({ value: 0, date: '', absent: true }, 'token'), 'no data for this day');
});

test('thousands grouping is locale-independent', () => {
  assert.equal(formatWhole(0), '0');
  assert.equal(formatWhole(999), '999');
  assert.equal(formatWhole(1000), '1,000');
  assert.equal(formatWhole(1234567), '1,234,567');
});

// The graph a panel renders while it waits for its series (owner directive,
// issue 127). It replaced a line of text where the graph belongs, and the
// honesty invariant is the whole design: an empty graph must contain exactly
// as many datapoints as the source has reported, which is none.
test('the pending graph is chrome with no datapoints in it', () => {
  const columns = pendingColumns();
  assert.equal(columns.length, pendingWeeks, 'the empty graph is a year wide, like the real one');
  // Parity pin, and it became load-bearing the day a block started sizing
  // itself to its column count: the reserve and the payload that lands in it
  // must be the SAME number of columns, or the calendar changes width on
  // arrival and the zero-CLS floor is gone. The other side of this number is
  // TestVCSActivityPanelShipsARenderableGraph in
  // internal/panels/registry_test.go, which pins the shipped calendar to
  // exactly 53 weeks and names this constant when it fails. Move one and the
  // other goes red.
  assert.equal(
    pendingWeeks,
    53,
    'the reserve must stay exactly as wide as the shipped calendar; see internal/panels/registry_test.go'
  );
  for (const column of columns) {
    assert.equal(column.length, gridRows, 'every column is a full week, like the real ones');
    for (const cell of column) {
      // Absent is what makes this honest rather than decorative: an absent
      // cell carries no value and no date, so it can never be read as a
      // measurement. How it is DRAWN is the component's decision and is
      // pinned separately below.
      assert.equal(cell.absent, true);
      assert.equal(cell.value, 0);
      assert.equal(cell.date, '', 'a placeholder day must not claim a date it was never told');
    }
  }
  // Every cell absent means no peak, so the ramp cannot paint a level: a
  // placeholder can never be mistaken for activity, whatever it is passed to.
  assert.equal(peakValue(columns.flat()), 0);
  assert.equal(cellLabel(columns[0][0], 'token'), 'no data for this day');
  // ...and no month axis either, since an undated column cannot be labelled.
  assert.deepEqual(monthTicks(columns), []);
  // A caller asking for nothing gets nothing, never a negative-length loop.
  assert.deepEqual(pendingColumns(0), []);
  assert.deepEqual(pendingColumns(-3), []);
});

// How WIDE a graph is drawn (issue #141, residual risk 2). The box used to be
// a year wide whatever it held, so a fifteen-day series was three columns
// against the left edge of fifty-three columns of nothing. Both directions are
// pinned here because either alone is satisfied by a page that got it wrong: a
// block that always claims 53 passes "never narrower than the minimum", and a
// block that always claims 1 passes "never wider than its data".
test('a graph claims the columns it draws, never more, and never collapses', () => {
  // The direction the owner reported: more box than series.
  assert.equal(stripColumns(3), gridMinColumns, 'a short series must not claim a year of columns');
  assert.equal(stripColumns(53), 53, 'a full calendar keeps every column it draws');
  assert.equal(
    stripColumns(pendingWeeks),
    pendingWeeks,
    'the reserved chrome claims exactly the columns it renders'
  );
  for (const drawn of [11, 12, 26, 40, 53, 104]) {
    assert.equal(stripColumns(drawn), drawn, `a ${drawn} column graph must be ${drawn} columns wide`);
  }

  // The other direction: a claim is never smaller than what is drawn, so a
  // graph can never be clipped by its own box.
  for (const drawn of [1, 2, 3, 9, 10, 11, 53]) {
    assert.ok(
      stripColumns(drawn) >= drawn,
      `a ${drawn} column graph may not be drawn into a narrower box`
    );
  }

  // The floor is the block's own furniture, not a preference: it is the first
  // count whose strip carries the less/more key printed under it (measured at
  // 123.38px in all three engines, and re-measured per engine in the
  // rendering lanes). Nine columns is 114px and would spill it.
  assert.equal(gridMinColumns, 10);
  assert.ok(gridMinColumns * (0.625 + 0.1875) - 0.1875 >= 123.38 / 16, 'the floor must carry the legend');
  assert.ok(
    (gridMinColumns - 1) * (0.625 + 0.1875) - 0.1875 < 123.38 / 16,
    'the floor is the SMALLEST count that carries the legend; a larger one is padding'
  );

  // Nothing a caller can pass produces a box that is not a box.
  for (const rogue of [0, -4, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(stripColumns(rogue), gridMinColumns, `${String(rogue)} columns must still draw a graph`);
  }
  assert.equal(stripColumns(3.9), gridMinColumns, 'a fractional column count never widens the box');
});

// The component half: the number above has to reach the stylesheet, and the
// stylesheet has to spend it on a CAP rather than a width — a fixed width
// would push a year of columns past a 320px viewport and take the page's own
// scrollbar sideways with it, which is a stage-1 floor.
test('the block is sized from the columns it rendered, as a cap', () => {
  assert.match(
    grid,
    /stripColumns\(columns\.length > 0 \? columns\.length : chrome\.length\)/,
    'the width must come from the columns actually drawn, not from a constant'
  );
  assert.match(grid, /style:--grid-columns=\{claimedColumns\}/, 'the count never reaches the stylesheet');
  const block = /\.grid-block \{([^}]*)\}/.exec(grid);
  assert.ok(block, 'the grid block lost its rule');
  assert.match(
    block[1],
    /max-inline-size:\s*calc\(\s*var\(--grid-columns/,
    'the size must be a maximum, so a narrow screen still shrinks it'
  );
  assert.doesNotMatch(
    block[1],
    /(?:^|[\s;])inline-size:/,
    'a fixed inline size would overflow a 320px viewport instead of scrolling inside the strip'
  );
  // The box and the cells must be laid out from the SAME cell metrics, or a
  // token change resizes one and not the other.
  for (const token of ['--grid-cell-size, 0.625rem', '--grid-cell-gap, 0.1875rem']) {
    assert.ok(block[1].includes(token), `the box computes its width from a different ${token}`);
  }
});

// The series arrives from a capture file on the owner's machine, through a
// snapshot, through the origin, into this DOM — so every string on that path
// has to reach the page as TEXT and never as markup (owner directive,
// 2026-08-24). The browser lane proves the rendered result; this proves the
// two places the component could leave the escaped path, which is where such
// a regression is actually written.
test('payload strings reach the grid as text, never as markup', () => {
  // The one label a cell carries is built here, and it must hand back what it
  // was given rather than sanitising it — a helper that stripped markup would
  // hide the bug the escaping is there to prevent, and would silently corrupt
  // a legitimate label containing an angle bracket.
  const hostile = '<img src=x onerror="window.pwned=1">';
  assert.equal(
    cellLabel({ value: 7, date: '2026-08-12' }, hostile),
    `7 ${hostile}s on 2026-08-12`,
    'the cell label must carry the payload string verbatim'
  );
  assert.ok(cellLabel({ value: 1, date: hostile }, 'token').includes(hostile));

  // ...and the component must never take a raw-HTML route with it. Both
  // spellings, because one is Svelte's and one is the DOM's.
  assert.doesNotMatch(grid, /\{@html/, 'the grid renders a payload string as raw HTML');
  assert.doesNotMatch(grid, /innerHTML|insertAdjacentHTML|outerHTML/, 'the grid writes markup by hand');
  // The cell text reaches the DOM through attribute bindings, which Svelte
  // escapes; pinning the spelling keeps a later edit from hand-rolling one.
  // Anchored on the attribute boundary, not on the substring: `data-title=`
  // ends in `title=` and would satisfy a loose match while the cell had lost
  // its tooltip entirely (a surviving mutant, caught by the kill matrix).
  assert.match(grid, /\saria-label=\{text\}/);
  assert.match(grid, /\stitle=\{text\}/);
});

// How the empty state LOOKS, which is a different question from what it
// contains and was conflated with it until issue 134: the placeholders were
// drawn as outlined holes, identically to a missing day inside a real window,
// so a panel with nothing to plot read as a graph that had failed to load.
test('the empty graph is styled as a reserved plate, not as a graph of holes', () => {
  assert.match(
    grid,
    /data-grid-state=\{columns\.length > 0 \? 'series' : 'empty'\}/,
    'the state must be declared on the block, not inferred by a selector'
  );
  const emptyCell = /\.grid-block\[data-grid-state='empty'\] \.grid-cell\[data-grid-pending\]\s*\{([^}]*)\}/.exec(grid);
  assert.ok(emptyCell, 'the empty state gives its placeholder cells no treatment of their own');
  assert.match(emptyCell[1], /box-shadow:\s*none/, 'the placeholder outlines must be cleared');
  assert.match(emptyCell[1], /background:\s*var\(--grid-cell-empty/, 'a flat field needs a fill');

  const emptyStrip = /\.grid-block\[data-grid-state='empty'\] \.grid-strip\s*\{([^}]*)\}/.exec(grid);
  assert.ok(emptyStrip, 'the empty state does not frame its plate');
  // Load-bearing, and the reason the rule is written the way it is: block-size
  // is content-box, so a border would add two pixels to the strip's bounding
  // rectangle and an empty panel would stop being exactly as tall as a full
  // one — which is the zero-CLS floor and a rendering-lane assertion both.
  assert.match(emptyStrip[1], /box-shadow:\s*inset/);
  assert.doesNotMatch(
    emptyStrip[1],
    /(?:^|[\s;])border(?:-block|-inline|-top|-bottom|-left|-right)?:/,
    'a border grows the strip box; the empty and filled panels must be the same height'
  );

  const emptyLegend = /\.grid-block\[data-grid-state='empty'\] \.grid-legend\s*\{([^}]*)\}/.exec(grid);
  assert.ok(emptyLegend, 'the magnitude legend still explains a magnitude that is not there');
  // Hidden, never removed: display:none would take the legend's box out of
  // flow and shorten the panel, which is the same shift by another route.
  assert.match(emptyLegend[1], /visibility:\s*hidden/);
  assert.doesNotMatch(emptyLegend[1], /display:\s*none/);

  const note = /\.grid-empty\s*\{([^}]*)\}/.exec(grid);
  assert.ok(note, 'the empty note lost its rule');
  assert.match(note[1], /position:\s*absolute/, 'the note stays out of flow');
  assert.match(note[1], /text-transform:\s*uppercase/, 'a state reads as a label, not as prose');
  assert.doesNotMatch(
    note[1],
    /font-style:\s*italic/,
    'italics are the typography of an apology; an unavailable series is a state, not a fault'
  );
});
