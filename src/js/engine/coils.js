// Coils as bundles of filaments (closed or open polylines). Biot–Savart for straight segments,
// Lorentz force / torque in an external field, flux through planar loops, partial-inductance estimate.
import { MU0, add, sub, scale, dot, cross, norm, unit, qRot, GL } from './vec.js';
import { cel } from './cylinder.js';

/** B (T) of a straight segment A->B carrying current I at point r (exact Biot–Savart). */
export function segmentB(A, B, I, r) {
  const Lx = B[0] - A[0], Ly = B[1] - A[1], Lz = B[2] - A[2];
  const L = Math.hypot(Lx, Ly, Lz); if (L < 1e-15) return [0, 0, 0];
  const ex = Lx / L, ey = Ly / L, ez = Lz / L;
  const ax = r[0] - A[0], ay = r[1] - A[1], az = r[2] - A[2];
  const bx = r[0] - B[0], by = r[1] - B[1], bz = r[2] - B[2];
  const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
  if (la < 1e-15 || lb < 1e-15) return [0, 0, 0];
  // e x a
  const cx = ey * az - ez * ay, cy = ez * ax - ex * az, cz = ex * ay - ey * ax;
  const d2 = cx * cx + cy * cy + cz * cz; if (d2 < 1e-30) return [0, 0, 0];
  const cosA = (ex * ax + ey * ay + ez * az) / la, cosB = (ex * bx + ey * by + ez * bz) / lb;
  const k = MU0 * I / (4 * Math.PI) * (cosA - cosB) / d2;
  return [cx * k, cy * k, cz * k];
}

/** B of a filament polyline (array of points; closed if `closed`). */
export function polylineB(pts, I, r, closed = true) {
  let bx = 0, by = 0, bz = 0; const n = pts.length;
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) { const b = segmentB(pts[i], pts[(i + 1) % n], I, r); bx += b[0]; by += b[1]; bz += b[2]; }
  return [bx, by, bz];
}

/** Coil model: { filaments:[{pts, closed, w}], turns N, geometry for R/L, ... }.  w = fraction of turns represented. */

/** Lorentz force & torque (about origin O) on a coil carrying current I in field function Bfun(r)->[Bx,By,Bz]. */
export function coilForceTorque(coil, I, Bfun, O = [0, 0, 0], gauss = 3) {
  let F = [0, 0, 0], T = [0, 0, 0];
  const g = GL[gauss];
  for (const fil of coil.filaments) {
    const cur = I * coil.turns * fil.w; const pts = fil.pts, n = pts.length, m = fil.closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const A = pts[i], B = pts[(i + 1) % n]; const dl = sub(B, A);
      for (let k = 0; k < g.x.length; k++) {
        const t = 0.5 * (g.x[k] + 1), w = 0.5 * g.w[k];
        const r = [A[0] + dl[0] * t, A[1] + dl[1] * t, A[2] + dl[2] * t];
        const Bv = Bfun(r);
        const dF = scale(cross(dl, Bv), cur * w);
        F = add(F, dF); T = add(T, cross(sub(r, O), dF));
      }
    }
  }
  return { F, T };
}

/** Flux (Wb) of field Bfun through a planar closed polygon (fan triangulation, 3-pt Gauss per sub-triangle). */
export function polygonFlux(pts, Bfun, nsub = 2) {
  const v0 = pts[0]; let flux = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const v1 = pts[i], v2 = pts[i + 1];
    const nvec = cross(sub(v1, v0), sub(v2, v0)); const area2 = norm(nvec); if (area2 < 1e-30) continue;
    const nh = scale(nvec, 1 / area2);
    const N = nsub; const p = (u, v) => add(add(scale(v0, 1 - u - v), scale(v1, u)), scale(v2, v));
    const dA = area2 / 2 / (N * N);
    for (let a = 0; a < N; a++) for (let b = 0; b < N - a; b++) {
      const u0 = a / N, w0 = b / N, du = 1 / N;
      flux += dot(Bfun(p(u0 + du / 3, w0 + du / 3)), nh) * dA;
      if (b < N - a - 1) flux += dot(Bfun(p(u0 + 2 * du / 3, w0 + 2 * du / 3)), nh) * dA;
    }
  }
  return flux;
}

/** Flux linkage (Wb·turns) of the whole coil (sum over filaments, weighted). */
export function coilFluxLinkage(coil, Bfun) {
  let s = 0;
  for (const fil of coil.filaments) if (fil.closed) s += coil.turns * fil.w * polygonFlux(fil.pts, Bfun);
  return s;
}

// ---------- geometry generators (local frame; coil axis = +z) ----------
function circlePts(r, z, nseg, phase = 0) {
  const pts = []; for (let i = 0; i < nseg; i++) { const a = phase + 2 * Math.PI * i / nseg; pts.push([r * Math.cos(a), r * Math.sin(a), z]); } return pts;
}
/** Round coil, rectangular cross-section: inner radius ri, outer ro, axial from z0 to z1 (local). */
export function ringCoil(ri, ro, z0, z1, opts = {}) {
  const nr = opts.nr || 2, nz = opts.nz || 2, nseg = opts.nseg || 48;
  const filaments = [];
  for (let i = 0; i < nr; i++) for (let j = 0; j < nz; j++) {
    const r = ri + (ro - ri) * (i + 0.5) / nr, z = z0 + (z1 - z0) * (j + 0.5) / nz;
    filaments.push({ pts: circlePts(r, z, nseg), closed: true, w: 1 / (nr * nz) });
  }
  const meanTurn = Math.PI * (ri + ro);
  return { kind: 'ring', filaments, turns: opts.turns || 1, window: (ro - ri) * (z1 - z0), meanTurn, build: ro - ri, thick: z1 - z0, cell: { b: (ro - ri) / nr, t: (z1 - z0) / nz }, geom: { ri, ro, z0, z1 } };
}
/** Racetrack: straight length Ls along local x, end radius rIn (inner) .. rIn+build, thickness t (z), centred. */
export function racetrackCoil(Ls, rIn, build, t, opts = {}) {
  const nr = opts.nr || 2, nz = opts.nz || 2, narc = opts.narc || 16;
  const filaments = [];
  for (let i = 0; i < nr; i++) for (let j = 0; j < nz; j++) {
    const r = rIn + build * (i + 0.5) / nr, z = -t / 2 + t * (j + 0.5) / nz;
    const pts = [];
    for (let k = 0; k <= narc; k++) { const a = -Math.PI / 2 + Math.PI * k / narc; pts.push([Ls / 2 + r * Math.cos(a), r * Math.sin(a), z]); }
    for (let k = 0; k <= narc; k++) { const a = Math.PI / 2 + Math.PI * k / narc; pts.push([-Ls / 2 + r * Math.cos(a), r * Math.sin(a), z]); }
    filaments.push({ pts, closed: true, w: 1 / (nr * nz) });
  }
  const rm = rIn + build / 2; const meanTurn = 2 * Ls + 2 * Math.PI * rm;
  return { kind: 'racetrack', filaments, turns: opts.turns || 1, window: build * t, meanTurn, build, thick: t, cell: { b: build / nr, t: t / nz }, geom: { Ls, rIn, build, t } };
}
/** Sector (trapezoid) coil for axial-flux stators: between radii r1..r2, angular half-span `half` (rad) of the coil's
 *  outer boundary, conductor build `b` (radial/angular thickness of the bundle), axial thickness t. Centred on +x axis, lies in z-plane. */
export function sectorCoil(r1, r2, half, b, t, opts = {}) {
  const nb = opts.nb || 2, nz = opts.nz || 2, narc = opts.narc || 6;
  const filaments = [];
  for (let i = 0; i < nb; i++) for (let j = 0; j < nz; j++) {
    const off = b * (i + 0.5) / nb; // inset from the outer boundary
    const z = -t / 2 + t * (j + 0.5) / nz;
    const ri = r1 + off, ro = r2 - off;
    const hin = half - off / ((ri + ro) / 2); // angular inset at mean radius
    if (ro <= ri || hin <= 0) continue;
    const pts = [];
    for (let k = 0; k <= narc; k++) { const a = -hin + 2 * hin * k / narc; pts.push([ro * Math.cos(a), ro * Math.sin(a), z]); }
    for (let k = 0; k <= narc; k++) { const a = hin - 2 * hin * k / narc; pts.push([ri * Math.cos(a), ri * Math.sin(a), z]); }
    filaments.push({ pts, closed: true, w: 1 });
  }
  const wsum = filaments.length; filaments.forEach(f => f.w = 1 / wsum);
  const rm = (r1 + r2) / 2, hm = half - (b / 2) / rm;
  const meanTurn = 2 * (r2 - r1 - b) + 2 * hm * (r1 + b / 2) + 2 * hm * (r2 - b / 2);
  return { kind: 'sector', filaments, turns: opts.turns || 1, window: b * t, meanTurn, build: b, thick: t, cell: { b: b / nb, t: t / nz }, geom: { r1, r2, half, b, t } };
}
/** Saddle coil on a cylinder (for radial-flux slotless stators): inner radius rIn, radial build b, outer boundary half-angle `half`,
 *  straight (axial) length Lz, angular bundle width wAng (rad at mean radius). Centred on +x axis. */
export function saddleCoil(rIn, b, half, Lz, wAng, opts = {}) {
  const nb = opts.nb || 2, na = opts.na || 2, narc = opts.narc || 6, nz = opts.nzseg || 4;
  const filaments = [];
  for (let i = 0; i < nb; i++) for (let j = 0; j < na; j++) {
    const r = rIn + b * (i + 0.5) / nb; const hin = half - wAng * (j + 0.5) / na; if (hin <= 0) continue;
    const pts = [];
    for (let k = 0; k <= nz; k++) pts.push([r * Math.cos(-hin), r * Math.sin(-hin), -Lz / 2 + Lz * k / nz]);
    for (let k = 1; k <= narc; k++) { const a = -hin + 2 * hin * k / narc; pts.push([r * Math.cos(a), r * Math.sin(a), Lz / 2]); }
    for (let k = 1; k <= nz; k++) pts.push([r * Math.cos(hin), r * Math.sin(hin), Lz / 2 - Lz * k / nz]);
    for (let k = 1; k < narc; k++) { const a = hin - 2 * hin * k / narc; pts.push([r * Math.cos(a), r * Math.sin(a), -Lz / 2]); }
    filaments.push({ pts, closed: true, w: 1 });
  }
  filaments.forEach(f => f.w = 1 / filaments.length);
  const rm = rIn + b / 2, hm = half - wAng / 2; const meanTurn = 2 * Lz + 2 * (2 * hm) * rm;
  return { kind: 'saddle', filaments, turns: opts.turns || 1, window: b * wAng * rm, meanTurn, build: b, thick: wAng * rm, cell: { b: b / nb, t: wAng * rm / na }, geom: { rIn, b, half, Lz, wAng } };
}
/** Flat Archimedean spiral (pancake) from ri to ro with N turns, one filament, open. Thickness t ignored for field (thin). */
export function spiralCoil(ri, ro, N, opts = {}) {
  const per = opts.per || 24; const pts = []; const n = Math.max(8, Math.round(N * per));
  for (let i = 0; i <= n; i++) { const a = 2 * Math.PI * N * i / n; const r = ri + (ro - ri) * i / n; pts.push([r * Math.cos(a), r * Math.sin(a), 0]); }
  const meanTurn = Math.PI * (ri + ro);
  return { kind: 'spiral', filaments: [{ pts, closed: false, w: 1 }], turns: 1, window: (ro - ri) * (opts.t || 0.001), meanTurn, build: ro - ri, thick: opts.t || 0.001, geom: { ri, ro, N } };
}
/** Transform a coil's filaments into world frame {q,p}. */
export function placeCoil(coil, frame) {
  const filaments = coil.filaments.map(f => ({ ...f, pts: f.pts.map(v => add(qRot(frame.q, v), frame.p)) }));
  return { ...coil, filaments, frame };
}
export function mirrorCoil(coil, p0, n) {
  const nn = unit(n);
  const mv = v => { const d = dot(sub(v, p0), nn); return sub(v, scale(nn, 2 * d)); };
  return { ...coil, filaments: coil.filaments.map(f => ({ ...f, pts: f.pts.map(mv) })), image: true };
}

// ---------- winding, resistance, inductance ----------
export const COND = { cu: { rho20: 1.72e-8, alpha: 0.00393, dens: 8960, name: 'медь' }, al: { rho20: 2.82e-8, alpha: 0.0039, dens: 2700, name: 'алюминий' } };
export function resistivity(cond, T) { const m = COND[cond]; return m.rho20 * (1 + m.alpha * (T - 20)); }
/** Winding numbers for a coil window filled with wire of diameter d (bare copper) at fill factor kf. */
export function winding(coil, { cond = 'cu', T = 80, kf = 0.75, wire = 0.2e-3 }) {
  const Aw = Math.PI * wire * wire / 4; const N = Math.max(1, Math.floor(kf * coil.window / Aw));
  const rho = resistivity(cond, T); const len = N * coil.meanTurn; const R = rho * len / Aw;
  const mass = COND[cond].dens * len * Aw;
  return { N, R, len, mass, rho, Aw };
}
/** Km factor: force per ampere-turn f1 -> Km = f1 * sqrt(kf*window/(rho*meanTurn)). */
export function kmFromPerAmpTurn(f1, coil, { cond = 'cu', T = 80, kf = 0.75 }) {
  const rho = resistivity(cond, T); return f1 * Math.sqrt(kf * coil.window / (rho * coil.meanTurn));
}
/** Inductance (H) of the coil with N turns.
 *  Ring coils: exact Maxwell coaxial-loop mutual inductances; self of a filament = M(a,a,GMD of its bundle cell) (Grover).
 *  Other closed planar filaments: Neumann double integral with Gauss points and automatic sub-segmentation;
 *  self = Neumann with a copy shifted by the GMD along the loop normal. Open filaments: Rosa partial inductance. */
export function coilInductance(coil, N) {
  const cell = coil.cell || { b: coil.build, t: coil.thick };
  const gmd = 0.2235 * (cell.b + cell.t) || 1e-4;
  const fils = coil.filaments; let Lsum = 0;
  if (coil.kind === 'ring') {
    const geo = fils.map(f => { const c = f.pts.reduce((s, p) => add(s, p), [0, 0, 0]).map(v => v / f.pts.length); return { a: norm(sub(f.pts[0], c)), z: c[2], c }; });
    for (let i = 0; i < fils.length; i++) for (let j = 0; j < fils.length; j++) {
      const d = i === j ? gmd : Math.hypot(geo[i].z - geo[j].z, 0);
      Lsum += fils[i].w * fils[j].w * coaxialMutual(geo[i].a, geo[j].a, i === j ? gmd : Math.abs(geo[i].z - geo[j].z));
      void d;
    }
    return N * N * Lsum;
  }
  for (let i = 0; i < fils.length; i++) for (let j = 0; j < fils.length; j++) {
    const wi = fils[i].w, wj = fils[j].w;
    if (!fils[i].closed || !fils[j].closed) { Lsum += wi * wj * (i === j ? selfRosa(fils[i].pts, gmd, fils[i].closed) : neumannGauss(fils[i].pts, fils[j].pts, fils[i].closed, fils[j].closed, gmd)); continue; }
    if (i === j) { const nrm = polyNormal(fils[i].pts); const shifted = fils[i].pts.map(p => add(p, scale(nrm, gmd))); Lsum += wi * wj * neumannGauss(fils[i].pts, shifted, true, true, gmd); }
    else Lsum += wi * wj * neumannGauss(fils[i].pts, fils[j].pts, true, true, Math.max(gmd, minDist(fils[i].pts, fils[j].pts)));
  }
  return N * N * Lsum;
}
/** Mutual inductance of coaxial circular loops radii a,b separated axially by d (Maxwell). */
export function coaxialMutual(a, b, d) {
  const k2 = 4 * a * b / ((a + b) ** 2 + d * d); const k = Math.sqrt(k2), kc = Math.sqrt(Math.max(1e-300, 1 - k2));
  const K = cel(kc, 1, 1, 1), E = cel(kc, 1, 1, kc * kc);
  return MU0 * Math.sqrt(a * b) * ((2 / k - k) * K - (2 / k) * E);
}
function minDist(p1, p2) { let m = Infinity; for (let i = 0; i < p1.length; i += 3) for (let j = 0; j < p2.length; j += 3) { const d = norm(sub(p1[i], p2[j])); if (d < m) m = d; } return m; }
function polyNormal(pts) { let nx = 0, ny = 0, nz = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); } return unit([nx, ny, nz]); }
function neumannGauss(p1, p2, c1, c2, sep, g = 3) {
  const G = GL[g];
  const segs = (p, c) => { const out = []; const n = p.length, m = c ? n : n - 1; for (let i = 0; i < m; i++) { const A = p[i], B = p[(i + 1) % n]; const d = sub(B, A); const L = norm(d); const k = Math.max(1, Math.min(64, Math.ceil(L / (0.5 * sep)))); for (let s = 0; s < k; s++) out.push({ A: add(A, scale(d, s / k)), d: scale(d, 1 / k) }); } return out; };
  const s1 = segs(p1, c1), s2 = segs(p2, c2); let s = 0;
  for (const a of s1) for (const b of s2) {
    const dd = dot(a.d, b.d); if (Math.abs(dd) < 1e-30) continue; let acc = 0;
    for (let i = 0; i < G.x.length; i++) { const ta = 0.5 * (G.x[i] + 1), wa = 0.5 * G.w[i]; const pa = add(a.A, scale(a.d, ta));
      for (let j = 0; j < G.x.length; j++) { const tb = 0.5 * (G.x[j] + 1), wb = 0.5 * G.w[j]; const pb = add(b.A, scale(b.d, tb)); const r = norm(sub(pa, pb)); acc += wa * wb / Math.max(r, 1e-12); } }
    s += dd * acc;
  }
  return MU0 / (4 * Math.PI) * s;
}
function selfRosa(p, a, closed) {
  let s = 0; const n = p.length, m = closed ? n : n - 1;
  const segs = []; for (let i = 0; i < m; i++) segs.push({ A: p[i], B: p[(i + 1) % n] });
  for (let i = 0; i < m; i++) { const d = sub(segs[i].B, segs[i].A), l = norm(d); if (l < 1e-15) continue;
    s += MU0 / (2 * Math.PI) * l * (Math.log(2 * l / a) - 0.75);
    const c = scale(add(segs[i].A, segs[i].B), 0.5);
    for (let j = 0; j < m; j++) { if (i === j) continue; const d2 = sub(segs[j].B, segs[j].A); const e = scale(add(segs[j].A, segs[j].B), 0.5);
      const r = Math.max(norm(sub(c, e)), a); s += MU0 / (4 * Math.PI) * dot(d, d2) / r; } }
  return s;
}
