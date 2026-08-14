#!/usr/bin/env python3
"""Bake a labeled character reference sheet into a clean game-ready atlas.

The source sheets in ../content (player.png, enemy.png, ...) are *labeled*
reference sheets: an 8x8 grid of character poses on a near-black background,
with a header row of column labels (Down, Down-Left, ...) and a left column of
row labels (Idle, Walk 1, ...). Those labels and the opaque background are not
usable in-game, so this script turns a sheet into a normalized atlas:

  * background flood-filled to transparency from each cell's border (a low
    threshold keeps the sprites' near-black *outlines* intact — the outlines are
    ~31 away from the bg color, so anything below that stays opaque);
  * stray fragments from neighboring cells removed by keeping only large
    connected components;
  * every frame trimmed to its content and re-composited horizontally centered
    and bottom-aligned, so feet share a common baseline `PAD` px from the bottom.

Output is an 8x8 grid of uniform FW x FH frames; the game reads it with plain
`col*FW, row*FH` math (see sprite.js). Frame size is printed so you can copy it
into the SpriteSheet config.

Usage:
    python bakeAtlas.py player      # content/player.png  -> content/player_atlas.png
    python bakeAtlas.py enemy       # content/enemy.png   -> content/enemy_atlas.png

Grid geometry was measured from player.png (1254x1254). If a new sheet uses a
different layout, adjust COL_CENTER0 / COL_PITCH / ROW_EDGES or re-measure with
a grid overlay before trusting the output.
"""
import sys
import os
from collections import deque
from PIL import Image

# --- grid geometry (measured from the 1254x1254 reference sheets) ---
COL_CENTER0 = 190.0    # x center of column 0 (Down)
COL_PITCH = 133.5      # x distance between column centers
# y cut lines between the 8 sprite rows (midpoints of the empty gaps), taken
# from the label/row content bands; index 0..8 bound rows 0..7.
ROW_EDGES = [64, 199, 332, 468, 601, 736, 886, 1066, 1200]

BG = (17, 18, 19)          # sheet background color
KEY_THRESH = 24 * 24       # squared distance: below the ~31 black-outline gap
MIN_COMPONENT_FRAC = 0.08  # keep components >= this fraction of the largest
MIN_COMPONENT_ABS = 400    # ...or at least this many px
PAD = 6                    # transparent px below the feet baseline


def d2(c):
    return (c[0] - BG[0]) ** 2 + (c[1] - BG[1]) ** 2 + (c[2] - BG[2]) ** 2


def col_edges():
    centers = [COL_CENTER0 + COL_PITCH * i for i in range(8)]
    edges = [centers[0] - COL_PITCH / 2]
    edges += [(centers[i] + centers[i + 1]) / 2 for i in range(7)]
    edges += [centers[7] + COL_PITCH / 2]
    return [int(round(x)) for x in edges]


def extract_cell(px, x0, y0, x1, y1):
    cw, ch = x1 - x0, y1 - y0
    cell = [[list(px[x0 + x, y0 + y]) + [255] for x in range(cw)] for y in range(ch)]

    # 1) flood-fill background -> transparent, starting from the border
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
        r, g, b, _ = cell[y][x]
        if d2((r, g, b)) < KEY_THRESH:
            cell[y][x][3] = 0
            q.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])

    # 2) keep only large connected components (drops neighbor fragments/specks)
    lab = [[0] * cw for _ in range(ch)]
    comps = []
    cid = 0
    for sy in range(ch):
        for sx in range(cw):
            if cell[sy][sx][3] > 0 and lab[sy][sx] == 0:
                cid += 1
                size = 0
                st = [(sx, sy)]
                lab[sy][sx] = cid
                while st:
                    x, y = st.pop()
                    size += 1
                    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                        if 0 <= nx < cw and 0 <= ny < ch and lab[ny][nx] == 0 and cell[ny][nx][3] > 0:
                            lab[ny][nx] = cid
                            st.append((nx, ny))
                comps.append((cid, size))
    if not comps:
        return None, (0, 0)
    largest = max(s for _, s in comps)
    keep = {i for i, s in comps if s >= max(MIN_COMPONENT_ABS, largest * MIN_COMPONENT_FRAC)}
    for y in range(ch):
        for x in range(cw):
            if cell[y][x][3] > 0 and lab[y][x] not in keep:
                cell[y][x][3] = 0

    # 3) trim to content bbox
    minx, miny, maxx, maxy = cw, ch, -1, -1
    for y in range(ch):
        for x in range(cw):
            if cell[y][x][3] > 0:
                minx = min(minx, x); maxx = max(maxx, x)
                miny = min(miny, y); maxy = max(maxy, y)
    if maxx < 0:
        return None, (0, 0)
    sub = [row[minx:maxx + 1] for row in cell[miny:maxy + 1]]
    return sub, (maxx - minx + 1, maxy - miny + 1)


def bake(name):
    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(here, '..', 'content', f'{name}.png')
    dst = os.path.join(here, '..', 'content', f'{name}_atlas.png')
    im = Image.open(src).convert('RGB')
    px = im.load()

    cedges = col_edges()
    cells = {}
    maxw = maxh = 0
    for r in range(8):
        for c in range(8):
            sub, (w, h) = extract_cell(px, cedges[c], ROW_EDGES[r], cedges[c + 1], ROW_EDGES[r + 1])
            cells[(r, c)] = sub
            maxw = max(maxw, w)
            maxh = max(maxh, h)

    fw = maxw + PAD * 2
    fh = maxh + PAD * 2
    atlas = Image.new('RGBA', (fw * 8, fh * 8), (0, 0, 0, 0))
    ap = atlas.load()
    for r in range(8):
        for c in range(8):
            sub = cells[(r, c)]
            if not sub:
                continue
            h = len(sub)
            w = len(sub[0])
            ox = c * fw + (fw - w) // 2          # horizontal center
            oy = r * fh + (fh - PAD - h)         # feet on the baseline
            for yy in range(h):
                for xx in range(w):
                    p = sub[yy][xx]
                    if p[3] > 0:
                        ap[ox + xx, oy + yy] = tuple(p)
    atlas.save(dst)
    print(f'{name}: wrote {dst}  ({atlas.size[0]}x{atlas.size[1]})  frameW={fw} frameH={fh} pad={PAD}')


if __name__ == '__main__':
    for n in (sys.argv[1:] or ['player']):
        bake(n)
