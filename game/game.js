'use strict';
/* ============================================================================
   SKYLINE RING RUSH — an original offline 3D flight game.
   Single canvas, software 3D renderer, zero network requests, zero assets.
   Everything (terrain, lake, runway, rings, plane, instruments) is drawn
   from code with a fixed seed, so every load renders the same world.

   Controls: W/S or Up/Down pitch, A/D or Left/Right bank & turn,
   mouse move steers, mouse wheel / Shift / Ctrl throttle, Space airbrake,
   C camera (chase / cockpit), P pause, R restart.
   Goal: take off from the valley runway, fly all 8 glowing rings, land.
   ============================================================================ */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = 1280, H = 720;
canvas.width = W; canvas.height = H;

/* ---------------- deterministic random ---------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261126);
function hash2(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) % 100000) / 100000;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
function fbm(x, z) {
  return vnoise(x, z) * 0.55 + vnoise(x * 2.13 + 5.2, z * 2.13 + 1.3) * 0.28 +
         vnoise(x * 4.31 + 9.1, z * 4.31 + 3.7) * 0.17;
}
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------------- terrain ----------------
   Valley floor ~3 m, rolling hills to ~150 m, snow mountains beyond,
   a lake at (650, -850), and a flat runway corridor along x = 0. */
const WATER_Y = 0;
function terrainHeight(x, z) {
  let h = fbm(x * 0.0035, z * 0.0035) * 90 + fbm(x * 0.0011 + 11, z * 0.0011 + 4) * 190 - 60;
  const m = fbm(x * 0.0009 + 31, z * 0.0009 + 17);
  // mountain wall: full height far away, softened near the runway
  const ridgeF = clamp((Math.hypot(x, z - 50) - 250) / 800, 0.3, 1);
  h += Math.max(0, m - 0.62) * 700 * ridgeF;
  h = Math.max(h, 3);                                     // dry valley floor
  const dx = (x - 650) / 420, dz = (z + 850) / 330;       // the lake, soft shore
  const d2 = dx * dx + dz * dz;
  const lakeT = clamp((1.12 - d2) / 0.35, 0, 1);
  if (lakeT > 0) h = lerp(h, -6 + d2 * 4, lakeT);
  // runway corridor flatten: wide, smooth blend so no cliff at the edge
  const cx = Math.max(0, 1 - Math.abs(x) / 260);
  const cz = Math.max(0, 1 - Math.max(0, Math.abs(z - 50) - 400) / 300);
  const f = Math.min(1, cx * cz * 2.2);
  return h * (1 - f);
}

/* ---------------- the course: 8 rings ---------------- */
const RING_R = 26;
const RINGS = [
  { x: 0,    y: 55,  z: -420 },
  { x: 280,  y: 75,  z: -760 },
  { x: 640,  y: 60,  z: -520 },
  { x: 650,  y: 55,  z: -1080 },
  { x: 150,  y: 120, z: -1360 },
  { x: -450, y: 150, z: -1000 },
  { x: -760, y: 120, z: -350 },
  { x: -300, y: 70,  z: 160 },
];
for (let i = 0; i < RINGS.length; i++) {
  const cur = RINGS[i], nxt = RINGS[(i + 1) % RINGS.length];
  const dx = nxt.x - cur.x, dy = nxt.y - cur.y, dz = nxt.z - cur.z;
  const len = Math.hypot(dx, dy, dz);
  cur.nx = dx / len; cur.ny = dy / len; cur.nz = dz / len;
}

/* ---------------- trees & clouds (fixed seed) ---------------- */
const TREES = [];
for (let i = 0; i < 220; i++) {
  const x = (rand() - 0.5) * 3200, z = -1600 + rand() * 2400;
  if (Math.abs(x) < 45 && z > -320 && z < 320) continue;   // keep runway clear
  const dx = (x - 650) / 460, dz = (z + 850) / 370;
  if (dx * dx + dz * dz < 1.15) continue;                  // keep lake clear
  TREES.push({ x, z, y: terrainHeight(x, z), h: 10 + rand() * 8, s: 0.8 + rand() * 0.5 });
}
const CLOUDS = [];
for (let i = 0; i < 18; i++) {
  CLOUDS.push({ x: (rand() - 0.5) * 3600, y: 260 + rand() * 160, z: -1800 + rand() * 2800, s: 60 + rand() * 90 });
}

/* ---------------- game state ---------------- */
const FT_PER_M = 3.28084, KT_PER_MS = 1.94384;
const state = {
  mode: 'menu',            // menu | flying | crashed | landed | complete
  camera: 'chase',         // chase | cockpit
  x: 0, y: 2, z: 190, heading: Math.PI, pitch: 0, roll: 0,
  speed: 0, throttle: 0, time: 0, score: 0,
  ringsPassed: 0, ringPrev: [], crashedWhy: '', muted: false,
  propAngle: 0, frozen: false,
};
function resetFlight(start) {
  state.x = start.x; state.y = start.y; state.z = start.z;
  state.heading = start.heading; state.pitch = start.pitch || 0; state.roll = 0;
  state.speed = start.speed || 0; state.throttle = start.throttle || 0;
  state.time = 0; state.score = 0; state.ringsPassed = 0;
  state.ringPrev = RINGS.map(r => (state.x - r.x) * r.nx + (state.y - r.y) * r.ny + (state.z - r.z) * r.nz);
  state.crashedWhy = ''; state.mode = 'flying';
}
const TAKEOFF = { x: 0, y: 2, z: 190, heading: Math.PI, speed: 0, throttle: 0 };

/* ---------------- input ---------------- */
const keys = {};
let mouse = { x: 0.5, y: 0.5, active: false };
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyC' && state.mode === 'flying') state.camera = state.camera === 'chase' ? 'cockpit' : 'chase';
  if (e.code === 'KeyR') startGame();
  if (e.code === 'KeyP' && state.mode === 'flying') state.mode = 'paused';
  else if (e.code === 'KeyP' && state.mode === 'paused') state.mode = 'flying';
  if (e.code === 'KeyM') state.muted = !state.muted;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) / r.width;
  mouse.y = (e.clientY - r.top) / r.height;
  mouse.active = true;
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  state.throttle = clamp(state.throttle - Math.sign(e.deltaY) * 0.08, 0, 1);
}, { passive: false });
canvas.addEventListener('mousedown', () => { mouse.active = true; });

/* ---------------- audio: tiny synthesized blip, no assets ---------------- */
let audioCtx = null;
function blip(freq) {
  if (state.muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.12, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.26);
  } catch (e) { /* audio unavailable: the game plays on silently */ }
}

/* ---------------- physics (fixed step) ---------------- */
const DT = 1 / 60;
function step() {
  if (state.mode !== 'flying') return;
  state.time += DT;
  state.propAngle += DT * 40 * (0.3 + state.throttle);

  // throttle
  if (keys['ShiftLeft'] || keys['ShiftRight']) state.throttle = clamp(state.throttle + DT * 0.6, 0, 1);
  if (keys['ControlLeft'] || keys['ControlRight']) state.throttle = clamp(state.throttle - DT * 0.6, 0, 1);
  const targetSpeed = 12 + state.throttle * 78 - (keys['Space'] ? 25 : 0);
  state.speed += clamp(targetSpeed - state.speed, -DT * 18, DT * 9);

  // pitch & roll targets from keyboard, mouse steers when no key is held
  let pitchT = 0, rollT = 0;
  if (keys['KeyW'] || keys['ArrowUp']) pitchT = 0.32;
  else if (keys['KeyS'] || keys['ArrowDown']) pitchT = -0.30;
  if (keys['KeyA'] || keys['ArrowLeft']) rollT = -0.85;
  else if (keys['KeyD'] || keys['ArrowRight']) rollT = 0.85;
  if (mouse.active && pitchT === 0 && rollT === 0) {
    rollT = clamp((mouse.x - 0.5) * 1.7, -0.85, 0.85);
    pitchT = clamp((0.5 - mouse.y) * 0.7, -0.30, 0.32);
  }
  state.pitch += (pitchT - state.pitch) * Math.min(1, DT * 3.2);
  state.roll += (rollT - state.roll) * Math.min(1, DT * 3.2);

  // stall: slow + nose up sinks the nose — only once airborne
  if (state.speed < 34 && state.pitch > -0.12 && state.y > terrainHeight(state.x, state.z) + 8) state.pitch -= DT * 0.35;

  // turn rate from bank, climb from pitch
  const turnRate = 9.81 * Math.tan(state.roll) / Math.max(state.speed, 22);
  state.heading += turnRate * DT;
  const cp = Math.cos(state.pitch);
  state.x += state.speed * cp * Math.sin(state.heading) * DT;
  state.z += state.speed * cp * Math.cos(state.heading) * DT;
  state.y += state.speed * Math.sin(state.pitch) * DT;
  if (state.y > 600) state.y = 600;

  // rings: crossing the ring plane inside the circle scores
  for (let i = 0; i < RINGS.length; i++) {
    if (i !== state.ringsPassed) continue;
    const r = RINGS[i];
    const d = (state.x - r.x) * r.nx + (state.y - r.y) * r.ny + (state.z - r.z) * r.nz;
    if (state.ringPrev[i] < 0 && d >= 0) {
      const px = state.x - r.nx * d, py = state.y - r.ny * d, pz = state.z - r.nz * d;
      if (Math.hypot(px - r.x, py - r.y, pz - r.z) < RING_R) {
        state.ringsPassed++;
        state.score += 1000;
        blip(880);
        if (state.ringsPassed === RINGS.length) finish('complete');
      }
    }
    state.ringPrev[i] = d;
  }

  // terrain / water / runway
  const g = terrainHeight(state.x, state.z);
  const onRunway = Math.abs(state.x) < 13 && state.z > -260 && state.z < 260;
  if (state.y <= g + 1.6) {
    if (onRunway && g <= 0.5 && state.speed < 45 && Math.abs(state.pitch) < 0.12) {
      finish('landed');
    } else if (g < WATER_Y + 0.4) {
      state.crashedWhy = 'Ditched in the lake';
      finish('crashed');
    } else {
      state.crashedWhy = 'Hit the mountainside';
      finish('crashed');
    }
  }
  state.groundClear = state.y - g;
}
function finish(mode) {
  state.mode = mode;
  if (mode === 'complete') state.score += Math.max(0, 3000 - Math.round(state.time) * 12);
  if (mode === 'landed') state.score += 500;
  showResults();
}

/* ---------------- camera & projection ---------------- */
function basis(yaw, pitch, roll) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const f = [Math.sin(yaw) * cp, sp, Math.cos(yaw) * cp];
  const r0 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const u0 = [f[1] * r0[2] - f[2] * r0[1], f[2] * r0[0] - f[0] * r0[2], f[0] * r0[1] - f[1] * r0[0]];
  const cr = Math.cos(roll), sr = Math.sin(roll);
  return {
    f,
    r: [r0[0] * cr + u0[0] * sr, r0[1] * cr + u0[1] * sr, r0[2] * cr + u0[2] * sr],
    u: [u0[0] * cr - r0[0] * sr, u0[1] * cr - r0[1] * sr, u0[2] * cr - r0[2] * sr],
  };
}
function makeCamera() {
  const b = basis(state.heading, state.pitch, state.roll);
  if (state.camera === 'cockpit') {
    const pos = [state.x + b.f[0] * 2 + b.u[0] * 1.4, state.y + b.f[1] * 2 + b.u[1] * 1.4, state.z + b.f[2] * 2 + b.u[2] * 1.4];
    return { pos, ...basis(state.heading, state.pitch, state.roll) };
  }
  const pos = [state.x - b.f[0] * 20 + b.u[0] * 5, state.y - b.f[1] * 20 + b.u[1] * 5, state.z - b.f[2] * 20 + b.u[2] * 5];
  const tx = state.x + b.f[0] * 40, ty = state.y + b.f[1] * 40, tz = state.z + b.f[2] * 40;
  const dx = tx - pos[0], dy = ty - pos[1], dz = tz - pos[2];
  const len = Math.hypot(dx, dy, dz);
  const yaw = Math.atan2(dx / len, dz / len), pitch = Math.asin(dy / len);
  return { pos, ...basis(yaw, pitch, state.roll * 0.45) };
}
let cam = null;
const FOCAL = (H / 2) / Math.tan((70 * Math.PI / 180) / 2);
function project(p) {
  const dx = p[0] - cam.pos[0], dy = p[1] - cam.pos[1], dz = p[2] - cam.pos[2];
  const cx = dx * cam.r[0] + dy * cam.r[1] + dz * cam.r[2];
  const cy = dx * cam.u[0] + dy * cam.u[1] + dz * cam.u[2];
  const cz = dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2];
  if (cz < 1.5) return null;
  return [W / 2 + (cx / cz) * FOCAL, H / 2 - (cy / cz) * FOCAL, cz];
}

/* ---------------- rendering ---------------- */
function lerpColor(a, b, t) {
  const na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((na >> 16) & 255, (nb >> 16) & 255, t));
  const g = Math.round(lerp((na >> 8) & 255, (nb >> 8) & 255, t));
  const bl = Math.round(lerp(na & 255, nb & 255, t));
  return `rgb(${r},${g},${bl})`;
}
// smooth height -> colour palette (no hard bands)
const PALETTE = [[-8, '#2e6cb0'], [0, '#6f9a52'], [45, '#5d8a4a'], [130, '#47663c'], [210, '#7a6a55'], [280, '#e9eff3']];
function terrainColor(h, slope) {
  let c = PALETTE[0][1];
  for (let i = 0; i < PALETTE.length - 1; i++) {
    if (h <= PALETTE[i + 1][0]) {
      const t = clamp((h - PALETTE[i][0]) / (PALETTE[i + 1][0] - PALETTE[i][0]), 0, 1);
      c = lerpColor(PALETTE[i][1], PALETTE[i + 1][1], t);
      break;
    }
  }
  // subtle patchiness from the noise field
  const n = vnoise(h * 3.1, h * 1.7);
  const f = 0.82 + clamp(0.35 - slope * 0.9, -0.18, 0.18) + (n - 0.5) * 0.08;
  const m = c.match(/\d+/g).map(Number);
  return `rgb(${clamp(Math.round(m[0] * f), 0, 255)},${clamp(Math.round(m[1] * f), 0, 255)},${clamp(Math.round(m[2] * f), 0, 255)})`;
}
function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  const t = clamp(1 - state.y / 700, 0.35, 1);
  g.addColorStop(0, '#2f6fd0');
  g.addColorStop(0.55, '#7fb2e8');
  g.addColorStop(1, '#cfe6f7');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // sun
  const sun = project([cam.pos[0] + 4000, 1600, cam.pos[2] - 5200]);
  if (sun) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 244, 200, 0.95)';
    ctx.shadowColor = '#fff3b0'; ctx.shadowBlur = 60;
    ctx.beginPath(); ctx.arc(sun[0], sun[1], 26, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}
function drawWorld() {
  const items = [];   // painter's list: {depth, kind, data}
  // camera-space transform + near-plane clip, so ground right under the
  // camera renders instead of leaving a hole (or a giant triangle)
  function camSpace(p) {
    const dx = p[0] - cam.pos[0], dy = p[1] - cam.pos[1], dz = p[2] - cam.pos[2];
    return [dx * cam.r[0] + dy * cam.r[1] + dz * cam.r[2],
            dx * cam.u[0] + dy * cam.u[1] + dz * cam.u[2],
            dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2]];
  }
  function clipNear(cs) {
    const res = [];
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i], b = cs[(i + 1) % cs.length];
      const aIn = a[2] >= 2, bIn = b[2] >= 2;
      if (aIn) res.push(a);
      if (aIn !== bIn) {
        const t = (2 - a[2]) / (b[2] - a[2]);
        res.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 2]);
      }
    }
    return res;
  }
  function addPoly3D(points3, col) {
    const cs = points3.map(camSpace);
    const clipped = clipNear(cs);
    if (clipped.length < 3) return;
    const pts = clipped.map(c => [W / 2 + (c[0] / c[2]) * FOCAL, H / 2 - (c[1] / c[2]) * FOCAL, c[2]]);
    const depth = clipped.reduce((s, c) => s + c[2], 0) / clipped.length;
    items.push({ depth, kind: 'poly', pts, col });
  }
  const CELL = 50, N = 32, HALF = N / 2;
  const gx0 = Math.round((cam.pos[0] + cam.f[0] * 650) / CELL) * CELL - HALF * CELL;
  const gz0 = Math.round((cam.pos[2] + cam.f[2] * 650) / CELL) * CELL - HALF * CELL;
  const P = [];
  for (let j = 0; j <= N; j++) {
    P[j] = [];
    for (let i = 0; i <= N; i++) {
      const x = gx0 + i * CELL, z = gz0 + j * CELL;
      const h = terrainHeight(x, z);
      P[j][i] = { p: [x, h, z], h };
    }
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = P[j][i], b = P[j][i + 1], c = P[j + 1][i + 1], d = P[j + 1][i];
      const slope = Math.abs(b.h - a.h) / CELL + Math.abs(d.h - a.h) / CELL;
      const col = terrainColor((a.h + b.h + c.h + d.h) / 4, slope);
      addPoly3D([a.p, b.p, c.p, d.p], col);
    }
  }
  // runway strip
  addPoly3D([[-14, 0.4, -260], [14, 0.4, -260], [14, 0.4, 260], [-14, 0.4, 260]], '#3c3f45');
  for (let z = -240; z <= 240; z += 40) {   // centreline dashes
    addPoly3D([[-0.8, 0.6, z], [0.8, 0.6, z], [0.8, 0.6, z + 18], [-0.8, 0.6, z + 18]], '#e8e8e8');
  }
  // hangars beside the runway
  for (const [hx, hz, hw, hh, hd] of [[48, 120, 26, 10, 20], [48, 165, 20, 8, 16]]) {
    const base = terrainHeight(hx, hz);
    addPoly3D([[hx - hw / 2, base + hh, hz - hd / 2], [hx + hw / 2, base + hh, hz - hd / 2],
               [hx + hw / 2, base + hh, hz + hd / 2], [hx - hw / 2, base + hh, hz + hd / 2]], '#8a94a6');
  }
  // trees
  for (const t of TREES) {
    const dx = t.x - cam.pos[0], dz = t.z - cam.pos[2];
    const dist = Math.hypot(dx, dz);
    if (dist > 1100) continue;
    addPoly3D([[t.x - 3 * t.s, t.y + 1, t.z], [t.x + 3 * t.s, t.y + 1, t.z], [t.x, t.y + t.h, t.z]], '#2f4d2a');
  }
  // rings
  for (let i = 0; i < RINGS.length; i++) {
    const r = RINGS[i];
    const c0 = project([r.x, r.y, r.z]);
    if (!c0) continue;
    // frame: u = normalize(cross(n, worldUp)) unless n is vertical, v = cross(n, u)
    const n = [r.nx, r.ny, r.nz];
    let u = [n[2], 0, -n[0]];
    const ul = Math.hypot(u[0], u[2]) || 1; u = [u[0] / ul, 0, u[2] / ul];
    const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const ringPts = [];
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const px = r.x + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * RING_R;
      const py = r.y + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * RING_R;
      const pz = r.z + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * RING_R;
      const s = project([px, py, pz]);
      if (s) ringPts.push(s);
    }
    const passed = i < state.ringsPassed;
    const next = i === state.ringsPassed;
    items.push({ depth: c0[2], kind: 'ring', pts: ringPts,
      col: passed ? '#39d353' : next ? '#ffd75e' : '#ff8c42' });
  }
  items.sort((a, b) => b.depth - a.depth);
  for (const it of items) {
    if (it.kind === 'poly') {
      ctx.fillStyle = it.col;
      ctx.beginPath();
      ctx.moveTo(it.pts[0][0], it.pts[0][1]);
      for (let k = 1; k < it.pts.length; k++) ctx.lineTo(it.pts[k][0], it.pts[k][1]);
      ctx.closePath(); ctx.fill();
    } else if (it.kind === 'ring' && it.pts.length > 3) {
      ctx.save();
      ctx.strokeStyle = it.col; ctx.lineWidth = 9; ctx.globalAlpha = 0.28;
      ctx.beginPath(); ctx.moveTo(it.pts[0][0], it.pts[0][1]);
      for (let k = 1; k < it.pts.length; k++) ctx.lineTo(it.pts[k][0], it.pts[k][1]);
      ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 3.5; ctx.shadowColor = it.col; ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.restore();
    }
  }
  // clouds (far, drawn last, no sorting needed)
  ctx.save();
  for (const c of CLOUDS) {
    const s = project([c.x, c.y, c.z]);
    if (!s || s[2] > 6000) continue;
    const sc = clamp(900 / s[2], 0.15, 1.4) * c.s / 60;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    for (const [ox, oy, r] of [[0, 0, 34], [-30, 8, 24], [32, 6, 26], [0, -12, 22]]) {
      ctx.beginPath(); ctx.ellipse(s[0] + ox * sc, s[1] + oy * sc, r * sc, r * 0.62 * sc, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

/* ---------------- the plane (chase view) ---------------- */
function planeLocalToWorld(lx, ly, lz) {
  const b = basis(state.heading, state.pitch, state.roll);
  return [state.x + b.r[0] * lx + b.u[0] * ly + b.f[0] * lz,
          state.y + b.r[1] * lx + b.u[1] * ly + b.f[1] * lz,
          state.z + b.r[2] * lx + b.u[2] * ly + b.f[2] * lz];
}
function drawPlane() {
  const P = (x, y, z) => project(planeLocalToWorld(x, y, z));
  const poly = (pts, col) => {
    const s = pts.map(p => p);
    if (s.some(v => !v)) return;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(s[0][0], s[0][1]);
    for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1]);
    ctx.closePath(); ctx.fill();
  };
  // fuselage: nose +7, tail -6, radius ~1.1
  poly([P(0, 0.9, 7), P(1.0, 0.2, 2), P(1.0, -0.4, -5), P(0, -0.6, -6)], '#d23b2e');
  poly([P(0, 0.9, 7), P(-1.0, 0.2, 2), P(-1.0, -0.4, -5), P(0, -0.6, -6)], '#b02e24');
  poly([P(0, 1.5, 7), P(1.0, 0.9, 2), P(1.0, 0.4, -5), P(0, 0.6, -6)], '#e8e8e8');
  // canopy (lit glass)
  poly([P(-0.7, 1.15, 4.6), P(0.7, 1.15, 4.6), P(0.55, 1.35, 2.2), P(-0.55, 1.35, 2.2)], '#7fd4ff');
  // wings
  poly([P(0.9, 0.15, 2.5), P(8.5, 0.15, 0.5), P(8.5, 0.05, -0.8), P(0.9, -0.1, -0.6)], '#f2f2f2');
  poly([P(-0.9, 0.15, 2.5), P(-8.5, 0.15, 0.5), P(-8.5, 0.05, -0.8), P(-0.9, -0.1, -0.6)], '#f2f2f2');
  poly([P(7.2, 0.15, 0.6), P(8.5, 0.15, 0.5), P(8.5, 0.05, -0.8), P(7.2, 0.05, -0.7)], '#d23b2e');
  poly([P(-7.2, 0.15, 0.6), P(-8.5, 0.15, 0.5), P(-8.5, 0.05, -0.8), P(-7.2, 0.05, -0.7)], '#d23b2e');
  // tailplane + fin
  poly([P(0.6, 0.3, -4.6), P(3.2, 0.3, -5.6), P(3.2, 0.25, -6.4), P(0.6, 0.1, -5.6)], '#f2f2f2');
  poly([P(-0.6, 0.3, -4.6), P(-3.2, 0.3, -5.6), P(-3.2, 0.25, -6.4), P(-0.6, 0.1, -5.6)], '#f2f2f2');
  poly([P(0, 0.5, -4.4), P(0, 2.6, -5.4), P(0, 2.6, -6.2), P(0, 0.4, -5.8)], '#d23b2e');
  // propeller: two spinning blades seen from behind
  const nose = P(0, 0.3, 7.4);
  if (nose) {
    const a = state.propAngle, bx = Math.cos(a) * 3.4, by = Math.sin(a) * 3.4;
    const scale = FOCAL / Math.max(nose[2], 1);
    ctx.save();
    ctx.strokeStyle = 'rgba(30,30,30,0.75)'; ctx.lineWidth = Math.max(2, scale * 0.28);
    ctx.beginPath(); ctx.moveTo(nose[0] - bx * scale * 0.12, nose[1] - by * scale * 0.12);
    ctx.lineTo(nose[0] + bx * scale * 0.12, nose[1] + by * scale * 0.12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(nose[0] + by * scale * 0.12, nose[1] - bx * scale * 0.12);
    ctx.lineTo(nose[0] - by * scale * 0.12, nose[1] + bx * scale * 0.12); ctx.stroke();
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(nose[0], nose[1], Math.max(2, scale * 0.12), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

/* ---------------- cockpit instruments (lit panel) ---------------- */
function gauge(cx, cy, r, label, value, max, unit) {
  ctx.save();
  ctx.shadowColor = '#39ff88'; ctx.shadowBlur = 12;
  ctx.fillStyle = '#0d1a12'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#39ff88'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#baffcf'; ctx.font = `bold ${Math.round(r * 0.22)}px monospace`;
  ctx.textAlign = 'center'; ctx.fillText(label, cx, cy - r + r * 0.32);
  // ticks
  ctx.strokeStyle = '#baffcf'; ctx.lineWidth = 1.5;
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
    ctx.lineTo(cx + Math.cos(a) * (r - 11), cy + Math.sin(a) * (r - 11));
    ctx.stroke();
  }
  const a = Math.PI * 0.75 + clamp(value / max, 0, 1) * Math.PI * 1.5;
  ctx.strokeStyle = '#ffd75e'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14)); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#baffcf'; ctx.font = `${Math.round(r * 0.24)}px monospace`;
  ctx.fillText(Math.round(value) + unit, cx, cy + r * 0.62);
  ctx.restore();
}
function drawCockpit() {
  const py = H - 190;
  // glareshield + panel
  const g = ctx.createLinearGradient(0, py, 0, H);
  g.addColorStop(0, '#1c2432'); g.addColorStop(1, '#0a0e16');
  ctx.fillStyle = g; ctx.fillRect(0, py, W, H - py);
  ctx.fillStyle = '#232d3d'; ctx.fillRect(0, py - 14, W, 14);
  // attitude indicator (centre)
  const ax = W / 2, ay = py + 88, ar = 62;
  ctx.save();
  ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI * 2); ctx.clip();
  ctx.translate(ax, ay); ctx.rotate(-state.roll);
  ctx.translate(0, clamp(state.pitch, -0.6, 0.6) * 120);
  ctx.fillStyle = '#2f7fd0'; ctx.fillRect(-ar, -ar * 2, ar * 2, ar * 2);
  ctx.fillStyle = '#8a5a2b'; ctx.fillRect(-ar, 0, ar * 2, ar * 2);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-ar, 0); ctx.lineTo(ar, 0); ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.shadowColor = '#39ff88'; ctx.shadowBlur = 12;
  ctx.strokeStyle = '#39ff88'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#ffd75e'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(ax - 26, ay); ctx.lineTo(ax - 8, ay); ctx.moveTo(ax + 8, ay); ctx.lineTo(ax + 26, ay); ctx.stroke();
  ctx.fillStyle = '#baffcf'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
  ctx.fillText('ATTITUDE', ax, ay + ar + 16);
  ctx.restore();
  // gauges
  gauge(W / 2 - 190, py + 88, 56, 'ALT', state.y * FT_PER_M, 12000, ' ft');
  gauge(W / 2 + 190, py + 88, 56, 'AIRSPEED', state.speed * KT_PER_MS, 220, ' kt');
  // compass strip
  const hdg = ((state.heading * 180 / Math.PI) % 360 + 360) % 360;
  ctx.save();
  ctx.fillStyle = '#0d1a12'; ctx.fillRect(W / 2 - 330, py + 22, 660, 30);
  ctx.strokeStyle = '#39ff88'; ctx.lineWidth = 2; ctx.shadowColor = '#39ff88'; ctx.shadowBlur = 8;
  ctx.strokeRect(W / 2 - 330, py + 22, 660, 30); ctx.shadowBlur = 0;
  ctx.fillStyle = '#baffcf'; ctx.font = 'bold 15px monospace'; ctx.textAlign = 'center';
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  for (let d = -60; d <= 60; d += 15) {
    const deg = Math.round((hdg + d + 360) % 360);
    const x = W / 2 + d * 4.4;
    const label = deg % 45 === 0 ? names[Math.round(deg / 45) % 8] : String(deg);
    ctx.fillText(label, x, py + 42);
  }
  ctx.fillStyle = '#ffd75e';
  ctx.beginPath(); ctx.moveTo(W / 2, py + 18); ctx.lineTo(W / 2 - 6, py + 8); ctx.lineTo(W / 2 + 6, py + 8); ctx.closePath(); ctx.fill();
  ctx.restore();
  // throttle lever (left) + warning lights (right)
  ctx.save();
  ctx.fillStyle = '#0d1a12'; ctx.fillRect(28, py + 30, 26, 130);
  ctx.strokeStyle = '#39ff88'; ctx.lineWidth = 2; ctx.strokeRect(28, py + 30, 26, 130);
  const ty = py + 30 + 130 * (1 - state.throttle);
  ctx.fillStyle = '#ffd75e'; ctx.fillRect(24, ty - 5, 34, 10);
  ctx.fillStyle = '#baffcf'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'left';
  ctx.fillText('THR ' + Math.round(state.throttle * 100) + '%', 62, py + 42);
  const warn = state.groundClear !== undefined && state.groundClear < 35;
  ctx.fillStyle = warn ? '#ff3b30' : '#22303f';
  ctx.shadowColor = warn ? '#ff3b30' : 'transparent'; ctx.shadowBlur = warn ? 16 : 0;
  ctx.beginPath(); ctx.arc(W - 60, py + 52, 12, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffb3ae'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'right';
  ctx.fillText(warn ? 'PULL UP' : 'TERRAIN', W - 82, py + 56);
  ctx.fillStyle = state.speed < 34 ? '#ff3b30' : '#22303f';
  ctx.beginPath(); ctx.arc(W - 60, py + 86, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffb3ae'; ctx.fillText(state.speed < 34 ? 'STALL' : 'SPEED OK', W - 82, py + 90);
  ctx.restore();
}

/* ---------------- HUD ---------------- */
function fmtTime(s) {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
}
function drawHUD() {
  const hdg = ((state.heading * 180 / Math.PI) % 360 + 360) % 360;
  ctx.save();
  ctx.font = 'bold 20px monospace'; ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(8, 16, 28, 0.72)'; ctx.fillRect(14, 12, 330, 92);
  ctx.strokeStyle = '#39ff88'; ctx.lineWidth = 1.5; ctx.strokeRect(14, 12, 330, 92);
  ctx.fillStyle = '#baffcf';
  ctx.fillText('ALT  ' + Math.round(state.y * FT_PER_M).toLocaleString('en-US') + ' FT', 26, 40);
  ctx.fillText('SPD  ' + Math.round(state.speed * KT_PER_MS) + ' KT', 26, 66);
  ctx.fillText('HDG  ' + String(Math.round(hdg)).padStart(3, '0') + '°', 26, 92);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(8, 16, 28, 0.72)'; ctx.fillRect(W - 344, 12, 330, 92);
  ctx.strokeStyle = '#ffd75e'; ctx.strokeRect(W - 344, 12, 330, 92);
  ctx.fillStyle = '#ffe9a8';
  ctx.fillText('RINGS  ' + state.ringsPassed + ' / ' + RINGS.length, W - 26, 40);
  ctx.fillText('TIME  ' + fmtTime(state.time), W - 26, 66);
  ctx.fillText('SCORE  ' + state.score.toLocaleString('en-US'), W - 26, 92);
  // throttle bar (chase view only; cockpit has its own lever)
  if (state.camera === 'chase') {
    ctx.fillStyle = 'rgba(8, 16, 28, 0.72)'; ctx.fillRect(W / 2 - 110, H - 34, 220, 20);
    ctx.strokeStyle = '#39ff88'; ctx.strokeRect(W / 2 - 110, H - 34, 220, 20);
    ctx.fillStyle = '#39ff88'; ctx.fillRect(W / 2 - 108, H - 32, 216 * state.throttle, 16);
    ctx.fillStyle = 'rgba(8, 16, 28, 0.85)'; ctx.fillRect(W / 2 - 44, H - 56, 88, 18);
    ctx.fillStyle = '#baffcf'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
    ctx.fillText('THR ' + Math.round(state.throttle * 100) + '%', W / 2, H - 42);
  }
  // centre crosshair
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(W / 2, H / 2 - 40, 12, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(W / 2 - 20, H / 2 - 40); ctx.lineTo(W / 2 - 12, H / 2 - 40);
  ctx.moveTo(W / 2 + 12, H / 2 - 40); ctx.lineTo(W / 2 + 20, H / 2 - 40);
  ctx.moveTo(W / 2, H / 2 - 60); ctx.lineTo(W / 2, H / 2 - 52);
  ctx.moveTo(W / 2, H / 2 - 28); ctx.lineTo(W / 2, H / 2 - 20);
  ctx.stroke();
  // next-ring off-screen arrow
  const next = RINGS[state.ringsPassed];
  if (next && state.mode === 'flying') {
    const s = project([next.x, next.y, next.z]);
    if (!s || s[0] < 60 || s[0] > W - 60 || s[1] < 60 || s[1] > H - 60) {
      const dx = next.x - state.x, dz = next.z - state.z;
      // screen-space direction: rotate world bearing into camera frame
      const b = basis(state.heading, state.pitch, state.roll);
      const lx = dx * b.r[0] + dz * b.r[2];
      const ly = dx * b.f[0] + dz * b.f[2]; // forward component -> up on screen
      const a = Math.atan2(-ly, lx);
      const ax = W / 2 + Math.cos(a) * 210, ay = H / 2 - 40 + Math.sin(a) * 150;
      ctx.save();
      ctx.translate(ax, ay); ctx.rotate(a);
      ctx.fillStyle = '#ffd75e'; ctx.shadowColor = '#ffd75e'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -10); ctx.lineTo(-10, 10); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#ffd75e'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
      ctx.fillText('NEXT RING ' + Math.round(Math.hypot(dx, dz)) + ' m', ax, ay + 26);
    }
  }
  // warnings
  if (state.mode === 'flying' && state.groundClear !== undefined && state.groundClear < 35 && Math.floor(state.time * 3) % 2 === 0) {
    ctx.fillStyle = '#ff3b30'; ctx.font = 'bold 34px monospace'; ctx.textAlign = 'center';
    ctx.fillText('⚠ PULL UP ⚠', W / 2, 150);
  }
  if (state.mode === 'paused') {
    ctx.fillStyle = 'rgba(8, 16, 28, 0.6)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 44px monospace'; ctx.textAlign = 'center';
    ctx.fillText('PAUSED — press P to resume', W / 2, H / 2);
  }
  ctx.restore();
}

/* ---------------- menu / results ---------------- */
const menuEl = document.getElementById('menu');
const resultsEl = document.getElementById('results');
function startGame() {
  menuEl.classList.add('hidden');
  resultsEl.classList.add('hidden');
  resetFlight(TAKEOFF);
}
function showResults() {
  const titles = { crashed: 'CRASHED', landed: 'LANDED SAFELY', complete: 'COURSE COMPLETE!' };
  document.getElementById('resultTitle').textContent = titles[state.mode] || 'FLIGHT OVER';
  document.getElementById('resultLine').textContent =
    state.mode === 'crashed' ? state.crashedWhy + ' — the valley claims another one. Try again.'
    : state.mode === 'landed' ? 'Wheels down on the runway. The rings are still waiting, though.'
    : 'All eight rings threaded. The valley is yours, pilot.';
  const rows = [
    ['Rings', state.ringsPassed + ' / ' + RINGS.length],
    ['Time', fmtTime(state.time)],
    ['Top speed', Math.round(Math.max(0, state.speed) * KT_PER_MS) + ' kt'],
    ['Score', state.score.toLocaleString('en-US')],
  ];
  document.getElementById('resultStats').innerHTML =
    rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
  resultsEl.classList.remove('hidden');
}
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('againBtn').addEventListener('click', startGame);

/* ---------------- main loop ---------------- */
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (state.frozen) { render(); return; }
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state.mode === 'flying' || state.mode === 'paused') {
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 5) { step(); acc -= DT; n++; }
  }
  render();
}
function render() {
  cam = makeCamera();
  drawSky();
  drawWorld();
  if (state.camera === 'chase') drawPlane();
  else drawCockpit();
  if (state.mode !== 'menu') drawHUD();
}

/* ---------------- screenshot scenes (?shot=) & self-test (?selftest=1) ---------------- */
const params = new URLSearchParams(location.search);
const SHOTS = {
  takeoff: { x: 0, y: 2, z: 190, heading: Math.PI, speed: 26, throttle: 0.85, camera: 'chase' },
  ring:    { x: 180, y: 72, z: -600, heading: 2.72, speed: 72, throttle: 0.8, camera: 'chase', rings: 1 },
  cockpit: { x: 640, y: 88, z: -180, heading: 3.10, speed: 76, throttle: 0.8, camera: 'cockpit', rings: 2 },
  valley:  { x: 600, y: 180, z: -750, heading: 2.99, speed: 68, throttle: 0.75, camera: 'chase', rings: 3 },
};
function applyShot(name) {
  const s = SHOTS[name];
  if (!s) return false;
  menuEl.classList.add('hidden');
  state.camera = s.camera;
  resetFlight({ x: s.x, y: s.y, z: s.z, heading: s.heading, speed: s.speed, throttle: s.throttle });
  state.ringsPassed = s.rings || 0;
  state.time = 42.5; state.score = state.ringsPassed * 1000;
  state.groundClear = state.y - terrainHeight(state.x, state.z);
  // settle the sim for a fixed 1.5 s, then freeze for a deterministic frame
  for (let i = 0; i < 90; i++) step();
  state.frozen = true;
  render();
  return true;
}
function runSelfTest() {
  const out = { checks: {}, pass: true };
  const t = (name, ok, detail) => { out.checks[name] = { ok: !!ok, detail: String(detail ?? '') }; if (!ok) out.pass = false; };
  try {
    t('terrain_deterministic', terrainHeight(123, -456) === terrainHeight(123, -456), terrainHeight(123, -456).toFixed(3));
    t('runway_flat', Math.abs(terrainHeight(0, 0)) < 0.01, terrainHeight(0, 0).toFixed(4));
    t('lake_below_water', terrainHeight(650, -850) < WATER_Y, terrainHeight(650, -850).toFixed(2));
    t('mountains_high', terrainHeight(-1400, -1400) > 150 || terrainHeight(1400, 1400) > 150,
      Math.max(terrainHeight(-1400, -1400), terrainHeight(1400, 1400)).toFixed(1));
    cam = makeCamera();
    const ahead = project([state.x + Math.sin(state.heading) * 100, state.y, state.z + Math.cos(state.heading) * 100]);
    t('projection_ahead', ahead && isFinite(ahead[0]) && isFinite(ahead[1]), ahead ? ahead.map(v => Math.round(v)).join(',') : 'null');
    const behind = project([cam.pos[0] - cam.f[0] * 50, cam.pos[1] - cam.f[1] * 50, cam.pos[2] - cam.f[2] * 50]);
    t('projection_behind_null', behind === null, String(behind));
    // ring crossing logic: teleport across ring 1's plane inside the circle
    resetFlight(TAKEOFF);
    const r0 = RINGS[0];
    state.x = r0.x - r0.nx * 5; state.y = r0.y; state.z = r0.z - r0.nz * 5;
    state.ringPrev[0] = -5;
    state.x = r0.x + r0.nx * 5; state.z = r0.z + r0.nz * 5;
    state.speed = 60; state.throttle = 0.8;
    step();
    t('ring_pass_detected', state.ringsPassed === 1, 'ringsPassed=' + state.ringsPassed);
    const res = performance.getEntriesByType('resource').filter(e => e.name.startsWith('http'));
    t('no_network_requests', res.length === 0, res.length + ' http resources');
    resetFlight(TAKEOFF);
    for (let i = 0; i < 120; i++) step();
    t('sim_runs_120_steps', state.mode === 'flying' || state.mode === 'landed' || state.mode === 'crashed',
      'mode=' + state.mode + ' y=' + state.y.toFixed(1) + ' speed=' + state.speed.toFixed(1));
    t('rings_defined', RINGS.length === 8, RINGS.length + ' rings');
    t('trees_generated', TREES.length > 100, TREES.length + ' trees');
  } catch (e) {
    out.pass = false; out.error = String(e && e.stack || e);
  }
  const el = document.getElementById('selftest');
  el.textContent = JSON.stringify(out);
  document.title = out.pass ? 'SELFTEST PASS' : 'SELFTEST FAIL';
  return out;
}
window.addEventListener('error', e => {
  window.__flightError = String(e.message);
});
window.__flight = { state, RINGS, terrainHeight, project, resetFlight, step, runSelfTest };

/* ---------------- boot ---------------- */
if (params.get('selftest') === '1') {
  menuEl.classList.add('hidden');
  resetFlight(TAKEOFF);
  runSelfTest();
  render();
} else if (params.get('shot')) {
  if (!applyShot(params.get('shot'))) { menuEl.classList.remove('hidden'); }
} else {
  resetFlight(TAKEOFF);
  state.mode = 'menu';
}
requestAnimationFrame(frame);
