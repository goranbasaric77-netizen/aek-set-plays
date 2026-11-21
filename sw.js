// AEK Set - Plays service worker. Bump CACHE on every release.
// Does not touch localStorage, so coaches' data survives updates.
const CACHE = "aek-setplays-2026-11-21b";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./logo.png", "./board.js", "./poses/p00.webp", "./poses/p01.webp", "./poses/p02.webp", "./poses/p03.webp", "./poses/p04.webp", "./poses/p05.webp", "./poses/p06.webp", "./poses/p07.webp", "./poses/p08.webp", "./poses/p09.webp", "./poses/p10.webp", "./poses/p11.webp", "./poses/p12.webp", "./poses/p13.webp", "./poses/p14.webp", "./poses/p15.webp", "./poses/p16.webp", "./poses/p17.webp", "./poses/p18.webp", "./poses/p19.webp", "./poses/p20.webp", "./poses/p21.webp", "./poses/p22.webp", "./poses/p23.webp", "./poses/p24.webp", "./poses/p25.webp", "./poses/p26.webp", "./poses/p27.webp", "./poses/p28.webp", "./poses/p29.webp", "./poses/p30.webp", "./poses/p31.webp", "./poses/p32.webp", "./poses/p33.webp", "./poses/p34.webp", "./poses/p35.webp", "./poses/p36.webp", "./poses/p37.webp", "./poses/p38.webp", "./poses/p39.webp", "./poses/p40.webp", "./poses/p41.webp", "./poses/p42.webp", "./poses/p43.webp", "./poses/p44.webp", "./poses/p45.webp", "./poses/p46.webp", "./poses/p47.webp", "./poses/p48.webp", "./poses/p49.webp", "./poses/p50.webp", "./poses/p51.webp", "./poses/p52.webp", "./poses/p53.webp", "./poses/p54.webp", "./poses/p55.webp", "./poses/p56.webp", "./poses/p57.webp", "./poses/p58.webp", "./poses/p59.webp", "./poses/p60.webp", "./poses/p61.webp", "./poses/p62.webp", "./poses/p63.webp", "./poses/p64.webp", "./poses/p65.webp", "./poses/p66.webp", "./poses/p67.webp", "./poses/p68.webp"];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" })))));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;

  // The app page: network first (newest build when online), cache when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req, { cache: "no-store" })
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put("./index.html", copy)); }
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // The app's code (board.js): network first as well, so a new release is used on the first reload, not the second.
  if (sameOrigin && /\.js$/.test(new URL(req.url).pathname)) {
    e.respondWith(
      fetch(req, { cache: "no-store" })
        .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  // Icons, manifest and other files: cache first, refresh in background.
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
      const fresh = fetch(req).then(res => {
        if (res && res.ok && sameOrigin) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
