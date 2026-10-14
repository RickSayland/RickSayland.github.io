// ============ OPENSTREETRPG — THE PLAYER ============
// Position, velocity and movement. Owns `player`. How the player LOOKS is
// avatar.js.
//
// The position is the point under the character's FEET, in normalised
// mercator (geo.js). The only collision is water: it stops you on foot and
// in any vehicle marked `landOnly` (the bike and the car; see keepDry and
// water.js). Aircraft fly over it. There is no swimming yet, which is why
// walking is blocked too.

const player = {

    // Speed is set in screen pixels per second AT REF_ZOOM, not in metres.
    // Real walking pace is a few pixels a second at street zoom, which reads as
    // standing still; this keeps the screen speed the same at every latitude,
    // and zooming out still makes the same walk cover visibly less screen.
    WALK: 130,
    REF_ZOOM: 18,

    // On foot. A mount's `move` replaces this (items.js), so walking and
    // riding are one model with different numbers: `speed` and `boost` (Shift)
    // multiply WALK, and velocity closes on its target at `accel` per second
    // while a key is held and `coast` per second once released. Walking's
    // rates are high enough to feel instant; a bike's are not.
    FOOT: { speed: 1, boost: 2.5, accel: 25, coast: 25 },

    x: 0.5,
    y: 0.5,
    vx: 0,                  // velocity, in screen px/s at REF_ZOOM
    vy: 0,
    facing: 'down',         // 'down' | 'up' | 'left' | 'right'
    mount: null,            // the ITEMS entry in the mount slot, or null
    moving: false,
    running: false,
    phase: 0,               // walk cycle, radians
    stride: 0,              // 0 standing .. 1 mid-walk, eased so legs settle
    crank: 0,               // pedal angle, radians
    wheel: 0,               // wheel angle, radians
    thrust: 0,              // speed as a fraction of the mount's cruising speed (>1 when boosting)
    alt: 0,                 // flying height in sprite units, eased toward the mount's `alt`
    clock: 0,               // seconds; drives rotors, flames and hovering
    walked: 0,              // metres on the ground, however they were covered
    blocked: false,         // ran into water this frame (on foot, or in a land vehicle)

    lat() { return geo.toLat(this.y); },
    lon() { return geo.toLon(this.x); },

    place(lat, lon) {
        this.x = geo.wrapX(geo.toX(lon));
        this.y = clamp(geo.toY(lat), 0, 1);
        this.vx = this.vy = 0;
    },

    update(dt) {
        this.mount = inventory.inSlot('mount');
        const m = this.mount ? this.mount.move : this.FOOT;
        const a = input.axis();
        const pressing = a.x !== 0 || a.y !== 0;

        const top = this.WALK * m.speed * (input.running() ? m.boost : 1);
        const k = 1 - Math.exp(-dt * (pressing ? m.accel : m.coast));
        this.vx += (a.x * top - this.vx) * k;
        this.vy += (a.y * top - this.vy) * k;
        let speed = Math.hypot(this.vx, this.vy);
        if (!pressing && speed < 3) { this.vx = this.vy = 0; speed = 0; }

        const u = dt / geo.worldPx(this.REF_ZOOM);
        let dx = this.vx * u, dy = this.vy * u;
        this.blocked = false;
        const landOnly = this.mount ? !!this.mount.landOnly : true;
        if (landOnly && (dx || dy)) [dx, dy] = this.keepDry(dx, dy, u);
        this.walked += Math.hypot(dx, dy) * geo.metresPerUnit(this.y);
        this.x = geo.wrapX(this.x + dx);
        this.y = clamp(this.y + dy, 0, 1);

        if (pressing) this.face(a.x, a.y);
        this.moving = speed > 4;
        this.running = !this.mount && pressing && input.running();
        this.clock += dt;
        this.thrust = speed / (this.WALK * m.speed);
        // Take-off and landing between two flying heights is eased; getting
        // out of an aircraft is not, since the walker is drawn on the ground.
        this.alt += (((this.mount && this.mount.alt) || 0) - this.alt) * Math.min(1, dt * 2.5);

        if (this.mount) {
            // Wheels turn with the road, pedals only while pedalling, both
            // capped so a sprint does not strobe the spokes.
            const r = Math.min(this.thrust, 1.6);
            this.wheel += dt * 14 * r;
            if (pressing) this.crank += dt * 7 * r;
            this.stride = 0;
        } else {
            if (this.moving) this.phase += dt * (this.running ? 15 : 10);
            this.stride += ((this.moving ? 1 : 0) - this.stride) * Math.min(1, dt * 12);
        }
    },

    // Water stops you on foot and in a land vehicle.
    //
    // Whether a piece of movement is allowed is decided by PROBING a fixed
    // distance ahead in its direction (`probe`, two sampler radii, ~2 m at
    // street zoom), not where the piece lands. A slow step is a fraction of a
    // pixel, and the water reading is pixel-coarse: judged where it lands, a
    // step parks you on the line where the "mostly water" vote is a coin
    // toss, after which every step in any direction flips it and you are
    // stuck — the car, which arrives fast and restarts slowly, could not slide
    // at all. Probing well ahead stops you clear of that band whatever your
    // speed. Movement is also cut into pieces no longer than one radius, so a
    // fast car cannot hop a canal between probes.
    //
    // A blocked piece keeps only its part ALONG the shore (the step minus its
    // component on the shore's normal), so the rider slides along a bank at
    // whatever angle it runs, slower the more squarely they push into it and
    // not at all when they push straight at it, plus a small push back out so
    // a curving shore does not catch them again. Velocity is then set to what
    // was actually covered: momentum follows the bank, and is zero after a
    // dead stop.
    //
    // Anyone already in the water (teleported there, or landed there) moves
    // freely until they reach land, rather than being trapped where they
    // stand. Ordinary movement can no longer slip anyone in (the landing
    // check below), so that freedom cannot be abused. Do NOT make it "never
    // deeper": a river name or ferry line drawn mid-river reads as a little
    // drier, and the next step back into plain water then counts as deeper —
    // that version stranded a walker halfway to the bank.
    keepDry(dx, dy, u) {
        if (water.isWater(this.x, this.y)) return [dx, dy];
        const piece = water.RADIUS / geo.worldPx(18), probe = 2 * piece;
        const n = Math.min(64, Math.max(1, Math.ceil(Math.hypot(dx, dy) / piece)));
        let sx = dx / n, sy = dy / n, x = this.x, y = this.y;
        // A piece is refused if the probe ahead is wet OR the piece would
        // land in water. The probe alone is not enough: running along a shore
        // (momentum after a slide) the probe can stay just dry while the body
        // drifts sideways into the water. The landing check is safe because
        // the probe keeps the body well clear of the coin-toss line.
        const wet = (vx, vy) => {
            const l = Math.hypot(vx, vy);
            return l > 0 && (water.blocks(x + vx / l * probe, y + vy / l * probe) || water.blocks(x + vx, y + vy));
        };
        for (let i = 0; i < n; i++) {
            if (!wet(sx, sy)) { x += sx; y += sy; continue; }
            this.blocked = true;
            const l = Math.hypot(sx, sy);
            const nrm = water.shoreNormal(x + sx / l * probe, y + sy / l * probe) || water.shoreNormal(x, y);
            if (!nrm) break;
            const into = sx * nrm[0] + sy * nrm[1];
            if (into <= 0) break;
            let tx = sx - into * nrm[0], ty = sy - into * nrm[1];
            const along = Math.hypot(tx, ty);
            if (along < 1e-14) break;
            tx -= nrm[0] * along * 0.25;
            ty -= nrm[1] * along * 0.25;
            if (wet(tx, ty)) break;
            x += tx;
            y += ty;
            sx = tx;
            sy = ty;
        }
        if (this.blocked) {
            this.vx = (x - this.x) / u;
            this.vy = (y - this.y) / u;
        }
        return [x - this.x, y - this.y];
    },

    // Four facings for eight directions of travel. On a diagonal, keep the
    // current facing if it is one of the two being pressed, so tapping a
    // second key mid-walk does not flip the sprite.
    face(ax, ay) {
        const h = ax > 0 ? 'right' : 'left', v = ay > 0 ? 'down' : 'up';
        if (ax === 0) this.facing = v;
        else if (ay === 0) this.facing = h;
        else if (this.facing !== h && this.facing !== v) this.facing = h;
    }
};
