/* The Professional Experience section's entries (owner directive,
 * 2026-08-25).
 *
 * This module used to hold two lorem-ipsum entries under a note saying so
 * (issue 134). The owner supplied the real history, so the placeholder copy
 * and the honest-state note that accompanied it are both gone: there is
 * nothing left to disclaim, and a "placeholder entries" line over four real
 * roles would be its own kind of false statement.
 *
 * The content is the owner's PORTFOLIO — employer, its public website, role,
 * dates, work location and what was accomplished there — the narrow exception
 * requirement 12 names alongside the commit identity and the license. Nothing
 * beyond it is written down: no contact detail, no address, no account, no
 * private operational fact about any employer's systems. What is here is what
 * a public portfolio page says about a career.
 *
 * The rows live here rather than inside the component for the same reason
 * they always did: the properties that carry meaning — four entries, newest
 * first, every one of them complete, every bullet a real accomplishment
 * rather than a duty — are executed by tests/sections.test.mjs against this
 * module instead of being pattern matched through an each-block. */

import type { LedgerLogProps } from './blocks.ts';

export interface WorkEntry {
  /* The employer, and the entry's heading and keyed-each key. */
  readonly company: string;
  /* The employer as the LEDGER names it, and the span as the ledger writes it
   * (owner directive, 2026-09-03, issue 287). Neither is a new fact: both are
   * shorter renderings of `company` and `dates` above, for a row that gives a
   * name one column and a span another rather than a card that gives a
   * sentence a whole line. They are DATA rather than a derivation because
   * shortening a name is an editorial judgement — "University of Maryland,
   * Baltimore County — LIDAR Research Group" has no mechanical short form, and
   * a rule that guessed one would guess wrong on the next entry. The long
   * forms stay authoritative: they are what the accessible name and the
   * drawer's link carry. */
  readonly short: string;
  readonly years: string;
  /* The role held there. */
  readonly role: string;
  /* The span, as the owner writes it — a portfolio date range, never an
   * instant, so it stays a plain string rather than something a locale could
   * re-render per visitor. */
  readonly dates: string;
  /* Where the role was based. */
  readonly location: string;
  /* The employer's own home on the web (owner directive, 2026-08-28, issue
   * 243). It is a public marketing address and nothing else: no account, no
   * portal, no private host, which is what keeps it inside requirement 12's
   * portfolio exception rather than outside it. Every one was resolved before
   * being written down — the value here is the address that answered, so a
   * reader is not sent through a redirect the site could have skipped.
   * Required rather than optional: all four roles have one, and an optional
   * field would invite a future entry to quietly ship without it. */
  readonly site: string;
  /* What was accomplished, one bullet each. */
  readonly points: readonly string[];
}

export const workEntries: readonly WorkEntry[] = [
  {
    company: 'Panasonic Avionics Corporation',
    short: 'Panasonic Avionics',
    years: '2023 —',
    role: 'Software Engineer, Automation, DevOps and Tools',
    dates: 'July 2023 – Present',
    location: 'Irvine, CA',
    site: 'https://www.panasonic.aero',
    points: [
      'Productionalized legacy RouterOS infrastructure into a self-service, multi-region platform that lets engineers connect physical access points to cloud-hosted Virtual Racks anywhere in the world — 4,100+ unique devices, and an 80% reduction in MikroTik management tickets.',
      'Expanded the Virtual Rack platform with a mechanism for developers to deploy custom x86 and ARM KubeVirt virtual machines alongside the native infrastructure; roughly 47% of users now deploy custom workloads regularly.',
      "Improved the platform's mean time to acknowledge and mean time to resolve by 37% as production on-call engineer.",
      'Triaged and resolved a recurring production out-of-memory defect in the API through a 102-experiment, agent-assisted investigation — 97% reduction in heap growth, with no production impact.',
      'Accelerated Virtual Rack provisioning by 79% with a Kubernetes-native snapshot orchestration system: a VirtualRackSnapshot custom resource and controller automating the snapshot, restore and state reconciliation of KubeVirt workloads.',
      'Reduced AWS spend by 15% by redesigning multicast provisioning around a Kubernetes operator with per-rack MulticastGroup resources for namespaced network isolation — an 85% reduction in networking costs.'
    ]
  },
  {
    company: 'Fathom5',
    short: 'Fathom5',
    years: '2022 – 23',
    role: 'Software Engineer, Condition Based Maintenance',
    dates: 'Mar 2022 – July 2023',
    location: 'Austin, TX',
    site: 'https://www.fathom5.com',
    points: [
      'Architected and deployed the microservices that let the US Navy perform remote condition-based maintenance across fleets of warships, saving millions of dollars in unnecessary repairs and thousands of hours of reactive labor.',
      'Improved continuous integration with automated jobs that build and deploy production-like environments for service, unit and integration testing.',
      'Configured and hardened every layer of an air-gapped infrastructure-as-code deployment — hypervisor, RHEL, Kubernetes — and built an in-house tool that deploys clusters completely offline onto a custom RHEL-based system.',
      'Developed a Kubernetes operator around a custom ERMAnalytic resource that lets Navy-sanctioned AI developers self-onboard and consume vessel sensor data, with an admission controller validating every submission.',
      'Created self-managed X.509 issuing and authentication workflows for that operator, using HashiCorp Vault as the certificate authority with cert-manager, issuing per-resource certificates on demand.'
    ]
  },
  {
    company: 'OnTrajectory',
    short: 'OnTrajectory',
    years: '2019',
    role: 'Software Engineering Intern',
    dates: 'May 2019 – Aug 2019',
    location: 'Towson, MD',
    site: 'https://www.ontrajectory.com',
    points: [
      'Implemented XPath-queried scripts that automate the test suites verifying the reliability of new web releases.',
      'Built a daily regression-test framework that detects whether a new feature has adversely affected existing behavior.'
    ]
  },
  {
    company: 'University of Maryland, Baltimore County — LIDAR Research Group',
    short: 'UMBC LIDAR Research Group',
    years: '2017',
    role: 'Software Engineering Intern',
    dates: 'May 2017 – Aug 2017',
    location: 'Baltimore, MD',
    site: 'https://umbc.edu',
    points: [
      'Halved the per-run time of the in-house Mie-scattering algorithm for aerosol and air-quality evaluation by automating its configuration, input/output and export steps.',
      "Created graphical representations of aerosol distributions with MATLAB and Python's Matplotlib."
    ]
  }
];

/* ---------------------------------------------------------------------------
 * The ledger adapter (owner directive, 2026-09-03, issue 287)
 *
 * The same four roles, in the same order, as ruled rows that open. What
 * changed is the SHAPE: a span, a name, a role and a place across one line,
 * with the accomplishments in a drawer under it rather than always on the
 * page. The section is a summary that expands, which is what the owner asked
 * for — four cards of six bullets each was most of a screen before a reader
 * had chosen to read any of it.
 *
 * The employer link survives the change and moves INSIDE the drawer, because
 * the row itself is now the disclosure control and an anchor inside a button
 * is invalid content that no keyboard can reach. It is still the employer's
 * own public home, still opened in a new tab, still announced as doing so.
 *
 * The two words the chevron says are here rather than in the component for the
 * same reason every other label on this page is: a component that composed
 * "Expand Fathom5" would be a component with an opinion about English.
 * ------------------------------------------------------------------------ */

export const workExpandLabel = 'Expand';
export const workCollapseLabel = 'Collapse';
export const workEmptyNote = 'no roles recorded';

export const roleLedgerProps: LedgerLogProps = {
  rows: workEntries.map((entry) => ({
    key: entry.company,
    span: entry.years,
    name: entry.short,
    role: entry.role,
    place: entry.location,
    points: entry.points,
    link: {
      text: entry.company,
      href: entry.site,
      label: `${entry.company}, opens in a new tab`
    }
  })),
  emptyNote: workEmptyNote,
  expandLabel: workExpandLabel,
  collapseLabel: workCollapseLabel
};
