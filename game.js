// ============ GAME STATE ============
let gameState = 'menu'; // 'menu' or 'playing'

// ============ WORLD STATE ============
const world = {
    weather: {
        condition: 'Clear',
        temperature: 20,
        humidity: 50,
        windSpeed: 5,
        lastUpdate: 0,
        updateInterval: 2000 // Update every 2 seconds
    },
    time: 0,
    frameCount: 0,
    camera: {
        x: 0,
        y: 0
    }
};

// ============ SIMULATION SETTINGS ============
let simulationSpeed = 1.0;

// ============ FPS TRACKING ============
let frameCounter = 0;
let lastFpsUpdate = Date.now();
let currentFps = 0;

// ============ CANVAS SETUP ============
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ============ CONTROL LISTENERS ============
document.getElementById('speedSlider').addEventListener('input', (e) => {
    simulationSpeed = parseFloat(e.target.value);
    document.getElementById('speedValue').textContent = simulationSpeed.toFixed(1) + 'x';
});

document.getElementById('levelSelect').addEventListener('change', (e) => {
    mapSystem.setLevel(e.target.value);
});

// ============ MENU UI ============
const menuUI = {
    startButton: null,
    continueButton: null,

    init() {
        // Create menu container
        const menuContainer = document.createElement('div');
        menuContainer.id = 'menuContainer';
        menuContainer.className = 'menu-container';

        // Hide the game container until game starts
        document.querySelector('.container').style.display = 'none';

        // Title
        const title = document.createElement('h1');
        title.className = 'menu-title';
        title.textContent = 'Silly Little Friends';

        // Subtitle
        const subtitle = document.createElement('p');
        subtitle.className = 'menu-subtitle';
        subtitle.textContent = 'The Game';

        // Button container
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'menu-buttons';

        // Start button
        this.startButton = document.createElement('button');
        this.startButton.className = 'menu-button';
        this.startButton.textContent = 'Start Game';
        this.startButton.addEventListener('click', () => {
            menuUI.startGame();
        });

        // Continue button
        this.continueButton = document.createElement('button');
        this.continueButton.className = 'menu-button menu-button-disabled';
        this.continueButton.textContent = 'Continue';
        this.continueButton.disabled = true;

        buttonContainer.appendChild(this.startButton);
        buttonContainer.appendChild(this.continueButton);

        menuContainer.appendChild(title);
        menuContainer.appendChild(subtitle);
        menuContainer.appendChild(buttonContainer);

        document.body.appendChild(menuContainer);
    },

    startGame() {
        gameState = 'playing';
        document.getElementById('menuContainer').style.display = 'none';
        document.querySelector('.container').style.display = 'flex';
        // Ensure player is on a walkable tile
        const spawnPoint = mapSystem.findSpawnPoint(400, 300);
        player.x = spawnPoint.x;
        player.y = spawnPoint.y;
    },

    show() {
        const menu = document.getElementById('menuContainer');
        if (menu) {
            menu.style.display = 'flex';
            document.querySelector('.container').style.display = 'none';
        }
    },

    hide() {
        const menu = document.getElementById('menuContainer');
        if (menu) {
            menu.style.display = 'none';
            document.querySelector('.container').style.display = 'flex';
        }
    }
};

// ============ CONTROL LISTENERS ============

// ============ DEBUG UI UPDATE ============
function updateDebugUI() {
    document.getElementById('fpsValue').textContent = currentFps.toFixed(0);
    document.getElementById('frameValue').textContent = world.frameCount;
    
    document.getElementById('weatherCondition').textContent = world.weather.condition;
    document.getElementById('weatherTemp').textContent = world.weather.temperature + '°C';
    document.getElementById('weatherHumidity').textContent = world.weather.humidity + '%';
    
    document.getElementById('playerPos').textContent = 
        Math.floor(player.x) + ', ' + Math.floor(player.y);
    
    const levelName = mapSystem.currentLevel.charAt(0).toUpperCase() + mapSystem.currentLevel.slice(1);
    document.getElementById('currentLevel').textContent = levelName;
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

    // Render player
    player.render(ctx);

    // Restore context state
    ctx.restore();

    // Draw placeholder text (UI layer, not affected by camera)
    ctx.fillStyle = '#4a9eff';
    ctx.font = '14px Arial';
    ctx.fillText('Use Arrow Keys or WASD to move', 20, 30);
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

    // Update camera to keep player centered
    world.camera.x = player.x - canvas.width / 2;
    world.camera.y = player.y - canvas.height / 2;

    // Update debug delta time display
    document.getElementById('deltaTimeValue').textContent = deltaTime.toFixed(1);
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

// Start the game loop after all scripts have loaded
setTimeout(() => {
    mapSystem.init();
    menuUI.init();
    input.init();
    gameLoop();
}, 0);
