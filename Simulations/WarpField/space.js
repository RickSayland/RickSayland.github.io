// ============ WARP FIELD ENGINEERING — LOCAL SPACE ============
// Where everything is. Zero DOM.
//
// Heliocentric ecliptic J2000 coordinates in metres throughout; time is
// seconds since J2000 (TT and UTC are treated as the same clock). Planets
// come from JPL's approximate Keplerian elements (Standish, valid 1800–2050,
// good to a fraction of a degree), the Moon from Schlyter's low-precision
// series. Named stars carry their real positions and distances, so flying
// ten light-years genuinely rearranges the nearby ones: from α Centauri the
// Sun is a zero-magnitude star in Cassiopeia. The faint background is
// procedural and sits at infinity, concentrated toward the galactic plane.

const DEG = Math.PI / 180;
const OBLIQUITY = 23.4392911 * DEG;

// [id, name, [a AU, e, I, L, ϖ, Ω] at J2000, per-century rates, radius km, colour, geometric albedo, mass kg]
const PLANET_ELEMENTS = [
    ['mercury', 'Mercury', [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
        [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081], 2439.7, '#a39e96', 0.142, 3.301e23],
    ['venus', 'Venus', [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
        [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418], 6051.8, '#eadfb4', 0.689, 4.867e24],
    ['earth', 'Earth', [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
        [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0], 6371.0, '#5b8fd6', 0.434, 5.972e24],
    ['mars', 'Mars', [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
        [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343], 3389.5, '#c9693f', 0.170, 6.417e23],
    ['jupiter', 'Jupiter', [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
        [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106], 69911, '#d9ba8f', 0.538, 1.898e27],
    ['saturn', 'Saturn', [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
        [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794], 58232, '#e3d09d', 0.499, 5.683e26],
    ['uranus', 'Uranus', [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
        [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589], 25362, '#a8dae2', 0.488, 8.681e25],
    ['neptune', 'Neptune', [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
        [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664], 24622, '#5f82da', 0.442, 1.024e26],
    ['pluto', 'Pluto', [39.48211675, 0.24882730, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
        [-0.00031596, 0.00005170, 0.00004818, 145.20780515, -0.04062942, -0.01183482], 1188.3, '#cdb89e', 0.52, 1.303e22]
];

// Named stars: [name, RA°, Dec°, V (from Earth), distance ly, T_eff K, radius R☉ (0 = unknown), target?]
const STAR_CATALOG = [
    ['α Centauri A', 219.902, -60.834, 0.01, 4.37, 5790, 1.22, true],
    ['Proxima Centauri', 217.429, -62.680, 11.13, 4.246, 3042, 0.154, true],
    ['Barnard\'s Star', 269.452, 4.693, 9.51, 5.96, 3134, 0.19, true],
    ['Wolf 359', 164.120, 7.015, 13.5, 7.86, 2800, 0.16, true],
    ['Lalande 21185', 165.834, 35.970, 7.52, 8.31, 3547, 0.39, true],
    ['Sirius', 101.287, -16.716, -1.46, 8.60, 9940, 1.71, true],
    ['UV Ceti', 24.756, -17.950, 12.5, 8.73, 2670, 0.14, false],
    ['Ross 154', 282.458, -23.836, 10.4, 9.69, 3340, 0.24, false],
    ['Ross 248', 355.480, 44.178, 12.3, 10.3, 2800, 0.16, false],
    ['ε Eridani', 53.233, -9.458, 3.73, 10.47, 5084, 0.74, true],
    ['Lacaille 9352', 346.467, -35.853, 7.34, 10.7, 3690, 0.47, false],
    ['Ross 128', 176.935, 0.804, 11.1, 11.0, 3190, 0.20, false],
    ['61 Cygni A', 316.725, 38.749, 5.21, 11.4, 4526, 0.67, true],
    ['Procyon', 114.826, 5.225, 0.34, 11.46, 6530, 2.05, true],
    ['ε Indi', 330.840, -56.786, 4.69, 11.87, 4630, 0.71, false],
    ['τ Ceti', 26.017, -15.937, 3.50, 11.9, 5344, 0.79, true],
    ['Altair', 297.696, 8.868, 0.76, 16.7, 7700, 1.79, true],
    ['Vega', 279.235, 38.784, 0.03, 25.0, 9600, 2.36, true],
    ['Fomalhaut', 344.413, -29.622, 1.16, 25.1, 8600, 1.84, false],
    ['Pollux', 116.329, 28.026, 1.14, 33.8, 4670, 9.1, false],
    ['Arcturus', 213.915, 19.182, -0.05, 36.7, 4290, 25.4, true],
    ['Denebola', 177.265, 14.572, 2.14, 35.9, 8500, 0, false],
    ['Capella', 79.172, 45.998, 0.08, 42.9, 4970, 0, false],
    ['Rasalhague', 263.734, 12.560, 2.08, 48.6, 8000, 0, false],
    ['Alderamin', 319.645, 62.586, 2.45, 49, 7700, 0, false],
    ['Castor', 113.650, 31.888, 1.58, 51, 10300, 0, false],
    ['Caph', 2.295, 59.150, 2.28, 55, 7080, 0, false],
    ['Zosma', 168.527, 20.524, 2.56, 58, 9000, 0, false],
    ['Menkent', 211.671, -36.370, 2.06, 59, 4980, 0, false],
    ['Aldebaran', 68.980, 16.509, 0.86, 65.3, 3900, 44, true],
    ['Hamal', 31.793, 23.462, 2.00, 66, 4480, 0, false],
    ['Gienah', 311.553, 33.970, 2.48, 72, 4700, 0, false],
    ['Unukalhai', 236.067, 6.426, 2.63, 74, 4600, 0, false],
    ['Alphecca', 233.672, 26.715, 2.23, 75, 9700, 0, false],
    ['Zubenelgenubi', 222.720, -16.042, 2.75, 76, 8000, 0, false],
    ['Regulus', 152.093, 11.967, 1.35, 79.3, 12500, 0, false],
    ['Merak', 165.460, 56.382, 2.37, 79.7, 9380, 0, false],
    ['Megrez', 183.857, 57.033, 3.31, 80.5, 9000, 0, false],
    ['Alsephina', 131.176, -54.709, 1.96, 80.6, 9500, 0, false],
    ['Menkalinan', 89.882, 44.948, 1.90, 81, 9200, 0, false],
    ['Alioth', 193.507, 55.960, 1.77, 82.6, 9400, 0, false],
    ['Mizar', 200.981, 54.925, 2.23, 82.9, 9000, 0, false],
    ['Phecda', 178.458, 53.695, 2.44, 83, 9360, 0, false],
    ['Ankaa', 6.571, -42.306, 2.40, 85, 4400, 0, false],
    ['Sabik', 257.595, -15.725, 2.43, 88, 8600, 0, false],
    ['Ascella', 285.653, -29.880, 2.60, 88, 9000, 0, false],
    ['Gacrux', 187.791, -57.113, 1.63, 88.6, 3600, 0, false],
    ['Algol', 47.042, 40.956, 2.12, 90, 13000, 0, false],
    ['Diphda', 10.897, -17.987, 2.04, 96, 4800, 0, false],
    ['Alpheratz', 2.097, 29.090, 2.06, 97, 13800, 0, false],
    ['Ruchbah', 21.454, 60.235, 2.68, 99, 8400, 0, false],
    ['Alnair', 332.058, -46.961, 1.74, 101, 13900, 0, false],
    ['Alkaid', 206.885, 49.313, 1.86, 104, 15500, 0, false],
    ['Alhena', 99.428, 16.399, 1.92, 109, 9260, 0, false],
    ['Cor Caroli', 194.007, 38.318, 2.89, 110, 11000, 0, false],
    ['Vindemiatrix', 195.544, 10.959, 2.83, 110, 5100, 0, false],
    ['Miaplacidus', 138.300, -69.717, 1.67, 113, 9000, 0, false],
    ['Dubhe', 165.932, 61.751, 1.79, 123, 4660, 0, false],
    ['Kochab', 222.676, 74.156, 2.08, 131, 4030, 0, false],
    ['Algieba', 154.993, 19.842, 2.08, 130, 4470, 0, false],
    ['Markab', 346.190, 15.205, 2.48, 133, 9800, 0, false],
    ['Elnath', 81.573, 28.608, 1.65, 134, 13600, 0, false],
    ['Achernar', 24.429, -57.237, 0.46, 139, 15000, 0, false],
    ['Kaus Australis', 276.043, -34.385, 1.85, 143, 9960, 0, false],
    ['Eltanin', 269.152, 51.489, 2.23, 154, 3930, 0, false],
    ['Alphard', 141.897, -8.659, 1.98, 177, 4120, 0, false],
    ['Peacock', 306.412, -56.735, 1.94, 179, 17000, 0, false],
    ['Scheat', 345.944, 28.083, 2.42, 196, 3700, 0, false],
    ['Mirach', 17.433, 35.621, 2.05, 197, 3840, 0, false],
    ['Izar', 221.247, 27.074, 2.37, 202, 4550, 0, false],
    ['Schedar', 10.127, 56.537, 2.24, 228, 4660, 0, false],
    ['Nunki', 283.816, -26.297, 2.05, 228, 18900, 0, false],
    ['Spica', 201.298, -11.161, 0.97, 250, 22400, 0, false],
    ['Bellatrix', 81.283, 6.350, 1.64, 250, 22000, 0, false],
    ['Menkar', 45.570, 4.090, 2.54, 250, 3800, 0, false],
    ['Mimosa', 191.930, -59.689, 1.25, 280, 27000, 0, false],
    ['Sargas', 264.330, -42.998, 1.86, 300, 7200, 0, false],
    ['Canopus', 95.988, -52.696, -0.74, 310, 7350, 0, true],
    ['Acrux', 186.650, -63.099, 0.77, 320, 28000, 0, false],
    ['Almach', 30.975, 42.330, 2.10, 350, 4250, 0, false],
    ['Kaus Media', 275.249, -29.828, 2.70, 350, 4200, 0, false],
    ['Hadar', 210.956, -60.373, 0.61, 390, 25000, 0, false],
    ['Algenib', 3.309, 15.184, 2.83, 390, 22000, 0, false],
    ['Atria', 252.166, -69.028, 1.91, 391, 4150, 0, false],
    ['Tarazed', 296.565, 10.613, 2.72, 395, 4100, 0, false],
    ['Dschubba', 240.083, -22.622, 2.29, 400, 28000, 0, false],
    ['Segin', 28.599, 63.670, 3.37, 410, 15000, 0, false],
    ['Adhara', 104.656, -28.972, 1.50, 430, 22000, 0, false],
    ['Polaris', 37.955, 89.264, 1.98, 433, 6000, 0, true],
    ['Albireo', 292.680, 27.960, 3.05, 430, 4400, 0, false],
    ['Mirzam', 95.675, -17.956, 1.98, 500, 25000, 0, false],
    ['Mirfak', 51.081, 49.861, 1.79, 510, 6350, 0, false],
    ['Suhail', 136.999, -43.433, 2.21, 545, 4000, 0, false],
    ['Betelgeuse', 88.793, 7.407, 0.50, 548, 3600, 764, true],
    ['Antares', 247.352, -26.432, 0.96, 550, 3500, 680, false],
    ['Navi', 14.177, 60.717, 2.15, 550, 25000, 0, false],
    ['Shaula', 263.402, -37.104, 1.62, 570, 25000, 0, false],
    ['Avior', 125.628, -59.510, 1.86, 630, 4000, 0, false],
    ['Saiph', 86.939, -9.670, 2.07, 650, 26000, 0, false],
    ['Enif', 326.046, 9.875, 2.39, 690, 4400, 0, false],
    ['Aspidiske', 139.273, -59.275, 2.21, 690, 7500, 0, false],
    ['Rigel', 78.634, -8.202, 0.13, 860, 12100, 79, true],
    ['Naos', 120.896, -40.003, 2.21, 1080, 40000, 0, false],
    ['Mintaka', 83.002, -0.299, 2.23, 1200, 29500, 0, false],
    ['Alnitak', 85.190, -1.943, 1.74, 1260, 29000, 0, false],
    ['Wezen', 107.098, -26.393, 1.83, 1600, 6000, 0, false],
    ['Sadr', 305.557, 40.257, 2.23, 1800, 5800, 0, false],
    ['Alnilam', 84.053, -1.202, 1.69, 2000, 27000, 0, false],
    ['Arneb', 83.183, -17.822, 2.58, 2200, 6900, 0, false],
    ['Deneb', 310.358, 45.280, 1.25, 2600, 8500, 0, true]
];

function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

const space = {
    bodies: [],
    byId: {},
    stars: [],
    bg: null,              // Float32Array: x, y, z, mag, T per star
    bgCount: 0,

    init() {
        this.bodies = [];
        this.bodies.push({
            id: 'sun', name: 'Sun', type: 'star', radius: 6.957e8, color: '#fff4d6',
            absMag: 4.83, T: 5772, standoff: 30 * 6.957e8
        });
        for (const p of PLANET_ELEMENTS) {
            this.bodies.push({
                id: p[0], name: p[1], type: 'planet', el: p[2], rate: p[3],
                radius: p[4] * 1e3, color: p[5], albedo: p[6], mass: p[7], standoff: 8 * p[4] * 1e3
            });
        }
        this.bodies.push({
            id: 'moon', name: 'Moon', type: 'moon', radius: 1.7374e6, color: '#bdb8ae',
            albedo: 0.12, mass: 7.342e22, standoff: 6 * 1.7374e6
        });
        for (const b of this.bodies) this.byId[b.id] = b;

        this.stars = STAR_CATALOG.map(s => {
            const [name, ra, dec, V, ly, T, rsun, target] = s;
            const dir = this.eqToEcl(this.raDec(ra, dec));
            const d = ly * PHYS.LY;
            const absMag = V - 5 * Math.log10(d / PHYS.PC / 10);
            // Where a star has no measured radius, back one out of its
            // luminosity and temperature — close enough to size a disc.
            const L = Math.pow(10, -0.4 * (absMag - 4.83));
            const radius = (rsun || Math.sqrt(L) / Math.pow(T / 5772, 2)) * 6.957e8;
            return {
                id: 'star:' + name, name, type: 'star', pos: [dir[0] * d, dir[1] * d, dir[2] * d],
                absMag, T, radius, target, ly,
                // Park where the star is as bright as the Sun from 1.5 AU,
                // but never closer than twenty stellar radii.
                standoff: Math.max(20 * radius, 1.5 * PHYS.AU * Math.pow(10, -0.2 * (absMag - 4.83)))
            };
        });
        for (const s of this.stars) this.byId[s.id] = s;

        this.buildBackground(5200);
    },

    raDec(raDeg, decDeg) {
        const ra = raDeg * DEG, dec = decDeg * DEG;
        return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
    },
    eqToEcl(v) {
        const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
        return [v[0], c * v[1] + s * v[2], -s * v[1] + c * v[2]];
    },
    eclToEq(v) {
        const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
        return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]];
    },

    // Faint stars, seeded. Most are drawn toward the galactic plane — a
    // Laplace profile in latitude plus a bulge toward the centre — which is
    // what turns five thousand dots into the Milky Way.
    buildBackground(n) {
        const rnd = mulberry32(0x5eed);
        const out = new Float32Array(n * 5);
        // Galactic → equatorial (J2000): transpose of the IAU matrix.
        const T = [[-0.0548755604, -0.8734370902, -0.4838350155],
                   [0.4941094279, -0.4448296300, 0.7469822445],
                   [-0.8676661490, -0.1980763734, 0.4559837762]];
        for (let i = 0; i < n; i++) {
            let l, b;
            const u = rnd();
            if (u < 0.4) {
                l = rnd() * 2 * Math.PI;
                b = Math.asin(2 * rnd() - 1);
            } else if (u < 0.85) {
                l = rnd() * 2 * Math.PI;
                const e = -Math.log(1 - rnd()) * 7 * DEG;
                b = rnd() < 0.5 ? e : -e;
            } else {
                const g1 = Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
                const g2 = Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
                l = g1 * 14 * DEG;
                b = g2 * 7 * DEG;
            }
            const g = [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
            const eq = [
                T[0][0] * g[0] + T[1][0] * g[1] + T[2][0] * g[2],
                T[0][1] * g[0] + T[1][1] * g[1] + T[2][1] * g[2],
                T[0][2] * g[0] + T[1][2] * g[1] + T[2][2] * g[2]
            ];
            const ec = this.eqToEcl(eq);
            // Number counts rise ~×3 per magnitude.
            const a = 0.47, m0 = 3.2, m1 = 8.2;
            const lo = Math.pow(10, a * m0), hi = Math.pow(10, a * m1);
            const mag = Math.log10(lo + rnd() * (hi - lo)) / a;
            const tr = rnd();
            const Teff = tr < 0.45 ? 4000 + rnd() * 1200 : tr < 0.8 ? 5500 + rnd() * 2500 : tr < 0.95 ? 8000 + rnd() * 5000 : 3200 + rnd() * 700;
            out.set([ec[0], ec[1], ec[2], mag, Teff], i * 5);
        }
        this.bg = out;
        this.bgCount = n;
    },

    // ---- Time ----

    jdToSec(jd) { return (jd - 2451545.0) * 86400; },
    nowSec() { return (Date.now() / 86400000 + 2440587.5 - 2451545.0) * 86400; },
    secToDate(t) { return new Date((t / 86400 + 2451545.0 - 2440587.5) * 86400000); },

    // ---- Ephemeris ----

    kepler(el, rate, T, out) {
        const a = el[0] + rate[0] * T, e = el[1] + rate[1] * T;
        const I = (el[2] + rate[2] * T) * DEG;
        const L = el[3] + rate[3] * T, lp = el[4] + rate[4] * T, node = el[5] + rate[5] * T;
        let M = ((L - lp) % 360 + 540) % 360 - 180;
        M *= DEG;
        let E = M + e * Math.sin(M);
        for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
        const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
        const w = (lp - node) * DEG, O = node * DEG;
        const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
        out[0] = ((cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp) * PHYS.AU;
        out[1] = ((cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp) * PHYS.AU;
        out[2] = ((sw * sI) * xp + (cw * sI) * yp) * PHYS.AU;
        return out;
    },

    // Geocentric Moon (Schlyter). The mean elements alone are good to a
    // degree or two, which at 384,000 km is a few Moon-widths — fine for a
    // place to fly to, not for an eclipse.
    moonGeo(t, out) {
        const d = t / 86400 + 1.5;          // days since 2000 Jan 0.0
        const N = (125.1228 - 0.0529538083 * d) * DEG;
        const i = 5.1454 * DEG;
        const w = (318.0634 + 0.1643573223 * d) * DEG;
        const a = 60.2666 * 6378.14e3, e = 0.054900;
        const M = ((115.3654 + 13.0649929509 * d) % 360) * DEG;
        let E = M + e * Math.sin(M);
        for (let k = 0; k < 6; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
        const xv = a * (Math.cos(E) - e), yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
        const v = Math.atan2(yv, xv), r = Math.hypot(xv, yv);
        const cN = Math.cos(N), sN = Math.sin(N), cvw = Math.cos(v + w), svw = Math.sin(v + w), ci = Math.cos(i);
        out[0] = r * (cN * cvw - sN * svw * ci);
        out[1] = r * (sN * cvw + cN * svw * ci);
        out[2] = r * (svw * Math.sin(i));
        return out;
    },

    _tmp: [0, 0, 0],
    bodyPos(id, t, out) {
        out = out || [0, 0, 0];
        const b = this.byId[id];
        if (id === 'sun') { out[0] = out[1] = out[2] = 0; return out; }
        if (b.type === 'star') { out[0] = b.pos[0]; out[1] = b.pos[1]; out[2] = b.pos[2]; return out; }
        const T = t / (86400 * 36525);
        if (id === 'moon' || id === 'earth') {
            const emb = this.kepler(this.byId.earth.el, this.byId.earth.rate, T, [0, 0, 0]);
            const m = this.moonGeo(t, this._tmp);
            // Earth sits 1/82.3 of the way from the barycentre toward the
            // Moon's opposite side.
            const k = 1 / 82.3;
            const ex = emb[0] - m[0] * k, ey = emb[1] - m[1] * k, ez = emb[2] - m[2] * k;
            if (id === 'earth') { out[0] = ex; out[1] = ey; out[2] = ez; }
            else { out[0] = ex + m[0]; out[1] = ey + m[1]; out[2] = ez + m[2]; }
            return out;
        }
        return this.kepler(b.el, b.rate, T, out);
    },

    // Where a body is SEEN from `from` at time t: its position when the
    // light left it. One iteration is plenty — nothing here moves at more
    // than 1e-4 c.
    apparentPos(id, t, from, out) {
        out = this.bodyPos(id, t, out);
        const b = this.byId[id];
        if (b.type === 'star') return out;
        const d = Math.hypot(out[0] - from[0], out[1] - from[1], out[2] - from[2]);
        return this.bodyPos(id, t - d / PHYS.c, out);
    },

    // Protons per cubic metre: the solar wind (~5 cm⁻³ at 1 AU, falling as
    // 1/r²) over the local interstellar cloud (~0.1 cm⁻³).
    mediumDensity(pos) {
        const r2 = (pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2]) / (PHYS.AU * PHYS.AU);
        return 5e6 / Math.max(r2, 1e-4) + 1e5;
    },

    // Laplace sphere of influence, a (m / M)^(2/5): inside it a body's own
    // frame is the one that matters. The Moon's is measured against Earth.
    soi(id, t) {
        const b = this.byId[id];
        if (!b || b.type === 'star') return Infinity;
        const p = this.bodyPos(id, t, [0, 0, 0]);
        if (id === 'moon') {
            const e = this.bodyPos('earth', t, [0, 0, 0]);
            const a = Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2]);
            return a * Math.pow(b.mass / 5.972e24, 0.4);
        }
        return Math.hypot(p[0], p[1], p[2]) * Math.pow(b.mass / PHYS.M_SUN, 0.4);
    },

    // The frame a ship at `pos` should keep station in: the innermost sphere
    // of influence it sits inside, or the Sun's.
    frameAt(pos, t) {
        const p = [0, 0, 0];
        for (const id of ['moon', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']) {
            this.bodyPos(id, t, p);
            if (Math.hypot(p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]) < this.soi(id, t)) return id;
        }
        return 'sun';
    },

    // Nearest solid body to a point, for proximity alarms.
    nearest(pos, t) {
        let best = null, bd = Infinity;
        const p = [0, 0, 0];
        for (const b of this.bodies) {
            this.bodyPos(b.id, t, p);
            const d = Math.hypot(p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]) - b.radius;
            if (d < bd) { bd = d; best = b; }
        }
        return { body: best, dist: bd };
    }
};
