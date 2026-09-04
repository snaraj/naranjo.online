import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
  categoryLabel,
  categoryShares,
  categorySlot,
  countBound,
  formatDuration,
  formatShare,
  formatStatValue,
  formatTokenCount,
  formatUtilization,
  meterFillPct,
  meterSeverity,
  modelLabel,
  modelShares,
  modelSlot,
  boardEmptyNote,
  boardReturnLabel,
  boardTurnLabel,
  provenanceIsMixed,
  resetsIn,
  tokenSquares,
  tokenSquaresProps,
  tokenUsageEmptyNote,
  tokenUsageFallbackTitle,
  tokenUsagePanelId,
  tokenUsageSourceEmptyNote,
  tokenUsageSources,
  unknownFigure,
  usageDataThrough,
  usageStaleAfterMs,
  usageStaleNote
} from '../src/lib/token-usage.ts';
import { recordedOutOfBand } from '../src/lib/blocks.ts';
import { commitLogProps } from '../src/lib/commits.ts';
import { formatMagnitude, pendingWeeks } from '../src/lib/grid.ts';

/* THE PANEL BECAME A BOARD (owner directive of 2026-09-03, issue 287): the
 * tile grid is five turnable squares in LedgerBoard.svelte, and the daily
 * graph the tracker used to draw moved into the commits section's cycling
 * calendar (CommitLog.svelte). Both are read here, because the pins this file
 * carries now live in two components rather than one — and the ABSENCE list
 * that keeps the retired display menu from coming back has to sweep both, or
 * it would only be guarding the door the menu did not use.
 *
 * styles.css joins them for the same reason: the board's grid and its category
 * swatches are page-level decisions the ledger's other sections share, so the
 * stylesheet is where they are stated and where they must be pinned. */
const [component, commits, helper, manifest, binding, sheet] = await Promise.all([
  readFile(new URL('../src/lib/components/LedgerBoard.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/components/CommitLog.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/token-usage.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/page.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/blocks/tokenSquares.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
]);

/* One envelope carrying the shipped payload plus a token series, for driving
 * the commits block's own adapter the way its multi-panel host does: the
 * calendar reads the version-control panel first and the token panel second,
 * so a token-only fixture passes null for the first slot. */
const tokenOnly = (data, overrides = {}) => [null, envelopeFor(data, overrides)];

/* One well-formed envelope around the shipped payload, for driving the
 * adapter the way the block host does. */
const envelopeFor = (data, overrides = {}) => ({
  schema: 'panel/v1',
  id: tokenUsagePanelId,
  kind: 'token-usage/v2',
  title: 'Fixture Usage',
  status: 'ok',
  generatedAt: '2026-08-11T03:00:00Z',
  data,
  ...overrides
});

// The exact payload shape internal/panels serves. The two
// source labels are DATA — they appear here exactly as the origin ships them,
// and the component itself is asserted vendor-free below.
const shippedPayload = {
  sources: [
    {
      label: 'anthropic',
      windows: [
        {
          period: 'session',
          inputTokens: 182340,
          outputTokens: 45120,
          utilizationPct: 36.4,
          resetsAt: '2026-08-11T07:00:00Z'
        },
        { period: 'week', inputTokens: 9421770, outputTokens: 2103980, utilizationPct: 61.2 }
      ]
    },
    {
      label: 'codex',
      windows: [{ period: 'week', inputTokens: 4180230, outputTokens: 1250770 }]
    }
  ]
};

/* formatTokenCount is `return formatMagnitude(count)` and nothing else, so a
 * literal value table here is a second copy of the one in tests/grid.test.mjs
 * — which is the larger table, and the one that also pins the boundary cases
 * (the promotion at every step, the unpromotable top, NaN). Three such tables
 * stood here and every value in them is now checked there, the five this
 * suite alone carried (999, 100K, 182.3K, 2.1M, 1.3B) having been migrated
 * across rather than dropped. What stays is the pin that cannot live in the
 * other suite: that the two names really are one function. */
describe('formatTokenCount', () => {
  it('is a NAME for the shared magnitude formatter, never a second copy of it', () => {
    // The panel's summary line and the heatmap cell above it are formatted by
    // two different modules, and until 2026-08-25 they were two different
    // implementations: "7.7B tokens over 15 days" under a tooltip reading
    // "627,742,457". One function is what makes those the same reading, so
    // this pin drives both names across the whole interesting range rather
    // than trusting the delegation to stay.
    for (const value of [0, 999, 9999, 10_000, 12_900, 999_950, 627_742_457, 7.7e12]) {
      assert.equal(formatTokenCount(value), formatMagnitude(value), `the two readings of ${value} diverged`);
    }
    assert.doesNotMatch(
      helper.replace(/\/\*[\s\S]*?\*\//g, ' '),
      /\[1_000_000_000, 'B'\]/,
      'the panel grew its own copy of the magnitude steps again'
    );
  });
});

describe('formatUtilization', () => {
  it('renders the true value to at most one decimal place', () => {
    assert.equal(formatUtilization(36.4), '36.4%');
    assert.equal(formatUtilization(61), '61%');
    assert.equal(formatUtilization(61.25), '61.3%');
    assert.equal(formatUtilization(0), '0%');
  });

  it('shows over-limit utilization honestly instead of capping the label', () => {
    assert.equal(formatUtilization(104.02), '104%');
  });
});

describe('meterSeverity and meterFillPct', () => {
  it('steps severity at the documented thresholds', () => {
    assert.equal(meterSeverity(0), 'ok');
    assert.equal(meterSeverity(74.9), 'ok');
    assert.equal(meterSeverity(75), 'warning');
    assert.equal(meterSeverity(89.9), 'warning');
    assert.equal(meterSeverity(90), 'critical');
    assert.equal(meterSeverity(130), 'critical');
  });

  it('saturates the drawn fill at the track while the label stays true', () => {
    assert.equal(meterFillPct(-5), 0);
    assert.equal(meterFillPct(36.4), 36.4);
    assert.equal(meterFillPct(100), 100);
    assert.equal(meterFillPct(104), 100);
  });
});

describe('resetsIn', () => {
  const now = new Date('2026-08-11T03:00:00Z');

  it('renders coarse relative time in minutes, hours, and days', () => {
    assert.equal(resetsIn('2026-08-11T03:00:30Z', now), 'resets in 1m');
    assert.equal(resetsIn('2026-08-11T03:59:00Z', now), 'resets in 59m');
    assert.equal(resetsIn('2026-08-11T04:30:00Z', now), 'resets in 1h');
    assert.equal(resetsIn('2026-08-13T01:00:00Z', now), 'resets in 46h');
    assert.equal(resetsIn('2026-08-14T05:00:00Z', now), 'resets in 3d');
  });

  it('renders nothing for absent, malformed, or already-passed instants', () => {
    assert.equal(resetsIn(undefined, now), '');
    assert.equal(resetsIn('not-a-date', now), '');
    assert.equal(resetsIn('2026-08-11T02:59:00Z', now), '');
    assert.equal(resetsIn('2026-08-11T03:00:00Z', now), '');
  });
});

describe('tokenUsageSources admission', () => {
  it('admits the shipped payload contract, both sources intact', () => {
    const sources = tokenUsageSources(shippedPayload);
    assert.equal(sources.length, 2);
    assert.deepEqual(
      sources.map((source) => source.label),
      shippedPayload.sources.map((source) => source.label)
    );
    const [first, second] = sources;
    assert.equal(first.windows.length, 2);
    assert.equal(first.windows[0].period, 'session');
    assert.equal(first.windows[0].inputTokens, 182340);
    assert.equal(first.windows[0].utilizationPct, 36.4);
    assert.equal(first.windows[0].resetsAt, '2026-08-11T07:00:00Z');
    assert.equal(first.windows[1].resetsAt, undefined);
    assert.equal(second.windows[0].utilizationPct, undefined);
  });

  it('passes through a source with no windows so it can render its own empty state', () => {
    const sources = tokenUsageSources({ sources: [{ label: 'fixture', windows: [] }] });
    assert.equal(sources.length, 1);
    assert.deepEqual(sources[0].windows, []);
  });

  it('refuses every malformed payload wholesale — the honest empty state, never fake numbers', () => {
    const broken = [
      null,
      'usage',
      { sources: 'nope' },
      { sources: [null] },
      { sources: [{ label: '', windows: [] }] },
      { sources: [{ windows: [] }] },
      { sources: [{ label: 'fixture', windows: 'nope' }] },
      { sources: [{ label: 'fixture', windows: [{ period: '', inputTokens: 1, outputTokens: 1 }] }] },
      { sources: [{ label: 'fixture', windows: [{ period: 'week', inputTokens: -1, outputTokens: 1 }] }] },
      { sources: [{ label: 'fixture', windows: [{ period: 'week', inputTokens: '1', outputTokens: 1 }] }] },
      { sources: [{ label: 'fixture', windows: [{ period: 'week', inputTokens: 1, outputTokens: Number.NaN }] }] },
      { sources: [{ label: 'fixture', windows: [{ period: 'week', inputTokens: 1, outputTokens: 1, utilizationPct: 'high' }] }] },
      { sources: [{ label: 'fixture', windows: [{ period: 'week', inputTokens: 1, outputTokens: 1, resetsAt: 7 }] }] }
    ];
    for (const payload of broken) {
      assert.deepEqual(tokenUsageSources(payload), [], JSON.stringify(payload));
    }
  });
});

describe('the board of squares: source contract', () => {
  it('renders inside the shared PanelShell with the envelope status, age, and no per-card control', () => {
    assert.match(component, /import PanelShell from '\.\/PanelShell\.svelte'/);
    /* The shell now receives the data-through line as well (owner directive of
       2026-09-03, issue 287): the board's body is a grid of fixed squares, so
       the head is the one row a late line can appear in without moving
       anything — the same arrangement the calendar already used. */
    assert.match(component, /<PanelShell \{title\} \{status\} \{generatedAt\} note=\{staleNote\}>/);
    assert.match(component, /<\/PanelShell>/);
    // No panel offers a manual refresh any more (owner directive, issue 179):
    // this panel hands its shell no refresher and holds no watcher handle of
    // its own — the block host enrols it through watchPanel, which keeps
    // itself current, and a failed read logs an error instead of waiting on
    // a visitor to press a control that does not exist.
    assert.doesNotMatch(component, /\{refresh\}|const refresh =|watcher/);
    // The envelope facts ride the adapter into the shell unchanged, and the
    // empty-title fallback the unavailablePanel case needs is preserved.
    const rendered = tokenSquaresProps(envelopeFor(shippedPayload));
    assert.equal(rendered.title, 'Fixture Usage');
    assert.equal(rendered.status, 'ok');
    assert.equal(rendered.generatedAt, '2026-08-11T03:00:00Z');
    assert.equal(tokenSquaresProps(envelopeFor(null, { title: '' })).title, tokenUsageFallbackTitle);
    assert.equal(tokenUsageFallbackTitle, 'Token usage');
    // Before the first envelope the block renders NOTHING — the same face the
    // retired component's {#if envelope} guard gave the page.
    assert.equal(tokenSquaresProps(null), null);
  });

  it('derives one square per payload source and takes every label from the data', () => {
    /* The tile grid iterated `sections`; the board iterates `squares` (owner
       directive of 2026-09-03, issue 287). The property that mattered is
       unchanged and is asserted the same way: the SET of surfaces is derived
       from the payload's own sources, in the payload's own order, so a third
       source appearing tomorrow needs no edit in the adapter and none in the
       component. */
    assert.match(component, /\{#each squares as square \(square\.key\)\}/);
    assert.match(component, /\{square\.label\}/);
    const rendered = tokenSquaresProps(envelopeFor(shippedPayload));
    const perSource = rendered.squares.filter((square) => square.key.startsWith('source-'));
    assert.deepEqual(
      perSource.map((square) => square.label),
      shippedPayload.sources.map((source) => source.label),
      'every source square is labelled by the payload, in the payload\u2019s order'
    );
    // ...and the whole board is derived, never enumerated: a one-source
    // payload produces one source square, a three-source payload three.
    const three = tokenSquares([
      { label: 'a', windows: [] },
      { label: 'b', windows: [] },
      { label: 'c', windows: [] }
    ]);
    assert.equal(three.filter((square) => square.key.startsWith('source-')).length, 3);
    assert.deepEqual(tokenSquares([]), [], 'a payload with no sources draws no board at all');
    // Vendor and tool names are payload data, never component or helper
    // logic. The needles are assembled from fragments so this test file's
    // own scan subject stays clean, mirroring the Go doctrine pin.
    for (const [name, source] of Object.entries({ component, commits, helper })) {
      const lowered = source.toLowerCase();
      for (const mark of ['anthro' + 'pic', 'co' + 'dex', 'open' + 'ai']) {
        assert.ok(!lowered.includes(mark), `${name} hardcodes the vendor name ${mark}`);
      }
    }
  });

  it('never lets color carry the meter alone: the graphic is hidden, the value visible', () => {
    /* THE METER SURVIVED THE REDESIGN (owner directive of 2026-09-03, issue
       287). It sits under a source square\u2019s lifetime figure rather than in a
       window row, and every property this pin protects is unchanged: the fill
       is decorative, the true reading is printed beside it, the period it
       measures is printed under it, and the fill saturates while the reading
       does not. Dropping the meter with the tiles would have been the redesign
       quietly losing a capability rather than restyling one. */
    assert.match(component, /class="board-meter" data-severity=\{square\.meter\.severity\}/);
    assert.match(component, /class="board-meter-reading">\{square\.meter\.reading\}/);
    assert.match(component, /class="board-meter-label">\{square\.meter\.label\}/);
    // The reading beside the fill is the true figure through the tested
    // renderer, and the fill saturates while the reading does not.
    const squares = tokenSquaresProps(envelopeFor(shippedPayload)).squares;
    const first = squares.find((square) => square.key === 'source-anthro' + 'pic');
    assert.equal(first.meter.reading, formatUtilization(36.4));
    assert.equal(first.meter.severity, meterSeverity(36.4));
    assert.equal(first.meter.fillPct, meterFillPct(36.4));
    const reset = resetsIn('2026-08-11T07:00:00Z');
    assert.equal(first.meter.label, reset === '' ? 'session' : `session · ${reset}`);
    // A source whose only window reports no utilization draws no meter at
    // all: a bar at zero and a bar for a figure nobody reported are the same
    // picture, and only one of them is true.
    const second = squares.find((square) => square.key === 'source-co' + 'dex');
    assert.equal(second.meter, undefined);
    /* THE INPUT/OUTPUT SPLIT MOVED TO THE SQUARE\u2019S BACK (same directive): the
       pair row became the per-day category composition, which says the same
       thing with more of it — a written label, an exact count and a share for
       each of input, output and the two cache classes. The words are never
       replaced by a glyph here, so there is nothing to clip into the
       accessibility tree and nothing to recover from a title attribute. */
    const composed = tokenSquaresProps(
      envelopeFor({
        sources: [
          {
            label: 'fixture',
            windows: [],
            series: {
              startDate: '2026-08-10',
              totals: [10],
              categories: [
                { key: 'input', totals: [4] },
                { key: 'output', totals: [6] }
              ]
            }
          }
        ]
      })
    ).squares.find((square) => square.key === 'source-fixture');
    assert.deepEqual(
      composed.back.facts.map((fact) => [fact.term, fact.value]),
      [
        ['input', `${formatTokenCount(4)} · ${formatShare(40)}`],
        ['output', `${formatTokenCount(6)} · ${formatShare(60)}`]
      ]
    );
  });

  it('renders honest empty states for a refused payload and for a sourceless square', () => {
    /* Two empty faces, exactly as the tracker had two: the board\u2019s own note
       for a payload that produced no squares, and a square\u2019s back note for a
       source with nothing to turn over to. Both are ADAPTER words, so the
       component states neither. */
    assert.match(component, /<p class="board-note">\{emptyNote\}<\/p>/);
    assert.match(component, /\{#if square\.back\.note\}<span class="board-sub">\{square\.back\.note\}<\/span>\{\/if\}/);
    assert.equal(boardEmptyNote, tokenUsageEmptyNote);
    assert.equal(tokenUsageEmptyNote, 'No usage data available.');
    assert.equal(tokenSquaresProps(envelopeFor(null)).squares.length, 0);
    const bare = tokenSquares([{ label: 'bare', windows: [] }]);
    const bareSource = bare.find((square) => square.key === 'source-bare');
    assert.equal(bareSource.back.facts, undefined, 'a source with nothing to show must list no facts');
    assert.equal(bareSource.back.note, tokenUsageSourceEmptyNote);
    assert.equal(tokenUsageSourceEmptyNote, 'No usage recorded for this source yet.');
  });

  it('reads every color from a custom property, and the severity ramp with no fallback at all', () => {
    assert.doesNotMatch(component, /#[0-9a-fA-F]{3,8}\b/, 'raw hex colors defeat theme overrides');
    /* RE-AIMED at the roles this component actually paints (owner directive of
       2026-09-03, issue 287): the board sits on the ledger\u2019s own sheet, so its
       neutrals are --ledger-* rather than --panel-*, and the panel tokens are
       read by the shell it renders inside. The claim is unchanged — every
       colour here is a token read, so a reading mode restyles the board
       without this file knowing a mode exists. */
    for (const token of ['--ledger-', '--usage-meter-ok', '--usage-meter-warning', '--usage-meter-critical']) {
      assert.match(
        component,
        new RegExp(`var\\(\\s*${token}`),
        `component styles must read var(${token}…) so themes can override it`
      );
    }
    /* RE-AIMED, not relaxed (issues 222 and 229). This list used to include
       --panel-status-ok, because the OK fill reached it through a fallback
       chain — and that chain is exactly the defect the two issues name: the
       warning fill's chain ended at --panel-accent (a BRAND mark standing in
       for a status) and the critical fill's ended at a bare rgb() literal
       inside this component. All three severities now read one declared meter
       token each, so the ramp is a palette decision in styles.css rather than
       a chain that quietly repaints itself when a link is missing. The three
       reads must therefore carry NO comma: a fallback here would restore the
       hiding place, since a fallback paints and so a missing declaration
       looks like nothing at all. */
    for (const token of ['--usage-meter-ok', '--usage-meter-warning', '--usage-meter-critical']) {
      assert.match(
        component,
        new RegExp(`var\\(${token}\\)`),
        `${token} must be read bare; a fallback hides the token's absence instead of failing on it`
      );
    }
    assert.doesNotMatch(
      component,
      /var\(\s*--panel-status-[a-z]+\s*,/,
      'a --panel-status-* read carries a fallback again; the token layer declares all three, so a fallback can only hide a missing one'
    );
  });

  it('sets every dynamic value through a custom property, never an inline style string', () => {
    /* The CSP floor (default-src 'self' admits no style attribute), carried
       into the board (owner directive of 2026-09-03, issue 287): a bar's fill
       is the one genuinely dynamic length on this surface, and it reaches the
       DOM as a custom property Svelte writes with setProperty rather than as a
       style string. Everything else — which face is up, which severity paints,
       which palette slot a category owns — is a closed-set data attribute. */
    assert.match(component, /style:--board-fill=\{`\$\{bar\.fillPct\}%`\}/);
    assert.match(component, /style:--board-fill=\{`\$\{square\.meter\.fillPct\}%`\}/);
    assert.doesNotMatch(component, /\sstyle="/, 'a static style attribute is exactly what the CSP forbids');
    assert.doesNotMatch(component, /style=\{/, 'a whole-attribute style expression is blocked by the CSP');
    assert.doesNotMatch(component, /cssText/, 'cssText writes the same blocked attribute by another name');
  });

  it('hides the face that is turned away, swapping at the flip midpoint, because WebKit flattens the 3D turn', () => {
    /* The back face used to rely on backface-visibility alone, and on every
       Safari it drew mirrored over the front: WebKit flattens 3D transforms
       inside a <button>, so the property never applied (found by the browser
       matrix, 2026-09-03, issue 287). The rule that fixed it is a
       `visibility` swap — the back hidden at rest, the front hidden once the
       square is turned — delayed half a flip so the swap lands while the
       square is edge-on. Pinned here where it is declared; the rendering lane
       "every board square shows all of its own content" measures the
       computed visibility of both faces at rest and turned. */
    assert.match(
      sheet,
      /\.board-face\[data-face='back'\],\s*\.board-square\[data-turned='true'\] \.board-face\[data-face='front'\] \{[^}]*visibility: hidden/,
      'the back at rest and the front once turned must be hidden, not merely turned away'
    );
    assert.match(
      sheet,
      /\.board-square\[data-turned='true'\] \.board-face\[data-face='back'\] \{[^}]*visibility: visible/,
      'the turned back must be the visible face'
    );
    assert.match(
      sheet,
      /\.board-face \{[^}]*transition: visibility 0s linear calc\(var\(--flip-duration\) \/ 2\)/,
      'the swap must wait half a flip, or the new face pops in before the square is edge-on'
    );
  });

  it('is a control a finger and a keyboard can both reach', () => {
    /* The 44px touch floor and the announced state, on the one control this
       surface has (owner directive of 2026-09-03, issue 287: "tap a square").
       A real <button> is what brings keyboard operation and the pressed state
       with it; the floor is declared on the class even though a square is far
       larger, because a control sized only by its content is a control whose
       size depends on its content. */
    assert.match(component, /<button\s+class="board-square"/);
    assert.match(component, /aria-pressed=\{open\}/);
    assert.match(sheet, /\.board-square \{[^}]*min-inline-size: var\(--control-target\)/);
    assert.match(sheet, /\.board-square \{[^}]*min-block-size: var\(--control-target\)/);
    assert.match(sheet, /--control-target: 2\.75rem;/);
    // The turn is announced in words the ADAPTER supplies, so the component
    // composes no sentence of its own.
    assert.match(component, /aria-label=\{`\$\{open \? returnLabel : turnLabel\} \$\{square\.ariaLabel\}`\}/);
    assert.equal(boardTurnLabel, 'Turn');
    assert.equal(boardReturnLabel, 'Turn back');
    // The face turned away is hidden from assistive technology, so a square's
    // front and back are never read as one run-on sentence.
    assert.match(component, /data-face="front" aria-hidden=\{open\}/);
    assert.match(component, /data-face="back" aria-hidden=\{!open\}/);
  });

  it('stays local-origin like every shipped source file', () => {
    for (const [name, source] of Object.entries({ component, commits, helper })) {
      // Protocol-relative origins still fail this; a line comment no longer
      // does. The lookahead and the reasoning behind it are documented once,
      // on the same sweep in tests/experience.test.mjs.
      assert.doesNotMatch(source, /(?:https?:)?\/\/(?=[\w-]+\.)/, `${name} introduces a remote origin`);
    }
  });
});

describe('manifest mount', () => {
  it('lists this block exactly once, bound to its panel id', () => {
    /* The fences retired with the table-of-contents App (issue 165): the
       manifest IS the mount list, so the per-panel pin moves to it. The block
       module was renamed with the component it binds (owner directive of
       2026-09-03, issue 287): tokenUsage → tokenSquares, UsageTracker →
       LedgerBoard. The PANEL ID is untouched, which is the half that matters —
       the wire contract did not move, only the rendering did. The canonical
       whole-section listing lives in panels-ui.test.mjs. */
    const importLines = manifest.match(/^import \{ tokenSquares \} from '\.\/lib\/blocks\/tokenSquares\.ts';$/gm);
    assert.equal(importLines?.length, 1, 'exactly one import line for the token block');
    const body = manifest.replace(/^import[^\n]*\n/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(
      (body.match(/\btokenSquares\b/g) ?? []).length,
      1,
      'the manifest lists the token block exactly once'
    );
    assert.match(
      binding,
      /panelBlock\(\s*'token-squares',\s*LedgerBoard,\s*tokenUsagePanelId,\s*\(envelope\) => tokenSquaresProps\(envelope\)\s*\)/
    );
    assert.equal(tokenUsagePanelId, 'token-usage');
  });
});

describe('stat tiles', () => {
  it('formats each unit the way that figure reads', () => {
    assert.equal(formatStatValue(22_700_000_000, 'tokens'), '22.7B');
    assert.equal(formatStatValue(2_900_000_000, 'tokens'), '2.9B');
    assert.equal(formatStatValue(4, 'days'), '4 days');
    assert.equal(formatStatValue(1, 'days'), '1 day');
    assert.equal(formatStatValue(80_940, 'seconds'), '22h 29m');
    // The first shipped figure past a day. It must read the way the source
    // tool reports it, not as the hour count a reader has to divide.
    assert.equal(formatStatValue(150_900, 'seconds'), '1d 17h 55m');
    // A tally is grouped but never abbreviated: the tile exists to show the
    // figure, and "17.1K" is not the figure.
    assert.equal(formatStatValue(25, 'count'), '25');
    assert.equal(formatStatValue(17_069, 'count'), '17,069');
  });

  it('renders an unreported figure as a dash, never as a zero', () => {
    // Zero and "not reported" are different claims, and a tile that
    // conflates them invents data.
    assert.equal(formatStatValue(null, 'tokens'), '--');
    assert.equal(formatStatValue(null, 'days'), '--');
    assert.equal(formatStatValue(null, 'count'), '--');
    assert.equal(formatStatValue(0, 'tokens'), '0');
  });

  it('formats durations across every step', () => {
    assert.equal(formatDuration(0), '0s');
    assert.equal(formatDuration(59), '59s');
    assert.equal(formatDuration(60), '1m');
    assert.equal(formatDuration(3599), '59m');
    assert.equal(formatDuration(3600), '1h 0m');
    assert.equal(formatDuration(3660), '1h 1m');
    // The day boundary, from both sides. A figure one second short of a day
    // must stay in hours, and the first day must not swallow its remainder.
    assert.equal(formatDuration(86_399), '23h 59m');
    assert.equal(formatDuration(86_400), '1d 0h 0m');
    assert.equal(formatDuration(150_900), '1d 17h 55m');
    assert.equal(formatDuration(2 * 86_400 + 60), '2d 0h 1m');
  });
});

describe('extended payload admission', () => {
  const base = {
    sources: [
      {
        label: 'fixture',
        account: 'handle',
        windows: [],
        stats: [{ key: 'lifetime', label: 'Lifetime tokens', value: 10, unit: 'tokens', recorded: true }],
        series: { startDate: '2026-08-01', totals: [1, 2, 3] },
        insights: [{ label: 'Fast mode', pct: 4, recorded: true }]
      }
    ]
  };

  it('admits the full extended shape and preserves provenance', () => {
    const [source] = tokenUsageSources(structuredClone(base));
    assert.equal(source.account, 'handle');
    assert.equal(source.stats[0].recorded, true);
    assert.deepEqual(source.series.totals, [1, 2, 3]);
    assert.equal(source.insights[0].pct, 4);
  });

  it('still admits a payload written before the sections existed', () => {
    // The extension is additive inside token-usage/v1: an older payload must
    // render unchanged, with the new sections simply absent.
    const [source] = tokenUsageSources({ sources: [{ label: 'fixture', windows: [] }] });
    assert.equal(source.label, 'fixture');
    assert.equal(source.account, undefined);
    assert.equal(source.stats, undefined);
    assert.equal(source.series, undefined);
    assert.equal(source.insights, undefined);
  });

  it('refuses every malformed corner rather than rendering part of it', () => {
    const mutations = {
      'non-string account': (payload) => (payload.sources[0].account = 7),
      'stat without a key': (payload) => delete payload.sources[0].stats[0].key,
      'stat without a label': (payload) => (payload.sources[0].stats[0].label = ''),
      'stat in an unformattable unit': (payload) => (payload.sources[0].stats[0].unit = 'furlongs'),
      'negative stat value': (payload) => (payload.sources[0].stats[0].value = -1),
      'non-boolean provenance': (payload) => (payload.sources[0].stats[0].recorded = 'yes'),
      'stats that are not a list': (payload) => (payload.sources[0].stats = { key: 'x' }),
      'series with an instant instead of a date': (payload) =>
        (payload.sources[0].series.startDate = '2026-08-01T00:00:00Z'),
      'series with a negative total': (payload) => (payload.sources[0].series.totals = [1, -2]),
      'series without totals': (payload) => delete payload.sources[0].series.totals,
      'insight without a label': (payload) => (payload.sources[0].insights[0].label = ''),
      'insight above the scale': (payload) => (payload.sources[0].insights[0].pct = 'lots')
    };
    for (const [name, mutate] of Object.entries(mutations)) {
      const payload = structuredClone(base);
      mutate(payload);
      assert.deepEqual(tokenUsageSources(payload), [], `${name} must refuse the whole payload`);
    }
  });

  it('still admits a series that declares itself a recorded capture', () => {
    // The origin marks a snapshot-shipped series `recorded`, the same word it
    // marks a tile with. The flag is additive inside token-usage/v1, so
    // admission must carry the series through untouched rather than refusing
    // a field it was not written to expect.
    const payload = structuredClone(base);
    payload.sources[0].series.recorded = true;
    const [source] = tokenUsageSources(payload);
    assert.equal(source.series.startDate, '2026-08-01');
    assert.deepEqual(source.series.totals, [1, 2, 3]);
  });

  it('treats a null figure as real information, not a refusal', () => {
    const payload = structuredClone(base);
    payload.sources[0].stats[0].value = null;
    payload.sources[0].insights[0].pct = null;
    const [source] = tokenUsageSources(payload);
    assert.equal(source.stats[0].value, null);
    assert.equal(source.insights[0].pct, null);
  });
});

describe('provenanceIsMixed', () => {
  const figure = (recorded) => ({ key: 'k', label: 'l', value: 1, unit: 'tokens', recorded });

  it('says nothing to mark when every figure shares one provenance', () => {
    // Both uniform cases, and they are the two the page is actually in. With
    // live refresh off every figure is a recorded capture; with every source
    // fetched every figure is live. Neither needs a per-figure word, because
    // the word would appear on all of them and separate none of them.
    assert.equal(
      provenanceIsMixed({ label: 's', windows: [], stats: [figure(true), figure(true)] }),
      false
    );
    assert.equal(
      provenanceIsMixed({ label: 's', windows: [], stats: [figure(false), figure(false)] }),
      false
    );
  });

  it('marks by exception the moment a source carries both', () => {
    // What a successful refresh produces: live tiles overlaid onto the
    // recorded figures no usage API reports. Here the word earns its space.
    assert.equal(
      provenanceIsMixed({ label: 's', windows: [], stats: [figure(true), figure(false)] }),
      true
    );
  });

  it('reads stats and insights as one population', () => {
    // A source whose tiles all went live while its insights stayed recorded
    // is mixed, even though neither section is mixed on its own — they render
    // in the same block and are read against each other.
    assert.equal(
      provenanceIsMixed({
        label: 's',
        windows: [],
        stats: [figure(false)],
        insights: [{ label: 'i', pct: 1, recorded: true }]
      }),
      true
    );
  });

  it('treats an absent section and an absent flag as unrecorded', () => {
    assert.equal(provenanceIsMixed({ label: 's', windows: [] }), false);
    assert.equal(
      provenanceIsMixed({ label: 's', windows: [], stats: [{ key: 'k', label: 'l', value: 1, unit: 'tokens' }] }),
      false
    );
  });
});

describe('the board of squares: live surface', () => {
  it('keeps itself current through the block host instead of painting once at mount', () => {
    // The subscription moved to the ONE host every panel block shares
    // (issue 165): Block.svelte runs watchPanel and re-runs this adapter on
    // every envelope, so a panel cannot drift into a one-shot read of its
    // own. The component itself fetches nothing.
    for (const [name, source] of Object.entries({ component, commits })) {
      assert.doesNotMatch(source, /onMount/, `${name}: a one-shot mount read is the bug this panel had`);
      assert.doesNotMatch(
        source,
        /watchPanel|loadPanel|fetch\(/,
        `${name} reads the wire itself; the block host does that`
      );
    }
  });

  it("renders the owner's board: five squares, two to a phone row, an odd last one spanning", () => {
    /* THE TILE GRID BECAME THE BOARD (owner directive of 2026-09-03, issue
       287). The arrangement pin survives intact and moves to the stylesheet,
       which is where the ledger's page-level geometry is stated: the desktop
       row is one track per square and a phone gets two columns with an odd
       final square taking the width rather than leaving a hole — the same
       "final odd tile spans the row" rule the grid had, on the same reasoning.
       The figure is still the tested renderer's, through the adapter. */
    assert.match(sheet, /\.board-grid \{[^}]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/);
    assert.match(sheet, /\.board-grid \{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(sheet, /\.board-square:last-child:nth-child\(odd\) \{[^}]*grid-column:\s*1 \/ -1/);
    assert.match(component, /class="board-figure">\{square\.figure\}/);
    // The figure the square shows is the tested renderer's, via the adapter.
    const payload = {
      sources: [
        {
          label: 'fixture',
          windows: [],
          stats: [{ key: 'lifetime', label: 'Lifetime tokens', value: 22_700_000_000, unit: 'tokens', recorded: true }]
        }
      ]
    };
    const squares = tokenSquaresProps(envelopeFor(payload)).squares;
    const source = squares.find((square) => square.key === 'source-fixture');
    assert.equal(source.figure, formatStatValue(22_700_000_000, 'tokens'));
    assert.equal(source.label, 'fixture');
    // The whole-board total is the same figure summed across sources, through
    // the same renderer — never a second formatter.
    assert.equal(squares[0].figure, formatTokenCount(22_700_000_000));
    assert.equal(squares[0].label, 'Tokens tracked');
  });

  it('marks provenance by exception, never once per figure', () => {
    /* The marker is still decided in the adapter, beside provenanceIsMixed
       itself, and it is still gated on the source's provenance being MIXED.
       What changed with the owner's directive of 2026-09-03 (issue 287) is
       WHERE it is decided FROM: the tiles and the insight rows became the
       board's squares and bars, so the mark travels on LedgerBar.marked. The
       ungated forms this replaces are still named exactly, in both components,
       because either one returning is the regression. */
    for (const [name, source] of Object.entries({ component, commits })) {
      assert.doesNotMatch(source, /\{#if stat\.recorded\}|\{#if tile\.recorded\}/, name);
      assert.doesNotMatch(source, /\{#if insight\.recorded\}/, name);
    }
    // EXECUTED both ways: a uniform source marks nothing, a mixed source
    // marks exactly the recorded figures.
    const figure = (key, recorded) => ({ key, label: key, value: 1, unit: 'tokens', recorded });
    const barsOf = (props) =>
      props.squares.find((square) => square.key === 'models')?.bars ?? [];
    const uniform = tokenSquaresProps(
      envelopeFor({
        sources: [
          {
            label: 's',
            windows: [],
            stats: [figure('a', true), figure('b', true)],
            insights: [{ label: 'i', pct: 4, recorded: true }]
          }
        ]
      })
    );
    assert.deepEqual(barsOf(uniform).map((bar) => bar.marked), [false]);
    const mixed = tokenSquaresProps(
      envelopeFor({
        sources: [
          {
            label: 's',
            windows: [],
            stats: [figure('a', true), figure('b', false)],
            insights: [{ label: 'i', pct: 4, recorded: true }]
          }
        ]
      })
    );
    assert.deepEqual(barsOf(mixed).map((bar) => bar.marked), [true]);
    // An unreported insight draws NO fill and reads as the explicit dash.
    // Null rather than 0 is the whole point (owner directive, 2026-08-28): a
    // zero-width bar is pixel-identical to a measured 0%, so a row whose
    // denominator never existed used to draw the same picture as one that
    // genuinely contributed nothing. The component honours it structurally:
    // a null fill renders no fill element at all.
    assert.match(component, /\{#if bar\.fillPct !== null\}/);
    const dashed = tokenSquaresProps(
      envelopeFor({ sources: [{ label: 's', windows: [], insights: [{ label: 'i', pct: null }] }] })
    );
    assert.equal(barsOf(dashed)[0].fillPct, null);
    assert.equal(barsOf(dashed)[0].reading, unknownFigure);
    assert.equal(unknownFigure, '--');
    // ...and a MEASURED zero still draws its (empty) bar, because 0% of a real
    // window is a measurement and must not be erased along with the unknowns.
    const measured = tokenSquaresProps(
      envelopeFor({ sources: [{ label: 's', windows: [], insights: [{ label: 'i', pct: 0 }] }] })
    );
    assert.equal(barsOf(measured)[0].fillPct, 0);
    assert.equal(barsOf(measured)[0].reading, '0%');
    // A figure the payload does not carry is the dash on the square's face
    // too, never a zero.
    const nothing = tokenSquares([{ label: 's', windows: [] }]);
    assert.equal(nothing.find((square) => square.key === 'source-s').figure, unknownFigure);
    assert.equal(nothing.find((square) => square.key === 'sessions').figure, unknownFigure);
  });

  it('draws ONE graph client-side over the whole delivered series', () => {
    /* RE-AIMED TWICE, and never relaxed. The owner's 2026-08-28 reversal took
       the display menu away ("remove this entire menu. it doesnt look good and
       it doesn't provide any value"); the directive of 2026-09-03 (issue 287)
       moved the graph itself out of this panel and into the commits section,
       where ONE ContributionGrid cycles between the contribution calendar and
       each token source's daily series. The claim is the same shape it has
       always been — one delivered payload, read client-side, no extra bytes,
       and no vocabulary offered to the reader — so every absence below now
       sweeps BOTH components, because a menu could otherwise come back through
       whichever of the two this pin had stopped watching. */
    assert.match(helper, /seriesCells|totals/);
    // ONE grid instance, swapped by props rather than three stacked copies:
    // three would be three scroll positions, three keyboard cursors and three
    // detail cards for one picture.
    assert.equal((commits.match(/<ContributionGrid/g) ?? []).length, 1);
    for (const [name, source] of Object.entries({ component, commits })) {
      // The source's own totals, never a category slice: the category lens
      // went with the menu, so there is no branch left that could read
      // anything else.
      assert.doesNotMatch(source, /category \? category\.totals/, name);
      assert.doesNotMatch(source, /viewColumns/, name);
      assert.doesNotMatch(source, /rangeColumns/, name);
      // No vocabulary is offered to the reader any more, in either question.
      assert.doesNotMatch(source, /seriesViews|seriesRanges|defaultSeriesRange/, name);
      assert.doesNotMatch(source, /role="radiogroup"/, name);
      assert.doesNotMatch(source, /\$state\([^)]*\)[^;]*(?:view|range|lens)/i, name);
      assert.doesNotMatch(source, /usage-controls|usage-activity-head|UsageFilterMenu/, name);
    }
    // The deleted components are genuinely gone from the tree rather than
    // merely unreferenced here.
    for (const gone of ['UsageFilterMenu', 'UsageTracker']) {
      assert.equal(
        existsSync(new URL(`../src/lib/components/${gone}.svelte`, import.meta.url)),
        false,
        `${gone}.svelte outlived every reference to it`
      );
    }
  });

  it('renders a token calendar only where there is a series to draw', () => {
    /* INVERTED by the owner's ruling of 2026-08-24 and MOVED by the directive
       of 2026-09-03 (issue 287). The rule is unchanged: a source that
       publishes no daily record gets no graph-shaped box held open for
       something that can never arrive, and it keeps every figure it genuinely
       reports. What changed is that the graph is now one of the commits
       section's cycling sets, so the same decision is made per SET.

       And it is made by OFFERING NO SET AT ALL, which an earlier draft of
       this pin got wrong: it accepted a set with no columns and an honest
       caption, which is still a pressable segment over a grid drawing 371
       placeholder cells — measured on chromium against the real origin with
       the source's series removed. The note's wording was better than "series
       pending"; the arrangement was the same one the ruling threw out. A
       reserve is a promise that something is coming, and for a source that
       has already answered and keeps no daily record, nothing is. */
    assert.match(commits, /import ContributionGrid from '\.\/ContributionGrid\.svelte'/);
    assert.match(commits, /<ContributionGrid/);
    assert.doesNotMatch(commits, /series pending/, 'the retired "pending" claim is back');
    assert.doesNotMatch(commits, /live refresh is off/);
    // The gate is the set's own emptiness, and the grid is inside it.
    assert.match(commits, /\{#if sets\.length > 0 && active\}/);
    // The adapter half, executed, and BOTH directions, because half of this
    // is not a guard: an adapter that offered no set to anybody would satisfy
    // the first half perfectly and draw nothing at all.
    const seriesless = commitLogProps(tokenOnly({ sources: [{ label: 's', windows: [] }] }));
    assert.equal(
      seriesless.sets.find((set) => set.key === 's'),
      undefined,
      'a source with no daily record was offered a segment over an empty grid'
    );
    const empty = commitLogProps(
      tokenOnly({ sources: [{ label: 's', windows: [], series: { startDate: '2026-08-01', totals: [] } }] })
    );
    assert.equal(
      empty.sets.find((set) => set.key === 's'),
      undefined,
      'a series carrying no days is the same permanent hole as no series at all'
    );
    /* The source is not ERASED, only its calendar: every figure it reports
       still reaches the page through the board's own square, which is the
       half of the ruling that keeps this from being a way to hide a source. */
    assert.ok(
      tokenSquaresProps(
        {
          schema: 'panel/v1',
          id: 'token-usage',
          kind: 'token-usage/v2',
          title: 'Token usage',
          status: 'ok',
          data: { sources: [{ label: 's', windows: [] }] }
        },
        new Date('2026-08-27T12:00:00Z')
      ).squares.some((square) => square.label.toLowerCase().includes('s')),
      'a source with no series lost its square as well as its calendar'
    );
    const drawn = commitLogProps(
      tokenOnly({ sources: [{ label: 's', windows: [], series: { startDate: '2026-08-01', totals: [1, 2, 3] } }] })
    );
    const set = drawn.sets.find((set) => set.key === 's');
    assert.equal(set.noun, 'token');
    assert.equal(set.stripLabel, 's token calendar: daily totals, newest last');
    assert.ok(set.columns.length > 0, 'a real series draws its window');
    /* THE READING IS BUILT FROM THE DAYS THE PAYLOAD ACTUALLY CARRIES, never
       from a sentence an adapter guessed at (issue 158's finding, carried
       through the move): the sum, the day count, the peak and the last day
       covered are all measured from the same totals the grid draws. */
    assert.equal(set.caption, `${formatMagnitude(6)} tokens over 3 days · peak ${formatMagnitude(3)} · data through 2026-08-03`);
    // A windowless, statless source still states its honest empty face on its
    // own square; a source with figures does not.
    const board = tokenSquaresProps(envelopeFor({ sources: [{ label: 's', windows: [] }] }));
    assert.equal(board.squares.find((square) => square.key === 'source-s').back.note, tokenUsageSourceEmptyNote);
    const withWindows = tokenSquaresProps(envelopeFor(shippedPayload));
    assert.equal(withWindows.emptyNote, 'No usage data available.');
  });

  it('lays every source onto the ONE window the section derives, never one each', () => {
    /* Issue 268's rule, carried into the cycler (owner directive of
       2026-09-03, issue 287): several series in one section have to be read
       against each other, so every set is laid onto the SAME calendar — the
       week that ends the contribution window ends every window. A source that
       stopped capturing early would otherwise draw a window silently offset
       from the one above it. */
    const props = commitLogProps(
      tokenOnly({
        sources: [
          { label: 'a', windows: [], series: { startDate: '2026-08-01', totals: [1, 2, 3] } },
          { label: 'b', windows: [], series: { startDate: '2026-06-01', totals: [4] } }
        ]
      }),
      new Date('2026-09-03T10:00:00Z')
    );
    const lastDayOf = (set) => set.columns.at(-1).at(-1).date;
    const [, first, second] = props.sets;
    // Both sources end on the SAME calendar week — the one holding the
    // section's anchor day — however far apart their own captures started.
    assert.equal(lastDayOf(first), '2026-09-05');
    assert.equal(lastDayOf(second), lastDayOf(first));
    assert.equal(first.columns.length, second.columns.length);
    assert.equal(first.columns.length, pendingWeeks);
  });
});

/* The per-category breakdown (issue #142): admission holds the categories
 * section to the origin's exact structural rules, the lens helpers read one
 * data set two ways, and the component pins keep identity paired with text
 * and every payload string inert. */
describe('category breakdown admission', () => {
  const withCategories = (categories) => ({
    sources: [
      {
        label: 'alpha',
        windows: [],
        series: { startDate: '2026-08-10', totals: [10, 20, 30], categories }
      }
    ]
  });

  it('admits a well-formed partition and preserves the served order', () => {
    const admitted = tokenUsageSources(
      withCategories([
        { key: 'input', totals: [1, 2, 3] },
        { key: 'output', totals: [9, 18, 27] }
      ])
    );
    assert.equal(admitted.length, 1);
    assert.deepEqual(
      admitted[0].series.categories.map((category) => category.key),
      ['input', 'output']
    );
    assert.deepEqual(admitted[0].series.categories[1].totals, [9, 18, 27]);
  });

  it('admits a series without categories exactly as before', () => {
    const admitted = tokenUsageSources(withCategories(undefined));
    assert.equal(admitted.length, 1);
    assert.equal(admitted[0].series.categories, undefined);
  });

  it('refuses the whole payload on any malformed corner', () => {
    for (const [name, categories] of Object.entries({
      'not an array': { input: [1, 2, 3] },
      'markup in a key': [{ key: '<img src=x onerror=alert(1)>', totals: [1, 2, 3] }],
      'uppercase key': [{ key: 'Input', totals: [1, 2, 3] }],
      'path in a key': [{ key: 'a/b', totals: [1, 2, 3] }],
      'empty key': [{ key: '', totals: [1, 2, 3] }],
      'duplicate keys': [
        { key: 'input', totals: [1, 2, 3] },
        { key: 'input', totals: [1, 2, 3] }
      ],
      'length mismatch': [{ key: 'input', totals: [1, 2] }],
      'negative count': [{ key: 'input', totals: [1, -2, 3] }],
      'non-numeric count': [{ key: 'input', totals: [1, 'two', 3] }]
    })) {
      assert.deepEqual(tokenUsageSources(withCategories(categories)), [], name);
    }
  });

  /* 2026-08-24 security review, finding 6. Admission here was SHAPE-only: it
     accepted any label-shaped key, enforced no count bound, and never
     rechecked that the categories partition the day. Shape admits far more
     than the vocabulary does, and the renderer humanizes whatever key it is
     given, so a label-shaped private identifier would have become public
     copy. Each case below is refused ONLY by the rule it names. */
  it('refuses a label-shaped key that is outside the closed vocabulary', () => {
    for (const key of [
      'private-feature',
      'internal-project-name',
      'audio',
      'a-client-name',
      'x'
    ]) {
      /* Deliberately a PERFECT partition — 10, 20, 30 against the series'
         own totals — so nothing but closed membership can refuse it. */
      assert.deepEqual(
        tokenUsageSources(withCategories([{ key, totals: [10, 20, 30] }])),
        [],
        key
      );
    }
  });

  it('admits every member of the closed vocabulary', () => {
    /* Non-vacuity for the membership rule: the check is a vocabulary, not a
       refusal of everything. Five categories, partitioning exactly. */
    const admitted = tokenUsageSources(
      withCategories([
        { key: 'input', totals: [2, 4, 6] },
        { key: 'output', totals: [2, 4, 6] },
        { key: 'cache-read', totals: [2, 4, 6] },
        { key: 'cache-write', totals: [2, 4, 6] },
        { key: 'reasoning', totals: [2, 4, 6] }
      ])
    );
    assert.equal(admitted.length, 1);
    assert.equal(admitted[0].series.categories.length, 5);
  });

  it('refuses a breakdown that does not partition the day', () => {
    for (const [name, categories] of Object.entries({
      'sums under the total': [
        { key: 'input', totals: [1, 2, 3] },
        { key: 'output', totals: [8, 17, 26] }
      ],
      'sums over the total': [
        { key: 'input', totals: [10, 20, 30] },
        { key: 'output', totals: [1, 1, 1] }
      ],
      'wrong on one day only': [
        { key: 'input', totals: [1, 2, 3] },
        { key: 'output', totals: [9, 18, 26] }
      ],
      'a lone category short of the total': [{ key: 'input', totals: [1, 2, 3] }]
    })) {
      assert.deepEqual(tokenUsageSources(withCategories(categories)), [], name);
    }
  });

  it('refuses more categories than the boundary bound allows', () => {
    const many = Array.from({ length: 9 }, () => ({ key: 'input', totals: [10, 20, 30] }));
    assert.deepEqual(tokenUsageSources(withCategories(many)), []);
  });

  it('refuses the reviewer probe: a private key with a broken partition', () => {
    /* Verbatim from the 2026-08-24 review: totals [10] against a
       {key:'private-feature', totals:[9]} breakdown was ADMITTED, and the
       renderer humanized that key into "private feature" on a public page. */
    assert.deepEqual(
      tokenUsageSources({
        sources: [
          {
            label: 'alpha',
            windows: [],
            series: {
              startDate: '2026-08-10',
              totals: [10],
              categories: [{ key: 'private-feature', totals: [9] }]
            }
          }
        ]
      }),
      []
    );
  });
});

describe('category lens helpers', () => {
  const series = {
    startDate: '2026-08-10',
    totals: [10, 20, 30],
    categories: [
      { key: 'input', totals: [1, 2, 3] },
      { key: 'cache-read', totals: [9, 18, 27] }
    ]
  };

  it('renders keys as display copy without inventing words', () => {
    assert.equal(categoryLabel('cache-read'), 'cache read');
    assert.equal(categoryLabel('input'), 'input');
  });

  /* Lens RESOLUTION used to be a helper here (`lensValues`), and its unit test
     sat in this spot. Both are gone: main's block architecture moved lens
     resolution into the component, and the owner's 2026-08-28 reversal then
     removed the lens itself along with the whole display menu. What the
     categories are FOR did not go with it — the owner's directive of
     2026-09-03 (issue 287) put the per-day breakdown on the back of each
     source's square, where it is delivered data a reader reads rather than a
     question they answer. So the vocabulary the adapter delivers is pinned
     here against that surface, and the four behaviours the retired resolver's
     tests described are asserted against the path that ships. */
  it('delivers the category breakdown the square turns over to, and nothing to resolve it with', () => {
    const backOf = (payload) =>
      tokenSquaresProps(envelopeFor(payload)).squares.find((square) => square.key === 'source-alpha')
        .back;
    const back = backOf({ sources: [{ label: 'alpha', windows: [], series }] });
    assert.deepEqual(
      back.facts.map((fact) => fact.key),
      ['input', 'cache-read'],
      'the served order is the rendered order'
    );
    /* A named category reads its OWN dailies, summed from the served row —
       the value the retired helper's second assertion measured. cache-read is
       9+18+27 of a 60-token series, input is 1+2+3. */
    const factFor = (key) => back.facts.find((fact) => fact.key === key);
    assert.equal(factFor('cache-read').value, `${formatTokenCount(54)} · ${formatShare(90)}`);
    assert.equal(factFor('input').value, `${formatTokenCount(6)} · ${formatShare(10)}`);
    /* A category this source does not report has no entry at all, which is
       what keeps the face a statement about real data rather than a table of
       zeroes for classes nobody used. */
    assert.equal(factFor('reasoning'), undefined);
    /* And a series with no breakdown at all turns over to the source's own
       remaining stats instead — the second half of the same fallback, and the
       reason a payload that reports only tiles still has something true
       behind its square. */
    const plain = backOf({
      sources: [
        {
          label: 'alpha',
          windows: [],
          series: { startDate: '2026-08-10', totals: [5] },
          stats: [{ key: 'chats', label: 'Chats', value: 4, unit: 'count' }]
        }
      ]
    });
    assert.deepEqual(
      plain.facts.map((fact) => [fact.key, fact.value, fact.slot]),
      [['chats', '4', undefined]],
      'a source with no breakdown lists its own stats, and a stat owns no palette slot'
    );
    /* Neither the resolver nor its sentinel came back, and the adapter reads
       the served category directly rather than through one. */
    assert.doesNotMatch(helper, /lensValues/, 'the dead lens resolver is back');
    assert.doesNotMatch(helper, /totalLens/, 'the adapter grew back a second copy of the sentinel');
    assert.doesNotMatch(helper, /function usageActivitySummary/, 'the adapter grew back a window-blind sentence');
    /* A category still carries no finished SENTENCE: the caption under the
       graph is built by lib/commits.ts from the days actually drawn, so a
       breakdown and a window cannot describe two different pictures. */
    assert.doesNotMatch(helper, /summary:/, 'the adapter grew back a sentence about a window it cannot see');
  });

  it('summarizes shares from the same integers the grid draws', () => {
    const shares = categoryShares(series);
    assert.deepEqual(
      shares.map((share) => share.key),
      ['input', 'cache-read']
    );
    assert.equal(shares[0].total, 6);
    assert.equal(shares[1].total, 54);
    assert.ok(Math.abs(shares[0].pct - 10) < 1e-9);
    assert.ok(Math.abs(shares[1].pct - 90) < 1e-9);
  });

  it('reports an UNKNOWN share for an empty window, never a zero one', () => {
    // Re-aimed by the owner's 2026-08-28 ruling: "if its either 0 or unknown I
    // rather it be Unknown". A share of nothing is not zero percent — the
    // denominator never existed — and 0 was a claim the data could not
    // support, rendered with a bar under it.
    const empty = {
      startDate: '2026-08-10',
      totals: [0],
      categories: [{ key: 'input', totals: [0] }]
    };
    assert.deepEqual(categoryShares(empty), [{ key: 'input', total: 0, pct: null }]);
    assert.deepEqual(categoryShares({ startDate: '2026-08-10', totals: [1] }), []);
    // A category that genuinely contributed nothing to a REAL window is 0%,
    // and stays 0%: that one is a measurement.
    assert.deepEqual(
      categoryShares({
        startDate: '2026-08-10',
        totals: [10],
        categories: [
          { key: 'input', totals: [10] },
          { key: 'output', totals: [0] }
        ]
      }),
      [
        { key: 'input', total: 10, pct: 100 },
        { key: 'output', total: 0, pct: 0 }
      ]
    );
    // The composition strip renders the unknown as the shared dash rather
    // than as "0%".
    assert.equal(formatShare(null), '--');
    assert.equal(formatShare(0), '0%');
  });

  it('binds color slots to the entity, never the payload position', () => {
    assert.equal(categorySlot('input'), 1);
    assert.equal(categorySlot('output'), 2);
    assert.equal(categorySlot('cache-read'), 3);
    assert.equal(categorySlot('cache-write'), 4);
    assert.equal(categorySlot('reasoning'), 5);
  });

  it('keeps the neutral slot as a total function, and unreachable', () => {
    /* Two halves of one promise, asserted together because the 2026-08-24
       review found them contradicting each other: the suite specified a
       neutral slot for an unknown key while the component pins claimed a
       hostile key could not reach rendering, and shape-only admission meant
       it could (finding 6).

       categorySlot stays TOTAL — it has a defined answer for any string, so
       no render can throw or steal a known category's hue — and admission
       now guarantees it is never asked, because a key outside the closed
       vocabulary refuses the whole payload. The fallback is defense, not a
       supported vocabulary slot. */
    assert.equal(categorySlot('audio'), 0);
    assert.deepEqual(
      tokenUsageSources({
        sources: [
          {
            label: 'alpha',
            windows: [],
            series: {
              startDate: '2026-08-10',
              totals: [10, 20, 30],
              categories: [{ key: 'audio', totals: [10, 20, 30] }]
            }
          }
        ]
      }),
      []
    );
  });
});

describe('the model breakdown (token-usage/v2)', () => {
  const withModels = (models, overrides = {}) => ({
    sources: [
      {
        label: 'alpha',
        windows: [],
        series: { startDate: '2026-08-10', totals: [10, 20, 30], models, ...overrides }
      }
    ]
  });

  const modelsOf = (payload) => tokenUsageSources(payload)[0]?.series?.models;

  it('admits an aligned partition and preserves the served order', () => {
    const models = modelsOf(
      withModels([
        { key: 'opus-5', totals: [6, 12, 18] },
        { key: 'sonnet-5', totals: [4, 8, 12] }
      ])
    );
    assert.deepEqual(
      models.map((model) => model.key),
      ['opus-5', 'sonnet-5']
    );
    // An aligned breakdown declares no window, which is the ONE spelling of
    // aligned: a row carrying the series' own start date is refused below.
    assert.equal(models[0].startDate, undefined);
  });

  it('admits a declared trailing window and carries it on every row', () => {
    const models = modelsOf(
      withModels([
        { key: 'opus-5', startDate: '2026-08-11', totals: [12, 18] },
        { key: 'fable-5', startDate: '2026-08-11', totals: [8, 12] }
      ])
    );
    assert.deepEqual(
      models.map((model) => [model.key, model.startDate, model.totals]),
      [
        ['opus-5', '2026-08-11', [12, 18]],
        ['fable-5', '2026-08-11', [8, 12]]
      ]
    );
  });

  it('holds the model window to the 92-day budget the Go boundary enforces', () => {
    // The same sixth rule the origin applies (maxModelDays in
    // internal/panels/types.go), mirrored per the 2026-08-27 adversarial
    // review of PR #230 (finding 4). A 93-day series: the models section
    // may cover its trailing 92 days, not all 93 — while the categories
    // breakdown answers to the series bound alone, exactly as in Go.
    const days = 93;
    const totals = Array.from({ length: days }, () => 2);
    const series = (extra) => ({
      sources: [
        {
          label: 'alpha',
          windows: [],
          series: { startDate: '2026-01-01', totals, ...extra }
        }
      ]
    });
    const windowed = Array.from({ length: days - 1 }, () => 2);
    assert.deepEqual(
      tokenUsageSources(
        series({ models: [{ key: 'opus-5', startDate: '2026-01-02', totals: windowed }] })
      )[0]?.series?.models?.[0]?.totals?.length,
      92
    );
    assert.deepEqual(
      tokenUsageSources(series({ models: [{ key: 'opus-5', totals }] })),
      []
    );
    assert.deepEqual(
      tokenUsageSources(
        series({ categories: [{ key: 'input', totals }] })
      )[0]?.series?.categories?.[0]?.totals?.length,
      93
    );
  });

  it('refuses every way a window can be a claim the series cannot back', () => {
    // Restating the series start is a SECOND spelling of aligned, and two
    // spellings of one state is how the same document renders two ways.
    assert.deepEqual(
      modelsOf(withModels([{ key: 'opus-5', startDate: '2026-08-10', totals: [10, 20, 30] }])),
      undefined
    );
    // Before the series: days the series has no totals for.
    assert.deepEqual(
      modelsOf(withModels([{ key: 'opus-5', startDate: '2026-08-09', totals: [0, 10, 20, 30] }])),
      undefined
    );
    // Past its end.
    assert.deepEqual(
      modelsOf(withModels([{ key: 'opus-5', startDate: '2026-08-13', totals: [] }])),
      undefined
    );
    // Rows that disagree about which window they cover are several
    // breakdowns wearing one section.
    assert.deepEqual(
      modelsOf(
        withModels([
          { key: 'opus-5', startDate: '2026-08-11', totals: [20, 30] },
          { key: 'fable-5', startDate: '2026-08-12', totals: [30] }
        ])
      ),
      undefined
    );
    // And a partly-declared breakdown is the same fault by omission.
    assert.deepEqual(
      modelsOf(
        withModels([
          { key: 'opus-5', startDate: '2026-08-11', totals: [20, 30] },
          { key: 'fable-5', totals: [0, 0, 0] }
        ])
      ),
      undefined
    );
    // A window whose date is not a real calendar day at all — the same
    // February-30th class lib/periods.ts refuses, reached through the one
    // implementation both share.
    assert.deepEqual(
      modelsOf(withModels([{ key: 'opus-5', startDate: '2026-02-30', totals: [20, 30] }])),
      undefined
    );
  });

  it('refuses a partition that disagrees with the days it claims', () => {
    assert.deepEqual(
      modelsOf(withModels([{ key: 'opus-5', startDate: '2026-08-11', totals: [20, 31] }])),
      undefined
    );
    assert.deepEqual(
      modelsOf(withModels([{ key: 'opus-5', startDate: '2026-08-11', totals: [20] }])),
      undefined
    );
    assert.deepEqual(modelsOf(withModels([{ key: 'opus-5', totals: [10, 20, 29] }])), undefined);
  });

  it('refuses a key outside the closed model vocabulary, in either direction', () => {
    // The vocabulary is closed against real-looking strings...
    assert.deepEqual(modelsOf(withModels([{ key: 'opus-9', totals: [10, 20, 30] }])), undefined);
    // ...and against the OTHER vocabulary. A category name is not a model
    // name, and admitting one here would let a document claim a partition of
    // a thing it never measured.
    assert.deepEqual(modelsOf(withModels([{ key: 'input', totals: [10, 20, 30] }])), undefined);
    // The same closure in reverse, through the shared admission.
    assert.deepEqual(
      tokenUsageSources({
        sources: [
          {
            label: 'alpha',
            windows: [],
            series: {
              startDate: '2026-08-10',
              totals: [10, 20, 30],
              categories: [{ key: 'opus-5', totals: [10, 20, 30] }]
            }
          }
        ]
      }),
      []
    );
  });

  it('refuses a duplicate row and more rows than the bound allows', () => {
    assert.deepEqual(
      modelsOf(
        withModels([
          { key: 'opus-5', totals: [5, 10, 15] },
          { key: 'opus-5', totals: [5, 10, 15] }
        ])
      ),
      undefined
    );
    assert.deepEqual(
      modelsOf(Array.from({ length: 9 }, () => ({ key: 'opus-5', totals: [10, 20, 30] }))),
      undefined
    );
  });

  it('binds model color slots to the entity, and keeps the fallback unreachable', () => {
    assert.equal(modelSlot('other'), 1);
    assert.equal(modelSlot('fable-5'), 2);
    assert.equal(modelSlot('opus-5'), 3);
    assert.equal(modelSlot('sonnet-5'), 4);
    assert.equal(modelSlot('opus-4-8'), 5);
    assert.equal(modelSlot('opus-9'), 0);
  });

  it('writes a model name rather than humanizing its key', () => {
    // The reason the labels are a table and the categories are a
    // transformation: `opus-4-8` humanizes to "opus 4 8", which is not the
    // product's name. Keys stay machine-shaped on the wire because the
    // producer's emission guard admits nothing else.
    assert.equal(modelLabel('opus-4-8'), 'Opus 4.8');
    assert.equal(modelLabel('fable-5'), 'Fable 5');
    assert.equal(modelLabel('other'), 'Other');
    // Every member of the vocabulary has a written form. The fallback returns
    // the key, so a member missing from the label table would render a
    // machine identifier in public copy — this is the assertion that makes
    // the fallback defense rather than a supported spelling.
    for (const key of ['other', 'fable-5', 'opus-5', 'sonnet-5', 'opus-4-8']) {
      assert.notEqual(modelLabel(key), key, `${key} has no written name`);
    }
    assert.equal(modelLabel('opus-9'), 'opus-9');
  });

  it('takes shares over the window the models cover, never the whole series', () => {
    // The distinction that makes the percentages mean anything: the window
    // holds 50 of the series' 60 tokens, and shares over the series would sum
    // to 83% while describing nothing anybody asked about.
    const series = {
      startDate: '2026-08-10',
      totals: [10, 20, 30],
      models: [
        { key: 'opus-5', startDate: '2026-08-11', totals: [20, 20] },
        { key: 'fable-5', startDate: '2026-08-11', totals: [0, 10] }
      ]
    };
    const shares = modelShares(series);
    assert.deepEqual(
      shares.map((share) => [share.key, share.total]),
      [
        ['opus-5', 40],
        ['fable-5', 10]
      ]
    );
    assert.ok(Math.abs(shares[0].pct - 80) < 1e-9);
    assert.ok(Math.abs(shares[1].pct - 20) < 1e-9);
    assert.ok(Math.abs(shares[0].pct + shares[1].pct - 100) < 1e-9);
  });

  it('reports an UNKNOWN share for an empty window, never a zero one', () => {
    // The same ruling as the category twin above, and this is the one the
    // owner actually SAW: an empty model window rendered five insight rows all
    // reading "0%", each carrying a provenance mark, implying five measured
    // proportions where nothing had been measured at all.
    assert.deepEqual(
      modelShares({ startDate: '2026-08-10', totals: [0], models: [{ key: 'other', totals: [0] }] }),
      [{ key: 'other', total: 0, pct: null }]
    );
    assert.deepEqual(modelShares({ startDate: '2026-08-10', totals: [1] }), []);
    // A model that contributed nothing to a real window is still 0%.
    assert.deepEqual(
      modelShares({
        startDate: '2026-08-10',
        totals: [10],
        models: [
          { key: 'opus-5', totals: [10] },
          { key: 'other', totals: [0] }
        ]
      }),
      [
        { key: 'opus-5', total: 10, pct: 100 },
        { key: 'other', total: 0, pct: 0 }
      ]
    );
  });
});

describe('activity insights provenance', () => {
  const sourceWith = (extra) => ({
    label: 'alpha',
    windows: [],
    series: {
      startDate: '2026-08-10',
      totals: [10, 20, 30],
      recorded: true,
      models: [
        { key: 'opus-5', startDate: '2026-08-11', totals: [20, 20] },
        { key: 'fable-5', startDate: '2026-08-11', totals: [0, 10] }
      ]
    },
    ...extra
  });

  /* The insight rows are the model split, and since the owner's directive of
     2026-09-03 (issue 287) they are the bars on the board's "Models · <source>"
     square: the first source's shares on the front, the second's behind it.
     Every property these pins protected is a property of the ROWS, so they
     read the bars the adapter builds rather than a region that no longer
     exists. */
  const modelBars = (payload, face = 'front') => {
    const square = tokenSquaresProps(envelopeFor(payload)).squares.find(
      (candidate) => candidate.key === 'models'
    );
    return (face === 'front' ? square?.bars : square?.back.bars) ?? [];
  };

  it('reads the rows from the live series when the payload carries models', () => {
    const bars = modelBars({
      sources: [sourceWith({ insights: [{ label: 'Frozen', pct: 99, recorded: true }] })]
    });
    assert.deepEqual(
      bars.map((bar) => [bar.label, bar.reading]),
      [
        ['Opus 5', '80%'],
        ['Fable 5', '20%']
      ]
    );
    // The frozen release-time set is not merged in beside the measured one:
    // two answers to one question is worse than the older answer alone.
    assert.equal(bars.find((bar) => bar.label === 'Frozen'), undefined);
    /* THE RANGE IS STILL MEASURED OVER THE WINDOW THE MODELS COVER, never the
       whole series — the property the retired range note ANNOUNCED, and the
       one that makes the percentages true. It is asserted here on the figures
       themselves (80/20 over the two declared days, not over the three-day
       series), and independently against modelShares in "takes shares over the
       window the models cover, never the whole series". */
    assert.deepEqual(
      modelShares(sourceWith({}).series).map((share) => [share.key, share.pct]),
      [
        ['opus-5', 80],
        ['fable-5', 20]
      ]
    );
  });

  it('falls back to the shipped insights when no model partition exists', () => {
    const bars = modelBars({
      sources: [
        {
          label: 'alpha',
          windows: [],
          series: { startDate: '2026-08-10', totals: [10] },
          insights: [{ label: 'Frozen', pct: 99, recorded: true }]
        }
      ]
    });
    assert.deepEqual(bars.map((bar) => bar.label), ['Frozen']);
    assert.equal(bars[0].reading, formatShare(99));
  });

  it('weighs the DERIVED rows when it decides whether provenance is mixed', () => {
    /* The rows must be resolved BEFORE the marks are, so a live-derived set is
       weighed exactly as a served one. Here the one stat is live and the
       derived rows inherit the series' recorded provenance, so the source is
       mixed and the recorded figures carry the mark.

       This is a property of the ADAPTER, unchanged by the owner's directive of
       2026-09-03 (issue 287): a figure captured out of band says so, and
       whether it needs to say so is decided against the whole population of
       figures a surface shows — derived rows included. */
    const bars = modelBars({
      sources: [sourceWith({ stats: [{ key: 'lifetime', label: 'Lifetime', value: 7, unit: 'tokens' }] })]
    });
    assert.deepEqual(bars.map((bar) => bar.marked), [true, true]);
  });

  it('marks nothing when the derived rows and the tiles share one provenance', () => {
    const bars = modelBars({
      sources: [
        sourceWith({
          stats: [{ key: 'lifetime', label: 'Lifetime', value: 7, unit: 'tokens', recorded: true }]
        })
      ]
    });
    assert.deepEqual(bars.map((bar) => bar.marked), [false, false]);
  });

  it("carries the second source's split on the back of the same square", () => {
    /* The owner's drawing (2026-09-03, issue 287) puts one source's model
       split on the front and the next source's behind it, so the two are read
       by turning one square rather than by hunting two. A payload with a
       single source turns over to its own honest note instead of an empty
       chart. */
    const both = {
      sources: [
        sourceWith({}),
        {
          label: 'beta',
          windows: [],
          series: { startDate: '2026-08-10', totals: [4], models: [{ key: 'sonnet-5', totals: [4] }] }
        }
      ]
    };
    assert.deepEqual(modelBars(both, 'back').map((bar) => bar.label), ['Sonnet 5']);
    const alone = { sources: [sourceWith({})] };
    assert.deepEqual(modelBars(alone, 'back'), []);
    const square = tokenSquaresProps(envelopeFor(alone)).squares.find(
      (candidate) => candidate.key === 'models'
    );
    assert.equal(square.back.note, tokenUsageSourceEmptyNote);
  });

  it('never encodes a share by colour alone', () => {
    /* The dataviz floor, carried onto the bars: every one of them prints its
       own label and its own reading beside the fill, and the fill is the
       redundant channel. */
    assert.match(component, /class="board-bar-label">\{bar\.label\}/);
    assert.match(component, /class="board-reading">\{bar\.reading\}/);
  });
});

describe('category breakdown surface', () => {
  it("gates the breakdown on the source having one", () => {
    /* RE-AIMED TWICE. The owner's 2026-08-28 reversal gated TWO things on a
       source reporting categories — the lens in the display menu, and the
       composition strip — and took the lens away. The directive of 2026-09-03
       (issue 287) moved what remained onto the back of the source's own
       square, which is the same distinction the owner drew then: delivered
       data a reader reads, never a question they answer. So the gate that
       remains is pinned here, and the retired one is pinned as an absence in
       BOTH components so the lens cannot come back through either door. */
    assert.match(component, /\{:else if square\.back\.facts\}/);
    assert.match(component, /class="board-facts"/);
    assert.match(component, /\{#each square\.back\.facts as fact \(fact\.key\)\}/);
    for (const [name, source] of Object.entries({ component, commits })) {
      assert.doesNotMatch(
        source,
        /activity\.categories|activeLensCategory/,
        `${name} reads the category vocabulary again, which only the retired lens ever needed`
      );
    }
  });

  it('never encodes a category by color alone', () => {
    /* Every fact carries its category's name and its figures BESIDE the
       swatch — built as data by the adapter, rendered verbatim by the
       component — so the colour is the redundant channel and the swatch is
       decorative to assistive technology. This is stronger than the retired
       strip's arrangement, which put the exact figures in a title attribute
       that no touch device could open (issue 219). */
    assert.match(helper, /value: `\$\{formatTokenCount\(share\.total\)\} · \$\{formatShare\(share\.pct\)\}`/);
    assert.match(component, /class="board-term">\{fact\.term\}/);
    assert.match(component, /class="board-value">\{fact\.value\}/);
    assert.match(component, /class="board-swatch" data-slot=\{fact\.slot\} aria-hidden="true"/);
    assert.doesNotMatch(component, /\stitle=/, 'a title attribute has no touch trigger in any engine');
    /* Figures wear the face's own ink, never a series colour. */
    assert.match(sheet, /\.board-value \{[^}]*font-variant-numeric: tabular-nums/);
  });

  it('separates the swatches from the values with the sheet gap (dataviz mark spec)', () => {
    /* The retired strip stacked segments in one bar and needed a 2px surface
       gap to keep adjacent categories apart. The board lists them as rows
       instead (owner directive of 2026-09-03, issue 287), so the separation is
       the row gap and the swatch's own box — a stronger separation than 2px,
       and one that cannot collapse when two adjacent categories are close in
       hue. */
    assert.match(sheet, /\.board-facts \{[^}]*gap: 0\.25rem/);
    assert.match(sheet, /\.board-swatch \{[^}]*inline-size: 0\.5rem/);
    assert.match(sheet, /\.board-swatch \{[^}]*block-size: 0\.5rem/);
  });

  it('resolves every category color from a global token slot', () => {
    /* The slot rules moved to styles.css with the rest of the board's
       geometry (owner directive of 2026-09-03, issue 287), which is also what
       keeps them CSP-safe: a closed set of attribute rules rather than a
       per-element inline style, exactly as the heatmap's levels are. */
    for (let slot = 0; slot <= 5; slot += 1) {
      assert.match(sheet, new RegExp(`background: var\\(--usage-cat-${slot}\\)`));
      assert.match(sheet, new RegExp(`--usage-cat-${slot}: var\\(--color-cat-${slot}\\)`));
    }
    /* The component draws whatever slot the adapter assigned; the adapter is
       where the entity-owns-its-slot rule lives (categorySlot above). */
    assert.match(component, /data-slot=\{fact\.slot\}/);
    assert.match(helper, /slot: categorySlot\(share\.key\)/);
    // No component declares a palette token of its own; it may only read one.
    assert.doesNotMatch(component, /--usage-cat-\d\s*:/, 'a component declares a palette slot');
  });

  it('renders every payload string as text, never markup', () => {
    /* Svelte escapes text interpolation; what would break that promise is a
       raw-HTML injection, so neither component may ever contain one. A hostile
       label in a payload therefore renders as inert text, and a hostile
       category KEY cannot even reach the renderer (admission refuses it —
       proven above). */
    for (const [name, source] of Object.entries({ component, commits })) {
      assert.doesNotMatch(source, /\{@html/, name);
    }
  });
});

/* Finding 9 of the 2026-08-24 round-3 review: the frontend was the loose end
 * of a numeric contract the other two stages enforce. Number.isFinite admits
 * 1.5, admits 1e300, and admits 9007199254740993 — which is not even the
 * number that was written, because it does not exist in JavaScript. These
 * cases are the exact inputs that used to be admitted. */
describe('count admission holds the shared numeric contract', () => {
  const window = (patch) => ({
    sources: [{ label: 'fixture', windows: [{ period: 'week', inputTokens: 1, outputTokens: 1, ...patch }] }]
  });

  it('admits the largest value every stage agrees about', () => {
    const admitted = tokenUsageSources(window({ inputTokens: countBound }));
    assert.equal(admitted.length, 1);
    assert.equal(admitted[0].windows[0].inputTokens, countBound);
  });

  it('refuses a count one past the exact-representation boundary', () => {
    /* countBound + 1 and countBound + 2 are the SAME double, so a payload
     * carrying either arrives indistinguishable from the other. Serving a
     * figure the origin did not produce is the doctrine violation the
     * panels contract names by hand; refusing is the honest state. */
    assert.equal(countBound + 1, countBound + 2);
    assert.deepEqual(tokenUsageSources(window({ inputTokens: countBound + 1 })), []);
    assert.deepEqual(tokenUsageSources(window({ outputTokens: 1e300 })), []);
  });

  it('refuses a fractional count', () => {
    assert.deepEqual(tokenUsageSources(window({ inputTokens: 1.5 })), []);
    assert.deepEqual(tokenUsageSources(window({ outputTokens: -0.5 })), []);
  });

  it('refuses NaN and both infinities', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.deepEqual(tokenUsageSources(window({ inputTokens: value })), [], String(value));
    }
  });

  it('still admits a fractional utilization, which is a rate and not a count', () => {
    /* The tightening above must not swallow the two *float64 fields the
     * origin genuinely serves. 36.4 is a correct utilizationPct and 58.7 is
     * a correct insight pct; refusing them would blank a truthful panel. */
    const admitted = tokenUsageSources(window({ utilizationPct: 36.4 }));
    assert.equal(admitted.length, 1);
    assert.equal(admitted[0].windows[0].utilizationPct, 36.4);
    const insight = tokenUsageSources({
      sources: [{ label: 'fixture', windows: [], insights: [{ label: 'cache read', pct: 58.7 }] }]
    });
    assert.equal(insight[0].insights[0].pct, 58.7);
  });

  it('refuses a rate that is not a number at all', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      assert.deepEqual(tokenUsageSources(window({ utilizationPct: value })), [], String(value));
    }
  });

  it('refuses a series total outside the shared range', () => {
    const series = (totals) => ({
      sources: [{ label: 'fixture', windows: [], series: { startDate: '2026-08-10', totals } }]
    });
    assert.equal(tokenUsageSources(series([1, countBound])).length, 1);
    assert.deepEqual(tokenUsageSources(series([1, countBound + 1])), []);
    assert.deepEqual(tokenUsageSources(series([1, 2.5])), []);
  });

  it('refuses a category partition whose running sum leaves the exact range', () => {
    /* Each part is admissible on its own and the declared total is
     * admissible too; only the SUM leaves the range. Unchecked, the
     * addition would land on an approximation and the equality below it
     * would be comparing two numbers neither of which is the truth. */
    const half = Math.floor(countBound / 2) + 1;
    const payload = {
      sources: [
        {
          label: 'fixture',
          windows: [],
          series: {
            startDate: '2026-08-10',
            totals: [countBound],
            categories: [
              { key: 'input', totals: [half] },
              { key: 'output', totals: [half] }
            ]
          }
        }
      ]
    };
    assert.ok(Number.isSafeInteger(half) && Number.isSafeInteger(countBound));
    assert.ok(!Number.isSafeInteger(half + half));
    assert.deepEqual(tokenUsageSources(payload), []);
  });
});

/* The honest data-through line (issue 276; the observability half of issue
 * 267). A stalled capture pipeline used to be invisible: the origin keeps
 * serving its last good payload at status ok, and nothing anywhere said the
 * figures were days old. The adapter now derives a stale note from fields
 * the envelope already carries — no invented freshness, no new wire data. */
describe('the stale data-through note', () => {
  const seriesSources = [
    { label: 'alpha', windows: [], series: { startDate: '2026-08-20', totals: [1, 0, 2], recorded: true } },
    { label: 'beta', windows: [], series: { startDate: '2026-08-25', totals: [3], recorded: true } }
  ];
  const now = new Date('2026-09-01T12:00:00Z');

  it('dates the payload by the newest day any series covers', () => {
    assert.equal(usageDataThrough(seriesSources), '2026-08-25');
    assert.equal(usageDataThrough([{ label: 's', windows: [] }]), undefined);
    assert.equal(
      usageDataThrough([{ label: 's', windows: [], series: { startDate: '2026-08-01', totals: [] } }]),
      undefined
    );
  });

  it('stays silent while the payload is fresh', () => {
    const fresh = new Date(Date.parse('2026-08-25T12:00:00Z') + usageStaleAfterMs);
    assert.equal(usageStaleNote('ok', '2026-08-25T12:00:00Z', seriesSources, fresh), undefined);
  });

  it('renders the note once generatedAt falls beyond the threshold', () => {
    // 2026-08-25T12:00Z to 2026-09-01T12:00Z is seven days — far beyond the
    // two-day allowance, so the pipeline has provably stalled.
    assert.equal(
      usageStaleNote('ok', '2026-08-25T12:00:00Z', seriesSources, now),
      'data through Aug 25, 2026 · last capture 7d ago'
    );
    // One millisecond inside the threshold is still fresh: the bound is a
    // strict exceedance, so the note can never flicker on a healthy panel.
    const edge = new Date(Date.parse('2026-08-25T12:00:00Z') + usageStaleAfterMs + 1);
    assert.notEqual(usageStaleNote('ok', '2026-08-25T12:00:00Z', seriesSources, edge), undefined);
  });

  it('renders on an origin-declared stale envelope whatever the age', () => {
    assert.equal(
      usageStaleNote('stale', '2026-09-01T11:00:00Z', seriesSources, now),
      'data through Aug 25, 2026 · last capture 1h ago'
    );
  });

  it('falls back to the capture age alone when no source draws a series', () => {
    assert.equal(
      usageStaleNote('stale', '2026-09-01T11:00:00Z', [{ label: 's', windows: [] }], now),
      'last capture 1h ago'
    );
  });

  it('says nothing on the unavailable state, which renders the empty face instead', () => {
    assert.equal(usageStaleNote('unavailable', '2026-08-01T00:00:00Z', seriesSources, now), undefined);
  });

  it('says nothing when the envelope carries nothing to restate', () => {
    // No generatedAt and no origin stale claim: silence, never a guess.
    assert.equal(usageStaleNote('ok', undefined, seriesSources, now), undefined);
    // Origin-stale with nothing datable at all: still no invented words.
    assert.equal(usageStaleNote('stale', undefined, [{ label: 's', windows: [] }], now), undefined);
  });

  it('rides the adapter into the shell head, where a late line moves nothing', () => {
    /* The line still arrives as adapter-built words the component never
       composes. Where it RENDERS moved with the owner's directive of
       2026-09-03 (issue 287): the board's body is a grid of fixed squares, so
       the shell's head — the one row a card already reserves beside its title
       — is the only place a late line can appear without moving anything.
       That is the identical arrangement the calendar has used since issue 285,
       so the page now has one home for this line rather than two. */
    const props = tokenSquaresProps(
      envelopeFor({ sources: seriesSources }, { generatedAt: '2026-08-25T12:00:00Z' }),
      now
    );
    assert.equal(props.staleNote, 'data through Aug 25, 2026 · last capture 7d ago');
    const fresh = tokenSquaresProps(
      envelopeFor({ sources: seriesSources }, { generatedAt: '2026-09-01T11:30:00Z' }),
      now
    );
    assert.equal(fresh.staleNote, undefined);
    assert.match(component, /note=\{staleNote\}/);
    assert.doesNotMatch(
      component,
      /class="board-note">\{staleNote\}/,
      'the stale line grew the board body it must not move'
    );
  });
});

/* PROVENANCE BY EXCEPTION, ON THE FACE A READER OPENS (issue 268's wording,
 * carried into the board by the owner directive of 2026-09-03, issue 287).
 *
 * The retired tile panel put a visible "· recorded" suffix beside a figure.
 * The owner removed that mark from the repository rows in the same breath
 * ("just remove it") and moved provenance to the surface a reader opens, so
 * the board's answer is the same one the card's counters give: the sentence
 * lives where the figures it qualifies are, which for a square is its back.
 *
 * The rule is unchanged in both directions — a source whose every figure
 * shares one provenance marks none of them, and a source that mixes them says
 * so — and the sentence is the page's ONE constant rather than a copy. */
describe('a figure captured out of band says so on the face that shows the breakdown', () => {
  it('marks a recorded source, and says it in the shared wording', () => {
    const [total, anthropic] = tokenSquares([
      {
        label: 'anthropic',
        windows: [],
        stats: [
          { key: 'lifetime', label: 'Lifetime tokens', value: 10, unit: 'tokens', recorded: true },
          { key: 'input', label: 'Input', value: 4, unit: 'tokens', recorded: true }
        ]
      }
    ]);
    assert.equal(anthropic.back.note, recordedOutOfBand);
    assert.equal(total.back.note, recordedOutOfBand);
    assert.equal(recordedOutOfBand, 'recorded out of band, not fetched live');
  });

  it('marks nothing when every figure was fetched live', () => {
    const [total, anthropic] = tokenSquares([
      {
        label: 'anthropic',
        windows: [],
        stats: [
          { key: 'lifetime', label: 'Lifetime tokens', value: 10, unit: 'tokens' },
          { key: 'input', label: 'Input', value: 4, unit: 'tokens' }
        ]
      }
    ]);
    assert.equal(anthropic.back.note, undefined, 'a live source claimed an out-of-band capture');
    assert.equal(total.back.note, undefined);
  });

  it('renders the note on the back face, never on the front', () => {
    assert.match(
      component,
      /data-face="back"[\s\S]*?\{#if square\.back\.note\}<span class="board-sub">\{square\.back\.note\}<\/span>\{\/if\}/,
      'the provenance sentence has no rendered home on the board'
    );
    assert.ok(
      !component.includes('recorded out of band'),
      'the component spells the provenance wording itself; it is one constant, carried as data'
    );
  });
});
