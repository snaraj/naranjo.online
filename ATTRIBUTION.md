# Third-party content attribution

## Old School RuneScape boss icons

The images under `frontend/src/assets/icons/bosses/` are small downscaled
thumbnails of Old School RuneScape artwork, sourced from the
[Old School RuneScape Wiki](https://oldschool.runescape.wiki/) — thanks to
the wiki community for hosting and curating them. The underlying artwork is
Jagex intellectual property, used on this personal, non-commercial site as
fan content:

> Created using intellectual property belonging to Jagex Limited under the
> terms of Jagex's Fan Content Policy. This content is not endorsed by or
> affiliated with Jagex.

The panel serves every boss the hiscores report, and only a handful of them
have a vendored icon here. That is deliberate: no art is fetched to fill the
gap, and a boss without an icon renders a plain initials tile instead. A
frontend test enforces the direction that matters — every icon that ships
must belong to a boss the origin actually serves, so third-party art can
never outlive the data that justified vendoring it. Widening the icon set is
an owner decision, taken one reviewed batch at a time.

## RuneLite-style panel chrome

The site's side rail recreates the look of the RuneLite client's side panel
purely in CSS from RuneLite's published palette values (RuneLite is
BSD-2-Clause open source). Color values are facts; no RuneLite artwork,
sprites, or logo — a registered trademark — are included in this repository.
