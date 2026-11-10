// End-to-end tests for the screen-reader layer's connections to the engine.
// Run: node tools/a11y.engine.test.js   (npm run test:a11y runs it too)
//
// tools/a11y.test.js covers the pure text logic. This file covers what it
// can't: the hooks in inputoutput.js, compiler.js, engine.js and graphics.js.
// It loads the same scripts as src/play.html, in that order, into a Node vm
// with a small fake DOM, then plays src/demo/a11y-demo.txt with real key
// events (onKeyDown/onKeyUp) and real frames (update()), and checks what the
// aria-live region would say and what is drawn on the canvas.
//
// No dependencies, no browser. If the engine changes so that a hook stops
// firing, one of these fails.

'use strict';
const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEMO = fs.readFileSync(path.join(ROOT, 'src/demo/a11y-demo.txt'), 'utf8');
// the same game without screen_reader in the prelude, so voice mode starts off
const DEMO_OFF = DEMO.replace(/^screen_reader[ \t]*\n/m, '');
assert.notStrictEqual(DEMO, DEMO_OFF, 'the demo has screen_reader in its prelude');

// the scripts src/play.html loads, minus mobile.js (touch only)
function playPageScripts() {
	const html = fs.readFileSync(path.join(ROOT, 'src/play.html'), 'utf8');
	return [...html.matchAll(/<script[^>]*src="(js\/[^"]+\.js)"/g)]
		.map(m => 'src/' + m[1])
		.filter(f => !/mobile\.js$/.test(f));
}

// ---- a fake DOM: just enough for the engine and a11y.js

function makeContext2d(log) {
	const target = {
		measureText: t => ({ width: String(t).length * 6 }),
		getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
		createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
		fillText: (text, x, y) => log.push({ text, x, y }),
	};
	return new Proxy(target, {
		get: (t, k) => (k in t ? t[k] : () => {}),
		set: (t, k, v) => { if (!(k in target) || typeof target[k] !== 'function') t[k] = v; return true; },
	});
}

class FakeElement {
	constructor(doc, tag) {
		this.ownerDocument = doc;
		this.tagName = String(tag).toUpperCase();
		this.attributes = {};
		this.style = {};
		this.children = [];
		this.parentElement = null;
		this.listeners = {};
		this.textContent = '';
		this.innerHTML = '';
		this.width = 640;
		this.height = 480;
		this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
		this.drawn = [];
	}
	get id() { return this.attributes.id || ''; }
	set id(v) { this.attributes.id = String(v); }
	setAttribute(k, v) { this.attributes[k] = String(v); }
	getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
	removeAttribute(k) { delete this.attributes[k]; }
	get parentNode() { return this.parentElement; }
	appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
	removeChild(c) { this.children = this.children.filter(x => x !== c); return c; }
	contains(c) { return c === this || this.children.some(x => x.contains(c)); }
	addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
	removeEventListener() {}
	dispatchEvent(e) { (this.listeners[e.type] || []).forEach(f => f(e)); return true; }
	focus() { this.ownerDocument.activeElement = this; }
	blur() {}
	getBoundingClientRect() { return { left: 0, top: 0, right: this.width, bottom: this.height, width: this.width, height: this.height }; }
	querySelector() { return null; }
	querySelectorAll() { return []; }
	getElementsByTagName() { return []; }
	getContext() { return this._ctx || (this._ctx = makeContext2d(this.drawn)); }
	toDataURL() { return ''; }
	get clientWidth() { return this.width; }
	get clientHeight() { return this.height; }
	get offsetWidth() { return this.width; }
	get offsetHeight() { return this.height; }
}

function makeDocument() {
	const doc = { readyState: 'complete', listeners: {} };
	const byId = {};
	doc.createElement = tag => new FakeElement(doc, tag);
	doc.body = doc.createElement('body');
	doc.documentElement = doc.createElement('html');
	const wrap = doc.createElement('div');
	const canvas = doc.createElement('canvas');
	canvas.id = 'gameCanvas';
	doc.body.appendChild(wrap);
	wrap.appendChild(canvas);
	doc.getElementById = id => {
		if (byId[id]) return byId[id];
		const find = el => el.id === id ? el : el.children.map(find).find(Boolean);
		return find(doc.body) || null;
	};
	doc.addEventListener = (t, f) => (doc.listeners[t] = doc.listeners[t] || []).push(f);
	doc.removeEventListener = () => {};
	doc.dispatchEvent = e => { (doc.listeners[e.type] || []).forEach(f => f(e)); return true; };
	doc.querySelector = () => null;
	doc.querySelectorAll = () => [];
	doc.getElementsByTagName = () => [];
	doc.createTextNode = t => ({ textContent: t });
	doc.hasFocus = () => true;
	return { doc, canvas, wrap };
}

// sound is irrelevant here; anything the engine asks of it returns a no-op
function FakeAudioContext() {
	const any = () => new Proxy(function () {}, { get: (t, k) => (k === 'state' ? 'running' : k === Symbol.toPrimitive ? () => 0 : any()), apply: () => any(), construct: () => any() });
	return any();
}

// ---- the page

function loadPage(search) {
	const { doc, canvas, wrap } = makeDocument();
	const timers = [];
	const store = {};
	const ctx = {
		console: { log() {}, warn() {}, error() {}, info() {}, debug() {}, trace() {} },
		document: doc,
		navigator: { userAgent: 'node', platform: 'node', maxTouchPoints: 0 },
		location: { href: 'http://localhost/play.html' + (search || ''), search: search || '', hash: '', pathname: '/play.html' },
		localStorage: {
			getItem: k => (k in store ? store[k] : null),
			setItem: (k, v) => { store[k] = String(v); },
			removeItem: k => { delete store[k]; },
		},
		setTimeout: (f) => { timers.push(f); return timers.length; },
		clearTimeout() {},
		setInterval() { return 0; },
		clearInterval() {},
		requestAnimationFrame() { return 0; },
		cancelAnimationFrame() {},
		performance: { now: () => Date.now() },
		Event: class { constructor(type) { this.type = type; } },
		CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
		KeyboardEvent: class {},
		Image: class { constructor() { this.width = 0; this.height = 0; } },
		AudioContext: FakeAudioContext, webkitAudioContext: undefined,
		HTMLCanvasElement: FakeElement, HTMLElement: FakeElement,
		URLSearchParams, Date, Math, JSON,
		addEventListener() {}, removeEventListener() {},
		innerWidth: 640, innerHeight: 480, devicePixelRatio: 1,
	};
	ctx.window = ctx;
	ctx.self = ctx;
	ctx.top = ctx;
	ctx.parent = ctx;
	vm.createContext(ctx);
	for (const f of playPageScripts()) {
		try {
			vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
		} catch (e) {
			e.message = `loading ${f} in the fake page: ${e.message}`; throw e;
		}
	}
	const run = code => vm.runInContext(code, ctx);

	const page = {
		ctx, run, canvas, wrap, doc, store,
		flushTimers() { let n = 0; while (timers.length && n++ < 1000) timers.shift()(); },
		load(src, level) {
			run(`unitTesting = false; lastDownTarget = canvas;`);
			ctx.__src = src;
			run(`compile(["loadLevel", ${level || 0}], __src, null);`);
			run(`if (!A11y.__logged) { A11y.__logged = true; A11y.__log = []; const say = A11y.say; A11y.say = function (t, f) { if (t) A11y.__log.push(t); return say.call(this, t, f); }; }`);
			page.frames(5);
			page.flushTimers();
		},
		// one key press: keydown then keyup, through the same handlers as the page
		key(keyCode) {
			let prevented = false;
			const ev = { keyCode, which: keyCode, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
				target: canvas, preventDefault() { prevented = true; }, stopPropagation() {} };
			ctx.__ev = ev;
			run('lastDownTarget = canvas; onKeyDown(__ev); onKeyUp(__ev);');
			page.frames(60);
			page.flushTimers();
			return { prevented };
		},
		frames(n) { for (let i = 0; i < n; i++) run('deltatime = 17; update();'); },
		said() { const el = doc.getElementById('a11yLive'); return el ? el.textContent : ''; },
		// everything announced since the last call
		heard() { const all = run('A11y.__log ? A11y.__log.splice(0).join(" | ") : ""'); return all; },
		redraw() { canvas.drawn.length = 0; run('redraw()'); return canvas.drawn.map(d => d.text); },
	};
	return page;
}

const KEY = { left: 37, up: 38, right: 39, down: 40, X: 88, Z: 90, R: 82, V: 86, H: 72, G: 71, N: 78, I: 73, J: 74, K: 75, L: 76, O: 79, B: 66, F: 70, Tab: 9 };

// ---- tests

let passed = 0;
function test(name, fn) {
	try { fn(); passed++; console.log('ok   ' + name); }
	catch (e) { console.log('FAIL ' + name); console.log('     ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n     ')); process.exitCode = 1; }
}

test('the play page scripts load, including a11y.js', () => {
	const p = loadPage('?sr=1');
	assert.strictEqual(p.run('typeof A11y'), 'object');
	assert.ok(playPageScripts().includes('src/js/a11y.js'), 'play.html loads a11y.js');
});

test('compiler hook: object metadata from the game is read after compile', () => {
	const p = loadPage('?sr=1');
	p.load(DEMO);
	const meta = p.run('JSON.stringify(A11y.meta ? Object.keys(A11y.meta) : null)');
	assert.ok(meta && meta !== 'null', 'A11y.meta is set by the compile hook');
	// @say renames, @quiet silences: both show up in what N lists
	p.key(KEY.N);
	assert.match(p.said(), /crate|wooden/i);
	assert.doesNotMatch(p.said(), /relay/i);
});

test('a game written with // comments gets its tags read too', () => {
	// every ( ... ) comment rewritten as // ..., which is how a //-style game must write them
	// PuzzleScript Next fixes the comment style from the first comment it meets;
	// if that one trails an object name, the // is read as part of the name.
	// So a //-style game starts with a // comment on its own line.
	const slashDemo = '// voice mode demo, written with // comments\n'
		+ DEMO.replace(/\(([^()\n]*)\)/g, '// $1');
	assert.match(slashDemo, /Crate \/\/ @say wooden crate/);
	const p = loadPage('?sr=1');
	p.load(slashDemo);
	assert.strictEqual(p.run('errorCount'), 0, 'the //-style game compiles');
	p.key(KEY.N);
	assert.match(p.said(), /wooden crate/i);
	assert.doesNotMatch(p.said(), /relay/i);
});

test('level load event: the level is announced when it starts', () => {
	const p = loadPage('?sr=1');
	p.load(DEMO);
	assert.match(p.said(), /level/i);
});

test('turn hook: a move is announced after the key', () => {
	const p = loadPage('?sr=1');
	p.load(DEMO);
	p.key(KEY.right);
	assert.match(p.said(), /moved right/i);
});

test('a blocked move says what was in the way', () => {
	const p = loadPage('?sr=1');
	p.load(DEMO);
	p.key(KEY.up);
	p.key(KEY.up);
	assert.match(p.said(), /wall|blocked|can't|cannot/i);
});

test('again chain: one announcement once it settles, not one per step', () => {
	const p = loadPage('?sr=1');
	p.load(DEMO);
	p.key(KEY.down);      // into the open row so the flame has room
	p.key(KEY.X);
	const text = p.said();
	assert.match(text, /flame/i, 'the @say name is used');
	assert.doesNotMatch(text, /spark|relay/i, 'transparent and @quiet helpers stay silent');
	assert.strictEqual(p.run('againing'), false, 'the chain has finished');
});

test('undo hook: undo is announced', () => {
	const p = loadPage('?sr=1');
	p.load(DEMO);
	p.key(KEY.right);
	p.heard();
	p.key(KEY.Z);
	assert.match(p.heard(), /^Undone\./);
});

test('restart event: restarting is announced', () => {
	const p = loadPage('?sr=1');
	p.load(DEMO);
	p.key(KEY.right);
	p.heard();
	p.key(KEY.R);
	assert.match(p.heard(), /restart/i);
});

test('H, G and the inspector keys work through the engine\'s key handler', () => {
	const p = loadPage('?sr=1');
	p.load(DEMO);
	assert.ok(p.key(KEY.H).prevented, 'H is taken by the layer');
	assert.match(p.said(), /left|right|up|down/i);
	p.key(KEY.L);
	assert.match(p.said(), /right/i);
	p.key(KEY.O);
	assert.match(p.said(), /inspector back on you/i);
});

test('Tab is never taken, so focus can always leave the game', () => {
	const p = loadPage('?sr=1');
	p.load(DEMO);
	p.key(KEY.B);
	const r = p.key(KEY.Tab);
	assert.strictEqual(r.prevented, false, 'Tab reached the browser (the engine used to swallow every key)');
	assert.match(p.run('A11y.handleKey(9, true) ? "taken" : "free"'), /free/);
	assert.match(p.canvas.attributes['aria-label'] || '', /Tab leaves the game/);
	// leaving the canvas stops it taking keys; coming back restores them
	p.canvas.dispatchEvent({ type: 'blur' });
	assert.strictEqual(p.run('lastDownTarget === canvas'), false);
	p.canvas.dispatchEvent({ type: 'focus' });
	assert.strictEqual(p.run('lastDownTarget === canvas'), true);
});

test('Tab is not taken with voice mode off either', () => {
	const p = loadPage('');
	p.load(DEMO_OFF);
	assert.strictEqual(p.key(KEY.Tab).prevented, false);
});

test('F steps through bookmarks', () => {
	const p = loadPage('?sr=1');
	p.load(DEMO);
	p.key(KEY.F);
	assert.match(p.said(), /no bookmarks/i);
	p.key(KEY.B);
	p.key(KEY.F);
	assert.match(p.said(), /bookmark 1/i);
});

test('V toggles voice mode, and the page remembers it', () => {
	const p = loadPage('');
	p.load(DEMO_OFF);
	assert.strictEqual(p.run('A11y.enabled'), false);
	p.key(KEY.V);
	assert.strictEqual(p.run('A11y.enabled'), true);
	assert.strictEqual(p.store.ps_a11y, '1');
	assert.strictEqual(p.wrap.attributes.role, 'application');
	p.key(KEY.V);
	assert.strictEqual(p.run('A11y.enabled'), false);
	assert.strictEqual(p.store.ps_a11y, '0');
	assert.strictEqual(p.wrap.attributes.role, undefined);
});

test('with voice mode off, the layer keys do nothing and moves are not announced', () => {
	const p = loadPage('');
	p.load(DEMO_OFF);
	p.heard();
	assert.strictEqual(p.run('A11y.handleKey(72, true)'), false, 'H is left to the game');
	p.key(KEY.H);
	p.key(KEY.right);
	assert.strictEqual(p.heard(), '');
	assert.strictEqual(p.said(), '');
});

test('redraw hook: "Press V to toggle voice mode" is drawn while voice mode is on', () => {
	const p = loadPage('');
	p.load(DEMO_OFF);
	assert.ok(!p.redraw().some(t => /Press V/.test(t)), 'no hint while off');
	p.key(KEY.V);
	assert.ok(p.redraw().includes('Press V to toggle voice mode'), 'hint while on');
	// drawn on the canvas, never written to the live region, so it is not read out
	assert.doesNotMatch(p.said(), /toggle voice mode/);
});

test('turning voice mode off leaves a short "off" hint, then nothing', () => {
	const p = loadPage('?sr=1');
	p.load(DEMO);
	p.run('A11y.handleKey(86, true)');   // V without flushing the 3-second timer
	assert.ok(p.redraw().some(t => /Voice mode off\. Press V to toggle voice mode/.test(t)));
	p.run('A11y._offHintUntil = 0');
	assert.ok(!p.redraw().some(t => /Press V/.test(t)));
});

test('the hint is drawn in the top margin when there is room, inside the canvas', () => {
	const p = loadPage('?sr=1');
	p.load(DEMO);
	p.redraw();
	const hint = p.canvas.drawn.find(d => d.text === 'Press V to toggle voice mode');
	assert.ok(hint, 'drawn');
	const yoffset = p.run('yoffset');
	assert.ok(hint.y >= 0 && hint.y < Math.max(yoffset, 24), `y=${hint.y} sits above the board (yoffset ${yoffset})`);
});

test('the second level loads and is announced after the win message', () => {
	const p = loadPage('?sr=1');
	p.load(DEMO);
	p.key(KEY.right);
	p.heard();
	p.key(KEY.right);   // crate onto the target: solved
	assert.match(p.heard(), /solved/i);
	assert.match(p.said(), /well done/i, 'then the message screen is read');
	p.key(KEY.X);       // past the message
	assert.match(p.heard(), /level 2/i);
});

console.log(`\n${passed} passed`);
