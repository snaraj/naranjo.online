/* Every lane fails on a Content-Security-Policy violation, in every engine.
 *
 * The origin's policy is the browser's half of the site's security headers,
 * and a page that silently depends on something it forbids is a page that
 * renders differently from what the lanes measured. Each context a lane uses
 * reports two ways, because the engines differ in which one they keep: the
 * `securitypolicyviolation` event, re-spoken on the console by an init script
 * that runs before any page script, and the engine's own console line about
 * the policy. The `context` fixture is watched for every lane; a lane that
 * opens its own context watches it with watchCSP. */
import { expect, test as base } from '@playwright/test';

export async function watchCSP(context, breaches) {
  context.on('console', (message) => {
    if (/content.security.policy|securitypolicyviolation/i.test(message.text())) breaches.push(message.text());
  });
  await context.addInitScript(() => {
    document.addEventListener(
      'securitypolicyviolation',
      (event) => console.error(`securitypolicyviolation ${event.violatedDirective} ${event.blockedURI}`),
      true
    );
  });
}

export const test = base.extend({
  cspBreaches: async ({}, use) => {
    const breaches = [];
    await use(breaches);
    expect([...new Set(breaches)], 'the page broke its own Content-Security-Policy').toEqual([]);
  },
  context: async ({ context, cspBreaches }, use) => {
    await watchCSP(context, cspBreaches);
    await use(context);
  },
});

export { expect };
