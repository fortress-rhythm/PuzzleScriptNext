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

So this project provides three ways to get it, in order of how nice they are:

1. **[The map editor](#the-map-editor)** — a browser grid editor that draws your
   actual sprites and treats rectangles as first-class.
2. **[The spreadsheet bridge](#the-spreadsheet-bridge)** — for when you would
   rather work in Excel or Google Sheets.
3. **[The REXPaint bridge](#the-rexpaint-bridge)** — for when you already live in
   REXPaint.

All three splice your edits back into the source file without disturbing
anything else in it.

## Install

```sh
git clone https://github.com/fortress-rhythm/puzzlescript-map-editor
cd puzzlescript-map-editor
npm link          # optional, puts `psmap` on your PATH
```

No `npm install` step — there are no dependencies.

---

## The map editor

```sh
npm start         # then open http://localhost:8080/
```

Drop a `.txt` game onto the page, or click **Open**. Everything runs locally in
the browser; nothing is uploaded.

**Rectangles are the point.** Marquee-select with the `select` tool, `Ctrl+C`,
then `Ctrl+V` — the copied block becomes a translucent ghost that follows your
cursor so you can see exactly which cells it will overwrite, and a click stamps
it down. The level's dimensions never change: anything that would land outside
the grid is dropped, and the status bar tells you how much. Switch levels and
paste again; the clipboard is shared across the whole game.

Tiles are drawn using **your game's real sprites**, read from the `OBJECTS`
section, resolved through your `color_palette`, and stacked in `COLLISIONLAYERS`
order — so `@ = Crate and Target` draws the target underneath the crate, exactly
as the game will. A character with no legend entry is drawn as a loud red cross,
because it means the level will not compile.

| | |
|---|---|
| `M` `B` `R` `L` `G` `I` | select, brush, rect, line, fill, eyedropper |
| `1`–`9`, `0` | pick one of the first ten tiles |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | copy / cut / paste a rectangle |
| `Ctrl+A` | select the whole level |
| `Ctrl+Z` / `Ctrl+Shift+Z` | undo / redo |
| `Delete` | clear the selection to background |
| `[` / `]` | previous / next level |
| `Escape` | cancel a paste or selection |
| right-click | paint background, whatever the tool |

Resize from any edge with the row and column buttons. **Download .txt** writes
the whole game back out with only the level grids changed.

**Sections with no map yet.** A `SECTION` heading with nothing under it is
normal while a game is being built out, and those appear in the level list
dashed, in their proper place in the numbering. Click one and it gets a
background-filled map the size of the level you were last looking at; the grid
is spliced in directly beneath that section's own commands when you save.

**Copy level** puts the current level on the clipboard as plain text, ready to
paste into a `LEVELS` section or straight into the PuzzleScript editor to try
it out. On a page opened straight off disk the browser blocks scripted clipboard
access, so the text appears in a box for you to copy by hand instead.

The editor is plain HTML and JavaScript with no build step, so `web/index.html`
also works opened directly from disk — only the "Try the example" button needs
a server.

---

## The spreadsheet bridge

```sh
psmap export mygame.txt          # -> mygame.levels.xlsx
```

Open it in Excel, LibreOffice or Google Sheets. You get:

- **one worksheet per level**, named from its `LEVEL` or `SECTION` command
- **every cell filled with that object's own colour**, so the map is legible at
  a glance instead of being a wall of letters
- **square cells**, so the level has the proportions it will have in game
- an `_index` sheet listing every level with its size and commands
- a `_legend` sheet showing each character, its colour and what it means

Edit freely — marquee, copy, paste, including between levels, since they are
just other tabs in the same workbook.

```sh
psmap import mygame.txt mygame.levels.xlsx
```

---

## The REXPaint bridge

[REXPaint](https://www.gridsagegames.com/rexpaint/) is the reputable ASCII art
editor in this space — free, fast, and it has had proper rectangular
copy/cut/paste, layers and a multi-image browser for a decade. It is Windows
only, but runs well under Wine.

```sh
psmap export mygame.txt -f xp    # -> mygame.rex/L00.xp, L01.xp, ... + glyphmap.json
psmap import mygame.txt mygame.rex
```

One `.xp` per level, so REXPaint's image browser doubles as a level browser.

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
psmap info mygame.txt                          # legend, colours, level sizes
psmap export mygame.txt -f csv                 # CSV or TSV instead of xlsx
psmap import mygame.txt edited.csv --dry-run   # report changes, write nothing
psmap import mygame.txt edited.xlsx --stdout   # print instead of overwriting
```

---

## How the round trip stays safe

The parser records the exact source line range of every level grid, and saving
splices replacement rows into those ranges. It never regenerates the file. That
is why a two-tile edit produces a two-line diff.

Specifically:

- **Level commands are read-only.** `MESSAGE`, `SECTION`, `LEVEL`, `GOTO`,
  `LINK`, `TITLE` and `INPUT` are shown for reference but never written back.
  Edit those in the text file.
- **Levels may be resized** without disturbing their neighbours.
- **Line endings are preserved**, CRLF included.
- **Ragged levels stay ragged.** A spreadsheet and a REXPaint canvas are both
  always rectangular, so import would otherwise pad short rows. Rows that are
  exactly their original selves plus padding are restored; rows you actually
  edited keep your changes.
- **Excel cannot corrupt your tiles.** `=`, `+`, `-` and `@` are all legal
  PuzzleScript legend characters and all of them start a formula in Excel. Every
  cell is written as an XLSX *inline string*, which is never parsed as a formula.
- **Empty cells and unknown glyphs are reported**, not silently swallowed.
- **Case-insensitivity is respected.** A game that declares `Wall W` but writes
  `w` in its levels is coloured and round-tripped correctly, unless the prelude
  sets `case_sensitive`.

Verified against all 94 demo games shipped with PuzzleScript Next, through the
spreadsheet, CSV and REXPaint paths: export then import with no edits returns
each file byte for byte.

## Tests

```sh
npm test
```

Covers the parser, all three bridges, the XLSX and `.xp` containers, and the
round-trip guarantee. The corpus comes in three layers:

- **`fixtures/games/`** — eight real games vendored into the repo, so the sweep
  runs anywhere, including CI with nothing else checked out. They were chosen to
  cover ragged levels, CRLF and LF endings, non-ASCII glyphs, comments inside
  `LEVELS`, a 36-glyph palette and a 1x1 degenerate level. See
  [`fixtures/games/NOTICE.md`](fixtures/games/NOTICE.md) for provenance and
  licensing.
- **`fixtures/*.txt`** — synthetic files for cases no real game happens to
  contain: a legend built entirely from characters Excel treats as formulas
  (`=` `+` `-` `@` `,` `"` `\`), and a `case_sensitive` game where `P` and `p`
  are different tiles.
- **`../src/demo`** — when checked out beside PuzzleScriptNext, the full 94-game
  sweep runs too. It self-skips otherwise.

The browser editor was verified by driving it headlessly against the same games.

## Layout

```
src/psgame.js    parses OBJECTS, LEGEND, COLLISIONLAYERS and LEVELS,
                 keeping source line ranges so edits can be spliced back
src/palettes.js  colour palettes, copied from PuzzleScript Next
src/xlsx.js      dependency-free XLSX reader/writer (inline strings, fills)
src/csv.js       RFC 4180 CSV/TSV
src/sheet.js     the spreadsheet bridge
src/rexpaint.js  REXPaint .xp reader/writer
src/cp437.js     the code page REXPaint draws with
src/rexbridge.js the REXPaint bridge, including the glyph mapping
src/cli.js       the psmap command
src/serve.js     tiny static server for `npm start`
web/             the browser editor (no build step)
fixtures/        synthetic edge cases, plus vendored real games under games/
```

## Licence

MIT. Colour palettes are taken from PuzzleScript Next, also MIT. REXPaint is a
separate program by Grid Sage Games; this project only reads and writes its file
format.
