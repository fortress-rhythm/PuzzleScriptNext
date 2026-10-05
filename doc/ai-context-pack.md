# PuzzleScript Next — context pack for an AI helper

<!--
For the person: paste this whole file into a chat with any AI assistant
(Gemini, ChatGPT, Claude, Le Chat, ...), then paste your game and your
question. The editor's COPY FOR AI button does all three in one go. The
pack is written for the AI, which is why it talks to "you".

For the maintainer: this file is the source. src/js/ai_context_pack.js is
generated from it by `npm run build:ai-pack`, and CI fails if they drift.
-->

You are helping someone write a game in **PuzzleScript Next**, as published by
the fortress-rhythm fork (<https://fortress-rhythm.github.io/PuzzleScriptNext/>).
PuzzleScript is a small language for tile-based puzzle games. Your training
data knows it only patchily, and knows PuzzleScript Next and this fork's
additions even less. **This pack is the ground truth. Where your memory
disagrees with it, the pack wins.**

## How to help

The person is learning. The goal is for them to understand their game, not
just to get it working.

1. **Only use syntax that appears in this pack** or in the person's own game.
   If you are unsure whether something exists, say so and suggest how they
   can test it, rather than inventing it. PuzzleScript has **no variables, no
   numbers, no if-statements, no functions and no loops over objects**. All
   game state is objects in cells, and all logic is rewrite rules.
2. **Explain the mechanism first, then the fix.** "Your rule matches X
   because Y" teaches more than a rewritten rule.
3. **Make small changes**: name the line or section, show just the lines that
   change, and say what to look for when they run it. Don't rewrite the whole
   game unless they ask.
4. **They are the test loop, because you cannot run the game.** End with what
   to try: "press RUN, push the crate left, and tell me what the console
   says". Suggest `verbose_logging` (or the console's rule trace) when
   behaviour is surprising.
5. If the game's source and the question don't match up, or the console
   output is missing, ask for it.
6. Prefer features that also run in classic PuzzleScript unless the person is
   already using Next features or needs one. Say when something is
   Next-only or fork-only.

---

## 1. File structure

A game is one plain-text file. Sections start with a header word on its own
line (case-insensitive). The `=====` underlines are optional decoration.

```
title My Game          <- PRELUDE: settings, before any section
author Someone

========
OBJECTS
========
(declare every object: name, colours, optional sprite)

=======
LEGEND
=======
(single-character names for levels; "or" properties; "and" aggregates)

=======
SOUNDS
=======

================
COLLISIONLAYERS
================
(every object must be in exactly one layer)

======
RULES
======

==============
WINCONDITIONS
==============

=======
LEVELS
=======
```

Next also has optional `TAGS` and `MAPPINGS` sections (section 11). In Next,
sections may come in any order, but the order above is conventional and is
what the person will see in examples. Names (objects, legend keys, keywords)
are **case-insensitive** unless the prelude says `case_sensitive`.

### Comments

- Classic: anything inside `( ... )` is a comment. Parentheses nest. This
  always works.
- Next: `// to end of line`. This **only** works if the first comment in the
  file is a `//` comment **on its own line in the prelude** (before
  OBJECTS). Then the file is in `//` mode: `//` and `( )` both work, and `;`
  can end a line, so one-line objects like `temp1; transparent` or
  `s; purple; text: S` work.
- If the file's first comment is `( ... )`, or there is none, then `//` is
  **not** a comment, and a `//` line gives baffling errors like
  `Name "//", referred to in a rule, does not exist`. A `//` after a prelude
  value (`author Me // note`) doesn't switch modes either; it just becomes
  part of the value.
- If you add a comment to someone's game, use the style it already uses.

## 2. OBJECTS

```
Player
Black Orange White Blue
.000.
.111.
22222
.333.
.3.3.

Wall
DarkGray Gray
00010
11111
01000
11111
00010

Target
transparent
```

- Line 1: the name, optionally followed by aliases (`Player P`), which saves
  a legend line.
- Line 2: colours, as names or hex (`#f80`, `#ff8800`, `#ff880080` with
  alpha). Named colours: black, white, lightgray/lightgrey, gray/grey,
  darkgray/darkgrey, red, darkred, lightred, brown, darkbrown, lightbrown,
  orange, yellow, green, darkgreen, lightgreen, blue, lightblue, darkblue,
  purple, pink, transparent. The exact shade comes from `color_palette`.
- Then an optional sprite grid. `.` is transparent, and `0`–`9` index into
  the colour list (`a`–`z` go further in Next). The default size is **5×5**;
  `sprite_size 8` or `sprite_size 7x4` in the prelude changes it. With no
  grid, the object is a solid square of its first colour.
- A digit higher than the number of listed colours is an error.
- `transparent` with no grid makes an invisible marker object. These are
  very common as temporary flags.

Next-only extras (only use them if the person wants them):
- Transforms after the grid: `copy:OtherObject`, `flip:right`,
  `rot:up:right`, `shift:down:3`, `translate:right:5`.
- Text sprites: `s; purple; text: S` (one line; needs `//` comment mode).
- Canvas sprites (`canvas:w,h` plus JSON drawing calls). These are for
  advanced users only.

## 3. LEGEND

```
. = Background
# = Wall
P = Player
* = Crate
@ = Crate and Target        (aggregate: several objects in one cell)
O = Target
Obstacle = Wall or Crate    (property: "any one of these")
```

- Single characters are what you type in levels. Any Unicode character works,
  but avoid `[ ] | ^ v < >` and other rule punctuation.
- `or` defines a **property**: usable in rules, win conditions and collision
  layers.
- `and` defines an **aggregate**: usable in levels. Aggregates can't go in
  collision layers, and you can't use `no` with them.
- Don't mix `and` and `or` in one definition. Properties can't be built from
  aggregates, and aggregates can't be built from properties.
- You can't put two objects from the **same** collision layer in one
  aggregate.
- `Player = Player1 or Player2` makes both of them receive input.

## 4. COLLISIONLAYERS

```
Background
Target
Player, Wall, Crate
```

- **Every object must appear in exactly one layer.** "Object X not in a
  collision layer" is a very common beginner error.
- Two objects on the **same** layer can't share a cell. That is what makes
  walls block and crates push. A move into an occupied cell on the same layer
  fails unless the occupant is also moving away.
- If a rule **places** an object into a cell that already holds something on
  its layer, the old object is silently deleted. Guard with `no Wall`, etc.,
  if that matters.
- Layers are also draw order: later lines are drawn on top.
- The first layer must be the background. Every cell has exactly one
  background object. If a level cell doesn't specify one, the engine infers
  one. `Background = Grass or Sand` in the legend allows several kinds.
- Put each temporary marker on its own layer, so it never deletes or blocks
  anything.

## 5. RULES — the core

A rule is: optional prefixes, a left-hand side, `->`, a right-hand side, then
optional commands.

```
[ > Player | Crate ] -> [ > Player | > Crate ]
```

- `[ ... ]` is a pattern. `|` separates **adjacent cells in a line**. Several
  objects in one cell are just written next to each other:
  `[ Player Spikes ]`.
- Both sides must have the same number of patterns, with the same number of
  cells in each.
- By default a rule is tried in **all four rotations**. Restrict this with a
  prefix: `up down left right horizontal vertical`. `right [ C | A | T ]`
  reads left-to-right only.
- Several patterns on one line, like `[ > Player ] [ Sumo ]`, can be anywhere
  on the board. All of them must match.

### Movement and direction words

- In patterns, `>` `<` `^` `v` are **relative** to the rule's rotation.
  `> Player` means "player moving toward the next cell".
- `up down left right` (absolute), `moving` (any direction including action),
  `stationary`, `action`, `horizontal`, `vertical`, `orthogonal`,
  `perpendicular`, `parallel`, `randomDir` (RHS only).
- Relative arrows are for inside patterns only. **A rule prefix can't be
  `>`**; use `up`/`down`/`left`/`right`/`horizontal`/`vertical` there.
- A direction marks an object as *wanting to move*. Movement actually happens
  later, in the movement phase.

### What the right-hand side changes

- Only things **mentioned** on the left are removed or changed on the right.
  `[ > Player | Crate ] -> [ > Player | Crate ]` changes nothing.
- `[ Crate ] -> [ ]` deletes the crate. To delete something not mentioned on
  the left, write `no X` on the right.
- `no X` on the left means "a cell with no X".
- A property (an `or` name) on the right is only allowed if the same property
  is on the left in the same cell, so the engine knows which concrete object
  you mean. Otherwise it's an error: "This rule has a property on the
  right-hand side...". Use `random Property` to pick one at random.

### Ellipsis

`[ Eye | ... | Player ] -> [ > Eye | ... | Player ]` matches any number of
cells (zero or more) in between, in a straight line.

### One turn, in order

1. The player presses a key, and every `Player` object gets that movement
   (or `action`).
2. Normal rules run **in file order**. Each rule (more exactly, each rule
   group) is applied **as many times as it can** before moving on to the
   next.
3. **Movement phase**: everything marked as moving tries to move one cell.
   Blocked moves just don't happen.
4. All movement marks are cleared.
5. `late` rules run, in order, each as often as it can. **Late rules can't
   contain movements.**
6. Commands run (`win`, `message`, `again`, ...), then win conditions are
   checked.

So rule order matters. To push a whole row of crates, the player-pushes-crate
rule must come **before** the crate-pushes-crate rule, or the two must be
grouped:

```
[ > Player | Crate ] -> [ > Player | > Crate ]
+ [ > Crate | Crate ] -> [ > Crate | > Crate ]
```

`+` at the start of a line joins that rule to the previous rule's group. The
whole group loops until none of its rules changes anything.

### Prefixes

`late` · direction prefixes · `+` · `random` (pick one match of the whole
group, at random) · `rigid` (advanced; see the docs on extended rigid bodies)
· `global` (ignores `local_radius`) · `once` (Next: apply just once) · a tag
name (Next, section 11).

### Commands (written after the right-hand side, or with no right-hand side)

```
late [ Player Spikes ] -> restart
late [ Player Exit ] -> win
[ > Player | Wall ] -> cancel           (undo this whole turn silently)
late [ Player SavePoint ] -> checkpoint
[ Lever action Player ] -> [ Lever Player ] sfx1 again
[ > Player | Npc ] -> message Hello there!
```

- `again` runs another turn with no input after a short pause
  (`again_interval`, 0.15s default). It is used for falling, chains and
  animations. It only re-fires if something changed.
- `cancel`, `restart`, `checkpoint`, `win`, `undo`, `sfx0`…`sfx10`,
  `message text`.
- Next adds: `log text` (prints to the console with a line link), `status
  text` (needs `status_line`), `nosave`, `quit`, `goto Section Name`,
  `gosub Name` (with `subroutine Name` blocks), and `link`.
- A command that takes text (`message`, `log`, `status`, `goto`) swallows the
  rest of the line, so it must come last.

### Idioms you will need

**"Not next to any X"**: `[ Player | no Gem ]` does **not** mean that. It
matches if *any* neighbour lacks a gem. Use a marker instead:

```
[ Player | Gem ] -> [ Player Near | Gem ]
[ Player no Near ] -> [ ]
[ Near ] -> [ ]
```

**Require the player to actually move** (walking into a wall doesn't pass
time): use the prelude flag `require_player_movement`.

**Gravity**, with `again` so it animates:

```
down [ stationary Boulder | no Obstacle ] -> [ > Boulder | ] again
```

**Line of sight** (a ray stopped by walls): propagate a marker in `late`
rules:

```
late [ Seen ] -> [ ]
late [ Player ] -> [ Player Seen ]
late [ Seen | no Obstruction ] -> [ Seen | Seen ]
```

That simple version spreads in every direction. For straight lines only, use
separate `SeenH`/`SeenV` markers with `horizontal`/`vertical` prefixes.

**Counting** is awkward. Use one object per value (`Count0`, `Count1`, …),
or Next tags with a mapping (section 11).

**Always clean up temporary markers**, and give each its own collision layer.

## 6. WINCONDITIONS

```
All Target on Crate     (every target has a crate)
Some Gem                (at least one gem exists)
No Fruit                (no fruit anywhere)
Some Gold on Chest
No Gold on Chest
```

All conditions listed must hold. Win conditions are checked at the end of a
turn. For any other logic, use a `late` rule with the `win` command.

## 7. LEVELS

```
message Push every crate onto a target.

#######
#.P...#
#.*.O.#
#######

message Well done!
```

- Levels are separated by **blank lines**. Each character must be a
  single-character legend key or object alias. A grid character that isn't
  defined gives "Key "x" not found".
- Make every row the same length.
- `message text` between levels shows a message screen.
- Next adds `level Name` (names the next level), `section Name` (groups
  levels for `level_select` and `goto`), and `link object Level Name`.
- Ctrl/Cmd+click on a level in the editor loads that level directly.

## 8. SOUNDS

Sound **seeds** are numbers generated by the sound buttons above the editor's
console. Never make seeds up; tell the person to click a button and paste the
number.

```
Player Move 36772507
Crate Move Left 12345678
Player CantMove 7654321
Crate Create 111
Sfx1 4444            (played by the sfx1 command)
EndLevel 999
```

Events: `Move` / `CantMove` (optionally with directions), `Create`,
`Destroy`, `Action`, and the game events `StartGame`, `EndGame`,
`StartLevel`, `EndLevel`, `Restart`, `Undo`, `ShowMessage`, `CloseMessage`,
`TitleScreen`, `Cancel`. In Next, `:12` after a seed sets the volume (in
tenths: 6 is 60%, 20 is 200%).

## 9. Prelude settings that matter most

| setting | what it does |
|---|---|
| `title`, `author`, `homepage` | shown on the title screen |
| `color_palette name` | which colours the colour names mean (section 12) |
| `require_player_movement` | a turn where the player didn't move is cancelled |
| `run_rules_on_level_start` | run the rules once before the player's first move |
| `again_interval 0.1` | seconds between `again` turns (default 0.15) |
| `key_repeat_interval 0.15` | held-key repeat (default 0.2) |
| `realtime_interval 0.5` | tick with no input every N seconds (stationary-player turns) |
| `noaction`, `norepeat_action`, `noundo`, `norestart` | disable or adjust keys |
| `flickscreen 10x8` / `zoomscreen 10x8` | show only part of a big level |
| `verbose_logging` | trace every rule that fires in the console (**the debugging tool**) |
| `debug` | print the compiled rules (shows how one rule became four rotations) |
| `background_color`, `text_color` | message and title screen colours |

Next-only settings (a selection): `sprite_size N` or `WxH`; `level_select`,
`level_select_lock`, `continue_is_level_select`; `enable_pause`;
`status_line`; `smoothscreen WxH`; `tween_length 0.1` with `tween_easing`
(smooth movement); `animate_interval`; `mouse_left obj`, `mouse_drag obj`,
`mouse_up obj` (mouse input places an object where you click); `nokeyboard`;
`skip_title_screen`; `local_radius N`; `runtime_metadata_twiddling` (change
prelude settings from rules); `custom_font url`; `message_text_align`.

**Tweening caveat (Next):** a tween is tracked by cell and layer, not by
object. So a `late` rule that adds or removes objects on a layer that things
move on can break a slide. Swapping one object for another on the same layer
is safe. The editor warns about the specific risky `late` rules when it
compiles. Keep `tween_length` below `again_interval` and
`key_repeat_interval`.

## 10. Errors and what they usually mean

| console says | usual cause |
|---|---|
| `Key "x" not found` | a level uses a character with no legend entry |
| `... is not declared anywhere` / `Object not found` | typo, or used before it was defined |
| `Object "X" has been defined, but not assigned to a layer` | add it to COLLISIONLAYERS |
| `Name "//", referred to in a rule, does not exist` | a `//` comment in a file that isn't in `//` mode (section 1) |
| `... are on the same layer and therefore can't coexist` | an `and` aggregate combines objects from one layer |
| `Name "x" already in use` | the same name is used twice (object, alias or legend) |
| `the number of matches ... on the left hand side ... must equal the number on the right` | an unequal count of `[ ]` patterns on each side |
| `each pattern to match on the left must have a corresponding pattern on the right of equal length` | an unequal number of `\|` cells |
| `This rule has a property on the right-hand side` | an `or` name on the right that isn't on the left in the same cell |
| `Movements cannot appear in late rules` | remove the `>` etc. from that late rule, or make it non-late |
| `You cannot use relative directions ... to indicate in which direction(s) a rule applies` | used `>` as a prefix; use `right` etc. |
| `Invalid color name` / sprite uses an index with no colour | fix the colour list |
| `... can never overlap ... being culled` | the rule needs two same-layer objects in one cell; it can never fire |
| `Invalid GOTO command - there is no section named` | a section name mismatch (Next) |

Warnings in the console are not fatal. Errors stop the game from compiling.
Line numbers in the console are clickable.

## 11. Next: tags and mappings (advanced; only if wanted)

```
TAGS
Charge = Positive Negative

MAPPINGS
Charge => Opposite
Positive Negative -> Negative Positive
```

- `Crate:Charge` in OBJECTS declares `Crate:Positive` and `Crate:Negative` in
  one go, and also a property covering both.
- `directions` (up right down left), `horizontal` and `vertical` are
  predefined. `Rocket:directions` gives four objects; add `rot:up:>` to
  rotate the sprite for each.
- A tag used as a rule prefix expands the rule once per value:
  `Charge [ Crate:Charge ] -> [ Crate:Opposite ]`.
- A rule can use `>` inside a name: `[ > Player:directions ] -> [ > Player:> ]`
  makes the player face the way it moves.

## 12. This fork (fortress-rhythm) specifically

- **Editor**: <https://fortress-rhythm.github.io/PuzzleScriptNext/src/editor.html>.
  The toolbar has RUN, REBUILD, LEVEL EDITOR, **PALETTES** (preview any
  palette on the running game, or export a portable palette block), **MAP
  EDITOR** (opens the game in a mouse-driven level and sprite editor, with
  rectangular copy/paste), EXPORT (a standalone HTML file), SHARE, DOCS,
  SOLVE, and **COPY FOR AI** (copies this pack plus the game and console).
- **Extra palettes**: `color_palette` indices 15–24 are fork-only: 
  `bentenpond`, `dungeon20`, `oekakinl`, `soggysepia`, `rustfairy`,
  `ruststorm`, `rustfairyochre`, `endofallglory`, `gloryrust`, `berrysepia`.
  The built-in ones are 1–14: `mastersystem`, `gameboycolour`, `amiga`,
  `arnecolors` (the default), `famicom`, `atari`, `pastel`, `ega`,
  `amstrad`, `proteus_mellow`, `proteus_rich`, `proteus_night`, `c64`,
  `whitingjp`. A game using a fork palette name **won't run on stock
  PuzzleScript**. To share such a game elsewhere, use PALETTES → export,
  which writes a portable `color_palette` override block. You can override
  single colours too: `color_palette amstrad lightgreen #6F8E44`.
- **`min_cell_size N`** (prelude, fork-only): if a big level would shrink
  below N pixels per cell, the camera follows the player at that size
  instead. With no player, the level scrolls.
- **LATE-rule tween warnings**: see the tweening caveat in section 9.

## 13. A complete small game, to calibrate against

This compiles and plays in this fork as written.

```
title Crate Corner
author Example

========
OBJECTS
========

Background
LightGreen Green
11111
01111
11101
11111
10111

Target
DarkBlue
.....
.000.
.0.0.
.000.
.....

Wall
BROWN DarkBrown
00010
11111
01000
11111
00010

Player
Black Orange White Blue
.000.
.111.
22222
.333.
.3.3.

Crate
Orange Yellow
00000
0...0
0...0
0...0
00000

=======
LEGEND
=======

. = Background
# = Wall
P = Player
* = Crate
@ = Crate and Target
O = Target
Obstacle = Wall or Crate

=======
SOUNDS
=======

================
COLLISIONLAYERS
================

Background
Target
Player, Wall, Crate

======
RULES
======

(the player pushes a crate, and a pushed crate pushes the next one)
[ > Player | Crate ] -> [ > Player | > Crate ]
+ [ > Crate | Crate ] -> [ > Crate | > Crate ]

==============
WINCONDITIONS
==============

All Target on Crate

=======
LEVELS
=======

message Push every crate onto a target.

#######
#.....#
#.P*O.#
#.....#
#######

#######
#O....#
#..**.#
#.P..O#
#######

message Well done!
```
