// ============ CORE SHARED STATE ============
// Dependency-free base of the module graph. Holds the canvas handles, the
// world/runtime state, and the few values that get reassigned across module
// boundaries. Those are exposed with setters because imported bindings are
// read-only — an importer can read a live `let` export but cannot assign to it.

export const GAME_VERSION = 'v0.5.0';

// ============ GAME STATE ============
export let gameState = 'menu'; // 'menu' or 'playing'
export function setGameState(next) {
    gameState = next;
}

// ============ WORLD STATE ============
export const world = {
    weather: {
        condition: 'Clear',
        temperature: 20,
        humidity: 50,
        windSpeed: 5,
        lastUpdate: 0,
        updateInterval: 30000 // Update every 30 seconds
    },
    time: 0,
    frameCount: 0,
    camera: {
        x: 0,
        y: 0
    }
};

// ============ SIMULATION SETTINGS ============
export let simulationSpeed = 1.0;
export function setSimulationSpeed(value) {
    simulationSpeed = value;
}

// ============ CANVAS SETUP ============
export const canvas = document.getElementById('gameCanvas');
export const ctx = canvas.getContext('2d');

export function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);
