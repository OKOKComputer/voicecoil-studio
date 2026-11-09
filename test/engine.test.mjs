import { MU0, add, sub, scale, dot, cross, norm, unit, qAxisAngle, QI, qEuler } from '../src/js/engine/vec.js';
import { cylinderBrz, ringBrz, loopBrz } from '../src/js/engine/cylinder.js';
import { makePoly, polyB, polyH, cuboidGeom, prismGeom, arcGeom, transformGeom, faceChargeSamples } from '../src/js/engine/polyhedron.js';
import { ringCoil, racetrackCoil, sectorCoil, coilForceTorque, polylineB, segmentB, placeCoil, coilInductance, coilFluxLinkage, polygonFlux } from '../src/js/engine/coils.js';
import { compileScene, fieldAt, magnetForceTorque, coilForceTorqueIn } from '../src/js/engine/scene.js';

const fmt = v => Array.isArray(v) ? '[' + v.map(x => x.toExponential(4)).join(', ') + ']' : v.toExponential(4);
const relerr = (a, b) => norm(sub(a, b)) / Math.max(norm(b), 1e-30);
let fails = 0; const check = (name, ok, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; };

// ---------- brute-force field of a charged polygon (fine subdivision) ----------
function bruteH(poly, r, N = 60) {
  let H = [0, 0, 0];
  for (const f of poly.fd) {
    if (Math.abs(f.sigma) < 1e-9) continue;
    const v0 = poly.verts[f.idx[0]];
    for (let i = 1; i < f.idx.length - 1; i++) {
      const v1 = poly.verts[f.idx[i]], v2 = poly.verts[f.idx[i + 1]];
      const area = norm(cross(sub(v1, v0), sub(v2, v0))) / 2;
      for (let a = 0; a < N; a++) for (let b = 0; b < N - a; b++) {
        const p = (u, v) => add(add(scale(v0, 1 - u - v), scale(v1, u)), scale(v2, v));
        const u0 = a / N, w0 = b / N, du = 1 / N;
        const pts = [p(u0 + du / 3, w0 + du / 3)]; if (b < N - a - 1) pts.push(p(u0 + 2 * du / 3, w0 + 2 * du / 3));
        for (const q of pts) { const d = sub(r, q); const dd = norm(d); H = add(H, scale(d, f.sigma * area / (N * N) / (4 * Math.PI * dd ** 3))); }
      }
    }
  }
  return H;
}

// T1: cuboid field vs brute force (M along z and oblique)
{
  const M = 1.4 / MU0;
  for (const [name, Mv] of [['z', [0, 0, M]], ['oblique', scale(unit([0.3, -0.5, 0.8]), M)]]) {
    const g = transformGeom(cuboidGeom(0.02, 0.012, 0.006), qEuler(0.3, -0.2, 0.7), [0.001, -0.002, 0.0005]);
    const poly = makePoly(g.verts, g.faces, Mv);
    let worst = 0;
    for (const r of [[0.015, 0.004, 0.009], [-0.011, 0.003, -0.002], [0.002, 0.014, 0.0], [0.03, 0.02, 0.01], [0.0005, -0.001, 0.0128]]) {
      const Ha = polyH(poly, r).H, Hb = bruteH(poly, r, 80);
      worst = Math.max(worst, relerr(Ha, Hb));
    }
    check(`cuboid H vs brute (${name})`, worst < 3e-3, `worst rel err ${worst.toExponential(2)}`);
    // inside point: B = mu0(H+M)
    const rin = [0.001, -0.002, 0.0005]; const { H, inside } = polyH(poly, rin, true);
    check(`inside detection (${name})`, inside === true);
    const Hb = bruteH(poly, rin, 80);
    check(`inside H vs brute (${name})`, relerr(H, Hb) < 5e-3, relerr(H, Hb).toExponential(2));
  }
}

// T2: Derby–Olbert cylinder vs faceted prism; and ring
{
  const Br = 1.45, a = 0.005, b = 0.0025; const M = Br / MU0;
  const g = prismGeom(a, 0, 2 * b, 96); const poly = makePoly(g.verts, g.faces, [0, 0, M]);
  let worst = 0;
  for (const [rho, z] of [[0.003, 0.004], [0.007, 0.001], [0.0, 0.006], [0.012, -0.003], [0.0049, 0.0026]]) {
    const [Br_, Bz_] = cylinderBrz(a, b, Br, rho, z); const Ba = [Br_, 0, Bz_];
    const Bp = polyB(poly, [rho, 0, z]); worst = Math.max(worst, relerr(Ba, Bp));
  }
  check('Derby–Olbert vs faceted cylinder (96 facets)', worst < 4e-3, `worst rel err ${worst.toExponential(2)}`);
  // on-axis closed form: Bz(z) = Br/2 [ (z+b)/sqrt((z+b)^2+a^2) - (z-b)/sqrt((z-b)^2+a^2) ]
  const z = 0.004; const exact = Br / 2 * ((z + b) / Math.hypot(z + b, a) - (z - b) / Math.hypot(z - b, a));
  const [, bz] = cylinderBrz(a, b, Br, 0, z);
  check('cylinder on-axis exact', Math.abs(bz - exact) / exact < 1e-9, `${bz} vs ${exact}`);
  // inside the magnet centre: B = mu0(M + H_demag); check against prism
  const Bc = cylinderBrz(a, b, Br, 0.001, 0.0005), Bp = polyB(poly, [0.001, 0, 0.0005]);
  check('inside cylinder vs prism', relerr([Bc[0], 0, Bc[1]], Bp) < 5e-3, relerr([Bc[0], 0, Bc[1]], Bp).toExponential(2));
}

// T3: force between two coaxial cylinder magnets: charge method (analytic cyl + poly) vs surface-current (Lorentz)
{
  const D = 0.01, L = 0.005, gap = 0.002, Br = 1.45;
  const m1 = { id: 'm1', kind: 'magnet', shape: 'cyl', dims: { D, L }, Br, frame: { q: QI, p: [0, 0, 0] } };
  const m2 = { id: 'm2', kind: 'magnet', shape: 'cyl', dims: { D, L }, Br, frame: { q: QI, p: [0, 0, L + gap] } };
  const sc = compileScene([m1, m2]);
  const Fc = magnetForceTorque(sc, 'm2', { n: 8 }).F;
  // surface current model of m2: sheet current K = M on its side, total ampere-turns M*L
  const M = Br / MU0; const coil = ringCoil(D / 2, D / 2 + 1e-9, -L / 2, L / 2, { nr: 1, nz: 24, nseg: 96 });
  const pc = placeCoil(coil, { q: QI, p: [0, 0, L + gap] });
  const sc1 = compileScene([m1]);
  const Fl = coilForceTorque(pc, M * L, r => fieldAt(sc1, r), [0, 0, 0], 2).F;
  check('two magnets: charge method vs surface current', relerr(Fc, Fl) < 1e-2, `Fc=${fmt(Fc)} Fl=${fmt(Fl)}`);
  // Newton's third law
  const F1 = magnetForceTorque(sc, 'm1', { n: 8 }).F;
  check('two magnets: F1 = -F2', relerr(F1, scale(Fc, -1)) < 1e-2, `F1=${fmt(F1)}`);
  // poly version of m2
  const m2p = { id: 'm2', kind: 'magnet', shape: 'dcyl', dims: { D, L, n: 64 }, Br, mdir: [0, 0, 1], frame: { q: QI, p: [0, 0, L + gap] } };
  const scp = compileScene([m1, m2p]); const Fp = magnetForceTorque(scp, 'm2', { n: 4 }).F;
  check('two magnets: poly magnet force', relerr(Fp, Fl) < 1.5e-2, `Fp=${fmt(Fp)}`);
  console.log('   attraction force between two 10x5 N52 at 2 mm gap:', (Fl[2]).toFixed(3), 'N (expect ~ -8..-9 N, pulling together)');
}

// T4: coil force = -magnet force
{
  const m1 = { id: 'm1', kind: 'magnet', shape: 'cyl', dims: { D: 0.01, L: 0.005 }, Br: 1.45, frame: { q: QI, p: [0, 0, 0] } };
  const coil = ringCoil(0.0055, 0.0075, 0.002, 0.005, { nr: 3, nz: 3, nseg: 64, turns: 100 });
  const c1 = { id: 'c1', kind: 'coil', coil, I: 1, frame: { q: QI, p: [0, 0, 0] } };
  const sc = compileScene([m1, c1]);
  const Fc = coilForceTorqueIn(sc, 'c1', 1).F; const Fm = magnetForceTorque(sc, 'm1', { n: 8 }).F;
  check('coil force = -magnet force', relerr(Fc, scale(Fm, -1)) < 1e-2, `Fc=${fmt(Fc)} Fm=${fmt(Fm)}`);
  // tilted magnet + oblique coil: torque consistency about the same origin
  const q = qAxisAngle([1, 0.3, 0], 0.6);
  const m2 = { id: 'm1', kind: 'magnet', shape: 'block', dims: { lx: 0.01, ly: 0.008, lz: 0.004 }, Br: 1.3, mdir: [0, 0, 1], frame: { q, p: [0.001, 0, 0] } };
  const c2 = { id: 'c1', kind: 'coil', coil, I: 2, frame: { q: qAxisAngle([0, 1, 0], 0.4), p: [0.002, 0.001, 0.006] } };
  const sc2 = compileScene([m2, c2]);
  const a = coilForceTorqueIn(sc2, 'c1', 2, { O: [0, 0, 0] }), b = magnetForceTorque(sc2, 'm1', { n: 8, O: [0, 0, 0] });
  check('oblique: F equal/opposite', relerr(a.F, scale(b.F, -1)) < 1e-2, `Fc=${fmt(a.F)} Fm=${fmt(b.F)}`);
  check('oblique: torque equal/opposite (same origin)', relerr(a.T, scale(b.T, -1)) < 1.5e-2, `Tc=${fmt(a.T)} Tm=${fmt(b.T)}`);
}

// T5: image plate: tangential B vanishes on the plate surface
{
  const m1 = { id: 'm1', kind: 'magnet', shape: 'cyl', dims: { D: 0.01, L: 0.005 }, Br: 1.45, frame: { q: QI, p: [0.003, 0, 0.004] } };
  const pl = { id: 'p1', kind: 'plate', frame: { q: QI, p: [0, 0, 0] } };
  const sc = compileScene([m1, pl]);
  let worst = 0;
  for (const r of [[0.002, 0.001, 0], [0.008, -0.003, 0], [0.0, 0.0, 0], [0.012, 0.005, 0]]) { const B = fieldAt(sc, r); const tan = Math.hypot(B[0], B[1]) / norm(B); worst = Math.max(worst, tan); }
  check('plate image: tangential B ~ 0 at plate', worst < 1e-9, `worst tan fraction ${worst.toExponential(2)}`);
  // block magnet with oblique M on plate
  const m2 = { id: 'm1', kind: 'magnet', shape: 'block', dims: { lx: 0.01, ly: 0.006, lz: 0.004 }, Br: 1.3, mdir: unit([0.5, 0.2, 0.8]), frame: { q: qAxisAngle([0, 0, 1], 0.5), p: [0, 0, 0.003] } };
  const sc2 = compileScene([m2, pl]); worst = 0;
  for (const r of [[0.002, 0.001, 0], [0.008, -0.003, 0], [0.0, 0.0, 0]]) { const B = fieldAt(sc2, r); worst = Math.max(worst, Math.hypot(B[0], B[1]) / norm(B)); }
  check('plate image (oblique block): tangential B ~ 0', worst < 1e-9, worst.toExponential(2));
  // coil over plate
  const coil = ringCoil(0.004, 0.006, 0.001, 0.003, { nr: 1, nz: 1, nseg: 64 });
  const c1 = { id: 'c1', kind: 'coil', coil, I: 1, frame: { q: qAxisAngle([1, 0, 0], 0.4), p: [0.002, 0, 0.006] } };
  const sc3 = compileScene([c1, pl]); worst = 0;
  for (const r of [[0.002, 0.001, 0], [0.008, -0.003, 0], [0.0, 0.0, 0]]) { const B = fieldAt(sc3, r); worst = Math.max(worst, Math.hypot(B[0], B[1]) / norm(B)); }
  check('plate image (coil): tangential B ~ 0', worst < 1e-9, worst.toExponential(2));
  // two plates: field between is reinforced; check tangential at both
  const pl2 = { id: 'p2', kind: 'plate', frame: { q: qAxisAngle([1, 0, 0], Math.PI), p: [0, 0, 0.012] } };
  const sc4 = compileScene([m1, pl, pl2], { imageDepth: 6 }); worst = 0;
  for (const r of [[0.002, 0.001, 0], [0.004, -0.003, 0.012]]) { const B = fieldAt(sc4, r); worst = Math.max(worst, Math.hypot(B[0], B[1]) / norm(B)); }
  check('two plates (depth 6): tangential B small', worst < 2e-3, worst.toExponential(2));
}

// T6: loop field vs polyline Biot–Savart; coil inductance sanity (Wheeler)
{
  const a = 0.01, I = 1; const pts = []; for (let i = 0; i < 128; i++) { const t = 2 * Math.PI * i / 128; pts.push([a * Math.cos(t), a * Math.sin(t), 0]); }
  let worst = 0;
  for (const [rho, z] of [[0.003, 0.002], [0.008, -0.004], [0.015, 0.001]]) { const [br, bz] = loopBrz(a, I, rho, z); const Bp = polylineB(pts, I, [rho, 0, z]); worst = Math.max(worst, relerr([br, 0, bz], Bp)); }
  check('loop (elliptic) vs 128-seg polyline', worst < 2e-3, worst.toExponential(2));
  // single-layer solenoid-ish coil inductance vs Wheeler: ri=5mm ro=7mm h=10mm N=200
  const coil = ringCoil(0.005, 0.007, -0.005, 0.005, { nr: 2, nz: 4, nseg: 48 });
  const L = coilInductance(coil, 200);
  // Wheeler multilayer (inches): L[uH] = 0.8 a^2 N^2 / (6a + 9b + 10c), a = mean radius, b = length, c = build
  const inch = 0.0254; const am = 0.006 / inch, b = 0.01 / inch, c = 0.002 / inch; const Lw = 0.8 * am * am * 200 * 200 / (6 * am + 9 * b + 10 * c) * 1e-6;
  check('inductance vs Wheeler within 10%', Math.abs(L - Lw) / Lw < 0.10, `L=${(L * 1e3).toFixed(3)} mH, Wheeler ${(Lw * 1e3).toFixed(3)} mH`);
  // same coil as a generic polyline (force the generic path) should agree with the ring path
  const t0 = performance.now(); const Lg = coilInductance({ ...coil, kind: 'generic' }, 200); const dt = performance.now() - t0;
  check('generic Neumann path vs ring path within 3%', Math.abs(Lg - L) / L < 0.03, `Lg=${(Lg * 1e3).toFixed(3)} mH (${dt.toFixed(0)} ms)`);
}

// T7: energy check Kt = dΨ/dθ for a coil near a rotating block magnet (torque per amp vs flux-linkage derivative)
{
  const coil = sectorCoil(0.010, 0.020, 0.35, 0.002, 0.003, { nb: 2, nz: 2, narc: 8, turns: 1 });
  const cObj = { id: 'c', kind: 'coil', coil, I: 1, frame: { q: QI, p: [0, 0, 0] } };
  const magAt = th => ({ id: 'm', kind: 'magnet', shape: 'arc', dims: { Ri: 0.011, Ro: 0.019, L: 0.003, span: 0.5, n: 8 }, Br: 1.3, mag: 'axial', frame: { q: qAxisAngle([0, 0, 1], th), p: [0, 0, 0.004] } });
  const torqueZ = th => { const sc = compileScene([magAt(th), cObj]); return coilForceTorqueIn(sc, 'c', 1, { O: [0, 0, 0] }).T[2]; };
  const flux = th => { const sc = compileScene([magAt(th)]); let s = 0; for (const f of coil.filaments) s += f.w * polygonFlux(f.pts, r => fieldAt(sc, r), 8); return s; };
  const th0 = 0.2, dth = 1e-4;
  const Tz = torqueZ(th0); // torque on coil about z due to magnet at angle th0
  const dPsi = (flux(th0 + dth) - flux(th0 - dth)) / (2 * dth); // dΨ/dθ_magnet
  // torque on the magnet = -Tz; power balance: T_mag * ω = -e*i with e = dΨ/dt -> T_mag = -dΨ/dθ * I  => Tz(coil) = dΨ/dθ * I
  check('Kt = -dΨ/dθ (energy consistency)', Math.abs(Tz + dPsi) / Math.abs(dPsi) < 2e-2, `T=${Tz.toExponential(4)} dΨ/dθ=${dPsi.toExponential(4)}`);
}

// timing
{
  const g = transformGeom(cuboidGeom(0.02, 0.012, 0.006), QI, [0, 0, 0]); const poly = makePoly(g.verts, g.faces, [0, 0, 1e6]);
  const t0 = performance.now(); let s = 0; for (let i = 0; i < 100000; i++) { const B = polyB(poly, [0.01 + i * 1e-9, 0.004, 0.009], false); s += B[2]; }
  const dt = performance.now() - t0; console.log(`   timing: ${(dt / 100000 * 1e3).toFixed(2)} µs per cuboid B eval (2 charged faces)`, s > 0 ? '' : '');
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
