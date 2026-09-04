/* Where the band's pictures actually live, resolved by the bundler.
 *
 * Split from lib/textures.ts for the same reason lib/blocks/osrsStats.ts is
 * split from lib/bossLog.ts: `import.meta.glob` is the bundler's, and a module
 * that calls it cannot run under plain node — which is where the mapping rules
 * beside it are executed. So the RULES stay pure and testable, and this file
 * does one thing: turn each vendored file name into the content-hashed,
 * same-origin URL the build produced for it.
 *
 * Every file the glob finds must be named by lib/textures.ts, and every name
 * that module states must resolve here. A texture that resolved to nothing
 * would render as a blank band rather than as an error, so the resolution is
 * total by construction: an unmatched name throws at module load, where a
 * build catches it, instead of painting nothing on a page nobody is watching.
 */

import { textures, type Texture } from './textures.ts';

const files = import.meta.glob('../assets/textures/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>;

/* One vendored texture, ready to paint: the decision layer's own record plus
 * the URL the build gave it. */
export interface BandTexture extends Texture {
  readonly url: string;
}

export const bandTextures: readonly BandTexture[] = textures.map((texture) => {
  const url = files[`../assets/textures/${texture.file}`];
  if (url === undefined) {
    throw new Error(`no vendored texture for ${texture.file}`);
  }
  return { ...texture, url };
});
