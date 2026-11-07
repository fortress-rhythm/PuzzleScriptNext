# The map editor's standalone repository (archived)

`puzzlescript-map-editor/` inside this repository **is the map editor**, and
the only copy anyone edits.

There used to be a second copy: the private repository
`fortress-rhythm/puzzlescript-map-editor`, kept identical by hand so the editor
could be cloned on its own. It was archived in November 2026. Nobody used it,
since it was private, and everything else depends on the copy here: `npm
start`, the run scripts, CI, the published site, the engine editor's
**MAP EDITOR** button, and charmroach's CI.

## What changed when it was archived

- The map editor's tests read their real games from `../src/demo` instead of
  eight copies under `fixtures/games/`. That folder only existed so a
  standalone checkout could run the round-trip sweep, and it duplicated
  third-party games byte for byte. The tests now fail, rather than skip, if
  `src/demo` or `src/js/colors.js` is missing.
- `tools/palette_analysis.py --write` writes only the copy here. It no longer
  touches a sibling checkout, which could abort a run halfway when that
  checkout was stale.
- Both LICENSE files name fortress-rhythm, so the two copies no longer differ
  anywhere, and `ALLOWED_DIFFERENCES` in `tools/sync_map_editor.py` is empty.

## What was kept

`tools/sync_map_editor.py` is still here, and still called from
`tools/palette_test.py`. With no `../puzzlescript-map-editor` checkout it
reports nothing to compare and skips, so it is idle until the standalone is
brought back.

## If you unarchive it

1. Unarchive it on GitHub: **Settings → General → Danger Zone → Unarchive**.
2. Clone it beside this repository, as `../puzzlescript-map-editor`.
3. Copy this repository's version over it, then commit and push there:

   ```sh
   uv run tools/sync_map_editor.py --check   # what differs (exit 1 if anything)
   uv run tools/sync_map_editor.py           # this repo -> standalone
   ```

The standalone still has `fixtures/games/` and its old tests, which read
from it. A sync copies this repository's tests across, and they read
`../src/demo`, which a standalone checkout does not have, so they will fail
there. If the standalone is to be used on its own again, it needs a corpus of
its own first. Its unmerged branch `claude/focused-allen-e199k3` has one: it
downloads the games, pinned to one commit and checked by SHA-256.
