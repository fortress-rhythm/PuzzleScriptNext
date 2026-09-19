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
//
// PuzzleScript Next's own dialect is understood as well, because a game written
// for it is otherwise unreadable here - every one of these turned Charmroach
// into a wall of red crosses:
//   - `//` line comments. The first comment in the file decides the style, as
//     in parser.js matchComment(): a game uses `//` or `( )`, never both
//   - `Name glyph glyph; colour colour` object headers, with the colours on the
//     header line after a semicolon (only in the `//` style, where `;` cannot
//     be a glyph)
//   - several single-character aliases on one header: `MergedRoach N E S W`
//   - `copy:`, `rot:` and the other transforms after the names
//   - a TAGS section, and `Roach:directions` defining four objects at once
//   - properties and tag classes wherever an object name may appear: the
//     legend, COLLISIONLAYERS (`Dark:Shade`), and `--` layer-group dividers
//   - 8-digit hex colours with an alpha channel

const SECTION_NAMES = [
    'objects', 'legend', 'sounds', 'collisionlayers',
    'rules', 'winconditions', 'tags', 'mappings', 'levels',
];

// Matches parser.js `cmds` in parseLevel().
const LEVEL_COMMANDS = ['goto', 'level', 'link', 'message', 'section', 'title', 'input'];

// Prelude settings whose value is free text running to the end of the line.
// parser.js reads these with matchAll(), so a `//` or `(` inside them is never
// seen by the comment matcher - `homepage https://...` must not pick the style.
const PRELUDE_TEXT_PARAMS = ['title', 'author', 'homepage', 'custom_font', 'text_controls',
    'text_message_continue', 'debug_switch', 'export_options'];

// Object header modifiers, from parser.js reg_objmodi. The first of these on a
// header line ends the run of names and glyphs.
const RE_OBJECT_MODIFIER = /^(canvas|copy|flip|rot|scale|shift|text|translate):/i;

// Tags every game has without declaring them, from parser.js's initial state.
const BUILTIN_TAGS = {
    directions: ['up', 'right', 'down', 'left'],
    horizontal: ['right', 'left'],
    vertical: ['up', 'down'],
};

const RE_EQUALS_ROW = /^=+\s*$/;
const RE_LEVEL_COMMAND = new RegExp(`^(${LEVEL_COMMANDS.join('|')})\\b`, 'i');
const RE_PRELUDE_TEXT = new RegExp(`^(${PRELUDE_TEXT_PARAMS.join('|')})\\b`, 'i');

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
 * Which comment style a file uses: '()' or '//'.
 *
 * PuzzleScript Next decides this the first time its comment matcher meets
 * either a `(` or a `//` at the start of a token, and from then on the other
 * one is ordinary text (`//` style) or a warning (`()` style). Doing the same
 * here is what lets a `//` game's `(` in a MESSAGE survive, and a `()` game's
 * `//` in a URL stay a URL.
 *
 * Text-valued prelude lines are skipped because parser.js swallows their value
 * whole and never looks inside it - `homepage https://example.com` is the
 * common case, and it comes before any real comment in most files.
 */
function detectCommentStyle(lines) {
    for (const line of lines) {
        const text = line.trim();
        if (!text) continue;
        if (RE_PRELUDE_TEXT.test(text)) continue;
        const paren = text.indexOf('(');
        // `//` only counts at a token boundary; `https://` is not a comment.
        const slash = text.search(/(^|\s)\/\//);
        if (paren < 0 && slash < 0) continue;
        if (slash < 0) return '()';
        if (paren < 0) return '//';
        return paren < slash ? '()' : '//';
    }
    return '()';
}

/**
 * Strip PuzzleScript comments for the purpose of *classifying* a line.
 * The original text is never modified - this is only used to decide whether a
 * line is blank, a section header, or grid content.
 *
 * Classic PuzzleScript comments are (nested parentheses) and may span lines, so
 * this runs as a single pass over the whole file and returns per-line "code
 * only" text plus the comment nesting depth at the start of each line. In the
 * `//` style a comment runs from a `//` at a token boundary to the end of the
 * line, and parentheses are just characters.
 */
function stripComments(lines, style) {
    style = style || detectCommentStyle(lines);
    const out = [];
    if (style === '//') {
        for (const line of lines) {
            const m = line.match(/(^|\s)\/\//);
            out.push({ code: m ? line.slice(0, m.index) : line, startDepth: 0 });
        }
        return out;
    }
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
 * Parse the TAGS section into { tagname -> [values] }, lower-cased, on top of
 * the built-in `directions`, `horizontal` and `vertical`.
 *
 *     Shade = Faint Dim Deep Full
 *
 * A tag class named in an object identifier (`Dark:Shade`) stands for each of
 * its values in turn, and that is the whole reason this parser needs to know
 * about tags at all: it is how one header line defines several objects.
 */
function parseTags(lines, stripped, section) {
    const tags = {};
    for (const [k, v] of Object.entries(BUILTIN_TAGS)) tags[k] = v.slice();
    if (!section) return tags;
    for (let i = section.start; i < section.end; i++) {
        const code = stripped[i].code.trim();
        if (!code || RE_EQUALS_ROW.test(code)) continue;
        const m = code.match(/^(\S+)\s*=\s*(.+)$/);
        if (!m) continue;
        const values = m[2].split(/\s+/).filter(Boolean).map(v => v.toLowerCase());
        // A tag may be built from other tags: `Glow = Faint Dim` is plain
        // values, but `All = Shade Extra` would expand Shade. Resolve one level
        // at a time, in file order, the way the compiler sees them.
        const flat = [];
        for (const v of values) {
            if (tags[v]) flat.push(...tags[v]);
            else flat.push(v);
        }
        tags[m[1].toLowerCase()] = flat;
    }
    return tags;
}

/**
 * Expand an identifier with tag parts into the concrete names it stands for.
 *
 *     Roach:directions  ->  Roach:up Roach:right Roach:down Roach:left
 *     Dark:Shade        ->  Dark:Faint Dark:Dim Dark:Deep Dark:Full
 *     Roach:right       ->  Roach:right         (a value, not a class)
 *     Wall              ->  Wall
 *
 * Several tag parts multiply out. The parts keep the casing they were written
 * with, except that a tag value is spelled the way the TAGS section spelled it,
 * since that is what the rest of the file will use. Returns [ident] unchanged
 * when nothing in it is a tag class, so callers can test `length > 1 ||
 * result[0] !== ident` to know whether anything happened.
 */
function expandTaggedName(ident, tags) {
    const parts = ident.split(':');
    if (parts.length < 2) return [ident];
    let combos = [[parts[0]]];
    let expanded = false;
    for (const part of parts.slice(1)) {
        const values = tags[part.toLowerCase()];
        const options = values ? values : [part];
        if (values) expanded = true;
        const next = [];
        for (const c of combos) for (const v of options) next.push([...c, v]);
        combos = next;
    }
    return expanded ? combos.map(c => c.join(':')) : [ident];
}

/**
 * Split an OBJECTS header line into its parts.
 *
 *     Player P                        classic: a name and an alias
 *     MergedRoach N E S W             several glyph aliases
 *     Roach:right e; Black Yellow     Next: glyph, then colours after `;`
 *     Ghost copy:Player rot:right     transforms end the run of names
 *
 * The `;` form is only legal in the `//` comment style - in the `()` style a
 * semicolon is just another glyph, and parser.js agrees.
 */
function parseObjectHeader(text, commentStyle) {
    let head = text;
    let inlineColors = null;
    if (commentStyle === '//') {
        const semi = text.indexOf(';');
        if (semi >= 0) {
            head = text.slice(0, semi);
            inlineColors = text.slice(semi + 1).trim();
        }
    }
    const tokens = head.trim().split(/\s+/).filter(Boolean);
    const name = tokens[0] || '';
    const aliases = [];
    let i = 1;
    for (; i < tokens.length; i++) {
        const t = tokens[i];
        // Only a `keyword:` modifier ends the names. `-` and `|` are
        // Pattern:Script mirror shorthands on a transform line, but on the
        // header line parser.js reads them as glyphs, and games use them.
        if (RE_OBJECT_MODIFIER.test(t)) break;
        aliases.push(t);
    }
    const modifiers = tokens.slice(i).join(' ');
    const copy = modifiers.match(/\bcopy:\s*(\S+)/i);
    return {
        name,
        aliases,
        inlineColors,
        copyFrom: copy ? copy[1] : null,
        hasTransforms: i < tokens.length,
    };
}

/**
 * Parse the OBJECTS section into { name -> { name, aliases, colors, sprite } }.
 *
 * Objects are separated by blank lines; the first line is the header (names,
 * glyphs, transforms, and in the `//` style the colours after a `;`), an
 * optional next line is colours, and any remaining lines are the sprite matrix.
 *
 * Each header produces one *block* - the thing you would edit in a sprite
 * editor, with its source line range - and one or more *objects*: a tagged
 * header such as `Roach:directions` yields four, all sharing the block's
 * colours and sprite. The map is keyed lower-case because PuzzleScript is
 * case-insensitive unless the prelude says otherwise; `names` keeps the
 * casing the file actually uses. `objects.__order` lists the objects in
 * declaration order and `objects.__blocks` the blocks; neither is enumerable,
 * so `Object.keys(objects)` is still just the names.
 *
 * `properties` collects the names that stand for several objects at once -
 * `Roach:directions` itself, once expanded - so the legend and the collision
 * layers can use them.
 */
function parseObjects(lines, stripped, section, tags, commentStyle) {
    tags = tags || parseTags(lines, stripped, null);
    const objects = {};
    const order = [];
    const blocks = [];
    const properties = {};
    Object.defineProperty(objects, '__order', { value: order, enumerable: false });
    Object.defineProperty(objects, '__blocks', { value: blocks, enumerable: false });
    Object.defineProperty(objects, '__properties', { value: properties, enumerable: false });
    if (!section) return objects;

    let block = [];      // [{ code, line }]
    const flush = () => {
        if (!block.length) { block = []; return; }
        const header = parseObjectHeader(block[0].code, commentStyle);
        if (header.name) {
            let colors = [];
            let spriteStart = 1;
            if (header.inlineColors !== null) {
                colors = header.inlineColors.split(/\s+/).filter(Boolean);
            } else if (block.length > 1) {
                const maybeColors = block[1].code.trim();
                if (maybeColors && looksLikeColorLine(maybeColors)) {
                    colors = maybeColors.split(/\s+/).filter(Boolean);
                    spriteStart = 2;
                }
            }
            // Transform lines (`rot:right`, `text: A`) may follow the matrix on
            // their own lines; they are not rows of it.
            const spriteRows = block.slice(spriteStart)
                .filter(r => !RE_OBJECT_MODIFIER.test(r.code.trim()));
            const sprite = parseSpriteMatrix(spriteRows.map(r => r.code));
            const entry = {
                name: header.name,
                aliases: header.aliases,
                colors,
                sprite,
                names: [header.name, ...header.aliases],
                copyFrom: header.copyFrom,
                headerLine: block[0].line,
                // Where the sprite rows live, so an edited sprite can be spliced
                // back exactly as a level can. An object with no matrix records
                // the line a new one would follow.
                spriteLines: sprite ? spriteRows.map(r => r.line) : [],
                spriteInsertAfterLine: block[Math.min(spriteStart, block.length) - 1].line,
                indent: sprite ? (lines[spriteRows[0].line].match(/^\s*/)[0]) : '',
            };
            blocks.push(entry);

            const expanded = expandTaggedName(header.name, tags);
            const concrete = [];
            for (const fullName of expanded) {
                // Every expansion shares the block's colours and sprite. A
                // `rot:` transform would turn the sprite per direction in the
                // engine; here the base drawing stands for all of them.
                const obj = fullName === header.name ? entry
                    : Object.assign({}, entry, { name: fullName, names: [fullName], aliases: [], block: entry });
                if (fullName === header.name) entry.block = entry;
                objects[fullName.toLowerCase()] = obj;
                order.push(obj);
                concrete.push(fullName);
            }
            if (concrete.length > 1 || concrete[0] !== header.name) {
                properties[header.name.toLowerCase()] = concrete;
                // The glyph aliases on a tagged header attach to the property,
                // which the engine rejects in a level - but keep them findable.
                for (const a of header.aliases) properties[a.toLowerCase()] = concrete;
            } else {
                for (const a of header.aliases) objects[a.toLowerCase()] = entry;
            }
        }
        block = [];
    };

    // Does this line continue the block that is open, or start a new one? A
    // blank line always ends a block, but the `;` header form lets a game write
    // one object per line with nothing between them:
    //
    //     Dark:Faint; #00002A30
    //     Dark:Dim;   #00002A58
    //
    // parser.js knows because it tracks what it expects next; the equivalent
    // here is that once a block has its colours, a line is a sprite row only if
    // it looks like one *for that block* - every character an index into its
    // colour list. Anything else is the next object's header.
    const blockHasColors = () => {
        if (!block.length) return false;
        const header = parseObjectHeader(block[0].code, commentStyle);
        if (header.inlineColors !== null) return true;
        return block.length > 1 && looksLikeColorLine(block[1].code.trim());
    };
    const blockColorCount = () => {
        const header = parseObjectHeader(block[0].code, commentStyle);
        const text = header.inlineColors !== null ? header.inlineColors : block[1].code.trim();
        return text.split(/\s+/).filter(Boolean).length;
    };
    const isSpriteRowFor = (text, colorCount) => {
        if (!/^[0-9a-z.]+$/i.test(text)) return false;
        for (const ch of text) {
            if (ch === '.') continue;
            if (parseInt(ch, 36) >= colorCount) return false;
        }
        return true;
    };
    const startsNewObject = (text) => {
        if (!block.length) return false;
        if (commentStyle === '//' && text.includes(';')) return true;
        if (RE_OBJECT_MODIFIER.test(text)) return false;      // `rot:right` on its own line
        if (/^text:/i.test(text)) return false;
        if (!blockHasColors()) return false;
        if (block.length === 1 && looksLikeColorLine(text)) return false;
        return !isSpriteRowFor(text, blockColorCount());
    };

    for (let i = section.start; i < section.end; i++) {
        const code = stripped[i].code;
        const text = code.trim();
        if (!text) { flush(); continue; }
        if (RE_EQUALS_ROW.test(text)) continue;
        if (startsNewObject(text)) flush();
        block.push({ code, line: i });
    }
    flush();

    // `copy:` - an object drawn with another's sprite. Resolved after the whole
    // section is read because the source may be declared later.
    for (const obj of blocks) {
        if (!obj.copyFrom || obj.sprite) continue;
        const source = objects[obj.copyFrom.toLowerCase()]
            || objects[(expandTaggedName(obj.copyFrom, tags)[0] || '').toLowerCase()];
        if (source && source.sprite) obj.sprite = source.sprite;
    }
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
        // The key is the first token, then a separating '='. Splitting on the
        // first '=' in the line would be wrong for `= = Equals`, where the key
        // itself is an equals sign - a legal and occasionally used glyph.
        const m = code.match(/^(\S+?)\s*=\s*(.*)$/);
        if (!m) continue;
        const key = m[1];
        const expansion = m[2].trim();
        if (!key || !expansion) continue;
        const parts = expansion.split(/\s+/).filter(Boolean);
        const op = parts.find(p => /^(and|or)$/i.test(p));
        const objects = parts.filter(p => !/^(and|or)$/i.test(p));
        legend[key] = {
            key,
            expansion,
            objects,
            op: op ? op.toLowerCase() : null,
            placeable: Array.from(key).length === 1,
            line: i,
        };
    }
    return legend;
}

/**
 * Parse COLLISIONLAYERS into an array of layers, each a list of object names,
 * bottom layer first. A renderer needs this to stack a tile like
 * `@ = Crate and Target` in the order the game itself would draw it.
 *
 * PuzzleScript Next adds two things that are not object names: a `--` line
 * (with optional arrow decoration) that opens a new layer group, and `->`
 * between names. Neither is a layer, so both are dropped here.
 */
function parseCollisionLayers(lines, stripped, section) {
    const layers = [];
    if (!section) return layers;
    for (let i = section.start; i < section.end; i++) {
        const code = stripped[i].code.trim();
        if (!code || RE_EQUALS_ROW.test(code)) continue;
        if (/^--/.test(code)) continue;
        const names = code.replace(/->/g, ',').split(',').map(t => t.trim()).filter(Boolean);
        if (names.length) layers.push(names);
    }
    return layers;
}

/**
 * Everything a name in the legend or the collision layers stands for, as a
 * list of concrete object names in declaration casing.
 *
 *     Wall               -> [Wall]
 *     Roach:directions   -> the four roaches       (a tag class)
 *     Opaque             -> Wall, MergedRoach, ... (a legend property)
 *     Dark:Shade         -> Dark:Faint, ...
 *
 * Legend entries are followed so an alias of an alias resolves, with a guard
 * against a legend that loops. An unknown name resolves to nothing, and the
 * caller decides how loudly to say so.
 */
function resolveNames(game, ident, seen) {
    seen = seen || new Set();
    const key = String(ident).toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);

    const obj = game.objects[key];
    if (obj) return [obj.name];

    const property = game.objects.__properties && game.objects.__properties[key];
    if (property) return property.flatMap(n => resolveNames(game, n, seen));

    const tagged = expandTaggedName(ident, game.tags || BUILTIN_TAGS);
    if (tagged.length > 1 || tagged[0] !== ident) {
        return tagged.flatMap(n => resolveNames(game, n, seen));
    }

    const entry = game.legend[ident] || (game.legendByLower && game.legendByLower[key]);
    if (entry) return entry.objects.flatMap(n => resolveNames(game, n, seen));
    return [];
}

/**
 * Map each object name to the index of the collision layer it sits on.
 *
 * Layer entries are written as objects, properties or tag classes; every one is
 * expanded to the concrete objects underneath, so `Witch:directions` on layer 5
 * puts `Witch:down` on layer 5. The name as written is kept too.
 */
function buildLayerIndex(collisionLayers, game) {
    const index = new Map();
    collisionLayers.forEach((names, i) => {
        for (const n of names) {
            const key = n.toLowerCase();
            if (!index.has(key)) index.set(key, i);
            if (!game) continue;
            for (const concrete of resolveNames(game, n)) {
                const ck = concrete.toLowerCase();
                if (!index.has(ck)) index.set(ck, i);
            }
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
 * The name a grid should carry: the nearest LEVEL command in front of it, or
 * failing that the nearest SECTION.
 *
 * "Nearest" is the whole point. A SECTION with no map under it yet is legal and
 * common while a game is being built out, and those orphaned commands stack up
 * in front of the *next* grid. Taking the first of that stack labels a map with
 * the name of an empty section several headings earlier.
 */
function labelForCommands(commands) {
    const list = commands || [];
    for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i];
        if ((c.verb === 'level' || c.verb === 'section') && c.text) return c.text;
    }
    return '';
}

/**
 * The LEVEL/SECTION headings in this list that own no map.
 *
 * Within `commandsBefore` the last heading owns the grid that follows, so every
 * earlier one is an empty section. In `commandsAfter` there is no grid at all,
 * so all of them are.
 */
function orphanLabels(commands, ownsFollowingGrid) {
    return emptySections(commands, ownsFollowingGrid).map(s => s.label);
}

/**
 * The same empty sections, but with the line a new grid would go after.
 *
 * A heading owns every command up to the next heading, and its map belongs
 * directly beneath those - so the insertion point is the last command line of
 * the run, and a grid inserted there lands where an author would have typed it.
 */
function emptySections(commands, ownsFollowingGrid) {
    const list = commands || [];
    const runs = [];
    for (const c of list) {
        const isHeading = (c.verb === 'level' || c.verb === 'section') && c.text;
        if (isHeading) {
            runs.push({ label: c.text, lastLine: c.line });
        } else if (runs.length) {
            // Commands under the current heading extend its run.
            runs[runs.length - 1].lastLine = c.line;
        }
        // Commands before any heading belong to no section, and are ignored.
    }
    // When a grid follows, the final heading owns it and is not empty.
    return ownsFollowingGrid ? runs.slice(0, -1) : runs;
}

/**
 * Full parse. Returns everything the editor and the spreadsheet bridge need.
 */
function parseGame(source) {
    const { lines, endings, dominant } = splitLines(source);
    const commentStyle = detectCommentStyle(lines);
    const stripped = stripComments(lines, commentStyle);
    const sections = findSections(lines, stripped);
    const byName = {};
    for (const s of sections) byName[s.name] = s;

    const tags = parseTags(lines, stripped, byName.tags);
    const objects = parseObjects(lines, stripped, byName.objects, tags, commentStyle);
    const legend = parseLegend(lines, stripped, byName.legend);
    const collisionLayers = parseCollisionLayers(lines, stripped, byName.collisionlayers);
    const levelBlocks = parseLevels(lines, stripped, byName.levels);

    // The legend keyed case-insensitively as well, for games that write `wall`
    // in one place and `Wall` in another. Exact matches are tried first.
    const legendByLower = {};
    for (const [k, v] of Object.entries(legend)) {
        if (!(k.toLowerCase() in legendByLower)) legendByLower[k.toLowerCase()] = v;
    }

    // Prelude settings the editor cares about. `case_sensitive` decides whether
    // P and p are one tile or two; `sprite_size` is what every sprite must be.
    const preludeEnd = sections.length ? sections[0].headerLine : lines.length;
    let caseSensitive = false;
    let spriteSize = 5;
    for (let i = 0; i < preludeEnd; i++) {
        const code = stripped[i].code.trim();
        if (/^case_sensitive\b/i.test(code)) caseSensitive = true;
        const m = code.match(/^sprite_size\s+(\d+)/i);
        if (m) spriteSize = Number(m[1]);
    }

    const game = {
        source,
        lines,
        endings,
        dominantEnding: dominant,
        commentStyle,
        stripped,
        sections,
        sectionByName: byName,
        caseSensitive,
        spriteSize,
        tags,
        objects,
        blocks: objects.__blocks || [],
        properties: objects.__properties || {},
        collisionLayers,
        layerIndex: null,
        legend,
        legendByLower,
        levelBlocks,
        levels: groupLevels(levelBlocks),
        grids: levelBlocks.filter(b => b.kind === 'grid'),
    };
    game.layerIndex = buildLayerIndex(collisionLayers, game);
    return game;
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

    // What a legend entry actually puts in a cell. `Crate and Target` is both;
    // `Roach:directions` is a property and cannot be placed, so the first member
    // stands in for it on screen rather than a red cross - the compiler will
    // say the rest. Names are expanded through properties, tag classes and
    // other legend entries alike.
    const concreteFor = (objectNames, op) => {
        if (op === 'or') {
            const all = objectNames.flatMap(n => resolveNames(game, n));
            return all.length ? [all[0]] : [];
        }
        return objectNames.flatMap(n => {
            const resolved = resolveNames(game, n);
            // An `and` of a property is not a thing the engine accepts either,
            // but drawing one of it is better than nothing.
            return resolved.length > 1 && !game.objects[n.toLowerCase()] ? [resolved[0]] : resolved;
        });
    };

    // The drawable form of a glyph: one entry per object it expands to, in
    // legend order, each with its palette-resolved colours and sprite matrix.
    // `@ = Crate and Target` therefore draws as Target with Crate on top.
    const rendersFor = (objectNames, op) => concreteFor(objectNames, op).map(n => {
        const obj = game.objects[n.toLowerCase()];
        if (!obj) return null;
        const layer = game.layerIndex ? game.layerIndex.get(obj.name.toLowerCase()) : undefined;
        return {
            name: obj.name,
            // Alpha is kept for drawing - a `#00002A80` night shade really is
            // translucent in the game - but `color` below stays opaque for
            // spreadsheets and swatches.
            colors: obj.colors.map(c => resolveColor(c, palette, true)),
            sprite: obj.sprite || null,
            layer: layer === undefined ? Infinity : layer,
        };
    }).filter(Boolean)
        // Bottom collision layer first, so a crate draws on top of its target.
        // Objects missing from COLLISIONLAYERS keep their legend order at the top.
        .sort((a, b) => a.layer - b.layer);

    const colorFor = (objectNames, op) => {
        for (const n of concreteFor(objectNames, op)) {
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
            color: colorFor(entry.objects, entry.op),
            renders: rendersFor(entry.objects, entry.op),
            source: 'legend',
        });
    }

    return glyphs;
}

/**
 * Every glyph a game's levels actually use that the glyph table cannot
 * explain, with how often each appears. Empty for a game that compiles.
 */
function unknownGlyphs(game, glyphs) {
    const lookup = (() => {
        if (game.caseSensitive) return ch => glyphs[ch];
        const folded = new Map();
        for (const [ch, g] of Object.entries(glyphs)) folded.set(ch.toLowerCase(), g);
        return ch => glyphs[ch] || folded.get(String(ch).toLowerCase());
    })();
    const counts = new Map();
    for (const grid of game.grids) {
        for (const row of grid.rows) {
            for (const ch of Array.from(row)) {
                if (lookup(ch)) continue;
                counts.set(ch, (counts.get(ch) || 0) + 1);
            }
        }
    }
    return [...counts].map(([char, count]) => ({ char, count }));
}

/**
 * A colour token as CSS hex, or null for `transparent` and the unknown.
 *
 * PuzzleScript accepts #RGB, #RGBA, #RRGGBB and #RRGGBBAA. The alpha channel
 * is dropped unless `keepAlpha` is set, because a spreadsheet fill or a swatch
 * has no use for it - a canvas does.
 */
function resolveColor(token, palette, keepAlpha) {
    if (!token) return null;
    const t = token.toLowerCase();
    if (t === 'transparent') return null;
    if (/^#[0-9a-f]{3}$/i.test(token)) {
        return '#' + token.slice(1).split('').map(c => c + c).join('');
    }
    if (/^#[0-9a-f]{6}$/i.test(token)) return token.toUpperCase();
    if (/^#[0-9a-f]{4}$/i.test(token)) {
        const rgb = '#' + token.slice(1, 4).split('').map(c => c + c).join('').toUpperCase();
        return keepAlpha ? rgb + (token[4] + token[4]).toUpperCase() : rgb;
    }
    if (/^#[0-9a-f]{8}$/i.test(token)) {
        return keepAlpha ? token.toUpperCase() : '#' + token.slice(1, 7).toUpperCase();
    }
    if (palette && palette[t]) return palette[t].toUpperCase();
    return null;
}

/**
 * Which palette does this game use, and what does it change about it?
 *
 * Returns { name, overrides } where overrides is a list of [key, token] pairs
 * in source order, ready for palettes.resolvePalette.
 *
 * The whole line matters, not just the first word. PuzzleScript's
 * `color_palette <base> <key> <value> ...` form spells out per-game overrides
 * on top of a stock palette, and it is the form you are meant to distribute -
 * it is the only one that runs on every build. Reading just the base name and
 * discarding the rest rendered exactly those games in the wrong colours, with
 * no indication anything had been ignored.
 *
 * A trailing unpaired token is ignored rather than treated as an error: this
 * is a viewer, and half a pair is more likely a typo in someone else's game
 * than a reason to refuse to draw their map.
 */
function findPaletteSpec(game) {
    const preludeEnd = game.sections.length ? game.sections[0].headerLine : game.lines.length;
    for (let i = 0; i < preludeEnd; i++) {
        const m = game.stripped[i].code.trim()
            .match(/^(?:color_palette|colour_palette)\s+(.+)$/i);
        if (!m) continue;
        const tokens = m[1].trim().split(/\s+/);
        const name = tokens.shift().toLowerCase();
        const overrides = [];
        for (let j = 0; j + 1 < tokens.length; j += 2) {
            overrides.push([tokens[j].toLowerCase(), tokens[j + 1]]);
        }
        return { name, overrides };
    }
    return { name: 'arnecolors', overrides: [] };
}

/** The base palette name alone. Kept for callers that only want the label. */
function findPaletteName(game) {
    return findPaletteSpec(game).name;
}

/**
 * Replace grid contents in the original source, preserving everything else.
 *
 * `edits` is an array of { gridIndex, rows: [string] }. Grids may change size:
 * rows are spliced in place of the original line range, so growing or shrinking
 * a level works without touching neighbouring levels.
 *
 * Two other shapes of edit use the same splice: { insertAfterLine, rows } puts
 * a new grid into a section that had none, and { startLine, lineCount, rows }
 * replaces any run of lines - which is how an edited sprite matrix in the
 * OBJECTS section goes back, since a sprite is a grid of characters too.
 */
function applyGridEdits(game, edits) {
    const lines = game.lines.slice();
    const endings = game.endings.slice();
    const grids = game.grids;

    // Every operation is a line range to splice: replacing an existing grid,
    // inserting a new one into a section that has none yet, or replacing an
    // arbitrary range. Sorting by start line descending keeps every index
    // valid as we go, whichever kind it is.
    const ops = [];
    for (const e of edits) {
        if (e.startLine !== undefined && e.startLine !== null) {
            ops.push({
                start: e.startLine,
                count: e.lineCount || 0,
                indent: e.indent || '',
                rows: e.rows,
            });
        } else if (e.gridIndex !== undefined && e.gridIndex !== null) {
            const grid = grids[e.gridIndex];
            if (!grid) {
                throw new Error(`No such grid index ${e.gridIndex} (file has ${grids.length})`);
            }
            ops.push({
                start: grid.lines[0],
                count: grid.lines.length,
                indent: grid.indent || '',
                rows: e.rows,
            });
        } else if (e.insertAfterLine !== undefined && e.insertAfterLine !== null) {
            if (!e.rows || !e.rows.length) continue;
            ops.push({
                start: e.insertAfterLine + 1,
                count: 0,
                indent: '',
                rows: e.rows,
            });
        } else {
            throw new Error('An edit needs a gridIndex, an insertAfterLine or a startLine');
        }
    }
    ops.sort((a, b) => b.start - a.start);

    for (const op of ops) {
        const replacement = op.rows.map(r => op.indent + r);
        const { start, count } = op;

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
    findPaletteSpec,
    SECTION_NAMES,
    LEVEL_COMMANDS,
    BUILTIN_TAGS,
    parseGame,
    parseObjects,
    parseObjectHeader,
    parseTags,
    expandTaggedName,
    resolveNames,
    parseLegend,
    parseLevels,
    groupLevels,
    buildGlyphTable,
    unknownGlyphs,
    resolveColor,
    findPaletteName,
    applyGridEdits,
    detectCommentStyle,
    stripComments,
    joinLines,
    splitLines,
    findSections,
    parseSpriteMatrix,
    parseCollisionLayers,
    buildLayerIndex,
    labelForCommands,
    orphanLabels,
    emptySections,
};

// Usable both as a CommonJS module (the psmap CLI) and as a plain <script> in
// the browser (the web editor), with no build step in either case.
if (typeof module !== 'undefined' && module.exports) module.exports = PSGAME_API;
if (typeof globalThis !== 'undefined') {
    globalThis.PSMap = globalThis.PSMap || {};
    globalThis.PSMap.psgame = PSGAME_API;
}
