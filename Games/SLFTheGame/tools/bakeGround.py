#!/usr/bin/env python3
"""Bake the labeled content/ground.png tilesheet into content/ground_atlas.png.

ground.png is a labeled sheet: a left column of terrain labels then an 8-wide
grid of variant tiles, one row per terrain type (GRASS, WATER, SAND, TREE, ROCK,
FOREST) on a near-black background. This produces a clean uniform atlas the game
samples with plain col*TS,row*TS math (see the TileSheet class in sprite.js):

  * Fill terrains (grass/water/sand/rock/forest) are cropped to a TSxTS square
    from the *interior* of each tile — trimming the tiles' darker rim so they
    abut seamlessly when drawn edge to edge at the game's tile size.
  * The TREE row is treated as objects: the dark background is keyed to
    transparency, each tree is trimmed and scaled to fit the cell, then
    bottom-anchored so it sits on the grass base map.js draws underneath it.

Atlas layout matches ground.png: row 0 grass .. row 5 forest, 8 variant columns.

Usage:  python bakeGround.py
"""
import os
from collections import deque
from PIL import Image

BG = (14, 16, 17)
KEY = 26 * 26          # squared bg-distance below the dark tree outlines (~40+)
TS = 118               # atlas cell size (and fill-tile interior crop size)

# Grid geometry measured from ground.png (1254x1112)
COL_CENTERS = [203, 344, 483, 621, 758, 898, 1035, 1172]
# (terrain, mode, y-center or band)
ROWS = [
    ('grass',  'fill',   119),
    ('water',  'fill',   297),
    ('sand',   'fill',   473),
    ('tree',   'object', (558, 732)),
    ('rock',   'fill',   841),
    ('forest', 'fill',   1018),
]


def d2(c):
    return (c[0] - BG[0]) ** 2 + (c[1] - BG[1]) ** 2 + (c[2] - BG[2]) ** 2


def crop_fill(px, cx, cy):
    """Opaque TSxTS interior square centered on the tile."""
    half = TS // 2
    cell = Image.new('RGBA', (TS, TS), (0, 0, 0, 255))
    cp = cell.load()
    for yy in range(TS):
        for xx in range(TS):
            r, g, b, *_ = px[cx - half + xx, cy - half + yy]
            cp[xx, yy] = (r, g, b, 255)
    return cell


def crop_object(px, cx, band):
    """Transparent, trimmed, bottom-anchored object (tree) fit into a TS cell."""
    x0, x1 = cx - 69, cx + 69
    y0, y1 = band
    cw, ch = x1 - x0, y1 - y0
    buf = [[list(px[x0 + x, y0 + y][:3]) + [255] for x in range(cw)] for y in range(ch)]

    # flood-fill background -> transparent from the border
    seen = [[False] * cw for _ in range(ch)]
    q = deque()
    for x in range(cw):
        q.append((x, 0)); q.append((x, ch - 1))
    for y in range(ch):
        q.append((0, y)); q.append((cw - 1, y))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= cw or y >= ch or seen[y][x]:
            continue
        seen[y][x] = True
        r, g, b, _ = buf[y][x]
        if d2((r, g, b)) < KEY:
            buf[y][x][3] = 0
            q.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])

    # keep only the largest connected component (drops stray specks)
    lab = [[0] * cw for _ in range(ch)]
    comps = []
    cid = 0
    for sy in range(ch):
        for sx in range(cw):
            if buf[sy][sx][3] > 0 and lab[sy][sx] == 0:
                cid += 1; size = 0; st = [(sx, sy)]; lab[sy][sx] = cid
                while st:
                    x, y = st.pop(); size += 1
                    for nx, ny in ((x+1, y), (x-1, y), (x, y+1), (x, y-1)):
                        if 0 <= nx < cw and 0 <= ny < ch and lab[ny][nx] == 0 and buf[ny][nx][3] > 0:
                            lab[ny][nx] = cid; st.append((nx, ny))
                comps.append((cid, size))
    if comps:
        keep = max(comps, key=lambda c: c[1])[0]
        for y in range(ch):
            for x in range(cw):
                if buf[y][x][3] > 0 and lab[y][x] != keep:
                    buf[y][x][3] = 0

    # trim to content bbox
    minx, miny, maxx, maxy = cw, ch, -1, -1
    for y in range(ch):
        for x in range(cw):
            if buf[y][x][3] > 0:
                minx = min(minx, x); maxx = max(maxx, x)
                miny = min(miny, y); maxy = max(maxy, y)
    sub = Image.new('RGBA', (maxx - minx + 1, maxy - miny + 1), (0, 0, 0, 0))
    sp = sub.load()
    for y in range(miny, maxy + 1):
        for x in range(minx, maxx + 1):
            if buf[y][x][3] > 0:
                sp[x - minx, y - miny] = tuple(buf[y][x])

    # scale to fit the cell (preserve aspect), then bottom-center
    cell = Image.new('RGBA', (TS, TS), (0, 0, 0, 0))
    scale = min((TS - 2) / sub.width, (TS - 2) / sub.height)
    nw, nh = max(1, round(sub.width * scale)), max(1, round(sub.height * scale))
    sub = sub.resize((nw, nh), Image.LANCZOS)
    cell.alpha_composite(sub, ((TS - nw) // 2, TS - nh))
    return cell


def bake():
    here = os.path.dirname(os.path.abspath(__file__))
    im = Image.open(os.path.join(here, '..', 'content', 'ground.png')).convert('RGBA')
    px = im.load()

    atlas = Image.new('RGBA', (TS * 8, TS * len(ROWS)), (0, 0, 0, 0))
    for r, (terrain, mode, geo) in enumerate(ROWS):
        for c, cx in enumerate(COL_CENTERS):
            cell = crop_fill(px, cx, geo) if mode == 'fill' else crop_object(px, cx, geo)
            atlas.alpha_composite(cell, (c * TS, r * TS))

    dst = os.path.join(here, '..', 'content', 'ground_atlas.png')
    atlas.save(dst)
    print(f'wrote {dst}  ({atlas.size[0]}x{atlas.size[1]})  tileSize={TS}')


if __name__ == '__main__':
    bake()
