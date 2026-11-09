import { BLDC_DEFAULTS, analyzeBLDC, rotorMagnets, platesFor, statorCoil, phaseMap, buildScene } from '../src/js/modules/bldc.js';
import { compileScene, fieldAt, coilForceTorqueIn } from '../src/js/engine/scene.js';
import { norm } from '../src/js/engine/vec.js';

let fails = 0; const check = (name, ok, info = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); if (!ok) fails++; };
const p = { ...BLDC_DEFAULTS };
console.log('phase map 12N14P:', phaseMap(14, 12).map(x => (x.sign > 0 ? '+' : '-') + 'ABC'[x.phase]).join(' '));
console.log('phase map 9N12P :', phaseMap(12, 9).map(x => (x.sign > 0 ? '+' : '-') + 'ABC'[x.phase]).join(' '));

let t0 = performance.now();
const r = analyzeBLDC(p, null, false);
let dt = performance.now() - t0;
console.log(`axial-single 12N14P: Kt/AT=${r.KtPerAT.toExponential(3)} N·m/(A·turn), N=${r.N}, Kt=${r.Kt.toFixed(4)} N·m/A, Rph=${r.Rph.toFixed(3)} Ω, Lph=${(r.Lph * 1e6).toFixed(1)} µH, Km=${r.Km.toFixed(4)} N·m/√W, ripple=${(r.ripple * 100).toFixed(1)}%, Kv=${r.Kv.toFixed(0)} rpm/V, gamma=${(r.gamma * 180 / Math.PI).toFixed(0)}°  (${dt.toFixed(0)} ms)`);
check('Kt/AT plausible (0.5e-3..4e-3)', r.KtPerAT > 0.5e-3 && r.KtPerAT < 4e-3);
check('ripple small for 12N14P ironless (<5%)', r.ripple < 0.05, (r.ripple * 100).toFixed(2) + '%');

// direct check of the symmetry synthesis: all coils, direct torque at two rotor angles
{
  const pm = phaseMap(p.poles, p.coils); const periodM = 4 * Math.PI / p.poles;
  for (const frac of [0.13, 0.61]) {
    const thm = periodM * frac, the = (p.poles / 2) * thm;
    const objs = [...rotorMagnets(p, thm), ...platesFor(p)]; for (let k = 0; k < p.coils; k++) objs.push(statorCoil(p, k));
    const sc = compileScene(objs, { imageDepth: 3 });
    let T = 0; for (let k = 0; k < p.coils; k++) { const ik = pm[k].sign * Math.cos(the + r.gamma - 2 * Math.PI * pm[k].phase / 3); T += -ik * coilForceTorqueIn(sc, 'c' + k, 1, { O: [0, 0, 0], coils: false }).T[2]; }
    // synthesized value at the same angle
    const i = Math.round(frac * r.Twave.length) % r.Twave.length; const Ts = r.Twave[i];
    // Twave sampled on 72-grid; compare to nearest sample (ripple is small so ok)
    check(`direct all-coil torque vs synthesized @${frac}`, Math.abs(T - Ts) / Math.abs(Ts) < 0.02, `direct=${T.toExponential(4)} synth=${Ts.toExponential(4)}`);
  }
}
// Halbach should give more Kt without back iron than plain without back iron
{
  const q1 = { ...p, rotorIron: false, halbach: false }, q2 = { ...p, rotorIron: false, halbach: true, poleArc: 0.6 };
  const a = analyzeBLDC(q1, null, true), b = analyzeBLDC(q2, null, true);
  console.log(`no-iron plain Kt/AT=${a.KtPerAT.toExponential(3)}  halbach Kt/AT=${b.KtPerAT.toExponential(3)}`);
  check('Halbach beats plain (no back iron)', b.KtPerAT > a.KtPerAT * 1.1);
  // back-iron should help plain
  check('back iron helps plain', r.KtPerAT > a.KtPerAT * 1.2, `${r.KtPerAT.toExponential(3)} vs ${a.KtPerAT.toExponential(3)}`);
}
// dual rotor
{
  const q = { ...p, topology: 'axial-dual' }; t0 = performance.now(); const d = analyzeBLDC(q, null, false); dt = performance.now() - t0;
  console.log(`axial-dual: Kt/AT=${d.KtPerAT.toExponential(3)} Km=${d.Km.toFixed(4)} ripple=${(d.ripple * 100).toFixed(1)}% (${dt.toFixed(0)} ms)`);
  check('dual rotor > single', d.KtPerAT > r.KtPerAT * 1.3);
}
// radial inrunner
{
  const q = { ...p, topology: 'radial-in', poles: 14, coils: 12, Rin: 8e-3, Rout: 12e-3, Lm: 20e-3, gap: 1e-3, build: 2e-3, tc: 2e-3, span: 0.9 };
  t0 = performance.now(); const d = analyzeBLDC(q, null, false); dt = performance.now() - t0;
  console.log(`radial-in: Kt/AT=${d.KtPerAT.toExponential(3)} Km=${d.Km.toFixed(4)} ripple=${(d.ripple * 100).toFixed(1)}% N=${d.N} (${dt.toFixed(0)} ms)`);
  check('radial Kt positive & plausible', d.KtPerAT > 1e-4 && d.KtPerAT < 5e-3);
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
