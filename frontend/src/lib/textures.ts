/* The band textures, and the one rule that says which of them a reading mode
 * shows (owner directive, 2026-09-03, issue 287).
 *
 * The page opens and closes on a picture band, and the picture follows the
 * reading mode: two per mode, chosen with the arrows on the band itself. This
 * module is that decision and nothing else — pure functions over file NAMES, so
 * a node test executes it directly. The URLs are the bundler's business and are
 * built where the bundler is allowed to be (lib/blocks/textureBand.ts), exactly
 * as the icon and gallery maps already are.
 *
 * A texture is chosen from the mode the DOCUMENT is in, not from a preference
 * stored anywhere: `auto` is the absence of a stamp, so it resolves through the
 * same prefers-color-scheme question the stylesheet asks, and the answer is
 * either the dark set or the light one. Nothing is persisted — a cookie for a
 * decorative picture would be a tracking surface the site does not need, and the
 * owner asked only that the choice survive the visit. */

import { autoMode, documentMode, type ModeId, type ThemeId } from './themes.ts';

/* One texture: the file it ships as, and the words the band's label reads.
 * The name is data the label renders, so the component composes nothing. */
export interface Texture {
  readonly file: string;
  readonly name: string;
}

/* Every reading mode's own pair, in cycle order. Keyed by the STAMPED theme
 * ids — auto has no set of its own because auto is not a palette; it borrows
 * whichever palette the device asked for (resolvedTheme below). */
export const textureSets: Readonly<Record<ThemeId, readonly Texture[]>> = {
  light: [
    { file: 'light-spikes.jpg', name: 'spikes' },
    { file: 'light-plaster.jpg', name: 'plaster' }
  ],
  dark: [
    { file: 'dark-refraction.jpg', name: 'refraction' },
    { file: 'dark-wave.jpg', name: 'wave' }
  ],
  slate: [
    { file: 'slate-fluid.jpg', name: 'fluid' },
    { file: 'slate-stars.jpg', name: 'stars' }
  ],
  sepia: [
    { file: 'sepia-galaxy.jpg', name: 'galaxy' },
    { file: 'sepia-eclipse.jpg', name: 'eclipse' }
  ]
};

/* Every texture this site vendors, in mode order. The band paints one layer
 * per file and crossfades between them, so it needs the whole list up front —
 * a layer that mounted on demand would fade in from nothing the first time. */
export const textures: readonly Texture[] = Object.values(textureSets).flat();

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

/* The set a mode shows, in cycle order. Total by construction — every branch
 * of ModeId lands on a real pair, so the band never has an empty list to
 * render. */
export function textureSet(mode: ModeId, prefersDark: boolean): readonly Texture[] {
  return textureSets[resolvedTheme(mode, prefersDark)];
}

/* Where the arrows land. Both directions wrap, and a negative step wraps
 * through the modulus rather than off the end of the array. */
export function nextTextureIndex(index: number, count: number, step: number): number {
  if (count <= 0) {
    return 0;
  }
  return (((index + step) % count) + count) % count;
}

/* The label the band prints, as data: `texture 1/2 — plaster` on a desktop,
 * `texture 1/2` where there is no room for the name. Built here rather than in
 * the component for the same reason every other figure on this page is: a
 * component that composed a sentence would be a component with an opinion
 * about words. */
export function textureLabel(texture: Texture, index: number, count: number, withName: boolean): string {
  const position = `texture ${index + 1}/${count}`;
  return withName ? `${position} — ${texture.name}` : position;
}

/* The media query the resolution above asks. Spelled once, here, so the
 * component and its test read the same string. */
export const prefersDarkQuery = '(prefers-color-scheme: dark)';

/* Whether the device is asking for dark right now. A host with no matchMedia —
 * an older engine, a test document — answers false, which lands on the light
 * set: the same palette the stylesheet paints when nothing else has spoken. */
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
