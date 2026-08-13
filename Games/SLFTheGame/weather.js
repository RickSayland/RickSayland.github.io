// ============ WEATHER SYSTEM ============
const weatherSystem = {
    conditions: ['Clear', 'Cloudy', 'Rainy', 'Stormy', 'Foggy'],
    particles: [],

    conditionConfig: {
        'Clear':  { speedMod: 1.0, visibility: Infinity, cloudCount: 1, cloudColor: '#ffffff', cloudAlpha: 0.3 },
        'Cloudy': { speedMod: 1.0, visibility: Infinity, cloudCount: 3, cloudColor: '#d0d0d0', cloudAlpha: 0.6 },
        'Rainy':  { speedMod: 0.85, visibility: 400,     cloudCount: 4, cloudColor: '#888888', cloudAlpha: 0.7 },
        'Stormy': { speedMod: 0.7,  visibility: 280,     cloudCount: 5, cloudColor: '#444444', cloudAlpha: 0.8 },
        'Foggy':  { speedMod: 0.9,  visibility: 220,     cloudCount: 2, cloudColor: '#cccccc', cloudAlpha: 0.5 }
    },

    _vignetteCache: { key: null, gradient: null },

    getConfig() {
        return this.conditionConfig[world.weather.condition] || this.conditionConfig['Clear'];
    },

    getSpeedModifier() {
        return this.getConfig().speedMod;
    },

    update(deltaTime, time) {
        if (time - world.weather.lastUpdate > world.weather.updateInterval) {
            world.weather.condition = this.conditions[
                Math.floor(Math.random() * this.conditions.length)
            ];
            world.weather.temperature = Math.floor(10 + Math.random() * 20);
            world.weather.humidity = Math.floor(30 + Math.random() * 60);
            world.weather.windSpeed = (Math.random() * 20).toFixed(1);
            this.particles = [];
            world.weather.lastUpdate = time;
        }

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += (p.vx * simulationSpeed);
            p.y += (p.vy * simulationSpeed);
            p.life -= (deltaTime * simulationSpeed);

            if (p.life <= 0) {
                this.particles.splice(i, 1);
            }
        }

        if (world.weather.condition === 'Rainy' || world.weather.condition === 'Stormy') {
            const particleCount = world.weather.condition === 'Stormy' ? 8 : 3;
            for (let i = 0; i < particleCount; i++) {
                this.particles.push({
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height - canvas.height,
                    vx: (Math.random() - 0.5) * 3 + (world.weather.windSpeed * 0.2),
                    vy: 2 + (world.weather.windSpeed * 0.1),
                    life: 2000,
                    size: world.weather.condition === 'Stormy' ? 2 : 1
                });
            }
        }
    },

    getBackgroundColor() {
        const temp = world.weather.temperature;
        switch (world.weather.condition) {
            case 'Clear': {
                const lightness = 65 + (temp - 10) * 1.5;
                return `hsl(200, 70%, ${Math.min(lightness, 80)}%)`;
            }
            case 'Cloudy':
                return `hsl(200, 40%, ${50 + (temp - 10) * 0.5}%)`;
            case 'Rainy':
                return 'hsl(200, 30%, 45%)';
            case 'Stormy':
                return 'hsl(200, 20%, 30%)';
            case 'Foggy':
                return 'hsl(200, 10%, 60%)';
        }
    },

    drawClouds() {
        const cfg = this.getConfig();
        ctx.fillStyle = cfg.cloudColor;
        ctx.globalAlpha = cfg.cloudAlpha;

        for (let i = 0; i < cfg.cloudCount; i++) {
            const x = (world.time * 0.02 + i * 200) % (canvas.width + 200) - 100;
            const y = 40 + Math.sin(world.time * 0.001 + i) * 20;
            const scale = 25;
            ctx.beginPath();
            ctx.arc(x, y, scale, 0, Math.PI * 2);
            ctx.arc(x + scale * 0.8, y - scale * 0.3, scale * 0.9, 0, Math.PI * 2);
            ctx.arc(x + scale * 1.6, y, scale, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.globalAlpha = 1;
    },

    drawRain() {
        if (world.weather.condition !== 'Rainy' && world.weather.condition !== 'Stormy') {
            return;
        }

        ctx.strokeStyle = world.weather.condition === 'Stormy' ? '#6699ff' : '#aabbff';
        ctx.lineWidth = world.weather.condition === 'Stormy' ? 2 : 1;
        ctx.globalAlpha = world.weather.condition === 'Stormy' ? 0.8 : 0.6;

        for (let p of this.particles) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - p.vx * 5, p.y - p.vy * 5);
            ctx.stroke();
        }

        ctx.globalAlpha = 1;
    },

    drawFog() {
        if (world.weather.condition !== 'Foggy') {
            return;
        }

        const fogGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        fogGradient.addColorStop(0, 'rgba(200, 210, 220, 0.3)');
        fogGradient.addColorStop(0.5, 'rgba(200, 210, 220, 0.5)');
        fogGradient.addColorStop(1, 'rgba(200, 210, 220, 0.3)');

        ctx.fillStyle = fogGradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    },

    drawVignette() {
        const radius = this.getConfig().visibility;
        if (radius === Infinity) return;

        const cacheKey = `${world.weather.condition}:${canvas.width}:${canvas.height}`;
        if (this._vignetteCache.key !== cacheKey) {
            const cx = canvas.width / 2;
            const cy = canvas.height / 2;
            const gradient = ctx.createRadialGradient(cx, cy, radius * 0.5, cx, cy, radius);
            gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
            this._vignetteCache = { key: cacheKey, gradient };
        }

        ctx.fillStyle = this._vignetteCache.gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    },

    render() {
        ctx.fillStyle = this.getBackgroundColor();
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        this.drawClouds();
        this.drawRain();
        this.drawFog();
    },

    renderOverlay() {
        this.drawVignette();
    }
};
