/* Focus Tasks Service Worker
 - Offline caching
 - Notification scheduling for tasks due within 3 days
 - Periodic background sync fallback
*/

const CACHE_NAME = 'focus-tasks-cache-v1';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

// Cache-first for app shell; network falling back
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Serve tiny placeholder PNGs for icons if not present on disk
  if (url.pathname.endsWith('/icons/icon-192.png') || url.pathname.endsWith('/icons/icon-512.png') || url.pathname.endsWith('/icons/icon-512-maskable.png')) {
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='; // 1x1 transparent PNG
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    event.respondWith(new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' } }));
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const resp = await fetch(request);
      if (resp && resp.status === 200 && resp.type === 'basic') {
        cache.put(request, resp.clone());
      }
      return resp;
    } catch (e) {
      if (request.mode === 'navigate') {
        return cache.match('./index.html');
      }
      throw e;
    }
  })());
});

// Notification helpers
async function showReminder(task) {
  const title = 'Task due soon';
  const body = `${task.title} is due on ${new Date(task.due).toLocaleString()}`;
  const reg = await self.registration.showNotification(title, {
    body,
    tag: `due-${task.id}`,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: '/', id: task.id, due: task.due },
    actions: [
      { action: 'open', title: 'Open app' },
      { action: 'snooze', title: 'Snooze 1 hour' }
    ]
  });
  return reg;
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'snooze') {
    const data = event.notification.data;
    const task = { id: data.id, title: 'Task', due: Date.now() + 60 * 60 * 1000 };
    event.waitUntil(showReminder(task));
    return;
  }
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const url = new URL('/', self.location.origin).href;
    for (const client of allClients) {
      if (client.url === url && 'focus' in client) return client.focus();
    }
    return clients.openWindow('/');
  })());
});

let pendingReminders = new Map(); // id -> timeoutId

function clearAllReminders() {
  for (const timeoutId of pendingReminders.values()) {
    clearTimeout(timeoutId);
  }
  pendingReminders.clear();
}

function scheduleReminder(task) {
  // T-3 days means notify immediately if due within 3 days and in future.
  const delay = Math.max(0, task.due - 3 * 24 * 60 * 60 * 1000 - Date.now());
  const timeoutId = setTimeout(() => {
    showReminder(task);
    pendingReminders.delete(task.id);
  }, delay);
  pendingReminders.set(task.id, timeoutId);
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'PING') return;
  if (data.type === 'SET_REMINDERS') {
    clearAllReminders();
    for (const t of data.tasks || []) scheduleReminder(t);
  }
});

// Periodic sync fallback: every 6 hours ask client for tasks to reschedule
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'focus-tasks-reminders') {
    event.waitUntil((async () => {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of allClients) c.postMessage({ type: 'REQUEST_TASKS_SNAPSHOT' });
    })());
  }
});

// If periodic sync not supported, emulate with setInterval while SW is alive
setInterval(async () => {
  const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of allClients) c.postMessage({ type: 'REQUEST_TASKS_SNAPSHOT' });
}, 6 * 60 * 60 * 1000);

