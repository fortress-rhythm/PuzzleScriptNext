#!/usr/bin/env node
'use strict';

// A tiny static file server, so `npm start` opens the web editor without
// pulling in a dependency. It serves the project root, because the editor loads
// its parser from ../src and the example game from ../fixtures.
//
// `--root <dir>` serves a different folder instead - PuzzleScriptNext's
// runserver scripts use it to serve the whole engine checkout, map editor
// included, from one port. The front page is that folder's index.html, or
// web/index.html when there is none (the map editor on its own).

const http = require('http');
const fs = require('fs');
const path = require('path');

function argValue(flag) {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : null;
}

const ROOT = path.resolve(argValue('--root') || process.env.PSMAP_ROOT || path.join(__dirname, '..'));
const PORT = Number(argValue('--port') || process.env.PORT) || 8080;
const FRONT = fs.existsSync(path.join(ROOT, 'index.html')) ? '/index.html' : '/web/index.html';

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const server = http.createServer((req, res) => {
    let urlPath;
    try {
        urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
        res.writeHead(400).end('Bad request');
        return;
    }
    if (urlPath === '/') urlPath = FRONT;
    if (urlPath.endsWith('/')) urlPath += 'index.html';

    // Resolve inside ROOT and refuse anything that escapes it.
    const target = path.resolve(ROOT, '.' + urlPath);
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
    }

    fs.readFile(target, (err, data) => {
        if (err) { res.writeHead(404).end('Not found'); return; }
        res.writeHead(200, {
            'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        res.end(data);
    });
});

server.listen(PORT, () => {
    process.stdout.write(`Serving ${ROOT}\n  at http://localhost:${PORT}/\n`);
    process.stdout.write('Press Ctrl+C to stop.\n');
});
