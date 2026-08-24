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
  resetsIn,
  tokenUsageSources
} from '../src/lib/token-usage.ts';

const [component, helper, app] = await Promise.all([
  readFile(new URL('../src/lib/components/TokenUsagePanel.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/token-usage.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.svelte', import.meta.url), 'utf8')
]);

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

describe('TokenUsagePanel source contract', () => {
  it('renders inside the shared PanelShell with the envelope status, age, and no per-card control', () => {
    assert.match(component, /import PanelShell from '\.\/PanelShell\.svelte'/);
    assert.match(
      component,
      /<PanelShell \{title\} status=\{envelope\.status\} generatedAt=\{envelope\.generatedAt\}>/
    );
    assert.match(component, /<\/PanelShell>/);
    // Refreshing is one gesture for the whole stack, not a per-card decision,
    // so this panel hands its shell no refresher and holds no watcher handle
    // of its own — watchPanel enrols itself, and RefreshAll drives them all
    // through the same single-flight read the periodic poll uses.
    assert.doesNotMatch(component, /\{refresh\}|const refresh =|watcher/);
    assert.match(component, /return watchPanel<TokenUsageData>\('token-usage'/);
  });

  it('iterates payload sources and takes every label from the data', () => {
    assert.match(component, /\{#each sources as source \(source\.label\)\}/);
    assert.match(component, /\{source\.label\}/);
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
    assert.match(component, /\{formatUtilization\(usageWindow\.utilizationPct\)\}/);
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

describe('panel mount region', () => {
  it('keeps the fences intact and mounts this panel exactly one line per fence', () => {
    const importsFence = app.match(/panels:imports:begin[^\n]*\n([^]*?)\n\s*\/\* panels:imports:end/);
    const mountFence = app.match(/panels:mount:begin[^\n]*-->\n([^]*?)\n\s*<!-- panels:mount:end/);
    assert.ok(importsFence, 'imports fence missing');
    assert.ok(mountFence, 'mount fence missing');
    const importLines = importsFence[1].split('\n').map((line) => line.trim()).filter(Boolean);
    const mountLines = mountFence[1].split('\n').map((line) => line.trim()).filter(Boolean);
    // Exactly one import line and one mount line for THIS panel — the fence
    // contract, asserted per-panel so sibling panels (and shared chrome like
    // the side rail, which imports separately but shares its panel's mount
    // line) stay this test's neighbors, never its subjects. The canonical
    // whole-fence listing lives in panels-ui.test.mjs.
    const myImport = "import TokenUsagePanel from './lib/components/TokenUsagePanel.svelte';";
    assert.equal(
      importLines.filter((line) => line === myImport).length,
      1,
      'token-usage import line must appear exactly once in its fence'
    );
    assert.equal(
      mountLines.filter((line) => line === '<TokenUsagePanel />').length,
      1,
      'token-usage mount line must appear exactly once in its fence'
    );
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

  it('treats a null figure as real information, not a refusal', () => {
    const payload = structuredClone(base);
    payload.sources[0].stats[0].value = null;
    payload.sources[0].insights[0].pct = null;
    const [source] = tokenUsageSources(payload);
    assert.equal(source.stats[0].value, null);
    assert.equal(source.insights[0].pct, null);
  });
});

describe('TokenUsagePanel live surface', () => {
  it('keeps itself current instead of painting once at mount', () => {
    assert.match(component, /watchPanel<TokenUsageData>\('token-usage'/);
    assert.doesNotMatch(component, /onMount/, 'a one-shot mount read is the bug this panel had');
  });

  it('renders the owner\'s tile grid: two columns, a final odd tile spanning the row', () => {
    assert.match(component, /grid-template-columns:\s*repeat\(2,/);
    assert.match(component, /\.usage-tile:last-child:nth-child\(odd\)\s*\{\s*grid-column:\s*1 \/ -1/);
    assert.match(component, /class="usage-tile-value">\{formatStatValue\(stat\.value, stat\.unit\)\}/);
  });

  it('marks recorded figures instead of letting them borrow live freshness', () => {
    assert.match(component, /\{#if stat\.recorded\}/);
    assert.match(component, /\{#if insight\.recorded\}/);
    assert.match(component, /class="usage-recorded"/);
  });

  it('switches the activity view client-side over one series', () => {
    assert.match(component, /role="radiogroup"/);
    assert.match(component, /\{#each seriesViews as candidate\}/);
    assert.match(component, /aria-checked=\{view === candidate\}/);
    assert.match(component, /viewValues\(source\.series\.totals, view\)/);
    // Touch target floor for the segmented control.
    assert.match(component, /min-block-size:\s*2\.75rem/);
  });

  it('renders the activity heatmap through the shared grid component', () => {
    assert.match(component, /import ContributionGrid from '\.\/ContributionGrid\.svelte'/);
    assert.match(component, /<ContributionGrid/);
    // A source with no series gets the graph's chrome and an honest note, not
    // a sentence where the graph belongs (owner directive, issue 127). The
    // note says what is true of the DATA — no series yet — and nothing about
    // the origin's refresh configuration, which is not a visitor's business
    // and was what the retired copy explained to them.
    assert.match(component, /emptyNote="series pending"/);
    assert.doesNotMatch(component, /live refresh is off/);
  });
});
