// App shell: tabs, panels, share links.
import { $, el, WorkerClient, decodeHash, encodeShare, copyText } from './common.js';
import { initVC } from './vcpanel.js';
import { initBLDC } from './bldcpanel.js';
import { initSPH } from './sphpanel.js';
import { initScene } from './scenepanel.js';

const workerUrl = new URL('../worker.js', import.meta.url);
const panels = {}; let active = 'vc'; const inited = {};
function initPanel(tab) {
  if (inited[tab]) return; inited[tab] = true;
  if (tab === 'vc') panels.vc = initVC(new WorkerClient(workerUrl));
  if (tab === 'bldc') panels.bldc = initBLDC(new WorkerClient(workerUrl));
  if (tab === 'sph') panels.sph = initSPH(new WorkerClient(workerUrl));
  if (tab === 'scene') panels.scene = initScene(new WorkerClient(workerUrl));
}
function selectTab(tab, pushHash = true) {
  active = tab;
  if (pushHash) { try { history.replaceState(null, '', '#' + tab); } catch (e) { } }
  document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + tab));
  initPanel(tab); try { localStorage.setItem('vcs2.tab', tab); } catch (e) { }
  requestAnimationFrame(() => { const p = panels[tab]; p?.view?.resize(); p?.redraw?.(); });
}
document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => selectTab(b.dataset.tab)));
// share / parameters panel (no prompt(), no downloads in the sandbox)
const shareBtn = el('button', { class: 'btn small secondary', style: 'margin-left:auto' }, 'Параметры');
const panel = el('div', { class: 'parampanel hidden' });
const ta = el('textarea', { rows: 8, spellcheck: 'false' });
const msg = el('span', { class: 'status' });
const btnLink = el('button', { class: 'btn small' }, 'Скопировать ссылку');
const btnCopy = el('button', { class: 'btn small secondary' }, 'Скопировать JSON');
const btnApply = el('button', { class: 'btn small secondary' }, 'Применить вставленное');
const btnClose = el('button', { class: 'btn small secondary' }, 'Закрыть');
panel.append(el('p', { class: 'hint', style: 'margin:0 0 6px' }, 'Параметры активной вкладки. Ссылка несёт их в адресе; JSON можно сохранить где угодно и вставить обратно.'), ta, el('div', { class: 'row', style: 'margin-top:8px' }, [btnLink, btnCopy, btnApply, btnClose, msg]));
document.querySelector('header.top').append(panel);
const flash = t => { msg.textContent = t; setTimeout(() => msg.textContent = '', 2000); };
shareBtn.addEventListener('click', () => { const p = panels[active]; if (!p) return; ta.value = JSON.stringify(p.state, null, 1); panel.classList.toggle('hidden'); });
btnLink.addEventListener('click', async () => { const p = panels[active]; if (!p) return; const url = await encodeShare(active, p.state); const ok = await copyText(url); flash(ok ? 'Ссылка скопирована' : 'Буфер недоступен — скопируй из поля'); if (!ok) ta.value = url; });
btnCopy.addEventListener('click', async () => { const ok = await copyText(ta.value); flash(ok ? 'JSON скопирован' : 'Выдели и скопируй вручную'); if (!ok) ta.select(); });
btnApply.addEventListener('click', () => { try { const s = JSON.parse(ta.value); panels[active]?.setState(s); flash('Применил'); } catch (e) { flash('Это не JSON'); } });
btnClose.addEventListener('click', () => panel.classList.add('hidden'));
document.querySelector('header.top .brand').append(shareBtn);
// start
const TABS = ['vc', 'bldc', 'sph', 'scene', 'help'];
(async () => {
  let saved = 'vc'; try { saved = localStorage.getItem('vcs2.tab') || 'vc'; } catch (e) { }
  const h = await decodeHash(); let start = (h && h.tab) || saved; if (!TABS.includes(start)) start = 'vc';
  selectTab(start, false);
  if (h && h.state && panels[h.tab]) { panels[h.tab].setState(h.state); try { history.replaceState(null, '', '#' + h.tab); } catch (e) { } }
})();
window.addEventListener('hashchange', async () => { const h = await decodeHash(); if (h && TABS.includes(h.tab) && h.tab !== active) selectTab(h.tab, false); });
window.addEventListener('error', e => { const s = document.querySelector('.tab.active .status'); if (s) s.textContent = 'Ошибка: ' + e.message; });
