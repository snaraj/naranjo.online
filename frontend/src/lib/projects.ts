/* The repositories panel's information module (owner directive, issue 134;
 * live since issue 242): the owner's public repositories as the origin reads
 * them, and the one link shape every repository address on this page takes.
 *
 * THE ROSTER IS THE PANEL'S (issue 281). The owner's ruling reversed the
 * curated-seven reading of 2026-08-29: a new public repository must appear
 * on the site without a release, so the origin enumerates the account's own
 * public listing and this module admits whatever roster the payload carries.
 * Curation lives server-side as an explicit exclusion list in
 * `internal/panels/config/fetch.json` — data, never a whitelist that goes
 * stale. What this module still fixes is the LINK SHAPE: every repository
 * href is the one `projectHost` constant plus a name admitted through the
 * repository-name grammar below, so a payload can decide which of the
 * owner's repositories show and can never point a link at another host or
 * an unparseable path.
 *
 * WHAT READS IT NOW (owner, 2026-11-02, issue #399). The repositories stopped
 * being a column of their own when Ongoing Work became one stream: what the
 * stream takes from this panel is each repository's latest release and the
 * commit its tag names, so a commit that IS a release carries the version
 * (lib/commits.ts). The trackers read it too, for the pull requests the
 * repositories have closed (lib/chronicle.ts). The captured rows that were the
 * table's no-payload face left with the table: a stream with no repositories
 * panel marks no release, which is the honest face of not knowing one.
 *
 * The page still makes no outbound request of its own. Requirement 1 keeps the
 * frontend local-origin-only: the panel is read from this origin's own
 * /api/panels path like every other panel, the host URLs here remain link
 * TARGETS a human may click, and no code in this module requests `projectHost`.
 *
 * Vendor names are data. The host label lives in this module beside the
 * address it describes, exactly as the panels keep theirs in config data, so
 * the components stay neutral and a move to another host is a data edit. */

import type { CodingProjectRow, CodingProjectsData } from './panels';

/* The host label the accessible names carry. */
export const projectHostLabel = 'GitHub';

/* The owner's account, and the only remote origin this repository's frontend
 * source spells. Every repository URL is this plus the repository name, so the
 * host is written once and a row cannot point somewhere else by typo. The
 * commit stream's outbound links (lib/activity.ts, issue 157) import this
 * constant rather than writing a second one, which is what keeps the claim in
 * this comment true as a second consumer arrives. */
export const projectHost = 'https://github.com/snaraj';

/* The registry identifier the repositories panel loads; the one place the id
 * is spelled on the frontend. */
export const codingProjectsPanelId = 'coding-projects';

/* The accessible name one repository link carries. It names the destination
 * and says the link leaves the page, because a link that opens a new tab
 * without warning is a surprise for anyone who cannot see it happen. */
export function projectLinkLabel(project: { readonly name: string }): string {
  return `${project.name} on ${projectHostLabel}, opens in a new tab`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* A tally is absent or a non-negative whole number. Absent is the only
 * "unknown" this field has: the producer omits the key rather than writing
 * null, which is what makes it additive, so an explicit null is drift and
 * refused with everything else. */
function isOptionalTally(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
  );
}

/* The release-tag grammar, the frontend's half of the gate the origin's
 * isReleaseTag applies (issue #317). The stream prints the tag verbatim, so
 * this is what stops a payload printing a sentence, a path or a control
 * character where a version belongs — the same layering the repository name
 * already has. */
const releaseTagPattern = /^[A-Za-z0-9._-]{1,64}$/;

function isReleaseTag(tag: string): boolean {
  return tag !== '.' && tag !== '..' && releaseTagPattern.test(tag);
}

/* The identity a release's tag names: 40 lowercase hex digits, the origin's
 * isCommitIdentity exactly (issue #399). The stream compares it with a
 * commit's own full identity for EQUALITY, so a short or case-folded form is
 * not a weaker match, it is drift — and refused with everything else. */
const releaseShaPattern = /^[0-9a-f]{40}$/;

/* The repository-name grammar, the frontend's half of the identity gate the
 * origin's mapRepositoryListing applies (issue 281): letters, digits, dots,
 * underscores and dashes, bounded, and never a filesystem dot name. Since the
 * roster is the payload's, this is what makes a payload name safe to build
 * an owner-account href from — the host is the one constant, and a name this
 * grammar admits cannot escape its path segment or read as anything but a
 * repository. */
const repositoryNamePattern = /^[A-Za-z0-9._-]{1,100}$/;

function isRepositoryName(name: string): boolean {
  return name !== '.' && name !== '..' && repositoryNamePattern.test(name);
}

/* parseCodingProjects admits only payloads carrying the exact shape the page
 * reads: a repos array of rows with a grammatical repository name, a string
 * description, a null-or-non-negative-integer star tally, an optional push
 * instant, an optional release with its instant and commit, and optional
 * boolean flags. Anything else returns null and every reader treats the panel
 * as absent — a data fault degrades what this panel feeds, never the page.
 *
 * The refusal is WHOLESALE rather than per row, and that is the fail-closed
 * direction here: a payload that half-parses is drift, and a half-parsed
 * repository list looks exactly like an owner who deleted a project. */
export function parseCodingProjects(document: unknown): CodingProjectsData | null {
  if (!isRecord(document) || !Array.isArray(document.repos)) {
    return null;
  }
  const repos: CodingProjectRow[] = [];
  for (const entry of document.repos) {
    if (!isRecord(entry)) {
      return null;
    }
    const { name, description, stars, pushedAt, closedPulls, release, releasedAt, releaseSha, pinned, recorded } =
      entry;
    if (typeof name !== 'string' || !isRepositoryName(name) || typeof description !== 'string') {
      return null;
    }
    if (
      stars !== null &&
      !(typeof stars === 'number' && Number.isSafeInteger(stars) && stars >= 0)
    ) {
      return null;
    }
    if (pushedAt !== undefined && typeof pushedAt !== 'string') {
      return null;
    }
    if (!isOptionalTally(closedPulls)) {
      return null;
    }
    if (release !== undefined && (typeof release !== 'string' || !isReleaseTag(release))) {
      return null;
    }
    if (releasedAt !== undefined && typeof releasedAt !== 'string') {
      return null;
    }
    if (releaseSha !== undefined && (typeof releaseSha !== 'string' || !releaseShaPattern.test(releaseSha))) {
      return null;
    }
    if (pinned !== undefined && typeof pinned !== 'boolean') {
      return null;
    }
    if (recorded !== undefined && typeof recorded !== 'boolean') {
      return null;
    }
    const row: CodingProjectRow = { name, description, stars };
    if (typeof pushedAt === 'string') {
      row.pushedAt = pushedAt;
    }
    if (typeof closedPulls === 'number') {
      row.closedPulls = closedPulls;
    }
    if (typeof release === 'string') {
      row.release = release;
    }
    if (typeof releasedAt === 'string') {
      row.releasedAt = releasedAt;
    }
    if (typeof releaseSha === 'string') {
      row.releaseSha = releaseSha;
    }
    if (pinned === true) {
      row.pinned = true;
    }
    if (recorded === true) {
      row.recorded = true;
    }
    repos.push(row);
  }
  return { repos };
}
