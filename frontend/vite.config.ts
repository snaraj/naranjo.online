import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

import { validatedDevApiPort } from './src/lib/devApiPort.ts';

// DEV_API_PORT names the locally built backend binary's port for the `/api`
// proxy below; `make dev` sets it to PORT (default 8080), after its own
// Makefile-level validate-port gate. validatedDevApiPort re-validates
// independently and fails closed HERE, at config load, because
// `npm run dev` can be invoked directly with an arbitrary DEV_API_PORT,
// bypassing the Makefile gate entirely -- see devApiPort.ts for why this
// validation, not the Makefile's, is what actually protects the URL built
// below. It affects only the `vite dev` server config, never `build` -- a
// production build reads no environment variable and this key does not
// exist in its output.
const devApiPort = validatedDevApiPort(process.env.DEV_API_PORT ?? '8080');

export default defineConfig({
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
  // Dev-server-only: `vite build` never reads this block, so it cannot
  // change production build output (proven by a before/after dist digest
  // comparison in the PR that added it). Binds 127.0.0.1 only, and proxies
  // `/api` to the locally built backend binary `make dev` launches on
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
});
