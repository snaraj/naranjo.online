<!-- J, the owner's dragon, FLYING (owner direction, 2026-10-16: "J's being
  trapped between two frames does not look good, lets swap him for the flying
  J again and give him a bit of a back-forth rotation, subtle"). The sheet is
  the owner's own flight study, the one commit 792f49b swapped for the typing
  render, restored byte for byte.

  ONE SEAT NOW (owner direction, 2026-10-16: "do away with [the bar] for now,
  put J elsewhere"). He bookended the chrome row from two seats (issue 314 at
  its end, issue 325 at its start, mirrored to face inwards); the row is gone,
  and he flies beside the name instead (App.svelte), as rendered — the flight
  faces screen-left, which from the name's upper right is toward it. The
  mirrored seat had no caller left, so its prop and its rule left with it.

  He is a PICTURE and nothing else: no text, no link, no control, aria-hidden,
  so a screen reader reads past nothing and the keyboard gains no stop.

  THE BOX AND THE PICTURE ARE TWO THINGS, and that is how he arrives without
  moving anything. The span is a square of the size his seat hands him
  (--j-size, the seat's own measure; the site's 44px control square when no
  seat says), RESERVED, so his box is the same before either file arrives as
  after (the zero-CLS floor). The picture is the span's ::before: out of flow,
  so it sizes nothing, drawn into exactly that square, and it takes no pointer,
  so nothing under him is ever unpressable because he flies over it. His size
  used to be derived from the bar's frame, which he had to fly past; there is
  no bar to clear any more, so the picture is the box.

  ONE PICTURE PER READER. At rest he is the still — frame 0 of the sheet,
  re-encoded losslessly, so it is exactly the pose the flight starts from. The
  sheet, its grid and the three animations (the two steps() that walk the
  sheet, and the slow rock) are declared together inside the no-preference
  block, so a reader who asked for less motion downloads only the 5kB still and
  never the 882kB sheet, and a reader who welcomes motion never downloads the
  still: a browser fetches only the background-image an element computes.

  The files are named here, in the component's own style, so the bundler
  resolves each to a content-hashed same-origin URL (assetsInlineLimit is 0, so
  never a data: URI the origin's policy would refuse); the markup never learns
  a file name. -->
<span class="j-flight" aria-hidden="true"></span>

<style>
  /* THE RESERVED BOX, and every measure of him stated once, here.

     --j-box is the square his seat hands him. The sheet is 20 columns by 24
     rows of square cells (480 frames at 60Hz), and its drawn size is derived
     from --j-box rather than restated, so one cell is always exactly his
     square and the keyframes below walk whole cells at any size the seat asks
     for.

     --j-flight is the whole loop and --j-flight-row one row of it, DIVIDED so
     the two animations stay phase-locked: a written row duration drifts a
     column across the sheet over time and every row boundary then shows a
     wrong frame. The rock is a few degrees each way over a slow swing — a
     glide, not a wobble. */
  .j-flight {
    --j-box: var(--j-size, var(--control-target));
    --j-sheet-inline: calc(var(--j-box) * 20);
    --j-sheet-block: calc(var(--j-box) * 24);
    --j-flight: 8s;
    --j-flight-row: calc(var(--j-flight) / 24);
    --j-rock-angle: 4deg;
    --j-rock-swing: 3.2s;
    display: block;
    position: relative;
    flex: none;
    inline-size: var(--j-box);
    block-size: var(--j-box);
  }

  /* THE PICTURE: exactly the box, out of flow. At rest it is the still, drawn
     whole. */
  .j-flight::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image: url('../../assets/images/j/j-flight-still.webp');
    background-repeat: no-repeat;
    background-position: 0 0;
    background-size: 100% 100%;
  }

  /* THE FLIGHT AND THE ROCK, only where motion is welcome. Two steps()
     composed on the picture walk the sheet — the 20 cells of a row, then the
     24 rows — naming each of the 480 frames once before the loop closes;
     steps() because a sprite has no in-between state, and a tween would draw
     two half-frames at once. The rock is the one smooth motion: ease-in-out
     and alternating, so he leans one way, slows, and leans back, with no
     corner at either end. */
  @media (prefers-reduced-motion: no-preference) {
    .j-flight::before {
      background-image: url('../../assets/images/j/j-flight.webp');
      background-size: var(--j-sheet-inline) var(--j-sheet-block);
      animation:
        j-flight-row var(--j-flight-row) steps(20) infinite,
        j-flight-sheet var(--j-flight) steps(24) infinite,
        j-rock var(--j-rock-swing) ease-in-out infinite alternate;
    }
  }

  /* Each sheet keyframe travels the sheet's own measurement, read back from
     the token the background is sized by, so the grid is stated once. */
  @keyframes j-flight-row {
    to {
      background-position-x: calc(-1 * var(--j-sheet-inline));
    }
  }

  @keyframes j-flight-sheet {
    to {
      background-position-y: calc(-1 * var(--j-sheet-block));
    }
  }

  @keyframes j-rock {
    from {
      transform: rotate(calc(-1 * var(--j-rock-angle)));
    }

    to {
      transform: rotate(var(--j-rock-angle));
    }
  }
</style>
