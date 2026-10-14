// ============ OPENSTREETRPG — GEOGRAPHY ============
// Web Mercator, the projection every OSM tile is cut in. Zero DOM.
//
// World positions are NORMALISED mercator: x and y both run 0..1 across the
// whole planet, x eastwards from the antimeridian, y southwards from 85.05°N.
// At zoom z the world is 256·2^z pixels square, so a position becomes a pixel
// by one multiply and a tile index by one floor. The projection is conformal,
// so a step of the same size in x and in y covers the same ground — which is
// what lets the player move in these units directly.

const geo = {

    TILE: 256,
    EARTH_CIRC: 40075016.686,       // m, equatorial
    MAX_LAT: 85.0511287798,         // where mercator y reaches 0 and 1

    toX(lon) { return (lon + 180) / 360; },

    toY(lat) {
        const s = Math.sin(clamp(lat, -this.MAX_LAT, this.MAX_LAT) * Math.PI / 180);
        return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
    },

    toLon(x) { return x * 360 - 180; },

    toLat(y) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI; },

    // The world's width in CSS pixels at a (possibly fractional) zoom.
    worldPx(zoom) { return this.TILE * Math.pow(2, zoom); },

    // Metres on the ground per normalised unit at mercator y. Mercator
    // stretches by 1/cos(lat), so the same step is shorter towards the poles.
    metresPerUnit(y) { return this.EARTH_CIRC * Math.cos(this.toLat(y) * Math.PI / 180); },

    wrapX(x) { return x - Math.floor(x); },

    // Shortest signed a − b in x, taking the antimeridian into account.
    dx(a, b) {
        let d = a - b;
        if (d > 0.5) d -= 1;
        else if (d < -0.5) d += 1;
        return d;
    }
};
