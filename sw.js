// Offline: every app file is cached under one version name and served from the cache first.
// A new version waits until Off Script asks for it (Update now on Today), so nothing reloads in the
// middle of a sprint. A phone with no lines on it has nothing to interrupt, and no Update now to tap,
// so it takes a new version at once. Change VERSION with every release.
const VERSION = 'off-script-cast-15';
const FILES = [
  './',
  'styles.css',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'src/app.js',
  'src/audiopack.js',
  'src/boot.js',
  'src/cast/client.js',
  'src/cast/config.js',
  'src/cast/pack.js',
  'src/cast/progress.js',
  'src/cast/proof.js',
  'src/cast/reminders.js',
  'src/cast/science.js',
  'src/cast/streak.js',
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
  'src/ui/badges.js',
  'src/ui/checkin.js',
  'src/ui/choose.js',
  'src/ui/dom.js',
  'src/ui/hearcue.js',
  'src/ui/install.js',
  'src/ui/keypad.js',
  'src/ui/offer.js',
  'src/ui/scenes.js',
  'src/ui/settings.js',
  'src/ui/sprint.js',
  'src/ui/stage.js',
  'src/ui/unlock.js',
  'src/ui/walk.js',
  'vendor/fflate.js',
];

const NOT_CACHED = /\/staff(\.html)?$|\/dashboard\//;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await (await caches.open(VERSION)).addAll(FILES);
      if (!(await hasLines())) await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const old = (await caches.keys()).filter((key) => key !== VERSION);
      for (const key of old) await caches.delete(key);
      await self.clients.claim();
      // An open page is still the old version: an install screen would go on showing old steps.
      if (old.length && !(await hasLines())) {
        for (const client of await self.clients.matchAll({ type: 'window' })) if (!NOT_CACHED.test(new URL(client.url).pathname)) client.navigate(client.url).catch(() => {});
      }
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // The director's page has no Update now and has to match the worker, so it is never cached. Its
  // code has its own address: no copy of this app, however old, holds anything there to mix with it.
  if (NOT_CACHED.test(url.pathname)) return;
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});

// A reminder is an empty push: the words were saved on the phone the last time the app was used, so
// they never leave it. A push must always show something.
const DEFAULT_NUDGE = { title: 'Off Script', body: 'Your lines are ready when you are. Fancy a round?' };

// Whether nothing is saved, as after Remove everything. Safari keeps an empty database even from an
// aborted open, so look first where the phone can.
async function nothingSaved() {
  try {
    return !(await indexedDB.databases()).some((d) => d.name === 'off-script-cast');
  } catch {
    return false;
  }
}

// failed: the answer if the phone will not say.
async function saved(key, failed) {
  if (await nothingSaved()) return undefined;
  return new Promise((resolve) => {
    const open = indexedDB.open('off-script-cast');
    open.onupgradeneeded = () => open.transaction.abort(); // never make one
    open.onerror = () => resolve(failed);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const get = db.transaction('kv', 'readonly').objectStore('kv').get(key);
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => resolve(failed);
      } catch {
        resolve(failed);
      }
      db.close(); // goes once the read is done, so it never holds up Remove everything
    };
  });
}

const savedNudge = async () => (await saved('reminder')) || DEFAULT_NUDGE;
const hasLines = async () => !!(await saved('script', true)); // not sure: wait, as a phone with lines does

self.addEventListener('push', (event) => {
  event.waitUntil(savedNudge().then(({ title, body }) => self.registration.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'off-script-nudge' })));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => (list.length ? list[0].focus() : self.clients.openWindow('./'))),
  );
});
