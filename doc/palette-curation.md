# Curating a palette

Fork-original. The stage *before* `doc/palette-set.md`: finding candidate
palettes, rating them, and deciding which are worth adopting.

`palette_analysis.py` documents and generates the palettes already chosen.
This tool is for the pile you have not chosen from yet.

---

## What is here

| | |
|---|---|
| `tools/palette_lib.py` | Shared colour maths — the slot list, WCAG contrast, the CVD matrices, CIELab, the ramp checks, the file parsers |
| `tools/palette_curate.py` | The curation CLI: fit, rate, look at, combine, record |
| `tools/palette_verdicts.json` | Your decisions. The tool never writes anything else |
| `tools/candidates-example/` | Three palettes in the three input formats, to run against |

`palette_analysis.py` now imports its maths from `palette_lib.py` rather than
carrying its own copy. Two tools that disagreed about what "deuteranopia" meant
would produce numbers that could not be compared, which is the whole point of
scoring a candidate against the shipped corpus. Its output is unchanged, except
that `--json` now also carries the ramp data and the baseline correctly reports
fourteen palettes (see *What changed underneath*).

## The shape of the thing

```sh
uv run tools/palette_curate.py score  candidates/           rank them
uv run tools/palette_curate.py sheet  candidates/ -o s.html look at them
uv run tools/palette_curate.py show   candidates/foo.hex    one in full
uv run tools/palette_curate.py combos candidates/           who fills whose gaps
uv run tools/palette_curate.py audit                        check what already ships
uv run tools/palette_curate.py verdict foo accept -m "..."  record a decision
uv run tools/palette_curate.py emit-curated candidates/foo.hex
```

Reads `.hex`, `.gpl`, `.pal`, `.json`, and any text file with hex codes in it —
between them, what Lospec, Coolors, GIMP and Aseprite export. Dependency-free,
so `uv run` needs no resolution step.

Start with `sheet`. The numbers are an index, not an answer: you cannot tell
whether a palette is worth using without looking at it, and looking at twenty-one
labelled chips is the entire job. The score exists to order the reading queue.

## Where palettes come from

`fetch` pulls straight from Lospec, which serves every palette as JSON at a
predictable URL — `https://lospec.com/palette-list/<slug>.json` — so "open up
the palette browser" is one GET per palette and no scraping:

```sh
uv run tools/palette_curate.py fetch benten-pond dungeon-20 -o candidates/
```

**This is blocked in the sandbox this was written in.** The egress proxy
rejects `lospec.com:443` under organisation policy, so `fetch` reports the
failure and tells you to do it by hand. The manual path is the supported one
and is barely worse: Lospec's palette pages have .hex, .gpl and .pal download
buttons, and the tool reads all three, so dropping files into a folder and
pointing `score` at the folder works offline and always has. If you want
`fetch` to work, the environment's network policy is the thing to change, not
the code.

## The two modes

This is the design question worth understanding before trusting any number.

"Does this palette fit PuzzleScript" is really two questions, and which one you
want depends on what you will do with the palette:

- **literal** (default) — a slot must mean what PuzzleScript means by it.
  `green` is green. Where the source has no green, one is synthesised at
  arnecolors' hue and the candidate's own saturation, marked `added`, and the
  palette is reported as a partial fit.

- **legible** (`--mode legible`) — every colour comes from the source and the
  slot names are just labels. `green` may be a teal, as long as all twenty-one
  slots stay distinguishable. Nothing is invented.

The distinction is not academic, because slot names are PuzzleScript's
*authoring* surface. Someone writing a sprite legend types `green` because the
grass is green. Under legible mode the board still renders coherently and
readably, but the author's mental model no longer matches the screen. So:

> **legible mode suits a palette you author with from the start. Literal mode
> suits one you drop into a game already written against arnecolors.**

`role` — how much each slot still means what PuzzleScript means by it — is
reported in both modes and *scored* only in literal mode. What replaces it in
legible mode is `separation`, the closest any two of the twenty-one slots come
to each other perceptually, because that is the thing that actually has to hold
if `green` is allowed to be a teal.

### Legible mode is not free, and the tool will tell you so

The obvious worry is that legible mode is a way of flattering a bad palette.
Measured, it is the opposite — it is a way of finding out whether a palette has
twenty-one distinguishable colours at all:

| palette | literal | legible |
|---|---|---|
| Oekaki.nl | 78.1 | 75.4 |
| Dungeon-20 | 75.6 | 65.4 |
| Benten Pond | 61.8 | 50.7 |

Dungeon-20 drops ten points. It has no green, so legible mode renames its
yellows — and its yellows then collide with its actual yellow and orange slots,
so contrast falls from the 36th percentile to the 21st and colourblind
separation from the 89th to the 57th. For that palette, *synthesising* three
greens is genuinely better than renaming three yellows, because the source
simply does not contain twenty-one things you can tell apart.

That is the honest answer to "could a palette missing some hues still be
legible": sometimes, and the way to find out is to run both modes and read the
`sep` column, not to decide in advance.

A stand-in is always a whole **family**, never a scatter of individually-distinct
colours. An early version picked the most mutually-distant spare colours and
produced a "green" ramp of cyan, orange and pale yellow — three slots that are
easy to tell apart and are not a ramp, so a game shading one object across
`darkgreen`/`green`/`lightgreen` would have got three unrelated hues. Ramps that
have a real family also claim it before any stand-in runs, or a missing `green`
helps itself to the blues and leaves `blue` deriving from leftovers.

## The rating

Six axes in literal mode, six in legible, each 0–100 and higher-is-better, plus
a weighted composite. Every axis is always printed, so you can disagree with the
weighting and read the components instead.

| axis | what it measures | literal | legible |
|---|---|---|---|
| `source` | how much of the mapping is really the source's — `derived` counts half, a stand-in counts full | 20 | 20 |
| `role` | how well each slot still means what PuzzleScript means by it | 15 | *shown, not scored* |
| `ramps` | dark→base→light actually gets lighter, and evenly | 20 | 15 |
| `contrast` | WCAG pairs below 1.3, as a percentile against the inherited palettes | 20 | 20 |
| `cvd` | colourblind collapses, same percentile | 15 | 15 |
| `distinct` | distinct hex values out of 21 | 10 | 10 |
| `separation` | the closest any two slots come, perceptually | — | 20 |

Contrast, CVD and separation are scored as **percentiles against the fourteen
inherited palettes**, not against an absolute ideal, because the absolute
numbers mean nothing on their own: the rubric's 1.3 floor flags twenty-six pairs
in `famicom`, which has shipped since 1983. The fork's own three are excluded
from that corpus — grading this work against a corpus containing this work
would flatter it in exactly one direction.

### The ramp rule, and the evidence for it

Within a ramp, luminance must increase at every step. `lightred` darker than
`red` is not a stylistic choice, it is a mapping error, and it is the most
common way a hand-written mapping goes wrong — contrast and CVD both measure
pairs in isolation, so neither notices a ramp running backwards.

`audit` checks this against the palettes that already ship, which is the right
way round: if the inherited palettes broke the rule routinely, the rule would be
wrong rather than they. They do not. Ten of the fourteen have zero faults, all
three fork palettes have zero, and the exceptions are real defects:

```
pastel           green: lightgreen is 15.2 L darker than green
ega              grey:  grey is 0.0 L darker than darkgrey     (duplicate hex)
ega              brown: brown is 0.0 L darker than darkbrown   (duplicate hex)
ega              green: green is 2.5 L darker than darkgreen
proteus_night    green: lightgreen is 55.2 L darker than green
proteus_rich     red:   red is 4.4 L darker than darkred
```

`proteus_night` is worth a look on its own account: `green` is `#75ac8d`, a mid
sage, and `lightgreen` is `#061f2e` — a near-black navy. Its `darkgreen` is
`#0a2434`, also navy. That is not a ramp with an uneven step, it is almost
certainly a copy-paste error from the blue slots that has been shipping for
years. **It is inherited, not fork-original, and changing it would repaint every
existing game that uses that palette, so nothing here touches it.** Worth
reporting upstream alongside the `color_palette` aliasing bug in
`doc/palette-set.md`.

## What the fitter gets wrong

It is a first draft, not a proposal you should adopt unread. It gets ramps and
neutrals right and has no judgement about meaning. Known weaknesses, all visible
in `tools/candidates-example/`:

- **Weak oranges.** Where a palette's only orange-hued colour is a pale cream,
  the fitter relights it to the slot's lightness and produces a khaki. Benten
  Pond's `orange` comes out `#a8a280`; the human curating it added `#c9793f`
  instead. Relighting preserves hue and chroma, and low chroma stays low.
- **It will not tell you a palette is beautiful.** Benten Pond scores worst of
  the three on every reading and was still the right adoption. The score orders
  a queue; it does not rank palettes by whether they are worth using.
- **`role` is measured against arnecolors' hues**, so a palette in a genuinely
  different register is marked down for being itself.
- **Stand-in family choice is greedy**, scored on lightness range, spare count
  and distance from what is already placed. It is not an optimal assignment and
  does not claim to be.

The guard against the worst failure — the one the original derivation notes
warned about, the clusterer "cheerfully making a pale cream your `darkbrown`" —
is a hue cap: a colour more than 45° round the circle from the slot it would
fill is not borrowed at all. Relighting a mid green does not produce a yellow,
it produces a pale green called `yellow`, which is worse than admitting the gap.

## Adding a palette, with the tool

This replaces steps 1–3 of *Adding a fourth palette* in `doc/palette-set.md`;
steps 4 and 5 are unchanged.

1. Get the palette into a folder — Lospec download button, or `fetch` if the
   network allows.
2. `score` the folder, then `sheet` it and actually look.
3. `show` the ones that survive. Read the provenance notes: every slot that is
   not `sourced` says why, and those are the lines that need a human.
4. `combos` if a candidate is close but short — it pools two palettes and
   re-fits, rather than grafting slot by slot, and only reports pairs that score
   better than either alone.
5. `verdict <slug> accept|reject|maybe -m "why"`. The note is the point; the
   verdict is just a filter. `sheet` shows them.
6. `emit-curated` drafts the `CURATED` and `SOURCES` blocks for
   `palette_analysis.py`, with every non-sourced slot's reason as a comment.
   **Correct it, then paste it.** That is step 3 of the old process made cheap,
   not automated away.
7. Continue at step 4 of `doc/palette-set.md`: regenerate both outputs, add the
   alias index and the credit.

## What changed underneath

Two behaviour changes in `palette_analysis.py`, both deliberate:

- The maths moved to `palette_lib.py`. Output of `--emit-js`, `--emit-refs` and
  the default report is byte-identical; `--json` gains `cvd_total`,
  `ramp_faults` and `ramp_evenness`.
- `baseline()` excluded the fork's own three palettes and its header stopped
  saying "the 14 shipped palettes" while printing seventeen. Once
  `bentenpond`, `dungeon20` and `oekakinl` landed in `colors.js`, a plain read
  of that file returned all seventeen and the "shipped range" quietly widened to
  include the palettes being measured against it. The printed range is unchanged
  at 26–75 low-contrast pairs and 0–13 CVD collapses — all three sat inside it —
  so every number quoted in `doc/palette-set.md` still holds.

## Credits

Unchanged from `doc/palette-set.md`: palettes are used with credit to their
authors, adapted rather than copied verbatim, and additions are marked
everywhere they appear. The tool enforces the marking — nothing reaches an
export without its provenance attached.
