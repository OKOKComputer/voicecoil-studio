// Voice coil under a given magnet — ported from "Войскол под магнит" v1 (verified axisymmetric grid solver),
// plus a bridge to the general scene engine (3D view, cross-check).
import { MU0, QI, qAxisAngle } from '../engine/vec.js';
import { cel, cylinderBrz } from '../engine/cylinder.js';
import { COND, ringCoil } from '../engine/coils.js';
import { MAGDENS } from '../engine/scene.js';

function solBr(a, zc, b, rho, z) {
  const zz = z - zc, zp = zz + b, zm = zz - b, s2 = (rho + a) * (rho + a), d2 = (a - rho) * (a - rho);
  const ap = a / Math.sqrt(zp * zp + s2), am = a / Math.sqrt(zm * zm + s2);
  const kp = Math.sqrt((zp * zp + d2) / (zp * zp + s2)), km = Math.sqrt((zm * zm + d2) / (zm * zm + s2));
  return ap * cel(kp, 1, 1, -1) - am * cel(km, 1, 1, -1);
}
function stackGeom(m, count, mode, spacer) {
  const mags = []; let z = 0;
  for (let k = 0; k < count; k++) { mags.push({ z0: z, z1: z + m.L, dir: mode === 'alt' ? (k % 2 ? -1 : 1) : 1 }); z += m.L + spacer; }
  return { mags, top: z - spacer };
}
function surfaces(m, geom, plate) {
  const S = []; const B0 = m.Br / Math.PI;
  for (const g of geom.mags) {
    const zc = (g.z0 + g.z1) / 2, b = (g.z1 - g.z0) / 2;
    S.push({ a: m.Ro, zc, b, s: B0 * g.dir });
    if (m.Ri > 0) S.push({ a: m.Ri, zc, b, s: -B0 * g.dir });
    if (plate) { S.push({ a: m.Ro, zc: -zc, b, s: B0 * g.dir }); if (m.Ri > 0) S.push({ a: m.Ri, zc: -zc, b, s: -B0 * g.dir }); }
  }
  return S;
}
export function solveBare(P, cfg) {
  const m = P.mag, c = P.clear, St = P.stroke, geom = stackGeom(m, cfg.count, cfg.mode, cfg.spacer);
  const H = geom.top, margin = Math.max(m.L * 1.2, m.Ro * 1.2, St / 2 + c + 0.002);
  let zlo = -margin, zhi = H + margin;
  if (cfg.plate) zlo = 0;
  if (P.Hlim > 0) {
    if (H > P.Hlim) return { invalid: 'магниты не влезают по высоте' };
    if (cfg.plate) { zhi = Math.min(zhi, P.Hlim); }
    else { zlo = Math.max(zlo, H / 2 - P.Hlim / 2); zhi = Math.min(zhi, H / 2 + P.Hlim / 2); }
  }
  const Rmax = P.Rmax, nr = P.nr, nzc = P.nz;
  const dr = Rmax / nr, dz = (zhi - zlo) / nzc;
  const sh = Math.round(St / 2 / dz);
  const nzf = nzc + 2 * sh, zf0 = zlo - sh * dz;
  const S = surfaces(m, geom, cfg.plate);
  const W = new Float64Array(nzf * nr), bF = new Float64Array(nzf * nr), dV = new Float64Array(nr);
  for (let i = 0; i < nr; i++) { const r = (i + .5) * dr; dV[i] = 2 * Math.PI * r * dr * dz; }
  for (let j = 0; j < nzf; j++) {
    const z = zf0 + (j + .5) * dz;
    for (let i = 0; i < nr; i++) {
      const r = (i + .5) * dr; let br = 0;
      if (cfg.plate && z < 0) { br = 0; } else
        for (const s of S) { if (Math.abs(r - s.a) < 1e-9) continue; br += s.s * solBr(s.a, s.zc, s.b, r, z); }
      bF[j * nr + i] = br; W[j * nr + i] = br * dV[i];
    }
  }
  const F = new Uint8Array(nzc * nr);
  for (let j = 0; j < nzc; j++) {
    const za = zlo + j * dz, zb = za + dz;
    for (let i = 0; i < nr; i++) {
      const ra = i * dr, rb = ra + dr; let f = 0;
      if (rb > m.Ri - c && ra < m.Ro + c && zb > -c - St / 2 && za < H + c + St / 2 && !(m.Ri > 0 && rb <= m.Ri - c)) f = 1;
      if (cfg.plate && za < c + St / 2) f = 1;
      F[j * nr + i] = f;
    }
  }
  const mat = COND[P.cond], rho = mat.rho20 * (1 + mat.alpha * (P.T - 20));
  const kf = P.kf, densEff = kf * mat.dens + (1 - kf) * 1200;
  const kfac = Math.sqrt(kf / rho);
  const magMass = cfg.count * Math.PI * (m.Ro * m.Ro - m.Ri * m.Ri) * m.L * MAGDENS[m.type];
  const moveMag = P.moving === 'magnet';
  const load = P.load;
  const shifts = sh > 0 ? [...new Set([-sh, -Math.round(sh / 2), 0, Math.round(sh / 2), sh])] : [0];
  const ns = shifts.length;
  const A = new Float64Array(nzf), rowF = new Int32Array(nzc);
  const sg = new Float64Array(nzc); const Ps = shifts.map(() => new Float64Array(nzc + 1));
  let best = { score: -1 };
  const objective = P.obj;
  for (let r1 = 0; r1 < nr; r1++) {
    A.fill(0); rowF.fill(0); let vrow = 0;
    for (let r2 = r1; r2 < nr; r2++) {
      vrow += dV[r2];
      for (let j = 0; j < nzf; j++) A[j] += W[j * nr + r2];
      for (let j = 0; j < nzc; j++) rowF[j] += F[j * nr + r2];
      for (let j = 0; j < nzc; j++) { sg[j] = P.sections ? (A[j + sh] >= 0 ? 1 : -1) : 1; }
      for (let k = 0; k < ns; k++) { const s = shifts[k], p = Ps[k]; p[0] = 0; for (let j = 0; j < nzc; j++) p[j + 1] = p[j] + sg[j] * A[j + sh + s]; }
      for (let j1 = 0; j1 < nzc; j1++) {
        if (rowF[j1] > 0) continue;
        for (let j2 = j1; j2 < nzc; j2++) {
          if (rowF[j2] > 0) break;
          let sum = 0, mn = 1e9, mx = -1e9;
          for (let k = 0; k < ns; k++) { const v = Ps[k][j2 + 1] - Ps[k][j1]; sum += v; if (v < mn) mn = v; if (v > mx) mx = v; }
          let fm = sum / ns; if (!P.sections) { if (fm < 0) { fm = -fm; const t = -mn; mn = -mx; mx = t; } }
          if (fm <= 0) continue;
          const V = vrow * (j2 - j1 + 1); if (P.mmax > 0 && V * densEff > P.mmax) break; const km = kfac * fm / Math.sqrt(V);
          let score = km;
          if (objective === 'acc') { const mm = moveMag ? magMass + load : V * densEff + load; score = km / mm; }
          if (score > best.score) best = { score, km, r1, r2, j1, j2, V, mn, mx };
        }
      }
    }
  }
  if (best.score < 0) return { invalid: 'катушка не помещается' };
  const rin = best.r1 * dr, rout = (best.r2 + 1) * dr, za = zlo + best.j1 * dz, zb = zlo + (best.j2 + 1) * dz, h = zb - za;
  let secs = 1, prev = null; const secRows = [];
  for (let j = best.j1; j <= best.j2; j++) { let a = 0; for (let i = best.r1; i <= best.r2; i++) a += W[(j + sh) * nr + i]; const s = a >= 0 ? 1 : -1; if (P.sections) { if (prev !== null && s !== prev) secs++; prev = s; } secRows.push(s); }
  const coilMass = best.V * densEff;
  const cells = []; let ideal = 0;
  for (let j = 0; j < nzc; j++) for (let i = 0; i < nr; i++) { if (F[j * nr + i]) continue; const b = bF[(j + sh) * nr + i]; cells.push({ j, i, b: Math.abs(b), dv: dV[i] }); ideal += b * b * dV[i]; }
  cells.sort((x, y) => y.b - x.b);
  let cs = 0, cv = 0, bestFF = { score: -1 };
  for (let k = 0; k < cells.length; k++) {
    cs += cells[k].b * cells[k].dv; cv += cells[k].dv; if (P.mmax > 0 && cv * densEff > P.mmax) break; const km = kfac * cs / Math.sqrt(cv);
    let score = km; if (objective === 'acc') { score = km / ((moveMag ? magMass : cv * densEff) + load); } if (score > bestFF.score) bestFF = { score, km, k: k + 1, V: cv };
  }
  const ffMask = new Uint8Array(nzc * nr); for (let k = 0; k < bestFF.k; k++) ffMask[cells[k].j * nr + cells[k].i] = 1;
  const kmIdeal = Math.sqrt(kf / rho * ideal);
  return {
    cfg, geom, zlo, zhi, dr, dz, nr, nzc, sh, bF, F, ffMask, rho, densEff, kf,
    coil: { rin, rout, za, zb, h, V: best.V, mass: coilMass, secs, secRows },
    km: best.km, kmMin: kfac * best.mn / Math.sqrt(best.V), kmMax: kfac * best.mx / Math.sqrt(best.V),
    score: best.score, ff: { km: bestFF.km, V: bestFF.V, mass: bestFF.V * densEff }, kmIdeal, magMass,
    moving: moveMag ? magMass + load : coilMass + load,
  };
}
export function solveCup(P, cfg) {
  const m = P.mag, c = P.clear, St = P.stroke, Lm = cfg.count * m.L;
  const Am = Math.PI * (m.Ro * m.Ro - m.Ri * m.Ri), rp = m.Ro, Bs = 1.9, sigma = 0.65, mur = 1.05;
  const mat = COND[P.cond], rho = mat.rho20 * (1 + mat.alpha * (P.T - 20)), kf = P.kf, densEff = kf * mat.dens + (1 - kf) * 1200, kfac = Math.sqrt(kf / rho);
  const magMass = cfg.count * Am * m.L * MAGDENS[m.type];
  let best = { score: -1 };
  const ints = (x0, x1, t, lam) => {
    const F = x => { const ax = Math.abs(x), sgn = x < 0 ? -1 : 1; let v; if (ax <= t / 2) v = ax; else v = t / 2 + lam * (1 - Math.exp(-(ax - t / 2) / lam)); return sgn * v; };
    return F(x1) - F(x0);
  };
  const wSteps = [], tSteps = [], hSteps = [];
  for (let w = 0.2e-3; w <= Math.min(8e-3, m.Ro * 1.5); w += 0.1e-3) wSteps.push(w);
  for (let t = 0.5e-3; t <= Math.max(Lm, 1e-3); t += 0.25e-3) tSteps.push(t);
  for (let h = 0.5e-3; h <= Math.max(4 * Lm, St + 8e-3); h += 0.25e-3) hSteps.push(h);
  const shifts = [-St / 2, -St / 4, 0, St / 4, St / 2];
  for (const w of wSteps) {
    const g = w + 2 * c, rc = rp + c + w / 2;
    for (const t of tSteps) {
      const lam = 0.45 * g;
      const Ag = 2 * Math.PI * (rp + g / 2) * (t + 2 * lam);
      let Bg = sigma * m.Br * Am / (Ag + sigma * mur * Am * g / Lm);
      const cap = Bs * Math.min(Math.PI * rp * rp, 2 * Math.PI * rp * t) / Ag; if (Bg > cap) Bg = cap;
      const flux = Bg * Ag; const ro = rp + g; const tw = Math.sqrt(ro * ro + flux / (Math.PI * Bs)) - ro; const Rout = ro + tw;
      if (Rout > P.Rmax) continue;
      const Htot = Lm + 2 * t; if (P.Hlim > 0 && Htot > P.Hlim) continue;
      for (const h of hSteps) {
        let sum = 0, mn = 1e9, mx = -1e9; for (const d of shifts) { const v = ints(d - h / 2, d + h / 2, t, lam); sum += v; mn = Math.min(mn, v); mx = Math.max(mx, v); }
        const fm = Bg * sum / shifts.length * 2 * Math.PI * rc * w; const V = 2 * Math.PI * rc * w * h; if (P.mmax > 0 && V * densEff > P.mmax) break;
        const km = kfac * fm / Math.sqrt(V); let score = km;
        if (P.obj === 'acc') score = km / ((P.moving === 'magnet' ? magMass : V * densEff) + P.load);
        if (score > best.score) best = { score, km, w, t, h, g, Bg, Rout, tw, rc, V, kmMin: kfac * Bg * mn * 2 * Math.PI * rc * w / Math.sqrt(V), kmMax: kfac * Bg * mx * 2 * Math.PI * rc * w / Math.sqrt(V) };
      }
    }
  }
  if (best.score < 0) return { invalid: 'стакан не помещается в габарит' };
  const rin = best.rc - best.w / 2, rout = best.rc + best.w / 2;
  return {
    cfg, cup: best, rho, densEff, kf, coil: { rin, rout, za: -best.h / 2, zb: best.h / 2, h: best.h, V: best.V, mass: best.V * densEff, secs: 1 },
    km: best.km, kmMin: best.kmMin, kmMax: best.kmMax, score: best.score, magMass, Lm, moving: (P.moving === 'magnet' ? magMass : best.V * densEff) + P.load,
  };
}
export function configs(P) {
  const n = P.count, L = P.mag.L, list = []; const mc = P.moving === 'coil';
  const sp = f => f.map(x => x * L);
  list.push({ name: 'Один магнит', desc: 'катушка вокруг голого магнита', count: 1, mode: 'same', spacers: [0], plate: false });
  if (n > 1) list.push({ name: `Стопка ×${n}`, desc: 'все одной полярностью, как один длинный магнит', count: n, mode: 'same', spacers: [0], plate: false });
  if (n > 1) list.push({ name: `Встречная стопка ×${n}`, desc: 'соседние магниты навстречу: поле выдавливается наружу в стыках', count: n, mode: 'alt', spacers: sp([0, 0.2, 0.4, 0.8, 1.2, 1.6]), plate: false });
  if (n > 2) list.push({ name: 'Встречная пара', desc: 'два магнита навстречу', count: 2, mode: 'alt', spacers: sp([0, 0.2, 0.4, 0.8, 1.2, 1.6]), plate: false });
  if (n > 1) list.push({ name: `Раздвинутая стопка ×${n}`, desc: 'одна полярность с зазорами', count: n, mode: 'same', spacers: sp([0.2, 0.4, 0.8, 1.2, 1.6]), plate: false });
  if (mc) {
    list.push({ name: n > 1 ? `Стопка ×${n} на стальной плите` : 'Магнит на стальной плите', desc: 'плита работает как зеркало и удваивает магнит', count: n, mode: 'same', spacers: [0], plate: true });
    if (n > 1) list.push({ name: `Встречная стопка ×${n} на плите`, desc: 'встречная стопка плюс зеркало снизу', count: n, mode: 'alt', spacers: sp([0, 0.2, 0.4, 0.8, 1.2, 1.6]), plate: true });
    list.push({ name: n > 1 ? `Стакан с ярмом, ×${n}` : 'Стакан с ярмом', desc: 'классический динамик: магнит, полюс, стальной стакан. Оценка ±30%', count: n, cup: true });
  }
  return list;
}
/** Run all configurations. progress(k, n). Returns array of results with .meta */
export function runVoiceCoil(P, progress) {
  const list = configs(P); const results = [];
  for (let k = 0; k < list.length; k++) {
    const c = list[k]; let r;
    try {
      if (c.cup) r = solveCup(P, { count: c.count });
      else { let best = null; for (const s of c.spacers) { const x = solveBare(P, { count: c.count, mode: c.mode, spacer: s, plate: c.plate }); if (!x.invalid && (!best || x.score > best.score)) best = x; if (!best && x.invalid) best = x; } r = best; }
    } catch (e) { r = { invalid: 'ошибка расчёта: ' + e.message }; }
    r.meta = c; results.push(r); if (progress) progress(k + 1, list.length);
  }
  const order = results.map((r, i) => i).filter(i => !results[i].invalid).sort((a, b) => results[b].score - results[a].score);
  return { results, order };
}
/** Build scene objects (for the 3D view / cross-check) from a bare-magnet result. */
export function toScene(r, P) {
  if (!r || r.invalid) return [];
  const objs = []; const m = P.mag;
  if (r.cup) {
    const cu = r.cup; const Lm = r.Lm;
    objs.push({ id: 'mag', kind: 'magnet', shape: m.Ri > 0 ? 'ring' : 'cyl', dims: { D: 2 * m.Ro, Din: 2 * m.Ri, L: Lm }, Br: m.Br, frame: { q: QI, p: [0, 0, -cu.t / 2 - Lm / 2] } });
    objs.push({ id: 'coil', kind: 'coil', coil: ringCoil(r.coil.rin, r.coil.rout, r.coil.za, r.coil.zb, { nr: 2, nz: 3, nseg: 48 }), I: 1, frame: { q: QI, p: [0, 0, 0] } });
    objs.push({ id: 'steel', kind: 'steelviz', cup: { ...cu, Lm, rp: m.Ro } });
    return objs;
  }
  r.geom.mags.forEach((g, i) => {
    objs.push({ id: 'mag' + i, kind: 'magnet', shape: m.Ri > 0 ? 'ring' : 'cyl', dims: { D: 2 * m.Ro, Din: 2 * m.Ri, L: g.z1 - g.z0 }, Br: m.Br, frame: { q: g.dir > 0 ? QI : qAxisAngle([1, 0, 0], Math.PI), p: [0, 0, (g.z0 + g.z1) / 2] } });
  });
  if (r.cfg.plate) objs.push({ id: 'plate', kind: 'plate', frame: { q: QI, p: [0, 0, 0] }, size: P.Rmax * 2.4 });
  objs.push({ id: 'coil', kind: 'coil', coil: ringCoil(r.coil.rin, r.coil.rout, r.coil.za, r.coil.zb, { nr: 2, nz: 3, nseg: 48 }), I: 1, frame: { q: QI, p: [0, 0, 0] } });
  return objs;
}
export const WIRES = [0.05, 0.063, 0.071, 0.08, 0.09, 0.1, 0.112, 0.125, 0.14, 0.16, 0.18, 0.2, 0.224, 0.25, 0.28, 0.315, 0.355, 0.4, 0.45, 0.5, 0.56, 0.63, 0.71, 0.8, 0.9, 1.0, 1.12, 1.25, 1.4, 1.6];
