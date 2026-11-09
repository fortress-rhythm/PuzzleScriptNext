# PuzzleScript Next (fortress-rhythm fork)

PuzzleScript Next is an upward-compatible successor to PuzzleScript for more advanced developers. This fork adds a curated palette set, a map and sprite editor, and an AI context pack.

> **The example games here are not MIT-licensed by this repository.** The repository holds over 200 scripts by other authors, whose license terms are unconfirmed. They are for study, so check with the author before reusing one. See [Example games and licensing](#example-games-and-licensing).

* [**Start here**](https://fortress-rhythm.github.io/PuzzleScriptNext/): the front page, with every tool and command
* [Editor](https://fortress-rhythm.github.io/PuzzleScriptNext/src/editor.html): write, run and export games
* [Map and sprite editor](https://fortress-rhythm.github.io/PuzzleScriptNext/puzzlescript-map-editor/web/index.html): edit levels and sprites with the mouse
* [Setup and running](https://fortress-rhythm.github.io/PuzzleScriptNext/doc/setup.html): the toolchain, serving the checkout, and where to run each command
* [This fork's documentation](doc/README.md): the palette set, the map and sprite editor, and how they stay in step
* [Upstream changelog](CHANGELOG.md): PuzzleScript Next's release notes

The official upstream project is at [david-pfx/PuzzleScriptNext](https://github.com/david-pfx/PuzzleScriptNext): [stable release](https://puzzlescriptnext.polyomino.com/), [dev version](https://david-pfx.github.io/PuzzleScriptNext/src/index.html), [documentation](https://david-pfx.github.io/PuzzleScriptNext/src/Documentation). This fork carries its own copy of the documentation, with the tween and LATE sections rewritten.

Report engine issues [upstream](https://github.com/david-pfx/PuzzleScriptNext/issues) and problems with this fork's additions on [its tracker](https://github.com/fortress-rhythm/PuzzleScriptNext/issues).

## Example games and licensing

The [MIT license](LICENSE) covers the engine, editor and tools. The map editor and this fork's tooling are copyright fortress-rhythm; the engine and editor are copyright Stephen Lavelle and the PuzzleScript, PuzzleScript Plus, Pattern:Script and PuzzleScript Next contributors. The license does not cover the third-party games stored in this repository, or the images and listings made from them:

| Location | What it holds |
|---|---|
| `src/demo/` | Whole game scripts, used by the editor's examples, `play.html` and `npm run check:games` |
| `src/tests/resources/` | Copies of games embedded as test data |
| `src/Gallery/`, `src/games_dat*.js` | Animations and screenshots of games, with titles and authors |

**What upstream says.** [`src/demo/README`](src/demo/README) dates from the original PuzzleScript in 2013:

> These demos aren't necessarily under MIT license. Ones that are linked to from the dropdown in the editor as examples can be assumed to be so, but other ones are just private records of games that I liked a lot and want to make sure aren’t lost in the sands of time.

**What that means here.**

* This fork inherited these files from upstream and has not confirmed the terms of any of them with their authors, so it cannot grant any rights to them.
* Treat even the dropdown games as unconfirmed. The README's assumption was written before most of today's dropdown existed.
* Some scripts state their own terms, and those can be stricter. For example, `src/demo/mazezam.txt` points to the AGPL, and `src/demo/next/custom_font_demo.txt` embeds a font with its own terms. Read the script's header first.
* GitHub Pages publishes this whole repository, so these files are also served from the site.

**If you wrote one of these games** and want it removed, [open an issue](https://github.com/fortress-rhythm/PuzzleScriptNext/issues). Removal takes it out of the current files and the site, but it stays in the git history.

Fonts and libraries bundled with the engine keep their own licenses: see [`credits/`](credits/README.md). Palettes from other artists are credited in their files in [`palettes/`](palettes/), and this fork does not relicense them.

## What this fork adds

Details are in [`doc/`](doc/README.md).

* **Palette set:** ten curated palettes at `color_palette` indices 15-24, a **PALETTES** panel that previews any palette on the running game, portable prelude blocks for stock PuzzleScript, and tooling to rate and adopt more. The palettes are in [`palettes/`](palettes/).
* **Map and sprite editor:** [`puzzlescript-map-editor/`](puzzlescript-map-editor/README.md) is a browser grid editor with rectangular copy and paste, a **Sprites** workspace and a palette sampler. Its command-line side, `psmap`, has Excel and REXPaint bridges and a `check` for CI. **MAP EDITOR** in the editor's toolbar hands the open game across.
* **COPY FOR AI:** this toolbar button copies a primer ([`doc/ai-context-pack.md`](doc/ai-context-pack.md)), the current game, any selected lines, the end of the console and a question template, ready to paste into a chat. Nothing is sent anywhere. After editing the primer, run `npm run build:ai-pack`.
* **Front page:** [`index.html`](index.html) links everything above.

## Running it

Clone or download, then open `index.html`. The editor and map editor work straight off disk. The editor's EXPORT and SHARE and the map editor's example buttons need a server:

```sh
./runserver.sh      # macOS / Linux: node if installed, else python3
runserver.bat       # Windows: the same
npm start           # from the repository root, if you have node
```

Then open <http://localhost:8020/>.

| To | You need |
|---|---|
| Play, write and edit games | A browser |
| Serve locally | Node 16+ or Python 3 |
| Run `npm test`, `npm run check:games`, `npm run check:export`, `npm run check:ai-pack`, or rebuild the export template with `npm run build:template` | Node 16+, with no `npm install` |
| Use the palette tools in `tools/` | [uv](https://docs.astral.sh/uv/) |
| Build the minified `bin/` with `npm run build` | Node and `npm ci` (not `npm install`, which rewrites the lock file). Its image tools need native binaries and fail on some machines. Nothing else depends on it. |

CI runs the checks on every push (`.github/workflows/check.yml`).

## Publishing on GitHub Pages

In the repository settings, set **Settings → Pages → Source** to **GitHub Actions**. Every push to `master` then publishes the checkout as is (`.github/workflows/pages.yml`), with the front page at `https://<you>.github.io/PuzzleScriptNext/`.

## Credits

PuzzleScript Next combines the work of many authors:

* [PuzzleScript](https://github.com/increpare/PuzzleScript) by Increpare
* [PuzzleScript Plus](https://github.com/Auroriax/PuzzleScriptPlus) by Auroriax
* [Pattern:Script](https://clementsparrow.github.io/Pattern-Script) by Clement Sparrow
* [PuzzleFAB](https://github.com/david-pfx/PuzzleFAB) and PuzzleScript Next by [david-pfx](https://github.com/david-pfx)
* The vector feature by [hfmanson](https://github.com/hfmanson/PuzzleScriptNext)
