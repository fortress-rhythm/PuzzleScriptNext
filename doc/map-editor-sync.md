# Working on the map editor without breaking the copy

`puzzlescript-map-editor/` inside this repository is a **plain copy** of the
standalone repository of the same name. Not a submodule, not a subtree — just
thirty-odd tracked files that happen to be identical. If you edit one copy and
not the other, they drift, and until now nothing noticed.

---

## Why it is a copy at all

The map editor's test suite reaches *up* out of itself:

```js
path.join(__dirname, '..', '..', 'src', 'demo')     // the 94-game corpus
path.join(__dirname, '..', '..', 'src', 'js', 'colors.js')   // the palette table
```

From `PuzzleScriptNext/puzzlescript-map-editor/test/` those resolve to this
repository's `src/demo` and `src/js/colors.js`. From a checkout sitting *beside*
this repository they resolve to nothing, and the checks skip.

So the nesting is load-bearing: it is what lets the map editor sweep every demo
game for round-trip safety and verify its vendored palettes against `colors.js`
slot by slot. Move it out and those two checks go quiet.

The alternatives were considered and are worse here. A **submodule** gives the
same layout but pins one commit and cannot let the copy carry its own LICENSE
line. A **subtree** merges two histories into one for no benefit, since nothing
is being upstreamed to a third party. A copy is the honest arrangement — it just
needs a way to stay honest.

## The rule

> **The standalone repository is canonical. Edit there, sync, commit both.**

```sh
# 1. edit in the standalone repo
cd ../puzzlescript-map-editor
$EDITOR src/psgame.js
npm test

# 2. copy into this repository
cd ../PuzzleScriptNext
uv run tools/sync_map_editor.py

# 3. commit in both — they are separate repositories with separate PRs
cd ../puzzlescript-map-editor && git add -A && git commit
cd ../PuzzleScriptNext      && git add -A && git commit
```

If you only have this repository checked out and edited the vendored copy,
reverse it instead:

```sh
uv run tools/sync_map_editor.py --reverse
```

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
        uv run tools/sync_map_editor.py            standalone -> vendored
        uv run tools/sync_map_editor.py --reverse  vendored -> standalone
```

It skips silently when the standalone repository is not checked out, the same
way the demo-game sweep does — plenty of clones will only ever have one of the
two.

**This is a different check from the palette drift one.** That compares
`src/palettes.js` against `colors.js` and catches the palette *data* going out
of step. This compares the two copies file by file. Before it existed, editing
`src/psgame.js` in the standalone and forgetting to copy it passed every suite
in both repositories with a clean `git status` in each.

## The one file that is meant to differ

`LICENSE` — the copyright holder line reads differently in the two
repositories. It is listed in `ALLOWED_DIFFERENCES` in the script with that
reason attached, and reported as `ok` rather than silently skipped.

Keep that list short and argued. Every entry is a place where the two copies
say different things on purpose, and an entry added carelessly is drift with
permission.

## Adding a palette

`doc/palette-set.md` step 6 covers this, and it is the common case of the rule
above: a new palette has to reach `puzzlescript-map-editor/src/palettes.js` and
its alias table, or the map editor renders the game in arnecolors and reports
the name unknown. Edit the standalone, sync, commit both.

## Two repositories, two pull requests

Because the copy is tracked here, a map editor change appears in **both** PRs —
standalone in its own, and vendored inside this repository's. That is expected.
What matters is that the two are identical when both land; merge order does not
break anything, since the cross-repository checks skip when the other side is
absent.
