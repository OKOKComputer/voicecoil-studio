// Voice coil tab — port of v1 UI on top of the worker + shared 3D view.
import { $, el, buildForm, WorkerClient, setProgress, persist, restore, fmt, f3, debounce, cssVar, setMini } from './common.js';
import { View3D } from './view3d.js';
import { toScene, WIRES } from '../modules/voicecoil.js';

const DEF = { shape: 'cyl', grade: '1.45|nd', D: 10, Din: 4, L: 5, count: 2, obj: 'km', Rmax: 12, Hlim: 0, mmax: 0, moving: 'coil', stroke: 2, clear: 0.3, load: 0, cond: 'cu', kf: 0.8, T: 80, hconv: 12, U: 5, wire: 0.23, sections: true, res: '48|72' };

export function initVC(worker) {
  const st = restore('vc', DEF); const view = new View3D($('vc-view'));
  let results = null, P = null, selIdx = 0;
  const magnetSchema = [
    { id: 'shape', label: 'Форма', type: 'select', options: [['cyl', 'Цилиндр'], ['ring', 'Кольцо']], numeric: false },
    { id: 'grade', label: 'Марка', type: 'select', numeric: false, options: [['1.20|nd', 'N35'], ['1.30|nd', 'N42'], ['1.35|nd', 'N45'], ['1.39|nd', 'N48'], ['1.45|nd', 'N52'], ['1.08|smco', 'SmCo'], ['0.39|fe', 'Феррит']] },
    { id: 'D', label: 'Диаметр', unit: 'мм', step: 0.5, min: 1 }, { id: 'Din', label: 'Отверстие', unit: 'мм', step: 0.5, min: 0.5, show: s => s.shape === 'ring' },
    { id: 'L', label: 'Высота', unit: 'мм', step: 0.5, min: 0.5 }, { id: 'count', label: 'Сколько таких есть', step: 1, min: 1, max: 6 },
  ];
  const condSchema = [
    { id: 'obj', label: 'Цель', type: 'select', wide: true, numeric: false, options: [['km', 'Максимум силы на ватт (Km)'], ['acc', 'Максимум ускорения на ватт (Km / подвижная масса)']] },
    { id: 'Rmax', label: 'Радиус узла до', unit: 'мм', step: 0.5, min: 2 }, { id: 'Hlim', label: 'Высота узла до (0 = нет)', unit: 'мм', step: 1, min: 0 },
    { id: 'mmax', label: 'Масса катушки до (0 = нет)', unit: 'г', step: 0.5, min: 0, wide: true, hint: 'Km растёт с количеством меди, поэтому без габарита или лимита массы катушка займёт всё доступное место.' },
    { id: 'moving', label: 'Двигается', type: 'select', numeric: false, options: [['coil', 'Катушка'], ['magnet', 'Магнит']] }, { id: 'stroke', label: 'Ход полный', unit: 'мм', step: 0.5, min: 0 },
    { id: 'clear', label: 'Зазор до магнита', unit: 'мм', step: 0.05, min: 0.05 }, { id: 'load', label: 'Полезный груз', unit: 'г', step: 0.5, min: 0 },
  ];
  const windSchema = [
    { id: 'cond', label: 'Проводник', type: 'select', numeric: false, options: [['cu', 'Медь'], ['al', 'Алюминий']] },
    { id: 'kf', label: 'Укладка', type: 'select', options: [['0.6', 'Рядовая, 0,60'], ['0.7', 'Аккуратная, 0,70'], ['0.8', 'Ортоциклическая, 0,80'], ['0.88', 'Прессованная с эпоксидкой, 0,88'], ['0.92', 'Квадратный провод, 0,92']] },
    { id: 'T', label: 'Темп. обмотки', unit: '°C', step: 5, min: 20, max: 200 }, { id: 'hconv', label: 'Охлаждение', type: 'select', options: [['12', 'Воздух'], ['40', 'Обдув'], ['150', 'В корпусе-радиаторе']] },
    { id: 'U', label: 'Напряжение', unit: 'В', step: 0.5, min: 0.5 }, { id: 'wire', label: 'Провод', unit: 'мм', step: 0.01, min: 0.03 },
    { id: 'sections', label: 'Разрешить встречные секции: катушка из частей, намотанных в разные стороны и включённых последовательно', type: 'check' },
    { id: 'res', label: 'Точность сетки', type: 'select', wide: true, numeric: false, options: [['36|54', 'Быстро'], ['48|72', 'Нормально'], ['64|96', 'Точно (медленнее)']] },
  ];
  const forms = [buildForm($('vc-magnet'), magnetSchema, st, onChange), buildForm($('vc-cond'), condSchema, st, onChange), buildForm($('vc-wind'), windSchema, st, onChange)];
  function params() {
    const [Br, type] = String(st.grade).split('|'); const ring = st.shape === 'ring'; const D = st.D, Din = ring ? Math.min(st.Din, D - 0.5) : 0; const [nr, nz] = String(st.res).split('|').map(Number);
    return { mag: { Ro: D / 2e3, Ri: Din / 2e3, L: st.L / 1e3, Br: +Br, type }, count: Math.max(1, Math.min(6, Math.round(st.count))), clear: Math.max(0.05, st.clear) / 1e3, stroke: Math.max(0, st.stroke) / 1e3, Rmax: Math.max(D / 2 + 1, st.Rmax) / 1e3, Hlim: st.Hlim / 1e3, mmax: st.mmax / 1e3, nr, nz, cond: st.cond, T: st.T, kf: +st.kf, moving: st.moving, load: st.load / 1e3, obj: st.obj, sections: !!st.sections, hconv: +st.hconv, U: st.U, wire: st.wire / 1e3 };
  }
  const run = debounce(async () => {
    persist('vc', st); P = params(); $('vc-status').textContent = 'Считаю…'; setProgress($('vc-prog'), null, 0.05);
    try {
      const r = await worker.run('voicecoil', P, (f, m) => setProgress($('vc-prog'), $('vc-status'), f, 'Считаю… ' + m));
      results = r.results; results.order = r.order; selIdx = r.order.length ? r.order[0] : 0; renderTable(); show(selIdx);
      $('vc-status').textContent = r.order.length ? 'Готово, лучшая сверху' : 'Ничего не поместилось: увеличьте габарит'; setProgress($('vc-prog'), null, 1); if (!r.order.length) setMini('Km', '—', 'не поместилось');
    } catch (e) { if (e.message !== 'cancelled') $('vc-status').textContent = 'Ошибка: ' + e.message; }
  }, 350);
  function onChange() { run(); }
  function renderTable() {
    const tb = $('vc-tb'); tb.innerHTML = ''; const ord = [...results.order, ...results.map((r, i) => i).filter(i => results[i].invalid)];
    const maxS = Math.max(...results.order.map(i => results[i].km), 1e-9);
    for (const i of ord) {
      const r = results[i]; const tr = document.createElement('tr');
      if (r.invalid) { tr.className = 'bad'; tr.innerHTML = `<td>${r.meta.name}<small>${r.invalid}</small></td><td>—</td><td>—</td><td>—</td><td>—</td>`; }
      else {
        const acc = r.km / Math.max(r.moving, 1e-6); const flat = r.kmMax > 0 ? Math.round(100 * r.kmMin / r.kmMax) : 100; const sp = r.cfg && r.cfg.spacer > 0 ? `, зазор ${fmt(r.cfg.spacer * 1e3, 1)} мм` : '';
        tr.innerHTML = `<td>${r.meta.name}<small>${r.meta.desc}${sp}</small></td><td>${f3(r.km)}<span class="bar" style="width:${Math.round(40 * r.km / maxS)}px"></span></td><td>${fmt(acc, 0)}</td><td>${fmt(r.coil.mass * 1e3, 1)}</td><td>${flat}%</td>`;
        tr.className = 'clickable'; tr.tabIndex = 0; tr.onclick = () => show(i); if (i === selIdx) tr.classList.add('sel');
      }
      tb.appendChild(tr);
    }
  }
  function show(i) {
    selIdx = i; const r = results[i]; if (!r || r.invalid) return;
    [...$('vc-tb').children].forEach(tr => tr.classList.remove('sel')); const ord = [...results.order, ...results.map((x, k) => k).filter(k => results[k].invalid)]; const pos = ord.indexOf(i); if ($('vc-tb').children[pos]) $('vc-tb').children[pos].classList.add('sel');
    $('vc-cfgname').textContent = r.meta.name + (r.cfg && r.cfg.spacer > 0 ? `, зазор ${fmt(r.cfg.spacer * 1e3, 1)} мм` : '');
    $('vc-km').textContent = f3(r.km); setMini('Km, Н/√Вт', f3(r.km), r.meta.name);
    const c = r.coil; const As = 2 * Math.PI * (c.rin + c.rout) * c.h + 2 * Math.PI * (c.rout * c.rout - c.rin * c.rin);
    const Pmax = P.hconv * As * Math.max(1, P.T - 25); const Fc = r.km * Math.sqrt(Pmax); const acc = r.km / Math.max(r.moving, 1e-6); const flat = r.kmMax > 0 ? Math.round(100 * r.kmMin / r.kmMax) : 100;
    const rd = [['Катушка, внутр. Ø', fmt(c.rin * 2e3, 1) + ' мм'], ['внешн. Ø', fmt(c.rout * 2e3, 1) + ' мм'], ['высота', fmt(c.h * 1e3, 1) + ' мм'], ['Масса катушки', fmt(c.mass * 1e3, 2) + ' г'], ['Секций', String(c.secs || 1)], ['Ровность по ходу', flat + '%'], ['Ускорение на √Вт', fmt(acc, 0) + ' м/с²'], ['Тепловой предел', fmt(Pmax, 2) + ' Вт'], ['Сила длительно', fmt(Fc, 2) + ' Н']];
    if (r.cup) rd.push(['Поле в зазоре', fmt(r.cup.Bg, 2) + ' Тл'], ['Зазор / верхняя плита', fmt(r.cup.g * 1e3, 1) + ' / ' + fmt(r.cup.t * 1e3, 2) + ' мм'], ['Стенка стакана', fmt(r.cup.tw * 1e3, 2) + ' мм']);
    $('vc-read').innerHTML = rd.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('');
    const Aw = Math.PI * P.wire * P.wire / 4, Awin = (c.rout - c.rin) * c.h, lm = Math.PI * (c.rin + c.rout); const N = Math.floor(r.kf * Awin / Aw); const R = N > 0 ? r.rho * N * lm / Aw : Infinity; const I = P.U / R, Pw = P.U * I, F = r.km * Math.sqrt(Pw);
    const Rneed = P.U * P.U / Pmax; const dneed = Math.sqrt(4 / Math.PI * Math.sqrt(r.rho * lm * r.kf * Awin / Rneed)); let dstd = WIRES[0]; for (const w of WIRES) if (w <= dneed * 1e3 + 1e-9) dstd = w;
    const wd = [['Витков', N > 0 ? N.toLocaleString('ru-RU') : 'провод не влезает'], ['Сопротивление', isFinite(R) ? fmt(R, R < 10 ? 2 : 1) + ' Ом' : '—'], ['Ток', isFinite(I) ? fmt(I, I < 1 ? 3 : 2) + ' А' : '—'], ['Мощность', isFinite(Pw) ? fmt(Pw, 2) + ' Вт' : '—'], ['Сила', isFinite(F) ? fmt(F, 2) + ' Н' : '—'], ['Провод под тепловой предел', fmt(dstd, 3) + ' мм']];
    $('vc-windread').innerHTML = wd.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('');
    let nt = '';
    if (isFinite(Pw) && Pw > Pmax * 1.05) nt += `<p class="note warn">При ${fmt(P.U, 1)} В катушка греется на ${fmt(Pw, 1)} Вт, а отвести может около ${fmt(Pmax, 2)} Вт. Длительно — только ШИМ или провод тоньше, около ${fmt(dstd, 3)} мм. Коротким импульсом можно.</p>`;
    if (!r.cup && r.ff) { const gff = Math.round(100 * (r.ff.km / r.km - 1)), gid = Math.round(100 * (r.kmIdeal / r.km - 1)); nt += `<p class="note">Свободная форма катушки (только самые сильные зоны поля, без хода) дала бы ${f3(r.ff.km)} Н/√Вт, на ${gff}% больше прямоугольной. Градиентная обмотка — потолок ${f3(r.kmIdeal)} Н/√Вт (+${gid}%).</p>`; }
    if (c.secs > 1) nt += `<p class="note">Катушка из ${c.secs} встречных секций: поле меняет знак по высоте, соседние части мотаются в разные стороны. Границы — пунктиром.</p>`;
    if (r.cup) nt += `<p class="note warn">Стакан посчитан по магнитной цепи — оценка ±30%. Точный расчёт стали с насыщением — в планах (FEM).</p>`;
    $('vc-notes').innerHTML = nt; draw(); view.setObjects(toScene(r, P), { fit: true }); view.clearSlice();
  }
  function hexA(h, a) { h = h.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
  function draw() {
    const r = results && results[selIdx]; if (!r || r.invalid) return;
    const cv = $('vc-cv'), box = cv.parentElement, W = box.clientWidth, dpr = window.devicePixelRatio || 1; const m = P.mag;
    let zlo, zhi; if (r.cup) { const cu = r.cup; zlo = -cu.t / 2 - r.Lm - cu.t - 0.0008; zhi = Math.max(cu.h / 2 + P.stroke / 2, cu.t / 2) + 0.0015; } else { zlo = r.zlo - (r.cfg.plate ? 0.0015 : 0); zhi = r.zhi; }
    const Rd = P.Rmax; let sc = (W - 16) / (2 * Rd); let Hpx = sc * (zhi - zlo); const maxH = Math.min(window.innerHeight * 0.6, W * 1.2); if (Hpx > maxH) { sc = maxH / (zhi - zlo); Hpx = maxH; }
    const H = Math.round(Hpx + 16); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const cx = W / 2, X = rr => cx + rr * sc, Y = z => H - 8 - (z - zlo) * sc;
    const cop = cssVar('--copper'), stl = cssVar('--steel'), gra = cssVar('--graphite'), iro = cssVar('--iron'), ink = cssVar('--ink'), muted = cssVar('--muted');
    const rect = (r0, r1, z0, z1, fill, both = true) => { g.fillStyle = fill; const y0 = Y(z1), h = Y(z0) - Y(z1); g.fillRect(X(r0), y0, (r1 - r0) * sc, h); if (both) g.fillRect(X(-r1), y0, (r1 - r0) * sc, h); };
    const arrow = (z0, z1, dir) => { const y0 = Y(z0), y1 = Y(z1), len = Math.min(Math.abs(y0 - y1) * 0.6, 40), yc = (y0 + y1) / 2, hw = Math.max(4, Math.min(8, m.Ro * sc * 0.25)); const xs = m.Ri > 0 ? [X((m.Ri + m.Ro) / 2), X(-(m.Ri + m.Ro) / 2)] : [cx]; g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 2; for (const x of xs) { const ya = yc + dir * len / 2, yb = yc - dir * len / 2; g.beginPath(); g.moveTo(x, ya); g.lineTo(x, yb); g.stroke(); g.beginPath(); g.moveTo(x, yb - dir * 2); g.lineTo(x - hw, yb + dir * hw); g.lineTo(x + hw, yb + dir * hw); g.closePath(); g.fill(); } };
    if (!r.cup) {
      let bmax = 0; const nr = r.nr, nzc = r.nzc, sh = r.sh;
      for (let j = 0; j < nzc; j++) for (let i = 0; i < nr; i++) { if (r.F[j * nr + i]) continue; bmax = Math.max(bmax, Math.abs(r.bF[(j + sh) * nr + i])); }
      for (let j = 0; j < nzc; j++) { const z0 = r.zlo + j * r.dz; for (let i = 0; i < nr; i++) { const b = r.bF[(j + sh) * nr + i]; const a = Math.min(1, Math.sqrt(Math.abs(b) / (bmax || 1))) * 0.92; if (a < 0.02) continue; rect(i * r.dr, (i + 1) * r.dr + 1e-7, z0, z0 + r.dz + 1e-7, hexA(b > 0 ? cop : stl, a)); } }
      if (r.cfg.plate) rect(0, Rd, zlo, 0, iro);
      for (const mg of r.geom.mags) { rect(m.Ri, m.Ro, mg.z0, mg.z1, gra); arrow(mg.z0, mg.z1, mg.dir); }
      if ($('vc-showff').checked) { g.fillStyle = hexA(ink, 0.55); for (let j = 0; j < nzc; j++) for (let i = 0; i < nr; i++) if (r.ffMask[j * nr + i]) { const z = r.zlo + (j + .5) * r.dz, rr = (i + .5) * r.dr, s = Math.max(1.2, Math.min(r.dr, r.dz) * sc * 0.22); g.fillRect(X(rr) - s / 2, Y(z) - s / 2, s, s); g.fillRect(X(-rr) - s / 2, Y(z) - s / 2, s, s); } }
    } else {
      const cu = r.cup, rp = m.Ro, Lm = r.Lm, t = cu.t, gg = cu.g, Ro = cu.Rout; const zt = t / 2, zm1 = -t / 2, zm0 = zm1 - Lm, zb = zm0 - t; const lam = 0.45 * gg; const steps = 60;
      for (let k = 0; k < steps; k++) { const z0 = zlo + (zhi - zlo) * k / steps, z1 = zlo + (zhi - zlo) * (k + 1) / steps, zc = (z0 + z1) / 2, az = Math.abs(zc); const prof = az <= t / 2 ? 1 : Math.exp(-(az - t / 2) / lam); if (zc < zm0) continue; rect(rp, rp + gg, z0, z1 + 1e-7, hexA(cop, 0.9 * Math.sqrt(prof))); }
      rect(0, Ro, zb, zm0, iro); rect(rp + gg, Ro, zm0, zt, iro); rect(m.Ri, rp, zm1, zt, iro); rect(m.Ri, m.Ro, zm0, zm1, gra); arrow(zm0, zm1, 1);
    }
    const c = r.coil; g.lineWidth = 2; g.strokeStyle = ink; g.fillStyle = hexA(ink, 0.1);
    for (const s of [1, -1]) { const x0 = s > 0 ? X(c.rin) : X(-c.rout); const w = (c.rout - c.rin) * sc, y0 = Y(c.zb), h = Y(c.za) - Y(c.zb); g.fillRect(x0, y0, w, h); g.strokeRect(x0, y0, w, h);
      if (c.secRows && c.secs > 1) { g.save(); g.setLineDash([4, 3]); g.lineWidth = 1.5; let prev = c.secRows[0]; for (let k = 1; k < c.secRows.length; k++) { if (c.secRows[k] !== prev) { const z = c.za + k * r.dz; g.beginPath(); g.moveTo(x0, Y(z)); g.lineTo(x0 + w, Y(z)); g.stroke(); prev = c.secRows[k]; } } g.restore(); } }
    g.save(); g.setLineDash([2, 4]); g.strokeStyle = hexA(muted, 0.7); g.lineWidth = 1; g.beginPath(); g.moveTo(cx, 4); g.lineTo(cx, H - 4); g.stroke(); g.restore();
    const mm = Rd * 1e3 > 15 ? 5 : 2; const bx = 10, by = H - 14; g.strokeStyle = ink; g.lineWidth = 2; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + mm / 1e3 * sc, by); g.stroke(); g.fillStyle = ink; g.font = '500 12px "Golos Text",sans-serif'; g.fillText(mm + ' мм', bx, by - 6);
  }
  $('vc-showff').addEventListener('change', draw);
  let rw; window.addEventListener('resize', () => { clearTimeout(rw); rw = setTimeout(draw, 150); });
  $('vc-3d-slice').addEventListener('click', async () => {
    const r = results && results[selIdx]; if (!r || r.invalid || r.cup) return;
    const Rd = P.Rmax; const hz = (r.zhi - r.zlo) / 2, zc = (r.zhi + r.zlo) / 2; const plane = { o: [0, 0, zc], u: [1, 0, 0], v: [0, 0, 1], hu: Rd, hv: hz, nu: 72, nv: 72, comp: 'mag', coils: false };
    $('vc-status').textContent = 'Срез…'; try { const sl = await worker.run('slice', { vc: { result: { ...r, bF: null, F: null, ffMask: null }, P }, plane }); view.setSlice(sl, plane); $('vc-status').textContent = 'Готово'; } catch (e) { $('vc-status').textContent = e.message; }
  });
  run();
  return { state: st, setState(s) { Object.assign(st, s); forms.forEach(f => f.refresh()); run(); }, redraw: draw, view };
}
