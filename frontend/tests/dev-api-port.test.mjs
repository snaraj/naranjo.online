import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validatedDevApiPort } from '../src/lib/devApiPort.ts';

// Daybreak Blue review of PR #173 (HIGH finding #1): an unvalidated
// DEV_API_PORT concatenated into vite.config.ts's proxy target URL is a
// vector to move that target off 127.0.0.1. These cases are the hostile
// regressions the finding asked for, demonstrated against the actual attack
// shape rather than only against well-formed input.
describe('validatedDevApiPort', () => {
  it('accepts the default and the full valid range', () => {
    assert.equal(validatedDevApiPort('8080'), '8080');
    assert.equal(validatedDevApiPort('1'), '1');
    assert.equal(validatedDevApiPort('65535'), '65535');
  });

  it('a validated value always resolves to the literal 127.0.0.1 host', () => {
    const url = new URL(`http://127.0.0.1:${validatedDevApiPort('8080')}`);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '8080');
  });

  it('rejects a shell-metacharacter injection shape', () => {
    assert.throws(() => validatedDevApiPort('18173; printf CYBER_REVIEW_INJECTION'));
  });

  it('rejects an @-host shape and proves what it would have done unvalidated', () => {
    const hostile = '80@evil.example';
    assert.throws(() => validatedDevApiPort(hostile));
    // The reproduction: had this string reached vite.config.ts's template
    // literal unvalidated, `new URL` would have parsed everything before
    // "@" as userinfo and handed the proxy to "evil.example" instead of
    // 127.0.0.1 -- this is the exact vector the throw above closes.
    const wouldHaveBeen = new URL(`http://127.0.0.1:${hostile}`);
    assert.equal(wouldHaveBeen.hostname, 'evil.example');
  });

  it('rejects empty, out-of-range, and non-numeric values', () => {
    for (const value of ['', '0', '65536', '99999999', 'not-a-port', '8080x', ' 8080', '08080@x']) {
      assert.throws(
        () => validatedDevApiPort(value),
        `expected rejection for ${JSON.stringify(value)}`,
      );
    }
  });
});
