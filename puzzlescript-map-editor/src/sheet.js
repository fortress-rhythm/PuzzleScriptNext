'use strict';

// The spreadsheet bridge: PuzzleScript LEVELS <-> Excel / Google Sheets / CSV.
//
// This exists because spreadsheets are the one ubiquitous tool that gets
// rectangular copy and paste right - select a block, copy, paste it somewhere
// else and it *overwrites* a block rather than shoving text sideways. The cost
// is normally that you lose all sense of what the map looks like, since every
// tile becomes an opaque letter.
//
// So the export colours every cell using the object's own colour from the game's
// OBJECTS section, and squares up the cells. The result is a map you can
// actually read, in a tool that already has the editing model you want.

const { parseGame, buildGlyphTable, findPaletteName, labelForCommands } = require('./psgame');
const { colorPalettes } = require('./palettes');
const xlsx = require('./xlsx');
const csv = require('./csv');

const LEVEL_SHEET_RE = /^L(\d+)/;

/**
 * Work out which character means "empty" for a given game, used to pad ragged
 * rows and to fill cells the user left blank.
 */
function findBackgroundChar(game, glyphs, grids) {
    // 1. A glyph that resolves to an object literally named "background".
    for (const [ch, g] of Object.entries(glyphs)) {
        if (g.objects.some(o => o.toLowerCase() === 'background')) return ch;
    }
    // 2. The conventional '.' if it is a legal glyph.
    if (glyphs['.']) return '.';
    // 3. The most common character across all levels.
    const counts = new Map();
    for (const grid of grids) {
        for (const row of grid.rows) {
            for (const ch of row) counts.set(ch, (counts.get(ch) || 0) + 1);
        }
    }
    let best = null, bestN = -1;
    for (const [ch, n] of counts) if (n > bestN) { best = ch; bestN = n; }
    return best || '.';
}

/**
 * Give each level a short human name for its worksheet tab, from the LEVEL or
 * SECTION command preceding it where one exists.
 */
function levelTabName(index, level) {
    const label = labelForCommands(level.commandsBefore);
    const prefix = `L${String(index).padStart(2, '0')}`;
    if (!label) return prefix;
    // Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 chars.
    const clean = label.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    const name = `${prefix} ${clean}`;
    return name.length > 31 ? name.slice(0, 31).trim() : name;
}

/**
 * Pick a readable text colour for a given background fill.
 */
function contrastText(hex) {
    if (!hex) return null;
    const n = parseInt(hex.replace('#', ''), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    // Rec. 709 luma.
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 140 ? '#000000' : '#FFFFFF';
}

/**
 * Look a character up in the glyph table, honouring the game's case rules.
 *
 * PuzzleScript is case-insensitive unless the prelude says otherwise, so a game
 * that declares `Wall W` may write `w` throughout its levels. Matching only on
 * exact case would leave most of such a game's tiles apparently unknown - and
 * therefore uncoloured on export, and warned about on import.
 */
function makeGlyphLookup(glyphs, caseSensitive) {
    if (caseSensitive) return ch => glyphs[ch];
    const folded = new Map();
    for (const [ch, g] of Object.entries(glyphs)) folded.set(ch.toLowerCase(), g);
    return ch => glyphs[ch] || folded.get(String(ch).toLowerCase());
}

/**
 * Build the analysis every exporter needs.
 */
function analyse(source) {
    const game = parseGame(source);
    const paletteName = findPaletteName(game);
    const palette = colorPalettes[paletteName] || colorPalettes.arnecolors;
    const glyphs = buildGlyphTable(game, palette);
    const grids = game.grids;
    const background = findBackgroundChar(game, glyphs, grids);
    const glyphAt = makeGlyphLookup(glyphs, game.caseSensitive);
    return { game, palette, paletteName, glyphs, glyphAt, grids, background };
}

// ---------------------------------------------------------------------------
// Export: game -> workbook
// ---------------------------------------------------------------------------

function toWorkbook(source, options = {}) {
    const { game, glyphs, glyphAt, grids, background, paletteName } = analyse(source);
    const sheets = [];

    // Index sheet: what is in this workbook, and the commands attached to each
    // level. Commands are read-only here - they live in the .txt file.
    const indexRows = [
        [{ v: 'Sheet', bold: true }, { v: 'Size', bold: true },
         { v: 'Name', bold: true }, { v: 'Commands (read-only)', bold: true }],
    ];

    let gridIndex = 0;
    for (const level of game.levels) {
        if (!level.grid) continue;
        const tab = levelTabName(gridIndex, level);
        const cmds = [...level.commandsBefore, ...level.commandsAfter]
            .map(c => `${c.verb.toUpperCase()} ${c.text}`.trim()).join(' | ');
        const name = labelForCommands(level.commandsBefore);
        indexRows.push([tab, `${level.grid.width} x ${level.grid.height}`, name, cmds]);

        sheets.push(gridSheet(tab, level.grid, glyphAt));
        gridIndex++;
    }

    sheets.unshift({
        name: '_index',
        rows: indexRows,
        colWidth: 28,
        freeze: { rows: 1, cols: 0 },
    });

    // Legend sheet: the palette you are painting with.
    const legendRows = [
        [{ v: 'Char', bold: true }, { v: 'Swatch', bold: true },
         { v: 'Means', bold: true }, { v: 'Defined in', bold: true }],
    ];
    for (const ch of Object.keys(glyphs).sort()) {
        const g = glyphs[ch];
        legendRows.push([
            { v: ch },
            { v: ch, fill: g.color || null },
            { v: g.label },
            { v: g.source },
        ]);
    }
    legendRows.push([]);
    legendRows.push([{ v: `palette: ${paletteName}` }]);
    legendRows.push([{ v: `background char: ${background}` }]);
    sheets.push({ name: '_legend', rows: legendRows, colWidth: 22, freeze: { rows: 1, cols: 0 } });

    return {
        buffer: xlsx.writeWorkbook(sheets),
        gridCount: grids.length,
        background,
        glyphs,
    };
}

function gridSheet(name, grid, glyphAt) {
    const rows = grid.rows.map(row =>
        Array.from(row).map(ch => {
            const g = glyphAt(ch);
            return { v: ch, fill: g && g.color ? g.color : null };
        })
    );
    return {
        name,
        rows,
        // Narrow columns plus a matching row height make the cells square, so
        // the map has the same proportions it will have in game.
        colWidth: 2.7,
        rowHeight: 18,
        showGridLines: false,
    };
}

// ---------------------------------------------------------------------------
// Export: game -> CSV / TSV
// ---------------------------------------------------------------------------

/**
 * Delimited formats are a single flat table, so levels are tagged in column A.
 * Every row of a grid carries its level id, which makes the format robust to
 * inserted or deleted rows.
 */
function toDelimited(source, kind = 'csv') {
    const { grids } = analyse(source);
    const rows = [['level', 'grid...']];
    grids.forEach((grid, i) => {
        grid.rows.forEach(row => {
            rows.push([`L${i}`, ...Array.from(row)]);
        });
        rows.push([]);
    });
    return kind === 'tsv' ? csv.toTsv(rows) : csv.toCsv(rows);
}

// ---------------------------------------------------------------------------
// Import: workbook / delimited -> grid rows
// ---------------------------------------------------------------------------

/**
 * Turn a 2-D array of cell strings into grid rows, padding ragged rows and
 * reporting anything suspicious rather than silently corrupting the level.
 */
function cellsToRows(cells, background, glyphAt, context, warnings) {
    // Drop trailing empty rows.
    const trimmed = cells.slice();
    while (trimmed.length && trimmed[trimmed.length - 1].every(c => !String(c ?? '').trim())) {
        trimmed.pop();
    }
    if (!trimmed.length) return [];

    const width = Math.max(...trimmed.map(r => {
        let last = -1;
        r.forEach((c, i) => { if (String(c ?? '').trim()) last = i; });
        return last + 1;
    }));
    if (width <= 0) return [];

    const rows = trimmed.map((r, y) => {
        let out = '';
        for (let x = 0; x < width; x++) {
            const raw = String(r[x] ?? '');
            const value = raw.trim();
            if (!value) {
                warnings.push(`${context} r${y + 1}c${x + 1}: empty cell, filled with "${background}"`);
                out += background;
                continue;
            }
            if (Array.from(value).length > 1) {
                warnings.push(`${context} r${y + 1}c${x + 1}: "${value}" is more than one character, used "${Array.from(value)[0]}"`);
                out += Array.from(value)[0];
                continue;
            }
            if (glyphAt && !glyphAt(value)) {
                warnings.push(`${context} r${y + 1}c${x + 1}: "${value}" is not in the legend`);
            }
            out += value;
        }
        return out;
    });
    return rows;
}

/**
 * A spreadsheet is always rectangular, so importing squares up levels whose
 * rows had differing lengths. That is usually harmless, but it turns a
 * deliberately ragged level into a whole-file diff.
 *
 * So: where a row is exactly its original self plus background padding, put the
 * original row back. Rows the author actually edited keep their new content.
 */
function unpadUntouchedRows(edits, grids, background) {
    for (const edit of edits) {
        const original = grids[edit.gridIndex];
        if (!original) continue;
        edit.rows = edit.rows.map((row, i) => {
            const was = original.rows[i];
            if (was === undefined || row.length <= was.length) return row;
            const padded = was + background.repeat(row.length - was.length);
            return row === padded ? was : row;
        });
    }
    return edits;
}

function fromWorkbook(source, buffer) {
    const { game, glyphAt, background } = analyse(source);
    const sheets = xlsx.readWorkbook(buffer);
    const edits = [];
    const warnings = [];

    for (const [name, cells] of Object.entries(sheets)) {
        const m = name.match(LEVEL_SHEET_RE);
        if (!m) continue;
        const gridIndex = Number(m[1]);
        if (gridIndex >= game.grids.length) {
            warnings.push(`sheet "${name}": no level ${gridIndex} in the game file, skipped`);
            continue;
        }
        const rows = cellsToRows(cells, background, glyphAt, `sheet "${name}"`, warnings);
        if (!rows.length) {
            warnings.push(`sheet "${name}": empty, skipped`);
            continue;
        }
        edits.push({ gridIndex, rows });
    }
    return { game, edits: unpadUntouchedRows(edits, game.grids, background), warnings };
}

function fromDelimited(source, text, kind = 'csv') {
    const { game, glyphAt, background } = analyse(source);
    const table = kind === 'tsv' ? csv.fromTsv(text) : csv.fromCsv(text);
    const warnings = [];

    // Gather rows per level id, in first-seen order.
    const groups = new Map();
    for (const row of table) {
        const tag = String(row[0] ?? '').trim();
        const m = tag.match(/^L(\d+)$/i);
        if (!m) continue;
        const gridIndex = Number(m[1]);
        if (!groups.has(gridIndex)) groups.set(gridIndex, []);
        groups.get(gridIndex).push(row.slice(1));
    }

    const edits = [];
    for (const [gridIndex, cells] of groups) {
        if (gridIndex >= game.grids.length) {
            warnings.push(`L${gridIndex}: no such level in the game file, skipped`);
            continue;
        }
        const rows = cellsToRows(cells, background, glyphAt, `L${gridIndex}`, warnings);
        if (rows.length) edits.push({ gridIndex, rows });
    }
    return { game, edits: unpadUntouchedRows(edits, game.grids, background), warnings };
}

module.exports = {
    analyse,
    toWorkbook,
    toDelimited,
    fromWorkbook,
    fromDelimited,
    findBackgroundChar,
    levelTabName,
    contrastText,
    cellsToRows,
    makeGlyphLookup,
    unpadUntouchedRows,
};
