/* Identity helpers for the Old School RuneScape stats rail. Boss and skill
 * names are API data, never frontend constants: the slug below is the only
 * bridge from a data name to an icon file shipped under assets/icons, so
 * adding an icon is a file drop and a missing file falls back to an initials
 * glyph. These helpers stay free of build-tool APIs so tests run them under
 * plain node; the asset lookups themselves live in BossLog.svelte.
 */

/* assetSlug canonicalizes a display name into the lowercase hyphenated form
 * icon files are named by, e.g. "Chambers of Xeric" into chambers-of-xeric
 * and "TzKal-Zuk" into tzkal-zuk. One rule for both tables: an icon file is
 * always named by exactly the data name it serves, so the two directories
 * can never drift into two different naming conventions. */
function assetSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* bossSlug names a file under assets/icons/bosses. */
export function bossSlug(name: string): string {
  return assetSlug(name);
}

/* skillSlug names a file under assets/icons/skills. */
export function skillSlug(name: string): string {
  return assetSlug(name);
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
