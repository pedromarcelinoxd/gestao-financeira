'use strict';
/* =====================================================================
   extras.js – ideias inspiradas em Mobills e Organizze (carregado por último)
   1 Painel: patrimônio líquido, projeção de caixa (30 dias) e insights do mês
   2 Backup (exportar/importar) · 3 Ocultar valores · 4 Duplicar lançamento · 5 Atalho "N"
   ===================================================================== */

/* ---------- 1. PAINEL ---------- */
function renderExtras(list, ym) { renderNetWorth(); renderForecast(); renderInsights(list, ym); }

/** Patrimônio líquido = saldo atual + investimentos − dívidas em aberto. */
function renderNetWorth() {
  const inv = state.investments.reduce((a, i) => a + i.current, 0);
  const debt = typeof allDebts === 'function' ? allDebts().filter((x) => x.st !== 'arquivada').reduce((a, x) => a + x.L.bal, 0) : 0;
  const nw = lastBal.now + inv - debt;
  $('#cards-bal').insertAdjacentHTML('beforeend', card('Patrimônio líquido', brl(nw), nw >= 0 ? 'pri' : 'neg', `<small>Saldo atual + investimentos (${brl(inv)}) − dívidas (${brl(debt)})</small>`));
}

/** Projeção de caixa: parte do saldo atual e aplica contas a pagar e receitas a receber nos próximos 30 dias. */
function renderForecast() {
  const t0 = today(), N = 30, flow = Array(N + 1).fill(0);
  const slot = (d) => Math.max(dayDiff(t0, d), 0);          // itens atrasados caem no dia 0
  state.transactions.forEach((t) => {
    if (t.type === 'despesa' && status(t) !== 'pago') { const i = slot(t.due || t.date); if (i <= N) flow[i] -= remaining(t); }
    if (t.type === 'receita' && t.paid === false) { const i = slot(t.date); if (i <= N) flow[i] += t.amount; }
  });
  let b = lastBal.now;
  const data = flow.map((f) => (b = r2c(b + f)));
  const labels = flow.map((_, i) => { const d = new Date(t0 + 'T12:00'); d.setDate(d.getDate() + i); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); });
  const lo = Math.min(...data), k = data.indexOf(lo);
  $('#fc-note').textContent = lo < 0 ? `Atenção: o saldo previsto fica negativo (${brl(lo)}) em ${labels[k]}. Antecipe recebimentos ou adie gastos.` : `Menor saldo previsto nos próximos 30 dias: ${brl(lo)} (${labels[k]}).`;
  $('#fc-note').className = 'hint ' + (lo < 0 ? 'neg-text' : '');
  draw('ch-forecast', { type: 'line', data: { labels, datasets: [{ label: 'Saldo previsto', data, borderColor: '#2f5fd0', backgroundColor: 'rgba(47,95,208,.15)', fill: true, stepped: true, pointRadius: 0 }] }, options: { scales: { y: money }, ...tip } });
}

/** "Meu desempenho": comparações automáticas do mês com o mês anterior. */
function renderInsights(list, ym) {
  const prev = inMonth(addMonths(ym, -1)), des = sum(list, 'despesa'), pdes = sum(prev, 'despesa'), rec = sum(list, 'receita'), out = [];
  const byCat = (l) => { const m = {}; l.filter((t) => t.type === 'despesa').forEach((t) => (m[t.category] = (m[t.category] || 0) + t.amount)); return m; };
  const c = byCat(list), p = byCat(prev), top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  if (pdes > 0 && des > 0) { const d = ((des - pdes) / pdes) * 100; out.push([d > 5 ? 'neg' : d < -5 ? 'pos' : '', `Você gastou ${Math.abs(d).toFixed(0)}% ${d >= 0 ? 'a mais' : 'a menos'} que em ${monthLabel(addMonths(ym, -1))} (${brl(des)} contra ${brl(pdes)}).`]); }
  if (top) out.push(['', `Maior gasto do mês: ${top[0]} — ${brl(top[1])} (${pct(top[1], des).toFixed(0)}% das despesas).`]);
  const up = Object.entries(c).map(([k, v]) => [k, v - (p[k] || 0)]).filter(([k, d]) => p[k] > 0 && d >= 50 && d / p[k] >= 0.3).sort((a, b) => b[1] - a[1])[0];
  if (up) out.push(['warn', `${up[0]} subiu ${brl(up[1])} (${pct(up[1], p[up[0]]).toFixed(0)}%) em relação ao mês anterior.`]);
  if (rec > 0) { const s = pct(rec - des, rec); out.push(s < 0 ? ['neg', `Suas despesas passaram da renda recebida em ${brl(des - rec)}.`] : [s >= 20 ? 'pos' : s < 10 ? 'warn' : '', `Você está guardando ${s.toFixed(0)}% da renda do mês${s >= 20 ? ', acima da referência de 20%.' : '. Uma referência comum é guardar 20%.'}`]); }
  if (openSum('proximo')) out.push(['warn', `${brl(openSum('proximo'))} em contas vencem nos próximos 7 dias.`]);
  $('#insights').innerHTML = out.map(([k, m]) => `<li class="ins ${k}">${esc(m)}</li>`).join('') || '<li class="ins">Cadastre lançamentos para ver comparações automáticas.</li>';
}

/* ---------- 2. BACKUP (os dados ficam só neste navegador: exporte de vez em quando) ---------- */
function exportBackup() {
  const blob = new Blob([JSON.stringify({ app: 'caderno-de-contas', version: 1, exportedAt: new Date().toISOString(), state }, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `caderno-backup-${today()}.json` });
  a.click(); URL.revokeObjectURL(a.href); toast('Backup exportado');
}
async function importBackup(file) {
  try {
    const s = JSON.parse(await file.text()).state;
    if (!s || !Array.isArray(s.transactions) || ['goals', 'investments', 'debts', 'recurring', 'tasks', 'events', 'notes', 'projects', 'areas'].some((k) => s[k] && !Array.isArray(s[k]))) throw new Error('formato');
    if (!(await ask(`Importar este backup? Todos os dados atuais serão substituídos (${s.transactions.length} lançamentos no arquivo).`, 'Importar'))) return;
    state = Object.assign({ transactions: [], budgets: {}, goals: [], investments: [] }, s); save(); toast('Backup importado com sucesso');
  } catch { toast('Arquivo inválido: use um backup exportado por este sistema.', 'neg'); }
}

/* ---------- 3. OCULTAR VALORES ---------- */
function setHide(on) {
  document.body.classList.toggle('hide-values', on); $('#eye').textContent = on ? 'Mostrar valores' : 'Ocultar valores';
  $('#eye').setAttribute('aria-pressed', String(on)); localStorage.setItem('caderno_hide', on ? '1' : '');
}

/* ---------- 4. DUPLICAR LANÇAMENTO (cria uma cópia e já abre para editar) ---------- */
function dupTx(id) {
  const t = state.transactions.find((x) => x.id === id), c = { ...t, id: uid(), date: today(), due: t.type === 'despesa' ? today() : '', paid: false, paidDate: '' };
  ['ruleId', 'ym', 'payments', 'paidAmount'].forEach((k) => delete c[k]);
  state.transactions.push(c); save(); toast('Lançamento duplicado: ajuste os dados e salve.'); editTransaction(c.id);
}

/* ---------- 5. EVENTOS ---------- */
document.addEventListener('DOMContentLoaded', () => {
  setHide(!!localStorage.getItem('caderno_hide'));
  $('#eye').onclick = () => setHide(!document.body.classList.contains('hide-values'));
  $('#btn-export').onclick = exportBackup;
  $('#btn-import').onclick = () => $('#file-import').click();
  $('#file-import').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importBackup(f); });
  // Atalho: tecla N abre "Novo lançamento" (fora de campos de texto e de modais)
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]') || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    e.preventDefault(); editTransaction();
  });
});
