// Free scene tab: object cards, forces table, sweep, slice.
import { $, el, buildForm, setProgress, persist, restore, fmt, f3, fmtSI, debounce, plotLine, num, setMini } from './common.js';
import { View3D } from './view3d.js';
import { PRESETS, toEngineObjects, getPath, setPath } from '../modules/freescene.js';

const MAG_DIMS = { cyl: ['D', 'L'], ring: ['D', 'Din', 'L'], block: ['lx', 'ly', 'lz'], arc: ['Ri', 'Ro', 'L', 'span', 'n'], dcyl: ['D', 'Din', 'L'], sphere: ['D'] };
const COIL_DIMS = { ring: ['ri', 'ro', 'h'], racetrack: ['Ls', 'ri', 'build', 'h'], sector: ['r1', 'r2', 'half', 'build', 'h'], spiral: ['ri', 'ro', 'N', 'h'], saddle: ['ri', 'build', 'half', 'Lz', 'wAng'] };
const LABEL = { D: 'Ø', Din: 'Ø отв.', L: 'высота', lx: 'X', ly: 'Y', lz: 'Z', Ri: 'R внутр', Ro: 'R внеш', span: 'дуга °', n: 'фасеток', ri: 'r внутр', ro: 'r внеш', h: 'высота', Ls: 'прямая', build: 'пучок', r1: 'r1', r2: 'r2', half: 'полуугол °', N: 'витков', Lz: 'длина', wAng: 'ширина °' };
const DEF_MAG = { cyl: { D: 10, L: 5 }, ring: { D: 10, Din: 4, L: 5 }, block: { lx: 10, ly: 10, lz: 4 }, arc: { Ri: 8, Ro: 14, L: 3, span: 40, n: 6 }, dcyl: { D: 10, Din: 0, L: 10 }, sphere: { D: 10 } };
const DEF_COIL = { ring: { ri: 5.5, ro: 8, h: 4 }, racetrack: { Ls: 10, ri: 3, build: 4, h: 3 }, sector: { r1: 8, r2: 14, half: 15, build: 2, h: 3 }, spiral: { ri: 1, ro: 4, N: 8, h: 0.5 }, saddle: { ri: 8, build: 2, half: 15, Lz: 20, wAng: 6 } };
const DIRS = [['0,0,1', '+Z'], ['0,0,-1', '−Z'], ['1,0,0', '+X'], ['-1,0,0', '−X'], ['0,1,0', '+Y'], ['0,-1,0', '−Y']];

export function initScene(worker) {
  const saved = restore('scene', { objs: null, sweep: null });
  let objs = saved.objs || PRESETS['Два магнита встречно + катушка']();
  const sw = Object.assign({ objId: '', path: 'z', from: -5, to: 5, steps: 11, targetId: '', comp: 'Fz' }, saved.sweep || {});
  const view = new View3D($('sc-view')); let lastRows = null;
  const presetSel = $('sc-preset'); for (const k of Object.keys(PRESETS)) presetSel.append(el('option', { value: k }, k));
  presetSel.addEventListener('change', () => { if (!presetSel.value) return; objs = PRESETS[presetSel.value](); presetSel.value = ''; refreshAll(true); });
  const save = () => persist('scene', { objs, sweep: sw });
  const show3d = debounce(() => { try { view.setObjects(toEngineObjects(objs), { fit: false }); } catch (e) { console.warn(e); } }, 150);
  function uid(prefix) { let i = 1; while (objs.some(o => o.id === prefix + i)) i++; return prefix + i; }
  $('sc-add').addEventListener('click', () => {
    const [kind, sub] = $('sc-addkind').value.split(':');
    if (kind === 'magnet') objs.push({ id: uid('m'), kind, shape: sub, grade: 'N52', dims: { ...DEF_MAG[sub] }, mdir: sub === 'dcyl' ? [1, 0, 0] : [0, 0, 1], mag: 'axial', x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
    else if (kind === 'coil') objs.push({ id: uid('c'), kind, spec: { ctype: sub, ...DEF_COIL[sub] }, I: 1, wire: 0.2, kf: 0.7, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
    else objs.push({ id: uid('p'), kind: 'plate', size: 40, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
    refreshAll(false);
  });
  $('sc-clear').addEventListener('click', () => { objs = []; refreshAll(true); });
  $('sc-export').addEventListener('click', async () => { const txt = JSON.stringify({ objs, sweep: sw }, null, 1); const { copyText } = await import('./common.js'); const ok = await copyText(txt); $('sc-status').textContent = ok ? 'JSON сцены скопирован — вставь в «Параметры» или сохрани в файл' : 'Открой «Параметры» вверху и скопируй оттуда'; });
  $('sc-import').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { const j = JSON.parse(await f.text()); objs = j.objs || j; refreshAll(true); } catch (err) { $('sc-status').textContent = 'Не смог прочитать JSON'; } e.target.value = ''; });

  function renderCards() {
    const box = $('sc-objs'); box.innerHTML = '';
    for (const o of objs) {
      const card = el('div', { class: 'objcard' + (o.hidden ? ' hidden-obj' : '') });
      const kindTxt = o.kind === 'magnet' ? `магнит · ${o.shape}` : o.kind === 'coil' ? `катушка · ${o.spec.ctype}` : 'стальная плита';
      const head = el('div', { class: 'head' }, [el('b', {}, o.id), el('span', { class: 'kind' }, kindTxt), el('span', { class: 'row' }, [
        el('button', { class: 'iconbtn', title: 'скрыть/показать', onclick: () => { o.hidden = !o.hidden; refreshAll(false); } }, o.hidden ? '◌' : '●'),
        el('button', { class: 'iconbtn', title: 'дублировать', onclick: () => { const c = JSON.parse(JSON.stringify(o)); c.id = uid(o.kind === 'magnet' ? 'm' : o.kind === 'coil' ? 'c' : 'p'); c.z = (c.z || 0) + 5; objs.push(c); refreshAll(false); } }, '⧉'),
        el('button', { class: 'iconbtn', title: 'удалить', onclick: () => { objs = objs.filter(x => x !== o); refreshAll(false); } }, '✕')])]);
      card.append(head);
      const numInput = (obj, path, label, step = 0.5) => { const inp = el('input', { type: 'number', step, inputmode: 'decimal' }); inp.value = getPath(obj, path); inp.addEventListener('change', () => { setPath(obj, path, num(inp.value, getPath(obj, path))); save(); show3d(); }); return el('label', { class: 'f' }, [label, inp]); };
      const selInput = (obj, path, label, options, conv = x => x) => { const s = el('select'); for (const [v, l] of options) s.append(el('option', { value: v }, l)); s.value = String(getPath(obj, path)); s.addEventListener('change', () => { setPath(obj, path, conv(s.value)); save(); refreshAll(false); }); return el('label', { class: 'f' }, [label, s]); };
      const g = el('div', { class: 'grid3' });
      if (o.kind === 'magnet') {
        for (const k of MAG_DIMS[o.shape]) g.append(numInput(o, 'dims.' + k, LABEL[k] + (k === 'span' || k === 'n' ? '' : ', мм'), k === 'n' ? 1 : 0.5));
        g.append(selInput(o, 'grade', 'марка', [['N35', 'N35'], ['N42', 'N42'], ['N48', 'N48'], ['N52', 'N52'], ['SmCo', 'SmCo'], ['Ferrite', 'феррит']]));
        if (o.shape === 'block' || o.shape === 'sphere' || o.shape === 'dcyl') g.append(selInput(o, 'mdir', 'намагнич.', DIRS, v => v.split(',').map(Number)));
        if (o.shape === 'arc') g.append(selInput(o, 'mag', 'намагнич.', [['axial', 'осевая (Z)'], ['radial', 'радиальная'], ['parallel', 'вдоль X']]));
        if (o.shape === 'cyl' || o.shape === 'ring') g.append(el('label', { class: 'f' }, ['намагнич.', el('input', { type: 'text', value: 'по оси Z (N вверх)', disabled: true })]));
      } else if (o.kind === 'coil') {
        for (const k of COIL_DIMS[o.spec.ctype]) g.append(numInput(o, 'spec.' + k, LABEL[k] + (['half', 'wAng', 'N'].includes(k) ? '' : ', мм'), k === 'N' ? 1 : 0.5));
        g.append(numInput(o, 'I', 'ток, А·виток', 0.1)); g.append(numInput(o, 'wire', 'провод, мм', 0.01)); g.append(numInput(o, 'kf', 'заполн.', 0.05));
      } else { g.append(numInput(o, 'size', 'размер, мм', 5)); }
      card.append(g);
      const pos = el('div', { class: 'grid3', style: 'margin-top:6px' }); for (const k of ['x', 'y', 'z']) pos.append(numInput(o, k, k.toUpperCase() + ', мм', 0.5)); for (const k of ['rx', 'ry', 'rz']) pos.append(numInput(o, k, 'пов. ' + k[1].toUpperCase() + ' °', 5)); card.append(pos);
      box.append(card);
    }
    if (!objs.length) box.append(el('p', { class: 'hint' }, 'Пусто. Добавь объект или выбери пресет.'));
  }
  function renderSweepForm() {
    const ids = objs.map(o => [o.id, o.id]); if (!objs.some(o => o.id === sw.objId)) sw.objId = objs[0]?.id || ''; if (!objs.some(o => o.id === sw.targetId)) sw.targetId = objs.find(o => o.kind === 'coil')?.id || objs[0]?.id || '';
    const o = objs.find(x => x.id === sw.objId); const paths = [['x', 'X'], ['y', 'Y'], ['z', 'Z'], ['rx', 'поворот X'], ['ry', 'поворот Y'], ['rz', 'поворот Z']];
    if (o?.kind === 'magnet') for (const k of MAG_DIMS[o.shape]) paths.push(['dims.' + k, LABEL[k]]); if (o?.kind === 'coil') { for (const k of COIL_DIMS[o.spec.ctype]) paths.push(['spec.' + k, LABEL[k]]); paths.push(['I', 'ток']); }
    if (!paths.some(p => p[0] === sw.path)) sw.path = 'z';
    buildForm($('sc-sweep'), [
      { id: 'objId', label: 'Объект', type: 'select', numeric: false, options: ids }, { id: 'path', label: 'Параметр', type: 'select', numeric: false, options: paths },
      { id: 'from', label: 'От', step: 0.5 }, { id: 'to', label: 'До', step: 0.5 }, { id: 'steps', label: 'Шагов', step: 1, min: 2, max: 61 },
      { id: 'targetId', label: 'Смотрим на', type: 'select', numeric: false, options: ids }, { id: 'comp', label: 'Величина', type: 'select', numeric: false, wide: true, options: [['Fx', 'Fx, Н'], ['Fy', 'Fy, Н'], ['Fz', 'Fz, Н'], ['F', '|F|, Н'], ['Tx', 'Tx, Н·м'], ['Ty', 'Ty, Н·м'], ['Tz', 'Tz, Н·м'], ['T', '|T|, Н·м']] },
    ], sw, id => { save(); if (id === 'objId') renderSweepForm(); });
  }
  function refreshAll(fit) { renderCards(); renderSweepForm(); save(); try { view.setObjects(toEngineObjects(objs), { fit }); } catch (e) { console.warn(e); } }
  $('sc-run').addEventListener('click', async () => {
    $('sc-status').textContent = 'Считаю…'; setProgress($('sc-prog'), null, 0.05);
    try {
      const r = await worker.run('scene', { objs, opts: { inductance: false } }, (f, m) => setProgress($('sc-prog'), $('sc-status'), f, 'Считаю… ' + m)); lastRows = r.rows; renderTable(r.rows); $('sc-status').textContent = 'Готово'; setProgress($('sc-prog'), null, 1); slice();
    } catch (e) { if (e.message !== 'cancelled') $('sc-status').textContent = 'Ошибка: ' + e.message; }
  });
  function renderTable(rows) {
    const tb = $('sc-tb'); tb.innerHTML = '';
    for (const r of rows) { const Tm = Math.hypot(...r.T) * 1e3; tb.append(el('tr', { html: `<td>${r.id}<small>${r.kind === 'magnet' ? 'магнит' : 'катушка, ток как задан'}</small></td><td>${fmtN(r.F[0])}</td><td>${fmtN(r.F[1])}</td><td>${fmtN(r.F[2])}</td><td>${fmt(Tm, Tm < 1 ? 3 : 1)}</td><td>${r.kind === 'coil' ? f3(r.km) : '—'}</td><td>${r.kind === 'coil' ? r.N : '—'}</td><td>${r.kind === 'coil' ? fmt(r.R, r.R < 10 ? 2 : 1) : '—'}</td>` })); }
    const coils = rows.filter(r => r.kind === 'coil'); let nt = '';
    if (coils.length) { const best = coils.reduce((a, b) => b.km > a.km ? b : a); setMini('Km лучшей катушки, Н/√Вт', f3(best.km), best.id); nt += `<p class="note">Лучшая катушка по Km — <b>${best.id}</b>: ${f3(best.km)} Н/√Вт. Направление силы на 1 А·виток: (${best.F1.map(v => v.toExponential(1)).join(', ')}) Н.</p>`; }
    $('sc-notes').innerHTML = nt;
  }
  const fmtN = v => Math.abs(v) < 1e-7 ? '0' : fmtSI(v, 'Н');
  $('sc-sweepbtn').addEventListener('click', async () => {
    $('sc-sweepstatus').textContent = 'Считаю…';
    try { const r = await worker.run('sweep', { objs, sw }, (f, m) => { $('sc-sweepstatus').textContent = m; }); plotLine($('sc-plot'), [{ xs: r.xs, ys: r.ys }], { zero: true, xunit: sw.path.startsWith('r') && sw.path.length === 2 ? '°' : (sw.path === 'I' ? 'А' : 'мм'), ylabel: sw.comp }); $('sc-sweepstatus').textContent = `Готово: ${sw.comp} от ${fmt(Math.min(...r.ys), 3)} до ${fmt(Math.max(...r.ys), 3)}`; }
    catch (e) { if (e.message !== 'cancelled') $('sc-sweepstatus').textContent = 'Ошибка: ' + e.message; }
  });
  async function slice() {
    const v = $('sc-slice').value; if (v === 'none') { view.clearSlice(); return; }
    const [comp, pl] = v.split(':'); const off = num($('sc-sliceoff').value, 0) * 1e-3;
    // extent from objects
    let R = 0.02; for (const o of objs) { const d = o.dims || o.spec || {}; const ext = Math.max(Math.abs(o.x || 0), Math.abs(o.y || 0), Math.abs(o.z || 0), ...Object.values(d).filter(x => typeof x === 'number')) * 1e-3; R = Math.max(R, ext * 1.3); }
    const plane = pl === 'xz' ? { o: [0, off, 0], u: [1, 0, 0], v: [0, 0, 1] } : pl === 'yz' ? { o: [off, 0, 0], u: [0, 1, 0], v: [0, 0, 1] } : { o: [0, 0, off], u: [1, 0, 0], v: [0, 1, 0] };
    Object.assign(plane, { hu: R, hv: R, nu: 64, nv: 64, comp, coils: true });
    try { const sl = await worker.run('slice', { uiObjs: objs, plane }); view.setSlice(sl, plane); } catch (e) { }
  }
  $('sc-slice').addEventListener('change', slice); $('sc-sliceoff').addEventListener('change', slice);
  refreshAll(true);
  return { get state() { return { objs, sweep: sw }; }, setState(s) { if (s.objs) objs = s.objs; if (s.sweep) Object.assign(sw, s.sweep); refreshAll(true); }, view };
}
