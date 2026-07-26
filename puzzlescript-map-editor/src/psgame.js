'use strict';

// Parser for the parts of a PuzzleScript / PuzzleScript Next source file that a
// map editor cares about: OBJECTS (for colours), LEGEND (for char -> object),
// and LEVELS (the grids themselves).
//
// This deliberately does NOT try to be a full PuzzleScript compiler. It is a
// structural parser that keeps byte-accurate line ranges, so that edited grids
// can be spliced back into the original file without disturbing a single
// comment, blank line or level command.
//
// Behaviour is matched against PuzzleScriptNext's src/js/parser.js:
//   - section headers are a lone section keyword on its own line
//   - a line of only '=' characters is decoration and is skipped
//   - inside LEVELS, lines beginning with a level command verb are commands
//   - every other non-blank line is a grid row, one non-whitespace char per tile
//   - blank lines separate levels

const SECTION_NAMES = [
    'objects', 'legend', 'sounds', 'collisionlayers',
    'rules', 'winconditions', 'tags', 'mappings', 'levels',
];

// Matches parser.js `cmds` in parseLevel().
const LEVEL_COMMANDS = ['goto', 'level', 'link', 'message', 'section', 'title', 'input'];

const RE_EQUALS_ROW = /^=+\s*$/;
const RE_LEVEL_COMMAND = new RegExp(`^(${LEVEL_COMMANDS.join('|')})\\b`, 'i');

/**
 * Split source into lines, keeping each line's terminator separately so the
 * file can be rebuilt byte for byte. Plenty of real PuzzleScript games use
 * CRLF, and silently rewriting those endings would turn a two-tile edit into a
 * whole-file diff.
 */
function splitLines(source) {
    const lines = [];
    const endings = [];
    const re = /\r\n|\n|\r/g;
    let pos = 0;
    let m;
    while ((m = re.exec(source)) !== null) {
        lines.push(source.slice(pos, m.index));
        endings.push(m[0]);
        pos = m.index + m[0].length;
    }
    // Trailing text with no terminator (or the empty string after a final newline).
    lines.push(source.slice(pos));
    endings.push('');

    // The ending to use for lines we add ourselves.
    const counts = {};
    for (const e of endings) if (e) counts[e] = (counts[e] || 0) + 1;
    const dominant = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '\n';

    return { lines, endings, dominant };
}

function joinLines(lines, endings) {
    let out = '';
    for (let i = 0; i < lines.length; i++) out += lines[i] + (endings[i] ?? '');
    return out;
}

/**
 * Strip PuzzleScript comments for the purpose of *classifying* a line.
 * The original text is never modified - this is only used to decide whether a
 * line is blank, a section header, or grid content.
 *
 * PuzzleScript comments are (nested parentheses) and may span lines, so this
 * runs as a single pass over the whole file and returns per-line "code only"
 * text plus the comment nesting depth at the start of each line.
 */
function stripComments(lines) {
    const out = [];
    let depth = 0;
    for (const line of lines) {
        const startDepth = depth;
        let code = '';
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '(') {
                depth++;
            } else if (ch === ')') {
                if (depth > 0) depth--;
                else code += ch; // unbalanced ')' is literal
            } else if (depth === 0) {
                code += ch;
            }
        }
        out.push({ code, startDepth });
    }
    return out;
}

/**
 * Locate each section, returning { name, headerLine, start, end } where
 * [start, end) are line indices of the section body (header and any '===='
 * decoration excluded).
 */
function findSections(lines, stripped) {
    const sections = [];
    for (let i = 0; i < lines.length; i++) {
        if (stripped[i].startDepth > 0) continue;
        const code = stripped[i].code.trim();
        const word = code.toLowerCase();
        if (SECTION_NAMES.includes(word)) {
            if (sections.length) sections[sections.length - 1].end = i;
            sections.push({ name: word, headerLine: i, start: i + 1, end: lines.length });
        }
    }
    // Skip '=====' decoration immediately after each header.
    for (const s of sections) {
        while (s.start < s.end && RE_EQUALS_ROW.test(stripped[s.start].code.trim())) s.start++;
    }
    return sections;
}

/**
 * Parse the OBJECTS section into { name -> { name, aliases, colors } }.
 * Objects are separated by blank lines; the first line is names, an optional
 * second line is colours, and any remaining lines are the sprite matrix.
 */
function parseObjects(lines, stripped, section) {
    const objects = {};
    const order = [];
    Object.defineProperty(objects, '__order', { value: order, enumerable: false });
    if (!section) return objects;

    let block = [];
    const flush = () => {
        if (!block.length) return;
        const nameLine = block[0].trim();
        // Object names may be followed by aliases and (in Next) a copy: directive.
        const tokens = nameLine.split(/\s+/).filter(Boolean);
        if (tokens.length) {
            const name = tokens[0];
            const aliases = tokens.slice(1).filter(t => !t.includes(':'));
            let colors = [];
            let spriteStart = 1;
            if (block.length > 1) {
                const maybeColors = block[1].trim();
                if (maybeColors && looksLikeColorLine(maybeColors)) {
                    colors = maybeColors.split(/\s+/).filter(Boolean);
                    spriteStart = 2;
                }
            }
            const sprite = parseSpriteMatrix(block.slice(spriteStart));
            // `names` keeps the original casing, which is what a level grid and
            // the legend actually contain; the map is keyed lower-case because
            // PuzzleScript is case-insensitive unless the prelude says otherwise.
            const entry = { name, aliases, colors, sprite, names: [name, ...aliases] };
            objects[name.toLowerCase()] = entry;
            for (const a of aliases) objects[a.toLowerCase()] = entry;
            order.push(entry);
        }
        block = [];
    };

    for (let i = section.start; i < section.end; i++) {
        const code = stripped[i].code;
        if (!code.trim()) { flush(); continue; }
        if (RE_EQUALS_ROW.test(code.trim())) continue;
        block.push(code);
    }
    flush();
    return objects;
}

const COLOR_WORDS = new Set([
    'black', 'white', 'grey', 'gray', 'lightgrey', 'lightgray', 'darkgrey', 'darkgray',
    'red', 'darkred', 'lightred', 'brown', 'darkbrown', 'lightbrown', 'orange', 'yellow',
    'green', 'darkgreen', 'lightgreen', 'blue', 'lightblue', 'darkblue', 'purple', 'pink',
    'transparent',
]);

/**
 * Parse an object's sprite matrix - the block of digit rows under its colours.
 *
 * Each character is an index into the object's colour list; '.' is transparent.
 * PuzzleScript's own sprites are 5x5, but PuzzleScript Next allows other sizes
 * via `sprite_size`, so the dimensions come from the matrix itself.
 *
 * Returns null when the lines are not a sprite - objects may legally have no
 * matrix at all, in which case they render as a solid square of colour 0.
 */
function parseSpriteMatrix(lines) {
    const rows = lines.map(l => l.trim()).filter(Boolean);
    if (rows.length < 2) return null;
    if (!rows.every(r => /^[0-9a-z.]+$/i.test(r))) return null;
    if (!rows.every(r => r.length === rows[0].length)) return null;
    // A single column would be ambiguous with other markup.
    if (rows[0].length < 2) return null;

    return {
        width: rows[0].length,
        height: rows.length,
        // Row-major array of colour indices, with null for transparent.
        pixels: rows.map(r => Array.from(r).map(ch => {
            if (ch === '.') return null;
            const n = parseInt(ch, 36);
            return Number.isNaN(n) ? null : n;
        })),
    };
}

function looksLikeColorLine(text) {
    const tokens = text.split(/\s+/).filter(Boolean);
    if (!tokens.length) return false;
    return tokens.every(t => COLOR_WORDS.has(t.toLowerCase()) || /^#[0-9a-f]{3,8}$/i.test(t));
}

/**
 * Parse the LEGEND section into { char -> { key, expansion, objects[], op } }.
 * Only single-character keys can appear in a level grid, so multi-character
 * keys are recorded but flagged as not placeable.
 */
function parseLegend(lines, stripped, section) {
    const legend = {};
    if (!section) return legend;

    for (let i = section.start; i < section.end; i++) {
        const code = stripped[i].code.trim();
        if (!code || RE_EQUALS_ROW.test(code)) continue;
        const eq = code.indexOf('=');
        if (eq < 0) continue;
        const key = code.slice(0, eq).trim();
        const expansion = code.slice(eq + 1).trim();
        if (!key) continue;
        const parts = expansion.split(/\s+/).filter(Boolean);
        const op = parts.find(p => /^(and|or)$/i.test(p));
        const objects = parts.filter(p => !/^(and|or)$/i.test(p));
        legend[key] = {
            key,
            expansion,
            objects,
            op: op ? op.toLowerCase() : null,
            placeable: key.length === 1,
            line: i,
        };
    }
    return legend;
}

/**
 * Parse COLLISIONLAYERS into an array of layers, each a list of object names,
 * bottom layer first. A renderer needs this to stack a tile like
 * `@ = Crate and Target` in the order the game itself would draw it.
 */
function parseCollisionLayers(lines, stripped, section) {
    const layers = [];
    if (!section) return layers;
    for (let i = section.start; i < section.end; i++) {
        const code = stripped[i].code.trim();
        if (!code || RE_EQUALS_ROW.test(code)) continue;
        const names = code.split(',').map(t => t.trim()).filter(Boolean);
        if (names.length) layers.push(names);
    }
    return layers;
}

/**
 * Map each object name to the index of the collision layer it sits on.
 */
function buildLayerIndex(collisionLayers) {
    const index = new Map();
    collisionLayers.forEach((names, i) => {
        for (const n of names) {
            // A layer entry may be a property name covering several objects;
            // storing it as written is enough for ordering purposes.
            if (!index.has(n.toLowerCase())) index.set(n.toLowerCase(), i);
        }
    });
    return index;
}

/**
 * Parse the LEVELS section into an ordered list of blocks.
 *
 * Block kinds:
 *   { kind: 'command', verb, text, line }
 *   { kind: 'grid', rows: [string], lines: [lineIndex], width, height }
 *   { kind: 'blank', line }        - preserved so the file rebuilds exactly
 *   { kind: 'decoration', line }   - '====' rows and comment-only lines
 *
 * Grid blocks record the source line index of every row, which is what makes
 * lossless splice-back possible.
 */
function parseLevels(lines, stripped, section) {
    const blocks = [];
    if (!section) return blocks;

    let current = null;
    const closeGrid = () => {
        if (current) {
            current.width = Math.max(0, ...current.rows.map(r => r.length));
            current.height = current.rows.length;
            blocks.push(current);
            current = null;
        }
    };

    for (let i = section.start; i < section.end; i++) {
        const raw = lines[i];
        const code = stripped[i].code;
        const trimmed = code.trim();

        if (!trimmed) {
            closeGrid();
            blocks.push({ kind: 'blank', line: i, raw });
            continue;
        }
        if (RE_EQUALS_ROW.test(trimmed)) {
            closeGrid();
            blocks.push({ kind: 'decoration', line: i, raw });
            continue;
        }
        const cmd = trimmed.match(RE_LEVEL_COMMAND);
        if (cmd) {
            closeGrid();
            blocks.push({
                kind: 'command',
                verb: cmd[1].toLowerCase(),
                text: trimmed.slice(cmd[1].length).trim(),
                line: i,
                raw,
            });
            continue;
        }
        // Grid row: every non-whitespace character is one tile.
        const cells = trimmed.replace(/\s+/g, '');
        if (!current) current = { kind: 'grid', rows: [], lines: [], indent: raw.match(/^\s*/)[0] };
        current.rows.push(cells);
        current.lines.push(i);
    }
    closeGrid();
    return blocks;
}

/**
 * Group level blocks into "levels" - a grid plus the commands that decorate it.
 * This is the unit a map editor presents as a single tab/page.
 */
function groupLevels(blocks) {
    const levels = [];
    let pending = [];
    for (const b of blocks) {
        if (b.kind === 'grid') {
            levels.push({ grid: b, commandsBefore: pending, commandsAfter: [] });
            pending = [];
        } else if (b.kind === 'command') {
            if (levels.length && !pending.length && b.verb === 'message') {
                // A message immediately after a grid reads as belonging to it,
                // but it is equally a preamble for the next grid. Treat trailing
                // messages as "after" only when no further grid follows.
                pending.push(b);
            } else {
                pending.push(b);
            }
        }
    }
    if (pending.length && levels.length) {
        levels[levels.length - 1].commandsAfter = pending;
    } else if (pending.length) {
        levels.push({ grid: null, commandsBefore: pending, commandsAfter: [] });
    }
    return levels;
}

/**
 * Full parse. Returns everything the editor and the spreadsheet bridge need.
 */
function parseGame(source) {
    const { lines, endings, dominant } = splitLines(source);
    const stripped = stripComments(lines);
    const sections = findSections(lines, stripped);
    const byName = {};
    for (const s of sections) byName[s.name] = s;

    const objects = parseObjects(lines, stripped, byName.objects);
    const legend = parseLegend(lines, stripped, byName.legend);
    const collisionLayers = parseCollisionLayers(lines, stripped, byName.collisionlayers);
    const levelBlocks = parseLevels(lines, stripped, byName.levels);

    // `case_sensitive` in the prelude decides whether P and p are one tile or two.
    const preludeEnd = sections.length ? sections[0].headerLine : lines.length;
    let caseSensitive = false;
    for (let i = 0; i < preludeEnd; i++) {
        if (/^case_sensitive\b/i.test(stripped[i].code.trim())) { caseSensitive = true; break; }
    }

    return {
        source,
        lines,
        endings,
        dominantEnding: dominant,
        stripped,
        sections,
        sectionByName: byName,
        caseSensitive,
        objects,
        collisionLayers,
        layerIndex: buildLayerIndex(collisionLayers),
        legend,
        levelBlocks,
        levels: groupLevels(levelBlocks),
        grids: levelBlocks.filter(b => b.kind === 'grid'),
    };
}

/**
 * Build the set of characters that may legally appear in a level grid,
 * mapped to a human-readable description and a colour for display.
 *
 * A glyph is placeable if it is a single character that is either an object
 * name/alias or a single-character legend key.
 */
function buildGlyphTable(game, palette) {
    const glyphs = {};

    // The drawable form of a glyph: one entry per object it expands to, in
    // legend order, each with its palette-resolved colours and sprite matrix.
    // `@ = Crate and Target` therefore draws as Target with Crate on top.
    const rendersFor = (objectNames) => objectNames.map(n => {
        const obj = game.objects[n.toLowerCase()];
        if (!obj) return null;
        const layer = game.layerIndex ? game.layerIndex.get(obj.name.toLowerCase()) : undefined;
        return {
            name: obj.name,
            colors: obj.colors.map(c => resolveColor(c, palette)),
            sprite: obj.sprite || null,
            layer: layer === undefined ? Infinity : layer,
        };
    }).filter(Boolean)
        // Bottom collision layer first, so a crate draws on top of its target.
        // Objects missing from COLLISIONLAYERS keep their legend order at the top.
        .sort((a, b) => a.layer - b.layer);

    const colorFor = (objectNames) => {
        for (const n of objectNames) {
            const obj = game.objects[n.toLowerCase()];
            if (!obj) continue;
            for (const c of obj.colors) {
                const hex = resolveColor(c, palette);
                if (hex) return hex;
            }
        }
        return null;
    };

    const caseSensitive = game.caseSensitive;
    // Track which glyphs are already claimed, respecting the game's case rules,
    // so that `P` from the legend and `p` from an object alias do not both show
    // up as separate tiles in a case-insensitive game.
    const claimed = new Map();
    const claimKey = ch => (caseSensitive ? ch : ch.toLowerCase());

    const add = (ch, glyph) => {
        const key = claimKey(ch);
        const existing = claimed.get(key);
        if (existing) {
            // Legend entries win over bare object names, since that is the
            // definition the author wrote most deliberately.
            if (existing.source === 'legend' && glyph.source !== 'legend') return;
            delete glyphs[existing.char];
        }
        claimed.set(key, glyph);
        glyphs[ch] = glyph;
    };

    // Single-character object names and aliases, in declaration order.
    for (const obj of game.objects.__order || []) {
        for (const name of obj.names) {
            if (Array.from(name).length !== 1) continue;
            add(name, {
                char: name,
                label: obj.name,
                objects: [obj.name],
                color: colorFor([obj.name]),
                renders: rendersFor([obj.name]),
                source: 'objects',
            });
        }
    }

    // Single-character legend keys override / add to the above.
    for (const [key, entry] of Object.entries(game.legend)) {
        if (!entry.placeable) continue;
        add(key, {
            char: key,
            label: entry.expansion,
            objects: entry.objects,
            color: colorFor(entry.objects),
            renders: rendersFor(entry.objects),
            source: 'legend',
        });
    }

    return glyphs;
}

function resolveColor(token, palette) {
    if (!token) return null;
    const t = token.toLowerCase();
    if (t === 'transparent') return null;
    if (/^#[0-9a-f]{3}$/i.test(token)) {
        return '#' + token.slice(1).split('').map(c => c + c).join('');
    }
    if (/^#[0-9a-f]{6}$/i.test(token)) return token.toUpperCase();
    if (/^#[0-9a-f]{4}$/i.test(token)) {
        return '#' + token.slice(1, 4).split('').map(c => c + c).join('');
    }
    if (/^#[0-9a-f]{8}$/i.test(token)) return '#' + token.slice(1, 7).toUpperCase();
    if (palette && palette[t]) return palette[t].toUpperCase();
    return null;
}

/**
 * Which palette does this game use? Read from the prelude.
 */
function findPaletteName(game) {
    const preludeEnd = game.sections.length ? game.sections[0].headerLine : game.lines.length;
    for (let i = 0; i < preludeEnd; i++) {
        const m = game.stripped[i].code.trim().match(/^(?:color_palette|colour_palette)\s+(\S+)/i);
        if (m) return m[1].toLowerCase();
    }
    return 'arnecolors';
}

/**
 * Replace grid contents in the original source, preserving everything else.
 *
 * `edits` is an array of { gridIndex, rows: [string] }. Grids may change size:
 * rows are spliced in place of the original line range, so growing or shrinking
 * a level works without touching neighbouring levels.
 */
function applyGridEdits(game, edits) {
    const byIndex = new Map();
    for (const e of edits) byIndex.set(e.gridIndex, e.rows);

    // Work back-to-front so earlier line indices stay valid.
    const lines = game.lines.slice();
    const endings = game.endings.slice();
    const grids = game.grids;
    const ordered = [...byIndex.keys()].sort((a, b) => b - a);

    for (const gi of ordered) {
        const grid = grids[gi];
        if (!grid) throw new Error(`No such grid index ${gi} (file has ${grids.length})`);
        const rows = byIndex.get(gi);
        const indent = grid.indent || '';
        const replacement = rows.map(r => indent + r);
        const start = grid.lines[0];
        const count = grid.lines.length;

        // Reuse the original rows' line endings where we can, so a same-size
        // edit produces a minimal diff; new rows get the file's usual ending.
        const oldEndings = endings.slice(start, start + count);
        const newEndings = replacement.map((_, i) =>
            oldEndings[i] !== undefined ? oldEndings[i] : game.dominantEnding);

        lines.splice(start, count, ...replacement);
        endings.splice(start, count, ...newEndings);
    }

    // Any line other than the final one must end with a terminator, or two
    // rows would run together. Only the very last line may lack one, and only
    // if the file never had a trailing newline to begin with.
    for (let i = 0; i < endings.length - 1; i++) {
        if (!endings[i]) endings[i] = game.dominantEnding;
    }
    return joinLines(lines, endings);
}

// Named distinctly rather than a generic `API`: in the browser these files
// load as plain <script>s and share one global scope.
const PSGAME_API = {
    SECTION_NAMES,
    LEVEL_COMMANDS,
    parseGame,
    parseObjects,
    parseLegend,
    parseLevels,
    groupLevels,
    buildGlyphTable,
    resolveColor,
    findPaletteName,
    applyGridEdits,
    stripComments,
    joinLines,
    splitLines,
    findSections,
    parseSpriteMatrix,
    parseCollisionLayers,
    buildLayerIndex,
};

// Usable both as a CommonJS module (the psmap CLI) and as a plain <script> in
// the browser (the web editor), with no build step in either case.
if (typeof module !== 'undefined' && module.exports) module.exports = PSGAME_API;
if (typeof globalThis !== 'undefined') {
    globalThis.PSMap = globalThis.PSMap || {};
    globalThis.PSMap.psgame = PSGAME_API;
}
