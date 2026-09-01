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
  provenanceIsMixed,
  resetsIn,
  tokenUsagePanelId,
  tokenUsageProps,
  tokenUsageSources
} from '../src/lib/token-usage.ts';
import { formatMagnitude } from '../src/lib/grid.ts';

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

describe('UsageTracker source contract', () => {
  it('renders inside the shared PanelShell with the envelope status, age, and no per-card control', () => {
    assert.match(component, /import PanelShell from '\.\/PanelShell\.svelte'/);
    assert.match(component, /<PanelShell \{title\} \{status\} \{generatedAt\}>/);
    assert.match(component, /<\/PanelShell>/);
    // No panel offers a manual refresh any more (owner directive, issue 179):
    // this panel hands its shell no refresher and holds no watcher handle of
    // its own — the block host enrols it through watchPanel, which keeps
    // itself current, and a failed read logs an error instead of waiting on
    // a visitor to press a control that does not exist.
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
    // The pair row: compact figures beside named glyphs, the replaced word
    // clipped into the tree (owner directive, 2026-08-31), exact figures on
    // the title.
    assert.deepEqual(
      first.windows[0].pairs.map((pair) => `${pair.glyph} ${pair.label} ${pair.figure}`),
      [`flow-in input ${formatTokenCount(182340)}`, `flow-out output ${formatTokenCount(45120)}`]
    );
    // The component draws both arrows in the page's one glyph language and
    // marks them decorative; the clipped word is what carries the meaning.
    for (const glyph of ["pair.glyph === 'flow-in'"]) {
      assert.ok(component.includes(glyph), `the tracker draws no ${glyph} branch`);
    }
    assert.match(component, /class="usage-pair-glyph"[^>]*aria-hidden="true"/s);
    assert.match(component, /\.usage-pair-label \{[^}]*clip-path: inset\(50%\)/s);
    assert.doesNotMatch(component, /\.usage-pair-label \{[^}]*display: none/s);
    // The exact figures stay exact (owner directive, 2026-08-25: the compact
    // reading is what surfaces, the exact one survives here) — but GROUPED,
    // because nine undelimited digits on a tooltip is a log line, not a
    // figure a reader can size at a glance.
    assert.equal(first.windows[0].pairsLabel, '182,340 input tokens, 45,120 output tokens');
    assert.equal(first.windows[0].reset, resetsIn('2026-08-11T07:00:00Z'));
  });

  it('renders honest empty states for a refused payload and for a windowless source', () => {
    const emptyStates = component.match(/class="usage-empty"/g) ?? [];
    assert.equal(emptyStates.length, 2);
  });

  it('reads every color from a custom property, and the severity ramp with no fallback at all', () => {
    assert.doesNotMatch(component, /#[0-9a-fA-F]{3,8}\b/, 'raw hex colors defeat theme overrides');
    for (const token of ['--panel-', '--usage-meter-ok', '--usage-meter-warning', '--usage-meter-critical']) {
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

  it('stays local-origin like every shipped source file', () => {
    for (const [name, source] of Object.entries({ component, helper })) {
      // Protocol-relative origins still fail this; a line comment no longer
      // does. The lookahead and the reasoning behind it are documented once,
      // on the same sweep in tests/experience.test.mjs.
      assert.doesNotMatch(source, /(?:https?:)?\/\/(?=[\w-]+\.)/, `${name} introduces a remote origin`);
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
    // An unreported insight draws NO fill and reads as the explicit dash.
    // Null rather than 0 is the whole point (owner directive, 2026-08-28): a
    // zero-width bar is pixel-identical to a measured 0%, so a row whose
    // denominator never existed used to draw the same picture as one that
    // genuinely contributed nothing.
    const dashed = tokenUsageProps(
      envelopeFor({ sources: [{ label: 's', windows: [], insights: [{ label: 'i', pct: null }] }] })
    );
    assert.equal(dashed.sections[0].insights.rows[0].fillPct, null);
    assert.equal(dashed.sections[0].insights.rows[0].reading, '--');
    // ...and a MEASURED zero still draws its (empty) bar, because 0% of a real
    // window is a measurement and must not be erased along with the unknowns.
    const measured = tokenUsageProps(
      envelopeFor({ sources: [{ label: 's', windows: [], insights: [{ label: 'i', pct: 0 }] }] })
    );
    assert.equal(measured.sections[0].insights.rows[0].fillPct, 0);
    assert.equal(measured.sections[0].insights.rows[0].reading, '0%');
  });

  it('draws ONE graph client-side over the whole delivered series', () => {
    /* RE-AIMED for the owner's 2026-08-28 reversal ("remove this entire menu.
       it doesnt look good and it doesn't provide any value"). What this used
       to pin was three toggles composing into one pipeline; what it pins now
       is that the pipeline has no toggles left and answers at full depth.
       The claim is the same shape — one delivered payload, read client-side,
       no extra bytes — and it is the QUESTION that stopped being a choice. */
    assert.match(
      component,
      /seriesCells\(activity\.series\.startDate, activity\.series\.totals\)/
    );
    // ONE window, derived from the panel's whole coverage and handed to every
    // source (issue 268), rather than each source measuring its own.
    assert.match(component, /coverageColumns\(seriesOf\(activity\), panelWindow\)/);
    assert.doesNotMatch(component, /rangeColumns/);
    // The source's own totals, never a category slice: the category lens went
    // with the menu, so there is no branch left that could read anything else.
    assert.doesNotMatch(component, /category \? category\.totals/);
    assert.doesNotMatch(component, /viewColumns/);
    // No vocabulary is offered to the reader any more, in either question.
    assert.doesNotMatch(component, /seriesViews|seriesRanges|defaultSeriesRange/);
    assert.doesNotMatch(component, /role="radiogroup"/);
    // The deleted component is genuinely gone from the tree rather than
    // merely unreferenced here.
    assert.equal(
      existsSync(new URL('../src/lib/components/UsageFilterMenu.svelte', import.meta.url)),
      false,
      'the display menu file outlived every reference to it'
    );
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
    // region is the whole graph — heading and grid together (the lens toggle
    // that used to be gated with them went with the owner's 2026-08-28
    // reversal).
    const region =
      /\{#if columns\.length > 0\}\s*<section class="usage-activity">([\s\S]*?)<\/section>\s*\{\/if\}/.exec(
        component
      );
    assert.ok(region, 'the graph region is no longer gated on there being columns to draw');
    assert.match(region[1], /<ContributionGrid/, 'the gate does not contain the graph');
    assert.match(region[1], /\{source\.activity\.heading\}/, 'the heading is outside the gate it belongs to');
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
    /* The adapter carries the SERIES and no sentence about it (issue 158).
       The sentence moved to lib/periods.ts, where the chosen window is known;
       an adapter-built one would keep describing the whole capture while the
       graph above it drew ninety days. What that sentence says for exactly
       this payload, through exactly the default window this panel opens on,
       is pinned in tests/periods.test.mjs — including that it is the same
       string this assertion used to hold. */
    assert.equal(drawn.sections[0].activity.summary, undefined);
    assert.deepEqual(drawn.sections[0].activity.series, { startDate: '2026-08-01', totals: [1, 2, 3] });
    // A windowless, statless source states its honest empty line; a source
    // with figures does not.
    assert.equal(seriesless.sections[0].note, 'No usage recorded for this source yet.');
    const withWindows = tokenUsageProps(envelopeFor(shippedPayload));
    assert.equal(withWindows.sections[0].note, undefined);
    assert.equal(withWindows.emptyNote, 'No usage data available.');
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
     resolution into the component, which resolves an `UsageCategory` from the
     adapter-built list and falls back to the plain series when the active lens
     names nothing — so the helper had no production caller left, and a test
     whose only subject is unshipped code measures nothing. The behaviour it
     described is still pinned, in the two places that now decide it: the
     component's own fallback expression, asserted ABOVE by `switches the
     activity view client-side over one series`, and the real-engine lens
     behaviour in `e2e/rendering-lanes.spec.mjs` :: `a source lens moves its
     own graph and leaves its neighbour on daily`. */

  /* The lens VOCABULARY is what the adapter delivers, and the lens LOOKUP is
     the component's `activeLensCategory` over exactly this list. A resolver
     helper in this module was deleted as dead code (coordinator ruling,
     2026-08-26): nothing on main ever called it, and the component already
     resolves its own lens, so keeping it would have been a second
     lens-resolution path pinned by tests that only it satisfied.

     The four behaviours those tests pinned still SHIP, so they are asserted
     here against the surviving path instead: a named lens reads its own
     dailies, an unreported lens has no entry to find, a series with no
     breakdown offers no lens at all, and the total sentinel travels as data.
     The component-side half of each — the guard and the fallback expression
     that consume them — is pinned in panels-ui.test.mjs. */
  it('delivers the lens vocabulary the component looks up, and nothing to resolve it with', () => {
    const props = tokenUsageProps(
      envelopeFor({ sources: [{ label: 'alpha', windows: [], series }] })
    );
    const categories = props.sections[0].activity.categories;
    assert.deepEqual(
      categories.map((category) => category.key),
      ['input', 'cache-read']
    );
    /* A named lens reads its OWN dailies, delivered unchanged from the
       served category — the value the retired helper's second assertion
       measured. */
    assert.deepEqual(
      categories.find((category) => category.key === 'cache-read').totals,
      [9, 18, 27]
    );
    assert.deepEqual(
      categories.find((category) => category.key === 'input').totals,
      [1, 2, 3]
    );
    /* A lens this source does not report has no entry to find, which is what
       sends the component's lookup to the plain series — real data, never a
       guess. */
    assert.equal(
      categories.find((category) => category.key === 'reasoning'),
      undefined
    );
    /* And a series with no breakdown at all offers no lens row: the second
       half of the same fallback. */
    const plain = tokenUsageProps(
      envelopeFor({
        sources: [
          { label: 'alpha', windows: [], series: { startDate: '2026-08-10', totals: [5] } }
        ]
      })
    );
    assert.equal(plain.sections[0].activity.categories, undefined);
    assert.deepEqual(plain.sections[0].activity.series.totals, [5]);
    /* Neither the resolver nor its sentinel came back here, and the adapter
       reads the served category directly rather than through one. The
       sentinel is stated once, in the component that decides with it. */
    assert.doesNotMatch(helper, /lensValues/, 'the dead lens resolver is back');
    assert.doesNotMatch(helper, /totalLens/, 'the adapter grew back a second copy of the sentinel');
    assert.match(helper, /totals: category\.totals,/);
    /* A category carries a NOUN, never a finished sentence: the reading is
       built by lib/periods.ts from the cells actually drawn, so a lens and a
       window cannot describe two different graphs. */
    for (const category of categories) {
      assert.equal(category.noun, `${category.label} token`);
      assert.equal(category.summary, undefined);
    }
    assert.match(helper, /noun: `\$\{categoryLabel\(category\.key\)\} \$\{tokenActivityNoun\}`/);
    assert.doesNotMatch(helper, /function usageActivitySummary/, 'the adapter grew back a window-blind sentence');
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

  it('reads the rows from the live series when the payload carries models', () => {
    const props = tokenUsageProps(
      envelopeFor({
        sources: [
          sourceWith({
            insights: [{ label: 'Frozen', pct: 99, recorded: true }]
          })
        ]
      })
    );
    const insights = props.sections[0].insights;
    assert.deepEqual(
      insights.rows.map((row) => [row.label, row.reading]),
      [
        ['Opus 5', '80%'],
        ['Fable 5', '20%']
      ]
    );
    // The frozen release-time set is not merged in beside the measured one:
    // two answers to one question is worse than the older answer alone.
    assert.equal(
      insights.rows.find((row) => row.label === 'Frozen'),
      undefined
    );
    // And the range is stated, because a percentage with no stated range
    // invites the reader to assume the widest one.
    assert.equal(insights.note, 'share of tokens · Aug 11–12, 2026');
  });

  it('falls back to the shipped insights when no model partition exists', () => {
    const props = tokenUsageProps(
      envelopeFor({
        sources: [
          {
            label: 'alpha',
            windows: [],
            series: { startDate: '2026-08-10', totals: [10] },
            insights: [{ label: 'Frozen', pct: 99, recorded: true }]
          }
        ]
      })
    );
    const insights = props.sections[0].insights;
    assert.deepEqual(
      insights.rows.map((row) => row.label),
      ['Frozen']
    );
    // No note: the frozen set is not measured over any window this panel can
    // name, and inventing one would be exactly the borrowed freshness the
    // panel doctrine forbids.
    assert.equal(insights.note, undefined);
  });

  it('weighs the DERIVED rows when it decides whether provenance is mixed', () => {
    // The rows are resolved before the marks are, so a live-derived set is
    // weighed exactly as a served one. Here the tiles are live and the
    // derived rows inherit the series' recorded provenance, so the section is
    // mixed and only the recorded figures carry the mark.
    const props = tokenUsageProps(
      envelopeFor({
        sources: [
          sourceWith({
            stats: [{ key: 'lifetime', label: 'Lifetime', value: 7, unit: 'tokens' }]
          })
        ]
      })
    );
    const section = props.sections[0];
    assert.deepEqual(
      section.insights.rows.map((row) => row.marked),
      [true, true]
    );
    assert.equal(section.tiles[0].marked, false);
  });

  it('marks nothing when the derived rows and the tiles share one provenance', () => {
    const props = tokenUsageProps(
      envelopeFor({
        sources: [
          sourceWith({
            stats: [
              { key: 'lifetime', label: 'Lifetime', value: 7, unit: 'tokens', recorded: true }
            ]
          })
        ]
      })
    );
    const section = props.sections[0];
    assert.deepEqual(
      section.insights.rows.map((row) => row.marked),
      [false, false]
    );
    assert.equal(section.tiles[0].marked, false);
  });

  it('renders the range note under the heading, gated on it existing', () => {
    assert.match(component, /\{#if source\.insights\.note\}/);
    assert.match(component, /<p class="usage-insights-note">\{source\.insights\.note\}<\/p>/);
  });
});

describe('category breakdown surface', () => {
  it('gates the composition strip on the composition existing', () => {
    /* RE-AIMED for the owner's 2026-08-28 reversal. This used to gate TWO
       things on a source reporting categories: the category lens in the
       display menu, and the composition strip. The lens went with the menu;
       the strip did not, and must not — it is delivered data a reader reads,
       never a question they answer, which is exactly the distinction the
       owner drew ("the filters don't provide any value"). So the gate that
       remains is pinned here, and the retired one is pinned as an absence so
       the lens cannot come back through this door. */
    assert.match(component, /\{#if source\.activity\.composition && source\.activity\.composition\.length > 0\}/);
    assert.match(component, /class="usage-composition-bar"/);
    assert.match(component, /class="usage-composition-rows"/);
    assert.doesNotMatch(
      component,
      /source\.activity\.categories/,
      'the component reads the category vocabulary again, which only the retired lens ever needed'
    );
  });

  it('never encodes a category by color alone', () => {
    /* Every segment carries its category's name and figures in the tooltip —
       built as data by the adapter, rendered verbatim by the component — and
       every legend chip sits BESIDE the written label and value. */
    assert.match(helper, /tooltip: `\$\{categoryLabel\(share\.key\)\}: \$\{formatTokenCount\(share\.total\)\} tokens/);
    assert.match(component, /title=\{share\.tooltip\}/);
    assert.match(component, /class="usage-composition-label">\{share\.label\}</);
    assert.match(component, /class="usage-composition-value"/);
    /* Figures wear the text token, never a series color. */
    assert.match(component, /\.usage-composition-value \{[^}]*var\(--panel-text/);
  });

  it('keeps 2px surface gaps between stacked segments (dataviz mark spec)', () => {
    assert.match(component, /\.usage-composition-bar \{[^}]*gap: 2px/);
  });

  it('resolves every category color from a global token slot', () => {
    for (let slot = 0; slot <= 5; slot += 1) {
      assert.match(component, new RegExp(`var\\(--usage-cat-${slot},`));
    }
    /* The component draws whatever slot the adapter assigned; the adapter is
       where the entity-owns-its-slot rule lives (categorySlot above). */
    assert.match(component, /data-category-slot=\{share\.slot\}/);
    assert.match(helper, /slot: categorySlot\(share\.key\)/);
  });

  it('renders every payload string as text, never markup', () => {
    /* Svelte escapes text interpolation; what would break that promise is a
       raw-HTML injection, so the component may never contain one. A hostile
       label in a payload therefore renders as inert text, and a hostile
       category KEY cannot even reach the renderer (admission refuses it —
       proven above). */
    assert.doesNotMatch(component, /\{@html/);
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
