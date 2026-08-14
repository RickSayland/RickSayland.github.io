// ============ SPRITE SHEET HELPER ============
// Dependency-free leaf module (like core.js) shared by any system that renders
// from a directional sprite atlas — currently the player, and enemies next.
//
// It expects a *pre-processed* atlas: a uniform grid of frames on a transparent
// background where every frame is horizontally centered and bottom-aligned so
// the character's feet sit on a common baseline `pad` pixels above the frame
// bottom. The labeled source sheets (content/*.png) are baked into that form by
// tools/bakeAtlas.py.
//
// Column/row *meaning* is left to the caller. The convention the baker uses:
//   columns (0-7): Down, Down-Left, Left, Up-Left, Up, Up-Right, Right, Down-Right
//   rows    (0-7): Idle, Walk 1, Walk 2, Walk 3, Walk 4, Attack, Hurt, Death

export class SpriteSheet {
    // opts: { src, frameW, frameH, pad?, colForOctant?, walkFrameMs? }
    constructor(opts) {
        this.frameW = opts.frameW;
        this.frameH = opts.frameH;
        this.pad = opts.pad || 0;
        // Maps a facing octant (0 = Right, counting clockwise where +y is down)
        // to a sheet column. Defaults to the baker's Down-first column order.
        this.colForOctant = opts.colForOctant || [6, 7, 0, 1, 2, 3, 4, 5];
        this.walkFrameMs = opts.walkFrameMs || 130;

        this.loaded = false;
        this.img = new Image();
        this.img.onload = () => { this.loaded = true; };
        this.img.src = opts.src;
    }

    // 8-way facing vector (screen space, +y down) -> sheet column
    facingColumn(fx, fy) {
        const angle = Math.atan2(fy, fx);
        let oct = Math.round(angle / (Math.PI / 4)); // -4..4
        oct = ((oct % 8) + 8) % 8;
        return this.colForOctant[oct];
    }

    // Walk-cycle row from a millisecond accumulator, e.g. rows 1..4
    walkRow(animTime, rowStart = 1, frames = 4) {
        return rowStart + (Math.floor(animTime / this.walkFrameMs) % frames);
    }

    // Draw frame (col,row) horizontally centered on x, with the feet baseline
    // anchored to feetY. Returns false (drawing nothing) until the image loads
    // so callers can render a placeholder.
    draw(ctx, col, row, x, feetY, scale, alpha = 1) {
        if (!this.loaded) return false;
        const dw = this.frameW * scale;
        const dh = this.frameH * scale;
        const footOffset = (this.frameH - this.pad) * scale;
        const dx = x - dw / 2;
        const dy = feetY - footOffset;

        if (alpha !== 1) ctx.globalAlpha = alpha;
        ctx.drawImage(
            this.img,
            col * this.frameW, row * this.frameH, this.frameW, this.frameH,
            dx, dy, dw, dh
        );
        if (alpha !== 1) ctx.globalAlpha = 1;
        return true;
    }
}

// A uniform grid of square tiles (baked by tools/bakeGround.py). Rows are
// terrain types, columns are variants. Cells are drawn straight into a
// destination square — fill terrains are opaque, object rows (trees) carry
// transparency so they compose over whatever was drawn first.
export class TileSheet {
    // opts: { src, tileSize }  (tileSize = px per cell in the atlas)
    constructor(opts) {
        this.tileSize = opts.tileSize;
        this.loaded = false;
        this.img = new Image();
        this.img.onload = () => { this.loaded = true; };
        this.img.src = opts.src;
    }

    // Draw atlas cell (col,row) into the size x size box at (dx,dy).
    // Returns false until the image loads so callers can fall back.
    drawTile(ctx, col, row, dx, dy, size) {
        if (!this.loaded) return false;
        const ts = this.tileSize;
        ctx.drawImage(this.img, col * ts, row * ts, ts, ts, dx, dy, size, size);
        return true;
    }
}
