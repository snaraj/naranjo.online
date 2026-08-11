import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

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
});
