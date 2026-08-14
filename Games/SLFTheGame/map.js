// ============ MAP SYSTEM ============
import { canvas } from './core.js?v=0.5.0';
import { player } from './player.js?v=0.5.0';
import { enemySystem } from './enemy.js?v=0.5.0';
import { TileSheet } from './sprite.js?v=0.5.0';

// content/ground_atlas.png is baked from the labeled content/ground.png sheet by
// tools/bakeGround.py. Rows are terrain types (see terrainTypes.row), columns
// are variants. Fill terrains are opaque; the tree row is transparent and drawn
// over a grass base.
const GROUND = new TileSheet({ src: 'content/ground_atlas.png?v=0.5.0', tileSize: 118 });

export const mapSystem = {
    currentLevel: 'woods',
    tileSize: 50,
    mapWidth: 40,
    mapHeight: 30,

    // `row` indexes the ground atlas; `variants` are the atlas columns safe to
    // scatter for this terrain; `color` is the minimap/fallback fill. `base`
    // (tree only) names a fill terrain drawn underneath the transparent overlay.
    terrainTypes: {
        grass:  { row: 0, variants: [0, 1, 4, 6],          color: '#2d5016', walkable: true },
        water:  { row: 1, variants: [0, 1],                color: '#1a4d7a', walkable: false },
        sand:   { row: 2, variants: [0, 1],                color: '#d4a574', walkable: true },
        tree:   { row: 3, variants: [0, 1, 2, 3, 4], base: 'grass', color: '#0a1a0a', walkable: false },
        rock:   { row: 4, variants: [0, 1, 2],             color: '#666666', walkable: false },
        forest: { row: 5, variants: [0, 1, 2, 3, 4, 5, 7], color: '#0d2610', walkable: true }
    },

    maps: {},
    minimapCache: {},

    init() {
        this.generateWoodsMap();
        this.generateBeachMap();
        this.generateErinMap();
        this.generateForestMap();
        this.generateCanyonMap();
        this.generateSwampMap();
        this.generateIslandMap();
    },

    generateWoodsMap() {
        const map = [];
        for (let y = 0; y < this.mapHeight; y++) {
            for (let x = 0; x < this.mapWidth; x++) {
                let terrain = 'grass';
                
                // Add river water
                if (Math.abs(y - 15) < 2 && x > 10 && x < 30) {
                    terrain = 'water';
                }
                
                // Add scattered trees with clustering
                const noise = Math.sin(x * 0.5) * Math.cos(y * 0.3) * 0.5 + 0.5;
                if (noise > 0.65 || Math.random() < 0.12) {
                    terrain = 'tree';
                }
                
                // Add forest groves (denser tree areas)
                if ((x - 8) * (x - 8) + (y - 8) * (y - 8) < 20) {
                    if (Math.random() < 0.4) {
                        terrain = 'tree';
                    }
                }
                if ((x - 32) * (x - 32) + (y - 22) * (y - 22) < 25) {
                    if (Math.random() < 0.5) {
                        terrain = 'tree';
                    }
                }
                
                map.push(terrain);
            }
        }
        this.maps.woods = map;
    },

    generateBeachMap() {
        const map = [];
        for (let y = 0; y < this.mapHeight; y++) {
            for (let x = 0; x < this.mapWidth; x++) {
                let terrain = 'sand';
                
                // Water takes up bottom half
                if (y > 15) {
                    terrain = 'water';
                }
                
                // Some rocks on beach
                if (terrain === 'sand' && Math.random() < 0.05) {
                    terrain = 'rock';
                }
                
                map.push(terrain);
            }
        }
        this.maps.beach = map;
    },

    generateErinMap() {

        const map = [
        /* y= 0 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y= 1 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y= 2 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y= 3 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y= 4 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y= 5 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y= 6 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y= 7 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree', 'tree', 'tree', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y= 8 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y= 9 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree', 'tree', 'tree', 'grass', 'grass', 'tree', 'grass', 'tree', 'grass', 'grass', 'tree', 'grass', 'grass', 'tree', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=10 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree', 'grass', 'grass', 'grass', 'grass', 'tree', 'grass', 'grass', 'grass', 'grass', 'tree', 'grass', 'grass', 'tree', 'grass', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=11 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree', 'tree', 'tree', 'tree', 'grass', 'tree', 'grass', 'grass', 'grass', 'grass', 'tree', 'grass', 'grass', 'tree', 'grass', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=12 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=13 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=14 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=15 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=16 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=17 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=18 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=19 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=20 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=21 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=22 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=23 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=24 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=25 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=26 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=27 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=28 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass',
        /* y=29 */  'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass'
        ];

        this.maps.erin = map;
    },

    generateForestMap() {
        const map = [
        /* y= 0 */  'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree',
        /* y= 1 */  'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y= 2 */  'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y= 3 */  'tree', 'grass', 'grass', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y= 4 */  'tree', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y= 5 */  'tree', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y= 6 */  'tree', 'grass', 'grass', 'sand', 'grass', 'tree', 'tree', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree', 'tree', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y= 7 */  'tree', 'grass', 'grass', 'sand', 'grass', 'tree', 'tree', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree', 'tree', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y= 8 */  'tree', 'grass', 'grass', 'sand', 'grass', 'tree', 'tree', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree', 'tree', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y= 9 */  'tree', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y=10 */  'tree', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y=11 */  'tree', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y=12 */  'tree', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'water', 'water', 'water', 'water', 'water', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree', 'tree', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y=13 */  'tree', 'grass', 'grass', 'sand', 'sand', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'water', 'water', 'water', 'water', 'water', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree', 'tree', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y=14 */  'tree', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'water', 'water', 'water', 'water', 'water', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree', 'tree', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y=15 */  'tree', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'water', 'water', 'water', 'water', 'water', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y=16 */  'tree', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'water', 'water', 'water', 'water', 'water', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y=17 */  'tree', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y=18 */  'tree', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y=19 */  'tree', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'tree', 'tree', 'tree', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y=20 */  'tree', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'tree', 'tree', 'tree', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree', 'tree', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y=21 */  'tree', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'tree', 'tree', 'tree', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree', 'tree', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y=22 */  'tree', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'tree', 'tree', 'tree', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree', 'tree', 'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'water', 'water', 'water', 'water', 'water', 'water', 'tree',
        /* y=23 */  'tree', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'water', 'water', 'water', 'water', 'water', 'water', 'tree',
        /* y=24 */  'tree', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'water', 'water', 'water', 'water', 'water', 'water', 'tree',
        /* y=25 */  'tree', 'grass', 'grass', 'grass', 'grass', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'sand', 'sand', 'grass', 'grass', 'water', 'water', 'water', 'water', 'water', 'water', 'tree',
        /* y=26 */  'tree', 'grass', 'grass', 'grass', 'grass', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'sand', 'sand', 'grass', 'grass', 'water', 'water', 'water', 'water', 'water', 'water', 'tree',
        /* y=27 */  'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'sand', 'grass', 'grass', 'water', 'water', 'water', 'water', 'water', 'water', 'tree',
        /* y=28 */  'tree', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'grass', 'tree',
        /* y=29 */  'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree', 'tree'
        ];

        this.maps.forest = map;
    },

    generateCanyonMap() {
        const W = this.mapWidth, H = this.mapHeight;
        const map = [];
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                let t = 'rock';
                const cx = W / 2, cy = H / 2;
                const pathY = cy + Math.sin(x * 0.25) * 4;
                if (Math.abs(y - pathY) < 3) t = 'sand';
                const vertPath = cx + Math.cos(y * 0.3) * 5;
                if (Math.abs(x - vertPath) < 2) t = 'sand';
                if (t === 'sand' && Math.abs(y - pathY) < 1 && x > 8 && x < 32) t = 'water';
                if (y <= 1 || y >= H - 2 || x <= 1 || x >= W - 2) t = 'rock';
                const nx = Math.sin(x * 0.7 + y * 0.4) * Math.cos(x * 0.3 - y * 0.6);
                if (t === 'rock' && nx > 0.6) t = 'grass';
                if (t === 'sand' && Math.random() < 0.04) t = 'rock';
                map.push(t);
            }
        }
        this.maps.canyon = map;
    },

    generateSwampMap() {
        const W = this.mapWidth, H = this.mapHeight;
        const map = [];
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                let t = 'forest';
                const pool1 = (x - 10) ** 2 + (y - 8) ** 2;
                const pool2 = (x - 30) ** 2 + (y - 22) ** 2;
                const pool3 = (x - 20) ** 2 + (y - 15) ** 2;
                const pool4 = (x - 8) ** 2 + (y - 24) ** 2;
                const pool5 = (x - 35) ** 2 + (y - 6) ** 2;
                if (pool1 < 16 || pool2 < 20 || pool3 < 12 || pool4 < 10 || pool5 < 14) t = 'water';
                if (t === 'forest' && Math.random() < 0.18) t = 'tree';
                if (t === 'forest') {
                    const n = Math.sin(x * 0.8) * Math.cos(y * 0.6);
                    if (n > 0.5) t = 'grass';
                }
                if (y === 0 || y === H - 1 || x === 0 || x === W - 1) t = 'tree';
                map.push(t);
            }
        }
        this.maps.swamp = map;
    },

    generateIslandMap() {
        const W = this.mapWidth, H = this.mapHeight;
        const cx = W / 2, cy = H / 2;
        const map = [];
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const dx = (x - cx) / (W * 0.42);
                const dy = (y - cy) / (H * 0.42);
                const dist = Math.sqrt(dx * dx + dy * dy);
                const wobble = Math.sin(Math.atan2(dy, dx) * 5) * 0.08;
                let t;
                if (dist > 1.0 + wobble) {
                    t = 'water';
                } else if (dist > 0.85 + wobble) {
                    t = 'sand';
                } else {
                    t = 'grass';
                    const pond = (x - cx - 3) ** 2 + (y - cy + 2) ** 2;
                    if (pond < 10) t = 'water';
                    if (pond >= 10 && pond < 16) t = 'sand';
                    const grove1 = (x - cx + 6) ** 2 + (y - cy - 5) ** 2;
                    const grove2 = (x - cx - 8) ** 2 + (y - cy + 6) ** 2;
                    if ((grove1 < 12 || grove2 < 10) && Math.random() < 0.6) t = 'tree';
                    if (t === 'grass' && Math.random() < 0.05) t = 'tree';
                }
                map.push(t);
            }
        }
        this.maps.island = map;
    },

    getCurrentMap() {
        return this.maps[this.currentLevel] || this.maps.woods;
    },

    setLevel(levelName) {
        if (this.maps[levelName]) {
            this.currentLevel = levelName;
            // Find and set player to a safe spawn point
            const spawnPoint = this.findSpawnPoint(400, 300);
            player.x = spawnPoint.x;
            player.y = spawnPoint.y;

            // Re-spawn enemies too, since their old position may not
            // be walkable on the new map
            if (typeof enemySystem !== 'undefined') {
                enemySystem.init();
            }
        }
    },

    getTileAt(x, y) {
        const tileX = Math.floor(x / this.tileSize);
        const tileY = Math.floor(y / this.tileSize);
        
        if (tileX < 0 || tileX >= this.mapWidth || tileY < 0 || tileY >= this.mapHeight) {
            return 'grass';
        }
        
        const map = this.getCurrentMap();
        const index = tileY * this.mapWidth + tileX;
        return map[index];
    },

    isWalkable(x, y) {
        if (x < 0 || y < 0 || x >= this.mapWidth * this.tileSize || y >= this.mapHeight * this.tileSize) return false;
        const terrain = this.getTileAt(x, y);
        return this.terrainTypes[terrain].walkable !== false;
    },

    floodFillSize(tileX, tileY, minSize) {
        const map = this.getCurrentMap();
        const visited = new Set();
        const queue = [[tileX, tileY]];
        const key = (x, y) => y * this.mapWidth + x;
        visited.add(key(tileX, tileY));

        while (queue.length > 0) {
            if (minSize && visited.size >= minSize) return visited.size;
            const [cx, cy] = queue.shift();
            for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                const nx = cx + dx;
                const ny = cy + dy;
                if (nx < 0 || nx >= this.mapWidth || ny < 0 || ny >= this.mapHeight) continue;
                const k = key(nx, ny);
                if (visited.has(k)) continue;
                const terrain = map[k];
                if (!this.terrainTypes[terrain].walkable) continue;
                visited.add(k);
                queue.push([nx, ny]);
            }
        }
        return visited.size;
    },

    isTileSpawnable(tileX, tileY, collisionBuffer) {
        const x = tileX * this.tileSize + this.tileSize / 2;
        const y = tileY * this.tileSize + this.tileSize / 2;
        const corners = [
            { x: x - collisionBuffer, y: y - collisionBuffer },
            { x: x + collisionBuffer, y: y - collisionBuffer },
            { x: x - collisionBuffer, y: y + collisionBuffer },
            { x: x + collisionBuffer, y: y + collisionBuffer },
            { x: x, y: y }
        ];
        for (const corner of corners) {
            if (!this.isWalkable(corner.x, corner.y)) return false;
        }
        return true;
    },

    findSpawnPoint(startX = canvas.width / 2, startY = canvas.height / 2) {
        const searchRadius = 10;
        const collisionBuffer = 15;
        const minRegionSize = 20;

        for (let radius = 0; radius <= searchRadius; radius++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
                    const tileX = Math.floor(startX / this.tileSize) + dx;
                    const tileY = Math.floor(startY / this.tileSize) + dy;
                    if (tileX < 0 || tileX >= this.mapWidth || tileY < 0 || tileY >= this.mapHeight) continue;

                    if (this.isTileSpawnable(tileX, tileY, collisionBuffer) &&
                        this.floodFillSize(tileX, tileY, minRegionSize) >= minRegionSize) {
                        return {
                            x: tileX * this.tileSize + this.tileSize / 2,
                            y: tileY * this.tileSize + this.tileSize / 2
                        };
                    }
                }
            }
        }

        // Fallback — search entire map
        for (let ty = 0; ty < this.mapHeight; ty++) {
            for (let tx = 0; tx < this.mapWidth; tx++) {
                if (this.isTileSpawnable(tx, ty, collisionBuffer) &&
                    this.floodFillSize(tx, ty, minRegionSize) >= minRegionSize) {
                    return {
                        x: tx * this.tileSize + this.tileSize / 2,
                        y: ty * this.tileSize + this.tileSize / 2
                    };
                }
            }
        }

        return { x: startX, y: startY };
    },

    // Deterministic variant column for a tile, so a level renders identically
    // every frame while still looking varied across the map.
    tileVariant(tx, ty, terrainData) {
        const variants = terrainData.variants;
        if (!variants || variants.length === 0) return 0;
        const h = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
        return variants[h % variants.length];
    },

    render(ctx, cameraX, cameraY) {
        const map = this.getCurrentMap();
        const ts = this.tileSize;

        // Calculate which tiles are visible
        const startTileX = Math.floor(cameraX / ts) - 1;
        const startTileY = Math.floor(cameraY / ts) - 1;
        const endTileX = startTileX + Math.ceil(canvas.width / ts) + 2;
        const endTileY = startTileY + Math.ceil(canvas.height / ts) + 2;

        const useTiles = GROUND.loaded;

        // Render only visible tiles
        for (let ty = Math.max(0, startTileY); ty < Math.min(this.mapHeight, endTileY); ty++) {
            for (let tx = Math.max(0, startTileX); tx < Math.min(this.mapWidth, endTileX); tx++) {
                const terrain = map[ty * this.mapWidth + tx];
                const terrainData = this.terrainTypes[terrain];
                const worldX = tx * ts;
                const worldY = ty * ts;

                if (useTiles) {
                    // Draw the fill base first (grass under a tree), then the
                    // terrain's own tile (transparent overlay for trees).
                    if (terrainData.base) {
                        const baseData = this.terrainTypes[terrainData.base];
                        GROUND.drawTile(ctx, this.tileVariant(tx, ty, baseData), baseData.row, worldX, worldY, ts);
                    }
                    GROUND.drawTile(ctx, this.tileVariant(tx, ty, terrainData), terrainData.row, worldX, worldY, ts);
                } else {
                    // Fallback until the atlas loads: flat color (+ tree marker)
                    ctx.fillStyle = terrainData.color;
                    ctx.fillRect(worldX, worldY, ts, ts);
                    if (terrain === 'tree') {
                        ctx.fillStyle = '#2d5016';
                        ctx.beginPath();
                        ctx.arc(worldX + ts / 2, worldY + ts / 2, ts / 3, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(worldX, worldY, ts, ts);
                }
            }
        }
    },

    // Bakes the current level's terrain into a tiny 1-pixel-per-tile
    // offscreen canvas. Done once per level and cached, so the minimap
    // only needs a single scaled drawImage() per frame instead of
    // redrawing every tile.
    buildMinimapTexture(levelName) {
        const map = this.maps[levelName];
        const texture = document.createElement('canvas');
        texture.width = this.mapWidth;
        texture.height = this.mapHeight;
        const texCtx = texture.getContext('2d');

        for (let ty = 0; ty < this.mapHeight; ty++) {
            for (let tx = 0; tx < this.mapWidth; tx++) {
                const terrain = map[ty * this.mapWidth + tx];
                texCtx.fillStyle = this.terrainTypes[terrain].color;
                texCtx.fillRect(tx, ty, 1, 1);
            }
        }

        this.minimapCache[levelName] = texture;
        return texture;
    },

    getMinimapTexture() {
        return this.minimapCache[this.currentLevel] || this.buildMinimapTexture(this.currentLevel);
    },

    // Draws the minimap panel in screen space (bottom-left corner).
    // `entities` is a list of { x, y, color, radius } in world coordinates.
    renderMinimap(ctx, camera, entities) {
        const isMobile = canvas.width < 768;
        const padding = 15;
        const mmWidth = isMobile ? 120 : 160;
        const mmHeight = mmWidth * (this.mapHeight / this.mapWidth);
        const mmX = isMobile ? canvas.width - mmWidth - padding : padding;
        const mmY = isMobile ? padding : canvas.height - mmHeight - padding;

        const mapPixelWidth = this.mapWidth * this.tileSize;
        const mapPixelHeight = this.mapHeight * this.tileSize;
        const scaleX = mmWidth / mapPixelWidth;
        const scaleY = mmHeight / mapPixelHeight;

        // Panel backdrop
        ctx.fillStyle = 'rgba(10, 10, 10, 0.75)';
        ctx.fillRect(mmX - 4, mmY - 4, mmWidth + 8, mmHeight + 8);
        ctx.strokeStyle = '#4a9eff';
        ctx.lineWidth = 1;
        ctx.strokeRect(mmX - 4, mmY - 4, mmWidth + 8, mmHeight + 8);

        // Terrain - crisp nearest-neighbor upscale of the cached texture
        const wasSmoothing = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.getMinimapTexture(), mmX, mmY, mmWidth, mmHeight);
        ctx.imageSmoothingEnabled = wasSmoothing;

        // Camera viewport box - what's currently on screen
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(
            mmX + camera.x * scaleX,
            mmY + camera.y * scaleY,
            canvas.width * scaleX,
            canvas.height * scaleY
        );

        // Entity dots
        for (const entity of entities) {
            ctx.fillStyle = entity.color;
            ctx.beginPath();
            ctx.arc(
                mmX + entity.x * scaleX,
                mmY + entity.y * scaleY,
                entity.radius,
                0,
                Math.PI * 2
            );
            ctx.fill();
        }
    }
};
