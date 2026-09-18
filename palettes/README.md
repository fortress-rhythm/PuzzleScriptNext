# The curated palettes

One JSON file per palette. This folder is the **source**: `src/js/colors.js`,
`src/demo/palette-refs.txt` and `puzzlescript-map-editor/src/palettes.js` are
all generated from it and will overwrite anything you hand-edit there.

```sh
uv run tools/palette_analysis.py --write     # regenerate all three
uv run tools/palette_analysis.py --check     # what would change? change nothing
uv run tools/palette_analysis.py --block bentenpond   # one prelude block
```

The format, the validation, and why the folder exists:
[`../doc/palette-folder.md`](../doc/palette-folder.md).
What the palettes are and how to use one:
[`../doc/palette-set.md`](../doc/palette-set.md).
Choosing the next one: [`../doc/palette-curation.md`](../doc/palette-curation.md).

| index | file | source |
|---|---|---|
| 15 | `bentenpond.json` | Benten Pond — Terry Ross |
| 16 | `dungeon20.json` | Dungeon-20 — Meaghan (goldentreesart) |
| 17 | `oekakinl.json` | Oekaki.nl — P-Tux7 |
| 18 | `soggysepia.json` | Soggy Sepia CRT-20 — Digi (@Digitress) |
| 19 | `rustfairy.json` | Rust Gold 8 + FairyRust_8x — Trigo Mathmancer, KRYPTOCCULTIST |
| 20 | `ruststorm.json` | Rust Gold 8 + Storms and Cyan — Trigo Mathmancer, Digi (@Digitress) |
| 21 | `rustfairyochre.json` | Rust Gold 8 + FairyRust_8x + Ochre Ruin — Trigo Mathmancer, KRYPTOCCULTIST, Quemis |
| 22 | `endofallglory.json` | End of All Glory — SurrealEmber |
| 23 | `gloryrust.json` | End of All Glory + FairyRust_8x — SurrealEmber, KRYPTOCCULTIST |
| 24 | `berrysepia.json` | Berry Nebula + Soggy Sepia CRT-20 — Lostinindigo, Digi (@Digitress) |

Every palette is adapted rather than copied verbatim — slots the source cannot
supply are marked `added` and named in the credit line everywhere the palette
appears. The `url` in each file is the source it came from.

The fourteen palettes PuzzleScript inherits are deliberately **not** here.
Changing one of those would repaint every existing game that uses it.
