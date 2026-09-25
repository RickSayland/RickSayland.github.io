// ============ ATOM VIEWER — VOLUME RENDERER (atom view) ============
// Owns `volumeView`: the WebGL2 ray-marcher for the electron cloud and the 2-D
// overlay drawn over it (box, axes, radial ruler, nucleus marker).
//
// The volume is a baked RGBA16F 3-D texture spanning the box [−1, 1]³; every
// pixel marches its ray through it. 'cloud' composites emission and
// absorption front to back; 'surface' stops at the first sample whose field
// reaches 1 (each orbital's 90% surface — see orbitals.js), refines the hit by
// bisection and lights it.
//
// Two things here are load-bearing:
//
// - **The cutaway is fixed to the CAMERA, not the atom.** A 90° wedge whose
//   bisector points at the viewer is removed, so the atom can spin under it and
//   the interior stays in view. An octant fixed to the atom swung round to the
//   back every half-turn of the auto-rotate.
// - **A surface hit that arrives from inside the cut is the cut face**, and is
//   shaded flat with that plane's normal. Taking the field gradient there gives
//   the direction to the nearest shell instead, and the face turns into noise.

const volumeView = (() => {
    const VS = `#version 300 es
in vec2 aPos;
out vec2 vNdc;
void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

    const FS = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler3D uVol;
uniform mat3 uRot;          // view → object
uniform vec3 uCam;          // camera, object space
uniform float uTanHalf, uAspect;
uniform int uMode;
uniform bool uCut;
uniform vec3 uCutA, uCutB;
uniform float uExposure, uAbsorb, uStep, uEps, uFrame;
uniform vec3 uLight;
in vec2 vNdc;
out vec4 frag;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uFrame * 0.618) * 43758.5453); }
bool cut(vec3 p) { return uCut && dot(p, uCutA) > 0.0 && dot(p, uCutB) > 0.0; }
vec4 S(vec3 p) { return texture(uVol, p * 0.5 + 0.5); }

void main() {
    vec3 dv = normalize(vec3(vNdc.x * uTanHalf * uAspect, vNdc.y * uTanHalf, -1.0));
    vec3 rd = uRot * dv, ro = uCam;
    vec3 inv = 1.0 / rd;
    vec3 t0 = (-1.0 - ro) * inv, t1 = (1.0 - ro) * inv;
    vec3 tmn = min(t0, t1), tmx = max(t0, t1);
    float tn = max(max(tmn.x, tmn.y), tmn.z), tf = min(min(tmx.x, tmx.y), tmx.z);
    if (tf <= max(tn, 0.0)) { frag = vec4(0.0); return; }
    tn = max(tn, 0.0);
    float t = tn + hash(gl_FragCoord.xy) * uStep;

    if (uMode == 0) {
        vec3 C = vec3(0.0);
        float T = 1.0;
        for (int i = 0; i < 700; i++) {
            if (t > tf) break;
            vec3 p = ro + rd * t;
            if (!cut(p)) {
                vec4 s = S(p);
                C += T * s.rgb * uStep;
                T *= exp(-s.a * uAbsorb * uStep);
                if (T < 0.004) break;
            }
            t += uStep;
        }
        vec3 col = vec3(1.0) - exp(-C * uExposure);
        frag = vec4(col, max(max(col.r, col.g), max(col.b, 1.0 - T)));
        return;
    }

    vec3 prev = ro + rd * t;
    bool prevCut = cut(prev);
    for (int i = 0; i < 700; i++) {
        if (t > tf) break;
        vec3 p = ro + rd * t;
        bool c = cut(p);
        if (!c) {
            vec4 s = S(p);
            if (s.a >= 1.0) {
                vec3 hit = p, n;
                bool face = false;
                if (prevCut && i > 0) {
                    // Arrived through the cut: the hit is on a cut plane.
                    vec3 a = prev, b = p;
                    for (int k = 0; k < 8; k++) { vec3 m = 0.5 * (a + b); if (cut(m)) a = m; else b = m; }
                    hit = b;
                    n = dot(hit, uCutA) <= dot(hit, uCutB) ? uCutA : uCutB;
                    face = true;
                } else {
                    vec3 a = prev, b = p;
                    for (int k = 0; k < 7; k++) { vec3 m = 0.5 * (a + b); if (S(m).a >= 1.0) b = m; else a = m; }
                    hit = b;
                    vec3 g = vec3(
                        S(hit + vec3(uEps, 0, 0)).a - S(hit - vec3(uEps, 0, 0)).a,
                        S(hit + vec3(0, uEps, 0)).a - S(hit - vec3(0, uEps, 0)).a,
                        S(hit + vec3(0, 0, uEps)).a - S(hit - vec3(0, 0, uEps)).a);
                    n = length(g) > 1e-6 ? -normalize(g) : -rd;
                }
                vec4 sh = S(hit);
                vec3 base = sh.rgb;
                vec3 V = -rd;
                vec3 col;
                if (face) {
                    float inside = clamp((sh.a - 1.0) * 0.25, 0.0, 1.0);
                    col = base * (0.5 + 0.2 * inside) * (0.8 + 0.2 * max(dot(n, uLight), 0.0));
                } else {
                    if (dot(n, V) < 0.0) n = -n;
                    float diff = max(dot(n, uLight), 0.0);
                    float spec = pow(max(dot(n, normalize(uLight + V)), 0.0), 48.0);
                    float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
                    col = base * (0.2 + 0.72 * diff) + vec3(0.32 * spec) + base * rim * 0.35;
                }
                frag = vec4(col, 1.0);
                return;
            }
        }
        prev = p; prevCut = c;
        t += uStep;
    }
    frag = vec4(0.0);
}`;

    let gl = null, canvas = null, overlay = null, octx = null;
    let prog = null, vao = null, tex = null;
    const uni = {};
    let G = 0, hasVolume = false, frame = 0;
    let renderScale = 1;
    const cam = { yaw: -0.62, pitch: 0.36, zoom: 1, fov: 30 * Math.PI / 180 };
    let aspect = 1;

    // Camera distance that fits the box's circumscribed sphere in whichever
    // field of view is narrower, divided by the user's zoom.
    function distance() {
        const fovH = 2 * Math.atan(Math.tan(cam.fov / 2) * aspect);
        const eff = Math.min(cam.fov, fovH);
        return 1.62 / Math.sin(eff / 2) / cam.zoom;
    }

    function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
    }

    function init(glCanvas, overlayCanvas) {
        canvas = glCanvas;
        overlay = overlayCanvas;
        octx = overlay.getContext('2d');
        gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: true });
        if (!gl) return false;
        prog = gl.createProgram();
        gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
        gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        for (const n of ['uVol', 'uRot', 'uCam', 'uTanHalf', 'uAspect', 'uMode', 'uCut', 'uCutA', 'uCutB',
                         'uExposure', 'uAbsorb', 'uStep', 'uEps', 'uFrame', 'uLight']) {
            uni[n] = gl.getUniformLocation(prog, n);
        }
        vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'aPos');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        tex = gl.createTexture();
        return true;
    }

    function setVolume(data, size) {
        G = size;
        gl.bindTexture(gl.TEXTURE_3D, tex);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, G, G, G, 0, gl.RGBA, gl.FLOAT, data);
        hasVolume = true;
    }
    function clearVolume() { hasVolume = false; }

    // ---- Camera ----
    // Object → view is M = Rx(pitch) · B · Rz(yaw): yaw about the object's z
    // axis, B turns object z into screen-up, pitch tips it toward the viewer.
    // Rows of M are the view axes expressed in object space.
    function rotation() {
        const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
        const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
        const rz = [[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]];
        const b = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];
        const rx = [[1, 0, 0], [0, cp, -sp], [0, sp, cp]];
        const mul = (A, B) => A.map(row => [0, 1, 2].map(j => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
        return mul(rx, mul(b, rz));
    }

    function project(M, p, W, H) {
        const x = M[0][0] * p[0] + M[0][1] * p[1] + M[0][2] * p[2];
        const y = M[1][0] * p[0] + M[1][1] * p[1] + M[1][2] * p[2];
        const z = M[2][0] * p[0] + M[2][1] * p[1] + M[2][2] * p[2] - distance();
        const f = (H / 2) / Math.tan(cam.fov / 2) / -z;
        return [W / 2 + x * f, H / 2 - y * f, z];
    }

    function resize() {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth, h = canvas.clientHeight;
        const s = Math.min(dpr, 1.5) * renderScale;
        const W = Math.max(1, Math.round(w * s)), H = Math.max(1, Math.round(h * s));
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
        aspect = w / Math.max(1, h);
        const OW = Math.round(w * dpr), OH = Math.round(h * dpr);
        if (overlay.width !== OW || overlay.height !== OH) { overlay.width = OW; overlay.height = OH; }
    }

    // opts: { style, cut, exposure }
    function render(opts) {
        resize();
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (!hasVolume) return;
        const M = rotation();
        // uRot maps view → object, i.e. Mᵀ. GLSL reads column-major, so M's
        // rows handed over in order become Mᵀ's columns.
        const Mt = new Float32Array([M[0][0], M[0][1], M[0][2], M[1][0], M[1][1], M[1][2], M[2][0], M[2][1], M[2][2]]);
        const D = distance();
        const camObj = [M[2][0] * D, M[2][1] * D, M[2][2] * D];
        const toObj = v => {
            const o = [0, 1, 2].map(j => M[0][j] * v[0] + M[1][j] * v[1] + M[2][j] * v[2]);
            const l = Math.hypot(...o);
            return o.map(c => c / l);
        };
        gl.useProgram(prog);
        gl.bindVertexArray(vao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_3D, tex);
        gl.uniform1i(uni.uVol, 0);
        gl.uniformMatrix3fv(uni.uRot, false, Mt);
        gl.uniform3fv(uni.uCam, camObj);
        gl.uniform1f(uni.uTanHalf, Math.tan(cam.fov / 2));
        gl.uniform1f(uni.uAspect, canvas.width / canvas.height);
        gl.uniform1i(uni.uMode, opts.style === 'surface' ? 1 : 0);
        gl.uniform1i(uni.uCut, opts.cut ? 1 : 0);
        gl.uniform3fv(uni.uCutA, toObj([0.7071, 0, 0.7071]));
        gl.uniform3fv(uni.uCutB, toObj([-0.7071, 0, 0.7071]));
        gl.uniform1f(uni.uExposure, opts.exposure || 1);
        gl.uniform1f(uni.uAbsorb, 1.2);
        gl.uniform1f(uni.uStep, 1.25 / G);
        gl.uniform1f(uni.uEps, 1 / G);
        gl.uniform1f(uni.uFrame, (frame++) % 64);
        gl.uniform3fv(uni.uLight, toObj([0.45, 0.65, 0.62]));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ---- Overlay ----
    // info: { map, showNucleus, ticks: [{ r, label }] }
    function drawOverlay(info) {
        const W = overlay.width, H = overlay.height;
        const dpr = window.devicePixelRatio || 1;
        octx.clearRect(0, 0, W, H);
        const M = rotation();
        const P = p => project(M, p, W, H);

        // Box edges: those on the far side dim and dashed.
        const corners = [];
        for (let i = 0; i < 8; i++) corners.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]);
        const camDir = [M[2][0], M[2][1], M[2][2]];
        octx.lineWidth = dpr;
        for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
            const d = i ^ j;
            if (d !== 1 && d !== 2 && d !== 4) continue;
            const a = corners[i], b = corners[j];
            const front = (a[0] + b[0]) * camDir[0] + (a[1] + b[1]) * camDir[1] + (a[2] + b[2]) * camDir[2] > 0.6;
            const pa = P(a), pb = P(b);
            octx.strokeStyle = front ? 'rgba(150,175,210,0.42)' : 'rgba(120,145,180,0.2)';
            octx.setLineDash(front ? [] : [3 * dpr, 4 * dpr]);
            octx.beginPath(); octx.moveTo(pa[0], pa[1]); octx.lineTo(pb[0], pb[1]); octx.stroke();
        }
        octx.setLineDash([]);

        // Axes through the centre, labelled just past the box faces.
        const axes = [['x', [1, 0, 0], '#ff7b72'], ['y', [0, 1, 0], '#7ee787'], ['z', [0, 0, 1], '#79b8ff']];
        octx.font = `${11 * dpr}px "Share Tech Mono", monospace`;
        octx.textAlign = 'center';
        octx.textBaseline = 'middle';
        for (const [name, v, col] of axes) {
            const a = P([-v[0], -v[1], -v[2]]), b = P(v);
            octx.strokeStyle = col;
            octx.globalAlpha = 0.28;
            octx.beginPath(); octx.moveTo(a[0], a[1]); octx.lineTo(b[0], b[1]); octx.stroke();
            octx.globalAlpha = 0.85;
            const l = P([v[0] * 1.12, v[1] * 1.12, v[2] * 1.12]);
            octx.fillStyle = col;
            octx.fillText(name, l[0], l[1]);
        }
        octx.globalAlpha = 1;

        // Radial ruler in screen space, under the box, starting below the
        // nucleus: ticks at physical radii, so the nonlinear 'shells' scale
        // can still be read. Lengths are measured at the depth of the centre.
        if (info.ticks && info.ticks.length && info.map) {
            const o = P([0, 0, 0]);
            const f = (H / 2) / Math.tan(cam.fov / 2) / distance();
            let low = 0;
            for (const c of corners) low = Math.max(low, P(c)[1]);
            const y = Math.min((info.rulerMax || H / dpr - 58) * dpr, low + 16 * dpr);
            const x1 = o[0] + f;
            octx.strokeStyle = 'rgba(215,225,240,0.5)';
            octx.fillStyle = 'rgba(215,225,240,0.78)';
            octx.lineWidth = dpr;
            octx.beginPath(); octx.moveTo(o[0], y); octx.lineTo(x1, y); octx.stroke();
            octx.beginPath(); octx.moveTo(o[0], y - 5 * dpr); octx.lineTo(o[0], y + 5 * dpr); octx.stroke();
            octx.font = `${10 * dpr}px "Share Tech Mono", monospace`;
            octx.textBaseline = 'top';
            octx.textAlign = 'center';
            octx.fillText('0', o[0], y + 7 * dpr);
            let lastX = o[0];
            for (const t of info.ticks) {
                const d = info.map.dOf(t.r);
                if (d <= 0 || d > 1) continue;
                const x = o[0] + d * f;
                const major = /^(0\.0*)?10* /.test(t.label);
                octx.beginPath(); octx.moveTo(x, y - (major ? 4 : 2) * dpr); octx.lineTo(x, y + (major ? 4 : 2) * dpr); octx.stroke();
                if (x - lastX > 38 * dpr) {
                    octx.fillText(t.label, x, y + 7 * dpr);
                    lastX = x;
                }
            }
        }

        if (info.showNucleus) {
            const c = P([0, 0, 0]);
            octx.fillStyle = '#ff6a5c';
            octx.shadowColor = '#ff6a5c';
            octx.shadowBlur = 8 * dpr;
            octx.beginPath(); octx.arc(c[0], c[1], 2.2 * dpr, 0, Math.PI * 2); octx.fill();
            octx.shadowBlur = 0;
        }
    }

    // ---- Interaction ----
    function orbit(dx, dy) {
        cam.yaw += dx * 0.008;
        cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + dy * 0.008));
    }
    function zoom(f) { cam.zoom = Math.max(0.5, Math.min(3.5, cam.zoom / f)); }

    return {
        init, setVolume, clearVolume, render, drawOverlay, orbit, zoom, cam, rotation, project, distance,
        get hasVolume() { return hasVolume; },
        set renderScale(s) { renderScale = s; },
        get renderScale() { return renderScale; },
    };
})();
