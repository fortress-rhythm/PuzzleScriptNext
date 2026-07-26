'use strict';

// REXPaint .xp files.
//
// REXPaint (https://www.gridsagegames.com/rexpaint/) is the reputable ASCII art
// editor in this space - free, fast, and it has had proper rectangular
// copy/cut/paste and a multi-image browser for a decade. Its one gap for our
// purposes is that it knows nothing about PuzzleScript, so this module is the
// translation layer.
//
// Format, after gunzip:
//   int32   version        (negative; pre-R9 files start with a positive layer count)
//   int32   layer count
//   per layer:
//     int32 width
//     int32 height
//     width*height cells in COLUMN-major order (x outer, y inner):
//       uint32 CP437 code point, little-endian
//       uint8  foreground R, G, B
//       uint8  background R, G, B
//
// A background of #FF00FF means "undrawn".

const zlib = require('zlib');

const XP_VERSION = -1;
const TRANSPARENT = { r: 255, g: 0, b: 255 };
const CELL_BYTES = 10;

/**
 * layers: [{ width, height, cells }] where cells is a flat row-major array of
 * { code, fg: {r,g,b}, bg: {r,g,b} }. Row-major in, column-major on disk.
 */
function writeXp(layers) {
    let size = 8;
    for (const l of layers) size += 8 + l.width * l.height * CELL_BYTES;
    const buf = Buffer.alloc(size);

    let p = 0;
    buf.writeInt32LE(XP_VERSION, p); p += 4;
    buf.writeInt32LE(layers.length, p); p += 4;

    for (const layer of layers) {
        buf.writeInt32LE(layer.width, p); p += 4;
        buf.writeInt32LE(layer.height, p); p += 4;
        for (let x = 0; x < layer.width; x++) {
            for (let y = 0; y < layer.height; y++) {
                const cell = layer.cells[y * layer.width + x] || {};
                const fg = cell.fg || { r: 255, g: 255, b: 255 };
                const bg = cell.bg || TRANSPARENT;
                buf.writeUInt32LE(cell.code || 0, p); p += 4;
                buf[p++] = fg.r; buf[p++] = fg.g; buf[p++] = fg.b;
                buf[p++] = bg.r; buf[p++] = bg.g; buf[p++] = bg.b;
            }
        }
    }
    return zlib.gzipSync(buf);
}

function readXp(gzipped) {
    let buf;
    try {
        buf = zlib.gunzipSync(gzipped);
    } catch (e) {
        // REXPaint writes gzip, but some tools emit raw zlib.
        try { buf = zlib.inflateSync(gzipped); }
        catch (e2) { throw new Error('Not a REXPaint .xp file (could not decompress)'); }
    }

    let p = 0;
    const first = buf.readInt32LE(p); p += 4;
    let layerCount;
    if (first < 0) {
        layerCount = buf.readInt32LE(p); p += 4;   // R9 and later
    } else {
        layerCount = first;                         // pre-R9, no version field
    }
    if (layerCount < 1 || layerCount > 64) {
        throw new Error(`Implausible layer count ${layerCount} - is this really an .xp file?`);
    }

    const layers = [];
    for (let l = 0; l < layerCount; l++) {
        const width = buf.readInt32LE(p); p += 4;
        const height = buf.readInt32LE(p); p += 4;
        if (width < 0 || height < 0 || p + width * height * CELL_BYTES > buf.length) {
            throw new Error(`Layer ${l} claims ${width}x${height}, which does not fit the file`);
        }
        const cells = new Array(width * height);
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                const code = buf.readUInt32LE(p); p += 4;
                const fg = { r: buf[p++], g: buf[p++], b: buf[p++] };
                const bg = { r: buf[p++], g: buf[p++], b: buf[p++] };
                cells[y * width + x] = { code, fg, bg };
            }
        }
        layers.push({ width, height, cells });
    }
    return layers;
}

function hexToRgb(hex, fallback) {
    if (!hex) return fallback;
    const n = parseInt(hex.replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

module.exports = { writeXp, readXp, hexToRgb, TRANSPARENT, XP_VERSION };
