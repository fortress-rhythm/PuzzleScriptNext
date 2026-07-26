#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const sheet = require('./sheet');
const rexbridge = require('./rexbridge');
const { applyGridEdits } = require('./psgame');

const USAGE = `psmap - PuzzleScript map tooling

  psmap export <game.txt> [-o dest]     level grids -> spreadsheet or .xp files
  psmap import <game.txt> <edited>      edits -> spliced back into the game file
  psmap info   <game.txt>               summarise levels and legend

Options
  -o, --output <path>   where to write (default: alongside the input)
  -f, --format <fmt>    xlsx | csv | tsv | xp     (export; default xlsx)
      --stdout          write the updated game to stdout instead of the file
      --dry-run         report what import would change, write nothing

Spreadsheet round trip
  psmap export sokoban.txt                     -> sokoban.levels.xlsx
  (edit in Excel / Google Sheets - rectangular copy and paste just works)
  psmap import sokoban.txt sokoban.levels.xlsx

REXPaint round trip
  psmap export sokoban.txt -f xp               -> sokoban.rex/L00.xp, L01.xp, ...
  (open the folder in REXPaint; its image browser doubles as a level browser)
  psmap import sokoban.txt sokoban.rex

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
    if (format === 'xp') return exportRex(opts, source, base);

    if (format !== 'xlsx') {
        process.stderr.write(`Unknown format "${format}". Use xlsx, csv, tsv or xp.\n`);
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

/**
 * Read either a directory of .xp files or a single one, along with the sidecar
 * that maps CP437 codes back to legend characters.
 */
function importRex(source, target, isDir) {
    const dir = isDir ? target : path.dirname(target);
    const names = isDir
        ? fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.xp')).sort()
        : [path.basename(target)];

    if (!names.length) {
        process.stderr.write(`No .xp files in ${dir}\n`);
        return null;
    }

    const sidecarPath = path.join(dir, rexbridge.SIDECAR);
    let sidecar = null;
    if (fs.existsSync(sidecarPath)) {
        try { sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8')); }
        catch (e) { process.stderr.write(`warning: ${rexbridge.SIDECAR} is unreadable (${e.message})\n`); }
    } else {
        process.stderr.write(
            `warning: no ${rexbridge.SIDECAR} beside the .xp files - falling back to\n`
            + '         code page 437, which is only right if the legend is plain ASCII\n');
    }

    const files = names.map(n => ({ name: n, buffer: fs.readFileSync(path.join(dir, n)) }));
    return rexbridge.fromRexFiles(source, files, sidecar);
}

function exportRex(opts, source, base) {
    const dir = opts.output || `${base}.rex`;
    fs.mkdirSync(dir, { recursive: true });

    const { files, sidecar, unmapped } = rexbridge.toRexFiles(source);
    for (const f of files) fs.writeFileSync(path.join(dir, f.name), f.buffer);
    fs.writeFileSync(path.join(dir, rexbridge.SIDECAR), JSON.stringify(sidecar, null, 2), 'utf8');

    process.stderr.write(`Wrote ${files.length} level(s) to ${dir}/\n`);
    process.stderr.write(`  plus ${rexbridge.SIDECAR} - keep it, import needs it\n`);
    if (unmapped.length) {
        process.stderr.write(
            `  ${unmapped.length} glyph(s) have no code page 437 equivalent and are\n`
            + '  shown as substitutes in REXPaint (they map back correctly on import):\n');
        for (const u of unmapped) {
            process.stderr.write(`    "${u.char}" appears as "${u.shownAs}" (code ${u.code})\n`);
        }
    }
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

    const stat = fs.statSync(sheetFile);
    const ext = path.extname(sheetFile).toLowerCase();
    let parsed;
    if (stat.isDirectory() || ext === '.xp') {
        parsed = importRex(source, sheetFile, stat.isDirectory());
        if (!parsed) return 2;
    } else if (ext === '.xlsx') {
        parsed = sheet.fromWorkbook(source, fs.readFileSync(sheetFile));
    } else if (ext === '.csv' || ext === '.tsv') {
        parsed = sheet.fromDelimited(source, fs.readFileSync(sheetFile, 'utf8'), ext.slice(1));
    } else {
        process.stderr.write(
            `Do not know how to read "${ext}". Use .xlsx, .csv, .tsv, .xp `
            + 'or a directory of .xp files.\n');
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
