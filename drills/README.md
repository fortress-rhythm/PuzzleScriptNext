# Rule-writing drills

Twelve short exercises for learning to write PuzzleScript rules yourself. Each
one teaches a single idea, and a checker runs your attempt on the real engine
to tell you whether it works.

Each drill gives you a small game where everything except the rules is already
written. The comment at the top of the file explains the idea, says what to
build and gives a hint. You write the rules until the checker passes.

## How to do a drill

1. Open `drills/NN-name/starter.txt`, paste it into the editor
   (`src/editor.html`, or the fork's online editor) and press RUN to play it.
2. Write rules in the editor until the game behaves as the TASK describes.
   Play it as you go. When something surprises you, add `verbose_logging`
   under `author` and read the rule trace in the console.
3. Paste your game back into `starter.txt` and run the checker from the
   repository root:

   ```bash
   node drills/check.js 01
   ```

   Or check a file kept somewhere else:

   ```bash
   node drills/check.js 01 my-attempt.txt
   ```

   Each case says pass or FAIL. A failed case shows the start map, the keys
   pressed, the map it expected and the map your rules produced. Keys are
   `U D L R` for the arrows, `X` for action.
4. Once it passes, compare with `drills/answers/NN-name.txt`. Yours may well
   be different and still correct. The checker only cares about behaviour.
5. If you're stuck for more than about 20 minutes, use the COPY FOR AI button
   in the editor and ask *why* your rule does what it does, not for the answer.

Keep the starter's OBJECTS and LEGEND. You can add to them, but don't rename
or remove anything, because the checks are drawn with the starter's legend
characters. Objects you add without a legend character of their own (helper
markers) are ignored when maps are compared.

`git checkout drills/` puts every starter back, so you can redo a drill from
scratch a week later. Redoing them is the drill.

## The drills

| # | Drill | What it teaches |
|---|---|---|
| 01 | Push | Rule shape: `[ ] -> [ ]`, `\|`, `>`, rotation |
| 02 | Pull | `<`, and reading direction relative to the pattern |
| 03 | Chain push | Properties (`Pushable = Crate or Barrel`), rules repeating |
| 04 | One-way tiles | Direction prefixes: `left [ ]`, `horizontal`, `vertical`; blocking a move |
| 05 | Holes | `late` rules: before vs. after movement |
| 06 | Coins and gems | WINCONDITIONS: `No`, `All ... on ...` |
| 07 | Keys and doors | State as objects; multi-part rules `[ A ] [ B ]` |
| 08 | Gates | **Debugging**: rule order and the flip-flop trap; `action` |
| 09 | Magnets | Ellipsis `...` |
| 10 | Falling boulders | `again`, `stationary`, instant vs. animated |
| 11 | Portals | **Debugging**: rules that undo each other; using movement as a trigger |
| 12 | Bridges | Capstone: a whole small ruleset from a blank RULES section |

They get harder as they go, and later drills assume the earlier ideas.
Drills 08 and 11 start with buggy rules to fix, because reading a rule trace
is half the skill.

## After the drills

Rewrite the rules of a mechanic you like from `src/demo/`, from memory, then
compare with the original. After that, build the smallest version of your own
idea: one mechanic, default colours, three levels.

## For maintainers

`node drills/check.js --self-test` checks that every answer passes all its
cases and every unedited starter fails at least one. CI runs it. A drill is
three files: `NN-name/starter.txt`, `NN-name/checks.json` (each case is a
`map`, the `keys` to press, and an `expect` that is a map, `"win"` or
`"no win"`) and `answers/NN-name.txt`. The checker loads the engine from
`src/js`, the same files as `src/tests/tests.html`, so it needs no `npm
install`.
