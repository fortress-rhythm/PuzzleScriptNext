# The fork's own documentation

Everything in this folder is fork-original — it describes work that is not in
upstream PuzzleScript. Upstream's own documentation is in
`src/Documentation/`, and the root `README.md` is the fork's changelog.

## Read these in this order

**1. [`palette-set.md`](palette-set.md) — what the palettes are.**
The ten curated palettes, the two ways to write `color_palette` in a game, the
**PALETTES** panel, and how to add another. Start here even if you only want to
*use* a palette: the first two sections are the whole user-facing story and you
can stop after them.

**2. [`palette-folder.md`](palette-folder.md) — where the palettes live.**
The `palettes/` folder, the file format, and what is generated from it. Read it
before editing a palette, because everything else — `src/js/colors.js`,
`src/demo/palette-refs.txt`, the map editor's copy — is generated and will
overwrite you.

**3. [`palette-curation.md`](palette-curation.md) — choosing the next one.**
The stage before the other two: rating candidate palettes you have not adopted
yet, what the six axes mean, and what the fitter gets wrong. Long, and only
worth reading when you have a pile of downloads to sort through.

**4. [`map-editor-sync.md`](map-editor-sync.md) — the vendored map editor.**
Why `puzzlescript-map-editor/` is a plain copy of a standalone repository, and
how to keep the two in step. Only relevant if you touch that folder.

## If you just want to do the thing

| you want to | do this |
|---|---|
| use a palette in a game on this fork | `color_palette bentenpond` in the prelude; the names are listed in `palette-set.md` |
| use one in a game that must run anywhere | `uv run tools/palette_analysis.py --block bentenpond`, or copy a block out of `src/demo/palette-refs.txt` |
| see them all, in colour, without a browser tab of the engine | `uv run tools/palette_curate.py preview --fork -o preview.html` and open the `file://` link it prints |
| change a colour in a shipped palette | edit `palettes/<name>.json`, then `uv run tools/palette_analysis.py --write` |
| add a palette you found on Lospec | `palette-curation.md`, *Adding a palette, with the tool* |
| check nothing has drifted | `uv run tools/palette_test.py` |

## What is generated, and from what

```
palettes/*.json                      the source: one file per curated palette
  |
  +-- tools/palette_analysis.py --write
        |
        +-- src/js/colors.js                    the engine's palette table
        +-- src/demo/palette-refs.txt           portable prelude blocks
        +-- puzzlescript-map-editor/src/palettes.js   the map editor's copy
```

`--write` only ever replaces the text between the `palette-set extension`
comment markers already in those files, so an upstream merge still sees a clean
diff. `--check` says what it would change and changes nothing; the test suite
runs it, so a hand-edit to a generated file fails the checks rather than
shipping.
