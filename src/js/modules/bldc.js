// Ironless / slotless BLDC (axial-flux single & dual rotor, radial-flux in/outrunner) on the general engine.
// Torque is computed for ONE coil over an electrical period (rotor rotated), the rest follows from symmetry.
import { MU0, QI, qAxisAngle, qMul, add, scale, norm } from '../engine/vec.js';
import { sectorCoil, saddleCoil, winding, coilInductance, resistivity, COND } from '../engine/coils.js';
import { compileScene, fieldAt, coilForceTorqueIn, GRADES, MAGDENS } from '../engine/scene.js';

export const BLDC_DEFAULTS = {
  topology: 'axial-single', poles: 14, coils: 12, grade: 'N52',
  Rin: 12e-3, Rout: 25e-3, tm: 3e-3, poleArc: 0.85, halbach: false,
  rotorIron: true, statorIron: false, gap: 1e-3,
  // radial-only
  Lm: 20e-3,
  // coil
  span: 0.92, build: 3e-3, tc: 3e-3,
  wire: 0.3e-3, kf: 0.6, cond: 'cu', T: 80, V: 24, hconv: 20,
  nTheta: 24, facets: 6, nb: 2, nz: 2,
  opRpm: 3000, opTorque: 0.05,
};

/** Build rotor magnet objects (rotated by thetaM) for the given params. */
export function rotorMagnets(p, thetaM = 0, lowFi = false) {
  const P = p.poles, pitch = 2 * Math.PI / P; const Br = GRADES[p.grade].Br; const objs = [];
  const n = lowFi ? Math.max(2, Math.round(p.facets / 2)) : p.facets;
  const axial = p.topology.startsWith('axial');
  if (axial) {
    const zTop = -(p.tc / 2 + p.gap); const zc = zTop - p.tm / 2;
    const discs = p.topology === 'axial-dual' ? [-1, 1] : [-1];
    for (const side of discs) {
      const zcen = side < 0 ? zc : -zc;
      for (let k = 0; k < P; k++) {
        const sgn = (k % 2 === 0) ? 1 : -1; const ang = thetaM + k * pitch;
        if (!p.halbach) {
          objs.push({ id: `m${side}_${k}`, kind: 'magnet', shape: 'arc', mag: 'axial', sign: sgn, dims: { Ri: p.Rin, Ro: p.Rout, L: p.tm, span: pitch * p.poleArc, n }, Br, frame: { q: qAxisAngle([0, 0, 1], ang), p: [0, 0, zcen] } });
        } else {
          // Halbach: axial segment (poleArc of pitch) + tangential segment filling the rest; tangential sense chosen so flux is pushed toward the coil (+z for lower disc)
          objs.push({ id: `m${side}_${k}a`, kind: 'magnet', shape: 'arc', mag: 'axial', sign: sgn, dims: { Ri: p.Rin, Ro: p.Rout, L: p.tm, span: pitch * p.poleArc, n }, Br, frame: { q: qAxisAngle([0, 0, 1], ang), p: [0, 0, zcen] } });
          const tsign = sgn * (side < 0 ? -1 : 1); // tangential segment carries return flux from pole k+1 back to pole k on the far side from the coil
          objs.push({ id: `m${side}_${k}t`, kind: 'magnet', shape: 'arc', mag: 'parallel', mdir: [0, tsign, 0], sign: 1, dims: { Ri: p.Rin, Ro: p.Rout, L: p.tm, span: pitch * (1 - p.poleArc), n: Math.max(2, Math.round(n / 2)) }, Br, frame: { q: qAxisAngle([0, 0, 1], ang + pitch / 2), p: [0, 0, zcen] } });
        }
      }
    }
  } else {
    // radial: magnets as arcs on a cylinder, radial magnetization alternating. 'radial-in': rotor inside coils; 'radial-out': rotor outside.
    for (let k = 0; k < P; k++) {
      const sgn = (k % 2 === 0) ? 1 : -1; const ang = thetaM + k * pitch;
      objs.push({ id: `m${k}`, kind: 'magnet', shape: 'arc', mag: 'radial', sign: sgn, dims: { Ri: p.Rin, Ro: p.Rout, L: p.Lm, span: pitch * p.poleArc, n, k: lowFi ? 1 : 2 }, Br, frame: { q: qAxisAngle([0, 0, 1], ang), p: [0, 0, 0] } });
    }
  }
  return objs;
}
export function platesFor(p) {
  const objs = []; const axial = p.topology.startsWith('axial');
  if (!axial) return objs;
  const zTop = -(p.tc / 2 + p.gap), zBack = zTop - p.tm;
  if (p.rotorIron) objs.push({ id: 'ironR1', kind: 'plate', frame: { q: QI, p: [0, 0, zBack] }, size: p.Rout * 2.3 });
  if (p.topology === 'axial-dual') { if (p.rotorIron) objs.push({ id: 'ironR2', kind: 'plate', frame: { q: qAxisAngle([1, 0, 0], Math.PI), p: [0, 0, -zBack] }, size: p.Rout * 2.3 }); }
  else if (p.statorIron) objs.push({ id: 'ironS', kind: 'plate', frame: { q: qAxisAngle([1, 0, 0], Math.PI), p: [0, 0, p.tc / 2 + p.gap] }, size: p.Rout * 2.3 });
  return objs;
}
/** One stator coil (index k) object. */
export function statorCoil(p, k, lowFi = false) {
  const C = p.coils, cpitch = 2 * Math.PI / C; const axial = p.topology.startsWith('axial');
  const fil = lowFi ? { nb: 1, nz: 1, na: 1, narc: 4, nzseg: 2 } : { nb: p.nb, nz: p.nz, na: p.nz, narc: 8, nzseg: 4 };
  let coil;
  if (axial) coil = sectorCoil(p.Rin, p.Rout, cpitch / 2 * p.span, p.build, p.tc, fil);
  else {
    const rIn = p.topology === 'radial-in' ? p.Rout + p.gap : p.Rin - p.gap - p.build;
    const rm = rIn + p.build / 2; const wAng = p.tc / rm; // tc = bundle width (tangential) for radial
    coil = saddleCoil(rIn, p.build, cpitch / 2 * p.span, p.Lm + 2 * p.build, wAng, fil);
  }
  return { id: `c${k}`, kind: 'coil', coil, I: 1, frame: { q: qAxisAngle([0, 0, 1], k * cpitch), p: [0, 0, 0] } };
}
export function buildScene(p, thetaM = 0) {
  const objs = [...rotorMagnets(p, thetaM), ...platesFor(p)];
  for (let k = 0; k < p.coils; k++) objs.push(statorCoil(p, k));
  return objs;
}
/** Phase assignment by the star of slots: coil k has EMF phasor angle eps_k = (P/2)·(2πk/C). The circle is cut into
 *  six 60° sectors (A+, C−, B+, A−, C+, B−) shifted by half the phasor spacing so no phasor sits on a boundary. */
export function phaseMap(P, C) {
  const TWO = 2 * Math.PI; const eps = [];
  for (let k = 0; k < C; k++) eps.push((((P / 2) * (TWO * k / C)) % TWO + TWO) % TWO);
  const uniq = [...new Set(eps.map(e => Math.round(e * 1e6) / 1e6))].sort((a, b) => a - b);
  let delta = TWO / 6; if (uniq.length > 1) { delta = Infinity; for (let i = 0; i < uniq.length; i++) { const d = (i + 1 < uniq.length ? uniq[i + 1] : uniq[0] + TWO) - uniq[i]; if (d > 1e-9 && d < delta) delta = d; } }
  const shift = Math.min(delta / 2, Math.PI / 6 - 1e-9);
  const SECT = [[0, 1], [2, -1], [1, 1], [0, -1], [2, 1], [1, -1]]; // [phase, sign] for sectors starting at -shift
  const out = [];
  for (let k = 0; k < C; k++) { const a = ((eps[k] + shift) % TWO + TWO) % TWO; const si = Math.floor(a / (Math.PI / 3)) % 6; const [phase, sign] = SECT[si]; out.push({ phase, sign, eps: eps[k] }); }
  return out;
}
// periodic Fourier interpolation of samples f_k at theta_k = k*T/n
function fourierInterp(samples, period) {
  const n = samples.length; const nh = Math.floor((n - 1) / 2); const a = [], b = [];
  let a0 = 0; for (const v of samples) a0 += v; a0 /= n;
  for (let h = 1; h <= nh; h++) { let ca = 0, cb = 0; for (let k = 0; k < n; k++) { const t = 2 * Math.PI * h * k / n; ca += samples[k] * Math.cos(t); cb += samples[k] * Math.sin(t); } a.push(2 * ca / n); b.push(2 * cb / n); }
  return th => { const x = 2 * Math.PI * th / period; let s = a0; for (let h = 1; h <= nh; h++) s += a[h - 1] * Math.cos(h * x) + b[h - 1] * Math.sin(h * x); return s; };
}
/** Main analysis. progress(frac,msg). lowFi for optimizer. */
export function analyzeBLDC(p, progress, lowFi = false) {
  const P = p.poles, C = p.coils; const axial = p.topology.startsWith('axial');
  if (P % 2) throw new Error('число полюсов должно быть чётным');
  if (C % 3) throw new Error('число катушек должно делиться на 3');
  const periodM = 4 * Math.PI / P; const nT = lowFi ? Math.max(8, Math.round(p.nTheta / 2)) : p.nTheta;
  const coil0 = statorCoil(p, 0, lowFi); const plates = platesFor(p);
  const tau0 = new Array(nT);
  for (let i = 0; i < nT; i++) {
    const th = periodM * i / nT; const sc = compileScene([...rotorMagnets(p, th, lowFi), ...plates, coil0], { imageDepth: 3 });
    const { T } = coilForceTorqueIn(sc, 'c0', 1, { O: [0, 0, 0], gauss: lowFi ? 2 : 3 });
    tau0[i] = T[2]; // torque on coil about axis per A·turn; rotor torque is the negative
    if (progress) progress((i + 1) / (nT + 2), `угол ${i + 1}/${nT}`);
  }
  const tauF = fourierInterp(tau0, periodM);
  const pm = phaseMap(P, C); const cpitch = 2 * Math.PI / C;
  // torque waveform for unit peak phase current (per A·turn), best commutation angle gamma
  const nS = 72; const Twave = g => { const w = new Array(nS); for (let i = 0; i < nS; i++) { const thm = periodM * i / nS, the = (P / 2) * thm; let s = 0; for (let k = 0; k < C; k++) { const ik = pm[k].sign * Math.cos(the + g - 2 * Math.PI * pm[k].phase / 3); s += ik * tauF(thm - k * cpitch); } w[i] = -s; } return w; };
  let bestG = 0, bestMean = -Infinity, bestW = null;
  for (let gd = 0; gd < 360; gd += 3) { const g = gd * Math.PI / 180; const w = Twave(g); const m = w.reduce((a, b) => a + b, 0) / nS; if (m > bestMean) { bestMean = m; bestG = g; bestW = w; } }
  const Tmin = Math.min(...bestW), Tmax = Math.max(...bestW); const ripple = (Tmax - Tmin) / Math.abs(bestMean);
  // winding
  const coilFull = statorCoil(p, 0, false).coil; const wd = winding(coilFull, { cond: p.cond, T: p.T, kf: p.kf, wire: p.wire });
  const N = wd.N; const Rcoil = wd.R; const Rph = Rcoil * (C / 3); const Lcoil = lowFi ? 0 : coilInductance(coilFull, N); const Lph = Lcoil * (C / 3);
  const Kt = bestMean * N; // N·m per A (peak phase current), sinusoidal commutation
  const Km = Kt / Math.sqrt(1.5 * Rph);
  const Ke = Kt / 1.5; // V·s/rad, phase peak
  const Kv = 60 / (2 * Math.PI * Math.sqrt(3) * Ke); // rpm per V (DC bus, SVPWM, approx)
  // masses & inertia
  const magVol = axial ? (P * 0.5 * (2 * Math.PI / P * p.poleArc) * (p.Rout ** 2 - p.Rin ** 2) * p.tm) * (p.topology === 'axial-dual' ? 2 : 1) * (p.halbach ? 1 / p.poleArc : 1)
    : P * 0.5 * (2 * Math.PI / P * p.poleArc) * (p.Rout ** 2 - p.Rin ** 2) * p.Lm;
  const magMass = magVol * MAGDENS[GRADES[p.grade].type];
  const Jrot = magMass * (p.Rin ** 2 + p.Rout ** 2) / 2;
  const coilMass = wd.mass * C;
  // thermal (per coil surface ~ 2 faces)
  const area = axial ? 2 * (0.5 * (cpitch * p.span) * (p.Rout ** 2 - p.Rin ** 2)) + 2 * p.build * (p.Rout - p.Rin) * 2 : 2 * coilFull.meanTurn * p.build;
  const Pmax = p.hconv * area * Math.max(1, p.T - 25) * C; const Tcont = Km * Math.sqrt(Pmax);
  const Icont = Tcont / Kt;
  // operating point
  const w = p.opRpm * 2 * Math.PI / 60; const Iop = p.opTorque / Kt; const Pcu = 1.5 * Iop * Iop * Rph; const Pmech = p.opTorque * w; const eta = Pmech / (Pmech + Pcu);
  const rpmMax = Kv * p.V; const Tstall = Kt * p.V / (2 * Rph);
  return {
    tau0, periodM, Twave: bestW, gamma: bestG, KtPerAT: bestMean, N, Rcoil, Rph, Lcoil, Lph, tauE: Lph / Rph, Kt, Ke, Kv, Km, ripple, Tmin, Tmax,
    magMass, Jrot, coilMass, wireLen: wd.len * C, Pmax, Tcont, Icont, eta, Pcu, Pmech, rpmMax, Tstall, phaseMap: pm,
    meanTurn: coilFull.meanTurn, window: coilFull.window,
  };
}
/** Random + coordinate-descent optimizer for Km (or Km per mass) within envelope. vars: poleArc, span, build, tc, tm. */
export function optimizeBLDC(p, opts, progress) {
  const vars = opts.vars || ['poleArc', 'span', 'build', 'tc'];
  const bounds = { poleArc: [0.5, 0.98], span: [0.5, 1.0], build: [0.5e-3, Math.max(1e-3, p.Rout * 0.4)], tc: [0.5e-3, 10e-3], tm: [1e-3, 8e-3], gap: [0.3e-3, 3e-3] };
  if (opts.bounds) Object.assign(bounds, opts.bounds);
  const objective = opts.objective || 'km';
  const score = r => objective === 'kmMass' ? r.Km / (r.magMass + r.coilMass) : objective === 'kmInertia' ? r.Km / Math.sqrt(r.Jrot) : r.Km * (1 - Math.min(0.5, (opts.ripplePenalty || 0) * r.ripple));
  const evalP = q => { try { const r = analyzeBLDC(q, null, true); return { s: score(r), r }; } catch (e) { return { s: -Infinity, r: null }; } };
  // feasibility: build must fit inside half the coil pitch at inner radius
  const feasible = q => { const cp = 2 * Math.PI / q.coils; if (q.topology.startsWith('axial')) { const wIn = q.Rin * cp * q.span; return q.build * 2 < wIn && q.build * 2 < (q.Rout - q.Rin); } return q.build * 2 < (q.Rout + q.gap) * cp * q.span; };
  let best = { s: -Infinity, q: { ...p } }; const trials = opts.trials || 24; let done = 0; const total = trials + (opts.refine || 2) * vars.length * 2;
  const rnd = () => { const q = { ...p }; for (const v of vars) { const [a, b] = bounds[v]; q[v] = a + Math.random() * (b - a); } return q; };
  const cands = [{ ...p }]; for (let i = 1; i < trials; i++) cands.push(rnd());
  for (const q of cands) { if (feasible(q)) { const e = evalP(q); if (e.s > best.s) best = { s: e.s, q, r: e.r }; } done++; if (progress) progress(done / total, `поиск ${done}/${total}`); }
  // coordinate descent
  for (let it = 0; it < (opts.refine || 2); it++) {
    for (const v of vars) {
      const [a, b] = bounds[v]; const step = (b - a) * 0.12 / (it + 1);
      for (const d of [-1, 1]) { const q = { ...best.q }; q[v] = Math.min(b, Math.max(a, q[v] + d * step)); if (feasible(q)) { const e = evalP(q); if (e.s > best.s) best = { s: e.s, q, r: e.r }; } done++; if (progress) progress(done / total, `уточнение ${done}/${total}`); }
    }
  }
  return best.q;
}
