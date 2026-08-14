// ============ MENU / CHARACTER SELECT UI ============
import { GAME_VERSION, resizeCanvas, setGameState } from './core.js?v=0.4.1';
import { player } from './player.js?v=0.4.1';
import { mapSystem } from './map.js?v=0.4.1';

// ============ MENU UI ============
export const menuUI = {
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

        // Version badge
        const versionBadge = document.createElement('div');
        versionBadge.className = 'version-badge';
        versionBadge.textContent = GAME_VERSION;

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
            menuContainer.style.display = 'none';
            characterSelectUI.show();
        });

        // Continue button
        this.continueButton = document.createElement('button');
        this.continueButton.className = 'menu-button menu-button-disabled';
        this.continueButton.textContent = 'Continue';
        this.continueButton.disabled = true;

        buttonContainer.appendChild(this.startButton);
        buttonContainer.appendChild(this.continueButton);

        menuContainer.appendChild(title);
        menuContainer.appendChild(versionBadge);
        menuContainer.appendChild(subtitle);
        menuContainer.appendChild(buttonContainer);

        document.body.appendChild(menuContainer);
    },

    startGame() {
        setGameState('playing');
        document.getElementById('menuContainer').style.display = 'none';
        document.querySelector('.container').style.display = 'flex';
        resizeCanvas();
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

// ============ CHARACTER SELECT UI ============
export const characterSelectUI = {
    colors: [
        { name: 'Green', value: '#00ff00' },
        { name: 'Blue', value: '#4a9eff' },
        { name: 'Yellow', value: '#ffd700' },
        { name: 'Purple', value: '#a64dff' },
        { name: 'Orange', value: '#ff8c42' },
        { name: 'Pink', value: '#ff66cc' }
    ],
    selectedColor: '#00ff00',
    swatchButtons: [],

    init() {
        const container = document.createElement('div');
        container.id = 'characterSelectContainer';
        container.className = 'character-select-container';
        container.style.display = 'none';

        const title = document.createElement('h2');
        title.className = 'character-select-title';
        title.textContent = 'Choose Your Character';

        const swatchRow = document.createElement('div');
        swatchRow.className = 'character-swatches';

        this.swatchButtons = [];
        this.colors.forEach((c) => {
            const swatch = document.createElement('button');
            swatch.className = 'character-swatch';
            swatch.style.backgroundColor = c.value;
            swatch.title = c.name;
            swatch.setAttribute('aria-label', c.name);
            if (c.value === this.selectedColor) {
                swatch.classList.add('selected');
            }

            swatch.addEventListener('click', () => {
                this.selectedColor = c.value;
                this.swatchButtons.forEach(b => b.classList.remove('selected'));
                swatch.classList.add('selected');
            });

            this.swatchButtons.push(swatch);
            swatchRow.appendChild(swatch);
        });

        const playButton = document.createElement('button');
        playButton.className = 'menu-button';
        playButton.textContent = 'Play';
        playButton.addEventListener('click', () => {
            player.color = this.selectedColor;
            container.style.display = 'none';
            menuUI.startGame();
        });

        container.appendChild(title);
        container.appendChild(swatchRow);
        container.appendChild(playButton);

        document.body.appendChild(container);
    },

    show() {
        document.getElementById('characterSelectContainer').style.display = 'flex';
    }
};
