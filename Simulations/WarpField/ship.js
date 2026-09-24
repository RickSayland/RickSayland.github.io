// ============ WARP FIELD ENGINEERING — THE TEST ARTICLE ============
// The ship, its helm, and the rules it flies by. Zero DOM.
//
// Kinematics are piecewise closed-form rather than stepped: within any
// interval the bubble speed is either held, or ramping exponentially (a field
// drive: so many e-folds of speed per second), or ramping linearly (a shell,
// which is a mass and has to be pushed). advance(dt) walks from event to
// event — reach cruise, reach the braking point, stop — and moves the ship
// the exact distance each piece covers. That is what lets ×100000 time
// compression stop a 10⁴ c leg within metres of its mark.
//
// Three rules are load-bearing, because they are the physics rather than a
// game design:
//
// - **Past c the helm is locked.** Once the bubble outruns light, the front
//   wall lies beyond a horizon: nothing aboard can signal it, so nothing
//   aboard can steer, throttle or stop it. A superluminal leg therefore has
//   to be a committed flight plan — heading, distance and braking point
//   fixed before the bubble crosses c (Krasnikov 1998; Everett & Roman 1997).
//   The interlock enforces that; it can be switched off, and the panel then
//   says in red that what follows is not physics.
// - **A field drive's crew feel nothing.** The cabin is in free fall for any
//   v(t) the metric is given, and its clocks keep coordinate time. A shell
//   is ordinary matter and must be pushed: its crew feel the thrust, and its
//   clocks run slow twice over — once for speed, once for the shell's
//   potential well.
// - **Speed is measured against the local frame.** The ship keeps station in
//   the innermost sphere of influence it is inside — the Moon's, a planet's,
//   or the Sun's — and "stopped" means stopped relative to that body.
//   Measured against the Sun, a ship parked beside Earth is left behind at
//   30 km/s, and a slow approach to the Moon ended 150,000 km short with the
//   ship fully braked, watching it recede.
// - **Superluminal walls sweep up the interstellar medium** and release it
//   ahead of the ship on arrival (McMonigal, Lewis & O'Byrne 2012). The
//   count is kept; the energy of the burst grows with the length of the
//   trip and is not something a closed form here would be honest about.

const FIELD_RATE = 1.5;          // e-folds of bubble speed per second
const BETA_FLOOR = 1e-6;         // slowest non-zero speed: 300 m/s
const SLEW_RATE = 35 * Math.PI / 180;   // attitude, radians per real second
const C_GATE = 0.999;

function v3len(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
function v3norm(a) { const l = v3len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function v3cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function v3rot(v, k, ang) {
    // Rodrigues: rotate v about unit axis k by ang.
    const c = Math.cos(ang), s = Math.sin(ang), d = v3dot(k, v) * (1 - c);
    const x = v3cross(k, v);
    return [v[0] * c + x[0] * s + k[0] * d, v[1] * c + x[1] * s + k[1] * d, v[2] * c + x[2] * s + k[2] * d];
}

const ship = {
    t: 0,
    tau: 0,
    pos: [0, 0, 0],           // absolute, recomputed from anchor + rel
    anchor: 'sun',
    rel: [0, 0, 0],
    fwd: [1, 0, 0], up: [0, 0, 1], right: [0, -1, 0],
    beta: 0,
    cruise: 3,
    fieldOn: false,
    mode: 'auto',
    target: 'mars',
    engaged: false,
    legActive: false,
    braking: false,
    plan: null,
    interlock: true,
    thrustG: 1,
    swept: 0,
    kinetic: 0,               // propulsion energy delivered to a shell, J
    odometer: 0,
    events: [],
    // vh is the bubble speed at which the flow of space along the axis first
    // reaches light speed: 1 for Alcubierre and Natário, far lower for an
    // irrotational wall, whose flow speeds up inside the wall itself.
    drive: { kind: 'shift', R: 100, M: 0, clockRate: 1, vh: 1 },

    init(t0) {
        this.t = t0;
        this.tau = 0;
        // Park 60,000 km out from Earth, square to the Sun line, looking
        // back at a half-lit planet.
        const e = space.bodyPos('earth', t0);
        const sunward = v3norm([-e[0], -e[1], -e[2]]);
        const side = v3norm(v3cross(sunward, [0, 0, 1]));
        const d = 6.0e7;
        this.pos = [e[0] + side[0] * d, e[1] + side[1] * d, e[2] + side[2] * d + 1.2e7];
        this.anchor = 'sun';
        this.rel = this.pos.slice();
        this.setAnchor(space.frameAt(this.pos, t0));
        this.pointAt(e);
        this.beta = 0;
        this.engaged = false;
        this.plan = null;
        this.swept = 0;
        this.kinetic = 0;
        this.odometer = 0;
    },

    syncPos() {
        const a = space.bodyPos(this.anchor, this.t);
        this.pos[0] = a[0] + this.rel[0]; this.pos[1] = a[1] + this.rel[1]; this.pos[2] = a[2] + this.rel[2];
    },

    setAnchor(id) {
        this.syncPos();
        const a = space.bodyPos(id, this.t);
        this.rel = [this.pos[0] - a[0], this.pos[1] - a[1], this.pos[2] - a[2]];
        this.anchor = id;
    },

    log(text, level) { this.events.push({ t: this.t, text, level: level || 'info' }); },

    setDrive(info) {
        this.drive = info;
        if (info.kind === 'shell' && this.beta > 0.99) this.beta = 0.99;
    },

    isShell() { return this.drive.kind === 'shell'; },

    // Horizons exist, and the front wall is out of reach, once the flow of
    // space along the axis of motion outruns light somewhere between the
    // cabin and the bow.
    vh() { return this.drive.vh || 1; },
    horizon() { return !this.isShell() && this.beta >= this.vh(); },
    helmLocked() { return this.interlock && this.horizon(); },

    // ---- Attitude ----

    pointAt(p) {
        const f = v3norm([p[0] - this.pos[0], p[1] - this.pos[1], p[2] - this.pos[2]]);
        let r = v3cross(f, [0, 0, 1]);
        if (v3len(r) < 1e-6) r = [0, -1, 0];
        r = v3norm(r);
        this.fwd = f; this.right = r; this.up = v3cross(r, f);
    },

    rotate(axis, ang) {
        this.fwd = v3norm(v3rot(this.fwd, axis, ang));
        this.up = v3norm(v3rot(this.up, axis, ang));
        this.right = v3norm(v3cross(this.fwd, this.up));
        this.up = v3cross(this.right, this.fwd);
    },

    // Manual stick input, rates in rad/s of real time.
    steer(yaw, pitch, roll, dtReal) {
        if (this.helmLocked() || this.mode !== 'manual') return false;
        if (yaw) this.rotate(this.up, -yaw * dtReal);
        if (pitch) this.rotate(this.right, pitch * dtReal);
        if (roll) this.rotate(this.fwd, roll * dtReal);
        return true;
    },

    // Autopilot: swing toward a direction at the slew rate. Returns the angle
    // still to go.
    slewToward(dir, dtReal) {
        const d = v3norm(dir);
        const c = Math.max(-1, Math.min(1, v3dot(this.fwd, d)));
        const ang = Math.acos(c);
        if (ang < 1e-7) return 0;
        let axis = v3cross(this.fwd, d);
        if (v3len(axis) < 1e-9) axis = this.up;
        axis = v3norm(axis);
        const step = Math.min(ang, SLEW_RATE * dtReal);
        this.rotate(axis, step);
        return ang - step;
    },

    // ---- Helm commands ----

    setMode(m) {
        if (this.helmLocked()) { this.log('Helm locked — the front wall is beyond the horizon', 'warn'); return false; }
        if (m === this.mode) return true;
        this.mode = m;
        this.engaged = false; this.legActive = false; this.braking = false; this.plan = null;
        this.log(m === 'auto' ? 'Autopilot selected' : 'Manual helm');
        return true;
    },

    setTarget(id) {
        if (this.helmLocked()) { this.log('Helm locked — cannot change destination beyond the horizon', 'warn'); return false; }
        this.target = id;
        if (this.engaged && !(this.plan && this.plan.committed)) {
            this.engaged = false; this.legActive = false; this.braking = false;
        }
        return true;
    },

    setCruise(b) {
        if (this.helmLocked()) return false;
        this.cruise = Math.max(0, b);
        return true;
    },

    setField(on) {
        if (!on && this.helmLocked()) {
            this.log('Cannot collapse the field: the front wall is out of causal contact', 'warn');
            return false;
        }
        this.fieldOn = on;
        if (!on) { this.engaged = false; this.legActive = false; this.braking = false; this.plan = null; }
        this.log(on ? (this.isShell() ? 'Propulsion armed' : 'Field generators energised')
                    : (this.isShell() ? 'Propulsion safed' : 'Field generators de-energised'));
        return true;
    },

    engage() {
        if (this.mode !== 'auto') { this.log('ENGAGE runs a flight plan — select AUTO', 'warn'); return false; }
        if (!this.fieldOn) { this.log(this.isShell() ? 'Arm propulsion first' : 'Energise the field first', 'warn'); return false; }
        if (this.helmLocked()) return false;
        if (this.effCruise() <= 0) { this.log('Set a cruise speed', 'warn'); return false; }
        this.engaged = true; this.legActive = false; this.braking = false; this.plan = null;
        this.log('Plan accepted: ' + this.targetName() + ' — aligning');
        return true;
    },

    allStop() {
        if (this.helmLocked()) {
            this.log('ALL STOP refused: nothing aboard can reach the front wall', 'alarm');
            return false;
        }
        this.engaged = false; this.legActive = false; this.braking = false; this.plan = null;
        if (this.mode === 'manual') this.cruise = 0;
        this.log('All stop');
        return true;
    },

    setInterlock(on) {
        if (on && this.horizon()) {
            this.log('Interlock cannot be restored beyond the horizon', 'warn');
            return false;
        }
        this.interlock = on;
        this.log(on ? 'Causality interlock restored' : 'CAUSALITY INTERLOCK BYPASSED — flight is no longer physical', on ? 'info' : 'alarm');
        return true;
    },

    effCruise() {
        let b = this.cruise;
        if (this.isShell()) return Math.min(b, 0.99);
        if (this.mode === 'manual' && this.interlock) b = Math.min(b, C_GATE * this.vh());
        return b;
    },

    targetName() {
        const b = space.byId[this.target];
        return b ? b.name : '—';
    },

    targetGeom() {
        const b = space.byId[this.target];
        const p = space.bodyPos(this.target, this.t);
        const d = [p[0] - this.pos[0], p[1] - this.pos[1], p[2] - this.pos[2]];
        const dist = v3len(d);
        return { body: b, pos: p, dir: v3norm(d), dist, rem: dist - b.standoff };
    },

    // ---- Kinematics ----

    rate() { return this.isShell() ? this.thrustG * PHYS.g0 / PHYS.c : FIELD_RATE; },
    lin() { return this.isShell(); },

    stopDist(b) {
        const k = this.rate();
        return this.lin() ? PHYS.c * b * b / (2 * k) : PHYS.c * b / k;
    },

    // Rough time for a leg of length d at cruise b, used to lead a moving
    // target when a superluminal plan is fixed.
    legTime(d, b) {
        const k = this.rate(), c = PHYS.c;
        if (this.lin()) {
            const ramp = c * b * b / k;
            if (d < ramp) return 2 * Math.sqrt(d / c / k);
            return 2 * b / k + (d - ramp) / (c * b);
        }
        const ramp = 2 * c * b / k;
        if (d < ramp) return 2 * Math.log(Math.max(d * k / (2 * c) / BETA_FLOOR, 1)) / k;
        return 2 * Math.log(b / BETA_FLOOR) / k + (d - ramp) / (c * b);
    },

    // Called once per frame with real elapsed seconds, before advance().
    // Handles attitude, which the pilot and autopilot work in real time.
    helm(dtReal) {
        if (this.mode !== 'auto' || !this.engaged) return;
        if (this.plan && this.plan.committed) { this.fwd = this.plan.dir.slice(); return; }
        const g = this.targetGeom();
        const left = this.slewToward(g.dir, dtReal);
        if (!this.legActive && left < 0.3 * Math.PI / 180) {
            if (g.rem < 1e3) {
                this.engaged = false;
                this.log('Already at ' + g.body.name);
                return;
            }
            this.legActive = true;
            const cruise = this.effCruise();
            if (!this.isShell() && cruise >= this.vh() && this.interlock) {
                // Commit: lead the target and freeze heading and distance.
                let aim = g.pos, dist = g.dist;
                for (let k = 0; k < 3; k++) {
                    const T = this.legTime(dist - g.body.standoff, cruise);
                    aim = space.bodyPos(this.target, this.t + T);
                    dist = v3len([aim[0] - this.pos[0], aim[1] - this.pos[1], aim[2] - this.pos[2]]);
                }
                const dir = v3norm([aim[0] - this.pos[0], aim[1] - this.pos[1], aim[2] - this.pos[2]]);
                this.plan = { committed: true, dir, remaining: dist - g.body.standoff, total: dist - g.body.standoff };
                // A committed leg is flown in the Sun's frame, where its aim
                // point was predicted.
                this.setAnchor('sun');
                this.pointAt(aim);
                this.log(`Plan committed: ${fmtDist(this.plan.total)} at ${fmtBeta(cruise)} — heading, braking point and stop fixed now`);
            } else {
                this.plan = null;
                this.log('Leg started: ' + g.body.name);
            }
        }
    },

    advance(dt) {
        let remain = dt;
        const c = PHYS.c;
        for (let iter = 0; iter < 64 && remain > 0; iter++) {
            this.syncPos();
            if (!(this.plan && this.plan.committed)) {
                const fr = space.frameAt(this.pos, this.t);
                if (fr !== this.anchor) this.setAnchor(fr);
            }
            const k = this.rate(), lin = this.lin();
            const auto = this.mode === 'auto' && this.engaged && this.legActive;
            let goal, dRem = Infinity, dir = this.fwd;
            if (auto) {
                goal = this.effCruise();
                if (this.plan && this.plan.committed) { dRem = this.plan.remaining; dir = this.plan.dir; }
                else { const g = this.targetGeom(); dRem = g.rem; dir = g.dir; }
                if (!this.braking && dRem <= this.stopDist(this.beta) * (1 + 1e-9)) this.braking = true;
            } else {
                goal = this.fieldOn && this.mode === 'manual' ? this.effCruise() : 0;
                this.braking = false;
            }

            const b0 = this.beta;
            let phase, tau = Infinity;
            if (this.braking) {
                phase = 'down';
                tau = lin ? b0 / k : Math.log(Math.max(b0, BETA_FLOOR) / BETA_FLOOR) / k;
            } else if (b0 < goal * (1 - 1e-12)) {
                phase = 'up';
                const bs = lin ? b0 : Math.max(b0, BETA_FLOOR);
                tau = lin ? (goal - bs) / k : Math.log(goal / bs) / k;
                if (auto) {
                    const tb = lin
                        ? (-2 * bs + Math.sqrt(2 * bs * bs + 4 * k * dRem / c)) / (2 * k)
                        : Math.log(Math.max(1, (dRem * k / (c * bs) + 1) / 2)) / k;
                    tau = Math.min(tau, Math.max(0, tb));
                }
            } else if (b0 > goal * (1 + 1e-12)) {
                phase = 'down';
                tau = lin ? (b0 - goal) / k : Math.log(b0 / Math.max(goal, BETA_FLOOR)) / k;
            } else {
                phase = 'hold';
                if (auto && b0 > 0) tau = Math.max(0, (dRem - this.stopDist(b0)) / (c * b0));
            }

            const h = Math.min(remain, tau);
            let b1, s;
            if (phase === 'up') {
                if (lin) { b1 = b0 + k * h; s = c * (b0 * h + 0.5 * k * h * h); }
                else { const bs = Math.max(b0, BETA_FLOOR); b1 = bs * Math.exp(k * h); s = c * (b1 - bs) / k; }
            } else if (phase === 'down') {
                if (lin) { b1 = Math.max(0, b0 - k * h); s = c * (b0 + b1) * 0.5 * h; }
                else { b1 = b0 * Math.exp(-k * h); s = c * (b0 - b1) / k; }
            } else {
                b1 = b0; s = c * b0 * h;
            }

            this.rel[0] += dir[0] * s; this.rel[1] += dir[1] * s; this.rel[2] += dir[2] * s;
            this.odometer += s;
            if (this.plan && this.plan.committed) this.plan.remaining -= s;
            if (!this.isShell() && Math.max(b0, b1) >= this.vh()) {
                this.swept += space.mediumDensity(this.pos) * Math.PI * this.drive.R * this.drive.R * s;
            }
            if (this.isShell()) {
                const g0 = 1 / Math.sqrt(1 - b0 * b0), g1 = 1 / Math.sqrt(1 - b1 * b1);
                this.kinetic += Math.abs(g1 - g0) * this.drive.M * c * c;
                this.tau += h * this.drive.clockRate / (0.5 * (g0 + g1));
            } else {
                this.tau += h;
            }
            this.t += h;
            remain -= h;
            this.syncPos();

            // Transitions.
            const vh = this.vh();
            if (b0 < vh && b1 >= vh && !this.isShell()) {
                this.log((vh < 0.999 ? `Wall flow outran light at ${fmtBeta(vh)}` : 'Bubble past c') +
                         ' — horizons formed; front wall out of contact' + (this.interlock ? '; helm locked' : ''), 'warn');
            }
            if (b0 >= vh && b1 < vh && !this.isShell()) {
                this.log('Horizons gone; helm restored');
                if (this.swept > 0) {
                    this.log(`Front wall discharged ${this.swept.toExponential(2)} trapped protons ` +
                             `(${fmtMass(this.swept * PHYS.m_p)}) ahead of the ship`, 'alarm');
                    this.swept = 0;
                }
            }
            this.beta = b1;
            const stopped = lin ? b1 <= 0 : b1 <= BETA_FLOOR;
            if (phase === 'down' && stopped && (this.braking || goal === 0)) {
                this.beta = 0;
                if (this.braking) {
                    const g = this.targetGeom();
                    this.log(`Arrived: ${g.body.name}, ${fmtDist(g.dist - g.body.radius)} off the surface`);
                    this.engaged = false; this.legActive = false; this.braking = false; this.plan = null;
                }
            }
        }
        this.t += Math.max(0, remain);
        this.syncPos();
    }
};

// ---- Formatting shared by every view ----

function fmtSci(x, d) {
    if (!isFinite(x)) return '—';
    if (x === 0) return '0';
    const e = Math.floor(Math.log10(Math.abs(x)));
    if (e >= -2 && e < 5) return x.toFixed(Math.max(0, (d === undefined ? 3 : d) - 1 - Math.max(e, 0)));
    const m = x / Math.pow(10, e);
    return m.toFixed(d === undefined ? 2 : d - 1) + '×10' + supNum(e);
}
function supNum(n) {
    const map = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
    return String(n).split('').map(ch => map[ch]).join('');
}
function fmtDist(m) {
    const a = Math.abs(m);
    if (a < 1e3) return a.toFixed(0) + ' m';
    if (a < 1e9) return (a / 1e3).toLocaleString('en-US', { maximumFractionDigits: a < 1e5 ? 1 : 0 }) + ' km';
    if (a < 0.05 * PHYS.LY) return (a / PHYS.AU).toFixed(a < 10 * PHYS.AU ? 3 : 1) + ' AU';
    return (a / PHYS.LY).toFixed(2) + ' ly';
}
function fmtBeta(b) {
    if (b === 0) return '0';
    if (b < 1e-3) return (b * PHYS.c / 1e3).toFixed(b * PHYS.c < 1e4 ? 2 : 1) + ' km/s';
    if (b < 1) return b.toFixed(b < 0.01 ? 4 : 3) + ' c';
    if (b < 1000) return b.toFixed(b < 10 ? 2 : 1) + ' c';
    return fmtSci(b, 3) + ' c';
}
function fmtTime(s) {
    const a = Math.abs(s);
    if (!isFinite(a)) return '—';
    if (a < 1e-6) return (a * 1e9).toFixed(a < 1e-8 ? 2 : 0) + ' ns';
    if (a < 1e-3) return (a * 1e6).toFixed(a < 1e-5 ? 2 : 0) + ' µs';
    if (a < 1) return (a * 1e3).toFixed(a < 1e-2 ? 2 : 0) + ' ms';
    if (a < 120) return a.toFixed(1) + ' s';
    if (a < 7200) return (a / 60).toFixed(1) + ' min';
    if (a < 172800) return (a / 3600).toFixed(1) + ' h';
    if (a < 3.15e7 * 2) return (a / 86400).toFixed(1) + ' d';
    return (a / 3.15576e7).toFixed(2) + ' yr';
}
function fmtMass(kg) {
    const a = Math.abs(kg);
    if (a === 0) return '0 kg';
    const refs = [
        [PHYS.M_UNIVERSE, 'observable universes'], [PHYS.M_GALAXY, 'Milky Ways'], [PHYS.M_SUN, 'M☉'],
        [PHYS.M_JUP, 'Jupiters'], [PHYS.M_EARTH, 'Earths']
    ];
    for (const [m, n] of refs) if (a >= 0.5 * m) return fmtSci(kg / m, 3) + ' ' + n;
    if (a >= 1e3) return fmtSci(kg / 1e3, 3) + ' t';
    if (a >= 1) return kg.toFixed(1) + ' kg';
    if (a >= 1e-3) return (kg * 1e3).toFixed(1) + ' g';
    return (kg * 1e6).toFixed(2) + ' mg';
}
