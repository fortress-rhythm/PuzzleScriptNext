# The `palettes/` folder

Fork-original. One JSON file per curated palette, at the top of the repository.
It is the **source**; `src/js/colors.js`, `src/demo/palette-refs.txt` and the
map editor's `src/palettes.js` are all generated from it and are overwritten
without asking.

```sh
uv run tools/palette_analysis.py --write    # regenerate all three, in place
uv run tools/palette_analysis.py --check    # what would change? change nothing
```

---

## Why it exists

The palettes used to be two Python dictionaries inside
`tools/palette_analysis.py`. That worked and was wrong in three ways that only
showed up with use.

**Adding a palette meant editing a tool.** The instruction was "paste this
block into `CURATED`", which is a diff against a 700-line script, in a language
nothing else in this repository is written in, to add a piece of content. A
palette is data. Nobody should have to read an emitter to add one.

**Reading a palette meant reading a tool.** "What colour is `berrysepia`'s
`darkblue`, and why that one?" was answered by finding the right dict literal
among nine others and then reading the Python comments around it.

**The generated files were in three different orders.** `colors.js` listed the
palettes by alias index, `palette-refs.txt` by whatever order the Python dict
happened to be in, and the alias table was maintained by hand. Nothing was
wrong in any of them; they simply could not be diffed against each other. Each
palette now carries its own `index` and everything is emitted in that order.

What did not change is that nothing is automatic. The fitter still drafts and a
human still corrects — see *What the fitter gets wrong* in
`doc/palette-curation.md`. The folder changes where the correction goes, not
whether it happens.

## The format

```json
{
  "name": "bentenpond",
  "index": 15,
  "title": "Benten Pond",
  "author": "Terry Ross",
  "url": "https://lospec.com/palette-list/benten-pond",
  "note": "inspired by \"The Pond at Benten Shrine\", a 1920s woodblock print by Kawase Hasui",
  "commentary": [
    "One warm-neutral olive ramp carries black->white. ...",
    "The source has no saturated warm mid-tones at all ..."
  ],
  "colors": ["#083b42", "#155355", "..."],
  "slots": {
    "black": ["#292f25", "sourced"],
    "orange": ["#c9793f", "added"]
  }
}
```

| key | what it is |
|---|---|
| `name` | the `color_palette` name a game writes. Must match the filename, must be lowercase letters, digits and underscores |
| `index` | the numeric alias in `colorPalettesAliases`. Unique; the inherited palettes hold 1–14 |
| `title`, `author`, `url` | the credit. All three are required — crediting the author is the condition these are used under, and `--write` puts them in every generated file |
| `note` | one line on what the palette is. Appears as a comment in `colors.js` and in the prelude block |
| `commentary` | paragraphs, for a reader. Why the non-sourced slots are what they are. Nothing generated reads it; it is the part that used to be Python comments |
| `slot_notes` | optional, per slot. What `emit-curated` writes into a draft: the fitter's own reason for each slot it did not source |
| `colors` | the source palette's own colours, in the author's order |
| `slots` | all twenty-one, each `[hex, "sourced" or "added"]` |

`sourced` means the colour is in `colors`, exactly. `added` means it is not —
picked by hand, interpolated, or relit — and everything generated says so, by
name, in a comment. There is no third word: a palette either quotes a colour or
it does not, and the interesting detail of *how* it was made goes in
`slot_notes` and `commentary` where a person will read it.

A palette file is also a valid candidate file, because `colors` is the key
Lospec's own JSON endpoint uses. `palette_curate.py score palettes/` rates what
already ships against the same corpus as anything you are thinking of adopting.

## What is checked, and when

`palette_lib.read_palette_file()` refuses to load a file that

- is missing any of the twenty-one slots, or names one that is not a slot
- has a colour that is not `#rrggbb`
- marks a slot with anything other than `sourced` or `added`
- marks a slot `sourced` when that colour is not in `colors`
- has a `name` that disagrees with its filename, or an `index` that is not an integer
- has a top-level key that is not one of the ones above — a misspelled `colours`
  would otherwise leave the source list empty and make every sourced slot fail
  for a reason that is not the reason

Two palettes claiming the same `index` is caught when the folder is loaded.
This is all deliberately at load time rather than in a separate checker: a
malformed file that reaches the emitters is discovered as a broken
`colors.js`, which is a much worse place to find out.

`tools/palette_test.py` then runs `--check` and fails if any generated file has
drifted, so hand-editing `colors.js` is caught by the checks rather than by a
game rendering in the wrong colours.

## Changing a shipped palette

```sh
$EDITOR palettes/berrysepia.json
uv run tools/palette_analysis.py --write
uv run tools/palette_test.py
```

The ramp rule is enforced on every palette in the folder: within
`darkred`/`red`/`lightred` and every other ramp, luminance must increase at
each step. If you darken a `lightgreen` past its `green`, the checks say so.

Changing a colour repaints every existing game that uses that palette. That is
fine for a palette this fork added and never fine for one it inherited — none
of the fourteen inherited palettes is in this folder, and that is deliberate.

## Adding one

The short version, from `doc/palette-curation.md`, which has the long one:

```sh
uv run tools/palette_curate.py score tools/candidates/
uv run tools/palette_curate.py sheet tools/candidates/ -o sheet.html   # and LOOK
uv run tools/palette_curate.py emit-curated tools/candidates/one.hex --write
$EDITOR palettes/one.json          # fill in the TODOs, argue with the mapping
uv run tools/palette_analysis.py --write
uv run tools/palette_test.py
```

`emit-curated --write` picks the next free index and writes the draft. It will
not overwrite an existing file.

Two things still need a hand afterwards, because neither is generated: the
credit in `src/Documentation/prelude.html`, and the one in `paletteCredits` in
`src/js/palettes_ui.js`. The panel itself enumerates whatever
`colorPalettesAliases` holds, so it needs no other change.

## Exporting a prelude block

```sh
uv run tools/palette_analysis.py --block berrysepia
uv run tools/palette_curate.py block berrysepia       # the same thing
```

One palette, spelled out as overrides on arnecolors, with its credit line —
what you paste into a game that has to run on stock PuzzleScript.
`src/demo/palette-refs.txt` is all ten of them in one file, generated from the
same place, and the **PALETTES** panel's *export* button produces the same text
without a terminal.
