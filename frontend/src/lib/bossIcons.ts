/* Boss identity helpers for the boss-log rail. Boss names are API data,
 * never frontend constants: the slug below is the only bridge from a data
 * name to an icon file shipped under assets/icons/bosses, so adding a boss
 * icon is a file drop and a missing file falls back to an initials glyph.
 * These helpers stay free of build-tool APIs so tests run them under plain
 * node; the asset lookup itself lives in BossLog.svelte. */

/* bossSlug canonicalizes a display name into the lowercase hyphenated form
 * icon files are named by, e.g. "Chambers of Xeric" into chambers-of-xeric
 * and "TzKal-Zuk" into tzkal-zuk. */
export function bossSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* bossInitials feeds the fallback glyph when no icon file matches: the
 * first letters of the first and last words, so "The Whisperer" reads TW
 * and a single word keeps one letter. */
export function bossInitials(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return '?';
  }
  const first = words[0].charAt(0);
  if (words.length === 1) {
    return first.toUpperCase();
  }
  return (first + words[words.length - 1].charAt(0)).toUpperCase();
}
