// Offline: every app file is cached under one version name and served from the cache first.
// A new version waits until Off Script asks for it (Update now on Today), so nothing reloads in the
// middle of a sprint. Change VERSION with every release.
const VERSION = 'off-script-cast-1';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'src/app.js',
  'src/audiopack.js',
  'src/cast/client.js',
  'src/cast/config.js',
  'src/cast/pack.js',
  'src/cast/proof.js',
  'src/cast/reminders.js',
  'src/cast/science.js',
  'src/coach.js',
  'src/device.js',
  'src/backup.js',
  'src/dates.js',
  'src/grade.js',
  'src/items.js',
  'src/parse.js',
  'src/memory.js',
  'src/mp3.js',
  'src/plan.js',
  'src/practice.js',
  'src/player.js',
  'src/session.js',
  'src/settings.js',
  'src/state.js',
  'src/store.js',
  'src/tape.js',
  'src/tokens.js',
  'src/tts.js',
  'src/ui/again.js',
  'src/ui/checkin.js',
  'src/ui/choose.js',
  'src/ui/dom.js',
  'src/ui/install.js',
  'src/ui/keypad.js',
  'src/ui/scenes.js',
  'src/ui/settings.js',
  'src/ui/sprint.js',
  'src/ui/stage.js',
  'src/ui/unlock.js',
  'src/ui/walk.js',
  'vendor/fflate.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});

// A reminder is an empty push: the words were saved on the phone the last time the app was used, so
// they never leave it. A push must always show something.
const DEFAULT_NUDGE = { title: 'Off Script', body: 'Your lines are starting to fade. Two minutes now will bring them back.' };

function savedNudge() {
  return new Promise((resolve) => {
    const open = indexedDB.open('off-script-cast');
    open.onerror = () => resolve(DEFAULT_NUDGE);
    open.onsuccess = () => {
      try {
        const get = open.result.transaction('kv', 'readonly').objectStore('kv').get('reminder');
        get.onsuccess = () => resolve(get.result || DEFAULT_NUDGE);
        get.onerror = () => resolve(DEFAULT_NUDGE);
      } catch {
        resolve(DEFAULT_NUDGE);
      }
    };
  });
}

self.addEventListener('push', (event) => {
  event.waitUntil(savedNudge().then(({ title, body }) => self.registration.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'off-script-nudge' })));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => (list.length ? list[0].focus() : self.clients.openWindow('./'))),
  );
});
