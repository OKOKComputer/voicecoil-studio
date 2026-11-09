import { SPH_DEFAULTS, analyzeSpherical, buildScene as sphScene } from '../src/js/modules/spherical.js';
import { PRESETS, analyzeScene, sweepScene, sliceScene } from '../src/js/modules/freescene.js';
import { runVoiceCoil, toScene } from '../src/js/modules/voicecoil.js';
import { compileScene, coilForceTorqueIn } from '../src/js/engine/scene.js';
import { kmFromPerAmpTurn } from '../src/js/engine/coils.js';
let t0=performance.now();
const p={...SPH_DEFAULTS, mapRes:6};
const r=analyzeSpherical(p,(f,m)=>{});
console.log(`spherical cube8/hemi8: N=${r.N} R=${r.R.toFixed(2)}Ω KmMin=${r.KmMin.toExponential(3)} KmMax=${r.KmMax.toExponential(3)} iso=${r.isotropy.toFixed(2)} axes=`, Object.fromEntries(Object.entries(r.axes).map(([k,v])=>[k,v.toExponential(2)])), `map min/max ${r.map.min.toExponential(2)}/${r.map.max.toExponential(2)} (${(performance.now()-t0).toFixed(0)} ms)`);
t0=performance.now();
const d=analyzeSpherical({...p, pattern:'dipole', mapRes:4},()=>{});
console.log(`dipole ball: sig=${d.sig.map(x=>x.toExponential(2)).join(',')} (rank-2 expected: third ~0)  (${(performance.now()-t0).toFixed(0)} ms)`);
for (const [name, mk] of Object.entries(PRESETS)) { t0=performance.now(); const objs=mk(); const a=analyzeScene(objs,{inductance:false}); const coils=a.rows.filter(r=>r.kind==='coil'); console.log(`preset "${name}": ${a.rows.length} objs, coil Km=`, coils.map(c=>c.km.toFixed(3)).join(' '), `Fz coil0=${coils[0].F[2].toExponential(2)} (${(performance.now()-t0).toFixed(0)} ms)`); }
// voice coil v1 solver cross-check vs generic engine on the best bare config
const P={mag:{Ro:5e-3,Ri:0,L:5e-3,Br:1.45,type:'nd'},count:2,clear:0.3e-3,stroke:2e-3,Rmax:12e-3,Hlim:0,mmax:0,nr:48,nz:72,cond:'cu',T:80,kf:0.8,moving:'coil',load:0,obj:'km',sections:true,hconv:12,U:5,wire:0.23e-3};
t0=performance.now(); const vc=runVoiceCoil(P); console.log(`voicecoil v1 solver: ${(performance.now()-t0).toFixed(0)} ms; ranking:`, vc.order.map(i=>`${vc.results[i].meta.name}: ${vc.results[i].km.toFixed(3)}`).join(' | '));
const best=vc.results[vc.order.find(i=>!vc.results[i].cup)]; const objs=toScene(best,P); const sc=compileScene(objs);
// generic engine: force per A·turn at stroke center (sections: coil may have counter-wound sections -> handle by sign of rows?). Only compare when secs==1
if (best.coil.secs===1){ const f=coilForceTorqueIn(sc,'coil',1).F[2]; const km=kmFromPerAmpTurn(Math.abs(f), objs.find(o=>o.id==='coil').coil,{cond:'cu',T:80,kf:0.8}); console.log(`cross-check ${best.meta.name}: v1 Km=${best.km.toFixed(4)} (min ${best.kmMin.toFixed(4)} max ${best.kmMax.toFixed(4)}), generic engine Km at centre=${km.toFixed(4)}`); } else console.log('best has',best.coil.secs,'sections — skip cross-check');
