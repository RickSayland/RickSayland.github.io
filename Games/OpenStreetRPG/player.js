// ============ OPENSTREETRPG — THE PLAYER ============
// Position, movement and the drawn character. Owns `player`.
//
// The position is the point under the character's FEET, in normalised
// mercator (geo.js). There is no collision yet: the map is a picture, and the
// player walks over it.

const player = {

    // Speed is set in screen pixels per second AT REF_ZOOM, not in metres.
    // Real walking pace is a few pixels a second at street zoom, which reads as
    // standing still; this keeps the screen speed the same at every latitude,
    // and zooming out still makes the same walk cover visibly less screen.
    WALK: 130,
    RUN: 2.5,               // Shift multiplier
    REF_ZOOM: 18,
    SCALE: 1.15,            // drawn size; the character is ~45 CSS px tall

    x: 0.5,
    y: 0.5,
    facing: 'down',         // 'down' | 'up' | 'left' | 'right'
    moving: false,
    running: false,
    phase: 0,               // walk cycle, radians
    stride: 0,              // 0 standing .. 1 mid-walk, eased so legs settle
    walked: 0,              // metres on the ground, for the HUD

    COLORS: {
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
        shadow: 'rgba(25, 18, 40, 0.3)'
    },

    lat() { return geo.toLat(this.y); },
    lon() { return geo.toLon(this.x); },

    place(lat, lon) {
        this.x = geo.wrapX(geo.toX(lon));
        this.y = clamp(geo.toY(lat), 0, 1);
    },

    update(dt) {
        const a = input.axis();
        this.moving = a.x !== 0 || a.y !== 0;
        this.running = this.moving && input.running();

        if (this.moving) {
            const speed = this.WALK * (this.running ? this.RUN : 1) / geo.worldPx(this.REF_ZOOM);
            const dx = a.x * speed * dt, dy = a.y * speed * dt;
            this.walked += Math.hypot(dx, dy) * geo.metresPerUnit(this.y);
            this.x = geo.wrapX(this.x + dx);
            this.y = clamp(this.y + dy, 0, 1);
            this.face(a.x, a.y);
            this.phase += dt * (this.running ? 15 : 10);
        }
        this.stride += ((this.moving ? 1 : 0) - this.stride) * Math.min(1, dt * 12);
    },

    // Four facings for eight directions of travel. On a diagonal, keep the
    // current facing if it is one of the two being pressed, so tapping a
    // second key mid-walk does not flip the sprite.
    face(ax, ay) {
        const h = ax > 0 ? 'right' : 'left', v = ay > 0 ? 'down' : 'up';
        if (ax === 0) this.facing = v;
        else if (ay === 0) this.facing = h;
        else if (this.facing !== h && this.facing !== v) this.facing = h;
    },

    // ---- Drawing ----
    // The character is a list of simple shapes. They are drawn twice: first
    // all of them stroked fat in the outline colour, then all of them filled.
    // The second pass covers every internal edge of the first, so what
    // survives is one clean outline around the whole silhouette — the
    // hand-inked look, without tracing the outline by hand.

    // (sx, sy): the feet, in CSS pixels, with the context in CSS-pixel space.
    draw(sx, sy) {
        const sw = Math.sin(this.phase) * this.stride;                  // which leg leads, -1..1
        const bob = -Math.abs(Math.cos(this.phase)) * 1.3 * this.stride;  // up as the legs pass

        ctx.save();
        ctx.translate(sx, sy);
        ctx.scale(this.SCALE, this.SCALE);

        ctx.fillStyle = this.COLORS.shadow;
        ctx.beginPath();
        ctx.ellipse(0, 0, 10, 3.6, 0, 0, TAU);
        ctx.fill();

        if (this.facing === 'left') ctx.scale(-1, 1);
        const parts = this.facing === 'down' ? this.front(sw, bob)
                    : this.facing === 'up' ? this.back(sw, bob)
                    : this.side(sw, bob);

        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = ctx.fillStyle = this.COLORS.line;
        for (const p of parts) { ctx.beginPath(); this.trace(p); ctx.fill(); ctx.stroke(); }
        for (const p of parts) { ctx.fillStyle = p[0]; ctx.beginPath(); this.trace(p); ctx.fill(); }

        ctx.restore();
    },

    // A part is [colour, kind, ...args]: 'r' rounded rect, 'o' circle,
    // 'e' ellipse, or one of the two hair shapes.
    trace(p) {
        switch (p[1]) {
            case 'r': ctx.roundRect(p[2], p[3], p[4], p[5], p[6]); break;
            case 'o': ctx.arc(p[2], p[3], p[4], 0, TAU); break;
            case 'e': ctx.ellipse(p[2], p[3], p[4], p[5], 0, 0, TAU); break;
            case 'hairFront': this.hairFront(p[2], p[3]); break;
            case 'hairSide': this.hairSide(p[2], p[3]); break;
        }
    },

    // Over the crown and down both sides, with a jagged fringe kept above the eyes.
    hairFront(hx, hy) {
        ctx.arc(hx, hy, 10.3, 0.92 * Math.PI, 2.08 * Math.PI);
        ctx.lineTo(hx + 7.5, hy - 1);
        ctx.lineTo(hx + 5, hy - 5);
        ctx.lineTo(hx + 2, hy - 2.5);
        ctx.lineTo(hx - 1, hy - 5.5);
        ctx.lineTo(hx - 3.5, hy - 2.5);
        ctx.lineTo(hx - 6.5, hy - 5);
        ctx.lineTo(hx - 7.5, hy - 1);
        ctx.closePath();
    },

    // Facing right: from the nape over the crown to the brow, then back down
    // in front of the ear.
    hairSide(hx, hy) {
        ctx.arc(hx, hy, 10.3, 0.72 * Math.PI, 1.88 * Math.PI);
        ctx.lineTo(hx + 4.5, hy - 4.5);
        ctx.lineTo(hx + 2, hy - 2);
        ctx.lineTo(hx - 0.5, hy + 2.5);
        ctx.lineTo(hx - 3.5, hy + 5);
        ctx.closePath();
    },

    // Legs lift alternately rather than swinging, since they swing towards
    // the camera; arms counter-swing.
    front(sw, b) {
        const C = this.COLORS, hy = -30 + b;
        const liftL = Math.max(0, sw) * 2.5, liftR = Math.max(0, -sw) * 2.5;
        const armL = -sw * 1.6, armR = sw * 1.6;
        return [
            [C.pants, 'r', -6, -11 - liftL, 5, 11, 2],
            [C.pants, 'r', 1, -11 - liftR, 5, 11, 2],
            [C.boot, 'r', -6.5, -4.5 - liftL, 6, 4.5, 2],
            [C.boot, 'r', 0.5, -4.5 - liftR, 6, 4.5, 2],
            [C.tunicDark, 'r', -11.5, -21 + b + armL, 4.5, 10, 2.2],
            [C.tunicDark, 'r', 7, -21 + b + armR, 4.5, 10, 2.2],
            [C.skin, 'o', -9.25, -11 + b + armL, 2.3],
            [C.skin, 'o', 9.25, -11 + b + armR, 2.3],
            [C.tunic, 'r', -8, -22 + b, 16, 13.5, 4],
            [C.packDark, 'r', -6, -20.5 + b, 2.2, 7, 1],       // pack straps
            [C.packDark, 'r', 3.8, -20.5 + b, 2.2, 7, 1],
            [C.belt, 'r', -7.6, -14 + b, 15.2, 2.6, 0],
            [C.buckle, 'r', -1.6, -14.3 + b, 3.2, 3.2, 0.6],
            [C.skin, 'o', 0, hy, 10],
            [C.hair, 'hairFront', 0, hy],
            [C.line, 'r', -5, hy + 0.5, 2.4, 3.4, 1.2],         // eyes
            [C.line, 'r', 2.6, hy + 0.5, 2.4, 3.4, 1.2],
            ['#fff', 'r', -4.6, hy + 0.9, 1, 1, 0],
            ['#fff', 'r', 3, hy + 0.9, 1, 1, 0],
            [C.blush, 'e', -6.3, hy + 5.2, 1.9, 1.1],
            [C.blush, 'e', 6.3, hy + 5.2, 1.9, 1.1]
        ];
    },

    back(sw, b) {
        const C = this.COLORS, hy = -30 + b;
        const liftL = Math.max(0, -sw) * 2.5, liftR = Math.max(0, sw) * 2.5;
        const armL = sw * 1.6, armR = -sw * 1.6;
        return [
            [C.pants, 'r', -6, -11 - liftL, 5, 11, 2],
            [C.pants, 'r', 1, -11 - liftR, 5, 11, 2],
            [C.boot, 'r', -6.5, -4.5 - liftL, 6, 4.5, 2],
            [C.boot, 'r', 0.5, -4.5 - liftR, 6, 4.5, 2],
            [C.tunicDark, 'r', -11.5, -21 + b + armL, 4.5, 10, 2.2],
            [C.tunicDark, 'r', 7, -21 + b + armR, 4.5, 10, 2.2],
            [C.skin, 'o', -9.25, -11 + b + armL, 2.3],
            [C.skin, 'o', 9.25, -11 + b + armR, 2.3],
            [C.tunic, 'r', -8, -22 + b, 16, 13.5, 4],
            [C.belt, 'r', -7.6, -14 + b, 15.2, 2.6, 0],
            [C.pack, 'r', -6.5, -19.5 + b, 13, 10.5, 3],
            [C.packDark, 'r', -6.5, -19.5 + b, 13, 4, 2.5],     // flap
            [C.buckle, 'r', -1, -16.8 + b, 2, 2, 0.4],
            [C.hair, 'o', 0, hy, 10.3],
            ['rgba(255, 255, 255, 0.12)', 'e', -3, hy - 4.5, 4, 2.4]
        ];
    },

    // Facing right; facing left is this mirrored. The far leg is drawn first
    // and darker, and the near arm swings against the near leg.
    side(sw, b) {
        const C = this.COLORS, hx = 0.5, hy = -30 + b;
        const leg = sw * 3.5, arm = -sw * 3;
        return [
            [C.pantsDark, 'r', -2.5 - leg, -11, 5, 11, 2],
            [C.bootDark, 'r', -2.5 - leg, -4.5, 6.5, 4.5, 2],
            [C.pants, 'r', -2.5 + leg, -11, 5, 11, 2],
            [C.boot, 'r', -2.5 + leg, -4.5, 6.5, 4.5, 2],
            [C.pack, 'r', -11, -21 + b, 6.5, 11.5, 2.5],
            [C.packDark, 'r', -11, -21 + b, 5, 3.5, 2],
            [C.tunic, 'r', -6, -22 + b, 12, 13.5, 4],
            [C.belt, 'r', -5.6, -14 + b, 11.2, 2.6, 0],
            [C.tunicDark, 'r', -2.25 + arm, -21 + b, 4.5, 10, 2.2],
            [C.skin, 'o', arm, -11 + b, 2.3],
            [C.skin, 'o', hx, hy, 10],
            [C.hair, 'hairSide', hx, hy],
            [C.skin, 'o', hx - 2, hy + 1.5, 2.2],                // ear
            [C.line, 'r', hx + 4.6, hy + 0.5, 2.2, 3.4, 1.1],
            ['#fff', 'r', hx + 5, hy + 0.9, 1, 1, 0],
            [C.blush, 'e', hx + 5.5, hy + 5, 1.8, 1.1]
        ];
    }
};
