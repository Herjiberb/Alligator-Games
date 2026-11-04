// sw-plus.js: add this as the FIRST line of sw.js:   importScripts('sw-plus.js');
// Takes over /__g/ requests (stronger lookups, retries, ghost stand-ins) and lets the launcher fetch raw files past the cache.
const IDX = new Map();
const IMG = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i, AUD = /\.(mp3|ogg|wav|m4a|aac|flac|opus)$/i;
function wav() {
  const b = new Uint8Array(46), d = new DataView(b.buffer), s = (o, t) => [...t].forEach((c, i) => b[o + i] = c.charCodeAt(0));
  s(0, 'RIFF'); d.setUint32(4, 38, true); s(8, 'WAVEfmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, 8000, true); d.setUint32(28, 8000, true); d.setUint16(32, 1, true); d.setUint16(34, 8, true); s(36, 'data'); d.setUint32(40, 2, true); b[44] = b[45] = 128;
  return b;
}
// "ghost" stand-ins: a missing image/sound still loads (blank / silent) so a game's loader never hangs or gives up
function ghost(p) {
  const h = { 'Cache-Control': 'no-store', 'X-AG-Ghost': '1' };
  if (IMG.test(p)) return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>', { headers: { ...h, 'Content-Type': 'image/svg+xml' } });
  if (AUD.test(p)) return new Response(wav(), { headers: { ...h, 'Content-Type': 'audio/wav' } });
  return null;
}
// case-insensitive, decoded-path index of a game's cache (fixes odd characters, spaces, wrong-case references)
async function norm(id) {
  const m = IDX.get(id); if (m && Date.now() - m.t < 5000) return m.map;
  const c = await caches.open('g-' + id), map = new Map();
  for (const k of await c.keys()) { let p = new URL(k.url).pathname; try { p = decodeURIComponent(p) } catch { } map.set(p.toLowerCase(), k) }
  IDX.set(id, { t: Date.now(), map }); return map;
}
async function liveRead(id, p) {
  for (const c of await clients.matchAll({ type: 'window' })) {
    if (c.url.includes('/__g/')) continue;
    for (let t = 0; t < 2; t++) {
      const r = await new Promise(ok => { const ch = new MessageChannel(); ch.port1.onmessage = m => ok(m.data); setTimeout(() => ok(null), 10000); c.postMessage({ id, p }, [ch.port2]) });
      if (r) return new Response(r.b, { headers: { 'Content-Type': r.t, 'Cache-Control': 'no-store' } });
    }
  }
  return null;
}
async function serve2(u, id, p) {
  const c = await caches.open('g-' + id);
  let hit = await c.match(u.origin + u.pathname);
  if (!hit && (p === '' || p.endsWith('/'))) hit = await c.match(u.origin + u.pathname + 'index.html');
  if (!hit) { let d = u.pathname; try { d = decodeURIComponent(d) } catch { } const k = (await norm(id)).get(d.toLowerCase()); if (k) hit = await c.match(k) }
  if (hit) return hit;
  return (await liveRead(id, p)) || ghost(p) || new Response('Not found: ' + p, { status: 404 });
}
self.addEventListener('fetch', e => {
  const q = e.request, u = new URL(q.url);
  if (q.headers.has('x-ag-raw')) { e.stopImmediatePropagation(); e.respondWith(fetch(q)); return }
  const m = u.pathname.match(/\/__g\/([^/]+)\/(.*)$/); if (!m) return;
  e.stopImmediatePropagation();
  let p = m[2]; try { p = decodeURIComponent(p) } catch { }
  e.respondWith(serve2(u, m[1], p).then(r => inj(r, q.destination))); // inj() lives in sw.js
});
