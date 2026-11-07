'use strict';

// Grid transforms: rotate, mirror, and wrap-around shift, for a sprite matrix
// or a rectangle of a level.
//
// A grid here is what the editor holds: an array of equal-length strings, one
// character per cell. Every function returns a new grid and leaves its input
// alone, so undo can keep the old one as it is.
//
// There are two families, and they are kept apart on purpose:
//
//   - The editor's own operations (flipH, rotCW, shift, flipAcross, ...),
//     which do what their names say on any grid.
//   - applyEngineTransforms, which replays an object's `flip:`, `rot:` and
//     `shift:` the way PuzzleScript Next's compiler.js applySpriteTransforms
//     does, quirks included, so a `copy:` object is previewed exactly as the
//     game will draw it. test/run.js checks it against a copy of that code.

/** Pad ragged rows out to the widest one, so every transform sees a rectangle. */
function pad(rows, fill) {
    const w = Math.max(0, ...rows.map(r => r.length));
    return rows.map(r => r + fill.repeat(w - r.length));
}

const width = rows => (rows.length ? rows[0].length : 0);
const column = (rows, x) => rows.map(r => r[x]).join('');

/** Mirror left-right: the first column becomes the last. */
function flipH(rows) {
    return rows.map(r => r.split('').reverse().join(''));
}

/** Mirror top-bottom: the first row becomes the last. */
function flipV(rows) {
    return rows.slice().reverse();
}

/** Mirror across the main diagonal (top-left to bottom-right): row i becomes column i. */
function transpose(rows) {
    const out = [];
    for (let x = 0; x < width(rows); x++) out.push(column(rows, x));
    return out;
}

/** Mirror across the other diagonal (top-right to bottom-left). */
function antiTranspose(rows) {
    return rot180(transpose(rows));
}

/** A quarter turn clockwise. */
function rotCW(rows) {
    return transpose(flipV(rows));
}

/** A quarter turn anticlockwise. */
function rotCCW(rows) {
    return flipV(transpose(rows));
}

/** A half turn. */
function rot180(rows) {
    return flipH(flipV(rows));
}

const mod = (n, m) => ((n % m) + m) % m;

/**
 * Move every cell by (dx, dy) on a torus: what leaves one edge comes back in at
 * the opposite one, so nothing is lost and nothing is invented. Positive dx is
 * right, positive dy is down.
 */
function shift(rows, dx, dy) {
    const h = rows.length, w = width(rows);
    if (!h || !w) return rows.slice();
    const sx = mod(dx, w), sy = mod(dy, h);
    const moved = rows.map(r => r.slice(w - sx) + r.slice(0, w - sx));
    return moved.slice(h - sy).concat(moved.slice(0, h - sy));
}

/**
 * Mirror across a line that need not be the centre, wrapping where the mirror
 * image would fall off the grid.
 *
 * `axis2` is twice the position of the mirror line, in cells, so both kinds of
 * line can be named with an integer: an odd number is the centre of a cell
 * (3 is the middle of cell 1), and an even one is the edge between two
 * (4 is between cells 1 and 2). Cell x lands on (axis2 - x) mod width, and
 * likewise for rows. On the grid's own centre line this is flipH or flipV.
 */
function flipAcross(rows, direction, axis2) {
    if (direction === 'vertical') {
        // A vertical mirror line: left and right swap.
        return shift(flipH(rows), axis2 - (width(rows) - 1), 0);
    }
    return shift(flipV(rows), 0, axis2 - (rows.length - 1));
}

/** True when a transform changes the grid's shape (a non-square rotation). */
function swapsShape(op, rows) {
    return ['rotCW', 'rotCCW', 'transpose', 'antiTranspose'].includes(op) && rows.length !== width(rows);
}

const OPERATIONS = { flipH, flipV, transpose, antiTranspose, rotCW, rotCCW, rot180 };

// ------------------------------------------------------------------ engine

// The four absolute directions in PuzzleScript Next's clockwise order. The
// relative ones (> v < ^) only mean something per expansion of a tagged
// object, which this preview does not do, so they are reported, not guessed.
const CLOCKWISE = ['up', 'right', 'down', 'left'];

/**
 * Read the object-transform tokens from a header's modifiers or a transform
 * line: `copy: Name`, `flip:right`, `rot:up:right`, `shift:down:3`,
 * `translate:left:2`, and the Pattern:Script mirrors `|` and `-`.
 *
 * Returns { copyFrom, transforms, ignored }. `transforms` holds the ones that
 * change the matrix, in order: ['flip', dir], ['rot', from, to],
 * ['shift', dir, amount]. Anything else is listed in `ignored` with a reason.
 */
function parseTransformTokens(text, options) {
    const allowBars = !options || options.allowBars !== false;
    const out = { copyFrom: null, transforms: [], ignored: [] };
    // `copy: Name` may have a space after the colon; glue it on first.
    const tokens = String(text || '').replace(/\b(copy|flip|rot|shift|translate|scale|text|canvas):\s+/gi, '$1:')
        .trim().split(/\s+/).filter(Boolean);
    for (const token of tokens) {
        const lower = token.toLowerCase();
        const parts = token.split(':');
        const kind = parts[0].toLowerCase();
        if (allowBars && (token === '|' || token === '-')) {
            out.transforms.push(['flip', token === '-' ? 'down' : 'right']);
        } else if (kind === 'copy') {
            // The name ends where name characters do, as in parser.js: in
            // `copy:Crate:JQ|` the bar is a mirror after the name, not part of it.
            const rest = token.slice(token.indexOf(':') + 1);
            const name = (rest.match(/^[\p{L}\p{N}_$:]+/u) || [''])[0].replace(/:+$/, '');
            out.copyFrom = name || null;
            if (allowBars) {
                for (const ch of rest.slice(name.length)) {
                    if (ch === '|' || ch === '-') out.transforms.push(['flip', ch === '-' ? 'down' : 'right']);
                }
            }
        } else if (kind === 'flip' && parts.length === 2) {
            const dir = parts[1].toLowerCase();
            if (CLOCKWISE.includes(dir)) out.transforms.push(['flip', dir]);
            else out.ignored.push({ token, reason: 'relative or tagged direction' });
        } else if (kind === 'rot' && parts.length === 3) {
            const a = parts[1].toLowerCase(), b = parts[2].toLowerCase();
            if (CLOCKWISE.includes(a) && CLOCKWISE.includes(b)) out.transforms.push(['rot', a, b]);
            else out.ignored.push({ token, reason: 'relative or tagged direction' });
        } else if (kind === 'shift' && (parts.length === 2 || parts.length === 3)) {
            const dir = parts[1].toLowerCase();
            const amount = parts.length === 3 ? Number(parts[2]) : 1;
            if (CLOCKWISE.includes(dir) && Number.isInteger(amount)) out.transforms.push(['shift', dir, amount]);
            else out.ignored.push({ token, reason: 'relative or tagged direction, or a tagged amount' });
        } else if (kind === 'translate') {
            out.ignored.push({ token, reason: 'translate moves the sprite, it does not redraw it' });
        } else if (kind === 'scale' || kind === 'text' || kind === 'canvas') {
            out.ignored.push({ token, reason: 'not a pixel-sprite transform' });
        } else if (/^[a-z]+:/.test(lower)) {
            out.ignored.push({ token, reason: 'unknown transform' });
        }
    }
    return out;
}

/**
 * Apply `flip:`, `rot:` and `shift:` as compiler.js applySpriteTransforms does.
 * Written against arrays of cells the way the engine is, rather than reusing
 * the operations above, because the engine has edges of its own: a shift by
 * more than the sprite's size is a slice past the end, not a wrap.
 */
function applyEngineTransforms(rows, transforms) {
    let m = rows.map(r => r.split(''));
    for (const tf of transforms || []) {
        const dir = CLOCKWISE.indexOf(tf[1]);
        if (tf[0] === 'flip') {
            m = dir % 2 === 0 ? m.slice().reverse() : m.map(r => r.slice().reverse());
        } else if (tf[0] === 'shift') {
            const amt = +tf[2];
            m = [
                x => [...x.slice(amt), ...x.slice(0, amt)],
                x => x.map(r => [...r.slice(-amt), ...r.slice(0, -amt)]),
                x => [...x.slice(-amt), ...x.slice(0, -amt)],
                x => x.map(r => [...r.slice(amt), ...r.slice(0, amt)]),
            ][dir](m);
        } else if (tf[0] === 'rot') {
            const turns = (4 + CLOCKWISE.indexOf(tf[2]) - dir) % 4;
            m = [
                x => x,
                x => Array.from(x[0], (ch, col) => x.map(row => row[col]).reverse()),
                x => Array.from(x, l => l.slice().reverse()).reverse(),
                x => Array.from(x[0], (ch, col) => x.map(row => row[col])).reverse(),
            ][turns](m);
        }
    }
    return m.map(r => r.join(''));
}

/** Write transforms back out as a Next transform line: `flip:right rot:up:left`. */
function formatTransforms(transforms) {
    return transforms.map(tf => tf.join(':')).join(' ');
}

const TRANSFORM_API = {
    pad, flipH, flipV, transpose, antiTranspose, rotCW, rotCCW, rot180, shift, flipAcross,
    swapsShape, OPERATIONS, CLOCKWISE, parseTransformTokens, applyEngineTransforms, formatTransforms,
};

if (typeof module !== 'undefined' && module.exports) module.exports = TRANSFORM_API;
if (typeof globalThis !== 'undefined') {
    globalThis.PSMap = globalThis.PSMap || {};
    globalThis.PSMap.transform = TRANSFORM_API;
}
