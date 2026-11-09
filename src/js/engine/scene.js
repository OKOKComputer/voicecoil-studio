// Scene = magnets + coils + ideal steel plates (images). Compiles objects to field sources, evaluates B, forces, torques.
import { MU0, add, sub, scale, dot, cross, norm, unit, qRot, qConj, toLocal, toWorld, dirToWorld, QI } from './vec.js';
import { ringBrz } from './cylinder.js';
import { makePoly, polyB, polyH, cuboidGeom, arcGeom, prismGeom, transformGeom, mirrorPoly, faceChargeSamples, mirrorPoint } from './polyhedron.js';
import { placeCoil, mirrorCoil, coilForceTorque, polylineB as polylineBpts } from './coils.js';

export const GRADES = {
  N35: { Br: 1.20, type: 'nd' }, N38: { Br: 1.24, type: 'nd' }, N42: { Br: 1.30, type: 'nd' }, N45: { Br: 1.35, type: 'nd' },
  N48: { Br: 1.39, type: 'nd' }, N52: { Br: 1.45, type: 'nd' }, SmCo: { Br: 1.08, type: 'smco' }, Ferrite: { Br: 0.39, type: 'fe' },
};
export const MAGDENS = { nd: 7500, smco: 8400, fe: 4900 };

const frameOf = o => ({ q: (o.frame && o.frame.q) || QI, p: (o.frame && o.frame.p) || [0, 0, 0] });

/** Compile a magnet object into one or more field sources. */
export function compileMagnet(o) {
  const fr = frameOf(o), Br = o.Br, M = Br / MU0; const d = o.dims; const out = [];
  const shape = o.shape;
  if (shape === 'cyl' || shape === 'ring') {
    const Ro = d.D / 2, Ri = shape === 'ring' ? (d.Din || 0) / 2 : 0;
    out.push({ type: 'cyl', frame: fr, Ro, Ri, b: d.L / 2, Br, M: dirToWorld(fr, [0, 0, M]), owner: o.id,
      volume: Math.PI * (Ro * Ro - Ri * Ri) * d.L });
  } else if (shape === 'sphere') {
    out.push({ type: 'sphere', frame: fr, R: d.D / 2, Br, M: dirToWorld(fr, scale(unit(o.mdir || [0, 0, 1]), M)), owner: o.id, volume: 4 / 3 * Math.PI * Math.pow(d.D / 2, 3) });
  } else if (shape === 'block') {
    const g = transformGeom(cuboidGeom(d.lx, d.ly, d.lz), fr.q, fr.p);
    out.push({ type: 'poly', poly: makePoly(g.verts, g.faces, dirToWorld(fr, scale(unit(o.mdir || [0, 0, 1]), M)), { owner: o.id }), owner: o.id, volume: d.lx * d.ly * d.lz });
  } else if (shape === 'dcyl') { // diametral cylinder: M along local x
    const n = d.n || 32; const g = transformGeom(prismGeom(d.D / 2, (d.Din || 0) / 2, d.L, n), fr.q, fr.p);
    out.push({ type: 'poly', poly: makePoly(g.verts, g.faces, dirToWorld(fr, scale(unit(o.mdir || [1, 0, 0]), M)), { owner: o.id }), owner: o.id, volume: Math.PI * ((d.D / 2) ** 2 - ((d.Din || 0) / 2) ** 2) * d.L });
  } else if (shape === 'arc') {
    // annular sector; magnetization: 'axial' (local z), 'parallel' (fixed local dir), 'radial' (split into k sub-arcs)
    const Ri = d.Ri, Ro = d.Ro, h = d.L, span = d.span, n = d.n || 8;
    const mode = o.mag || 'axial', sign = o.sign || 1;
    if (mode === 'radial') {
      const k = d.k || 4;
      for (let i = 0; i < k; i++) {
        const a0 = -span / 2 + span * i / k, a1 = -span / 2 + span * (i + 1) / k, am = (a0 + a1) / 2;
        const g = transformGeom(arcGeom(Ri, Ro, h, a0, a1, Math.max(2, Math.round(n / k))), fr.q, fr.p);
        const Ml = scale([Math.cos(am), Math.sin(am), 0], M * sign);
        out.push({ type: 'poly', poly: makePoly(g.verts, g.faces, dirToWorld(fr, Ml), { owner: o.id }), owner: o.id, volume: 0 });
      }
      out[out.length - 1].volume = 0.5 * span * (Ro * Ro - Ri * Ri) * h;
    } else {
      const g = transformGeom(arcGeom(Ri, Ro, h, -span / 2, span / 2, n), fr.q, fr.p);
      const Ml = mode === 'axial' ? [0, 0, M * sign] : scale(unit(o.mdir || [1, 0, 0]), M * sign);
      out.push({ type: 'poly', poly: makePoly(g.verts, g.faces, dirToWorld(fr, Ml), { owner: o.id }), owner: o.id, volume: 0.5 * span * (Ro * Ro - Ri * Ri) * h });
    }
  }
  return out;
}

function mirrorSource(s, p0, n) {
  if (s.type === 'poly') return { ...s, poly: mirrorPoly(s.poly, p0, n), image: true };
  if (s.type === 'cyl') {
    // mirror the frame: position mirrored, axis mirrored (normal comp preserved -> axis direction flips tangential parts)
    const nn = unit(n); const p = mirrorPoint(s.frame.p, p0, nn);
    const ax = dirToWorld(s.frame, [0, 0, 1]); const axm = sub(scale(nn, 2 * dot(ax, nn)), ax); // image M direction
    // new frame with z along axm
    const q = qFromDir(axm); return { ...s, frame: { q, p }, M: scale(axm, norm(s.M)), image: true };
  }
  if (s.type === 'sphere') { const nn = unit(n); const p = mirrorPoint(s.frame.p, p0, nn); const M = sub(scale(nn, 2 * dot(s.M, nn)), s.M); return { ...s, frame: { ...s.frame, p }, M, image: true }; }
  if (s.type === 'coil') return { ...s, coil: mirrorCoil(s.coil, p0, n), image: true };
  return s;
}
function qFromDir(d) { // quaternion rotating +z to d
  const u = unit(d), c = u[2];
  if (c > 1 - 1e-12) return [1, 0, 0, 0]; if (c < -1 + 1e-12) return [0, 1, 0, 0];
  const ax = unit(cross([0, 0, 1], u)), ang = Math.acos(c), s = Math.sin(ang / 2); return [Math.cos(ang / 2), ax[0] * s, ax[1] * s, ax[2] * s];
}

/** Compile whole scene. objects: [{kind:'magnet'|'coil'|'plate', ...}]. coils carry .coil (local filaments) + .I */
export function compileScene(objects, opts = {}) {
  const depth = opts.imageDepth ?? 4;
  const sources = [], coils = [], plates = [];
  for (const o of objects) {
    if (o.hidden) continue;
    if (o.kind === 'magnet') sources.push(...compileMagnet(o));
    else if (o.kind === 'coil') { const c = placeCoil(o.coil, frameOf(o)); coils.push({ type: 'coil', coil: c, I: o.I || 0, owner: o.id }); }
    else if (o.kind === 'plate') { const fr = frameOf(o); plates.push({ p0: fr.p, n: dirToWorld(fr, [0, 0, 1]), owner: o.id, size: o.size }); }
  }
  // images
  let images = [];
  if (plates.length) {
    let layer = [...sources, ...coils];
    for (let k = 0; k < (plates.length === 1 ? 1 : depth); k++) {
      const next = [];
      for (const s of layer) for (const pl of plates) {
        // only mirror objects that are on the +n side of this plate (or were produced by the other plate)
        if (s.lastPlate === pl) continue;
        const img = mirrorSource(s, pl.p0, pl.n); img.lastPlate = pl; img.gen = k + 1; next.push(img);
      }
      images.push(...next); layer = next;
    }
  }
  return { sources, coils, plates, images, objects };
}

function sourceB(s, r, inside) {
  if (s.type === 'poly') return polyB(s.poly, r, inside);
  if (s.type === 'cyl') {
    const l = toLocal(s.frame, r); const rho = Math.hypot(l[0], l[1]);
    const [br, bz] = ringBrz(s.Ro, s.Ri, s.b, s.Br, rho, l[2]);
    const bl = rho > 1e-15 ? [br * l[0] / rho, br * l[1] / rho, bz] : [0, 0, bz];
    return qRot(s.frame.q, bl);
  }
  if (s.type === 'sphere') {
    const d = sub(r, s.frame.p); const rr = norm(d);
    if (rr < s.R) return scale(s.M, 2 / 3 * MU0);
    const m = scale(s.M, 4 / 3 * Math.PI * s.R ** 3); const rh = scale(d, 1 / rr);
    return scale(sub(scale(rh, 3 * dot(m, rh)), m), MU0 / (4 * Math.PI * rr ** 3));
  }
  if (s.type === 'coil') { if (!s.I) return [0, 0, 0]; let b = [0, 0, 0]; for (const f of s.coil.filaments) { const cur = s.I * s.coil.turns * f.w; b = add(b, polylineBpts(f.pts, cur, r, f.closed)); } return b; }
  return [0, 0, 0];
}

/** Total B at r. opts: {exclude: ownerId, coils:boolean, inside:boolean} */
export function fieldAt(sc, r, opts = {}) {
  let b = [0, 0, 0]; const ex = opts.exclude; const inside = opts.inside !== false;
  for (const s of sc.sources) { if (ex !== undefined && s.owner === ex) continue; b = add(b, sourceB(s, r, inside)); }
  for (const s of sc.images) { if (opts.excludeImagesOf !== undefined && s.owner === opts.excludeImagesOf) continue; if (s.type === 'coil' && opts.coils === false) continue; b = add(b, sourceB(s, r, false)); }
  if (opts.coils !== false) for (const s of sc.coils) { if (ex !== undefined && s.owner === ex) continue; b = add(b, sourceB(s, r, false)); }
  return b;
}

/** Charge samples {r,w} for a compiled magnet source (for force/torque via charge method). */
export function chargeSamples(s, n = 6) {
  if (s.type === 'poly') return faceChargeSamples(s.poly, n);
  const out = [];
  if (s.type === 'cyl') {
    const Mmag = norm(s.M); const nr = n, nphi = 4 * n;
    for (const sgn of [1, -1]) {
      for (let i = 0; i < nr; i++) {
        const r0 = s.Ri + (s.Ro - s.Ri) * i / nr, r1 = s.Ri + (s.Ro - s.Ri) * (i + 1) / nr; const rm = (r0 + r1) / 2, dA = 0.5 * (r1 * r1 - r0 * r0) * (2 * Math.PI / nphi);
        for (let j = 0; j < nphi; j++) { const a = 2 * Math.PI * (j + 0.5) / nphi; out.push({ r: toWorld(s.frame, [rm * Math.cos(a), rm * Math.sin(a), sgn * s.b]), w: sgn * Mmag * dA }); }
      }
    }
  } else if (s.type === 'sphere') {
    const Mmag = norm(s.M), mdir = unit(s.M); const nth = 2 * n, nph = 4 * n, R = s.R;
    for (let i = 0; i < nth; i++) { const th = Math.PI * (i + 0.5) / nth; for (let j = 0; j < nph; j++) { const ph = 2 * Math.PI * (j + 0.5) / nph;
      const nv = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
      // orient so that pole axis = mdir: build basis
      const w = Mmag * dot(rotateToAxis(nv, mdir), mdir) * R * R * Math.sin(th) * (Math.PI / nth) * (2 * Math.PI / nph);
      out.push({ r: add(s.frame.p, scale(rotateToAxis(nv, mdir), R)), w }); } }
  }
  return out;
}
function rotateToAxis(v, axis) { const q = qFromDir(axis); return qRot(q, v); }

/** Force and torque (about point O, default: magnet centre) on magnet with owner id, from everything else incl. all images. */
export function magnetForceTorque(sc, ownerId, opts = {}) {
  const n = opts.n || 5; let F = [0, 0, 0], T = [0, 0, 0];
  const mine = sc.sources.filter(s => s.owner === ownerId);
  const O = opts.O || centroidOf(mine);
  for (const s of mine) {
    for (const smp of chargeSamples(s, n)) {
      const B = fieldAt(sc, smp.r, { exclude: ownerId, inside: false, coils: opts.coils !== false });
      const dF = scale(B, smp.w); F = add(F, dF); T = add(T, cross(sub(smp.r, O), dF));
    }
  }
  return { F, T, O };
}
export function centroidOf(srcs) {
  let c = [0, 0, 0], vs = 0;
  for (const s of srcs) { const v = s.volume || 1; const p = s.type === 'poly' ? polyCentroid(s.poly) : s.frame.p; c = add(c, scale(p, v)); vs += v; }
  return vs ? scale(c, 1 / vs) : [0, 0, 0];
}
function polyCentroid(poly) { let c = [0, 0, 0]; for (const v of poly.verts) c = add(c, v); return scale(c, 1 / poly.verts.length); }

/** Force/torque on a coil object (by owner id) in the field of magnets (+images) and optionally other coils. */
export function coilForceTorqueIn(sc, ownerId, I, opts = {}) {
  const c = sc.coils.find(x => x.owner === ownerId); if (!c) return null;
  const O = opts.O || coilCentre(c.coil);
  const Bfun = r => fieldAt(sc, r, { exclude: ownerId, inside: false, coils: opts.coils !== false });
  return { ...coilForceTorque(c.coil, I, Bfun, O, opts.gauss || 3), O };
}
export function coilCentre(coil) { let c = [0, 0, 0], n = 0; for (const f of coil.filaments) for (const p of f.pts) { c = add(c, p); n++; } return scale(c, 1 / n); }

/** Sample B on a planar grid for heat maps: plane with origin o, axes u,v (unit), half-sizes hu,hv, nu x nv. */
export function fieldSlice(sc, o, u, v, hu, hv, nu, nv, opts = {}) {
  const comp = opts.comp || 'mag'; const out = new Float32Array(nu * nv); const nrm = cross(u, v); let bmax = 0;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const r = add(add(o, scale(u, -hu + 2 * hu * (i + 0.5) / nu)), scale(v, -hv + 2 * hv * (j + 0.5) / nv));
    const B = fieldAt(sc, r, { inside: true, coils: opts.coils !== false });
    let val; if (comp === 'mag') val = norm(B); else if (comp === 'n') val = dot(B, nrm); else if (comp === 'u') val = dot(B, u); else val = dot(B, v);
    out[j * nu + i] = val; if (Math.abs(val) > bmax) bmax = Math.abs(val);
  }
  return { data: out, nu, nv, bmax, comp };
}
