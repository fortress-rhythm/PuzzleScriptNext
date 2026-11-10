#!/usr/bin/env node
// Checks a drill answer by running it on the real PuzzleScript Next engine.
//
//   node drills/check.js 03                 check drills/03-*/starter.txt
//   node drills/check.js 03 my-attempt.txt  check another file against drill 03
//   node drills/check.js --self-test        every answer passes, every starter fails
//
// Each drill folder has a checks.json: a list of cases, each a small map, the
// keys to press, and what should happen. The checker swaps the case's map in
// for your LEVELS section, presses the keys, lets any `again` turns finish,
// and compares the result. Keep the starter's OBJECTS and LEGEND (you can add
// to them): the cases are drawn with the starter's legend characters. Objects
// you add without a legend character of their own are ignored when comparing.
//
// No dependencies: it loads the engine from src/js into a Node vm context, the
// same set of files src/tests/tests.html loads, with the same stubs.

'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENGINE_FILES = [
	'src/tests/resources/wrapper.js', 'src/js/storagewrapper.js', 'src/js/globalVariables.js',
	'src/js/debug.js', 'src/js/font.js', 'src/js/rng.js', 'src/js/riffwave.js', 'src/js/sfxr.js',
	'src/js/codemirror/stringstream.js', 'src/js/colors.js', 'src/js/engine.js', 'src/js/parser.js',
	'src/js/compiler.js', 'src/js/soundbar.js',
];
const KEYS = { U: 0, L: 1, D: 2, R: 3, X: 4 };

function makeEngine() {
	const noop = () => {};
	// A DOM element that accepts anything and returns more of itself.
	const element = () => new Proxy(function () {}, {
		get: (t, k) => k === Symbol.toPrimitive ? () => '' : element(),
		apply: () => element(),
		set: () => true,
	});
	const ctx = {
		console: { log: noop, warn: noop, error: noop, info: noop, debug: noop, trace: noop },
		setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
		Event: class { constructor(type) { this.type = type; } },
		KeyboardEvent: class {}, CustomEvent: class {},
		localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
		navigator: { userAgent: 'node', platform: 'node' },
		document: element(),
		performance: { now: () => Date.now() },
		location: { href: '', search: '' },
		URLSearchParams,
	};
	ctx.window = ctx;
	ctx.self = ctx;
	vm.createContext(ctx);
	for (const f of ENGINE_FILES)
		vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
	// Record a win instead of moving on to the next level.
	vm.runInContext(`
		var __won = false;
		DoWin = function () { __won = true; againing = false; };
		function __settle() {
			let n = 0;
			while (againing && n++ < 500) { againing = false; processInput(-1); }
		}
		function __load(src) {
			unitTesting = true; errorStrings = []; errorStringsOnly = []; errorCount = 0; __won = false;
			const ok = compile(["loadLevel", 0], src, null);
			__settle();
			return ok ? true : false;
		}
		function __cells() {
			const out = [];
			for (let y = 0; y < curLevel.height; y++) {
				const row = [];
				for (let x = 0; x < curLevel.width; x++) {
					// cells are stored column by column
					const mask = curLevel.getCell(y + x * curLevel.height);
					const objs = [];
					for (let bit = 0; bit < 32 * STRIDE_OBJ; ++bit)
						if (mask.get(bit)) objs.push(state.idDict[bit]);
					row.push(objs.sort().join(' '));
				}
				out.push(row);
			}
			return out;
		}
		function __glyphs() {
			const out = {};
			for (const k in state.glyphDict) {
				if (k.length !== 1) continue;
				out[k] = state.glyphDict[k].filter(id => id >= 0).map(id => state.idDict[id]).sort();
			}
			return out;
		}
		function __errors() {
			return errorStringsOnly.map(s => String(s).replace(/<[^>]*>/g, ''));
		}
	`, ctx);
	return ctx;
}

const engine = makeEngine();
const run = code => vm.runInContext(code, engine);

// Replace everything after the LEVELS header with one map.
function withLevel(src, mapRows) {
	const lines = src.replace(/\r\n?/g, '\n').split('\n');
	const i = lines.findIndex(l => /^\s*levels\s*$/i.test(l));
	if (i < 0) throw new Error('no LEVELS section found');
	let j = i + 1;
	while (j < lines.length && /^\s*=+\s*$/.test(lines[j])) j++;
	return lines.slice(0, j).join('\n') + '\n\n' + mapRows.join('\n') + '\n';
}

// Show a grid of cells with the legend's own characters where one fits.
function render(cells, glyphs, background, src) {
	// the engine lowercases legend keys; get the author's spelling back
	const spelled = {};
	for (const m of src.matchAll(/^[ \t]*(\S)[ \t]*=/gm)) spelled[m[1].toLowerCase()] = m[1];
	const strip = s => s.split(' ').filter(o => o && o !== background).sort().join(' ');
	const byObjects = {};
	for (const [ch, objs] of Object.entries(glyphs)) {
		const key = strip(objs.join(' '));
		if (!(key in byObjects) || ch === '.') byObjects[key] = ch;
	}
	return cells.map(row => row.map(c => {
		const ch = byObjects[strip(c)];
		return ch === undefined ? '?' : (spelled[ch] ?? ch);
	}).join(''));
}

function checkCase(src, c) {
	if (!run(`__load(${JSON.stringify(withLevel(src, c.map))})`) || run('errorCount') > 0)
		return { ok: false, why: 'it does not compile:\n      ' + run('__errors()').join('\n      ') };
	const glyphs = run('__glyphs()');
	const background = run('state.objects.background ? "background" : ""');
	for (const k of (c.keys || '').toUpperCase()) {
		if (k === ' ') continue;
		if (k === 'Z') run('DoUndo(false, true)');
		else if (k === 'T') run('processInput(-1)');
		else if (k in KEYS) run(`processInput(${KEYS[k]})`);
		else throw new Error(`unknown key '${k}' in checks.json`);
		run('__settle()');
	}
	const won = run('__won');
	const after = run('__cells()');
	const shown = render(after, glyphs, background, src);

	if (c.expect === 'win') return won ? { ok: true } : { ok: false, why: 'the level should be won, and is not', shown };
	if (c.expect === 'no win') return !won ? { ok: true } : { ok: false, why: 'the level should not be won yet, and is', shown };

	// Expected map: draw it through the same game, so legend characters mean the same thing.
	// Objects with no legend character of their own (helper markers you add)
	// are left out, so any working approach passes.
	run(`__load(${JSON.stringify(withLevel(src, c.expect))})`);
	const visible = new Set(Object.values(glyphs).flat());
	const keep = grid => grid.map(row => row.map(cell => cell.split(' ').filter(o => visible.has(o)).join(' ')));
	const want = keep(run('__cells()'));
	const same = JSON.stringify(want) === JSON.stringify(keep(after));
	return same ? { ok: true } : { ok: false, why: 'the map ends up wrong', shown, expected: c.expect };
}

function checkFile(drillDir, file, quiet) {
	const checks = JSON.parse(fs.readFileSync(path.join(drillDir, 'checks.json'), 'utf8'));
	const src = fs.readFileSync(file, 'utf8');
	let passed = 0;
	for (const c of checks.cases) {
		let r;
		try { r = checkCase(src, c); } catch (e) { r = { ok: false, why: 'the checker crashed: ' + e.message }; }
		if (r.ok) { passed++; if (!quiet) console.log(`  pass  ${c.name}`); continue; }
		if (quiet) continue;
		console.log(`  FAIL  ${c.name}: ${r.why}`);
		if (c.keys) console.log(`        keys pressed: ${c.keys}`);
		const pad = s => s.padEnd(Math.max(8, ...c.map.map(r => r.length)) + 3);
		console.log(`        ${pad('start')}${r.expected ? pad('expected') : ''}${r.shown ? 'got' : ''}`);
		for (let i = 0; i < c.map.length; i++)
			console.log(`        ${pad(c.map[i])}${r.expected ? pad(r.expected[i] || '') : ''}${r.shown ? r.shown[i] || '' : ''}`);
	}
	if (!quiet) console.log(`\n  ${passed}/${checks.cases.length} cases pass` +
		(passed === checks.cases.length ? ' - drill done.' : ''));
	return { passed, total: checks.cases.length };
}

function drillDirs() {
	return fs.readdirSync(__dirname).filter(d => /^\d\d-/.test(d)).sort().map(d => path.join(__dirname, d));
}

function main(argv) {
	if (argv[0] === '--self-test') {
		let bad = 0;
		for (const dir of drillDirs()) {
			const name = path.basename(dir);
			const answer = path.join(__dirname, 'answers', name + '.txt');
			const a = checkFile(dir, answer, true);
			const s = checkFile(dir, path.join(dir, 'starter.txt'), true);
			const ok = a.passed === a.total && s.passed < s.total;
			if (!ok) bad++;
			console.log(`${ok ? 'ok  ' : 'BAD '} ${name}: answer ${a.passed}/${a.total}, starter ${s.passed}/${s.total}`);
		}
		if (bad) { console.log(`\n${bad} drill(s) broken: rerun one with node drills/check.js NN drills/answers/NN-....txt`); process.exit(1); }
		return;
	}
	if (!argv[0] || argv[0] === '--help' || argv[0] === '-h') {
		console.log('usage: node drills/check.js NN [file]   (NN is the drill number, e.g. 03)\n' +
			'       node drills/check.js --self-test');
		process.exit(argv[0] ? 0 : 2);
	}
	const num = argv[0].padStart(2, '0');
	const dir = drillDirs().find(d => path.basename(d).startsWith(num + '-'));
	if (!dir) { console.error(`no drill ${num} in ${__dirname}`); process.exit(2); }
	const file = argv[1] || path.join(dir, 'starter.txt');
	console.log(`drill ${path.basename(dir)}, checking ${path.relative(process.cwd(), file)}\n`);
	const r = checkFile(dir, file, false);
	process.exit(r.passed === r.total ? 0 : 1);
}

main(process.argv.slice(2));
