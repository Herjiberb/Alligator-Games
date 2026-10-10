// Alligator Games – virtual file server for games at /__g/<gameId>/<path>
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url), m = u.pathname.match(/\/__g\/([^/]+)\/(.*)$/);
  if (m) e.respondWith(serve(u, m[1], decodeURIComponent(m[2])).then(inj));
});
// Injected into every game HTML page. Adds window.__snap(): captures the WHOLE page (canvas/WebGL + HTML UI + video).
// Zero cost during play: no preserveDrawingBuffer, no per-frame work. Work happens only when a snapshot is requested.
function inject() {
  if (window.__snap) return;
  const raf = window.requestAnimationFrame.bind(window); let want = null;
  // run the snapshot right after a game's own frame callback, when the WebGL buffer is still valid
  window.requestAnimationFrame = cb => raf(t => { try { cb(t) } finally { if (want) { const f = want; want = null; f() } } });
  const SEL = 'canvas,video', cache = new Map();
  const b64 = u => cache.get(u) || (cache.set(u, fetch(u).then(r => r.blob()).then(b => new Promise(ok => { const f = new FileReader; f.onload = () => ok(f.result); f.onerror = () => ok(u); f.readAsDataURL(b) })).catch(() => u)), cache.get(u));
  const read = () => [...document.querySelectorAll(SEL)].map(el => {
    const w = el.videoWidth || el.width, h = el.videoHeight || el.height; if (!w || !h) return null;
    if (el.tagName == 'VIDEO') { const c = document.createElement('canvas'); c.width = w; c.height = h; try { c.getContext('2d').drawImage(el, 0, 0); return Promise.resolve(c) } catch { return null } }
    return createImageBitmap(el).catch(() => null); // synchronous snapshot of the current buffer, async encode
  });
  const frames = () => new Promise(ok => { let d = 0; const go = () => { if (!d) { d = 1; ok(read()) } }; want = go; setTimeout(() => { if (!d) { want = null; go() } }, 200) });
  const enc = async s => { if (!s) return null; const c = document.createElement('canvas'); c.width = s.width; c.height = s.height; c.getContext('2d').drawImage(s, 0, 0); return new Promise(ok => c.toBlob(b => { const f = new FileReader; f.onload = () => ok(f.result); f.readAsDataURL(b) }, 'image/webp', .95)) };
  const rx = /url\(\s*(['"]?)(?!data:|#)(.*?)\1\s*\)/g;
  const rs = async (t, base) => { const m = [...t.matchAll(rx)], rep = await Promise.all(m.map(x => b64(new URL(x[2], base).href))); let i = 0; return t.replace(rx, () => `url("${rep[i++]}")`) };
  const KEEP = ['position', 'left', 'top', 'right', 'bottom', 'transform', 'transformOrigin', 'zIndex', 'margin', 'objectFit', 'objectPosition', 'display', 'opacity', 'filter', 'imageRendering'];
  window.__snap = async () => {
    const W = innerWidth, H = innerHeight, k = Math.max(1, devicePixelRatio || 1);
    const els = [...document.querySelectorAll(SEL)];
    const urls = await Promise.all((await Promise.all(await frames())).map(enc));
    const cl = document.documentElement.cloneNode(true);
    cl.querySelectorAll('script,link[rel~=stylesheet],style,noscript,iframe').forEach(n => n.remove());
    const cels = [...cl.querySelectorAll(SEL)];
    els.forEach((el, i) => {
      const n = cels[i]; if (!n || !urls[i]) return;
      const im = document.createElement('img'), cs = getComputedStyle(el), r = el.getBoundingClientRect();
      im.className = n.className; if (n.id) im.id = n.id; im.src = urls[i];
      for (const p of KEEP) im.style[p] = cs[p];
      im.style.width = r.width + 'px'; im.style.height = r.height + 'px'; im.style.boxSizing = cs.boxSizing;
      n.replaceWith(im);
    });
    await Promise.all([...cl.querySelectorAll('img')].map(async im => { const s = im.getAttribute('src'); if (s && !/^data:/.test(s)) { im.removeAttribute('srcset'); im.src = await b64(new URL(s, document.baseURI).href) } }));
    let css = '';
    for (const s of document.styleSheets) { try { css += await rs([...s.cssRules].map(r => r.cssText).join('\n'), s.href || document.baseURI) + '\n' } catch { } }
    const st = document.createElement('style'); st.textContent = css; (cl.querySelector('head') || cl).appendChild(st);
    cl.style.cssText += `;width:${W}px;height:${H}px;overflow:hidden`;
    const xml = new XMLSerializer().serializeToString(cl);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;
    const img = new Image; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await img.decode();
    const o = document.createElement('canvas'); o.width = W * k; o.height = H * k;
    const x = o.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, o.width, o.height); x.drawImage(img, 0, 0, o.width, o.height);
    return new Promise(ok => o.toBlob(ok, 'image/png'));
  };
}
const INJ = '<script>(' + inject + ')()</script>';
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
