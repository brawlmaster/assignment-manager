/* Service Worker for offline caching and reminder checks */

const CACHE_NAME = 'tasks-pwa-cache-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/scripts/app.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
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

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const resp = await fetch(request);
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, resp.clone());
      return resp;
    } catch (e) {
      return cached || Response.error();
    }
  })());
});

// Lightweight background check to fire reminders ~ due in 3 days for users who reopen app
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'due-soon-check') {
    event.waitUntil(checkDueSoon());
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'due-soon-check') {
    event.waitUntil(checkDueSoon());
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'tasks') {
    // Received tasks payload; check if any are due soon without scheduled triggers
    checkDueSoon(event.data.tasks);
  }
  if (event.data && event.data.type === 'request-tasks') {
    // No-op here; page will send tasks in response to our earlier request
  }
});

async function requestTasksFromClients() {
  const allClients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of allClients) {
    client.postMessage({ type: 'request-tasks' });
  }
}

async function checkDueSoon(optionalTasks) {
  // We cannot directly access IndexedDB of the page here without opening our own DB. Instead, ping clients to send tasks.
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const tasks = optionalTasks || [];

  if (!optionalTasks) {
    await requestTasksFromClients();
    // Give clients a short grace period to respond with tasks via message
    await new Promise(r => setTimeout(r, 800));
  }

  // If no tasks provided, nothing to do.
  if (!tasks || tasks.length === 0) return;

  const reg = await self.registration;

  for (const task of tasks) {
    if (task.completed) continue;
    if (task.dueMs >= now && (task.dueMs - now) <= threeDaysMs) {
      try {
        await reg.showNotification('Upcoming task', {
          body: `${task.title} in 3 days — ${new Date(task.dueMs).toLocaleString()}`,
          tag: `task-${task.id}`,
          data: { id: task.id, kind: 'due-soon' }
        });
      } catch (e) {
        // Ignore if permissions missing
      }
    }
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window' });
    if (allClients.length > 0) {
      allClients[0].focus();
    } else {
      self.clients.openWindow('/');
    }
  })());
});

