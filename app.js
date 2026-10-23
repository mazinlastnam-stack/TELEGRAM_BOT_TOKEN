'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { data: null, timezone: 'Africa/Khartoum', currency: 'SDG', taskFilter: 'open', messageTimer: null };
const pageTitles = { overview: 'نظرة عامة', tasks: 'المهام والتذكيرات', notes: 'الملاحظات الشخصية', links: 'الروابط المحفوظة', finance: 'إدارة المصروفات', files: 'الملفات' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function formatDate(value, includeTime = true) {
  if (!value) return 'دون موعد محدد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'تاريخ غير صالح';
  try {
    return new Intl.DateTimeFormat('ar', { timeZone: state.timezone, year: 'numeric', month: 'short', day: 'numeric', ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(date);
  } catch { return date.toLocaleString(); }
}
function money(value) {
  const n = Number(value) || 0;
  try { return `${new Intl.NumberFormat('ar', { maximumFractionDigits: 2 }).format(n)} ${state.currency}`; }
  catch { return `${n.toFixed(2)} ${state.currency}`; }
}
function showMessage(text, type = 'success') {
  const node = $('#global-message');
  node.textContent = text;
  node.className = `global-message ${type === 'error' ? 'error' : 'success'}`;
  node.hidden = false;
  clearTimeout(state.messageTimer);
  state.messageTimer = setTimeout(() => { node.hidden = true; }, 4200);
}
async function api(url, options = {}) {
  const opts = { credentials: 'same-origin', ...options, headers: { ...(options.headers || {}) } };
  if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== 'string') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const response = await fetch(url, opts);
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    if (response.status === 401 && url !== '/api/login') showLogin();
    throw new Error(payload?.error || `تعذّر تنفيذ الطلب (${response.status}).`);
  }
  return payload;
}
function showLogin() {
  $('#app-screen').hidden = true;
  $('#login-screen').hidden = false;
  $('#password').value = '';
  setTimeout(() => $('#password').focus(), 0);
}
function showApp() {
  $('#login-screen').hidden = true;
  $('#app-screen').hidden = false;
}
async function loadData() {
  const data = await api('/api/data');
  state.data = data;
  state.currency = data.summary.currency || state.currency;
  state.timezone = data.summary.timezone || state.timezone;
  $('#timezone-label').textContent = state.timezone;
  renderAll();
}
function renderAll() {
  const d = state.data;
  if (!d) return;
  const openTasks = d.tasks.filter(t => !t.done);
  $('#stat-tasks').textContent = openTasks.length;
  $('#stat-notes').textContent = d.notes.length;
  $('#stat-balance').textContent = money(d.summary.balance);
  $('#stat-currency').textContent = state.currency;
  $('#stat-files').textContent = d.files.length;
  $('#summary-income').textContent = money(d.summary.income);
  $('#summary-expenses').textContent = money(d.summary.expenses);
  $('#summary-balance').textContent = money(d.summary.balance);
  $('#finance-income').textContent = money(d.summary.income);
  $('#finance-expenses').textContent = money(d.summary.expenses);
  $('#finance-balance').textContent = money(d.summary.balance);
  $('#overview-tasks').innerHTML = openTasks.length ? openTasks.slice(0, 5).map(taskMarkup).join('') : '<div class="empty-state">لا توجد مهام مفتوحة. يمكنك إضافة مهمة جديدة.</div>';
  renderTasks(); renderNotes(); renderLinks(); renderTransactions(); renderFiles();
}
function taskMarkup(task) {
  return `<div class="task-item"><input class="task-check" type="checkbox" data-action="toggle-task" data-id="${escapeHtml(task.id)}" ${task.done ? 'checked' : ''} aria-label="تغيير حالة المهمة"><div class="task-main"><span class="task-title ${task.done ? 'completed' : ''}">${escapeHtml(task.title)}</span><div class="task-meta"><span>${task.dueAt ? `الموعد: ${escapeHtml(formatDate(task.dueAt))}` : 'دون موعد محدد'}</span><span class="task-id">${escapeHtml(task.id)}</span>${task.notifiedAt ? '<span>أُرسل التذكير</span>' : ''}</div></div><div class="item-actions"><button class="mini-button delete" data-action="delete-task" data-id="${escapeHtml(task.id)}" title="حذف المهمة" aria-label="حذف المهمة">×</button></div></div>`;
}
function renderTasks() {
  const tasks = state.data.tasks.filter(t => state.taskFilter === 'all' || (state.taskFilter === 'done' ? t.done : !t.done));
  $('#tasks-list').innerHTML = tasks.length ? tasks.map(taskMarkup).join('') : '<div class="empty-state">لا توجد مهام في هذه القائمة.</div>';
  $$('[data-task-filter]').forEach(btn => btn.classList.toggle('active', btn.dataset.taskFilter === state.taskFilter));
}
function renderNotes() {
  const q = ($('#notes-search').value || '').trim().toLocaleLowerCase();
  const notes = state.data.notes.filter(n => !q || n.text.toLocaleLowerCase().includes(q));
  $('#notes-count').textContent = `${state.data.notes.length} ملاحظة`;
  $('#notes-list').innerHTML = notes.length ? notes.map(n => `<article class="note-card"><div class="note-card-top"><time>${escapeHtml(formatDate(n.createdAt))}</time><div class="item-actions"><span class="task-id">${escapeHtml(n.id)}</span><button class="mini-button delete" data-action="delete-note" data-id="${escapeHtml(n.id)}" aria-label="حذف الملاحظة" title="حذف الملاحظة">×</button></div></div><p>${escapeHtml(n.text)}</p></article>`).join('') : '<div class="empty-state">لا توجد ملاحظات مطابقة للبحث.</div>';
}
function renderLinks() {
  const links = state.data.links;
  $('#links-list').innerHTML = links.length ? [...links].reverse().map(l => `<div class="link-item"><div class="link-symbol">↗</div><div class="link-content"><strong>${escapeHtml(l.title)}</strong><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.url)}</a><div class="task-meta"><span>${escapeHtml(formatDate(l.createdAt))}</span><span class="task-id">${escapeHtml(l.id)}</span></div></div><div class="item-actions"><button class="mini-button delete" data-action="delete-link" data-id="${escapeHtml(l.id)}" aria-label="حذف الرابط" title="حذف الرابط">×</button></div></div>`).join('') : '<div class="empty-state">لم تحفظ أي روابط بعد.</div>';
}
function renderTransactions() {
  const txs = state.data.transactions;
  $('#transactions-list').innerHTML = txs.length ? txs.map(t => `<tr><td>${escapeHtml(formatDate(t.createdAt))}</td><td><span class="type-pill ${t.type}">${t.type === 'income' ? 'دخل' : 'مصروف'}</span></td><td>${escapeHtml(t.description)}</td><td class="${t.type === 'income' ? 'positive' : 'negative'}">${t.type === 'income' ? '+' : '−'} ${escapeHtml(money(t.amount))}</td><td><button class="mini-button delete" data-action="delete-transaction" data-id="${escapeHtml(t.id)}" title="حذف العملية" aria-label="حذف العملية">×</button></td></tr>`).join('') : '<tr><td colspan="5"><div class="empty-state">لا توجد عمليات مالية بعد.</div></td></tr>';
}
function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function renderFiles() {
  const files = state.data.files;
  $('#files-list').innerHTML = files.length ? [...files].reverse().map(f => {
    const ext = (f.originalName.split('.').pop() || 'FILE').slice(0, 5).toUpperCase();
    return `<article class="file-card"><div class="file-kind">${escapeHtml(ext)}</div><div class="file-info"><strong>${escapeHtml(f.originalName)}</strong><small>${escapeHtml(fileSize(f.size))} · ${escapeHtml(f.source === 'telegram' ? 'تيليجرام' : 'لوحة الويب')} · ${escapeHtml(formatDate(f.createdAt))}</small></div><div class="file-buttons"><a class="mini-button" href="/api/files/${encodeURIComponent(f.id)}/download" title="تنزيل الملف" aria-label="تنزيل الملف">↓</a><button class="mini-button delete" data-action="delete-file" data-id="${escapeHtml(f.id)}" title="حذف الملف" aria-label="حذف الملف">×</button></div></article>`;
  }).join('') : '<div class="empty-state">لا توجد ملفات محفوظة. ارفع ملفًا أو أرسله إلى البوت في تيليجرام.</div>';
}
async function refresh() {
  try { await loadData(); } catch (err) { showMessage(err.message, 'error'); }
}
function switchView(view) {
  if (!pageTitles[view]) return;
  $$('.view').forEach(el => el.classList.toggle('active', el.id === `view-${view}`));
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  $('#page-title').textContent = pageTitles[view];
}
function goToForm(view, selector) {
  switchView(view);
  const field = $(selector);
  if (field) setTimeout(() => field.focus(), 50);
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const error = $('#login-error'); error.textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: { password: $('#password').value } });
    showApp(); await loadData();
  } catch (err) { error.textContent = err.message; }
});
$('#logout-button').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  showLogin();
});
$('#refresh-button').addEventListener('click', refresh);
$$('.nav-item').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
$$('[data-go]').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.go)));
$$('[data-quick]').forEach(btn => btn.addEventListener('click', () => {
  const key = btn.dataset.quick;
  const map = { task: ['tasks', '#task-title'], note: ['notes', '#note-text'], expense: ['finance', '#transaction-amount'], link: ['links', '#link-url'] };
  goToForm(...map[key]);
  if (key === 'expense') $('#transaction-type').value = 'expense';
}));
$$('[data-task-filter]').forEach(btn => btn.addEventListener('click', () => { state.taskFilter = btn.dataset.taskFilter; renderTasks(); }));
$('#notes-search').addEventListener('input', renderNotes);

$('#task-form').addEventListener('submit', async event => {
  event.preventDefault();
  const title = $('#task-title').value.trim();
  const localDate = $('#task-due').value;
  try {
    await api('/api/tasks', { method: 'POST', body: { title, dueAt: localDate ? new Date(localDate).toISOString() : null } });
    $('#task-title').value = ''; $('#task-due').value = ''; await loadData(); showMessage('تمت إضافة المهمة.');
  } catch (err) { showMessage(err.message, 'error'); }
});
$('#note-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await api('/api/notes', { method: 'POST', body: { text: $('#note-text').value.trim() } }); $('#note-text').value = ''; await loadData(); showMessage('تم حفظ الملاحظة.'); }
  catch (err) { showMessage(err.message, 'error'); }
});
$('#link-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await api('/api/links', { method: 'POST', body: { url: $('#link-url').value.trim(), title: $('#link-title').value.trim() } }); $('#link-url').value = ''; $('#link-title').value = ''; await loadData(); showMessage('تم حفظ الرابط.'); }
  catch (err) { showMessage(err.message, 'error'); }
});
$('#transaction-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await api('/api/transactions', { method: 'POST', body: { type: $('#transaction-type').value, amount: Number($('#transaction-amount').value), description: $('#transaction-description').value.trim() } }); $('#transaction-amount').value = ''; $('#transaction-description').value = ''; await loadData(); showMessage('تم تسجيل العملية المالية.'); }
  catch (err) { showMessage(err.message, 'error'); }
});
$('#file-form').addEventListener('submit', async event => {
  event.preventDefault();
  const file = $('#file-input').files[0]; if (!file) return;
  const form = new FormData(); form.append('file', file);
  try { await api('/api/files', { method: 'POST', body: form }); $('#file-input').value = ''; await loadData(); showMessage('تم رفع الملف.'); }
  catch (err) { showMessage(err.message, 'error'); }
});

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  try {
    if (action === 'toggle-task') {
      const task = state.data.tasks.find(t => t.id === id); if (!task) return;
      await api(`/api/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: { done: button.checked } });
    } else if (action === 'delete-task') {
      if (!confirm('هل تريد حذف هذه المهمة؟')) return;
      await api(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } else if (action === 'delete-note') {
      if (!confirm('هل تريد حذف هذه الملاحظة؟')) return;
      await api(`/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } else if (action === 'delete-link') {
      if (!confirm('هل تريد حذف هذا الرابط؟')) return;
      await api(`/api/links/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } else if (action === 'delete-transaction') {
      if (!confirm('هل تريد حذف هذه العملية المالية؟')) return;
      await api(`/api/transactions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } else if (action === 'delete-file') {
      if (!confirm('سيُحذف الملف نهائيًا من مساحة التخزين. هل تريد المتابعة؟')) return;
      await api(`/api/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
    await loadData();
    showMessage('تم تحديث البيانات.');
  } catch (err) { showMessage(err.message, 'error'); }
});

(async function init() {
  $('#today-label').textContent = new Intl.DateTimeFormat('ar', { dateStyle: 'full', timeZone: 'Africa/Khartoum' }).format(new Date());
  try {
    const me = await api('/api/me');
    state.timezone = me.timezone || state.timezone; state.currency = me.currency || state.currency;
    if (me.authenticated) { showApp(); await loadData(); } else showLogin();
  } catch { showLogin(); }
})();
