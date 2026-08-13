// ============ GEOPOLITICS SIMULATOR — GLOBE ENGINE ============

const DEG = Math.PI / 180;

// Simplified continent outlines: arrays of [lat, lon] pairs.
// Each sub-array is one filled polygon traced clockwise.
const LAND = [
  // Africa
  [[35.8,-5],[37,10],[32,25],[31,32],[22,37],[12,44],[11.5,51],
   [2,45],[-1,42],[-7,40],[-15,40],[-26,33],[-35,27],[-35,18],
   [-29,17],[-17,12],[-6,12],[4,10],[6,3],[5,-5],[8,-8],
   [15,-17],[21,-17],[27,-13],[35.8,-5]],

  // Europe
  [[36,-10],[37,0],[43,3],[44,-2],[48,-5],[51,2],[54,9],
   [57,10],[55,14],[54,19],[60,25],[64,28],[71,28],
   [71,40],[60,40],[55,42],[48,40],[42,30],
   [40,26],[39,20],[37,15],[36,6],[36,-10]],

  // Asia
  [[71,40],[73,55],[73,80],[72,105],[73,130],[70,150],[65,170],
   [60,163],[53,160],[50,143],[46,143],[43,132],
   [39,127],[35,129],[37,123],[30,122],[25,120],
   [22,114],[21,110],[16,108],[10,107],
   [1,104],[8,100],[16,97],[22,93],[22,89],
   [28,84],[28,77],[25,68],[24,67],[25,62],[27,57],
   [30,50],[33,44],[37,36],[42,30],[48,40],[55,42],[60,40],[71,40]],

  // India
  [[24,68],[20,73],[15,74],[8,77],[10,80],[16,82],[22,88],
   [28,84],[28,77],[24,68]],

  // Arabian Peninsula
  [[30,33],[27,36],[20,39],[15,43],[13,45],[15,52],[22,59],
   [26,56],[28,50],[30,48],[32,44],[33,36],[30,33]],

  // North America
  [[50,-130],[55,-130],[58,-136],[60,-147],[64,-166],[71,-156],
   [72,-155],[72,-95],[68,-67],[60,-65],[52,-56],
   [47,-53],[45,-60],[44,-66],[41,-70],[30,-82],[25,-80],
   [25,-90],[20,-87],[16,-96],[14,-90],[10,-84],[8,-79],
   [8,-82],[14,-91],[17,-97],
   [20,-105],[24,-110],[28,-114],[32,-117],
   [38,-123],[45,-124],[48,-124],[50,-130]],

  // South America
  [[12,-72],[10,-62],[8,-60],[5,-52],[0,-50],[-5,-35],
   [-8,-35],[-15,-39],[-23,-42],[-30,-50],[-35,-57],
   [-42,-64],[-46,-68],[-52,-70],[-55,-68],[-55,-64],
   [-50,-74],[-42,-73],[-37,-73],[-33,-72],[-27,-71],
   [-18,-70],[-15,-75],[-5,-80],[0,-80],[5,-77],[10,-72],[12,-72]],

  // Australia
  [[-12,131],[-12,137],[-17,140],[-16,146],[-19,149],
   [-24,152],[-28,153],[-33,152],[-37,150],[-39,147],
   [-38,141],[-35,137],[-32,133],[-31,115],[-22,114],
   [-18,122],[-15,129],[-12,131]],

  // Greenland
  [[84,-30],[83,-20],[82,-18],[78,-18],[76,-20],[72,-22],
   [69,-50],[70,-54],[72,-56],[78,-68],[80,-66],[82,-45],[84,-30]],

  // Great Britain
  [[50,-5],[51,1],[53,0],[55,-2],[58,-3],[58,-5],
   [57,-6],[55,-5],[54,-3],[52,-4],[50,-5]],

  // Ireland
  [[52,-10],[53,-6],[54,-6],[55,-8],[54,-10],[52,-10]],

  // Japan
  [[31,131],[33,130],[35,135],[37,137],[39,140],
   [41,140],[43,145],[44,145],[43,141],[40,140],
   [36,136],[34,133],[31,131]],

  // Madagascar
  [[-12,49],[-16,50],[-22,47],[-25,44],[-18,44],[-12,49]],

  // New Zealand North
  [[-35,174],[-38,176],[-41,175],[-42,172],[-39,174],[-36,175],[-35,174]],

  // New Zealand South
  [[-42,172],[-44,170],[-46,167],[-46,170],[-44,172],[-42,172]],

  // Antarctica East
  [[-65,0],[-70,0],[-70,30],[-70,80],[-68,100],[-66,130],
   [-70,150],[-80,170],[-80,90],[-80,0],[-65,0]],

  // Antarctica West
  [[-65,0],[-80,0],[-80,-90],[-80,-170],[-75,-140],
   [-73,-100],[-72,-80],[-65,-60],[-68,-60],[-70,-30],[-65,0]],

  // Iceland
  [[64,-14],[66,-14],[66,-18],[65,-22],[64,-22],[63,-20],[64,-14]],

  // Sri Lanka
  [[10,80],[8,80],[6,81],[7,82],[10,80]],

  // Italy
  [[46,8],[46,13],[44,13],[42,15],[40,18],[38,16],
   [40,15],[42,12],[44,9],[46,8]],

  // Borneo
  [[7,117],[6,116],[2,110],[0,109],[-3,111],[-4,115],
   [-1,117],[5,118],[7,117]],

  // Sumatra
  [[-5,105],[-3,104],[2,99],[5,97],[2,98],[-2,101],[-5,105]],

  // New Guinea
  [[-2,141],[-5,141],[-8,143],[-9,148],[-6,148],[-3,145],[-2,141]],

  // Philippines (simplified)
  [[5,120],[7,122],[10,124],[14,122],[18,121],[18,120],
   [14,120],[10,122],[7,120],[5,120]],

  // Cuba
  [[20,-84],[22,-84],[23,-80],[22,-77],[20,-75],[20,-78],[20,-84]],

  // Taiwan
  [[22,120],[25,121],[25,122],[22,121],[22,120]],
];


// ============ GLOBE OBJECT ============

const globe = {
    canvas: null,
    ctx: null,
    cx: 0,
    cy: 0,
    width: 0,
    height: 0,
    radius: 0,
    rotation: { lon: -20, lat: 20 },
    zoom: 1.0,
    dragging: false,
    lastPointer: { x: 0, y: 0 },
    dirty: true,
    autoRotate: true,
    autoRotateSpeed: 0.012,
    autoRotateTimer: null,

    init(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.resize();

        window.addEventListener('resize', () => this.resize());

        this.canvas.addEventListener('pointerdown', e => this.onPointerDown(e));
        window.addEventListener('pointermove', e => this.onPointerMove(e));
        window.addEventListener('pointerup', () => this.onPointerUp());
        this.canvas.addEventListener('wheel', e => this.onWheel(e), { passive: false });

        this.canvas.addEventListener('mousemove', e => {
            if (this.dragging) return;
            const rect = this.canvas.getBoundingClientRect();
            const coords = this.unproject(e.clientX - rect.left, e.clientY - rect.top);
            const el = document.getElementById('coords');
            if (coords) {
                const ns = coords.lat >= 0 ? 'N' : 'S';
                const ew = coords.lon >= 0 ? 'E' : 'W';
                el.textContent =
                    Math.abs(coords.lat).toFixed(1) + '°' + ns + '  ' +
                    Math.abs(coords.lon).toFixed(1) + '°' + ew;
            } else {
                el.textContent = '—';
            }
        });

        this.loop();
    },

    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.width = rect.width;
        this.height = rect.height;
        this.cx = this.width / 2;
        this.cy = this.height / 2;
        this.radius = Math.min(this.cx, this.cy) * 0.82 * this.zoom;
        this.dirty = true;
    },

    // ---- Projection ----

    project(lat, lon) {
        const phi = lat * DEG;
        const rLon = this.rotation.lon * DEG;
        const rLat = this.rotation.lat * DEG;

        const x  = Math.cos(phi) * Math.sin(lon * DEG - rLon);
        const y  = Math.sin(phi);
        const z  = Math.cos(phi) * Math.cos(lon * DEG - rLon);

        const y2 = y * Math.cos(rLat) - z * Math.sin(rLat);
        const z2 = y * Math.sin(rLat) + z * Math.cos(rLat);

        return {
            x: this.cx + x * this.radius,
            y: this.cy - y2 * this.radius,
            z: z2
        };
    },

    unproject(sx, sy) {
        const x  = (sx - this.cx) / this.radius;
        const y2 = -(sy - this.cy) / this.radius;
        const r2 = x * x + y2 * y2;
        if (r2 > 1) return null;

        const z2   = Math.sqrt(1 - r2);
        const rLat = this.rotation.lat * DEG;

        const y = y2 * Math.cos(rLat) + z2 * Math.sin(rLat);
        const z = -y2 * Math.sin(rLat) + z2 * Math.cos(rLat);

        const lat = Math.asin(Math.max(-1, Math.min(1, y))) / DEG;
        let   lon = Math.atan2(x, z) / DEG + this.rotation.lon;
        while (lon > 180)  lon -= 360;
        while (lon < -180) lon += 360;
        return { lat, lon };
    },

    // ---- Drawing helpers ----

    buildClippedPath(points) {
        const ctx = this.ctx;
        const n   = points.length;
        const proj = points.map(([lat, lon]) => ({
            ...this.project(lat, lon), lat, lon
        }));

        ctx.beginPath();
        for (let i = 0; i < n; i++) {
            const curr = proj[i];
            const prev = proj[(i - 1 + n) % n];

            if (curr.z > 0) {
                if (prev.z <= 0) {
                    const t    = prev.z / (prev.z - curr.z);
                    const edge = this.project(
                        prev.lat + t * (curr.lat - prev.lat),
                        prev.lon + t * (curr.lon - prev.lon)
                    );
                    ctx.moveTo(edge.x, edge.y);
                }
                ctx.lineTo(curr.x, curr.y);
            } else if (prev.z > 0) {
                const t    = prev.z / (prev.z - curr.z);
                const edge = this.project(
                    prev.lat + t * (curr.lat - prev.lat),
                    prev.lon + t * (curr.lon - prev.lon)
                );
                ctx.lineTo(edge.x, edge.y);
            }
        }
    },

    drawGraticule() {
        const ctx = this.ctx;

        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth   = 0.5;

        for (let lon = -180; lon < 180; lon += 30) {
            ctx.beginPath();
            let on = false;
            for (let lat = -90; lat <= 90; lat += 2) {
                const p = this.project(lat, lon);
                if (p.z > 0) { on ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); on = true; }
                else { on = false; }
            }
            ctx.stroke();
        }

        for (let lat = -60; lat <= 60; lat += 30) {
            ctx.beginPath();
            let on = false;
            for (let lon = -180; lon <= 180; lon += 2) {
                const p = this.project(lat, lon);
                if (p.z > 0) { on ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); on = true; }
                else { on = false; }
            }
            ctx.stroke();
        }

        // Equator (brighter)
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth   = 0.7;
        ctx.beginPath();
        let on = false;
        for (let lon = -180; lon <= 180; lon += 2) {
            const p = this.project(0, lon);
            if (p.z > 0) { on ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); on = true; }
            else { on = false; }
        }
        ctx.stroke();
    },

    // ---- Main render ----

    render() {
        const ctx = this.ctx;
        const R   = this.radius;

        // Background
        ctx.fillStyle = '#0a0c14';
        ctx.fillRect(0, 0, this.width, this.height);

        // Atmosphere glow
        const glow = ctx.createRadialGradient(this.cx, this.cy, R * 0.95, this.cx, this.cy, R * 1.18);
        glow.addColorStop(0, 'rgba(70,150,255,0.22)');
        glow.addColorStop(1, 'rgba(70,150,255,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, R * 1.18, 0, Math.PI * 2);
        ctx.fill();

        // Ocean sphere
        ctx.fillStyle = '#0d2847';
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, R, 0, Math.PI * 2);
        ctx.fill();

        // Ocean depth shading
        const depth = ctx.createRadialGradient(
            this.cx - R * 0.25, this.cy - R * 0.25, 0,
            this.cx, this.cy, R
        );
        depth.addColorStop(0, 'rgba(30,90,160,0.25)');
        depth.addColorStop(1, 'rgba(0,8,25,0.35)');
        ctx.fillStyle = depth;
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, R, 0, Math.PI * 2);
        ctx.fill();

        // Graticule
        this.drawGraticule();

        // Clip rendering to the sphere
        ctx.save();
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, R, 0, Math.PI * 2);
        ctx.clip();

        // Continents
        ctx.fillStyle   = '#28694a';
        ctx.strokeStyle = 'rgba(80,150,100,0.35)';
        ctx.lineWidth   = 0.6;

        for (const mass of LAND) {
            this.buildClippedPath(mass);
            ctx.fill();
            ctx.stroke();
        }

        ctx.restore();

        // Specular highlight
        const spec = ctx.createRadialGradient(
            this.cx - R * 0.3, this.cy - R * 0.3, 0,
            this.cx - R * 0.3, this.cy - R * 0.3, R * 0.8
        );
        spec.addColorStop(0, 'rgba(255,255,255,0.06)');
        spec.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = spec;
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, R, 0, Math.PI * 2);
        ctx.fill();

        // Edge ring
        ctx.strokeStyle = 'rgba(100,180,255,0.12)';
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.arc(this.cx, this.cy, R, 0, Math.PI * 2);
        ctx.stroke();
    },

    // ---- Loop ----

    loop() {
        if (this.autoRotate && !this.dragging) {
            this.rotation.lon += this.autoRotateSpeed;
            this.dirty = true;
        }
        if (this.dirty) {
            this.render();
            this.dirty = false;
        }
        requestAnimationFrame(() => this.loop());
    },

    // ---- Interaction ----

    onPointerDown(e) {
        this.dragging    = true;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.canvas.setPointerCapture(e.pointerId);
        this.autoRotate = false;
        clearTimeout(this.autoRotateTimer);
    },

    onPointerMove(e) {
        if (!this.dragging) return;
        const dx = e.clientX - this.lastPointer.x;
        const dy = e.clientY - this.lastPointer.y;

        this.rotation.lon -= dx * 0.3;
        this.rotation.lat += dy * 0.3;
        this.rotation.lat  = Math.max(-90, Math.min(90, this.rotation.lat));

        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.dirty = true;
    },

    onPointerUp() {
        this.dragging = false;
        this.autoRotateTimer = setTimeout(() => { this.autoRotate = true; }, 3000);
    },

    onWheel(e) {
        e.preventDefault();
        this.zoom *= e.deltaY > 0 ? 0.95 : 1.05;
        this.zoom  = Math.max(0.5, Math.min(3, this.zoom));
        this.radius = Math.min(this.cx, this.cy) * 0.82 * this.zoom;
        this.dirty = true;
    }
};

globe.init('globeCanvas');