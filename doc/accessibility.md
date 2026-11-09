# Spoken play for blind and low-vision players

This fork can speak a game to the player's own screen reader (NVDA, JAWS,
VoiceOver, TalkBack). After each turn it says what changed; on request it
describes the player's surroundings, lists everything on the level, and lets
the player inspect any square. It is off unless asked for, and a game that
doesn't use it looks, plays and exports exactly as before.

The code is `src/js/a11y.js`. It ports the ideas of
[Accessible PuzzleScript](https://github.com/philschatz/puzzlescript) (a
separate, dormant engine) into this one, so PuzzleScript Next features keep
working.

## Turning it on

Any one of these:

- **The game:** put `screen_reader` in the prelude.
- **The page:** add `?sr=1` to the address. `?sr=show` also prints each
  announcement under the game, for testing without a screen reader.
- **The player:** press **V**. The choice is remembered by the browser, so a
  player who turns it on once gets it in every game from the same site.

We call it voice mode. While it is on, a line across the top of the game says
**Press V to toggle voice mode**. It goes in the margin above the board, or on
a thin dark band when there's no margin. It's drawn on the canvas, so screen
readers never read it out; it's there so a sighted person who switched voice
mode on by accident can see how to switch it off. After V turns voice mode
off, the line says so for three seconds, then goes away.

When it is on, the game area gets `role="application"` and a spoken label, so
screen readers pass letter keys to the game instead of using them to browse
the page. **Tab always leaves the game.** Neither the engine nor this layer
takes it, so a keyboard or screen-reader user can never get stuck inside the
game (WCAG 2.1.2). While voice mode is on, keys follow real focus: Tab away and
the game stops taking keys, Tab or click back and it takes them again.

## What the player hears

- **After each turn**, once any `again` chain has finished: what moved,
  appeared, disappeared or turned into something else, said relative to the
  player ("Wooden crate moved right, 1 right"), with repeats grouped ("4 fires
  appeared"). A move that went nowhere says what was in the way. After a move,
  what lies ahead in that direction. At most six phrases; the rest is on **G**.
- **When a level starts or restarts, and after undo:** the level number and
  size, then the surroundings.
- **Title, menu and message screens** are read; moving a menu selection reads
  only the newly selected line.
- **Solving a level** adds "Solved!".

| Key | Does |
| --- | --- |
| V | Voice mode on or off |
| H | Surroundings: the nearest thing in each direction, what is behind it, and what you stand on |
| G | Repeat the last announcement in full |
| N | Every kind of thing on the level, how many, and where the nearest is; landmarks first |
| I J K L | Move the inspector up, left, down, right, and read that square |
| O | Read the inspected square, then put the inspector back on you |
| B | Bookmark the inspected square (or yours) |
| F | Step through bookmarks |
| Tab | Leaves the game, as it does everywhere else on the page |

H, G, N, I, J, K, L, O, B and F only do anything while voice mode is on.
Bookmarks used to be on Tab, which trapped focus inside the game.

## Making a game read well

Names come from the object names, with underscores read as spaces. Tag
variants such as `crate:up` are read as "crate, facing up", and a variant that
changes while it moves still counts as the same thing moving.

Three things are silent unless you say otherwise: objects on the background
layer, objects whose sprite is entirely `.` or `transparent`, and anything you
mark `@quiet`.

Metadata goes in a comment on the object's name line. Comments are ignored by
every other PuzzleScript engine, so the same file still runs anywhere.

```
Crate (@say wooden crate)
Relay (@quiet)
Glint (@speak)
Exit (@landmark)
```

Games written with `//` comments (a PuzzleScript Next option) use the same
tags after `//`. Each tag runs to the next `@` or the end of the line:

```
// Spoken play tags, // comment style
Crate // @say wooden crate @landmark
Relay //@quiet
```

One catch, which comes from the engine and not from voice mode: Next picks
the comment style from the first comment in the file. If that first comment
trails an object name, Next reads the `//` as part of the name and the game
won't compile. Put any `//` comment on a line of its own before it, at the
top of the file for example. In a `//` game, `(@say …)` is not a comment at
all, so use the `//` form there.

| Tag | Effect |
| --- | --- |
| `(@say words)` | Say these words instead of the object's name |
| `(@quiet)` | Never mention this object (counters, relays, markers, helper flags) |
| `(@speak)` | Mention it even though it is invisible or on the background layer |
| `(@landmark)` | List it first under N, as a fixed reference point |

Helper objects are the main thing to check. A game built from relays,
counters and direction markers will otherwise narrate its own machinery.

Design advice from blind players, in short:

- Keep levels small (around 10×10) and give each a couple of landmarks.
- Don't make a maze, or a pattern you have to see at a glance, the point of a
  level. If a level depends on sight, keep it but offer a skip or an
  alternative with the same logic.
- If colour matters, put it in the name: `Key_red (@say red key)`.

`src/demo/a11y-demo.txt` shows all of this in a two-level game.

## Testing

A feature here counts as working once a person has used it for real, not
when its tests pass. The tests catch breakage. They can't tell you whether
a blind player can actually solve a level.

**Automated** (`npm run test:a11y`, run in CI):

- `tools/a11y.test.js`: unit tests for the diff and description logic.
- `tools/a11y.engine.test.js`: the connections to the engine. It loads the
  same scripts as `src/play.html` into Node with a small fake page, plays
  `src/demo/a11y-demo.txt` with real key events and frames, and checks what
  the live region says and what is drawn on the canvas. It covers the compile
  hook, level load and restart events, the turn hooks, an `again` chain
  giving one announcement, undo, the layer's keys, Tab not being taken (with
  voice mode on and off), V and its remembered setting, and the
  voice-mode hint. Removing any one hook from the engine makes at least one of
  these fail.

**By a person** (not done yet; record the result in
[`feature-status.md`](feature-status.md)):

1. Serve the checkout (`npm start`) and open `src/demo/a11y-demo.txt` with
   `?sr=show`. Play both levels, reading the printed text. Press Tab: focus
   should leave the game.
2. Do the same with NVDA (Windows, free) running and the monitor off.
3. Best: one blind or low-vision player tries a real game, unprompted.

## How it works

At the start of a player turn (`checkKey` and `mouseInput` in
`inputoutput.js`) the layer copies `curLevel.objects`. When the turn and any
`again` chain have settled (checked after the key and on every `update` tick),
it compares the copy with the level now, object by object:

- an object that left one square and arrived in the next one moved;
- a line of identical objects pushed together moved one square each;
- an object that left one place and arrived somewhere not adjacent jumped;
- a disappearance and an appearance in the same square is one thing becoming
  another;
- anything left over appeared or disappeared.

It compares level snapshots rather than reading the engine's sound-effect
lists, because those lists are cleared during the `again` dry run and the rigid
body retry loop, so they miss things.

Hooks into the engine are small and guarded by `typeof A11y !== 'undefined'`:
`compiler.js` (metadata after compile), `inputoutput.js` (turn start and end,
undo, keys), and the `psplusLevelLoaded` / `psplusLevelRestarted` events.

## Order of work

The rule for this feature, as for the rest of the fork: **nothing new goes on
top of something nobody has tested.** Step 1 comes first because what testers
find should reorder everything after it.

1. **Test it by hand**, as in *Testing* above. Not done yet.
2. **Review fixes.** Done:
   - Tab no longer trapped (it was in both the layer and the engine).
   - Unit and engine tests run in CI.
   - The visible voice-mode hint.
   - This doc, the AI context pack and the README mention it.

   Still open: V is remembered site-wide, so a sighted author who presses it
   in the editor gets voice mode in every game until they press it again. The
   hint makes that easy to spot and undo. Decide after step 1 whether the
   editor should ignore the remembered setting.
3. **Engine-connection tests.** Done: `tools/a11y.engine.test.js`.
4. **Merge** to master.
5. **Win conditions with progress** ("All crates on targets: 2 of 3"). A blind
   player can't see the goal, so this is the most useful thing still missing.
6. **A `psmap check` warning** for objects that will be narrated but look
   like helper machinery: no legend character, never placed in a level, and
   not `@quiet`. *Making a game read well* calls this the main thing to
   check, and today only the author's memory checks it.
7. **Jump the inspector to the next object of one kind.**
8. **On-screen buttons for phone screen readers**, which have no H, G or N
   keys. This needs new UI and testing on real phones.
9. **Verbosity levels and absolute coordinates.** Wait until testers ask.

**Alongside, as a separate track: low vision and colour blindness.** The
screen reader doesn't help these players. Palette contrast
(`tools/palette_chart.py` already measures it) and zoom (`min_cell_size`) do.
Test those two first, then decide whether a high-contrast palette or a
forced-zoom option is worth building.
