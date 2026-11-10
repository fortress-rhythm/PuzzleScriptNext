/*
 * a11y.js — optional screen-reader layer for PuzzleScript Next (fortress-rhythm fork).
 *
 * Off unless the game has `screen_reader` in its prelude, the page URL has `?sr=1`
 * (or `?sr=show`, which also shows the announcements on screen), or the player
 * presses V. When off, every hook below returns immediately.
 *
 * Two halves:
 *   - a pure core (diffLevels, describeAround, formatTurn, ...) that only sees
 *     plain arrays, so it can be tested in Node (tools/a11y.test.js);
 *   - glue (A11y) that reads engine globals and writes to an aria-live region.
 *
 * Cells are stored column-major, STRIDE_OBJ ints per cell: index = y + x*height.
 * Author metadata lives in comments on an object's name line, so other engines
 * ignore it:  Crate (@say wooden crate)   Relay (@quiet)   Glint (@speak)   Exit (@landmark)
 * See doc/accessibility.md.
 */
(function (root) {
'use strict';

// ---------------------------------------------------------------- core (pure)

// [dx, dy] per direction, using the engine's dirNames order for 0-3.
const DIRS = { up: [0, -1], left: [-1, 0], down: [0, 1], right: [1, 0] };
const DIR_ORDER = ['up', 'left', 'down', 'right'];

function xyOf(cell, height) { return [(cell / height) | 0, cell % height]; }
function cellOf(x, y, height) { return y + x * height; }

function hasId(objects, stride, cell, id) {
	return (objects[cell * stride + (id >> 5)] & (1 << (id & 31))) !== 0;
}

function idsInCell(objects, geom, cell) {
	const out = [];
	const base = cell * geom.stride;
	for (let w = 0; w < geom.stride; w++) {
		let word = objects[base + w];
		while (word !== 0) {
			const bit = 31 - Math.clz32(word & -word);
			const id = w * 32 + bit;
			if (id < geom.nIds) out.push(id);
			word &= word - 1;
		}
	}
	return out;
}

// Map key -> array of {cell, id}, for visible ids only.
function positionsByKey(objects, geom, opts) {
	const map = new Map();
	const n = geom.width * geom.height;
	for (let c = 0; c < n; c++) {
		for (const id of idsInCell(objects, geom, c)) {
			if (!opts.visible(id)) continue;
			const k = opts.keyOf ? opts.keyOf(id) : id;
			if (!map.has(k)) map.set(k, []);
			map.get(k).push({ cell: c, id: id });
		}
	}
	return map;
}

function dirBetween(a, b, height) {
	const [ax, ay] = xyOf(a, height), [bx, by] = xyOf(b, height);
	const dx = bx - ax, dy = by - ay;
	if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
	return dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up';
}

/*
 * Compare two level snapshots. Returns events:
 *   {kind:'moved',  id, from, to, dir, player}
 *   {kind:'jumped', id, from, to, player}         (same object, not adjacent)
 *   {kind:'became', fromId, id, cell}             (one object replaced by another in place)
 *   {kind:'gone',   id, cell, player}
 *   {kind:'appeared', id, cell, player}
 * opts: visible(id), isPlayer(id), keyOf(id) (objects sharing a key count as the
 * same thing for movement, e.g. tag variants crate:up / crate:left), prefer (a
 * direction name to try first when pairing ambiguous moves).
 */
function diffLevels(before, after, geom, opts) {
	const B = positionsByKey(before, geom, opts);
	const A = positionsByKey(after, geom, opts);
	const events = [];
	const leftovers = { gone: [], appeared: [] };
	const keys = new Set([...B.keys(), ...A.keys()]);
	const preferOrder = opts.prefer ? [opts.prefer].concat(DIR_ORDER.filter(d => d !== opts.prefer)) : DIR_ORDER;

	for (const k of keys) {
		const b = B.get(k) || [], a = A.get(k) || [];
		const aCells = new Map(a.map(e => [e.cell, e]));
		const bCells = new Map(b.map(e => [e.cell, e]));
		// same key still in the same cell: unchanged, unless the id changed (tag variant)
		const D = [], N = [];
		for (const e of b) {
			const twin = aCells.get(e.cell);
			if (!twin) D.push(e);
			else if (twin.id !== e.id) events.push({ kind: 'became', fromId: e.id, id: twin.id, cell: e.cell, player: !!opts.isPlayer(twin.id) });
		}
		for (const e of a) if (!bCells.has(e.cell)) N.push(e);

		// pair moves: one step, preferred direction first
		const usedN = new Set();
		const unpairedD = [];
		for (const d of D) {
			let match = null;
			for (const dir of preferOrder) {
				const [dx, dy] = DIRS[dir];
				const [x, y] = xyOf(d.cell, geom.height);
				const nx = x + dx, ny = y + dy;
				if (nx < 0 || ny < 0 || nx >= geom.width || ny >= geom.height) continue;
				const target = cellOf(nx, ny, geom.height);
				const cand = N.find(n => n.cell === target && !usedN.has(n));
				if (cand) { match = { n: cand, dir: dir }; break; }
			}
			if (!match && opts.prefer && DIRS[opts.prefer]) {
				// A pushed line of identical things (C C . -> . C C) looks like the back one jumping to
				// the front, because the middle cells are occupied before and after. Walk the line in the
				// pressed direction; if it ends on a new arrival, every member moved one step.
				const [dx, dy] = DIRS[opts.prefer];
				let [x, y] = xyOf(d.cell, geom.height);
				const chain = [d.cell];
				for (;;) {
					x += dx; y += dy;
					if (x < 0 || y < 0 || x >= geom.width || y >= geom.height) break;
					const c = cellOf(x, y, geom.height);
					const end = N.find(n => n.cell === c && !usedN.has(n));
					if (end) {
						usedN.add(end);
						chain.push(c);
						for (let i = 0; i + 1 < chain.length; i++) {
							const to = aCells.get(chain[i + 1]);
							events.push({ kind: 'moved', id: to.id, from: chain[i], to: chain[i + 1], dir: opts.prefer, player: !!opts.isPlayer(to.id) });
						}
						match = 'chain';
						break;
					}
					if (bCells.has(c) && aCells.has(c)) { chain.push(c); continue; }
					break;
				}
			}
			if (match === 'chain') continue;
			if (match) {
				usedN.add(match.n);
				events.push({ kind: 'moved', id: match.n.id, from: d.cell, to: match.n.cell, dir: match.dir, player: !!opts.isPlayer(match.n.id) });
			} else unpairedD.push(d);
		}
		const restN = N.filter(n => !usedN.has(n));
		// a lone object that vanished here and reappeared elsewhere: a jump (teleport)
		if (unpairedD.length === 1 && restN.length === 1) {
			events.push({ kind: 'jumped', id: restN[0].id, from: unpairedD[0].cell, to: restN[0].cell, player: !!opts.isPlayer(restN[0].id) });
		} else {
			for (const d of unpairedD) leftovers.gone.push(d);
			for (const n of restN) leftovers.appeared.push(n);
		}
	}

	// a disappearance and an appearance in the same cell is one thing becoming another
	const appearedByCell = new Map();
	for (const n of leftovers.appeared) {
		if (!appearedByCell.has(n.cell)) appearedByCell.set(n.cell, []);
		appearedByCell.get(n.cell).push(n);
	}
	const consumed = new Set();
	for (const g of leftovers.gone) {
		const list = appearedByCell.get(g.cell);
		const n = list && list.find(x => !consumed.has(x));
		if (n) {
			consumed.add(n);
			events.push({ kind: 'became', fromId: g.id, id: n.id, cell: g.cell, player: !!opts.isPlayer(n.id) });
		} else {
			events.push({ kind: 'gone', id: g.id, cell: g.cell, player: !!opts.isPlayer(g.id) });
		}
	}
	for (const n of leftovers.appeared) {
		if (!consumed.has(n)) events.push({ kind: 'appeared', id: n.id, cell: n.cell, player: !!opts.isPlayer(n.id) });
	}
	return events;
}

function plural(name, n) {
	if (n === 1) return name;
	if (/(ss|x|z|ch|sh)$/i.test(name)) return name + 'es';
	if (/s$/i.test(name)) return name;          // 'debris', 'gas': leave as is
	if (/[^aeiou]y$/i.test(name)) return name.slice(0, -1) + 'ies';
	return name + 's';
}

// "2 left, 1 up" from `from` to `to`; "here" if equal.
function relPhrase(from, to, height) {
	if (from == null || to == null) return '';
	const [fx, fy] = xyOf(from, height), [tx, ty] = xyOf(to, height);
	const dx = tx - fx, dy = ty - fy;
	const parts = [];
	if (dx) parts.push(Math.abs(dx) + (dx < 0 ? ' left' : ' right'));
	if (dy) parts.push(Math.abs(dy) + (dy < 0 ? ' up' : ' down'));
	return parts.length ? parts.join(', ') : 'here';
}

function joinNames(names) {
	if (names.length <= 1) return names.join('');
	return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

/*
 * Walk outward from `cell` in each direction. For each, report the first cell with
 * visible things in it, how far away, and what lies just beyond it.
 * Returns {dirs: {up: {names, dist, beyond}|{edge: n}}, under: [names]}.
 * opts: visible(id), isPlayer(id), name(id).
 */
function describeAround(objects, geom, cell, opts) {
	const [x0, y0] = xyOf(cell, geom.height);
	const namesAt = c => idsInCell(objects, geom, c)
		.filter(id => opts.visible(id) && !opts.isPlayer(id))
		.map(opts.name);
	const out = { dirs: {}, under: namesAt(cell) };
	for (const dir of DIR_ORDER) {
		const [dx, dy] = DIRS[dir];
		let x = x0 + dx, y = y0 + dy, dist = 1, first = null;
		while (x >= 0 && y >= 0 && x < geom.width && y < geom.height) {
			const names = namesAt(cellOf(x, y, geom.height));
			if (names.length) {
				if (!first) first = { names: names, dist: dist };
				else { first.beyond = names; first.gap = dist - first.dist; break; }
			}
			x += dx; y += dy; dist++;
		}
		out.dirs[dir] = first || { edge: dist - 1 };
	}
	return out;
}

function distPhrase(d) { return d === 1 ? 'next to you' : d + ' away'; }

function aroundToText(around, dirs) {
	const parts = [];
	for (const dir of (dirs || DIR_ORDER)) {
		const r = around.dirs[dir];
		const label = dir[0].toUpperCase() + dir.slice(1);
		if (r.edge !== undefined) {
			parts.push(r.edge === 0 ? `${label}: edge.` : `${label}: open ${r.edge}, then edge.`);
		} else {
			let s = `${label}: ${joinNames(r.names)}, ${distPhrase(r.dist)}`;
			if (r.beyond) s += r.gap === 1 ? `; ${joinNames(r.beyond)} behind it` : `; ${joinNames(r.beyond)} ${r.gap} beyond`;
			parts.push(s + '.');
		}
	}
	if (around.under && around.under.length) parts.push(`On your square: ${joinNames(around.under)}.`);
	return parts.join(' ');
}

/*
 * Turn events into sentences. Returns {short, full}: short is capped at `limit`
 * phrases; full has everything. ctx: name(id), height, player (cell after the
 * turn, or null), pressed (direction name or null), blockedBy (names, if the
 * player pressed a direction and did not move).
 */
function formatTurn(events, ctx) {
	const limit = ctx.limit || 6;
	const lead = [];
	const self = events.filter(e => e.player);
	const others = events.filter(e => !e.player);

	const pm = self.filter(e => e.kind === 'moved');
	if (pm.length) {
		const dirs = [...new Set(pm.map(e => e.dir))];
		lead.push((pm.length > 1 ? 'Players moved ' : 'You moved ') + dirs.join(' and ') + '.');
	} else if (ctx.pressed && ctx.pressed !== 'action') {
		lead.push(ctx.blockedBy && ctx.blockedBy.length
			? `Blocked by ${joinNames(ctx.blockedBy)}.`
			: `Can't move ${ctx.pressed}.`);
	}
	for (const e of self) {
		if (e.kind === 'jumped') lead.push(`You moved to ${relPhrase(e.from, e.to, ctx.height)} from where you were.`);
		else if (e.kind === 'became') lead.push(`You became ${ctx.name(e.id)}.`);
		else if (e.kind === 'gone') lead.push(`${ctx.name(e.id)} gone.`);
		else if (e.kind === 'appeared') lead.push(`${ctx.name(e.id)} appeared, ${relPhrase(ctx.player, e.cell, ctx.height)}.`);
	}

	// group the rest: same kind + name (+ dir) collapse to a count
	const groups = new Map();
	for (const e of others) {
		const name = ctx.name(e.id);
		const from = e.kind === 'became' ? ctx.name(e.fromId) : '';
		const key = [e.kind, name, e.dir || '', from].join('|');
		if (!groups.has(key)) groups.set(key, { e: e, name: name, from: from, list: [] });
		groups.get(key).list.push(e);
	}
	const phrases = [];
	for (const g of groups.values()) {
		const n = g.list.length, e = g.e;
		const where = n === 1 && ctx.player != null
			? ', ' + relPhrase(ctx.player, e.kind === 'moved' || e.kind === 'jumped' ? e.to : e.cell, ctx.height)
			: '';
		const subj = n === 1 ? g.name : `${n} ${plural(g.name, n)}`;
		const verbS = n === 1;
		if (e.kind === 'moved') phrases.push(`${subj} moved ${e.dir}${where}.`);
		else if (e.kind === 'jumped') phrases.push(`${subj} moved to${where.replace(/^,/, '')}.`);
		else if (e.kind === 'became') phrases.push(`${n === 1 ? g.from : n + ' ' + plural(g.from, n)} became ${n === 1 ? g.name : plural(g.name, n)}${where}.`);
		else if (e.kind === 'gone') phrases.push(`${subj} ${verbS ? 'is' : 'are'} gone${where}.`);
		else if (e.kind === 'appeared') phrases.push(`${subj} appeared${where}.`);
	}
	// sentence-case each phrase
	const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
	const all = lead.concat(phrases).map(cap);
	if (!all.length) all.push('No change.');
	const full = all.join(' ');
	if (all.length <= limit) return { short: full, full: full };
	const shown = all.slice(0, limit - 1);
	return { short: shown.join(' ') + ` And ${all.length - shown.length} more; press G for all.`, full: full };
}

/*
 * Read author metadata from comments on each object's name line.
 * source: game text; objects: {name: {lineNumber}}; originalCase: {lower: Original}.
 * Returns {lowerName: {say, quiet, speak, landmark}}.
 */
const META_RE = /\(\s*@(say|quiet|speak|landmark)\b([^)]*)\)/gi;
// the same tags after a // comment: each runs to the next @tag or the end of the line
const SLASH_META_RE = /@(say|quiet|speak|landmark)\b([^@]*)/gi;
function readObjectMeta(source, objects) {
	const lines = source.split('\n');
	const out = {};
	for (const name of Object.keys(objects)) {
		const ln = objects[name].lineNumber;
		if (typeof ln !== 'number') continue;
		// lineNumber is 1-based in this parser; tolerate either
		const base = name.split(':')[0].toLowerCase();
		let line = null;
		for (const cand of [lines[ln - 1], lines[ln]]) {
			if (cand && cand.toLowerCase().indexOf(base) >= 0) { line = cand; break; }
		}
		if (!line) continue;
		const m = {};
		let r;
		META_RE.lastIndex = 0;
		while ((r = META_RE.exec(line))) {
			const key = r[1].toLowerCase();
			m[key] = key === 'say' ? r[2].trim() : true;
		}
		// games written with // comments (PuzzleScript Next): Crate // @say wooden crate @landmark
		const slash = line.indexOf('//');
		if (slash >= 0) {
			SLASH_META_RE.lastIndex = 0;
			const rest = line.slice(slash + 2);
			while ((r = SLASH_META_RE.exec(rest))) {
				const key = r[1].toLowerCase();
				m[key] = key === 'say' ? r[2].trim() : true;
			}
		}
		if (Object.keys(m).length) out[name] = m;
	}
	return out;
}

// A sprite counts as invisible if every drawn pixel is '.' or a transparent colour.
function isInvisibleSprite(obj) {
	if (!obj) return false;
	if (obj.vector || obj.image || obj.load_image) return false;
	const transparent = c => {
		if (c == null) return true;
		const s = String(c).trim().toLowerCase();
		return s === 'transparent' || /^#[0-9a-f]{6}00$/.test(s) || /^#[0-9a-f]{3}0$/.test(s);
	};
	const colors = obj.colors || [];
	const m = obj.spritematrix || [];
	if (!m.length) return colors.length > 0 ? transparent(colors[0]) : false;
	for (const row of m) {
		for (const v of row) {
			if (v >= 0 && !transparent(colors[v])) return false;
		}
	}
	return true;
}

// "crate:up" -> base "crate", suffix "up"; spoken as "crate, facing up" when the suffix is a direction
function splitTagName(name) {
	const i = name.indexOf(':');
	return i < 0 ? [name, ''] : [name.slice(0, i), name.slice(i + 1)];
}

const Core = {
	DIRS, DIR_ORDER, xyOf, cellOf, idsInCell, diffLevels, describeAround, aroundToText,
	formatTurn, relPhrase, plural, joinNames, readObjectMeta, isInvisibleSprite, splitTagName
};

// ---------------------------------------------------------------- glue

const A11y = {
	core: Core,
	enabled: false,          // player/author switch
	show: false,             // ?sr=show: also print announcements visibly
	meta: null,              // per-compile info (names, visibility)
	pending: null,           // snapshot taken at the start of a player turn
	lastSpoken: '',
	lastFull: '',
	lastScreen: null,        // last text screen (title/message) we announced
	inspector: null,         // cell index, or null when following the player
	bookmarks: [],
	bookmarkIdx: -1,
	_offHintUntil: 0,        // after V turns voice mode off, keep the hint up briefly
	_regionEl: null,
	_announcedLevel: null,

	init() {
		if (typeof document === 'undefined') return;
		let q = '';
		try { q = new URLSearchParams(location.search).get('sr') || ''; } catch (e) {}
		if (q === '1' || q === 'on' || q === 'show') this.enabled = true;
		if (q === 'show') this.show = true;
		try { if (localStorage.getItem('ps_a11y') === '1') this.enabled = true; } catch (e) {}
		const ready = () => { this._ensureRegion(); if (this.enabled) this._applyEnabled(); };
		if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
		else ready();
		document.addEventListener('psplusLevelLoaded', () => this._onLevelStart('load'));
		document.addEventListener('psplusLevelRestarted', () => this._onLevelStart('restart'));
	},

	// Is the layer doing anything right now?
	active() {
		return this.enabled
			&& typeof unitTesting !== 'undefined' && !unitTesting
			&& !(typeof solving !== 'undefined' && solving);
	},

	_ensureRegion() {
		if (typeof document === 'undefined') return null;
		if (this._regionEl && document.body.contains(this._regionEl)) return this._regionEl;
		let el = document.getElementById('a11yLive');
		if (!el) {
			el = document.createElement('div');
			el.id = 'a11yLive';
			document.body.appendChild(el);
		}
		el.setAttribute('aria-live', 'assertive');
		el.setAttribute('aria-atomic', 'true');
		el.setAttribute('role', 'status');
		this._regionEl = el;
		this._styleRegion();
		return el;
	},

	_styleRegion() {
		const el = this._regionEl;
		if (!el) return;
		if (this.show) {
			el.style.cssText = 'position:static;margin:8px auto;max-width:90%;color:#ddd;font:14px/1.4 sans-serif;'
				+ 'background:#222;padding:6px 10px;border-radius:4px;white-space:pre-wrap;';
		} else {
			// visually hidden, still read by screen readers
			el.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;'
				+ 'clip:rect(0,0,0,0);white-space:nowrap;border:0;';
		}
	},

	_applyEnabled() {
		if (typeof document === 'undefined') return;
		const c = document.getElementById('gameCanvas');
		if (!c) return;
		const wrap = c.parentElement;
		if (this.enabled) {
			c.setAttribute('tabindex', '0');
			c.setAttribute('aria-label', 'Game. Arrow keys move, X acts, Z undoes, R restarts. '
				+ 'H describes your surroundings, G repeats, N lists everything, I J K L inspect, O reads the inspected square, '
				+ 'B bookmarks it, F steps through bookmarks, V turns voice mode off. Tab leaves the game.');
			// role=application makes screen readers pass letter keys to the game instead of browse mode
			if (wrap) wrap.setAttribute('role', 'application');
			if (wrap && !wrap.getAttribute('aria-label')) wrap.setAttribute('aria-label', 'Puzzle game');
			try { c.focus({ preventScroll: true }); } catch (e) {}
			if (typeof lastDownTarget !== 'undefined') lastDownTarget = c;
			// Keys follow real focus while voice mode is on: Tab out and the
			// game stops taking keys; Tab (or click) back in and it takes them again.
			if (!c._a11yFocusHooked) {
				c._a11yFocusHooked = true;
				c.addEventListener('focus', () => { if (this.enabled && typeof lastDownTarget !== 'undefined') lastDownTarget = c; });
				c.addEventListener('blur', () => { if (this.enabled && typeof lastDownTarget !== 'undefined' && lastDownTarget === c) lastDownTarget = null; });
			}
		} else {
			c.removeAttribute('aria-label');
			if (wrap && wrap.getAttribute('role') === 'application') wrap.removeAttribute('role');
		}
	},

	say(text, full) {
		if (!text) return;
		this.lastSpoken = text;
		this.lastFull = full || text;
		const el = this._ensureRegion();
		if (!el) return;
		// clear first so the same sentence twice is still announced
		el.textContent = '';
		setTimeout(() => { el.textContent = text; }, 30);
	},

	// ---- compile-time metadata

	onCompiled(st, sourceText) {
		if (!st || !st.idDict) return;
		if (st.metadata && 'screen_reader' in st.metadata && !this.enabled) {
			this.enabled = true;
			this._applyEnabled();
		}
		let meta = {};
		try { meta = sourceText ? readObjectMeta(sourceText, st.objects) : {}; } catch (e) { meta = {}; }
		const n = st.idDict.length;
		const names = new Array(n), visible = new Array(n), isPlayer = new Array(n), landmark = new Array(n), keys = new Array(n);
		const playerMask = st.playerMask;
		for (let id = 0; id < n; id++) {
			const lower = st.idDict[id];
			const obj = st.objects[lower];
			const [baseLower, suffix] = splitTagName(lower);
			const m = meta[lower] || meta[baseLower] || {};
			const orig = (st.original_case_names && (st.original_case_names[baseLower] || st.original_case_names[lower])) || baseLower;
			let spoken = m.say || orig.replace(/_/g, ' ');
			if (suffix && Core.DIRS[suffix]) spoken += ', facing ' + suffix;
			names[id] = spoken;
			keys[id] = baseLower;
			const isBg = obj && obj.layer === st.backgroundlayer;
			let vis = !isBg && !isInvisibleSprite(obj);
			if (m.quiet) vis = false;
			if (m.speak) vis = true;
			visible[id] = vis;
			landmark[id] = !!m.landmark;
			isPlayer[id] = !!(playerMask && playerMask.get && playerMask.get(id));
		}
		this.meta = { state: st, names, visible, isPlayer, landmark, keys };
		this.pending = null;
		this.lastScreen = null;
	},

	_geom() {
		return { width: curLevel.width, height: curLevel.height, stride: STRIDE_OBJ, nIds: this.meta.names.length };
	},
	_opts(prefer) {
		const m = this.meta;
		return {
			visible: id => !!m.visible[id],
			isPlayer: id => !!m.isPlayer[id],
			keyOf: id => m.keys[id],
			name: id => m.names[id],
			prefer: prefer || null,
		};
	},
	_ready() {
		return this.active() && this.meta && this.meta.state === state
			&& typeof curLevel !== 'undefined' && curLevel && curLevel.objects && !textMode;
	},
	_player() {
		const p = getPlayerPositions();
		return p.length ? p[0] : null;
	},

	// ---- turn lifecycle

	beginTurn(inputdir) {
		if (!this._ready()) return;
		const dir = inputdir >= 0 && inputdir <= 3 ? DIR_ORDER[inputdir] : inputdir === 4 ? 'action' : null;
		this.pending = {
			before: new Int32Array(curLevel.objects),
			level: curLevelNo, width: curLevel.width, height: curLevel.height,
			dir: dir, player: this._player(),
		};
	},

	// Called after the key's processInput and on every update tick; finishes once `again` settles.
	maybeEndTurn() {
		if (!this.pending) return;
		if (typeof againing !== 'undefined' && againing) return;
		const p = this.pending;
		this.pending = null;
		if (!this._ready() || p.level !== curLevelNo || p.width !== curLevel.width || p.height !== curLevel.height) return;
		const geom = this._geom();
		const opts = this._opts(p.dir);
		const events = diffLevels(p.before, curLevel.objects, geom, opts);
		const player = this._player();
		let blockedBy = null;
		const moved = events.some(e => e.player && (e.kind === 'moved' || e.kind === 'jumped'));
		if (!moved && p.dir && p.dir !== 'action' && player != null) {
			const [dx, dy] = DIRS[p.dir];
			const [x, y] = xyOf(player, geom.height);
			const nx = x + dx, ny = y + dy;
			if (nx < 0 || ny < 0 || nx >= geom.width || ny >= geom.height) blockedBy = ['the edge'];
			else blockedBy = idsInCell(curLevel.objects, geom, cellOf(nx, ny, geom.height))
				.filter(id => opts.visible(id) && !opts.isPlayer(id)).map(opts.name);
		}
		const t = formatTurn(events, { name: opts.name, height: geom.height, player, pressed: p.dir, blockedBy });
		let short = t.short, full = t.full;
		if (typeof winning !== 'undefined' && winning) { short += ' Solved!'; full += ' Solved!'; }
		else if (moved && player != null) {
			// after moving, say what is ahead in the direction of travel
			const around = describeAround(curLevel.objects, geom, player, opts);
			const ahead = aroundToText({ dirs: around.dirs, under: around.under }, [p.dir]);
			short += ' ' + ahead; full += ' ' + aroundToText(around);
		}
		this.say(short, full);
	},

	_onLevelStart(kind) {
		if (!this.active()) return;
		this.pending = null;
		this.inspector = null;
		if (kind === 'load') { this.bookmarks = []; this.bookmarkIdx = -1; }
		// the level may not be fully set up until the event's caller finishes
		setTimeout(() => {
			if (!this._ready()) return;
			const head = kind === 'restart' ? 'Restarted.' : this._levelHeading();
			this.say(head + ' ' + this.surroundingsText(), null);
		}, 0);
	},

	_levelHeading() {
		const st = this.meta.state;
		let num = 0;
		for (let i = 0; i <= curLevelNo && i < st.levels.length; i++) if (!st.levels[i].message) num++;
		const total = st.levels.filter(l => !l.message && l.target === undefined).length;
		const g = this._geom();
		return `Level ${num} of ${total}, ${g.width} wide by ${g.height} high.`;
	},

	afterUndo() {
		if (!this._ready()) return;
		this.pending = null;
		this.say('Undone. ' + this.surroundingsText());
	},

	surroundingsText() {
		const player = this._player();
		if (player == null) return 'No player on this level.';
		const around = describeAround(curLevel.objects, this._geom(), player, this._opts());
		return aroundToText(around);
	},

	// Every visible kind of thing, how many, and where the nearest one is. Landmarks first.
	tallyText() {
		const geom = this._geom(), opts = this._opts(), m = this.meta;
		const player = this._player();
		const byName = new Map();
		const n = geom.width * geom.height;
		for (let c = 0; c < n; c++) {
			for (const id of idsInCell(curLevel.objects, geom, c)) {
				if (!opts.visible(id) || opts.isPlayer(id)) continue;
				const name = m.names[id];
				if (!byName.has(name)) byName.set(name, { count: 0, nearest: null, d: Infinity, landmark: false });
				const r = byName.get(name);
				r.count++;
				if (m.landmark[id]) r.landmark = true;
				if (player != null) {
					const [px, py] = xyOf(player, geom.height), [x, y] = xyOf(c, geom.height);
					const d = Math.abs(px - x) + Math.abs(py - y);
					if (d < r.d) { r.d = d; r.nearest = c; }
				}
			}
		}
		if (!byName.size) return 'Nothing else here.';
		const rows = [...byName.entries()].sort((a, b) => (b[1].landmark - a[1].landmark) || (a[1].d - b[1].d));
		return rows.map(([name, r]) => {
			const where = r.nearest != null ? (r.count > 1 ? ', nearest ' : ', ') + relPhrase(player, r.nearest, geom.height) : '';
			return `${r.landmark ? 'Landmark: ' : ''}${r.count} ${plural(name, r.count)}${where}.`;
		}).join(' ');
	},

	// ---- inspector

	inspectorText(cell) {
		const geom = this._geom(), opts = this._opts(), player = this._player();
		const ids = idsInCell(curLevel.objects, geom, cell).filter(id => opts.visible(id));
		const what = ids.length ? joinNames(ids.map(id => opts.isPlayer(id) ? 'you' : opts.name(id))) : 'empty';
		const [x, y] = xyOf(cell, geom.height);
		const where = player != null ? relPhrase(player, cell, geom.height) : `column ${x + 1}, row ${y + 1}`;
		return `${what}, ${where}.`;
	},

	moveInspector(dir) {
		const geom = this._geom();
		if (this.inspector == null) this.inspector = this._player() != null ? this._player() : 0;
		const [x, y] = xyOf(this.inspector, geom.height);
		const [dx, dy] = DIRS[dir];
		const nx = x + dx, ny = y + dy;
		if (nx < 0 || ny < 0 || nx >= geom.width || ny >= geom.height) { this.say('Edge.'); return; }
		this.inspector = cellOf(nx, ny, geom.height);
		this.say(this.inspectorText(this.inspector));
	},

	// ---- keys. Returns true if the key was consumed.
	handleKey(keyCode, justPressed) {
		if (keyCode === 86) { // V
			if (!justPressed) return true;
			this.enabled = !this.enabled;
			try { localStorage.setItem('ps_a11y', this.enabled ? '1' : '0'); } catch (e) {}
			this._ensureRegion();
			this._applyEnabled();
			if (this.enabled) this.say('Voice mode on. Press H for surroundings, V to turn it off.');
			else {
				if (this._regionEl) this._regionEl.textContent = 'Voice mode off.';
				this._offHintUntil = Date.now() + 3000;
				setTimeout(() => this._redraw(), 3100);
			}
			this._redraw();
			return true;
		}
		if (!this._ready()) return false;
		if (!justPressed) return [72, 71, 78, 79, 66, 70, 73, 74, 75, 76].indexOf(keyCode) >= 0;
		switch (keyCode) {
			case 72: this.say(this.surroundingsText()); return true;            // H
			case 71: this.say(this.lastFull || 'Nothing yet.'); return true;   // G
			case 78: this.say(this.tallyText()); return true;                  // N
			case 73: this.moveInspector('up'); return true;                    // I
			case 74: this.moveInspector('left'); return true;                  // J
			case 75: this.moveInspector('down'); return true;                  // K
			case 76: this.moveInspector('right'); return true;                 // L
			case 79: {                                                          // O
				if (this.inspector == null) { this.say('Inspector is on you. ' + this.inspectorText(this._player() || 0)); return true; }
				const c = this.inspector;
				this.inspector = null;
				this.say(this.inspectorText(c) + ' Inspector back on you.');
				return true;
			}
			case 66: {                                                          // B
				const c = this.inspector != null ? this.inspector : this._player();
				if (c == null) return true;
				if (this.bookmarks.indexOf(c) < 0) this.bookmarks.push(c);
				this.say(`Bookmark ${this.bookmarks.indexOf(c) + 1} set. ` + this.inspectorText(c));
				return true;
			}
			// Not Tab: a screen-reader user must always be able to Tab out of the game (WCAG 2.1.2).
			case 70: {                                                          // F
				if (!this.bookmarks.length) { this.say('No bookmarks. Press B to set one.'); return true; }
				this.bookmarkIdx = (this.bookmarkIdx + 1) % this.bookmarks.length;
				const c = this.bookmarks[this.bookmarkIdx];
				this.inspector = c;
				this.say(`Bookmark ${this.bookmarkIdx + 1}: ` + this.inspectorText(c));
				return true;
			}
		}
		return false;
	},

	_redraw() {
		try { if (typeof redraw === 'function' && typeof canvas !== 'undefined' && canvas) redraw(); } catch (e) {}
	},

	// Text for the visible hint, or null for none. Drawn on the canvas, so
	// screen readers never read it: it is for whoever is looking at the screen.
	hintText() {
		if (this.enabled) return 'Press V to toggle voice mode';
		if (Date.now() < this._offHintUntil) return 'Voice mode off. Press V to toggle voice mode';
		return null;
	},

	// Called at the end of redraw(): the hint goes in the top margin, or on a
	// dark band across the top of the game when there is no margin to use.
	drawHint(ctx, canvas, topMargin) {
		const text = this.hintText();
		if (!text || !ctx || !canvas) return;
		const size = Math.max(10, Math.min(16, Math.round(canvas.height / 32)));
		const band = size + 8;
		ctx.save();
		ctx.font = `${size}px sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		const inMargin = topMargin >= band;
		if (!inMargin) {
			ctx.fillStyle = 'rgba(0,0,0,0.65)';
			ctx.fillRect(0, 0, canvas.width, band);
		}
		ctx.fillStyle = inMargin && typeof state !== 'undefined' && state && state.fgcolor ? state.fgcolor : '#ddd';
		ctx.globalAlpha = inMargin ? 0.75 : 1;
		const y = inMargin ? Math.round(topMargin / 2) : Math.round(band / 2);
		ctx.fillText(text, canvas.width / 2, y);
		ctx.restore();
	},

	// ---- text screens (title, menus, messages). Polled from update().

	pollScreen() {
		if (!this.active()) return;
		if (typeof textMode === 'undefined' || !textMode || !titleImage) { this.lastScreen = null; return; }
		const clean = titleImage.map(l => String(l).replace(/^[\s#>]+|[\s#<]+$/g, '').trim());
		const key = clean.join('\n');
		if (this.lastScreen && this.lastScreen.key === key) return;
		const prev = this.lastScreen;
		this.lastScreen = { key, clean };
		const selected = titleImage.map((l, i) => /#\s.*\s#|>\s.*\s</.test(l) ? clean[i] : null).filter(Boolean);
		if (prev && prev.clean.length === clean.length) {
			const changed = clean.filter((l, i) => l !== prev.clean[i]).length;
			if (changed <= 3 && selected.length) { this.say(selected[0] + ', selected.'); return; }
		}
		let text = clean.filter(Boolean).map(l => /[.!?:]$/.test(l) ? l : l + '.').join(' ');
		if (selected.length) text += ` Selected: ${selected[0]}.`;
		this.say(text);
	},
};

A11y.init();

root.A11y = A11y;
if (typeof module !== 'undefined' && module.exports) module.exports = { Core: Core, A11y: A11y };

})(typeof window !== 'undefined' ? window : globalThis);
