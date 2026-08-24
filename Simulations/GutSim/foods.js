// ============ GUTSIM — FOOD ============
// Solid foods are authored as pixel sprites: one character per legend entry,
// blown up by `scale` cells. That is worth the authoring effort because the
// layers are what you watch come apart — a Big Mac drops as a recognisable
// burger, slumps into a pile in the fundus, and only then starts turning into
// coloured macro particles from the outside in.
//
// Liquids are poured instead of stamped, a few particles per step, so a pint
// arrives as a stream rather than a brick.
//
// `panel` is the real nutrition label. The sprite decides the SHAPE of the
// absorption curve over time; the panel decides the totals. digestion.js ties
// them together — see registerDrop.

const FOODS = [
    {
        key: 'bigmac', name: 'Big Mac', icon: '🍔',
        panel: { protein: 25, carb: 45, fat: 33, alcohol: 0 },
        note: 'Beef and cheese in a bun. Protein is the slowest thing the stomach handles — watch the patty outlast everything around it.',
        sprite: {
            scale: 2,
            legend: { b: 'BUN', l: 'LETTUCE', c: 'CHEESE', p: 'PATTY', u: 'SAUCE', k: 'PICKLE' },
            rows: [
                '  bbbbbbb  ',
                ' bbbbbbbbb ',
                'uuuuuuuuuuu',
                'lllllllllll',
                'ccccccccccc',
                'ppppppppppp',
                'ppppppppppp',
                'bbbbbbbbbbb',
                'uuuuuuuuuuu',
                'kkkkkkkkkkk',
                'lllllllllll',
                'ppppppppppp',
                'ppppppppppp',
                ' bbbbbbbbb ',
                '  bbbbbbb  '
            ]
        }
    },
    {
        key: 'pizza', name: 'Pizza slice', icon: '🍕',
        panel: { protein: 13, carb: 34, fat: 14, alcohol: 0 },
        note: 'Mostly crust, so mostly glucose. The cheese and pepperoni behind it are fat, and fat is the one macro that has to wait for bile.',
        sprite: {
            scale: 2,
            legend: { m: 'MOZZ', t: 'TOMATO', p: 'PEPPERONI', c: 'CRUST' },
            rows: [
                '     m     ',
                '    mmm    ',
                '   mmpmm   ',
                '   mtmtm   ',
                '  mmmmmmm  ',
                '  mtmpmtm  ',
                ' mmmmmmmmm ',
                ' mtmmmmmtm ',
                'mmmmpmmmmmm',
                'ttttttttttt',
                'ccccccccccc',
                'ccccccccccc'
            ]
        }
    },
    {
        key: 'sushi', name: 'Salmon roll', icon: '🍣',
        panel: { protein: 9, carb: 36, fat: 7, alcohol: 0 },
        note: 'Rice is starch and goes fast. The nori wrapper is nearly all fibre — follow the green particles all the way to the exit.',
        sprite: {
            scale: 2,
            legend: { n: 'NORI', r: 'RICE', f: 'FISH' },
            rows: [
                '  nnnnnnn  ',
                ' nrrrrrrrn ',
                'nrrrfffrrrn',
                'nrrfffffrrn',
                'nrrrfffrrrn',
                ' nrrrrrrrn ',
                '  nnnnnnn  '
            ]
        }
    },
    {
        key: 'icecream', name: 'Ice cream cone', icon: '🍦',
        panel: { protein: 5, carb: 38, fat: 16, alcohol: 0 },
        note: 'Sugar and dairy fat together. The fat globules float to the top of the acid pool and sit there until the duodenum.',
        sprite: {
            scale: 2,
            legend: { i: 'CREAM', w: 'CONE' },
            rows: [
                '   iiiii   ',
                '  iiiiiii  ',
                ' iiiiiiiii ',
                'iiiiiiiiiii',
                ' iiiiiiiii ',
                ' wwwwwwwww ',
                '  wwwwwww  ',
                '  wwwwwww  ',
                '   wwwww   ',
                '   wwwww   ',
                '    www    ',
                '     w     '
            ]
        }
    },
    {
        key: 'shake', name: 'Protein shake', icon: '🥤',
        panel: { protein: 25, carb: 3, fat: 2, alcohol: 0 },
        note: 'Already liquid, so nothing needs grinding. It clears the pylorus in a fraction of the time a patty takes, for the same protein.',
        pour: { element: 'WHEY', count: 340, rate: 7 }
    },
    {
        key: 'beer', name: 'Pint of beer', icon: '🍺',
        panel: { protein: 2, carb: 17, fat: 0, alcohol: 19 },
        note: 'The fourth macro. Ethanol needs no digestion at all — it crosses the stomach lining directly, which is why it lands before anything you ate with it.',
        pour: { element: 'BEERLIQ', count: 420, rate: 8 }
    }
];

const FOOD_BY_KEY = {};
for (const f of FOODS) FOOD_BY_KEY[f.key] = f;

// kcal is derived, never authored, so the alcohol row visibly carries its own
// 7 kcal/g into the total instead of being a number someone typed in.
function panelKcal(panel) {
    let k = 0;
    for (const m of MACROS) k += (panel[m.key] || 0) * m.kcal;
    return k;
}

const foods = {
    pours: [],

    drop(key) {
        const food = FOOD_BY_KEY[key];
        if (!food) return;
        if (food.sprite) this.dropSprite(food);
        else this.startPour(food);
    },

    dropSprite(food) {
        const g = grid;
        const { scale, legend, rows } = food.sprite;
        const wCells = rows[0].length * scale;
        const x0 = Math.round(anatomy.dropX - wCells / 2);
        const y0 = anatomy.dropY;

        const counts = {};
        let placed = 0, wanted = 0;

        for (let ry = 0; ry < rows.length; ry++) {
            const row = rows[ry];
            for (let rx = 0; rx < row.length; rx++) {
                const ch = row[rx];
                if (ch === ' ') continue;
                const id = EL[legend[ch]];
                for (let sy = 0; sy < scale; sy++) {
                    for (let sx = 0; sx < scale; sx++) {
                        wanted++;
                        const x = x0 + rx * scale + sx;
                        const y = y0 + ry * scale + sy;
                        if (!g.inBounds(x, y)) continue;
                        const i = g.idx(x, y);
                        if (g.type[i] !== EL.EMPTY || !anatomy.lumen[i]) continue;
                        g.spawn(i, id);
                        counts[id] = (counts[id] || 0) + 1;
                        placed++;
                    }
                }
            }
        }

        // If the mouth was still full and part of the sprite could not land,
        // scale the label down to match — otherwise half a burger would report
        // a whole burger's calories once absorbed.
        if (placed) digestion.registerDrop(food, counts, placed / wanted);
    },

    startPour(food) {
        const id = EL[food.pour.element];
        const counts = { [id]: food.pour.count };
        digestion.registerDrop(food, counts, 1);
        this.pours.push({ id, remaining: food.pour.count, rate: food.pour.rate });
    },

    // Called once per simulation step. A pour that cannot place a particle this
    // step stalls rather than dropping it, so the count that was registered is
    // always the count that eventually goes in.
    tick() {
        if (!this.pours.length) return;
        const g = grid;

        for (const p of this.pours) {
            let n = Math.min(p.rate, p.remaining);
            let guard = n * 12;
            while (n > 0 && guard-- > 0) {
                const x = anatomy.dropX + Math.round((Math.random() - 0.5) * 22);
                const y = anatomy.dropY + ((Math.random() * 5) | 0);
                if (!g.inBounds(x, y)) continue;
                const i = g.idx(x, y);
                if (g.type[i] !== EL.EMPTY || !anatomy.lumen[i]) continue;
                g.spawn(i, p.id);
                p.remaining--;
                n--;
            }
        }
        this.pours = this.pours.filter(p => p.remaining > 0);
    },

    reset() { this.pours.length = 0; }
};
