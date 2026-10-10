// Alligator Games – virtual file server for games at /__g/<gameId>/<path>
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url), m = u.pathname.match(/\/__g\/([^/]+)\/(.*)$/);
  if (m) e.respondWith(serve(u, m[1], decodeURIComponent(m[2])).then(inj));
});
// Injected into every game HTML page. Adds window.__ag: volume/mute, pause, game speed, auto-click and a frame counter.
function inject() {
  if (window.__ag) return;
  const ag = window.__ag = { mute: false, vol: 1, speed: 1, paused: false, frames: 0, gains: new Map(), els: new Set(), om: new Map(), pe: new Set(), held: [], mx: null, my: null };
  try { ag.mute = parent.localStorage.agmute == '1'; ag.vol = (JSON.parse(parent.localStorage.agopts || '{}').vol ?? 100) / 100 } catch { }
  const orig = { now: performance.now.bind(performance), dnow: Date.now.bind(Date), st: window.setTimeout.bind(window), si: window.setInterval.bind(window) };
  // virtual clock (only installed when speed != 1 or the game is paused)
  let vt = 0, last = 0, patched = false;
  const adv = () => { const r = orig.now(); vt += (r - last) * (ag.paused ? 0 : ag.speed); last = r; return vt };
  const install = () => {
    if (patched) return; patched = true; vt = last = orig.now(); const d0 = orig.dnow() - vt;
    performance.now = () => adv(); Date.now = () => d0 + adv();
    window.setTimeout = (f, d, ...a) => orig.st(f, (d || 0) / (ag.speed || 1), ...a);
    window.setInterval = (f, d, ...a) => orig.si(f, (d || 0) / (ag.speed || 1), ...a);
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(t => { if (ag.paused) { ag.held.push(cb); return } ag.frames++; cb(patched ? adv() : t) });
  document.addEventListener('pointermove', e => { ag.mx = e.clientX; ag.my = e.clientY }, true);
  // route everything that reaches the speakers through one master gain per AudioContext
  const oc = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (d, ...a) {
    if (typeof AudioDestinationNode != 'undefined' && d instanceof AudioDestinationNode) {
      const c = this.context; let g = ag.gains.get(c);
      if (!g) { g = c.createGain(); g.gain.value = ag.mute ? 0 : ag.vol; oc.call(g, d); ag.gains.set(c, g) }
      if (this !== g) { oc.call(this, g, ...a); return d }
    }
    return oc.call(this, d, ...a);
  };
  const pl = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    ag.els.add(this); if (ag.vol != 1) try { this.volume = ag.vol } catch { }
    if (ag.mute) { if (!ag.om.has(this)) ag.om.set(this, this.muted); this.muted = true }
    return pl.apply(this, arguments)
  };
  const media = () => { document.querySelectorAll('audio,video').forEach(e => ag.els.add(e)); return ag.els };
  ag.setMute = m => {
    ag.mute = m; ag.gains.forEach(g => g.gain.value = m ? 0 : ag.vol);
    media().forEach(e => { if (m) { if (!ag.om.has(e)) ag.om.set(e, e.muted); e.muted = true } else { e.muted = ag.om.get(e) ?? false; ag.om.delete(e) } });
  };
  ag.setVol = v => { ag.vol = v; ag.gains.forEach(g => g.gain.value = ag.mute ? 0 : v); media().forEach(e => { try { e.volume = v } catch { } }) };
  ag.setSpeed = s => { if (patched) adv(); ag.speed = s; if (s != 1) install() };
  ag.setPause = p => {
    if (p === ag.paused) return;
    if (p) {
      install(); adv(); ag.paused = true;
      ag.gains.forEach((g, c) => c.suspend && c.suspend().catch(() => { }));
      media().forEach(e => { if (!e.paused) { e.pause(); ag.pe.add(e) } });
    } else {
      last = orig.now(); ag.paused = false;
      ag.gains.forEach((g, c) => c.resume && c.resume().catch(() => { }));
      ag.pe.forEach(e => e.play().catch(() => { })); ag.pe.clear();
      ag.held.splice(0).forEach(cb => window.requestAnimationFrame(cb));
    }
  };
  let ai = 0;
  ag.setAuto = n => {
    clearInterval(ai); ai = 0; if (!n) return;
    ai = orig.si(() => {
      if (ag.paused) return;
      const x = ag.mx ?? innerWidth / 2, y = ag.my ?? innerHeight / 2, el = document.elementFromPoint(x, y) || document.body, o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, view: window };
      for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(t[0] == 'p' ? new PointerEvent(t, { ...o, pointerType: 'mouse', isPrimary: true }) : new MouseEvent(t, o));
    }, 1000 / n);
  };
}
// Per-game storage namespacing: all games share one origin, so localStorage/IndexedDB names get a "g:<id>:" prefix.
// This lets the app measure and wipe each game's data separately.
function shim() {
  const m = location.pathname.match(/\/__g\/([^/]+)\//); if (!m || window.__gs) return; window.__gs = 1;
  const P = 'g:' + decodeURIComponent(m[1]) + ':', own = Object.hasOwn;
  try {
    const real = window.localStorage, mine = () => { const o = []; for (let i = 0; i < real.length; i++) { const k = real.key(i); if (k.startsWith(P)) o.push(k.slice(P.length)) } return o };
    const api = { getItem: k => real.getItem(P + k), setItem: (k, v) => real.setItem(P + k, v), removeItem: k => real.removeItem(P + k), clear: () => mine().forEach(k => real.removeItem(P + k)), key: i => mine()[i] ?? null };
    const px = new Proxy({}, {
      get: (t, k) => k == 'length' ? mine().length : typeof k != 'string' ? undefined : own(api, k) ? api[k] : (real.getItem(P + k) ?? undefined),
      set: (t, k, v) => { real.setItem(P + k, v); return true }, deleteProperty: (t, k) => { real.removeItem(P + k); return true },
      has: (t, k) => typeof k == 'string' && (own(api, k) || real.getItem(P + k) !== null), ownKeys: () => mine(),
      getOwnPropertyDescriptor: (t, k) => typeof k == 'string' && real.getItem(P + k) !== null ? { value: real.getItem(P + k), enumerable: true, configurable: true, writable: true } : undefined
    });
    Object.defineProperty(window, 'localStorage', { get: () => px, configurable: true });
  } catch { }
  try {
    const idb = window.indexedDB;
    const w = { open: (n, v) => v === undefined ? idb.open(P + n) : idb.open(P + n, v), deleteDatabase: n => idb.deleteDatabase(P + n), cmp: (a, b) => idb.cmp(a, b),
      databases: async () => (await idb.databases()).filter(d => d.name.startsWith(P)).map(d => ({ ...d, name: d.name.slice(P.length) })) };
    Object.defineProperty(window, 'indexedDB', { get: () => w, configurable: true });
  } catch { }
}
const INJ = '<script>(' + shim + ')();(' + inject + ')()</script>';
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