"""Regenerate Simulations/GeoSim/landData.js from Natural Earth 50m land.

    python tools/fetchLand.py ../landData.js

Standard library only. landData.js is generated — edit this instead.
"""

import json, urllib.request, sys

url = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson"
print(f"Fetching {url}...", file=sys.stderr)
data = json.loads(urllib.request.urlopen(url, timeout=30).read())


def simplify(pts, tol):
    """Iterative Douglas-Peucker on [lat, lon] points."""
    n = len(pts)
    if n < 3:
        return pts
    keep = [False] * n
    keep[0] = keep[n - 1] = True
    stack = [(0, n - 1)]
    tol2 = tol * tol
    while stack:
        lo, hi = stack.pop()
        if hi <= lo + 1:
            continue
        ay, ax = pts[lo]
        by, bx = pts[hi]
        dx, dy = bx - ax, by - ay
        span = dx * dx + dy * dy
        best, bestd = -1, -1.0
        for i in range(lo + 1, hi):
            py, px = pts[i]
            if span > 0:
                t = ((px - ax) * dx + (py - ay) * dy) / span
                t = 0.0 if t < 0 else (1.0 if t > 1 else t)
                ex, ey = ax + t * dx, ay + t * dy
            else:
                ex, ey = ax, ay
            d = (px - ex) ** 2 + (py - ey) ** 2
            if d > bestd:
                best, bestd = i, d
        if bestd > tol2:
            keep[best] = True
            stack.append((lo, best))
            stack.append((best, hi))
    return [p for i, p in enumerate(pts) if keep[i]]


def add_ring(ring, out):
    converted = [[round(p[1], 1), round(p[0], 1)] for p in ring]
    # Drop the duplicated closing vertex; the renderer closes paths itself.
    if len(converted) > 1 and converted[0] == converted[-1]:
        converted.pop()
    # Collapse consecutive duplicates introduced by rounding.
    deduped = [converted[0]]
    for pt in converted[1:]:
        if pt != deduped[-1]:
            deduped.append(pt)
    if len(deduped) < 3:
        return
    # Drop collinear runs left over from the 0.1-degree grid. At max zoom one
    # pixel spans ~0.066 degrees, so this stays under a pixel of error.
    deduped = simplify(deduped, 0.05)
    if len(deduped) < 3:
        return
    out.append(deduped)


polygons = []
for feature in data['features']:
    geom = feature['geometry']
    # Outer ring only ([0]) — inner rings are lakes, and the renderer would
    # fill them as land.
    if geom['type'] == 'Polygon':
        add_ring(geom['coordinates'][0], polygons)
    elif geom['type'] == 'MultiPolygon':
        for poly in geom['coordinates']:
            add_ring(poly[0], polygons)

polygons.sort(key=len, reverse=True)

out = ["const LAND = ["]
for poly in polygons:
    flat = ",".join(f"[{p[0]},{p[1]}]" for p in poly)
    out.append(f"  [{flat}],")
out.append("];")

result = "\n".join(out)
print(f"Generated {len(polygons)} polygons, {sum(len(p) for p in polygons)} total points", file=sys.stderr)
print(f"Output size: {len(result)} chars", file=sys.stderr)

outpath = sys.argv[1] if len(sys.argv) > 1 else "landData.js"
with open(outpath, "w") as f:
    f.write(result)
print(f"Wrote {outpath}", file=sys.stderr)
