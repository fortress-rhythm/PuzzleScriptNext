#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const sheet = require('./sheet');
const { applyGridEdits } = require('./psgame');

const USAGE = `psmap - PuzzleScript map tooling

  psmap export <game.txt> [-o out.xlsx]     level grids -> spreadsheet
  psmap import <game.txt> <edited.xlsx>     spreadsheet -> back into the game file
  psmap info   <game.txt>                   summarise levels and legend

Options
  -o, --output <file>   where to write (default: alongside the input)
  -f, --format <fmt>    xlsx | csv | tsv     (export; default xlsx)
      --stdout          write the updated game to stdout instead of the file
      --dry-run         report what import would change, write nothing

Round trip
  psmap export sokoban.txt          -> sokoban.levels.xlsx
  (edit in Excel / Google Sheets - rectangular copy and paste just works)
  psmap import sokoban.txt sokoban.levels.xlsx

Import only ever rewrites the level grids. Comments, level commands, and every
other section of the file are left exactly as they were.
`;

function parseArgs(argv) {
    const opts = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '-o' || a === '--output') opts.output = argv[++i];
        else if (a === '-f' || a === '--format') opts.format = argv[++i];
        else if (a === '--stdout') opts.stdout = true;
        else if (a === '--dry-run') opts.dryRun = true;
        else if (a === '-h' || a === '--help') opts.help = true;
        else opts._.push(a);
    }
    return opts;
}

function main(argv) {
    const opts = parseArgs(argv);
    const command = opts._[0];

    if (opts.help || !command) { process.stdout.write(USAGE); return 0; }

    if (command === 'export') return doExport(opts);
    if (command === 'import') return doImport(opts);
    if (command === 'info') return doInfo(opts);

    process.stderr.write(`Unknown command "${command}".\n\n${USAGE}`);
    return 2;
}

function readGame(file) {
    if (!file) { process.stderr.write('Need a game file.\n'); process.exit(2); }
    if (!fs.existsSync(file)) { process.stderr.write(`No such file: ${file}\n`); process.exit(2); }
    return fs.readFileSync(file, 'utf8');
}

function doExport(opts) {
    const gameFile = opts._[1];
    const source = readGame(gameFile);
    const format = (opts.format || 'xlsx').toLowerCase();
    const base = gameFile.replace(/\.[^.]+$/, '');

    if (format === 'csv' || format === 'tsv') {
        const out = opts.output || `${base}.levels.${format}`;
        fs.writeFileSync(out, sheet.toDelimited(source, format), 'utf8');
        const { grids } = sheet.analyse(source);
        process.stderr.write(`Wrote ${grids.length} level(s) to ${out}\n`);
        return 0;
    }
    if (format !== 'xlsx') {
        process.stderr.write(`Unknown format "${format}". Use xlsx, csv or tsv.\n`);
        return 2;
    }

    const out = opts.output || `${base}.levels.xlsx`;
    const result = sheet.toWorkbook(source);
    fs.writeFileSync(out, result.buffer);
    process.stderr.write(
        `Wrote ${result.gridCount} level(s) to ${out}\n`
        + `  one worksheet per level, plus _index and _legend\n`
        + `  background character: "${result.background}"\n`);
    return 0;
}

function doImport(opts) {
    const gameFile = opts._[1];
    const sheetFile = opts._[2];
    const source = readGame(gameFile);

    if (!sheetFile || !fs.existsSync(sheetFile)) {
        process.stderr.write(`No such spreadsheet: ${sheetFile}\n`);
        return 2;
    }

    const ext = path.extname(sheetFile).toLowerCase();
    let parsed;
    if (ext === '.xlsx') {
        parsed = sheet.fromWorkbook(source, fs.readFileSync(sheetFile));
    } else if (ext === '.csv' || ext === '.tsv') {
        parsed = sheet.fromDelimited(source, fs.readFileSync(sheetFile, 'utf8'), ext.slice(1));
    } else {
        process.stderr.write(`Do not know how to read "${ext}". Use .xlsx, .csv or .tsv.\n`);
        return 2;
    }

    const { game, edits, warnings } = parsed;
    for (const w of warnings) process.stderr.write(`warning: ${w}\n`);

    if (!edits.length) {
        process.stderr.write('Nothing to import - no level sheets found.\n');
        return 1;
    }

    // Report size changes, since those are the ones worth a second look.
    let changed = 0;
    for (const e of edits) {
        const before = game.grids[e.gridIndex];
        const after = { w: Math.max(...e.rows.map(r => r.length)), h: e.rows.length };
        const same = before.rows.length === e.rows.length
            && before.rows.every((r, i) => r === e.rows[i]);
        if (!same) {
            changed++;
            const size = (before.width !== after.w || before.height !== after.h)
                ? `  ${before.width}x${before.height} -> ${after.w}x${after.h}` : '';
            process.stderr.write(`  L${e.gridIndex} updated${size}\n`);
        }
    }

    if (!changed) { process.stderr.write('No changes - levels already match.\n'); return 0; }

    const updated = applyGridEdits(game, edits);

    if (opts.dryRun) {
        process.stderr.write(`Dry run: ${changed} level(s) would change.\n`);
        return 0;
    }
    if (opts.stdout) { process.stdout.write(updated); return 0; }

    fs.writeFileSync(opts.output || gameFile, updated, 'utf8');
    process.stderr.write(`Updated ${changed} level(s) in ${opts.output || gameFile}\n`);
    return 0;
}

function doInfo(opts) {
    const source = readGame(opts._[1]);
    const { game, glyphs, grids, background, paletteName } = sheet.analyse(source);

    process.stdout.write(`palette: ${paletteName}\n`);
    process.stdout.write(`background char: "${background}"\n`);
    process.stdout.write(`\nglyphs (${Object.keys(glyphs).length}):\n`);
    for (const ch of Object.keys(glyphs).sort()) {
        const g = glyphs[ch];
        process.stdout.write(`  ${ch}  ${(g.color || '-').padEnd(8)} ${g.label}\n`);
    }

    process.stdout.write(`\nlevels (${grids.length}):\n`);
    let i = 0;
    for (const level of game.levels) {
        if (!level.grid) continue;
        const name = (level.commandsBefore.find(c => c.verb === 'level') || {}).text || '';
        const ragged = new Set(level.grid.rows.map(r => r.length)).size > 1 ? '  [ragged!]' : '';
        process.stdout.write(
            `  L${String(i).padStart(2, '0')}  ${level.grid.width}x${level.grid.height}`
            + `  ${name}${ragged}\n`);
        i++;
    }

    // Ragged levels are worth calling out - they are legal but usually a typo,
    // and the spreadsheet round trip will square them up.
    const anyRagged = grids.some(g => new Set(g.rows.map(r => r.length)).size > 1);
    if (anyRagged) {
        process.stdout.write(
            '\nNote: some levels have rows of differing length. Exporting and\n'
            + 'importing will pad them to a rectangle with the background char.\n');
    }
    return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { main, parseArgs };
