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
    hover: null,

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
    state.selection = null;
    state.clipboard = null;
    state.pasteAt = null;
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
    sprite.block.colors.forEach((token, i) => {
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

    if (inSprites()) refreshSpriteGlyphs();
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
        text.querySelector('.lv-meta').textContent = size
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
    setCurrentIndex(i);
    state.selection = null;
    state.pasteAt = null;
    if (inSprites()) {
        if (!list[i].rows.length) addMatrixToSprite(list[i]);
        refreshSpriteGlyphs();
        buildPalette();
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
    el('levelTitle').textContent = inSprites()
        ? `${level.name}  ·  ${level.block.colors.join(' ')}`
        : level.name;
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
        commitPaste(state.pasteAt.x, state.pasteAt.y);
        return;
    }
    if (!inBounds(level, point.x, point.y)) return;

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
canvas.addEventListener('mouseleave', () => { state.hover = null; el('cursor').textContent = ''; draw(); });

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
    setStatus(clipped
        ? `pasted ${placed} tiles, ${clipped} fell outside the level`
        : `pasted ${clip.w}×${clip.h}`, clipped > 0);
    fullRefresh();
}

function clearSelection() {
    const level = currentLevel();
    const sel = state.selection;
    if (!sel) return;
    pushUndo('clear');
    for (let y = sel.y0; y <= sel.y1; y++) {
        for (let x = sel.x0; x <= sel.x1; x++) setCell(level, x, y, eraseChar());
    }
    afterEdit();
    fullRefresh();
}

// ------------------------------------------------------------------ resize

function resize(action) {
    const level = currentLevel();
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
function buildOutput() {
    const edits = state.levels
        .filter(l => l.edited)
        .map(l => (l.isNew
            ? { insertAfterLine: l.insertAfterLine, rows: l.rows }
            : { gridIndex: l.gridIndex, rows: l.rows }));
    for (const s of state.sprites) {
        if (!s.edited || !s.rows.length) continue;
        const b = s.block;
        if (b.spriteLines && b.spriteLines.length && !s.isNew) {
            edits.push({ startLine: b.spriteLines[0], lineCount: b.spriteLines.length, rows: s.rows, indent: b.indent || '' });
        } else {
            edits.push({ startLine: b.spriteInsertAfterLine + 1, lineCount: 0, rows: s.rows });
        }
    }
    return psgame.applyGridEdits(state.game, edits);
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
    setStatus(`saved ${state.fileName} (${changedLevels} level(s), ${changedSprites} sprite(s) changed)`);
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
    if (state.levels.some(l => l.edited) || state.sprites.some(s => s.edited)) {
        event.preventDefault();
        event.returnValue = '';
    }
});

// Exposed for the test page.
window.PSMapEditor = { state, loadSource, buildOutput, currentLevelText, copyCurrentLevel,
    addMapToSection, copySelection, beginPaste, commitPaste, resize, undo, redo, fitZoom,
    setMode, selectLevel, applyPalette, setInk };

})();
