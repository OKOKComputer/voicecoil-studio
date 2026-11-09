// Spherical motor tab
import { $, buildForm, setProgress, persist, restore, fmt, f3, fmtSI, debounce, heatmap, setMini } from './common.js';
import { View3D } from './view3d.js';
import { SPH_DEFAULTS, buildScene } from '../modules/spherical.js';

const DEF = { Rb: 15, pattern: 'cube8', magD: 6, magL: 4, grade: 'N52', shell: 'hemi', ncoils: 8, cap: 35, coilRi: 2.5, coilBuild: 2.5, coilT: 3, gap: 1, wire: 0.2, kf: 0.7, cond: 'cu', T: 60, hconv: 15, rx: 0, ry: 0, rz: 0, mapRes: 8 };
function toSI(st) { return { ...SPH_DEFAULTS, Rb: st.Rb * 1e-3, pattern: st.pattern, magD: st.magD * 1e-3, magL: st.magL * 1e-3, grade: st.grade, shell: st.shell, ncoils: Math.round(st.ncoils), cap: st.cap, coilRi: st.coilRi * 1e-3, coilBuild: st.coilBuild * 1e-3, coilT: st.coilT * 1e-3, gap: st.gap * 1e-3, wire: st.wire * 1e-3, kf: +st.kf, cond: st.cond, T: st.T, hconv: +st.hconv, rx: st.rx, ry: st.ry, rz: st.rz, mapRes: Math.round(st.mapRes) }; }
export function initSPH(worker) {
  const st = restore('sph', DEF); const view = new View3D($('sph-view')); let last = null;
  const rotor = [
    { id: 'Rb', label: 'Радиус шара', unit: 'мм', step: 0.5, min: 3 },
    { id: 'pattern', label: 'Магниты в шаре', type: 'select', wide: true, numeric: false, options: [['cube8', '8 полюсов по вершинам куба, шахматно'], ['oct6', '6 полюсов по осям (пары)'], ['tetra4', '4 полюса, тетраэдр'], ['ico12', '12 полюсов, икосаэдр (полушария)'], ['dipole', 'Шар намагничен целиком (диполь)']] },
    { id: 'magD', label: 'Диаметр магнитов', unit: 'мм', step: 0.5, min: 1, show: s => s.pattern !== 'dipole' }, { id: 'magL', label: 'Высота магнитов', unit: 'мм', step: 0.5, min: 0.5, show: s => s.pattern !== 'dipole' },
    { id: 'grade', label: 'Марка', type: 'select', numeric: false, options: [['N35', 'N35'], ['N42', 'N42'], ['N45', 'N45'], ['N48', 'N48'], ['N52', 'N52'], ['SmCo', 'SmCo'], ['Ferrite', 'Феррит']] },
  ];
  const stator = [
    { id: 'shell', label: 'Расстановка катушек', type: 'select', wide: true, numeric: false, options: [['hemi', 'Нижняя полусфера (чаша), равномерно'], ['ring', 'Кольцо по экватору'], ['oct6', '6 по осям'], ['cube8', '8 по вершинам куба']] },
    { id: 'ncoils', label: 'Катушек', step: 1, min: 3, max: 24, show: s => s.shell === 'hemi' || s.shell === 'ring' }, { id: 'cap', label: 'Отступ от экватора', unit: '°', step: 5, min: 0, max: 60, show: s => s.shell === 'hemi' },
    { id: 'gap', label: 'Зазор шар–катушка', unit: 'мм', step: 0.1, min: 0.1 }, { id: 'coilRi', label: 'Внутр. радиус катушки', unit: 'мм', step: 0.5, min: 0.5 },
    { id: 'coilBuild', label: 'Толщина стенки катушки', unit: 'мм', step: 0.5, min: 0.5 }, { id: 'coilT', label: 'Высота катушки', unit: 'мм', step: 0.5, min: 0.5 },
  ];
  const orient = [
    { id: 'rx', label: 'Поворот X', type: 'range', min: -180, max: 180, step: 5 }, { id: 'ry', label: 'Поворот Y', type: 'range', min: -180, max: 180, step: 5 }, { id: 'rz', label: 'Поворот Z', type: 'range', min: -180, max: 180, step: 5 },
    { id: 'mapRes', label: 'Разрешение карты (строк)', step: 2, min: 4, max: 24 },
  ];
  const elec = [
    { id: 'wire', label: 'Провод', unit: 'мм', step: 0.01, min: 0.05 }, { id: 'kf', label: 'Заполнение', type: 'select', options: [['0.5', '0,50'], ['0.6', '0,60'], ['0.7', '0,70'], ['0.8', '0,80']] },
    { id: 'cond', label: 'Проводник', type: 'select', numeric: false, options: [['cu', 'Медь'], ['al', 'Алюминий']] }, { id: 'T', label: 'Темп. обмотки', unit: '°C', step: 5, min: 20, max: 180 },
    { id: 'hconv', label: 'Охлаждение', type: 'select', options: [['12', 'Закрытый корпус'], ['20', 'Открытый'], ['50', 'Обдув']] },
  ];
  const forms = [buildForm($('sph-rotor'), rotor, st, onChange), buildForm($('sph-stator'), stator, st, onChange), buildForm($('sph-orient'), orient, st, onChange), buildForm($('sph-el'), elec, st, onChange)];
  function onChange() { run(); }
  const run = debounce(async () => {
    persist('sph', st); const p = toSI(st); $('sph-status').textContent = 'Считаю…'; setProgress($('sph-prog'), null, 0.02);
    try { view.setObjects(buildScene(p), { fit: true }); } catch (e) { }
    try {
      const r = await worker.run('spherical', p, (f, m) => setProgress($('sph-prog'), $('sph-status'), f, 'Считаю… ' + m)); last = { r, p }; render(r, p); $('sph-status').textContent = 'Готово'; setProgress($('sph-prog'), null, 1); slice();
    } catch (e) { if (e.message !== 'cancelled') $('sph-status').textContent = 'Ошибка: ' + e.message; }
  }, 500);
  function render(r, p) {
    $('sph-km').textContent = f3(r.KmMin * 1e3); setMini('Km слабой оси, мН·м/√Вт', f3(r.KmMin * 1e3), `изотропия ${fmt(r.isotropy * 100, 0)}%`);
    const v = r.vecs; const dirTxt = d => `(${d.map(x => x.toFixed(2)).join(', ')})`;
    const rd = [
      ['Km сильной оси', fmtSI(r.KmMax, 'Н·м/√Вт')], ['Km слабой оси', fmtSI(r.KmMin, 'Н·м/√Вт')], ['Изотропия (слабая/сильная)', fmt(r.isotropy * 100, 0) + ' %'],
      ['Km по X / Y / Z', `${fmtSI(r.axes.x, '')} / ${fmtSI(r.axes.y, '')} / ${fmtSI(r.axes.z, '')}`], ['Слабая ось', dirTxt(v[2])], ['Сильная ось', dirTxt(v[0])],
      ['Витков в катушке', String(r.N)], ['R катушки', fmtSI(r.R, 'Ом')], ['L катушки (оценка)', fmtSI(r.L, 'Гн')], ['τ = L/R', fmtSI(r.tauE, 'с')],
      ['Катушек', String(r.C)], ['Тепловой предел, все катушки', fmt(r.Pmax, 1) + ' Вт'], ['Момент длительно по слабой оси (оценка)', fmtSI(r.TcontMin, 'Н·м')],
      ['Паразитная сила на 1 Н·м по слабой оси', fmtSI(Math.hypot(...r.forceWeak), 'Н/(Н·м)')], ['Масса магнитов', fmt(r.magMass * 1e3, 1) + ' г'], ['Масса меди', fmt(r.coilMass * 1e3, 1) + ' г'],
      ['Карта: мин / макс Km слабой оси', `${fmtSI(r.map.min, '')} / ${fmtSI(r.map.max, '')}`],
    ];
    $('sph-read').innerHTML = rd.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('');
    heatmap($('sph-map'), r.map.data, r.map.nph, r.map.nth, { min: 0, max: r.map.max, labels: [{ text: 'θ=0° (ось вверх)', x: 0.01, y: 0.08 }, { text: 'θ=180°', x: 0.01, y: 0.97 }, { text: 'φ=0', x: 0.01, y: 0.55 }, { text: 'φ=360°', x: 0.88, y: 0.55 }] });
    let nt = '';
    if (r.KmMin < 1e-9 * Math.max(1, r.KmMax)) nt += `<p class="note warn">В этой ориентации есть ось, вокруг которой момент создать нельзя (ранг матрицы 2). Для диполя это всегда ось намагниченности — нужна несимметричная расстановка полюсов (например, 8 по вершинам куба).</p>`;
    if (r.map.min < 0.15 * r.map.max) nt += `<p class="note warn">На карте есть мёртвые зоны (Km слабой оси падает ниже 15% от максимума): в этих наклонах ротора контроль по одной из осей почти теряется. Лечится другой схемой полюсов или добавлением катушек.</p>`;
    else nt += `<p class="note ok">Во всех наклонах ротора хотя бы ${fmt(100 * r.map.min / r.map.max, 0)}% от лучшего Km сохраняется — ориентационных дыр нет.</p>`;
    $('sph-notes').innerHTML = nt;
  }
  async function slice() {
    const mode = $('sph-slice').value; if (mode === 'none' || !last) { view.clearSlice(); return; }
    const p = last.p; const R = (p.Rb + p.gap + p.coilT) * 1.2; const plane = { o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], hu: R, hv: R, nu: 64, nv: 64, comp: 'mag', coils: false };
    try { const sl = await worker.run('slice', { sph: p, plane }); view.setSlice(sl, plane); } catch (e) { }
  }
  $('sph-slice').addEventListener('change', slice);
  run();
  return { state: st, setState(s) { Object.assign(st, s); forms.forEach(f => f.refresh()); run(); }, view };
}
