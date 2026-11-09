// Unit tests for the pure core of src/js/a11y.js.  Run: node tools/a11y.test.js
'use strict';
const assert = require('assert');
const path = require('path');
const { Core } = require(path.join(__dirname, '..', 'src', 'js', 'a11y.js'));

// Build a level from rows of single-char glyphs. legend: glyph -> [ids]
function level(rows, legend, nIds) {
	const height = rows.length, width = rows[0].length;
	const stride = Math.ceil(nIds / 32);
	const objects = new Int32Array(width * height * stride);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
		const cell = y + x * height;
		for (const id of legend[rows[y][x]] || []) objects[cell * stride + (id >> 5)] |= 1 << (id & 31);
	}
	return { objects, geom: { width, height, stride, nIds } };
}

// ids: 0 background, 1 player, 2 wall, 3 crate, 4 target, 5 relay (helper), 6 debris
const NAMES = ['background', 'player', 'wall', 'crate', 'target', 'relay', 'debris'];
const L = { '.': [0], 'P': [0, 1], '#': [0, 2], 'C': [0, 3], 'T': [0, 4], 'r': [0, 5], 'D': [0, 6], 'Q': [0, 3, 4] };
const opts = (extra) => Object.assign({
	visible: id => id !== 0 && id !== 5,
	isPlayer: id => id === 1,
	name: id => NAMES[id],
}, extra || {});
const fmt = (events, after, geom, extra) => Core.formatTurn(events, Object.assign({
	name: id => NAMES[id], height: geom.height,
	player: playerCell(after, geom),
}, extra || {}));
function playerCell(lv, geom) {
	for (let c = 0; c < geom.width * geom.height; c++) if (Core.idsInCell(lv, geom, c).includes(1)) return c;
	return null;
}

let passed = 0;
function test(name, fn) {
	try { fn(); passed++; console.log('ok   ' + name); }
	catch (e) { console.log('FAIL ' + name); console.log(e.stack); process.exitCode = 1; }
}

test('idsInCell reads bits across words', () => {
	const ids = [0, 31, 32, 40];
	const lv = level(['x'], { x: ids }, 41);
	assert.deepStrictEqual(Core.idsInCell(lv.objects, lv.geom, 0), ids);
});

test('player move + push is reported, relative to player', () => {
	const b = level(['.PC.'], L, 7), a = level(['..PC'], L, 7);
	const ev = Core.diffLevels(b.objects, a.objects, b.geom, opts({ prefer: 'right' }));
	assert.strictEqual(ev.length, 2);
	const t = fmt(ev, a.objects, a.geom, { pressed: 'right' });
	assert.strictEqual(t.short, 'You moved right. Crate moved right, 1 right.');
});

test('blocked move names the blocker', () => {
	const b = level(['P#'], L, 7);
	const ev = Core.diffLevels(b.objects, b.objects, b.geom, opts());
	assert.strictEqual(ev.length, 0);
	const t = fmt(ev, b.objects, b.geom, { pressed: 'right', blockedBy: ['wall'] });
	assert.strictEqual(t.short, 'Blocked by wall.');
});

test('no change, no direction', () => {
	const b = level(['P.'], L, 7);
	const t = fmt([], b.objects, b.geom, { pressed: 'action' });
	assert.strictEqual(t.short, 'No change.');
});

test('helper objects are silent', () => {
	const b = level(['P..'], L, 7), a = level(['Prr'], L, 7);
	const ev = Core.diffLevels(b.objects, a.objects, b.geom, opts());
	assert.strictEqual(ev.length, 0);
});

test('became: crate turns into debris in place', () => {
	const b = level(['PC'], L, 7), a = level(['PD'], L, 7);
	const ev = Core.diffLevels(b.objects, a.objects, b.geom, opts());
	assert.deepStrictEqual(ev.map(e => e.kind), ['became']);
	assert.strictEqual(fmt(ev, a.objects, a.geom).short, 'Crate became debris, 1 right.');
});

test('grouping and plurals', () => {
	const b = level(['P...'], L, 7), a = level(['PDDD'], L, 7);
	const ev = Core.diffLevels(b.objects, a.objects, b.geom, opts());
	assert.strictEqual(fmt(ev, a.objects, a.geom).short, '3 debris appeared.');
});

test('push chain of two crates', () => {
	const b = level(['PCC.'], L, 7), a = level(['.PCC'], L, 7);
	const ev = Core.diffLevels(b.objects, a.objects, b.geom, opts({ prefer: 'right' }));
	const moved = ev.filter(e => e.kind === 'moved' && !e.player);
	assert.strictEqual(moved.length, 2);
	assert.ok(moved.every(e => e.dir === 'right'));
	assert.strictEqual(fmt(ev, a.objects, a.geom, { pressed: 'right' }).short, 'You moved right. 2 crates moved right.');
});

test('vertical movement uses column-major layout', () => {
	const b = level(['P', '.', '.'], L, 7), a = level(['.', 'P', '.'], L, 7);
	const ev = Core.diffLevels(b.objects, a.objects, b.geom, opts({ prefer: 'down' }));
	assert.strictEqual(ev[0].dir, 'down');
});

test('teleport is a jump', () => {
	const b = level(['C...P'], L, 7), a = level(['...CP'], L, 7);
	const ev = Core.diffLevels(b.objects, a.objects, b.geom, opts());
	assert.deepStrictEqual(ev.map(e => e.kind), ['jumped']);
});

test('tag variants share a key: rotate while moving is a move', () => {
	const names = ['background', 'player', 'arrow:up', 'arrow:right'];
	const leg = { '.': [0], 'P': [0, 1], 'u': [0, 2], 'r': [0, 3] };
	const b = level(['Pu.'], leg, 4), a = level(['P.r'], leg, 4);
	const o = { visible: id => id > 0, isPlayer: id => id === 1, keyOf: id => names[id].split(':')[0] };
	const ev = Core.diffLevels(b.objects, a.objects, b.geom, o);
	assert.deepStrictEqual(ev.map(e => e.kind), ['moved']);
	assert.strictEqual(ev[0].id, 3);
});

test('truncation offers G', () => {
	const b = level(['P.......'], L, 7);
	const a = level(['PCTD#CTD'], L, 7);
	const ev = Core.diffLevels(b.objects, a.objects, b.geom, opts());
	const t = fmt(ev, a.objects, a.geom, { limit: 3 });
	assert.ok(/press G for all\.$/.test(t.short), t.short);
	assert.ok(t.full.length > t.short.length - 20);
});

test('describeAround: nearest, behind, edge, underfoot', () => {
	const lv = level([
		'#####',
		'#.C.#',
		'#.P.#',
		'#...#',
		'#####'], Object.assign({}, L, { P: [0, 1, 4] }), 7);
	const pc = playerCell(lv.objects, lv.geom);
	const around = Core.describeAround(lv.objects, lv.geom, pc, opts());
	assert.deepStrictEqual(around.dirs.up, { names: ['crate'], dist: 1, beyond: ['wall'], gap: 1 });
	assert.deepStrictEqual(around.under, ['target']);
	const text = Core.aroundToText(around);
	assert.ok(text.startsWith('Up: crate, next to you; wall behind it. Left: wall, 2 away.'), text);
	assert.ok(text.endsWith('On your square: target.'), text);
	const open = level(['P..'], L, 7);
	const t2 = Core.aroundToText(Core.describeAround(open.objects, open.geom, 0, opts()), ['right', 'left']);
	assert.strictEqual(t2, 'Right: open 2, then edge. Left: edge.');
});

test('relPhrase', () => {
	// height 5: cell = y + x*5
	assert.strictEqual(Core.relPhrase(0, 0, 5), 'here');
	assert.strictEqual(Core.relPhrase(12, 7, 5), '1 left');
	assert.strictEqual(Core.relPhrase(12, 18, 5), '1 right, 1 down');
});

test('readObjectMeta reads comments on the name line only', () => {
	const src = [
		'OBJECTS',
		'Crate (@say wooden crate) (@landmark)',
		'orange',
		'Relay (@quiet)',
		'transparent',
		'Player',
		'blue (@say ignored, not the name line)',
	].join('\n');
	const objs = { crate: { lineNumber: 2 }, relay: { lineNumber: 4 }, player: { lineNumber: 6 } };
	const m = Core.readObjectMeta(src, objs);
	assert.deepStrictEqual(m.crate, { say: 'wooden crate', landmark: true });
	assert.deepStrictEqual(m.relay, { quiet: true });
	assert.strictEqual(m.player, undefined);
});

test('isInvisibleSprite', () => {
	assert.strictEqual(Core.isInvisibleSprite({ colors: ['transparent'], spritematrix: [] }), true);
	assert.strictEqual(Core.isInvisibleSprite({ colors: ['#ff0000'], spritematrix: [] }), false);
	assert.strictEqual(Core.isInvisibleSprite({ colors: ['#ff0000'], spritematrix: [[-1, -1], [-1, -1]] }), true);
	assert.strictEqual(Core.isInvisibleSprite({ colors: ['#ff0000', '#00000000'], spritematrix: [[1, -1]] }), true);
	assert.strictEqual(Core.isInvisibleSprite({ colors: ['#ff0000', '#00000000'], spritematrix: [[1, 0]] }), false);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
