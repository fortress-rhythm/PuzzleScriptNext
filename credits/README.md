# Third-Party Credits

This directory documents third-party assets that are bundled with, or set as
a default in, the **PuzzleScriptNext engine and its tooling itself** — as
opposed to assets that an individual game author supplies via their own
`.txt` source (for example, a font loaded with the `custom_font` prelude
directive, or a spritesheet loaded with `load_images`).

The distinction matters for attribution: an asset baked into the engine is
inherited by *every* game built from this fork, so the credit belongs here
at the repo level rather than in any one game's source file.

## Categories

- [`fonts/`](fonts/README.md) — fonts bundled with the repo and/or used as a
  default text-rendering font by the engine or its documentation/tooling.

Additional categories (e.g. bundled images, sounds, or third-party code)
should be added here as their own subdirectory with its own `README.md`,
following the same per-asset format used in `fonts/README.md`.
