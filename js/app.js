'use strict';
/* =====================================================================
   Caderno de Contas – gestão financeira pessoal
   Seções: 1 Estado/persistência · 2 Utilidades · 3 Formulário modal
           4 Painel · 5 Transações · 6 Orçamento · 7 Metas
           8 Investimentos · 9 Relatórios · 10 Navegação e eventos
   ===================================================================== */

/* ---------- 1. ESTADO E PERSISTÊNCIA (localStorage) ---------- */
const KEY = 'caderno_contas_v1';
const CATS_DESPESA = ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Compras', 'Contas', 'Outros'];
const CATS_RECEITA = ['Salário', 'Freelance', 'Rendimentos', 'Outros'];
const TIPOS_INV = ['Renda fixa', 'Ações', 'Fundos', 'FIIs', 'Cripto', 'Outros'];
const KINDS = ['Renda', 'Gasto fixo', 'Gasto variável'];

/** Lê os dados salvos; se não houver (ou estiverem corrompidos), começa vazio. */
function load() {
  const base = { transactions: [], budgets: {}, goals: [], investments: [] };
  try { return Object.assign(base, JSON.parse(localStorage.getItem(KEY))); } catch { return base; }
}
let state = load();

/** Salva no navegador e redesenha a tela. */
function save() { applyRecurring(); localStorage.setItem(KEY, JSON.stringify(state)); renderAll(); }

/* ---------- 2. UTILIDADES ---------- */
const $ = (s) => document.querySelector(s);
const brl = (v) => (+v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => d.split('-').reverse().join('/');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthOf = (d) => d.slice(0, 7);
/** Soma n meses a um "AAAA-MM". */
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const monthLabel = (ym) => { const [y, m] = ym.split('-'); return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }); };
const curMonth = () => $('#month').value || today().slice(0, 7);
const inMonth = (ym) => state.transactions.filter((t) => monthOf(t.date) === ym);
const sum = (list, type) => list.filter((t) => t.type === type && !(type === 'receita' && t.paid === false)).reduce((a, t) => a + t.amount, 0);
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const card = (label, value, cls = '', extra = '') => `<div class="card ${cls}"><small>${label}</small><strong>${value}</strong>${extra}</div>`;
const bar = (p) => `<div class="prog ${p > 100 ? 'over' : p >= 80 ? 'warn' : ''}"><i style="width:${Math.min(p, 100)}%"></i></div>`;
const empty = (cols, msg) => `<tr><td class="empty" colspan="${cols}">${msg}</td></tr>`;
const catList = () => [...new Set([...CATS_RECEITA, ...CATS_DESPESA])];

/* ---------- 2b. PAGAMENTOS, ALERTAS, RECORRÊNCIAS E TEMA ---------- */
const METHODS = ['Pix', 'Transferência', 'Boleto', 'Cartão', 'Dinheiro', 'Débito automático', 'Outro'];
const r2c = (x) => Math.round(x * 100) / 100;
const remaining = (t) => t.amount - (t.paidAmount || 0);
const STATUS = { pago: 'Pago', pendente: 'A vencer', proximo: 'Vence em breve', vencido: 'Vencido' };
/** Situação de uma despesa. Lançamentos antigos (sem campo "paid") contam como pagos. */
function status(t) {
  if (t.type !== 'despesa') return '';
  if (t.paid !== false) return 'pago';
  const diff = (new Date(t.due || t.date) - new Date(today())) / 864e5;
  return diff < 0 ? 'vencido' : diff <= 7 ? 'proximo' : 'pendente';
}
const badge = (t) => { if (t.type === 'receita') return t.paid === false ? '<span class="badge proximo">A receber</span>' : '<span class="badge pago">Recebido</span>'; const s = status(t); return s ? `<span class="badge ${s}">${s === 'pago' && t.paidDate ? 'Pago em ' + fmtDate(t.paidDate) : t.paidAmount && s !== 'pago' ? STATUS[s] + ' · parcial (pago ' + brl(t.paidAmount) + ')' : STATUS[s]}</span>` : ''; };
const openSum = (...k) => state.transactions.filter((t) => k.includes(status(t))).reduce((a, t) => a + remaining(t), 0);

/** Notificação temporária no canto da tela. */
function toast(msg, type = 'ok') {
  const el = Object.assign(document.createElement('div'), { className: 'toast ' + type, textContent: msg });
  $('#toasts').append(el); setTimeout(() => el.remove(), 3800);
}
/** Faixa de alertas (contas vencidas/próximas e orçamentos) exibida em todas as telas. */
function renderAlerts() {
  const msgs = [], n = (s) => state.transactions.filter((t) => status(t) === s).length;
  if (n('vencido')) msgs.push(['neg', `${n('vencido')} conta(s) vencida(s) somando ${brl(openSum('vencido'))}`]);
  if (n('proximo')) msgs.push(['warn', `${n('proximo')} conta(s) vencem nos próximos 7 dias (${brl(openSum('proximo'))})`]);
  const list = inMonth(today().slice(0, 7)).filter((t) => t.type === 'despesa');
  CATS_DESPESA.forEach((c) => {
    const b = state.budgets[c]; if (!b) return;
    const p = pct(list.filter((t) => t.category === c).reduce((a, t) => a + t.amount, 0), b);
    if (p >= 100) msgs.push(['neg', `Orçamento de ${c} estourado (${p.toFixed(0)}%)`]);
    else if (p >= 80) msgs.push(['warn', `${c}: ${p.toFixed(0)}% do orçamento do mês já foi usado`]);
  });
  if (typeof debtAlerts === 'function') msgs.push(...debtAlerts());
  $('#alerts').innerHTML = msgs.map(([c, m]) => `<div class="alert ${c}">${m}</div>`).join('');
}
function budgetToast(t) {
  const b = state.budgets[t.category]; if (t.type !== 'despesa' || !b) return;
  const p = pct(inMonth(monthOf(t.date)).filter((x) => x.type === 'despesa' && x.category === t.category).reduce((a, x) => a + x.amount, 0), b);
  if (p >= 100) toast(`Orçamento de ${t.category} estourado (${p.toFixed(0)}%)`, 'neg'); else if (p >= 80) toast(`${t.category}: ${p.toFixed(0)}% do orçamento`, 'warn');
}
/** Gera os lançamentos de parcelas/assinaturas/recorrências (idempotente: nunca duplica o mesmo mês). */
function applyRecurring() {
  state.recurring ||= [];
  const limit = addMonths(today().slice(0, 7), 1);
  state.recurring.forEach((r) => {
    const n = r.count || 0, first = r.start.slice(0, 7), last = n ? addMonths(first, n - 1) : limit;
    for (let m = first, i = 1; m <= last; m = addMonths(m, 1), i++) {
      if ((r.skip || []).includes(m) || state.transactions.some((t) => t.ruleId === r.id && t.ym === m)) continue;
      const due = `${m}-${pad(Math.min(+r.start.slice(8), 28))}`;
      state.transactions.push({ id: uid(), ruleId: r.id, ym: m, kind: r.mode === 'Parcelado' ? 'Gasto variável' : 'Gasto fixo', type: 'despesa',
        desc: r.mode === 'Parcelado' ? `${r.desc} (${i}/${n})` : r.desc, amount: r.amount, category: r.category, date: due, due, paid: false, paidDate: '' });
    }
  });
}
/** Tema: claro/escuro + cor de destaque (salvo à parte em localStorage). */
const prefs = Object.assign({ theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', accent: '#2f5fd0' }, JSON.parse(localStorage.getItem('caderno_prefs') || '{}'));
function applyPrefs() {
  document.documentElement.dataset.theme = prefs.theme;
  document.documentElement.style.setProperty('--primary', prefs.accent);
  localStorage.setItem('caderno_prefs', JSON.stringify(prefs)); renderAll();
}
const statusCards = (list) => {
  const s = (...k) => list.filter((t) => k.includes(status(t))).reduce((a, t) => a + (k.includes('pago') ? t.amount : remaining(t)), 0);
  return card('Despesas pagas', brl(s('pago')), 'pos') + card('A pagar no mês', brl(s('pendente', 'proximo', 'vencido')), 'warn') + card('Vencidas (total)', brl(openSum('vencido')), 'neg');
};
/** Gráfico de status + tabela de contas vencidas/próximas do vencimento. */
function renderPending(list) {
  const by = (s) => list.filter((t) => status(t) === s).reduce((a, t) => a + (s === 'pago' ? t.amount : remaining(t)), 0);
  draw('ch-status', { type: 'doughnut', data: { labels: ['Pagas', 'A vencer', 'Vencem em breve', 'Vencidas'], datasets: [{ data: [by('pago'), by('pendente'), by('proximo'), by('vencido')], backgroundColor: ['#138a63', '#7f8da0', '#d98a12', '#d6455d'] }] },
    options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.label}: ${brl(c.parsed)}` } } } } });
  const open = state.transactions.filter((t) => ['vencido', 'proximo'].includes(status(t))).sort((a, b) => (a.due || a.date).localeCompare(b.due || b.date)).slice(0, 8);
  $('#pending').innerHTML = open.map((t) => `<tr class="${status(t) === 'vencido' ? 'late' : ''}"><td>${esc(t.desc)}</td><td>${fmtDate(t.due || t.date)}</td><td>${badge(t)}</td><td class="num">${brl(t.amount)}</td>
    <td><button class="mini" data-act="pay-tx" data-id="${t.id}">Pagar</button></td></tr>`).join('') || empty(5, 'Nenhuma conta vencida ou próxima do vencimento.');
}

/** Cria/recria um gráfico Chart.js (e avisa se a biblioteca não carregou). */
const charts = {};
function draw(id, cfg) {
  if (typeof Chart === 'undefined') { $('#' + id).parentElement.textContent = 'Gráfico indisponível: conecte-se à internet para carregar o Chart.js.'; return; }
  const css = getComputedStyle(document.documentElement);
  Chart.defaults.color = css.getPropertyValue('--ink'); Chart.defaults.borderColor = css.getPropertyValue('--line');
  charts[id]?.destroy();
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false }, cfg.options);
  charts[id] = new Chart($('#' + id), cfg);
}
const money = { ticks: { callback: (v) => brl(v) } };
const tip = { plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label || c.label}: ${brl(c.parsed.y ?? c.parsed)}` } } } };
const COLORS = ['#2f5fd0', '#138a63', '#d6455d', '#d98a12', '#7c4dcc', '#0e9bb5', '#c2559a', '#5b7083', '#8aa31f'];

/* ---------- 3. FORMULÁRIO MODAL GENÉRICO COM VALIDAÇÃO ---------- */
/**
 * fields: [{name,label,type:'text|number|date|select',options,required}]
 * Valida ao enviar; chama onSave(dados) só se tudo estiver correto.
 */
function openForm(title, fields, values, onSave) {
  const dlg = $('#modal'), form = $('#modal-form');
  $('#modal-title').textContent = title;
  form.innerHTML = fields.map((f) => {
    const v = values[f.name] ?? '';
    const input = f.type === 'textarea' ? `<textarea name="${f.name}" rows="6">${esc(v)}</textarea>` : f.type === 'select'
      ? `<select name="${f.name}">${(f.options || []).map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`
      : `<input name="${f.name}" type="${f.type}" value="${esc(v)}" ${f.type === 'number' ? 'step="0.01"' : ''}>`;
    return `<label>${f.label}${input}<small class="msg" data-for="${f.name}"></small></label>`;
  }).join('') + `<div class="actions"><button type="button" class="btn ghost" id="cancel">Cancelar</button><button class="btn">Salvar</button></div>`;

  $('#cancel').onclick = () => dlg.close();
  form.onsubmit = (e) => {
    e.preventDefault();
    const data = {}; let ok = true;
    fields.forEach((f) => {
      const el = form.elements[f.name]; let val = el.value.trim(), msg = '';
      if (f.required && !val) msg = 'Campo obrigatório.';
      else if (f.type === 'number' && val && !(f.zero ? +val >= 0 : +val > 0)) msg = f.zero ? 'Não use valores negativos.' : 'Informe um valor maior que zero.';
      else if (f.type === 'date' && val && isNaN(new Date(val))) msg = 'Data inválida.';
      else if (f.check) msg = f.check(val, form) || '';
      form.querySelector(`[data-for="${f.name}"]`).textContent = msg;
      el.classList.toggle('err', !!msg);
      if (msg) ok = false;
      data[f.name] = f.type === 'number' ? +val : val;
    });
    if (!ok) return;
    dlg.close(); onSave(data);
  };
  dlg.showModal();
  return form;
}

/* ---------- 4. PAINEL ---------- */
function renderDashboard() {
  const ym = curMonth(), list = inMonth(ym);
  const rec = sum(list, 'receita'), des = sum(list, 'despesa'), saldo = rec - des;
  $('#cards').innerHTML =
    card('Receitas do mês', brl(rec), 'pos', pendInc(list)) + card('Despesas do mês', brl(des), 'neg') +
    card('Saldo do mês', brl(saldo), saldo >= 0 ? 'pos' : 'neg') +
    card('Taxa de economia', rec ? pct(saldo, rec).toFixed(1) + '%' : '—', 'pri') + statusCards(list);

  renderPending(list); renderBalances();
  if (typeof renderExtras === 'function') renderExtras(list, ym);
  // Barras: últimos 6 meses
  const m6 = Array.from({ length: 6 }, (_, i) => addMonths(ym, i - 5));
  draw('ch-bars', { type: 'bar', data: { labels: m6.map(monthLabel), datasets: [
    { label: 'Receitas', data: m6.map((m) => sum(inMonth(m), 'receita')), backgroundColor: '#138a63' },
    { label: 'Despesas', data: m6.map((m) => sum(inMonth(m), 'despesa')), backgroundColor: '#d6455d' }] },
    options: { scales: { y: money }, ...tip } });

  // Rosca: despesas por categoria no mês
  const byCat = CATS_DESPESA.map((c) => list.filter((t) => t.type === 'despesa' && t.category === c).reduce((a, t) => a + t.amount, 0));
  draw('ch-cat', { type: 'doughnut', data: { labels: CATS_DESPESA, datasets: [{ data: byCat, backgroundColor: COLORS }] },
    options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.label}: ${brl(c.parsed)}` } } } } });

  // Linha: saldo acumulado até o fim de cada mês (12 meses)
  const m12 = Array.from({ length: 12 }, (_, i) => addMonths(ym, i - 11));
  const acc = m12.map((m) => { const l = state.transactions.filter((t) => monthOf(t.date) <= m); return sum(l, 'receita') - sum(l, 'despesa'); });
  draw('ch-line', { type: 'line', data: { labels: m12.map(monthLabel), datasets: [{ label: 'Saldo acumulado', data: acc, borderColor: '#2f5fd0', backgroundColor: 'rgba(47,95,208,.15)', fill: true, tension: .3 }] },
    options: { scales: { y: money }, ...tip } });

  // Comparação entre dois meses
  const cmpEl = $('#cmp-month'); if (!cmpEl.value) cmpEl.value = addMonths(ym, -1);
  const b = inMonth(cmpEl.value), brec = sum(b, 'receita'), bdes = sum(b, 'despesa');
  const row = (name, a, c, goodUp) => {
    const d = a - c, p = c ? (d / c) * 100 : 0, good = goodUp ? d >= 0 : d <= 0;
    return `<tr><td>${name}</td><td class="num">${brl(a)}</td><td class="num">${brl(c)}</td><td class="num ${d === 0 ? '' : good ? 'pos' : 'neg'}">${d >= 0 ? '+' : ''}${brl(d)} ${c ? `(${p.toFixed(1)}%)` : ''}</td></tr>`;
  };
  $('#cmp-table').innerHTML = `<tr><th></th><th class="num">${monthLabel(ym)}</th><th class="num">${monthLabel(cmpEl.value)}</th><th class="num">Diferença</th></tr>` +
    row('Receitas', rec, brec, true) + row('Despesas', des, bdes, false) + row('Saldo', saldo, brec - bdes, true);
}

/* ---------- 5. TRANSAÇÕES (adicionar, editar, excluir, filtrar) ---------- */
const TX_HEAD = '<tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Tipo</th><th>Vencimento</th><th>Status</th><th class="num">Valor</th><th></th></tr>';
/** Linha de um lançamento (usada em Transações e em Contas a pagar). */
function txRow(t) {
  const st = status(t);
  return `<tr class="${st === 'vencido' ? 'late' : t.type === 'receita' && t.paid === false ? 'future' : ''}"><td>${fmtDate(t.date)}</td><td>${esc(t.desc)}${t.ruleId ? ' <small title="Gerado por parcela/recorrência">↻</small>' : ''}</td><td><span class="tag">${esc(t.category)}</span></td><td>${t.kind}</td>
    <td>${st ? fmtDate(t.due || t.date) : '—'}</td><td>${badge(t)}</td>
    <td class="num ${t.type === 'receita' ? 'pos' : 'neg'}">${t.type === 'receita' ? '+' : '−'} ${brl(t.amount)}</td>
    <td>${st || t.type === 'receita' ? `<button class="mini" data-act="pay-tx" data-id="${t.id}">${t.type === 'receita' ? (t.paid === false ? 'Receber' : 'Desfazer') : st === 'pago' ? 'Desfazer' : 'Pagar'}</button> ` : ''}<button class="mini" data-act="dup-tx" data-id="${t.id}">Duplicar</button> <button class="mini" data-act="edit-tx" data-id="${t.id}">Editar</button> <button class="mini del" data-act="del-tx" data-id="${t.id}">Excluir</button></td></tr>`;
}
function renderTransactions() {
  const ym = curMonth(), q = $('#f-search').value.toLowerCase(), k = $('#f-kind').value, c = $('#f-cat').value, s = $('#f-status').value, all = $('#f-all').checked;
  const fr = $('#f-from').value, to = $('#f-to').value;   // intervalo de datas (tem prioridade sobre o mês)
  const list = state.transactions
    .filter((t) => (fr || to ? (!fr || t.date >= fr) && (!to || t.date <= to) : all || monthOf(t.date) === ym) && (!k || t.kind === k) && (!c || t.category === c) && (!s || (s === 'areceber' ? t.type === 'receita' && t.paid === false : status(t) === s)) && t.desc.toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date));
  $('#tx-table').innerHTML = TX_HEAD + (list.map(txRow).join('') || empty(8, 'Nenhum lançamento neste período. Clique em “+ Novo lançamento” para começar.'));
}
/** Tela "Contas a pagar": só despesas em aberto (inclui as parcialmente pagas), da mais antiga para a mais recente. */
function renderPayments() {
  const l = state.transactions.filter((t) => ['vencido', 'proximo', 'pendente'].includes(status(t))).sort((a, b) => (a.due || a.date).localeCompare(b.due || b.date));
  $('#pay-cards').innerHTML = card('Vencidas', brl(openSum('vencido')), openSum('vencido') ? 'neg' : 'pri') + card('Vencem em 7 dias', brl(openSum('proximo')), 'warn') + card('A vencer depois', brl(openSum('pendente')), 'pri');
  $('#pay-table').innerHTML = TX_HEAD + (l.map(txRow).join('') || empty(8, 'Nenhuma conta pendente. Tudo pago!'));
  const inc = state.transactions.filter((t) => t.type === 'receita' && t.paid === false).sort((a, b) => a.date.localeCompare(b.date));
  $('#inc-table').innerHTML = TX_HEAD + (inc.map(txRow).join('') || empty(8, 'Nenhuma receita futura lançada.'));
}
/** Sino do cabeçalho: quantas contas estão vencidas ou vencem em até 7 dias. */
function updateBell() {
  const n = state.transactions.filter((t) => ['vencido', 'proximo'].includes(status(t))).length;
  $('#bell-n').textContent = n; $('#bell').classList.toggle('has', n > 0);
}

function editTransaction(id) {
  const t = state.transactions.find((x) => x.id === id) || { kind: 'Gasto variável', date: today() };
  const form = openForm(id ? 'Editar lançamento' : 'Novo lançamento', [
    { name: 'kind', label: 'Tipo', type: 'select', options: KINDS },
    { name: 'desc', label: 'Descrição', type: 'text', required: true },
    { name: 'amount', label: 'Valor (R$)', type: 'number', required: true },
    { name: 'category', label: 'Categoria', type: 'select', options: [] },
    { name: 'date', label: 'Data (lançamento ou recebimento previsto)', type: 'date', required: true },
    { name: 'due', label: 'Data de vencimento', type: 'date' },
    { name: 'pay', label: 'Situação do pagamento', type: 'select', options: ['Pago', 'Não pago'] },
    { name: 'paidDate', label: 'Data do pagamento', type: 'date' },
    { name: 'rec', label: 'Situação da receita', type: 'select', options: ['Recebido', 'A receber'] },
  ], { ...t, rec: t.paid === false ? 'A receber' : 'Recebido', due: t.due || t.date, pay: t.paid === false ? 'Não pago' : 'Pago', paidDate: t.paidDate || (id ? '' : today()) }, (d) => {
    const exp = d.kind !== 'Renda', paid = exp ? d.pay === 'Pago' : d.rec === 'Recebido' && d.date <= today();
    const item = { ...(t.ruleId ? { ruleId: t.ruleId, ym: t.ym } : {}), ...(t.paidAmount ? { paidAmount: t.paidAmount, payments: t.payments } : {}), id: id || uid(), kind: d.kind, type: exp ? 'despesa' : 'receita', desc: d.desc, amount: d.amount,
      category: d.category, date: d.date, due: exp ? d.due || d.date : '', paid, paidDate: paid ? (exp ? d.paidDate || d.date : d.date) : '' };
    state.transactions = id ? state.transactions.map((x) => (x.id === id ? item : x)) : [...state.transactions, item];
    const fut = !exp && d.rec === 'Recebido' && !paid; save(); toast(fut ? 'Data futura: lançada como “A receber”.' : id ? 'Lançamento atualizado' : 'Lançamento salvo', fut ? 'warn' : 'ok'); budgetToast(item);
  });
  const el = form.elements;
  // Categorias mudam conforme o tipo; campos de pagamento só aparecem para despesas
  const syncCat = () => { const o = el.kind.value === 'Renda' ? CATS_RECEITA : CATS_DESPESA; el.category.innerHTML = o.map((x) => `<option ${x === t.category ? 'selected' : ''}>${x}</option>`).join(''); };
  const vis = () => { const inc = el.kind.value === 'Renda'; ['due', 'pay'].forEach((n) => (el[n].closest('label').hidden = inc)); el.rec.closest('label').hidden = !inc; el.paidDate.closest('label').hidden = inc || el.pay.value !== 'Pago'; };
  el.kind.addEventListener('change', () => { t.category = ''; syncCat(); vis(); });
  el.pay.addEventListener('change', vis);
  el.date.addEventListener('input', () => { if (el.kind.value === 'Renda' && el.date.value > today()) el.rec.value = 'A receber'; }); // data futura = a receber
  syncCat(); vis();
}

let lastBal = { now: 0, future: 0, owed: 0 };
/** Saldo REAL (só o que já entrou e já foi pago) separado do saldo PREVISTO (inclui receitas futuras). */
function renderBalances() {
  const T = state.transactions, sumOf = (f, g) => T.filter(f).reduce((a, t) => a + g(t), 0);
  const got = sumOf((t) => t.type === 'receita' && t.paid !== false, (t) => t.amount);
  const spent = sumOf((t) => t.type === 'despesa', (t) => (status(t) === 'pago' ? t.amount : t.paidAmount || 0));
  const future = sumOf((t) => t.type === 'receita' && t.paid === false, (t) => t.amount);
  const owed = sumOf((t) => t.type === 'despesa' && status(t) !== 'pago', remaining), now = got - spent;
  lastBal = { now, future, owed };
  $('#cards-bal').innerHTML = card('Saldo atual (em conta)', brl(now), now >= 0 ? 'pos' : 'neg', '<small>Só o que já foi recebido e pago</small>') +
    card('A receber (futuro)', brl(future), 'fut', '<small>Ainda não entrou — não está no saldo atual</small>') +
    card('Saldo previsto', brl(now + future - owed), 'fut', `<small>Saldo atual + a receber − contas em aberto (${brl(owed)})</small>`);
}
/** Aviso no card de receitas do mês: quanto ainda vai entrar. */
const pendInc = (list) => { const v = list.filter((t) => t.type === 'receita' && t.paid === false).reduce((a, t) => a + t.amount, 0); return v ? `<small>+ ${brl(v)} a receber (previsto)</small>` : ''; };

/** Pagamento de conta: aceita qualquer valor (parcial ou total) e registra cada pagamento. */
function payTx(id) {
  const t = state.transactions.find((x) => x.id === id);
  if (t.type === 'receita') { const got = t.paid !== false; Object.assign(t, got ? { paid: false, paidDate: '' } : { paid: true, paidDate: today() }); save(); toast(got ? 'Recebimento desfeito' : 'Receita marcada como recebida'); return; }
  if (status(t) === 'pago') { Object.assign(t, { paid: false, paidDate: '', paidAmount: 0, payments: [] }); save(); toast('Pagamento desfeito'); return; }
  const rest = r2c(remaining(t));
  openForm('Registrar pagamento', [
    { name: 'v', label: `Valor pago (saldo da conta: ${brl(rest)})`, type: 'number', required: true },
    { name: 'date', label: 'Data do pagamento', type: 'date', required: true, check: (v) => (v > today() ? 'A data não pode ser futura.' : '') },
    { name: 'method', label: 'Forma de pagamento', type: 'select', options: METHODS },
  ], { v: rest, date: today(), method: METHODS[0] }, async (d) => {
    if (d.v > rest + 0.005 && !(await ask(`O valor excede o saldo de ${brl(rest)}. Registrar mesmo assim?`, 'Registrar'))) return;
    const v = Math.min(d.v, rest);
    t.payments = [...(t.payments || []), { id: uid(), date: d.date, amount: v, method: d.method }];
    t.paidAmount = r2c((t.paidAmount || 0) + v); t.due = t.due || t.date;
    if (t.amount - t.paidAmount <= 0.005) Object.assign(t, { paid: true, paidDate: d.date });
    save(); toast(t.paid ? 'Conta quitada' : `Pagamento parcial de ${brl(v)} registrado. Restam ${brl(remaining(t))}`);
  });
}
/** Exclui um lançamento (com confirmação); se veio de recorrência, não será gerado de novo. */
async function delTx(id) {
  const t = state.transactions.find((x) => x.id === id);
  if (!(await ask(`Excluir “${t.desc}”?`, 'Excluir'))) return;
  const r = t.ruleId && state.recurring.find((x) => x.id === t.ruleId); if (r) r.skip = [...(r.skip || []), t.ym];
  state.transactions = state.transactions.filter((x) => x.id !== id); save(); toast('Lançamento excluído');
}

/* ---------- 5b. PARCELAS, ASSINATURAS E RECORRÊNCIAS ---------- */
function renderRecurring() {
  $('#rec-table').innerHTML = `<tr><th>Tipo</th><th>Descrição</th><th>Categoria</th><th class="num">Valor</th><th>1º vencimento</th><th>Pagas</th><th></th></tr>` +
    ((state.recurring || []).map((r) => { const paid = state.transactions.filter((t) => t.ruleId === r.id && status(t) === 'pago').length;
      return `<tr><td><span class="tag">${r.mode}</span></td><td>${esc(r.desc)}</td><td>${r.category}</td><td class="num">${brl(r.amount)}</td><td>${fmtDate(r.start)}</td><td>${paid}/${r.count || '∞'}</td>
      <td><button class="mini" data-act="edit-rec" data-id="${r.id}">Editar</button> <button class="mini del" data-act="del-rec" data-id="${r.id}">Excluir</button></td></tr>`; }).join('')
      || empty(7, 'Nada cadastrado. Use “+ Nova parcela/recorrência” para uma compra parcelada ou assinatura.'));
}
function editRecurring(id) {
  const r = (state.recurring || []).find((x) => x.id === id) || { start: today(), mode: 'Assinatura' };
  openForm(id ? 'Editar parcela/recorrência' : 'Nova parcela/recorrência', [
    { name: 'mode', label: 'Tipo', type: 'select', options: ['Parcelado', 'Assinatura', 'Recorrente'] },
    { name: 'desc', label: 'Descrição', type: 'text', required: true },
    { name: 'amount', label: 'Valor da parcela/mensalidade (R$)', type: 'number', required: true },
    { name: 'category', label: 'Categoria', type: 'select', options: CATS_DESPESA },
    { name: 'start', label: '1º vencimento', type: 'date', required: true },
    { name: 'count', label: 'Nº de parcelas (vazio = sem fim)', type: 'number',
      check: (v, f) => (f.elements.mode.value === 'Parcelado' && !v ? 'Informe o número de parcelas.' : v && !Number.isInteger(+v) ? 'Use um número inteiro.' : '') },
  ], r, (d) => {
    const item = { id: id || uid(), mode: d.mode, desc: d.desc, amount: d.amount, category: d.category, start: d.start, count: d.count || 0, skip: [] };
    state.recurring ||= [];
    if (id) { state.transactions = state.transactions.filter((t) => t.ruleId !== id || status(t) === 'pago'); state.recurring = state.recurring.map((x) => (x.id === id ? item : x)); }
    else state.recurring.push(item);
    save(); toast('Salvo. Lançamentos mensais gerados.');
  });
}
async function delRec(id) {
  if (!(await ask('Excluir esta recorrência e seus lançamentos ainda não pagos?', 'Excluir'))) return;
  state.recurring = state.recurring.filter((x) => x.id !== id);
  state.transactions = state.transactions.filter((t) => t.ruleId !== id || status(t) === 'pago'); save(); toast('Recorrência excluída');
}

/* ---------- 6. ORÇAMENTO MENSAL ---------- */
function renderBudget() {
  const list = inMonth(curMonth()).filter((t) => t.type === 'despesa');
  let tb = 0, ts = 0;
  const rows = CATS_DESPESA.map((c) => {
    const budget = state.budgets[c] || 0, spent = list.filter((t) => t.category === c).reduce((a, t) => a + t.amount, 0), p = pct(spent, budget);
    tb += budget; ts += spent;
    return `<tr><td>${c}</td><td class="num"><input class="bud-in" type="number" min="0" step="0.01" data-bud="${c}" value="${budget || ''}" placeholder="0,00" aria-label="Limite de ${c}"></td>
      <td class="num">${brl(spent)}</td><td class="num ${budget - spent < 0 ? 'neg' : ''}">${budget ? brl(budget - spent) : '—'}</td><td>${budget ? bar(p) + ` <small>${p.toFixed(0)}%</small>` : ''}</td></tr>`;
  }).join('');
  $('#bud-table').innerHTML = `<tr><th>Categoria</th><th class="num">Limite</th><th class="num">Gasto</th><th class="num">Restante</th><th>Uso</th></tr>${rows}
    <tr><th>Total</th><th class="num">${brl(tb)}</th><th class="num">${brl(ts)}</th><th class="num">${brl(tb - ts)}</th><th></th></tr>`;
}

/* ---------- 7. METAS DE ECONOMIA ---------- */
function renderGoals() {
  $('#goals').innerHTML = state.goals.map((g) => {
    const p = pct(g.saved, g.target), left = Math.max(g.target - g.saved, 0);
    let plan = '';
    if (g.deadline && left > 0) {
      const months = Math.max((new Date(g.deadline) - new Date()) / 2629800000, 1);
      plan = `<small>Guarde ${brl(left / Math.ceil(months))}/mês até ${fmtDate(g.deadline)}</small>`;
    }
    return card(esc(g.name), `${brl(g.saved)} <small>de ${brl(g.target)}</small>`, p >= 100 ? 'pos' : 'pri',
      `${bar(p)}<small>${p.toFixed(0)}% concluído</small><br>${plan}
       <div class="row"><button class="mini" data-act="aporte" data-id="${g.id}">+ Aporte</button><button class="mini" data-act="edit-goal" data-id="${g.id}">Editar</button><button class="mini del" data-act="del-goal" data-id="${g.id}">Excluir</button></div>`);
  }).join('') || '<p class="hint">Nenhuma meta ainda. Crie a primeira em “+ Nova meta”.</p>';
}
function editGoal(id) {
  const g = state.goals.find((x) => x.id === id) || {};
  openForm(id ? 'Editar meta' : 'Nova meta', [
    { name: 'name', label: 'Nome da meta', type: 'text', required: true },
    { name: 'target', label: 'Valor da meta (R$)', type: 'number', required: true },
    { name: 'saved', label: 'Já guardado (R$)', type: 'number' },
    { name: 'deadline', label: 'Prazo (opcional)', type: 'date' },
  ], g, (d) => {
    const item = { id: id || uid(), name: d.name, target: d.target, saved: d.saved || 0, deadline: d.deadline };
    state.goals = id ? state.goals.map((x) => (x.id === id ? item : x)) : [...state.goals, item];
    save();
  });
}
function addAporte(id) {
  openForm('Novo aporte', [{ name: 'v', label: 'Valor guardado (R$)', type: 'number', required: true }], {}, (d) => {
    state.goals.find((g) => g.id === id).saved += d.v; save();
  });
}

/* ---------- 8. INVESTIMENTOS ---------- */
function renderInvestments() {
  const inv = state.investments, tot = inv.reduce((a, i) => a + i.invested, 0), cur = inv.reduce((a, i) => a + i.current, 0), gain = cur - tot;
  $('#inv-cards').innerHTML = card('Total aplicado', brl(tot), 'pri') + card('Valor atual', brl(cur), 'pri') +
    card('Rentabilidade', `${gain >= 0 ? '+' : ''}${brl(gain)} <small>${pct(gain, tot).toFixed(1)}%</small>`, gain >= 0 ? 'pos' : 'neg');
  $('#inv-table').innerHTML = `<tr><th>Nome</th><th>Tipo</th><th class="num">Aplicado</th><th class="num">Atual</th><th class="num">Retorno</th><th></th></tr>` +
    (inv.map((i) => { const g = i.current - i.invested; return `<tr><td>${esc(i.name)}</td><td><span class="tag">${i.type}</span></td><td class="num">${brl(i.invested)}</td><td class="num">${brl(i.current)}</td>
      <td class="num ${g >= 0 ? 'pos' : 'neg'}">${pct(g, i.invested).toFixed(1)}%</td>
      <td><button class="mini" data-act="edit-inv" data-id="${i.id}">Editar</button> <button class="mini del" data-act="del-inv" data-id="${i.id}">Excluir</button></td></tr>`; }).join('') || empty(6, 'Nenhum investimento cadastrado.'));
  draw('ch-inv', { type: 'doughnut', data: { labels: TIPOS_INV, datasets: [{ data: TIPOS_INV.map((t) => inv.filter((i) => i.type === t).reduce((a, i) => a + i.current, 0)), backgroundColor: COLORS }] },
    options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.label}: ${brl(c.parsed)}` } } } } });
}
function editInvestment(id) {
  const i = state.investments.find((x) => x.id === id) || { date: today() };
  openForm(id ? 'Editar investimento' : 'Novo investimento', [
    { name: 'name', label: 'Nome (ex.: Tesouro Selic)', type: 'text', required: true },
    { name: 'type', label: 'Tipo', type: 'select', options: TIPOS_INV },
    { name: 'invested', label: 'Valor aplicado (R$)', type: 'number', required: true },
    { name: 'current', label: 'Valor atual (R$)', type: 'number', required: true },
    { name: 'date', label: 'Data da aplicação', type: 'date', required: true },
  ], i, (d) => {
    const item = { id: id || uid(), ...d };
    state.investments = id ? state.investments.map((x) => (x.id === id ? item : x)) : [...state.investments, item];
    save();
  });
}

/* ---------- 9. RELATÓRIOS COM FILTRO POR PERÍODO ---------- */
const reportList = () => state.transactions.filter((t) => t.date >= $('#r-from').value && t.date <= $('#r-to').value
  && (!$('#r-cat-f').value || t.category === $('#r-cat-f').value) && (!$('#r-status').value || status(t) === $('#r-status').value));
function renderReports() {
  const list = reportList(), rec = sum(list, 'receita'), des = sum(list, 'despesa');
  $('#r-cards').innerHTML = card('Receitas no período', brl(rec), 'pos') + card('Despesas no período', brl(des), 'neg') + card('Resultado', brl(rec - des), rec - des >= 0 ? 'pos' : 'neg') + card('Em aberto', brl(list.filter((t) => ['pendente', 'proximo', 'vencido'].includes(status(t))).reduce((a, t) => a + t.amount, 0)), 'warn');
  const months = [...new Set(list.map((t) => monthOf(t.date)))].sort();
  draw('ch-rep', { type: 'bar', data: { labels: months.map(monthLabel), datasets: [
    { label: 'Receitas', data: months.map((m) => sum(list.filter((t) => monthOf(t.date) === m), 'receita')), backgroundColor: '#138a63' },
    { label: 'Despesas', data: months.map((m) => sum(list.filter((t) => monthOf(t.date) === m), 'despesa')), backgroundColor: '#d6455d' }] },
    options: { scales: { y: money }, ...tip } });
  const rows = CATS_DESPESA.map((c) => [c, list.filter((t) => t.type === 'despesa' && t.category === c).reduce((a, t) => a + t.amount, 0)]).filter((r) => r[1] > 0).sort((a, b) => b[1] - a[1]);
  $('#r-cat').innerHTML = `<tr><th>Categoria</th><th class="num">Total</th><th class="num">%</th></tr>` +
    (rows.map(([c, v]) => `<tr><td>${c}</td><td class="num">${brl(v)}</td><td class="num">${pct(v, des).toFixed(1)}%</td></tr>`).join('') || empty(3, 'Sem despesas no período.'));
}
/** Exporta o período filtrado para CSV (abre no Excel; separador ;). */
function exportCsv() {
  const lines = [['Data', 'Descrição', 'Categoria', 'Tipo', 'Vencimento', 'Status', 'Pagamento', 'Valor'], ...reportList().sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => [fmtDate(t.date), t.desc, t.category, t.kind, t.type === 'despesa' ? fmtDate(t.due || t.date) : '', STATUS[status(t)] || '', t.paidDate ? fmtDate(t.paidDate) : '', (t.type === 'receita' ? '' : '-') + t.amount.toFixed(2).replace('.', ',')])];
  const csv = '\ufeff' + lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'relatorio.csv' });
  a.click(); URL.revokeObjectURL(a.href);
}

/* ---------- 10. NAVEGAÇÃO, EVENTOS E DADOS DE EXEMPLO ---------- */
const TITLES = { dashboard: 'Painel', transactions: 'Transações', debts: 'Dívidas', payments: 'Contas a pagar', recurring: 'Parcelas e recorrências', budget: 'Orçamento', goals: 'Metas de economia', investments: 'Investimentos', reports: 'Relatórios' };
function showView(v) {
  document.querySelectorAll('.view').forEach((s) => (s.hidden = s.id !== 'view-' + v));
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  $('#title').textContent = TITLES[v];
  $('.mpick').style.visibility = ['dashboard', 'transactions', 'budget'].includes(v) ? 'visible' : 'hidden';
  renderAll();
}
const currentView = () => document.querySelector('#nav .on').dataset.view;
function renderAll() {
  ({ dashboard: renderDashboard, transactions: renderTransactions, budget: renderBudget, goals: renderGoals, investments: renderInvestments, reports: renderReports, recurring: renderRecurring, payments: renderPayments, debts: () => typeof renderDebts === 'function' && renderDebts(), ...(typeof LIFE_RENDER !== 'undefined' ? LIFE_RENDER : {}) })[currentView()]();
  renderAlerts(); updateBell();
}

/** Gera 6 meses de lançamentos fictícios para testar o sistema. */
function seed() {
  const ym = today().slice(0, 7), tx = [];
  for (let i = -5; i <= 0; i++) {
    const m = addMonths(ym, i), r = (min, max) => Math.round(min + Math.random() * (max - min));
    const add = (kind, desc, amount, category, day) => tx.push({ id: uid(), kind, type: kind === 'Renda' ? 'receita' : 'despesa', desc, amount, category, date: `${m}-${pad(day)}`, due: `${m}-${pad(day)}`, paid: i < 0 || day <= new Date().getDate(), paidDate: `${m}-${pad(day)}` });
    add('Renda', 'Salário', 5200, 'Salário', 5); if (i % 2) add('Renda', 'Projeto freelance', r(600, 1500), 'Freelance', 18);
    add('Gasto fixo', 'Aluguel', 1500, 'Moradia', 10); add('Gasto fixo', 'Internet e celular', 180, 'Contas', 12); add('Gasto fixo', 'Plano de saúde', 420, 'Saúde', 15);
    add('Gasto variável', 'Supermercado', r(700, 1000), 'Alimentação', 8); add('Gasto variável', 'Combustível', r(250, 400), 'Transporte', 14);
    add('Gasto variável', 'Cinema e restaurantes', r(150, 450), 'Lazer', 20); add('Gasto variável', 'Compras diversas', r(100, 500), 'Compras', 22);
  }
  state = { debts: state.debts, debtPlan: state.debtPlan, tasks: state.tasks, events: state.events, notes: state.notes, projects: state.projects, areas: state.areas, transactions: tx, budgets: { Moradia: 1600, Alimentação: 900, Transporte: 350, Lazer: 300, Compras: 300, Saúde: 450, Contas: 200 },
    goals: [{ id: uid(), name: 'Reserva de emergência', target: 20000, saved: 6500, deadline: `${+ym.slice(0, 4) + 1}-12-31` }],
    investments: [{ id: uid(), name: 'Tesouro Selic', type: 'Renda fixa', invested: 6000, current: 6420, date: `${ym}-01` }, { id: uid(), name: 'ETF de índice', type: 'Ações', invested: 3000, current: 3310, date: `${ym}-01` }] };
  save();
}

document.addEventListener('DOMContentLoaded', () => {
  $('#month').value = today().slice(0, 7);
  $('#r-from').value = addMonths(today().slice(0, 7), -5) + '-01';
  $('#r-to').value = today();
  const catOpts = '<option value="">Todas as categorias</option>' + catList().map((c) => `<option>${c}</option>`).join('');
  $('#f-cat').innerHTML = catOpts; $('#r-cat-f').innerHTML = catOpts;

  $('#nav').addEventListener('click', (e) => e.target.dataset.view && showView(e.target.dataset.view));
  ['#month', '#cmp-month', '#f-search', '#f-kind', '#f-cat', '#f-all', '#r-from', '#r-to', '#r-cat-f', '#r-status', '#f-status', '#f-from', '#f-to'].forEach((s) => $(s).addEventListener('input', renderAll));
  $('#add-tx').onclick = () => editTransaction();
  $('#add-goal').onclick = () => editGoal();
  $('#add-inv').onclick = () => editInvestment();
  $('#r-csv').onclick = exportCsv;
  $('#btn-seed').onclick = async () => { if (!state.transactions.length || await ask('Isso substitui lançamentos, orçamentos, metas e investimentos pelos de exemplo (as dívidas são mantidas). Continuar?', 'Substituir')) seed(); };
  $('#btn-clear').onclick = async () => { if (await ask('Apagar TODOS os dados deste navegador, inclusive dívidas?', 'Apagar tudo')) { state = { transactions: [], budgets: {}, goals: [], investments: [] }; save(); } };

  // Limites do orçamento (campo editável na tabela)
  $('#bud-table').addEventListener('change', (e) => { if (e.target.dataset.bud) { state.budgets[e.target.dataset.bud] = Math.max(+e.target.value || 0, 0); save(); } });

  // Botões de editar/excluir (delegação de eventos)
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.dataset.id, del = async (key) => { if (await ask('Excluir este item?', 'Excluir')) { state[key] = state[key].filter((x) => x.id !== id); save(); } };
    ({ 'edit-tx': () => editTransaction(id), 'del-tx': () => delTx(id), 'pay-tx': () => payTx(id), 'dup-tx': () => dupTx(id), 'edit-rec': () => editRecurring(id), 'del-rec': () => delRec(id), 'edit-goal': () => editGoal(id), 'del-goal': () => del('goals'),
       aporte: () => addAporte(id), 'edit-inv': () => editInvestment(id), 'del-inv': () => del('investments') })[b.dataset.act]();
  });
  $('#accent').value = prefs.accent;
  $('#accent').addEventListener('input', (e) => { prefs.accent = e.target.value; applyPrefs(); });
  $('#btn-theme').onclick = () => { prefs.theme = prefs.theme === 'dark' ? 'light' : 'dark'; applyPrefs(); };
  $('#add-rec').onclick = () => editRecurring();
  $('#bell').onclick = () => showView('payments');
  document.documentElement.dataset.theme = prefs.theme; document.documentElement.style.setProperty('--primary', prefs.accent);
  save(); showView('today');
  const na = document.querySelectorAll('#alerts .alert').length; if (na) toast(`${na} alerta(s) de contas e orçamento`, 'warn');
});
