// ============ MENU / CHARACTER SELECT UI ============
import { GAME_VERSION, resizeCanvas, setGameState } from './core.js?v=0.5.0';
import { player, CHARACTERS } from './player.js?v=0.5.0';
import { mapSystem } from './map.js?v=0.5.0';

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
    selectedCharacter: CHARACTERS[0].key,
    characterButtons: [],

    init() {
        const container = document.createElement('div');
        container.id = 'characterSelectContainer';
        container.className = 'character-select-container';
        container.style.display = 'none';

        const title = document.createElement('h2');
        title.className = 'character-select-title';
        title.textContent = 'Choose Your Character';

        // ---- character (sprite) chooser ----
        const charRow = document.createElement('div');
        charRow.className = 'character-options';

        this.characterButtons = [];
        CHARACTERS.forEach((c) => {
            const btn = document.createElement('button');
            btn.className = 'character-option';
            if (c.key === this.selectedCharacter) btn.classList.add('selected');

            // Preview shows the idle/down frame (col 0, row 0) of the atlas
            const preview = document.createElement('div');
            preview.className = 'character-preview';
            const sheet = c.sheet;
            const pw = 92;
            const scale = pw / sheet.frameW;
            preview.style.width = pw + 'px';
            preview.style.height = Math.round(sheet.frameH * scale) + 'px';
            preview.style.backgroundImage = `url('${sheet.img.src}')`;
            preview.style.backgroundSize =
                `${Math.round(sheet.frameW * 8 * scale)}px ${Math.round(sheet.frameH * 8 * scale)}px`;
            preview.style.backgroundPosition = '0px 0px';
            preview.style.backgroundRepeat = 'no-repeat';

            const nameEl = document.createElement('div');
            nameEl.className = 'character-name';
            nameEl.textContent = c.name;

            const roleEl = document.createElement('div');
            roleEl.className = 'character-role';
            roleEl.textContent = c.blurb;

            btn.appendChild(preview);
            btn.appendChild(nameEl);
            btn.appendChild(roleEl);

            btn.addEventListener('click', () => {
                this.selectedCharacter = c.key;
                this.characterButtons.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });

            this.characterButtons.push(btn);
            charRow.appendChild(btn);
        });

        const playButton = document.createElement('button');
        playButton.className = 'menu-button';
        playButton.textContent = 'Play';
        playButton.addEventListener('click', () => {
            player.setCharacter(this.selectedCharacter);
            container.style.display = 'none';
            menuUI.startGame();
        });

        container.appendChild(title);
        container.appendChild(charRow);
        container.appendChild(playButton);

        document.body.appendChild(container);
    },

    show() {
        document.getElementById('characterSelectContainer').style.display = 'flex';
    }
};
