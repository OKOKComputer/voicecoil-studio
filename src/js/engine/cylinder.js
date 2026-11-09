// Exact field of an axially magnetized cylinder / ring (Derby & Olbert 2010, Am. J. Phys. 78, 229)
// via Bulirsch's general complete elliptic integral cel(kc,p,a,b).
import { MU0 } from './vec.js';

export function cel(kc, p, c, s) {
  if (kc === 0) return NaN;
  const errtol = 1e-8; let k = Math.abs(kc), pp = p, cc = c, ss = s, em = 1, f, q, g, kk;
  if (p > 0) { pp = Math.sqrt(p); ss = s / pp; }
  else { f = kc * kc; q = 1 - f; g = 1 - pp; f = f - pp; q = q * (ss - c * pp); pp = Math.sqrt(f / g); cc = (c - ss) / g; ss = -q / (g * g * pp) + cc * pp; }
  f = cc; cc = cc + ss / pp; g = k / pp; ss = 2 * (ss + f * g); pp = g + pp; g = em; em = k + em; kk = k;
  let it = 0;
  while (Math.abs(g - k) > g * errtol && it++ < 60) { k = 2 * Math.sqrt(kk); kk = k * em; f = cc; cc = cc + ss / pp; g = kk / pp; ss = 2 * (ss + f * g); pp = g + pp; g = em; em = k + em; }
  return (Math.PI / 2) * (ss + cc * em) / (em * (em + pp));
}

/**
 * B field (tesla) of a solid cylinder, radius a, half-height b, remanence Br (axial, +z),
 * centred at origin, at cylindrical point (rho, z). Returns [Brho, Bz]. Valid inside and outside.
 */
export function cylinderBrz(a, b, Br, rho, z) {
  if (rho < 1e-12 * a) rho = 1e-12 * a;
  if (Math.abs(rho - a) < 1e-9 * a) rho = a * (1 + 1e-9);
  const B0 = Br / Math.PI;
  const zp = z + b, zm = z - b, s2 = (rho + a) * (rho + a), d2 = (a - rho) * (a - rho);
  const rp = Math.sqrt(zp * zp + s2), rm = Math.sqrt(zm * zm + s2);
  const ap = a / rp, am = a / rm, bp = zp / rp, bm = zm / rm;
  const g = (a - rho) / (a + rho);
  const kp = Math.sqrt((zp * zp + d2) / (zp * zp + s2)), km = Math.sqrt((zm * zm + d2) / (zm * zm + s2));
  const Brho = B0 * (ap * cel(kp, 1, 1, -1) - am * cel(km, 1, 1, -1));
  const Bz = (B0 * a / (a + rho)) * (bp * cel(kp, g * g, 1, g) - bm * cel(km, g * g, 1, g));
  return [Brho, Bz];
}

/** Ring magnet (outer radius Ro, inner Ri, half-height b) = outer cylinder minus inner cylinder. */
export function ringBrz(Ro, Ri, b, Br, rho, z) {
  const o = cylinderBrz(Ro, b, Br, rho, z);
  if (Ri <= 0) return o;
  const i = cylinderBrz(Ri, b, Br, rho, z);
  return [o[0] - i[0], o[1] - i[1]];
}

/** Field of a thin circular current loop, radius a at z=0, current I (A), at (rho,z). [Brho,Bz]. */
export function loopBrz(a, I, rho, z) {
  if (rho < 1e-12 * a) rho = 1e-12 * a;
  const s2 = (rho + a) * (rho + a), d2 = (a - rho) * (a - rho);
  const r2 = z * z + s2, kc2 = (z * z + d2) / r2, kc = Math.sqrt(kc2);
  const pref = MU0 * I / (2 * Math.PI * Math.sqrt(r2));
  // Using Derby-Olbert style expressions: Bz = pref * cel(kc, g^2,1,g) * ... (we use the standard K,E form instead)
  const k2 = 1 - kc2;
  const K = cel(kc, 1, 1, 1), E = cel(kc, 1, 1, kc2);
  const Bz = pref * (K + (a * a - rho * rho - z * z) / (d2 + z * z) * E);
  const Brho = (Math.abs(rho) < 1e-15) ? 0 : pref * (z / rho) * (-K + (a * a + rho * rho + z * z) / (d2 + z * z) * E);
  void k2;
  return [Brho, Bz];
}
