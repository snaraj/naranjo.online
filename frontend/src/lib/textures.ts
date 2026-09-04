/* The band textures, and the one rule that says which of them a reading mode
 * shows (owner directive, 2026-09-03, issue 287; one picture per mode since
 * 2026-09-04, issue 292, when the owner cut the cycle box).
 *
 * The page opens and closes on a picture band, and the picture follows the
 * reading mode. This module is that decision and nothing else — a pure mapping
 * over file NAMES, so it needs no bundler to run. The URLs are the bundler's
 * business and are built where the bundler is allowed to be
 * (lib/textureAssets.ts), exactly as the icon and gallery maps already are.
 *
 * A texture is chosen from the mode the DOCUMENT is in, not from a preference
 * stored anywhere: `auto` is the absence of a stamp, so it resolves through the
 * same prefers-color-scheme question the stylesheet asks, and the answer is
 * either the dark picture or the light one. Nothing is persisted — a cookie for
 * a decorative picture would be a tracking surface the site does not need. */

import { autoMode, documentMode, type ModeId, type ThemeId } from './themes.ts';

/* One texture: the file it ships as. */
export interface Texture {
  readonly file: string;
}

/* Every reading mode's own picture. Keyed by the STAMPED theme ids — auto has
 * no picture of its own because auto is not a palette; it borrows whichever
 * palette the device asked for (resolvedTheme below). */
export const modeTextures: Readonly<Record<ThemeId, Texture>> = {
  light: { file: 'light-spikes.jpg' },
  dark: { file: 'dark-refraction.jpg' },
  slate: { file: 'slate-fluid.jpg' },
  sepia: { file: 'sepia-galaxy.jpg' }
};

/* Every texture this site vendors, in mode order. The band is handed the whole
 * list and mounts the picture showing and the one it left, so a mode switch
 * crossfades between two decoded pictures rather than flashing the ground. */
export const textures: readonly Texture[] = Object.values(modeTextures);

/* resolvedTheme answers the question `auto` leaves open: which palette is
 * actually painting. A stamped document names its own mode; an unstamped one
 * follows the device, and the fallback when nothing can be asked (a server
 * render, a test host with no matchMedia) is `light`, which is the palette the
 * stylesheet's own :root defaults paint. */
export function resolvedTheme(mode: ModeId, prefersDark: boolean): ThemeId {
  if (mode !== autoMode) {
    return mode;
  }
  return prefersDark ? 'dark' : 'light';
}

/* The picture a mode shows. Total by construction — every branch of ModeId
 * lands on a real file, so the band never has nothing to paint. */
export function textureFor(mode: ModeId, prefersDark: boolean): Texture {
  return modeTextures[resolvedTheme(mode, prefersDark)];
}

/* The media query the resolution above asks. Spelled once, here, so the
 * component and its test read the same string. */
export const prefersDarkQuery = '(prefers-color-scheme: dark)';

/* Whether the device is asking for dark right now. A host with no matchMedia —
 * an older engine, a test document — answers false, which lands on the light
 * picture: the same palette the stylesheet paints when nothing else has spoken. */
export function documentPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(prefersDarkQuery).matches;
}

/* The mode the band is showing for, read from the live document. It is
 * documentMode() by another name, re-exported through this module so the band
 * imports its whole world from one place. */
export function bandMode(): ModeId {
  return documentMode();
}
