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

test('builds a glyph table from both the legend and object aliases', () => {
    const { glyphs } = sheet.analyse(SOKOBAN);
    assert.strictEqual(glyphs['P'].source, 'legend');
    assert.strictEqual(glyphs['W'].source, 'objects', 'a single-letter alias should be placeable');
    // Case-insensitive game: 'p' must not appear as a separate tile.
    assert.ok(!glyphs['p'], 'lower-case duplicate glyph leaked through');
});

test('a legend entry beats an object alias for the same character', () => {
    // Declaring `Crate C` and then `C = Crate and Target` is legal; the legend
    // is the more deliberate statement, so it should win.
    const src = SOKOBAN
        .replace('Crate\nOrange Yellow', 'Crate C\nOrange Yellow')
        .replace('O = Target', 'O = Target\nC = Crate and Target');
    const { glyphs } = sheet.analyse(src);
    assert.strictEqual(glyphs['C'].source, 'legend');
    assert.deepStrictEqual(glyphs['C'].objects, ['Crate', 'Target']);
});

test('a legend key may itself be an equals sign', () => {
    // `= = Equals` is legal, and splitting the line on its first '=' loses it.
    const src = fs.readFileSync(path.join(FIXTURES, 'formulaglyphs.txt'), 'utf8');
    const { glyphs } = sheet.analyse(src);
    for (const ch of ['=', '+', '-', '@', ',', '"', '\\']) {
        assert.ok(glyphs[ch], `glyph "${ch}" missing from the legend`);
    }
    assert.strictEqual(glyphs['='].label, 'Equals');
});

test('case_sensitive keeps P and p as separate tiles', () => {
    const src = fs.readFileSync(path.join(FIXTURES, 'casesensitive.txt'), 'utf8');
    const { game, glyphs, glyphAt } = sheet.analyse(src);
    assert.strictEqual(game.caseSensitive, true);
    assert.ok(glyphs['P'] && glyphs['p'], 'both cases should be placeable');
    assert.notStrictEqual(glyphAt('P').label, glyphAt('p').label);
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

test('a map is labelled by the nearest heading, not the first', () => {
    // Empty SECTIONs leave their commands stacked in front of the next grid.
    // Taking the first of that stack labels the map several headings too early.
    const src = fs.readFileSync(path.join(FIXTURES, 'emptysections.txt'), 'utf8');
    const game = psgame.parseGame(src);
    const withGrids = game.levels.filter(l => l.grid);

    assert.strictEqual(withGrids.length, 3, 'three maps in the fixture');
    assert.deepStrictEqual(
        withGrids.map(l => psgame.labelForCommands(l.commandsBefore)),
        ['0', '1', '3'],
        'the third map sits under "section 3", after two empty "section 2" headings');

    // The stack really is there - this is not a fixture that trivially passes.
    assert.strictEqual(withGrids[2].commandsBefore.filter(c => c.verb === 'section').length, 3);
});

test('empty sections are reported so the numbering can be explained', () => {
    const src = fs.readFileSync(path.join(FIXTURES, 'emptysections.txt'), 'utf8');
    const game = psgame.parseGame(src);
    const withGrids = game.levels.filter(l => l.grid);

    // Two placeholder "2" headings sit before the third map.
    assert.deepStrictEqual(
        psgame.orphanLabels(withGrids[2].commandsBefore, true), ['2', '2']);
    // Headings after the last map own nothing at all.
    const last = game.levels[game.levels.length - 1];
    assert.deepStrictEqual(psgame.orphanLabels(last.commandsAfter, false), ['4', '5']);
    // And a heading that does own a grid is not reported as an orphan.
    assert.deepStrictEqual(psgame.orphanLabels(withGrids[0].commandsBefore, true), []);
});

test('an empty section reports where a new map would go', () => {
    const src = fs.readFileSync(path.join(FIXTURES, 'emptysections.txt'), 'utf8');
    const game = psgame.parseGame(src);
    const withGrids = game.levels.filter(l => l.grid);

    const empties = psgame.emptySections(withGrids[2].commandsBefore, true);
    assert.deepStrictEqual(empties.map(e => e.label), ['2', '2']);
    // Each insertion point is that section's own last command, so a grid lands
    // directly beneath the heading it belongs to.
    for (const e of empties) {
        assert.match(game.lines[e.lastLine].trim(), /^message/i);
        assert.match(game.lines[e.lastLine - 1].trim(), /^section 2/i);
    }
});

test('a map can be inserted into a section that had none', () => {
    const src = fs.readFileSync(path.join(FIXTURES, 'emptysections.txt'), 'utf8');
    const game = psgame.parseGame(src);
    const target = psgame.emptySections(
        game.levels.filter(l => l.grid)[2].commandsBefore, true)[0];

    const rows = ['#####', '#.p.#', '#####'];
    const out = psgame.applyGridEdits(game, [{ insertAfterLine: target.lastLine, rows }]);
    const after = psgame.parseGame(out);

    assert.strictEqual(after.grids.length, game.grids.length + 1,
        'the file should have gained exactly one grid');
    // It lands under the right heading, and the numbering now runs 0,1,2,3.
    assert.deepStrictEqual(
        after.levels.filter(l => l.grid).map(l => psgame.labelForCommands(l.commandsBefore)),
        ['0', '1', '2', '3']);
    const inserted = after.grids.find(g => g.rows.join('\n') === rows.join('\n'));
    assert.ok(inserted, 'the inserted rows should be readable back as a grid');
    // Every pre-existing grid survives untouched.
    for (const g of game.grids) {
        assert.ok(after.grids.some(h => h.rows.join('\n') === g.rows.join('\n')),
            `original grid ${g.rows[0]} went missing`);
    }
});

test('inserting and replacing in one pass keeps both correct', () => {
    // The two operations interleave by line number, so applying them in the
    // wrong order would corrupt whichever came first in the file.
    const src = fs.readFileSync(path.join(FIXTURES, 'emptysections.txt'), 'utf8');
    const game = psgame.parseGame(src);
    const target = psgame.emptySections(
        game.levels.filter(l => l.grid)[2].commandsBefore, true)[0];

    const out = psgame.applyGridEdits(game, [
        { gridIndex: 0, rows: ['@@@@@', '@@@@@'] },
        { insertAfterLine: target.lastLine, rows: ['#####', '#.p.#', '#####'] },
        { gridIndex: 2, rows: ['.........'] },
    ]);
    const after = psgame.parseGame(out);
    assert.strictEqual(after.grids.length, 4);
    assert.deepStrictEqual(after.grids[0].rows, ['@@@@@', '@@@@@']);
    assert.deepStrictEqual(after.grids[2].rows, ['#####', '#.p.#', '#####']);
    assert.deepStrictEqual(after.grids[3].rows, ['.........']);
});

test('inserting preserves CRLF line endings', () => {
    const crlf = fs.readFileSync(path.join(FIXTURES, 'emptysections.txt'), 'utf8')
        .replace(/\n/g, '\r\n');
    const game = psgame.parseGame(crlf);
    const target = psgame.emptySections(
        game.levels.filter(l => l.grid)[2].commandsBefore, true)[0];
    const out = psgame.applyGridEdits(game, [{ insertAfterLine: target.lastLine, rows: ['###'] }]);
    assert.ok(!/[^\r]\n/.test(out), 'a bare LF crept into a CRLF file');
    assert.strictEqual(psgame.parseGame(out).grids.length, game.grids.length + 1);
});

test('an insert with no rows is ignored', () => {
    const src = fs.readFileSync(path.join(FIXTURES, 'emptysections.txt'), 'utf8');
    const game = psgame.parseGame(src);
    assert.strictEqual(psgame.applyGridEdits(game, [{ insertAfterLine: 5, rows: [] }]), src);
});

test('an edit with neither a gridIndex nor an insert point is rejected', () => {
    const game = psgame.parseGame(SOKOBAN);
    assert.throws(() => psgame.applyGridEdits(game, [{ rows: ['##'] }]),
        /gridIndex, an insertAfterLine or a startLine/);
});

test('a LEVEL command outranks the SECTION it sits under', () => {
    const cmds = [
        { verb: 'section', text: 'Chapter One' },
        { verb: 'level', text: 'The Bridge' },
    ];
    assert.strictEqual(psgame.labelForCommands(cmds), 'The Bridge');
    assert.strictEqual(psgame.labelForCommands([]), '');
    assert.strictEqual(psgame.labelForCommands([{ verb: 'message', text: 'hi' }]), '');
});

test('worksheet tabs use the nearest heading too', () => {
    const src = fs.readFileSync(path.join(FIXTURES, 'emptysections.txt'), 'utf8');
    const { game } = sheet.analyse(src);
    const tabs = game.levels.filter(l => l.grid)
        .map((l, i) => sheet.levelTabName(i, l));
    assert.deepStrictEqual(tabs, ['L00 0', 'L01 1', 'L02 3']);
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

function sweepRoundTrip(files, label) {
    const broken = [];
    for (const file of files) {
        const src = fs.readFileSync(file, 'utf8');
        const name = path.basename(file);
        try {
            const wb = sheet.toWorkbook(src);
            const { game, edits } = sheet.fromWorkbook(src, wb.buffer);
            if (psgame.applyGridEdits(game, edits) !== src) broken.push(`${name} (xlsx)`);
        } catch (e) {
            broken.push(`${name} (xlsx threw: ${e.message})`);
        }
        try {
            const { files: xps, sidecar } = rexbridge.toRexFiles(src);
            const { game, edits } = rexbridge.fromRexFiles(src, xps, sidecar);
            if (psgame.applyGridEdits(game, edits) !== src) broken.push(`${name} (xp)`);
        } catch (e) {
            broken.push(`${name} (xp threw: ${e.message})`);
        }
        try {
            const text = sheet.toDelimited(src, 'csv');
            const { game, edits } = sheet.fromDelimited(src, text, 'csv');
            if (psgame.applyGridEdits(game, edits) !== src) broken.push(`${name} (csv)`);
        } catch (e) {
            broken.push(`${name} (csv threw: ${e.message})`);
        }
    }
    assert.deepStrictEqual(broken, [],
        `${broken.length} failures across ${files.length} ${label}`);
}

test('vendored real games round-trip unchanged', () => {
    // These ship with the repo, so this runs everywhere including CI.
    const dir = path.join(FIXTURES, 'games');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.txt')).map(f => path.join(dir, f));
    assert.ok(files.length >= 8, `expected the vendored corpus, found ${files.length} files`);
    sweepRoundTrip(files, 'vendored games');
});

test('synthetic edge-case fixtures round-trip unchanged', () => {
    const files = fs.readdirSync(FIXTURES)
        .filter(f => f.endsWith('.txt'))
        .map(f => path.join(FIXTURES, f));
    assert.ok(files.length >= 3, `expected the synthetic fixtures, found ${files.length}`);
    sweepRoundTrip(files, 'fixtures');
});

test('all upstream demo games round-trip unchanged', () => {
    // Only present when checked out next to PuzzleScriptNext; the vendored
    // corpus above is what guarantees coverage on its own.
    const demoDir = path.join(__dirname, '..', '..', 'src', 'demo');
    if (!fs.existsSync(demoDir)) return;
    const files = fs.readdirSync(demoDir).filter(f => f.endsWith('.txt'))
        .map(f => path.join(demoDir, f));
    sweepRoundTrip(files, 'upstream demo games');
});


// ---------------------------------------------------------------------------
// PuzzleScript Next dialect
// ---------------------------------------------------------------------------

const NEXT = fs.readFileSync(path.join(FIXTURES, 'nextsyntax.txt'), 'utf8');

test('the comment style is decided by the first real comment', () => {
    // A `//` inside a text-valued prelude line is not a comment.
    assert.strictEqual(psgame.detectCommentStyle(['homepage https://x.y/z', '// hello']), '//');
    assert.strictEqual(psgame.detectCommentStyle(['title a (b)', '(c)']), '()');
    assert.strictEqual(psgame.detectCommentStyle(['Wall // brown']), '//');
    assert.strictEqual(psgame.detectCommentStyle(['x(y)']), '()');
    assert.strictEqual(psgame.detectCommentStyle(['Wall', 'Brown']), '()');
});

test('in the // style parentheses are text and // is stripped', () => {
    const stripped = psgame.stripComments(['a // b', '(c) d', 'https://e'], '//');
    assert.strictEqual(stripped[0].code, 'a');
    assert.strictEqual(stripped[1].code, '(c) d');
    assert.strictEqual(stripped[2].code, 'https://e');
});

test('reads every shape of Next object header', () => {
    let h = psgame.parseObjectHeader('Roach:right e; Black LightBrown Yellow', '//');
    assert.strictEqual(h.name, 'Roach:right');
    assert.deepStrictEqual(h.aliases, ['e']);
    assert.strictEqual(h.inlineColors, 'Black LightBrown Yellow');

    h = psgame.parseObjectHeader('MergedRoach N E S W', '()');
    assert.deepStrictEqual(h.aliases, ['N', 'E', 'S', 'W']);
    assert.strictEqual(h.inlineColors, null);

    h = psgame.parseObjectHeader('Shadow copy:Wall rot:right; Black', '//');
    assert.deepStrictEqual(h.aliases, []);
    assert.strictEqual(h.copyFrom, 'Wall');
    assert.strictEqual(h.hasTransforms, true);

    // In the classic style a semicolon is just another glyph, and so are the
    // Pattern:Script mirror characters when they sit on the header line.
    h = psgame.parseObjectHeader('Semi ;', '()');
    assert.deepStrictEqual(h.aliases, [';']);
    h = psgame.parseObjectHeader('Pipe | -', '()');
    assert.deepStrictEqual(h.aliases, ['|', '-']);
});

test('a tagged header defines one object per tag value, sharing the sprite', () => {
    const game = psgame.parseGame(NEXT);
    for (const d of ['up', 'right', 'down', 'left']) {
        const obj = game.objects[`ghost:${d}`];
        assert.ok(obj, `Ghost:${d} missing`);
        assert.strictEqual(obj.sprite, game.blocks.find(b => b.name === 'Ghost:directions').sprite);
    }
    assert.deepStrictEqual(game.properties['ghost:directions'],
        ['Ghost:up', 'Ghost:right', 'Ghost:down', 'Ghost:left']);
    // The TAGS section is read, on top of the built-in directions.
    assert.deepStrictEqual(game.tags.shade, ['faint', 'dim', 'deep', 'full']);
    assert.deepStrictEqual(psgame.expandTaggedName('Dark:Shade', game.tags),
        ['Dark:faint', 'Dark:dim', 'Dark:deep', 'Dark:full']);
    assert.deepStrictEqual(psgame.expandTaggedName('Wall', game.tags), ['Wall']);
});

test('one-line objects need no blank line between them', () => {
    const game = psgame.parseGame(NEXT);
    assert.deepStrictEqual(game.objects['dark:dim'].colors, ['#00002A58']);
    assert.deepStrictEqual(game.objects['dark:full'].colors, ['#00002AA8']);
    assert.deepStrictEqual(game.objects.night.colors, ['transparent']);
    assert.strictEqual(game.objects['dark:full'].sprite, null);
});

test('copy: takes the source object\'s sprite', () => {
    const game = psgame.parseGame(NEXT);
    assert.strictEqual(game.objects.shadow.sprite, game.objects.wall.sprite);
    assert.deepStrictEqual(game.objects.shadow.colors, ['Black']);
});

test('several single-character aliases on one header all map to the object', () => {
    const { glyphs } = sheet.analyse(NEXT);
    for (const ch of ['N', 'E', 'S', 'W']) {
        assert.strictEqual(glyphs[ch].label, 'MergedRoach');
        assert.strictEqual(glyphs[ch].renders[0].name, 'MergedRoach');
    }
});

test('tag classes and properties resolve wherever a name may appear', () => {
    const game = psgame.parseGame(NEXT);
    assert.deepStrictEqual(psgame.resolveNames(game, 'Roach:directions'),
        ['Roach:up', 'Roach:right', 'Roach:down', 'Roach:left']);
    assert.deepStrictEqual(psgame.resolveNames(game, 'Opaque'),
        ['Wall', 'MergedRoach', 'Ghost:up', 'Ghost:right', 'Ghost:down', 'Ghost:left']);
    assert.deepStrictEqual(psgame.resolveNames(game, 'player'), ['Witch:down']);
    assert.deepStrictEqual(psgame.resolveNames(game, 'nosuchthing'), []);
    // Through the collision layers, past the `--` divider.
    assert.strictEqual(game.collisionLayers.length, 5);
    assert.strictEqual(game.layerIndex.get('ghost:up'), 3);
    assert.strictEqual(game.layerIndex.get('dark:deep'), 4);
    assert.strictEqual(game.layerIndex.get('roach:left'), 3);
});

test('a // comment under a section heading is not a level row', () => {
    const game = psgame.parseGame(NEXT);
    assert.strictEqual(game.grids.length, 2);
    assert.strictEqual(game.grids[0].width, 9);
    assert.strictEqual(game.grids[0].height, 7);
    assert.strictEqual(game.grids[0].rows[0], '#########');
    assert.strictEqual(psgame.labelForCommands(game.levels[0].commandsBefore), 'Footfall');
});

test('the Next fixture leaves no glyph unexplained', () => {
    const { game, glyphs, background } = sheet.analyse(NEXT);
    assert.deepStrictEqual(psgame.unknownGlyphs(game, glyphs), []);
    assert.strictEqual(background, '.');
    assert.strictEqual(game.commentStyle, '//');
    assert.strictEqual(game.caseSensitive, true);
    // Every glyph the levels use has something to draw.
    for (const ch of ['e', 'w', 'n', 's', 'x', 'o', 'P', '*', '#', '.']) {
        assert.ok(glyphs[ch], `glyph ${ch} missing`);
        assert.ok(glyphs[ch].renders.length, `glyph ${ch} draws nothing`);
    }
    // An AND of two objects stacks them in collision-layer order.
    assert.deepStrictEqual(glyphs.x.renders.map(r => r.name), ['Night', 'Nest']);
});

test('a legend property draws as its first member rather than a red cross', () => {
    const { glyphs } = sheet.analyse(NEXT);
    assert.strictEqual(glyphs.r.label, 'Roach:directions');
    assert.deepStrictEqual(glyphs.r.renders.map(r => r.name), ['Roach:up']);
    assert.ok(glyphs.r.color);
});

test('alpha colours keep their alpha for drawing but not for fills', () => {
    assert.strictEqual(psgame.resolveColor('#00002a80', {}, true), '#00002A80');
    assert.strictEqual(psgame.resolveColor('#00002a80', {}), '#00002A');
    assert.strictEqual(psgame.resolveColor('#123f', {}, true), '#112233FF');
    assert.strictEqual(psgame.resolveColor('#123f', {}), '#112233');
    const { glyphs } = sheet.analyse(NEXT);
    // The swatch colour of a translucent object is its opaque part.
    const game = psgame.parseGame(NEXT);
    assert.strictEqual(psgame.buildGlyphTable(game, {})['*'].color, null);
    assert.ok(glyphs['.'].color.length === 7);
});

test('sprite_size is read from the prelude', () => {
    assert.strictEqual(psgame.parseGame('title T\nsprite_size 10\n').spriteSize, 10);
    assert.strictEqual(psgame.parseGame(SOKOBAN).spriteSize, 5);
});

test('sprite rows carry their source line ranges', () => {
    const game = psgame.parseGame(NEXT);
    const wall = game.blocks.find(b => b.name === 'Wall');
    assert.strictEqual(wall.spriteLines.length, 5);
    assert.strictEqual(game.lines[wall.spriteLines[0]], '22222');
    assert.strictEqual(game.lines[wall.headerLine], 'Wall #; DarkGrey Grey LightGrey');
    // An object with no matrix says where one would go.
    const night = game.blocks.find(b => b.name === 'Night');
    assert.deepStrictEqual(night.spriteLines, []);
    assert.strictEqual(game.lines[night.spriteInsertAfterLine], 'Night; transparent');
    // The classic layout too: header, colours, then the rows.
    const classic = psgame.parseGame(SOKOBAN);
    const player = classic.blocks.find(b => b.name === 'Player');
    assert.strictEqual(player.spriteLines.length, 5);
    assert.strictEqual(player.spriteLines[0], player.headerLine + 2);
});

test('an edited sprite splices back into OBJECTS and nothing else moves', () => {
    const game = psgame.parseGame(NEXT);
    const wall = game.blocks.find(b => b.name === 'Wall');
    const rows = ['11111', '10001', '10001', '10001', '11111'];
    const out = psgame.applyGridEdits(game, [
        { startLine: wall.spriteLines[0], lineCount: wall.spriteLines.length, rows },
    ]);
    const again = psgame.parseGame(out);
    assert.deepStrictEqual(again.objects.wall.sprite.pixels[1], [1, 0, 0, 0, 1]);
    assert.deepStrictEqual(again.grids.map(g => g.rows), game.grids.map(g => g.rows));
    // Only the five rows differ.
    const a = NEXT.split('\n'), b = out.split('\n');
    assert.strictEqual(a.length, b.length);
    const changed = a.map((l, i) => (l === b[i] ? null : i)).filter(i => i !== null);
    assert.deepStrictEqual(changed, wall.spriteLines);
    // A matrix can be given to an object that had none.
    const night = game.blocks.find(b => b.name === 'Night');
    const out2 = psgame.applyGridEdits(game, [
        { startLine: night.spriteInsertAfterLine + 1, lineCount: 0, rows: ['0....', '.0...', '..0..', '...0.', '....0'] },
    ]);
    assert.strictEqual(psgame.parseGame(out2).objects.night.sprite.height, 5);
});

test('Charmroach parses cleanly when it is checked out beside the engine', () => {
    // The game this dialect support was written for. Its repository sits next
    // to PuzzleScriptNext in the author's layout and in charmroach's own CI;
    // anywhere else this is skipped, the way the demo sweep is.
    const file = path.join(__dirname, '..', '..', '..', 'charmroach', 'charmroach.txt');
    if (!fs.existsSync(file)) return;
    const source = fs.readFileSync(file, 'utf8');
    const { game, glyphs, background, resolved } = sheet.analyse(source);
    assert.strictEqual(game.commentStyle, '//');
    assert.strictEqual(resolved.known, true, 'its palette must be one this build carries');
    assert.deepStrictEqual(psgame.unknownGlyphs(game, glyphs), []);
    assert.ok(game.grids.length >= 9);
    assert.strictEqual(background, '.');
    for (const [ch, g] of Object.entries(glyphs)) {
        assert.ok(g.renders.length, `glyph ${ch} (${g.label}) resolves to no object`);
    }
    // The whole family arrived, not just the first roach.
    for (const d of ['up', 'right', 'down', 'left']) assert.ok(game.objects[`roach:${d}`]);
    assert.ok(game.objects['dark:full']);
    sweepRoundTrip([file], 'charmroach');
});


test('psmap check passes a sound game and names what is wrong with a broken one', () => {
    const { checkGame } = require('../src/cli');
    assert.deepStrictEqual(checkGame(NEXT), []);
    assert.deepStrictEqual(checkGame(SOKOBAN), []);
    // A glyph the legend does not know, and a palette this build lacks.
    const broken = SOKOBAN.replace('color_palette arnecolors', 'color_palette nosuch').replace('#.*.*.O.#', '#.*.?.O.#');
    const problems = checkGame(broken);
    assert.ok(problems.some(p => p.includes('"?"')), problems.join('\n'));
    assert.ok(problems.some(p => p.includes('nosuch')), problems.join('\n'));
});

test('psmap check expands a glob the shell left behind', () => {
    const { expandGlobs } = require('../src/cli');
    // cmd.exe and PowerShell pass `fixtures/*.txt` through verbatim; bash does not.
    const hits = expandGlobs([path.join(FIXTURES, '*.txt')]);
    assert.ok(hits.length >= 1, 'expected at least one fixture game');
    assert.ok(hits.every(f => fs.existsSync(f)), hits.join(', '));
    assert.ok(hits.some(f => path.basename(f) === 'sokoban.txt'), hits.join(', '));
    // Ordinary paths are untouched, and a pattern that matches nothing is kept
    // as typed so the "No such file" message still names it.
    const plain = path.join(FIXTURES, 'sokoban.txt');
    assert.deepStrictEqual(expandGlobs([plain]), [plain]);
    assert.deepStrictEqual(expandGlobs(['nowhere-at-all/*.txt']), ['nowhere-at-all/*.txt']);
});

test('a palette exports as the same portable block the engine produces', () => {
    const palettes = require('../src/palettes');
    const block = palettes.paletteToPreludeBlock('ruststorm');
    assert.ok(block.startsWith('color_palette arnecolors black '));
    // 24 names: 21 slots plus the three gray spellings.
    assert.strictEqual(block.split(/\s+/).length, 2 + 24 * 2);
    const list = palettes.paletteList();
    assert.strictEqual(list[0].name, 'mastersystem');
    assert.deepStrictEqual(list.find(p => p.name === 'ruststorm'), { index: 20, name: 'ruststorm' });
    assert.strictEqual(palettes.PALETTE_SLOTS.length, 21);
});


// ---------------------------------------------------------------------------
// Colour palettes
// ---------------------------------------------------------------------------

const palettes = require('../src/palettes');

function gameWithPalette(line) {
    return [
        'title T', line, '',
        '===', 'OBJECTS', '===', '',
        'Background', 'green', '', 'Wall', 'black', '',
        '===', 'LEGEND', '===', '', '. = Background', '# = Wall', '',
        '===', 'LEVELS', '===', '', '..#', '.#.', '',
    ].join('\n');
}

test('a plain palette name resolves', () => {
    const r = palettes.resolvePalette({ name: 'mastersystem', overrides: [] });
    assert.strictEqual(r.known, true);
    assert.strictEqual(r.palette.black, '#000000');
});

test('numeric palette aliases resolve', () => {
    // These were defined and never consulted, so every numbered palette
    // silently rendered as arnecolors.
    const r = palettes.resolvePalette({ name: '3', overrides: [] });
    assert.strictEqual(r.resolved, 'amiga');
    assert.strictEqual(r.palette.green, palettes.colorPalettes.amiga.green);
});

test('an unknown palette name falls back to arnecolors and says so', () => {
    const r = palettes.resolvePalette({ name: 'nosuchpalette', overrides: [] });
    assert.strictEqual(r.known, false);
    assert.strictEqual(r.palette.black, palettes.colorPalettes.arnecolors.black);
    assert.ok(/unknown here/.test(palettes.describePalette(r)));
});

test('inline overrides are applied', () => {
    const spec = psgame.findPaletteSpec(psgame.parseGame(
        gameWithPalette('color_palette arnecolors black #292f25 green #4c8149')));
    assert.deepStrictEqual(spec.overrides,
        [['black', '#292f25'], ['green', '#4c8149']]);
    const r = palettes.resolvePalette(spec);
    assert.strictEqual(r.applied, 2);
    assert.strictEqual(r.palette.black, '#292F25');
    assert.strictEqual(r.palette.green, '#4C8149');
});

test('an override value may name another colour', () => {
    const r = palettes.resolvePalette(
        { name: 'arnecolors', overrides: [['green', 'blue']] });
    assert.strictEqual(r.palette.green, palettes.colorPalettes.arnecolors.blue);
});

test('an override of a slot that does not exist is reported, not applied', () => {
    const r = palettes.resolvePalette(
        { name: 'arnecolors', overrides: [['chartreuse', '#123456']] });
    assert.strictEqual(r.applied, 0);
    assert.deepStrictEqual(r.unknownKeys, ['chartreuse']);
});

test('grey and gray stay separate keys', () => {
    // The engine treats them as separate, so overriding one must not move the
    // other - a viewer that aliased them would disagree with the game.
    const r = palettes.resolvePalette(
        { name: 'arnecolors', overrides: [['grey', '#123456']] });
    assert.strictEqual(r.palette.grey, '#123456');
    assert.strictEqual(r.palette.gray, palettes.colorPalettes.arnecolors.gray);
});

test('a trailing unpaired override token is ignored, not fatal', () => {
    const spec = psgame.findPaletteSpec(psgame.parseGame(
        gameWithPalette('color_palette arnecolors black #292f25 white')));
    assert.deepStrictEqual(spec.overrides, [['black', '#292f25']]);
});

test('findPaletteName still returns just the base name', () => {
    const game = psgame.parseGame(
        gameWithPalette('color_palette arnecolors black #292f25'));
    assert.strictEqual(psgame.findPaletteName(game), 'arnecolors');
});

test('the fork palette names resolve', () => {
    for (const name of ['bentenpond', 'dungeon20', 'oekakinl']) {
        const r = palettes.resolvePalette({ name, overrides: [] });
        assert.strictEqual(r.known, true, name);
        assert.strictEqual(Object.keys(r.palette).length, 24, name);
    }
});

test('the short and portable palette forms render identically', () => {
    // PuzzleScript Next's palette-set docs promise these two are the same
    // palette: `color_palette bentenpond` for the fork, and the spelled-out
    // override block for everywhere else. That promise is only true if a
    // viewer honours the overrides - before it did, these differed.
    const short = sheet.analyse(gameWithPalette('color_palette bentenpond'));
    const bp = palettes.colorPalettes.bentenpond;
    const pairs = Object.keys(bp).map(k => `${k} ${bp[k]}`).join(' ');
    const portable = sheet.analyse(
        gameWithPalette(`color_palette arnecolors ${pairs}`));
    for (const ch of Object.keys(short.glyphs)) {
        assert.strictEqual(portable.glyphs[ch].color, short.glyphs[ch].color,
            `glyph ${ch} differs between the short and portable forms`);
    }
});

test('vendored palettes match PuzzleScriptNext colors.js, when it is beside us', () => {
    // This file is a copy, so it can drift. Checked only when the engine repo
    // is checked out as a sibling, the same way the demo-game sweep is.
    const colorsJs = path.join(__dirname, '..', '..', 'src', 'js', 'colors.js');
    if (!fs.existsSync(colorsJs)) return;
    const text = fs.readFileSync(colorsJs, 'utf8');
    const body = text.slice(text.indexOf('colorPalettes = {'));
    const upstream = {};
    const blockRe = /(\w+)\s*:\s*\{([^}]*)\}/g;
    let m;
    while ((m = blockRe.exec(body))) {
        const entries = {};
        const pairRe = /(\w+)\s*:\s*"(#[0-9a-fA-F]{6})"/g;
        let q;
        while ((q = pairRe.exec(m[2]))) entries[q[1]] = q[2].toLowerCase();
        if (Object.keys(entries).length >= 24) upstream[m[1]] = entries;
    }
    assert.ok(Object.keys(upstream).length >= 14,
        `parsed only ${Object.keys(upstream).length} palettes from colors.js`);
    for (const [name, entries] of Object.entries(upstream)) {
        const mine = palettes.colorPalettes[name];
        assert.ok(mine, `colors.js has "${name}" and src/palettes.js does not`);
        for (const [slot, hex] of Object.entries(entries)) {
            assert.strictEqual(String(mine[slot]).toLowerCase(), hex,
                `${name}.${slot} drifted from colors.js`);
        }
    }
});

// ---------------------------------------------------------------------------

for (const { name, error } of failures) {
    process.stdout.write(`FAIL  ${name}\n      ${error.message.split('\n')[0]}\n`);
}
process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length ? 1 : 0);
