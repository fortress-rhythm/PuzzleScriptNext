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
| Screen-reader layer (`a11y.js`) | `a11y-screen-reader` | `test:a11y`: 16 unit tests of the diff and text logic; **not in CI** | — | branch |

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
- **Screen reader:** see the accessibility order of work below, step 1.

## Accessibility: order of work

What's on the `a11y-screen-reader` branch today:

- One commit, based on current master.
- Its 16 unit tests, the map editor suite and the export check all pass.
- The demo game opens in `psmap`.

Its "Not done yet" list in `doc/accessibility.md` holds four items. Here they
are in order, together with things noticed while reviewing it:

1. **Test what's there before adding anything.** Open `src/demo/a11y-demo.txt`
   with `?sr=show` and play both levels, reading the printed text. Then do the
   same with NVDA running and the monitor off. Best of all, ask one blind or
   low-vision player to try it. Those results should reorder everything after
   this step.
2. **Small fixes found in review:**
   - Add `npm run test:a11y` to `.github/workflows/check.yml`. It isn't
     there yet, so nothing stops the unit tests from breaking.
   - **Tab is a keyboard trap while speech is on.** `handleKey` takes Tab for
     bookmarks and always returns true, so focus can never leave the game.
     That is a WCAG 2.1.2 problem, and it hits exactly the players this
     feature is for. Move bookmark cycling to another key, or let Tab leave
     when there are no bookmarks, and say how to leave in the spoken label.
   - V switches speech on site-wide and remembers it in `localStorage`. A
     sighted author who presses V by accident in the editor gets speech in
     every game until they press V again. Decide whether the editor should
     respect that setting or ignore it.
   - Mention `screen_reader` and the `@say`, `@quiet`, `@speak`,
     `@landmark` tags in `doc/ai-context-pack.md`, so AI help writes games
     that read well. Add a line to the top-level README's feature list too.
3. **An end-to-end automated check.** The unit tests cover the text logic but
   not the hooks into the engine (turn start/end, `again` chains, undo,
   restart). `drills/check.js` already runs the real engine in Node. Load
   `a11y.js` the same way, play the demo's moves, and assert on what is said.
   That catches a hook breaking when the engine changes.
4. **Merge.**
5. **Win conditions with progress** ("All crates on targets: 2 of 3"). A blind
   player can't see what the goal is, so this is the most useful item on the
   list.
6. **Author tooling:** a `psmap check` warning for objects that will be
   narrated but look like helper machinery (no legend character, never placed
   in a level, not `@quiet`). The doc already calls this "the main thing to
   check", and right now only the author's memory checks it.
7. **Jump the inspector to the next object of one kind.**
8. **On-screen buttons for phone screen readers.** This needs new UI and
   testing on real phones, so it's a bigger job.
9. **Verbosity levels, absolute coordinates.** Wait for step 1's players to
   ask for them.

Alongside, as a separate track: low-vision and colour-blind players aren't
served by the screen reader, but they are by palette contrast
(`palette_chart.py` already measures it) and by zoom (`min_cell_size`). Test
those two first (see the table above), then decide whether a "high contrast"
palette or a forced-zoom option is worth building.
