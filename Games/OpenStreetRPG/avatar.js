// ============ OPENSTREETRPG — THE AVATAR ============
// How the player looks: the renderer, the body, and walking. Whatever the
// player rides is drawn by vehicles.js out of the same parts. Reads `player`,
// keeps no state. Owns `avatar`.
//
// The character is a list of simple parts. They are drawn twice: first all of
// them inked fat in the outline colour, then all of them painted. The paint
// pass covers every internal edge of the ink pass, so what survives is one
// clean outline around the whole silhouette — the hand-inked look, with no
// outline work per part. A part is [colour, kind, ...args]:
//
//   solid (filled; the ink fills and strokes it)
//     'r'     x, y, w, h, radius             rounded rect
//     'o'     x, y, r                        circle
//     'e'     x, y, rx, ry                   ellipse
//     'poly'  [x,y], [x,y]…                  polygon
//     'hairFront' / 'hairSide'  hx, hy, s    hair, at head scale s
//   line (stroked; the ink is the stroke plus INK)
//     'L'     width, [x,y], [x,y]…           polyline
//     'ring'  width, x, y, r                 circle outline (a tyre)
//   glass (translucent fill; the ink only outlines it, so what is behind shows)
//     'glass'  [x,y]…                        polygon
//     'glassE' x, y, rx, ry                  ellipse
//     'dome'   x, y, rx, ry                  upper half-ellipse
//   detail (never inked: an outline would swallow them, or they glow)
//     'thin'  width, [x,y]…    'thinRing'  width, x, y, r
//     'spokes'  x, y, r, angle  'dot'  x, y, r
//     'blur'  x, y, rx, ry      'flare'  [x,y]…
//
// Coordinates are in sprite units with the feet (or the wheels, or the
// skids) on y = 0, and face right in profile; facing left is the same list
// mirrored.

const avatar = {

    SCALE: 1.15,            // ~45 CSS px tall on foot
    INK: 3,                 // outline width added around every inked part
    PIVOT: -15,             // height an aircraft banks about

    KIND: {
        r: 'solid', o: 'solid', e: 'solid', poly: 'solid', hairFront: 'solid', hairSide: 'solid',
        L: 'line', ring: 'line',
        glass: 'glass', glassE: 'glass', dome: 'glass',
        thin: 'stroke', thinRing: 'stroke', spokes: 'stroke',
        dot: 'fill', blur: 'fill', flare: 'fill'
    },

    C: {
        line: '#241b30',
        skin: '#f5c9a3',
        hair: '#5b3520',
        tunic: '#3f8f5c',
        tunicDark: '#2f6c46',
        belt: '#6e4524',
        buckle: '#f0c94a',
        pants: '#3f3a58',
        pantsDark: '#2f2b44',
        boot: '#57381f',
        bootDark: '#3d2616',
        pack: '#b5773b',
        packDark: '#8a552a',
        blush: 'rgba(236, 112, 104, 0.45)',
        shine: 'rgba(255, 255, 255, 0.12)',
        shadow: 'rgba(25, 18, 40, 0.3)'
    },

    // (sx, sy): the point on the ground under the player, in CSS pixels, with
    // the context in CSS-pixel space. A flying vehicle is drawn `alt` above
    // its own shadow, bobbing, and banking into sideways motion.
    draw(sx, sy) {
        const p = player;
        const art = p.mount ? vehicles[p.mount.id] : null;
        const profile = p.facing === 'left' || p.facing === 'right';

        ctx.save();
        ctx.translate(sx, sy);
        ctx.scale(this.SCALE, this.SCALE);

        const sh = art ? (profile ? art.shadow[0] : art.shadow[1]) : [10, 3.6];
        ctx.globalAlpha = art && art.flies ? clamp(1 - p.alt / 90, 0.45, 1) : 1;
        ctx.fillStyle = this.C.shadow;
        ctx.beginPath();
        ctx.ellipse(0, 0, sh[0], sh[1], 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;

        if (art && art.flies) {
            ctx.translate(0, -p.alt + Math.sin(p.clock * art.bob[1]) * art.bob[0]);
            const bank = clamp(p.vx / (player.WALK * p.mount.move.speed), -1, 1) * art.bank[profile ? 0 : 1];
            ctx.translate(0, this.PIVOT);
            ctx.rotate(bank);
            ctx.translate(0, -this.PIVOT);
        }
        if (p.facing === 'left') ctx.scale(-1, 1);

        const parts = art ? art.parts(p) : this.walk(p);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = ctx.fillStyle = this.C.line;
        for (const q of parts) this.ink(q);
        for (const q of parts) this.paint(q);

        ctx.restore();
    },

    ink(p) {
        const k = this.KIND[p[1]];
        if (k === 'solid') {
            ctx.lineWidth = this.INK;
            ctx.beginPath();
            this.trace(p);
            ctx.fill();
            ctx.stroke();
        } else if (k === 'line' || k === 'glass') {
            ctx.lineWidth = k === 'line' ? p[2] + this.INK : this.INK;
            ctx.beginPath();
            this.trace(p);
            ctx.stroke();
        }
    },

    paint(p) {
        const k = this.KIND[p[1]];
        ctx.beginPath();
        this.trace(p);
        if (k === 'line' || k === 'stroke') {
            ctx.strokeStyle = p[0];
            ctx.lineWidth = p[1] === 'spokes' ? 0.6 : p[2];
            ctx.stroke();
        } else {
            ctx.fillStyle = p[0];
            ctx.fill();
        }
    },

    trace(p) {
        switch (p[1]) {
            case 'r': ctx.roundRect(p[2], p[3], p[4], p[5], p[6]); break;
            case 'o': case 'dot': ctx.arc(p[2], p[3], p[4], 0, TAU); break;
            case 'e': case 'glassE': case 'blur': ctx.ellipse(p[2], p[3], p[4], p[5], 0, 0, TAU); break;
            case 'dome': ctx.ellipse(p[2], p[3], p[4], p[5], 0, Math.PI, TAU); ctx.closePath(); break;
            case 'ring': case 'thinRing': ctx.arc(p[3], p[4], p[5], 0, TAU); break;
            case 'L': case 'thin': this.path(p, 3, false); break;
            case 'poly': case 'glass': case 'flare': this.path(p, 2, true); break;
            case 'spokes':
                for (let i = 0; i < 3; i++) {
                    const a = p[5] + i * Math.PI / 3;
                    const c = Math.cos(a) * p[4], s = Math.sin(a) * p[4];
                    ctx.moveTo(p[2] - c, p[3] - s);
                    ctx.lineTo(p[2] + c, p[3] + s);
                }
                break;
            case 'hairFront': this.hairFront(p[2], p[3], p[4] || 1); break;
            case 'hairSide': this.hairSide(p[2], p[3], p[4] || 1); break;
        }
    },

    path(p, from, close) {
        ctx.moveTo(p[from][0], p[from][1]);
        for (let i = from + 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
        if (close) ctx.closePath();
    },

    // Over the crown and down both sides, with a jagged fringe kept above the eyes.
    hairFront(hx, hy, s) {
        ctx.arc(hx, hy, 10.3 * s, 0.92 * Math.PI, 2.08 * Math.PI);
        const pts = [[7.5, -1], [5, -5], [2, -2.5], [-1, -5.5], [-3.5, -2.5], [-6.5, -5], [-7.5, -1]];
        for (const [x, y] of pts) ctx.lineTo(hx + x * s, hy + y * s);
        ctx.closePath();
    },

    // In profile: from the nape over the crown to the brow, then back down in
    // front of the ear.
    hairSide(hx, hy, s) {
        ctx.arc(hx, hy, 10.3 * s, 0.72 * Math.PI, 1.88 * Math.PI);
        const pts = [[4.5, -4.5], [2, -2], [-0.5, 2.5], [-3.5, 5]];
        for (const [x, y] of pts) ctx.lineTo(hx + x * s, hy + y * s);
        ctx.closePath();
    },

    // ---- The body, shared by every pose ----
    // `ox` shifts it sideways and `b` lifts it (a walking bob, or a seat).

    torso(facing, ox, b) {
        const C = this.C;
        if (facing === 'down') return [
            [C.tunic, 'r', ox - 8, -22 + b, 16, 13.5, 4],
            [C.packDark, 'r', ox - 6, -20.5 + b, 2.2, 7, 1],          // pack straps
            [C.packDark, 'r', ox + 3.8, -20.5 + b, 2.2, 7, 1],
            [C.belt, 'r', ox - 7.6, -14 + b, 15.2, 2.6, 0],
            [C.buckle, 'r', ox - 1.6, -14.3 + b, 3.2, 3.2, 0.6]
        ];
        if (facing === 'up') return [
            [C.tunic, 'r', ox - 8, -22 + b, 16, 13.5, 4],
            [C.belt, 'r', ox - 7.6, -14 + b, 15.2, 2.6, 0],
            [C.pack, 'r', ox - 6.5, -19.5 + b, 13, 10.5, 3],
            [C.packDark, 'r', ox - 6.5, -19.5 + b, 13, 4, 2.5],      // flap
            [C.buckle, 'r', ox - 1, -16.8 + b, 2, 2, 0.4]
        ];
        return [
            [C.pack, 'r', ox - 11, -21 + b, 6.5, 11.5, 2.5],
            [C.packDark, 'r', ox - 11, -21 + b, 5, 3.5, 2],
            [C.tunic, 'r', ox - 6, -22 + b, 12, 13.5, 4],
            [C.belt, 'r', ox - 5.6, -14 + b, 11.2, 2.6, 0]
        ];
    },

    // `s` scales the whole head about its centre, for a pilot in a cockpit.
    head(facing, hx, hy, s = 1) {
        const C = this.C;
        if (facing === 'left' || facing === 'right') facing = 'side';
        if (facing === 'down') return [
            [C.skin, 'o', hx, hy, 10 * s],
            [C.hair, 'hairFront', hx, hy, s],
            [C.line, 'r', hx - 5 * s, hy + 0.5 * s, 2.4 * s, 3.4 * s, 1.2 * s],    // eyes
            [C.line, 'r', hx + 2.6 * s, hy + 0.5 * s, 2.4 * s, 3.4 * s, 1.2 * s],
            ['#fff', 'r', hx - 4.6 * s, hy + 0.9 * s, s, s, 0],
            ['#fff', 'r', hx + 3 * s, hy + 0.9 * s, s, s, 0],
            [C.blush, 'e', hx - 6.3 * s, hy + 5.2 * s, 1.9 * s, 1.1 * s],
            [C.blush, 'e', hx + 6.3 * s, hy + 5.2 * s, 1.9 * s, 1.1 * s]
        ];
        if (facing === 'up') return [
            [C.hair, 'o', hx, hy, 10.3 * s],
            [C.shine, 'e', hx - 3 * s, hy - 4.5 * s, 4 * s, 2.4 * s]
        ];
        return [
            [C.skin, 'o', hx, hy, 10 * s],
            [C.hair, 'hairSide', hx, hy, s],
            [C.skin, 'o', hx - 2 * s, hy + 1.5 * s, 2.2 * s],                       // ear
            [C.line, 'r', hx + 4.6 * s, hy + 0.5 * s, 2.2 * s, 3.4 * s, 1.1 * s],
            ['#fff', 'r', hx + 5 * s, hy + 0.9 * s, s, s, 0],
            [C.blush, 'e', hx + 5.5 * s, hy + 5 * s, 1.8 * s, 1.1 * s]
        ];
    },

    // ---- On foot ----
    // Towards or away from the camera the legs lift alternately rather than
    // swinging, and the arms counter-swing. In profile the far leg is drawn
    // first and darker, and the near arm swings against the near leg.

    walk(p) {
        const C = this.C;
        const sw = Math.sin(p.phase) * p.stride;                      // which leg leads, -1..1
        const b = -Math.abs(Math.cos(p.phase)) * 1.3 * p.stride;      // up as the legs pass

        if (p.facing === 'down' || p.facing === 'up') {
            const front = p.facing === 'down';
            const liftL = Math.max(0, front ? sw : -sw) * 2.5;
            const liftR = Math.max(0, front ? -sw : sw) * 2.5;
            const armL = (front ? -sw : sw) * 1.6, armR = -armL;
            return [
                [C.pants, 'r', -6, -11 - liftL, 5, 11, 2],
                [C.pants, 'r', 1, -11 - liftR, 5, 11, 2],
                [C.boot, 'r', -6.5, -4.5 - liftL, 6, 4.5, 2],
                [C.boot, 'r', 0.5, -4.5 - liftR, 6, 4.5, 2],
                [C.tunicDark, 'r', -11.5, -21 + b + armL, 4.5, 10, 2.2],
                [C.tunicDark, 'r', 7, -21 + b + armR, 4.5, 10, 2.2],
                [C.skin, 'o', -9.25, -11 + b + armL, 2.3],
                [C.skin, 'o', 9.25, -11 + b + armR, 2.3],
                ...this.torso(p.facing, 0, b),
                ...this.head(p.facing, 0, -30 + b)
            ];
        }

        const leg = sw * 3.5, arm = -sw * 3;
        return [
            [C.pantsDark, 'r', -2.5 - leg, -11, 5, 11, 2],
            [C.bootDark, 'r', -2.5 - leg, -4.5, 6.5, 4.5, 2],
            [C.pants, 'r', -2.5 + leg, -11, 5, 11, 2],
            [C.boot, 'r', -2.5 + leg, -4.5, 6.5, 4.5, 2],
            ...this.torso('side', 0, b),
            [C.tunicDark, 'r', -2.25 + arm, -21 + b, 4.5, 10, 2.2],
            [C.skin, 'o', arm, -11 + b, 2.3],
            ...this.head('side', 0.5, -30 + b)
        ];
    }
};
