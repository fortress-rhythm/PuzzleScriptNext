# Working on the map editor without breaking the copy

`puzzlescript-map-editor/` inside this repository **is the map editor**. The
standalone repository of the same name is a plain copy of it - not a
submodule, not a subtree - just thirty-odd tracked files that happen to be
identical. If you edit one and not the other, they drift, and until the sync
check existed nothing noticed.

---

## Why there are two at all

The map editor's test suite reaches *up* out of itself:

```js
path.join(__dirname, '..', '..', 'src', 'demo')            // the 94-game corpus
path.join(__dirname, '..', '..', 'src', 'js', 'colors.js') // the palette table
path.join(__dirname, '..', '..', '..', 'charmroach', ...)  // a real Next-dialect game
```

From `PuzzleScriptNext/puzzlescript-map-editor/test/` those resolve to this
repository's `src/demo` and `src/js/colors.js`, and to a `charmroach` checkout
beside this repository. From a checkout sitting anywhere else they resolve to
nothing, and those checks skip.

So the nesting is load-bearing: it is what lets the map editor sweep every
demo game for round-trip safety, verify its vendored palettes against
`colors.js` slot by slot, and prove it can open a real game written in the
Next dialect. That is why **this copy is the one that is developed**.

The standalone repository exists for the other direction: so the editor can be
cloned, `npm link`ed and published on its own, with its own README and LICENSE
line, by people who do not want the whole engine. It is a *subset* of this
repository - the same files, none of the engine - and it is meant to follow,
never lead.

The alternatives were considered and are worse here. A **submodule** would
put the standalone in charge and could not carry a different LICENSE line. A
**subtree** merges two histories into one for no benefit. A copy is the
honest arrangement - it just needs a way to stay honest.

## The rule

> **This repository's copy is canonical. Edit here, sync, commit both.**

```sh
# 1. edit here
$EDITOR puzzlescript-map-editor/src/psgame.js
npm test                                   # the map editor's suite, from the root

# 2. copy out to the standalone repository (a sibling folder by default)
uv run tools/sync_map_editor.py

# 3. commit in both - they are separate repositories with separate PRs
git add -A && git commit
cd ../puzzlescript-map-editor && git add -A && git commit
```

If you only have the standalone checked out and edited it there, reverse it
when you next have both:

```sh
uv run tools/sync_map_editor.py --reverse    # standalone -> this repo
```

and then run the suite here, because the standalone cannot run the parts of
it that matter most.

## What catches you

```sh
uv run tools/sync_map_editor.py --check     # exit 1 on drift, changes nothing
```

This also runs as part of `uv run tools/palette_test.py`, so the ordinary test
run fails if the two copies have gone out of step:

```
  vendored map editor
      DIFFERS  web/render.js

      1 file(s) out of step. Run one of:
        uv run tools/sync_map_editor.py            this repo -> standalone (the usual way)
        uv run tools/sync_map_editor.py --reverse  standalone -> this repo
```

It skips silently when the standalone repository is not checked out beside
this one, the same way the demo-game sweep does - plenty of clones will only
ever have one of the two, and CI is one of them.

**This is a different check from the palette drift one.** That compares
`src/palettes.js` against `colors.js` and catches the palette *data* going out
of step. This compares the two copies file by file.

## The one file that is meant to differ

`LICENSE` - the copyright holder line reads differently in the two
repositories. It is listed in `ALLOWED_DIFFERENCES` in the script with that
reason attached, and reported as `ok` rather than silently skipped.

Keep that list short and argued. Every entry is a place where the two copies
say different things on purpose, and an entry added carelessly is drift with
permission.

## Adding a palette

`doc/palette-set.md` step 6 covers this, and it is the common case of the rule
above: a new palette has to reach `puzzlescript-map-editor/src/palettes.js` and
its alias table, or the map editor renders the game in arnecolors and reports
the name unknown. `tools/palette_analysis.py --write` regenerates that file
here; then sync, then commit both.

## Two repositories, two pull requests

Because the copy is tracked here, a map editor change appears in **both** PRs -
inside this repository's, and on its own in the standalone's. That is expected.
What matters is that the two are identical when both land; merge order does not
break anything, since the cross-repository checks skip when the other side is
absent.
