// Spherical (ball) motor: magnets in a ball, ring coils on a shell. Torque matrix, Km per direction, orientation map.
import { MU0, QI, add, sub, scale, dot, cross, norm, unit, qAxisAngle, qMul, qRot, qFromZTo, qEuler, qNormalize } from '../engine/vec.js';
import { ringCoil, winding, coilInductance } from '../engine/coils.js';
import { compileScene, coilForceTorqueIn, GRADES, MAGDENS } from '../engine/scene.js';

export const SPH_DEFAULTS = {
  Rb: 15e-3, pattern: 'cube8', magD: 6e-3, magL: 4e-3, grade: 'N52',
  shell: 'hemi', ncoils: 8, cap: 35, coilRi: 2.5e-3, coilBuild: 2.5e-3, coilT: 3e-3, gap: 1e-3,
  wire: 0.2e-3, kf: 0.7, cond: 'cu', T: 60, hconv: 15,
  rx: 0, ry: 0, rz: 0, mapRes: 10,
};
const SQ3 = Math.sqrt(3);
export function magnetDirs(pattern) {
  if (pattern === 'cube8') { const out = []; for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push({ d: [x / SQ3, y / SQ3, z / SQ3], s: x * y * z }); return out; }
  if (pattern === 'oct6') return [{ d: [1, 0, 0], s: 1 }, { d: [-1, 0, 0], s: 1 }, { d: [0, 1, 0], s: -1 }, { d: [0, -1, 0], s: -1 }, { d: [0, 0, 1], s: 1 }, { d: [0, 0, -1], s: 1 }];
  if (pattern === 'ico12') { const phi = (1 + Math.sqrt(5)) / 2; const v = []; for (const a of [-1, 1]) for (const b of [-1, 1]) { v.push([0, a, b * phi]); v.push([a, b * phi, 0]); v.push([b * phi, 0, a]); } return v.map(x => { const d = unit(x); return { d, s: d[2] >= 0 ? 1 : -1 }; }); }
  if (pattern === 'tetra4') { return [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map((x, i) => ({ d: unit(x), s: i % 2 ? -1 : 1 })); }
  return [];
}
export function coilDirs(p) {
  const n = p.ncoils; const out = [];
  if (p.shell === 'oct6') return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].slice(0, Math.max(1, Math.min(6, n)));
  if (p.shell === 'ring') { for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; out.push([Math.cos(a), Math.sin(a), 0]); } return out; }
  if (p.shell === 'cube8') { for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push([x / SQ3, y / SQ3, z / SQ3]); return out.slice(0, n); }
  // hemisphere (z<0) Fibonacci spread between polar angle (90°+cap) and 180°-cap... use cap as the margin from the equator and from the pole
  const th0 = Math.PI / 2 + p.cap * Math.PI / 180, th1 = Math.PI - 8 * Math.PI / 180; const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; const c = Math.cos(th0) + (Math.cos(th1) - Math.cos(th0)) * t; const th = Math.acos(Math.max(-1, Math.min(1, c))); const ph = ga * i; out.push([Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)]); }
  return out;
}
export function rotorObjects(p, q) {
  const Br = GRADES[p.grade].Br; const objs = [];
  if (p.pattern === 'dipole') { objs.push({ id: 'ball', kind: 'magnet', shape: 'sphere', dims: { D: 2 * p.Rb }, Br, mdir: [0, 0, 1], frame: { q, p: [0, 0, 0] } }); return objs; }
  magnetDirs(p.pattern).forEach((m, i) => {
    const dw = qRot(q, m.d); const qa = qFromZTo(dw); const pos = scale(dw, p.Rb - p.magL / 2);
    const qq = m.s > 0 ? qa : qMul(qa, qAxisAngle([1, 0, 0], Math.PI));
    objs.push({ id: 'm' + i, kind: 'magnet', shape: 'cyl', dims: { D: p.magD, L: p.magL }, Br, frame: { q: qq, p: pos } });
  });
  return objs;
}
export function statorObjects(p) {
  const objs = []; const r0 = p.Rb + p.gap;
  coilDirs(p).forEach((d, i) => {
    const q = qFromZTo(d); const pos = scale(d, r0 + p.coilT / 2);
    objs.push({ id: 'c' + i, kind: 'coil', coil: ringCoil(p.coilRi, p.coilRi + p.coilBuild, -p.coilT / 2, p.coilT / 2, { nr: 2, nz: 2, nseg: 32 }), I: 1, frame: { q, p: pos } });
  });
  return objs;
}
export function rotorQuat(p) { return qEuler(p.rx * Math.PI / 180, p.ry * Math.PI / 180, p.rz * Math.PI / 180); }
export function buildScene(p) { const o = [...rotorObjects(p, rotorQuat(p)), ...statorObjects(p)]; if (p.pattern !== 'dipole') o.push({ id: 'ball', kind: 'ballviz', R: p.Rb, frame: { q: QI, p: [0, 0, 0] } }); return o; }

function torqueMatrix(p, q, stator) {
  const sc = compileScene([...rotorObjects(p, q), ...stator]);
  const J = [], Fm = [];
  for (let i = 0; i < stator.length; i++) { const r = coilForceTorqueIn(sc, 'c' + i, 1, { O: [0, 0, 0], coils: false }); J.push(scale(r.T, -1)); Fm.push(scale(r.F, -1)); }
  return { J, Fm };
}
// 3x3 symmetric eigen-decomposition (Jacobi)
function eigSym3(A) {
  let a = A.map(r => r.slice()); let V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let it = 0; it < 50; it++) {
    let pI = 0, qI = 1, mx = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > mx) { pI = 0; qI = 2; mx = Math.abs(a[0][2]); } if (Math.abs(a[1][2]) > mx) { pI = 1; qI = 2; mx = Math.abs(a[1][2]); }
    if (mx < 1e-18) break;
    const th = 0.5 * Math.atan2(2 * a[pI][qI], a[qI][qI] - a[pI][pI]); const c = Math.cos(th), s = Math.sin(th);
    const R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; R[pI][pI] = c; R[qI][qI] = c; R[pI][qI] = s; R[qI][pI] = -s;
    const mul = (X, Y) => X.map((r, i) => Y[0].map((_, j) => r.reduce((s2, v, k) => s2 + v * Y[k][j], 0)));
    const Rt = R[0].map((_, j) => R.map(r => r[j]));
    a = mul(mul(Rt, a), R); V = mul(V, R);
  }
  const vals = [a[0][0], a[1][1], a[2][2]]; const idx = [0, 1, 2].sort((i, j) => vals[j] - vals[i]);
  return { vals: idx.map(i => vals[i]), vecs: idx.map(i => [V[0][i], V[1][i], V[2][i]]) };
}
/** Analysis at the current orientation + Km over an orientation map. progress(frac,msg) */
export function analyzeSpherical(p, progress) {
  const stator = statorObjects(p); const C = stator.length;
  const coil = stator[0].coil; const wd = winding(coil, { cond: p.cond, T: p.T, kf: p.kf, wire: p.wire });
  const N = wd.N, R = wd.R; const L = coilInductance(coil, N);
  const q0 = rotorQuat(p);
  const { J, Fm } = torqueMatrix(p, q0, stator);
  // Jn = N J / sqrt(R)  (torque per sqrt(W))
  const Jn = J.map(t => scale(t, N / Math.sqrt(R)));
  const G = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const t of Jn) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) G[i][j] += t[i] * t[j];
  const eg = eigSym3(G); const sig = eg.vals.map(v => Math.sqrt(Math.max(0, v)));
  const KmDir = u => { // 1/sqrt(u^T G^-1 u) via eigen decomposition
    let s = 0; for (let k = 0; k < 3; k++) { const c = dot(u, eg.vecs[k]); if (eg.vals[k] < 1e-24) { if (Math.abs(c) > 1e-9) return 0; continue; } s += c * c / eg.vals[k]; } return s > 0 ? 1 / Math.sqrt(s) : 0; };
  const axes = { x: KmDir([1, 0, 0]), y: KmDir([0, 1, 0]), z: KmDir([0, 0, 1]) };
  // parasitic force for unit torque along weakest/strongest axes: I = Jn^+ u  (min-norm), f = Fm·I·N/sqrt(R)
  const minNormCurrents = u => { // I_k = Jn_k · G^{-1} u  (rows)
    const Ginv_u = [0, 0, 0]; for (let k = 0; k < 3; k++) { if (eg.vals[k] < 1e-24) continue; const c = dot(u, eg.vecs[k]) / eg.vals[k]; for (let i = 0; i < 3; i++) Ginv_u[i] += c * eg.vecs[k][i]; }
    return Jn.map(t => dot(t, Ginv_u)); };
  const forceFor = u => { const I = minNormCurrents(u); let f = [0, 0, 0]; for (let k = 0; k < C; k++) f = add(f, scale(Fm[k], I[k] * N / Math.sqrt(R))); return f; };
  const perCoil = J.map((t, k) => ({ torque: scale(t, N), force: scale(Fm[k], N) }));
  // thermal per coil
  const area = 2 * Math.PI * (coil.geom.ri + coil.geom.ro) * p.coilT + 2 * Math.PI * (coil.geom.ro ** 2 - coil.geom.ri ** 2);
  const PmaxCoil = p.hconv * area * Math.max(1, p.T - 25);
  const Pmax = PmaxCoil * C; // all coils at thermal limit
  const magMass = p.pattern === 'dipole' ? 4 / 3 * Math.PI * p.Rb ** 3 * MAGDENS[GRADES[p.grade].type] : magnetDirs(p.pattern).length * Math.PI * (p.magD / 2) ** 2 * p.magL * MAGDENS[GRADES[p.grade].type];
  if (progress) progress(0.1, 'карта ориентаций');
  // orientation map: rotor axis tilted to (theta, phi) [no spin]; Km_min over directions
  const nth = p.mapRes, nph = 2 * p.mapRes; const map = new Float32Array(nth * nph); let mapMin = Infinity, mapMax = 0;
  for (let i = 0; i < nth; i++) {
    for (let j = 0; j < nph; j++) {
      const th = Math.PI * (i + 0.5) / nth, ph = 2 * Math.PI * j / nph; const d = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
      const q = qMul(qFromZTo(d), q0);
      const { J: Jq } = torqueMatrix(p, q, stator); const Jqn = Jq.map(t => scale(t, N / Math.sqrt(R)));
      const Gq = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const t of Jqn) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) Gq[a][b] += t[a] * t[b];
      const e = eigSym3(Gq); const s3 = Math.sqrt(Math.max(0, e.vals[2])); map[i * nph + j] = s3; if (s3 < mapMin) mapMin = s3; if (s3 > mapMax) mapMax = s3;
    }
    if (progress) progress(0.1 + 0.9 * (i + 1) / nth, `карта ${i + 1}/${nth}`);
  }
  return { N, R, L, tauE: L / R, sig, vecs: eg.vecs, axes, KmMin: sig[2], KmMax: sig[0], isotropy: sig[0] > 0 ? sig[2] / sig[0] : 0, forceWeak: forceFor(eg.vecs[2]), forceStrong: forceFor(eg.vecs[0]), perCoil, PmaxCoil, Pmax, TcontMin: sig[2] * Math.sqrt(Pmax), magMass, coilMass: wd.mass * C, map: { data: map, nth, nph, min: mapMin, max: mapMax }, C };
}
