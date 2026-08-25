/* The version-control activity block (issue 165): the generic
 * ActivityTracker bound to the vcs-activity panel through its adapter in
 * lib/activity.ts. The binding layer is the one place the component, the
 * panel id and the adapter meet; the component knows no repository, no host
 * and no commit. */

import { activityPanelId, vcsActivityProps } from '../activity.ts';
import { panelBlock, type PageBlock } from '../blocks.ts';
import ActivityTracker from '../components/ActivityTracker.svelte';

export const vcsActivity: PageBlock = panelBlock(
  'vcs-activity',
  ActivityTracker,
  activityPanelId,
  vcsActivityProps
);
