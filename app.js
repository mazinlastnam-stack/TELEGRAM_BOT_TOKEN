/* نسخة ثابتة لـ GitHub Pages: تخزين محلي داخل هذا المتصفح فقط. */
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const KEY = "personal-assistant-pages-v1";
const state = {
  data: null,
  timezone: "Africa/Khartoum",
  currency: "SDG",
  taskFilter: "open",
  messageTimer: null,
};
const pageTitles = {
  overview: "نظرة عامة",
  tasks: "المهام والتذكيرات",
  notes: "الملاحظات الشخصية",
  links: "الروابط المحفوظة",
  finance: "إدارة المصروفات",
  files: "الملفات",
};
function uid() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}
function escapeHtml(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );
}
function formatDate(v, time = true) {
  if (!v) return "دون موعد محدد";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "تاريخ غير صالح";
  try {
    return new Intl.DateTimeFormat("ar", {
      timeZone: state.timezone,
      year: "numeric",
      month: "short",
      day: "numeric",
      ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
    }).format(d);
  } catch {
    return d.toLocaleString("ar");
  }
}
function money(v) {
  return `${new Intl.NumberFormat("ar", { maximumFractionDigits: 2 }).format( Number(v) || 0 )} ${state.currency}`;
}
function showMessage(text, type = "success") {
  const n = $("#global-message");
  n.textContent = text;
  n.className = `global-message ${type === "error" ? "error" : "success"}`;
  n.hidden = false;
  clearTimeout(state.messageTimer);
  state.messageTimer = setTimeout(() => (n.hidden = true), 4000);
}
function freshData() {
  return {
    tasks: [],
    notes: [],
    links: [],
    transactions: [],
    files: [],
    summary: {
      currency: "SDG",
      timezone: "Africa/Khartoum",
      income: 0,
      expenses: 0,
      balance: 0,
    },
  };
}
function loadStore() {
  try {
    const x = JSON.parse(localStorage.getItem(KEY) || "null");
    if (x && Array.isArray(x.tasks)) return { ...freshData(), ...x };
  } catch {}
  return freshData();
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state.data));
  } catch (e) {
    showMessage(
      "مساحة التخزين في المتصفح ممتلئة. احذف بعض الملفات أو صدّر نسخة احتياطية.",
      "error"
    );
  }
}
function calc() {
  const tx = state.data.transactions;
  const income = tx
    .filter((x) => x.type === "income")
    .reduce((a, x) => a + Number(x.amount), 0);
  const expenses = tx
    .filter((x) => x.type === "expense")
    .reduce((a, x) => a + Number(x.amount), 0);
  state.data.summary = {
    currency: state.currency,
    timezone: state.timezone,
    income,
    expenses,
    balance: income - expenses,
  };
}
function persist() {
  calc();
  save();
  renderAll();
}
function taskMarkup(t) {
  return `<div class="task-item"><input class="task-check" type="checkbox" data-action="toggle-task" data-id="${escapeHtml( t.id )}" ${ t.done ? "checked" : "" } aria-label="تغيير حالة المهمة"><div class="task-main"><span class="task-title ${ t.done ? "completed" : "" }">${escapeHtml(t.title)}</span><div class="task-meta"><span>${ t.dueAt ? `الموعد: ${escapeHtml(formatDate(t.dueAt))}` : "دون موعد محدد" }</span>${ t.dueAt && !t.done && new Date(t.dueAt) > new Date() ? `<span>تذكير داخل اللوحة عند فتحها</span>` : "" }</div></div><div class="item-actions"><button class="mini-button delete" data-action="delete-task" data-id="${escapeHtml( t.id )}" title="حذف المهمة" aria-label="حذف المهمة">×</button></div></div>`;
}
function renderTasks() {
  const ts = state.data.tasks
    .filter(
      (t) =>
        state.taskFilter === "all" ||
        (state.taskFilter === "done" ? t.done : !t.done)
    )
    .sort((a, b) => (a.dueAt || "").localeCompare(b.dueAt || ""));
  $("#tasks-list").innerHTML = ts.length
    ? ts.map(taskMarkup).join()
    : '<div class="empty-state">لا توجد مهام في هذه القائمة.</div>';
  $$("[data-task-filter]").forEach((b) =>
    b.classList.toggle("active", b.dataset.taskFilter === state.taskFilter)
  );
}
function renderNotes() {
  const q = ($("#notes-search").value || "").trim().toLocaleLowerCase();
  const ns = state.data.notes.filter(
    (n) => !q || n.text.toLocaleLowerCase().includes(q)
  );
  $("#notes-count").textContent = `${state.data.notes.length} ملاحظة`;
  $("#notes-list").innerHTML = ns.length
    ? ns
        .map(
          (n) =>
            `<article class="note-card"><div class="note-card-top"><time>${escapeHtml( formatDate(n.createdAt) )}</time><div class="item-actions"><button class="mini-button delete" data-action="delete-note" data-id="${escapeHtml( n.id )}" aria-label="حذف الملاحظة">×</button></div></div><p>${escapeHtml( n.text ).replace(/\n/g, "<br>")}</p></article>`
        )
        .join()
    : '<div class="empty-state">لا توجد ملاحظات مطابقة للبحث.</div>';
}
function renderLinks() {
  const a = [...state.data.links].reverse();
  $("#links-list").innerHTML = a.length
    ? a
        .map(
          (l) =>
            `<div class="link-item"><div class="link-symbol">↗</div><div class="link-content"><strong>${escapeHtml( l.title || l.url )}</strong><a href="${escapeHtml( l.url )}" target="_blank" rel="noopener noreferrer">${escapeHtml( l.url )}</a><div class="task-meta"><span>${escapeHtml( formatDate(l.createdAt) )}</span></div></div><div class="item-actions"><button class="mini-button delete" data-action="delete-link" data-id="${escapeHtml( l.id )}" aria-label="حذف الرابط">×</button></div></div>`
        )
        .join()
    : '<div class="empty-state">لم تحفظ أي روابط بعد.</div>';
}
function renderTransactions() {
  const a = state.data.transactions.slice(0, 100);
  $("#transactions-list").innerHTML = a.length
    ? a
        .map(
          (t) =>
            `<tr><td>${escapeHtml( formatDate(t.createdAt) )}</td><td><span class="type-pill ${t.type}">${ t.type === "income" ? "دخل" : "مصروف" }</span></td><td>${escapeHtml( t.description || "—" )}</td><td class="${ t.type === "income" ? "positive" : "negative" }">${t.type === "income" ? "+" : "−"} ${escapeHtml( money(t.amount) )}</td><td><button class="mini-button delete" data-action="delete-transaction" data-id="${escapeHtml( t.id )}" aria-label="حذف العملية">×</button></td></tr>`
        )
        .join()
    : '<tr><td colspan="5"><div class="empty-state">لا توجد عمليات مالية بعد.</div></td></tr>';
}
function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
function renderFiles() {
  $("#files-list").innerHTML = state.data.files.length
    ? [...state.data.files]
        .reverse()
        .map(
          (f) =>
            `<article class="file-card"><div class="file-kind">${escapeHtml( (f.name.split(".").pop() || "FILE").slice(0, 5).toUpperCase() )}</div><div class="file-info"><strong>${escapeHtml( f.name )}</strong><small>${fmtSize( f.size )} · محفوظ في هذا المتصفح</small></div><div class="file-buttons"><a class="mini-button" href="${ f.data }" download="${escapeHtml( f.name )}" title="تنزيل الملف">↓</a><button class="mini-button delete" data-action="delete-file" data-id="${escapeHtml( f.id )}" title="حذف الملف">×</button></div></article>`
        )
        .join()
    : '<div class="empty-state">لا توجد ملفات محفوظة. أضف ملفًا من هذا المتصفح.</div>';
}
function renderAll() {
  const d = state.data;
  const open = d.tasks.filter((t) => !t.done);
  $("#stat-tasks").textContent = open.length;
  $("#stat-notes").textContent = d.notes.length;
  $("#stat-balance").textContent = money(d.summary.balance);
  $("#stat-currency").textContent = state.currency;
  $("#stat-files").textContent = d.files.length;
  $("#summary-income").textContent = money(d.summary.income);
  $("#summary-expenses").textContent = money(d.summary.expenses);
  $("#summary-balance").textContent = money(d.summary.balance);
  $("#finance-income").textContent = money(d.summary.income);
  $("#finance-expenses").textContent = money(d.summary.expenses);
  $("#finance-balance").textContent = money(d.summary.balance);
  $("#overview-tasks").innerHTML = open.length
    ? open
        .slice()
        .sort((a, b) => (a.dueAt || "").localeCompare(b.dueAt || ""))
        .slice(0, 5)
        .map(taskMarkup)
        .join()
    : '<div class="empty-state">لا توجد مهام مفتوحة. يمكنك إضافة مهمة جديدة.</div>';
  renderTasks();
  renderNotes();
  renderLinks();
  renderTransactions();
  renderFiles();
}
function switchView(v) {
  if (!pageTitles[v]) return;
  $$(".view").forEach((e) =>
    e.classList.toggle("active", e.id === `view-${v}`)
  );
  $$(".nav-item").forEach((e) =>
    e.classList.toggle("active", e.dataset.view === v)
  );
  $("#page-title").textContent = pageTitles[v];
}
function downloadBackup() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "personal-assistant-backup.json";
  a.click();
  URL.revokeObjectURL(a.href);
  showMessage("تم تنزيل نسخة احتياطية من البيانات.");
}
function checkDue() {
  const now = Date.now();
  const due = state.data.tasks.filter(
    (t) =>
      !t.done && t.dueAt && !t.alerted && new Date(t.dueAt).getTime() <= now
  );
  if (due.length) {
    due.forEach((t) => (t.alerted = true));
    save();
    showMessage(
      `لديك ${due.length} مهمة حان موعدها. افتح قائمة المهام لمراجعتها.`
    );
    try {
      if ("Notification" in window && Notification.permission === "granted")
        new Notification("تذكير بالمهام", {
          body: due
            .map((t) => t.title)
            .join("، ")
            .slice(0, 250),
        });
    } catch {}
  }
}
function init() {
  state.data = loadStore();
  state.currency = state.data.summary?.currency || "SDG";
  state.timezone = "Africa/Khartoum";
  $("#timezone-label").textContent = state.timezone;
  $("#today-label").textContent = new Intl.DateTimeFormat("ar", {
    dateStyle: "full",
    timeZone: state.timezone,
  }).format(new Date());
  // GitHub Pages is static: show dashboard directly; no server-side login is possible.
  $("#login-screen").hidden = true;
  $("#app-screen").hidden = false;
  calc();
  renderAll();
  checkDue();
  setInterval(checkDue, 60000);
}
$("#login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  showMessage(
    "نسخة GitHub Pages لا تستخدم تسجيل دخول آمنًا. لا تحفظ بيانات حساسة هنا.",
    "error"
  );
});
$("#logout-button").addEventListener("click", () =>
  showMessage(
    "هذه نسخة محلية بلا حساب مستخدم. أغلق الصفحة إذا كنت على جهاز مشترك.",
    "error"
  )
);
$("#refresh-button").addEventListener("click", () => {
  state.data = loadStore();
  calc();
  renderAll();
  showMessage("تم تحديث البيانات المحفوظة في هذا المتصفح.");
});
$$(".nav-item").forEach((b) =>
  b.addEventListener("click", () => switchView(b.dataset.view))
);
$$("[data-go]").forEach((b) =>
  b.addEventListener("click", () => switchView(b.dataset.go))
);
$$("[data-quick]").forEach((b) =>
  b.addEventListener("click", () => {
    const k = b.dataset.quick;
    const m = {
      task: ["tasks", "#task-title"],
      note: ["notes", "#note-text"],
      expense: ["finance", "#transaction-amount"],
      link: ["links", "#link-url"],
    };
    switchView(m[k][0]);
    setTimeout(() => $(m[k][1]).focus(), 50);
    if (k === "expense") $("#transaction-type").value = "expense";
  })
);
$$("[data-task-filter]").forEach((b) =>
  b.addEventListener("click", () => {
    state.taskFilter = b.dataset.taskFilter;
    renderTasks();
  })
);
$("#notes-search").addEventListener("input", renderNotes);
$("#task-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const title = $("#task-title").value.trim();
  if (!title) return;
  const v = $("#task-due").value;
  state.data.tasks.push({
    id: uid(),
    title,
    dueAt: v ? new Date(v).toISOString() : null,
    done: false,
    createdAt: new Date().toISOString(),
    alerted: false,
  });
  $("#task-title").value = "";
  $("#task-due").value = "";
  persist();
  showMessage("تمت إضافة المهمة. التذكير يعمل عندما تكون الصفحة مفتوحة.");
});
$("#note-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#note-text").value.trim();
  if (!text) return;
  state.data.notes.unshift({
    id: uid(),
    text,
    createdAt: new Date().toISOString(),
  });
  $("#note-text").value = "";
  persist();
  showMessage("تم حفظ الملاحظة في هذا المتصفح.");
});
$("#link-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const url = $("#link-url").value.trim();
  if (!url) return;
  state.data.links.push({
    id: uid(),
    url,
    title: $("#link-title").value.trim() || url,
    createdAt: new Date().toISOString(),
  });
  $("#link-url").value = "";
  $("#link-title").value = "";
  persist();
  showMessage("تم حفظ الرابط.");
});
$("#transaction-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const amount = Number($("#transaction-amount").value);
  if (!(amount > 0)) return;
  state.data.transactions.unshift({
    id: uid(),
    type: $("#transaction-type").value,
    amount,
    description: $("#transaction-description").value.trim(),
    createdAt: new Date().toISOString(),
  });
  $("#transaction-amount").value = "";
  $("#transaction-description").value = "";
  persist();
  showMessage("تم تسجيل العملية المالية.");
});
$("#file-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = $("#file-input").files[0];
  if (!f) return;
  if (f.size > 1500000) {
    showMessage(
      "في النسخة المجانية المحلية، اختر ملفًا أصغر من 1.5 ميغابايت لتجنب امتلاء تخزين المتصفح.",
      "error"
    );
    return;
  }
  const r = new FileReader();
  r.onload = () => {
    state.data.files.push({
      id: uid(),
      name: f.name,
      size: f.size,
      type: f.type,
      data: r.result,
      createdAt: new Date().toISOString(),
    });
    $("#file-input").value = "";
    persist();
    showMessage("تم حفظ الملف في تخزين المتصفح.");
  };
  r.onerror = () => showMessage("تعذرت قراءة الملف.", "error");
  r.readAsDataURL(f);
});
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const { action, id } = b.dataset;
  const lists = {
    "delete-task": "tasks",
    "delete-note": "notes",
    "delete-link": "links",
    "delete-transaction": "transactions",
    "delete-file": "files",
  };
  if (action === "toggle-task") {
    const t = state.data.tasks.find((x) => x.id === id);
    if (t) t.done = b.checked;
    persist();
    return;
  }
  if (!lists[action]) return;
  if (!confirm("هل تريد حذف هذا العنصر؟")) return;
  state.data[lists[action]] = state.data[lists[action]].filter(
    (x) => x.id !== id
  );
  persist();
  showMessage("تم الحذف.");
});
$("#file-limit").textContent = "1.5";
const backup = document.createElement("button");
backup.type = "button";
backup.className = "text-button";
backup.textContent = "تنزيل نسخة احتياطية";
backup.style.marginInlineStart = "12px";
backup.addEventListener("click", downloadBackup);
$(".topbar-right").appendChild(backup);
init();
