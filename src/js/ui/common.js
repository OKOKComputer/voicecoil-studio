// Shared UI helpers: forms from schema, worker client, formatting, small plots, persistence.
export const $ = id => document.getElementById(id);
export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null) e.setAttribute(k, v); }
  for (const c of [].concat(children)) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
export const num = (v, d = 0) => { const x = parseFloat(String(v).replace(',', '.')); return isFinite(x) ? x : d; };
export const fmt = (v, d = 1) => (v == null || !isFinite(v)) ? '—' : v.toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: d });
export const f3 = v => { if (v == null || !isFinite(v)) return '—'; const a = Math.abs(v); const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3; return v.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d }); };
export function fmtSI(v, unit, d = 3) {
  if (v == null || !isFinite(v)) return '—'; const a = Math.abs(v); if (a === 0) return '0 ' + unit;
  const pre = [[1e9, 'Г'], [1e6, 'М'], [1e3, 'к'], [1, ''], [1e-3, 'м'], [1e-6, 'мк'], [1e-9, 'н'], [1e-12, 'п']];
  for (const [s, p] of pre) if (a >= s * 0.9999) { const x = v / s; return x.toLocaleString('ru-RU', { maximumSignificantDigits: d }) + ' ' + p + unit; }
  return v.toExponential(2) + ' ' + unit;
}

/** Build a form. schema: [{id,label,type,unit,step,min,max,options,wide,hint,show}] ; state: object (UI units). */
export function buildForm(container, schema, state, onChange) {
  container.innerHTML = ''; const grid = el('div', { class: 'grid2' }); container.append(grid); const inputs = {};
  for (const f of schema) {
    if (f.type === 'heading') { grid.append(el('h3', { class: 'wide', style: 'grid-column:1/-1' }, f.label)); continue; }
    let inp;
    if (f.type === 'select') { inp = el('select', { id: f.id }); for (const [v, l] of f.options) inp.append(el('option', { value: v }, l)); inp.value = String(state[f.id]); }
    else if (f.type === 'check') { inp = el('input', { type: 'checkbox', id: f.id }); inp.checked = !!state[f.id]; }
    else if (f.type === 'range') { inp = el('input', { type: 'range', id: f.id, min: f.min, max: f.max, step: f.step ?? 1 }); inp.value = state[f.id]; }
    else if (f.type === 'text') { inp = el('input', { type: 'text', id: f.id }); inp.value = state[f.id] ?? ''; }
    else { inp = el('input', { type: 'number', id: f.id, step: f.step ?? 'any', inputmode: 'decimal' }); if (f.min != null) inp.min = f.min; if (f.max != null) inp.max = f.max; inp.value = state[f.id]; }
    inputs[f.id] = inp;
    const handler = () => {
      if (f.type === 'check') state[f.id] = inp.checked; else if (f.type === 'select') state[f.id] = isNaN(Number(inp.value)) || inp.value === '' ? inp.value : (f.numeric === false ? inp.value : Number(inp.value)); else if (f.type === 'text') state[f.id] = inp.value; else state[f.id] = num(inp.value, state[f.id]);
      if (f.type === 'range' && f.out) f.out.textContent = String(state[f.id]);
      refresh(); onChange(f.id, f);
    };
    inp.addEventListener(f.type === 'range' ? 'input' : 'change', handler); if (f.type === 'number') inp.addEventListener('input', () => { clearTimeout(inp._t); inp._t = setTimeout(handler, 500); });
    let wrap;
    if (f.type === 'check') wrap = el('label', { class: 'chk' }, [inp, el('span', {}, f.label)]);
    else { const lab = el('label', { class: 'f' + (f.wide ? ' wide' : '') }); const txt = f.label + (f.unit ? `, ${f.unit}` : ''); if (f.type === 'range') { const out = el('b', { style: 'color:var(--ink)' }, String(state[f.id])); f.out = out; lab.append(el('span', {}, [txt + ' ', out])); } else lab.append(txt); lab.append(inp); wrap = lab; }
    wrap.dataset.field = f.id; grid.append(wrap);
    if (f.hint) grid.append(el('p', { class: 'hint', style: 'grid-column:1/-1;margin:-2px 0 2px' }, f.hint));
  }
  function refresh() {
    for (const f of schema) { if (f.type === 'heading') continue; const w = grid.querySelector(`[data-field="${f.id}"]`); if (!w) continue; const vis = f.show ? !!f.show(state) : true; w.classList.toggle('hidden', !vis); const inp = inputs[f.id];
      if (document.activeElement === inp) continue;
      if (f.type === 'check') inp.checked = !!state[f.id]; else inp.value = String(state[f.id]); if (f.type === 'range' && f.out) f.out.textContent = String(state[f.id]); }
  }
  refresh(); return { refresh, inputs };
}

/** One worker per channel; a new run terminates the previous one (so superseded work stops). */
export class WorkerClient {
  constructor(url) { this.url = url; this.w = null; this.seq = 0; }
  run(type, params, onProgress) {
    if (this.w) { this.w.terminate(); this.w = null; if (this._rej) this._rej(new Error('cancelled')); }
    this.w = new Worker(this.url, { type: 'module' }); const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this._rej = reject;
      this.w.onmessage = e => { const d = e.data; if (d.id !== id) return; if (d.progress != null) { onProgress && onProgress(d.progress, d.msg); return; } if (d.error) { this._rej = null; reject(new Error(d.error)); } else { this._rej = null; resolve(d.result); } };
      this.w.onerror = e => { this._rej = null; reject(new Error(e.message || 'worker error')); };
      this.w.postMessage({ id, type, params });
    });
  }
}
export function setProgress(bar, status, frac, msg) { if (bar) bar.style.width = Math.round(100 * frac) + '%'; if (status && msg != null) status.textContent = msg; const ms = document.getElementById('mini-status'); if (ms && msg != null) ms.textContent = msg; }

// ---------- persistence ----------
export function persist(key, state) { try { localStorage.setItem('vcs2.' + key, JSON.stringify(state)); } catch (e) { } }
export function restore(key, defaults) { try { const o = JSON.parse(localStorage.getItem('vcs2.' + key) || 'null'); if (o && typeof o === 'object') return { ...defaults, ...o }; } catch (e) { } return { ...defaults }; }
// Share link: #<tab>-<z|j><base32 of (deflated) JSON>. Only letters/digits/hyphens in the hash.
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
function b32enc(bytes) { let bits = 0, val = 0, out = ''; for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
function b32dec(str) { const out = []; let bits = 0, val = 0; for (const ch of str) { const v = B32.indexOf(ch); if (v < 0) continue; val = (val << 5) | v; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(out); }
async function deflate(bytes) { if (typeof CompressionStream === 'undefined') return null; try { const cs = new CompressionStream('deflate-raw'); const w = cs.writable.getWriter(); w.write(bytes); w.close(); return new Uint8Array(await new Response(cs.readable).arrayBuffer()); } catch (e) { return null; } }
async function inflate(bytes) { const ds = new DecompressionStream('deflate-raw'); const w = ds.writable.getWriter(); w.write(bytes); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); }
export async function encodeShare(tab, state) {
  const raw = new TextEncoder().encode(JSON.stringify(state)); const z = await deflate(raw);
  const code = z && z.length < raw.length ? 'z' + b32enc(z) : 'j' + b32enc(raw);
  return `${location.origin}${location.pathname}#${tab}-${code}`;
}
export async function decodeHash() {
  const m = location.hash.match(/^#([a-z]+)(?:-([zj])([a-z2-7]+))?$/); if (!m) return null; let state = null;
  if (m[2]) { try { const bytes = b32dec(m[3]); const raw = m[2] === 'z' ? await inflate(bytes) : bytes; state = JSON.parse(new TextDecoder().decode(raw)); } catch (e) { state = null; } }
  return { tab: m[1], state };
}
export async function copyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch (e) { return false; } }

// ---------- plots ----------
export function cssVar(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
function prepCanvas(cv) { const dpr = window.devicePixelRatio || 1; const W = cv.clientWidth || 300, H = cv.clientHeight || 180; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); return { g, W, H }; }
export function plotLine(cv, series, opts = {}) {
  const { g, W, H } = prepCanvas(cv); const ink = cssVar('--ink'), muted = cssVar('--muted'), line = cssVar('--line');
  const padL = 46, padR = 10, padT = 10, padB = 24;
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const s of series) for (let i = 0; i < s.xs.length; i++) { xmin = Math.min(xmin, s.xs[i]); xmax = Math.max(xmax, s.xs[i]); ymin = Math.min(ymin, s.ys[i]); ymax = Math.max(ymax, s.ys[i]); }
  if (!isFinite(xmin)) return; if (opts.zero) { ymin = Math.min(ymin, 0); ymax = Math.max(ymax, 0); } if (ymax - ymin < 1e-12) { ymax += 1; ymin -= 1; }
  const pad = (ymax - ymin) * 0.08; ymin -= pad; ymax += pad;
  const X = x => padL + (x - xmin) / (xmax - xmin || 1) * (W - padL - padR), Y = y => H - padB - (y - ymin) / (ymax - ymin) * (H - padT - padB);
  g.strokeStyle = line; g.lineWidth = 1; g.beginPath(); g.moveTo(padL, padT); g.lineTo(padL, H - padB); g.lineTo(W - padR, H - padB); g.stroke();
  if (ymin < 0 && ymax > 0) { g.setLineDash([3, 3]); g.beginPath(); g.moveTo(padL, Y(0)); g.lineTo(W - padR, Y(0)); g.stroke(); g.setLineDash([]); }
  g.fillStyle = muted; g.font = '11px "Golos Text",system-ui,sans-serif'; g.textAlign = 'right';
  for (let k = 0; k <= 4; k++) { const y = ymin + (ymax - ymin) * k / 4; g.fillText(fmtAxis(y), padL - 4, Y(y) + 4); }
  g.textAlign = 'center'; for (let k = 0; k <= 4; k++) { const x = xmin + (xmax - xmin) * k / 4; g.fillText(fmtAxis(x) + (opts.xunit ? ' ' + opts.xunit : ''), X(x), H - 6); }
  if (opts.ylabel) { g.save(); g.translate(10, (padT + H - padB) / 2); g.rotate(-Math.PI / 2); g.fillText(opts.ylabel, 0, 0); g.restore(); }
  const colors = [cssVar('--copper'), cssVar('--steel'), ink];
  series.forEach((s, si) => { g.strokeStyle = s.color || colors[si % 3]; g.lineWidth = 2; g.beginPath(); for (let i = 0; i < s.xs.length; i++) { const px = X(s.xs[i]), py = Y(s.ys[i]); if (i) g.lineTo(px, py); else g.moveTo(px, py); } g.stroke(); });
}
function fmtAxis(v) { const a = Math.abs(v); if (a === 0) return '0'; if (a >= 1000 || a < 0.01) return v.toExponential(1); return v.toLocaleString('ru-RU', { maximumSignificantDigits: 3 }); }
/** colormap: value in [0,1] -> [r,g,b] (dark→copper→light) */
export function cmap(t) { t = Math.max(0, Math.min(1, t)); const stops = [[18, 24, 22], [47, 108, 128], [176, 96, 47], [245, 214, 150], [255, 255, 255]]; const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i; return [0, 1, 2].map(k => Math.round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f)); }
export function cmapDiv(t) { // -1..1 : steel .. paper .. copper
  t = Math.max(-1, Math.min(1, t)); const a = [47, 108, 128], m = [236, 239, 234], b = [176, 96, 47]; const c = t < 0 ? a : b, f = Math.abs(t); return [0, 1, 2].map(k => Math.round(m[k] + (c[k] - m[k]) * f)); }
export function heatmap(cv, data, nu, nv, opts = {}) {
  const { g, W, H } = prepCanvas(cv); const img = g.createImageData(nu, nv); const mn = opts.min ?? 0, mx = opts.max ?? 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const v = data[j * nu + i]; const t = (v - mn) / (mx - mn || 1); const [r, gg, b] = cmap(t); const k = (j * nu + i) * 4; img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255; }
  const off = document.createElement('canvas'); off.width = nu; off.height = nv; off.getContext('2d').putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true; g.drawImage(off, 0, 0, W, H);
  if (opts.labels) { g.fillStyle = '#fff'; g.font = '11px system-ui,sans-serif'; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 3; for (const l of opts.labels) g.fillText(l.text, l.x * W, l.y * H); }
}
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export function setMini(label, val, status) { const l = document.getElementById('mini-label'), v = document.getElementById('mini-val'), st = document.getElementById('mini-status'); if (l && label != null) l.textContent = label; if (v && val != null) v.textContent = val; if (st && status != null) st.textContent = status; }
