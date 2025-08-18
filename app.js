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
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    let result;
    try {
      result = op(...stores, tx);
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
let deleteMode = false;
let selectedForDeletion = new Set();
let filterMode = 'all';
let searchQuery = '';

// Elements
const taskListEl = document.getElementById('taskList');
const upcomingSectionEl = document.getElementById('upcomingSection');
const upcomingListEl = document.getElementById('upcomingList');
const progressFillEl = document.getElementById('progressFill');
const importanceValueEl = document.getElementById('importanceValue');
const progressPctEl = document.getElementById('progressPct');
const addTaskButton = document.getElementById('addTaskButton');
const deleteModeButton = document.getElementById('deleteModeButton');
const deleteSelectedButton = document.getElementById('deleteSelectedButton');
const dialog = document.getElementById('taskDialog');
const form = document.getElementById('taskForm');
const titleInput = document.getElementById('taskTitle');
const dueInput = document.getElementById('taskDue');
const importanceInput = document.getElementById('taskImportance');
const notesInput = document.getElementById('taskNotes');
const filterSelect = document.getElementById('filterSelect');
const searchInput = document.getElementById('searchInput');
const exportButton = document.getElementById('exportButton');
const importButton = document.getElementById('importButton');
const importFile = document.getElementById('importFile');

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

    if (deleteMode) {
      const sel = document.createElement('input');
      sel.type = 'checkbox';
      sel.checked = selectedForDeletion.has(t.id);
      sel.addEventListener('change', () => {
        if (sel.checked) selectedForDeletion.add(t.id); else selectedForDeletion.delete(t.id);
      });
      right.appendChild(sel);
    }

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
  const d = defaults ?? { title: '', due: nowMs() + ONE_DAY_MS, importance: 5, notes: '' };
  titleInput.value = d.title;
  dueInput.value = toInputDateTime(d.due);
  importanceInput.value = d.importance;
  if (importanceValueEl) importanceValueEl.textContent = String(d.importance);
  notesInput.value = d.notes ?? '';
  dialog.showModal();
}

addTaskButton.addEventListener('click', () => openDialog());
deleteModeButton.addEventListener('click', () => {
  deleteMode = !deleteMode;
  deleteModeButton.setAttribute('aria-pressed', String(deleteMode));
  deleteSelectedButton.hidden = !deleteMode;
  if (!deleteMode) selectedForDeletion.clear();
  render();
});
deleteSelectedButton.addEventListener('click', async () => {
  if (selectedForDeletion.size === 0) return;
  await deleteTasks([...selectedForDeletion]);
  selectedForDeletion.clear();
  deleteMode = false;
  deleteSelectedButton.hidden = true;
  deleteModeButton.setAttribute('aria-pressed', 'false');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = titleInput.value.trim();
  const due = new Date(dueInput.value).getTime();
  const importance = Number(importanceInput.value);
  const notes = notesInput.value.trim();
  if (!title || !Number.isFinite(due)) return;
  const task = { id: uid(), title, due, importance, notes, completed: false, createdAt: nowMs() };
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
  const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `focus-tasks-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
});
importButton?.addEventListener('click', () => importFile?.click());
importFile?.addEventListener('change', async () => {
  const file = importFile.files?.[0]; if (!file) return;
  const text = await file.text();
  try {
    const imported = JSON.parse(text);
    if (!Array.isArray(imported)) throw new Error('Invalid file');
    await dbTxn(['tasks'], 'readwrite', (store) => { imported.forEach(t => store.put(t)); });
    await loadTasks(); render(); await refreshReminders();
  } catch (e) { alert('Import failed: ' + e.message); }
});

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

