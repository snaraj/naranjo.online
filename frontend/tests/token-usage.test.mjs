import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
  boardEmptyNote,
  categoryLabel,
  categoryShares,
  categorySlot,
  countBound,
  formatDuration,
  formatShare,
  formatStatValue,
  formatTokenCount,
  formatUtilization,
  lifetimeContext,
  meterFillPct,
  meterSeverity,
  modelClassKeys,
  modelLabel,
  modelShares,
  modelSlot,
  resetsIn,
  sessionsCardLabel,
  sourceName,
  sparkDays,
  tokenBoardProps,
  tokenCards,
  tokenUsageEmptyNote,
  tokenUsageFallbackTitle,
  tokenUsagePanelId,
  tokenUsageSourceEmptyNote,
  tokenUsageSources,
  totalCardLabel,
  unknownFigure,
  usageDataThrough,
  usageStaleAfterMs,
  usageStaleNote,
  windowTerm
} from '../src/lib/token-usage.ts';
import { scrubReading } from '../src/lib/blocks.ts';
import { commitLogProps, tokenSetLabel } from '../src/lib/commits.ts';
import {
  formatMagnitude,
  formatMagnitudeFixed,
  formatWhole as formatWholeFigure,
  pendingWeeks
} from '../src/lib/grid.ts';
import { sparkBox, sparkIndexAt, sparkInset, sparklinePath, sparkPointAt } from '../src/lib/spark.ts';

/* THE PANEL BECAME A BOARD (owner directive of 2026-09-03, issue 287), THEN
 * SIX CARDS (2026-09-11, issues 267 and 311), AND THEN A BOARD NOBODY PRESSES
 * (2026-09-11, issue 316): LedgerBoard.svelte draws a three-by-two grid whose
 * cards carry a static inversion, Sparkline.svelte draws the daily line back
 * under the ones that have a series AND scrubs it, and the contribution
 * calendar the tracker used to own stayed in the commits section's cycler
 * (CommitLog.svelte). All three are read here, because the pins this file
 * carries live across them — and the ABSENCE list that keeps the retired
 * display menu and the retired chrome from coming back has to sweep all of
 * them, or it would only be guarding the door they did not use.
 *
 * styles.css joins them for the same reason: the board's column ladder, its
 * card roles and the turn's token remap are page-level decisions the ledger's
 * other sections share, so the stylesheet is where they are stated and where
 * they must be pinned. */
const [component, commits, helper, manifest, binding, sheet, chart] = await Promise.all([
  readFile(new URL('../src/lib/components/LedgerBoard.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/components/CommitLog.svelte', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/token-usage.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/page.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/blocks/tokenBoard.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/components/Sparkline.svelte', import.meta.url), 'utf8')
]);

/* The model vocabulary, read as BYTES rather than through the module's own
   import, so the pins below compare the module's view against the file the
   origin embeds and the capture tool reads — not against itself. */
const vocabulary = JSON.parse(
  await readFile(new URL('../../internal/panels/config/models.json', import.meta.url), 'utf8')
);
const vocabularyMembers = vocabulary.groups.flatMap((group) =>
  group.members.map((member) => ({ ...member, group: group.key }))
);

/* The SOURCE vocabulary, read the same way and for the same reason (issue
   #311). Every fixture below builds its source labels out of this file rather
   than typing one, so this suite says something about the RULE — a wire key
   becomes the written name the file gives it — instead of about two lists
   that happen to agree today. It is also what keeps this file free of the
   vendor spellings the sweep at the bottom forbids in production source. */
/* A source with its COMMENTS REMOVED. Several sweeps below are about what a
   component PRINTS, and a comment recording that a retired chip is retired
   must not read as the chip coming back. */
const rendered = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');

const sourceVocabulary = JSON.parse(
  await readFile(new URL('../../internal/panels/config/sources.json', import.meta.url), 'utf8')
);
const [firstSource, secondSource] = sourceVocabulary.sources;

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

// The exact payload shape internal/panels serves. The two source labels are
// DATA and they are READ FROM THE VOCABULARY FILE, which is exactly how the
// origin ships them; the component and the adapter are asserted vendor-free
// below.
const shippedPayload = {
  sources: [
    {
      label: firstSource.key,
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
      label: secondSource.key,
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
    /* RE-AIMED at the spelling the board reads (owner directive, 2026-09-11):
       formatTokenCount is formatMagnitudeFixed, which keeps the decimal place
       a column of figures needs. The claim is unchanged and is asserted on the
       property that matters — both names pick the SAME UNIT through the same
       step walk, so one can never say millions while the other says billions,
       and they differ in nothing but the trailing zero. */
    for (const value of [0, 999, 9999, 10_000, 12_900, 999_950, 627_742_457, 7.7e12]) {
      assert.equal(
        formatTokenCount(value),
        formatMagnitudeFixed(value),
        `the two readings of ${value} diverged`
      );
      const unit = (reading) => reading.replace(/[\d.,-]/g, '');
      assert.equal(
        unit(formatTokenCount(value)),
        unit(formatMagnitude(value)),
        `the two spellings of ${value} chose different units`
      );
      assert.equal(
        Number(formatTokenCount(value).replace(/[^\d.-]/g, '')),
        Number(formatMagnitude(value).replace(/[^\d.-]/g, '')),
        `the two spellings of ${value} are different quantities, not one figure written twice`
      );
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

describe('the board of cards: source contract', () => {
  it('renders inside the shared PanelShell with the envelope status, age, and no per-card control', () => {
    assert.match(component, /import PanelShell from '\.\/PanelShell\.svelte'/);
    /* The shell receives the data-through line as well (owner directive of
       2026-09-03, issue 287): the head is the one row a late line can appear
       in without moving anything — the same arrangement the calendar uses. */
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
    const rendered = tokenBoardProps(envelopeFor(shippedPayload));
    assert.equal(rendered.title, 'Fixture Usage');
    assert.equal(rendered.status, 'ok');
    assert.equal(rendered.generatedAt, '2026-08-11T03:00:00Z');
    assert.equal(tokenBoardProps(envelopeFor(null, { title: '' })).title, tokenUsageFallbackTitle);
    assert.equal(tokenUsageFallbackTitle, 'Token usage');
    // Before the first envelope the block renders NOTHING — the same face the
    // retired component's {#if envelope} guard gave the page.
    assert.equal(tokenBoardProps(null), null);
  });

  it('derives one card per payload source and takes every name from the vocabulary', () => {
    /* The SET of surfaces is derived from the payload's own sources, in the
       payload's own order, so a third source appearing tomorrow needs no edit
       in the adapter and none in the component. What the card is CALLED comes
       from the vocabulary file rather than from the wire: the wire carries a
       machine key, and the page prints the written name that key resolves
       to. */
    assert.match(component, /\{#each cards as card \(card\.key\)\}/);
    assert.match(component, /\{card\.label\}/);
    const rendered = tokenBoardProps(envelopeFor(shippedPayload));
    const perSource = rendered.cards.filter((card) => card.key.startsWith('source-'));
    assert.deepEqual(
      perSource.map((card) => card.label),
      shippedPayload.sources.map((source) => sourceName(source.label)),
      'every source card is named by the vocabulary, in the payload\u2019s order'
    );
    assert.deepEqual(
      perSource.map((card) => card.label),
      [firstSource.name, secondSource.name],
      'the written names are the ones the vocabulary file states'
    );
    // ...and the whole board is derived, never enumerated: a one-source
    // payload produces one source card, a three-source payload three.
    const three = tokenCards([
      { label: 'a', windows: [] },
      { label: 'b', windows: [] },
      { label: 'c', windows: [] }
    ]);
    assert.equal(three.filter((card) => card.key.startsWith('source-')).length, 3);
    assert.deepEqual(tokenCards([]), [], 'a payload with no sources draws no board at all');
  });

  it('resolves a source name through the vocabulary, and an unknown key honestly', () => {
    for (const entry of sourceVocabulary.sources) {
      assert.equal(sourceName(entry.key), entry.name, entry.key);
    }
    /* AN UNKNOWN KEY RENDERS AS THE KEY. A source the vocabulary has not been
       taught yet is still a source whose figures are true: inventing a name
       would be a fabrication, and dropping the card would hide real data. */
    assert.equal(sourceName('a-source-the-file-does-not-name'), 'a-source-the-file-does-not-name');
    const card = tokenCards([{ label: 'a-source-the-file-does-not-name', windows: [] }]).find(
      (candidate) => candidate.key === 'source-a-source-the-file-does-not-name'
    );
    assert.equal(card.label, 'a-source-the-file-does-not-name');
    // The file is what the module reads, not a copy of it.
    assert.match(helper, /config\/sources\.json/, 'the adapter transcribes the source vocabulary');
    assert.equal(sourceVocabulary.schema, 'usage-sources/v1');
  });

  it('names the commits section\u2019s token segments through the same one function', () => {
    /* One resolver, three surfaces (issue #311): the board's source card, the
       models heading above its split, and the calendar segment a reader
       presses all print the same words, because all three ask sourceName. */
    assert.equal(tokenSetLabel(firstSource.key), `Tokens · ${firstSource.name}`);
    assert.equal(tokenSetLabel('a-source-the-file-does-not-name'), 'Tokens · a-source-the-file-does-not-name');
  });

  it('never lets color carry the meter alone: the graphic is hidden, the value visible', () => {
    /* THE METER SURVIVED BOTH REDESIGNS. It sits under a source card's
       lifetime figure, and every property this pin protects is unchanged: the
       fill is decorative, the true reading is printed beside it, the period it
       measures is printed under it, and the fill saturates while the reading
       does not. Dropping the meter with the squares would have been the
       redesign quietly losing a capability rather than restyling one. */
    assert.match(component, /class="board-meter" data-severity=\{card\.meter\.severity\}/);
    assert.match(component, /class="board-meter-reading">\{card\.meter\.reading\}/);
    assert.match(component, /class="board-meter-label">\{card\.meter\.label\}/);
    // The reading beside the fill is the true figure through the tested
    // renderer, and the fill saturates while the reading does not.
    const cards = tokenBoardProps(envelopeFor(shippedPayload)).cards;
    const first = cards.find((card) => card.key === `source-${firstSource.key}`);
    assert.equal(first.meter.reading, formatUtilization(36.4));
    assert.equal(first.meter.severity, meterSeverity(36.4));
    assert.equal(first.meter.fillPct, meterFillPct(36.4));
    const reset = resetsIn('2026-08-11T07:00:00Z');
    assert.equal(first.meter.label, reset === '' ? 'session' : `session · ${reset}`);
    // A source whose only window reports no utilization draws no meter at
    // all: a bar at zero and a bar for a figure nobody reported are the same
    // picture, and only one of them is true.
    const second = cards.find((card) => card.key === `source-${secondSource.key}`);
    assert.equal(second.meter, undefined);
  });

  it('renders honest empty states for a refused payload and for a sourceless card', () => {
    /* Two empty faces: the board's own note for a payload that produced no
       cards, and a card's own note for a source with nothing to say. Both are
       ADAPTER words, so the component states neither. */
    assert.match(component, /<p class="board-note">\{emptyNote\}<\/p>/);
    assert.match(component, /\{#if card\.note\}<span class="board-card-note">\{card\.note\}<\/span>\{\/if\}/);
    assert.equal(boardEmptyNote, tokenUsageEmptyNote);
    assert.equal(tokenUsageEmptyNote, 'No usage data available.');
    assert.equal(tokenBoardProps(envelopeFor(null)).cards.length, 0);
    const bare = tokenCards([{ label: 'bare', windows: [] }]);
    const bareSource = bare.find((card) => card.key === 'source-bare');
    assert.equal(bareSource.facts, undefined, 'a source with nothing to show must list no facts');
    assert.equal(bareSource.figure, unknownFigure);
    assert.equal(bareSource.note, tokenUsageSourceEmptyNote);
    assert.equal(tokenUsageSourceEmptyNote, 'No usage recorded for this source yet.');
    /* AND THE DASH IS THE PAGE'S ONE MARK, not two hyphens beside a column of
       real figures (owner directive, 2026-09-11). */
    assert.equal(unknownFigure, '\u2014');
  });

  it('reads every color from a custom property, and the severity ramp with no fallback at all', () => {
    assert.doesNotMatch(component, /#[0-9a-fA-F]{3,8}\b/, 'raw hex colors defeat theme overrides');
    assert.doesNotMatch(chart, /#[0-9a-fA-F]{3,8}\b/, 'the daily line states a colour of its own');
    /* The board sits on the ledger's own sheet, so its neutrals are the card's
       own --board-* roles (declared in styles.css, remapped by the turn) and
       the meter's three status inks. The claim is unchanged — every colour
       here is a token read, so a reading mode restyles the board without this
       file knowing a mode exists. */
    for (const token of ['--board-', '--usage-meter-ok', '--usage-meter-warning', '--usage-meter-critical']) {
      assert.match(
        component,
        new RegExp(`var\\(\\s*${token}`),
        `component styles must read var(${token}\u2026) so themes can override it`
      );
    }
    /* RE-AIMED, not relaxed (issues 222 and 229). All three severities read
       one declared meter token each, so the ramp is a palette decision in
       styles.css rather than a chain that quietly repaints itself when a link
       is missing. The three reads must carry NO comma: a fallback would
       restore the hiding place, since a fallback paints and so a missing
       declaration looks like nothing at all. */
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
    /* The CSP floor (default-src 'self' admits no style attribute): a bar's
       fill, the daily line's end mark, the scrubber's cursor and the height
       the sub area reserves are the genuinely dynamic lengths on this
       surface, and each reaches the DOM as a custom property Svelte writes
       with setProperty rather than as a style string. Everything else —
       which card is inverted, which severity paints, how many fact columns,
       whether a cursor is lit — is a closed-set data attribute. */
    assert.match(component, /style:--board-fill=\{`\$\{row\.fillPct\}%`\}/);
    assert.match(component, /style:--board-fill=\{`\$\{card\.meter\.fillPct\}%`\}/);
    assert.match(component, /style:--board-sub-lines=\{card\.sub\?\.length \?\? 1\}/);
    assert.match(chart, /style:--spark-mark-x=\{`\$\{path\.last\.x\}%`\}/);
    assert.match(chart, /style:--spark-mark-y=\{`\$\{path\.last\.y\}%`\}/);
    assert.match(chart, /style:--spark-cursor-x=\{`\$\{point\?\.x \?\? 0\}%`\}/);
    assert.match(chart, /style:--spark-cursor-y=\{`\$\{point\?\.y \?\? 0\}%`\}/);
    for (const [name, source] of Object.entries({ component, chart })) {
      assert.doesNotMatch(source, /\sstyle="/, `${name}: a static style attribute is exactly what the CSP forbids`);
      assert.doesNotMatch(source, /style=\{/, `${name}: a whole-attribute style expression is blocked by the CSP`);
      assert.doesNotMatch(source, /cssText/, `${name}: cssText writes the same blocked attribute by another name`);
    }
  });

  it('inverts by remapping one token set, with no second face left in the DOM', () => {
    /* THE INVERSION IS ONE TOKEN REMAP (owner directive, 2026-09-11). The
       two-face machinery is gone with the reasons it existed: a rotated
       pivot, the backface cull, the WebKit visibility swap, the aria-hidden
       on whichever face was turned away, and the fixed box that clipped
       whatever the far face could not fit. What replaces all of it is one
       [data-turned] rule remapping the card's own paper and ink roles, so
       nothing is hidden and nothing can be hidden by accident. */
    for (const gone of ['board-pivot', 'board-face', 'data-face', 'rotateY', 'backface-visibility', 'perspective']) {
      assert.ok(!component.includes(gone), `the component still carries ${gone}`);
      assert.ok(!sheet.includes(gone), `the sheet still carries ${gone}`);
    }
    assert.ok(!sheet.includes('--flip-duration'), 'the flip duration outlived the flip');
    assert.match(
      sheet,
      /\.board-card \{[^}]*--board-paper: var\(--ledger-bg\);[\s\S]*?--board-ink: var\(--ledger-ink\)/,
      'a card in the paper state must declare the roles the inversion swaps'
    );
    assert.match(
      sheet,
      /\.board-card\[data-turned='true'\] \{[^}]*--board-paper: var\(--ledger-ink\);[\s\S]*?--board-ink: var\(--ledger-bg\)/,
      'the inversion must be one token remap, not a rule per painted thing'
    );
  });

  it('offers nothing to press, and paints the inversion the adapter composed', () => {
    /* "THESE SHOULDN'T CHANGE COLOUR WHEN I CLICK ON THEM" (owner directive,
       2026-09-11, issue 316). The press revealed nothing — one face, one
       token remap — so the whole control is gone: no button, no pressed
       state, no click, and no state for a click to change. What stays is the
       RHYTHM, which was always the adapter's: every second source card is
       drawn inverted, and no reader can move it. */
    const markup = rendered(component);
    assert.ok(!markup.includes('<button'), 'the board grew a control again');
    assert.ok(!markup.includes('aria-pressed'), 'a card still announces a pressed state');
    assert.ok(!markup.includes('onclick'), 'a card still takes a click');
    assert.match(component, /<div\s+class="board-card"/);
    assert.match(component, /data-turned=\{card\.turned \? 'true' : 'false'\}/);
    /* The inversion is READ from the card the adapter composed rather than
       held in the component: a Set keyed by card is exactly the machinery the
       owner asked to be removed, and the turn vocabulary went with it. */
    assert.doesNotMatch(component, /new Set\(/, 'the component kept a per-card state set');
    assert.doesNotMatch(component, /turnLabel|returnLabel/, 'the turn vocabulary outlived the turn');
    assert.doesNotMatch(helper, /boardTurnLabel|boardReturnLabel/, 'the adapter still writes turn copy');

    /* EVERY SECOND SOURCE CARD IS INVERTED. It is the board's rhythm rather
       than a fact about any source, which is what makes a third source join
       that rhythm instead of needing a rule of its own. */
    const cards = tokenBoardProps(envelopeFor(shippedPayload)).cards;
    assert.deepEqual(
      cards.filter((card) => card.key.startsWith('source-')).map((card) => card.turned === true),
      [false, true]
    );
    const three = tokenCards([
      { label: 'a', windows: [] },
      { label: 'b', windows: [] },
      { label: 'c', windows: [] }
    ]);
    assert.deepEqual(
      three.filter((card) => card.key.startsWith('source-')).map((card) => card.turned === true),
      [false, true, false]
    );
    assert.ok(
      cards.filter((card) => !card.key.startsWith('source-')).every((card) => card.turned === undefined),
      'only the source cards carry the board\u2019s alternating rhythm'
    );
    // Every card still names itself, so the box a reader lands in is named.
    for (const card of cards) {
      assert.ok(card.ariaLabel.trim().length > 0, card.key);
    }
    assert.match(component, /aria-label=\{card\.ariaLabel\}/);
  });

  it('puts the board\u2019s one target on the daily line, for a finger and a keyboard alike', () => {
    /* THE CARD IS NOT A CONTROL AND THE CHART IS (issue 316). The touch floor
       moves with the interaction: the line is declared taller than the floor
       before the card's padding is pulled back around it, it takes a focus
       stop, and it hands the page its vertical scroll rather than swallowing
       it. */
    assert.match(chart, /role="slider"/);
    assert.match(chart, /tabindex="0"/);
    assert.match(chart, /onkeydown=\{onKeydown\}/);
    /* The pointer half is the gesture layer's, which is what keeps this
       component from being a second implementation of whose gesture a finger
       belongs to (tests/gesture.test.mjs owns that sweep). */
    assert.match(chart, /use:scrubAlong=\{scrubBinding\}/);
    assert.match(sheet, /\.spark \{[^}]*touch-action: pan-y/);
    assert.match(sheet, /\.spark:focus-visible \{[^}]*outline: 2px solid var\(--color-accent\)/);
    const plot = /--spark-height: ([\d.]+)rem;/.exec(sheet);
    const target = /--control-target: ([\d.]+)rem;/.exec(sheet);
    assert.ok(plot && target, 'the chart height and the touch floor must both be declared lengths');
    assert.ok(
      Number(plot[1]) >= Number(target[1]),
      `the daily line is ${plot[1]}rem against a ${target[1]}rem touch floor`
    );
    /* The card keeps a stated minimum for the GRID's sake — an automatic
       minimum of min-content drags the board past its own column — which is a
       different claim from the one above and is asserted as its own. */
    assert.match(sheet, /\.board-card \{[^}]*min-inline-size: var\(--control-target\)/);
    assert.match(sheet, /\.board-card \{[^}]*min-block-size: var\(--control-target\)/);
  });

  it('prints no hint, no chip and no caption on the board or its shell', () => {
    /* THE BOARD SAYS WHAT IT MEASURED AND NOTHING ELSE (owner directive,
       2026-09-11): no turn hint beside the cards, no refresh or records or
       categories chip, no caption under a chart, and no legend spelling the
       accounting classes out a second time. Swept over the component, the
       adapter and the sheet together, because a retired chrome word coming
       back through any one of the three is the same regression. */
    /* Read with the comments stripped: this file's subject is what the page
       PRINTS, and a comment recording that a chip was retired is the opposite
       of the chip coming back. */
    for (const [name, source] of Object.entries({ component, helper, chart })) {
      for (const chrome of [
        'turnhint',
        'turn-hint',
        'press a card',
        'refresh',
        "'Records'",
        "'Categories'",
        'in · out · cache',
        'both sources',
        '72 days'
      ]) {
        assert.ok(
          !rendered(source).toLowerCase().includes(chrome.toLowerCase()),
          `${name} prints the retired chrome "${chrome}"`
        );
      }
    }
  });

  it('stays local-origin like every shipped source file', () => {
    for (const [name, source] of Object.entries({ component, commits, helper, chart })) {
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
       2026-09-03, issue 287, and again on 2026-09-11): tokenUsage →
       tokenSquares → tokenBoard, UsageTracker → LedgerBoard. The PANEL ID is
       untouched, which is the half that matters — the wire contract did not
       move, only the rendering did. The canonical whole-section listing lives
       in panels-ui.test.mjs. */
    const importLines = manifest.match(/^import \{ tokenBoard \} from '\.\/lib\/blocks\/tokenBoard\.ts';$/gm);
    assert.equal(importLines?.length, 1, 'exactly one import line for the token block');
    const body = manifest.replace(/^import[^\n]*\n/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(
      (body.match(/\btokenBoard\b/g) ?? []).length,
      1,
      'the manifest lists the token block exactly once'
    );
    assert.match(
      binding,
      /panelBlock\(\s*'token-board',\s*LedgerBoard,\s*tokenUsagePanelId,\s*\(envelope\) => tokenBoardProps\(envelope\)\s*\)/
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
    assert.equal(formatStatValue(null, 'tokens'), unknownFigure);
    assert.equal(formatStatValue(null, 'days'), unknownFigure);
    assert.equal(formatStatValue(null, 'count'), unknownFigure);
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

describe('the board of cards: live surface', () => {
  it('keeps itself current through the block host instead of painting once at mount', () => {
    // The subscription moved to the ONE host every panel block shares
    // (issue 165): Block.svelte runs watchPanel and re-runs this adapter on
    // every envelope, so a panel cannot drift into a one-shot read of its
    // own. The component itself fetches nothing.
    for (const [name, source] of Object.entries({ component, commits, chart })) {
      assert.doesNotMatch(source, /onMount/, `${name}: a one-shot mount read is the bug this panel had`);
      assert.doesNotMatch(
        source,
        /watchPanel|loadPanel|fetch\(/,
        `${name} reads the wire itself; the block host does that`
      );
    }
  });

  it("renders the owner's board: three across, folding to one on a phone", () => {
    /* THE BOARD IS A LADDER OF THE SHEET'S OWN BREAKPOINTS (owner directive,
       2026-09-11). One column is the base, two from the width the chrome row
       stops being a phone's, three from the width the rails appear at — and
       no new breakpoint, because a sheet with a second max-width boundary is
       a sheet whose parts disagree about where a phone ends (the pin in
       tests/sections.test.mjs states that in full).

       The row height is the tallest card in the row and never less than the
       declared minimum, which is what replaced the fixed square: a card that
       has more to say is taller instead of clipping what it cannot fit. */
    assert.match(sheet, /\.board-grid \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    assert.match(
      sheet,
      /@media \(min-width: 45\.0625rem\) \{\s*\.board-grid \{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/
    );
    assert.match(
      sheet,
      /@media \(min-width: 67\.5rem\) \{\s*\.board-grid \{\s*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/
    );
    assert.match(sheet, /\.board-grid \{[^}]*grid-auto-rows: minmax\(var\(--board-card-min\), auto\)/);
    /* The headline is the card's own figure, or the scrubbed day's while a
       reader is on the line — one element either way, so the swap costs the
       card no box (issue 316). */
    assert.match(
      component,
      /class="board-figure">\{scrubbed \? scrubbed\.figure : card\.figure\}/
    );
    // The figure the card shows is the tested renderer's, via the adapter.
    const payload = {
      sources: [
        {
          label: 'fixture',
          windows: [],
          stats: [{ key: 'lifetime', label: 'Lifetime tokens', value: 22_700_000_000, unit: 'tokens', recorded: true }]
        }
      ]
    };
    const cards = tokenBoardProps(envelopeFor(payload)).cards;
    const source = cards.find((card) => card.key === 'source-fixture');
    assert.equal(source.figure, formatStatValue(22_700_000_000, 'tokens'));
    assert.equal(source.label, 'fixture');
    // The whole-board total is the same figure summed across sources, through
    // the same renderer — never a second formatter.
    assert.equal(cards[0].figure, formatTokenCount(22_700_000_000));
    assert.equal(cards[0].label, totalCardLabel);
    assert.equal(cards[0].ctx, lifetimeContext);
  });

  it('draws every model row without a provenance mark, whatever the source mixes', () => {
    /* The per-row mark, and the sentence it used to decide, left the page with
       the owner's directive of 2026-09-06 (issue 299): provenance stays in
       the payload's `recorded` flags and the board prints nothing for it. The
       ungated forms this page retired earlier are still named exactly, in
       every component, because any one of them returning is the regression. */
    for (const [name, source] of Object.entries({ component, commits, chart })) {
      assert.doesNotMatch(source, /\{#if stat\.recorded\}|\{#if tile\.recorded\}/, name);
      assert.doesNotMatch(source, /\{#if insight\.recorded\}/, name);
    }
    // EXECUTED on the case that used to mark: a source mixing recorded and
    // live figures yields rows that carry no mark at all — not `false`, no
    // such field — so a component could not render one even by accident.
    const [member] = vocabulary.groups[0].members;
    const rows = tokenBoardProps(
      envelopeFor({
        sources: [
          {
            label: 's',
            windows: [],
            series: {
              startDate: '2026-08-10',
              totals: [4],
              recorded: true,
              models: [{ key: member.key, totals: [4] }]
            }
          }
        ]
      })
    ).cards.find((card) => card.key === 'models-s').models;
    assert.deepEqual(Object.keys(rows[0]).sort(), ['detail', 'fillPct', 'key', 'label', 'reading']);
    assert.equal(rows[0].detail, undefined);
    // A figure the payload does not carry is the dash on the card's face,
    // never a zero.
    const nothing = tokenCards([{ label: 's', windows: [] }]);
    assert.equal(nothing.find((card) => card.key === 'source-s').figure, unknownFigure);
    assert.equal(nothing.find((card) => card.key === 'sessions').figure, unknownFigure);
    assert.equal(nothing.find((card) => card.key === 'tracked').figure, unknownFigure);
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
       still reaches the page through the board's own card, which is the half
       of the ruling that keeps this from being a way to hide a source. */
    assert.ok(
      tokenBoardProps(
        {
          schema: 'panel/v1',
          id: 'token-usage',
          kind: 'token-usage/v2',
          title: 'Token usage',
          status: 'ok',
          data: { sources: [{ label: 's', windows: [] }] }
        },
        new Date('2026-08-27T12:00:00Z')
      ).cards.some((card) => card.label.toLowerCase().includes('s')),
      'a source with no series lost its card as well as its calendar'
    );
    const drawn = commitLogProps(
      tokenOnly({ sources: [{ label: 's', windows: [], series: { startDate: '2026-08-01', totals: [1, 2, 3] } }] })
    );
    const set = drawn.sets.find((set) => set.key === 's');
    assert.equal(set.noun, 'token');
    assert.equal(set.stripLabel, `${sourceName('s')} token calendar: daily totals, newest last`);
    assert.ok(set.columns.length > 0, 'a real series draws its window');
    /* THE READING IS BUILT FROM THE DAYS THE PAYLOAD ACTUALLY CARRIES, never
       from a sentence an adapter guessed at (issue 158's finding, carried
       through the move): the sum, the day count, the peak and the last day
       covered are all measured from the same totals the grid draws. */
    assert.equal(set.caption, `${formatMagnitude(6)} tokens over 3 days · peak ${formatMagnitude(3)} · data through 2026-08-03`);
    // A windowless, statless source still states its honest empty face on its
    // own card; a source with figures does not.
    const board = tokenBoardProps(envelopeFor({ sources: [{ label: 's', windows: [] }] }));
    assert.equal(board.cards.find((card) => card.key === 'source-s').note, tokenUsageSourceEmptyNote);
    const withWindows = tokenBoardProps(envelopeFor(shippedPayload));
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
    // Token sets lead and contributions closes the row (owner directive,
    // 2026-09-04, issue 294); neither fixture label is the lead source, so
    // the two keep their payload order.
    const [first, second, contributions] = props.sets;
    assert.equal(contributions.key, 'contributions');
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
  it('keeps the breakdown a delivered reading, with nothing to resolve it with', () => {
    /* The categories are the calendar's own breakdown now: the board's cards
       print the four accounting classes as LIFETIME stats (the source card)
       and as a model's own accounting (the models card), and neither is a
       question a reader answers. The shares helper stays the one place a
       served row becomes a proportion, and the retired resolver stays retired.

       A named category reads its OWN dailies, summed from the served row:
       cache-read is 9+18+27 of a 60-token series, input is 1+2+3. */
    const shares = categoryShares(series);
    assert.deepEqual(
      shares.map((share) => [share.key, share.total, share.pct]),
      [
        ['input', 6, 10],
        ['cache-read', 54, 90]
      ],
      'the served order is the delivered order, and each row sums its own days'
    );
    /* A category this source does not report has no entry at all, which is
       what keeps the reading a statement about real data rather than a table
       of zeroes for classes nobody used. */
    assert.equal(shares.find((share) => share.key === 'reasoning'), undefined);
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
    assert.equal(formatShare(null), unknownFigure);
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

  it('holds the model window to the eight-week budget the Go boundary enforces', () => {
    // The same sixth rule the origin applies (maxModelDays in
    // internal/panels/types.go), mirrored per the 2026-08-27 adversarial
    // review of PR #230 (finding 4). A 57-day series: the models section
    // may cover its trailing 56 days, not all 57 — while the categories
    // breakdown answers to the series bound alone, exactly as in Go. The
    // budget was a quarter until the vocabulary gained a second vendor group
    // (issue #302), and ten weeks until the sealed ceiling needed its further
    // digit (issue #267): a row costs one integer per day per member, and the
    // ceiling is never the lever; the window is.
    const days = 57;
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
      56
    );
    assert.deepEqual(
      tokenUsageSources(series({ models: [{ key: 'opus-5', totals }] })),
      []
    );
    assert.deepEqual(
      tokenUsageSources(
        series({ categories: [{ key: 'input', totals }] })
      )[0]?.series?.categories?.[0]?.totals?.length,
      57
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
    // The residual member draws the neutral slot (issue 299): it is the fold
    // of every identifier the vocabulary does not name, not an entity, and
    // the chromatic slot it held went to the member that joined beside it.
    assert.equal(modelSlot('other'), 0);
    assert.equal(modelSlot('fable-5'), 2);
    assert.equal(modelSlot('fable-5-1'), 1);
    assert.equal(modelSlot('opus-5'), 3);
    assert.equal(modelSlot('sonnet-5'), 4);
    assert.equal(modelSlot('opus-4-8'), 5);
    assert.equal(modelSlot('opus-9'), 0);
    // Every REAL member owns a chromatic slot, and no two share one.
    const chromatic = ['fable-5', 'fable-5-1', 'opus-5', 'sonnet-5', 'opus-4-8'].map(modelSlot);
    assert.deepEqual([...new Set(chromatic)].sort(), [1, 2, 3, 4, 5]);
  });

  it('writes a model name rather than humanizing its key', () => {
    // The reason the labels are a table and the categories are a
    // transformation: `opus-4-8` humanizes to "opus 4 8", which is not the
    // product's name. Keys stay machine-shaped on the wire because the
    // producer's emission guard admits nothing else.
    assert.equal(modelLabel('opus-4-8'), 'Opus 4.8');
    assert.equal(modelLabel('fable-5'), 'Fable 5');
    assert.equal(modelLabel('fable-5-1'), 'Fable 5.1');
    assert.equal(modelLabel('other'), 'Other');
    // Every member of the vocabulary has a written form. The fallback returns
    // the key, so a member missing from the label table would render a
    // machine identifier in public copy — this is the assertion that makes
    // the fallback defense rather than a supported spelling.
    for (const key of ['other', 'fable-5', 'fable-5-1', 'opus-5', 'sonnet-5', 'opus-4-8']) {
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

describe('the model vocabulary is one data file', () => {
  /* Issue #302 retired three hand-kept tables — the capture tool's
     MODEL_KEYS, the origin's serve order and this module's slot table —
     and the regex parity test that compared them. What is left to pin is
     that this consumer's view IS the file, member for member, in the file's
     own order. The scripts/ci suite pins the same for the producer and
     proves no production source anywhere spells a model. */

  it('resolves every member from the file it imports', () => {
    assert.ok(vocabularyMembers.length > 6, 'the vocabulary is too small to be interesting');
    for (const member of vocabularyMembers) {
      assert.equal(modelSlot(member.key), member.slot, member.key);
      assert.equal(modelLabel(member.key), member.label, member.key);
    }
    assert.equal(modelSlot(vocabulary.residual.key), vocabulary.residual.slot);
    assert.equal(modelLabel(vocabulary.residual.key), vocabulary.residual.label);
    /* THE VENDOR GROUP IS NO LONGER READ ANYWHERE (owner directive,
       2026-09-11): a models card is headed by the SOURCE whose split it
       draws, so the group's written name, its declared row reserve and the
       "which group is present" walk went with the blocks they headed. The
       groups are still the file's own structure and still what gives each
       member its slot; nothing on the page asks which one a member belongs
       to, and nothing in this module can answer. */
    for (const gone of ['modelGroup', 'modelGroupLabel', 'modelGroupRows', 'modelGroupKeys']) {
      assert.ok(!helper.includes(`export function ${gone}`), `${gone} outlived the blocks it headed`);
    }
  });

  it('keeps every named member on its own chromatic slot inside its group', () => {
    for (const group of vocabulary.groups) {
      const slots = group.members.map((member) => modelSlot(member.key));
      assert.equal(new Set(slots).size, slots.length, group.key);
      assert.ok(
        slots.every((slot) => slot !== vocabulary.residual.slot),
        `${group.key} paints a member with the residual's neutral slot`
      );
    }
  });

  it('declares every reading mode a swatch for every slot it can hand out', () => {
    /* A member whose slot has no declared token would silently draw the
       residual's neutral, which is the one colour that means "we could not
       attribute this". The stylesheet must therefore cover every slot the
       vocabulary can return, in every reading mode. */
    const slots = new Set([
      vocabulary.residual.slot,
      ...vocabularyMembers.map((member) => member.slot)
    ]);
    for (const slot of slots) {
      assert.match(sheet, new RegExp(`--usage-cat-${slot}: var\\(--color-cat-${slot}\\)`));
      for (const mode of ['light', 'dark', 'slate', 'sepia']) {
        assert.match(sheet, new RegExp(`--palette-${mode}-cat-${slot}: #[0-9a-f]{6}`));
      }
      assert.match(
        sheet,
        new RegExp(`--color-cat-${slot}: var\\(--palette-light-cat-${slot}\\)`)
      );
    }
  });
});

describe('the models card is one card per source', () => {
  /* Issues #302 and #311. A models card draws ONE SOURCE'S split, headed by
     that source's written name from the vocabulary file. It used to be headed
     by the VENDOR GROUP, on the reasoning that a group names whose models the
     numbers measure while an operator-typed label names where they were
     captured — and the source label is no longer operator-typed: it is a key
     the vocabulary resolves, so the heading names a source the reader knows
     by the same word the card above it uses.

     Every fixture below builds its members FROM the vocabulary, so these pins
     say something about the rule rather than about a list transcribed twice. */

  const keysOf = (group) => group.members.map((member) => member.key);

  /* A payload whose every member carries the same non-zero row, partitioning
     the series exactly. Rows of zeroes are refused (see below), so a fixture
     cannot pad a card with placeholders even by accident. */
  const carrying = (blocks) => ({
    sources: blocks.map(({ label, keys }) => ({
      label,
      windows: [],
      series: {
        startDate: '2026-08-10',
        totals: [keys.length, keys.length * 2, keys.length * 3],
        recorded: true,
        models: keys.map((key) => ({ key, totals: [1, 2, 3] }))
      }
    }))
  });

  const cardsOf = (payload) => tokenBoardProps(envelopeFor(payload)).cards;
  const modelCards = (payload) =>
    cardsOf(payload).filter((card) => card.key.startsWith('models-'));

  it('heads each card with its source\u2019s written name, one card per source', () => {
    const [first, second] = vocabulary.groups;
    const cards = modelCards(
      carrying([
        { label: firstSource.key, keys: keysOf(first) },
        { label: secondSource.key, keys: keysOf(second) }
      ])
    );
    assert.equal(cards.length, 2, 'each source that has a split gets its own card');
    assert.equal(cards[0].label, `Models · ${firstSource.name}`);
    assert.equal(cards[1].label, `Models · ${secondSource.name}`);
    assert.equal(cards[0].ariaLabel, `Model split for ${firstSource.name}`);
    /* Neither the wire key nor the vendor group reaches the heading. */
    for (const heading of cards.map((card) => card.label)) {
      assert.doesNotMatch(heading, new RegExp(first.label));
      assert.doesNotMatch(heading, new RegExp(second.label));
    }
  });

  it('renders exactly the members the envelope carries, in the vocabulary\u2019s order', () => {
    const [group] = vocabulary.groups;
    /* Served BACKWARDS, so the order below is the vocabulary's rule rather
       than the payload's accident. */
    const keys = keysOf(group).slice(0, 3).reverse();
    const [card] = modelCards(carrying([{ label: 'a-capture-tool', keys }]));
    assert.equal(card.models.length, keys.length);
    assert.deepEqual(
      card.models.map((row) => row.label),
      keysOf(group).slice(0, 3).map(modelLabel),
      'the rows are laid out in the vocabulary\u2019s serve order, not the payload\u2019s'
    );
    for (const row of card.models) {
      assert.notEqual(row.reading, '0%');
      assert.ok(row.fillPct > 0, row.reading);
    }
  });

  it('runs the longest row the card\u2019s full width and reads the rest against it', () => {
    /* MEMBER AGAINST THE LARGEST MEMBER, on both kinds of card, so the longest
       rule always spans the card and the number beside each row is what says
       how much of the whole it was. */
    const [group] = vocabulary.groups;
    const [big, small] = keysOf(group);
    const [card] = modelCards({
      sources: [
        {
          label: 'a-capture-tool',
          windows: [],
          series: {
            startDate: '2026-08-10',
            totals: [5],
            recorded: true,
            models: [
              { key: big, totals: [4] },
              { key: small, totals: [1] }
            ]
          }
        }
      ]
    });
    const rank = (key) => card.models.find((row) => row.key === key);
    assert.equal(rank(big).fillPct, 100);
    assert.equal(rank(small).fillPct, 25);
    /* Without a lifetime accounting the reading is the WINDOW TOTAL, compact —
       a share of a window is a different quantity from a share of a lifetime,
       and printing them in the same units on two neighbouring cards would
       invite exactly the comparison that is false. */
    assert.equal(rank(big).reading, formatTokenCount(4));
    assert.equal(rank(small).reading, formatTokenCount(1));
    assert.equal(rank(big).detail, undefined);
  });

  it('reads shares and the accounting behind them when the source reports lifetimes', () => {
    const [group] = vocabulary.groups;
    const [big, small] = keysOf(group);
    const stat = (key, totals) => ({ key, totals });
    const [card] = modelCards({
      sources: [
        {
          label: 'a-capture-tool',
          windows: [],
          modelStats: [
            stat(big, { input: 1, output: 2, 'cache-read': 60, 'cache-write': 7 }),
            stat(small, { input: 1, output: 1, 'cache-read': 8, 'cache-write': 0 })
          ]
        }
      ]
    });
    /* 70 and 10 of 80: the share is the member's own four classes against the
       sum of every member's. */
    assert.deepEqual(
      card.models.map((row) => [row.label, row.reading, row.fillPct]),
      [
        [modelLabel(big), formatShare(87.5), 100],
        [modelLabel(small), formatShare(12.5), (10 / 70) * 100]
      ]
    );
    assert.equal(
      card.models[0].detail,
      `in ${formatTokenCount(1)} · out ${formatTokenCount(2)} · cache ${formatTokenCount(60)} / ${formatTokenCount(7)}`
    );
    // The lifetime accounting OUTRANKS the window when a source has both.
    const both = modelCards({
      sources: [
        {
          label: 'a-capture-tool',
          windows: [],
          modelStats: [stat(big, { input: 0, output: 0, 'cache-read': 1, 'cache-write': 0 })],
          series: {
            startDate: '2026-08-10',
            totals: [9],
            models: [{ key: small, totals: [9] }]
          }
        }
      ]
    });
    assert.deepEqual(both[0].models.map((row) => row.label), [modelLabel(big)]);
  });

  it('drops the residual and every member that carried nothing', () => {
    /* The residual is not an entity: it is the fold of every identifier the
       vocabulary does not name, and a rule beside named models would read as
       one more model. A member that carried NOTHING is dropped for the
       opposite reason — a named entity drawn at nought beside entities that
       were actually used is a row saying something the data never said.

       Dropping the empty rows is also what makes the bar arithmetic total:
       every remaining member has a positive total, so the largest is
       positive, so no row can be handed a proportion it would have to decline
       to draw. */
    const [group] = vocabulary.groups;
    const keys = [vocabulary.residual.key, ...keysOf(group).slice(0, 1)];
    const [card] = modelCards(carrying([{ label: 'a-capture-tool', keys }]));
    assert.deepEqual(
      card.models.map((row) => row.label),
      [modelLabel(keys[1])],
      'the residual reached a card as though it were a model'
    );
    // A lifetime accounting whose member carried nothing is not a row to
    // drop but a payload to REFUSE: the origin refuses such a member whole
    // (a sum of nothing), so a page that drew the rest would be drawing a
    // document the origin never serves (PR #312 round 2, finding 3).
    assert.deepEqual(
      modelCards({
        sources: [
          {
            label: 'a-capture-tool',
            windows: [],
            modelStats: [
              { key: keys[1], totals: { input: 1, output: 0, 'cache-read': 0, 'cache-write': 0 } },
              {
                key: keysOf(group)[1],
                totals: { input: 0, output: 0, 'cache-read': 0, 'cache-write': 0 }
              }
            ]
          }
        ]
      }),
      [],
      'a member carrying nothing must refuse the payload, not lose a row'
    );
  });

  it('folds an unnamed identifier into the residual, which never renders and never leaves the total', () => {
    /* "I AM NOT SURE THIS IS A REAL MODEL?" (owner directive, 2026-09-11,
       issue 316). A feature identifier the Codex journals record where a
       model id normally sits was rendering as a model row, so it left the
       vocabulary; the producer folds every identifier the file does not name
       into the residual, and THIS is what the page then does with it.

       The claim has two halves and both are checked, because passing one
       alone would be a different bug: the residual draws no row beside real
       members, and the SOURCE TOTAL is untouched — the daily series is the
       source's own measurement and a member leaving the vocabulary must never
       reduce it. */
    const [group] = vocabulary.groups;
    const named = keysOf(group).slice(0, 2);
    const payload = carrying([
      { label: 'a-capture-tool', keys: [vocabulary.residual.key, ...named] }
    ]);
    const cards = cardsOf(payload);
    const [card] = cards.filter((entry) => entry.key.startsWith('models-'));
    assert.deepEqual(
      card.models.map((row) => row.key),
      named,
      'the residual drew a row beside real models'
    );
    assert.ok(
      !card.models.some((row) => row.label === vocabulary.residual.label),
      'the residual reached a models card by its written name'
    );
    /* The source's own line still carries every token the payload reported,
       residual included: `carrying` sums one row per key into each day, so a
       fold that was DROPPED rather than folded would show here as a shorter
       total. */
    const source = cards.find((entry) => entry.key === 'source-a-capture-tool');
    assert.deepEqual(source.spark.totals, [3, 6, 9]);
    assert.deepEqual(
      source.spark.dayFigures,
      [3, 6, 9].map((value) => formatTokenCount(value))
    );
  });

  it('renders no card at all when a source has nothing to split', () => {
    /* A card saying "all of it was something we cannot name" is the aggregate
       above it with extra steps, and the producer already omits the section
       for exactly this case. */
    const cards = cardsOf(carrying([{ label: 'a-capture-tool', keys: [vocabulary.residual.key] }]));
    assert.deepEqual(cards.filter((card) => card.key.startsWith('models-')), []);
    /* The rest of the board is untouched: this is a missing card, never a
       missing panel. */
    assert.ok(cards.length > 0);
    // A source with neither a partition nor a lifetime accounting: same answer.
    assert.deepEqual(modelCards({ sources: [{ label: 's', windows: [] }] }), []);
    // And the frozen insight set is NOT a fallback any more (owner directive,
    // 2026-09-11: ignore insights entirely).
    assert.deepEqual(
      modelCards({
        sources: [{ label: 's', windows: [], insights: [{ label: 'Frozen', pct: 100 }] }]
      }),
      []
    );
    assert.doesNotMatch(helper, /insightBar/, 'the insight row builder came back');
  });

  it('refuses a member that carries nothing across the window it covers', () => {
    /* Defence in depth: the producer omits such a row and the origin refuses
       the document, so a payload carrying one reached the browser past two
       boundaries that both say no. The claim that a placeholder cannot be
       rendered has to survive a regression in either of them. */
    const [group] = vocabulary.groups;
    const [alive, hollow] = keysOf(group);
    assert.deepEqual(
      tokenUsageSources({
        sources: [
          {
            label: 'a-capture-tool',
            windows: [],
            series: {
              startDate: '2026-08-10',
              totals: [1, 2, 3],
              recorded: true,
              models: [
                { key: alive, totals: [1, 2, 3] },
                { key: hollow, totals: [0, 0, 0] }
              ]
            }
          }
        ]
      }),
      []
    );
  });

  it('never encodes a share by colour alone', () => {
    /* The dataviz floor, carried onto the rows: every one prints its own name
       and its own reading beside the rule, and the rule is the redundant
       channel. */
    assert.match(component, /class="board-model-name">\{row\.label\}/);
    assert.match(component, /class="board-reading">\{row\.reading\}/);
  });
});

describe('the lifetime model accounting is admitted strictly', () => {
  /* The optional modelStats section (issue #311), held to the same
     three-state contract every other section takes and to the same closed
     membership the daily partition takes. */
  const [member, other] = vocabulary.groups[0].members;
  const full = { input: 1, output: 2, 'cache-read': 3, 'cache-write': 4 };
  const withStats = (modelStats) => ({
    sources: [{ label: 's', windows: [], modelStats }]
  });

  it('admits a well-formed section and carries it onto the source', () => {
    const [source] = tokenUsageSources(withStats([{ key: member.key, totals: full }]));
    assert.deepEqual(source.modelStats, [{ key: member.key, totals: { ...full, reasoning: 0 } }]);
  });

  it('reads the five categories as a split’s classes, reasoning among them, off the one map the parity pin holds', () => {
    /* The origin and the exporter admit a member carrying the second tool's
       reasoning class; a page that read only the four stat tiles refused the
       WHOLE payload over it (PR #312 round 2, finding 1). The list is read
       off categorySlots, which the capture suite pins to the origin's
       categoryServeOrder and the producer's CATEGORY_KEYS. */
    assert.deepEqual([...modelClassKeys], ['input', 'output', 'cache-read', 'cache-write', 'reasoning']);
    const [source] = tokenUsageSources(withStats([{ key: member.key, totals: { output: 5, reasoning: 3 } }]));
    assert.deepEqual(source.modelStats[0].totals, { input: 0, output: 5, 'cache-read': 0, 'cache-write': 0, reasoning: 3 });
    const [card] = tokenCards(tokenUsageSources(withStats([{ key: member.key, totals: { output: 5, reasoning: 3 } }])))
      .filter((entry) => entry.key === 'models-s');
    assert.ok(card, 'the split card did not render for a source whose only split carries reasoning');
    assert.equal(card.models[0].detail, 'in 0 · out 5 · reasoning 3 · cache 0 / 0');
    assert.equal(card.models[0].reading, formatShare(100));
    /* Reasoning COUNTS toward the member's total, so the shares and the
       rules are read against it: 8 against 4 is two thirds and a half-length
       rule, where a total blind to the fifth class would read 5 against 4. */
    const [shared] = tokenCards(
      tokenUsageSources(
        withStats([
          { key: member.key, totals: { output: 5, reasoning: 3 } },
          { key: other.key, totals: { output: 4 } }
        ])
      )
    ).filter((entry) => entry.key === 'models-s');
    assert.deepEqual(
      shared.models.map((row) => [row.key, row.reading, row.fillPct]),
      [
        [member.key, formatShare((8 / 12) * 100), 100],
        [other.key, formatShare((4 / 12) * 100), 50]
      ]
    );
    /* And a member that spent no reasoning prints none: the other tool's
       models never do, and a row of noughts would say nothing. */
    const [quiet] = tokenCards(tokenUsageSources(withStats([{ key: member.key, totals: full }])))
      .filter((entry) => entry.key === 'models-s');
    assert.equal(quiet.models[0].detail, 'in 1 · out 2 · cache 3 / 4');
  });

  it('refuses a member whose classes sum to nothing, by the origin’s own rule', () => {
    /* The origin refuses a member carrying nothing — a SUM, not a presence —
       and the exporter the same; the page once refused only a member naming
       no class and admitted an all-nought row (PR #312 round 2, finding 3). */
    for (const totals of [{}, { input: 0 }, { input: 0, output: 0, 'cache-read': 0, 'cache-write': 0, reasoning: 0 }]) {
      assert.deepEqual(tokenUsageSources(withStats([{ key: member.key, totals }])), [], JSON.stringify(totals));
    }
  });

  it('reads a class the member never spent as the zero the origin says it is', () => {
    /* The producer drops a nought class and the origin serves the member
       without it (its stated contract). The page used to require all four
       and refuse the WHOLE payload over such a member — the Token usage
       panel went to its empty state over data that was true (PR #312
       review, finding 1). Absence is a figure here, not a fill. */
    const [source] = tokenUsageSources(
      withStats([{ key: member.key, totals: { input: 10, output: 5, 'cache-read': 100 } }])
    );
    assert.deepEqual(source.modelStats, [
      { key: member.key, totals: { input: 10, output: 5, 'cache-read': 100, 'cache-write': 0, reasoning: 0 } }
    ]);
    const [single] = tokenUsageSources(withStats([{ key: member.key, totals: { output: 500 } }]));
    assert.deepEqual(single.modelStats[0].totals, { input: 0, output: 500, 'cache-read': 0, 'cache-write': 0, reasoning: 0 });
  });

  /* ONE SHAPE IN FOUR PLACES. The producer, the exporter's merge admission,
     the origin and this boundary each read the same fixture in their own
     tests, so a stage that drifts on the shape reddens against the file
     rather than against a sibling's memory of it. Capability-gated exactly
     as the cross-tree pins in panels-ui.test.mjs are: the image's frontend
     stage carries no internal/panels/testdata, so it skips by name there and
     runs in every full checkout. */
  const shapesUrl = new URL('../../internal/panels/testdata/model-stats-shapes.json', import.meta.url);
  const shapesNote = existsSync(shapesUrl)
    ? false
    : 'reduced build context: internal/panels/testdata is not in the frontend stage';
  it('admits and refuses exactly the class shapes the producer, exporter and origin do', { skip: shapesNote }, async () => {
    const shapes = JSON.parse(await readFile(shapesUrl, 'utf8'));
    assert.equal(shapes.schema, 'model-stats-shapes/v1');
    assert.ok(shapes.admitted.length >= 4 && shapes.refused.length >= 9, 'the fixture has almost nothing to pin');
    for (const shape of shapes.admitted) {
      const sources = tokenUsageSources(withStats([{ key: member.key, totals: shape.totals }]));
      assert.equal(sources.length, 1, `${shape.name}: the page refused a shape the origin serves`);
      for (const key of modelClassKeys) {
        assert.equal(sources[0].modelStats[0].totals[key], shape.totals[key] ?? 0, `${shape.name}: ${key}`);
      }
    }
    for (const shape of shapes.refused) {
      assert.deepEqual(
        tokenUsageSources(withStats([{ key: member.key, totals: shape.totals }])),
        [],
        `${shape.name}: the page admitted a shape the origin refuses`
      );
    }
  });

  it('admits a payload written before the section existed', () => {
    const [source] = tokenUsageSources({ sources: [{ label: 's', windows: [] }] });
    assert.equal(source.modelStats, undefined);
    assert.deepEqual(tokenUsageSources(withStats([])), [{ label: 's', windows: [] }]);
  });

  it('refuses every malformed corner rather than rendering part of it', () => {
    const refusals = [
      ['not an array', withStats({ [member.key]: full })],
      ['a key outside the vocabulary', withStats([{ key: 'a-model-nobody-declared', totals: full }])],
      ['a key twice', withStats([{ key: member.key, totals: full }, { key: member.key, totals: full }])],
      ['a class outside the closed vocabulary', withStats([{ key: member.key, totals: { ...full, tokens: 5 } }])],
      ['a class carrying no figure', withStats([{ key: member.key, totals: { input: null } }])],
      ['a class spelled as text', withStats([{ key: member.key, totals: { input: '1' } }])],
      ['no class at all', withStats([{ key: member.key, totals: {} }])],
      ['a negative class', withStats([{ key: member.key, totals: { ...full, output: -1 } }])],
      ['a fractional class', withStats([{ key: member.key, totals: { ...full, input: 1.5 } }])],
      ['no totals at all', withStats([{ key: member.key }])],
      ['a non-record row', withStats(['nope'])],
      [
        'a sum past the exact-representation boundary',
        withStats([
          {
            key: member.key,
            totals: { input: countBound, output: countBound, 'cache-read': 0, 'cache-write': 0 }
          }
        ])
      ]
    ];
    for (const [why, payload] of refusals) {
      assert.deepEqual(tokenUsageSources(payload), [], why);
    }
    // ...and the row count is bounded by the vocabulary's own size, exactly as
    // the daily partition's is.
    const every = [vocabulary.residual, ...vocabularyMembers].map((entry) => ({
      key: entry.key,
      totals: full
    }));
    assert.equal(tokenUsageSources(withStats(every)).length, 1, 'the whole vocabulary must fit');
    assert.deepEqual(
      tokenUsageSources(withStats([...every, { key: other.key, totals: full }])),
      [],
      'a section longer than the vocabulary is a section carrying a repeat'
    );
  });

  it('bounds the row count BEFORE it reads a row', () => {
    /* Closed membership already means an over-long section must repeat a key,
       so the duplicate rule would refuse this document too — but only after
       walking every entry in it. The bound is therefore a bound on WORK, and
       the only way to tell the two apart is to hand it rows that cannot be
       read at all: a section the bound refuses never touches one, and a
       section it admits throws on the first.

       This is the same reasoning admitBreakdown's own maxRows carries, made
       observable rather than asserted. */
    let reads = 0;
    const unreadable = () => ({
      get key() {
        reads += 1;
        throw new Error('a bounded section must be refused before its rows are read');
      }
    });
    const overlong = Array.from({ length: vocabularyMembers.length + 2 }, unreadable);
    assert.deepEqual(tokenUsageSources(withStats(overlong)), []);
    assert.equal(reads, 0, 'the section was walked before its length was weighed');
    // The control: a section INSIDE the bound really is walked, so the
    // assertion above is about the bound rather than about a lazy admission.
    assert.throws(() => tokenUsageSources(withStats([unreadable()])), /refused before its rows/);
    assert.equal(reads, 1);
  });
});

describe('the card surface renders payload strings as data', () => {
  it('lists the accounting classes as ruled facts, in the sheet\u2019s own order', () => {
    /* THE FOUR CLASSES ARE LIFETIME STATS ON A SOURCE CARD (owner directive,
       2026-09-11). They used to be the per-day category composition on a
       square's back face; the reading is the same division of the same
       tokens, printed as ruled lines a reader sees without pressing anything.
       The order is the sheet's own closed list, and a class the source does
       not report is simply not a row — which is what keeps the card a
       statement about real data rather than a ladder of dashes. */
    const stat = (key, value) => ({ key, label: key, value, unit: 'tokens' });
    const card = tokenCards([
      {
        label: 's',
        windows: [{ period: 'week', inputTokens: 3, outputTokens: 4 }],
        stats: [stat('cache-write', 40), stat('input', 10), stat('output', 20)]
      }
    ]).find((candidate) => candidate.key === 'source-s');
    assert.deepEqual(
      card.facts.map((fact) => [fact.key, fact.term, fact.value]),
      [
        ['input', 'input', formatTokenCount(10)],
        ['output', 'output', formatTokenCount(20)],
        ['cache-write', 'cache write', formatTokenCount(40)],
        ['window-week', 'this week', `${formatTokenCount(3)} in · ${formatTokenCount(4)} out`]
      ],
      'the classes lead in the sheet\u2019s order and the windows follow'
    );
    assert.equal(card.factColumns, 2);
    assert.equal(
      card.facts.find((fact) => fact.key === 'cache-read'),
      undefined,
      'a class the source did not report became a row'
    );
  });

  it('words the origin\u2019s closed window vocabulary, and an unknown period verbatim', () => {
    /* The origin serves two window keys (usageSeriesWindowKeys in
       internal/panels/types.go) and the page has a word for each. A period
       outside them prints VERBATIM: an unknown window is still a real
       reading, and the word the payload used says exactly what is known. */
    assert.equal(windowTerm('today'), 'today');
    assert.equal(windowTerm('week'), 'this week');
    assert.equal(windowTerm('a-window-nobody-declared'), 'a-window-nobody-declared');
  });

  it('never encodes a fact by colour alone', () => {
    /* Every fact carries its term and its figure as TEXT — built as data by
       the adapter, rendered verbatim by the component — so nothing on a card
       is readable only by looking. The one mark that remains is the record
       the current streak has matched, and the figure it matched is printed on
       the line directly above it. */
    assert.match(component, /class="board-term">\{fact\.term\}/);
    assert.match(component, /class="board-value">\{fact\.value\}/);
    assert.match(component, /data-peak=\{fact\.peak \? 'true' : 'false'\}/);
    /* And the ladder's column count is the ADAPTER's, read off the card
       rather than decided by the component: a fixed attribute here would
       quietly flatten the accounting pairs into one column on every card. */
    assert.match(component, /data-columns=\{card\.factColumns \?\? 1\}/);
    assert.match(
      sheet,
      /\.board-facts\[data-columns='2'\] \{\s*--board-fact-columns: 2;/,
      'the two-column ladder has no rule to select'
    );
    assert.match(
      sheet,
      /\.board-fact\[data-peak='true'\] \.board-value \{\s*color: var\(--ledger-highlight\)/
    );
    assert.doesNotMatch(component, /\stitle=/, 'a title attribute has no touch trigger in any engine');
    /* Figures wear the card's own ink, never a series colour. */
    assert.match(sheet, /\.board-value \{[^}]*font-variant-numeric: tabular-nums/);
    /* AND THE SWATCHES ARE GONE with the face they sat on: the board prints
       no category colour at all, so nothing on it can be read by hue. */
    for (const gone of ['board-swatch', 'data-slot']) {
      assert.ok(!component.includes(gone), `the component still draws ${gone}`);
      assert.ok(!sheet.includes(gone), `the sheet still styles ${gone}`);
    }
  });

  it('renders every payload string as text, never markup', () => {
    /* Svelte escapes text interpolation; what would break that promise is a
       raw-HTML injection, so no component may ever contain one. A hostile
       label in a payload therefore renders as inert text, and a hostile
       model KEY cannot even reach the renderer (admission refuses it —
       proven above). */
    for (const [name, source] of Object.entries({ component, commits, chart })) {
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
    const props = tokenBoardProps(
      envelopeFor({ sources: seriesSources }, { generatedAt: '2026-08-25T12:00:00Z' }),
      now
    );
    assert.equal(props.staleNote, 'data through Aug 25, 2026 · last capture 7d ago');
    const fresh = tokenBoardProps(
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

/* NO PROVENANCE SENTENCE, ANYWHERE (owner directive, 2026-09-06, issue 299).
 *
 * The board used to print "recorded out of band, not fetched live" on the
 * back of a square whose figures mixed provenance. The owner removed every
 * instance of it. The `recorded` flags stay in the payload for the envelope's
 * readers; the page says nothing about them, and the session card lost its
 * "N days active of M days tracked" line in the same directive. */
describe('no card prints a provenance sentence or the days-tracked line', () => {
  it('leaves recorded and live sources alike without a note', () => {
    const recordedStats = [
      { key: 'lifetime', label: 'Lifetime tokens', value: 10, unit: 'tokens', recorded: true },
      { key: 'input', label: 'Input', value: 4, unit: 'tokens', recorded: true }
    ];
    const liveStats = recordedStats.map(({ recorded: _dropped, ...stat }) => stat);
    for (const stats of [recordedStats, liveStats]) {
      const [total, source] = tokenCards([{ label: firstSource.key, windows: [], stats }]);
      assert.equal(source.note, undefined);
      assert.equal(total.note, undefined);
    }
  });

  it('shows the session figure with no active-of-tracked line under it', () => {
    const cards = tokenCards([
      {
        label: firstSource.key,
        windows: [],
        stats: [
          { key: 'sessions', label: 'Sessions', value: 26, unit: 'count', recorded: true },
          { key: 'active-days', label: 'Active days', value: 26, unit: 'days', recorded: true },
          { key: 'tracked-days', label: 'Days tracked', value: 66, unit: 'days', recorded: true }
        ]
      }
    ]);
    const sessions = cards.find((card) => card.key === 'sessions');
    assert.equal(sessions.figure, '26');
    assert.equal(sessions.sub, undefined, 'the days-tracked line came back');
    assert.equal(
      sessions.facts,
      undefined,
      'active-days and tracked-days became rows; the session card lists records, not coverage'
    );
  });

  it('spells no provenance wording anywhere it could be rendered', () => {
    for (const [name, source] of Object.entries({ component, helper, chart })) {
      assert.ok(
        !source.includes('recorded out of band'),
        `${name} spells the retired provenance wording`
      );
    }
  });
});

/* ---------------------------------------------------------------------------
 * THE SIX CARDS (owner directive, 2026-09-11, issues 267 and 311)
 *
 * The board's composition, driven through the adapter with a payload shaped
 * like the one the origin serves: every figure, every fact and every share is
 * checked against arithmetic done here rather than against a number copied
 * out of a drawing.
 * ------------------------------------------------------------------------ */
describe('the six-card board', () => {
  const member = (index) => vocabulary.groups[0].members[index];

  /* One payload that exercises every card: two sources, both with lifetimes,
     both with a daily series, one with the lifetime model accounting and one
     with only the windowed partition. */
  const board = () => ({
    sources: [
      {
        label: firstSource.key,
        windows: [
          { period: 'today', inputTokens: 12_900_000, outputTokens: 49_500 },
          { period: 'week', inputTokens: 3_300_000_000, outputTokens: 4_300_000 }
        ],
        stats: [
          { key: 'lifetime', label: 'Lifetime tokens', value: 44_900_000_000, unit: 'tokens' },
          { key: 'input', label: 'Input', value: 3_200_000, unit: 'tokens' },
          { key: 'output', label: 'Output', value: 129_000_000, unit: 'tokens' },
          { key: 'cache-read', label: 'Cache read', value: 43_400_000_000, unit: 'tokens' },
          { key: 'cache-write', label: 'Cache write', value: 1_400_000_000, unit: 'tokens' },
          { key: 'sessions', label: 'Sessions', value: 54, unit: 'count' },
          { key: 'longest-session', label: 'Longest session', value: 150_900, unit: 'seconds' },
          { key: 'longest-streak', label: 'Longest streak', value: 27, unit: 'days' },
          { key: 'current-streak', label: 'Current streak', value: 27, unit: 'days' }
        ],
        series: { startDate: '2026-08-10', totals: [1, 2, 3, 4], recorded: true },
        modelStats: [
          { key: member(0).key, totals: { input: 2, output: 3, 'cache-read': 60, 'cache-write': 5 } },
          { key: member(1).key, totals: { input: 1, output: 1, 'cache-read': 26, 'cache-write': 2 } }
        ]
      },
      {
        label: secondSource.key,
        windows: [{ period: 'today', inputTokens: 71_900_000, outputTokens: 169_400 }],
        stats: [
          { key: 'lifetime', label: 'Lifetime tokens', value: 53_500_000_000, unit: 'tokens' },
          { key: 'current-streak', label: 'Current streak', value: 22, unit: 'days' },
          { key: 'longest-session', label: 'Longest session', value: 80_940, unit: 'seconds' }
        ],
        series: {
          startDate: '2026-08-11',
          totals: [10, 20, 30],
          recorded: true,
          models: [{ key: member(2).key, totals: [10, 20, 30] }]
        }
      }
    ]
  });

  const cardsOf = () => tokenBoardProps(envelopeFor(board())).cards;

  it('composes the total, a card per source, the record, then a card per split', () => {
    assert.deepEqual(
      cardsOf().map((card) => card.key),
      [
        'tracked',
        `source-${firstSource.key}`,
        `source-${secondSource.key}`,
        'sessions',
        `models-${firstSource.key}`,
        `models-${secondSource.key}`
      ]
    );
  });

  it('totals every lifetime and prints the split beside the exact figure', () => {
    const [total] = cardsOf();
    const sum = 44_900_000_000 + 53_500_000_000;
    assert.equal(total.figure, formatTokenCount(sum));
    assert.deepEqual(total.sub, [formatWholeFigure(sum)]);
    assert.equal(total.ctx, lifetimeContext);
    assert.deepEqual(
      total.facts.map((fact) => [fact.term, fact.value]),
      [
        [
          `${firstSource.name} · ${secondSource.name}`,
          `${formatShare((44_900_000_000 / sum) * 100)} · ${formatShare((53_500_000_000 / sum) * 100)}`
        ]
      ]
    );
    assert.equal(total.factColumns, 1);
  });

  it('builds no split row it cannot back with two reported lifetimes', () => {
    /* One source's "100%" is the figure above it restated, and a share of a
       sum of nothing is unknown rather than zero. */
    const lone = tokenCards([
      {
        label: 's',
        windows: [],
        stats: [{ key: 'lifetime', label: 'L', value: 5, unit: 'tokens' }]
      }
    ]);
    assert.equal(lone[0].facts, undefined);
    const silent = tokenCards([{ label: 'a', windows: [] }, { label: 'b', windows: [] }]);
    assert.equal(silent[0].figure, unknownFigure);
    assert.equal(silent[0].facts, undefined);
    assert.equal(silent[0].sub, undefined, 'an unmeasured total printed an exact figure anyway');
    assert.equal(silent[0].note, boardEmptyNote);
    // A total of zero real tokens is still a measurement; it just has no
    // proportions to draw.
    const zero = tokenCards([
      { label: 'a', windows: [], stats: [{ key: 'lifetime', label: 'L', value: 0, unit: 'tokens' }] },
      { label: 'b', windows: [], stats: [{ key: 'lifetime', label: 'L', value: 0, unit: 'tokens' }] }
    ]);
    assert.equal(zero[0].figure, formatTokenCount(0));
    assert.equal(zero[0].facts, undefined);
  });

  it('draws the combined line over the days EVERY series carries, never a zero for a silence', () => {
    /* A day one source lacks contributes that source's ABSENCE, not zero:
       adding a silent source in at nought would draw a measured trough
       exactly where the younger capture begins. The line therefore covers the
       intersection — 2026-08-11 through 2026-08-13, three days of the first
       source's four and all three of the second's. */
    const [total] = cardsOf();
    assert.deepEqual(total.spark.totals, [2 + 10, 3 + 20, 4 + 30]);
    assert.equal(total.spark.ariaLabel, 'All sources daily tokens, 3 days');
    // A source with NO series never narrows the window: it has no window to
    // narrow it with, and a source that says nothing about any day cannot
    // make a day unmeasurable.
    const withSilent = tokenCards([
      { label: 'a', windows: [], series: { startDate: '2026-08-10', totals: [1, 2] } },
      { label: 'b', windows: [] }
    ]);
    assert.deepEqual(withSilent[0].spark.totals, [1, 2]);
    // Windows that never overlap draw no combined line at all.
    const apart = tokenCards([
      { label: 'a', windows: [], series: { startDate: '2026-08-01', totals: [1] } },
      { label: 'b', windows: [], series: { startDate: '2026-09-01', totals: [2] } }
    ]);
    assert.equal(apart[0].spark, undefined);
    // And a board with no series at all draws none.
    assert.equal(tokenCards([{ label: 'a', windows: [] }])[0].spark, undefined);
  });

  it('words every day of every line: its date, its compacted figure and its exact one', () => {
    /* THE COMPONENT FORMATS NOTHING (owner directive, 2026-09-11, issue 316),
       so the three readings a scrubbed day needs arrive written and parallel
       to the series itself. The source's line is dated from its OWN start
       date; the combined line is dated from the INTERSECTION's, which is the
       first day every source carries and not the oldest capture — the fixture
       starts one source on the 10th and the other on the 11th. */
    const source = cardsOf().find((card) => card.key === `source-${firstSource.key}`);
    assert.deepEqual(source.spark.dayLabels, ['on Aug 10', 'on Aug 11', 'on Aug 12', 'on Aug 13']);
    assert.deepEqual(
      source.spark.dayFigures,
      [1, 2, 3, 4].map((value) => formatTokenCount(value))
    );
    assert.deepEqual(
      source.spark.dayExact,
      [1, 2, 3, 4].map((value) => formatWholeFigure(value))
    );
    const [total] = cardsOf();
    assert.deepEqual(total.spark.dayLabels, ['on Aug 11', 'on Aug 12', 'on Aug 13']);
    assert.deepEqual(
      total.spark.dayFigures,
      [12, 23, 34].map((value) => formatTokenCount(value))
    );
    assert.deepEqual(
      total.spark.dayExact,
      [12, 23, 34].map((value) => formatWholeFigure(value))
    );
    /* PARALLEL IS THE WHOLE CONTRACT: an array one entry short is a scrubbed
       day with an undefined figure, which is the defect the card's own lookup
       refuses and this is the half that keeps it from arising. */
    for (const card of cardsOf()) {
      if (card.spark === undefined) continue;
      const days = card.spark.totals.length;
      assert.equal(card.spark.dayLabels.length, days, card.key);
      assert.equal(card.spark.dayFigures.length, days, card.key);
      assert.equal(card.spark.dayExact.length, days, card.key);
    }
  });

  it('gives each source card its figure, its classes, its windows and its own line', () => {
    const card = cardsOf().find((candidate) => candidate.key === `source-${firstSource.key}`);
    assert.equal(card.label, firstSource.name);
    assert.equal(card.figure, formatTokenCount(44_900_000_000));
    assert.deepEqual(card.sub, ['27-day streak', `longest session ${formatDuration(150_900)}`]);
    assert.deepEqual(
      card.facts.map((fact) => [fact.term, fact.value]),
      [
        ['input', formatTokenCount(3_200_000)],
        ['output', formatTokenCount(129_000_000)],
        ['cache read', formatTokenCount(43_400_000_000)],
        ['cache write', formatTokenCount(1_400_000_000)],
        ['today', `${formatTokenCount(12_900_000)} in · ${formatTokenCount(49_500)} out`],
        ['this week', `${formatTokenCount(3_300_000_000)} in · ${formatTokenCount(4_300_000)} out`]
      ]
    );
    assert.deepEqual(card.spark.totals, [1, 2, 3, 4]);
    assert.equal(card.spark.ariaLabel, `${firstSource.name} daily tokens, 4 days`);
    /* The second source is the SAME shape read from different data: no class
       stats to print, so no class rows — not four rows of dashes. */
    const second = cardsOf().find((candidate) => candidate.key === `source-${secondSource.key}`);
    assert.deepEqual(
      second.facts.map((fact) => fact.term),
      ['today'],
      'a source with no accounting classes printed them anyway'
    );
    assert.deepEqual(second.sub, ['22-day streak', `longest session ${formatDuration(80_940)}`]);
  });

  it('reads the session record from whichever source keeps one, and marks a matched streak', () => {
    const sessions = cardsOf().find((card) => card.key === 'sessions');
    assert.equal(sessions.label, sessionsCardLabel);
    assert.equal(sessions.figure, '54');
    assert.equal(sessions.factColumns, 1);
    assert.deepEqual(
      sessions.facts.map((fact) => [fact.term, fact.value, fact.peak === true]),
      [
        ['longest session', formatDuration(150_900), false],
        ['longest streak', '27 days', false],
        ['current streak', '27 days', true]
      ]
    );
    /* THE MARK IS A MEASUREMENT, not decoration: a streak short of the record
       is not marked, and the record it is measured against is printed on the
       line above either way. */
    const behind = tokenCards([
      {
        label: 's',
        windows: [],
        stats: [
          { key: 'sessions', label: 'Sessions', value: 3, unit: 'count' },
          { key: 'longest-streak', label: 'Longest streak', value: 27, unit: 'days' },
          { key: 'current-streak', label: 'Current streak', value: 2, unit: 'days' }
        ]
      }
    ]).find((card) => card.key === 'sessions');
    assert.equal(behind.facts.find((fact) => fact.key === 'current-streak').peak, false);
    // A source that never reported a record is offered no row for it.
    const bare = tokenCards([{ label: 's', windows: [] }]).find((card) => card.key === 'sessions');
    assert.equal(bare.figure, unknownFigure);
    assert.equal(bare.facts, undefined);
    assert.equal(bare.note, tokenUsageSourceEmptyNote);
  });

  it('gives the sessions figure to the source that reports one, whichever it is', () => {
    const keeper = tokenCards([
      { label: 'a', windows: [] },
      {
        label: 'b',
        windows: [],
        stats: [{ key: 'sessions', label: 'Sessions', value: 9, unit: 'count' }]
      }
    ]).find((card) => card.key === 'sessions');
    assert.equal(keeper.figure, '9');
  });

  it('never turns a card that is not a source card', () => {
    for (const card of cardsOf()) {
      if (card.key.startsWith('source-')) continue;
      assert.equal(card.turned, undefined, card.key);
    }
  });
});

/* ---------------------------------------------------------------------------
 * THE FORMATTERS, executed (owner directive, 2026-09-11)
 * ------------------------------------------------------------------------ */
describe('the board writes every figure one way', () => {
  it('keeps the decimal place on a compact figure, so a column of them lines up', () => {
    /* formatMagnitude TRIMS a trailing .0 and formatMagnitudeFixed keeps it,
       and the board reads the second: a column that alternates "129M" with
       "44.9B" is a column whose digits stop lining up. Both pick their unit
       through one shared step walk, so the two spellings can never disagree
       about whether a figure is millions or billions. */
    assert.equal(formatTokenCount(98_400_189_458), '98.4B');
    assert.equal(formatTokenCount(44_885_807_826), '44.9B');
    assert.equal(formatTokenCount(129_000_000), '129.0M');
    assert.equal(formatMagnitude(129_000_000), '129M', 'the calendar keeps the trimmed spelling');
    assert.equal(formatTokenCount(3_200_000), '3.2M');
    assert.equal(formatTokenCount(49_500), '49.5K');
    // Below the grouping floor both spellings are the exact figure.
    assert.equal(formatTokenCount(1284), '1,284');
    assert.equal(formatTokenCount(1284), formatMagnitude(1284));
    // The promotion is shared: 999,950 is "1.0M", never "1000.0K".
    assert.equal(formatTokenCount(999_950), '1.0M');
    assert.equal(formatMagnitudeFixed(999_950), formatTokenCount(999_950));
  });

  it('prints an exact figure with thousands groups, and a share to one decimal', () => {
    assert.equal(formatWholeFigure(98_400_189_458), '98,400,189,458');
    assert.equal(formatShare(54.32), '54.3%');
    assert.equal(formatShare(46), '46%');
    assert.equal(formatShare(null), unknownFigure);
  });

  it('reads a duration in the units a person thinks in, dropping the empty step', () => {
    assert.equal(formatStatValue(150_900, 'seconds'), '1d 17h 55m');
    assert.equal(formatStatValue(80_940, 'seconds'), '22h 29m');
    assert.equal(formatStatValue(513_360, 'seconds'), '5d 22h 36m');
    assert.equal(formatStatValue(90, 'seconds'), '1m');
  });
});

/* ---------------------------------------------------------------------------
 * THE DAILY LINE, as arithmetic (lib/spark.ts)
 * ------------------------------------------------------------------------ */
describe('sparklinePath', () => {
  const box = { width: 100, height: 100 };

  it('plots the series across the box, newest last', () => {
    const path = sparklinePath([0, 5, 10], box);
    assert.equal(path.plotted, 3);
    assert.equal(path.line, 'M0 92 L50 50 L100 8');
    assert.equal(path.area, 'M0 92 L50 50 L100 8 L100 100 L0 100 Z');
    assert.deepEqual(path.last, { x: 100, y: 8 });
  });

  it('draws a single day across the whole box rather than as a dot in a corner', () => {
    const path = sparklinePath([7], box);
    assert.equal(path.line, 'M0 8 L100 8');
    assert.deepEqual(path.last, { x: 100, y: 8 });
    assert.equal(path.plotted, 1);
  });

  it('draws a window that recorded nothing along its own floor', () => {
    /* A window of real zeros is a REAL SHAPE — the days were measured and
       nothing was spent — and it is a different picture from a window nobody
       measured, which draws nothing at all. */
    const path = sparklinePath([0, 0, 0], box);
    assert.equal(path.line, 'M0 92 L50 92 L100 92');
    assert.equal(path.plotted, 3);
  });

  it('spends a null day’s place without drawing a point on its floor', () => {
    /* The absence moves no ink downward, which a zero would, and its x
       position is still spent, so a gap reads as a longer segment rather than
       as a compressed series. */
    const path = sparklinePath([10, null, 10], box);
    assert.equal(path.line, 'M0 8 L100 8');
    assert.equal(path.plotted, 2);
    assert.notEqual(sparklinePath([10, 0, 10], box).line, path.line);
  });

  it('draws nothing at all for a series with nothing plottable', () => {
    assert.equal(sparklinePath([], box), null);
    assert.equal(sparklinePath([null, null], box), null);
  });

  it('scales with the box it is given, and the page draws in a percentage space', () => {
    const wide = sparklinePath([0, 10], { width: 200, height: 50 });
    assert.equal(wide.last.x, 200);
    assert.deepEqual(sparkBox, { width: 100, height: 100 });
  });

  it('reserves its own mark, at the size the sheet gives it', () => {
    /* THE DRAWING CONTAINS ITS MARK, and the two halves of that promise live
       in different files: the reserve is a PERCENTAGE of the plot's height
       (lib/spark.ts) and the mark is a LENGTH the sheet declares. A box that
       shrank or a mark that grew would put half the dot outside the card —
       measured on 2026-09-11 as two pixels of a card's content hidden behind
       its own edge, which is exactly the silence the fits lane exists to
       break — so the two are held against each other here rather than
       rediscovered in an engine. */
    const lengthOf = (token) => {
      const declared = new RegExp(`${token}:\\s*([\\d.]+)(rem|px);`).exec(sheet);
      assert.ok(declared, `${token} is not declared as a length`);
      return Number(declared[1]) * (declared[2] === 'rem' ? 16 : 1);
    };
    const height = lengthOf('--spark-height');
    const mark = lengthOf('--spark-mark-size');
    assert.ok(height > 0 && mark > 0);
    assert.ok(
      (sparkInset / sparkBox.height) * height >= mark / 2,
      `the plot reserves ${(sparkInset / sparkBox.height) * height}px at each end and the mark needs ${mark / 2}px`
    );
    /* And the reserve is not so large that the line has nowhere to go. */
    assert.ok(sparkInset * 2 < sparkBox.height / 2, 'the reserve eats the drawing');
  });

  it('is the only place the chart computes anything', () => {
    assert.match(
      chart,
      /import \{ sparkBox, sparkIndexAt, sparklinePath, sparkPointAt \} from '\.\.\/spark\.ts'/
    );
    assert.match(chart, /preserveAspectRatio="none"/);
    assert.match(chart, /aria-label=\{ariaLabel\}/);
    /* The stroke keeps its own thickness through vector-effect, and the mark
       on the newest reading is positioned OUTSIDE the squashed space — a
       circle inside it would be an ellipse whose eccentricity is the card's
       aspect ratio. */
    assert.match(sheet, /\.spark-line \{[^}]*vector-effect: non-scaling-stroke/);
    assert.match(sheet, /\.spark-line \{[^}]*stroke: var\(--grid-cell-peak\)/);
    assert.match(sheet, /\.spark-area \{[^}]*fill: var\(--grid-cell-1\)/);
    assert.match(sheet, /\.spark-mark \{[^}]*border-radius: 50%/);
    /* The scrubber's own two marks wear the CHART's family rather than the
       sheet's one mark: the line and its end dot are already the peak, and a
       cursor in a different ink would read as a second quantity rather than
       as a position on the first. */
    assert.match(sheet, /\.spark-cursor \{[^}]*background: var\(--grid-cell-peak\)/);
    assert.match(sheet, /\.spark-guide \{[^}]*background: var\(--grid-cell-peak\)/);
    // No axis, no caption, no legend: the figures above the line are the
    // reading, and the drawing is the shape.
    for (const chrome of ['<text', 'caption', 'legend', 'axis']) {
      assert.ok(!rendered(chart).toLowerCase().includes(chrome), `the chart draws ${chrome}`);
    }
  });
});

/* ---------------------------------------------------------------------------
 * THE SCRUBBER'S ARITHMETIC (owner directive, 2026-09-11, issue 316)
 *
 * "As I run the mouse through this hovering or clicking, I expected to see
 * more information, like you can in Robinhood when looking at a stock price."
 * Which day a pointer names and where that day sits on the drawn line are two
 * pure functions, decided here rather than in an engine, so every edge a
 * finger can produce — past either end, on a day nobody measured, on a series
 * of one — is answered by a test rather than by a browser.
 * ------------------------------------------------------------------------ */
describe('scrubReading', () => {
  /* One card of the shape the adapter composes, with its three day arrays
     parallel to a three-day series. */
  const card = (spark) => ({ key: 'a-card', label: 'A card', ariaLabel: 'A card', spark });
  const days = { totals: [1, 2, 3], ariaLabel: 'line', ...sparkDays('2026-09-01', [1, 2, 3]) };

  it('reads the day the cursor names, exactly and dated', () => {
    assert.deepEqual(scrubReading(card(days), 1), {
      figure: formatTokenCount(2),
      line: `${formatWholeFigure(2)} · on Sep 2`
    });
  });

  it('refuses a day the current payload cannot answer', () => {
    /* THE INDEX CAME FROM A POINTER OVER A CHART THAT MAY SINCE HAVE BEEN
       HANDED A DIFFERENT PAYLOAD. Every one of these is a card that must go
       back to its own figure rather than print the word `undefined`. */
    assert.equal(scrubReading(card(days), 3), null, 'a day past the end of the series');
    assert.equal(scrubReading(card(days), -1), null, 'a day before the start of the series');
    assert.equal(scrubReading(card(undefined), 0), null, 'a card that lost its line');
    // An array shorter than the series — a half-built payload, or a card whose
    // line grew without its words.
    assert.equal(
      scrubReading(card({ ...days, dayExact: [formatWholeFigure(1)] }), 1),
      null,
      'a card whose exact figures are short of its series'
    );
    assert.equal(
      scrubReading(card({ ...days, dayLabels: [] }), 0),
      null,
      'a card whose days carry no dates'
    );
  });

  it('reads a day nobody measured as unknown, twice, and still dates it', () => {
    const absent = { totals: [null], ariaLabel: 'line', ...sparkDays('2026-09-04', [null]) };
    assert.deepEqual(scrubReading(card(absent), 0), {
      figure: unknownFigure,
      line: `${unknownFigure} · on Sep 4`
    });
  });
});

describe('sparkDays', () => {
  it('dates every day from the wire\u2019s start date, in the page\u2019s one voice', () => {
    const days = sparkDays('2026-08-30', [1, 2, 3]);
    assert.deepEqual(days.dayLabels, ['on Aug 30', 'on Aug 31', 'on Sep 1']);
    assert.deepEqual(days.dayFigures, [1, 2, 3].map((value) => formatTokenCount(value)));
    assert.deepEqual(days.dayExact, [1, 2, 3].map((value) => formatWholeFigure(value)));
  });

  it('marks a day nobody measured as unknown in both figures, and still dates it', () => {
    /* An absence is a fact about a REAL day: printing a zero there would be
       the invention the honest-states floor forbids, and dropping the date
       would leave a reader scrubbing over a day the page refuses to name. */
    const days = sparkDays('2026-09-01', [5, null]);
    assert.deepEqual(days.dayLabels, ['on Sep 1', 'on Sep 2']);
    assert.deepEqual(days.dayFigures, [formatTokenCount(5), unknownFigure]);
    assert.deepEqual(days.dayExact, [formatWholeFigure(5), unknownFigure]);
  });

  it('says nothing at all for a series of no days', () => {
    assert.deepEqual(sparkDays('2026-09-01', []), {
      dayLabels: [],
      dayFigures: [],
      dayExact: []
    });
  });
});

describe('sparkIndexAt', () => {
  it('names the NEAREST day, so a pointer lands on the day it is pointing at', () => {
    // Four days across the box: the boundaries between them are at 1/6, 1/2
    // and 5/6, and a fraction either side of one picks the nearer day.
    assert.equal(sparkIndexAt(0, 4), 0);
    assert.equal(sparkIndexAt(0.16, 4), 0);
    assert.equal(sparkIndexAt(0.18, 4), 1);
    assert.equal(sparkIndexAt(0.5, 4), 2);
    assert.equal(sparkIndexAt(1, 4), 3);
  });

  it('clamps a pointer that arrived outside its own box', () => {
    /* A finger that began on the chart and slid past its edge keeps
       reporting, and a box measured one frame before a resize answers a
       fraction outside [0, 1]. The end day is the honest answer there; an
       index the series cannot answer is a figure of undefined. */
    assert.equal(sparkIndexAt(-4, 5), 0);
    assert.equal(sparkIndexAt(9, 5), 4);
    assert.equal(sparkIndexAt(-0.0001, 5), 0);
    assert.equal(sparkIndexAt(1.0001, 5), 4);
  });

  it('answers a one-day series with its one day, and a series of none with none', () => {
    // A single day has no interval to divide by: every point of the box is it.
    assert.equal(sparkIndexAt(0, 1), 0);
    assert.equal(sparkIndexAt(1, 1), 0);
    assert.equal(sparkIndexAt(0.5, 1), 0);
    assert.equal(sparkIndexAt(0.5, 0), null);
    assert.equal(sparkIndexAt(0.5, -3), null);
    /* A box of zero width divides to NaN or to an infinity on the caller's
       side. Neither is a fraction, so neither names a day — clamping an
       infinity would answer a question nobody could have asked. */
    assert.equal(sparkIndexAt(Number.NaN, 5), null);
    assert.equal(sparkIndexAt(Number.POSITIVE_INFINITY, 5), null);
    assert.equal(sparkIndexAt(Number.NEGATIVE_INFINITY, 5), null);
  });
});

describe('sparkPointAt', () => {
  const box = { width: 100, height: 100 };

  it('puts the cursor exactly where the line already drew that day', () => {
    /* ONE mapping from a day to a point, or the cursor and the line are two
       drawings of the same series: every plotted day is checked against the
       path's own coordinates rather than against numbers typed here. */
    const totals = [0, 5, 10];
    const path = sparklinePath(totals, box);
    const points = totals.map((_, index) => sparkPointAt(totals, box, index));
    assert.equal(
      points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' '),
      path.line,
      'the cursor and the line disagree about where a day is'
    );
    assert.deepEqual(points[2], path.last);
  });

  it('refuses a day the series cannot answer', () => {
    const totals = [1, 2, 3];
    assert.equal(sparkPointAt(totals, box, -1), null);
    assert.equal(sparkPointAt(totals, box, 3), null);
    assert.equal(sparkPointAt(totals, box, 1.5), null);
    assert.equal(sparkPointAt([], box, 0), null);
    assert.equal(sparkPointAt([null, null], box, 0), null);
  });

  it('puts no cursor on a day nobody measured', () => {
    /* The absence draws no point, so there is nothing to mark — and the days
       either side of it are unmoved, because a gap spends its x position. */
    const totals = [10, null, 20];
    assert.equal(sparkPointAt(totals, box, 1), null);
    assert.deepEqual(sparkPointAt(totals, box, 0), { x: 0, y: 50 });
    assert.deepEqual(sparkPointAt(totals, box, 2), { x: 100, y: 8 });
  });

  it('marks a one-day series where its own mark is', () => {
    /* sparklinePath draws a single day as a line across the whole box and
       puts its mark at the far edge; a cursor at the origin would sit on the
       same line at a place the reader cannot read a value at. */
    const totals = [7];
    assert.deepEqual(sparkPointAt(totals, box, 0), sparklinePath(totals, box).last);
    assert.deepEqual(sparkPointAt(totals, box, 0), { x: 100, y: 8 });
  });

  it('scales with the box it is given, exactly as the path does', () => {
    const wide = { width: 200, height: 50 };
    assert.deepEqual(sparkPointAt([0, 10], wide, 1), sparklinePath([0, 10], wide).last);
  });
});

/* ---------------------------------------------------------------------------
 * NO PRODUCTION SOURCE SPELLS A SOURCE (issue #311)
 *
 * The twin of the model sweep in scripts/ci/test_capture_usage_series.py, for
 * the vocabulary this lane added. The needles are built from the DATA FILE at
 * run time, so this test file never spells a source name either.
 * ------------------------------------------------------------------------ */
describe('the source vocabulary is one data file', () => {
  const spellings = sourceVocabulary.sources.flatMap((entry) => [entry.name, entry.vendor]);
  const needles = spellings.flatMap((value) => [`'${value}'`, `"${value}"`, `\`${value}\``]);

  it('has needles worth sweeping for', () => {
    assert.ok(needles.length >= 6, 'the sweep has almost nothing to look for');
  });

  it('spells no source name or vendor in any production source', async () => {
    const root = new URL('../src/', import.meta.url);
    const swept = [];
    const walk = async (dir) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
        if (entry.isDirectory()) {
          await walk(child);
        } else if (/\.(ts|svelte|css)$/.test(entry.name)) {
          swept.push([child, await readFile(child, 'utf8')]);
        }
      }
    };
    await walk(root);
    assert.ok(swept.length > 20, 'the sweep found almost no production source to read');
    for (const [file, text] of swept) {
      const found = needles.filter((needle) => text.includes(needle));
      assert.deepEqual(
        found,
        [],
        `${file.pathname} spells ${found.join(', ')}; a source's written name and its vendor live only in internal/panels/config/sources.json, which every consumer reads`
      );
    }
  });

  it('can actually fail', () => {
    // Non-vacuity: a guard that cannot redden is decoration. A source that
    // reintroduced a written name as a literal must be caught, and one that
    // merely mentions the words in prose must not.
    const hostile = `const table = [${needles[0]}];`;
    assert.deepEqual(needles.filter((needle) => hostile.includes(needle)), [needles[0]]);
    const prose = `/* every source keeps its own name in the file */`;
    assert.deepEqual(needles.filter((needle) => prose.includes(needle)), []);
  });
});
