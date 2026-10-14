// ============ OPENSTREETRPG — ITEMS ============
// The item registry and what the player is carrying. Zero DOM. Owns `ITEMS`,
// `SLOTS` and `inventory`.
//
// An item is data. What it DOES is read off it by whichever system cares:
// player.js reads `move` from whatever is in the mount slot, avatar.js draws
// a rider when that slot is filled, and the HUD lists everything. A new item
// is a new entry here plus, if it changes how the player looks, a pose there.

const SLOTS = {
    mount: 'Mount'
};

const ITEMS = {
    bicycle: {
        name: 'Bicycle',
        slot: 'mount',
        icon: 'bicycle',
        blurb: 'A sturdy town bike. Takes a moment to get going, and freewheels when you stop pedalling.',
        // Multipliers on walking speed (player.WALK), and the rates (1/s) at
        // which velocity closes on its target while pedalling and while
        // freewheeling. Walking's own profile is player.FOOT.
        move: { speed: 3.2, boost: 1.5, accel: 4, coast: 2.2 },
        equipText: 'You hop on the bicycle.',
        unequipText: 'You hop off the bicycle.'
    }
};

const inventory = {

    STARTING: ['bicycle'],

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
