import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

import { validatedDevApiPort } from './src/lib/devApiPort.ts';

// The build config is shared by both commands; the dev-only server/proxy
// block below is added ONLY when Vite's own `command` argument is 'serve'
// (`vite dev` / `npm run dev`), never for 'build'. This is the actual fix
// for Daybreak Blue's finding that a hostile DEV_API_PORT could break a
// production build: round 1 called validatedDevApiPort() unconditionally
// at module scope, so `vite build` evaluated it -- and therefore could
// throw -- even though a build never reads DEV_API_PORT's value for
// anything. Scoping to 'serve' means a build no longer evaluates
// DEV_API_PORT, valid or hostile, at all: see
// tests/vite-config.test.mjs, which calls this file's exported config
// function directly with `{ command: 'build' }` and a hostile
// DEV_API_PORT and asserts it neither throws nor returns a server block.
const buildConfig = {
  plugins: [svelte()],
  build: {
    // The origin serves CSP default-src 'self', which forbids data: URIs,
    // so no asset may ever be inlined: every icon stays a real same-origin
    // file with a content-hashed (digest-stable) name.
    assetsInlineLimit: 0,
    emptyOutDir: true,
    outDir: '../internal/web/dist',
    sourcemap: false,
  },
};

export default defineConfig(({ command }) => {
  if (command !== 'serve') {
    return buildConfig;
  }

  // DEV_API_PORT names the locally built backend binary's port for the
  // `/api` proxy below; `make dev` sets it to PORT (default 8080), after
  // its own Makefile-level validate-port gate. validatedDevApiPort
  // re-validates independently and fails closed HERE, at config load,
  // because `npm run dev` can be invoked directly with an arbitrary
  // DEV_API_PORT, bypassing the Makefile gate entirely -- see
  // devApiPort.ts for why this validation, not the Makefile's, is what
  // actually protects the URL built below. This whole branch runs only
  // for `vite dev`; `vite build` returns buildConfig above and never
  // reaches this line.
  const devApiPort = validatedDevApiPort(process.env.DEV_API_PORT ?? '8080');

  return {
    ...buildConfig,
    // Dev-server-only: proven unreachable from `vite build` by the early
    // return above (structural, not merely empirically byte-identical
    // output as round 1 proved). Binds 127.0.0.1 only, and proxies `/api`
    // to the locally built backend binary `make dev` launches on
    // DEV_API_PORT, so hot-reload editing can see real panel data.
    server: {
      host: '127.0.0.1',
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${devApiPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
