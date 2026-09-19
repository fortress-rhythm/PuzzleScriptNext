'use strict';

// Drawing PuzzleScript tiles onto a canvas.
//
// A tile is a stack of objects (`@ = Crate and Target`), each with its own
// colour list and optional sprite matrix, already ordered bottom-first by
// collision layer. Objects with no matrix are drawn as a solid square of their
// first colour, which is what PuzzleScript itself does.
//
// Two things the game does that a naive renderer forgets:
//
//   - Background is under every cell. A roach with transparent pixels shows
//     the floor through them, not the void, so the background glyph is drawn
//     first wherever another glyph is placed (`underlay`).
//   - Some objects are invisible on purpose - `Night; transparent` is a switch,
//     not scenery. In the game that is fine; in an editor a tile that looks
//     exactly like the floor is a tile you cannot find again, so such glyphs
//     get a faint marker with their character in it.

(function (root) {

    /**
     * Draw one glyph into the cell whose top-left corner is (px, py).
     *
     * `size` is the cell size in device pixels. Sprites are drawn at whatever
     * resolution divides evenly, so a 5x5 sprite in a 20px cell gets crisp 4px
     * pixels rather than blurry ones.
     *
     * `options.underlay` is the glyph to draw first (normally the background);
     * `options.checker` draws transparent pixels as a checkerboard, for editing
     * a sprite on its own.
     */
    function drawGlyph(ctx, glyph, px, py, size, options) {
        options = options || {};
        if (!glyph || !glyph.renders) {
            if (options.underlay) drawRenders(ctx, options.underlay.renders, px, py, size, options);
            drawUnknown(ctx, px, py, size);
            return;
        }
        if (options.underlay && options.underlay !== glyph) {
            drawRenders(ctx, options.underlay.renders, px, py, size, options);
        }
        if (glyph.transparent) {
            if (options.checker) drawChecker(ctx, px, py, size);
            return;
        }
        drawRenders(ctx, glyph.renders, px, py, size, options);
        if (!paintsSomething(glyph)) drawMarker(ctx, glyph, px, py, size);
    }

    function drawRenders(ctx, renders, px, py, size, options) {
        for (const render of renders || []) drawObject(ctx, render, px, py, size, options);
    }

    /** Would drawing this glyph put any pixel on the canvas? */
    function paintsSomething(glyph) {
        for (const render of glyph.renders || []) {
            if (!render.sprite) {
                if (render.colors.find(Boolean)) return true;
                continue;
            }
            for (const row of render.sprite.pixels) {
                for (const index of row) {
                    if (index !== null && index !== undefined && render.colors[index]) return true;
                }
            }
        }
        return false;
    }

    function drawObject(ctx, render, px, py, size, options) {
        const sprite = render.sprite;
        if (!sprite) {
            const solid = render.colors.find(Boolean);
            if (!solid) return;             // an all-transparent object draws nothing
            ctx.fillStyle = solid;
            ctx.fillRect(px, py, size, size);
            return;
        }

        // Integer pixel size keeps sprites crisp; the remainder is spread so the
        // sprite still fills the cell exactly.
        const w = sprite.width;
        const h = sprite.height;
        const checker = options && options.checker;
        for (let y = 0; y < h; y++) {
            const y0 = py + Math.round((y * size) / h);
            const y1 = py + Math.round(((y + 1) * size) / h);
            const rowPixels = sprite.pixels[y];
            for (let x = 0; x < w; x++) {
                const index = rowPixels[x];
                const color = (index === null || index === undefined) ? null : render.colors[index];
                const x0 = px + Math.round((x * size) / w);
                const x1 = px + Math.round(((x + 1) * size) / w);
                if (!color) {              // transparent, or an out-of-range index
                    if (checker) drawChecker(ctx, x0, y0, x1 - x0, y1 - y0, (x + y) % 2);
                    continue;
                }
                ctx.fillStyle = color;
                ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
            }
        }
    }

    /**
     * A character with no legend entry. Worth making loud rather than invisible:
     * it means the level will not compile.
     */
    function drawUnknown(ctx, px, py, size) {
        ctx.fillStyle = '#2a1020';
        ctx.fillRect(px, py, size, size);
        ctx.strokeStyle = '#ff3b6b';
        ctx.lineWidth = Math.max(1, size / 12);
        ctx.beginPath();
        ctx.moveTo(px + size * 0.25, py + size * 0.25);
        ctx.lineTo(px + size * 0.75, py + size * 0.75);
        ctx.moveTo(px + size * 0.75, py + size * 0.25);
        ctx.lineTo(px + size * 0.25, py + size * 0.75);
        ctx.stroke();
    }

    /**
     * A legal glyph that draws nothing - a transparent marker object. Shown as
     * a dotted box with its character, faint enough not to shout, present
     * enough that you can see where the markers are and pick them up again.
     */
    function drawMarker(ctx, glyph, px, py, size) {
        if (size < 10) return;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(px + 2.5, py + 2.5, size - 5, size - 5);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = `${Math.max(8, Math.floor(size * 0.55))}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(glyph.char || '?', px + size / 2, py + size / 2 + 1);
        ctx.restore();
    }

    /** The transparent-pixel checkerboard, for editing a sprite by itself. */
    function drawChecker(ctx, px, py, w, h, phase) {
        if (h === undefined) { h = w; }
        ctx.fillStyle = phase ? '#2b2e3b' : '#1d1f29';
        ctx.fillRect(px, py, w, h);
    }

    /**
     * Render a whole grid. `rows` is an array of strings.
     */
    function drawGrid(ctx, rows, glyphAt, size, options = {}) {
        const { offsetX = 0, offsetY = 0, alpha = 1 } = options;
        const previous = ctx.globalAlpha;
        ctx.globalAlpha = alpha;
        for (let y = 0; y < rows.length; y++) {
            const row = rows[y];
            for (let x = 0; x < row.length; x++) {
                drawGlyph(ctx, glyphAt(row[x]), offsetX + x * size, offsetY + y * size, size, options);
            }
        }
        ctx.globalAlpha = previous;
    }

    /**
     * A small standalone canvas showing one glyph, for the palette buttons.
     */
    function glyphThumbnail(glyph, size, options) {
        const canvas = document.createElement('canvas');
        const scale = window.devicePixelRatio || 1;
        canvas.width = size * scale;
        canvas.height = size * scale;
        canvas.style.width = size + 'px';
        canvas.style.height = size + 'px';
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        drawGlyph(ctx, glyph, 0, 0, size * scale, options);
        return canvas;
    }

    root.PSMapRender = { drawGlyph, drawGrid, drawObject, drawChecker, glyphThumbnail, paintsSomething };

})(typeof globalThis !== 'undefined' ? globalThis : window);
