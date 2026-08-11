import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
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
  it('renders inside the shared PanelShell with the envelope status and age', () => {
    assert.match(component, /import PanelShell from '\.\/PanelShell\.svelte'/);
    assert.match(component, /<PanelShell \{title\} status=\{envelope\.status\} generatedAt=\{envelope\.generatedAt\}>/);
    assert.match(component, /<\/PanelShell>/);
  });

  it('iterates payload sources and takes every label from the data', () => {
    assert.match(component, /\{#each sources as source\}/);
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
