// Mode hors ligne : l'application elle-même est gardée dans le cache du téléphone.
// Les leçons et la progression sont gardées par l'application (IndexedDB), pas ici.
// Pour publier une nouvelle version de l'application, change VERSION.
const VERSION = 'tv-1.0.1';
const FICHIERS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/stockage.js',
  './js/sync.js',
  './js/etat.js',
  './js/revision.js',
  './icones/icone.svg',
  './icones/icone-192.png',
  './icones/icone-512.png',
  './icones/icone-maskable-512.png',
];
// Sur le PC de développement, on prend toujours la version la plus récente.
const DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FICHIERS)));
  if (DEV) self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const cle of await caches.keys()) if (cle !== VERSION) await caches.delete(cle);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'maj') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // GitHub : toujours par le réseau

  if (DEV) {
    e.respondWith(
      fetch(req)
        .then((rep) => {
          if (rep.ok) {
            const copie = rep.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copie));
          }
          return rep;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || secours(req))),
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (enCache) =>
        enCache ||
        fetch(req)
          .then((rep) => {
            if (rep.ok && url.pathname.startsWith(new URL(self.registration.scope).pathname)) {
              const copie = rep.clone();
              caches.open(VERSION).then((cache) => cache.put(req, copie));
            }
            return rep;
          })
          .catch(() => secours(req)),
    ),
  );
});

function secours(req) {
  if (req.mode === 'navigate') return caches.match('./index.html');
  return Response.error();
}
