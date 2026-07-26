#!/usr/bin/env node
'use strict';

// A tiny static file server, so `npm start` opens the web editor without
// pulling in a dependency. It serves the project root, because the editor loads
// its parser from ../src and the example game from ../fixtures.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
};

const server = http.createServer((req, res) => {
    let urlPath;
    try {
        urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
        res.writeHead(400).end('Bad request');
        return;
    }
    if (urlPath === '/') urlPath = '/web/index.html';

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
    process.stdout.write(`Map editor running at http://localhost:${PORT}/\n`);
    process.stdout.write('Press Ctrl+C to stop.\n');
});
