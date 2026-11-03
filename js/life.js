'use strict';
/* =====================================================================
   life.js – organização pessoal (carregado depois dos outros módulos)
   Reaproveita state/save/openForm/ask/toast/card/bar e integra as contas a
   pagar/receber ao calendário e ao "Início".
   1 Dados e utilitários · 2 Calendário · 3 Início · 4 Tarefas · 5 Projetos e áreas
   6 Notas · 7 Formulários · 8 Eventos
   ===================================================================== */
Object.assign(TITLES, { today: 'Início', calendar: 'Calendário', tasks: 'Tarefas', projects: 'Projetos e áreas', notes: 'Notas' });

/* ---------- 1. DADOS E UTILITÁRIOS ---------- */
const LD = (k) => (state[k] ||= []);
const areas = () => (state.areas ||= ['Finanças', 'Saúde', 'Carreira', 'Estudos', 'Casa'].map((name) => ({ id: uid(), name })));
const QUOTES = ['Disciplina hoje, liberdade amanhã.', 'Pequenos passos todos os dias levam longe.', 'O que é medido melhora.', 'Organize o dia e o dinheiro acompanha.', 'Feito é melhor que perfeito.'];
const plusDays = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isoWeek = (d) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); };
const cal = { y: +today().slice(0, 4), m: +today().slice(5, 7) - 1, sel: today() };

/** O evento acontece no dia d? (considera repetição diária, semanal e mensal) */
const occursOn = (e, d) => d >= e.date && (d === e.date || e.repeat === 'Diária' || (e.repeat === 'Semanal' && dayDiff(e.date, d) % 7 === 0) || (e.repeat === 'Mensal' && d.slice(8) === e.date.slice(8)));
const eventsOn = (d) => LD('events').filter((e) => occursOn(e, d)).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
const tasksOn = (d) => LD('tasks').filter((t) => t.due === d);
/** Integração com as finanças: contas a pagar em aberto e receitas a receber que vencem no dia. */
const billsOn = (d) => state.transactions.filter((t) => (t.type === 'despesa' && status(t) !== 'pago' && (t.due || t.date) === d) || (t.type === 'receita' && t.paid === false && t.date === d));
const dueBadge = (t) => (t.done ? '<span class="badge pago">Concluída</span>' : !t.due ? '—' : t.due < today() ? '<span class="badge vencido">Atrasada</span> ' + fmtDate(t.due) : t.due === today() ? '<span class="badge proximo">Hoje</span>' : fmtDate(t.due));
const checkbox = (t) => `<input type="checkbox" data-l="toggle" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="Concluir tarefa">`;

/* ---------- 2. CALENDÁRIO ---------- */
function monthGrid(y, m, sel, big) {
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate(), t = today();
  let h = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((x) => `<b>${x}</b>`).join('') + '<span></span>'.repeat(first);
  for (let i = 1; i <= days; i++) {
    const d = `${y}-${pad(m + 1)}-${pad(i)}`, bl = billsOn(d);
    h += `<button type="button" data-day="${d}" class="${d === sel ? 'sel' : ''}${d === t ? ' now' : ''}" aria-label="${fmtDate(d)}">${i}<i class="dots">${eventsOn(d).length ? '<u class="ev"></u>' : ''}${tasksOn(d).some((x) => !x.done) ? '<u class="tk"></u>' : ''}${bl.some((b) => b.type === 'despesa') ? '<u class="bill"></u>' : ''}${bl.some((b) => b.type === 'receita') ? '<u class="inc"></u>' : ''}</i></button>`;
  }
  return `<div class="mcal ${big ? 'big' : ''}">${h}</div>`;
}
const monthTitle = () => new Date(cal.y, cal.m, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
/** Lista do dia: compromissos, tarefas e contas. */
function dayHtml(d) {
  const rows = [
    ...eventsOn(d).map((e) => `<li><span class="dot ev"></span><div><strong>${e.time ? e.time + ' · ' : ''}${esc(e.title)}</strong><small>${e.type}${e.repeat !== 'Nenhuma' ? ' · repete ' + e.repeat.toLowerCase() : ''}${e.notes ? ' · ' + esc(e.notes) : ''}</small></div><span class="acts"><button class="mini" data-l="editevent" data-id="${e.id}">Editar</button> <button class="mini del" data-l="delevent" data-id="${e.id}">Excluir</button></span></li>`),
    ...tasksOn(d).map((t) => `<li>${checkbox(t)}<div class="${t.done ? 'done' : ''}"><strong>${esc(t.title)}</strong><small>Tarefa · prioridade ${t.priority.toLowerCase()}</small></div></li>`),
    ...billsOn(d).map((b) => `<li><span class="dot ${b.type === 'despesa' ? 'bill' : 'inc'}"></span><div><strong>${b.type === 'despesa' ? 'Pagar' : 'Receber'}: ${esc(b.desc)}</strong><small>${brl(remaining(b))}</small></div></li>`),
  ];
  return rows.length ? `<ul class="agenda">${rows.join('')}</ul>` : '<p class="hint">Nada marcado para este dia.</p>';
}
function renderCalendar() {
  $('#c-title').textContent = monthTitle(); $('#c-grid').innerHTML = monthGrid(cal.y, cal.m, cal.sel, true);
  $('#c-day-title').textContent = 'Agenda de ' + fmtDate(cal.sel);
  $('#c-day').innerHTML = dayHtml(cal.sel) + '<div class="row"><button class="mini" data-l="addevent">+ Evento</button> <button class="mini" data-l="addtask">+ Tarefa</button></div>';
}

/* ---------- 3. INÍCIO ---------- */
let tab = 'tasks';
function renderToday() {
  const t = today(), now = new Date(), h = now.getHours(), wk = Array.from({ length: 7 }, (_, i) => plusDays(t, i - now.getDay()));
  const T = LD('tasks'), open = T.filter((x) => !x.done), notes = LD('notes'), projs = LD('projects').filter((p) => p.status === 'Ativo');
  $('#t-greet').textContent = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  $('#t-quote').textContent = `“${QUOTES[now.getDate() % QUOTES.length]}”`;
  $('#t-date').textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#t-week').textContent = `Semana ${isoWeek(now)} de ${now.getFullYear()}`;
  renderBalances(); // atualiza o saldo atual usado no card abaixo
  const bills = state.transactions.filter((x) => ['vencido', 'proximo'].includes(status(x)));
  $('#t-cards').innerHTML = card('Tarefas', String(open.filter((x) => x.due && x.due <= t).length), 'pri', `<small>${T.filter((x) => x.done && x.doneAt === t).length} concluídas hoje</small>`) +
    card('Compromissos', String(eventsOn(t).length), 'pri', '<small>hoje</small>') + card('Notas', String(notes.filter((n) => n.created >= wk[0]).length), 'pri', '<small>criadas na semana</small>') +
    card('Projetos', String(projs.length), 'pri', '<small>ativos</small>') + card('Contas a vencer', String(bills.length), bills.length ? 'neg' : 'pos', `<small>${brl(openSum('vencido', 'proximo'))} em 7 dias ou atrasadas</small>`) +
    card('Saldo atual', brl(lastBal.now), lastBal.now >= 0 ? 'pos' : 'neg', '<small>só o que já foi recebido e pago</small>');
  // Hoje em resumo: prioridades + agenda
  const prio = open.filter((x) => x.focus || (x.priority === 'Alta' && x.due && x.due <= t));
  const agenda = [...eventsOn(t).map((e) => `<li><small>${e.time || 'dia todo'}</small><span>${esc(e.title)}</span></li>`), ...billsOn(t).map((b) => `<li><small>${b.type === 'despesa' ? 'pagar' : 'receber'}</small><span>${esc(b.desc)} · ${brl(remaining(b))}</span></li>`)];
  $('#t-glance').innerHTML = `<h4>Prioridades</h4>${prio.length ? `<ul class="agenda">${prio.map((x) => `<li>${checkbox(x)}<span>${esc(x.title)}</span></li>`).join('')}</ul>` : '<p class="hint">Nenhuma prioridade ainda.</p>'}<h4>Agenda de hoje</h4>${agenda.length ? `<ul class="agenda plain">${agenda.join('')}</ul>` : '<p class="hint">Nada na agenda de hoje.</p>'}`;
  // Próximos 7 dias (abas)
  const d7 = Array.from({ length: 7 }, (_, i) => plusDays(t, i)), li = (d, x, y) => `<li><small>${fmtDate(d).slice(0, 5)}</small><span>${x}</span>${y ? `<small>${y}</small>` : ''}</li>`;
  const rows = tab === 'tasks' ? [...open.filter((x) => x.due && x.due < t).map((x) => li(x.due, esc(x.title), 'atrasada')), ...d7.flatMap((d) => tasksOn(d).filter((x) => !x.done).map((x) => li(d, esc(x.title), x.priority)))]
    : tab === 'events' ? d7.flatMap((d) => eventsOn(d).map((e) => li(d, esc(e.title), e.time || '')))
    : [...bills.filter((x) => status(x) === 'vencido').map((x) => li(x.due || x.date, esc(x.desc), 'vencida')), ...d7.flatMap((d) => billsOn(d).map((b) => li(d, esc(b.desc), brl(remaining(b)))))];
  $('#t-tabs').innerHTML = [['tasks', 'Tarefas'], ['events', 'Compromissos'], ['bills', 'Contas']].map(([k, n]) => `<button type="button" data-tab="${k}" class="${tab === k ? 'on' : ''}">${n}</button>`).join('');
  $('#t-upcoming').innerHTML = rows.length ? `<ul class="agenda plain">${rows.join('')}</ul>` : '<p class="hint">Nada previsto para os próximos 7 dias.</p>';
  // Calendário, notas, projetos, semana, áreas
  $('#t-cal').innerHTML = `<div class="cal-h"><button type="button" data-l="calprev" aria-label="Mês anterior">‹</button><strong>${monthTitle()}</strong><button type="button" data-l="calnext" aria-label="Próximo mês">›</button></div>${monthGrid(cal.y, cal.m, cal.sel, false)}<p class="hint legend"><u class="ev"></u>compromisso <u class="tk"></u>tarefa <u class="bill"></u>conta <u class="inc"></u>receita</p>`;
  $('#t-notes').innerHTML = [...notes].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 3).map((n) => `<p class="mini-note"><strong>${esc(n.title)}</strong><small>${fmtDate(n.updated)}</small></p>`).join('') || '<p class="hint">Nenhuma nota recente.</p>';
  $('#t-projects').innerHTML = projs.map((p) => { const pr = projProgress(p); return `<p class="mini-note"><strong>${esc(p.name)}</strong><small>${pr.toFixed(0)}%</small></p>${bar(pr)}`; }).join('') || '<p class="hint">Nenhum projeto ativo.</p>';
  const wkTasks = T.filter((x) => wk.includes(x.due) || wk.includes(x.doneAt)), wkEv = wk.reduce((a, d) => a + eventsOn(d).length, 0);
  $('#t-week-stats').innerHTML = `<div class="stats"><div><small>Tarefas concluídas</small><strong>${wkTasks.filter((x) => x.done).length}</strong><small>de ${wkTasks.length}</small></div><div><small>Compromissos</small><strong>${wkEv}</strong><small>na semana</small></div><div><small>Notas criadas</small><strong>${notes.filter((n) => n.created >= wk[0]).length}</strong><small>na semana</small></div></div>`;
  $('#t-areas').innerHTML = areas().map((a) => `<span class="chip">${esc(a.name)}<small>${LD('projects').filter((p) => p.area === a.name).length} proj.</small></span>`).join('');
}

/* ---------- 4. TAREFAS ---------- */
function renderTasks() {
  const sel = $('#k-proj'), prev = sel.value, q = $('#k-q').value.toLowerCase(), st = $('#k-status').value, t = today();
  sel.innerHTML = '<option value="">Todos os projetos</option>' + LD('projects').map((p) => `<option>${esc(p.name)}</option>`).join(''); sel.value = [...sel.options].some((o) => o.value === prev) ? prev : '';
  const list = LD('tasks').filter((x) => x.title.toLowerCase().includes(q) && (!sel.value || x.project === sel.value)
    && (!st || (st === 'pendentes' ? !x.done : st === 'concluidas' ? x.done : !x.done && x.due && x.due < t)))
    .sort((a, b) => a.done - b.done || (a.due || '9').localeCompare(b.due || '9'));
  $('#k-table').innerHTML = '<tr><th></th><th>Tarefa</th><th>Prazo</th><th>Prioridade</th><th></th></tr>' + (list.map((x) => `<tr class="${x.done ? 'void' : ''}"><td>${checkbox(x)}</td>
    <td><strong>${esc(x.title)}</strong>${x.focus ? ' <span class="badge proximo">Foco do dia</span>' : ''}${x.project ? `<br><small>${esc(x.project)}</small>` : ''}</td><td>${dueBadge(x)}</td><td><span class="tag">${x.priority}</span></td>
    <td><button class="mini" data-l="focus" data-id="${x.id}">${x.focus ? 'Tirar foco' : 'Foco'}</button> <button class="mini" data-l="edittask" data-id="${x.id}">Editar</button> <button class="mini del" data-l="deltask" data-id="${x.id}">Excluir</button></td></tr>`).join('')
    || '<tr><td class="empty" colspan="5">Nenhuma tarefa por aqui. Use “+ Nova tarefa” ou a captura rápida no Início.</td></tr>');
}

/* ---------- 5. PROJETOS E ÁREAS ---------- */
const projProgress = (p) => { const l = LD('tasks').filter((x) => x.project === p.name); return l.length ? (l.filter((x) => x.done).length / l.length) * 100 : 0; };
function renderProjects() {
  $('#p-areas').innerHTML = areas().map((a) => `<span class="chip">${esc(a.name)}<small>${LD('projects').filter((p) => p.area === a.name).length} projeto(s)</small><button type="button" class="x" data-l="delarea" data-id="${a.id}" aria-label="Remover área ${esc(a.name)}">×</button></span>`).join('');
  $('#p-cards').innerHTML = LD('projects').map((p) => { const pr = projProgress(p), l = LD('tasks').filter((x) => x.project === p.name);
    return card(esc(p.name), `${pr.toFixed(0)}%`, p.status === 'Concluído' ? 'pos' : p.status === 'Pausado' ? 'warn' : 'pri',
      `${bar(pr)}<small>${esc(p.area || 'Sem área')} · ${p.status}${p.deadline ? ' · prazo ' + fmtDate(p.deadline) : ''} · ${l.filter((x) => x.done).length}/${l.length} tarefas</small>
       <div class="row"><button class="mini" data-l="editproject" data-id="${p.id}">Editar</button><button class="mini del" data-l="delproject" data-id="${p.id}">Excluir</button></div>`); }).join('') || '<p class="hint">Nenhum projeto ainda. Crie o primeiro em “+ Novo projeto”.</p>';
}

/* ---------- 6. NOTAS ---------- */
function renderNotes() {
  const sel = $('#n-tag'), prev = sel.value, q = $('#n-q').value.toLowerCase(), tags = [...new Set(LD('notes').map((n) => n.tag).filter(Boolean))];
  sel.innerHTML = '<option value="">Todas as etiquetas</option>' + tags.map((x) => `<option>${esc(x)}</option>`).join(''); sel.value = tags.includes(prev) ? prev : '';
  const list = LD('notes').filter((n) => `${n.title} ${n.body}`.toLowerCase().includes(q) && (!sel.value || n.tag === sel.value)).sort((a, b) => (b.pinned || 0) - (a.pinned || 0) || b.updated.localeCompare(a.updated));
  $('#n-list').innerHTML = list.map((n) => `<div class="panel note">
    <h3>${esc(n.title)} ${n.pinned ? '<span class="badge proximo">Fixada</span>' : ''}</h3><p>${esc(n.body.slice(0, 240)).replace(/\n/g, '<br>')}${n.body.length > 240 ? '…' : ''}</p>
    <small>${n.tag ? '#' + esc(n.tag) + ' · ' : ''}atualizada em ${fmtDate(n.updated)}</small>
    <div class="row"><button class="mini" data-l="pin" data-id="${n.id}">${n.pinned ? 'Desafixar' : 'Fixar'}</button><button class="mini" data-l="editnote" data-id="${n.id}">Editar</button><button class="mini del" data-l="delnote" data-id="${n.id}">Excluir</button></div></div>`).join('')
    || '<p class="hint">Nenhuma nota encontrada.</p>';
}

/* ---------- 7. FORMULÁRIOS ---------- */
const byId$ = (k, id) => LD(k).find((x) => x.id === id);
const upsert = (k, id, item) => { state[k] = id ? LD(k).map((x) => (x.id === id ? item : x)) : [...LD(k), item]; };
function editTask(id, pre = {}) {
  const cur = byId$('tasks', id) || { priority: 'Média', ...pre };
  openForm(id ? 'Editar tarefa' : 'Nova tarefa', [
    { name: 'title', label: 'Tarefa', type: 'text', required: true },
    { name: 'due', label: 'Prazo (opcional)', type: 'date' },
    { name: 'priority', label: 'Prioridade', type: 'select', options: ['Alta', 'Média', 'Baixa'] },
    { name: 'project', label: 'Projeto', type: 'select', options: ['—', ...LD('projects').map((p) => p.name)] },
    { name: 'focus', label: 'Foco do dia?', type: 'select', options: ['Não', 'Sim'] },
  ], { ...cur, project: cur.project || '—', focus: cur.focus ? 'Sim' : 'Não' }, (d) => {
    upsert('tasks', id, { done: false, doneAt: '', ...(cur.id ? cur : {}), id: id || uid(), title: d.title, due: d.due, priority: d.priority, project: d.project === '—' ? '' : d.project, focus: d.focus === 'Sim' });
    save(); toast(id ? 'Tarefa atualizada' : 'Tarefa criada');
  });
}
function editEvent(id, pre = {}) {
  const cur = byId$('events', id) || { type: 'Evento', repeat: 'Nenhuma', date: today(), ...pre };
  openForm(id ? 'Editar compromisso' : 'Novo compromisso', [
    { name: 'title', label: 'Título', type: 'text', required: true },
    { name: 'type', label: 'Tipo', type: 'select', options: ['Evento', 'Reunião'] },
    { name: 'date', label: 'Data', type: 'date', required: true },
    { name: 'time', label: 'Horário (HH:MM, opcional)', type: 'text', check: (v) => (v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? 'Use o formato HH:MM, ex.: 14:30.' : '') },
    { name: 'repeat', label: 'Repetição', type: 'select', options: ['Nenhuma', 'Diária', 'Semanal', 'Mensal'] },
    { name: 'notes', label: 'Observações (opcional)', type: 'text' },
  ], cur, (d) => { upsert('events', id, { id: id || uid(), ...d }); save(); toast(id ? 'Compromisso atualizado' : 'Compromisso criado'); });
}
function editProject(id) {
  const cur = byId$('projects', id) || { status: 'Ativo' };
  openForm(id ? 'Editar projeto' : 'Novo projeto', [
    { name: 'name', label: 'Nome do projeto', type: 'text', required: true, check: (v) => (LD('projects').some((p) => p.id !== id && p.name.toLowerCase() === v.toLowerCase()) ? 'Já existe um projeto com esse nome.' : '') },
    { name: 'area', label: 'Área de foco', type: 'select', options: areas().map((a) => a.name) },
    { name: 'status', label: 'Situação', type: 'select', options: ['Ativo', 'Pausado', 'Concluído'] },
    { name: 'deadline', label: 'Prazo (opcional)', type: 'date' },
  ], cur, (d) => {
    if (id && cur.name !== d.name) LD('tasks').forEach((t) => { if (t.project === cur.name) t.project = d.name; });   // renomeia nas tarefas
    upsert('projects', id, { id: id || uid(), ...d }); save(); toast(id ? 'Projeto atualizado' : 'Projeto criado');
  });
}
function editNote(id, pre = {}) {
  const cur = byId$('notes', id) || pre;
  openForm(id ? 'Editar nota' : 'Nova nota', [
    { name: 'title', label: 'Título', type: 'text', required: true }, { name: 'tag', label: 'Etiqueta (opcional)', type: 'text' },
    { name: 'body', label: 'Texto', type: 'textarea' },
  ], cur, (d) => { upsert('notes', id, { pinned: false, ...(cur.id ? cur : {}), id: id || uid(), created: cur.created || today(), updated: today(), ...d }); save(); toast(id ? 'Nota atualizada' : 'Nota criada'); });
}
function addArea() {
  openForm('Nova área de foco', [{ name: 'name', label: 'Nome da área', type: 'text', required: true, check: (v) => (areas().some((a) => a.name.toLowerCase() === v.toLowerCase()) ? 'Essa área já existe.' : '') }], {}, (d) => { areas().push({ id: uid(), name: d.name }); save(); toast('Área criada'); });
}

/* ---------- 8. EVENTOS ---------- */
const LIFE_RENDER = { today: renderToday, calendar: renderCalendar, tasks: renderTasks, projects: renderProjects, notes: renderNotes };
function capture(kind) {
  const v = $('#qc').value.trim(), clear = () => { $('#qc').value = ''; };
  if (kind === 'note') { if (!v) return editNote(); LD('notes').push({ id: uid(), title: v, body: '', tag: '', pinned: false, created: today(), updated: today() }); clear(); save(); toast('Nota criada'); }
  else if (kind === 'task') { if (!v) return editTask(); LD('tasks').push({ id: uid(), title: v, due: today(), priority: 'Média', project: '', focus: false, done: false, doneAt: '' }); clear(); save(); toast('Tarefa criada para hoje'); }
  else { const pre = { title: v, type: kind === 'meeting' ? 'Reunião' : 'Evento' }; clear(); editEvent(null, pre); }
}
document.addEventListener('DOMContentLoaded', () => {
  ['#k-q', '#k-status', '#k-proj', '#n-q', '#n-tag'].forEach((s) => $(s).addEventListener('input', renderAll));
  $('#qc').addEventListener('keydown', (e) => { if (e.key === 'Enter') capture('task'); });
  document.addEventListener('click', async (e) => {
    const day = e.target.closest('[data-day]'), tb = e.target.closest('[data-tab]'), b = e.target.closest('[data-l]');
    if (day) { cal.sel = day.dataset.day; cal.y = +cal.sel.slice(0, 4); cal.m = +cal.sel.slice(5, 7) - 1; return currentView() === 'today' ? showView('calendar') : renderAll(); }
    if (tb) { tab = tb.dataset.tab; return renderAll(); }
    if (!b) return;
    const id = b.dataset.id, onCal = currentView() === 'calendar', find = (k) => byId$(k, id);
    const del = async (k, msg, after) => { if (await ask(msg, 'Excluir')) { state[k] = LD(k).filter((x) => x.id !== id); after?.(); save(); toast('Excluído'); } };
    const move = (n) => { cal.m += n; if (cal.m > 11) { cal.m = 0; cal.y++; } if (cal.m < 0) { cal.m = 11; cal.y--; } renderAll(); };
    ({ toggle: () => { const t = find('tasks'); t.done = !t.done; t.doneAt = t.done ? today() : ''; save(); },
       focus: () => { const t = find('tasks'); t.focus = !t.focus; save(); },
       addtask: () => editTask(null, onCal ? { due: cal.sel } : {}), addprio: () => editTask(null, { focus: true, due: today() }), edittask: () => editTask(id),
       deltask: () => del('tasks', `Excluir a tarefa “${find('tasks').title}”?`),
       addevent: () => editEvent(null, onCal ? { date: cal.sel } : {}), editevent: () => editEvent(id),
       delevent: () => del('events', `Excluir “${find('events').title}” (e todas as repetições)?`),
       addproject: () => editProject(), editproject: () => editProject(id),
       delproject: () => { const p = find('projects'); return del('projects', `Excluir o projeto “${p.name}”? As tarefas ficam, sem projeto.`, () => LD('tasks').forEach((t) => { if (t.project === p.name) t.project = ''; })); },
       addnote: () => editNote(), editnote: () => editNote(id), delnote: () => del('notes', `Excluir a nota “${find('notes').title}”?`),
       pin: () => { const n = find('notes'); n.pinned = !n.pinned; save(); },
       addarea: addArea, delarea: () => del('areas', `Remover a área “${areas().find((a) => a.id === id).name}”?`),
       calprev: () => move(-1), calnext: () => move(1), caltoday: () => { Object.assign(cal, { y: +today().slice(0, 4), m: +today().slice(5, 7) - 1, sel: today() }); renderAll(); },
       'qc-note': () => capture('note'), 'qc-task': () => capture('task'), 'qc-event': () => capture('event'), 'qc-meeting': () => capture('meeting') })[b.dataset.l]?.();
  });
});
