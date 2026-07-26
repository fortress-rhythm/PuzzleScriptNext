'use strict';

// Plain node test runner - no dependencies, run with `npm test`.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const psgame = require('../src/psgame');
const sheet = require('../src/sheet');
const xlsx = require('../src/xlsx');
const csv = require('../src/csv');
const rexpaint = require('../src/rexpaint');
const rexbridge = require('../src/rexbridge');
const zlib = require('zlib');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const SOKOBAN = fs.readFileSync(path.join(FIXTURES, 'sokoban.txt'), 'utf8');

let passed = 0;
const failures = [];

function test(name, fn) {
    try { fn(); passed++; }
    catch (e) { failures.push({ name, error: e }); }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

test('finds every section', () => {
    const game = psgame.parseGame(SOKOBAN);
    assert.deepStrictEqual(
        game.sections.map(s => s.name),
        ['objects', 'legend', 'sounds', 'collisionlayers', 'rules', 'winconditions', 'levels']);
});

test('parses objects with names, aliases and colours', () => {
    const game = psgame.parseGame(SOKOBAN);
    assert.strictEqual(game.objects.player.name, 'Player');
    assert.deepStrictEqual(game.objects.wall.aliases, ['W']);
    assert.deepStrictEqual(game.objects.crate.colors, ['Orange', 'Yellow']);
    // The alias resolves to the same entry.
    assert.strictEqual(game.objects.w, game.objects.wall);
});

test('does not mistake a sprite matrix row for a colour line', () => {
    const game = psgame.parseGame(SOKOBAN);
    // Background's second line is "LIGHTGREEN GREEN"; the 11111 rows must not
    // be read as colours.
    assert.deepStrictEqual(game.objects.background.colors, ['LIGHTGREEN', 'GREEN']);
});

test('parses legend entries including AND aggregates', () => {
    const game = psgame.parseGame(SOKOBAN);
    assert.deepStrictEqual(game.legend['@'].objects, ['Crate', 'Target']);
    assert.strictEqual(game.legend['@'].op, 'and');
    assert.strictEqual(game.legend['#'].expansion, 'Wall');
});

test('parses level grids and their line ranges', () => {
    const game = psgame.parseGame(SOKOBAN);
    assert.strictEqual(game.grids.length, 2);
    assert.strictEqual(game.grids[0].width, 9);
    assert.strictEqual(game.grids[0].height, 7);
    assert.strictEqual(game.grids[1].width, 5);
    assert.strictEqual(game.grids[0].rows[2], '#.*.*.O.#');
    // Line indices must point at the real source lines.
    assert.strictEqual(game.lines[game.grids[0].lines[2]].trim(), '#.*.*.O.#');
});

test('separates level commands from grids', () => {
    const game = psgame.parseGame(SOKOBAN);
    const verbs = game.levelBlocks.filter(b => b.kind === 'command').map(b => b.verb);
    assert.deepStrictEqual(verbs, ['message', 'level', 'section', 'message']);
});

test('a level command is not confused with a grid row', () => {
    // "message" starts with 'm', which could be a legend char in some games.
    const src = SOKOBAN.replace('message Push the crates onto the targets.',
        'message Push the crates onto the targets.');
    const game = psgame.parseGame(src);
    assert.strictEqual(game.grids.length, 2);
});

test('handles CRLF without rewriting line endings', () => {
    const crlf = SOKOBAN.replace(/\n/g, '\r\n');
    const game = psgame.parseGame(crlf);
    assert.strictEqual(game.dominantEnding, '\r\n');
    assert.strictEqual(game.grids[0].rows[0], '#########');
    const out = psgame.applyGridEdits(game, []);
    assert.strictEqual(out, crlf);
});

test('strips nested multi-line comments when classifying lines', () => {
    const lines = ['a(b(c)d)e', 'f(g', 'h)i'];
    const stripped = psgame.stripComments(lines);
    assert.strictEqual(stripped[0].code, 'ae');
    assert.strictEqual(stripped[1].code, 'f');
    assert.strictEqual(stripped[2].code, 'i');
});

test('reads the palette and case sensitivity from the prelude', () => {
    const game = psgame.parseGame(SOKOBAN);
    assert.strictEqual(psgame.findPaletteName(game), 'arnecolors');
    assert.strictEqual(game.caseSensitive, false);
});

// ---------------------------------------------------------------------------
// Glyphs and colours
// ---------------------------------------------------------------------------

test('builds a glyph table with legend entries winning over object names', () => {
    const { glyphs } = sheet.analyse(SOKOBAN);
    assert.strictEqual(glyphs['P'].source, 'legend');
    assert.strictEqual(glyphs['W'].source, 'objects');
    // Case-insensitive game: 'p' must not appear as a separate tile.
    assert.ok(!glyphs['p'], 'lower-case duplicate glyph leaked through');
});

test('resolves colours through the named palette', () => {
    const { glyphs } = sheet.analyse(SOKOBAN);
    assert.strictEqual(glyphs['#'].color, '#A46422');   // arnecolors brown
    assert.strictEqual(glyphs['.'].color, '#A3CE27');   // lightgreen
});

test('resolves hex colours including short form', () => {
    assert.strictEqual(psgame.resolveColor('#0FF', {}), '#00FFFF');
    assert.strictEqual(psgame.resolveColor('#123456', {}), '#123456');
    assert.strictEqual(psgame.resolveColor('transparent', {}), null);
});

test('picks Background as the background character', () => {
    const { background } = sheet.analyse(SOKOBAN);
    assert.strictEqual(background, '.');
});

// ---------------------------------------------------------------------------
// XLSX container
// ---------------------------------------------------------------------------

test('xlsx round-trips cell values', () => {
    const buf = xlsx.writeWorkbook([
        { name: 'S1', rows: [['a', 'b'], ['c', { v: 'd', fill: '#FF0000' }]] },
    ]);
    const back = xlsx.readWorkbook(buf);
    assert.deepStrictEqual(back.S1, [['a', 'b'], ['c', 'd']]);
});

test('xlsx writes formula-looking characters as literal text', () => {
    // These are all legal PuzzleScript legend characters and all of them would
    // be parsed as formulas by Excel if written as anything but an inline string.
    const dangerous = ['=', '+', '-', '@', '"', "'"];
    const buf = xlsx.writeWorkbook([{ name: 'S1', rows: [dangerous] }]);
    const xml = xlsx.zipRead(buf)['xl/worksheets/sheet1.xml'].toString('utf8');
    assert.ok(!xml.includes('<f>'), 'a formula element was emitted');
    assert.ok(xml.includes('t="inlineStr"'), 'cells are not inline strings');
    assert.deepStrictEqual(xlsx.readWorkbook(buf).S1, [dangerous]);
});

test('xlsx handles XML-significant characters', () => {
    const rows = [['<', '&', '>', '"']];
    const buf = xlsx.writeWorkbook([{ name: 'S1', rows }]);
    assert.deepStrictEqual(xlsx.readWorkbook(buf).S1, rows);
});

test('column names convert past Z', () => {
    assert.strictEqual(xlsx.colName(0), 'A');
    assert.strictEqual(xlsx.colName(25), 'Z');
    assert.strictEqual(xlsx.colName(26), 'AA');
    assert.strictEqual(xlsx.colName(701), 'ZZ');
    for (const i of [0, 25, 26, 51, 701, 702]) {
        assert.strictEqual(xlsx.colIndex(xlsx.colName(i)), i);
    }
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

test('csv quotes and unquotes delimiters and quotes', () => {
    const rows = [[',', '"', 'a,b', 'say "hi"', ' pad ']];
    assert.deepStrictEqual(csv.fromCsv(csv.toCsv(rows)), rows);
});

test('csv survives a UTF-8 BOM', () => {
    assert.deepStrictEqual(csv.fromCsv('﻿a,b\n'), [['a', 'b']]);
});

test('csv distinguishes an empty field from a missing one', () => {
    assert.deepStrictEqual(csv.fromCsv('a,,b\n'), [['a', '', 'b']]);
});

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

test('xlsx round trip with no edits is byte-identical', () => {
    const wb = sheet.toWorkbook(SOKOBAN);
    const { game, edits } = sheet.fromWorkbook(SOKOBAN, wb.buffer);
    assert.strictEqual(psgame.applyGridEdits(game, edits), SOKOBAN);
});

test('csv round trip with no edits is byte-identical', () => {
    const text = sheet.toDelimited(SOKOBAN, 'csv');
    const { game, edits } = sheet.fromDelimited(SOKOBAN, text, 'csv');
    assert.strictEqual(psgame.applyGridEdits(game, edits), SOKOBAN);
});

test('a rectangular paste lands as a rectangle', () => {
    // The whole point of the tool: copy a 3x2 block and stamp it elsewhere,
    // overwriting rather than shifting the rest of the row.
    const wb = sheet.toWorkbook(SOKOBAN);
    const sheets = xlsx.readWorkbook(wb.buffer);
    const tab = Object.keys(sheets).find(n => n.startsWith('L00'));
    const cells = sheets[tab];

    // Snapshot a 3x2 block of crates, then stamp it over a patch of open floor.
    const block = [2, 3].map(y => [1, 2, 3].map(x => cells[y][x]));
    assert.deepStrictEqual(block, [['.', '*', '.'], ['.', '.', '*']], 'fixture moved');

    const before = [1, 2].map(y => cells[y].join(''));
    [1, 2].forEach((y, dy) => [1, 2, 3].forEach((x, dx) => { cells[y][x] = block[dy][dx]; }));
    const after = [1, 2].map(y => cells[y].join(''));
    assert.notDeepStrictEqual(after, before, 'the paste changed nothing - test is vacuous');

    const edited = xlsx.writeWorkbook([{ name: tab, rows: cells }]);
    const { game, edits } = sheet.fromWorkbook(SOKOBAN, edited);
    const out = psgame.applyGridEdits(game, edits);

    assert.notStrictEqual(out, SOKOBAN, 'the edit did not reach the game file');

    const grid = psgame.parseGame(out).grids[0];
    assert.strictEqual(grid.width, 9, 'level width changed - the paste shifted content');
    assert.strictEqual(grid.height, 7);
    for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 3; dx++) {
            assert.strictEqual(grid.rows[1 + dy][1 + dx], block[dy][dx],
                `pasted cell (${dy},${dx}) did not land`);
        }
    }
    // Everything outside the pasted rectangle is untouched.
    assert.strictEqual(grid.rows[0], '#########');
    assert.strictEqual(grid.rows[6], '#########');
});

test('a resized level splices without disturbing its neighbours', () => {
    const game = psgame.parseGame(SOKOBAN);
    const taller = ['#####', '#...#', '#.O.#', '#.*.#', '#.P.#', '#####'];
    const out = psgame.applyGridEdits(game, [{ gridIndex: 1, rows: taller }]);
    const after = psgame.parseGame(out);
    assert.strictEqual(after.grids.length, 2);
    assert.deepStrictEqual(after.grids[1].rows, taller);
    // Level 0 and the surrounding commands are unchanged.
    assert.deepStrictEqual(after.grids[0].rows, game.grids[0].rows);
    assert.ok(out.includes('message Thank you for playing.'));
    assert.ok(out.includes('section Harder'));
    assert.ok(out.includes('All Target on Crate'), 'a later section was damaged');
});

test('shrinking a level does not merge lines', () => {
    const game = psgame.parseGame(SOKOBAN);
    const out = psgame.applyGridEdits(game, [{ gridIndex: 1, rows: ['###', '#P#', '###'] }]);
    const after = psgame.parseGame(out);
    assert.deepStrictEqual(after.grids[1].rows, ['###', '#P#', '###']);
    assert.strictEqual(after.grids.length, 2);
});

test('editing two levels at once keeps both correct', () => {
    const game = psgame.parseGame(SOKOBAN);
    const out = psgame.applyGridEdits(game, [
        { gridIndex: 0, rows: ['###', '#P#', '###'] },
        { gridIndex: 1, rows: ['#####', '#...#', '#.O.#', '#.*.#', '#.P.#', '#####'] },
    ]);
    const after = psgame.parseGame(out);
    assert.deepStrictEqual(after.grids[0].rows, ['###', '#P#', '###']);
    assert.strictEqual(after.grids[1].height, 6);
});

test('ragged levels are left ragged when untouched', () => {
    const ragged = SOKOBAN.replace('#.*.*.O.#\n', '#.*.*.O\n');
    const wb = sheet.toWorkbook(ragged);
    const { game, edits } = sheet.fromWorkbook(ragged, wb.buffer);
    assert.strictEqual(psgame.applyGridEdits(game, edits), ragged);
});

test('an empty cell becomes the background character, with a warning', () => {
    const warnings = [];
    const rows = sheet.cellsToRows([['#', '', '#']], '.', null, 'test', warnings);
    assert.deepStrictEqual(rows, ['#.#']);
    assert.strictEqual(warnings.length, 1);
    assert.ok(warnings[0].includes('empty cell'));
});

test('an unknown glyph is reported but preserved', () => {
    const warnings = [];
    const rows = sheet.cellsToRows([['#', 'Z', '#']], '.', ch => ({ '#': {} })[ch], 'test', warnings);
    assert.deepStrictEqual(rows, ['#Z#']);
    assert.ok(warnings.some(w => w.includes('not in the legend')));
});

test('level tab names are legal Excel sheet names', () => {
    const name = sheet.levelTabName(3, {
        commandsBefore: [{ verb: 'level', text: 'A really long level name that goes on and on/with slashes' }],
    });
    assert.ok(name.length <= 31, `sheet name too long: ${name}`);
    assert.ok(!/[:\\/?*[\]]/.test(name), `illegal characters in ${name}`);
    assert.ok(name.startsWith('L03'));
});

// ---------------------------------------------------------------------------
// REXPaint
// ---------------------------------------------------------------------------

test('xp files match the published binary layout', () => {
    const cells = [
        { code: 65, fg: { r: 1, g: 2, b: 3 }, bg: { r: 4, g: 5, b: 6 } },
        { code: 66, fg: { r: 7, g: 8, b: 9 }, bg: { r: 10, g: 11, b: 12 } },
        { code: 67, fg: { r: 0, g: 0, b: 0 }, bg: { r: 0, g: 0, b: 0 } },
        { code: 68, fg: { r: 0, g: 0, b: 0 }, bg: { r: 0, g: 0, b: 0 } },
    ];
    const buf = rexpaint.writeXp([{ width: 2, height: 2, cells }]);
    const raw = zlib.gunzipSync(buf);

    assert.strictEqual(raw.readInt32LE(0), -1, 'version field');
    assert.strictEqual(raw.readInt32LE(4), 1, 'layer count');
    assert.strictEqual(raw.readInt32LE(8), 2, 'width');
    assert.strictEqual(raw.readInt32LE(12), 2, 'height');
    assert.strictEqual(raw.length, 16 + 4 * 10, 'ten bytes per cell');
    // Column-major: after (0,0) comes (0,1), not (1,0).
    assert.strictEqual(raw.readUInt32LE(16), 65);
    assert.strictEqual(raw.readUInt32LE(26), 67);

    const back = rexpaint.readXp(buf);
    assert.strictEqual(back.length, 1);
    assert.deepStrictEqual(back[0].cells.map(c => c.code), [65, 66, 67, 68]);
    assert.deepStrictEqual(back[0].cells[0].bg, { r: 4, g: 5, b: 6 });
});

test('xp reader rejects a file that is not an xp', () => {
    assert.throws(() => rexpaint.readXp(Buffer.from('not compressed at all')),
        /could not decompress/);
});

test('xp reader accepts pre-R9 files with no version field', () => {
    // A positive first int32 is the layer count, not a version.
    const body = Buffer.alloc(4 + 8 + 10);
    body.writeInt32LE(1, 0);
    body.writeInt32LE(1, 4);
    body.writeInt32LE(1, 8);
    body.writeUInt32LE(88, 12);
    const layers = rexpaint.readXp(zlib.gzipSync(body));
    assert.strictEqual(layers[0].cells[0].code, 88);
});

test('rexpaint round trip with no edits is byte-identical', () => {
    const { files, sidecar } = rexbridge.toRexFiles(SOKOBAN);
    assert.strictEqual(files.length, 2);
    assert.deepStrictEqual(files.map(f => f.name), ['L00.xp', 'L01.xp']);
    const { game, edits } = rexbridge.fromRexFiles(SOKOBAN, files, sidecar);
    assert.strictEqual(psgame.applyGridEdits(game, edits), SOKOBAN);
});

test('a rectangle painted in an xp file lands back in the level', () => {
    const { files, sidecar } = rexbridge.toRexFiles(SOKOBAN);
    const layers = rexpaint.readXp(files[0].buffer);
    const layer = layers[0];
    const crate = sidecar.codeToChar[42] !== undefined ? 42 : null;
    assert.ok(crate, 'the crate glyph "*" should sit on its natural CP437 code');

    // Stamp a 3x2 rectangle of crates over open floor.
    for (let y = 1; y <= 2; y++) {
        for (let x = 1; x <= 3; x++) layer.cells[y * layer.width + x].code = crate;
    }
    const edited = [{ name: 'L00.xp', buffer: rexpaint.writeXp(layers) }];
    const { game, edits } = rexbridge.fromRexFiles(SOKOBAN, edited, sidecar);
    const grid = psgame.parseGame(psgame.applyGridEdits(game, edits)).grids[0];

    assert.strictEqual(grid.width, 9);
    assert.strictEqual(grid.rows[1], '#***....#');
    // Row 2 already had a crate at column 4, which the rectangle does not cover.
    assert.strictEqual(grid.rows[2], '#****.O.#');
    assert.strictEqual(grid.rows[0], '#########', 'a row outside the rectangle changed');
    assert.strictEqual(grid.rows[3], '#..*..O.#', 'a row below the rectangle changed');
});

test('resizing the xp canvas resizes the level', () => {
    const { files, sidecar } = rexbridge.toRexFiles(SOKOBAN);
    const layer = rexpaint.readXp(files[1].buffer)[0];
    const wall = sidecar.codeToChar[35] !== undefined ? 35 : null;
    assert.ok(wall, 'the wall glyph "#" should sit on its natural CP437 code');

    // Rebuild as a 3x3 canvas of walls.
    const small = {
        width: 3, height: 3,
        cells: Array.from({ length: 9 }, () => ({
            code: wall, fg: { r: 255, g: 255, b: 255 }, bg: { r: 0, g: 0, b: 0 },
        })),
    };
    const { game, edits } = rexbridge.fromRexFiles(
        SOKOBAN, [{ name: 'L01.xp', buffer: rexpaint.writeXp([small]) }], sidecar);
    const out = psgame.applyGridEdits(game, edits);
    const after = psgame.parseGame(out);
    assert.deepStrictEqual(after.grids[1].rows, ['###', '###', '###']);
    assert.deepStrictEqual(after.grids[0].rows, psgame.parseGame(SOKOBAN).grids[0].rows);
    assert.ok(out.includes('message Thank you for playing.'));
});

test('lower-case grid characters survive a case-insensitive game', () => {
    // `Wall W` in OBJECTS, but the level writes 'w'. Both must round-trip and
    // both must be coloured.
    const src = SOKOBAN.replace('#####\n#.O.#\n#.*.#\n#.P.#\n#####',
        'wwwww\nw.O.w\nw.*.w\nw.P.w\nwwwww');
    assert.ok(src.includes('wwwww'), 'fixture replacement did not apply');

    const { glyphAt } = sheet.analyse(src);
    assert.ok(glyphAt('w'), 'lower-case w should resolve to the Wall glyph');
    assert.strictEqual(glyphAt('w').color, glyphAt('W').color);

    const { files, sidecar } = rexbridge.toRexFiles(src);
    const { game, edits } = rexbridge.fromRexFiles(src, files, sidecar);
    assert.strictEqual(psgame.applyGridEdits(game, edits), src);
});

test('glyphs outside code page 437 get a substitute code that maps back', () => {
    const glyphs = { '#': {}, 'あ': {}, 'い': {} };
    const map = rexbridge.buildGlyphMap(glyphs, new Set(['#', 'あ', 'い']));
    assert.strictEqual(map.charToCode['#'], 35, 'ASCII should keep its natural code');
    assert.strictEqual(map.unmapped.length, 2);
    for (const ch of ['あ', 'い']) {
        assert.strictEqual(map.codeToChar[map.charToCode[ch]], ch);
    }
    // No two characters may share a code.
    const codes = Object.values(map.charToCode);
    assert.strictEqual(new Set(codes).size, codes.length, 'two glyphs collided on one code');
});

test('rexpaint round trip works without a sidecar for an ASCII legend', () => {
    const { files } = rexbridge.toRexFiles(SOKOBAN);
    const { game, edits } = rexbridge.fromRexFiles(SOKOBAN, files, null);
    assert.strictEqual(psgame.applyGridEdits(game, edits), SOKOBAN);
});

// ---------------------------------------------------------------------------
// Every demo game in the upstream repo, if present
// ---------------------------------------------------------------------------

test('all upstream demo games round-trip unchanged', () => {
    const demoDir = path.join(__dirname, '..', '..', 'src', 'demo');
    if (!fs.existsSync(demoDir)) return; // standalone checkout, nothing to test against

    const files = fs.readdirSync(demoDir).filter(f => f.endsWith('.txt'));
    const broken = [];
    for (const f of files) {
        const src = fs.readFileSync(path.join(demoDir, f), 'utf8');
        try {
            const wb = sheet.toWorkbook(src);
            const { game, edits } = sheet.fromWorkbook(src, wb.buffer);
            if (psgame.applyGridEdits(game, edits) !== src) broken.push(`${f} (xlsx)`);
        } catch (e) {
            broken.push(`${f} (xlsx threw: ${e.message})`);
        }
        try {
            const { files: xps, sidecar } = rexbridge.toRexFiles(src);
            const { game, edits } = rexbridge.fromRexFiles(src, xps, sidecar);
            if (psgame.applyGridEdits(game, edits) !== src) broken.push(`${f} (xp)`);
        } catch (e) {
            broken.push(`${f} (xp threw: ${e.message})`);
        }
    }
    assert.deepStrictEqual(broken, [], `${broken.length} failures across ${files.length} games`);
});

// ---------------------------------------------------------------------------

for (const { name, error } of failures) {
    process.stdout.write(`FAIL  ${name}\n      ${error.message.split('\n')[0]}\n`);
}
process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length ? 1 : 0);
