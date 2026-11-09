// Uniformly magnetized polyhedra via the magnetic-charge model.
// Each planar face carries sigma = M·n (A/m). The field of a uniformly charged planar polygon is closed-form:
//   H(r) = (sigma/4pi) [ -Omega(r) n  +  sum_edges m_e * ln((Ra+Rb+L)/(Ra+Rb-L)) ]
// where Omega is the signed solid angle (Van Oosterom & Strackee) and m_e = e_hat x n is the outward in-plane edge normal.
// B = mu0 (H + M inside).  Exact for polyhedra; curved magnets are faceted.
import { MU0, add, sub, scale, dot, cross, norm, unit, qRot } from './vec.js';

export function makePoly(verts, faces, M, meta = {}) {
  const fd = [];
  for (const f of faces) {
    // Newell normal
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < f.length; i++) {
      const a = verts[f[i]], b = verts[f[(i + 1) % f.length]];
      nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const area2 = Math.hypot(nx, ny, nz); if (area2 < 1e-30) continue;
    const n = [nx / area2, ny / area2, nz / area2];
    const sigma = dot(M, n);
    const edges = [];
    for (let i = 0; i < f.length; i++) {
      const A = verts[f[i]], B = verts[f[(i + 1) % f.length]]; const d = sub(B, A); const L = norm(d);
      if (L < 1e-15) continue;
      const e = scale(d, 1 / L); const m = cross(e, n);
      edges.push({ A, B, L, m });
    }
    const c = f.reduce((s, i) => add(s, verts[i]), [0, 0, 0]).map(v => v / f.length);
    fd.push({ idx: f, n, sigma, edges, c, area: area2 / 2 });
  }
  return { verts, faces, M, fd, meta };
}

// signed solid angle of polygon (vertex list in verts order) seen from r; positive when r is on the side the normal points to
function solidAngle(verts, idx, r) {
  const n = idx.length; const v0 = verts[idx[0]];
  const a = [v0[0] - r[0], v0[1] - r[1], v0[2] - r[2]]; const la = Math.hypot(a[0], a[1], a[2]);
  let om = 0;
  for (let i = 1; i < n - 1; i++) {
    const v1 = verts[idx[i]], v2 = verts[idx[i + 1]];
    const b = [v1[0] - r[0], v1[1] - r[1], v1[2] - r[2]], c = [v2[0] - r[0], v2[1] - r[1], v2[2] - r[2]];
    const lb = Math.hypot(b[0], b[1], b[2]), lc = Math.hypot(c[0], c[1], c[2]);
    const num = a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    const den = la * lb * lc + (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) * lc + (b[0] * c[0] + b[1] * c[1] + b[2] * c[2]) * la + (c[0] * a[0] + c[1] * a[1] + c[2] * a[2]) * lb;
    om += 2 * Math.atan2(num, den);
  }
  return -om; // VOS gives negative for an observer on the +n side of a CCW polygon; flip so that +n side is positive
}

/** H field (A/m) of the polyhedron at r. If wantInside, also returns whether r is inside (via total solid angle). */
export function polyH(poly, r, wantInside = false) {
  let hx = 0, hy = 0, hz = 0, omTot = 0;
  const verts = poly.verts;
  for (const f of poly.fd) {
    const charged = Math.abs(f.sigma) > 1e-9;
    if (!charged && !wantInside) continue;
    const om = solidAngle(verts, f.idx, r);
    omTot += om;
    if (!charged) continue;
    let ex = 0, ey = 0, ez = 0;
    for (const e of f.edges) {
      const ra = Math.hypot(r[0] - e.A[0], r[1] - e.A[1], r[2] - e.A[2]);
      const rb = Math.hypot(r[0] - e.B[0], r[1] - e.B[1], r[2] - e.B[2]);
      let den = ra + rb - e.L; if (den < 1e-12 * e.L) den = 1e-12 * e.L;
      const lg = Math.log((ra + rb + e.L) / den);
      ex += e.m[0] * lg; ey += e.m[1] * lg; ez += e.m[2] * lg;
    }
    const s = f.sigma / (4 * Math.PI);
    hx += s * (om * f.n[0] + ex); hy += s * (om * f.n[1] + ey); hz += s * (om * f.n[2] + ez);
  }
  const H = [hx, hy, hz];
  if (wantInside) return { H, inside: Math.abs(omTot) > 2 * Math.PI };
  return { H };
}

/** B field (T) at r. Handles inside (adds mu0 M). */
export function polyB(poly, r, checkInside = true) {
  const { H, inside } = polyH(poly, r, checkInside);
  if (inside) return [MU0 * (H[0] + poly.M[0]), MU0 * (H[1] + poly.M[1]), MU0 * (H[2] + poly.M[2])];
  return [MU0 * H[0], MU0 * H[1], MU0 * H[2]];
}

// ---------- builders (local frame, centred at origin) ----------
export function cuboidGeom(lx, ly, lz) {
  const x = lx / 2, y = ly / 2, z = lz / 2;
  const v = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]];
  const f = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return { verts: v, faces: f };
}

/** Faceted annular sector: radii Ri<Ro, height h, angles phi0..phi1 (rad), n facets along the arc. Ri=0 gives a wedge. */
export function arcGeom(Ri, Ro, h, phi0, phi1, n) {
  const verts = [], faces = [];
  const zb = -h / 2, zt = h / 2; const inner = Ri > 1e-12;
  const bo = [], to = [], bi = [], ti = [];
  for (let i = 0; i <= n; i++) {
    const ph = phi0 + (phi1 - phi0) * i / n, c = Math.cos(ph), s = Math.sin(ph);
    bo.push(verts.push([Ro * c, Ro * s, zb]) - 1); to.push(verts.push([Ro * c, Ro * s, zt]) - 1);
    if (inner) { bi.push(verts.push([Ri * c, Ri * s, zb]) - 1); ti.push(verts.push([Ri * c, Ri * s, zt]) - 1); }
  }
  let axB = -1, axT = -1;
  if (!inner) { axB = verts.push([0, 0, zb]) - 1; axT = verts.push([0, 0, zt]) - 1; }
  for (let i = 0; i < n; i++) {
    faces.push([bo[i], bo[i + 1], to[i + 1], to[i]]); // outer side
    if (inner) {
      faces.push([bi[i], ti[i], ti[i + 1], bi[i + 1]]); // inner side
      faces.push([to[i], to[i + 1], ti[i + 1], ti[i]]); // top
      faces.push([bo[i + 1], bo[i], bi[i], bi[i + 1]]); // bottom
    } else {
      faces.push([to[i], to[i + 1], axT]);
      faces.push([bo[i + 1], bo[i], axB]);
    }
  }
  const full = Math.abs((phi1 - phi0) - 2 * Math.PI) < 1e-9;
  if (!full) {
    if (inner) { faces.push([bi[0], bo[0], to[0], ti[0]]); faces.push([bo[n], bi[n], ti[n], to[n]]); }
    else { faces.push([axB, bo[0], to[0], axT]); faces.push([bo[n], axB, axT, to[n]]); }
  }
  return { verts, faces };
}

/** Faceted cylinder / ring (full 360°). */
export function prismGeom(Ro, Ri, h, n) { return arcGeom(Ri, Ro, h, 0, 2 * Math.PI, n); }

/** Regular polygon prism for a sphere-ish display mesh is not needed; spheres are analytic (see scene.js). */

export function transformGeom(geom, q, p) {
  return { verts: geom.verts.map(v => add(qRot(q, v), p)), faces: geom.faces };
}

/** Mirror a polyhedron magnet in a plane (point p0, unit normal n). Returns the image magnet for an ideal (mu->inf) plate. */
export function mirrorPoly(poly, p0, n) {
  const nn = unit(n);
  const mv = v => { const d = dot(sub(v, p0), nn); return sub(v, scale(nn, 2 * d)); };
  const verts = poly.verts.map(mv);
  const faces = poly.faces.map(f => [...f].reverse());
  const Mn = dot(poly.M, nn); const M = sub(scale(nn, 2 * Mn), poly.M); // keep normal component, flip tangential
  return makePoly(verts, faces, M, { ...poly.meta, image: true });
}
export function mirrorPoint(v, p0, n) { const nn = unit(n); const d = dot(sub(v, p0), nn); return sub(v, scale(nn, 2 * d)); }

/** Quadrature points on charged faces for force/torque via charge method: returns [{r, w: sigma*dA}] */
export function faceChargeSamples(poly, nsub = 4) {
  const out = [];
  for (const f of poly.fd) {
    if (Math.abs(f.sigma) < 1e-9) continue;
    const idx = f.idx, v0 = poly.verts[idx[0]];
    for (let i = 1; i < idx.length - 1; i++) {
      const v1 = poly.verts[idx[i]], v2 = poly.verts[idx[i + 1]];
      const area = norm(cross(sub(v1, v0), sub(v2, v0))) / 2; if (area < 1e-30) continue;
      // subdivide triangle into nsub^2 sub-triangles, centroid rule
      const N = nsub;
      for (let a = 0; a < N; a++) for (let b = 0; b < N - a; b++) {
        // two sub-triangles per cell except on the diagonal
        const p = (u, v) => add(add(scale(v0, 1 - u - v), scale(v1, u)), scale(v2, v));
        const u0 = a / N, v0b = b / N, du = 1 / N;
        const c1 = p(u0 + du / 3, v0b + du / 3); out.push({ r: c1, w: f.sigma * area / (N * N) });
        if (b < N - a - 1) { const c2 = p(u0 + 2 * du / 3, v0b + 2 * du / 3); out.push({ r: c2, w: f.sigma * area / (N * N) }); }
      }
    }
  }
  return out;
}
