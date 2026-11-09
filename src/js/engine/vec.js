// Small 3-vector / quaternion helpers. Vectors are plain arrays [x,y,z]. SI units everywhere.
export const MU0 = 4e-7 * Math.PI;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = a => Math.hypot(a[0], a[1], a[2]);
export const unit = a => { const n = norm(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Quaternions as [w,x,y,z]
export const QI = [1, 0, 0, 0];
export function qAxisAngle(axis, ang) {
  const u = unit(axis), s = Math.sin(ang / 2);
  return [Math.cos(ang / 2), u[0] * s, u[1] * s, u[2] * s];
}
export function qMul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
}
export const qConj = q => [q[0], -q[1], -q[2], -q[3]];
export function qNormalize(q) { const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]; }
// rotate vector v by quaternion q
export function qRot(q, v) {
  const [w, x, y, z] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
// quaternion that rotates +z onto direction d
export function qFromZTo(d) {
  const u = unit(d); const c = u[2];
  if (c > 1 - 1e-12) return [1, 0, 0, 0];
  if (c < -1 + 1e-12) return [0, 1, 0, 0]; // 180° about x
  const ax = cross([0, 0, 1], u); return qAxisAngle(ax, Math.acos(c));
}
// Euler ZYX (yaw-pitch-roll) in radians -> quaternion
export function qEuler(rx, ry, rz) {
  return qNormalize(qMul(qAxisAngle([0, 0, 1], rz), qMul(qAxisAngle([0, 1, 0], ry), qAxisAngle([1, 0, 0], rx))));
}
export function toLocal(frame, r) { return qRot(qConj(frame.q), sub(r, frame.p)); }
export function toWorld(frame, r) { return add(qRot(frame.q, r), frame.p); }
export function dirToWorld(frame, v) { return qRot(frame.q, v); }
export function dirToLocal(frame, v) { return qRot(qConj(frame.q), v); }

// Gauss-Legendre nodes/weights on [-1,1]
export const GL = {
  1: { x: [0], w: [2] },
  2: { x: [-0.5773502691896257, 0.5773502691896257], w: [1, 1] },
  3: { x: [-0.7745966692414834, 0, 0.7745966692414834], w: [5 / 9, 8 / 9, 5 / 9] },
  4: { x: [-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526], w: [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538] },
};
