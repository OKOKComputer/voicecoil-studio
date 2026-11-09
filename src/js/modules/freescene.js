// Free scene: arbitrary magnets / coils / plates. Forces, torques, Km of a coil, parameter sweeps, presets.
import { MU0, QI, add, sub, scale, dot, cross, norm, unit, qAxisAngle, qEuler, qFromZTo } from '../engine/vec.js';
import { ringCoil, racetrackCoil, sectorCoil, spiralCoil, saddleCoil, winding, coilInductance, kmFromPerAmpTurn } from '../engine/coils.js';
import { compileScene, fieldAt, magnetForceTorque, coilForceTorqueIn, fieldSlice, GRADES, MAGDENS } from '../engine/scene.js';

/** Build the engine coil from a coil spec {ctype, ...dims} */
export function coilFromSpec(s) {
  const cnt = (len, step = 0.7e-3, lo = 2, hi = 6) => Math.min(hi, Math.max(lo, Math.round((len || 0) / step)));
  const fil = { nr: cnt((s.ro || 0) - (s.ri || 0)), nz: cnt(s.h), nseg: 48, nb: cnt(s.build), narc: 8, na: 2, nzseg: 4 };
  switch (s.ctype) {
    case 'ring': return ringCoil(s.ri, s.ro, -s.h / 2, s.h / 2, fil);
    case 'racetrack': return racetrackCoil(s.Ls, s.ri, s.build, s.h, { ...fil, nr: cnt(s.build) });
    case 'sector': return sectorCoil(s.r1, s.r2, s.half * Math.PI / 180, s.build, s.h, fil);
    case 'spiral': return spiralCoil(s.ri, s.ro, s.N, { t: s.h });
    case 'saddle': return saddleCoil(s.ri, s.build, s.half * Math.PI / 180, s.Lz, s.wAng * Math.PI / 180, fil);
    default: return ringCoil(5e-3, 7e-3, -2e-3, 2e-3, fil);
  }
}
/** Convert UI object list (mm, degrees) to engine objects (SI). */
export function toEngineObjects(uiObjs) {
  const out = [];
  for (const o of uiObjs) {
    if (o.hidden) continue;
    const q = qEuler((o.rx || 0) * Math.PI / 180, (o.ry || 0) * Math.PI / 180, (o.rz || 0) * Math.PI / 180);
    const frame = { q, p: [(o.x || 0) * 1e-3, (o.y || 0) * 1e-3, (o.z || 0) * 1e-3] };
    if (o.kind === 'magnet') {
      const Br = GRADES[o.grade || 'N52'].Br; const d = o.dims; const dims = {};
      for (const k in d) dims[k] = (k === 'n' || k === 'k') ? d[k] : (k === 'span' ? d[k] * Math.PI / 180 : d[k] * 1e-3);
      out.push({ id: o.id, kind: 'magnet', shape: o.shape, dims, Br, mdir: o.mdir || [0, 0, 1], mag: o.mag || 'axial', sign: 1, frame });
    } else if (o.kind === 'coil') {
      const s = { ...o.spec }; for (const k in s) if (!['ctype', 'N', 'half', 'wAng'].includes(k)) s[k] = s[k] * 1e-3;
      out.push({ id: o.id, kind: 'coil', coil: coilFromSpec(s), I: o.I || 0, frame, wire: (o.wire || 0.2) * 1e-3, kf: o.kf || 0.7, cond: o.cond || 'cu', T: o.T || 80 });
    } else if (o.kind === 'plate') out.push({ id: o.id, kind: 'plate', frame, size: (o.size || 40) * 1e-3 });
  }
  return out;
}
/** Forces/torques on every object; Km of every coil along the probe direction (world) for its own current sign. */
export function analyzeScene(uiObjs, opts = {}, progress) {
  const objs = toEngineObjects(uiObjs); const sc = compileScene(objs, { imageDepth: 4 });
  const rows = []; let k = 0;
  for (const o of objs) {
    if (o.kind === 'magnet') { const r = magnetForceTorque(sc, o.id, { n: 5 }); rows.push({ id: o.id, kind: 'magnet', F: r.F, T: r.T }); }
    else if (o.kind === 'coil') {
      const r1 = coilForceTorqueIn(sc, o.id, 1, { coils: opts.coilCoil !== false }); // per 1 A·turn (turns=1)
      const F = scale(r1.F, o.I), T = scale(r1.T, o.I);
      const f1 = opts.probeDir ? Math.abs(dot(r1.F, unit(opts.probeDir))) : norm(r1.F);
      const km = kmFromPerAmpTurn(f1, o.coil, { cond: o.cond, T: o.T, kf: o.kf });
      const wd = winding(o.coil, { cond: o.cond, T: o.T, kf: o.kf, wire: o.wire });
      const L = opts.inductance ? coilInductance(o.coil, wd.N) : null;
      rows.push({ id: o.id, kind: 'coil', F, T, F1: r1.F, T1: r1.T, km, N: wd.N, R: wd.R, L, mass: wd.mass, Fdir: f1 * o.I, meanTurn: o.coil.meanTurn });
    }
    k++; if (progress) progress(k / objs.length, o.id);
  }
  return { rows };
}
export function sliceScene(uiObjs, plane) {
  const objs = toEngineObjects(uiObjs); const sc = compileScene(objs, { imageDepth: 4 });
  const { o, u, v, hu, hv, nu, nv, comp } = plane;
  return fieldSlice(sc, o, u, v, hu, hv, nu, nv, { comp });
}
export function getPath(obj, path) { return path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), obj); }
export function setPath(obj, path, val) { const ks = path.split('.'); let a = obj; for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] == null) a[ks[i]] = {}; a = a[ks[i]]; } a[ks[ks.length - 1]] = val; }
/** Sweep a numeric property of one UI object; record force/torque component on a target object. */
export function sweepScene(uiObjs, sw, progress) {
  const xs = [], ys = [];
  for (let i = 0; i < sw.steps; i++) {
    const x = sw.from + (sw.to - sw.from) * (sw.steps > 1 ? i / (sw.steps - 1) : 0);
    const objs = JSON.parse(JSON.stringify(uiObjs)); const o = objs.find(z => z.id === sw.objId); if (!o) break; setPath(o, sw.path, x);
    const eng = toEngineObjects(objs); const sc = compileScene(eng, { imageDepth: 4 });
    const tgt = eng.find(z => z.id === sw.targetId); let y = 0;
    if (tgt) { const r = tgt.kind === 'magnet' ? magnetForceTorque(sc, tgt.id, { n: 4 }) : (() => { const q = coilForceTorqueIn(sc, tgt.id, 1); return { F: scale(q.F, tgt.I), T: scale(q.T, tgt.I) }; })();
      const comp = sw.comp || 'Fz'; const vec = comp[0] === 'F' ? r.F : r.T; const idx = { x: 0, y: 1, z: 2 }[comp[1]]; y = idx === undefined ? norm(vec) : vec[idx]; }
    xs.push(x); ys.push(y); if (progress) progress((i + 1) / sw.steps, `${i + 1}/${sw.steps}`);
  }
  return { xs, ys };
}
// ---------- presets (UI units: mm, deg) ----------
export const PRESETS = {
  'Два магнита встречно + катушка': () => [
    { id: 'm1', kind: 'magnet', shape: 'cyl', grade: 'N52', dims: { D: 10, L: 5 }, x: 0, y: 0, z: -3.5, rx: 0, ry: 0, rz: 0 },
    { id: 'm2', kind: 'magnet', shape: 'cyl', grade: 'N52', dims: { D: 10, L: 5 }, x: 0, y: 0, z: 3.5, rx: 180, ry: 0, rz: 0 },
    { id: 'c1', kind: 'coil', spec: { ctype: 'ring', ri: 5.5, ro: 8, h: 4 }, I: 1, wire: 0.23, kf: 0.75, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
  ],
  'Магнит между двумя встречными катушками': () => [
    { id: 'm1', kind: 'magnet', shape: 'cyl', grade: 'N52', dims: { D: 8, L: 10 }, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
    { id: 'c1', kind: 'coil', spec: { ctype: 'ring', ri: 4.5, ro: 7, h: 5 }, I: 1, wire: 0.23, kf: 0.75, x: 0, y: 0, z: -4, rx: 0, ry: 0, rz: 0 },
    { id: 'c2', kind: 'coil', spec: { ctype: 'ring', ri: 4.5, ro: 7, h: 5 }, I: -1, wire: 0.23, kf: 0.75, x: 0, y: 0, z: 4, rx: 0, ry: 0, rz: 0 },
  ],
  'Плоская катушка над блоком (HDD-VCM)': () => [
    { id: 'm1', kind: 'magnet', shape: 'block', grade: 'N48', dims: { lx: 20, ly: 12, lz: 3 }, mdir: [0, 0, 1], x: -10.5, y: 0, z: -3.5, rx: 0, ry: 0, rz: 0 },
    { id: 'm2', kind: 'magnet', shape: 'block', grade: 'N48', dims: { lx: 20, ly: 12, lz: 3 }, mdir: [0, 0, -1], x: 10.5, y: 0, z: -3.5, rx: 0, ry: 0, rz: 0 },
    { id: 'p1', kind: 'plate', size: 60, x: 0, y: 0, z: -5, rx: 0, ry: 0, rz: 0 },
    { id: 'p2', kind: 'plate', size: 60, x: 0, y: 0, z: 5, rx: 180, ry: 0, rz: 0 },
    { id: 'c1', kind: 'coil', spec: { ctype: 'racetrack', Ls: 10, ri: 4, build: 6, h: 3 }, I: 1, wire: 0.2, kf: 0.7, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 90 },
  ],
  'Цепочка магнит–катушка (гибкий актуатор)': () => {
    const out = []; const n = 5, pitch = 8;
    for (let i = 0; i < n; i++) { out.push({ id: 'm' + i, kind: 'magnet', shape: 'ring', grade: 'N52', dims: { D: 8, Din: 3, L: 3 }, x: 0, y: 0, z: i * pitch, rx: i % 2 ? 180 : 0, ry: 0, rz: 0 }); if (i < n - 1) out.push({ id: 'c' + i, kind: 'coil', spec: { ctype: 'ring', ri: 4.5, ro: 6.5, h: 3 }, I: i % 2 ? -1 : 1, wire: 0.15, kf: 0.7, x: 0, y: 0, z: i * pitch + pitch / 2, rx: 0, ry: 0, rz: 0 }); }
    return out;
  },
  'Матрица спиралей над решёткой магнитов («мышца Фибоначчи»)': () => {
    const out = []; const n = 3, pitch = 8;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const s = (i + j) % 2 ? -1 : 1; out.push({ id: `m${i}${j}`, kind: 'magnet', shape: 'cyl', grade: 'N52', dims: { D: 6, L: 3 }, x: (i - 1) * pitch, y: (j - 1) * pitch, z: -2.5, rx: s > 0 ? 0 : 180, ry: 0, rz: 0 }); out.push({ id: `c${i}${j}`, kind: 'coil', spec: { ctype: 'spiral', ri: 1, ro: 3.5, N: 6, h: 0.5 }, I: s, wire: 0.1, kf: 0.5, x: (i - 1) * pitch, y: (j - 1) * pitch, z: 0.5, rx: 0, ry: 0, rz: 0 }); }
    return out;
  },
  'Магнит на стальной плите + катушка': () => [
    { id: 'p1', kind: 'plate', size: 50, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
    { id: 'm1', kind: 'magnet', shape: 'cyl', grade: 'N52', dims: { D: 10, L: 5 }, x: 0, y: 0, z: 2.5, rx: 0, ry: 0, rz: 0 },
    { id: 'c1', kind: 'coil', spec: { ctype: 'ring', ri: 5.5, ro: 8, h: 4 }, I: 1, wire: 0.23, kf: 0.75, x: 0, y: 0, z: 4, rx: 0, ry: 0, rz: 0 },
  ],
};
