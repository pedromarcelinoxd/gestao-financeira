'use strict';
/* =====================================================================
   debts.js – módulo de dívidas (carregado DEPOIS do app.js, reutiliza state, save,
   openForm, card, bar, draw, brl, toast, ask…).
   1 Cálculo (ledger) · 2 Status · 3 Pagamentos/encargos · 4 Cadastro
   5 Simulação/planejamento · 6 Telas · 7 Histórico · 8 Alertas · 9 Eventos
   ===================================================================== */
const r2 = (x) => Math.round(x * 100) / 100;
const DEBT_TYPES = ['Cartão de crédito', 'Empréstimo', 'Financiamento', 'Cheque especial', 'Consignado', 'Outros'];
const DL = () => (state.debts ||= []);
const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const parcelDue = (d, k) => `${addMonths(d.due.slice(0, 7), k)}-${pad(Math.min(+d.due.slice(8), 28))}`;
const monthlyEq = (d) => (d.ratePeriod === 'Diária' ? (Math.pow(1 + d.rate / 100, 30) - 1) * 100 : d.rate);
const fmtPct = (x) => (+x).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/* ---------- 1. CÁLCULO ----------
   Premissas: juros simples = taxa × principal em aberto × tempo; compostos = taxa sobre (principal + juros em aberto).
   Taxa mensal usa mês de 30 dias. Multa % incide uma vez sobre cada parcela vencida e não paga; mora % a.m. (pro rata dia)
   incide sobre o valor em atraso. Pagamentos abatem primeiro multas/encargos, depois juros, depois principal.
   "previsto" = calculado pelas regras; "cobrado" = só os encargos que você lançou manualmente. */
function instValue(d) {
  if (d.instValue > 0) return d.instValue;
  const n = d.installments || 1, r = monthlyEq(d) / 100;
  return n > 1 ? r2(r > 0 ? (d.original * r) / (1 - Math.pow(1 + r, -n)) : d.original / n) : d.original;
}
const growth = (d, P, I, t) => {
  const r = d.rate / 100, n = d.ratePeriod === 'Diária' ? t : t / 30;
  return d.interestType === 'Simples' ? P * r * n : (P + I) * (Math.pow(1 + r, n) - 1);
};
/** Linha do tempo da dívida até asOf: separa principal, juros e multas. */
function ledger(d, asOf = today(), mode = 'previsto') {
  const n = d.installments || 1, iv = instValue(d), prev = mode === 'previsto';
  let P = d.original, I = 0, M = 0, cur = d.start, dueN = 0;
  const L = { paidTotal: 0, paidP: 0, paidI: 0, paidM: 0, accI: 0, accM: 0, excess: 0, tl: [{ date: d.start, bal: P, label: 'Contratação' }] };
  const grow = (to) => {
    const t = dayDiff(cur, to); if (t <= 0) return; cur = to; if (!prev) return;
    const g = r2(growth(d, P, I, t)); I = r2(I + g); L.accI += g;
    const od = dueN >= n ? P + I : Math.min(Math.max(dueN * iv - L.paidTotal, 0), P + I);
    if (d.lateRate && od > 0) { const m = r2((od * d.lateRate / 100 * t) / 30); M = r2(M + m); L.accM += m; }
  };
  const ev = [
    ...(d.payments || []).filter((p) => !p.voided && p.date <= asOf).map((p) => ({ date: p.date, o: 1, p })),
    ...(prev ? [] : (d.charges || []).filter((c) => !c.voided && c.date <= asOf).map((c) => ({ date: c.date, o: 0, c }))),
    ...Array.from({ length: n }, (_, k) => ({ date: parcelDue(d, k), o: 2 })).filter((e) => e.date <= asOf),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.o - b.o);
  ev.forEach((e) => {
    grow(e.date);
    if (e.p) {
      let a = e.p.amount; const m = Math.min(a, M); M = r2(M - m); a -= m;
      const i = Math.min(a, I); I = r2(I - i); a -= i; const p = Math.min(a, P); P = r2(P - p); a -= p;
      Object.assign(L, { paidM: L.paidM + m, paidI: L.paidI + i, paidP: L.paidP + p, excess: L.excess + a, paidTotal: L.paidTotal + e.p.amount });
      L.tl.push({ date: e.date, bal: r2(P + I + M), label: 'Pagamento', ref: e.p.id });
    } else if (e.c) {
      if (e.c.kind === 'Juros') { I = r2(I + e.c.amount); L.accI += e.c.amount; } else { M = r2(M + e.c.amount); L.accM += e.c.amount; }
      L.tl.push({ date: e.date, bal: r2(P + I + M), label: 'Encargo ' + e.c.kind, ref: e.c.id });
    } else {
      dueN++; const short = Math.min(iv, Math.max(dueN * iv - L.paidTotal, 0));
      if (prev && d.fine && short > 0) { const f = r2(short * d.fine / 100); M = r2(M + f); L.accM += f; L.tl.push({ date: e.date, bal: r2(P + I + M), label: `Multa da parcela ${dueN}` }); }
    }
  });
  grow(asOf);
  const bal = r2(P + I + M), paidParcels = Math.min(n, Math.floor((L.paidTotal + 0.005) / iv));
  return Object.assign(L, { P, I, M, bal, iv, n, paidParcels, overdue: bal > 0.005 ? Math.max(dueN - paidParcels, dueN >= n ? 1 : 0) : 0 });
}
/** Saldo oficial: usa o "cobrado" se houver encargos lançados; senão o "previsto". */
const full = (d, asOf) => ledger(d, asOf, d.charges?.some((c) => !c.voided) ? 'cobrado' : 'previsto');

/* ---------- 2. STATUS ---------- */
function dStatus(d, L = full(d)) {
  if (d.archived) return 'arquivada';
  if (L.bal <= 0.005) return 'quitada';   // só quita com saldo zerado: pagamento parcial NUNCA quita
  if (L.overdue) return 'atrasada';
  return L.paidTotal > 0 ? 'parcial' : 'pendente';
}
const D_LABEL = { quitada: 'Quitada', atrasada: 'Atrasada', parcial: 'Parcialmente paga', pendente: 'Pendente', arquivada: 'Arquivada' };
const D_CLS = { quitada: 'pago', atrasada: 'vencido', parcial: 'proximo', pendente: '', arquivada: '' };
const nextDue = (d, L) => (L.bal > 0.005 ? parcelDue(d, Math.min(L.paidParcels, L.n - 1)) : null);
const allDebts = () => DL().map((d) => { const L = full(d); return { d, L, st: dStatus(d, L), nd: nextDue(d, L) }; });

/* ---------- 3. PAGAMENTOS E ENCARGOS (histórico auditável: nunca apagado, só estornado) ---------- */
/** Regras de validação + registro. Retorna 'ok' | 'cancelado'. */
async function registerPayment(d, x) {
  const bal = full(d, x.date).bal;
  if (DL().find((q) => q.id === d.id).payments.some((p) => !p.voided && p.date === x.date && Math.abs(p.amount - x.v) < 0.005 && p.method === x.method)
    && !(await ask('Já existe um pagamento igual (mesma data, valor e forma). Registrar mesmo assim?', 'Registrar'))) return 'cancelado';
  if (x.v > bal + 0.005 && !(await ask(`O valor (${brl(x.v)}) é maior que o saldo (${brl(bal)}). Registrar mesmo assim?`, 'Registrar'))) return 'cancelado';
  d.payments.push({ id: uid(), date: x.date, amount: x.v, method: x.method, note: x.note || '', at: new Date().toISOString() });
  save(); const L = full(d);
  toast(L.bal <= 0.005 ? `Dívida “${d.name}” quitada!` : `Pagamento registrado. Saldo restante: ${brl(L.bal)}`);
  return 'ok';
}
function addPayment(id) {
  const d = DL().find((x) => x.id === id), first = d.payments.map((p) => p.date).sort()[0];
  const form = openForm(`Pagamento · ${d.institution}`, [
    { name: 'v', label: 'Valor pago (R$)', type: 'number', required: true },
    { name: 'date', label: 'Data do pagamento', type: 'date', required: true,
      check: (v) => (v > today() ? 'A data não pode ser futura.' : v < d.start ? 'Anterior à contratação da dívida.' : '') },
    { name: 'method', label: 'Forma de pagamento', type: 'select', options: METHODS },
    { name: 'note', label: 'Observação (opcional)', type: 'text' },
  ], { date: today(), method: METHODS[0] }, (x) => registerPayment(d, x));
  const b = Object.assign(document.createElement('button'), { type: 'button', className: 'mini', textContent: 'Usar saldo total' });
  b.onclick = () => (form.elements.v.value = full(d, form.elements.date.value || today()).bal);
  form.elements.v.closest('label').append(b);
}
function addCharge(id) {
  const d = DL().find((x) => x.id === id);
  openForm('Encargo efetivamente cobrado', [
    { name: 'kind', label: 'Tipo', type: 'select', options: ['Juros', 'Multa/encargos'] },
    { name: 'v', label: 'Valor cobrado (R$)', type: 'number', required: true },
    { name: 'date', label: 'Data da cobrança', type: 'date', required: true, check: (v) => (v > today() ? 'A data não pode ser futura.' : v < d.start ? 'Anterior à contratação.' : '') },
    { name: 'note', label: 'Observação (opcional)', type: 'text' },
  ], { date: today() }, (x) => {
    (d.charges ||= []).push({ id: uid(), kind: x.kind, amount: x.v, date: x.date, note: x.note || '' });
    d.audit.push({ date: today(), text: `Lançado encargo cobrado: ${x.kind} ${brl(x.v)}` });
    save(); toast('Encargo registrado. O saldo passa a considerar o valor cobrado.');
  });
}
async function voidRecord(id, kind, rid) {
  const d = DL().find((x) => x.id === id), r = d[kind].find((x) => x.id === rid);
  if (!(await ask(`Estornar este lançamento de ${brl(r.amount)}? Ele continuará no histórico, marcado como estornado.`, 'Estornar'))) return;
  r.voided = true; r.voidedAt = today(); d.audit.push({ date: today(), text: `Estornado ${kind === 'payments' ? 'pagamento' : 'encargo'} de ${brl(r.amount)} (${fmtDate(r.date)})` });
  save(); toast('Lançamento estornado'); showHistory(id);
}

/* ---------- 4. CADASTRO / EDIÇÃO (edição nunca apaga pagamentos nem encargos) ---------- */
const FIELD_NAMES = { institution: 'instituição', name: 'descrição', type: 'tipo', original: 'valor original', start: 'contratação', due: '1º vencimento', installments: 'parcelas', instValue: 'valor da parcela', rate: 'taxa', ratePeriod: 'período da taxa', interestType: 'tipo de juros', fine: 'multa', lateRate: 'mora', priority: 'prioridade' };
function editDebt(id) {
  const d = DL().find((x) => x.id === id), cur = d || { type: DEBT_TYPES[0], ratePeriod: 'Mensal', interestType: 'Composto', fine: 2, lateRate: 1, priority: 3, installments: 1, start: today(), due: today() };
  const firstPay = d ? d.payments.map((p) => p.date).sort()[0] : null;
  const form = openForm(id ? 'Editar dívida' : 'Nova dívida', [
    { name: 'institution', label: 'Banco / instituição', type: 'text', required: true },
    { name: 'name', label: 'Descrição', type: 'text', required: true },
    { name: 'type', label: 'Tipo de dívida', type: 'select', options: DEBT_TYPES },
    { name: 'original', label: 'Valor original (R$)', type: 'number', required: true },
    { name: 'start', label: 'Data de contratação', type: 'date', required: true, check: (v) => (firstPay && v > firstPay ? 'Há pagamentos anteriores a esta data.' : '') },
    { name: 'due', label: '1º vencimento', type: 'date', required: true, check: (v, f) => (v < f.elements.start.value ? 'Anterior à contratação.' : '') },
    { name: 'installments', label: 'Nº de parcelas', type: 'number', required: true, check: (v) => (!Number.isInteger(+v) ? 'Use um número inteiro.' : '') },
    { name: 'instValue', label: 'Valor da parcela (opcional)', type: 'number', zero: true },
    { name: 'rate', label: 'Taxa de juros (%)', type: 'number', zero: true, required: true },
    { name: 'ratePeriod', label: 'Período da taxa', type: 'select', options: ['Mensal', 'Diária'] },
    { name: 'interestType', label: 'Tipo de juros', type: 'select', options: ['Simples', 'Composto'] },
    { name: 'fine', label: 'Multa por atraso (%)', type: 'number', zero: true, required: true },
    { name: 'lateRate', label: 'Juros de mora (% a.m.)', type: 'number', zero: true, required: true },
    { name: 'priority', label: 'Prioridade (1 = mais urgente)', type: 'select', options: ['1', '2', '3', '4', '5'] },
  ], { ...cur, priority: String(cur.priority) }, (x) => {
    x.priority = +x.priority; x.installments = Math.max(1, x.installments);
    if (!d) { DL().push({ id: uid(), ...x, payments: [], charges: [], audit: [{ date: today(), text: 'Dívida cadastrada' }] }); toast('Dívida cadastrada'); }
    else {
      const ch = Object.keys(FIELD_NAMES).filter((k) => String(d[k] ?? '') !== String(x[k] ?? '')).map((k) => `${FIELD_NAMES[k]}: ${d[k] ?? '—'} → ${x[k]}`);
      Object.assign(d, x); if (ch.length) d.audit.push({ date: today(), text: 'Editado — ' + ch.join('; ') });
      toast('Dívida atualizada (histórico preservado)');
    }
    save();
  });
  form.classList.add('cols');
}

/* ---------- 5. SIMULAÇÃO E PLANEJAMENTO ---------- */
const bucketsLeft = (s) => s.P + s.I + s.M;
/** Aplica pagamento a um estado {P,I,M}: multas → juros → principal. Retorna o valor usado. */
function alloc(s, a) {
  const used = Math.min(a, bucketsLeft(s)); let r = used;
  ['M', 'I', 'P'].forEach((k) => { const x = Math.min(r, s[k]); s[k] = r2(s[k] - x); r -= x; });
  return used;
}
/** Projeta a quitação mês a mês (meses de 30 dias). */
function simulate(d, monthly, extra, lump) {
  const L = full(d), s = { P: L.P, I: L.I, M: L.M }; let paid = 0, intr = 0, m = 0;
  const bal = [r2(bucketsLeft(s))];
  if (lump > 0) { paid += alloc(s, lump); bal[0] = r2(bucketsLeft(s)); }
  while (bucketsLeft(s) > 0.005 && m < 600) { const g = r2(growth(d, s.P, s.I, 30)); s.I = r2(s.I + g); intr += g; paid += alloc(s, monthly + extra); m++; bal.push(r2(bucketsLeft(s))); }
  return { months: bucketsLeft(s) > 0.005 ? null : m, paid: r2(paid), intr: r2(intr), bal };
}
const strategyOrder = (s) => (s === 'Avalanche' ? (a, b) => b.rate - a.rate : s === 'Bola de neve' ? (a, b) => a.bal - b.bal : (a, b) => a.pr - b.pr || b.rate - a.rate);
/** Distribui a meta mensal: primeiro as parcelas mínimas, depois o excedente conforme a estratégia. */
function planAlloc(items, monthly, strat) {
  const ord = [...items].sort(strategyOrder(strat)); let left = monthly;
  ord.forEach((x) => { x.min = Math.min(x.iv, x.bal); x.pay = Math.min(x.min, left); left = r2(left - x.pay); });
  ord.forEach((x) => { x.extra = Math.min(left, r2(x.bal - x.pay)); x.pay = r2(x.pay + x.extra); left = r2(left - x.extra); });
  return { ord, left };
}
function planMonths(items, monthly, strat) {
  const S = items.map((x) => ({ d: x.d, P: x.L.P, I: x.L.I, M: x.L.M, iv: x.iv, rate: x.rate, pr: x.pr })); let m = 0, intr = 0;
  while (S.some((s) => bucketsLeft(s) > 0.005) && m < 600) {
    m++; S.forEach((s) => { const g = r2(growth(s.d, s.P, s.I, 30)); s.I = r2(s.I + g); intr += g; });
    let left = monthly; const open = S.filter((s) => bucketsLeft(s) > 0.005).map((s) => Object.assign(s, { bal: bucketsLeft(s) })).sort(strategyOrder(strat));
    open.forEach((s) => (left -= alloc(s, Math.min(s.iv, left))));
    open.forEach((s) => (left -= alloc(s, left)));
  }
  return { months: S.some((s) => bucketsLeft(s) > 0.005) ? null : m, intr: r2(intr) };
}

/* ---------- 6. TELAS ---------- */
let sim = { id: null, rows: [] };
function renderDebts() {
  const all = allDebts(), act = all.filter((x) => x.st !== 'arquivada');
  const S = (f) => act.reduce((a, x) => a + f(x), 0), charged = S((x) => (x.d.charges || []).filter((c) => !c.voided).reduce((a, c) => a + c.amount, 0));
  const prevAcc = S((x) => { const p = ledger(x.d); return p.accI + p.accM; });
  const soon = act.filter((x) => x.nd && x.nd >= today() && dayDiff(today(), x.nd) <= 7), nxt = [...act.filter((x) => x.nd)].sort((a, b) => a.nd.localeCompare(b.nd))[0];
  $('#d-cards').innerHTML = card('Valor original total', brl(S((x) => x.d.original)), 'pri') + card('Total já pago', brl(S((x) => x.L.paidTotal)), 'pos') +
    card('Saldo devedor atualizado', brl(S((x) => x.L.bal)), 'neg') +
    card('Juros e multas acumulados', brl(prevAcc), 'warn', `<small>Previsto · cobrado lançado: ${brl(charged)}</small>`) +
    card('Parcelas vencidas', String(S((x) => x.L.overdue)), S((x) => x.L.overdue) ? 'neg' : 'pos') +
    card('Próximos vencimentos (7 dias)', String(soon.length), soon.length ? 'warn' : 'pri', nxt ? `<small>Próximo: ${fmtDate(nxt.nd)} · ${esc(nxt.d.institution)} · ${brl(nxt.L.iv)}</small>` : '');
  // gráficos
  const byInst = {}; act.forEach((x) => (byInst[x.d.institution] = (byInst[x.d.institution] || 0) + x.L.bal));
  draw('ch-d-inst', { type: 'bar', data: { labels: Object.keys(byInst), datasets: [{ label: 'Saldo devedor', data: Object.values(byInst), backgroundColor: COLORS }] }, options: { plugins: { legend: { display: false } }, scales: { y: money }, ...tip } });
  draw('ch-d-comp', { type: 'doughnut', data: { labels: ['Principal', 'Juros', 'Multas/encargos'], datasets: [{ data: [S((x) => x.L.P), S((x) => x.L.I), S((x) => x.L.M)], backgroundColor: ['#2f5fd0', '#d98a12', '#d6455d'] }] },
    options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.label}: ${brl(c.parsed)}` } } } } });
  const ms = Array.from({ length: 12 }, (_, i) => addMonths(today().slice(0, 7), i - 11)), eom = (m) => { const [y, mo] = m.split('-'); const e = `${m}-${pad(new Date(y, mo, 0).getDate())}`; return e > today() ? today() : e; };
  draw('ch-d-evo', { type: 'line', data: { labels: ms.map(monthLabel), datasets: [{ label: 'Saldo devedor total', data: ms.map((m) => act.reduce((a, x) => a + (x.d.start <= eom(m) ? full(x.d, eom(m)).bal : 0), 0)), borderColor: '#d6455d', backgroundColor: 'rgba(214,69,93,.15)', fill: true, tension: .3 }] }, options: { scales: { y: money }, ...tip } });
  renderDebtTable(); renderPlan(); renderSim();
}
function renderDebtTable() {
  const q = $('#d-q').value.toLowerCase(), ty = $('#d-type').value, st = $('#d-status').value, du = $('#d-due').value, mr = +$('#d-rate').value || 0, so = $('#d-sort').value;
  const all = allDebts(), maxRate = Math.max(0, ...all.filter((x) => x.st !== 'arquivada' && x.L.bal > 0.005).map((x) => monthlyEq(x.d)));
  const rows = all.filter(({ d, st: s, nd }) => (st ? s === st : s !== 'arquivada') && (!ty || d.type === ty) && `${d.institution} ${d.name}`.toLowerCase().includes(q) && monthlyEq(d) >= mr
    && (!du || (nd && (du === 'atrasada' ? nd < today() : nd >= today() && dayDiff(today(), nd) <= +du))))
    .sort((a, b) => so === 'taxa' ? monthlyEq(b.d) - monthlyEq(a.d) : so === 'venc' ? (a.nd || '9').localeCompare(b.nd || '9') : b.L.bal - a.L.bal);
  $('#d-table').innerHTML = '<tr><th>Instituição</th><th class="num">Saldo atualizado</th><th class="num">Taxa</th><th>Próx. venc.</th><th>Parcelas</th><th>Status</th><th></th></tr>' +
    (rows.map(({ d, L, st: s, nd }) => `<tr class="${s === 'atrasada' ? 'late' : ''}"><td><strong>${esc(d.institution)}</strong> ${maxRate > 0 && L.bal > 0.005 && monthlyEq(d) >= maxRate - 1e-9 && s !== 'arquivada' ? '<span class="badge vencido">Juros mais altos</span>' : ''}<br><small>${esc(d.name)} · ${d.type}</small></td>
      <td class="num">${brl(L.bal)}<br><small>Original ${brl(d.original)}</small></td><td class="num">${fmtPct(d.rate)}% ${d.ratePeriod === 'Diária' ? 'a.d.' : 'a.m.'}<br><small>${d.interestType}</small></td>
      <td>${nd ? fmtDate(nd) : '—'}</td><td>${L.paidParcels}/${L.n}</td><td><span class="badge ${D_CLS[s]}">${D_LABEL[s]}${s === 'atrasada' && L.paidTotal > 0 ? ' · parcial' : ''}</span></td>
      <td>${L.bal > 0.005 && s !== 'arquivada' ? `<button class="mini" data-d="pay" data-id="${d.id}">Pagar</button> <button class="mini" data-d="chg" data-id="${d.id}">Encargo</button> ` : ''}<button class="mini" data-d="hist" data-id="${d.id}">Histórico</button> <button class="mini" data-d="edit" data-id="${d.id}">Editar</button>
      <button class="mini del" data-d="${d.payments.length || (d.charges || []).length ? 'arch' : 'del'}" data-id="${d.id}">${d.payments.length || (d.charges || []).length ? (d.archived ? 'Reativar' : 'Arquivar') : 'Excluir'}</button></td></tr>`).join('')
      || '<tr><td class="empty" colspan="7">Nenhuma dívida encontrada. Use “+ Nova dívida”.</td></tr>');
}
function renderPlan() {
  const p = (state.debtPlan ||= { monthly: 0, strategy: 'Avalanche' });
  const items = allDebts().filter((x) => x.st !== 'arquivada' && x.L.bal > 0.005).map((x) => ({ d: x.d, L: x.L, bal: x.L.bal, iv: x.L.iv, rate: monthlyEq(x.d), pr: x.d.priority }));
  const { ord, left } = planAlloc(items, p.monthly, p.strategy), minT = items.reduce((a, x) => a + Math.min(x.iv, x.bal), 0), top = Math.max(0, ...items.map((x) => x.rate));
  const paidMonth = DL().reduce((a, d) => a + d.payments.filter((q) => !q.voided && q.date.slice(0, 7) === today().slice(0, 7)).reduce((s, q) => s + q.amount, 0), 0);
  $('#p-progress').innerHTML = p.monthly > 0 ? `<small>Meta do mês: ${brl(paidMonth)} de ${brl(p.monthly)} (${pct(paidMonth, p.monthly).toFixed(0)}%)</small>${bar(pct(paidMonth, p.monthly))}` : '<small>Defina uma meta mensal para planejar a quitação.</small>';
  $('#p-table').innerHTML = '<tr><th>Prioridade</th><th>Dívida</th><th class="num">Parcela mínima</th><th class="num">Extra sugerido</th><th class="num">Total no mês</th><th class="num">Taxa a.m.</th></tr>' +
    (ord.map((x, i) => `<tr><td>${i + 1}º</td><td>${esc(x.d.institution)} <small>${esc(x.d.name)}</small> ${top > 0 && x.rate >= top - 1e-9 ? '<span class="badge vencido">Juros mais altos</span>' : ''}</td><td class="num">${brl(x.min)}</td><td class="num">${brl(x.extra)}</td><td class="num"><strong>${brl(x.pay)}</strong></td><td class="num">${fmtPct(x.rate)}%</td></tr>`).join('') || '<tr><td class="empty" colspan="6">Sem dívidas em aberto.</td></tr>');
  const pm = p.monthly > 0 && items.length ? planMonths(items, p.monthly, p.strategy) : null;
  $('#p-sum').textContent = !items.length ? '' : p.monthly <= 0 ? '' : (p.monthly < minT ? `Atenção: a meta é menor que a soma das parcelas mínimas (${brl(minT)}). ` : '') +
    (pm ? (pm.months ? `Projeção: quitar tudo em ${pm.months} mês(es), com ${brl(pm.intr)} de juros futuros (premissa: meses de 30 dias, sem novos atrasos).` : 'Com essa meta as dívidas não são quitadas (os juros superam os pagamentos).') : '');
}
function renderSim() {
  const sel = $('#s-debt'), open = allDebts().filter((x) => x.st !== 'arquivada' && x.L.bal > 0.005), prev = sel.value;
  sel.innerHTML = open.map((x) => `<option value="${x.d.id}">${esc(x.d.institution)} — ${esc(x.d.name)}</option>`).join('') || '<option value="">Sem dívidas em aberto</option>';
  if (open.some((x) => x.d.id === prev)) sel.value = prev;
  const cur = open.find((x) => x.d.id === sel.value);
  if (!cur) { $('#s-in').innerHTML = ''; $('#s-out').innerHTML = ''; charts['ch-d-sim']?.destroy(); return; }
  if (sim.id !== cur.d.id) {
    const iv = cur.L.iv; sim = { id: cur.d.id, rows: [{ n: 'Parcela atual', m: iv, x: 0, l: 0 }, { n: 'Com extra mensal', m: iv, x: r2(iv * 0.5), l: 0 }, { n: 'Antecipação única', m: iv, x: 0, l: r2(cur.L.bal * 0.2) }] };
    $('#s-in').innerHTML = '<tr><th>Cenário</th><th>Mensal (R$)</th><th>Extra mensal (R$)</th><th>Pagamento único agora (R$)</th></tr>' +
      sim.rows.map((r, i) => `<tr><td>${r.n}</td>${['m', 'x', 'l'].map((f) => `<td><input type="number" min="0" step="0.01" data-s="${i}" data-f="${f}" value="${r[f]}" aria-label="${r.n} – ${f}"></td>`).join('')}</tr>`).join('');
  }
  const res = sim.rows.map((r) => simulate(cur.d, r.m, r.x, r.l));
  $('#s-out').innerHTML = '<tr><th>Cenário</th><th class="num">Meses</th><th>Quitação em</th><th class="num">Total pago</th><th class="num">Juros futuros</th><th class="num">Economia vs. cenário 1</th></tr>' +
    res.map((r, i) => `<tr><td>${sim.rows[i].n}</td><td class="num">${r.months ?? '—'}</td><td>${r.months != null ? monthLabel(addMonths(today().slice(0, 7), r.months)) : 'Não quita'}</td><td class="num">${brl(r.paid)}</td><td class="num">${brl(r.intr)}</td>
      <td class="num ${i && res[0].months != null && r.months != null && res[0].paid - r.paid > 0 ? 'pos' : ''}">${i && res[0].months != null && r.months != null ? brl(res[0].paid - r.paid) : '—'}</td></tr>`).join('');
  const len = Math.min(Math.max(...res.map((r) => r.bal.length)), 121), cols = ['#7f8da0', '#138a63', '#2f5fd0'];
  draw('ch-d-sim', { type: 'line', data: { labels: Array.from({ length: len }, (_, i) => `Mês ${i}`), datasets: res.map((r, i) => ({ label: sim.rows[i].n, data: Array.from({ length: len }, (_, k) => r.bal[k] ?? 0), borderColor: cols[i], tension: .2, pointRadius: 0 })) }, options: { scales: { y: money }, ...tip } });
}

/* ---------- 7. HISTÓRICO (movimentos, saldo após cada um, previsto x cobrado) ---------- */
function showHistory(id) {
  const d = DL().find((x) => x.id === id), Lp = ledger(d), hasC = d.charges?.some((c) => !c.voided), Lc = hasC ? ledger(d, today(), 'cobrado') : null, Lm = full(d);
  const aft = Object.fromEntries(Lm.tl.filter((t) => t.ref).map((t) => [t.ref, t.bal]));
  const c2 = (f) => (Lc ? brl(f(Lc)) : '—');
  const mv = [
    ...d.payments.map((p) => ({ date: p.date, kind: 'Pagamento', det: `${p.method}${p.note ? ' · ' + p.note : ''}`, v: p.amount, id: p.id, rec: p, k: 'payments' })),
    ...(d.charges || []).map((c) => ({ date: c.date, kind: 'Encargo ' + c.kind, det: c.note || 'Cobrado pela instituição', v: c.amount, id: c.id, rec: c, k: 'charges' })),
    ...d.audit.map((a) => ({ date: a.date, kind: 'Registro', det: a.text })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  showInfo(`${d.institution} · ${d.name}`, `
    <p class="hint">Premissas: juros ${d.interestType.toLowerCase()}s de ${fmtPct(d.rate)}% ${d.ratePeriod === 'Diária' ? 'ao dia' : 'ao mês'} (mês de 30 dias); multa de ${fmtPct(d.fine)}% por parcela vencida e não paga; mora de ${fmtPct(d.lateRate)}% a.m. sobre o valor em atraso; pagamentos abatem multas, depois juros, depois principal. Parcela de referência: ${brl(Lp.iv)} (${d.installments}x, 1º vencimento ${fmtDate(d.due)}). ${hasC ? 'O saldo oficial usa os encargos <strong>cobrados</strong> que você lançou.' : 'Sem encargos lançados, o saldo oficial usa o <strong>previsto</strong>.'}</p>
    <div class="scroll"><table><tr><th></th><th class="num">Previsto (calculado)</th><th class="num">Cobrado (lançado)</th></tr>
      <tr><td>Principal em aberto</td><td class="num">${brl(Lp.P)}</td><td class="num">${c2((l) => l.P)}</td></tr>
      <tr><td>Juros em aberto</td><td class="num">${brl(Lp.I)}</td><td class="num">${c2((l) => l.I)}</td></tr>
      <tr><td>Multas e encargos em aberto</td><td class="num">${brl(Lp.M)}</td><td class="num">${c2((l) => l.M)}</td></tr>
      <tr><td>Juros acumulados (total)</td><td class="num">${brl(Lp.accI)}</td><td class="num">${c2((l) => l.accI)}</td></tr>
      <tr><td>Multas acumuladas (total)</td><td class="num">${brl(Lp.accM)}</td><td class="num">${c2((l) => l.accM)}</td></tr>
      <tr><th>Saldo atualizado</th><th class="num">${brl(Lp.bal)}</th><th class="num">${c2((l) => l.bal)}</th></tr>
      <tr><td>Total pago</td><td class="num" colspan="2">${brl(Lm.paidTotal)} (principal ${brl(Lm.paidP)} · juros ${brl(Lm.paidI)} · multas ${brl(Lm.paidM)})${Lm.excess > 0 ? ` · crédito ${brl(Lm.excess)}` : ''}</td></tr></table></div>
    <div class="ch"><canvas id="ch-d-hist"></canvas></div>
    <h3>Movimentos</h3><div class="scroll"><table><tr><th>Data</th><th>Movimento</th><th>Detalhe</th><th class="num">Valor</th><th class="num">Saldo após</th><th></th></tr>${mv.map((m) => `<tr class="${m.rec?.voided ? 'void' : ''}"><td>${fmtDate(m.date)}</td><td>${esc(m.kind)}${m.rec?.voided ? ' <span class="badge">Estornado</span>' : ''}</td><td>${esc(m.det)}</td>
      <td class="num">${m.v != null ? brl(m.v) : ''}</td><td class="num">${aft[m.id] != null ? brl(aft[m.id]) : ''}</td><td>${m.rec && !m.rec.voided ? `<button class="mini del" data-d="void" data-k="${m.k}" data-id="${d.id}" data-rid="${m.id}">Estornar</button>` : ''}</td></tr>`).join('')}</table></div>`);
  draw('ch-d-hist', { type: 'line', data: { labels: Lm.tl.map((t) => fmtDate(t.date)), datasets: [{ label: 'Saldo devedor', data: Lm.tl.map((t) => t.bal), borderColor: '#d6455d', backgroundColor: 'rgba(214,69,93,.15)', fill: true, stepped: true }] }, options: { scales: { y: money }, ...tip } });
}

/* ---------- 8. ALERTAS (somados à faixa de alertas do app.js) ---------- */
function debtAlerts() {
  const out = [];
  allDebts().filter((x) => x.st !== 'arquivada' && x.L.bal > 0.005).forEach(({ d, L, nd }) => {
    if (L.overdue) out.push(['neg', `Dívida ${d.institution} (${d.name}): ${L.overdue} parcela(s) em atraso — saldo ${brl(L.bal)}`]);
    else if (nd && dayDiff(today(), nd) <= 7) out.push(['warn', `Dívida ${d.institution} vence em ${Math.max(dayDiff(today(), nd), 0)} dia(s) (${fmtDate(nd)})`]);
    const acc = L.I + L.M; if (acc > 0.15 * L.P && acc > 0) out.push(['warn', `Juros em ${d.institution} já somam ${pct(acc, L.P).toFixed(0)}% do principal em aberto`]);
    const last = d.payments.filter((p) => !p.voided).map((p) => p.date).sort().pop();
    if (dayDiff(last || d.start, today()) > 35 && dayDiff(d.start, today()) > 35) out.push(['warn', `Sem pagamento registrado em ${d.institution} há ${dayDiff(last || d.start, today())} dias`]);
  });
  return out;
}

/* ---------- 9. EVENTOS ---------- */
document.addEventListener('DOMContentLoaded', () => {
  $('#d-type').innerHTML = '<option value="">Todos os tipos</option>' + DEBT_TYPES.map((t) => `<option>${t}</option>`).join('');
  ['#d-q', '#d-type', '#d-status', '#d-due', '#d-rate', '#d-sort'].forEach((s) => $(s).addEventListener('input', renderDebtTable));
  $('#d-add').onclick = () => editDebt();
  $('#s-debt').addEventListener('input', renderSim);
  $('#s-in').addEventListener('input', (e) => { const t = e.target; if (t.dataset.s) { sim.rows[+t.dataset.s][t.dataset.f] = Math.max(+t.value || 0, 0); renderSim(); } });
  const p = () => (state.debtPlan ||= { monthly: 0, strategy: 'Avalanche' });
  $('#p-monthly').value = p().monthly || ''; $('#p-strat').value = p().strategy;
  $('#p-monthly').addEventListener('input', (e) => { p().monthly = Math.max(+e.target.value || 0, 0); localStorage.setItem(KEY, JSON.stringify(state)); renderPlan(); });
  $('#p-strat').addEventListener('input', (e) => { p().strategy = e.target.value; localStorage.setItem(KEY, JSON.stringify(state)); renderPlan(); });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-d]'); if (!b) return; const id = b.dataset.id, d = DL().find((x) => x.id === id);
    ({ pay: () => addPayment(id), chg: () => addCharge(id), hist: () => showHistory(id), edit: () => editDebt(id),
       void: () => voidRecord(id, b.dataset.k, b.dataset.rid),
       arch: async () => { if (await ask(d.archived ? 'Reativar esta dívida?' : 'Arquivar esta dívida? O histórico é mantido.', d.archived ? 'Reativar' : 'Arquivar')) { d.archived = !d.archived; d.audit.push({ date: today(), text: d.archived ? 'Arquivada' : 'Reativada' }); save(); toast(d.archived ? 'Dívida arquivada' : 'Dívida reativada'); } },
       del: async () => { if (await ask(`Excluir a dívida “${d.name}”? Ela não tem pagamentos registrados.`, 'Excluir')) { state.debts = DL().filter((x) => x.id !== id); save(); toast('Dívida excluída'); } } })[b.dataset.d]();
  });
});
