/* Focus Tasks Service Worker
 - Offline caching
 - Notification scheduling for tasks due within 3 days
 - Periodic background sync fallback
*/

const CACHE_NAME = 'focus-tasks-cache-v6';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js?v=4',
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

let pendingReminders = new Map(); // key -> timeoutId, key can include task id and timestamp

function clearAllReminders() {
  for (const timeoutId of pendingReminders.values()) {
    clearTimeout(timeoutId);
  }
  pendingReminders.clear();
}

function scheduleAt(timeMs, key, callback) {
  const delay = timeMs - Date.now();
  if (delay <= 0) return;
  if (pendingReminders.has(key)) return; // already scheduled this exact time
  const timeoutId = setTimeout(() => {
    try { callback(); } finally { pendingReminders.delete(key); }
  }, delay);
  pendingReminders.set(key, timeoutId);
}

function scheduleTMinus3Days(task) {
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  const t = task.due - threeDays;
  if (t > Date.now()) {
    scheduleAt(t, `t3-${task.id}-${t}`, () => showReminder(task));
  }
}

function nextNoonOrMidnightAfter(ms) {
  const d = new Date(ms);
  d.setSeconds(0, 0);
  const h = d.getHours();
  if (h < 12) {
    d.setHours(12, 0, 0, 0);
  } else {
    d.setHours(24, 0, 0, 0); // midnight of next day
  }
  return d.getTime();
}

function scheduleNoonMidnightReminders(task) {
  const threeDaysFromNow = Date.now() + 3 * 24 * 60 * 60 * 1000;
  const windowEnd = Math.min(task.due, threeDaysFromNow);
  let t = nextNoonOrMidnightAfter(Date.now());
  while (t <= windowEnd) {
    const key = `nm-${task.id}-${t}`;
    scheduleAt(t, key, () => showReminder(task));
    t += 12 * 60 * 60 * 1000; // step 12 hours
  }
}

function scheduleTaskNotifications(task) {
  scheduleTMinus3Days(task);
  scheduleNoonMidnightReminders(task);
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'PING') return;
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'SET_REMINDERS') {
    clearAllReminders();
    for (const t of data.tasks || []) scheduleTaskNotifications(t);
  }
  if (data.type === 'TASKS_SNAPSHOT') {
    // Re-schedule based on latest tasks snapshot
    clearAllReminders();
    const now = Date.now();
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    const tasks = (data.tasks || []).filter(t => !t.completed && t.due - now <= threeDays && t.due > now);
    for (const t of tasks) scheduleTaskNotifications(t);
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

