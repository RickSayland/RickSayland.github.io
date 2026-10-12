// genome.js -- encoding, decoding, mutation, and genome -> body.
//
// A genome is a fixed-length array of floats in [0,1]. It means nothing on
// its own: CFG.GENES maps each gene onto a physical range, and buildPlan()
// turns the result into a body plan -- where the bones are, the meat
// lattice, how much blood, the skin ring, the colours, the muscle schedule.
//
// Two contracts:
//   * Building is deterministic. The only randomness in buildPlan comes from
//     a PRNG seeded by the genome itself, so the same genome always builds
//     the same animal, on any machine, including the thumbnail of an
//     ancestor that died three generations ago.
//   * A genome is always stored already quantised to what the share code can
//     hold (6 bits a gene). Otherwise an animal and the animal you get from
//     its own link would differ in the low bits.

import { CFG, GENOME_VERSION, TISSUE } from './config.js';

export const GENES = CFG.GENES;
export const GENE_COUNT = GENES.length;
export const GENE_INDEX = {};
GENES.forEach((g, i) => { GENE_INDEX[g.key] = i; });

const Q = 63;     // 6 bits

// ---- PRNG ----------------------------------------------------------------------
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Box-Muller
export function gaussian(rng) {
    let u = rng(); if (u < 1e-9) u = 1e-9;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * rng());
}

// ---- encoding ------------------------------------------------------------------
// Each gene is quantised to 6 bits, the fields are packed most significant
// bit first, and the bytes are written as base64url. base64 is itself a
// 6-bits-per-character code, so with MSB-first packing a gene lands on
// exactly one character: the packer below and "one alphabet character per
// gene" produce the same string. It is written as a real bit packer anyway
// so the format is what the comment says it is. The string is prefixed with
// a format version and a dot.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_REV = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64_REV[B64.charCodeAt(i)] = i;

export function snap(genome) {
    for (let i = 0; i < genome.length; i++) {
        const v = genome[i] < 0 ? 0 : genome[i] > 1 ? 1 : genome[i];
        genome[i] = Math.round(v * Q) / Q;
    }
    return genome;
}

export function encode(genome) {
    // pack
    const bytes = new Uint8Array(Math.ceil(GENE_COUNT * 6 / 8));
    let bit = 0;
    for (let i = 0; i < GENE_COUNT; i++) {
        const q = Math.round(Math.max(0, Math.min(1, genome[i])) * Q);
        for (let b = 5; b >= 0; b--, bit++) {
            if ((q >> b) & 1) bytes[bit >> 3] |= 0x80 >> (bit & 7);
        }
    }
    // base64url, no padding
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
        out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
        if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
        if (i + 2 < bytes.length) out += B64[n & 63];
    }
    return GENOME_VERSION + '.' + out;
}

export function decode(str) {
    if (typeof str !== 'string') return null;
    const dot = str.indexOf('.');
    if (dot < 0 || str.slice(0, dot) !== GENOME_VERSION) return null;
    const body = str.slice(dot + 1);
    const need = Math.ceil(GENE_COUNT * 6 / 8);
    const bytes = new Uint8Array(need + 3);
    let acc = 0, bits = 0, n = 0;
    for (let i = 0; i < body.length; i++) {
        const c = body.charCodeAt(i);
        const v = c < 128 ? B64_REV[c] : -1;
        if (v < 0) return null;
        acc = (acc << 6) | v; bits += 6;
        if (bits >= 8) { bits -= 8; if (n < bytes.length) bytes[n++] = (acc >> bits) & 255; }
    }
    if (n < need) return null;
    const g = new Float32Array(GENE_COUNT);
    let bit = 0;
    for (let i = 0; i < GENE_COUNT; i++) {
        let q = 0;
        for (let b = 0; b < 6; b++, bit++) q = (q << 1) | ((bytes[bit >> 3] >> (7 - (bit & 7))) & 1);
        g[i] = q / Q;
    }
    return g;
}

export function genomeSeed(genome) {
    // FNV-1a over the quantised genes
    let h = 0x811c9dc5;
    for (let i = 0; i < genome.length; i++) {
        h ^= Math.round(genome[i] * Q) + 1;
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

// ---- variation -----------------------------------------------------------------
export function randomGenome(rng = Math.random) {
    const g = new Float32Array(GENE_COUNT);
    for (let i = 0; i < GENE_COUNT; i++) g[i] = rng();
    return snap(g);
}

// Offspring = parent + Gaussian noise on every gene. sigma is the base rate
// plus a term proportional to the dose the parent had absorbed when it laid:
// an irradiated animal has visibly stranger children. Occasionally one gene
// is re-rolled outright (a macro-mutation), and that chance climbs with dose
// too.
export function mutationRates(dose) {
    const G = CFG.GENETICS;
    return {
        sigma: Math.min(G.SIGMA_MAX, G.SIGMA_BASE + G.SIGMA_PER_DOSE * dose),
        macro: Math.min(0.9, G.MACRO_CHANCE + G.MACRO_PER_DOSE * dose),
    };
}

export function mutate(genome, dose, rng = Math.random) {
    const { sigma, macro } = mutationRates(dose);
    const g = new Float32Array(GENE_COUNT);
    for (let i = 0; i < GENE_COUNT; i++) {
        let v = genome[i] + sigma * gaussian(rng);
        // reflect at the ends rather than clamp, so genes do not pile up at 0 and 1
        if (v < 0) v = -v;
        if (v > 1) v = 2 - v;
        g[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    if (rng() < macro) g[(rng() * GENE_COUNT) | 0] = rng();
    return snap(g);
}

// Uniform crossover: each gene comes from one parent or the other.
export function crossover(a, b, rng = Math.random) {
    const g = new Float32Array(GENE_COUNT);
    for (let i = 0; i < GENE_COUNT; i++) g[i] = rng() < 0.5 ? a[i] : b[i];
    return snap(g);
}

// ---- gene -> physical value ---------------------------------------------------
export function express(genome) {
    const out = {};
    for (let i = 0; i < GENE_COUNT; i++) {
        const d = GENES[i], v = genome[i];
        if (d.kind === 'lin') out[d.key] = d.min + v * (d.max - d.min);
        else if (d.kind === 'log') out[d.key] = d.min * Math.pow(d.max / d.min, v);
        else {
            const n = d.max - d.min + 1;
            out[d.key] = d.min + Math.min(n - 1, Math.floor(v * n));
        }
    }
    return out;
}

// ---- the outline ----------------------------------------------------------------
// The body is star-shaped about its centre, so its outline is a radius as a
// function of angle. Angles are in grid orientation: 0 is +x (right), and
// because y runs DOWN the screen, +pi/2 is the belly and -pi/2 is the back.
//
//   r(theta) = ellipse(theta)                     aspect ratio
//            * (1 + head bulge at the leading end)
//            * (1 - taper at the trailing end)
//            + limb nubs along the belly
//
// `wR` blends which end is the leading one: 1 = facing right, 0 = facing
// left. Turning round is not a flip. The rest shape itself is morphed from
// one to the other with every particle keeping its place, so the head
// deflates at one end while it inflates at the other and the face slides
// across. Distances between particles change smoothly throughout, which is
// what lets the constraints carry the animal through it.
function angDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
}
function bump(d, sigma) { const u = d / sigma; return Math.exp(-u * u); }

export function faceWeight(face) {
    const t = Math.max(0, Math.min(1, (face + 1) * 0.5));
    return t * t * (3 - 2 * t);
}

export function outlineR(plan, th, wR) {
    const c = Math.cos(th), s = Math.sin(th);
    const a = plan.a, b = plan.b;
    let r = a * b / Math.sqrt(b * b * c * c + a * a * s * s);
    const wL = 1 - wR;
    r *= 1 + plan.headAmt * (wR * bump(angDiff(th, plan.headTh), plan.headSig) +
        wL * bump(angDiff(th, Math.PI - plan.headTh), plan.headSig));
    r *= 1 - plan.tailAmt * (wR * bump(angDiff(th, Math.PI), plan.tailSig) +
        wL * bump(angDiff(th, 0), plan.tailSig));
    const nubs = plan.nubs;
    for (let k = 0; k < nubs.length; k++) r += nubs[k].len * bump(angDiff(th, nubs[k].th), nubs[k].sig);
    return r;
}

function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// ---- genome -> body plan ------------------------------------------------------
// The plan is pure data: no physics, no positions in the world. Every
// particle gets a tissue, a mass, a place in the rest shape and a `birth`
// scale at which it comes into existence, so one plan describes the animal
// from embryo to elder.
//
// Particle order is fixed: [spine bones][skin ring][foot pads][meat lattice][blood].
export function buildPlan(genome) {
    const ph = express(genome);
    const rng = mulberry32(genomeSeed(genome));
    const B = CFG.BODY, S = CFG.SOFT;

    // Size sets the AREA; aspect then decides how that area is spent.
    const b = B.HALF_HEIGHT * ph.size * Math.sqrt(1.5 / ph.aspect);
    const a = b * ph.aspect;

    const plan = {
        genome, phen: ph, a, b,
        headAmt: ph.head, headTh: B.HEAD_ANGLE, headSig: B.HEAD_SIGMA,
        tailAmt: B.TAIL_TAPER, tailSig: B.TAIL_SIGMA,
        nubs: [],
    };

    // -- limb nubs: evenly spaced along the belly. A nub is a radial bump, and
    //    the belly curves up toward the ends, so each nub's length is solved
    //    for rather than fixed: long enough that every tip reaches the same
    //    ground line, b + nubLen below the centre. Otherwise only the middle
    //    feet ever touch the floor.
    const nubLen = ph.nubLen * b;
    for (let k = 0; k < ph.nubs; k++) {
        const x = a * (-0.44 + 0.88 * (ph.nubs === 1 ? 0.5 : k / (ph.nubs - 1)));
        const y = b * Math.sqrt(Math.max(0, 1 - (x / a) * (x / a)));
        const th = Math.atan2(y, x);
        const re = Math.hypot(x, y);
        plan.nubs.push({ th, sig: B.NUB_WIDTH / re, len: (b + nubLen) / Math.sin(th) - re });
    }

    const tissue = [], mass = [], rho = [], theta = [], fx = [], fy = [], morph = [], birth = [], foot = [];
    const add = (t, o) => {
        tissue.push(t); mass.push(S.MASS[t]);
        rho.push(o.rho || 0); theta.push(o.theta || 0);
        fx.push(o.x || 0); fy.push(o.y || 0);
        morph.push(o.morph ? 1 : 0); birth.push(o.birth || 0); foot.push(o.foot === undefined ? -1 : o.foot);
        return tissue.length - 1;
    };

    // -- BONE: a spine along the long axis, slightly arched. It does not
    //    morph: the skeleton is symmetric and the animal turns around it.
    const bones = [];
    for (let k = 0; k < ph.spine; k++) {
        const u = ph.spine === 1 ? 0 : k / (ph.spine - 1) * 2 - 1;
        bones.push(add(TISSUE.BONE, { x: u * a * 0.52, y: -b * (0.1 + 0.07 * (1 - u * u)) }));
    }

    // -- SKIN: a closed ring, evenly spaced by arc length around the
    //    symmetric (mid-turn) outline, with one vertex snapped onto the tip
    //    of every nub so a foot always has a particle to stand on.
    const K = 720;
    const cum = new Float32Array(K + 1);
    let lx = 0, ly = 0;
    for (let k = 0; k <= K; k++) {
        const th = -Math.PI + (k / K) * 2 * Math.PI;
        const r = outlineR(plan, th, 0.5);
        const x = r * Math.cos(th), y = r * Math.sin(th);
        cum[k] = k === 0 ? 0 : cum[k - 1] + Math.hypot(x - lx, y - ly);
        lx = x; ly = y;
    }
    const perim = cum[K];
    const nSkin = Math.max(B.SKIN_MIN, Math.min(B.SKIN_MAX, Math.round(perim / B.SKIN_SPACING)));
    const ringTh = [];
    for (let e = 0, k = 0; e < nSkin; e++) {
        const target = (e / nSkin) * perim;
        while (k < K && cum[k + 1] < target) k++;
        const f = (target - cum[k]) / Math.max(1e-6, cum[k + 1] - cum[k]);
        ringTh.push(-Math.PI + ((k + f) / K) * 2 * Math.PI);
    }
    const ringFoot = new Array(nSkin).fill(-1);
    plan.nubs.forEach((nub, ni) => {
        let best = 0, bd = 1e9;
        for (let e = 0; e < nSkin; e++) {
            const d = Math.abs(angDiff(ringTh[e], nub.th));
            if (d < bd) { bd = d; best = e; }
        }
        ringTh[best] = nub.th;
        for (let e = 0; e < nSkin; e++) {
            if (Math.abs(angDiff(ringTh[e], nub.th)) < nub.sig * 1.25) ringFoot[e] = ni;
        }
    });
    const ring = [];
    for (let e = 0; e < nSkin; e++) ring.push(add(TISSUE.SKIN, { morph: 1, rho: 1, theta: ringTh[e], foot: ringFoot[e] }));

    // -- foot pads: one meat particle inside each nub. These are what the
    //    muscles pull on.
    const feet = [];
    plan.nubs.forEach((nub, ni) => {
        const R = outlineR(plan, nub.th, 0.5);
        const r = R - B.FOOT_INSET;
        const idx = add(TISSUE.MEAT, { morph: 1, rho: r / R, theta: nub.th, foot: ni });
        // Both muscles run to the two ENDS of the spine. Two lengths locate
        // a point well only if their anchors subtend a wide angle at it; a
        // pair of neighbouring vertebrae seen from a foot is a sliver of a
        // triangle, and a foot hung from one lags its orders by a third of
        // a stride.
        const b1 = 0, b2 = bones.length - 1;
        feet.push({ meat: idx, b1: bones[b1], b2: bones[b2], phase: 0, c1: -1, c2: -1 });
    });

    // -- MEAT: a hex lattice filling the space between bone and skin. It is
    //    generated in Cartesian coordinates on the symmetric outline and then
    //    stored as (rho, theta) -- a fraction of the outline radius at an
    //    angle -- so it follows the outline as the head moves from one end
    //    to the other.
    const h = B.MEAT_SPACING;
    const cand = [];
    const rows = Math.ceil(b * 1.8 / (h * 0.866));
    const cols = Math.ceil(a * 1.6 / h);
    for (let row = -rows; row <= rows; row++) {
        const y0 = row * h * 0.866;
        for (let col = -cols; col <= cols; col++) {
            const x = col * h + (row & 1 ? h * 0.5 : 0) + (rng() - 0.5) * h * 0.22;
            const y = y0 + (rng() - 0.5) * h * 0.22;
            const r = Math.hypot(x, y);
            const th = Math.atan2(y, x);
            const R = outlineR(plan, th, 0.5);
            if (R - r < B.MEAT_MARGIN * h) continue;
            let clash = false;
            for (const bi of bones) if (Math.hypot(fx[bi] - x, fy[bi] - y) < h * 0.42) clash = true;
            if (clash) continue;
            cand.push({ x, y, rho: r / R, th });
        }
    }
    // Order the lattice coarse-to-fine by farthest-point sampling: each next
    // node is the one farthest from everything already placed. Any prefix of
    // that order is an evenly spread subset, so a baby is the first third of
    // the list and growing is simply switching on the next node.
    const placedX = [], placedY = [];
    bones.forEach((bi) => { placedX.push(fx[bi]); placedY.push(fy[bi]); });
    feet.forEach((f) => {
        const R = outlineR(plan, theta[f.meat], 0.5) * rho[f.meat];
        placedX.push(R * Math.cos(theta[f.meat])); placedY.push(R * Math.sin(theta[f.meat]));
    });
    const dmin = cand.map((c) => {
        let d = 1e9;
        for (let k = 0; k < placedX.length; k++) d = Math.min(d, Math.hypot(c.x - placedX[k], c.y - placedY[k]));
        return d;
    });
    const used = new Array(cand.length).fill(false);
    const order = [];
    for (let n = 0; n < cand.length; n++) {
        let best = -1, bd = -1;
        for (let k = 0; k < cand.length; k++) if (!used[k] && dmin[k] > bd) { bd = dmin[k]; best = k; }
        used[best] = true; order.push(best);
        for (let k = 0; k < cand.length; k++) {
            if (!used[k]) dmin[k] = Math.min(dmin[k], Math.hypot(cand[k].x - cand[best].x, cand[k].y - cand[best].y));
        }
    }
    const L = CFG.LIFE;
    const M = order.length;
    const M0 = Math.max(4, Math.ceil(M * B.MEAT_BABY_FRAC));
    const lattice = [];
    order.forEach((ci, j) => {
        const c = cand[ci];
        const birthAt = j < M0 ? 0 : L.SCALE_HATCH + 0.02 + (1.0 - L.SCALE_HATCH - 0.02) * ((j - M0 + 1) / Math.max(1, M - M0));
        lattice.push(add(TISSUE.MEAT, { morph: 1, rho: c.rho, theta: c.th, birth: birthAt }));
    });

    // -- BLOOD: loose particles in the cavity. No rest position; they are
    //    placed around the spine and find their own level.
    const nBlood = Math.max(8, Math.min(40, Math.round(B.BLOOD_COUNT * ph.blood * ph.size * ph.size)));
    const B0 = Math.max(3, Math.ceil(nBlood * B.BLOOD_BABY_FRAC));
    const blood = [];
    for (let k = 0; k < nBlood; k++) {
        const ang = rng() * 6.283, rr = Math.sqrt(rng());
        const birthAt = k < B0 ? 0 : L.SCALE_HATCH + 0.02 + (1.0 - L.SCALE_HATCH - 0.02) * ((k - B0 + 1) / Math.max(1, nBlood - B0));
        blood.push(add(TISSUE.BLOOD, { x: Math.cos(ang) * rr * a * 0.4, y: b * 0.05 + Math.sin(ang) * rr * b * 0.35, birth: birthAt }));
    }

    plan.n = tissue.length;
    plan.tissue = Uint8Array.from(tissue);
    plan.mass = Float32Array.from(mass);
    plan.rho = Float32Array.from(rho);
    plan.theta = Float32Array.from(theta);
    plan.cosT = Float32Array.from(theta, Math.cos);
    plan.sinT = Float32Array.from(theta, Math.sin);
    plan.fx = Float32Array.from(fx);
    plan.fy = Float32Array.from(fy);
    plan.morph = Uint8Array.from(morph);
    plan.birth = Float32Array.from(birth);
    plan.foot = Int8Array.from(foot);
    plan.bones = bones;
    plan.ring = ring;
    plan.feet = feet;
    plan.lattice = lattice;
    plan.blood = blood;
    plan.latticePitch = h;
    // Rest positions on the symmetric (mid-turn) outline. Which particles
    // are neighbours is decided from these and nothing else, so the
    // constraint set depends only on which particles exist -- not on which
    // way the animal happened to be facing when it was last rebuilt.
    plan.sx = new Float32Array(plan.n);
    plan.sy = new Float32Array(plan.n);
    for (let i = 0; i < plan.n; i++) {
        if (plan.morph[i]) {
            const R = outlineR(plan, plan.theta[i], 0.5) * plan.rho[i];
            plan.sx[i] = R * plan.cosT[i]; plan.sy[i] = R * plan.sinT[i];
        } else { plan.sx[i] = plan.fx[i]; plan.sy[i] = plan.fy[i]; }
    }

    // -- muscle schedule
    // gait 0, inchworm: the feet cycle one after another, tail to head, a
    //                   wave of planted feet travelling up the body
    // gait 1, hop:      every foot in phase
    plan.gait = ph.gait;
    feet.forEach((f, k) => { f.phase = ph.gait === 1 ? 0 : -(k / feet.length) * CFG.GAIT.WAVE * 2; });

    // -- ring landmarks (positions in the ring, not particle indices)
    const nearestRing = (th) => {
        let best = 0, bd = 1e9;
        for (let e = 0; e < nSkin; e++) {
            if (ringFoot[e] >= 0) continue;
            const d = Math.abs(angDiff(ringTh[e], th));
            if (d < bd) { bd = d; best = e; }
        }
        return best;
    };
    plan.mouthR = nearestRing(B.MOUTH_ANGLE);
    plan.mouthL = nearestRing(Math.PI - B.MOUTH_ANGLE);
    plan.tailR = nearestRing(Math.PI - 0.35);
    plan.tailL = nearestRing(0.35);

    // -- face, in unit rest coordinates when facing right
    const headR = outlineR(plan, plan.headTh, 1) * 0.56;
    plan.face = {
        hx: headR * Math.cos(plan.headTh),
        hy: headR * Math.sin(plan.headTh),
        eyeR: B.EYE_BASE_R * ph.eyeSize,
        eyeGap: B.EYE_BASE_GAP * ph.eyeGap * (0.8 + 0.2 * ph.eyeSize),
    };

    // -- palette and pattern
    const primary = hsl(ph.hue, ph.sat, 0.6);
    const secondary = hsl(ph.hue + ph.patternHue, Math.min(1, ph.sat * 1.05), 0.42);
    plan.palette = {
        primary, secondary,
        outline: hsl(ph.hue, Math.min(1, ph.sat * 1.1), 0.27),
        belly: hsl(ph.hue, ph.sat * 0.7, 0.8),
        css: `hsl(${ph.hue.toFixed(0)},${(ph.sat * 100).toFixed(0)}%,60%)`,
    };
    plan.pattern = { type: ph.pattern, spots: [], period: 3.4 * ph.patternSize, slant: (rng() - 0.5) * 1.2 };
    if (ph.pattern === 1) {
        const n = 5 + Math.floor(rng() * 5);
        for (let k = 0; k < n; k++) {
            plan.pattern.spots.push({
                rho: 0.15 + 0.7 * Math.sqrt(rng()), th: rng() * 6.283 - Math.PI,
                r: b * (0.16 + 0.14 * rng()) * ph.patternSize,
            });
        }
    }
    return plan;
}

// Rest outline polygon at unit scale, for thumbnails.
export function restOutline(plan, wR = 1, n = 96) {
    const pts = [];
    for (let k = 0; k < n; k++) {
        const th = -Math.PI + (k / n) * 2 * Math.PI;
        const r = outlineR(plan, th, wR);
        pts.push([r * Math.cos(th), r * Math.sin(th)]);
    }
    return pts;
}
