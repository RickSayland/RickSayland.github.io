// ============ GAME ORCHESTRATOR (ENTRY MODULE) ============
// Loaded as the single <script type="module"> entry; everything else is
// pulled in through these imports, so load order is driven by the module
// graph rather than the order of <script> tags.
import { canvas, ctx, world, gameState, simulationSpeed, setSimulationSpeed } from './core.js?v=0.5.0';
import { player, input } from './player.js?v=0.5.0';
import { mapSystem } from './map.js?v=0.5.0';
import { enemySystem } from './enemy.js?v=0.5.0';
import { shockwaveSystem } from './shockwave.js?v=0.5.0';
import { projectileSystem } from './projectile.js?v=0.5.0';
import { weatherSystem } from './weather.js?v=0.5.0';
import { menuUI, characterSelectUI } from './ui.js?v=0.5.0';

const levelOrder = ['woods', 'beach', 'erin', 'forest', 'canyon', 'swamp', 'island'];

// ============ FPS TRACKING ============
let frameCounter = 0;
let lastFpsUpdate = Date.now();
let currentFps = 0;

// ============ DEBUG MODE ============
const debugMode = new URLSearchParams(window.location.search).has('debug');
if (!debugMode) {
    const rightPanel = document.querySelector('.right-panel');
    if (rightPanel) rightPanel.style.display = 'none';
    const leftPanel = document.querySelector('.left-panel');
    if (leftPanel) leftPanel.style.display = 'none';
    const centerPanel = document.querySelector('.center-panel');
    if (centerPanel) centerPanel.style.flex = '1 1 100%';
}

// ============ CONTROL LISTENERS ============
const speedSlider = document.getElementById('speedSlider');
const levelSelect = document.getElementById('levelSelect');

if (speedSlider) {
    speedSlider.addEventListener('input', (e) => {
        setSimulationSpeed(parseFloat(e.target.value));
        document.getElementById('speedValue').textContent = simulationSpeed.toFixed(1) + 'x';
    });
}

if (levelSelect) {
    levelSelect.addEventListener('change', (e) => {
        mapSystem.setLevel(e.target.value);
    });
}

// ============ DEBUG UI UPDATE ============
function updateDebugUI() {
    if (!debugMode) return;
    document.getElementById('fpsValue').textContent = currentFps.toFixed(0);
    document.getElementById('frameValue').textContent = world.frameCount;

    document.getElementById('weatherCondition').textContent = world.weather.condition;
    document.getElementById('weatherTemp').textContent = world.weather.temperature + '°C';
    document.getElementById('weatherHumidity').textContent = world.weather.humidity + '%';

    document.getElementById('playerPos').textContent =
        Math.floor(player.x) + ', ' + Math.floor(player.y);

    const enemyPositions = enemySystem.enemies
        .map(e => Math.floor(e.x) + ', ' + Math.floor(e.y))
        .join('  |  ');
    document.getElementById('enemyPos').textContent = enemyPositions || '—';

    const levelName = mapSystem.currentLevel.charAt(0).toUpperCase() + mapSystem.currentLevel.slice(1);
    document.getElementById('currentLevel').textContent = levelName;
}

// ============ LEVEL PROGRESSION ============
let levelClearTimer = 0;

function advanceLevel() {
    const currentIndex = levelOrder.indexOf(mapSystem.currentLevel);
    const nextIndex = (currentIndex + 1) % levelOrder.length;
    mapSystem.setLevel(levelOrder[nextIndex]);
    levelClearTimer = 2000;
    if (debugMode) {
        const sel = document.getElementById('levelSelect');
        if (sel) sel.value = levelOrder[nextIndex];
    }
}

// ============ RENDER FUNCTION ============
function render() {
    if (gameState !== 'playing') {
        return; // Don't render game world when not playing
    }

    // Render weather in screen space (background)
    weatherSystem.render();

    // Save context state for camera transformation
    ctx.save();

    // Apply camera transformation (center player on screen)
    ctx.translate(-world.camera.x, -world.camera.y);

    // Render map tiles
    mapSystem.render(ctx, world.camera.x, world.camera.y);

    ctx.globalAlpha = 1;

    // Render enemies
    enemySystem.render(ctx);

    // Render player
    player.render(ctx);

    // Render projectiles and shockwave ripples in world space
    projectileSystem.render(ctx);
    shockwaveSystem.render(ctx);

    // Restore context state
    ctx.restore();

    // Weather visibility overlay (screen space, drawn over world but under HUD)
    weatherSystem.renderOverlay();

    // HUD: HP/MP bars (screen space, top-left)
    player.renderStatsBar(ctx);

    // Minimap (screen space, not affected by camera)
    mapSystem.renderMinimap(ctx, world.camera, [
        { x: player.x, y: player.y, color: player.color, radius: 3 },
        ...enemySystem.enemies.map(e => ({ x: e.x, y: e.y, color: '#ff4444', radius: 2.5 }))
    ]);

    if (debugMode) {
        ctx.fillStyle = '#4a9eff';
        ctx.font = '14px Arial';
        ctx.fillText('Use Arrow Keys or WASD to move', 20, 115);
        ctx.fillText('Space: Shockwave', 20, 135);
    }

    if (levelClearTimer > 0) {
        const alpha = Math.min(1, levelClearTimer / 500);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, canvas.height / 2 - 40, canvas.width, 80);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#4a9eff';
        ctx.font = 'bold ' + Math.min(48, canvas.width / 12) + 'px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Level Clear!', canvas.width / 2, canvas.height / 2);
        ctx.restore();
    }
}

// ============ UPDATE FUNCTION ============
function update(deltaTime) {
    if (gameState !== 'playing') {
        return; // Don't update game when not playing
    }

    const scaledDeltaTime = deltaTime * simulationSpeed;

    // Update world time
    world.time += scaledDeltaTime;
    world.frameCount++;

    // Update systems
    weatherSystem.update(scaledDeltaTime, world.time);
    player.update(deltaTime);
    shockwaveSystem.update(deltaTime);
    projectileSystem.update(deltaTime);
    enemySystem.update(deltaTime);

    if (levelClearTimer > 0) {
        levelClearTimer -= deltaTime;
    } else if (enemySystem.enemies.length === 0) {
        advanceLevel();
    }

    // Update camera to keep player centered
    world.camera.x = player.x - canvas.width / 2;
    world.camera.y = player.y - canvas.height / 2;

    if (debugMode) {
        document.getElementById('deltaTimeValue').textContent = deltaTime.toFixed(1);
    }
}

// ============ MAIN GAME LOOP ============
let lastFrameTime = Date.now();

function gameLoop() {
    const now = Date.now();
    const deltaTime = now - lastFrameTime;
    lastFrameTime = now;

    // Update FPS counter
    frameCounter++;
    const timeSinceLastFpsUpdate = now - lastFpsUpdate;
    if (timeSinceLastFpsUpdate >= 1000) {
        currentFps = frameCounter;
        frameCounter = 0;
        lastFpsUpdate = now;
    }

    // Update and render
    update(deltaTime);
    render();
    updateDebugUI();

    requestAnimationFrame(gameLoop);
}

// ============ BOOT ============
// Module scripts are deferred and all imports have fully evaluated by the time
// this runs, so the DOM and every system are ready — no setTimeout needed.
mapSystem.init();
enemySystem.init();
menuUI.init();
characterSelectUI.init();
input.init();
gameLoop();
