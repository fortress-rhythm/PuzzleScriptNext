#!/usr/bin/env node
'use strict';

// Rebuild src/js/ai_context_pack.js - the copy of doc/ai-context-pack.md that
// the editor's COPY FOR AI button puts on the clipboard.
//
// The pack is embedded as a script rather than fetched, because the editor is
// meant to work straight off disk and a file:// page cannot fetch. The Markdown
// file stays the one to edit; this writes the script from it, minus the
// maintainer's note at the top, which is for people and not for the AI.
//
//   node tools/build_ai_pack.js            rebuild it
//   node tools/build_ai_pack.js --check    say whether it is current, write nothing

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'doc', 'ai-context-pack.md');
const OUT = path.join(ROOT, 'src', 'js', 'ai_context_pack.js');

/** The script, as it should be on disk. */
function build() {
    const markdown = fs.readFileSync(SOURCE, 'utf8')
        .replace(/\r\n/g, '\n')
        .replace(/<!--[\s\S]*?-->\n*/, '')
        .trim() + '\n';
    return '// GENERATED from doc/ai-context-pack.md by tools/build_ai_pack.js - edit that, then\n'
        + '// run `npm run build:ai-pack`. Used by the editor\'s COPY FOR AI button.\n'
        + 'var AI_CONTEXT_PACK = ' + JSON.stringify(markdown) + ';\n';
}

function main(argv) {
    const script = build();
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;

    if (argv.includes('--check')) {
        if (current !== script) {
            process.stderr.write(`${path.relative(ROOT, OUT)} does not match ${path.relative(ROOT, SOURCE)}.\n`
                + `Rebuild it: npm run build:ai-pack\n`);
            return 1;
        }
        process.stdout.write(`AI context pack is current.\n`);
        return 0;
    }

    fs.writeFileSync(OUT, script, 'utf8');
    const size = (Buffer.byteLength(script) / 1024).toFixed(0);
    process.stdout.write(`Wrote ${path.relative(ROOT, OUT)} - ${size} KB\n`);
    return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { build };
