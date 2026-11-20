const cacheName = 'lumbre-shell-v2'
const shell = ['./', './index.html', './style.css', './app.js', './neural-voice.js', './catalog.json', './manifest.webmanifest', './assets/app-192.png', './assets/hero.webp', './assets/quijote.webp', './assets/lazarillo.webp', './assets/leyendas.webp']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(shell)))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('lumbre-shell-') && key !== cacheName).map(key => caches.delete(key))
  )).then(() => self.clients.claim()))
})

const shellUrls = new Set(shell.map(path => new URL(path, self.location).href))
self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET' || (!shellUrls.has(request.url) &&
    !(request.mode === 'navigate' && new URL(request.url).pathname === new URL('./', self.location).pathname &&
      new URL(request.url).origin === self.location.origin))) return
  event.respondWith(fetch(request).catch(async () => {
    const cache = await caches.open(cacheName)
    return (await cache.match(request, { ignoreSearch: request.mode === 'navigate' })) ??
      (request.mode === 'navigate' ? await cache.match('./') : undefined) ?? Response.error()
  }))
})
