// ============ WEATHER SYSTEM ============
const weatherSystem = {
    conditions: ['Clear', 'Cloudy', 'Rainy', 'Stormy', 'Foggy'],
    particles: [],
    
    update(deltaTime, time) {
        if (time - world.weather.lastUpdate > world.weather.updateInterval) {
            // Random weather condition
            world.weather.condition = this.conditions[
                Math.floor(Math.random() * this.conditions.length)
            ];
            
            // Random temperature between 10-30°C
            world.weather.temperature = Math.floor(10 + Math.random() * 20);
            
            // Random humidity between 30-90%
            world.weather.humidity = Math.floor(30 + Math.random() * 60);
            
            // Random wind speed between 0-20 m/s
            world.weather.windSpeed = (Math.random() * 20).toFixed(1);
            
            // Reset particles when weather changes
            this.particles = [];
            
            world.weather.lastUpdate = time;
        }

        // Update particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += (p.vx * simulationSpeed);
            p.y += (p.vy * simulationSpeed);
            p.life -= (deltaTime * simulationSpeed);
            
            if (p.life <= 0) {
                this.particles.splice(i, 1);
            }
        }

        // Generate new particles based on weather
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
        // Color changes based on temperature and condition
        const temp = world.weather.temperature;
        let baseColor;

        if (world.weather.condition === 'Clear') {
            // Blue sky, warmer = lighter
            const hue = 200;
            const lightness = 65 + (temp - 10) * 1.5;
            return `hsl(${hue}, 70%, ${Math.min(lightness, 80)}%)`;
        } else if (world.weather.condition === 'Cloudy') {
            return `hsl(200, 40%, ${50 + (temp - 10) * 0.5}%)`;
        } else if (world.weather.condition === 'Rainy') {
            return `hsl(200, 30%, 45%)`;
        } else if (world.weather.condition === 'Stormy') {
            return `hsl(200, 20%, 30%)`;
        } else if (world.weather.condition === 'Foggy') {
            return `hsl(200, 10%, 60%)`;
        }
    },

    drawClouds() {
        const cloudCount = this.getCloudCount();
        ctx.fillStyle = this.getCloudColor();
        ctx.globalAlpha = this.getCloudAlpha();

        for (let i = 0; i < cloudCount; i++) {
            const x = (world.time * 0.02 + i * 200) % (canvas.width + 200) - 100;
            const y = 40 + Math.sin(world.time * 0.001 + i) * 20;
            this.drawCloud(x, y);
        }

        ctx.globalAlpha = 1;
    },

    drawCloud(x, y) {
        const scale = 25;
        ctx.beginPath();
        ctx.arc(x, y, scale, 0, Math.PI * 2);
        ctx.arc(x + scale * 0.8, y - scale * 0.3, scale * 0.9, 0, Math.PI * 2);
        ctx.arc(x + scale * 1.6, y, scale, 0, Math.PI * 2);
        ctx.fill();
    },

    getCloudCount() {
        const counts = {
            'Clear': 1,
            'Cloudy': 3,
            'Rainy': 4,
            'Stormy': 5,
            'Foggy': 2
        };
        return counts[world.weather.condition] || 1;
    },

    getCloudColor() {
        const colors = {
            'Clear': '#ffffff',
            'Cloudy': '#d0d0d0',
            'Rainy': '#888888',
            'Stormy': '#444444',
            'Foggy': '#cccccc'
        };
        return colors[world.weather.condition] || '#ffffff';
    },

    getCloudAlpha() {
        const alphas = {
            'Clear': 0.3,
            'Cloudy': 0.6,
            'Rainy': 0.7,
            'Stormy': 0.8,
            'Foggy': 0.5
        };
        return alphas[world.weather.condition] || 0.5;
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

    render() {
        // Draw background
        ctx.fillStyle = this.getBackgroundColor();
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw clouds
        this.drawClouds();

        // Draw rain
        this.drawRain();

        // Draw fog
        this.drawFog();
    }
};
