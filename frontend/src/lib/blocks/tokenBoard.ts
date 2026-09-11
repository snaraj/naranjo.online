/* The token block (issue 165): the generic LedgerBoard bound to the
 * token-usage panel through its adapter in lib/token-usage.ts. The binding
 * layer is the one place the component, the panel id and the adapter meet;
 * the component knows no vendor and no token.
 *
 * It used to bind UsageTracker, which drew a grid of tiles, meters and a graph.
 * The owner's ledger redesign (2026-09-03, issue 287) made it a board of five
 * turnable squares and moved the graph into the commits section's cycler; the
 * lifelong-tracker board (2026-09-11, issues 267 and 311) made it six cards
 * with a daily line back under each of the ones that have one. The figures are
 * the same figures, from the same stats, through the same formatters. */

import { panelBlock, type PageBlock } from '../blocks.ts';
import LedgerBoard from '../components/LedgerBoard.svelte';
import { tokenBoardProps, tokenUsagePanelId } from '../token-usage.ts';

export const tokenBoard: PageBlock = panelBlock(
  'token-board',
  LedgerBoard,
  tokenUsagePanelId,
  (envelope) => tokenBoardProps(envelope)
);
