// App entry: PWA To‑Do with offline, IndexedDB, background notifications and reminders

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * ONE_DAY_MS;

// IndexedDB wrapper
const dbPromise = (() => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('focus-tasks-db', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('tasks')) {
        const store = db.createObjectStore('tasks', { keyPath: 'id' });
        store.createIndex('due', 'due');
        store.createIndex('completed', 'completed');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
})();

async function dbTxn(storeNames, mode, op) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    const stores = storeNames.map((n) => tx.objectStore(n));
    let opResult;
    tx.oncomplete = async () => {
      try {
        const finalValue = opResult instanceof Promise ? await opResult : opResult;
        resolve(finalValue);
      } catch (e) {
        reject(e);
      }
    };
    tx.onerror = () => reject(tx.error);
    try {
      opResult = op(...stores, tx);
    } catch (e) {
      reject(e);
    }
  });
}

// Utility
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function nowMs() { return Date.now(); }
function toInputDateTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

// State
let tasks = [];
let deleteMode = false; // deprecated
let selectedForDeletion = new Set(); // deprecated
let filterMode = 'all';
let searchQuery = '';
const pendingDeletions = new Map(); // id -> timeoutId

// Elements
const taskListEl = document.getElementById('taskList');
const upcomingSectionEl = document.getElementById('upcomingSection');
const upcomingListEl = document.getElementById('upcomingList');
const progressFillEl = document.getElementById('progressFill');
const importanceValueEl = document.getElementById('importanceValue');
const progressPctEl = document.getElementById('progressPct');
const addTaskButton = document.getElementById('addTaskButton');
const dialog = document.getElementById('taskDialog');
const form = document.getElementById('taskForm');
const titleInput = document.getElementById('taskTitle');
const dueInput = document.getElementById('taskDue');
const importanceInput = document.getElementById('taskImportance');
const notesInput = document.getElementById('taskNotes');
const recurrenceInput = document.getElementById('taskRecurrence');
const filterSelect = document.getElementById('filterSelect');
const searchInput = document.getElementById('searchInput');
const exportButton = document.getElementById('exportButton');
const importButton = document.getElementById('importButton');
const importFile = document.getElementById('importFile');
const exportDialog = document.getElementById('exportDialog');
const exportForm = document.getElementById('exportForm');
const exportList = document.getElementById('exportList');
const exportSelectAll = document.getElementById('exportSelectAll');
const exportSelectNone = document.getElementById('exportSelectNone');
const exportConfirm = document.getElementById('exportConfirm');
const exportCancel = document.getElementById('exportCancel');
const toastEl = document.getElementById('toast');
const toastMessageEl = document.getElementById('toastMessage');
const toastUndoEl = document.getElementById('toastUndo');

// Service worker registration
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const swUrl = new URL('sw.js', location.href).toString();
    const r = await navigator.serviceWorker.register(swUrl);
    if (r.active) {
      r.active.postMessage({ type: 'PING' });
    }
    // Try to enable periodic background sync for reminders
    if ('periodicSync' in r) {
      try {
        const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
        if (status.state === 'granted') {
          await r.periodicSync.register('focus-tasks-reminders', { minInterval: 6 * 60 * 60 * 1000 });
        }
      } catch {}
    }
  } catch (e) {
    console.error('SW register failed', e);
  }
}

// Notifications permission prompt
async function ensureNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const res = await Notification.requestPermission();
  return res === 'granted';
}

// Schedule reminders at T-3 days via service worker Alarms (emulated in SW with setTimeout when active, and periodic sync fallback)
async function refreshReminders() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    const upcoming = tasks.filter(t => !t.completed && t.due - nowMs() <= THREE_DAYS_MS && t.due > nowMs());
    reg.active?.postMessage({ type: 'SET_REMINDERS', tasks: upcoming.map(t => ({ id: t.id, title: t.title, due: t.due })) });
  } catch (e) {
    console.warn('refreshReminders error', e);
  }
}

function render() {
  // Sort by due asc then importance desc
  let filtered = tasks.filter(t => {
    if (searchQuery && !(t.title.toLowerCase().includes(searchQuery) || (t.notes||'').toLowerCase().includes(searchQuery))) return false;
    if (filterMode === 'active' && t.completed) return false;
    if (filterMode === 'completed' && !t.completed) return false;
    if (filterMode === 'dueSoon' && (t.completed || (t.due - nowMs() > THREE_DAYS_MS))) return false;
    return true;
  });
  const sorted = [...filtered].sort((a, b) => a.completed - b.completed || a.due - b.due || b.importance - a.importance);
  taskListEl.innerHTML = '';
  let completedCount = 0;
  const dueSoon = [];

  for (const t of sorted) {
    if (t.completed) completedCount++;
    if (!t.completed && t.due - nowMs() <= THREE_DAYS_MS) dueSoon.push(t);

    const li = document.createElement('li');
    li.className = 'task-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!t.completed;
    checkbox.addEventListener('change', async () => {
      t.completed = checkbox.checked;
      await saveTask(t);
      render();
    });

    const content = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = t.title;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const due = new Date(t.due);
    meta.textContent = `Due ${due.toLocaleString()} • Importance ${t.importance}`;
    content.appendChild(title);
    content.appendChild(meta);
    if (t.notes) {
      const notes = document.createElement('div');
      notes.className = 'hint';
      notes.textContent = t.notes;
      content.appendChild(notes);
    }

    const right = document.createElement('div');
    right.className = 'badges';
    const soon = t.due - nowMs() <= THREE_DAYS_MS && !t.completed;
    const badge = document.createElement('span');
    badge.className = 'badge ' + (soon ? 'alert' : 'ok');
    badge.textContent = soon ? 'Due ≤ 3 days' : 'Scheduled';
    right.appendChild(badge);

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn icon-danger';
    delBtn.title = 'Delete task';
    delBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';
    delBtn.addEventListener('click', () => softDeleteTask(t));
    right.appendChild(delBtn);

    li.appendChild(checkbox);
    li.appendChild(content);
    li.appendChild(right);
    taskListEl.appendChild(li);
  }

  // Progress
  const pct = tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100);
  progressFillEl.style.transform = `scaleX(${pct/100})`;
  progressPctEl.textContent = pct + '%';

  // Due soon section
  upcomingListEl.innerHTML = '';
  if (dueSoon.length > 0) {
    upcomingSectionEl.hidden = false;
    for (const t of dueSoon.slice(0, 10)) {
      const li = document.createElement('li');
      li.className = 'task-item';
      const label = document.createElement('div');
      label.className = 'title';
      label.textContent = `${t.title} — ${new Date(t.due).toLocaleString()}`;
      li.appendChild(document.createElement('span'));
      li.appendChild(label);
      li.appendChild(document.createElement('div'));
      upcomingListEl.appendChild(li);
    }
  } else {
    upcomingSectionEl.hidden = true;
  }
  updateAppBadge();
}

async function loadTasks() {
  tasks = await dbTxn(['tasks'], 'readonly', (store) => {
    return new Promise((resolve, reject) => {
      const result = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) { result.push(cur.value); cur.continue(); } else { resolve(result); }
      };
      req.onerror = () => reject(req.error);
    });
  });
}

async function saveTask(task) {
  await dbTxn(['tasks'], 'readwrite', (store) => { store.put(task); });
  await refreshReminders();
}

async function deleteTasks(ids) {
  await dbTxn(['tasks'], 'readwrite', (store) => { ids.forEach((id) => store.delete(id)); });
  await loadTasks();
  await refreshReminders();
  render();
}

function openDialog(defaults = null) {
  form.reset();
  document.getElementById('dialogTitle').textContent = defaults ? 'Edit Task' : 'New Task';
  const d = defaults ?? { title: '', due: nowMs() + ONE_DAY_MS, importance: 5, notes: '', recurrence: 'none' };
  titleInput.value = d.title;
  dueInput.value = toInputDateTime(d.due);
  importanceInput.value = d.importance;
  if (importanceValueEl) importanceValueEl.textContent = String(d.importance);
  if (recurrenceInput) recurrenceInput.value = d.recurrence || 'none';
  notesInput.value = d.notes ?? '';
  dialog.showModal();
}

addTaskButton.addEventListener('click', () => openDialog());


form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = titleInput.value.trim();
  const due = new Date(dueInput.value).getTime();
  const importance = Number(importanceInput.value);
  const recurrence = recurrenceInput?.value || 'none';
  const notes = notesInput.value.trim();
  if (!title || !Number.isFinite(due)) return;
  const task = { id: uid(), title, due, importance, notes, recurrence, completed: false, createdAt: nowMs() };
  await saveTask(task);
  tasks.push(task);
  tasks.sort((a,b)=>a.due-b.due);
  render();
  dialog.close();
});

// Live update importance display
importanceInput.addEventListener('input', () => {
  if (importanceValueEl) importanceValueEl.textContent = importanceInput.value;
});

// Filters & search
filterSelect?.addEventListener('change', () => { filterMode = filterSelect.value; render(); });
searchInput?.addEventListener('input', () => { searchQuery = searchInput.value.trim().toLowerCase(); render(); });

// Export / Import
exportButton?.addEventListener('click', async () => {
  // Populate export dialog list
  exportList.innerHTML = '';
  const sorted = [...tasks].sort((a,b)=> a.completed - b.completed || a.due - b.due || b.importance - a.importance);
  for (const t of sorted) {
    const li = document.createElement('li');
    li.className = 'task-item';
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = true; check.dataset.taskId = t.id;
    const text = document.createElement('div');
    text.className = 'title';
    text.textContent = `${t.title} — ${new Date(t.due).toLocaleString()} (imp ${t.importance})`;
    li.appendChild(check);
    li.appendChild(text);
    li.appendChild(document.createElement('div'));
    exportList.appendChild(li);
  }
  exportDialog.showModal();
});
exportCancel?.addEventListener('click', () => exportDialog.close());

exportSelectAll?.addEventListener('click', (e) => {
  e.preventDefault();
  exportList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
});
exportSelectNone?.addEventListener('click', (e) => {
  e.preventDefault();
  exportList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
});

exportConfirm?.addEventListener('click', (e) => {
  e.preventDefault();
  const selectedIds = Array.from(exportList.querySelectorAll('input[type="checkbox"]'))
    .filter(cb => cb.checked)
    .map(cb => cb.dataset.taskId);
  const selectedTasks = tasks.filter(t => selectedIds.includes(t.id));
  const payload = { type: 'focus-tasks-backup', version: 1, exportedAt: Date.now(), tasks: selectedTasks };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `focus-tasks-${new Date().toISOString().slice(0,10)}.task`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  exportDialog.close();
});
importButton?.addEventListener('click', () => importFile?.click());
importFile?.addEventListener('change', async () => {
  const file = importFile.files?.[0]; if (!file) return;
  const text = await file.text();
  try {
    const imported = JSON.parse(text);
    let list = Array.isArray(imported) ? imported : imported?.tasks;
    if (!list && imported?.type === 'focus-tasks-backup' && Array.isArray(imported?.tasks)) {
      list = imported.tasks;
    }
    if (!Array.isArray(list)) throw new Error('Invalid file');
    const normalized = list.map((t) => {
      const id = typeof t.id === 'string' && t.id ? t.id : (Math.random().toString(36).slice(2) + Date.now().toString(36));
      const dueNum = typeof t.due === 'number' ? t.due : new Date(t.due).getTime();
      const importanceNum = Math.min(10, Math.max(1, Number(t.importance ?? 5)));
      return {
        id,
        title: String(t.title || 'Untitled task'),
        due: Number.isFinite(dueNum) ? dueNum : Date.now() + 24*60*60*1000,
        importance: Number.isFinite(importanceNum) ? importanceNum : 5,
        notes: String(t.notes || ''),
        completed: Boolean(t.completed),
        createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now()
      };
    });
    await dbTxn(['tasks'], 'readwrite', (store) => { normalized.forEach(t => store.put(t)); });
    await loadTasks(); render(); await refreshReminders();
  } catch (e) { alert('Import failed: ' + e.message); }
  finally {
    // Allow re-importing the same file name after completion
    importFile.value = '';
  }
});

// Soft delete with undo toast
function softDeleteTask(task) {
  // Remove from current view
  tasks = tasks.filter(x => x.id !== task.id);
  render();
  showToast(`Deleted "${task.title}"`, async () => {
    // Undo: restore
    tasks.push(task);
    await saveTask(task);
    render();
  });
  // After timeout, delete from DB unless undone
  const timeoutId = setTimeout(async () => {
    await deleteTasks([task.id]);
  }, 5000);
  pendingDeletions.set(task.id, timeoutId);
}

function showToast(message, onUndo) {
  if (!toastEl) return;
  toastMessageEl.textContent = message;
  toastEl.hidden = false;
  let undone = false;
  const timerId = setTimeout(() => {
    if (!undone) hideToast();
  }, 5200);
  const onClickUndo = () => {
    undone = true;
    // Cancel only the most recent pending delete (best-effort)
    // If multiple deletes happen, we try to cancel the last added one
    const entries = Array.from(pendingDeletions.entries());
    const last = entries[entries.length - 1];
    if (last) { clearTimeout(last[1]); pendingDeletions.delete(last[0]); }
    hideToast();
    onUndo?.();
  };
  toastUndoEl.onclick = onClickUndo;
  function hideToast(){ toastEl.hidden = true; clearTimeout(timerId); toastUndoEl.onclick = null; }
}

// App badge count
async function updateAppBadge() {
  try {
    const pending = tasks.filter(t => !t.completed).length;
    if ('setAppBadge' in navigator) {
      await navigator.setAppBadge(pending);
    }
  } catch {}
}

// Boot
(async function init(){
  // Default due input min
  const min = new Date(nowMs() + 30 * 60 * 1000);
  dueInput.min = toInputDateTime(min.getTime());
  await registerSW();
  await ensureNotificationPermission();
  await loadTasks();
  render();
  await refreshReminders();
})();

// Listen to SW messages (e.g., when notifications fired or periodic sync tick)
navigator.serviceWorker?.addEventListener('message', async (e) => {
  const data = e.data || {};
  if (data.type === 'REQUEST_TASKS_SNAPSHOT') {
    e.source?.postMessage({ type: 'TASKS_SNAPSHOT', tasks });
  }
});

// Install prompt helper
window.addEventListener('beforeinstallprompt', (e) => {
  // Store or auto-prompt; for simplicity, just prompt immediately
  e.prompt?.();
});

// Open add dialog if launched via shortcut
if (location.hash === '#add') {
  window.addEventListener('load', () => openDialog());
}

