# Feature status: built, checked, tested

A feature isn't counted as helpful until someone has used it for real.
Code existing and CI passing are not enough. Each feature is tracked on three
separate lines:

- **Built**: the code is merged (or on the branch named).
- **Checked**: an automated check covers it, and CI runs that check. This
  catches regressions, but only for what the check looks at.
- **Tested**: a person has used it for its real purpose and written down the
  date and what they found. This is the only column that makes a feature
  count.

**Status** follows from those three:

| Status | Means |
|---|---|
| `untested` | Built, but nobody has used it for real. Treat it as a draft. |
| `tested` | Used for real, and it did the job. Note the date. |
| `issues` | Used for real, and something got in the way. Link or list what. |
| `branch` | Not merged yet. |

The rule for new work: **no new feature on top of an `untested` one.** Test
the thing underneath first. That usually takes 10 minutes and often changes
what the next feature should be.

Every row below started as `untested`, because nothing records that it was
tried. If you have already used something for real, change it to `tested`
with today's date and a few words.

## Features

| Feature | Built | Checked (automated) | Tested (by a person) | Status |
|---|---|---|---|---|
| Palette set: 10 palettes at `color_palette` 15–24, PALETTES panel | master | `uv run tools/palette_test.py` (in CI) | — | untested |
| Palette curation tools (rate, compare, adopt) | master | `palette_test.py` (in CI) | — | untested |
| Palette accessibility chart (`palette_chart.py`) | master | none | — | untested |
| Map editor: grid, rectangular copy/paste, Excel and REXPaint bridges | master | `npm test` (in CI) | — | untested |
| Map editor: Sprites workspace, palette sampler, background underlay | master | `npm test`, partly | — | untested |
| Map editor: turn, mirror, wrap; draw copy | master | `npm test` | — | untested |
| Map editor: add, duplicate, delete levels and objects | master | `npm test` | — | untested |
| `psmap check` | master | `npm run check:games` (in CI) | — | untested |
| `custom_font` and its tutorial | master | none in this fork | — | untested |
| `min_cell_size` (auto-zoom camera) | master | none in this fork | — | untested |
| COPY FOR AI and the AI context pack | master | `check:ai-pack` checks the copy is current, not that it helps | — | untested |
| Front page, site menu on every page | master | none | — | untested |
| Setup page (`doc/setup.html`) | master | none | — | untested |
| Export template kept current | master | `check:export` (in CI) | — | untested |
| Rule-writing drills (`drills/`) | `claude/lucid-faraday-5nb6wm` | `check:drills` (in CI) checks the answers pass and the starters fail | — | branch |
| Voice mode / screen-reader layer (`a11y.js`), with the on-screen V hint | `claude/lucid-faraday-5nb6wm` (merged in from `a11y-screen-reader`) | `test:a11y` (in CI): 17 unit tests, plus 19 engine-connection tests that play the demo through the real engine, in both comment styles | — | branch |
| Tab never trapped in the game (engine change, all games) | `claude/lucid-faraday-5nb6wm` | `test:a11y` engine tests (in CI) | — | branch |

## What "tested" means for each

These are short sessions, not a full QA pass. Each one is the smallest real use
that would show whether the feature does its job.

- **Palettes:** take a game you care about, switch through every palette in
  the PALETTES panel, and keep one. Note anything unreadable.
- **Palette accessibility chart:** run it, choose a palette with it, then look
  at that game through a colour-blindness simulator. Does the chart agree?
- **Map editor:** build three levels of a real game in it from scratch, using
  copy/paste and turn/mirror, then play them in the engine.
- **Sprites workspace:** draw two new objects in it and use them in a level.
- **`custom_font`:** put a font into a game with text and export it. Does
  the exported file show the font offline?
- **`min_cell_size`:** play a large level on a phone, or a narrow browser
  window, and check that the camera follows the player.
- **COPY FOR AI:** get stuck on a real rule, use the button, and paste into a
  chat. Did the answer use correct PuzzleScript Next syntax the first time?
- **Setup page:** follow it on a clean machine, or a fresh cloud session,
  without already knowing the steps.
- **Drills:** do drills 01–04 for real. Note where the hint or the checker's
  output didn't help.
- **Voice mode:** the three steps under *Testing* in [`accessibility.md`](accessibility.md).
- **Tab:** in any game, click the game, then press Tab. Focus should move to the next control on the page, and clicking the game should bring keys back.

## Accessibility: order of work

This lives in [`accessibility.md`](accessibility.md#order-of-work) now, next
to the feature it plans. In short: the review fixes and the engine-connection
tests are done. Next is a test by a person, and nothing new until then.
