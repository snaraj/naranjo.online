/* The Professional Experience section's entries (owner directive,
 * 2026-08-25).
 *
 * This module used to hold two lorem-ipsum entries under a note saying so
 * (issue 134). The owner supplied the real history, so the placeholder copy
 * and the honest-state note that accompanied it are both gone: there is
 * nothing left to disclaim, and a "placeholder entries" line over four real
 * roles would be its own kind of false statement.
 *
 * The content is the owner's PORTFOLIO — employer, role, dates, work location
 * and what was accomplished there — which is the narrow canonical exception
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

import type { EntryLogProps } from './blocks.ts';

export interface WorkEntry {
  /* The employer, and the entry's heading and keyed-each key. */
  readonly company: string;
  /* The role held there. */
  readonly role: string;
  /* The span, as the owner writes it — a portfolio date range, never an
   * instant, so it stays a plain string rather than something a locale could
   * re-render per visitor. */
  readonly dates: string;
  /* Where the role was based. */
  readonly location: string;
  /* What was accomplished, one bullet each. */
  readonly points: readonly string[];
}

/* workByline is the one meta line under an entry's heading: the role, the
 * span and the place, in that order, joined by the page's own separator. It
 * is a function rather than a field so the three facts stay separate DATA —
 * a test reads each of them back out of the composed line, and a later design
 * that wants them in three boxes rewrites this and nothing else. */
export const workBylineSeparator = ' · ';

export function workByline(entry: WorkEntry): string {
  return [entry.role, entry.dates, entry.location].join(workBylineSeparator);
}

export const workEntries: readonly WorkEntry[] = [
  {
    company: 'Panasonic Avionics Corporation',
    role: 'Software Engineer, Automation, DevOps and Tools',
    dates: 'July 2023 – Present',
    location: 'Irvine, CA',
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
    role: 'Software Engineer, Condition Based Maintenance',
    dates: 'Mar 2022 – July 2023',
    location: 'Austin, TX',
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
    role: 'Software Engineering Intern',
    dates: 'May 2019 – Aug 2019',
    location: 'Towson, MD',
    points: [
      'Implemented XPath-queried scripts that automate the test suites verifying the reliability of new web releases.',
      'Built a daily regression-test framework that detects whether a new feature has adversely affected existing behavior.'
    ]
  },
  {
    company: 'University of Maryland, Baltimore County — LIDAR Research Group',
    role: 'Software Engineering Intern',
    dates: 'May 2017 – Aug 2017',
    location: 'Baltimore, MD',
    points: [
      'Halved the per-run time of the in-house Mie-scattering algorithm for aerosol and air-quality evaluation by automating its configuration, input/output and export steps.',
      "Created graphical representations of aerosol distributions with MATLAB and Python's Matplotlib."
    ]
  }
];

/* The adapter (issue 165): the rows above as EntryLog props. The company is
 * the entry's title, the composed byline carries role, span and place, and
 * the accomplishments arrive as the entry's own points list — the shape the
 * card renders, with no domain vocabulary in a single field name. The titles
 * sit at h3, directly under the section's own h2, and the default framed card
 * variant is deliberate: these are the page's primary records, not a compact
 * list.
 *
 * No entry carries `placeholder` any more, and that absence is the honest
 * state rather than the loss of one: the DOM marker existed to say "this is
 * filler under a real heading", and there is no filler left to mark. */
export const workHistoryProps: EntryLogProps = {
  entries: workEntries.map((entry) => ({
    key: entry.company,
    title: entry.company,
    byline: workByline(entry),
    points: entry.points
  })),
  titleLevel: 3
};
