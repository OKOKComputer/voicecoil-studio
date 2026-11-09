// BLDC tab
import { $, el, buildForm, setProgress, persist, restore, fmt, f3, fmtSI, debounce, plotLine, setMini } from './common.js';
import { View3D } from './view3d.js';
import { BLDC_DEFAULTS, buildScene } from '../modules/bldc.js';

// UI state in mm / degrees
const DEF = { topology: 'axial-single', poles: 14, coils: 12, grade: 'N52', Rin: 12, Rout: 25, tm: 3, poleArc: 0.85, halbach: false, rotorIron: true, statorIron: false, gap: 1, Lm: 20,
  span: 0.92, build: 3, tc: 3, wire: 0.3, kf: 0.6, cond: 'cu', T: 80, V: 24, hconv: 20, nTheta: 24, facets: 6, nb: 2, nz: 2, opRpm: 3000, opTorque: 50,
  optObjective: 'km', optTrials: 24, optVars: 'poleArc,span,build,tc' };
export function toSI(st) {
  return { ...BLDC_DEFAULTS, topology: st.topology, poles: Math.max(2, 2 * Math.round(st.poles / 2)), coils: Math.max(3, 3 * Math.round(st.coils / 3)), grade: st.grade, Rin: st.Rin * 1e-3, Rout: st.Rout * 1e-3, tm: st.tm * 1e-3, poleArc: st.poleArc, halbach: !!st.halbach, rotorIron: !!st.rotorIron, statorIron: !!st.statorIron, gap: st.gap * 1e-3, Lm: st.Lm * 1e-3,
    span: st.span, build: st.build * 1e-3, tc: st.tc * 1e-3, wire: st.wire * 1e-3, kf: +st.kf, cond: st.cond, T: st.T, V: st.V, hconv: +st.hconv, nTheta: st.nTheta, facets: st.facets, nb: st.nb, nz: st.nz, opRpm: st.opRpm, opTorque: st.opTorque * 1e-3 };
}
export function initBLDC(worker) {
  const st = restore('bldc', DEF); const view = new View3D($('bldc-view')); let last = null;
  const axial = s => String(s.topology).startsWith('axial');
  const topo = [
    { id: 'topology', label: 'Схема', type: 'select', wide: true, numeric: false, options: [['axial-single', 'Аксиальный, один ротор (блин)'], ['axial-dual', 'Аксиальный, два ротора, катушки между'], ['radial-in', 'Радиальный, ротор внутри (инраннер, без железа)'], ['radial-out', 'Радиальный, ротор снаружи (аутраннер, без железа)']] },
    { id: 'poles', label: 'Полюсов (чётное)', step: 2, min: 2, max: 60 }, { id: 'coils', label: 'Катушек (кратно 3)', step: 3, min: 3, max: 60 },
    { id: 'rotorIron', label: 'Стальная спинка за магнитами (плита-зеркало)', type: 'check', show: axial },
    { id: 'statorIron', label: 'Стальная спинка за катушками (ярмо статора)', type: 'check', show: s => s.topology === 'axial-single' },
  ];
  const rotor = [
    { id: 'grade', label: 'Марка', type: 'select', numeric: false, options: [['N35', 'N35'], ['N38', 'N38'], ['N42', 'N42'], ['N45', 'N45'], ['N48', 'N48'], ['N52', 'N52'], ['SmCo', 'SmCo'], ['Ferrite', 'Феррит']] },
    { id: 'tm', label: 'Толщина магнита', unit: 'мм', step: 0.5, min: 0.5 },
    { id: 'Rin', label: 'Внутр. радиус магнитов', unit: 'мм', step: 0.5, min: 1 }, { id: 'Rout', label: 'Внешн. радиус магнитов', unit: 'мм', step: 0.5, min: 2 },
    { id: 'Lm', label: 'Длина магнитов по оси', unit: 'мм', step: 1, min: 1, show: s => !axial(s) },
    { id: 'poleArc', label: 'Дуга полюса, доля шага', type: 'range', min: 0.3, max: 1, step: 0.01 },
    { id: 'halbach', label: 'Хальбах: между полюсами тангенциальные сегменты (доля 1 − дуга)', type: 'check', show: axial },
    { id: 'gap', label: 'Зазор магнит–катушка', unit: 'мм', step: 0.1, min: 0.1 },
  ];
  const stator = [
    { id: 'span', label: 'Ширина катушки, доля шага', type: 'range', min: 0.3, max: 1, step: 0.01 },
    { id: 'build', label: 'Пучок: ширина стенки (акс.) / толщина по радиусу (рад.)', unit: 'мм', step: 0.25, min: 0.25 },
    { id: 'tc', label: 'Толщина катушки по оси (акс.) / ширина пучка по окружности (рад.)', unit: 'мм', step: 0.25, min: 0.25 },
    { id: 'facets', label: 'Фасеток на магнит', step: 1, min: 2, max: 16 }, { id: 'nTheta', label: 'Точек на эл. период', step: 4, min: 8, max: 72 },
    { id: 'nb', label: 'Нитей по ширине пучка', step: 1, min: 1, max: 4 }, { id: 'nz', label: 'Нитей по толщине', step: 1, min: 1, max: 4 },
  ];
  const elec = [
    { id: 'wire', label: 'Провод', unit: 'мм', step: 0.01, min: 0.05 }, { id: 'kf', label: 'Коэф. заполнения', type: 'select', options: [['0.45', 'Внавал, 0,45'], ['0.6', 'Рядовая, 0,60'], ['0.7', 'Аккуратная, 0,70'], ['0.8', 'Ортоциклическая, 0,80']] },
    { id: 'cond', label: 'Проводник', type: 'select', numeric: false, options: [['cu', 'Медь'], ['al', 'Алюминий']] }, { id: 'T', label: 'Темп. обмотки', unit: '°C', step: 5, min: 20, max: 200 },
    { id: 'hconv', label: 'Охлаждение', type: 'select', options: [['12', 'Закрытый корпус'], ['20', 'Открытый, без обдува'], ['50', 'Самообдув ротором'], ['150', 'На радиаторе']] }, { id: 'V', label: 'Напряжение шины', unit: 'В', step: 1, min: 1 },
    { id: 'opRpm', label: 'Рабочая скорость', unit: 'об/мин', step: 100, min: 0 }, { id: 'opTorque', label: 'Рабочий момент', unit: 'мН·м', step: 1, min: 0 },
  ];
  const opt = [
    { id: 'optObjective', label: 'Критерий', type: 'select', wide: true, numeric: false, options: [['km', 'Максимум Km (момент на √Вт)'], ['kmMass', 'Km на грамм (магниты + медь)'], ['kmInertia', 'Km / √инерции ротора (динамика)']] },
    { id: 'optVars', label: 'Что варьировать', type: 'select', wide: true, numeric: false, options: [['poleArc,span,build,tc', 'дуга полюса, ширина катушки, пучок, толщина катушки'], ['poleArc,span,build,tc,tm', '…и толщина магнита'], ['poleArc,span,build,tc,tm,gap', '…и зазор']] },
    { id: 'optTrials', label: 'Случайных проб', step: 4, min: 4, max: 200 },
  ];
  const forms = [buildForm($('bldc-topo'), topo, st, onChange), buildForm($('bldc-rotor'), rotor, st, onChange), buildForm($('bldc-stator'), stator, st, onChange), buildForm($('bldc-el'), elec, st, onChange), buildForm($('bldc-opt'), opt, st, () => persist('bldc', st))];
  function onChange() { run(); }
  const run = debounce(async () => {
    persist('bldc', st); const p = toSI(st); $('bldc-status').textContent = 'Считаю…'; setProgress($('bldc-prog'), null, 0.02);
    try { view.setObjects(buildScene(p), { fit: true }); } catch (e) { }
    try {
      const r = await worker.run('bldc', p, (f, m) => setProgress($('bldc-prog'), $('bldc-status'), f, 'Считаю… ' + m)); last = { r, p }; render(r, p); $('bldc-status').textContent = 'Готово'; setProgress($('bldc-prog'), null, 1); slice();
    } catch (e) { if (e.message !== 'cancelled') { $('bldc-status').textContent = 'Ошибка: ' + e.message; } }
  }, 500);
  function render(r, p) {
    $('bldc-km').textContent = f3(r.Km * 1e3); setMini('Km, мН·м/√Вт', f3(r.Km * 1e3), `Kt ${fmtSI(r.Kt, 'Н·м/А')} · Kv ${fmt(r.Kv, 0)}`);
    const rd = [
      ['Kt, момент на пиковый ток', fmtSI(r.Kt, 'Н·м/А')], ['Ke, фаза, пик', fmtSI(r.Ke, 'В·с/рад')], ['Kv (шина, прибл.)', fmt(r.Kv, 0) + ' об/мин/В'],
      ['Витков в катушке', String(r.N)], ['R фазы', fmtSI(r.Rph, 'Ом')], ['L фазы (оценка)', fmtSI(r.Lph, 'Гн')], ['τ = L/R', fmtSI(r.tauE, 'с')],
      ['Пульсации момента', fmt(r.ripple * 100, 1) + ' %'], ['Угол коммутации γ', fmt(r.gamma * 180 / Math.PI, 0) + '°'],
      ['Масса магнитов', fmt(r.magMass * 1e3, 1) + ' г'], ['Масса меди', fmt(r.coilMass * 1e3, 1) + ' г'], ['Инерция ротора (магниты)', fmtSI(r.Jrot, 'кг·м²')], ['Провода всего', fmt(r.wireLen, 1) + ' м'],
      ['Тепловой предел (все катушки)', fmt(r.Pmax, 1) + ' Вт'], ['Момент длительно', fmtSI(r.Tcont, 'Н·м')], ['Ток длительно (пик)', fmt(r.Icont, 2) + ' А'],
      ['Холостой ход при ' + fmt(p.V, 0) + ' В', fmt(r.rpmMax, 0) + ' об/мин'], ['Стоповый момент при ' + fmt(p.V, 0) + ' В', fmtSI(r.Tstall, 'Н·м')],
      ['КПД в рабочей точке', fmt(r.eta * 100, 1) + ' %'], ['Потери в меди там же', fmt(r.Pcu, 2) + ' Вт'],
    ];
    $('bldc-read').innerHTML = rd.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('');
    const xs = r.Twave.map((_, i) => 360 * i / r.Twave.length); const xs0 = r.tau0.map((_, i) => 360 * i / r.tau0.length);
    plotLine($('bldc-plot'), [{ xs, ys: r.Twave.map(v => v * r.N * 1e3) }, { xs: [...xs0, 360], ys: [...r.tau0, r.tau0[0]].map(v => -v * r.N * 1e3) }], { xunit: '°эл', zero: true, ylabel: 'мН·м на 1 А' });
    $('bldc-plotlegend').innerHTML = '<span><i class="sw" style="background:var(--copper)"></i>суммарный момент, синусная коммутация</span><span><i class="sw" style="background:var(--steel)"></i>одна катушка при 1 А (без коммутации)</span>';
    $('bldc-phases').innerHTML = r.phaseMap.map((m, k) => `<span class="ph${m.phase}">${m.sign > 0 ? '' : '−'}${'ABC'[m.phase]}</span>`).join(' ');
    let nt = '';
    if (r.ripple > 0.1) nt += `<p class="note warn">Пульсации ${fmt(r.ripple * 100, 0)}% — комбинация полюсов/катушек даёт несбалансированную обмотку или сильные гармоники. Попробуй 12/14, 12/10, 9/12, 18/20.</p>`;
    if (p.topology.startsWith('radial')) nt += `<p class="note">Радиальные схемы считаются без стального ярма (безжелезный статор и ротор). С ярмом поле в зазоре будет заметно больше — это следующий шаг движка.</p>`;
    if (r.eta < 0.7) nt += `<p class="note warn">КПД в рабочей точке ${fmt(r.eta * 100, 0)}% — мотор слишком мал для этого момента или скорость мала. Km ${f3(r.Km)}: на момент ${fmt(p.opTorque * 1e3, 0)} мН·м уходит ${fmt(r.Pcu, 1)} Вт меди.</p>`;
    if (r.Pcu > r.Pmax) nt += `<p class="note warn">В рабочей точке меди ${fmt(r.Pcu, 1)} Вт при тепловом пределе ${fmt(r.Pmax, 1)} Вт — перегрев. Нужно больше меди/магнитов или обдув.</p>`;
    $('bldc-notes').innerHTML = nt;
  }
  async function slice() {
    const mode = $('bldc-slice').value; if (mode === 'none' || !last) { view.clearSlice(); return; }
    const p = last.p; const ax = p.topology.startsWith('axial'); const R = ax ? p.Rout * 1.15 : (p.topology === 'radial-in' ? (p.Rout + p.gap + p.build) * 1.15 : p.Rout * 1.15);
    const plane = ax ? { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], hu: R, hv: R, nu: 64, nv: 64, comp: mode, coils: false } : { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], hu: R, hv: R, nu: 64, nv: 64, comp: mode === 'n' ? 'mag' : mode, coils: false };
    try { const sl = await worker.run('slice', { bldc: p, plane }); view.setSlice(sl, plane); } catch (e) { }
  }
  $('bldc-slice').addEventListener('change', slice);
  $('bldc-optbtn').addEventListener('click', async () => {
    const p = toSI(st); const btn = $('bldc-optbtn'); btn.disabled = true; $('bldc-optstatus').textContent = 'Ищу…';
    try {
      const q = await worker.run('bldcOpt', { p, opts: { vars: String(st.optVars).split(','), objective: st.optObjective, trials: st.optTrials, refine: 2 } }, (f, m) => { $('bldc-optstatus').textContent = m; setProgress($('bldc-prog'), null, f); });
      st.poleArc = +q.poleArc.toFixed(3); st.span = +q.span.toFixed(3); st.build = +(q.build * 1e3).toFixed(2); st.tc = +(q.tc * 1e3).toFixed(2); st.tm = +(q.tm * 1e3).toFixed(2); st.gap = +(q.gap * 1e3).toFixed(2);
      forms.forEach(f => f.refresh()); $('bldc-optstatus').textContent = 'Применил лучшее'; run();
    } catch (e) { if (e.message !== 'cancelled') $('bldc-optstatus').textContent = 'Ошибка: ' + e.message; }
    btn.disabled = false;
  });
  run();
  return { state: st, setState(s) { Object.assign(st, s); forms.forEach(f => f.refresh()); run(); }, view };
}
