/* Legendary One service worker: installable PWA + offline app shell + Firebase push notifications.
 * One worker owns scope "/", so push (FCM) and the PWA can't replace each other.
 * Registered from src/pwa.ts with the Firebase config in the query string. */

const VERSION = 'lo-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const SHELL_URLS = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
const IS_DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);

// ---------- Push notifications (Firebase Cloud Messaging) ----------
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');
  const params = new URL(self.location.href).searchParams;
  const config = {
    apiKey: params.get('apiKey') || '',
    authDomain: params.get('authDomain') || '',
    projectId: params.get('projectId') || '',
    storageBucket: params.get('storageBucket') || '',
    messagingSenderId: params.get('messagingSenderId') || '',
    appId: params.get('appId') || '',
  };
  if (config.projectId && config.messagingSenderId) {
    if (!firebase.apps.length) firebase.initializeApp(config);
    firebase.messaging().onBackgroundMessage((payload) => {
      const title = payload.notification?.title || payload.data?.title || 'Legendary One';
      return self.registration.showNotification(title, {
        body: payload.notification?.body || payload.data?.body || 'You have a new update.',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: payload.data || {},
      });
    });
  }
} catch (err) {
  // Offline on first install or messaging unsupported: the app still works without push
  console.warn('[sw] Push notifications unavailable:', err);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      return open ? open.focus() : self.clients.openWindow('/');
    })
  );
});

// ---------- Install / activate ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ---------- Fetch: network-first pages, cache-first hashed assets ----------
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || IS_DEV) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase, Google APIs, fonts: always live

  // App pages: try the network, fall back to the cached shell when offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error()))
    );
    return;
  }

  // Vite's hashed build files never change, so cache them forever
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(ASSET_CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  // Icons, manifest and other static files: serve cached, refresh in the background
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
