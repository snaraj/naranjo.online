import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import viteConfig from '../vite.config.ts';

// Daybreak Blue review of PR #173/#174 (MEDIUM finding #4): round 1's
// vite.config.ts called validatedDevApiPort() unconditionally at module
// scope, so `vite build` -- which never reads DEV_API_PORT for anything --
// still evaluated it, and a hostile value could throw and break a
// production build. `defineConfig`'s function form makes `export default`
// the config FUNCTION itself (Vite documents this identity behavior), so
// these tests call it directly with the exact { command, mode } shape Vite
// passes, with no Vite runtime needed.
describe('vite.config command-scoping', () => {
  it('a production build never evaluates DEV_API_PORT, even a hostile one', () => {
    const previous = process.env.DEV_API_PORT;
    process.env.DEV_API_PORT = '80@evil.example';
    try {
      const config = viteConfig({ command: 'build', mode: 'production' });
      assert.equal(
        config.server,
        undefined,
        'a build config must carry no dev-only server/proxy block',
      );
    } finally {
      if (previous === undefined) delete process.env.DEV_API_PORT;
      else process.env.DEV_API_PORT = previous;
    }
  });

  it('a production build config is unaffected by DEV_API_PORT being unset entirely', () => {
    const previous = process.env.DEV_API_PORT;
    delete process.env.DEV_API_PORT;
    try {
      const config = viteConfig({ command: 'build', mode: 'production' });
      assert.equal(config.build.outDir, '../internal/web/dist');
      assert.equal(config.build.assetsInlineLimit, 0);
      assert.equal(config.server, undefined);
    } finally {
      if (previous !== undefined) process.env.DEV_API_PORT = previous;
    }
  });

  it('serve mode still proxies correctly for a well-formed port', () => {
    const previous = process.env.DEV_API_PORT;
    process.env.DEV_API_PORT = '9090';
    try {
      const config = viteConfig({ command: 'serve', mode: 'development' });
      assert.equal(config.server.host, '127.0.0.1');
      assert.equal(config.server.proxy['/api'].target, 'http://127.0.0.1:9090');
      assert.equal(config.server.proxy['/api'].changeOrigin, true);
    } finally {
      if (previous === undefined) delete process.env.DEV_API_PORT;
      else process.env.DEV_API_PORT = previous;
    }
  });

  it('serve mode still fails closed on a hostile DEV_API_PORT', () => {
    const previous = process.env.DEV_API_PORT;
    process.env.DEV_API_PORT = '80@evil.example';
    try {
      assert.throws(() => viteConfig({ command: 'serve', mode: 'development' }));
    } finally {
      if (previous === undefined) delete process.env.DEV_API_PORT;
      else process.env.DEV_API_PORT = previous;
    }
  });

  it('the build settings are identical byte for byte across both commands', () => {
    const previous = process.env.DEV_API_PORT;
    process.env.DEV_API_PORT = '9090';
    try {
      const buildCfg = viteConfig({ command: 'build', mode: 'production' });
      const serveCfg = viteConfig({ command: 'serve', mode: 'development' });
      assert.deepEqual(buildCfg.build, serveCfg.build);
    } finally {
      if (previous === undefined) delete process.env.DEV_API_PORT;
      else process.env.DEV_API_PORT = previous;
    }
  });
});
