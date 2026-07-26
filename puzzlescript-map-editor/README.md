# puzzlescript-map-editor

Map editing tools for [PuzzleScript](https://www.puzzlescript.net/) and
[PuzzleScript Next](https://github.com/david-pfx/PuzzleScriptNext), built around
the one operation every text editor gets wrong: **copying a rectangle and
pasting it as a rectangle.**

Zero dependencies. Node 16+.

---

## Why

PuzzleScript levels are grids of characters living inside a text file, which
means every general-purpose tool you might reach for is subtly wrong for the job:

| Tool | Rect copy | Rect paste | Shows you the map |
|---|---|---|---|
| Text editor (CodeMirror, VS Code, Vim) | yes | **no** — it inserts and shoves the rest of the row sideways | no |
| Spreadsheet | yes | yes | no — every tile is an opaque letter |
| [REXPaint](https://www.gridsagegames.com/rexpaint/) | yes | yes | not in *your* colours |
| PuzzleScript's built-in editor | no | no | yes |

Block *copy* is easy. Block *paste* — overwriting a rectangle in place rather
than inserting text — is a grid operation, and text editors do not have it.
Spreadsheets and REXPaint both do, so this project meets them halfway: it
explodes your levels into either one, **coloured with your own game's palette**,
and splices your edits back into the source file without touching anything else.

## Install

```sh
git clone https://github.com/fortress-rhythm/puzzlescript-map-editor
cd puzzlescript-map-editor
npm link          # optional, puts `psmap` on your PATH
```

No `npm install` step — there are no dependencies.

## Use

```sh
psmap export mygame.txt          # -> mygame.levels.xlsx
```

Open it in Excel, LibreOffice or Google Sheets. You get:

- **one worksheet per level**, named from its `LEVEL` or `SECTION` command
- **every cell filled with that object's own colour**, read from your `OBJECTS`
  section and resolved through your `color_palette` — so the map is legible at a
  glance instead of being a wall of letters
- **square cells**, so the level has the proportions it will have in game
- an `_index` sheet listing every level with its size and commands
- a `_legend` sheet showing each character, its colour and what it means

Edit freely. Marquee-select a rectangle, copy, paste it anywhere — including
into a different level, since they are just other tabs in the same workbook.

```sh
psmap import mygame.txt mygame.levels.xlsx
```

Your levels are updated in place. **Nothing else in the file is touched** — not a
comment, not a blank line, not a level command, not your line endings.

## Use with REXPaint

[REXPaint](https://www.gridsagegames.com/rexpaint/) is the reputable ASCII art
editor in this space — free, fast, and it has had proper rectangular
copy/cut/paste, layers and a multi-image browser for a decade. It is Windows
only, but runs well under Wine.

```sh
psmap export mygame.txt -f xp        # -> mygame.rex/L00.xp, L01.xp, ... + glyphmap.json
```

Point REXPaint at that folder. Its image browser becomes a level browser, so
copying a rectangle out of one level and stamping it into another is two
keystrokes. Every tile is drawn in its object's colour, as with the spreadsheet.

```sh
psmap import mygame.txt mygame.rex
```

REXPaint draws code page 437, and PuzzleScript legends are not limited to it —
the demo games alone use `§`, `è` and Japanese kana. So export assigns every
character a CP437 code (its natural one wherever it has one) and writes the
assignment to `glyphmap.json` beside the `.xp` files. Keep that file: import
uses it to map codes back exactly, whatever your legend contains. Characters
that needed a substitute are listed on export so you know what you are looking
at on screen.

Resize a level by resizing the REXPaint canvas. Multiple layers are flattened
top-down on import, with undrawn cells falling through.

### Other commands

```sh
psmap info mygame.txt                       # legend, colours, level sizes
psmap export mygame.txt -f csv              # CSV or TSV instead of xlsx
psmap import mygame.txt edited.csv --dry-run   # report changes, write nothing
psmap import mygame.txt edited.xlsx --stdout   # print instead of overwriting
```

## How the round trip stays safe

The parser records the exact source line range of every level grid, and import
splices replacement rows into those ranges. It never regenerates the file. That
is why a two-tile edit produces a two-line diff.

Specifically:

- **Level commands are read-only.** `MESSAGE`, `SECTION`, `LEVEL`, `GOTO`,
  `LINK`, `TITLE` and `INPUT` are shown on the `_index` sheet for reference but
  are never written back. Edit those in the text file.
- **Levels may be resized.** Add or delete rows and columns in the spreadsheet
  and the level grows or shrinks; neighbouring levels are unaffected.
- **Line endings are preserved**, CRLF included.
- **Ragged levels stay ragged.** A spreadsheet is always rectangular, so import
  would otherwise pad short rows. Rows that are exactly their original selves
  plus padding are restored; rows you actually edited keep your changes.
- **Excel cannot corrupt your tiles.** `=`, `+`, `-` and `@` are all legal
  PuzzleScript legend characters and all of them start a formula in Excel. Every
  cell is written as an XLSX *inline string*, which is never parsed as a formula.
- **Empty cells and unknown glyphs are reported**, not silently swallowed. An
  empty cell becomes the background character and prints a warning naming the
  exact row and column.

- **Case-insensitivity is respected.** A game that declares `Wall W` but writes
  `w` in its levels is coloured and round-tripped correctly, unless the prelude
  sets `case_sensitive`.

Verified against all 94 demo games shipped with PuzzleScript Next, through both
the spreadsheet and the REXPaint path: export then import with no edits returns
each file byte for byte.

## Tests

```sh
npm test
```

## Layout

```
src/psgame.js    parses OBJECTS, LEGEND and LEVELS, keeping source line ranges
src/palettes.js  colour palettes, copied from PuzzleScript Next
src/xlsx.js      dependency-free XLSX reader/writer (inline strings, fills)
src/csv.js       RFC 4180 CSV/TSV
src/sheet.js     the spreadsheet bridge
src/rexpaint.js  REXPaint .xp reader/writer
src/cp437.js     the code page REXPaint draws with
src/rexbridge.js the REXPaint bridge, including the glyph mapping
src/cli.js       the psmap command
```

## Licence

MIT. Colour palettes are taken from PuzzleScript Next, also MIT. REXPaint is a
separate program by Grid Sage Games; this project only reads and writes its file
format.
