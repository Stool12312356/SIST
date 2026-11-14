// Процедурный конструктор геометрии: выпуклые многогранники с фасками,
// тела вращения, стержни. Никаких внешних библиотек.
import { M, V } from './glmath.js';

const EPS = 1e-7;

// ---- выпуклая оболочка (перебор, для небольших наборов точек) ----
export function convexHull(pts) {
  const P = [];
  for (const p of pts) {
    let dup = false;
    for (const q of P) { const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2]; if (dx * dx + dy * dy + dz * dz < 1e-11) { dup = true; break; } }
    if (!dup) P.push(p);
  }
  const n = P.length, faces = [];
  if (n < 4) return faces;
  const used = new Set();
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    if (used.has(i * 4096 * 4096 + j * 4096 + k)) continue;
    const a = P[i], b = P[j], c = P[k];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-10) continue;
    nx /= l; ny /= l; nz /= l;
    const d = nx * a[0] + ny * a[1] + nz * a[2];
    let pos = 0, neg = 0; const on = [];
    for (let m = 0; m < n; m++) {
      const s = nx * P[m][0] + ny * P[m][1] + nz * P[m][2] - d;
      if (s > EPS) pos++; else if (s < -EPS) neg++; else on.push(m);
      if (pos && neg) break;
    }
    if (pos && neg) continue;
    for (let x = 0; x < on.length; x++) for (let y = x + 1; y < on.length; y++) for (let z = y + 1; z < on.length; z++) used.add(on[x] * 4096 * 4096 + on[y] * 4096 + on[z]);
    if (pos) { nx = -nx; ny = -ny; nz = -nz; }
    const nrm = [nx, ny, nz];
    // упорядочить точки грани по углу
    let cx = 0, cy = 0, cz = 0;
    for (const m of on) { cx += P[m][0]; cy += P[m][1]; cz += P[m][2]; }
    cx /= on.length; cy /= on.length; cz /= on.length;
    const e1 = V.norm([P[on[0]][0] - cx, P[on[0]][1] - cy, P[on[0]][2] - cz]);
    const e2 = V.cross(nrm, e1);
    const ord = on.map((m) => {
      const r = [P[m][0] - cx, P[m][1] - cy, P[m][2] - cz];
      return { m, a: Math.atan2(V.dot(r, e2), V.dot(r, e1)) };
    }).sort((p, q) => p.a - q.a);
    // выбросить коллинеарные точки
    let poly = ord.map((o) => P[o.m]);
    if (poly.length > 3) {
      poly = poly.filter((p, idx) => {
        const a2 = poly[(idx + poly.length - 1) % poly.length], b2 = poly[(idx + 1) % poly.length];
        return V.len(V.cross(V.sub(p, a2), V.sub(b2, p))) > 1e-9;
      });
    }
    if (poly.length >= 3) faces.push({ n: nrm, pts: poly });
  }
  return faces;
}

// вершины многогранника, заданного полупространствами [nx,ny,nz,d]: n·p <= d
export function polytope(planes) {
  const pts = [], n = planes.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    const a = planes[i], b = planes[j], c = planes[k];
    const bc = V.cross(b, c), det = V.dot(a, bc);
    if (Math.abs(det) < 1e-9) continue;
    const ca = V.cross(c, a), ab = V.cross(a, b);
    const p = [(a[3] * bc[0] + b[3] * ca[0] + c[3] * ab[0]) / det, (a[3] * bc[1] + b[3] * ca[1] + c[3] * ab[1]) / det, (a[3] * bc[2] + b[3] * ca[2] + c[3] * ab[2]) / det];
    let ok = true;
    for (let m = 0; m < n; m++) { const q = planes[m]; if (q[0] * p[0] + q[1] * p[1] + q[2] * p[2] > q[3] + 1e-6) { ok = false; break; } }
    if (ok) pts.push(p);
  }
  return pts;
}
// плоскость по точке и (не обязательно единичной) нормали
export function plane(p, n) { const u = V.norm(n); return [u[0], u[1], u[2], V.dot(u, p)]; }

// сжать грани внутрь на b (для фасок)
function insetFaces(faces, b) {
  const out = [];
  for (const f of faces) {
    const p = f.pts, m = p.length;
    for (let i = 0; i < m; i++) {
      const a = p[(i + m - 1) % m], c = p[i], d = p[(i + 1) % m];
      const e1 = V.norm(V.cross(f.n, V.sub(c, a))), e2 = V.norm(V.cross(f.n, V.sub(d, c)));
      const k = 1 + V.dot(e1, e2);
      if (k < 0.05) { out.push(c); continue; }
      let mv = V.mul(V.add(e1, e2), 1 / k);
      const ml = V.len(mv); if (ml > 3) mv = V.mul(mv, 3 / ml);
      out.push(V.add(c, V.mul(mv, b)));
    }
  }
  return out;
}

export function chamferedFaces(pts, bevel) {
  let faces = convexHull(pts);
  if (bevel > 0 && faces.length) {
    let minE = 1e9;
    for (const f of faces) for (let i = 0; i < f.pts.length; i++) minE = Math.min(minE, V.len(V.sub(f.pts[i], f.pts[(i + 1) % f.pts.length])));
    const b = Math.min(bevel, minE * 0.3);
    if (b > 1e-4) {
      const f2 = convexHull(insetFaces(faces, b));
      if (f2.length >= faces.length) {
        // грани-фаски помечаем (для потёртостей кромок в шейдере)
        for (const f of f2) { f.edge = 1; for (const o of faces) if (V.dot(f.n, o.n) > 0.99995) { f.edge = 0; break; } }
        faces = f2;
      }
    }
  }
  return faces;
}

// точки призмы: профиль в плоскости XY, выдавленный по Z
export function prismXY(prof, z0, z1) { const o = []; for (const p of prof) { o.push([p[0], p[1], z0], [p[0], p[1], z1]); } return o; }
export function prismXZ(prof, y0, y1) { const o = []; for (const p of prof) { o.push([p[0], y0, p[1]], [p[0], y1, p[1]]); } return o; }
export function prismZY(prof, x0, x1) { const o = []; for (const p of prof) { o.push([x0, p[1], p[0]], [x1, p[1], p[0]]); } return o; }

export class Builder {
  constructor() {
    this.groups = {};
    this.cur = null;
    this.stack = [M.ident()];
    this.m = { col: [200, 200, 200], rough: 200, metal: 0, dust: 255, bump: 0, glass: 0 };
    this.boxCache = new Map();
  }
  group(name) {
    if (!this.groups[name]) this.groups[name] = { pos: [], nrm: [], col: [], mat: [], edg: [] };
    this.cur = this.groups[name];
    return this;
  }
  get top() { return this.stack[this.stack.length - 1]; }
  push(m) { this.stack.push(M.mul(this.top, m)); return this; }
  pop() { this.stack.pop(); return this; }
  at(m, fn) { this.push(m); fn(); this.pop(); return this; }
  mirrorZ(fn) { fn(1); this.push(M.S(1, 1, -1)); fn(-1); this.pop(); }
  // материал: color sRGB 0..1
  mat(o) {
    this.m = {
      col: o.color.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255)),
      rough: Math.round((o.rough ?? 0.8) * 255), metal: Math.round((o.metal ?? 0) * 255),
      dust: Math.round((o.dust ?? 1) * 255), bump: Math.round((o.bump ?? 0) * 255), glass: Math.round((o.glass ?? 0) * 255),
    };
    return this;
  }
  _v(p, n, e = 0) {
    const g = this.cur, m = this.m; g.edg.push(e);
    g.pos.push(p[0], p[1], p[2]);
    g.nrm.push(n[0], n[1], n[2]);
    g.col.push(m.col[0], m.col[1], m.col[2], m.rough);
    g.mat.push(m.metal, m.dust, m.bump, m.glass);
  }
  // треугольник в локальных координатах; нормали по вершинам
  tri(a, b, c, na, nb, nc, e = 0) {
    const t = this.top;
    this._v(M.pt(t, a), V.norm(M.dir(t, na)), e);
    this._v(M.pt(t, b), V.norm(M.dir(t, nb)), e);
    this._v(M.pt(t, c), V.norm(M.dir(t, nc)), e);
  }
  faces(faces) {
    for (const f of faces) for (let i = 1; i < f.pts.length - 1; i++) this.tri(f.pts[0], f.pts[i], f.pts[i + 1], f.n, f.n, f.n, f.edge || 0);
    return this;
  }
  hull(pts, bevel = 0.006) { return this.faces(chamferedFaces(pts, bevel)); }
  poly(planes, bevel = 0.008) { return this.hull(polytope(planes), bevel); }
  // коробка по центру и размерам
  box(cx, cy, cz, sx, sy, sz, bevel = 0.005) {
    const key = sx.toFixed(4) + '|' + sy.toFixed(4) + '|' + sz.toFixed(4) + '|' + bevel;
    let f = this.boxCache.get(key);
    if (!f) {
      const hx = sx / 2, hy = sy / 2, hz = sz / 2, p = [];
      for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) p.push([x, y, z]);
      f = chamferedFaces(p, bevel); this.boxCache.set(key, f);
    }
    this.push(M.T(cx, cy, cz)); this.faces(f); this.pop();
    return this;
  }
  // коробка по границам
  bx(x0, x1, y0, y1, z0, z1, bevel = 0.005) {
    return this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), bevel);
  }
  // тело вращения вокруг локальной оси X. profile: [[x, r], ...]
  lathe(profile, segs = 24, smoothDeg = 35, a0 = 0, a1 = Math.PI * 2) {
    const n = profile.length, sn = [];
    for (let i = 0; i < n - 1; i++) {
      const dx = profile[i + 1][0] - profile[i][0], dr = profile[i + 1][1] - profile[i][1];
      const l = Math.hypot(dx, dr) || 1; sn.push([-dr / l, dx / l]);
    }
    const cosT = Math.cos(smoothDeg * Math.PI / 180);
    const vn = (seg, end) => { // нормаль вершины сегмента (end: 0 начало, 1 конец)
      const me = sn[seg], o = end ? sn[seg + 1] : sn[seg - 1];
      if (o && me[0] * o[0] + me[1] * o[1] > cosT) { const x = me[0] + o[0], y = me[1] + o[1], l = Math.hypot(x, y); return [x / l, y / l]; }
      return me;
    };
    for (let i = 0; i < n - 1; i++) {
      const p0 = profile[i], p1 = profile[i + 1];
      if (Math.abs(p0[0] - p1[0]) < 1e-9 && Math.abs(p0[1] - p1[1]) < 1e-9) continue;
      const n0 = vn(i, 0), n1 = vn(i, 1);
      for (let s = 0; s < segs; s++) {
        const t0 = a0 + (a1 - a0) * s / segs, t1 = a0 + (a1 - a0) * (s + 1) / segs;
        const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
        const A = [p0[0], p0[1] * c0, p0[1] * s0], B = [p1[0], p1[1] * c0, p1[1] * s0];
        const C = [p1[0], p1[1] * c1, p1[1] * s1], D = [p0[0], p0[1] * c1, p0[1] * s1];
        const nA = [n0[0], n0[1] * c0, n0[1] * s0], nB = [n1[0], n1[1] * c0, n1[1] * s0];
        const nC = [n1[0], n1[1] * c1, n1[1] * s1], nD = [n0[0], n0[1] * c1, n0[1] * s1];
        if (p1[1] > 1e-9) this.tri(A, B, C, nA, nB, nC);
        if (p0[1] > 1e-9) this.tri(A, C, D, nA, nC, nD);
      }
    }
    return this;
  }
  // цилиндр вдоль локальной X от x0 до x1 с торцами
  cyl(x0, x1, r, segs = 16, r1 = r) { return this.lathe([[x0, 0], [x0, r], [x1, r1], [x1, 0]], segs, 20); }
  // стержень между двумя точками
  rod(a, b, r, segs = 8, caps = true) {
    const l = V.len(V.sub(b, a)); if (l < 1e-6) return this;
    this.push(M.align(a, b));
    this.lathe(caps ? [[0, 0], [0, r], [l, r], [l, 0]] : [[0, r], [l, r]], segs, 20);
    this.pop(); return this;
  }
  sphere(c, r, segs = 10) {
    const prof = []; const k = Math.max(4, segs >> 1);
    for (let i = 0; i <= k; i++) { const a = Math.PI * i / k; prof.push([-Math.cos(a) * r, Math.sin(a) * r]); }
    this.push(M.T(c[0], c[1], c[2])); this.lathe(prof, segs, 80); this.pop(); return this;
  }
  // ломаная труба со скруглёнными стыками
  pipe(pts, r, segs = 8) {
    for (let i = 0; i < pts.length - 1; i++) this.rod(pts[i], pts[i + 1], r, segs, false);
    for (const p of pts) this.sphere(p, r, segs);
    return this;
  }
  // записать фрагмент, чтобы потом размножить
  capture(fn) {
    const saveCur = this.cur, saveStack = this.stack;
    const tmp = { pos: [], nrm: [], col: [], mat: [], edg: [] };
    this.cur = tmp; this.stack = [M.ident()];
    fn();
    this.cur = saveCur; this.stack = saveStack;
    return tmp;
  }
  place(frag, m) {
    const t = M.mul(this.top, m), g = this.cur;
    for (let i = 0; i < frag.pos.length; i += 3) {
      const p = M.pt(t, [frag.pos[i], frag.pos[i + 1], frag.pos[i + 2]]);
      const nn = V.norm(M.dir(t, [frag.nrm[i], frag.nrm[i + 1], frag.nrm[i + 2]]));
      g.pos.push(p[0], p[1], p[2]); g.nrm.push(nn[0], nn[1], nn[2]);
    }
    for (let i = 0; i < frag.col.length; i++) g.col.push(frag.col[i]);
    for (let i = 0; i < frag.mat.length; i++) g.mat.push(frag.mat[i]);
    for (let i = 0; i < frag.edg.length; i++) g.edg.push(frag.edg[i]);
    return this;
  }
  finish() {
    const out = {};
    for (const k in this.groups) {
      const g = this.groups[k], n = g.pos.length / 3;
      const nrm = new Int16Array(n * 4);
      for (let i = 0; i < n; i++) { nrm[i * 4] = g.nrm[i * 3] * 32767; nrm[i * 4 + 1] = g.nrm[i * 3 + 1] * 32767; nrm[i * 4 + 2] = g.nrm[i * 3 + 2] * 32767; nrm[i * 4 + 3] = g.edg[i] * 32767; }
      out[k] = { count: n, pos: new Float32Array(g.pos), nrm, col: new Uint8Array(g.col), mat: new Uint8Array(g.mat) };
    }
    return out;
  }
}
