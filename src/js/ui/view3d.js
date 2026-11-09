// Three.js view of engine objects (SI) — rendered in mm.
import * as THREE from '../vendor/three.module.min.js';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { cssVar, cmap, cmapDiv } from './common.js';
import { placeCoil } from '../engine/coils.js';

const S = 1000; // m -> mm
function hex(c) { const v = c.trim(); return v.startsWith('#') ? v : '#888888'; }

export class View3D {
  constructor(container, opts = {}) {
    this.c = container; this.opts = opts;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    container.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 5000); this.camera.up.set(0, 0, 1);
    this.camera.position.set(60, -80, 50);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true; this.controls.dampingFactor = 0.12;
    this.controls.addEventListener('change', () => this.requestRender());
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.1));
    const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(80, -60, 120); this.scene.add(dl);
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.5); dl2.position.set(-60, 80, -40); this.scene.add(dl2);
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.sliceMesh = null; this.axes = new THREE.AxesHelper(8); this.scene.add(this.axes);
    this.tools = document.createElement('div'); this.tools.className = 'tools'; container.append(this.tools);
    const fitBtn = document.createElement('button'); fitBtn.textContent = '⌖ вписать'; fitBtn.onclick = () => this.fit(); this.tools.append(fitBtn);
    this.legend = document.createElement('div'); this.legend.className = 'legend'; container.append(this.legend);
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(container);
    this._raf = 0; this.resize(); this.animate = this.animate.bind(this); this.animate();
    this.mq = window.matchMedia('(prefers-color-scheme: dark)'); this.mq.addEventListener?.('change', () => this.requestRender());
  }
  resize() { const w = this.c.clientWidth || 300, h = this.c.clientHeight || 240; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.requestRender(); }
  requestRender() { this._dirty = true; }
  animate() { requestAnimationFrame(this.animate); const moved = this.controls.update(); if (this._dirty || moved) { this._dirty = false; this.renderer.setClearColor(new THREE.Color(hex(cssVar('--paper'))), 1); this.renderer.render(this.scene, this.camera); } }
  clear() { while (this.group.children.length) { const o = this.group.children.pop(); o.traverse?.(x => { x.geometry?.dispose?.(); if (x.material) [].concat(x.material).forEach(m => m.map?.dispose?.() || m.dispose?.()); }); } }
  setObjects(objs, { fit = false } = {}) {
    this.clear(); let nm = 0, nc = 0, np = 0; const bbox = new THREE.Box3();
    const magMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex(cssVar('--graphite'))), metalness: 0.35, roughness: 0.55, transparent: true, opacity: 0.92 });
    const ballMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex(cssVar('--steel'))), metalness: 0.1, roughness: 0.6, transparent: true, opacity: 0.22, depthWrite: false });
    const imgMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex(cssVar('--iron'))), metalness: 0.5, roughness: 0.5, transparent: true, opacity: 0.85 });
    const coilMat = new THREE.LineBasicMaterial({ color: new THREE.Color(hex(cssVar('--copper'))), transparent: true, opacity: 0.9 });
    const coilMatNeg = new THREE.LineBasicMaterial({ color: new THREE.Color(hex(cssVar('--steel'))), transparent: true, opacity: 0.9 });
    for (const o of objs) {
      if (o.hidden) continue;
      const fr = o.frame || { q: [1, 0, 0, 0], p: [0, 0, 0] }; const q = new THREE.Quaternion(fr.q[1], fr.q[2], fr.q[3], fr.q[0]); const p = new THREE.Vector3(fr.p[0] * S, fr.p[1] * S, fr.p[2] * S);
      if (o.kind === 'magnet') {
        const g = magnetGeometry(o); if (!g) continue; const mesh = new THREE.Mesh(g, magMat); mesh.quaternion.copy(q); mesh.position.copy(p); this.group.add(mesh); nm++;
        // magnetization arrow
        const d = o.dims; const size = o.shape === 'block' ? Math.max(d.lx, d.ly, d.lz) : o.shape === 'arc' ? Math.min(d.Ro - d.Ri, d.L) * 1.6 : (d.L || d.D) * 1.0;
        const mdirLocal = o.shape === 'cyl' || o.shape === 'ring' ? [0, 0, 1] : (o.mag === 'axial' || !o.mdir ? [0, 0, (o.sign || 1)] : o.mdir.map(x => x * (o.sign || 1)));
        if (o.shape === 'arc' && o.mag === 'radial') { const a0 = 0; mdirLocal[0] = Math.cos(a0) * (o.sign || 1); mdirLocal[1] = Math.sin(a0) * (o.sign || 1); mdirLocal[2] = 0; }
        const dirW = new THREE.Vector3(...mdirLocal).normalize().applyQuaternion(q);
        let center = p.clone(); if (o.shape === 'arc') { const rm = (d.Ri + d.Ro) / 2 * S; center = p.clone().add(new THREE.Vector3(rm, 0, 0).applyQuaternion(q)); }
        const len = Math.max(1.5, size * S * 0.9); const arrow = new THREE.ArrowHelper(dirW, center.clone().addScaledVector(dirW, -len / 2), len, 0xd84343, len * 0.35, len * 0.2); arrow.line.material.depthTest = false; arrow.cone.material.depthTest = false; arrow.line.material.transparent = true; arrow.cone.material.transparent = true; arrow.line.material.opacity = 0.85; arrow.cone.material.opacity = 0.85; arrow.renderOrder = 10; arrow.line.renderOrder = 10; arrow.cone.renderOrder = 10; this.group.add(arrow);
        bbox.expandByObject(mesh);
      } else if (o.kind === 'coil') {
        const placed = placeCoil(o.coil, fr); const mat = (o.I || 1) >= 0 ? coilMat : coilMatNeg;
        for (const f of placed.filaments) { const pts = f.pts.map(v => new THREE.Vector3(v[0] * S, v[1] * S, v[2] * S)); if (f.closed) pts.push(pts[0].clone()); const geo = new THREE.BufferGeometry().setFromPoints(pts); const line = new THREE.Line(geo, mat); this.group.add(line); bbox.expandByObject(line); }
        nc++;
      } else if (o.kind === 'plate') {
        const sz = (o.size || 0.04) * S; const g = new THREE.BoxGeometry(sz, sz, 0.8); g.translate(0, 0, -0.4); const mesh = new THREE.Mesh(g, imgMat); mesh.quaternion.copy(q); mesh.position.copy(p); this.group.add(mesh); np++; bbox.expandByObject(mesh);
      } else if (o.kind === 'ballviz') {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(o.R * S, 40, 28), ballMat); mesh.position.copy(p); this.group.add(mesh); bbox.expandByObject(mesh);
      } else if (o.kind === 'steelviz' && o.cup) {
        // pot: bottom disc + outer wall + top plate ring (approx viz)
        const cu = o.cup; const rp = cu.rp * S, Ro = cu.Rout * S, Lm = cu.Lm * S, t = cu.t * S, g = cu.g * S;
        const zt = t / 2, zm1 = -t / 2, zm0 = zm1 - Lm, zb = zm0 - t;
        const parts = [ringGeo(0, Ro, zb, zm0), ringGeo(rp + g, Ro, zm0, zt), ringGeo(0, rp, zm1, zt)];
        for (const gg of parts) { const m = new THREE.Mesh(gg, imgMat); this.group.add(m); bbox.expandByObject(m); } np++;
      }
    }
    this.legend.textContent = `${nm} магн. · ${nc} кат.` + (np ? ` · сталь ${np}` : '') + ' · мм';
    this.bbox = bbox; if (fit || !this._fitted) this.fit(); this.requestRender();
  }
  fit() {
    const b = this.bbox; if (!b || b.isEmpty()) return; const c = b.getCenter(new THREE.Vector3()); const r = Math.max(3, b.getSize(new THREE.Vector3()).length() / 2);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize(); if (!isFinite(dir.x) || dir.length() < 0.5) dir.set(0.6, -0.8, 0.5).normalize();
    const dist = r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.05;
    this.controls.target.copy(c); this.camera.position.copy(c).addScaledVector(dir, dist); this.camera.near = dist / 100; this.camera.far = dist * 20; this.camera.updateProjectionMatrix(); this.controls.update(); this._fitted = true; this.axes.scale.setScalar(r * 0.25 / 8); this.requestRender();
  }
  /** slice: {data,nu,nv,bmax,comp}; plane: {o,u,v,hu,hv} in SI */
  setSlice(slice, plane) {
    this.clearSlice(); if (!slice) return;
    const { data, nu, nv, bmax, comp } = slice; const tex = new Uint8Array(nu * nv * 4);
    for (let i = 0; i < nu * nv; i++) { const v = data[i]; let rgb; if (comp === 'mag') rgb = cmap(Math.sqrt(Math.min(1, v / (bmax || 1)))); else { const t = v / (bmax || 1); rgb = cmapDiv(Math.sign(t) * Math.sqrt(Math.abs(t))); } tex[i * 4] = rgb[0]; tex[i * 4 + 1] = rgb[1]; tex[i * 4 + 2] = rgb[2]; tex[i * 4 + 3] = 235; }
    const dt = new THREE.DataTexture(tex, nu, nv, THREE.RGBAFormat); dt.needsUpdate = true; dt.magFilter = THREE.LinearFilter; dt.minFilter = THREE.LinearFilter; dt.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(2 * plane.hu * S, 2 * plane.hv * S); const mat = new THREE.MeshBasicMaterial({ map: dt, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    const u = new THREE.Vector3(...plane.u).normalize(), v = new THREE.Vector3(...plane.v).normalize(), n = new THREE.Vector3().crossVectors(u, v);
    const m = new THREE.Matrix4().makeBasis(u, v, n); mesh.quaternion.setFromRotationMatrix(m); mesh.position.set(plane.o[0] * S, plane.o[1] * S, plane.o[2] * S);
    this.sliceMesh = mesh; this.scene.add(mesh); this.legend.textContent += ` · срез ${comp === 'mag' ? '|B|' : 'Bn'} до ${bmax.toFixed(2)} Тл`; this.requestRender();
  }
  clearSlice() { if (this.sliceMesh) { this.scene.remove(this.sliceMesh); this.sliceMesh.geometry.dispose(); this.sliceMesh.material.map?.dispose(); this.sliceMesh.material.dispose(); this.sliceMesh = null; this.requestRender(); } }
}
function ringGeo(ri, ro, z0, z1) { const sh = new THREE.Shape(); sh.absarc(0, 0, ro, 0, Math.PI * 2, false); if (ri > 0) { const h = new THREE.Path(); h.absarc(0, 0, ri, 0, Math.PI * 2, true); sh.holes.push(h); } const g = new THREE.ExtrudeGeometry(sh, { depth: z1 - z0, bevelEnabled: false, curveSegments: 48 }); g.translate(0, 0, z0); return g; }
function magnetGeometry(o) {
  const d = o.dims;
  if (o.shape === 'cyl' || o.shape === 'ring' || o.shape === 'dcyl') { const L = d.L * S; return ringGeo((d.Din || 0) / 2 * S, d.D / 2 * S, -L / 2, L / 2); }
  if (o.shape === 'block') return new THREE.BoxGeometry(d.lx * S, d.ly * S, d.lz * S);
  if (o.shape === 'sphere') return new THREE.SphereGeometry(d.D / 2 * S, 32, 24);
  if (o.shape === 'arc') { const Ri = d.Ri * S, Ro = d.Ro * S, L = d.L * S, a = d.span / 2; const sh = new THREE.Shape(); sh.absarc(0, 0, Ro, -a, a, false); if (Ri > 0.01) sh.absarc(0, 0, Ri, a, -a, true); else sh.lineTo(0, 0); sh.closePath(); const g = new THREE.ExtrudeGeometry(sh, { depth: L, bevelEnabled: false, curveSegments: 24 }); g.translate(0, 0, -L / 2); return g; }
  return null;
}
