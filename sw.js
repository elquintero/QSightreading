/* ReadNotes Lectura – service worker (funciona sin conexión)
   Cambia VERSION en cada publicación: así el móvil detecta la nueva versión y muestra el aviso.
   IMPORTANTE: todas las cachés de esta app empiezan por "lectura-". Las de la app hermana empiezan por "readnotes-"
   y su service worker borra las que no conoce, así que no se deben mezclar los prefijos. */
const VERSION = "0.1.7";
const CACHE = "lectura-" + VERSION;
const CURSOS = "lectura-cursos";           // cursos (JSON): se conservan entre versiones
const SOUND = "readnotes-sound";           // muestras de piano de la app hermana: se comparten y aquí nunca se borran
const ASSETS = [
  "./", "index.html", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png",
  "cursos/index.json", "cursos/sr1-notas-cercanas.json", "cursos/sr2-saltos-moderados.json", "cursos/sr3-saltos-amplios.json",
  "cursos/d1-posicion-fija.json", "cursos/d2-mas-intervalos.json", "cursos/d3-cambios-de-posicion.json", "cursos/sr5-ritmo.json"
];
// Opcionales (viven en la app hermana): si faltan no deben romper la instalación
const OPTIONAL = ["fonts/Bravura.otf", "Fonts/Bravura.otf"];

// ¿Llegó la página completa? Código 200 y el cuerpo leído hasta el final, terminando en </html> (si se corta a medias, falla o no termina así).
async function pageOk(res) {
  if (!res || res.status !== 200) return false;
  try { return /<\/html>\s*$/i.test(await res.clone().text()); } catch (err) { return false; }
}

self.addEventListener("install", (e) => {
  // Sin skipWaiting automático: la app avisa y el usuario decide cuándo actualizar
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" })));
    await Promise.all(OPTIONAL.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {})));
  }));
});
self.addEventListener("message", (e) => { if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("lectura-") && k !== CACHE && k !== CURSOS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;

  // Páginas: red primero con límite de espera; si tarda, se abre la copia guardada y la red la actualiza en segundo plano
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      // La página de la red solo vale si llega ENTERA y con código 200 (con el móvil recién despierto puede llegar cortada o con error).
      // Si no, se abre la copia guardada, y la copia mala nunca se guarda.
      const net = fetch(req, { cache: "no-cache" }).then(async (res) => {
        if (!(await pageOk(res))) throw new Error("página incompleta");
        cache.put("index.html", res.clone());
        return res;
      });
      const cached = await cache.match("index.html");
      if (!cached) return net.catch(() => fetch(req));
      e.waitUntil(net.catch(() => {}));
      return Promise.race([net.catch(() => cached), new Promise((r) => setTimeout(() => r(cached), 1800))]);
    })());
    return;
  }

  // Muestras de piano (de la app hermana): caché primero y compartida
  if (url.pathname.toLowerCase().includes("/sound/")) {
    e.respondWith(
      caches.open(SOUND).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; })))
    );
    return;
  }

  // Cursos: red primero (un cambio subido a GitHub aparece enseguida); sin conexión, la última copia guardada
  if (url.pathname.toLowerCase().includes("/cursos/")) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CURSOS).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || new Response("", { status: 504 })))
    );
    return;
  }

  // Resto: caché primero
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
