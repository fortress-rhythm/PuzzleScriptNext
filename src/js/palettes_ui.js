// Palette preview and export - palette-set extension (fork-original).
//
// Three previews, all rendered from colorPalettes so they cannot drift from
// what the engine actually uses:
//
//   one palette   - the 21 named slots as labelled swatches
//   all palettes  - every palette as a row, for comparing them side by side
//   in the editor - the current game's own sprites and level redrawn under a
//                   chosen palette, without touching the game source
//
// Plus export: any palette as a `color_palette ...` prelude block with all 24
// names spelled out, so a game using a fork-only palette still runs on stock
// PuzzleScript once distributed.

var palettePreviewOpen = false;
var palettePreviewMode = 'all';      // 'all' | 'one'
var palettePreviewName = 'arnecolors';

// The palette the level editor is currently being previewed under, or null for
// the game's own. Only ever affects rendering; the game source is untouched.
var paletteEditorOverride = null;

// The 21 real slots, in ramp order. gray/darkgray/lightgray are spelling
// aliases of their grey twins, so they are exported but not shown twice.
const PALETTE_SLOTS = [
    'black', 'darkgrey', 'grey', 'lightgrey', 'white',
    'darkred', 'red', 'lightred',
    'darkbrown', 'brown', 'lightbrown',
    'orange', 'yellow',
    'darkgreen', 'green', 'lightgreen',
    'darkblue', 'blue', 'lightblue',
    'purple', 'pink',
];

const PALETTE_EXPORT_ORDER = [
    'black', 'white', 'grey', 'darkgrey', 'lightgrey',
    'gray', 'darkgray', 'lightgray',
    'red', 'darkred', 'lightred', 'brown', 'darkbrown', 'lightbrown',
    'orange', 'yellow', 'green', 'darkgreen', 'lightgreen',
    'blue', 'lightblue', 'darkblue', 'purple', 'pink',
];

// Which palettes this build ships, in alias order so the numbering shown
// matches what you would write in a prelude.
function paletteNames() {
    const ordered = [];
    const indices = Object.keys(colorPalettesAliases)
        .map(Number).sort((a, b) => a - b);
    for (const i of indices) {
        const name = colorPalettesAliases[i];
        if (name in colorPalettes) ordered.push({ index: i, name: name });
    }
    // Anything in colorPalettes without an alias still deserves to be listed.
    for (const name of Object.keys(colorPalettes)) {
        if (!ordered.some(o => o.name === name)) ordered.push({ index: null, name: name });
    }
    return ordered;
}

/**
 * A palette as a prelude line. `base` is the palette name the overrides sit on
 * top of - arnecolors by default, because every build has it.
 *
 * The point of spelling all 24 names out is portability: a game that says
 * `color_palette bentenpond` only runs on a build that has bentenpond, but the
 * same game with this block runs anywhere.
 */
function paletteToPreludeBlock(name, base) {
    base = base || 'arnecolors';
    const p = colorPalettes[name];
    if (!p) return '';
    const pairs = PALETTE_EXPORT_ORDER
        .filter(k => k in p)
        .map(k => k + ' ' + p[k]);
    return 'color_palette ' + base + ' ' + pairs.join(' ');
}

// ---------------------------------------------------------------- rendering

function paletteSwatchRow(name, opts) {
    opts = opts || {};
    const p = colorPalettes[name];
    const cells = PALETTE_SLOTS.map(slot =>
        '<span class="pal-sw" style="background:' + p[slot] + '"'
        + ' title="' + slot + ' ' + p[slot] + '"></span>').join('');

    const alias = paletteNames().find(o => o.name === name);
    const label = (alias && alias.index !== null ? alias.index + ' - ' : '') + name;

    return '<div class="pal-row">'
        + '<div class="pal-row-head">'
        + '<span class="pal-name">' + label + '</span>'
        + '<span class="pal-actions">'
        + '<a href="javascript:void(0)" data-pal-preview="' + name + '">preview</a> '
        + '<a href="javascript:void(0)" data-pal-editor="' + name + '">in editor</a> '
        + '<a href="javascript:void(0)" data-pal-export="' + name + '">export</a>'
        + '</span></div>'
        + '<div class="pal-swatches">' + cells + '</div>'
        + '</div>';
}

function paletteSwatchDetail(name) {
    const p = colorPalettes[name];
    const cells = PALETTE_SLOTS.map(slot =>
        '<div class="pal-chip">'
        + '<span class="pal-chip-col" style="background:' + p[slot] + '"></span>'
        + '<span class="pal-chip-name">' + slot + '</span>'
        + '<span class="pal-chip-hex">' + p[slot].toLowerCase() + '</span>'
        + '</div>').join('');
    return '<div class="pal-detail">' + cells + '</div>';
}

function renderPalettePreview() {
    const host = document.getElementById('palettePanelBody');
    if (!host) return;

    let html = '';
    if (palettePreviewMode === 'one') {
        html += '<div class="pal-head">'
            + '<b>' + palettePreviewName + '</b> '
            + '<a href="javascript:void(0)" id="palBackAll">&larr; all palettes</a>'
            + '</div>';
        html += paletteSwatchDetail(palettePreviewName);
        html += '<div class="pal-head" style="margin-top:8px">'
            + '<a href="javascript:void(0)" data-pal-editor="' + palettePreviewName + '">apply to level editor</a> '
            + '<a href="javascript:void(0)" data-pal-export="' + palettePreviewName + '">export as prelude block</a>'
            // Clearing has to be reachable from here too, or previewing a
            // palette in detail is a one-way door until you navigate back.
            + (paletteEditorOverride
                ? ' <a href="javascript:void(0)" id="palClearOverride">clear override ('
                  + paletteEditorOverride + ')</a>'
                : '')
            + '</div>';
    } else {
        html += '<div class="pal-head">'
            + 'Click <b>preview</b> for detail, <b>in editor</b> to redraw the game '
            + 'under a palette, <b>export</b> for a portable prelude block.'
            + (paletteEditorOverride
                ? ' <a href="javascript:void(0)" id="palClearOverride">clear override ('
                  + paletteEditorOverride + ')</a>'
                : '')
            + '</div>';
        for (const entry of paletteNames()) html += paletteSwatchRow(entry.name);
    }
    html += '<div class="pal-out hidden" id="palExportOut">'
        + '<div class="pal-head"><span>Paste into your prelude</span>'
        + '<a href="javascript:void(0)" id="palExportClose">close</a></div>'
        + '<textarea id="palExportText" readonly spellcheck="false"></textarea></div>';

    host.innerHTML = html;
    wirePalettePanel(host);
}

function wirePalettePanel(host) {
    host.querySelectorAll('[data-pal-preview]').forEach(a => {
        a.addEventListener('click', () => {
            palettePreviewMode = 'one';
            palettePreviewName = a.getAttribute('data-pal-preview');
            renderPalettePreview();
        });
    });
    host.querySelectorAll('[data-pal-editor]').forEach(a => {
        a.addEventListener('click', () => applyPalettePreviewToEditor(a.getAttribute('data-pal-editor')));
    });
    host.querySelectorAll('[data-pal-export]').forEach(a => {
        a.addEventListener('click', () => showPaletteExport(a.getAttribute('data-pal-export')));
    });

    const back = host.querySelector('#palBackAll');
    if (back) back.addEventListener('click', () => {
        palettePreviewMode = 'all';
        renderPalettePreview();
    });
    const clear = host.querySelector('#palClearOverride');
    if (clear) clear.addEventListener('click', () => applyPalettePreviewToEditor(null));
    const close = host.querySelector('#palExportClose');
    if (close) close.addEventListener('click', () => {
        host.querySelector('#palExportOut').classList.add('hidden');
    });
}

function showPaletteExport(name) {
    const out = document.getElementById('palExportOut');
    const area = document.getElementById('palExportText');
    if (!out || !area) return;
    const p = colorPalettes[name];
    const added = paletteCredits[name];
    area.value = (added ? '(' + added + ')\n' : '') + paletteToPreludeBlock(name);
    out.classList.remove('hidden');
    area.focus();
    area.select();
    consolePrint('Exported "' + name + '" as a prelude block - portable to any PuzzleScript build.');
}

/**
 * Redraw the running game under a different palette.
 *
 * This recompiles nothing and edits nothing: it swaps the palette object the
 * renderer reads, regenerates the sprite images, and redraws. Passing null puts
 * the game's own palette back.
 */
function applyPalettePreviewToEditor(name) {
    if (typeof state === 'undefined' || !state || !state.metadata) {
        consolePrint('Compile a game first - there is nothing to recolour yet.', true);
        return;
    }
    if (name && !(name in colorPalettes)) return;

    if (!paletteOriginalMetadata) {
        paletteOriginalMetadata = state.metadata.color_palette;
    }

    paletteEditorOverride = name;
    state.metadata.color_palette = name
        ? Object.assign({}, colorPalettes[name])
        : paletteOriginalMetadata;

    // Sprites keep their colour *names* and resolve them against
    // state.metadata.color_palette every time the sprite images are rebuilt
    // (graphics.js, regenSpriteImages). So swapping the palette object and
    // forcing a regen is the whole job - nothing in state.objects is touched,
    // which is why this is reversible.
    try {
        recomputeChromeColours();
        forceRegenImages = true;
        canvasResize();
    } catch (e) {
        consolePrint('Could not recolour: ' + e.message, true);
        return;
    }
    consolePrint(name
        ? 'Previewing "' + name + '" in the editor. This changes nothing in your source.'
        : 'Palette preview cleared - back to the game\'s own colours.');
    renderPalettePreview();
}

var paletteOriginalMetadata = null;

/**
 * Recompute the handful of colours that are stored on `state` as hex rather
 * than re-resolved per frame: the background and text chrome.
 *
 * Their *names* live in state.metadata, so this is just the same lookup the
 * compiler does, run again against the new palette.
 */
function recomputeChromeColours() {
    const palette = state.metadata.color_palette;
    const chrome = [
        ['background_color', 'bgcolor'],
        ['text_color', 'fgcolor'],
        ['author_color', 'author_color'],
        ['title_color', 'title_color'],
        ['keyhint_color', 'keyhint_color'],
    ];
    for (const [meta, field] of chrome) {
        if (meta in state.metadata) {
            state[field] = colorToHex(palette, state.metadata[meta]);
        }
    }
}

// -------------------------------------------------------------------- panel

function palettePreviewClick() {
    const panel = document.getElementById('palettePanel');
    if (!panel) return;
    palettePreviewOpen = !palettePreviewOpen;
    panel.classList.toggle('hidden', !palettePreviewOpen);
    if (palettePreviewOpen) renderPalettePreview();
}

// One-line credit per fork-original palette, shown when exporting so the
// attribution travels with the colours.
var paletteCredits = {
    bentenpond:
        'palette adapted from "Benten Pond" by Terry Ross (lospec.com/palette-list/benten-pond), '
        + 'inspired by Kawase Hasui\'s "The Pond at Benten Shrine". '
        + 'brown, darkbrown, orange and yellow are original additions.',
    dungeon20:
        'palette adapted from "Dungeon-20" by Meaghan / goldentreesart '
        + '(lospec.com/palette-list/dungeon-20). lightred, darkbrown, the three greens '
        + 'and pink are original additions.',
    oekakinl:
        'palette adapted from "Oekaki.nl" by P-Tux7 (lospec.com/palette-list/oekakinl). '
        + 'darkred, darkgreen and lightbrown are original additions.',
    soggysepia:
        'palette adapted from "Soggy Sepia CRT-20" by Digi / @Digitress '
        + '(lospec.com/palette-list/soggy-sepia-crt-20). The source has no blue at all, '
        + 'so the three blues and yellow are original additions.',
};
