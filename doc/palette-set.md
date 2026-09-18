# The palette-set extension

Fork-original. Adds curated colour palettes to PuzzleScript Next, plus the
tooling to derive, check, preview and export them.

Descendant of the working prompt that commissioned it: that document said what
to build, this one says what exists and how to add the next one.

---

## What is here

| | |
|---|---|
| `src/js/colors.js` | Four palettes at indices 15–18, inside a labelled fork block |
| `tools/palette_analysis.py` | Derivation, the three checks, and the code generators |
| `src/demo/palette-refs.txt` | The same palettes as portable prelude blocks |
| `src/js/palettes_ui.js` | The **PALETTES** panel: preview, apply, export |
| `src/Documentation/prelude.html` | User-facing list with credits |
| `tools/palette_lib.py` | Shared colour maths, used by both tools |
| `tools/palette_curate.py` | Rating *candidate* palettes — see `doc/palette-curation.md` |
| `tools/palette_test.py` | Checks for both tools, including that the generated files above still match their generators |

The palettes:

| # | name | source | author |
|---|---|---|---|
| 15 | `bentenpond` | [Benten Pond](https://lospec.com/palette-list/benten-pond) | Terry Ross |
| 16 | `dungeon20` | [Dungeon-20](https://lospec.com/palette-list/dungeon-20) | Meaghan (goldentreesart) |
| 17 | `oekakinl` | [Oekaki.nl](https://lospec.com/palette-list/oekakinl) | P-Tux7 |
| 18 | `soggysepia` | [Soggy Sepia CRT-20](https://lospec.com/palette-list/soggy-sepia-crt-20) | Digi (@Digitress) |

Indices continue at 15 and the inherited fourteen are untouched, so an upstream
merge stays a clean diff.

## Two ways to use a palette, and why both exist

```
color_palette bentenpond
```

Short, readable, and **only works on this fork**. Stock PuzzleScript and
PuzzleScript Plus have never heard the name and will fall back to arnecolors
with an error.

```
color_palette arnecolors black #292f25 white #d8d2ae grey #736f52 ...
```

Every colour spelled out as an override on a palette every build has. Runs
anywhere. This is what you distribute.

Author with the short form; export the long one when you publish. The
**PALETTES** panel does the conversion, and `src/demo/palette-refs.txt` holds all
four ready to paste.

The two forms now render identically in `puzzlescript-map-editor/` too. They
did not before: the map editor read the base palette name and dropped every
override, so the one representation meant to be portable was the one it drew in
the wrong colours. It also never consulted its own numeric aliases, so
`color_palette 3` fell back to arnecolors. Both are fixed, it carries all
eighteen palettes now, and its test suite checks that copy against
`src/js/colors.js` slot by slot whenever the two are checked out together.

One detail that is easy to get wrong by hand: the block must also set
`gray`, `darkgray` and `lightgray`. They are spelling aliases, not extra
colours, but they are separate keys — omit them and a game that spells grey the
American way silently keeps arnecolors' three greys while everything else
changes.

## The PALETTES panel

In the editor toolbar, next to LEVEL EDITOR.

- **all palettes** — every palette as a swatch strip, for comparing them
- **preview** — one palette as 21 labelled chips with hex
- **in editor** — redraws the running game and the level editor under that
  palette. Nothing is written to your source; it swaps the palette object the
  renderer reads and forces a sprite regen. *clear override* puts it back.
- **export** — the portable prelude block, with its credit line

"in editor" works because sprites store colour *names* and resolve them against
`state.metadata.color_palette` every time sprite images are rebuilt. Swapping the
palette and regenerating is the whole mechanism, which is why it is reversible
and why it cannot corrupt a game.

## Adding another palette

`doc/palette-curation.md` covers the stage before this one — finding candidates,
rating them and deciding. Its tooling replaces steps 1-3 below with a fitted,
rated draft you correct; steps 4 and 5 are unchanged either way.

Two things now notice on their own when you add one, so neither needs editing:
the calibration corpus reads the fork block's own comment markers in
`colors.js` rather than carrying a list, and `puzzlescript-map-editor`'s test
suite fails until the new palette is copied into its vendored table.

1. Add the source hex to `SOURCES` in `tools/palette_analysis.py`.
2. `uv run tools/palette_analysis.py` — the raw hue-clustering pass plus the
   three checks, with the fourteen shipped palettes printed underneath as a
   baseline.
3. Read the clustering against the slot list and write the result into
   `CURATED`, with a comment for every slot the source cannot supply. The
   clusterer gets ramps right but has no judgement: it will cheerfully make a
   pale cream your `darkbrown`.
4. Regenerate both outputs — they are generated, never hand-edited:
   ```sh
   uv run tools/palette_analysis.py --emit-js    # paste into colors.js
   uv run tools/palette_analysis.py --emit-refs > src/demo/palette-refs.txt
   uv run tools/palette_test.py                  # confirms they match
   ```
5. Add an alias index and a credit in `prelude.html` and in
   `paletteCredits` in `palettes_ui.js`.

### The rubric

Every mapping is checked three ways, and gaps are never papered over — a slot is
either sourced, or a stated addition.

- **Contrast** — WCAG relative luminance for all 210 pairs, flagging below 1.3.
- **Colourblindness** — protanopia, deuteranopia and tritanopia simulated by
  matrix; flags pairs that are clearly distinct normally (RGB distance > 20) but
  collapse under simulation (< 15). The "looks fine to you, invisible to them"
  case.
- **Duplicate hex** — how many of the 21 slots are actually distinct. Sharing is
  not automatically wrong; three of the fourteen built-ins do it.

A fourth check was added later, in `tools/palette_lib.py`, and applies to both
tools: within a ramp, **luminance must increase at every step**. `lightred`
darker than `red` is a mapping error, and contrast and colourblindness both
measure pairs in isolation, so neither notices a ramp running backwards. Ten of
the fourteen inherited palettes have no such fault, and all four palettes above
have none; `palette_curate.py audit` lists the exceptions, one of which
(`proteus_night`'s `lightgreen`, a near-black navy) looks like an inherited
copy-paste error rather than a stylistic choice.

One thing that came out of building the curation tool is worth knowing before
hand-mapping anything: **arnecolors is a fallback, not a dictionary.** It is the
right table to fall back to — that is a compatibility requirement — but it is a
poor guide to what a slot name *means*. Five of its twenty-one colours do not
classify as their own name: `darkgreen` `#2f484e` is a slate, `darkblue` is
near-black, `purple` `#342a97` is blue-violet, `pink` is magenta, `lightbrown`
`#eeb62f` is a golden yellow. Measured against the fourteen inherited palettes
it is the most typical colour for only seven of the twenty-one slots.
`palette_curate.py anchors` prints what the corpus actually means by each name.

## How these four came out

Measured against the fourteen inherited palettes, which span **26–75**
low-contrast pairs and **0–13** colourblind collapses:

| palette | sourced | distinct | contrast < 1.3 | CVD collapses | ramp faults |
|---|---|---|---|---|---|
| `oekakinl` | 18/21 | 21/21 | 28 | 4 | 0 |
| `dungeon20` | 15/21 | 21/21 | 35 | 7 | 0 |
| `bentenpond` | 17/21 | 21/21 | 37 | 10 | 0 |
| `soggysepia` | 17/21 | 21/21 | 40 | 2 | 0 |

All four are inside the inherited range, all four have distinct values for every
slot, and none has a ramp that runs backwards.

- **`oekakinl` is the most legible** and the safest default. Its numbers sit
  beside arnecolors (29 / 5), it has true black and white, and only three slots
  are additions.
- **`bentenpond` is the most beautiful and the least literal.** Ten CVD
  collapses is high — below proteus_night's 13, but the clustering is
  structural: its greys, greens and reds all share a muted mid-lightness band,
  which is exactly what makes the palette pretty. If a game distinguishes two
  objects *only* by colour, check them under simulation first.
- **`dungeon20` fits PuzzleScript's slot list worst**, though its raw numbers are
  middling. Six of twenty-one slots are additions because the source has no
  green, no pink, no light red and no dark brown — by design; it is a dungeon
  mood, not a general palette. Use it for the atmosphere, and do not assume
  `green` means anything characteristic of Dungeon-20, because nothing in
  Dungeon-20 is green.
- **`soggysepia` is the most robust under colour blindness**, and the reason is
  worth understanding rather than trusting. Two collapses is the lowest of the
  four, but that is not because the palette is especially colourful — it is
  because it separates by *lightness* far more than by hue, and lightness
  survives simulation. Its four source ramps are eight evenly-stepped tones
  each. The flip side is that under deuteranopia the whole warm half — reds,
  browns, orange, greens — reads as one sepia range, and only the blues stand
  apart. Objects distinguished by lightness will be fine; objects distinguished
  by warm hue alone will not.

### soggysepia in particular

The source is four eight-step phosphor ramps: sepia, red, green, purple. Two
things about it shaped the mapping.

**Every ramp jumps from about L 30 to L 51.** That hole is the palette's CRT
character and no mapping hides it — whichever five colours carry `black` to
`white`, one step is roughly twice the others, so grey-ramp evenness comes out
around 0.16. For scale, `ega` ships at 0.16 and `proteus_mellow` at 0.27.

**There is no blue anywhere.** A CRT palette with red, green and purple ramps
and no blue is a conspicuous gap, so the three blues are built to the source's
own plan — three steps at its lightnesses and its chroma, pushed to hue 235 so
they stay clear of the purple ramp instead of collapsing into it. `yellow` is
the fourth addition: the source's only yellow-ish colours are the pale top of
its green ramp, 31° of hue away, and calling a fourth green `yellow` in a
palette that already has three is the failure the rubric exists to catch.

The one warm ramp had to be either `red` or `brown` and could not be both —
taking three of each from it leaves one of the two with no dark end. So `red` is
the warm ramp proper, spanning its full range, and `brown` is the sepia ramp's
middle, which is genuinely brown (hue 25–36) rather than a neutral pressed into
service. The greys then take the purple ramp's near-neutral dark end and the
sepia ramp's light end: shadows lean faintly plum, highlights faintly warm, and
at chroma under 11 all five still read as neutral.

No further hand-tuning is recommended before use. The additions already sit in
each palette's own saturation range, and the remaining flags are inherent to the
source palettes rather than artefacts of the mapping.

## A bug this work surfaced

`color_palette <name> <overrides...>` assigned the shared `colorPalettes` entry
**by reference** and then wrote the overrides into it. One game's overrides
therefore repainted the built-in palette for every game compiled afterwards in
the same session — load a game with overrides, then any other game using that
base palette, and the second game got the first one's colours.

Fixed in `compiler.js` by copying at all three assignment sites. It is upstream
behaviour, not fork-original, and worth reporting upstream.

The ramp audit later turned up a second inherited defect worth reporting with
it: `proteus_night` has `green` `#75ac8d`, a mid sage, and `lightgreen`
`#061f2e`, a near-black navy. Nothing here changes it - repainting a shipped
palette would repaint every existing game that uses it.

## Credits

Palettes are used with credit to their authors; each is adapted, not copied
verbatim, since PuzzleScript's twenty-one fixed slots rarely match a palette's
own count. Additions are marked everywhere they appear — in `colors.js`
comments, in `palette-refs.txt`, in the docs, and in the exported block.
