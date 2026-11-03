'use strict';
/* =====================================================================
   ui.js – componentes de interface próprios (nada com aparência nativa):
   caixa de confirmação, menu suspenso, calendário e painel de informações.
   Carregado ANTES do app.js. Usa helpers do app.js (pad, today, esc) só em tempo de execução.
   ===================================================================== */
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const byId = (id) => document.getElementById(id);

/** Caixa de confirmação estilizada. Retorna Promise<boolean> (substitui window.confirm). */
function ask(msg, ok = 'Confirmar') {
  return new Promise((res) => {
    const d = document.createElement('dialog'); d.className = 'sm';
    d.innerHTML = '<h3></h3><div class="actions"><button type="button" class="btn ghost" data-v="0">Cancelar</button><button type="button" class="btn" data-v="1"></button></div>';
    d.querySelector('h3').textContent = msg; d.querySelector('[data-v="1"]').textContent = ok;
    d.addEventListener('click', (e) => { if (e.target.dataset.v) d.close(e.target.dataset.v); });
    d.addEventListener('close', () => { res(d.returnValue === '1'); d.remove(); });
    document.body.append(d); d.showModal(); d.querySelector('[data-v="1"]').focus();
  });
}

/** Painel de informações (histórico etc.). */
function showInfo(title, html) {
  let d = byId('info');
  if (!d) {
    d = document.createElement('dialog'); d.id = 'info'; d.className = 'wide';
    d.innerHTML = '<div class="hd"><h3></h3><button type="button" class="mini" data-close>Fechar</button></div><div class="body"></div>';
    d.addEventListener('click', (e) => e.target.hasAttribute('data-close') && d.close());
    document.body.append(d);
  }
  d.querySelector('h3').textContent = title; d.querySelector('.body').innerHTML = html;
  if (!d.open) d.showModal();
}

/* ---------- Popovers (menu e calendário ficam na "top layer", acima dos modais) ---------- */
function mkPop(id) { let el = byId(id); if (!el) { el = document.createElement('div'); el.id = id; el.popover = 'manual'; } return el; }
function closePops() { ['menu', 'cal'].forEach((id) => { const p = byId(id); if (p?.matches(':popover-open')) { p.hidePopover(); p._for?.setAttribute('aria-expanded', 'false'); } }); }
function place(el, btn) {
  closePops(); (btn.closest('dialog') || document.body).append(el); // dentro do modal para não ficar inerte
  el.style.minWidth = btn.offsetWidth + 'px'; el.showPopover();
  const r = btn.getBoundingClientRect(), h = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8)) + 'px';
  el.style.top = (r.bottom + h + 10 > innerHeight && r.top > h + 10 ? r.top - h - 6 : r.bottom + 6) + 'px';
  el._for = btn; btn.setAttribute('aria-expanded', 'true');
}
const isOpen = (el, btn) => el?.matches(':popover-open') && el._for === btn;
const fire = (el) => ['input', 'change'].forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
/** Faz o .value programático também atualizar o rótulo visível. */
function hookValue(el, proto, sync) {
  const d = Object.getOwnPropertyDescriptor(proto, 'value');
  Object.defineProperty(el, 'value', { get() { return d.get.call(this); }, set(v) { d.set.call(this, v); sync(); }, configurable: true });
}

/* ---------- Menu suspenso (substitui <select> nativo) ---------- */
function ddEnhance(sel) {
  sel.dataset.dd = '1'; sel.hidden = true;
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'dd'; btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<span></span>'; sel.after(btn);
  const sync = () => (btn.firstChild.textContent = sel.selectedOptions[0]?.text ?? '');
  hookValue(sel, HTMLSelectElement.prototype, sync); sync();
  new MutationObserver(sync).observe(sel, { childList: true });
  btn.onclick = () => {
    const menu = mkPop('menu'); if (isOpen(menu, btn)) return closePops();
    menu.setAttribute('role', 'listbox');
    menu.innerHTML = [...sel.options].map((o, i) => `<button type="button" role="option" data-i="${i}" ${o.selected ? 'aria-selected="true"' : ''}></button>`).join('');
    [...menu.children].forEach((b, i) => (b.textContent = sel.options[i].text));
    menu.onclick = (e) => { const i = e.target.dataset.i; if (i == null) return; sel.selectedIndex = +i; sync(); fire(sel); closePops(); btn.focus(); };
    menu.onkeydown = (e) => { const bs = [...menu.children], k = bs.indexOf(document.activeElement); if (e.key === 'ArrowDown') bs[Math.min(k + 1, bs.length - 1)].focus(); else if (e.key === 'ArrowUp') bs[Math.max(k - 1, 0)].focus(); else return; e.preventDefault(); };
    place(menu, btn); (menu.querySelector('[aria-selected]') || menu.firstChild)?.focus();
  };
}

/* ---------- Calendário (substitui <input type="date|month"> nativo) ---------- */
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
let cs = null; // estado do calendário aberto
function drawCal() {
  const cal = mkPop('cal'), { inp, mode, y, m } = cs, v = inp.value, t = today();
  let body;
  if (mode === 'month') body = MESES.map((n, i) => { const k = `${y}-${pad(i + 1)}`; return `<button type="button" data-pick="${k}" class="${k === v ? 'sel' : ''}${k === t.slice(0, 7) ? ' now' : ''}">${n}</button>`; }).join('');
  else {
    const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    body = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((x) => `<b>${x}</b>`).join('') + '<span></span>'.repeat(first) +
      Array.from({ length: days }, (_, i) => { const k = `${y}-${pad(m + 1)}-${pad(i + 1)}`; return `<button type="button" data-pick="${k}" class="${k === v ? 'sel' : ''}${k === t ? ' now' : ''}">${i + 1}</button>`; }).join('');
  }
  const title = mode === 'month' ? y : new Date(y, m, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  cal.innerHTML = `<div class="cal-h"><button type="button" data-nav="-1" aria-label="Anterior">‹</button><strong>${title}</strong><button type="button" data-nav="1" aria-label="Próximo">›</button></div>
    <div class="cg ${mode}">${body}</div><div class="cal-f"><button type="button" data-pick="${mode === 'month' ? t.slice(0, 7) : t}">Hoje</button><button type="button" data-pick="">Limpar</button></div>`;
  cal.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.nav) { const n = +b.dataset.nav; if (mode === 'month') cs.y += n; else { cs.m += n; if (cs.m > 11) { cs.m = 0; cs.y++; } if (cs.m < 0) { cs.m = 11; cs.y--; } } drawCal(); }
    else if (b.dataset.pick != null) { inp.value = b.dataset.pick; fire(inp); closePops(); cs.btn.focus(); }
  };
}
function dpEnhance(inp) {
  const mode = inp.type; inp.dataset.dp = mode; inp.type = 'hidden';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'dd dp'; btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false'); inp.after(btn);
  const fmt = (v) => (!v ? 'Selecionar…' : mode === 'month' ? new Date(v + '-01T12:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : v.split('-').reverse().join('/'));
  const sync = () => (btn.textContent = fmt(inp.value));
  hookValue(inp, HTMLInputElement.prototype, sync); sync();
  btn.onclick = () => {
    const cal = mkPop('cal'); if (isOpen(cal, btn)) return closePops();
    const v = inp.value, now = new Date();
    cs = { inp, btn, mode, y: +(v.slice(0, 4) || now.getFullYear()), m: +(v.slice(5, 7) || now.getMonth() + 1) - 1 };
    drawCal(); place(cal, btn);
  };
}

function enhanceAll() {
  $$('select:not([data-dd])').forEach(ddEnhance);
  $$('input[type=date]:not([data-dp]),input[type=month]:not([data-dp])').forEach(dpEnhance);
}
document.addEventListener('DOMContentLoaded', () => {
  enhanceAll(); new MutationObserver(enhanceAll).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', (e) => { if (!e.target.closest('#menu,#cal,.dd')) closePops(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ['menu', 'cal'].some((id) => byId(id)?.matches(':popover-open'))) { e.preventDefault(); e.stopPropagation(); closePops(); } }, true);
  addEventListener('resize', closePops);
});
