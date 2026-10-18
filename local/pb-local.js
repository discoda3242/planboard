// Planboard local shim: gives the page the same window.claude.use('db'|'user') API it has on claude.ai,
// backed by the local server (/api/*) with live updates over server-sent events,
// or by the planboard hub (window.PB_BASE = '/b/<board>', window.PB_WS = true: live updates over a WebSocket).
(function () {
  const B = window.PB_BASE || '';
  const H = { 'Content-Type': 'application/json', 'X-PB': '1' };
  async function api(method, url, body) {
    const r = await fetch(B + url, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }
  const subs = new Set();
  function snapDoc(path, d) { return { id: path.split('/').pop(), exists: d != null, data: () => d }; }
  function snapCol(list) { return { docs: list.map(x => ({ id: x.id, data: () => x.data })), size: list.length, empty: !list.length }; }
  async function refresh(s) {
    try {
      if (s.kind === 'doc') { const j = await api('GET', '/api/doc?path=' + encodeURIComponent(s.path)); s.cb(snapDoc(s.path, j.data)); }
      else { const j = await api('GET', '/api/col?name=' + encodeURIComponent(s.path)); s.cb(snapCol(j.docs)); }
    } catch (e) { if (s.err) s.err(e); }
  }
  function sub(kind, path, cb, err) { const s = { kind, path, col: path.split('/')[0], cb, err }; subs.add(s); refresh(s); return () => subs.delete(s); }
  let es;
  const onMsg = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } for (const s of subs) if (m.all || s.col === m.col) refresh(s); };
  const again = () => setTimeout(() => { listen(); for (const s of subs) refresh(s); }, 3000);
  function listen() {
    if (window.PB_WS) {
      const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + B + '/api/ws');
      let ping = 0; ws.onopen = () => { ping = setInterval(() => { try { ws.send('ping'); } catch (e) {} }, 30000); };
      ws.onmessage = onMsg; ws.onclose = () => { clearInterval(ping); again(); };
      return;
    }
    es = new EventSource(B + '/api/events');
    es.onmessage = onMsg;
    es.onerror = () => { es.close(); again(); };
  }
  listen();
  const db = {
    doc(path) {
      return {
        id: path.split('/').pop(),
        onSnapshot: (cb, err) => sub('doc', path, cb, err),
        get: async () => snapDoc(path, (await api('GET', '/api/doc?path=' + encodeURIComponent(path))).data),
        set: (data) => api('POST', '/api/doc', { op: 'set', path, data }),
        update: (data) => api('POST', '/api/doc', { op: 'update', path, data }),
        delete: () => api('POST', '/api/doc', { op: 'delete', path }),
      };
    },
    collection(name) {
      return {
        onSnapshot: (cb, err) => sub('col', name, cb, err),
        get: async () => snapCol((await api('GET', '/api/col?name=' + encodeURIComponent(name))).docs),
        add: async (data) => { const j = await api('POST', '/api/add', { col: name, data }); return { id: j.id }; },
        doc: (id) => db.doc(name + '/' + id),
      };
    },
  };
  let meP;
  const user = {
    me: () => (meP = meP || api('GET', '/api/me')),
    can: async (cap) => { const m = await user.me(); return cap === 'data.write' ? m.role !== 'view' : null; },
    profiles: async (ids) => (await api('GET', '/api/profiles?ids=' + encodeURIComponent(ids.join(',')))).profiles,
  };
  window.PB_LOCAL = true;
  window.claude = { use: async (name) => (name === 'db' ? db : name === 'user' ? user : null) };
})();
