// creature.js -- the animal: tissues, muscles, senses, AI, stats, lifecycle.
//
// A Creature owns a SoftBody built from a genome's body plan and everything
// that makes it alive: it grows, thermoregulates, gets hurt, heals, decides
// what to do and does it by changing the rest lengths of its muscles. It
// never touches the grid. Everything that crosses between the animal and the
// sand (collision, eating, heat through the skin, radiation hits, blood on
// the floor) is coupling.js, which reads and writes the fields below.
//
// The Egg and the toy Ball live here too: one is the animal before it is an
// animal, the other is the same solver with a different set of constraints.

import { CFG, TISSUE, STAGE, AI } from './config.js';
import { SoftBody, KIND } from './softbody.js';
import { buildPlan, outlineR, faceWeight, encode, decode, express } from './genome.js';
import { MAT, MAT_COUNT, M_BASE_RGB } from './materials.js';

const { BONE, MEAT, BLOOD, SKIN } = TISSUE;
const MASK_BONE = 1 << BONE;
const MASK_FLESH = (1 << BONE) | (1 << MEAT) | (1 << SKIN);
const L = CFG.LIFE, G = CFG.GAIT, ST = CFG.STATS, TH = CFG.THERMO, D = CFG.DOSE, INJ = CFG.INJURY, A = CFG.AI;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const frac = (v) => v - Math.floor(v);
const rgba = (r, g, b) => (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);

export function stageCap(stage) {
    if (stage === STAGE.EGG) return L.SCALE_EMBRYO;
    if (stage === STAGE.BABY) return L.SCALE_BABY;
    if (stage === STAGE.CHILD) return L.SCALE_CHILD;
    return L.SCALE_ADULT;
}

export class Creature {
    constructor(genome, generation = 1) {
        this.genome = genome;
        this.generation = generation;
        this.plan = buildPlan(genome);
        this.phen = this.plan.phen;
        const n = this.plan.n;
        this.body = new SoftBody(n + 2, 2048, 64);
        this.ux = new Float32Array(n);          // unit rest position at the current facing
        this.uy = new Float32Array(n);
        this.speck = new Uint8Array(n);         // surface contamination: a material id per skin particle
        this.bled = new Uint8Array(n);          // blood particles lost through a wound
        this.internal = new Float32Array(MAT_COUNT);   // swallowed radioactive dust, in cells
        this.spotX = new Float32Array(16);
        this.spotY = new Float32Array(16);

        this.stage = STAGE.EGG;
        this.age = 0;
        this.scale = L.SCALE_EMBRYO;
        this.mass = this.scale * this.scale;
        this.budget = 0;
        this.face = 1;                 // -1 facing left .. +1 facing right
        this.moveDir = 0;              // what the AI wants: -1, 0, +1
        this.walking = false;
        this.gaitPhase = 0;
        this.gaitEnv = 0;
        this.breath = 0;
        this.crouch = 0;
        this.bow = 0;
        this.variant = 0;              // which variation of its gait it has settled on
        this.tryTime = 0;
        this.tryX = 0;
        this.restDirty = true;

        this.stats = { hunger: 62, happiness: 70, hygiene: 100, energy: 85, health: 100 };
        this.bodyTemp = TH.START;
        this.regulation = 1;           // heat output relative to basal
        this.shiver = 0;
        this.doseTotal = 0;            // body-mean cumulative dose: never recovers
        this.doseRate = 0;             // recovers slowly
        this.doseTick = 0;             // accumulated by coupling during the tick
        this.rateNow = 0;
        this.bloodFrac = 1;
        this.wounds = 0;
        this.strainHurt = 0;
        this.sick = 0;                 // 0..1 radiation sickness

        this.ai = AI.IDLE;
        this.aiTimer = 0;
        this.targetX = 0;
        this.stuck = 0;
        this.lastX = 0;
        this.sleeping = false;
        this.eating = 0;               // seconds since the last bite
        this.sense = {
            hasFood: false, foodX: 0, foodY: 0, tempL: 22, tempR: 22, doseL: 0, doseR: 0,
            hasBall: false, ballX: 0, ballY: 0, wasteCount: 0, lights: true,
        };

        this.gut = 0;
        this.wasteTimer = L.WASTE_INTERVAL;
        this.pendingWaste = 0;         // coupling turns these into cells
        this.eggCooldown = L.EGG_COOLDOWN * 0.5;
        this.layTimer = 0;
        this.wantsToLay = false;       // main.js acts on this
        this.hasEgg = false;           // set by main.js
        this.mate = null;              // genome to cross with at the next laying
        this.medicineCooldown = 0;
        this.healBoost = 0;
        this.bloodTimer = 0;
        this.blink = 0;
        this.dead = false;
        this.cause = '';
        this.grace = 0;

        // measured each tick
        this.cx = 0; this.cy = 0; this.vx = 0; this.vy = 0;
        this.mouthX = 0; this.mouthY = 0; this.tailX = 0; this.tailY = 0;
        this.lookX = 0; this.lookY = 0;

        this._build();
    }

    // ---- construction ----------------------------------------------------------
    _build() {
        const p = this.plan, b = this.body;
        b.reset();
        for (let i = 0; i < p.n; i++) {
            b.addParticle(0, 0, p.mass[i], p.tissue[i]);
            b.on[i] = 0;
        }
        for (let e = 0; e < p.ring.length; e++) b.ring[e] = p.ring[e];
        b.ringN = p.ring.length;
        // Two shape-matching groups. The skeleton is one rigid body; the
        // whole animal is a much weaker one, which is its memory of its own
        // shape.
        b.addGroup(MASK_BONE, CFG.SOFT.ALPHA_SHAPE_BONE * this.phen.boneSoft);
        b.addGroup(MASK_FLESH, CFG.SOFT.ALPHA_SHAPE_BODY * this.phen.meatSoft);
        this.refreshRest();
    }

    // Put the animal in the world, at rest, centred on (x, y).
    place(x, y) {
        const p = this.plan, b = this.body;
        this.refreshRest();
        for (let i = 0; i < p.n; i++) {
            b.x[i] = b.px[i] = x + b.rx[i];
            b.y[i] = b.py[i] = y + b.ry[i];
            b.vx[i] = b.vy[i] = 0;
            b.on[i] = p.birth[i] <= this.scale + 1e-6 ? 1 : 0;
            b.temp[i] = TH.START;
        }
        this.rebuildConstraints();
        this.measure();
    }

    // Rest positions for the current growth scale and facing, and every rest
    // length that follows from them. Growth lengthens the rest shape and
    // turning morphs it; in both cases the particles are left where they are
    // and the constraints walk them to the new shape over the next few
    // substeps.
    refreshRest() {
        const p = this.plan, b = this.body, g = this.scale;
        const wR = faceWeight(this.face);
        for (let i = 0; i < p.n; i++) {
            let ux, uy;
            if (p.morph[i]) {
                const R = outlineR(p, p.theta[i], wR) * p.rho[i];
                ux = R * p.cosT[i]; uy = R * p.sinT[i];
            } else { ux = p.fx[i]; uy = p.fy[i]; }
            this.ux[i] = ux; this.uy[i] = uy;
            b.rx[i] = ux * g; b.ry[i] = uy * g;
        }
        for (let k = 0; k < b.nc; k++) {
            if (b.cKind[k] === KIND.MUSCLE) continue;
            const i = b.ci[k], j = b.cj[k];
            b.cRest[k] = Math.hypot(b.rx[i] - b.rx[j], b.ry[i] - b.ry[j]);
        }
        this.areaRest0 = b.restRingArea();
        b.areaRest = this.areaRest0;
        // Thrust balance for the hop. The head makes the animal front-heavy,
        // so feet that all push equally push BEHIND the centre of mass and
        // every hop pitches it onto its nose. Each foot gets a weight
        // w_k = 1 + s (x_k - mean x) with s chosen so the weighted push has
        // no moment about the centre of mass:  s = N * offset / sum (x_k - mean)^2.
        let M = 0, comX = 0;
        for (let i = 0; i < p.n; i++) { if (p.tissue[i] !== BLOOD) { M += p.mass[i]; comX += p.mass[i] * this.ux[i]; } }
        comX /= M || 1;
        const feet = p.feet;
        let mean = 0, varx = 0;
        for (const f of feet) mean += this.ux[f.meat] / feet.length;
        for (const f of feet) varx += (this.ux[f.meat] - mean) ** 2;
        const slope = varx > 1e-6 ? feet.length * (comX - mean) / varx : 0;
        for (const f of feet) f.push = clamp(1 + slope * (this.ux[f.meat] - mean), 0.35, 1.8);
        const sp = p.pattern.spots;
        for (let k = 0; k < sp.length && k < 16; k++) {
            const R = outlineR(p, sp[k].th, wR) * sp[k].rho;
            this.spotX[k] = R * Math.cos(sp[k].th); this.spotY[k] = R * Math.sin(sp[k].th);
        }
        this.restDirty = false;
    }

    // Build the constraint set for the particles that currently exist. Called
    // at birth and whenever growth switches a particle on. Deterministic: the
    // same active set always produces the same constraints in the same order.
    rebuildConstraints() {
        const p = this.plan, b = this.body, ph = this.phen, S = CFG.SOFT, B = CFG.BODY;
        // wounds survive a rebuild: they are keyed by ring edge, which is stable
        const rn = b.ringN;
        const wasBroken = new Array(rn).fill(0);
        for (let e = 0; e < rn; e++) {
            const k = b.ringEdge[e];
            if (k >= 0 && !b.cOn[k]) wasBroken[e] = b.cMend[k] || INJ.MEND_TIME;
        }
        b.clearConstraints();

        const seen = new Set();
        const rest = (i, j) => Math.hypot(b.rx[i] - b.rx[j], b.ry[i] - b.ry[j]);
        const udist = (i, j) => Math.hypot(p.sx[i] - p.sx[j], p.sy[i] - p.sy[j]);
        const add = (i, j, kind, alpha) => {
            const key = i < j ? i * 1024 + j : j * 1024 + i;
            if (i === j || seen.has(key)) return -1;
            seen.add(key);
            return b.addConstraint(i, j, kind, alpha, rest(i, j));
        };

        // BONE: stiff links along the spine and across every second vertebra.
        const aBone = S.ALPHA_BONE * ph.boneSoft;
        const bones = p.bones;
        for (let k = 0; k + 1 < bones.length; k++) add(bones[k], bones[k + 1], KIND.BONE, aBone);
        for (let k = 0; k + 2 < bones.length; k++) add(bones[k], bones[k + 2], KIND.BONE, aBone);

        // SKIN: stretchy edges round the ring, plus a much softer link across
        // every second vertex that resists the outline folding on itself.
        const aSkin = S.ALPHA_SKIN * ph.skinSoft;
        for (let e = 0; e < rn; e++) {
            const k = add(p.ring[e], p.ring[(e + 1) % rn], KIND.SKIN, aSkin);
            b.ringEdge[e] = k;
            if (k >= 0 && wasBroken[e] > 0) { b.cOn[k] = 0; b.cMend[k] = wasBroken[e]; }
        }
        for (let e = 0; e < rn; e++) add(p.ring[e], p.ring[(e + 2) % rn], KIND.SKIN_BEND, S.ALPHA_SKIN_BEND * ph.skinSoft);

        // MEAT: every active lattice node links to its neighbours. A young
        // animal has a sparse subset of the lattice, so the reach scales with
        // the spacing the active nodes actually have.
        const meat = [];
        for (let i = 0; i < p.n; i++) if (b.on[i] && p.tissue[i] === MEAT) meat.push(i);
        let activeLattice = 0;
        for (const i of p.lattice) if (b.on[i]) activeLattice++;
        const pitch = p.latticePitch * Math.sqrt(p.lattice.length / Math.max(1, activeLattice));
        const aMeat = S.ALPHA_MEAT * ph.meatSoft;
        const aMB = S.ALPHA_MEAT_BONE * ph.meatSoft;
        const deg = new Map();
        const bump = (i) => deg.set(i, (deg.get(i) || 0) + 1);
        const reach = B.LINK_RADIUS * pitch;
        for (let a = 0; a < meat.length; a++) {
            for (let c = a + 1; c < meat.length; c++) {
                if (udist(meat[a], meat[c]) < reach && add(meat[a], meat[c], KIND.MEAT, aMeat) >= 0) { bump(meat[a]); bump(meat[c]); }
            }
        }
        // ...and to nearby bone, which is what hangs the meat on the skeleton
        const boneReach = B.BONE_LINK_RADIUS * pitch;
        for (const bi of bones) {
            for (const mi of meat) {
                if (udist(bi, mi) < boneReach && add(bi, mi, KIND.MEAT_BONE, aMB) >= 0) { bump(bi); bump(mi); }
            }
        }
        // nobody is left dangling: top every node up to MIN_LINKS with its nearest
        const anchors = meat.concat(bones);
        for (const i of anchors) {
            let guard = 0;
            while ((deg.get(i) || 0) < B.MIN_LINKS && guard++ < 6) {
                let best = -1, bd = 1e9;
                for (const j of anchors) {
                    if (j === i) continue;
                    const key = i < j ? i * 1024 + j : j * 1024 + i;
                    if (seen.has(key)) continue;
                    const d = udist(i, j);
                    if (d < bd) { bd = d; best = j; }
                }
                if (best < 0) break;
                const isBone = p.tissue[i] === BONE || p.tissue[best] === BONE;
                add(i, best, isBone ? KIND.MEAT_BONE : KIND.MEAT, isBone ? aMB : aMeat);
                bump(i); bump(best);
            }
        }

        // SPOKES: each skin particle to the two nearest pieces of flesh. A
        // skin particle in a limb nub is tied firmly to that nub's foot pad.
        for (let e = 0; e < rn; e++) {
            const si = p.ring[e];
            let n1 = -1, d1 = 1e9, n2 = -1, d2 = 1e9;
            for (const j of anchors) {
                const d = udist(si, j);
                if (d < d1) { n2 = n1; d2 = d1; n1 = j; d1 = d; } else if (d < d2) { n2 = j; d2 = d; }
            }
            const f = p.foot[si];
            if (f >= 0) add(si, p.feet[f].meat, KIND.FOOT, S.ALPHA_FOOT * ph.meatSoft);
            if (n1 >= 0) add(si, n1, KIND.SPOKE, S.ALPHA_SPOKE * ph.skinSoft);
            if (n2 >= 0) add(si, n2, KIND.SPOKE, S.ALPHA_SPOKE * ph.skinSoft);
        }

        // MUSCLES: two actuated links from each foot pad to the spine bones
        // fore and aft of it. Two lengths fix a point relative to two bones,
        // so setting the pair of rest lengths is asking for the foot to be
        // somewhere -- and the solver, not the AI, is what puts it there.
        for (const f of p.feet) {
            f.c1 = add(f.meat, f.b1, KIND.MUSCLE, S.ALPHA_MUSCLE);
            f.c2 = add(f.meat, f.b2, KIND.MUSCLE, S.ALPHA_MUSCLE);
        }
        this.restDirty = true;
    }

    // Switch on any particle whose time has come. New meat appears where the
    // rest shape says it belongs, carried through the body's current best-fit
    // rigid motion, and inherits the body's velocity and temperature.
    activate() {
        const p = this.plan, b = this.body;
        let changed = false;
        const g1 = b.groups[1];
        const c = Math.cos(g1.angle), s = Math.sin(g1.angle);
        if (!(g1.mass > 0)) return false;       // not solved yet: nothing to carry it through
        for (let i = 0; i < p.n; i++) {
            if (b.on[i] || p.birth[i] > this.scale + 1e-6) continue;
            if (p.tissue[i] === BLOOD) {
                // Growing makes blood along with everything else. Blood that
                // was LOST is a different matter: that comes back slowly,
                // out of food (see _regenBlood).
                if (!this.bled[i]) this._bloodAt(i);
                continue;
            }
            const qx = b.rx[i] - (g1.qx0 || 0), qy = b.ry[i] - (g1.qy0 || 0);
            b.x[i] = b.px[i] = g1.cx + c * qx - s * qy;
            b.y[i] = b.py[i] = g1.cy + s * qx + c * qy;
            b.vx[i] = this.vx; b.vy[i] = this.vy;
            b.temp[i] = this.bodyTemp;
            b.dose[i] = this.doseTotal;
            b.on[i] = 1;
            changed = true;
        }
        return changed;
    }

    // ---- per-tick: before the solver ------------------------------------------
    think(dt, tick) {
        if (this.dead) return;
        const egg = this.stage === STAGE.EGG;
        // external accelerations are rebuilt every tick: the righting reflex
        // below, then load and buoyancy from coupling.skinPass
        const b0 = this.body;
        b0.ax.fill(0, 0, b0.n); b0.ay.fill(0, 0, b0.n); b0.drag.fill(0, 0, b0.n);
        if (!egg) {
            this.age += dt;
            this._stageByAge();
            this._grow(dt);
            this._turn(dt);
            if ((tick % A.DECIDE_TICKS) === 0 || this.aiTimer <= 0) this._decide();
            this.aiTimer -= dt;
            this._act(dt);
            this._stats(dt);
        }
        if (this.restDirty) this.refreshRest();
        if (!egg && this.activate()) { this.rebuildConstraints(); this.refreshRest(); }
        this._actuate(dt);
        this._thermo(dt);
        this._compliance();
    }

    _stageByAge() {
        const f = this.age / this.phen.lifespan;
        let s = STAGE.BABY;
        if (f >= L.AGE_ELDER) s = STAGE.ELDER;
        else if (f >= L.AGE_ADULT) s = STAGE.ADULT;
        else if (f >= L.AGE_CHILD) s = STAGE.CHILD;
        if (s !== this.stage) { this.stage = s; this.stageChanged = true; }
        if (f >= 1) this.die('old age');
    }

    // Growth. Food becomes a budget of mass; the budget is spent at a fixed
    // rate up to whatever the current life stage allows; and the rest shape
    // follows the mass (scale = sqrt(mass), because the body is an area)
    // with a lag of about a second so nothing ever jumps.
    _grow(dt) {
        const cap = stageCap(this.stage);
        const capMass = cap * cap;
        if (this.budget > 0 && this.mass < capMass) {
            const d = Math.min(this.budget, L.GROW_RATE * dt, capMass - this.mass);
            this.mass += d; this.budget -= d;
        }
        if (this.budget > 0.35) this.budget = 0.35;
        const target = Math.sqrt(this.mass);
        if (Math.abs(target - this.scale) > 1e-4) {
            this.scale += (target - this.scale) * Math.min(1, L.SCALE_LERP * dt);
            this.restDirty = true;
        }
    }

    _turn(dt) {
        const want = this.moveDir !== 0 ? this.moveDir : (this.face >= 0 ? 1 : -1);
        if (this.sleeping) return;
        if (Math.abs(want - this.face) > 1e-3) {
            const step = L.TURN_RATE * dt * (this.stage === STAGE.ELDER ? L.ELDER_SPEED : 1);
            this.face += clamp(want - this.face, -step, step);
            this.restDirty = true;
        }
    }

    // ---- AI ----------------------------------------------------------------------
    // A state machine. Hard needs come first and in a fixed order; below them
    // the temperament genes weight the choice between doing something and
    // doing nothing. A state only ever sets a target and a direction: the
    // moving is done by _actuate.
    _decide() {
        const s = this.stats, sn = this.sense, ph = this.phen;
        const prev = this.ai;
        const comfortLo = ph.comfort - ph.comfortW, comfortHi = ph.comfort + ph.comfortW;
        const wantSleep = !sn.lights || s.energy < A.SLEEP_AT || (this.sleeping && sn.lights && s.energy < A.WAKE_AT && this._selfSleep);
        // a timid animal runs from a field a bold one ignores
        const fleeAt = D.FLEE_RATE * (1.5 - ph.timid);
        const hot = this.doseRate > fleeAt || Math.max(sn.doseL, sn.doseR) > fleeAt * 60;
        let next;

        if (hot && Math.abs(sn.doseL - sn.doseR) > 0.02 * (sn.doseL + sn.doseR + 1e-6)) next = AI.FLEE_RADIATION;
        else if (wantSleep && this.doseRate < fleeAt * 2) next = AI.SLEEP;
        else if (this.bodyTemp > comfortHi + 1 && Math.abs(sn.tempL - sn.tempR) > A.TEMP_DELTA) next = AI.SEEK_COOL;
        else if (this.bodyTemp < comfortLo - 1 && Math.abs(sn.tempL - sn.tempR) > A.TEMP_DELTA) next = AI.SEEK_WARMTH;
        else if (this.wantsLayNow()) next = AI.LAY_EGG;
        else if (sn.hasFood && (s.hunger < A.HUNGRY || (prev === AI.EAT && s.hunger < A.FULL) ||
            (prev === AI.SEEK_FOOD && s.hunger < A.FULL) || this._growing())) {
            next = this._mouthNearFood() ? AI.EAT : AI.SEEK_FOOD;
        }
        else if (s.health < A.DISTRESS_HEALTH || s.hunger < 8) next = AI.DISTRESSED;
        else if (sn.hasBall && (s.happiness < 85 || ph.curious > 0.5) && s.energy > 20) next = AI.PLAY;
        else if (prev === AI.WANDER && this.aiTimer > 0) next = AI.WANDER;
        else if (prev === AI.IDLE && this.aiTimer > 0) next = AI.IDLE;
        else {
            // curious animals explore, lazy ones do not
            const pWander = clamp(0.3 + 0.55 * ph.curious - 0.45 * ph.lazy, 0.05, 0.9);
            if (Math.random() < pWander) {
                next = AI.WANDER;
                this.aiTimer = A.WANDER_MIN + Math.random() * (A.WANDER_MAX - A.WANDER_MIN);
                const reach = 20 + 50 * ph.curious;
                this.targetX = clamp(this.cx + (Math.random() * 2 - 1) * reach, 12, CFG.GRID.W - 12);
            } else {
                next = AI.IDLE;
                this.aiTimer = (A.IDLE_MIN + Math.random() * (A.IDLE_MAX - A.IDLE_MIN)) * (0.7 + ph.lazy);
            }
        }

        if (next === AI.SLEEP && prev !== AI.SLEEP) this._selfSleep = sn.lights;
        if (next !== prev) {
            this.ai = next;
            this.stuck = 0;
            if (next === AI.LAY_EGG) this.layTimer = 2.2;
            if (next !== AI.WANDER && next !== AI.IDLE) this.aiTimer = 1;
        }
        this.sleeping = this.ai === AI.SLEEP;
    }

    // A growing animal is always peckish: it will eat on a full stomach as
    // long as there is room to grow and nothing banked to grow with.
    _growing() {
        const cap = stageCap(this.stage);
        return this.mass < cap * cap - 0.004 && this.budget < 0.06 && this.sick <= 0;
    }

    wantsLayNow() {
        const s = this.stats;
        return this.stage === STAGE.ADULT && !this.hasEgg && this.eggCooldown <= 0 &&
            this.scale >= L.EGG_READY_SCALE && s.hunger >= L.EGG_HUNGER && s.health >= L.EGG_HEALTH;
    }

    _mouthNearFood() {
        const sn = this.sense;
        const r = A.EAT_REACH + 1.5;
        return Math.hypot(sn.foodX - this.mouthX, sn.foodY - this.mouthY) < r;
    }

    _act(dt) {
        const sn = this.sense;
        let dir = 0;
        switch (this.ai) {
            case AI.WANDER:
                if (Math.abs(this.targetX - this.cx) > A.ARRIVE) dir = Math.sign(this.targetX - this.cx);
                else this.aiTimer = 0;
                break;
            case AI.SEEK_FOOD: {
                // walk so that the MOUTH, not the middle, arrives at the food
                const dx = sn.foodX - this.mouthX;
                if (Math.abs(dx) > 1.2) dir = Math.sign(sn.foodX - this.cx) || Math.sign(dx);
                if (this._mouthNearFood()) this.ai = AI.EAT;
                break;
            }
            case AI.EAT:
                // lean into the pile while there is still some in front
                if (!this._mouthNearFood()) this.ai = AI.SEEK_FOOD;
                else if (Math.abs(sn.foodX - this.mouthX) > 1.0) dir = Math.sign(sn.foodX - this.cx);
                break;
            case AI.PLAY:
                if (Math.abs(sn.ballX - this.cx) > 2) dir = Math.sign(sn.ballX - this.cx);
                break;
            case AI.FLEE_RADIATION:
                // down the gradient of the dose-rate field
                dir = sn.doseL < sn.doseR ? -1 : 1;
                break;
            case AI.SEEK_WARMTH: dir = sn.tempL > sn.tempR ? -1 : 1; break;
            case AI.SEEK_COOL: dir = sn.tempL < sn.tempR ? -1 : 1; break;
            case AI.LAY_EGG:
                this.layTimer -= dt;
                if (this.layTimer <= 0) { this.wantsToLay = true; this.ai = AI.IDLE; this.aiTimer = 2; }
                break;
            default: break;
        }
        // do not walk into the glass
        if (dir < 0 && this.cx < 10) dir = 0;
        if (dir > 0 && this.cx > CFG.GRID.W - 10) dir = 0;
        // give up on a target that is not getting any closer
        if (dir !== 0) {
            this.stuck += dt;
            if (Math.abs(this.cx - this.lastX) > 1.5) { this.lastX = this.cx; this.stuck = 0; }
            if (this.stuck > A.STUCK_TIME && (this.ai === AI.WANDER || this.ai === AI.PLAY)) { this.aiTimer = 0; this.stuck = 0; dir = 0; }
        }
        this.moveDir = this.sleeping ? 0 : dir;
    }

    // ---- muscles -------------------------------------------------------------------
    // Locomotion is rhythm and nothing else. Each foot pad hangs off two
    // spine bones by two muscles, and a gait is a path for the foot to trace
    // in the body's own frame:
    //
    //   inchworm   a loop -- planted and pushed back along the ground, then
    //              lifted and carried forward -- with the feet out of phase
    //              so a wave of planted feet runs up the body
    //   hop        every foot together: sink slowly, then throw the feet
    //              down and back far faster than the body can follow
    //
    // The path becomes two rest lengths (the distance from the wanted foot
    // position to each bone), and that is all that is ever commanded. The
    // animal moves because a planted foot has friction and the constraint
    // solver would rather move the skeleton than the foot. Grip is the other
    // half: a planted foot holds, a swinging foot and the belly slide.
    _actuate(dt) {
        const p = this.plan, b = this.body, ph = this.phen;
        const elder = this.stage === STAGE.ELDER;
        const egg = this.stage === STAGE.EGG;
        const vigor = clamp(0.55 + this.stats.energy / 220 + this.stats.health / 400, 0.5, 1);
        const speed = ph.gaitFreq * (elder ? L.ELDER_SPEED : 1) * (this.sleeping ? G.SLEEP_SPEED : 1) * vigor;
        const amp = ph.gaitAmp * (elder ? L.ELDER_MUSCLE : 1) * (0.6 + 0.4 * vigor);
        const facingOk = this.moveDir !== 0 && Math.abs(this.face - this.moveDir) < 0.4;
        this.walking = facingOk && !this.sleeping && !egg;
        // Learning to walk. Whether a gait works for a given body is not
        // something the genome can know in advance, so the animal checks:
        // if a couple of seconds of trying have got it nowhere it changes
        // something -- the direction of the wave, the tempo, how hard it
        // kicks, and in the end the gait itself: a hopper that cannot hop
        // will crawl -- and keeps whatever variation is working.
        if (this.walking) {
            this.tryTime += dt;
            if (this.tryTime >= G.TRY_TIME) {
                const made = (this.cx - this.tryX) * this.moveDir / this.tryTime;
                if (made < G.TRY_SPEED * Math.sqrt(this.scale)) this.variant = (this.variant + 1) & 7;
                this.tryTime = 0; this.tryX = this.cx;
            }
        } else { this.tryTime = 0; this.tryX = this.cx; }
        const altA = (this.variant & 1) === 1, altB = (this.variant & 2) === 2;
        const hop = (p.gait === 1) !== ((this.variant & 4) === 4);
        // A hop is timed off the ground, not off a clock: the loading and
        // release phases wait until there is a foot down to push with.
        // Otherwise the cycle drifts out of step with the landings and the
        // animal throws its feet at thin air.
        let advance = this.walking;
        if (hop && advance && frac(this.gaitPhase) < G.HOP_CROUCH && !this._grounded()) {
            this.airTime = (this.airTime || 0) + dt;
            if (this.airTime < 1.5) advance = false;
        } else this.airTime = 0;
        const hopRate = speed * G.HOP_FREQ * (altB ? 1.35 : 1);       // hops per second
        if (advance) this.gaitPhase += dt * (hop ? hopRate : speed * (altB ? 1.35 : 1));
        this.gaitEnv += ((this.walking ? 1 : 0) - this.gaitEnv) * Math.min(1, dt * 7);
        // Posture. Asleep, it lies down; eating, it bows: the legs fold and
        // the righting reflex is asked for a nose-down tilt, which is what
        // brings a mouth that is carried well clear of the ground down to
        // the food.
        const bowing = this.ai === AI.EAT || (this.ai === AI.SEEK_FOOD && Math.abs(this.sense.foodX - this.mouthX) < 7);
        const wantCrouch = egg ? 0 : this.sleeping ? 1 : bowing ? 0.85 : this.ai === AI.LAY_EGG ? 0.7 : 0;
        this.crouch += (wantCrouch - this.crouch) * Math.min(1, dt * 3.5);
        this.bow += ((bowing ? 1 : 0) - this.bow) * Math.min(1, dt * 3.5);
        // the young take relatively bigger steps: a stride that shrank with
        // the body would not clear a single grain of sand
        const env = this.gaitEnv * amp / Math.pow(Math.max(0.3, this.scale), G.YOUNG_STRIDE);
        const d = this.face >= 0 ? 1 : -1;
        const g = this.scale;
        const sh = this.shiver * G.SHIVER;
        const moving = this.gaitEnv > 0.08;
        // The young stand tall. A hatchling's legs, scaled down with the rest
        // of it, are about one grain of sand long; left at that its belly
        // is on the floor and its feet have nothing to push against. So the
        // smaller the animal, the further it holds its feet down (in unit
        // coordinates: STAND_TALL (1 - g) cells in the world).
        const stand = egg ? 0 : G.STAND_TALL * (1 - Math.min(1, g)) / g;

        const nf = p.feet.length;
        for (let k = 0; k < nf; k++) {
            const f = p.feet[k];
            // the wave of planted feet always runs tail to head, whichever
            // end the head currently is
            const lag = hop ? 0 : ((d > 0) !== altA ? k : nf - 1 - k) / nf * G.WAVE * 2;
            const u = frac(this.gaitPhase - lag);
            let ox = 0, oy = 0, grip = 1;
            if (hop) {
                // (the release is never shorter than HOP_THRUST_MIN seconds:
                // a quick-stepping hatchling otherwise lets go in three ticks,
                // faster than its own body can follow)
                const c0 = G.HOP_CROUCH, c1 = c0 + Math.min(0.3, Math.max(G.HOP_THRUST, G.HOP_THRUST_MIN * hopRate));
                // The feet stay planted AHEAD of the body through the whole
                // of the load, so sinking does not drag it backwards; all the
                // fore-aft travel is spent in the release, and the feet are
                // brought forward again in the air, where it costs nothing.
                const w = (f.push || 1) * (altA ? 1.3 : 1);
                if (u < c0) {                         // load: sink onto planted feet
                    const t = smooth(u / c0);
                    ox = d * G.STRIDE * 0.7; oy = -G.HOP_DEPTH * t * w;
                } else if (u < c1) {                  // release: feet thrown down and back
                    const t = (u - c0) / (c1 - c0);
                    ox = d * G.STRIDE * (0.7 - 1.9 * t); oy = (-G.HOP_DEPTH + (G.HOP_DEPTH + G.HOP_KICK) * t) * w;
                } else {                              // flight: swing the feet forward to land on
                    const t = smooth((u - c1) / (1 - c1));
                    ox = d * G.STRIDE * (-1.2 + 1.9 * t); oy = G.HOP_KICK * (1 - t);
                    grip = 0;
                }
            } else if (u < G.DUTY) {
                // stance: planted, pressed down, swept from front to back.
                // A foot spends more than half the cycle here (DUTY), so
                // with the feet out of phase there are always enough of them
                // down to stand on; at an even split a two-footed animal is
                // balanced on one leg the whole time and rocks itself to a halt.
                const a = Math.PI * u / G.DUTY;
                ox = d * G.STRIDE * Math.cos(a);
                oy = G.PRESS * Math.sin(a);              // +y is down
            } else {
                // swing: lifted and carried forward, in the time that is left
                const a = Math.PI * (u - G.DUTY) / (1 - G.DUTY);
                ox = -d * G.STRIDE * Math.cos(a);
                oy = -G.LIFT * Math.sin(a);
                grip = 0;
            }
            const tx = this.ux[f.meat] + ox * env;
            const ty = this.uy[f.meat] + oy * env + stand * (1 - this.crouch) - this.crouch * G.CROUCH * p.nubs[k].len;
            if (f.c1 >= 0) {
                let n1 = 1, n2 = 1;
                if (sh > 0) { n1 += sh * (Math.random() * 2 - 1); n2 += sh * (Math.random() * 2 - 1); }
                b.cRest[f.c1] = g * Math.hypot(tx - this.ux[f.b1], ty - this.uy[f.b1]) * n1;
                b.cRest[f.c2] = g * Math.hypot(tx - this.ux[f.b2], ty - this.uy[f.b2]) * n2;
            }
            f.grip = moving ? grip : 2;
        }
        // friction per particle: planted feet grip, everything else slides
        // while walking and holds while standing
        for (let i = 0; i < p.n; i++) {
            const ft = p.foot[i];
            if (!moving) b.fric[i] = G.FRICTION_STAND;
            else if (ft >= 0) b.fric[i] = p.feet[ft].grip === 1 ? G.FRICTION_GRIP : G.FRICTION_SLIP;
            else b.fric[i] = G.FRICTION_SLIP;
        }
        this._right(dt);
        // breathing: the pressure in the skin rises and falls a little
        this.breath += dt * L.BREATH_HZ * (this.sleeping ? 0.55 : 1) * 6.283185307;
        b.areaRest = this.areaRest0 * (1 + L.BREATH_AMP * Math.sin(this.breath) * (this.sleeping ? 1.4 : 1));
    }

    _grounded() {
        const p = this.plan, b = this.body;
        for (let e = 0; e < p.ring.length; e++) {
            const i = p.ring[e];
            if (p.foot[i] >= 0 && b.hit[i] === 1) return true;
        }
        return false;
    }

    // The righting reflex. Nothing in a soft body knows which way is up, and
    // an animal that lands a hop badly would otherwise lie on its back and
    // keep pedalling. This is a pure couple -- equal and opposite forces
    // about the centre of mass, no net push -- proportional to how far the
    // skeleton has rolled from level and damped by how fast it is rolling.
    // It is applied as an acceleration and goes through the solver like
    // gravity does.
    _right(dt) {
        const b = this.body, p = this.plan;
        if (this.stage === STAGE.EGG) return;
        const g0 = b.groups[0];
        let ang = g0.angle;
        let w = ang - (this._lastAngle || 0);
        if (w > Math.PI) w -= 2 * Math.PI; else if (w < -Math.PI) w += 2 * Math.PI;
        this._lastAngle = ang;
        w /= dt;
        this.roll = ang;
        // (in the air there is nothing else to level it, so it tries harder)
        const vig = this.sleeping ? 0.4 : (this.walking && !this._grounded()) ? G.RIGHT_AIR : 1;
        // "level" is nose-down while it is bowing to eat
        const want = (this.face >= 0 ? 1 : -1) * G.EAT_TILT * this.bow;
        const alpha = (-G.RIGHT_GAIN * clamp(ang - want, -1.2, 1.2) - G.RIGHT_DAMP * clamp(w, -8, 8)) * vig;
        if (Math.abs(alpha) < 1e-4) return;
        for (let i = 0; i < p.n; i++) {
            if (!b.on[i] || p.tissue[i] === BLOOD) continue;
            b.ax[i] += -alpha * (b.y[i] - this.cy);
            b.ay[i] += alpha * (b.x[i] - this.cx);
        }
    }

    // ---- body temperature ----------------------------------------------------------
    // Each particle has its own temperature. Meat makes heat at the genome's
    // metabolic rate, heat conducts along every constraint, and blood mixes
    // with whatever tissue it is sloshing past, which is circulation in the
    // only sense that matters here: it evens the animal out. (The skin's
    // exchange with the world outside is in coupling.js.)
    //
    // Heat output is regulated: below the comfort centre the animal burns
    // more, above it less, within limits. Burning more is not free -- it is
    // paid for in hunger -- and at the top of the range the muscles shiver.
    _thermo(dt) {
        const p = this.plan, b = this.body, ph = this.phen;
        const err = (ph.comfort - this.bodyTemp) / ph.comfortW;
        const fed = this.stats.hunger > 2 ? 1 : 0.35;        // nothing to burn
        this.regulation = clamp(1 + TH.REG_GAIN * err, TH.REG_MIN, TH.REG_MAX) * fed;
        this.shiver = this.stage === STAGE.EGG ? 0 : clamp((this.regulation - TH.SHIVER_AT) / (TH.REG_MAX - TH.SHIVER_AT), 0, 1);
        if (this.ai === AI.DISTRESSED) this.shiver = Math.max(this.shiver, 0.6);
        const q = TH.METAB_HEAT * ph.metabolism * this.regulation * dt;
        for (let i = 0; i < p.n; i++) if (b.on[i] && p.tissue[i] === MEAT) b.temp[i] += q;

        // conduction along constraints
        const kc = Math.min(0.45, TH.CONDUCT * dt);
        const cap = TH.HEAT_CAP;
        for (let k = 0; k < b.nc; k++) {
            const i = b.ci[k], j = b.cj[k];
            const ci = cap[b.tissue[i]] * b.m[i], cj = cap[b.tissue[j]] * b.m[j];
            const flow = (b.temp[j] - b.temp[i]) * kc * Math.min(ci, cj);
            b.temp[i] += flow / ci; b.temp[j] -= flow / cj;
        }
        // blood
        const km = Math.min(0.45, TH.BLOOD_MIX * dt);
        const r2 = TH.BLOOD_REACH * TH.BLOOD_REACH;
        for (let a = 0; a < p.blood.length; a++) {
            const bi = p.blood[a];
            if (!b.on[bi]) continue;
            for (let i = 0; i < p.n; i++) {
                if (!b.on[i] || i === bi) continue;
                const dx = b.x[i] - b.x[bi], dy = b.y[i] - b.y[bi];
                if (dx * dx + dy * dy > r2) continue;
                const ci = cap[b.tissue[i]] * b.m[i], cb = cap[BLOOD] * b.m[bi];
                const flow = (b.temp[bi] - b.temp[i]) * km * Math.min(ci, cb) * 0.25;
                b.temp[i] += flow / ci; b.temp[bi] -= flow / cb;
            }
        }
    }

    // Effective compliance of every constraint: its base value, softened by
    // accumulated damage, by radiation sickness (meat only: a sick animal is
    // floppy), and by age (an elder's spine bends).
    _compliance() {
        const b = this.body;
        const sick = 1 + D.SICK_SOFTEN * this.sick;
        const elder = this.stage === STAGE.ELDER ? L.ELDER_BONE_SOFT : 1;
        // muscle tone follows the gait: tense while working, slack at rest
        const S = CFG.SOFT;
        // Small bodies are firmer. Compliance is an absolute quantity (cells
        // per unit force), so the same flesh on a hatchling with legs one
        // cell long sags it onto its belly; scaling compliance with
        // size^1.5 keeps the sag in proportion to the animal.
        const young = Math.pow(Math.min(1, this.scale), S.YOUNG_FIRM);
        const tone = (S.ALPHA_MUSCLE_RELAXED * young + (S.ALPHA_MUSCLE - S.ALPHA_MUSCLE_RELAXED * young) * smooth(this.gaitEnv * 1.5)) *
            Math.sqrt(this.phen.meatSoft);
        for (let k = 0; k < b.nc; k++) {
            const kind = b.cKind[k];
            let a = b.cBase[k] * (1 + INJ.DAMAGE_SOFTEN * b.cDamage[k]);
            if (kind === KIND.MEAT || kind === KIND.MEAT_BONE) a *= sick * young;
            else if (kind === KIND.BONE) a *= elder;
            else if (kind === KIND.MUSCLE) a = tone * sick;
            else a *= young;
            b.cAlpha[k] = a;
        }
        b.groups[0].alpha = CFG.SOFT.ALPHA_SHAPE_BONE * this.phen.boneSoft * elder;
        b.groups[1].alpha = CFG.SOFT.ALPHA_SHAPE_BODY * this.phen.meatSoft * sick;
    }

    // ---- per-tick: after the solver ---------------------------------------------
    afterStep(dt) {
        if (this.dead) return;
        this._injury(dt);
        this.measure();
        if (this.stage === STAGE.EGG) return;
        this._dose(dt);
        this._health(dt);
        if (!this.body.finite()) this.die('a physics accident');
    }

    // Injury. Every constraint knows its strain (how far from its rest length
    // it was last substep, as a fraction). Past STRAIN_WEAKEN it accumulates
    // damage, which makes it more compliant and costs health; past
    // STRAIN_BREAK it is gone. A broken SKIN edge is a wound: blood is no
    // longer held in across it. Damage heals and broken constraints knit,
    // faster on a full stomach.
    _injury(dt) {
        const b = this.body;
        const fed = 0.4 + (INJ.FED_BONUS - 0.4) * (this.stats.hunger / 100);
        const boost = this.healBoost > 0 ? ST.MEDICINE_BOOST_X : 1;
        const heal = INJ.HEAL_RATE * fed * boost * dt;
        let hurt = 0, wounds = 0;
        if (this.grace > 0) this.grace -= dt;
        const egg = this.stage === STAGE.EGG || this.grace > 0;
        const minRest = INJ.MIN_REST * this.scale;
        for (let k = 0; k < b.nc; k++) {
            const kind = b.cKind[k];
            if (!b.cOn[k]) {
                if (kind === KIND.SKIN) wounds++;
                b.cMend[k] -= dt * fed * boost;
                if (b.cMend[k] <= 0 && !this._burned(k)) { b.cOn[k] = 1; b.cDamage[k] = 0.6; b.cStrain[k] = 0; }
                continue;
            }
            // the skeleton and the muscles are exempt: a muscle is strained on
            // purpose every stride, and the bend links are only a helper
            if (egg || kind === KIND.BONE || kind === KIND.MUSCLE || kind === KIND.SKIN_BEND) continue;
            // A very short link reads an enormous strain for a displacement
            // that means nothing, so strain is taken against at least
            // MIN_REST cells of length.
            const rl = b.cRest[k];
            const s = rl < minRest ? b.cStrain[k] * rl / minRest : b.cStrain[k];
            const as = s < 0 ? -s : s;
            // only stretching tears: flesh squashed flat is bruised, not cut
            if (s > INJ.STRAIN_BREAK) {
                b.cOn[k] = 0; b.cMend[k] = INJ.MEND_TIME; hurt += 0.5;
            } else if (as > INJ.STRAIN_WEAKEN) {
                const ex = as - INJ.STRAIN_WEAKEN;
                b.cDamage[k] = Math.min(1, b.cDamage[k] + INJ.DAMAGE_RATE * ex * dt);
                hurt += ex;
            } else if (b.cDamage[k] > 0) b.cDamage[k] = Math.max(0, b.cDamage[k] - heal);
        }
        this.strainHurt = hurt;
        this.wounds = wounds;
    }

    // is this skin edge in a region too irradiated to heal?
    _burned(k) {
        const b = this.body;
        if (b.cKind[k] !== KIND.SKIN) return false;
        return b.dose[b.ci[k]] > D.LOCAL_BURN || b.dose[b.cj[k]] > D.LOCAL_BURN;
    }

    // Centre, velocity, temperature, dose, landmarks.
    measure() {
        const p = this.plan, b = this.body;
        let M = 0, cx = 0, cy = 0, vx = 0, vy = 0, hc = 0, tsum = 0, dsum = 0, blood = 0, bloodMax = 0;
        const cap = TH.HEAT_CAP;
        for (let i = 0; i < p.n; i++) {
            if (p.tissue[i] === BLOOD && p.birth[i] <= this.scale + 1e-6) { bloodMax++; if (b.on[i]) blood++; }
            if (!b.on[i]) continue;
            const m = b.m[i];
            M += m; cx += m * b.x[i]; cy += m * b.y[i]; vx += m * b.vx[i]; vy += m * b.vy[i];
            const c = m * cap[b.tissue[i]];
            hc += c; tsum += c * b.temp[i];
            dsum += m * b.dose[i];
        }
        if (M <= 0) return;
        this.totalMass = M;
        this.cx = cx / M; this.cy = cy / M; this.vx = vx / M; this.vy = vy / M;
        // body temperature is the (heat-capacity-)mass-weighted mean of the tissues
        this.bodyTemp = tsum / hc;
        this.doseTotal = dsum / M;
        this.bloodFrac = bloodMax ? blood / bloodMax : 1;
        this.bloodCount = blood; this.bloodMax = bloodMax;

        const right = this.face >= 0;
        const mi = p.ring[right ? p.mouthR : p.mouthL], ti = p.ring[right ? p.tailR : p.tailL];
        this.mouthX = b.x[mi]; this.mouthY = b.y[mi];
        this.tailX = b.x[ti]; this.tailY = b.y[ti];
    }

    _dose(dt) {
        // doseTick was filled by coupling with this tick's body-mean dose
        const rate = this.doseTick / dt;
        this.doseTick = 0;
        // Hits arrive one at a time, so the raw rate is a train of spikes.
        // It is averaged over a second or so first; the reading then follows
        // that average straight up, and recovers slowly on the way down.
        // The dose itself does not recover at all.
        this.rateNow += (rate - this.rateNow) * Math.min(1, dt / D.RATE_WINDOW);
        if (this.rateNow > this.doseRate) this.doseRate = this.rateNow;
        else this.doseRate += (this.rateNow - this.doseRate) * (dt / D.RATE_TAU);
        this.sick = clamp((this.doseTotal - D.MODERATE) / (D.HIGH - D.MODERATE), 0, 1);
        if (this.doseTotal > D.MODERATE && this.sick < 0.15) this.sick = 0.15;
        // High dose: skin in the worst-irradiated regions fails
        const b = this.body;
        for (let e = 0; e < b.ringN; e++) {
            const k2 = b.ringEdge[e];
            if (k2 >= 0 && b.cOn[k2] && this._burned(k2)) { b.cOn[k2] = 0; b.cMend[k2] = INJ.MEND_TIME; }
        }
    }

    _stats(dt) {
        const s = this.stats, ph = this.phen, sn = this.sense;
        // hunger is what the metabolism burns: more when cold, more when walking
        s.hunger -= (ST.HUNGER_RATE * ph.metabolism * (0.55 + 0.45 * this.regulation) + (this.walking ? ST.HUNGER_WALK : 0)) * dt *
            (this.sleeping ? 0.5 : 1);
        s.happiness -= ST.HAPPY_RATE * dt * (this.sleeping ? 0.3 : 1);
        if (this.sleeping) s.energy += ST.ENERGY_SLEEP * dt;
        else s.energy -= (ST.ENERGY_RATE + (this.walking ? ST.ENERGY_WALK : 0)) * dt;
        let specks = 0;
        for (let i = 0; i < this.speck.length; i++) if (this.speck[i]) specks++;
        this.specks = specks;
        const clean = clamp(100 - ST.HYGIENE_PER_WASTE * sn.wasteCount - ST.HYGIENE_PER_SPECK * specks, 0, 100);
        s.hygiene += (clean - s.hygiene) * Math.min(1, ST.HYGIENE_LERP * dt);
        s.hunger = clamp(s.hunger, 0, 100);
        s.happiness = clamp(s.happiness, 0, 100);
        s.energy = clamp(s.energy, 0, 100);

        this.eggCooldown -= dt;
        this.medicineCooldown = Math.max(0, this.medicineCooldown - dt);
        this.healBoost = Math.max(0, this.healBoost - dt);
        this.eating += dt;
        if (this.blink > 0) this.blink -= dt; else if (Math.random() < dt * 0.25) this.blink = 0.14;

        // waste: on a timer that runs faster the more has gone in
        if (this.gut >= 1) {
            this.wasteTimer -= dt * (1 + this.gut * 0.15);
            if (this.wasteTimer <= 0) {
                const n = Math.min(6, Math.floor(this.gut));
                this.gut -= n; this.pendingWaste += n;
                this.wasteTimer = L.WASTE_INTERVAL;
            }
        }
        // blood comes back slowly, and only out of food
        if (this.bloodCount < this.bloodMax && s.hunger > INJ.BLOOD_REGEN_HUNGER) {
            this.bloodTimer += dt * (this.healBoost > 0 ? 2 : 1);
            if (this.bloodTimer >= INJ.BLOOD_REGEN) { this.bloodTimer = 0; this._regenBlood(); }
        }
    }

    // a blood particle appears beside the spine
    _bloodAt(i) {
        const b = this.body, g0 = b.groups[0];
        b.x[i] = b.px[i] = g0.cx + (Math.random() - 0.5) * this.scale * 2;
        b.y[i] = b.py[i] = g0.cy + (Math.random() - 0.5) * this.scale * 2;
        b.vx[i] = this.vx; b.vy[i] = this.vy;
        b.temp[i] = this.bodyTemp; b.dose[i] = this.doseTotal; b.fluidOut[i] = 0;
        b.on[i] = 1;
        this.bled[i] = 0;
    }

    _regenBlood() {
        const p = this.plan, b = this.body;
        for (const i of p.blood) {
            if (b.on[i] || p.birth[i] > this.scale + 1e-6) continue;
            this._bloodAt(i);
            this.stats.hunger = Math.max(0, this.stats.hunger - INJ.BLOOD_COST);
            return;
        }
    }

    // Health is not a meter that drains by itself: it is the sum of what is
    // currently wrong, against a slow recovery when nothing is.
    _health(dt) {
        const s = this.stats, ph = this.phen;
        let d = 0;
        if (s.hunger <= 4) d -= ST.HEALTH_STARVE;
        if (this.bloodFrac < 0.75) d -= ST.HEALTH_BLOOD * (0.75 - this.bloodFrac);
        d -= ST.HEALTH_WOUND * this.wounds;
        d -= ST.HEALTH_STRAIN * Math.min(4, this.strainHurt);
        const over = (this.bodyTemp - (ph.comfort + ph.comfortW)) / ph.comfortW;
        if (over > 0) d -= ST.HEALTH_HOT * Math.min(8, over);
        const under = ((ph.comfort - ph.comfortW * 2) - this.bodyTemp) / ph.comfortW;
        if (under > 0) d -= ST.HEALTH_COLD * Math.min(4, under);
        if (this.doseTotal > D.HIGH) d -= D.HEALTH_HIGH;
        else if (this.doseTotal > D.MODERATE) d -= D.HEALTH_MODERATE;
        else if (this.doseTotal > D.LOW) d -= D.HEALTH_LOW;
        if (s.hygiene < 15) d -= ST.HEALTH_DIRTY;
        if (s.happiness < 5) d -= ST.HEALTH_SAD;
        if (s.energy < 3) d -= ST.HEALTH_TIRED;
        this.healthTrend = d;
        if (d === 0 && s.hunger > 35) d = ST.HEALTH_REGEN;
        s.health = clamp(s.health + d * dt, 0, 100);
        if (s.health <= 0) {
            let why = 'neglect';
            if (this.doseTotal > D.MODERATE) why = 'radiation sickness';
            else if (this.bloodFrac < 0.6) why = 'blood loss';
            else if (over > 0) why = 'overheating';
            else if (s.hunger <= 4) why = 'starvation';
            else if (this.strainHurt > 0.5) why = 'crush injuries';
            this.die(why);
        }
    }

    // ---- things done to it ---------------------------------------------------------
    // One food cell went down. Returns false if it would not eat.
    feed() {
        const s = this.stats;
        // Radiation sickness: hunger stops recovering. The food is still
        // swallowed, which is the point -- it just does no good.
        if (this.sick <= 0) s.hunger = Math.min(100, s.hunger + L.FOOD_HUNGER);
        s.happiness = Math.min(100, s.happiness + ST.HAPPY_EAT);
        this.budget += L.FOOD_MASS;
        this.gut += L.WASTE_PER_FOOD;
        this.eating = 0;
        return true;
    }

    medicine() {
        if (this.medicineCooldown > 0 || this.dead || this.stage === STAGE.EGG) return false;
        this.stats.health = Math.min(100, this.stats.health + ST.MEDICINE_HEAL);
        this.healBoost = ST.MEDICINE_BOOST;
        this.medicineCooldown = ST.MEDICINE_COOLDOWN;
        for (let m = 0; m < MAT_COUNT; m++) this.internal[m] *= 1 - ST.MEDICINE_FLUSH;
        return true;
    }

    // Laying costs mass, and mass is size: the mother is visibly smaller
    // afterwards.
    laid() {
        this.mass = Math.max(0.5, this.mass - L.EGG_MASS);
        this.eggCooldown = L.EGG_COOLDOWN;
        this.wantsToLay = false;
        this.hasEgg = true;
        this.stats.hunger = Math.max(0, this.stats.hunger - 12);
    }

    hatch() {
        this.stage = STAGE.BABY;
        this.mass = L.SCALE_HATCH * L.SCALE_HATCH;
        this.body.womb = null;
        this.age = 0;
        this.grace = L.HATCH_GRACE;
    }

    die(cause) {
        if (this.dead) return;
        this.dead = true;
        this.cause = cause;
        this.stage = STAGE.DEAD;
        // all constraints are removed: what is left is loose tissue, and
        // coupling.js hands it to the sand
        this.body.cOn.fill(0);
        this.body.grabI = -1;
    }

    // Body-mean dose from one deposit of `amount` into particle i.
    addDose(i, amount) {
        const b = this.body;
        b.dose[i] += amount / b.m[i];
        this.doseTick += amount / (this.totalMass || 100);
    }

    // world position of a point given in unit rest coordinates, through the
    // skeleton's rigid frame: this is what "anchored to the bone" means
    anchor(ux, uy, out) {
        const g0 = this.body.groups[0];
        const c = Math.cos(g0.angle), s = Math.sin(g0.angle);
        const qx = ux * this.scale - (g0.qx0 || 0), qy = uy * this.scale - (g0.qy0 || 0);
        out.x = g0.cx + c * qx - s * qy;
        out.y = g0.cy + s * qx + c * qy;
        return out;
    }

    // ---- rendering -----------------------------------------------------------------
    // Drawn into the same pixel buffer as the sand, one colour per BODY cell.
    // For each cell the nearest particle says where in the REST shape that
    // cell is, and the skin pattern is evaluated there -- so spots and
    // stripes are painted on the animal, and stretch and squash with it.
    render(buf, cells, count, W, H, mat) {
        const p = this.plan, b = this.body, pal = p.palette;
        const n = p.n;
        const g0 = b.groups[0];
        const c = Math.cos(g0.angle), s = Math.sin(g0.angle);
        const invG = 1 / this.scale;
        const pat = p.pattern;
        const nSpots = Math.min(16, pat.spots.length);
        const dim = this.sleeping ? 0.72 : 1;
        const pulse = 0.75 + 0.25 * Math.sin(this.breath * 3);
        const sickTint = this.sick;
        const BODYM = MAT.BODY;

        for (let k = 0; k < count; k++) {
            const i = cells[k];
            const X = (i % W) + 0.5, Y = ((i / W) | 0) + 0.5;
            let best = 1e9, bi = -1, bloodD = 1e9;
            for (let j = 0; j < n; j++) {
                if (!b.on[j]) continue;
                const dx = b.x[j] - X, dy = b.y[j] - Y;
                const d2 = dx * dx + dy * dy;
                if (b.tissue[j] === BLOOD) { if (d2 < bloodD) bloodD = d2; }
                else if (d2 < best) { best = d2; bi = j; }
            }
            if (bi < 0) continue;
            const dx = X - b.x[bi], dy = Y - b.y[bi];
            const ux = this.ux[bi] + (c * dx + s * dy) * invG;
            const uy = this.uy[bi] + (-s * dx + c * dy) * invG;

            let on = 0;
            if (pat.type === 1) {
                for (let q = 0; q < nSpots; q++) {
                    const sx = ux - this.spotX[q], sy = uy - this.spotY[q];
                    if (sx * sx + sy * sy < pat.spots[q].r * pat.spots[q].r) { on = 1; break; }
                }
            } else if (pat.type === 2) {
                on = Math.sin((ux + uy * pat.slant) * 6.283185307 / pat.period) > 0.2 ? 1 : 0;
            }
            let r, g, bl;
            if (on) { r = pal.secondary[0]; g = pal.secondary[1]; bl = pal.secondary[2]; }
            else { r = pal.primary[0]; g = pal.primary[1]; bl = pal.primary[2]; }
            // a pale belly and a little light on the back
            const v = uy / p.b;
            if (v > 0.3) {
                const t = Math.min(0.75, (v - 0.3) * 1.1);
                r += (pal.belly[0] - r) * t; g += (pal.belly[1] - g) * t; bl += (pal.belly[2] - bl) * t;
            } else if (v < -0.55) { r = Math.min(255, r * 1.08); g = Math.min(255, g * 1.08); bl = Math.min(255, bl * 1.08); }
            // outline: a body cell with open space beside it
            if (mat[i - 1] !== BODYM || mat[i + 1] !== BODYM || mat[i - W] !== BODYM || mat[i + W] !== BODYM) {
                r = pal.outline[0]; g = pal.outline[1]; bl = pal.outline[2];
            } else if (bloodD < 2.4) {
                // blood shows through where it has pooled: the skin there is
                // a shade darker and a little flushed
                const t = 1 - bloodD / 2.4;
                r = r * (1 - 0.1 * t) + 14 * t; g *= 1 - 0.13 * t; bl *= 1 - 0.11 * t;
            }
            // a low dose is already visible: the worst-hit tissue glows
            const dose = b.dose[bi];
            if (dose > D.LOCAL_GLOW) {
                const t = Math.min(1, (dose - D.LOCAL_GLOW) / (D.LOCAL_BURN - D.LOCAL_GLOW)) * pulse;
                r += 30 * t; g += 120 * t; bl += 40 * t;
            }
            if (sickTint > 0) {
                const t = sickTint * 0.3;
                r += (150 - r) * t; g += (168 - g) * t; bl += (118 - bl) * t;
            }
            buf[i] = rgba(Math.min(255, r * dim), Math.min(255, g * dim), Math.min(255, bl * dim));
        }

        // wounds: broken skin edges
        for (let e = 0; e < b.ringN; e++) {
            const kc = b.ringEdge[e];
            if (kc < 0 || b.cOn[kc]) continue;
            const i0 = b.ring[e], i1 = b.ring[(e + 1) % b.ringN];
            for (let t = 0; t <= 1; t += 0.5) {
                const X = (b.x[i0] + (b.x[i1] - b.x[i0]) * t) | 0, Y = (b.y[i0] + (b.y[i1] - b.y[i0]) * t) | 0;
                if (X >= 0 && Y >= 0 && X < W && Y < H) buf[Y * W + X] = rgba(190, 14, 28);
            }
        }
        // contamination: specks of whatever is stuck to the skin
        for (let i = 0; i < n; i++) {
            const m = this.speck[i];
            if (!m || !b.on[i]) continue;
            const X = b.x[i] | 0, Y = b.y[i] | 0;
            if (X >= 0 && Y >= 0 && X < W && Y < H) buf[Y * W + X] = rgba(M_BASE_RGB[m * 3], M_BASE_RGB[m * 3 + 1], M_BASE_RGB[m * 3 + 2]);
        }
        this._renderFace(buf, W, H, mat, dim);
    }

    // Eyes and mouth. The eyes ride on the skeleton: their position is a
    // point in the rest shape carried through the bone frame, and it slides
    // from one end of the spine to the other as the animal turns. The pupils
    // look at whatever the animal is interested in.
    _renderFace(buf, W, H, mat, dim) {
        const p = this.plan, f = p.face, g = this.scale;
        const wR = faceWeight(this.face);
        const side = wR * 2 - 1;
        const out = this._pt || (this._pt = { x: 0, y: 0 });
        // the young have big eyes: they shrink less than the body does
        const er = Math.max(1.15, f.eyeR * (0.5 + 0.5 * g) * (this.stage === STAGE.BABY ? 1.15 : 1));
        const gap = f.eyeGap * (0.55 + 0.45 * g);
        const hx = f.hx * side, hy = f.hy;
        const closed = this.sleeping || this.blink > 0;
        const sad = this.ai === AI.DISTRESSED || this.stats.health < 30;
        let lx = this.lookX - this.cx, ly = this.lookY - this.cy;
        const ll = Math.hypot(lx, ly) || 1;
        lx /= ll; ly /= ll;
        const white = rgba(250 * dim, 250 * dim, 245 * dim), dark = rgba(20, 18, 28);
        for (let e = -1; e <= 1; e += 2) {
            this.anchor(hx + (e * gap * 0.5) / g + side * 0.4, hy, out);
            // The skeleton says where the eye belongs; the skin has the last
            // word. Flesh sags on its bones, so an eye that would sit on the
            // outline is drawn in toward the middle until it is on the face.
            let ex = out.x, ey = out.y;
            for (let k = 0; k < 6; k++) {
                const ox = ex - this.cx, oy = ey - this.cy;
                const ol = Math.hypot(ox, oy) || 1;
                if (this.body.contains(ex + ox / ol * (er + 0.9), ey + oy / ol * (er + 0.9))) break;
                ex -= ox / ol * 0.5; ey -= oy / ol * 0.5;
            }
            const r = er, r2 = r * r + 0.2;
            const x0 = Math.floor(ex - r), x1 = Math.ceil(ex + r), y0 = Math.floor(ey - r), y1 = Math.ceil(ey + r);
            for (let Y = y0; Y <= y1; Y++) {
                if (Y < 0 || Y >= H) continue;
                for (let X = x0; X <= x1; X++) {
                    if (X < 0 || X >= W) continue;
                    const dx = X + 0.5 - ex, dy = Y + 0.5 - ey;
                    if (dx * dx + dy * dy > r2) continue;
                    const i = Y * W + X;
                    if (mat[i] !== MAT.BODY) continue;
                    if (closed) { if (Math.abs(dy) < 0.6) buf[i] = dark; }
                    else buf[i] = white;
                }
            }
            if (!closed) {
                const pr = sad ? 0.3 : 0.45;
                const pxw = ex + lx * r * pr, pyw = ey + ly * r * pr;
                const rp = Math.max(0.55, r * (sad ? 0.36 : 0.5)), rp2 = rp * rp;
                for (let Y = Math.floor(pyw - rp); Y <= Math.ceil(pyw + rp); Y++) {
                    if (Y < 0 || Y >= H) continue;
                    for (let X = Math.floor(pxw - rp); X <= Math.ceil(pxw + rp); X++) {
                        if (X < 0 || X >= W) continue;
                        const dx = X + 0.5 - pxw, dy = Y + 0.5 - pyw;
                        if (dx * dx + dy * dy > rp2 + 0.1) continue;
                        const i = Y * W + X;
                        if (mat[i] === MAT.BODY) buf[i] = dark;
                    }
                }
            }
        }
        // mouth: two or three dark pixels a little inside the skin, at the
        // front and low; open while eating
        const turn = Math.abs(side);
        this.anchor(hx, hy + (er + 1.3) / g, out);
        const mcx = out.x, mcy = out.y;
        let mx = this.mouthX + (this.cx - this.mouthX) * 0.14, my = this.mouthY + (this.cy - this.mouthY) * 0.14 - 0.4 * g;
        mx = mcx + (mx - mcx) * turn; my = mcy + (my - mcy) * turn;
        const open = this.eating < 0.35;
        const w = open ? 1 : Math.max(1, Math.round(1.4 * g));
        for (let dx = -w; dx <= w; dx++) {
            for (let dy = 0; dy <= (open ? 1 : 0); dy++) {
                const curve = open ? 0 : (sad ? (Math.abs(dx) === w ? 1 : 0) : (Math.abs(dx) === w ? -1 : 0));
                const X = Math.round(mx + dx), Y = Math.round(my + dy + (w > 1 ? curve : 0));
                if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
                const i = Y * W + X;
                if (mat[i] === MAT.BODY) buf[i] = open ? rgba(120, 24, 40) : dark;
            }
        }
    }

    // The embryo, seen through the shell.
    renderEmbryo(buf, W, H) {
        const b = this.body, pal = this.plan.palette;
        const bb = b.bounds(this._bb || (this._bb = {}));
        for (let Y = Math.floor(bb.y0); Y <= Math.ceil(bb.y1); Y++) {
            if (Y < 0 || Y >= H) continue;
            for (let X = Math.floor(bb.x0); X <= Math.ceil(bb.x1); X++) {
                if (X < 0 || X >= W || !b.contains(X + 0.5, Y + 0.5)) continue;
                const i = Y * W + X;
                const c = buf[i];
                const r = c & 255, g = (c >> 8) & 255, bl = (c >> 16) & 255;
                buf[i] = rgba(r + (pal.outline[0] - r) * 0.5, g + (pal.outline[1] - g) * 0.5, bl + (pal.outline[2] - bl) * 0.5);
            }
        }
    }

    // ---- persistence ---------------------------------------------------------------
    serialize() {
        const b = this.body, n = this.plan.n;
        const r3 = (v) => Math.round(v * 1000) / 1000;
        const arr = (a, len, f) => Array.from(a.subarray(0, len), f);
        return {
            genome: encode(this.genome), generation: this.generation,
            stage: this.stage, age: r3(this.age), scale: this.scale, mass: this.mass, budget: this.budget,
            face: this.face, gaitPhase: r3(this.gaitPhase),
            stats: { ...this.stats }, bodyTemp: r3(this.bodyTemp),
            doseRate: this.doseRate, ai: this.ai, sleeping: this.sleeping,
            gut: this.gut, wasteTimer: this.wasteTimer, eggCooldown: this.eggCooldown,
            medicineCooldown: this.medicineCooldown, healBoost: this.healBoost, hasEgg: this.hasEgg,
            mate: this.mate ? encode(this.mate) : null,
            internal: Array.from(this.internal, r3), speck: Array.from(this.speck), bled: Array.from(this.bled),
            womb: b.womb,
            p: {
                x: arr(b.x, n, r3), y: arr(b.y, n, r3), vx: arr(b.vx, n, r3), vy: arr(b.vy, n, r3),
                t: arr(b.temp, n, r3), d: arr(b.dose, n, r3), on: arr(b.on, n),
            },
            c: { n: b.nc, on: arr(b.cOn, b.nc), dmg: arr(b.cDamage, b.nc, r3), mend: arr(b.cMend, b.nc, r3) },
        };
    }

    static deserialize(d) {
        const genome = decode(d.genome);
        if (!genome) return null;
        const c = new Creature(genome, d.generation);
        const b = c.body, n = c.plan.n;
        if (!d.p || d.p.x.length !== n) return null;
        Object.assign(c, {
            stage: d.stage, age: d.age, scale: d.scale, mass: d.mass, budget: d.budget, face: d.face,
            gaitPhase: d.gaitPhase, bodyTemp: d.bodyTemp, doseRate: d.doseRate, ai: d.ai, sleeping: d.sleeping,
            gut: d.gut, wasteTimer: d.wasteTimer, eggCooldown: d.eggCooldown,
            medicineCooldown: d.medicineCooldown, healBoost: d.healBoost, hasEgg: d.hasEgg,
        });
        Object.assign(c.stats, d.stats);
        c.mate = d.mate ? decode(d.mate) : null;
        c.internal.set(d.internal.slice(0, MAT_COUNT));
        c.speck.set(d.speck.slice(0, n));
        if (d.bled) c.bled.set(d.bled.slice(0, n));
        c.refreshRest();
        for (let i = 0; i < n; i++) {
            b.x[i] = b.px[i] = d.p.x[i]; b.y[i] = b.py[i] = d.p.y[i];
            b.vx[i] = d.p.vx[i]; b.vy[i] = d.p.vy[i];
            b.temp[i] = d.p.t[i]; b.dose[i] = d.p.d[i]; b.on[i] = d.p.on[i];
        }
        b.womb = d.womb || null;
        // The constraint set is a pure function of which particles exist, so
        // it is rebuilt rather than stored; only its state is restored.
        c.rebuildConstraints();
        c.refreshRest();
        if (d.c && d.c.n === b.nc) {
            for (let k = 0; k < b.nc; k++) { b.cOn[k] = d.c.on[k]; b.cDamage[k] = d.c.dmg[k]; b.cMend[k] = d.c.mend[k]; }
        }
        c.measure();
        c.lastX = c.cx;
        return c;
    }
}

// ================================================================== the egg
// An oval of SHELL cells in the grid (stamped by coupling.js) with this
// object keeping time. It wobbles by tilting, which re-stamps the oval at an
// angle. Dormant while its parent lives; incubating after.
export class Egg {
    constructor(genome, generation, x, y, parentDose = 0) {
        this.genome = genome;
        this.generation = generation;
        this.x = x; this.y = y;
        this.rx = CFG.EGG.RX; this.ry = CFG.EGG.RY;
        this.tilt = 0;
        this.incubating = false;
        this.progress = 0;
        this.wobbleT = 0;
        this.wobbleClock = CFG.EGG.WOBBLE_EVERY;
        this.parentDose = parentDose;
        this.cells = new Int32Array(900);
        this.nCells = 0;
        this.stampKey = '';
        const ph = express(genome);
        this.hue = ph.hue;
        this.tint = hueRgb(ph.hue);
        this.seed = (genome[0] * 977 + genome[10] * 131) % 1;
    }

    // returns true on the tick it should hatch
    update(dt) {
        const E = CFG.EGG;
        if (this.incubating) this.progress += dt / E.INCUBATE;
        this.wobbleClock -= dt * (this.incubating ? 1 + 2.5 * this.progress : 0.3);
        if (this.wobbleClock <= 0) { this.wobbleT = E.WOBBLE_TIME; this.wobbleClock = E.WOBBLE_EVERY; }
        if (this.wobbleT > 0) {
            this.wobbleT -= dt;
            const u = 1 - Math.max(0, this.wobbleT) / E.WOBBLE_TIME;
            this.tilt = E.WOBBLE_TILT * Math.sin(u * 12.566) * (1 - u) * (this.incubating ? 0.6 + this.progress : 0.5);
        } else this.tilt = 0;
        return this.incubating && this.progress >= 1;
    }

    tap() {
        if (this.incubating) this.progress += CFG.EGG.TAP_BONUS;
        this.wobbleT = CFG.EGG.WOBBLE_TIME;
    }

    // is this cell centre inside the (tilted, slightly pointed) oval?
    inside(X, Y, grow = 0) {
        const c = Math.cos(-this.tilt), s = Math.sin(-this.tilt);
        const dx = X - this.x, dy = Y - (this.y + this.ry * 0.15);
        // pivot the wobble about the base so it rocks rather than spins
        const px = dx, py = dy - this.ry * 0.85;
        const lx = c * px - s * py, ly = s * px + c * py + this.ry * 0.85;
        const v = ly / (this.ry + grow);
        const rx = (this.rx + grow) * (1 + 0.16 * v);
        const u = lx / rx;
        return u * u + v * v <= 1;
    }

    local(X, Y, out) {
        const c = Math.cos(-this.tilt), s = Math.sin(-this.tilt);
        const px = X - this.x, py = Y - (this.y + this.ry * 0.15) - this.ry * 0.85;
        const lx = c * px - s * py, ly = s * px + c * py + this.ry * 0.85;
        out.v = ly / this.ry;
        out.u = lx / (this.rx * (1 + 0.16 * out.v));
        return out;
    }

    render(buf, W, H) {
        const E = CFG.EGG;
        const o = this._o || (this._o = { u: 0, v: 0 });
        const crack = this.incubating ? clamp((this.progress - E.CRACK_AT) / (1 - E.CRACK_AT), 0, 1) : 0;
        const dormant = !this.incubating;
        const pulse = this.incubating ? 0.5 + 0.5 * Math.sin(this.progress * 60) : 0;
        for (let k = 0; k < this.nCells; k++) {
            const i = this.cells[k];
            const X = (i % W) + 0.5, Y = ((i / W) | 0) + 0.5;
            this.local(X, Y, o);
            const c = buf[i];
            let r = c & 255, g = (c >> 8) & 255, b = (c >> 16) & 255;
            // shading: lit from the upper left
            const shade = 1 - 0.2 * clamp(o.u * 0.6 + o.v * 0.8, -1, 1);
            r *= shade; g *= shade; b *= shade;
            // a blush of the colour the hatchling will be
            const t = 0.16 + 0.1 * pulse;
            r += (this.tint[0] - r) * t; g += (this.tint[1] - g) * t; b += (this.tint[2] - b) * t;
            // speckles
            const h = Math.sin(o.u * 37.1 + this.seed * 50) * Math.cos(o.v * 29.3 + this.seed * 20);
            if (h > 0.82) { r *= 0.8; g *= 0.8; b *= 0.8; }
            if (dormant) { r *= 0.86; g *= 0.88; b *= 0.94; }
            // the crack: a zigzag across the waist that lengthens as it comes due
            if (crack > 0 && Math.abs(o.u) < crack * 1.05) {
                const z = 0.16 * Math.asin(Math.sin(o.u * 9 + this.seed * 6)) / 1.57 - 0.08;
                if (Math.abs(o.v - z) < 0.085) { r = 34; g = 28; b = 30; }
            }
            buf[i] = rgba(clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255));
        }
    }

    serialize() {
        return {
            genome: encode(this.genome), generation: this.generation, x: this.x, y: this.y,
            incubating: this.incubating, progress: this.progress, parentDose: this.parentDose,
        };
    }

    static deserialize(d) {
        const g = decode(d.genome);
        if (!g) return null;
        const e = new Egg(g, d.generation, d.x, d.y, d.parentDose || 0);
        e.incubating = !!d.incubating; e.progress = d.progress || 0;
        return e;
    }
}

function hueRgb(h) {
    const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (0.62 - 0.3 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return [f(0), f(8), f(4)];
}

// ================================================================= the ball
// The same solver, a different body: a ring of skin, a hub, and an area
// constraint held a little over its rest area, so it is pressurised and
// bounces.
export class Ball {
    constructor(x, y) {
        const C = CFG.BALL;
        const b = this.body = new SoftBody(C.POINTS + 2, C.POINTS * 3 + 4, C.POINTS + 2);
        this.hub = b.addParticle(x, y, C.MASS * 2, MEAT);
        for (let k = 0; k < C.POINTS; k++) {
            const a = (k / C.POINTS) * 6.283185307;
            const i = b.addParticle(x + Math.cos(a) * C.RADIUS, y + Math.sin(a) * C.RADIUS, C.MASS, SKIN);
            b.ring[k] = i;
            b.fric[i] = C.FRICTION;
        }
        b.ringN = C.POINTS;
        for (let k = 0; k < C.POINTS; k++) {
            const i = b.ring[k], j = b.ring[(k + 1) % C.POINTS];
            b.ringEdge[k] = b.addConstraint(i, j, KIND.SKIN, C.ALPHA_EDGE, Math.hypot(b.x[i] - b.x[j], b.y[i] - b.y[j]));
            b.addConstraint(i, this.hub, KIND.SPOKE, C.ALPHA_SPOKE, C.RADIUS);
        }
        b.areaRest = b.ringArea() * C.PRESSURE;
        b.areaAlpha = C.ALPHA_AREA;
        b.damping = C.DAMPING;
        b.fric[this.hub] = C.FRICTION;
        b.cx = x; b.cy = y;
        this.life = C.LIFE;
        this.touching = false;
    }

    get x() { return this.body.x[this.hub]; }
    get y() { return this.body.y[this.hub]; }

    update(dt) {
        this.life -= dt;
        this.body.cx = this.x; this.body.cy = this.y;
        return this.life > 0 && this.body.finite();
    }

    render(buf, cells, count, W, mat) {
        const C = CFG.BALL.COLOR;
        const hx = this.x, hy = this.y;
        for (let k = 0; k < count; k++) {
            const i = cells[k];
            const X = (i % W) + 0.5, Y = ((i / W) | 0) + 0.5;
            const edge = mat[i - 1] !== MAT.BODY || mat[i + 1] !== MAT.BODY || mat[i - W] !== MAT.BODY || mat[i + W] !== MAT.BODY;
            const hi = (X - hx) < -0.3 && (Y - hy) < -0.3;
            const f = edge ? 0.55 : hi ? 1.25 : 1;
            buf[i] = rgba(Math.min(255, C[0] * f), Math.min(255, C[1] * f), Math.min(255, C[2] * f));
        }
    }
}
