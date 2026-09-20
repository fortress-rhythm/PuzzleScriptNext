#!/usr/bin/env node
'use strict';

// Rebuild src/standalone_inlined.txt - the template EXPORT substitutes a game
// into - from src/standalone.html and the files it references.
//
// `node compile.js` does this too, as one step of the whole minified bin/ build,
// but that build pulls in image-compression packages that want native binaries
// and fail on some machines. The template is the part you actually need in order
// to export, so it gets a path of its own: no dependencies, nothing to install.
//
// The inlining is verbatim, which is what web-resource-inliner does here, so the
// output is byte-comparable with what compile.js writes and check_export.js can
// tell a stale template from a current one.
//
//   node tools/inline_standalone.js            rebuild it
//   node tools/inline_standalone.js --check    say whether it is current, write nothing

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const TEMPLATE = path.join(SRC, 'standalone.html');
const OUT = path.join(SRC, 'standalone_inlined.txt');

const SCRIPT = /<script src="([^"]+)"><\/script>/g;
const LF = text => text.replace(/\r\n/g, '\n');   // the sources are CRLF, the template is not
const STYLE = /<link rel="stylesheet" href="([^"]+)">/g;

/** The template with every local script and stylesheet inlined. */
function build() {
    let html = fs.readFileSync(TEMPLATE, 'utf8');
    const used = [];
    const inline = (re, open, close) => {
        html = html.replace(re, (whole, ref) => {
            if (/^(https?:|data:|\/\/)/.test(ref)) return whole;
            const file = path.join(SRC, ref);
            if (!fs.existsSync(file)) throw new Error(`${TEMPLATE} references ${ref}, which is missing`);
            used.push(ref);
            return open + LF(fs.readFileSync(file, 'utf8')) + close;
        });
    };
    inline(STYLE, '<style>\n', '\n</style>');
    inline(SCRIPT, '<script>\n', '\n</script>');
    return { html, used };
}

function main(argv) {
    const { html, used } = build();
    const check = argv.includes('--check');
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;

    if (check) {
        if (current === null) {
            process.stderr.write(`Missing ${path.relative(ROOT, OUT)} - run: node tools/inline_standalone.js\n`);
            return 1;
        }
        // Whitespace between the tags and the file content is the inliner's own;
        // compare what matters, which is that every file is in there as it is now.
        const inThere = LF(current);
        const stale = used.filter(ref => !inThere.includes(LF(fs.readFileSync(path.join(SRC, ref), 'utf8')).trim()));
        if (stale.length) {
            process.stderr.write(`Stale export template. These are in src/ but not in the template:\n`);
            for (const ref of stale) process.stderr.write(`  ${ref}\n`);
            process.stderr.write(`Rebuild it: node tools/inline_standalone.js\n`);
            return 1;
        }
        process.stdout.write(`Export template is current (${used.length} files inlined).\n`);
        return 0;
    }

    fs.writeFileSync(OUT, html, 'utf8');
    const size = (Buffer.byteLength(html) / 1024).toFixed(0);
    process.stdout.write(`Wrote ${path.relative(ROOT, OUT)} - ${used.length} files inlined, ${size} KB\n`);
    return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { build };
