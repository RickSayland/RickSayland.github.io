// ============ OPENSTREETRPG — VEHICLES ============
// How each mount is drawn, with the player in it, in avatar.js's part
// language. Keyed by item id (items.js). Reads `player`, keeps no state.
// Owns `vehicles`.
//
// Each entry has `parts(p)` and a few numbers avatar.draw reads:
//   shadow   [[rx, ry] in profile, [rx, ry] facing the camera or away]
//   flies    drawn `player.alt` above its shadow
//   bob      [amplitude, rate] of the hover
//   bank     radians it tilts at cruising speed: [in profile, facing the camera
//            or away]. In profile a tilt is a pitch, which suits a helicopter
//            (it dips its nose to fly) and not a jet (it would look like a
//            dive); facing the camera, sideways motion makes it a roll.
//
// Profile views are drawn facing right. In every view the rider's torso and
// head come from avatar.torso/head, so a vehicle only adds itself, the
// rider's limbs, and where the rider sits.

const vehicles = {

    C: {
        // shared
        metal: '#a9afbd',
        metalDark: '#717685',
        tire: '#3b3644',
        rim: '#d5d8e0',
        lamp: '#fff4c2',
        tail: '#e0392b',
        glass: 'rgba(190, 228, 245, 0.5)',
        // bicycle
        frame: '#d2463c',
        spoke: 'rgba(213, 216, 224, 0.8)',
        saddle: '#3a2a22',
        // car
        car: '#3a86c8',
        carDark: '#2a679f',
        carShine: 'rgba(255, 255, 255, 0.22)',
        plate: '#f4ecd8',
        // helicopter
        heli: '#f0b72f',
        heliDark: '#c48e1c',
        blade: 'rgba(40, 36, 52, 0.9)',
        rotorBlur: 'rgba(225, 228, 238, 0.3)',
        // jet
        jet: '#c9d1dc',
        jetDark: '#8f9aab',
        stripe: '#d2463c',
        nose: '#5d6677',
        flame: 'rgba(255, 170, 70, 0.85)',
        burner: 'rgba(120, 200, 255, 0.85)',
        flameCore: 'rgba(255, 246, 210, 0.95)',
        // ufo
        ufo: '#b8c2d0',
        ufoTop: '#d9e0ea',
        ufoUnder: '#6b7486',
        dome: 'rgba(170, 240, 255, 0.35)',
        lights: ['#5ef2ff', '#ff5ee0', '#ffe45e', '#7dff8a']
    },

    // The two ends of a blade or bar of half-length r through (cx, cy) at
    // angle a, squashed vertically by k (a rotor disc seen from the side).
    spin(cx, cy, r, a, k) {
        const c = Math.cos(a) * r, s = Math.sin(a) * r * k;
        return [[cx + c, cy + s], [cx - c, cy - s]];
    },

    facingParts(art, p) {
        return p.facing === 'down' ? art.front(p) : p.facing === 'up' ? art.back(p) : art.side(p);
    },

    // ---- Bicycle ----

    bicycle: {
        shadow: [[18, 3.6], [7.5, 3.4]],
        LIFT: -10.5,            // how much higher the body sits on the saddle than on its feet

        parts(p) { return vehicles.facingParts(this, p); },

        wheel(cx, cy, angle) {
            const V = vehicles.C;
            return [
                [V.tire, 'ring', 2.2, cx, cy, 6.4],
                [V.rim, 'thinRing', 0.7, cx, cy, 4.6],
                [V.spoke, 'spokes', cx, cy, 4.6, angle],
                [V.metal, 'dot', cx, cy, 1.1]
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

        // In profile: the frame drawn as stroked tubes, a rider sitting
        // upright, and both legs solved onto the pedals every frame, so they
        // genuinely turn the cranks.
        side(p) {
            const A = avatar.C, V = vehicles.C, b = this.LIFT, ox = -3.5;
            const R = [-11.5, -7.5], F = [11.5, -7.5];          // axles
            const BB = [-1, -6.5];                              // bottom bracket
            const ST = [-5, -18], HT = [8, -17.5], HB = [9.2, -13];
            const grip = [5.2, -21.4], hip = [-5, -21];
            const cr = 3.6, cc = Math.cos(p.crank) * cr, cs = Math.sin(p.crank) * cr;
            const near = [BB[0] + cc, BB[1] + cs], far = [BB[0] - cc, BB[1] - cs];
            const kNear = this.knee(hip, near, 9.5, 9.5), kFar = this.knee(hip, far, 9.5, 9.5);
            return [
                ...this.wheel(R[0], R[1], p.wheel),
                ...this.wheel(F[0], F[1], p.wheel + 0.5),
                [A.pantsDark, 'L', 4.4, hip, kFar, far],
                [A.bootDark, 'r', far[0] - 2, far[1] - 1.8, 5.5, 3.6, 1.5],
                [V.metalDark, 'L', 1.4, BB, far],
                [V.frame, 'L', 1.8, R, BB, HB],                   // chainstay, down tube
                [V.frame, 'L', 1.8, R, [-4.6, -16.5]],            // seat stay
                [V.frame, 'L', 1.8, BB, ST],                      // seat tube
                [V.frame, 'L', 2.2, [-4.7, -16.9], HT, HB],       // top tube, head tube
                [V.metal, 'L', 1.6, HB, F],                       // fork
                [V.metal, 'L', 1.5, ST, [-5, -19.5]],             // seat post
                [V.metal, 'L', 1.6, HT, [7.8, -20.6], grip],      // stem and bars
                [V.lamp, 'o', 9.6, -16.2, 1.3],
                [V.saddle, 'r', -8.5, -21, 7, 2.6, 1.3],
                [V.metal, 'o', BB[0], BB[1], 2.4],                // chainring
                ...avatar.torso('side', ox, b),
                [V.metal, 'L', 1.4, BB, near],
                [A.pants, 'L', 4.4, hip, kNear, near],
                [A.boot, 'r', near[0] - 2, near[1] - 1.8, 5.5, 3.6, 1.5],
                [A.tunicDark, 'L', 4.2, [ox, -30.5], grip],
                [A.skin, 'o', grip[0], grip[1], 2.3],
                ...avatar.head('side', ox + 0.5, -30 + b)
            ];
        },

        // Facing the camera or away, the knees rise and fall with the pedals.
        legs(p) {
            const A = avatar.C, fy = Math.sin(p.crank) * 3.6;
            const leg = (s, y) => [
                [A.pants, 'L', 4.4, [s * 3.5, -21], [s * 6.2, y - 8], [s * 5.2, y]],
                [A.boot, 'r', s * 5.2 - 2.5, y - 2.4, 5, 4, 1.5]
            ];
            return [...leg(-1, -6.5 + fy), ...leg(1, -6.5 - fy)];
        },

        // Towards the camera: the front wheel is a tyre seen edge-on and the
        // bars cross in front of the body.
        front(p) {
            const A = avatar.C, V = vehicles.C, b = this.LIFT;
            return [
                ...this.legs(p),
                ...avatar.torso('down', 0, b),
                [V.tire, 'r', -1.6, -15, 3.2, 15, 1.6],
                [V.metal, 'L', 1.4, [-2.3, -7.5], [-2.3, -16]],   // fork
                [V.metal, 'L', 1.4, [2.3, -7.5], [2.3, -16]],
                [V.metal, 'L', 1.6, [0, -16], [0, -20.5]],        // stem
                [V.lamp, 'o', 0, -17.6, 1.5],
                [V.metal, 'L', 1.7, [-10.5, -21.8], [-4, -20.5], [4, -20.5], [10.5, -21.8]],
                [A.tunicDark, 'L', 4.2, [-7.6, -30], [-10.2, -22.4]],
                [A.tunicDark, 'L', 4.2, [7.6, -30], [10.2, -22.4]],
                [A.skin, 'o', -10.5, -21.8, 2.3],
                [A.skin, 'o', 10.5, -21.8, 2.3],
                ...avatar.head('down', 0, -30 + b)
            ];
        },

        // Away from the camera: the bars are beyond the rider so they go
        // first, and the rear wheel, mudguard and reflector are nearest, so
        // they go last.
        back(p) {
            const A = avatar.C, V = vehicles.C, b = this.LIFT;
            return [
                [V.metal, 'L', 1.7, [-10.5, -23.5], [-4, -22.5], [4, -22.5], [10.5, -23.5]],
                [A.tunicDark, 'L', 4.2, [-7.6, -29.5], [-10.2, -23.8]],
                [A.tunicDark, 'L', 4.2, [7.6, -29.5], [10.2, -23.8]],
                [A.skin, 'o', -10.5, -23.5, 2.3],
                [A.skin, 'o', 10.5, -23.5, 2.3],
                ...this.legs(p),
                ...avatar.torso('up', 0, b),
                ...avatar.head('up', 0, -30 + b),
                [V.tire, 'r', -1.6, -15, 3.2, 15, 1.6],
                [V.frame, 'L', 1.5, [-2.3, -7.5], [-2.3, -17]],   // seat stays
                [V.frame, 'L', 1.5, [2.3, -7.5], [2.3, -17]],
                [V.frame, 'r', -3.2, -18.6, 6.4, 2.8, 1.2],       // mudguard
                [V.tail, 'r', -1.8, -18.1, 3.6, 1.8, 0.6]         // reflector
            ];
        }
    },

    // ---- Car ----
    // An open-top convertible, so the driver's whole head shows: a hardtop
    // would leave a window too small for a chibi head to fit in.

    car: {
        shadow: [[27, 4], [21, 4]],
        SEAT: -6,               // driver sits this much higher than standing

        parts(p) { return vehicles.facingParts(this, p); },

        wheel(x, w) {
            const V = vehicles.C;
            return [
                [V.tire, 'ring', 3.2, x, -5.5, 4],
                [V.rim, 'dot', x, -5.5, 2.1],
                [V.metalDark, 'dot', x + Math.cos(w) * 1.2, -5.5 + Math.sin(w) * 1.2, 0.7]
            ];
        },

        side(p) {
            const A = avatar.C, V = vehicles.C, b = this.SEAT;
            return [
                ...avatar.torso('side', -4, b),
                [V.metalDark, 'L', 1.6, [2.5, -24], [5.5, -17]],       // steering wheel, edge-on
                [A.tunicDark, 'L', 4.2, [-4, -25.5], [3.8, -20.5]],
                [A.skin, 'o', 3.8, -20.5, 2.3],
                ...avatar.head('side', -3.5, -30 + b),
                [V.glass, 'glass', [6.5, -17], [10, -17], [6.8, -25.5], [4.6, -25.5]],   // windscreen
                [V.car, 'r', -25, -18, 50, 11.5, 5],
                [V.carShine, 'r', -21, -17, 30, 2, 1],
                [V.carDark, 'thin', 0.9, [-5, -16.5], [-5, -8.5]],     // door
                [V.carDark, 'r', -3.5, -14, 3.2, 1.2, 0.6],            // handle
                [V.lamp, 'r', 21.5, -16, 3.2, 3, 1.2],
                [V.tail, 'r', -25.6, -16.5, 2.4, 3.4, 1],
                [V.metal, 'r', 20, -9, 7.5, 2.8, 1.4],                 // bumpers
                [V.metal, 'r', -27.5, -9, 7.5, 2.8, 1.4],
                ...this.wheel(-14.5, p.wheel),
                ...this.wheel(14.5, p.wheel + 1)
            ];
        },

        front(p) {
            const A = avatar.C, V = vehicles.C, b = this.SEAT;
            return [
                ...avatar.torso('down', 0, b),
                [A.tunicDark, 'L', 4.2, [-7, -24], [-5, -20]],
                [A.tunicDark, 'L', 4.2, [7, -24], [5, -20]],
                [V.metalDark, 'L', 1.8, [-5.5, -20], [5.5, -20]],      // steering wheel
                [A.skin, 'o', -5, -20, 2.3],
                [A.skin, 'o', 5, -20, 2.3],
                ...avatar.head('down', 0, -30 + b),
                [V.glass, 'glass', [-15.5, -17.5], [15.5, -17.5], [13, -26], [-13, -26]],
                [V.tire, 'r', -20, -9, 6, 9, 2],
                [V.tire, 'r', 14, -9, 6, 9, 2],
                [V.car, 'r', -19.5, -18.5, 39, 12.5, 5],
                [V.carShine, 'r', -15, -17.5, 30, 2, 1],
                [V.carDark, 'r', -6, -13, 12, 4, 2],                  // grille
                [V.lamp, 'o', -13.5, -13, 2.8],
                [V.lamp, 'o', 13.5, -13, 2.8],
                [V.metal, 'r', -18.5, -8, 37, 2.8, 1.4],
                [V.plate, 'r', -3.5, -8.2, 7, 3, 0.6]
            ];
        },

        back(p) {
            const V = vehicles.C, b = this.SEAT;
            return [
                ...avatar.torso('up', 0, b),
                ...avatar.head('up', 0, -30 + b),
                [V.tire, 'r', -20, -9, 6, 9, 2],
                [V.tire, 'r', 14, -9, 6, 9, 2],
                [V.car, 'r', -19.5, -18.5, 39, 12.5, 5],
                [V.carShine, 'r', -15, -17.5, 30, 2, 1],
                [V.tail, 'r', -17, -15.5, 5.5, 3.2, 1.2],
                [V.tail, 'r', 11.5, -15.5, 5.5, 3.2, 1.2],
                [V.metal, 'r', -18.5, -8, 37, 2.8, 1.4],
                [V.plate, 'r', -3.5, -8.2, 7, 3, 0.6],
                [V.metalDark, 'r', 9, -6, 3.6, 2, 1]                   // exhaust
            ];
        }
    },

    // ---- Helicopter ----
    // The main rotor is a translucent disc with two blades swept round it,
    // foreshortened because it is seen nearly edge-on.

    helicopter: {
        shadow: [[24, 4.5], [15, 4]],
        flies: true,
        bob: [1.2, 2.4],
        bank: [0.2, 0.2],

        parts(p) { return vehicles.facingParts(this, p); },

        rotor(p) {
            const V = vehicles.C, a = p.clock * 26, y = -30.5;
            return [
                [V.metalDark, 'L', 1.8, [0, -26], [0, y]],              // mast
                [V.rotorBlur, 'blur', 0, y, 31, 6],
                [V.blade, 'thin', 2, ...vehicles.spin(0, y, 31, a, 0.2)],
                [V.blade, 'thin', 2, ...vehicles.spin(0, y, 31, a + Math.PI / 2, 0.2)],
                [V.metalDark, 'o', 0, y, 2.2]
            ];
        },

        skidsFacing() {
            const V = vehicles.C;
            return [
                [V.metalDark, 'L', 1.3, [-10, -1.5], [-7, -8]],
                [V.metalDark, 'L', 1.3, [10, -1.5], [7, -8]],
                [V.metalDark, 'o', -10, -1.5, 1.7],
                [V.metalDark, 'o', 10, -1.5, 1.7]
            ];
        },

        side(p) {
            const V = vehicles.C;
            return [
                [V.heli, 'L', 3.6, [-11, -16], [-33, -19.5]],          // tail boom
                [V.heliDark, 'poly', [-35, -18], [-32.5, -29.5], [-29.5, -29], [-30.5, -18.5]],
                [V.rotorBlur, 'blur', -31, -24, 5.5, 5.5],             // tail rotor
                [V.blade, 'thin', 1.4, ...vehicles.spin(-31, -24, 5.5, p.clock * 44, 1)],
                [V.metalDark, 'L', 1.5, [-11, -1.5], [12, -1.5], [15.5, -4.5]],     // skid
                [V.metalDark, 'L', 1.3, [-6, -1.5], [-5, -7.5]],
                [V.metalDark, 'L', 1.3, [7, -1.5], [6, -7.5]],
                [V.heli, 'e', 0, -16, 15, 10.5],
                [V.heliDark, 'r', -14, -17.5, 20, 2.6, 1.3],
                ...avatar.head('side', 6.5, -18, 0.55),
                [V.glass, 'glassE', 7, -18, 7.5, 6.5],                 // canopy
                ...this.rotor(p)
            ];
        },

        front(p) {
            const V = vehicles.C;
            return [
                ...this.skidsFacing(),
                [V.heli, 'e', 0, -16, 11.5, 10.5],
                [V.heliDark, 'r', -11, -17.5, 22, 2.6, 1.3],
                ...avatar.head('down', 0, -18, 0.55),
                [V.glass, 'glassE', 0, -17.5, 8, 7],
                ...this.rotor(p)
            ];
        },

        // From behind, the tail boom comes towards the camera, so it runs down
        // the screen past the skids, with the tail rotor edge-on beside the fin.
        back(p) {
            const V = vehicles.C;
            return [
                ...this.skidsFacing(),
                [V.heli, 'e', 0, -16, 11.5, 10.5],
                [V.heliDark, 'r', -11, -17.5, 22, 2.6, 1.3],
                [V.heliDark, 'r', -4.5, -24, 9, 4, 2],                 // engine housing
                [V.heli, 'L', 3.6, [0, -10], [0, 5]],
                [V.heliDark, 'r', -1.6, -1, 3.2, 10, 1.4],             // fin, edge-on
                [V.rotorBlur, 'blur', 3.6, 3, 1.4, 5.5],
                ...this.rotor(p)
            ];
        }
    },

    // ---- Jet ----
    // The exhaust grows with speed and turns blue when Shift lights the
    // afterburner (thrust above cruising).

    jet: {
        shadow: [[30, 3.5], [27, 3.5]],
        flies: true,
        bob: [0.8, 1.3],
        bank: [0, 0.3],

        parts(p) { return vehicles.facingParts(this, p); },

        wings() {
            return [vehicles.C.jetDark, 'poly', [-34, -11], [-6, -16.5], [6, -16.5], [34, -11],
                [34, -9], [6, -13.5], [-6, -13.5], [-34, -9]];
        },

        side(p) {
            const V = vehicles.C, t = Math.min(p.thrust, 1.7);
            const f = 3 + 9 * t + Math.sin(p.clock * 47) * 1.2;
            return [
                [t > 1.05 ? V.burner : V.flame, 'flare', [-29, -18.8], [-29 - f * 1.5, -15.6], [-29, -12.4]],
                [V.flameCore, 'flare', [-29, -17.2], [-29 - f, -15.6], [-29, -14]],
                [V.jetDark, 'poly', [-21, -19.5], [-30.5, -33], [-25.5, -33], [-13, -19.5]],   // fin
                [V.jet, 'poly', [-30, -19], [-20, -21.5], [12, -21.5], [24, -19.5], [35, -15.5],
                    [24, -11.5], [-20, -11.5], [-30, -12.5]],
                [V.jetDark, 'r', -31.5, -18.5, 3.5, 6, 1],                                       // nozzle
                [V.stripe, 'r', -18, -16.8, 34, 2.2, 1.1],
                [V.jetDark, 'poly', [-24, -14.5], [-31, -10], [-27, -10], [-18, -14.5]],         // tailplane
                [V.jetDark, 'poly', [-4, -14], [-17, -6.5], [-11, -6.5], [8, -13]],              // wing
                [V.nose, 'o', 33.5, -15.5, 1.4],
                ...avatar.head('side', 11.5, -22.5, 0.45),
                [V.glass, 'glassE', 12, -22.5, 8, 4.5]                                          // canopy
            ];
        },

        front(p) {
            const V = vehicles.C;
            return [
                [V.jetDark, 'poly', [-1.8, -21], [-1.2, -33], [1.2, -33], [1.8, -21]],        // fin, beyond
                this.wings(),
                [V.jet, 'o', 0, -15.5, 7.5],
                [V.jetDark, 'e', -8.6, -13.5, 2.6, 3.2],                                     // intakes
                [V.jetDark, 'e', 8.6, -13.5, 2.6, 3.2],
                [V.nose, 'o', 0, -15.5, 2.6],
                ...avatar.head('down', 0, -22.5, 0.42),
                [V.glass, 'glassE', 0, -22.5, 5.2, 4]
            ];
        },

        back(p) {
            const V = vehicles.C, t = Math.min(p.thrust, 1.7);
            const g = 1.5 + 2.8 * t + Math.sin(p.clock * 47) * 0.4;
            return [
                this.wings(),
                [V.jet, 'o', 0, -15.5, 7.5],
                [V.jetDark, 'e', -8.6, -13.5, 2.6, 3.2],
                [V.jetDark, 'e', 8.6, -13.5, 2.6, 3.2],
                [V.nose, 'o', 0, -15.5, 4.6],                                                // nozzle
                [t > 1.05 ? V.burner : V.flame, 'blur', 0, -15.5, g, g],
                [V.flameCore, 'blur', 0, -15.5, 0.8 + 1.4 * t, 0.8 + 1.4 * t],
                [V.jetDark, 'poly', [-13, -14.5], [-2, -16.5], [2, -16.5], [13, -14.5], [13, -12.8], [-13, -12.8]],
                [V.jetDark, 'poly', [-1.8, -20], [-1.2, -34], [1.2, -34], [1.8, -20]]         // fin, nearest
            ];
        }
    },

    // ---- UFO ----
    // A saucer looks the same from every side, so only the pilot turns. The
    // rim lights chase round, only the near half of the rim is drawn, and
    // hovering still lowers a tractor beam to the ground (`alt` below).

    ufo: {
        shadow: [[25, 5], [25, 5]],
        flies: true,
        bob: [2, 2],
        bank: [0.25, 0.25],

        parts(p) {
            const V = vehicles.C, ph = p.clock * 3;
            const beam = clamp(1 - p.thrust * 4, 0, 1);
            const parts = [];
            if (beam > 0.01) {
                parts.push(['rgba(150, 255, 190, ' + (0.22 * beam).toFixed(3) + ')', 'flare',
                    [-7, -5], [7, -5], [17, p.alt], [-17, p.alt]]);
            }
            parts.push(
                [V.ufoUnder, 'e', 0, -6.5, 15, 5.5],
                [V.ufo, 'e', 0, -10, 27, 7.5],
                [V.ufoTop, 'e', 0, -11.5, 21, 4.6],
                ...avatar.head(p.facing, 0, -20.5, 0.8),
                [V.dome, 'dome', 0, -12.5, 12.5, 17.5]
            );
            for (let i = 0; i < 8; i++) {
                const a = ph + i * TAU / 8, s = Math.sin(a);
                if (s < 0) continue;
                const x = Math.cos(a) * 24, y = -10 + s * 6.4, c = V.lights[i % 4];
                parts.push([c + '55', 'blur', x, y, 3.4, 3.4], [c, 'dot', x, y, 1.7]);
            }
            return parts;
        }
    }
};
