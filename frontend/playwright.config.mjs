/* Rendering lanes, stage 2 (issue #26): the browser-emulated smoke lanes.
 *
 * The stage-1 floors are pinned in the source, where they are decided. These
 * lanes answer the question a source pin cannot: what did an actual engine
 * DO with those declarations. Three engines cover every browser the owner
 * named — Chromium is Chrome and Edge, WebKit is Safari and every iOS
 * browser, Gecko is Firefox — and two of them run again under phone
 * emulation, because a floor about phones that only ever ran at 1280px is a
 * floor nobody measured.
 *
 * Zero spend, by construction: the browsers are downloaded once from
 * Playwright's own CDN onto a GitHub-hosted public-repo runner, the origin
 * under test is this repository's own Go binary on localhost, and nothing
 * else is contacted. No service, no account, no key.
 *
 * The suite is deliberately a SMOKE matrix and not a second test suite: it
 * runs one navigation per floor per engine and asserts what the engine
 * reports, so the whole matrix stays inside a couple of runner-minutes.
 */
import { defineConfig, devices } from '@playwright/test';

/* The origin's own port (AGENTS.md requirement 8), overridable so a machine
 * already serving something on it can still run the lanes. */
const port = Number(process.env.SITE_PORT ?? 8080);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  /* No retries anywhere. A flake is a finding that names its test
     (AGENTS.md, "Flake probe"), and a retry is how a suite stops reporting
     one. */
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  /* Several agent lanes share one machine and heavy suites contend for CPU
     (AGENTS.md, "Parallel agents in one checkout"). Two workers keeps this
     matrix from being the lane that starves the others. */
  workers: 2,
  reporter: 'list',
  timeout: 30_000,
  outputDir: './test-results',
  use: {
    baseURL: origin,
    /* Nothing is recorded. Traces, videos and screenshots are debugging
       conveniences that cost disk and runner time on every run, and this
       matrix is a smoke gate: it either reports a floor breach in its
       failure message or it has not done its job. */
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  /* The real artifact, not a dev server: the Go binary serving the embedded
     build, exactly as the container does. `npm run build` must have run — the
     binary refuses to start without the embedded site, which is the honest
     failure rather than a lane that silently tests nothing. */
  webServer: {
    command: 'go run ./cmd/server',
    cwd: '..',
    env: {
      PORT: String(port),
      /* Both capabilities that reach outside the process are stated OFF
         rather than left to a default, so the lane cannot make a network
         request even if a default ever changes. */
      MEDIA_ENABLED: 'false',
      PANELS_REFRESH: 'false',
    },
    /* Readiness is the origin's own truthful probe (requirement 8), so the
       lanes start when the server can really serve, never after a sleep. */
    url: `${origin}/readyz`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    /* Chromium covers Chrome AND Edge: Edge is Chromium with a different
       shell, and pinning the branded channel would need a system-installed
       browser this runner does not have and must not download from a
       vendor. */
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    /* WebKit is the Safari engine, and on iOS it is the ONLY engine — every
       iOS browser is WebKit underneath, so this project is what "works on
       iPhone" means. */
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    /* The phone lanes: an Android viewport on Chromium and an iPhone
       viewport on WebKit, both with touch and the mobile meta-viewport
       enabled, which is where the safe-area, touch-target and
       no-sideways-scroll floors actually apply. */
    { name: 'android-chrome', use: { ...devices['Pixel 5'] } },
    { name: 'ios-safari', use: { ...devices['iPhone 13'] } },
  ],
});
