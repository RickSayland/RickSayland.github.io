// ============ MAP SYSTEM ============
const mapSystem = {
    currentLevel: 'woods',
    tileSize: 50,
    mapWidth: 40,
    mapHeight: 30,
    
    terrainTypes: {
        grass: { color: '#2d5016', walkable: true },
        water: { color: '#1a4d7a', walkable: false },
        sand: { color: '#d4a574', walkable: true },
        tree: { color: '#0a1a0a', walkable: false },
        rock: { color: '#666666', walkable: false },
        forest: { color: '#0d2610', walkable: true }
    },

    // Woods level - mostly grass with trees and some water
    woodsMap: null,
    beachMap: null,
    erinMap: null,
    minimapCache: {},

    init() {
        this.generateWoodsMap();
        this.generateBeachMap();
        this.generateErinMap();
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
        this.woodsMap = map;
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
        this.beachMap = map;
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

        this.erinMap = map;
    },

    getCurrentMap() {
        if (this.currentLevel === 'woods')
            return this.woodsMap;
            else if (this.currentLevel === 'beach')
                return this.beachMap;
                else if (this.currentLevel === 'erin')
                    return this.erinMap;
                    else
                        return this.woodsMap;
    },

    setLevel(levelName) {
        if (levelName === 'woods' || levelName === 'beach' || levelName === 'erin') {
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
        const terrain = this.getTileAt(x, y);
        return this.terrainTypes[terrain].walkable !== false;
    },

    findSpawnPoint(startX = canvas.width / 2, startY = canvas.height / 2) {
        // Search for a walkable tile starting from the given position
        // Align to tile centers so player doesn't clip into obstacles
        const searchRadius = 10;
        const collisionBuffer = 15; // Player half-width
        
        for (let radius = 0; radius <= searchRadius; radius++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    if (Math.abs(dx) === radius || Math.abs(dy) === radius) {
                        // Align to tile center
                        const tileX = Math.floor(startX / this.tileSize) + dx;
                        const tileY = Math.floor(startY / this.tileSize) + dy;
                        const x = tileX * this.tileSize + this.tileSize / 2;
                        const y = tileY * this.tileSize + this.tileSize / 2;
                        
                        // Check all collision points like in player.update()
                        const corners = [
                            { x: x - collisionBuffer, y: y - collisionBuffer },
                            { x: x + collisionBuffer, y: y - collisionBuffer },
                            { x: x - collisionBuffer, y: y + collisionBuffer },
                            { x: x + collisionBuffer, y: y + collisionBuffer },
                            { x: x, y: y }
                        ];
                        
                        let canSpawn = true;
                        for (let corner of corners) {
                            if (!this.isWalkable(corner.x, corner.y)) {
                                canSpawn = false;
                                break;
                            }
                        }
                        
                        if (canSpawn) {
                            return { x, y };
                        }
                    }
                }
            }
        }
        
        // Fallback - search entire map if needed
        for (let ty = 0; ty < this.mapHeight; ty++) {
            for (let tx = 0; tx < this.mapWidth; tx++) {
                const x = tx * this.tileSize + this.tileSize / 2;
                const y = ty * this.tileSize + this.tileSize / 2;
                
                const corners = [
                    { x: x - collisionBuffer, y: y - collisionBuffer },
                    { x: x + collisionBuffer, y: y - collisionBuffer },
                    { x: x - collisionBuffer, y: y + collisionBuffer },
                    { x: x + collisionBuffer, y: y + collisionBuffer },
                    { x: x, y: y }
                ];
                
                let canSpawn = true;
                for (let corner of corners) {
                    if (!this.isWalkable(corner.x, corner.y)) {
                        canSpawn = false;
                        break;
                    }
                }
                
                if (canSpawn) {
                    return { x, y };
                }
            }
        }
        
        return { x: startX, y: startY };
    },

    render(ctx, cameraX, cameraY) {
        const map = this.getCurrentMap();
        
        // Calculate which tiles are visible
        const startTileX = Math.floor(cameraX / this.tileSize) - 1;
        const startTileY = Math.floor(cameraY / this.tileSize) - 1;
        const endTileX = startTileX + Math.ceil(canvas.width / this.tileSize) + 2;
        const endTileY = startTileY + Math.ceil(canvas.height / this.tileSize) + 2;
        
        // Render only visible tiles
        for (let ty = Math.max(0, startTileY); ty < Math.min(this.mapHeight, endTileY); ty++) {
            for (let tx = Math.max(0, startTileX); tx < Math.min(this.mapWidth, endTileX); tx++) {
                const index = ty * this.mapWidth + tx;
                const terrain = map[index];
                const terrainData = this.terrainTypes[terrain];
                
                const worldX = tx * this.tileSize;
                const worldY = ty * this.tileSize;
                
                ctx.fillStyle = terrainData.color;
                ctx.fillRect(
                    worldX,
                    worldY,
                    this.tileSize,
                    this.tileSize
                );
                
                // Draw tree markers for better visibility
                if (terrain === 'tree') {
                    ctx.fillStyle = '#2d5016';
                    ctx.beginPath();
                    ctx.arc(
                        worldX + this.tileSize / 2,
                        worldY + this.tileSize / 2,
                        this.tileSize / 3,
                        0,
                        Math.PI * 2
                    );
                    ctx.fill();
                }
                
                // Add a subtle border
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
                ctx.lineWidth = 1;
                ctx.strokeRect(
                    worldX,
                    worldY,
                    this.tileSize,
                    this.tileSize
                );
            }
        }
    },

    // Bakes the current level's terrain into a tiny 1-pixel-per-tile
    // offscreen canvas. Done once per level and cached, so the minimap
    // only needs a single scaled drawImage() per frame instead of
    // redrawing every tile.
    buildMinimapTexture(levelName) {
        const map = levelName === 'woods' ? this.woodsMap : this.beachMap;
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
        const padding = 15;
        const mmWidth = 160;
        const mmHeight = mmWidth * (this.mapHeight / this.mapWidth);
        const mmX = padding;
        const mmY = canvas.height - mmHeight - padding;

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
