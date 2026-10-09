// Alligator Games – virtual file server for games at /__g/<gameId>/<path>
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url), m = u.pathname.match(/\/__g\/([^/]+)\/(.*)$/);
  if (m) e.respondWith(serve(u, m[1], decodeURIComponent(m[2])).then(inj));
});
// Injected into every game HTML page: keeps WebGL frames readable so screenshots are never blank.
const INJ = '<script>(()=>{const g=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,a){if(/webgl/i.test(t))a=Object.assign({},a,{preserveDrawingBuffer:true});return g.call(this,t,a)}})()</script>';
async function inj(r) {
  const ct = r.headers.get('Content-Type') || '';
  if (!/text\/html/i.test(ct)) return r;
  let t = await r.text();
  const re = [/<head[^>]*>/i, /<html[^>]*>/i, /<!doctype[^>]*>/i].find(x => x.test(t));
  t = re ? t.replace(re, m => m + INJ) : INJ + t;
  return new Response(t, { status: r.status, headers: { 'Content-Type': ct, 'Cache-Control': 'no-store' } });
}
async function serve(u, id, p) {
  // 1) uploaded games: unpacked into Cache Storage
  const hit = await (await caches.open('g-' + id)).match(u.origin + u.pathname);
  if (hit) return hit;
  // 2) local-folder games: ask the app tab (holds the folder handle) to read the file live
  for (const c of await clients.matchAll({ type: 'window' })) {
    if (c.url.includes('/__g/')) continue;
    const r = await new Promise(ok => {
      const ch = new MessageChannel();
      ch.port1.onmessage = m => ok(m.data);
      setTimeout(() => ok(null), 3000);
      c.postMessage({ id, p }, [ch.port2]);
    });
    if (r) return new Response(r.b, { headers: { 'Content-Type': r.t, 'Cache-Control': 'no-store' } });
  }
  return new Response('Not found: ' + p, { status: 404 });
}