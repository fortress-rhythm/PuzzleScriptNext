'use strict';

// The REXPaint bridge: PuzzleScript LEVELS <-> a directory of .xp files.
//
// One .xp file per level, so REXPaint's image browser doubles as a level
// browser - which is what makes copying a rectangle out of one level and
// stamping it into another practical.
//
// The only real problem is the character set. REXPaint draws code page 437,
// while a PuzzleScript legend may use anything - the demo games alone include
// 'section sign', 'e-grave' and '"'. So rather than hoping the two line up, we
// assign every glyph in the game a CP437 code (its natural one where it has
// one) and write that assignment to a sidecar file. Import reads the sidecar,
// so the round trip is exact for any legend, and repainting a tile in REXPaint
// maps back to the right object.

const { analyse, contrastText } = require('./sheet');
const { CP437, CP437_INDEX } = require('./cp437');
const rex = require('./rexpaint');

const SIDECAR = 'glyphmap.json';

// Codes to hand out to glyphs with no natural CP437 home. These are the solid
// and shaded blocks and box-drawing characters - highly visible, and unlikely
// to collide with a game's own ASCII glyphs.
const SPARE_CODES = [
    0xdb, 0xb2, 0xb1, 0xb0, 0xfe, 0x04, 0x03, 0x05, 0x06, 0x0f,
    0x02, 0x01, 0x0e, 0x0b, 0x0c, 0x09, 0x08, 0x07, 0x10, 0x11,
];

/**
 * Collect every character that actually appears in a level grid.
 *
 * This matters because PuzzleScript is case-insensitive by default: a game may
 * declare `Wall W` in the legend and then write `w` throughout its levels. The
 * glyph table holds the declared casing, so mapping from it alone would leave
 * every `w` in the file unrepresented.
 */
function charsInGrids(grids) {
    const set = new Set();
    for (const grid of grids) {
        for (const row of grid.rows) for (const ch of row) set.add(ch);
    }
    return set;
}

/**
 * Assign a CP437 code to every character the game can put in a level - both the
 * declared glyphs and whatever the grids actually contain.
 *
 * Returns { charToCode, codeToChar, unmapped }; `unmapped` lists characters
 * that had to borrow a substitute code, which the CLI reports so you know what
 * you are looking at in REXPaint.
 */
function buildGlyphMap(glyphs, extraChars) {
    const charToCode = {};
    const codeToChar = {};
    const unmapped = [];
    const used = new Set();

    // Declared glyphs first, so they win the natural code points.
    const chars = [...Object.keys(glyphs), ...(extraChars || [])];

    // Pass 1: characters that exist in CP437 keep their own shape.
    for (const ch of chars) {
        if (charToCode[ch] !== undefined) continue;
        const code = CP437_INDEX.get(ch);
        if (code !== undefined && !used.has(code)) {
            charToCode[ch] = code;
            codeToChar[code] = ch;
            used.add(code);
        }
    }

    // Pass 2: anything left over gets a spare, then any free code at all.
    for (const ch of chars) {
        if (charToCode[ch] !== undefined) continue;
        let code = SPARE_CODES.find(c => !used.has(c));
        if (code === undefined) {
            for (let c = 255; c >= 1; c--) if (!used.has(c)) { code = c; break; }
        }
        if (code === undefined) {
            throw new Error('More than 255 distinct glyphs - too many for a CP437 canvas');
        }
        charToCode[ch] = code;
        codeToChar[code] = ch;
        used.add(code);
        unmapped.push({ char: ch, code, shownAs: CP437[code] });
    }

    return { charToCode, codeToChar, unmapped };
}

/**
 * Export every level to .xp buffers, plus the sidecar that makes import exact.
 * Returns { files: [{ name, buffer }], sidecar, unmapped, glyphs }.
 */
function toRexFiles(source) {
    const { game, glyphs, glyphAt, grids } = analyse(source);
    const map = buildGlyphMap(glyphs, charsInGrids(grids));
    const files = [];

    let index = 0;
    for (const level of game.levels) {
        if (!level.grid) continue;
        const grid = level.grid;
        const width = grid.width;
        const height = grid.height;
        const cells = new Array(width * height);

        for (let y = 0; y < height; y++) {
            const row = grid.rows[y] || '';
            for (let x = 0; x < width; x++) {
                // Short rows in a ragged level are padded visually only; the
                // sidecar records the true width so import can undo it.
                const ch = row[x];
                const glyph = ch !== undefined ? glyphAt(ch) : undefined;
                const bgHex = glyph && glyph.color ? glyph.color : null;
                cells[y * width + x] = {
                    code: ch !== undefined ? (map.charToCode[ch] ?? CP437_INDEX.get(ch) ?? 0x3f) : 0,
                    fg: rex.hexToRgb(contrastText(bgHex) || '#FFFFFF', { r: 255, g: 255, b: 255 }),
                    bg: bgHex ? rex.hexToRgb(bgHex) : rex.TRANSPARENT,
                };
            }
        }

        const name = (level.commandsBefore.find(c => c.verb === 'level') || {}).text || '';
        files.push({
            name: `L${String(index).padStart(2, '0')}.xp`,
            buffer: rex.writeXp([{ width, height, cells }]),
            level: index,
            label: name,
            rowLengths: grid.rows.map(r => r.length),
        });
        index++;
    }

    const sidecar = {
        format: 'puzzlescript-map-editor/rexpaint',
        version: 1,
        note: 'Maps CP437 codes back to PuzzleScript legend characters. '
            + 'Keep this next to the .xp files; psmap import needs it.',
        codeToChar: map.codeToChar,
        rowLengths: Object.fromEntries(files.map(f => [f.level, f.rowLengths])),
    };

    return { files, sidecar, unmapped: map.unmapped, glyphs, gridCount: grids.length };
}

/**
 * Read .xp buffers back into grid edits.
 *
 * `files` is [{ name, buffer }]; the level index comes from the L## filename.
 * `sidecar` is the parsed glyphmap.json, or null to fall back to a plain CP437
 * reading (which is right for a file drawn from scratch in ASCII).
 */
function fromRexFiles(source, files, sidecar) {
    const { game, glyphs, glyphAt, grids, background } = analyse(source);
    const warnings = [];
    const edits = [];

    // Prefer the sidecar; fall back to rebuilding the same assignment, which is
    // deterministic for an unchanged game file.
    const codeToChar = (sidecar && sidecar.codeToChar)
        || buildGlyphMap(glyphs, charsInGrids(grids)).codeToChar;
    const rowLengths = (sidecar && sidecar.rowLengths) || {};

    for (const file of files) {
        const m = file.name.match(/L(\d+)/i);
        if (!m) { warnings.push(`${file.name}: filename has no L## level number, skipped`); continue; }
        const gridIndex = Number(m[1]);
        if (gridIndex >= game.grids.length) {
            warnings.push(`${file.name}: no level ${gridIndex} in the game file, skipped`);
            continue;
        }

        let layers;
        try { layers = rex.readXp(file.buffer); }
        catch (e) { warnings.push(`${file.name}: ${e.message}`); continue; }

        // Flatten layers top-down: a cell on a higher layer wins unless it is
        // undrawn. Most maps are one layer, but REXPaint users do use them.
        const base = layers[0];
        const rows = [];
        for (let y = 0; y < base.height; y++) {
            let row = '';
            for (let x = 0; x < base.width; x++) {
                let cell = null;
                for (let l = layers.length - 1; l >= 0; l--) {
                    const c = layers[l].cells[y * layers[l].width + x];
                    if (!c) continue;
                    const undrawn = c.code === 0
                        || (c.bg.r === 255 && c.bg.g === 0 && c.bg.b === 255 && c.code === 32);
                    if (!undrawn) { cell = c; break; }
                }
                if (!cell) { row += background; continue; }

                const ch = codeToChar[cell.code] ?? codeToChar[String(cell.code)];
                if (ch !== undefined) { row += ch; continue; }

                // Not one of ours - fall back to the literal CP437 character,
                // which is what a hand-drawn .xp will contain.
                const literal = CP437[cell.code];
                if (literal !== undefined && glyphAt(literal)) { row += literal; continue; }
                warnings.push(
                    `${file.name} r${y + 1}c${x + 1}: CP437 code ${cell.code}`
                    + `${literal ? ` ("${literal}")` : ''} is not a known glyph,`
                    + ` used "${background}"`);
                row += background;
            }
            rows.push(row);
        }

        // Undo the visual padding applied to a ragged level, but only where the
        // padding is untouched.
        const originalLengths = rowLengths[gridIndex] || rowLengths[String(gridIndex)];
        if (originalLengths) {
            for (let y = 0; y < rows.length; y++) {
                const want = originalLengths[y];
                if (want === undefined || want >= rows[y].length) continue;
                const tail = rows[y].slice(want);
                if (tail === background.repeat(tail.length)) rows[y] = rows[y].slice(0, want);
            }
        }

        // Resizing a level is done by resizing the REXPaint canvas, so the
        // layer dimensions are authoritative and no trimming is needed here.
        if (rows.length) edits.push({ gridIndex, rows });
    }

    return { game, edits, warnings };
}

module.exports = { toRexFiles, fromRexFiles, buildGlyphMap, charsInGrids, SIDECAR, SPARE_CODES };
