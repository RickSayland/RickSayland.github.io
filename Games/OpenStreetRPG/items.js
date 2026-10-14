// ============ OPENSTREETRPG — ITEMS ============
// The item registry and what the player is carrying. Zero DOM. Owns `ITEMS`,
// `SLOTS` and `inventory`.
//
// An item is data. What it DOES is read off it by whichever system cares:
// player.js reads `move` and `alt` from whatever is in the mount slot,
// main.js reads `view` to frame the camera, vehicles.js draws it by id, and
// the HUD lists it. A new vehicle is an entry here plus a drawing there.
//
//   move   multipliers on walking speed (player.WALK): `speed`, and `boost`
//          while Shift is held; then the rates (1/s) at which velocity closes
//          on its target while a key is held (`accel`) and after (`coast`).
//          Walking's own profile is player.FOOT.
//   view   { cruise, min, max } zoom levels. A fast vehicle has to be seen from
//          further out, or it crosses the screen in a blink and asks the tile
//          servers for a screenful of tiles every frame. Absent: the walking
//          range, and the zoom is left where it was.
//   alt    flying height in sprite units (0 or absent: on the ground)

const SLOTS = {
    mount: 'Vehicle'
};

const ITEMS = {
    bicycle: {
        name: 'Bicycle',
        slot: 'mount',
        blurb: 'A sturdy town bike. Takes a moment to get going, and freewheels when you stop pedalling.',
        move: { speed: 3.2, boost: 1.5, accel: 4, coast: 2.2 },
        equipText: 'You hop on the bicycle.',
        unequipText: 'You hop off the bicycle.'
    },
    car: {
        name: 'Car',
        slot: 'mount',
        blurb: 'A zippy little convertible. Quick on the straights and slow to stop, so brake early. The view pulls back a little.',
        move: { speed: 8, boost: 1.75, accel: 2.2, coast: 1.4 },
        view: { cruise: 17, min: 15, max: 18 },
        equipText: 'You start the car.',
        unequipText: 'You park the car and climb out.'
    },
    helicopter: {
        name: 'Helicopter',
        slot: 'mount',
        blurb: 'Lifts straight up and drifts wherever you point it. High enough to take in a whole district.',
        move: { speed: 30, boost: 1.5, accel: 1.6, coast: 0.9 },
        view: { cruise: 15, min: 12, max: 16 },
        alt: 28,
        equipText: 'Rotors spinning up. You lift off.',
        unequipText: 'You touch down and climb out.'
    },
    jet: {
        name: 'Jet',
        slot: 'mount',
        blurb: 'Very fast, very high, and very hard to stop. Cross a country in a few minutes. Shift lights the afterburner.',
        move: { speed: 120, boost: 1.6, accel: 1.0, coast: 0.6 },
        view: { cruise: 12, min: 9, max: 13 },
        alt: 44,
        equipText: 'Afterburners lit. You climb to cruising altitude.',
        unequipText: 'You land the jet and climb out.'
    },
    // The secret one, granted by ?ufo (main.js). Fifteen times the jet (it
    // was three, then got a 5x speedup), with the same boost, so the ratio
    // holds whether or not Shift is held. Its view sits a level further out
    // than the old one: still visibly quicker on screen, but not so quick that
    // the tiles can never arrive. It also stops on a dime, which nothing from
    // Earth does.
    ufo: {
        name: 'UFO',
        slot: 'mount',
        blurb: 'Not of this Earth. Fifteen times as fast as the jet, and it stops on a dime. Hover still to switch on the beam.',
        move: { speed: 1800, boost: 1.6, accel: 6, coast: 6 },
        view: { cruise: 10, min: 5, max: 10 },
        alt: 34,
        equipText: 'The hatch hisses shut. The craft hums to life.',
        unequipText: 'The beam lowers you gently back to the ground.'
    }
};
for (const id in ITEMS) ITEMS[id].id = id;

const inventory = {

    STARTING: ['bicycle', 'car', 'helicopter', 'jet'],

    items: [],              // ids the player owns, in display order
    equipped: {},           // slot -> item id
    version: 0,             // bumped on every change; the HUD and saver watch it

    reset() {
        this.items = this.STARTING.slice();
        this.equipped = {};
        this.version++;
    },

    isEquipped(id) {
        const it = ITEMS[id];
        return !!it && this.equipped[it.slot] === id;
    },

    inSlot(slot) {
        const id = this.equipped[slot];
        return id ? ITEMS[id] : null;
    },

    // Add an item if it is not already owned. Returns whether it was new.
    grant(id) {
        if (!ITEMS[id] || this.items.includes(id)) return false;
        this.items.push(id);
        this.version++;
        return true;
    },

    // Equip, or take off if already worn; equipping replaces whatever held the
    // slot. Returns whether the item is now equipped.
    toggle(id) {
        const it = ITEMS[id];
        if (!it || !this.items.includes(id)) return false;
        if (this.equipped[it.slot] === id) delete this.equipped[it.slot];
        else this.equipped[it.slot] = id;
        this.version++;
        return this.isEquipped(id);
    },

    save() {
        return { items: this.items.slice(), equipped: Object.assign({}, this.equipped) };
    },

    // Tolerant of saves from older versions: unknown ids are dropped, and the
    // starting kit is always there even if the save predates an item in it.
    restore(s) {
        this.reset();
        if (!s) return;
        if (Array.isArray(s.items)) {
            for (const id of s.items) if (ITEMS[id] && !this.items.includes(id)) this.items.push(id);
        }
        for (const slot in s.equipped || {}) {
            const id = s.equipped[slot];
            if (ITEMS[id] && ITEMS[id].slot === slot && this.items.includes(id)) this.equipped[slot] = id;
        }
        this.version++;
    }
};
