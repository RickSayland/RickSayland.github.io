// ============ OPENSTREETRPG — THE AVATAR ============
// How the player looks: on foot, or riding whatever is in the mount slot.
// Reads `player`, draws, keeps no state. Owns `avatar`.
//
// The character is a list of simple parts. They are drawn twice: first all of
// them inked fat in the outline colour, then all of them painted. The paint
// pass covers every internal edge of the ink pass, so what survives is one
// clean outline around the whole silhouette — the hand-inked look, with no
// outline work per part. A part is [colour, kind, ...args]:
//
//   'r'  x, y, w, h, radius     rounded rect      ┐
//   'o'  x, y, r                circle            │ inked
//   'e'  x, y, rx, ry           ellipse           │
//   'hairFront' / 'hairSide'  hx, hy              │
//   'L'  width, [x,y], [x,y]…   stroked polyline  │
//   'ring'  width, x, y, r      stroked circle    ┘
//   'thin'  width, [x,y]…       polyline          ┐ not inked: fine detail
//   'thinRing'  width, x, y, r                    │ that an outline would
//   'spokes'  x, y, r, angle                      │ swallow
//   'dot'  x, y, r                                ┘
//
// Coordinates are in sprite units with the feet (or the tyres) on y = 0, and
// face right in profile; facing left is the same list mirrored.

const avatar = {

    SCALE: 1.15,            // ~45 CSS px tall on foot
    INK: 3,                 // outline width added around every inked part
    LIFT: -10.5,            // how much higher the body sits on a saddle than on its feet

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
        shadow: 'rgba(25, 18, 40, 0.3)',
        // the bicycle
        frame: '#d2463c',
        metal: '#a9afbd',
        metalDark: '#717685',
        tire: '#3b3644',
        rim: '#d5d8e0',
        spoke: 'rgba(213, 216, 224, 0.8)',
        saddle: '#3a2a22',
        lamp: '#fff4c2',
        reflector: '#e0392b'
    },

    // (sx, sy): the feet, in CSS pixels, with the context in CSS-pixel space.
    draw(sx, sy) {
        const p = player, C = this.C;
        const profile = p.facing === 'left' || p.facing === 'right';

        ctx.save();
        ctx.translate(sx, sy);
        ctx.scale(this.SCALE, this.SCALE);

        ctx.fillStyle = C.shadow;
        ctx.beginPath();
        if (!p.mount) ctx.ellipse(0, 0, 10, 3.6, 0, 0, TAU);
        else if (profile) ctx.ellipse(0, 0, 18, 3.6, 0, 0, TAU);
        else ctx.ellipse(0, 0, 7.5, 3.4, 0, 0, TAU);
        ctx.fill();

        if (p.facing === 'left') ctx.scale(-1, 1);
        const parts = p.mount ? this.ride(p) : this.walk(p);

        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = ctx.fillStyle = C.line;
        for (const q of parts) this.ink(q);
        for (const q of parts) this.paint(q);

        ctx.restore();
    },

    ink(p) {
        const k = p[1];
        if (k === 'L' || k === 'ring') {
            ctx.lineWidth = p[2] + this.INK;
            ctx.beginPath();
            this.trace(p);
            ctx.stroke();
        } else if (k !== 'thin' && k !== 'thinRing' && k !== 'spokes' && k !== 'dot') {
            ctx.lineWidth = this.INK;
            ctx.beginPath();
            this.trace(p);
            ctx.fill();
            ctx.stroke();
        }
    },

    paint(p) {
        const k = p[1];
        ctx.beginPath();
        this.trace(p);
        if (k === 'L' || k === 'ring' || k === 'thin' || k === 'thinRing' || k === 'spokes') {
            ctx.strokeStyle = p[0];
            ctx.lineWidth = k === 'spokes' ? 0.6 : p[2];
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
            case 'e': ctx.ellipse(p[2], p[3], p[4], p[5], 0, 0, TAU); break;
            case 'ring': case 'thinRing': ctx.arc(p[3], p[4], p[5], 0, TAU); break;
            case 'L': case 'thin':
                ctx.moveTo(p[3][0], p[3][1]);
                for (let i = 4; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
                break;
            case 'spokes':
                for (let i = 0; i < 3; i++) {
                    const a = p[5] + i * Math.PI / 3;
                    const c = Math.cos(a) * p[4], s = Math.sin(a) * p[4];
                    ctx.moveTo(p[2] - c, p[3] - s);
                    ctx.lineTo(p[2] + c, p[3] + s);
                }
                break;
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

    // In profile: from the nape over the crown to the brow, then back down in
    // front of the ear.
    hairSide(hx, hy) {
        ctx.arc(hx, hy, 10.3, 0.72 * Math.PI, 1.88 * Math.PI);
        ctx.lineTo(hx + 4.5, hy - 4.5);
        ctx.lineTo(hx + 2, hy - 2);
        ctx.lineTo(hx - 0.5, hy + 2.5);
        ctx.lineTo(hx - 3.5, hy + 5);
        ctx.closePath();
    },

    // ---- The body, shared by every pose ----
    // `ox` shifts it sideways and `b` lifts it (a walking bob, or the saddle).

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

    head(facing, hx, hy) {
        const C = this.C;
        if (facing === 'down') return [
            [C.skin, 'o', hx, hy, 10],
            [C.hair, 'hairFront', hx, hy],
            [C.line, 'r', hx - 5, hy + 0.5, 2.4, 3.4, 1.2],          // eyes
            [C.line, 'r', hx + 2.6, hy + 0.5, 2.4, 3.4, 1.2],
            ['#fff', 'r', hx - 4.6, hy + 0.9, 1, 1, 0],
            ['#fff', 'r', hx + 3, hy + 0.9, 1, 1, 0],
            [C.blush, 'e', hx - 6.3, hy + 5.2, 1.9, 1.1],
            [C.blush, 'e', hx + 6.3, hy + 5.2, 1.9, 1.1]
        ];
        if (facing === 'up') return [
            [C.hair, 'o', hx, hy, 10.3],
            [C.shine, 'e', hx - 3, hy - 4.5, 4, 2.4]
        ];
        return [
            [C.skin, 'o', hx, hy, 10],
            [C.hair, 'hairSide', hx, hy],
            [C.skin, 'o', hx - 2, hy + 1.5, 2.2],                       // ear
            [C.line, 'r', hx + 4.6, hy + 0.5, 2.2, 3.4, 1.1],
            ['#fff', 'r', hx + 5, hy + 0.9, 1, 1, 0],
            [C.blush, 'e', hx + 5.5, hy + 5, 1.8, 1.1]
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
    },

    // ---- On the bicycle ----

    ride(p) {
        if (p.facing === 'down') return this.rideFront(p);
        if (p.facing === 'up') return this.rideBack(p);
        return this.rideSide(p);
    },

    wheelParts(cx, cy, angle) {
        const C = this.C;
        return [
            [C.tire, 'ring', 2.2, cx, cy, 6.4],
            [C.rim, 'thinRing', 0.7, cx, cy, 4.6],
            [C.spoke, 'spokes', cx, cy, 4.6, angle],
            [C.metal, 'dot', cx, cy, 1.1]
        ];
    },

    // Two-bone leg: where the knee goes for a hip, a foot and two bone
    // lengths, bending forward (+x), which is the way a rider's knee points.
    knee(h, f, l1, l2) {
        const dx = f[0] - h[0], dy = f[1] - h[1];
        const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 0.01);
        const a = Math.atan2(dy, dx);
        const off = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
        const k1 = [h[0] + l1 * Math.cos(a - off), h[1] + l1 * Math.sin(a - off)];
        const k2 = [h[0] + l1 * Math.cos(a + off), h[1] + l1 * Math.sin(a + off)];
        return k1[0] > k2[0] ? k1 : k2;
    },

    // In profile: the frame drawn as stroked tubes, a rider sitting upright
    // on the saddle, and both legs solved onto the pedals every frame, so they
    // genuinely turn the cranks.
    rideSide(p) {
        const C = this.C, b = this.LIFT, ox = -3.5;
        const R = [-11.5, -7.5], F = [11.5, -7.5];          // axles
        const BB = [-1, -6.5];                              // bottom bracket
        const ST = [-5, -18], HT = [8, -17.5], HB = [9.2, -13];
        const grip = [5.2, -21.4], hip = [-5, -21];
        const cr = 3.6, cc = Math.cos(p.crank) * cr, cs = Math.sin(p.crank) * cr;
        const near = [BB[0] + cc, BB[1] + cs], far = [BB[0] - cc, BB[1] - cs];
        const kNear = this.knee(hip, near, 9.5, 9.5), kFar = this.knee(hip, far, 9.5, 9.5);

        return [
            ...this.wheelParts(R[0], R[1], p.wheel),
            ...this.wheelParts(F[0], F[1], p.wheel + 0.5),
            [C.pantsDark, 'L', 4.4, hip, kFar, far],
            [C.bootDark, 'r', far[0] - 2, far[1] - 1.8, 5.5, 3.6, 1.5],
            [C.metalDark, 'L', 1.4, BB, far],
            [C.frame, 'L', 1.8, R, BB, HB],                   // chainstay, down tube
            [C.frame, 'L', 1.8, R, [-4.6, -16.5]],            // seat stay
            [C.frame, 'L', 1.8, BB, ST],                      // seat tube
            [C.frame, 'L', 2.2, [-4.7, -16.9], HT, HB],       // top tube, head tube
            [C.metal, 'L', 1.6, HB, F],                       // fork
            [C.metal, 'L', 1.5, ST, [-5, -19.5]],             // seat post
            [C.metal, 'L', 1.6, HT, [7.8, -20.6], grip],      // stem and bars
            [C.lamp, 'o', 9.6, -16.2, 1.3],
            [C.saddle, 'r', -8.5, -21, 7, 2.6, 1.3],
            [C.metal, 'o', BB[0], BB[1], 2.4],                // chainring
            ...this.torso('side', ox, b),
            [C.metal, 'L', 1.4, BB, near],
            [C.pants, 'L', 4.4, hip, kNear, near],
            [C.boot, 'r', near[0] - 2, near[1] - 1.8, 5.5, 3.6, 1.5],
            [C.tunicDark, 'L', 4.2, [ox, -30.5], grip],
            [C.skin, 'o', grip[0], grip[1], 2.3],
            ...this.head('side', ox + 0.5, -30 + b)
        ];
    },

    // Towards the camera: the front wheel is a tyre seen edge-on, the bars
    // cross in front of the body, and the knees rise and fall with the pedals.
    pedalLegs(p) {
        const C = this.C, fy = Math.sin(p.crank) * 3.6;
        const leg = (s, y) => [
            [C.pants, 'L', 4.4, [s * 3.5, -21], [s * 6.2, y - 8], [s * 5.2, y]],
            [C.boot, 'r', s * 5.2 - 2.5, y - 2.4, 5, 4, 1.5]
        ];
        return [...leg(-1, -6.5 + fy), ...leg(1, -6.5 - fy)];
    },

    rideFront(p) {
        const C = this.C, b = this.LIFT;
        return [
            ...this.pedalLegs(p),
            ...this.torso('down', 0, b),
            [C.tire, 'r', -1.6, -15, 3.2, 15, 1.6],
            [C.metal, 'L', 1.4, [-2.3, -7.5], [-2.3, -16]],   // fork
            [C.metal, 'L', 1.4, [2.3, -7.5], [2.3, -16]],
            [C.metal, 'L', 1.6, [0, -16], [0, -20.5]],        // stem
            [C.lamp, 'o', 0, -17.6, 1.5],
            [C.metal, 'L', 1.7, [-10.5, -21.8], [-4, -20.5], [4, -20.5], [10.5, -21.8]],
            [C.tunicDark, 'L', 4.2, [-7.6, -30], [-10.2, -22.4]],
            [C.tunicDark, 'L', 4.2, [7.6, -30], [10.2, -22.4]],
            [C.skin, 'o', -10.5, -21.8, 2.3],
            [C.skin, 'o', 10.5, -21.8, 2.3],
            ...this.head('down', 0, -30 + b)
        ];
    },

    // Away from the camera: the bars are beyond the rider so they go first,
    // and the rear wheel, mudguard and reflector are nearest, so they go last.
    rideBack(p) {
        const C = this.C, b = this.LIFT;
        return [
            [C.metal, 'L', 1.7, [-10.5, -23.5], [-4, -22.5], [4, -22.5], [10.5, -23.5]],
            [C.tunicDark, 'L', 4.2, [-7.6, -29.5], [-10.2, -23.8]],
            [C.tunicDark, 'L', 4.2, [7.6, -29.5], [10.2, -23.8]],
            [C.skin, 'o', -10.5, -23.5, 2.3],
            [C.skin, 'o', 10.5, -23.5, 2.3],
            ...this.pedalLegs(p),
            ...this.torso('up', 0, b),
            ...this.head('up', 0, -30 + b),
            [C.tire, 'r', -1.6, -15, 3.2, 15, 1.6],
            [C.frame, 'L', 1.5, [-2.3, -7.5], [-2.3, -17]],   // seat stays
            [C.frame, 'L', 1.5, [2.3, -7.5], [2.3, -17]],
            [C.frame, 'r', -3.2, -18.6, 6.4, 2.8, 1.2],       // mudguard
            [C.reflector, 'r', -1.8, -18.1, 3.6, 1.8, 0.6]
        ];
    }
};
