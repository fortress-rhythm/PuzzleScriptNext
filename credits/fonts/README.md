# Fonts bundled with / defaulted by the engine

These are fonts shipped inside this repository and used as a default by the
engine or its documentation/tooling — not fonts loaded by an individual game
via the `custom_font` prelude directive (see
[`Documentation/prelude.html`](../../src/Documentation/prelude.html),
[`Documentation/custom_fonts.html`](../../src/Documentation/custom_fonts.html)
and [`src/js/codemirror/anyword-hint.js`](../../src/js/codemirror/anyword-hint.js)
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
  - `src/css/docs.css` — the default body font for the documentation site.
  - `src/js/graphics.js` — the font for the `showLayers` debug overlay label
    (the "Layer N" text shown by the layer-visualization dev tool).

  Note this is *not* the font a game's own title screen, menus, messages or
  status line render with by default: those use the generic `Monospace`
  CSS font-family (see `drawTextWithFont` in `src/js/graphics.js`), a
  system font rather than a bundled file, so it needs no entry here. A game
  can replace that default for itself with `custom_font`, credited
  per-game as described at the top of this file.

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
