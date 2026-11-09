'use strict';

// The PuzzleScript map editor.
//
// The whole point of this program is that a rectangle is a first-class thing:
// you marquee one, copy it, and paste it somewhere else where it OVERWRITES a
// rectangle of the same shape. Text editors insert instead, which shoves the
// rest of every row sideways and destroys the map. Everything else here -
// sprites, flood fill, cross-level clipboard - exists to make that workflow
// pleasant rather than merely possible.
//
// There are two workspaces over the same grid model. MAPS edits the level grids
// from LEVELS, with tiles drawn as the game's own objects. SPRITES edits the
// sprite matrices from OBJECTS - the ASCII art the tiles are drawn with - where
// a "tile" is one of the object's colour indices. Both splice back into the
// source file by line range, so a two-pixel edit is a two-line diff either way.
//
// The palette sampler redraws everything under any palette this build carries
// without touching the file, so "would this game look better in soggysepia" is
// a click rather than an edit-save-reload.

(function () {

const psgame = PSMap.psgame;
const palettes = PSMap.palettes;
const tf = PSMap.transform;
const render = PSMapRender;

// --------------------------------------------------------------------- state

const state = {
    source: null,
    fileName: 'game.txt',
    game: null,

    mode: 'levels',      // 'levels' | 'sprites'

    // MAPS workspace.
    glyphs: {},
    glyphAt: () => undefined,
    glyphOrder: [],
    background: '.',
    underlay: null,      // the background glyph, drawn under every cell
    levels: [],          // working copies: { rows: [string], name, gridIndex }
    outline: [],         // display order, including sections with no map yet
    currentLevel: 0,

    // SPRITES workspace.
    sprites: [],         // working copies: { rows: [string], name, block, edited }
    currentSprite: 0,
    spriteGlyphs: {},
    spriteGlyphOrder: [],
    colorsFrom: null,    // a block whose colours the sprite is previewed in, or null

    // Colours. `resolved` is what the game asked for; `paletteOverride` is the
    // sampler's choice, or null for the game's own.
    resolved: null,
    paletteOverride: null,

    tool: 'select',
    ink: '.',
    cell: 24,
    zoomPinned: false,

    selection: null,     // { x0, y0, x1, y1 } inclusive, normalised
    drag: null,          // in-progress mouse operation
    clipboard: null,     // { w, h, rows: [string] }
    pasteAt: null,       // { x, y } while a paste ghost is following the cursor
    floating: null,      // { clipboard } while a turned selection waits to be placed
    hover: null,
    hoverFine: null,     // the cursor in cells, with the fraction, for a mirror line
    axisHint: false,     // Shift held: show where Shift+H / Shift+V would mirror
    sourceDirty: false,  // the source itself was rewritten (a new copy: object)

    undo: [],
    redo: [],
};

const el = (id) => document.getElementById(id);
const canvas = el('canvas');
const ctx = canvas.getContext('2d');

// ------------------------------------------------------------- grid helpers

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const inSprites = () => state.mode === 'sprites';

/** The list the active workspace edits, and the index into it. */
function currentList() { return inSprites() ? state.sprites : state.levels; }
function currentIndex() { return inSprites() ? state.currentSprite : state.currentLevel; }
function setCurrentIndex(i) { if (inSprites()) state.currentSprite = i; else state.currentLevel = i; }

function currentLevel() { return currentList()[currentIndex()]; }

/** What "erase" paints: the background tile, or a transparent sprite pixel. */
function eraseChar() { return inSprites() ? '.' : state.background; }

/** The glyph lookup for the active workspace. */
function glyphLookup() { return inSprites() ? spriteGlyphLookup : state.glyphAt; }
function glyphOrder() { return inSprites() ? state.spriteGlyphOrder : state.glyphOrder; }
function glyphTable() { return inSprites() ? state.spriteGlyphs : state.glyphs; }

function levelSize(level) {
    return { w: Math.max(0, ...level.rows.map(r => r.length)), h: level.rows.length };
}

function getCell(level, x, y) {
    const row = level.rows[y];
    return row === undefined ? undefined : row[x];
}

function setCell(level, x, y, ch) {
    const row = level.rows[y];
    if (row === undefined || x < 0 || x >= row.length) return false;
    if (row[x] === ch) return false;
    level.rows[y] = row.slice(0, x) + ch + row.slice(x + 1);
    return true;
}

function normalise(sel) {
    return {
        x0: Math.min(sel.x0, sel.x1), y0: Math.min(sel.y0, sel.y1),
        x1: Math.max(sel.x0, sel.x1), y1: Math.max(sel.y0, sel.y1),
    };
}

// ------------------------------------------------------------------ history

/**
 * Snapshot before every mutation. Levels are small enough that copying the
 * whole grid is far simpler than a diff, and fast enough not to matter. An
 * entry remembers which workspace it belongs to, so undoing a sprite edit
 * from the maps view switches back to show what changed.
 */
function pushUndo(label) {
    state.undo.push({
        label,
        mode: state.mode,
        index: currentIndex(),
        rows: currentLevel().rows.slice(),
    });
    if (state.undo.length > 200) state.undo.shift();
    state.redo.length = 0;
    currentLevel().edited = true;
    refreshChrome();
}

function restore(entry, into) {
    const list = entry.mode === 'sprites' ? state.sprites : state.levels;
    const item = list[entry.index];
    into.push({ label: entry.label, mode: entry.mode, index: entry.index, rows: item.rows.slice() });
    item.rows = entry.rows;
    if (state.mode !== entry.mode) setMode(entry.mode, true);
    setCurrentIndex(entry.index);
    if (entry.mode === 'sprites') syncSpriteToGame(item);
    state.selection = null;
}

function undo() {
    const entry = state.undo.pop();
    if (!entry) return;
    restore(entry, state.redo);
    setStatus(`undo ${entry.label}`);
    fullRefresh();
}

function redo() {
    const entry = state.redo.pop();
    if (!entry) return;
    restore(entry, state.undo);
    setStatus(`redo ${entry.label}`);
    fullRefresh();
}

// ------------------------------------------------------------------ loading

function loadSource(text, fileName) {
    const game = psgame.parseGame(text);
    if (!game.grids.length && !game.blocks.length) {
        setStatus('No levels or objects found in that file', true);
        return false;
    }

    state.source = text;
    state.fileName = fileName || 'game.txt';
    state.game = game;
    state.paletteOverride = null;
    rebuildGlyphs();

    // The level list mirrors the file's own order, including SECTION headings
    // that have no map under them yet. Leaving those out is what made a map
    // labelled with the wrong section number look like a loading bug.
    state.levels = [];
    state.outline = [];
    let index = 0;
    for (const level of game.levels) {
        for (const sec of psgame.emptySections(level.commandsBefore, !!level.grid)) {
            state.outline.push({ kind: 'empty', label: sec.label, afterLine: sec.lastLine });
        }
        if (!level.grid) continue;
        state.levels.push({
            rows: level.grid.rows.slice(),
            name: psgame.labelForCommands(level.commandsBefore) || `Level ${index + 1}`,
            gridIndex: index,
            edited: false,
        });
        state.outline.push({ kind: 'level', index: index });
        index++;
    }
    // Headings trailing the last map own nothing, so all of them are empty.
    const last = game.levels[game.levels.length - 1];
    if (last) {
        for (const sec of psgame.emptySections(last.commandsAfter, false)) {
            state.outline.push({ kind: 'empty', label: sec.label, afterLine: sec.lastLine });
        }
    }

    // One sprite per OBJECTS block - a tagged header such as Roach:directions
    // is one drawing however many objects it defines.
    state.sprites = game.blocks.map(block => ({
        rows: block.sprite ? block.sprite.pixels.map(row => row.map(i => (i === null ? '.' : i.toString(36))).join('')) : [],
        name: block.name,
        block,
        edited: false,
    }));

    state.currentLevel = 0;
    state.currentSprite = 0;
    state.colorsFrom = null;
    state.selection = null;
    state.clipboard = null;
    state.pasteAt = null;
    state.floating = null;
    state.sourceDirty = false;
    state.undo.length = 0;
    state.redo.length = 0;

    el('welcome').classList.add('hidden');
    el('workspace').classList.remove('hidden');
    el('save').disabled = false;

    setMode(game.grids.length ? 'levels' : 'sprites', true);
    buildPalette();
    buildPalettePanel();
    fitZoom();
    fullRefresh();
    canvas.focus();
    // Say what the colours came from, and warn when this build could not honour
    // the game's request - the map would otherwise just look subtly wrong.
    const p = state.resolved;
    const note = p ? ` - palette ${palettes.describePalette(p)}` : '';
    const dialect = game.commentStyle === '//' ? ', PuzzleScript Next dialect' : '';
    setStatus(`${state.levels.length} level(s), ${state.sprites.length} sprite(s) loaded${note}${dialect}`,
        p ? !p.known : false);
    return true;
}

/**
 * Resolve the palette and rebuild the glyph table for the maps view. Called on
 * load, when the sampler picks another palette, and after a sprite edit so the
 * maps redraw with the new art.
 */
function rebuildGlyphs() {
    const game = state.game;
    const spec = state.paletteOverride
        ? { name: state.paletteOverride, overrides: [] }
        : psgame.findPaletteSpec(game);
    state.resolved = palettes.resolvePalette(spec);
    const glyphs = psgame.buildGlyphTable(game, state.resolved.palette);
    state.glyphs = glyphs;
    state.glyphAt = makeGlyphLookup(glyphs, game.caseSensitive);
    state.glyphOrder = Object.keys(glyphs).sort(glyphSortOrder(glyphs));
    state.background = findBackgroundChar(glyphs, game.grids);
    state.underlay = glyphs[state.background] || null;
    if (!(state.ink in glyphs) && !inSprites()) state.ink = state.glyphOrder[0] || '.';
}

/** Mirrors the CLI's case handling so the editor agrees with psmap. */
function makeGlyphLookup(glyphs, caseSensitive) {
    if (caseSensitive) return ch => glyphs[ch];
    const folded = new Map();
    for (const [ch, g] of Object.entries(glyphs)) folded.set(ch.toLowerCase(), g);
    return ch => glyphs[ch] || folded.get(String(ch).toLowerCase());
}

function findBackgroundChar(glyphs, grids) {
    for (const [ch, g] of Object.entries(glyphs)) {
        if (g.objects.some(o => o.toLowerCase() === 'background')) return ch;
    }
    if (glyphs['.']) return '.';
    const counts = new Map();
    for (const grid of grids) {
        for (const row of grid.rows) for (const ch of row) counts.set(ch, (counts.get(ch) || 0) + 1);
    }
    let best = '.', bestN = -1;
    for (const [ch, n] of counts) if (n > bestN) { best = ch; bestN = n; }
    return best;
}

/** Background first, then everything else alphabetically - it is the tile you
 *  reach for most, so it belongs under the 1 key. */
function glyphSortOrder(glyphs) {
    const rank = ch => (glyphs[ch].objects.some(o => o.toLowerCase() === 'background') ? 0 : 1);
    return (a, b) => (rank(a) - rank(b)) || a.localeCompare(b);
}

// ----------------------------------------------------------------- sprites

/**
 * The "tiles" of a sprite: `.` for transparent and one entry per colour in the
 * object's list, drawn as solid squares in the current palette.
 */
function buildSpriteGlyphs(sprite) {
    const glyphs = {};
    if (!sprite) return glyphs;
    const palette = state.resolved ? state.resolved.palette : {};
    glyphs['.'] = { char: '.', label: 'transparent', objects: [], renders: [], transparent: true, color: null };
    previewColors(sprite).forEach((token, i) => {
        const ch = i.toString(36);
        const color = psgame.resolveColor(token, palette, true);
        glyphs[ch] = {
            char: ch,
            label: `${token}${color ? '  ' + color.slice(0, 7).toLowerCase() : ''}`,
            objects: [],
            color: color ? color.slice(0, 7) : null,
            renders: [{ name: token, colors: [color], sprite: null, layer: 0 }],
            transparent: !color,
        };
    });
    return glyphs;
}

function spriteGlyphLookup(ch) { return state.spriteGlyphs[ch]; }

/** The colour list a sprite is drawn in: its own, or the one being previewed. */
function previewColors(sprite) {
    return (state.colorsFrom || sprite.block).colors;
}

/** A `copy:` object: drawn from another sprite, with no pixels of its own. */
function isDerived(sprite) {
    return !!(sprite && sprite.block && sprite.block.copyFrom);
}

/**
 * Refuse an edit to something that cannot be edited here, and say why. A
 * `copy:` object's drawing belongs to its source, so painting it would mean
 * nothing on save.
 */
function guardEditable() {
    const item = currentLevel();
    if (inSprites() && isDerived(item)) {
        setStatus(`"${item.name}" is drawn by copy: ${item.block.copyFrom} - edit ${item.block.copyFrom} instead`, true);
        return false;
    }
    return true;
}

/** Redraw every copy: object from its source, after a source changed. */
function refreshDerived() {
    psgame.resolveCopies(state.game.objects);
    for (const s of state.sprites) {
        if (!isDerived(s)) continue;
        const sp = s.block.sprite;
        s.rows = sp ? sp.pixels.map(row => row.map(i => (i === null ? '.' : i.toString(36))).join('')) : [];
    }
}

function refreshSpriteGlyphs() {
    state.spriteGlyphs = buildSpriteGlyphs(currentLevel());
    state.spriteGlyphOrder = Object.keys(state.spriteGlyphs);
    if (inSprites() && !(state.ink in state.spriteGlyphs)) {
        state.ink = state.spriteGlyphOrder[1] || '.';
    }
}

/**
 * Push an edited sprite's rows back into the parsed game so the maps view and
 * the thumbnails draw the new art straight away. The sprite object is shared by
 * every object the block defines, so it is changed in place.
 */
function syncSpriteToGame(sprite) {
    const matrix = psgame.parseSpriteMatrix(sprite.rows);
    const block = sprite.block;
    if (matrix && block.sprite) {
        block.sprite.width = matrix.width;
        block.sprite.height = matrix.height;
        block.sprite.pixels = matrix.pixels;
    } else {
        block.sprite = matrix;
        for (const obj of state.game.objects.__order || []) {
            if (obj.block === block) obj.sprite = matrix;
        }
    }
    refreshDerived();
    rebuildGlyphs();
}

/** A drawable glyph standing for one OBJECTS block, for the sprite list. */
function blockGlyph(block) {
    const palette = state.resolved ? state.resolved.palette : {};
    return {
        char: block.aliases.find(a => Array.from(a).length === 1) || '',
        label: block.name,
        objects: [block.name],
        renders: [{
            name: block.name,
            colors: block.colors.map(c => psgame.resolveColor(c, palette, true)),
            sprite: block.sprite || null,
            layer: 0,
        }],
    };
}

// -------------------------------------------------------------------- modes

/**
 * Switch workspace. The selection and paste ghost belong to a grid, so they
 * are dropped; the clipboard is kept, because copying a run of sprite pixels
 * into another sprite is exactly what the workspace is for.
 */
function setMode(mode, silent) {
    if (mode === 'sprites' && !state.sprites.length) {
        setStatus('This file has no OBJECTS to edit', true);
        return;
    }
    if (mode === 'levels' && !state.levels.length) {
        setStatus('This file has no LEVELS to edit', true);
        return;
    }
    const changed = state.mode !== mode;
    if (state.floating) cancelFloating();
    state.mode = mode;
    state.selection = null;
    state.pasteAt = null;
    state.drag = null;
    for (const button of document.querySelectorAll('.mode')) {
        button.setAttribute('aria-selected', String(button.dataset.mode === mode));
    }
    // A 5x5 sprite wants far bigger cells than a 30x20 level.
    const slider = el('zoom');
    slider.max = inSprites() ? '128' : '48';
    slider.step = inSprites() ? '4' : '2';

    el('tilesTitle').textContent = inSprites() ? 'Colours' : 'Tiles';
    el('listTitle').textContent = inSprites() ? 'Sprites' : 'Levels';
    el('listHint').textContent = inSprites()
        ? 'Every OBJECTS block, in file order. Edits show up in the maps at once, and save splices only the changed rows.'
        : 'Copy a rectangle in one level, switch to another, paste. The clipboard follows you.';
    el('copylevel').textContent = inSprites() ? 'Copy sprite as text' : 'Copy level as text';

    el('spriteTools').classList.toggle('hidden', !inSprites());
    refreshListActions();
    if (inSprites()) { refreshSpriteGlyphs(); buildSpriteTools(); }
    else if (!(state.ink in state.glyphs)) state.ink = state.glyphOrder[0] || '.';

    if (!silent) {
        buildPalette();
        state.zoomPinned = false;
        fitZoom();
        fullRefresh();
        canvas.focus();
        if (changed) setStatus(inSprites()
            ? 'Sprites: paint with colour indices. Every sprite must stay '
              + `${state.game.spriteSize}×${state.game.spriteSize} (sprite_size).`
            : 'Maps: paint with the game\'s tiles.');
    }
}

// ------------------------------------------------------------------ palette

function buildPalette() {
    const host = el('palette');
    host.innerHTML = '';
    const glyphs = glyphTable();
    const order = glyphOrder();
    const thumbOptions = inSprites() ? { checker: true } : { underlay: state.underlay };
    order.forEach((ch) => {
        const glyph = glyphs[ch];
        const button = document.createElement('button');
        button.className = 'swatch';
        button.setAttribute('aria-pressed', String(ch === state.ink));
        button.dataset.char = ch;
        button.title = `${ch} = ${glyph.label}`;

        button.appendChild(render.glyphThumbnail(glyph, 22, thumbOptions));

        const key = document.createElement('span');
        key.className = 'key';
        key.textContent = ch;
        button.appendChild(key);

        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = glyph.label;
        button.appendChild(name);

        button.addEventListener('click', () => setInk(ch));
        host.appendChild(button);
    });

    const shortcuts = Math.min(10, order.length);
    el('paletteHint').textContent = shortcuts
        ? `Keys 1-${shortcuts === 10 ? '0' : shortcuts} pick the first ${shortcuts}. I picks up whatever is under the cursor. Right-click erases.`
        : '';
    markUsedSlots();
}

function setInk(ch) {
    state.ink = ch;
    for (const button of document.querySelectorAll('.swatch')) {
        button.setAttribute('aria-pressed', String(button.dataset.char === ch));
    }
}

// ---------------------------------------------------------- palette sampler

/**
 * The sampler: a list of every palette this build carries, plus the 21 slots of
 * whichever is showing. Choosing one re-resolves every colour name in the game
 * and redraws; the source is never touched, and the prelude line you would
 * need to adopt it is one click away.
 */
function buildPalettePanel() {
    const select = el('paletteSelect');
    select.innerHTML = '';
    const own = state.game ? psgame.findPaletteSpec(state.game) : { name: 'arnecolors', overrides: [] };
    const ownOption = document.createElement('option');
    ownOption.value = '';
    ownOption.textContent = `game's own (${own.name}${own.overrides.length ? ' + overrides' : ''})`;
    select.appendChild(ownOption);
    for (const { index, name } of palettes.paletteList()) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = (index !== null ? `${index}  ` : '') + name;
        select.appendChild(option);
    }
    select.value = state.paletteOverride || '';
    renderSlots();
}

function renderSlots() {
    const host = el('slots');
    host.innerHTML = '';
    if (!state.resolved) return;
    const palette = state.resolved.palette;
    for (const slot of palettes.PALETTE_SLOTS) {
        const hex = palette[slot];
        const button = document.createElement('button');
        button.className = 'slot';
        button.dataset.slot = slot;
        button.style.background = hex || 'transparent';
        button.title = `${slot}  ${(hex || '').toLowerCase()}\nclick to copy the hex`;
        button.addEventListener('click', () => copyText(hex, `${slot} ${hex.toLowerCase()} copied`));
        host.appendChild(button);
    }
    markUsedSlots();

    const shown = state.paletteOverride
        ? `Previewing ${state.resolved.resolved}. Nothing in the file has changed.`
        : `The game's own palette: ${palettes.describePalette(state.resolved)}.`;
    el('paletteNote').textContent = shown + ' Outlined slots are the ones this game\'s objects use.';
}

/** Outline the slots the game actually names, so a palette's fit is visible. */
function markUsedSlots() {
    if (!state.game) return;
    const used = new Set();
    for (const block of state.game.blocks) {
        for (const c of block.colors) used.add(c.toLowerCase().replace('gray', 'grey'));
    }
    for (const button of document.querySelectorAll('.slot')) {
        button.classList.toggle('used', used.has(button.dataset.slot));
    }
}

function applyPalette(name) {
    state.paletteOverride = name || null;
    rebuildGlyphs();
    if (inSprites()) refreshSpriteGlyphs();
    buildPalette();
    renderSlots();
    fullRefresh();
    setStatus(name
        ? `Previewing "${name}" - the file is unchanged. "Copy prelude line" gives you the line to adopt it.`
        : 'Back to the game\'s own palette.');
}

/** The palette name the sampler is showing, whichever way it was chosen. */
function shownPaletteName() {
    return state.resolved ? state.resolved.resolved : 'arnecolors';
}

// ------------------------------------------------------------------- levels

function buildLevelList() {
    const host = el('levels');
    host.innerHTML = '';
    if (inSprites()) { buildSpriteList(host); return; }

    for (const row of state.outline) {
        if (row.kind === 'empty') {
            // A SECTION with no map yet. Clicking gives it one.
            const item = document.createElement('button');
            item.className = 'level-item empty';
            item.innerHTML =
                '<span class="lv-name"></span><span class="lv-meta">+ add map</span>';
            item.querySelector('.lv-name').textContent = row.label;
            item.title = `Section "${row.label}" has no map yet - click to create one`;
            item.addEventListener('click', () => addMapToSection(row));
            host.appendChild(item);
            continue;
        }

        const i = row.index;
        const level = state.levels[i];
        const size = levelSize(level);
        const button = document.createElement('button');
        button.className = 'level-item' + (level.edited ? ' edited' : '');
        button.setAttribute('aria-pressed', String(i === state.currentLevel));
        button.innerHTML =
            `<span class="lv-name"></span><span class="lv-meta">${size.w}×${size.h}</span>`;
        button.querySelector('.lv-name').textContent = level.name;
        button.addEventListener('click', () => selectLevel(i));
        host.appendChild(button);
    }
}

function buildSpriteList(host) {
    state.sprites.forEach((sprite, i) => {
        const block = sprite.block;
        const size = sprite.rows.length ? levelSize(sprite) : null;
        const button = document.createElement('button');
        button.className = 'level-item sprite-item' + (sprite.edited ? ' edited' : '');
        button.setAttribute('aria-pressed', String(i === state.currentSprite));
        button.appendChild(render.glyphThumbnail(blockGlyph(block), 22, { checker: true }));
        const text = document.createElement('span');
        text.className = 'lv-text';
        text.innerHTML = '<span class="lv-name"></span><span class="lv-meta"></span>';
        text.querySelector('.lv-name').textContent = block.name
            + (block.aliases.length ? '  ' + block.aliases.join(' ') : '');
        text.querySelector('.lv-meta').textContent = isDerived(sprite)
            ? `copy: ${block.copyFrom}${block.transforms.length ? ' ' + tf.formatTransforms(block.transforms) : ''}`
            : size
            ? `${size.w}×${size.h}  ${block.colors.length} colour${block.colors.length === 1 ? '' : 's'}`
            : (block.colors.some(c => c.toLowerCase() !== 'transparent') ? 'solid - click to draw one' : 'invisible');
        button.appendChild(text);
        button.title = `${block.name}: ${block.colors.join(' ')}`;
        button.addEventListener('click', () => selectLevel(i));
        host.appendChild(button);
    });
}

/**
 * Give an empty SECTION a map.
 *
 * The new grid is background-filled at the same size as the level you were last
 * looking at, which is nearly always the right starting point and is trivially
 * resized from the row/column buttons. Nothing is written to disk until you
 * save; the grid is spliced in directly beneath that section's own commands.
 */
function addMapToSection(row) {
    const reference = state.levels[state.currentLevel];
    const size = reference ? levelSize(reference) : { w: 9, h: 7 };
    const w = Math.max(1, size.w);
    const h = Math.max(1, size.h);
    const rows = [];
    for (let y = 0; y < h; y++) rows.push(state.background.repeat(w));

    const index = state.levels.length;
    state.levels.push({
        rows: rows,
        name: row.label,
        gridIndex: null,          // no grid in the original file
        insertAfterLine: row.afterLine,
        isNew: true,
        edited: true,
    });

    // The placeholder becomes a real level, keeping its place in the list.
    row.kind = 'level';
    row.index = index;

    state.currentLevel = index;
    state.selection = null;
    state.pasteAt = null;
    state.undo.length = 0;
    state.redo.length = 0;

    fitZoom();
    fullRefresh();
    canvas.focus();
    setStatus(`Added a ${w}×${h} map to section "${row.label}" - resize or paste into it`);
}

/**
 * Give a sprite-less object a matrix, sprite_size square and transparent, so
 * it can be drawn. Saved as an insertion just under the colours.
 */
function addMatrixToSprite(sprite) {
    const n = Math.max(1, state.game.spriteSize || 5);
    sprite.rows = [];
    for (let y = 0; y < n; y++) sprite.rows.push('.'.repeat(n));
    sprite.edited = true;
    sprite.isNew = true;
    syncSpriteToGame(sprite);
    setStatus(`Gave "${sprite.name}" a ${n}×${n} matrix - it was a solid square before`);
}

function selectLevel(i) {
    const list = currentList();
    if (i < 0 || i >= list.length) return;
    const same = i === currentIndex();
    if (state.floating) cancelFloating();
    setCurrentIndex(i);
    state.selection = null;
    state.pasteAt = null;
    if (inSprites()) {
        if (!list[i].rows.length && !isDerived(list[i])) addMatrixToSprite(list[i]);
        refreshSpriteGlyphs();
        buildPalette();
        buildSpriteTools();
        if (isDerived(list[i])) describeDerived(list[i]);
    } else if (same) {
        return;
    }
    fitZoom();
    fullRefresh();
    canvas.focus();
}

// ----------------------------------------------------------------- drawing

function fullRefresh() {
    buildLevelList();
    refreshChrome();
    draw();
}

/**
 * Pick a cell size that makes the level fill the available space.
 *
 * A 5x5 level and a 60x40 level should both arrive on screen at a comfortable
 * size, rather than as a postage stamp or something you have to scroll around.
 */
function fitZoom() {
    const level = currentLevel();
    if (!level) return;
    const { w, h } = levelSize(level);
    if (!w || !h) return;

    const wrap = document.querySelector('.canvas-wrap');
    const padding = 56;            // matches the wrap's padding, plus breathing room
    const availableW = Math.max(80, wrap.clientWidth - padding);
    const availableH = Math.max(80, wrap.clientHeight - padding);

    const slider = el('zoom');
    const min = Number(slider.min), max = Number(slider.max), step = Number(slider.step);
    const ideal = Math.min(availableW / w, availableH / h);
    const snapped = Math.round(ideal / step) * step;

    state.cell = clamp(snapped, min, max);
    slider.value = String(state.cell);
}

function refreshChrome() {
    const level = currentLevel();
    if (!level) return;
    const size = levelSize(level);
    el('levelTitle').textContent = !inSprites() ? level.name
        : isDerived(level)
        ? `${level.name}  ·  copy: ${level.block.copyFrom} ${tf.formatTransforms(level.block.transforms)}  ·  read-only`
        : `${level.name}  ·  ${previewColors(level).join(' ')}`;
    const expected = state.game ? state.game.spriteSize : 5;
    const off = inSprites() && (size.w !== expected || size.h !== expected);
    el('sizeBadge').textContent = `${size.w} × ${size.h}` + (off ? `  (sprite_size is ${expected})` : '');
    el('sizeBadge').classList.toggle('warn', off);
    el('undo').disabled = !state.undo.length;
    el('redo').disabled = !state.redo.length;
    for (const button of document.querySelectorAll('.tool')) {
        button.setAttribute('aria-pressed', String(button.dataset.tool === state.tool));
    }
    const row = el('levels').querySelector('.level-item[aria-pressed="true"]');
    if (row) row.classList.toggle('edited', !!level.edited);
}

function drawOptions() {
    return inSprites() ? { checker: true } : { underlay: state.underlay };
}

function draw() {
    const level = currentLevel();
    if (!level) return;
    const { w, h } = levelSize(level);
    const cell = state.cell;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.max(1, w * cell * dpr);
    canvas.height = Math.max(1, h * cell * dpr);
    canvas.style.width = (w * cell) + 'px';
    canvas.style.height = (h * cell) + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w * cell, h * cell);
    render.drawGrid(ctx, level.rows, glyphLookup(), cell, drawOptions());

    drawOverlay(cell, w, h);
}

function drawOverlay(cell, w, h) {
    // Grid lines, subtle, only when the cells are big enough to read.
    if (cell >= 14) {
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 1; x < w; x++) { ctx.moveTo(x * cell + 0.5, 0); ctx.lineTo(x * cell + 0.5, h * cell); }
        for (let y = 1; y < h; y++) { ctx.moveTo(0, y * cell + 0.5); ctx.lineTo(w * cell, y * cell + 0.5); }
        ctx.stroke();
    }

    // The shape being dragged out right now, previewed before it is committed.
    if (state.drag && state.drag.preview) {
        const sel = normalise(state.drag.preview);
        outline(sel, cell, '#6ea8fe', [4, 3]);
    }

    if (state.selection) {
        const sel = state.selection;
        ctx.fillStyle = 'rgba(110,168,254,0.14)';
        ctx.fillRect(sel.x0 * cell, sel.y0 * cell,
            (sel.x1 - sel.x0 + 1) * cell, (sel.y1 - sel.y0 + 1) * cell);
        outline(sel, cell, '#6ea8fe', [5, 3]);
    }

    // The paste ghost: what will land, and exactly where.
    if (state.pasteAt && state.clipboard) {
        const clip = state.clipboard;
        const { x, y } = state.pasteAt;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, w * cell, h * cell);
        ctx.clip();
        render.drawGrid(ctx, clip.rows, glyphLookup(), cell,
            Object.assign({ offsetX: x * cell, offsetY: y * cell, alpha: 0.75 }, drawOptions()));
        ctx.restore();
        outline({ x0: x, y0: y, x1: x + clip.w - 1, y1: y + clip.h - 1 }, cell, '#7ee787', [4, 3]);
    }

    if (state.hover && !state.pasteAt) {
        outline({ x0: state.hover.x, y0: state.hover.y, x1: state.hover.x, y1: state.hover.y },
            cell, 'rgba(255,255,255,0.55)', null);
    }

    // With Shift held, the two lines Shift+H and Shift+V would mirror across,
    // snapped to a cell's centre or edge, whichever the cursor is nearer.
    if (state.axisHint && state.hoverFine) {
        const ax = Math.round(state.hoverFine.x * 2) / 2 * cell;
        const ay = Math.round(state.hoverFine.y * 2) / 2 * cell;
        ctx.save();
        ctx.strokeStyle = '#ffb454';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(ax, 0); ctx.lineTo(ax, h * cell);
        ctx.moveTo(0, ay); ctx.lineTo(w * cell, ay);
        ctx.stroke();
        ctx.restore();
    }
}

function outline(sel, cell, color, dash) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    if (dash) ctx.setLineDash(dash);
    ctx.strokeRect(
        sel.x0 * cell + 1, sel.y0 * cell + 1,
        (sel.x1 - sel.x0 + 1) * cell - 2, (sel.y1 - sel.y0 + 1) * cell - 2);
    ctx.restore();
}

let statusTimer = null;
function setStatus(text, warn) {
    const node = el('status');
    node.textContent = text;
    node.classList.toggle('warn', !!warn);
    clearTimeout(statusTimer);
    if (text) statusTimer = setTimeout(() => { node.textContent = ''; }, 6000);
}

/** After any change to the grid being edited. */
function afterEdit() {
    if (inSprites()) syncSpriteToGame(currentLevel());
}

// ------------------------------------------------------------------- tools

function cellFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: Math.floor((event.clientX - rect.left) / state.cell),
        y: Math.floor((event.clientY - rect.top) / state.cell),
    };
}

function inBounds(level, x, y) {
    const row = level.rows[y];
    return row !== undefined && x >= 0 && x < row.length;
}

canvas.addEventListener('mousedown', (event) => {
    const level = currentLevel();
    if (!level) return;
    const point = cellFromEvent(event);
    canvas.focus();

    // Pasting takes precedence over every tool: click to commit.
    if (state.pasteAt && state.clipboard) {
        if (guardEditable()) commitPaste(state.pasteAt.x, state.pasteAt.y);
        return;
    }
    if (!inBounds(level, point.x, point.y)) return;
    if (['brush', 'rect', 'line', 'fill'].includes(state.tool) && !guardEditable()) return;

    // Right-click always paints the background, whatever the tool.
    const erase = event.button === 2;

    switch (state.tool) {
        case 'select':
            state.drag = { kind: 'select', from: point, preview: { x0: point.x, y0: point.y, x1: point.x, y1: point.y } };
            state.selection = null;
            break;
        case 'brush':
            pushUndo('paint');
            state.drag = { kind: 'brush', erase, painted: true };
            setCell(level, point.x, point.y, erase ? eraseChar() : state.ink);
            afterEdit();
            break;
        case 'rect':
        case 'line':
            state.drag = { kind: state.tool, from: point, erase, preview: { x0: point.x, y0: point.y, x1: point.x, y1: point.y } };
            break;
        case 'fill':
            pushUndo('fill');
            floodFill(level, point.x, point.y, erase ? eraseChar() : state.ink);
            afterEdit();
            break;
        case 'pick': {
            const ch = getCell(level, point.x, point.y);
            if (ch !== undefined) { setInk(ch); setStatus(`picked "${ch}"`); }
            break;
        }
    }
    draw();
});

canvas.addEventListener('mousemove', (event) => {
    const level = currentLevel();
    if (!level) return;
    const point = cellFromEvent(event);
    state.hover = inBounds(level, point.x, point.y) ? point : null;
    const rect = canvas.getBoundingClientRect();
    state.hoverFine = state.hover
        ? { x: (event.clientX - rect.left) / state.cell, y: (event.clientY - rect.top) / state.cell }
        : null;

    if (state.hover) {
        const ch = getCell(level, point.x, point.y);
        const glyph = glyphLookup()(ch);
        el('cursor').textContent = `${point.x}, ${point.y}  "${ch}"` + (glyph ? `  ${glyph.label}` : '  (unknown)');
    } else {
        el('cursor').textContent = '';
    }

    if (state.pasteAt && state.clipboard) {
        state.pasteAt = { x: point.x, y: point.y };
        draw();
        return;
    }

    if (state.drag) {
        if (state.drag.kind === 'brush') {
            if (inBounds(level, point.x, point.y)) {
                if (setCell(level, point.x, point.y, state.drag.erase ? eraseChar() : state.ink)) afterEdit();
            }
        } else if (state.drag.preview) {
            state.drag.preview = { x0: state.drag.from.x, y0: state.drag.from.y, x1: point.x, y1: point.y };
            const sel = normalise(state.drag.preview);
            el('selInfo').textContent = `${sel.x1 - sel.x0 + 1} × ${sel.y1 - sel.y0 + 1}`;
        }
    }
    draw();
});

window.addEventListener('mouseup', () => {
    const level = currentLevel();
    const drag = state.drag;
    state.drag = null;
    if (!drag || !level) { draw(); return; }

    if (drag.kind === 'select' && drag.preview) {
        const sel = normalise(drag.preview);
        const size = levelSize(level);
        state.selection = {
            x0: clamp(sel.x0, 0, size.w - 1), y0: clamp(sel.y0, 0, size.h - 1),
            x1: clamp(sel.x1, 0, size.w - 1), y1: clamp(sel.y1, 0, size.h - 1),
        };
        el('selInfo').textContent =
            `${state.selection.x1 - state.selection.x0 + 1} × ${state.selection.y1 - state.selection.y0 + 1} selected`;
    } else if (drag.kind === 'rect' && drag.preview) {
        pushUndo('rectangle');
        const sel = normalise(drag.preview);
        const ch = drag.erase ? eraseChar() : state.ink;
        for (let y = sel.y0; y <= sel.y1; y++) {
            for (let x = sel.x0; x <= sel.x1; x++) setCell(level, x, y, ch);
        }
        afterEdit();
    } else if (drag.kind === 'line' && drag.preview) {
        pushUndo('line');
        const ch = drag.erase ? eraseChar() : state.ink;
        drawLine(level, drag.preview.x0, drag.preview.y0, drag.preview.x1, drag.preview.y1, ch);
        afterEdit();
    }
    if (drag.kind === 'brush') afterEdit();
    fullRefresh();
});

canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mouseleave', () => { state.hover = null; state.hoverFine = null; el('cursor').textContent = ''; draw(); });

function drawLine(level, x0, y0, x1, y1, ch) {
    // Bresenham, so diagonal walls come out as clean single-tile runs.
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
        setCell(level, x0, y0, ch);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}

function floodFill(level, x, y, ch) {
    const target = getCell(level, x, y);
    if (target === undefined || target === ch) return;
    const stack = [[x, y]];
    const seen = new Set();
    while (stack.length) {
        const [cx, cy] = stack.pop();
        const key = cy * 4096 + cx;
        if (seen.has(key)) continue;
        seen.add(key);
        if (getCell(level, cx, cy) !== target) continue;
        setCell(level, cx, cy, ch);
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
}

// --------------------------------------------------------------- clipboard

function copySelection(cut) {
    const level = currentLevel();
    const sel = state.selection;
    if (!sel) { setStatus('Select a rectangle first', true); return; }
    if (cut && !guardEditable()) return;

    const rows = [];
    for (let y = sel.y0; y <= sel.y1; y++) {
        let row = '';
        for (let x = sel.x0; x <= sel.x1; x++) {
            const ch = getCell(level, x, y);
            row += ch === undefined ? eraseChar() : ch;
        }
        rows.push(row);
    }
    state.clipboard = { w: sel.x1 - sel.x0 + 1, h: sel.y1 - sel.y0 + 1, rows };

    if (cut) {
        pushUndo('cut');
        for (let y = sel.y0; y <= sel.y1; y++) {
            for (let x = sel.x0; x <= sel.x1; x++) setCell(level, x, y, eraseChar());
        }
        afterEdit();
    }
    setStatus(`${cut ? 'cut' : 'copied'} ${state.clipboard.w}×${state.clipboard.h}`);
    draw();
}

/**
 * Begin a paste. Nothing is written yet - a ghost follows the cursor so you can
 * see exactly which cells will be overwritten, and a click commits it.
 */
function beginPaste() {
    if (!state.clipboard) { setStatus('Nothing copied yet', true); return; }
    const anchor = state.selection
        ? { x: state.selection.x0, y: state.selection.y0 }
        : (state.hover || { x: 0, y: 0 });
    state.pasteAt = { x: anchor.x, y: anchor.y };
    setStatus('Click to place, Escape to cancel');
    draw();
}

/**
 * Stamp the clipboard at (ox, oy), overwriting in place. Cells that fall
 * outside the level are dropped rather than growing it, so a paste can never
 * silently change the level's dimensions.
 */
function commitPaste(ox, oy) {
    const level = currentLevel();
    const clip = state.clipboard;
    pushUndo('paste');

    let placed = 0, clipped = 0;
    for (let y = 0; y < clip.h; y++) {
        for (let x = 0; x < clip.w; x++) {
            const tx = ox + x, ty = oy + y;
            if (!inBounds(level, tx, ty)) { clipped++; continue; }
            setCell(level, tx, ty, clip.rows[y][x]);
            placed++;
        }
    }
    afterEdit();

    state.pasteAt = null;
    state.selection = { x0: ox, y0: oy, x1: ox + clip.w - 1, y1: oy + clip.h - 1 };
    if (state.floating) {
        // A turned selection has landed: give back whatever was on the clipboard.
        state.clipboard = state.floating.clipboard;
        state.floating = null;
    }
    setStatus(clipped
        ? `pasted ${placed} tiles, ${clipped} fell outside the level`
        : `pasted ${clip.w}×${clip.h}`, clipped > 0);
    fullRefresh();
}

function clearSelection() {
    const level = currentLevel();
    const sel = state.selection;
    if (!sel || !guardEditable()) return;
    pushUndo('clear');
    for (let y = sel.y0; y <= sel.y1; y++) {
        for (let x = sel.x0; x <= sel.x1; x++) setCell(level, x, y, eraseChar());
    }
    afterEdit();
    fullRefresh();
}

// --------------------------------------------------------------- transforms

const XF_LABELS = {
    flipH: 'mirror left-right', flipV: 'mirror top-bottom',
    rotCW: 'turn clockwise', rotCCW: 'turn anticlockwise',
    transpose: 'mirror across \\', antiTranspose: 'mirror across /',
};

/** The cells of a selection as rows; anything past a ragged row's end reads as erase. */
function regionRows(level, sel) {
    const rows = [];
    for (let y = sel.y0; y <= sel.y1; y++) {
        let row = '';
        for (let x = sel.x0; x <= sel.x1; x++) {
            const ch = getCell(level, x, y);
            row += ch === undefined ? eraseChar() : ch;
        }
        rows.push(row);
    }
    return rows;
}

function writeRegion(level, sel, rows) {
    for (let y = 0; y < rows.length; y++) {
        for (let x = 0; x < rows[y].length; x++) setCell(level, sel.x0 + x, sel.y0 + y, rows[y][x]);
    }
}

/**
 * Apply a grid transform to whatever is in hand, in this order:
 *   - the paste ghost, while one is showing - so a stamp can be turned before
 *     it is placed, and nothing is written until it is;
 *   - the selection, in place. A quarter turn or a diagonal mirror of a
 *     non-square selection cannot fit back where it was, so it is lifted out
 *     and left floating as a paste: click to place, Escape to put it back;
 *   - otherwise the whole grid. A ragged level is padded first, since a
 *     mirror of rows of different lengths has no single answer.
 */
function transformGrid(label, fn) {
    const level = currentLevel();
    if (!level || !guardEditable()) return;

    if (state.pasteAt && state.clipboard) {
        const rows = fn(state.clipboard.rows);
        state.clipboard = { w: rows.length ? rows[0].length : 0, h: rows.length, rows };
        setStatus(`${label}: the paste`);
        draw();
        return;
    }

    const sel = state.selection;
    if (!sel) {
        const ragged = new Set(level.rows.map(r => r.length)).size > 1;
        pushUndo(label);
        level.rows = fn(tf.pad(level.rows, eraseChar()));
        afterEdit();
        state.selection = null;
        fullRefresh();
        setStatus(label + (ragged ? `: the ragged rows were padded with "${eraseChar()}" first` : ''), ragged);
        return;
    }

    const region = regionRows(level, sel);
    const out = fn(region);
    if (out.length !== region.length || (out[0] || '').length !== region[0].length) {
        pushUndo(label);
        writeRegion(level, sel, region.map(r => eraseChar().repeat(r.length)));
        afterEdit();
        state.floating = { clipboard: state.clipboard };
        state.clipboard = { w: out[0].length, h: out.length, rows: out };
        state.pasteAt = { x: sel.x0, y: sel.y0 };
        state.selection = null;
        fullRefresh();
        setStatus(`${label}: the shape changed, so it is floating - click to place it, Escape puts it back`);
        return;
    }
    pushUndo(label);
    writeRegion(level, sel, out);
    afterEdit();
    fullRefresh();
    setStatus(`${label}: the selection`);
}

function applyOp(op) {
    transformGrid(XF_LABELS[op], tf.OPERATIONS[op]);
}

/** Shift on a torus: what leaves one edge comes back at the other. */
function wrapShift(dx, dy) {
    const arrow = dx < 0 ? '←' : dx > 0 ? '→' : dy < 0 ? '↑' : '↓';
    transformGrid(`wrap ${arrow}`, rows => tf.shift(rows, dx, dy));
}

/**
 * Mirror across the line under the cursor rather than the centre. The line
 * snaps to a cell's centre or its edge, whichever is nearer (hold Shift to
 * see it), and the mirror image wraps round where it would fall off.
 */
function flipAcrossCursor(direction) {
    const f = state.hoverFine;
    if (!f) {
        setStatus('Point at where the mirror line should go, then press Shift+H or Shift+V', true);
        return;
    }
    const origin = state.pasteAt ? state.pasteAt
        : state.selection ? { x: state.selection.x0, y: state.selection.y0 }
        : { x: 0, y: 0 };
    const vertical = direction === 'vertical';
    const axis2 = Math.round((vertical ? f.x : f.y) * 2) - 2 * (vertical ? origin.x : origin.y);
    const where = (axis2 % 2 ? `the middle of ${vertical ? 'column' : 'row'} ` : `the edge before ${vertical ? 'column' : 'row'} `)
        + Math.ceil(axis2 / 2);
    transformGrid(`${vertical ? 'mirror left-right' : 'mirror top-bottom'} across ${where}`,
        rows => tf.flipAcross(rows, direction, axis2));
}

/** Put a lifted selection back as it was, and the clipboard with it. */
function cancelFloating() {
    const floating = state.floating;
    state.floating = null;
    state.pasteAt = null;
    state.clipboard = floating.clipboard;
    undo();
}

// ------------------------------------------------------- sprite: colours, copy:

/**
 * The "Colours of" picker: draw the sprite you are on with another object's
 * colour list. That is what `copy:` is for - one drawing, several colourings -
 * so this shows what a copy would look like before it exists. The file is not
 * touched, and painting still writes colour indices, which mean the same thing
 * in either list.
 */
function buildSpriteTools() {
    const select = el('colorsFrom');
    const sprite = currentLevel();
    if (!sprite || !sprite.block) return;
    select.innerHTML = '';
    const own = document.createElement('option');
    own.value = '';
    own.textContent = 'its own';
    select.appendChild(own);
    state.game.blocks.forEach((block, i) => {
        if (block === sprite.block || !block.colors.length) return;
        const option = document.createElement('option');
        option.value = String(i);
        option.textContent = `${block.name}: ${block.colors.join(' ')}`;
        select.appendChild(option);
    });
    const index = state.colorsFrom ? state.game.blocks.indexOf(state.colorsFrom) : -1;
    select.value = index >= 0 && state.colorsFrom !== sprite.block ? String(index) : '';
    describeColors();
}

/** Say what the preview means, and which pixels the borrowed list cannot colour. */
function describeColors() {
    const sprite = currentLevel();
    const note = el('colorsNote');
    if (!state.colorsFrom || !sprite || state.colorsFrom === sprite.block) {
        note.textContent = 'Preview this drawing in another object\'s colours, as a copy: object would draw it.';
        return;
    }
    const n = state.colorsFrom.colors.length;
    let missing = 0;
    for (const row of sprite.rows) for (const ch of row) if (ch !== '.' && parseInt(ch, 36) >= n) missing++;
    note.textContent = `Showing ${sprite.name} in ${state.colorsFrom.name}'s colours. Nothing in the file has changed.`
        + (missing ? ` ${missing} pixel(s) use a colour index ${state.colorsFrom.name} does not have.` : '');
}

function setColorsFrom(value) {
    state.colorsFrom = value === '' ? null : state.game.blocks[Number(value)];
    el('colorsFrom').value = value;
    refreshSpriteGlyphs();
    buildPalette();
    describeColors();
    refreshChrome();
    draw();
}

/** Tell someone opening a copy: object where its drawing actually lives. */
function describeDerived(sprite) {
    const d = sprite.block.derived || {};
    const parts = [`"${sprite.name}" is copy: ${sprite.block.copyFrom}`];
    if (!d.found) parts.push(d.cycle ? 'which copies back to itself' : 'which this file does not define');
    else if (!sprite.rows.length) parts.push('whose source has no drawing of its own');
    if (d.ignored && d.ignored.length) parts.push(`not previewed: ${d.ignored.map(i => i.token).join(' ')}`);
    setStatus(parts.join(' - ') + '. Read-only here: edit the source.', !d.found || (d.ignored && d.ignored.length));
}

function uniqueObjectName(base) {
    const taken = name => !!state.game.objects[name.toLowerCase()];
    if (!taken(base)) return base;
    for (let n = 2; ; n++) if (!taken(base + n)) return base + n;
}

function openCopyForm() {
    const sprite = currentLevel();
    if (!inSprites() || !sprite) return;
    el('copyName').value = uniqueObjectName(sprite.name.replace(/[^\p{L}\p{N}_$:]/gu, '') + 'Copy');
    el('copyColors').value = previewColors(sprite).join(' ');
    el('copyTransform').value = '';
    el('copyForm').classList.remove('hidden');
    el('copyName').focus();
    el('copyName').select();
}

/** The collision-layer line that names `name`, so a new object can join it. */
function findLayerLine(names) {
    const section = state.game.sections.find(s => s.name === 'collisionlayers');
    if (!section) return null;
    // A layer may name the object, or a tag class or property that includes
    // it (`GridLines:directions`), so expand each name the way the legend does.
    const wanted = new Set(names.map(n => n.toLowerCase()));
    const covers = tok => wanted.has(tok.toLowerCase())
        || psgame.resolveNames(state.game, tok).some(n => wanted.has(n.toLowerCase()));
    for (let i = section.start; i < section.end; i++) {
        const code = state.game.stripped[i].code;
        if (code.trim().split(/[\s,]+/).filter(Boolean).some(covers)) {
            const raw = state.game.lines[i];
            const end = raw.indexOf(code.trim()) + code.trim().length;
            return { line: i, text: raw.slice(0, end) + ', %NAME%' + raw.slice(end) };
        }
    }
    return null;
}

/**
 * Add a `copy:` object after the one being shown: a name, its own colours,
 * and a transform line `copy:Source flip:right`. It joins its source's
 * collision layer, because the engine refuses an object in none.
 *
 * The source is rewritten and reloaded rather than patched in place, since a
 * new object shifts every line below it. Pending edits are written in first,
 * so nothing is lost - but undo starts again from here.
 */
function addCopyObject(name, transformText, colorsText) {
    const sprite = currentLevel();
    const block = sprite.block;
    name = name.trim();
    if (!/^[\p{L}\p{N}_$]+(:[\p{L}\p{N}_$]+)*$/u.test(name)) {
        setStatus('An object name is letters, digits, _ and $, with : between tag parts', true);
        return false;
    }
    if (state.game.objects[name.toLowerCase()]) {
        setStatus(`There is already an object called "${name}"`, true);
        return false;
    }
    const colors = colorsText.trim().split(/\s+/).filter(Boolean);
    if (!colors.length) { setStatus('A copy: object needs at least one colour', true); return false; }

    const edits = collectEdits();
    const line = ['copy:' + block.name, transformText].filter(Boolean).join(' ');
    edits.push({ startLine: block.lastLine + 1, lineCount: 0, rows: ['', name, colors.join(' '), line] });
    const layer = findLayerLine(block.names || [block.name]);
    if (layer) edits.push({ startLine: layer.line, lineCount: 1, rows: [layer.text.replace('%NAME%', name)] });

    if (!rewriteSource(psgame.applyGridEdits(state.game, edits), 'sprites')) return false;
    const index = state.sprites.findIndex(s => s.name === name);
    if (index >= 0) selectLevel(index);
    setStatus(`Added ${name} (${line})` + (layer ? ` to ${block.name}'s collision layer` : ' - add it to a collision layer yourself')
        + '. Give it a legend glyph to use it in a map. Undo history starts again here.', !layer);
    return true;
}

// ------------------------------------------------- adding and removing things
//
// New and deleted levels and objects shift every line below them, so each one
// writes pending edits into the text, makes its change there, and reloads -
// as New copy: does. Nothing reaches disk until Download. Undo starts again.

/** Reload from rewritten text, keeping the file name and the sampled palette. */
function rewriteSource(text, mode) {
    const keep = { palette: state.paletteOverride, fileName: state.fileName };
    if (!loadSource(text, keep.fileName)) return false;
    state.sourceDirty = true;
    if (keep.palette) applyPalette(keep.palette);
    setMode(mode);
    return true;
}

/** The game as it would be saved, with every pending edit written in. */
function savedGame() {
    return psgame.parseGame(buildOutput());
}

/** The current level's position in the file, which is its grid index once saved. */
function currentGridInFile() {
    return state.outline.filter(r => r.kind === 'level').findIndex(r => r.index === state.currentLevel);
}

/** Show what stops a delete, one line each, where it can be copied. */
function listReferences(references, label) {
    const where = references.map(r => `${r.section.toUpperCase()} line ${r.line + 1}: ${r.text}`).join('\n');
    showText(where, label + ' (line numbers as the file would be saved):');
}

function newLevel(duplicate) {
    const level = currentLevel();
    if (inSprites() || !level) return false;
    const { w, h } = levelSize(level);
    const rows = duplicate ? level.rows.slice()
        : Array.from({ length: Math.max(1, h) }, () => state.background.repeat(Math.max(1, w)));
    const at = currentGridInFile();
    const game = savedGame();
    // A new level renumbers the unnamed `Level N` after it.
    const usage = psgame.levelUsage(game, { insertAfter: at });
    if (usage.references.length) {
        listReferences(usage.references, `A level here would send ${usage.references.length} link(s) to a different level.`
            + ' Give the levels they point at a LEVEL heading first');
        setStatus('Not added: it would renumber a link target - see the list', true);
        return false;
    }
    let text;
    try { text = psgame.insertLevel(game, at, rows); } catch (e) { setStatus(e.message, true); return false; }
    if (!rewriteSource(text, 'levels')) return false;
    selectLevel(at + 1);
    setStatus(`${duplicate ? 'Duplicated' : 'Added'} a ${w}×${h} level after ${level.name}. Undo history starts again here.`);
    return true;
}

function deleteCurrentLevel(skipConfirm) {
    const level = currentLevel();
    if (inSprites() || !level) return false;
    if (state.levels.length <= 1) { setStatus('A game needs at least one level', true); return false; }
    if (!skipConfirm && !window.confirm(`Delete ${level.name}? Messages and headings around it stay.`)) return false;
    const at = currentGridInFile();
    const game = savedGame();
    const usage = psgame.levelUsage(game, { delete: at });
    if (usage.references.length) {
        listReferences(usage.references, `Deleting ${level.name} would send ${usage.references.length} link(s) somewhere else.`
            + ' Give the levels they point at a LEVEL heading first');
        setStatus('Not deleted: it would break a link or goto - see the list', true);
        return false;
    }
    let text;
    try { text = psgame.deleteLevel(game, at); } catch (e) { setStatus(e.message, true); return false; }
    if (!rewriteSource(text, 'levels')) return false;
    selectLevel(Math.min(at, state.levels.length - 1));
    setStatus(`Deleted ${level.name}. Undo history starts again here - reopen the file to get it back.`);
    return true;
}

/** The collision layer the current sprite sits on, as an index into collisionLayerLines. */
function currentSpriteLayer(game, layers) {
    const sprite = currentLevel();
    if (!sprite || !sprite.block) return -1;
    const names = new Set(sprite.block.names.map(n => n.toLowerCase()));
    return layers.findIndex(l => l.names.some(tok =>
        names.has(tok.toLowerCase()) || psgame.resolveNames(game, tok).some(n => names.has(n.toLowerCase()))));
}

function openObjectForm() {
    if (!inSprites()) return;
    const game = state.game;
    const sprite = currentLevel();
    el('objName').value = uniqueObjectName('NewObject');
    el('objColors').value = sprite && sprite.block.colors.length ? sprite.block.colors.join(' ') : 'black';
    const layers = psgame.collisionLayerLines(game);
    const select = el('objLayer');
    select.innerHTML = '';
    layers.forEach((layer, i) => {
        const option = document.createElement('option');
        option.value = String(i);
        option.textContent = layer.text.length > 40 ? layer.text.slice(0, 39) + '…' : layer.text;
        select.appendChild(option);
    });
    const fresh = document.createElement('option');
    fresh.value = 'new';
    fresh.textContent = 'a new layer, on top';
    select.appendChild(fresh);
    const mine = currentSpriteLayer(game, layers);
    select.value = mine >= 0 ? String(mine) : 'new';
    el('objGlyph').value = psgame.freeGlyphs(game, 1)[0] || '';
    el('objectForm').classList.remove('hidden');
    el('objName').focus();
    el('objName').select();
}

/**
 * Add an object after the current one: a name, colours, a sprite_size matrix
 * filled with its first colour, a collision layer and, optionally, a glyph.
 */
function addNewObject(name, colorsText, layer, glyph) {
    name = name.trim();
    glyph = glyph.trim();
    const colors = colorsText.trim().split(/\s+/).filter(Boolean);
    const game = savedGame();
    const n = Math.max(1, game.spriteSize || 5);
    const after = game.blocks[state.currentSprite] || null;
    let text;
    try {
        text = psgame.addObject(game, {
            name, colors, after, glyph,
            rows: Array.from({ length: n }, () => '0'.repeat(n)),
            layer: layer === 'new' ? 'new' : Number(layer),
        });
    } catch (e) { setStatus(e.message, true); return false; }
    if (!rewriteSource(text, 'sprites')) return false;
    const index = state.sprites.findIndex(s => s.name === name);
    if (index >= 0) selectLevel(index);
    setStatus(`Added ${name}` + (glyph ? `, drawn in maps as ${glyph}` : ' with no glyph - add one to the legend to use it in a map')
        + '. Undo history starts again here.');
    return true;
}

function deleteCurrentObject(skipConfirm) {
    const sprite = currentLevel();
    if (!inSprites() || !sprite) return false;
    const game = savedGame();
    const block = game.blocks[state.currentSprite];
    const usage = psgame.objectUsage(game, block);
    if (usage.references.length) {
        listReferences(usage.references, `${block.name} is used in ${usage.references.length} place(s). Remove these first`);
        setStatus(`Not deleted: ${block.name} is still used - see the list`, true);
        return false;
    }
    const extra = [];
    if (usage.glyphs.length) extra.push(`its glyph${usage.glyphs.length > 1 ? 's' : ''} ${usage.glyphs.join(' ')}`);
    if (usage.layerEdits.length) extra.push('its collision layer entry');
    if (!skipConfirm && !window.confirm(`Delete ${block.name}${extra.length ? ' with ' + extra.join(' and ') : ''}?`)) return false;
    let text;
    try { text = psgame.deleteObject(game, block); } catch (e) { setStatus(e.message, true); return false; }
    const at = state.currentSprite;
    if (!rewriteSource(text, 'sprites')) return false;
    selectLevel(Math.min(at, state.sprites.length - 1));
    setStatus(`Deleted ${block.name}${extra.length ? ' and ' + extra.join(' and ') : ''}. Undo history starts again here.`);
    return true;
}

/** The buttons over the list say what they act on. */
function refreshListActions() {
    const sprites = inSprites();
    el('listNew').textContent = sprites ? 'New…' : 'New';
    el('listNew').title = sprites
        ? 'Add an object after this one, with its own colours, collision layer and glyph'
        : 'Add an empty level the same size, after this one';
    el('listDuplicate').classList.toggle('hidden', sprites);
    el('listDelete').title = sprites
        ? 'Delete this object, if nothing but its own glyph and layer entry uses it'
        : 'Delete this level. Messages and headings around it stay.';
    if (!sprites) el('objectForm').classList.add('hidden');
}

// ------------------------------------------------------------------ resize

function resize(action) {
    const level = currentLevel();
    if (!guardEditable()) return;
    const { w, h } = levelSize(level);
    const bg = eraseChar();

    // Refuse to delete the last row or column rather than producing an empty
    // level that PuzzleScript cannot parse.
    if (action.startsWith('row-remove') && h <= 1) { setStatus('A level needs at least one row', true); return; }
    if (action.startsWith('col-remove') && w <= 1) { setStatus('A level needs at least one column', true); return; }

    pushUndo('resize');
    switch (action) {
        case 'row-add-top':      level.rows.unshift(bg.repeat(w)); break;
        case 'row-add-bottom':   level.rows.push(bg.repeat(w)); break;
        case 'row-remove-top':   level.rows.shift(); break;
        case 'row-remove-bottom': level.rows.pop(); break;
        case 'col-add-left':     level.rows = level.rows.map(r => bg + r); break;
        case 'col-add-right':    level.rows = level.rows.map(r => r + bg); break;
        case 'col-remove-left':  level.rows = level.rows.map(r => r.slice(1)); break;
        case 'col-remove-right': level.rows = level.rows.map(r => r.slice(0, -1)); break;
    }
    afterEdit();
    state.selection = null;
    if (inSprites()) {
        const n = state.game.spriteSize;
        const size = levelSize(level);
        if (size.w !== n || size.h !== n) {
            setStatus(`Sprites in this game are ${n}×${n} (sprite_size) - the engine will reject ${size.w}×${size.h}`, true);
        }
    }
    fullRefresh();
}

// -------------------------------------------------------------------- save

/**
 * Rebuild the game file with the edited grids spliced in. Everything outside
 * the edited rows - comments, level commands, other sections, line endings -
 * comes through untouched, because applyGridEdits replaces line ranges rather
 * than regenerating the file. Sprite edits go the same way: an object's matrix
 * rows are a line range in OBJECTS.
 */
function collectEdits() {
    const edits = state.levels
        .filter(l => l.edited)
        .map(l => (l.isNew
            ? { insertAfterLine: l.insertAfterLine, rows: l.rows }
            : { gridIndex: l.gridIndex, rows: l.rows }));
    for (const s of state.sprites) {
        if (!s.edited || !s.rows.length || isDerived(s)) continue;
        const b = s.block;
        if (b.spriteLines && b.spriteLines.length && !s.isNew) {
            edits.push({ startLine: b.spriteLines[0], lineCount: b.spriteLines.length, rows: s.rows, indent: b.indent || '' });
        } else {
            edits.push({ startLine: b.spriteInsertAfterLine + 1, lineCount: 0, rows: s.rows });
        }
    }
    return edits;
}

function buildOutput() {
    return psgame.applyGridEdits(state.game, collectEdits());
}

/**
 * The current grid as plain text, ready to paste into a LEVELS section, under
 * an object's colours, or straight into the PuzzleScript editor to try it out.
 */
function currentLevelText() {
    const level = currentLevel();
    return level ? level.rows.join('\n') : '';
}

/**
 * Copy text out. The async clipboard API needs a secure context, which a page
 * opened straight off disk is not, so fall back to a selected textarea the
 * user can copy by hand rather than failing silently.
 */
function copyText(text, doneMessage, label) {
    if (!text) return;
    const ok = () => setStatus(doneMessage);
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok, () => fallbackCopy(text, label));
    } else {
        fallbackCopy(text, label);
    }
}

function copyCurrentLevel() {
    const text = currentLevelText();
    if (!text) return;
    const level = currentLevel();
    const size = levelSize(level);
    copyText(text, `Copied "${level.name}" (${size.w}×${size.h}) as text`);
}

function fallbackCopy(text, label) {
    const box = el('copyout');
    const area = el('copytext');
    el('copyoutLabel').textContent = label || 'Select all and copy';
    area.value = text;
    box.classList.remove('hidden');
    area.focus();
    area.select();
    area.scrollTop = 0;
    area.scrollLeft = 0;
    setStatus('Press Ctrl/Cmd+C to copy, Escape to close', true);
}

/** Show text in the box regardless - for a prelude block you want to read. */
function showText(text, label) {
    fallbackCopy(text, label);
    setStatus('');
}

function save() {
    const text = buildOutput();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = state.fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    const changedLevels = state.levels.filter(l => l.edited).length;
    const changedSprites = state.sprites.filter(s => s.edited).length;
    setStatus(`saved ${state.fileName} (${changedLevels} level(s), ${changedSprites} sprite(s) changed`
        + `${state.sourceDirty ? ', new objects added' : ''})`);
}

// ---------------------------------------------------------------- keyboard

window.addEventListener('keydown', (event) => {
    if (!state.game) return;
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;

    const mod = event.ctrlKey || event.metaKey;

    if (mod) {
        switch (event.key.toLowerCase()) {
            case 'c': copySelection(false); event.preventDefault(); return;
            case 'x': copySelection(true); event.preventDefault(); return;
            case 'v': beginPaste(); event.preventDefault(); return;
            case 'a': {
                const { w, h } = levelSize(currentLevel());
                state.selection = { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
                el('selInfo').textContent = `${w} × ${h} selected`;
                draw(); event.preventDefault(); return;
            }
            case 's': save(); event.preventDefault(); return;
            case 'z':
                if (event.shiftKey) redo(); else undo();
                event.preventDefault(); return;
            case 'y': redo(); event.preventDefault(); return;
        }
        return;
    }

    switch (event.key) {
        case 'Escape':
            if (!el('copyout').classList.contains('hidden')) {
                el('copyout').classList.add('hidden');
                canvas.focus();
                return;
            }
            if (state.floating) { cancelFloating(); setStatus('put back'); return; }
            state.pasteAt = null;
            state.selection = null;
            el('selInfo').textContent = '';
            draw();
            return;
        case 'Delete':
        case 'Backspace':
            clearSelection();
            event.preventDefault();
            return;
        case 'Enter':
            if (state.pasteAt) { commitPaste(state.pasteAt.x, state.pasteAt.y); event.preventDefault(); }
            return;
        case '[': selectLevel(Math.max(0, currentIndex() - 1)); return;
        case ']': selectLevel(Math.min(currentList().length - 1, currentIndex() + 1)); return;
        case 'Tab':
            // Tab flips between the two workspaces; Shift+Tab as well, since
            // there are only two.
            setMode(inSprites() ? 'levels' : 'sprites');
            event.preventDefault();
            return;
    }

    // Transforms. Shift+arrows wrap; Shift+H / Shift+V mirror across the line
    // under the cursor; Shift+D is the other diagonal.
    if (event.shiftKey && event.key.startsWith('Arrow')) {
        const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        wrapShift(d[0], d[1]);
        event.preventDefault();
        return;
    }
    const lower = event.key.toLowerCase();
    if (event.shiftKey && lower === 'h') { flipAcrossCursor('vertical'); return; }
    if (event.shiftKey && lower === 'v') { flipAcrossCursor('horizontal'); return; }
    if (event.shiftKey && lower === 'd') { applyOp('antiTranspose'); return; }
    const ops = { h: 'flipH', v: 'flipV', q: 'rotCCW', e: 'rotCW', d: 'transpose' };
    if (!event.shiftKey && ops[lower]) { applyOp(ops[lower]); return; }

    const tools = { m: 'select', b: 'brush', r: 'rect', l: 'line', g: 'fill', i: 'pick' };
    const tool = tools[event.key.toLowerCase()];
    if (tool) { state.tool = tool; refreshChrome(); return; }

    // 1-9 then 0 pick the first ten tiles.
    if (/^[0-9]$/.test(event.key)) {
        const index = event.key === '0' ? 9 : Number(event.key) - 1;
        const ch = glyphOrder()[index];
        if (ch !== undefined) setInk(ch);
    }
});

// Holding Shift shows the mirror lines Shift+H and Shift+V would use.
window.addEventListener('keydown', (event) => {
    if (event.key === 'Shift' && !state.axisHint && state.game) { state.axisHint = true; draw(); }
});
window.addEventListener('keyup', (event) => {
    if (event.key === 'Shift' && state.axisHint) { state.axisHint = false; draw(); }
});
window.addEventListener('blur', () => { if (state.axisHint) { state.axisHint = false; draw(); } });

// ------------------------------------------------------------------- wiring

for (const button of document.querySelectorAll('.tool')) {
    button.addEventListener('click', () => { state.tool = button.dataset.tool; refreshChrome(); });
}
for (const button of document.querySelectorAll('.mode')) {
    button.addEventListener('click', () => setMode(button.dataset.mode));
}
for (const button of document.querySelectorAll('[data-resize]')) {
    button.addEventListener('click', () => resize(button.dataset.resize));
}
for (const button of document.querySelectorAll('[data-xf]')) {
    button.addEventListener('click', () => { applyOp(button.dataset.xf); canvas.focus(); });
}
for (const button of document.querySelectorAll('[data-wrap]')) {
    const [dx, dy] = button.dataset.wrap.split(',').map(Number);
    button.addEventListener('click', () => { wrapShift(dx, dy); canvas.focus(); });
}
el('colorsFrom').addEventListener('change', (e) => setColorsFrom(e.target.value));
el('newCopy').addEventListener('click', openCopyForm);
el('copyCancel').addEventListener('click', () => { el('copyForm').classList.add('hidden'); canvas.focus(); });
el('copyForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (addCopyObject(el('copyName').value, el('copyTransform').value, el('copyColors').value)) {
        el('copyForm').classList.add('hidden');
        canvas.focus();
    }
});

el('listNew').addEventListener('click', () => (inSprites() ? openObjectForm() : newLevel(false)));
el('listDuplicate').addEventListener('click', () => newLevel(true));
el('listDelete').addEventListener('click', () => (inSprites() ? deleteCurrentObject() : deleteCurrentLevel()));
el('objCancel').addEventListener('click', () => { el('objectForm').classList.add('hidden'); canvas.focus(); });
el('objectForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (addNewObject(el('objName').value, el('objColors').value, el('objLayer').value, el('objGlyph').value)) {
        el('objectForm').classList.add('hidden');
        canvas.focus();
    }
});

el('undo').addEventListener('click', undo);
el('redo').addEventListener('click', redo);
el('save').addEventListener('click', save);
el('copylevel').addEventListener('click', copyCurrentLevel);
el('copyclose').addEventListener('click', () => el('copyout').classList.add('hidden'));
el('zoom').addEventListener('input', (e) => {
    state.cell = Number(e.target.value);
    state.zoomPinned = true;      // stop auto-fitting once the zoom is chosen by hand
    draw();
});

el('paletteSelect').addEventListener('change', (e) => applyPalette(e.target.value || null));
el('paletteLine').addEventListener('click', () => {
    const name = shownPaletteName();
    copyText(`color_palette ${name}`, `Copied "color_palette ${name}" - paste it into the prelude`,
        'The prelude line, for PuzzleScript Next');
});
el('paletteBlock').addEventListener('click', () => {
    const name = shownPaletteName();
    showText(palettes.paletteToPreludeBlock(name),
        `Portable prelude block for ${name} - runs on any PuzzleScript build`);
});

window.addEventListener('resize', () => {
    if (!state.game || state.zoomPinned) return;
    fitZoom();
    draw();
});

const fileInput = el('file');
el('open').addEventListener('click', () => fileInput.click());
el('open2').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) readFile(file);
    fileInput.value = '';
});

function readFile(file) {
    const reader = new FileReader();
    reader.onload = () => loadSource(String(reader.result), file.name);
    reader.onerror = () => setStatus('Could not read that file', true);
    reader.readAsText(file);
}

// Drag and drop, with a full-window target so you cannot miss.
const dropzone = el('dropzone');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (++dragDepth === 1) dropzone.classList.remove('hidden');
});
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropzone.classList.add('hidden'); } });
window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropzone.classList.add('hidden');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) readFile(file);
});

// The example games, so the editor is explorable without finding a file first.
function loadExample(name) {
    fetch(`../fixtures/${name}`)
        .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.text(); })
        .then(text => loadSource(text, name))
        .catch(() => setStatus(
            'Could not load the example - serve this folder over http, or open your own file',
            true));
}
el('demo').addEventListener('click', () => loadExample('sokoban.txt'));
el('demoNext').addEventListener('click', () => loadExample('nextsyntax.txt'));

// A game named in the URL loads itself: index.html?game=../../src/demo/sokoban.txt
// This is how the PuzzleScript Next editor's MAP EDITOR link hands over the
// game it has open (via sessionStorage, below), and how a gallery can deep-link.
(function loadFromLocation() {
    const params = new URLSearchParams(window.location.search);
    const game = params.get('game');
    if (game) {
        fetch(game)
            .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.text(); })
            .then(text => loadSource(text, game.split('/').pop()))
            .catch(() => setStatus(`Could not fetch ${game}`, true));
        return;
    }
    try {
        const handed = window.sessionStorage && sessionStorage.getItem('psmap.handoff');
        if (handed) {
            sessionStorage.removeItem('psmap.handoff');
            const parsed = JSON.parse(handed);
            if (parsed && parsed.source) loadSource(parsed.source, parsed.fileName || 'game.txt');
        }
    } catch (e) { /* storage blocked - nothing to hand over */ }
})();

window.addEventListener('beforeunload', (event) => {
    if (state.sourceDirty || state.levels.some(l => l.edited) || state.sprites.some(s => s.edited)) {
        event.preventDefault();
        event.returnValue = '';
    }
});

// Exposed for the test page.
window.PSMapEditor = { state, loadSource, buildOutput, currentLevelText, copyCurrentLevel,
    addMapToSection, copySelection, beginPaste, commitPaste, resize, undo, redo, fitZoom,
    setMode, selectLevel, applyPalette, setInk, applyOp, wrapShift, transformGrid, flipAcrossCursor,
    setColorsFrom, addCopyObject, cancelFloating, newLevel, deleteCurrentLevel, addNewObject,
    deleteCurrentObject, openObjectForm };

})();
