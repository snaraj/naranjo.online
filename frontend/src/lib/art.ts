/* The Art gallery's rows (owner directive, issue 134): eight full-resolution
 * placeholder photographs, present so the owner can watch the page behave
 * under genuinely heavy media before any real artwork exists.
 *
 * Nothing here is in this repository, and that is requirement 11 rather than a
 * convenience: heavy media never enters git, the bundle, the embed, the image,
 * or a ConfigMap. Each row is a logical identity — a content digest and a file
 * name — that lib/media.ts turns into the one public URL shape the origin
 * accepts. Where the bytes actually live is an operator concern this tree is
 * not allowed to know, and a component never learns a host, a volume or a
 * path from it.
 *
 * The digests are the addresses AND the identity: the origin serves an
 * immutable publication under the digest of its own bytes, so a row here names
 * exactly one file and can never quietly come to mean another.
 *
 * Provenance, plainly: these are placeholder photographs from Lorem Picsum,
 * which serves Unsplash photography under the Unsplash Licence — free to use,
 * no attribution required. That is what was verified; nothing more is claimed.
 * They are 3840x2160 and 0.44-1.2 MB each on purpose, and they are temporary:
 * the owner replaces them with real work, at which point these rows change and
 * this note goes with them.
 *
 * What each photograph DEPICTS is deliberately not described. The files are
 * random placeholders and nobody has reviewed their subjects, so an alt text
 * naming a scene would be a caption invented to look finished — the same
 * failure as a panel inventing a figure. Each is described as what it
 * verifiably is: one placeholder, numbered, of eight. */

import type { MediaGalleryProps } from './blocks.ts';
import { mediaUrl, type MediaPublication } from './media.ts';

export interface ArtPiece {
  /* The SHA-256 of the file's bytes, lowercase hex: its immutable address. */
  readonly sha256: string;
  /* The published file name, the last segment of its public URL. */
  readonly file: string;
}

/* The short placeholder paragraph under the Art heading. */
export const artNote =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.';

/* Where the pictures come from, said on the page rather than only in source. */
export const artProvenance =
  'Placeholder photography from Lorem Picsum under the Unsplash Licence (free use, no attribution required), to be replaced by real work.';

/* The designed state for an origin that is not serving the pictures. It is not
 * an error and must not read as one: media delivery is off by default and
 * turning it on is a separate operator decision, so the truthful thing to say
 * is that the artwork is not being served here — never that something failed,
 * and never a broken picture icon.
 *
 * It claims only what is observable. The gallery cannot know WHY a picture did
 * not arrive, and it deliberately does not guess: "not being served here yet"
 * is true whether the media root is unconfigured, the capability is off, or
 * that publication is genuinely absent. */
export const artUnavailableNote =
  'The photographs are not being served here yet, so the gallery is showing its frames.';

export const artPieces: readonly ArtPiece[] = [
  { sha256: 'abc9001d65daa2d394a8a665c3cfdde2ca5bc19243cf2d1e2fbccd31d761631f', file: 'art-01-aurora.jpg' },
  { sha256: '72ead064993b6fc28afec516abcf124e7babae1b018791062c23ee098fa4d8f9', file: 'art-02-basalt.jpg' },
  { sha256: 'fb9ab0d1baabfaece546ae24e4e5d0200da8e24c3f7f8720cd68c316520be9ec', file: 'art-03-cirrus.jpg' },
  { sha256: '9562fbb40482ba80d475dda20aa201e8abdbbc1d39d9cb420b2b6fb521ffad36', file: 'art-04-dunes.jpg' },
  { sha256: '3c0502b678fdb3a222f9198059679fa5b1b8c17fc319959f47303a9b49645fe2', file: 'art-05-fjord.jpg' },
  { sha256: '25132347b356bb23ee635b51c82e075d7c189cc04785dd98a37a95c987b3a2d7', file: 'art-06-glacier.jpg' },
  { sha256: '5512203ad9acffa618a7bb953fe04540884d639cd2c9d302ba1fee23c3a0e55a', file: 'art-07-harbor.jpg' },
  { sha256: 'e690fee1d952b1c71a0bfc4d9c2b9e1b0c1bd65784a90354da67a7511e0a0b0a', file: 'art-08-ironwood.jpg' }
];

/* Every photograph is the same shape, and the frame reserves it before a byte
 * arrives. Stated once, here, so the markup's width/height attributes and the
 * stylesheet's reserved box cannot disagree about the ratio and shift the page
 * when the first picture lands. */
export const artWidth = 3840;
export const artHeight = 2160;

/* The logical publication one row stands for. Components call this rather than
 * assembling a URL, so the only place a media address is built is media.ts and
 * a row can never produce a shape the origin refuses to serve. */
export function artPublication(piece: ArtPiece): MediaPublication {
  return { kind: 'immutable', sha256: piece.sha256, path: piece.file };
}

/* The public URL for one row. */
export function artSource(piece: ArtPiece): string {
  return mediaUrl(artPublication(piece));
}

/* What a reader who cannot see the picture is told. It describes what is
 * verifiably true — which placeholder this is, out of how many — instead of a
 * scene nobody has looked at. */
export function artLabel(index: number, total: number): string {
  return `Placeholder photograph ${index + 1} of ${total}`;
}

/* The adapter (issue 165): the rows above as MediaGallery props. Static —
 * the addresses and the shared frame box are build-time facts — so the
 * manifest binds it once and the component that renders it knows no digest,
 * no URL builder and no provenance note of its own. */
export const artGalleryProps: MediaGalleryProps = {
  items: artPieces.map((piece, index) => ({
    key: piece.sha256,
    src: artSource(piece),
    alt: artLabel(index, artPieces.length)
  })),
  width: artWidth,
  height: artHeight,
  unavailableNote: artUnavailableNote
};
