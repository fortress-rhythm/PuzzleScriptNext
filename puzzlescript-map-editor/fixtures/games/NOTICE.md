# Vendored test games

These are real PuzzleScript games, bundled here so the round-trip test suite runs
against genuine files rather than only synthetic ones. They are **test data, not
part of the library** — nothing under `src/` imports them.

They come from the demo collection in
[PuzzleScriptNext](https://github.com/david-pfx/PuzzleScriptNext), under
`src/demo/`. That directory's README notes that its contents are *not*
necessarily MIT-licensed, with the exception of the games linked from the
editor's "Load Examples" dropdown, which can be assumed to be. **Every game here
is one of those dropdown examples** — the rest of the collection was deliberately
left alone.

Copyright remains with the original authors. Each file keeps its own `title` and
`author` lines intact.

| File | Title | Author | Why it is here |
|---|---|---|---|
| `sokoban_basic.txt` | Simple Block Pushing Game | David Skinner | The canonical baseline; LF line endings |
| `blank.txt` | *(untitled)* | — | Degenerate case: a single 1×1 level |
| `microban.txt` | Microban | David Skinner | Ten levels in one file; CRLF line endings |
| `whaleworld.txt` | 2D Whale World | increpare | Larger maps; CRLF line endings |
| `bridges.txt` | Bridges | polyomino games | **Ragged levels** — rows of differing length |
| `colour_chart.txt` | Colour Chart | polyomino games | 36 glyphs; exercises palette resolution |
| `magiciban_v1.txt` | Magiciban v1 | Tom Hermans [@Auroriax] | **Comments inside the LEVELS section** |
| `tapaban.txt` | Tapaban | Menderbug | **Non-ASCII glyphs** (`¹²³`), comments, Pattern:Script dialect |

If you are one of these authors and would rather not be included here, say so on
the issue tracker and the file will be removed — the suite degrades gracefully to
the games that remain.

## Updating

These are verbatim copies. To refresh them, copy the same filenames out of a
current PuzzleScriptNext checkout; do not hand-edit them, since the whole point
is that they are untouched real-world input.
