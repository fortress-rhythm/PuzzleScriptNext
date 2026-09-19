# puzzlescript-map-editor

Map editing tools for [PuzzleScript](https://www.puzzlescript.net/) and
[PuzzleScript Next](https://github.com/david-pfx/PuzzleScriptNext), built around
the one operation every text editor gets wrong: **copying a rectangle and
pasting it as a rectangle.**

Zero dependencies. Node 16+ for the command line; the browser editor needs
nothing at all.

This is developed inside
[fortress-rhythm/PuzzleScriptNext](https://github.com/fortress-rhythm/PuzzleScriptNext)
as `puzzlescript-map-editor/`, where its test suite can reach the engine's
demo games and palette table; the standalone repository is a copy of that
folder. Either one works on its own.

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

No `npm install` step — there are no dependencies. Inside a PuzzleScriptNext
checkout the same folder is already there; `npm start` at the engine's root
serves the whole thing, map editor included, and **MAP EDITOR** in the
engine's editor toolbar opens the game you have open.

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
as the game will. `Background` is drawn under every cell, as the engine draws
it, so a sprite's transparent pixels show floor rather than void. An object
that is transparent on purpose — a marker like `Night; transparent` — shows
as a dotted box with its character in it, so you can find it again; a
character with no legend entry at all is drawn as a loud red cross, because
it means the level will not compile.

### The Sprites workspace

The **Sprites** button (or `Tab`) switches to the other grid in a PuzzleScript
file: the sprite matrices in `OBJECTS`. Every object definition is listed with
a thumbnail; pick one and its matrix is the grid, its colour list is the tile
palette (`0`, `1`, `2`... and `.` for transparent), and every tool works the
same — brush, rectangle, line, fill, marquee copy and paste, undo. The maps
redraw with the new art as you paint. An object with no matrix gets a
transparent `sprite_size` square the moment you select it. The size badge
turns red if a sprite is not `sprite_size` square, since the engine will
refuse it. **Download .txt** splices only the changed rows back, the same
way it does for levels.

### The palette sampler

The **Palette** dropdown in the left panel redraws the whole game — tiles,
maps, sprites — under any of the 24 palettes this build carries, without
touching the file. The 21 slot swatches below it show the palette in use,
outlined where this game's objects name the slot; click one to copy its hex.
**Copy prelude line** gives the `color_palette name` line to adopt what you
are looking at, and **Portable block** the same palette spelled out slot by
slot, which runs on any PuzzleScript build.

### Palettes

The whole `color_palette` line is honoured, in all of the forms PuzzleScript
accepts:

```
color_palette mastersystem                     a name
color_palette 3                                a number
color_palette arnecolors black #292f25 ...     a base plus per-game overrides
color_palette bentenpond                       a PuzzleScript Next palette
```

The override form matters most, because it is the one you distribute: it is the
only way to ship a custom palette that runs on every PuzzleScript build. A
viewer that read the base name and dropped the overrides would render exactly
those games in the wrong colours, which is what this one used to do.

The twenty-four palettes in `src/palettes.js` are copied from PuzzleScript Next —
the fourteen stock ones, plus the ten its palette-set extension adds at
indices 15-24. When this repo is checked out inside PuzzleScriptNext the
test suite verifies the copy against `src/js/colors.js` slot by slot, and skips
the check when it is not, the same way the demo-game sweep does.

**Nothing here refuses to open a file.** A palette name this build does not
carry falls back to arnecolors, and an override naming a slot that does not
exist is dropped — but both are reported rather than applied silently, in the
status bar, in `psmap info`, and on the `_legend` sheet of an exported
workbook. Opening a map in the wrong colours and saying so is better than
refusing to open it; doing it without saying so is worse than either.

| | |
|---|---|
| `M` `B` `R` `L` `G` `I` | select, brush, rect, line, fill, eyedropper |
| `1`–`9`, `0` | pick one of the first ten tiles (or colours, in Sprites) |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | copy / cut / paste a rectangle |
| `Ctrl+A` | select the whole grid |
| `Ctrl+Z` / `Ctrl+Shift+Z` | undo / redo |
| `Delete` | clear the selection to background (transparent, in Sprites) |
| `[` / `]` | previous / next level or sprite |
| `Tab` | switch between Maps and Sprites |
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
also works opened directly from disk — only the "Try the example" buttons need
a server. `web/index.html?game=path/to/game.txt` loads a game straight away,
for deep links from a gallery or a served checkout.

### PuzzleScript Next's dialect

Games written for PuzzleScript Next read like this, and the parser knows all
of it - a game using any of it used to open as a wall of red crosses:

```
// line comments; the first comment in a file decides the style, as the engine does
Roach:right e; Black LightBrown Yellow      glyph on the header, colours after ;
MergedRoach N E S W; LightBlue Black White  several glyph aliases on one header
Dark:Faint; #00002A30                       one-line objects, alpha colours
Dark:Dim;   #00002A58                       ...with nothing between them
Ray:directions; transparent                 a tag class: four objects at once
Shadow copy:Wall rot:right                  transforms after the names
--                                          a layer-group divider in COLLISIONLAYERS
Dark:Shade                                  a tag class from the TAGS section
```

A `TAGS` section is read, `Roach:directions` in the legend or the layers
expands to every roach, and a comment between a `section` heading and its map
is a comment. Sprites defined by `copy:` borrow the source matrix; other
transforms (`rot:`, `flip:`) draw the base sprite unturned, which is enough to
tell which object is which.

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
psmap info mygame.txt                          # legend, colours, level sizes, dialect
psmap check mygame.txt other.txt ...           # can the editor open these? exit 1 if not
psmap export mygame.txt -f csv                 # CSV or TSV instead of xlsx
psmap import mygame.txt edited.csv --dry-run   # report changes, write nothing
psmap import mygame.txt edited.xlsx --stdout   # print instead of overwriting
```

`check` is for a game's own CI: it fails if a level uses a glyph nothing
defines, an object cannot be drawn, the palette is not one this build carries
or an override names a slot that does not exist, or the export/import round
trip through any of the three bridges changes a byte. A file with no sections
at all is reported as skipped rather than failed, so a glob over a folder that
also holds a prelude-block library still passes.

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
round-trip guarantee. The corpus comes in four layers:

- **`fixtures/games/`** — eight real games vendored into the repo, so the sweep
  runs anywhere, including CI with nothing else checked out. They were chosen to
  cover ragged levels, CRLF and LF endings, non-ASCII glyphs, comments inside
  `LEVELS`, a 36-glyph palette and a 1x1 degenerate level. See
  [`fixtures/games/NOTICE.md`](fixtures/games/NOTICE.md) for provenance and
  licensing.
- **`fixtures/*.txt`** — synthetic files for cases no real game happens to
  contain: a legend built entirely from characters Excel treats as formulas
  (`=` `+` `-` `@` `,` `"` `\`), a `case_sensitive` game where `P` and `p`
  are different tiles, and `nextsyntax.txt`, a small game in the PuzzleScript
  Next dialect that exercises every spelling listed above and compiles under
  the real engine.
- **`../src/demo`** — inside PuzzleScriptNext, the full 94-game sweep runs
  too. It self-skips otherwise.
- **`../../charmroach/charmroach.txt`** — a real Next-dialect game, when its
  repository is checked out beside the engine. Self-skips otherwise.

The browser editor was verified by driving it headlessly against the same games.

## Layout

```
src/psgame.js    parses OBJECTS, LEGEND, COLLISIONLAYERS and LEVELS,
                 keeping source line ranges so edits can be spliced back
src/palettes.js  colour palettes copied from PuzzleScript Next, and the
                 resolver that turns a color_palette line into real colours
src/xlsx.js      dependency-free XLSX reader/writer (inline strings, fills)
src/csv.js       RFC 4180 CSV/TSV
src/sheet.js     the spreadsheet bridge
src/rexpaint.js  REXPaint .xp reader/writer
src/cp437.js     the code page REXPaint draws with
src/rexbridge.js the REXPaint bridge, including the glyph mapping
src/cli.js       the psmap command, including `check`
src/serve.js     tiny static server for `npm start`; `--root` serves any folder
web/             the browser editor (no build step): maps, sprites, palette sampler
fixtures/        synthetic edge cases, plus vendored real games under games/
```

## Licence

MIT. Colour palettes are taken from PuzzleScript Next, also MIT. REXPaint is a
separate program by Grid Sage Games; this project only reads and writes its file
format.
