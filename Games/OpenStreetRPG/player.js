// ============ OPENSTREETRPG — THE PLAYER ============
// Position, velocity and movement. Owns `player`. How the player LOOKS is
// avatar.js.
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
        const dx = this.vx * u, dy = this.vy * u;
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
