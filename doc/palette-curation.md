# Curating a palette

Fork-original. The stage *before* `doc/palette-set.md`: finding candidate
palettes, rating them, and deciding which are worth adopting.

`palette_analysis.py` documents and generates the palettes already chosen.
This tool is for the pile you have not chosen from yet.

---

## Ten-minute version

Run everything from the repository root.

```sh
mkdir -p tools/candidates            # drop .hex / .gpl / .pal / .json in here
uv run tools/palette_test.py                                    # says all passed
uv run tools/palette_curate.py score   tools/candidates/        # rank them
uv run tools/palette_curate.py compare tools/candidates/        # does the mode matter?
uv run tools/palette_curate.py combos  tools/candidates/        # any pair better together?
uv run tools/palette_curate.py sheet   tools/candidates/ -o tools/candidates/sheet.html
open tools/candidates/sheet.html                                # LOOK at them
uv run tools/palette_curate.py show    tools/candidates/best.hex
uv run tools/palette_curate.py verdict best accept -m "why"
uv run tools/palette_curate.py emit-curated tools/candidates/best.hex
```

Then continue at step 4 of `doc/palette-set.md`.

Nothing is special about `tools/candidates/` except that it is `.gitignore`d,
so downloaded palettes and generated sheets do not end up in a commit. Any
directory works; every command takes paths.

The only step that is not optional is looking at the sheet. A score orders a
reading queue; it cannot tell you a palette is beautiful. Benten Pond scores
worst of the ten shipped palettes on every reading and was still the right
adoption.

## Where things go

**Input** is any file or directory you name on the command line. There is no
configured location and no search path — if you would rather keep candidates on
your desktop, point at your desktop.

**Output** is stdout for everything except two things:

| what | where | in git? |
|---|---|---|
| `score`, `compare`, `show`, `combos`, `audit`, `anchors` | stdout — redirect if you want a file; `score --json` for machine-readable | no |
| `emit-curated`, `block` | stdout — made to be read, corrected, and pasted | no |
| `sheet` | the `-o` path; defaults to `./palette-sheet.html` | no, if you keep it in `tools/candidates/` |
| `union` | the `-o` path, a `.gpl` file | no — it is a candidate, not a decision |
| `preview` | the `-o` path; defaults to `./palette-preview.html` | no |
| `sync_map_editor.py` | the vendored copy under `puzzlescript-map-editor/` | **yes** — see `doc/map-editor-sync.md` |
| `verdict` | `tools/palette_verdicts.json`, always | **yes** — it is the record of your decisions |
| `fetch` | the `-o` directory; defaults to `./candidates` | no |

`tools/palette_verdicts.json` is the only file the tool writes on its own, and
the only one meant to be committed. Nothing writes to `src/`: `emit-curated`
prints a draft for you to correct and paste into `palette_analysis.py`, and
`--emit-js` prints a block for you to paste into `colors.js`. That is
deliberate — a tool that edited the engine's palette table directly would make
a curation mistake indistinguishable from a bug.

## Using it like any other command-line tool

Every command that takes palettes takes **any mix of files, directories and
shell globs**, so the ordinary things work:

```sh
uv run tools/palette_curate.py score tools/candidates/           # a folder
uv run tools/palette_curate.py score tools/candidates/*.gpl      # a glob
uv run tools/palette_curate.py score candidates/ one-more.hex    # both
```

Directories are walked recursively. Duplicate palettes collapse and colliding
slugs are disambiguated, both reported on stderr, so pointing at a folder of
mixed downloads does the sensible thing.

**Pipes work.** `score candidates/ | head` used to print a `BrokenPipeError`
traceback and exit 1, because Python flushes stdout at shutdown and the flush
hit the closed pipe. All four scripts now exit 141 instead — what a shell
reports for a process killed by SIGPIPE — with nothing on stderr.

**Reports go to stdout, diagnostics to stderr**, so `2>/dev/null` drops the
"skipped this file" notes without touching the table, and `>` captures a report
without capturing them.

**Exit codes** are 0 on success, 1 when there is nothing to do or a check
failed (`sync_map_editor.py --check` on drift, `fetch` with nothing fetched),
141 on a closed pipe.

For anything the fixed table cannot answer — *everything with no colourblind
collapses*, *sorted by sourced slots* — `score --json` prints the same numbers
in a shape `jq` can work on:

```sh
uv run tools/palette_curate.py score candidates/ --json \
  | jq -r '.candidates[] | select(.cvd_collapses == 0) | "\(.name) \(.score)"'

uv run tools/palette_curate.py score candidates/ --json \
  | jq -r '.candidates | sort_by(-.provenance.sourced)[] | "\(.provenance.sourced)/21 \(.name)"'
```

Each entry carries the score and all six axes, the provenance counts, the raw
metrics (`distinct`, `low_contrast_pairs`, `cvd_collapses`, `ramp_faults`,
`ramp_evenness`), any recorded verdict, and the full mapping with its per-slot
provenance. The corpus the percentiles were taken against is in there too, so a
number can be read without re-running anything.

## What runs where, and in what language

The curation tooling is Python; nothing a *player* or a *game author* touches
is.

| | language | when |
|---|---|---|
| `tools/*.py` | Python, via `uv run` | only while deciding on and generating a palette |
| `src/js/colors.js` | JavaScript | the engine, at runtime |
| `src/js/palettes_ui.js` | JavaScript | the **PALETTES** panel in the editor toolbar |
| `puzzlescript-map-editor/` | JavaScript, Node and browser | the standalone map toolkit |

So: Python is a build-time tool for this repository, not a dependency of the
engine, the editor, the map editor, or anything you ship. A game author never
runs it. If you only want to *use* the palettes, the PALETTES panel does
preview, apply and export without touching a terminal, and
`src/demo/palette-refs.txt` has all ten ready to paste.

You need Python only to rate a new candidate palette or to regenerate the
generated files, and only `uv` — the scripts are dependency-free with PEP 723
headers, so `uv run` needs no resolution step and there is no environment to
create.

## What is here

| | |
|---|---|
| `tools/palette_lib.py` | Shared colour maths — the slot list, WCAG contrast, the CVD matrices, CIELab, the ramp checks, the anchor lexicon, the file parsers |
| `tools/palette_curate.py` | The curation CLI: fit, rate, look at, combine, record |
| `tools/palette_verdicts.json` | Your decisions. The tool never writes anything else |
| `tools/candidates-example/` | Three palettes in the three input formats, to run against |
| `tools/palette_test.py` | The checks. `uv run tools/palette_test.py` |

`palette_analysis.py` now imports its maths from `palette_lib.py` rather than
carrying its own copy. Two tools that disagreed about what "deuteranopia" meant
would produce numbers that could not be compared, which is the whole point of
scoring a candidate against the shipped corpus. Its output is unchanged, except
that `--json` now also carries the ramp data and the baseline correctly reports
fourteen palettes (see *What changed underneath*).

## The shape of the thing

```sh
uv run tools/palette_curate.py score  candidates/           rank them
uv run tools/palette_curate.py compare candidates/          both modes at once
uv run tools/palette_curate.py sheet  candidates/ -o s.html look at them
uv run tools/palette_curate.py show   candidates/foo.hex    one in full
uv run tools/palette_curate.py combos candidates/           who fills whose gaps
uv run tools/palette_curate.py union a.gpl b.gpl -o both.gpl   pool them into one
uv run tools/palette_curate.py audit                        check what already ships
uv run tools/palette_curate.py preview --fork -o p.html     LOOK at what already ships
uv run tools/palette_curate.py anchors                      the slot-name lexicon
uv run tools/palette_curate.py verdict foo accept -m "..."  record a decision
uv run tools/palette_curate.py emit-curated candidates/foo.hex
```

Reads `.hex`, `.gpl`, `.pal`, `.json`, and any text file with hex codes in it —
between them, what Lospec, Coolors, GIMP and Aseprite export. Dependency-free,
so `uv run` needs no resolution step.

Start with `sheet`. The numbers are an index, not an answer: you cannot tell
whether a palette is worth using without looking at it, and looking at twenty-one
labelled chips is the entire job. The score exists to order the reading queue.

## Looking at what already ships

`sheet` renders candidates. `preview` does the same for the palettes already in
`colors.js`, which nothing else did: the **PALETTES** panel shows them but needs
a browser and a running engine, and `audit` prints their numbers without showing
a single colour.

```sh
uv run tools/palette_curate.py preview --fork -o preview.html   # the fork's own
uv run tools/palette_curate.py preview soggysepia berrysepia -o pair.html
uv run tools/palette_curate.py preview -o all.html              # all of them
```

Each palette gets its twenty-one slots as labelled chips in ramp order, its
numbers, both colourblindness simulations, and its portable prelude block. Two
named palettes side by side is the quickest way to see what a change actually
did — `soggysepia berrysepia` shows one palette's synthesised blues against the
other's real ones at a glance.

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
want depends on what you will do with the palette. The modes are named for what
they fit **to**, and they claim nothing about quality — quality is what the six
axes are for, and they frequently disagree with the name.

- **`fit-colourname`** (default) — the slot name wins. `green` is green. Where
  the source has no green, one is synthesised at the anchor hue in the
  candidate's own saturation, marked `added`, and the palette is reported as a
  partial fit. The palette is *extended to satisfy the names*.

- **`fit-palette`** (`--mode fit-palette`) — the palette wins. Only the source's
  own colours are used, so a missing green becomes another family renamed and
  marked `standin`. The names are *reinterpreted to fit the palette*.

Neither is "verbatim", and it would be wrong to name one that. Both still
interpolate short ramps and relight singles within a family that exists —
Dungeon-20 under `fit-palette` is 10 sourced, 3 stand-in and **8 derived**. The
modes differ in exactly one place: what happens when a hue family is absent
*and* no neighbouring family is within `BORROW_HUE_MAX` of it. Everything else
— classification, the hue-capped borrow, interpolation, relighting — is
identical.

The distinction is not academic, because slot names are PuzzleScript's
*authoring* surface. Someone writing a sprite legend types `green` because the
grass is green. Under `fit-palette` the board still renders coherently, but the
author's mental model no longer matches the screen. So:

> **`fit-palette` suits a palette you author with from the start.
> `fit-colourname` suits one you drop into a game already written against
> arnecolors.**

`role` — how much each slot still means what PuzzleScript means by it — is
reported in both modes and *scored* only under `fit-colourname`. What replaces
it under `fit-palette` is `separation`, the closest any two of the twenty-one
slots come to each other perceptually, because that is the thing that actually
has to hold if `green` is allowed to be a teal.

### Which mode wins is a property of the palette

`compare` runs both and shows the gap:

```
  palette                colourname  palette    gap   prefers     why
  Oekaki.nl                    78.0     74.7   -3.3   either      same mapping both ways
  Dungeon-20                   67.3     71.4   +4.1   palette     4 slots would have to be
                                                                  invented; renaming 3 costs less
  benten-pond                  62.8     55.5   -7.3   either      same mapping both ways
```

**Read the `prefers` column before the scores.** Only Dungeon-20 is actually
fitted differently by the two modes. It is the only one of the three with a
family the hue-capped borrow cannot cover: it has no green anywhere, and
nothing within 45° of green to stand in. Inventing three greens crowds the
space its yellows and browns already occupy — contrast falls to the 21st
percentile — whereas renaming a spare family costs it nothing it was using.
**A palette with a true hue gap is usually better off renaming.**

Oekaki.nl and Benten Pond produce *byte-identical mappings* under both modes,
because neither has a gap the borrow cannot fill. Their score differences are
therefore not a finding about renaming at all — they are purely the axis
reweighting, `role` at 15 versus `separation` at 20. Comparing scores across
modes is only meaningful when the mappings actually differ, which is why
`compare` says `either` rather than inventing a preference.

So the honest answer to "could a palette missing some hues still be legible" is
*sometimes*, it is decided per palette, and for most palettes the question does
not arise — the borrow covers them and there is nothing to choose between.

A stand-in is always a whole **family**, never a scatter of individually-distinct
colours. An early version picked the most mutually-distant spare colours and
produced a "green" ramp of cyan, orange and pale yellow — three slots that are
easy to tell apart and are not a ramp, so a game shading one object across
`darkgreen`/`green`/`lightgreen` would have got three unrelated hues. Ramps that
have a real family also claim it before any stand-in runs, or a missing `green`
helps itself to the blues and leaves `blue` deriving from leftovers.

## Pooling palettes

Eight-colour palettes are common and none of them can fill twenty-one slots on
its own — `Rust Gold 8` alone manages seven and scores 61.6. `combos` finds
which pairs are worth putting together; `union` is what actually makes one:

```sh
uv run tools/palette_curate.py union rust-gold-8.gpl fairyrust-8x.gpl \
    -o tools/candidates/unions/rustfairy.gpl --name "Rust Gold 8 + FairyRust_8x"
uv run tools/palette_curate.py score tools/candidates/unions/
```

Any number of inputs. The output is a GIMP palette because that is the one
input format carrying a name and comments, so the file records how many colours
came from which source and every later command reads it like any other
candidate. Colours are deduplicated across sources, first occurrence winning.

**Nothing is blended.** A union is exactly the colours of its parts, which is
what keeps the result attributable to the people who made them — and it is why
`union` is a separate step rather than something `combos` does silently.

One thing measurement kept showing while the three shipped unions were being
fitted, and worth expecting: **almost every colourblind collapse in a pooled
palette is a lightness collision, not a hue problem.** Two slots landing within
a few L of each other look like different colours normally and like one colour
under simulation. Twenty-one slots across an L range of about 90 leaves roughly
4 L per slot, so it happens readily when two palettes are stacked — and the fix
is always to move whichever of the pair is `added` or `derived` into a gap
rather than to change a sourced colour's role. `doc/palette-set.md` has the
worked example, where that took one palette from four collapses to none.

## The anchors, and why they are not arnecolors

`ANCHOR` in `palette_lib.py` is the lexicon: what each slot **name** denotes. It
is deliberately separate from `ARNE`, which is the *fallback colour* the engine
substitutes and must stay exactly arnecolors for compatibility. Those are two
different jobs, and conflating them had measurable consequences.

Using arnecolors as the lexicon is the obvious move and it is wrong, because
arnecolors is a palette with opinions rather than a dictionary. Five of its
twenty-one colours do not classify as their own name under the tool's own
`family()`:

| slot | arnecolors | actually |
|---|---|---|
| `darkgreen` | `#2f484e` | a slate — hue 192, chroma 10 |
| `darkblue` | `#1B2632` | near-black, chroma 9 |
| `purple` | `#342a97` | blue-violet, hue 246 |
| `pink` | `#de65e2` | magenta, hue 298 |
| `lightbrown` | `#eeb62f` | a golden yellow, hue 42 |

Anchoring the rating there meant a candidate whose `darkgreen` was *actually
dark green* scored a 75° hue error and lost most of the `role` axis for being
correct.

The fix is not an idealised set — nothing here is anyone's taste. For each slot
the anchor is the **medoid** of what the fourteen inherited palettes put there:
the one real, shipped colour with the smallest total distance to all the
others. Every anchor is a colour some palette actually ships for that name.
`anchors` prints the table with, per slot, which palette it came from and the
`spread` — how much the corpus disagrees about that name at all (`black` 6.7,
`pink` 42.3).

Measured that way, **arnecolors is the medoid for seven of twenty-one slots**
(two of them black and white, which everyone agrees on) and an outlier by more
than 25 ΔE for five. A good lexicon for most names, and quite wrong for a few.

The table is frozen in source rather than recomputed at import, so it is visible
in a diff, reproducible, and does not silently move every score when a palette
is added to `colors.js`. `anchors` re-derives it and reports drift.

One wrinkle worth knowing: because each slot's medoid is chosen independently,
the anchor set is monotonic but not evenly spaced — the corpus's typical `green`
(L 70) sits close to its typical `lightgreen` (L 77). A ramp being invented
outright therefore takes its *endpoints* from the anchors and spaces the middle
evenly, rather than reproducing the corpus's crowding.

## The rating

Six axes under each mode, each 0–100 and higher-is-better, plus
a weighted composite. Every axis is always printed, so you can disagree with the
weighting and read the components instead.

| axis | what it measures | `fit-colourname` | `fit-palette` |
|---|---|---|---|
| `source` | how much of the mapping is really the source's — `derived` counts half, a stand-in counts full | 20 | 20 |
| `role` | how well each slot still means what PuzzleScript means by it, measured against `ANCHOR` | 15 | *shown, not scored* |
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

## The checks

```sh
uv run tools/palette_test.py
```

Dependency-free and self-contained, like the tools, so there is no framework to
install. About 5,200 assertions over the real palettes, the three example
candidates, and sixty generated ones weighted towards the awkward cases — the
one-colour palette, the all-greys palette, the palette whose colours are all at
the same lightness.

It checks *invariants the code claims*, not particular outputs. The fitter is
meant to be improved, and pinning its exact choices would make every
improvement look like a regression. What must not change is the set of
promises:

- every fit covers all 21 slots with valid colours, in both modes
- **every ramp climbs** — the fitter's "monotonic by construction" claim
- a slot marked `sourced` or `standin` really is a colour from the source
- `standin` never appears under `fit-colourname`
- `spares` really are unused; every non-sourced slot carries a note saying why
- `fit` is deterministic; every axis lands in 0–100
- the frozen `ANCHOR` still matches the corpus, and every anchor is a real
  shipped colour
- `ANCHOR` itself obeys the ramp rule it enforces
- the calibration corpus is exactly 14 palettes, with the fork's three excluded
- **`src/demo/palette-refs.txt` matches `--emit-refs`**, and every curated
  colour appears in `colors.js` — the generated files in git cannot drift
- all five input formats parse the same palette identically
- duplicate palettes collapse; colliding slugs are disambiguated, not merged

Writing it found three real bugs that manual inspection had missed, all of them
invariant violations rather than matters of taste:

1. **`relight` silently changed hue.** It converted Lab to sRGB and let the
   channels clip. Relighting `#7bda1e`, a yellow-green, down to L 25 clipped to
   `#006900` — a pure green 40° away. It now reduces chroma until the colour
   fits the gamut instead, so a dark yellow-green comes out duller rather than
   greener, which is what pigment does anyway.
2. **`sourced` was sometimes a lie.** `enforce_monotonic` would relight a
   colour to keep a ramp climbing while leaving its provenance as `sourced`, so
   the "sourced 17/21" figures were overstated whenever two source colours sat
   within 4 L of each other. Relit slots are now downgraded to `derived` with a
   note. Dungeon-20's honest count is 11/21, not 13/21.
3. **Ramps could still fail to climb.** `enforce_monotonic` pushed each step up
   to clear the one below, which has no headroom at the top: a palette whose
   greys are already near L 100 kept a flat final step. It now makes a second
   pass downwards, pushing the lower steps out of the way instead.

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
- **`role` is measured against the corpus medoid**, so a palette in a genuinely
  different register is still marked down for being itself — less unfairly than
  against arnecolors, but the axis rewards conventionality by construction.
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
- `baseline()` excluded the fork's own palettes, and its header stopped saying
  "the 14 shipped palettes" while printing more than fourteen. Once the fork's
  entries landed in `colors.js`, a plain read of that file returned all of them
  and the "shipped range" quietly widened to include the very palettes being
  measured against it. The corpus is now read from the fork block's own comment
  markers in `colors.js`, so it stays at fourteen however many palettes are
  added. The printed range is unchanged at 26–75 low-contrast pairs and 0–13
  CVD collapses, so every number quoted in `doc/palette-set.md` still holds.

## Credits

Unchanged from `doc/palette-set.md`: palettes are used with credit to their
authors, adapted rather than copied verbatim, and additions are marked
everywhere they appear. The tool enforces the marking — nothing reaches an
export without its provenance attached.
