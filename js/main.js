import { M, V } from './glmath.js';
import { Builder } from './mesh.js';
import { buildAbrams, TURRET_POS, TRUNNION } from './abrams.js';
import { Renderer } from './renderer.js';

const D2R = Math.PI / 180;
const qs = new URLSearchParams(location.search);
const canvas = document.getElementById('gl');
const $ = (id) => document.getElementById(id);

// Пресеты камеры. yaw=0 — камера со стороны правого борта, yaw=90 — спереди.
const VIEWS = {
  hero:   { t: [0.75, 1.20, 0.0], yaw: 52, pitch: 13, dist: 15.5, fov: 26 },
  side:   { t: [0.95, 1.30, 0.0], yaw: 0, pitch: 0, dist: 62, fov: 7.4 },
  top:    { t: [0.95, 1.2, 0.0], yaw: 0, pitch: 90, dist: 62, fov: 7.6 },
  front:  { t: [0.0, 1.30, 0.0], yaw: 90, pitch: 0, dist: 50, fov: 6.0 },
  turret: { t: [2.35, 2.02, 0.12], yaw: 50, pitch: 15, dist: 7.6, fov: 30 },
  rear:   { t: [-0.6, 1.25, 0.0], yaw: 222, pitch: 16, dist: 21, fov: 26 },
};
const state = { ...structuredClone(VIEWS.hero), turret: 0, gun: 0, auto: false, tTurret: 0, tGun: 0 };
let goal = null;

let renderer;
try { renderer = new Renderer(canvas); } catch (e) { $('err').textContent = String(e.message || e); $('err').style.display = 'block'; throw e; }

// ---- геометрия ----
const t0 = performance.now();
const b = new Builder();
buildAbrams(b);
b.group('ground').mat({ color: [0.5, 0.5, 0.5], rough: 0.9 });
{ const R = 34, n = 64, u = [0, 1, 0]; for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2; b.tri([0.6, 0, 0], [0.6 + Math.cos(a1) * R, 0, Math.sin(a1) * R], [0.6 + Math.cos(a0) * R, 0, Math.sin(a0) * R], u, u, u); } }
const meshes = b.finish();
let tris = 0;
['hull', 'turret', 'gun', 'ground'].forEach((k, i) => { renderer.addGroup(k, meshes[k], i * 3.7); tris += meshes[k].count / 3; });
$('stats').textContent = `${Math.round(tris).toLocaleString('ru-RU')} треугольников · построено за ${Math.round(performance.now() - t0)} мс`;

function setView(name, instant) {
  const v = VIEWS[name]; if (!v) return;
  document.querySelectorAll('[data-view]').forEach((el) => el.classList.toggle('on', el.dataset.view === name));
  if (instant) { Object.assign(state, structuredClone(v)); goal = null; } else {
    goal = structuredClone(v);
    // кратчайший поворот
    let d = ((goal.yaw - state.yaw) % 360 + 540) % 360 - 180; goal.yaw = state.yaw + d;
  }
  state.auto = false; $('auto').classList.remove('on');
}

function camera() {
  const aspect = renderer.w / renderer.h;
  const pitch = Math.min(89.99, Math.max(-4, state.pitch));
  const view = M.mulN(M.T(0, 0, -state.dist), M.RX(pitch * D2R), M.RY(-state.yaw * D2R), M.T(-state.t[0], -state.t[1], -state.t[2]));
  const inv = M.invert(view);
  const near = Math.min(2.5, Math.max(0.2, state.dist * 0.04)), far = state.dist + 80;
  return { view, proj: M.perspective(state.fov * D2R, aspect, near, far), pos: [inv[12], inv[13], inv[14]], inv };
}

function updateModels() {
  const tm = M.mul(M.T(...TURRET_POS), M.RY(state.turret * D2R));
  renderer.groups.turret.model = tm;
  renderer.groups.gun.model = M.mulN(tm, M.T(...TRUNNION), M.RZ(state.gun * D2R));
}

// ---- управление ----
let drag = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey }; goal = null; });
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
  if (drag.pan) {
    const c = camera(), k = state.dist * Math.tan(state.fov * D2R / 2) * 2 / canvas.clientHeight;
    const right = [c.inv[0], c.inv[1], c.inv[2]], up = [c.inv[4], c.inv[5], c.inv[6]];
    state.t = V.add(state.t, V.add(V.mul(right, -dx * k), V.mul(up, dy * k)));
    state.t[1] = Math.max(0.1, state.t[1]);
  } else { state.yaw -= dx * 0.3; state.pitch = Math.min(89.99, Math.max(-2, state.pitch + dy * 0.3)); }
  document.querySelectorAll('[data-view]').forEach((el) => el.classList.remove('on'));
});
canvas.addEventListener('wheel', (e) => { e.preventDefault(); goal = null; state.dist = Math.min(120, Math.max(2.2, state.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });
document.querySelectorAll('[data-view]').forEach((el) => el.addEventListener('click', () => setView(el.dataset.view)));
$('auto').addEventListener('click', () => { state.auto = !state.auto; $('auto').classList.toggle('on', state.auto); goal = null; });
$('turret').addEventListener('input', (e) => { state.tTurret = +e.target.value; $('turretV').textContent = e.target.value + '°'; });
$('gunel').addEventListener('input', (e) => { state.tGun = +e.target.value; $('gunV').textContent = e.target.value + '°'; });
addEventListener('keydown', (e) => {
  const map = { 1: 'hero', 2: 'side', 3: 'top', 4: 'front', 5: 'turret', 6: 'rear' };
  if (map[e.key]) setView(map[e.key]);
});

// ---- параметры URL (используются скриптом скриншотов) ----
const still = qs.get('still') === '1';
const forcedSS = qs.get('ss') ? +qs.get('ss') : 0;
if (qs.get('ui') === '0') document.body.classList.add('noui');
if (qs.get('view')) setView(qs.get('view'), true); else setView('hero', true);
for (const k of ['yaw', 'pitch', 'dist', 'fov']) if (qs.get(k)) state[k] = +qs.get(k);
if (qs.get('target')) state.t = qs.get('target').split(',').map(Number);
if (qs.get('turret')) { state.turret = state.tTurret = +qs.get('turret'); }
if (qs.get('gun')) { state.gun = state.tGun = +qs.get('gun'); }
if (qs.get('exp')) renderer.exposure = +qs.get('exp');

let last = performance.now(), frames = 0, slow = 0, autoSS = 1;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(2, Math.round(canvas.clientWidth * dpr)), h = Math.max(2, Math.round(canvas.clientHeight * dpr));
  const ss = forcedSS || (dpr >= 2 ? 1.25 : 2) * autoSS;
  renderer.ss = ss; renderer.resize(w, h, ss);
  // адаптивное качество: если кадр слишком тяжёлый — снижаем суперсэмплинг
  if (!forcedSS && frames > 10) { if (dt > 0.05) slow++; else slow = Math.max(0, slow - 1); if (slow > 25 && autoSS > 0.5) { autoSS *= 0.75; slow = 0; } }
  if (goal) {
    const k = 1 - Math.exp(-dt * 5);
    for (const key of ['yaw', 'pitch', 'dist', 'fov']) state[key] += (goal[key] - state[key]) * k;
    state.t = V.lerp(state.t, goal.t, k);
    if (Math.abs(goal.yaw - state.yaw) < 0.02 && Math.abs(goal.dist - state.dist) < 0.01 && Math.abs(goal.pitch - state.pitch) < 0.02) { Object.assign(state, goal); goal = null; }
  }
  if (state.auto) state.yaw += dt * 9;
  const k2 = 1 - Math.exp(-dt * 4);
  state.turret += (state.tTurret - state.turret) * k2; state.gun += (state.tGun - state.gun) * k2;
  updateModels();
  renderer.render(camera());
  frames++;
  window.__frameMs = performance.now() - now;
  if (still) { renderer.gl.finish(); window.__frameMs = performance.now() - now; window.__ready = true; return; }
  if (frames === 3) window.__ready = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__state = state; window.__renderer = renderer;
