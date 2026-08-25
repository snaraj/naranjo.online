/* The token-usage block (issue 165): the generic UsageTracker bound to the
 * token-usage panel through its adapter in lib/token-usage.ts. The binding
 * layer is the one place the component, the panel id and the adapter meet;
 * the component knows no vendor and no token. */

import { panelBlock, type PageBlock } from '../blocks.ts';
import UsageTracker from '../components/UsageTracker.svelte';
import { tokenUsagePanelId, tokenUsageProps } from '../token-usage.ts';

export const tokenUsage: PageBlock = panelBlock(
  'token-usage',
  UsageTracker,
  tokenUsagePanelId,
  tokenUsageProps
);
