# Fonts bundled with / defaulted by the engine

These are fonts shipped inside this repository and used as a default by the
engine or its documentation/tooling — not fonts loaded by an individual game
via the `custom_font` prelude directive (see
[`Documentation/prelude.html`](../../src/Documentation/prelude.html) and
[`src/js/codemirror/anyword-hint.js`](../../src/js/codemirror/anyword-hint.js)
for that per-game mechanism; that attribution travels with the game's own
`.txt` file as a comment, not here).

## Source Sans Pro

- **Author:** Paul D. Hunt (Adobe)
- **Source:** https://github.com/adobe-fonts/source-sans /
  https://fonts.google.com/specimen/Source+Sans+Pro
- **License:** SIL Open Font License, Version 1.1 —
  https://scripts.sil.org/OFL
- **Bundled at:** `src/fonts/SourceSansPro-Regular.ttf`,
  `src/fonts/SourceSansPro-Regular.woff`
- **Used as default in:**
  - `src/js/graphics.js` — the default font used to render in-game canvas
    text (title screen, messages, on-screen text) unless a game overrides it
    with `custom_font`.
  - `src/css/docs.css` — the default body font for the documentation site.

## Glyphicons Halflings

- **Author:** Jan Kovařík / Glyphicons, bundled and redistributed as part of
  Bootstrap v3.0.0
- **Source:** https://getbootstrap.com/docs/3.4/components/#glyphicons /
  https://www.glyphicons.com/
- **License:** Apache License, Version 2.0 (Glyphicons Halflings has been
  bundled with, and licensed under, Bootstrap's own license since
  Bootstrap 3) — https://www.apache.org/licenses/LICENSE-2.0
- **Bundled at:** `src/Documentation/fonts/glyphicons-halflings-regular.ttf`,
  `.woff`, `.eot`, `.svg`
- **Used as default in:** `src/Documentation/css/bootstrap.css` — iconography
  on the documentation site.

## Not third-party: the built-in bitmap glyph font

`src/js/font.js` defines a hardcoded 5×12 bitmap glyph set used for
in-engine text rendering. This is original artwork created for this
project, not a third-party font, so it is not listed above. If it is ever
replaced or supplemented with a licensed third-party font (bitmap or
vector), add an entry to this file describing it, following the same
format (name, author, source URL, license).
