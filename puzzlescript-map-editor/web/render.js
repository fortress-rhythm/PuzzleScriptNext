'use strict';

// Drawing PuzzleScript tiles onto a canvas.
//
// A tile is a stack of objects (`@ = Crate and Target`), each with its own
// colour list and optional sprite matrix, already ordered bottom-first by
// collision layer. Objects with no matrix are drawn as a solid square of their
// first colour, which is what PuzzleScript itself does.

(function (root) {

    /**
     * Draw one glyph into the cell whose top-left corner is (px, py).
     *
     * `size` is the cell size in device pixels. Sprites are drawn at whatever
     * resolution divides evenly, so a 5x5 sprite in a 20px cell gets crisp 4px
     * pixels rather than blurry ones.
     */
    function drawGlyph(ctx, glyph, px, py, size) {
        if (!glyph || !glyph.renders || !glyph.renders.length) {
            drawUnknown(ctx, px, py, size);
            return;
        }
        for (const render of glyph.renders) {
            drawObject(ctx, render, px, py, size);
        }
    }

    function drawObject(ctx, render, px, py, size) {
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
        for (let y = 0; y < h; y++) {
            const y0 = py + Math.round((y * size) / h);
            const y1 = py + Math.round(((y + 1) * size) / h);
            const rowPixels = sprite.pixels[y];
            for (let x = 0; x < w; x++) {
                const index = rowPixels[x];
                if (index === null || index === undefined) continue;
                const color = render.colors[index];
                if (!color) continue;       // transparent, or an out-of-range index
                const x0 = px + Math.round((x * size) / w);
                const x1 = px + Math.round(((x + 1) * size) / w);
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
     * Render a whole grid. `rows` is an array of strings.
     */
    function drawGrid(ctx, rows, glyphAt, size, options = {}) {
        const { offsetX = 0, offsetY = 0, alpha = 1 } = options;
        const previous = ctx.globalAlpha;
        ctx.globalAlpha = alpha;
        for (let y = 0; y < rows.length; y++) {
            const row = rows[y];
            for (let x = 0; x < row.length; x++) {
                drawGlyph(ctx, glyphAt(row[x]), offsetX + x * size, offsetY + y * size, size);
            }
        }
        ctx.globalAlpha = previous;
    }

    /**
     * A small standalone canvas showing one glyph, for the palette buttons.
     */
    function glyphThumbnail(glyph, size) {
        const canvas = document.createElement('canvas');
        const scale = window.devicePixelRatio || 1;
        canvas.width = size * scale;
        canvas.height = size * scale;
        canvas.style.width = size + 'px';
        canvas.style.height = size + 'px';
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        drawGlyph(ctx, glyph, 0, 0, size * scale);
        return canvas;
    }

    root.PSMapRender = { drawGlyph, drawGrid, drawObject, glyphThumbnail };

})(typeof globalThis !== 'undefined' ? globalThis : window);
