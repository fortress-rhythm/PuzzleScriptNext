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

When it is on, the game area gets `role="application"` and a spoken label, so
screen readers pass letter keys to the game instead of using them to browse
the page.

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
| V | Speech on or off |
| H | Surroundings: the nearest thing in each direction, what is behind it, and what you stand on |
| G | Repeat the last announcement in full |
| N | Every kind of thing on the level, how many, and where the nearest is; landmarks first |
| I J K L | Move the inspector up, left, down, right, and read that square |
| O | Read the inspected square, then put the inspector back on you |
| B | Bookmark the inspected square (or yours) |
| Tab | Step through bookmarks |

H, G, N, I, J, K, L, O, B and Tab only do anything while speech is on.

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

- `npm run test:a11y` runs the unit tests for the diff and description logic
  (`tools/a11y.test.js`).
- By hand: serve the checkout (`npm start`), open a game with `?sr=show`, and
  play. With NVDA running, turn the monitor off and play the first few levels.

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

## Not done yet

- Reading out the win conditions with progress ("All crates on targets: 2 of 3").
- Jumping the inspector to the next object of one kind.
- Verbosity levels, and an absolute-coordinates option.
- On-screen buttons for phone screen readers, which have no H, G or N keys.
