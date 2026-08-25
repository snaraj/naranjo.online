import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
  formatDuration,
  formatStatValue,
  formatTokenCount,
  formatUtilization,
  meterFillPct,
  meterSeverity,
  provenanceIsMixed,
  resetsIn,
  tokenUsagePanelId,
  tokenUsageProps,
  tokenUsageSources
} from '../src/lib/token-usage.ts';

const [component, helper, manifest, binding] = await Promise.all([
  readFile(new URL('../src/lib/components/UsageTracker.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/token-usage.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/page.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/blocks/tokenUsage.ts', import.meta.url), 'utf8')
]);

/* One well-formed envelope around the shipped payload, for driving the
 * adapter the way the block host does. */
const envelopeFor = (data, overrides = {}) => ({
  schema: 'panel/v1',
  id: tokenUsagePanelId,
  kind: 'token-usage/v1',
  title: 'Fixture Usage',
  status: 'ok',
  generatedAt: '2026-08-11T03:00:00Z',
  data,
  ...overrides
});

// The exact payload shape internal/panels serves for token-usage/v1. The two
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

describe('formatTokenCount', () => {
  it('keeps small counts exact with deterministic comma grouping', () => {
    assert.equal(formatTokenCount(0), '0');
    assert.equal(formatTokenCount(999), '999');
    assert.equal(formatTokenCount(1284), '1,284');
    assert.equal(formatTokenCount(9999), '9,999');
  });

  it('compacts large counts to one-decimal K, M, and B figures', () => {
    assert.equal(formatTokenCount(12900), '12.9K');
    assert.equal(formatTokenCount(100000), '100K');
    assert.equal(formatTokenCount(182340), '182.3K');
    assert.equal(formatTokenCount(9421770), '9.4M');
    assert.equal(formatTokenCount(2103980), '2.1M');
    assert.equal(formatTokenCount(1250000000), '1.3B');
  });

  it('promotes a figure that would round to 1000 of its own unit', () => {
    assert.equal(formatTokenCount(999950), '1M');
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

describe('UsageTracker source contract', () => {
  it('renders inside the shared PanelShell with the envelope status, age, and no per-card control', () => {
    assert.match(component, /import PanelShell from '\.\/PanelShell\.svelte'/);
    assert.match(component, /<PanelShell \{title\} \{status\} \{generatedAt\}>/);
    assert.match(component, /<\/PanelShell>/);
    // Refreshing is one gesture for the whole stack, not a per-card decision,
    // so this panel hands its shell no refresher and holds no watcher handle
    // of its own — the block host enrols it through watchPanel, and
    // RefreshAll drives them all through the same single-flight read the
    // periodic poll uses.
    assert.doesNotMatch(component, /\{refresh\}|const refresh =|watcher/);
    // The envelope facts ride the adapter into the shell unchanged, and the
    // empty-title fallback the unavailablePanel case needs is preserved.
    const rendered = tokenUsageProps(envelopeFor(shippedPayload));
    assert.equal(rendered.title, 'Fixture Usage');
    assert.equal(rendered.status, 'ok');
    assert.equal(rendered.generatedAt, '2026-08-11T03:00:00Z');
    assert.equal(tokenUsageProps(envelopeFor(null, { title: '' })).title, 'Token usage');
    // Before the first envelope the block renders NOTHING — the same face the
    // retired component's {#if envelope} guard gave the page.
    assert.equal(tokenUsageProps(null), null);
  });

  it('iterates payload sources and takes every label from the data', () => {
    assert.match(component, /\{#each sections as source \(source\.key\)\}/);
    assert.match(component, /\{source\.label\}/);
    const rendered = tokenUsageProps(envelopeFor(shippedPayload));
    assert.deepEqual(
      rendered.sections.map((section) => section.label),
      shippedPayload.sources.map((source) => source.label),
      'every section label is the payload’s, in the payload’s order'
    );
    // Vendor and tool names are payload data, never component or helper
    // logic. The needles are assembled from fragments so this test file's
    // own scan subject stays clean, mirroring the Go doctrine pin.
    for (const [name, source] of Object.entries({ component, helper })) {
      const lowered = source.toLowerCase();
      for (const mark of ['anthro' + 'pic', 'co' + 'dex', 'open' + 'ai']) {
        assert.ok(!lowered.includes(mark), `${name} hardcodes the vendor name ${mark}`);
      }
    }
  });

  it('never lets color carry the meter alone: the graphic is hidden, the value visible', () => {
    assert.match(component, /class="usage-meter-track" aria-hidden="true"/);
    assert.match(component, /class="usage-meter-value"/);
    assert.match(component, /\{usageWindow\.meter\.reading\}/);
    // The reading beside the fill is the true figure through the tested
    // renderer, and the fill saturates while the reading does not.
    const [first] = tokenUsageProps(envelopeFor(shippedPayload)).sections;
    assert.equal(first.windows[0].meter.reading, formatUtilization(36.4));
    assert.equal(first.windows[0].meter.severity, meterSeverity(36.4));
    assert.equal(first.windows[0].meter.fillPct, meterFillPct(36.4));
    // A window without a reported utilization draws no meter at all.
    const [, second] = tokenUsageProps(envelopeFor(shippedPayload)).sections;
    assert.equal(second.windows[0].meter, undefined);
    // The pair row: compact figures visible, exact figures on the title.
    assert.deepEqual(
      first.windows[0].pairs.map((pair) => `${pair.label} ${pair.figure}`),
      [`in ${formatTokenCount(182340)}`, `out ${formatTokenCount(45120)}`]
    );
    assert.equal(first.windows[0].pairsLabel, '182340 input tokens, 45120 output tokens');
    assert.equal(first.windows[0].reset, resetsIn('2026-08-11T07:00:00Z'));
  });

  it('renders honest empty states for a refused payload and for a windowless source', () => {
    const emptyStates = component.match(/class="usage-empty"/g) ?? [];
    assert.equal(emptyStates.length, 2);
  });

  it('reads every color from a custom property with dark-native defaults', () => {
    assert.doesNotMatch(component, /#[0-9a-fA-F]{3,8}\b/, 'raw hex colors defeat theme overrides');
    for (const token of ['--panel-', '--usage-meter-ok', '--usage-meter-warning', '--usage-meter-critical', '--panel-status-ok']) {
      assert.match(
        component,
        new RegExp(`var\\(\\s*${token}`),
        `component styles must read var(${token}…) so themes can override it`
      );
    }
  });

  it('stays local-origin like every shipped source file', () => {
    for (const [name, source] of Object.entries({ component, helper })) {
      assert.doesNotMatch(source, /(?:https?:)?\/\//, `${name} introduces a remote origin`);
    }
  });
});

describe('manifest mount', () => {
  it('lists this block exactly once, bound to its panel id', () => {
    // The fences retired with the table-of-contents App (issue 165): the
    // manifest IS the mount list, so the per-panel pin moves to it. The
    // canonical whole-section listing lives in panels-ui.test.mjs.
    const importLines = manifest.match(/^import \{ tokenUsage \} from '\.\/lib\/blocks\/tokenUsage\.ts';$/gm);
    assert.equal(importLines?.length, 1, 'exactly one import line for the usage block');
    const body = manifest.replace(/^import[^\n]*\n/gm, '');
    assert.equal(
      (body.match(/\btokenUsage\b/g) ?? []).length,
      1,
      'the manifest lists the usage block exactly once'
    );
    assert.match(binding, /panelBlock\(\s*'token-usage',\s*UsageTracker,\s*tokenUsagePanelId,\s*tokenUsageProps\s*\)/);
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

describe('UsageTracker live surface', () => {
  it('keeps itself current through the block host instead of painting once at mount', () => {
    // The subscription moved to the ONE host every panel block shares
    // (issue 165): Block.svelte runs watchPanel and re-runs this adapter on
    // every envelope, so a panel cannot drift into a one-shot read of its
    // own. The component itself fetches nothing.
    assert.doesNotMatch(component, /onMount/, 'a one-shot mount read is the bug this panel had');
    assert.doesNotMatch(component, /watchPanel|loadPanel|fetch\(/, 'the component reads no wire; the block host does');
  });

  it('renders the owner\'s tile grid: two columns, a final odd tile spanning the row', () => {
    assert.match(component, /grid-template-columns:\s*repeat\(2,/);
    assert.match(component, /\.usage-tile:last-child:nth-child\(odd\)\s*\{\s*grid-column:\s*1 \/ -1/);
    assert.match(component, /class="usage-tile-value">\{tile\.figure\}/);
    // The figure the tile shows is the tested renderer's, via the adapter.
    const payload = {
      sources: [
        {
          label: 'fixture',
          windows: [],
          stats: [{ key: 'lifetime', label: 'Lifetime tokens', value: 22_700_000_000, unit: 'tokens', recorded: true }]
        }
      ]
    };
    const [section] = tokenUsageProps(envelopeFor(payload)).sections;
    assert.equal(section.tiles[0].figure, formatStatValue(22_700_000_000, 'tokens'));
    assert.equal(section.tiles[0].label, 'Lifetime tokens');
  });

  it('marks provenance by exception, never once per figure', () => {
    // The marker is still here and still says the same thing — what changed
    // with issue 134 is that it is gated on the source's provenance being
    // MIXED, and with issue 165 the gate is decided in the adapter, beside
    // provenanceIsMixed itself, so the component renders a plain flag.
    assert.match(component, /\{#if tile\.marked\}/);
    assert.match(component, /\{#if insight\.marked\}/);
    assert.match(component, /class="usage-recorded"/);
    // The ungated forms are what this replaces; either one returning is the
    // regression, and both are cheap to name exactly.
    assert.doesNotMatch(component, /\{#if stat\.recorded\}|\{#if tile\.recorded\}/);
    assert.doesNotMatch(component, /\{#if insight\.recorded\}/);
    // EXECUTED both ways: a uniform source marks nothing, a mixed source
    // marks exactly the recorded figures.
    const figure = (key, recorded) => ({ key, label: key, value: 1, unit: 'tokens', recorded });
    const uniform = tokenUsageProps(
      envelopeFor({ sources: [{ label: 's', windows: [], stats: [figure('a', true), figure('b', true)] }] })
    );
    assert.deepEqual(uniform.sections[0].tiles.map((tile) => tile.marked), [false, false]);
    const mixed = tokenUsageProps(
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
    assert.deepEqual(mixed.sections[0].tiles.map((tile) => tile.marked), [true, false]);
    assert.equal(mixed.sections[0].insights.rows[0].marked, true);
    // An unreported insight draws no fill and reads as the explicit dash.
    const dashed = tokenUsageProps(
      envelopeFor({ sources: [{ label: 's', windows: [], insights: [{ label: 'i', pct: null }] }] })
    );
    assert.equal(dashed.sections[0].insights.rows[0].fillPct, 0);
    assert.equal(dashed.sections[0].insights.rows[0].reading, '--');
  });

  it('switches the activity view client-side over one series', () => {
    assert.match(component, /role="radiogroup"/);
    assert.match(component, /\{#each seriesViews as candidate\}/);
    assert.match(component, /aria-checked=\{view === candidate\}/);
    assert.match(component, /viewValues\(\[\.\.\.activity\.series\.totals\], view\)/);
    // Touch target floor for the segmented control.
    assert.match(component, /min-block-size:\s*2\.75rem/);
  });

  it('renders the activity heatmap only where there is a series to draw', () => {
    assert.match(component, /import ContributionGrid from '\.\/ContributionGrid\.svelte'/);
    assert.match(component, /<ContributionGrid/);
    // INVERTED by the owner's ruling of 2026-08-24. This used to require
    // `emptyNote="series pending"` — a source with no series got the graph's
    // chrome and that note. The note was true about the data and false about
    // the future: this source publishes no daily record, so no series is
    // pending, and the panel was reserving a graph-shaped box for something
    // that can never arrive. It now renders no graph region at all, and keeps
    // every figure the source genuinely reports.
    assert.doesNotMatch(component, /emptyNote=/, 'the panel asks for an empty grid again');
    assert.doesNotMatch(component, /series pending/, 'the retired "pending" claim is back');
    // Both halves of the guarantee, now decided twice on the same data: the
    // adapter carries an activity region only when the series has days in it,
    // and the render still gates on there being columns to draw. The gated
    // region is the whole graph — heading, lens toggle and grid together.
    const region =
      /\{#if columns\.length > 0\}\s*<section class="usage-activity">([\s\S]*?)<\/section>\s*\{\/if\}/.exec(
        component
      );
    assert.ok(region, 'the graph region is no longer gated on there being columns to draw');
    assert.match(region[1], /<ContributionGrid/, 'the gate does not contain the graph');
    assert.match(region[1], /role="radiogroup"/, 'the lens toggle is outside the gate it belongs to');
    assert.doesNotMatch(component, /live refresh is off/);
    // The adapter half, executed: no series (or an empty one) means no
    // activity region at all; a real series carries the region and its
    // whole-series summary sentence.
    const seriesless = tokenUsageProps(envelopeFor({ sources: [{ label: 's', windows: [] }] }));
    assert.equal(seriesless.sections[0].activity, undefined);
    const empty = tokenUsageProps(
      envelopeFor({ sources: [{ label: 's', windows: [], series: { startDate: '2026-08-01', totals: [] } }] })
    );
    assert.equal(empty.sections[0].activity, undefined);
    const drawn = tokenUsageProps(
      envelopeFor({ sources: [{ label: 's', windows: [], series: { startDate: '2026-08-01', totals: [1, 2, 3] } }] })
    );
    assert.equal(drawn.sections[0].activity.heading, 'Token activity');
    assert.equal(drawn.sections[0].activity.label, 's token activity');
    assert.equal(drawn.sections[0].activity.noun, 'token');
    assert.equal(drawn.sections[0].activity.summary, '6 tokens over 3 days, peaking at 3');
    // A windowless, statless source states its honest empty line; a source
    // with figures does not.
    assert.equal(seriesless.sections[0].note, 'No usage recorded for this source yet.');
    const withWindows = tokenUsageProps(envelopeFor(shippedPayload));
    assert.equal(withWindows.sections[0].note, undefined);
    assert.equal(withWindows.emptyNote, 'No usage data available.');
  });
});
