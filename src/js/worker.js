// Module worker: heavy computations off the main thread.
import { runVoiceCoil, toScene as vcToScene } from './modules/voicecoil.js';
import { analyzeBLDC, optimizeBLDC, buildScene as bldcScene } from './modules/bldc.js';
import { analyzeSpherical, buildScene as sphScene } from './modules/spherical.js';
import { analyzeScene, sweepScene, sliceScene, toEngineObjects } from './modules/freescene.js';
import { compileScene, fieldSlice } from './engine/scene.js';

self.onmessage = e => {
  const { id, type, params } = e.data;
  const progress = (frac, msg) => self.postMessage({ id, progress: frac, msg });
  try {
    let result;
    if (type === 'voicecoil') {
      const { results, order } = runVoiceCoil(params, (k, n) => progress(k / n, `${k} из ${n}`));
      // strip typed arrays we don't need except bF/F/ffMask for drawing
      result = { results: results.map(r => r.invalid ? { invalid: r.invalid, meta: r.meta } : { ...r, geom: r.geom }), order };
    } else if (type === 'bldc') {
      result = analyzeBLDC(params, progress, false);
    } else if (type === 'bldcOpt') {
      result = optimizeBLDC(params.p, params.opts, progress);
    } else if (type === 'spherical') {
      result = analyzeSpherical(params, progress);
    } else if (type === 'scene') {
      result = analyzeScene(params.objs, params.opts || {}, progress);
    } else if (type === 'sweep') {
      result = sweepScene(params.objs, params.sw, progress);
    } else if (type === 'slice') {
      let objs;
      if (params.uiObjs) objs = toEngineObjects(params.uiObjs);
      else if (params.bldc) objs = bldcScene(params.bldc);
      else if (params.sph) objs = sphScene(params.sph);
      else if (params.vc) objs = vcToScene(params.vc.result, params.vc.P);
      else objs = params.engineObjs || [];
      objs = objs.filter(o => o.kind !== 'steelviz' && o.kind !== 'ballviz');
      const sc = compileScene(objs, { imageDepth: 3 });
      const pl = params.plane; result = fieldSlice(sc, pl.o, pl.u, pl.v, pl.hu, pl.hv, pl.nu, pl.nv, { comp: pl.comp, coils: pl.coils });
    } else throw new Error('unknown task ' + type);
    self.postMessage({ id, done: true, result });
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
