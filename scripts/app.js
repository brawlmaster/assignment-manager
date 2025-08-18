// App entry for the offline PWA To-Do
// High-level: IndexedDB persistence, foreground scheduling, SW registration, notification permission flow,
// progressive features (Periodic Sync, Notification Triggers when available), and UI state management.

/* ===================== Utilities ===================== */
const isSupported = {
    serviceWorker: 'serviceWorker' in navigator,
    notifications: 'Notification' in window,
    showNotification: 'showNotification' in ServiceWorkerRegistration.prototype,
    notificationTriggers: 'showTrigger' in Notification.prototype,
    periodicBackgroundSync: 'periodicSync' in (navigator.serviceWorker || {}),
    backgroundSync: 'SyncManager' in window,
};

function formatDateTime(isoOrMs) {
    if (!isoOrMs) return '';
    const date = typeof isoOrMs === 'number' ? new Date(isoOrMs) : new Date(isoOrMs);
    return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function secondsUntil(dateMs) {
    return Math.floor((dateMs - Date.now()) / 1000);
}

function clamp(num, min, max) { return Math.max(min, Math.min(max, num)); }

/* ===================== IndexedDB ===================== */
const DB_NAME = 'tasks-db-v1';
const DB_STORE = 'tasks';

function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (event) => {
            const db = request.result;
            if (!db.objectStoreNames.contains(DB_STORE)) {
                const store = db.createObjectStore(DB_STORE, { keyPath: 'id' });
                store.createIndex('by_due', 'dueMs');
                store.createIndex('by_completed', 'completed');
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function dbGetAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const store = tx.objectStore(DB_STORE);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

async function dbPut(task) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        const store = tx.objectStore(DB_STORE);
        store.put(task);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function dbBulkDelete(ids) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        const store = tx.objectStore(DB_STORE);
        ids.forEach(id => store.delete(id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/* ===================== Notifications & SW ===================== */
async function registerServiceWorker() {
    if (!isSupported.serviceWorker) return null;
    try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        return reg;
    } catch (e) {
        console.error('SW register failed', e);
        return null;
    }
}

async function ensureNotificationPermission() {
    if (!isSupported.notifications) return 'denied';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    const result = await Notification.requestPermission();
    return result;
}

function scheduleForegroundTimeoutNotification(task) {
    // Fallback: schedule a setTimeout up to 24h ahead, for due minus 3 days.
    // If further out, we keep a periodic check when app opens.
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const triggerMs = task.dueMs - threeDaysMs;
    const delay = triggerMs - Date.now();
    if (delay <= 0 || delay > 24 * 60 * 60 * 1000) return; // too late or too far; handled by periodic check/sw
    setTimeout(() => {
        navigator.serviceWorker.getRegistration().then(reg => {
            if (reg && isSupported.showNotification && Notification.permission === 'granted') {
                const body = `${task.title} in 3 days — ${formatDateTime(task.dueMs)}`;
                reg.showNotification('Upcoming task', {
                    body,
                    tag: `task-${task.id}`,
                    data: { id: task.id, kind: 'due-soon' },
                    icon: '/icons/icon-192-maskable.png',
                    badge: '/icons/badge-72.png',
                });
            }
        });
    }, delay);
}

async function tryScheduleNotificationTrigger(task) {
    // Experimental Notification Triggers API (Chrome on Android behind flags, some builds). Guarded usage.
    try {
        if (!('showTrigger' in Notification.prototype)) return false;
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg || Notification.permission !== 'granted') return false;
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
        const triggerTime = task.dueMs - threeDaysMs;
        if (triggerTime <= Date.now()) return false;
        const timestampTrigger = new TimestampTrigger(triggerTime);
        await reg.showNotification('Upcoming task', {
            body: `${task.title} in 3 days — ${formatDateTime(task.dueMs)}`,
            tag: `task-${task.id}`,
            data: { id: task.id, kind: 'due-soon' },
            showTrigger: timestampTrigger,
            icon: '/icons/icon-192-maskable.png',
            badge: '/icons/badge-72.png',
        });
        return true;
    } catch (e) {
        console.warn('Trigger schedule failed', e);
        return false;
    }
}

async function scheduleTaskNotification(task) {
    // Try trigger; fallback to foreground timeout; SW periodic check will also catch if needed.
    const ok = await tryScheduleNotificationTrigger(task);
    if (!ok) scheduleForegroundTimeoutNotification(task);
}

/* ===================== State ===================== */
let appState = {
    tasks: [],
    deleteMode: false,
    selectedToDelete: new Set(),
};

function createEmptyTask() {
    return {
        id: crypto.randomUUID(),
        title: '',
        details: '',
        dueMs: Date.now() + 60 * 60 * 1000,
        importance: 5,
        tags: [],
        completed: false,
        createdMs: Date.now(),
        updatedMs: Date.now(),
    };
}

/* ===================== DOM Refs ===================== */
const els = {
    taskList: document.getElementById('taskList'),
    addTaskBtn: document.getElementById('addTaskBtn'),
    deleteModeBtn: document.getElementById('deleteModeBtn'),
    bulkDeleteBar: document.getElementById('bulkDeleteBar'),
    confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),
    cancelDeleteBtn: document.getElementById('cancelDeleteBtn'),
    enableNotificationsBtn: document.getElementById('enableNotificationsBtn'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    dueSoonText: document.getElementById('dueSoonText'),
    dialog: document.getElementById('taskDialog'),
    form: document.getElementById('taskForm'),
    dialogTitle: document.getElementById('dialogTitle'),
    fieldId: document.getElementById('taskId'),
    fieldTitle: document.getElementById('taskTitle'),
    fieldDetails: document.getElementById('taskDetails'),
    fieldDue: document.getElementById('taskDue'),
    fieldImportance: document.getElementById('taskImportance'),
    fieldTags: document.getElementById('taskTags'),
};

/* ===================== Render ===================== */
function render() {
    els.taskList.innerHTML = '';
    const now = Date.now();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    let completedCount = 0;
    let dueSoonCount = 0;

    const template = document.getElementById('taskItemTemplate');
    const frag = document.createDocumentFragment();

    const sorted = [...appState.tasks].sort((a, b) => a.completed - b.completed || a.dueMs - b.dueMs || b.importance - a.importance);
    for (const task of sorted) {
        const clone = template.content.cloneNode(true);
        const li = clone.querySelector('li');
        const selectBox = clone.querySelector('.select-box');
        const selectCheckbox = clone.querySelector('.select-checkbox');
        const completeCheckbox = clone.querySelector('.complete-checkbox');
        const titleEl = clone.querySelector('.title');
        const importanceEl = clone.querySelector('.importance');
        const dueEl = clone.querySelector('.due');
        const tagsEl = clone.querySelector('.tags');
        const detailsEl = clone.querySelector('.details');
        const editBtn = clone.querySelector('.edit-btn');
        const dueSoonBadge = clone.querySelector('.due-soon-badge');

        titleEl.textContent = task.title || 'Untitled task';
        importanceEl.textContent = `Imp ${task.importance}`;
        importanceEl.style.background = `linear-gradient(90deg, #1b2c55, #1a2450 ${clamp(task.importance*10, 5, 95)}%)`;
        dueEl.textContent = `Due: ${formatDateTime(task.dueMs)}`;
        tagsEl.textContent = task.tags && task.tags.length ? `#${task.tags.join(' #')}` : '';
        detailsEl.textContent = task.details || '';
        completeCheckbox.checked = !!task.completed;

        const isDueSoon = task.dueMs - now <= threeDaysMs && task.dueMs >= now && !task.completed;
        if (isDueSoon) {
            dueSoonCount += 1;
            dueSoonBadge.hidden = false;
            li.classList.add('due-soon-item');
        }
        if (task.completed) {
            completedCount += 1;
            li.classList.add('completed');
        }

        if (appState.deleteMode) {
            selectBox.hidden = false;
            selectCheckbox.checked = appState.selectedToDelete.has(task.id);
        }

        completeCheckbox.addEventListener('change', async () => {
            task.completed = completeCheckbox.checked;
            task.updatedMs = Date.now();
            await dbPut(task);
            await refreshTasks();
        });
        editBtn.addEventListener('click', () => openEditDialog(task));
        selectCheckbox.addEventListener('change', () => {
            if (selectCheckbox.checked) appState.selectedToDelete.add(task.id);
            else appState.selectedToDelete.delete(task.id);
        });
        frag.appendChild(clone);
    }

    els.taskList.appendChild(frag);

    // Progress
    const total = appState.tasks.length;
    const pct = total === 0 ? 0 : Math.round((completedCount / total) * 100);
    els.progressBar.style.width = `${pct}%`;
    els.progressText.textContent = `${completedCount} of ${total} done`;
    els.dueSoonText.textContent = `${dueSoonCount} due soon`;
}

/* ===================== Dialog ===================== */
function openAddDialog() {
    els.dialogTitle.textContent = 'Add task';
    const t = createEmptyTask();
    els.fieldId.value = t.id;
    els.fieldTitle.value = '';
    els.fieldDetails.value = '';
    els.fieldDue.value = new Date(t.dueMs).toISOString().slice(0,16);
    els.fieldImportance.value = String(t.importance);
    els.fieldTags.value = '';
    if (!els.dialog.open) els.dialog.showModal();
}

function openEditDialog(task) {
    els.dialogTitle.textContent = 'Edit task';
    els.fieldId.value = task.id;
    els.fieldTitle.value = task.title;
    els.fieldDetails.value = task.details || '';
    els.fieldDue.value = new Date(task.dueMs).toISOString().slice(0,16);
    els.fieldImportance.value = String(task.importance);
    els.fieldTags.value = (task.tags || []).join(', ');
    if (!els.dialog.open) els.dialog.showModal();
}

els.cancelDialogBtn.addEventListener('click', () => {
    els.dialog.close();
});

els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = els.fieldId.value || crypto.randomUUID();
    const existing = appState.tasks.find(t => t.id === id);
    const dueMs = new Date(els.fieldDue.value).getTime();
    const task = existing || createEmptyTask();
    task.id = id;
    task.title = els.fieldTitle.value.trim();
    task.details = els.fieldDetails.value.trim();
    task.dueMs = isNaN(dueMs) ? Date.now() : dueMs;
    task.importance = clamp(parseInt(els.fieldImportance.value, 10) || 5, 1, 10);
    task.tags = els.fieldTags.value.trim() ? els.fieldTags.value.split(',').map(s => s.trim()).filter(Boolean) : [];
    task.updatedMs = Date.now();
    await dbPut(task);
    els.dialog.close();
    await refreshTasks();
    if (Notification.permission === 'granted') {
        scheduleTaskNotification(task);
    }
});

/* ===================== Delete Mode ===================== */
function setDeleteMode(enabled) {
    appState.deleteMode = enabled;
    appState.selectedToDelete.clear();
    els.bulkDeleteBar.hidden = !enabled;
    render();
}

els.deleteModeBtn.addEventListener('click', () => setDeleteMode(!appState.deleteMode));
els.cancelDeleteBtn.addEventListener('click', () => setDeleteMode(false));
els.confirmDeleteBtn.addEventListener('click', async () => {
    const ids = Array.from(appState.selectedToDelete);
    if (ids.length > 0) {
        await dbBulkDelete(ids);
        setDeleteMode(false);
        await refreshTasks();
    } else {
        setDeleteMode(false);
    }
});

/* ===================== Task refresh ===================== */
async function refreshTasks() {
    appState.tasks = await dbGetAll();
    render();
}

/* ===================== Initialization ===================== */
function configureNotificationButton() {
    if (!isSupported.notifications || Notification.permission === 'granted') {
        els.enableNotificationsBtn.hidden = true;
        return;
    }
    if (Notification.permission === 'default') {
        els.enableNotificationsBtn.hidden = false;
        els.enableNotificationsBtn.addEventListener('click', async () => {
            const perm = await ensureNotificationPermission();
            if (perm === 'granted') {
                els.enableNotificationsBtn.hidden = true;
                // Schedule all tasks' due-soon notifications
                const tasks = await dbGetAll();
                tasks.forEach(scheduleTaskNotification);
            }
        }, { once: true });
    }
}

async function main() {
    // Register SW to enable offline, caching, and background checks.
    const reg = await registerServiceWorker();
    if (reg) {
        navigator.serviceWorker.addEventListener('message', async (event) => {
            if (event.data && event.data.type === 'request-tasks') {
                const tasks = await dbGetAll();
                reg.active?.postMessage({ type: 'tasks', tasks });
            }
        });
    }

    // UI
    await refreshTasks();
    configureNotificationButton();

    // Events
    els.addTaskBtn.addEventListener('click', openAddDialog);

    // Attempt to schedule for all existing tasks if permission is granted
    if (Notification.permission === 'granted') {
        const tasks = await dbGetAll();
        tasks.forEach(scheduleTaskNotification);
    }
}

main();

