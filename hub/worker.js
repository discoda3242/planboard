// Planboard hub — the board on a server (Cloudflare Worker + one Durable Object per board) with an MCP endpoint
// so every collaborator's AI (Claude, Gemini CLI, Codex…) can see the board, claim a module, get its interface
// contracts and report progress live. The page is the same planboard.html, served with the local shim.
//
// Routes (per board, prefix /b/<board>):
//   /join?t=<token>   invite link → sets the cookie        /            the board page
//   /admin            members, invite links, MCP URLs       /api/*       page API (same as local/server.mjs) + /api/ws live updates
//   /mcp/<token>      MCP (Streamable HTTP)                 /api/ci-check  CI: changed files vs. claims (Bearer CI_KEY)
// Secrets: OWNER_KEY (your master link: /b/<board>/join?t=<OWNER_KEY>), CI_KEY (GitHub Actions).
import { Hub, mcpHandle, httpErr, ROLES } from './core.js';
import { PAGE, SHIM, UI } from './assets.js';

const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    const m = u.pathname.match(/^\/b\/([^/]+)(\/.*)?$/);
    if (!m) return new Response('Planboard hub. Open /b/<board>/join?t=<link token>.', { status: u.pathname === '/' ? 200 : 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    if (!SLUG.test(m[1])) return new Response('bad board name', { status: 400 });
    if (!m[2]) return Response.redirect(u.origin + u.pathname + '/' + u.search, 302);
    const stub = env.BOARD.get(env.BOARD.idFromName(m[1]));
    return stub.fetch(req);
  },
};

export class Board {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.pending = new Set(); this.timer = 0;
    this.hub = new Hub(memCache(ctx.storage), { onChange: (col) => this.changed(col) });
    // pings from open board pages are answered by Cloudflare without waking this object (no duration billed)
    try { ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong')); } catch {}
  }
  // wake exactly when the earliest claim runs out, free it (page shows it at once), then sleep again
  async schedule() { const n = await this.hub.nextExpiry(); if (n) await this.ctx.storage.setAlarm(n + 1000); else await this.ctx.storage.deleteAlarm(); }
  async alarm() { await this.hub.expire(); await this.schedule(); }
  changed(col) {
    this.pending.add(col);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = 0; const cols = [...this.pending]; this.pending.clear();
      const msg = cols.includes('*') ? JSON.stringify({ all: true }) : null;
      for (const ws of this.ctx.getWebSockets()) for (const c of msg ? [null] : cols) { try { ws.send(msg || JSON.stringify({ col: c })); } catch {} }
    }, 80);
  }
  webSocketMessage(ws, m) { if (m === 'ping') ws.send('pong'); }
  webSocketClose(ws) { try { ws.close(); } catch {} }

  async fetch(req) {
    const u = new URL(req.url);
    const [, slug, rest] = u.pathname.match(/^\/b\/([^/]+)(\/.*)$/);
    const base = `${u.origin}/b/${slug}`, p = rest;
    try {
      // ---- MCP: token in the path (works as a claude.ai custom connector, in Claude Code and Gemini CLI) ----
      const mm = p.match(/^\/mcp\/([A-Za-z0-9_-]{8,})$/);
      if (mm) {
        if (req.method !== 'POST') return new Response('MCP endpoint: POST JSON-RPC', { status: 405, headers: { Allow: 'POST' } });
        const me = await this.hub.byToken(mm[1]); if (!me || me.removed) return json(401, { error: 'unknown member token' });
        const out = await mcpHandle(this.hub, me, await req.json());
        await this.schedule();
        return out ? json(200, out) : new Response(null, { status: 202 });
      }
      if (p === '/api/ci-check') {
        if (!this.env.CI_KEY || (req.headers.get('Authorization') || '') !== 'Bearer ' + this.env.CI_KEY) return json(401, { error: 'bad CI key' });
        return json(200, await this.hub.ciCheck(await req.json()));
      }
      if (p === '/join') {
        const t = u.searchParams.get('t') || '';
        let me = await this.hub.byToken(t);
        if (!me && this.env.OWNER_KEY && t === this.env.OWNER_KEY) { // master link: the owner of every board on this hub
          me = (await this.hub.members()).find((x) => x.owner);
          if (!me) { const r = await this.hub.addMember({ name: u.searchParams.get('name') || 'owner', role: 'admin', owner: true }); me = await this.hub.member(r.id); }
        }
        if (!me || me.removed) return html(403, NO_ACCESS);
        return new Response(null, { status: 302, headers: { Location: base + '/', 'Set-Cookie': `pb_t=${encodeURIComponent(me.token)}; Path=/b/${slug}; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000` } });
      }
      const me = await this.hub.byToken(cookie(req, 'pb_t'));
      if (!me || me.removed) return p.startsWith('/api/') ? json(401, { error: 'invite link needed' }) : html(401, NO_ACCESS);
      if (p === '/api/ws') {
        if (req.headers.get('Upgrade') !== 'websocket') return json(426, { error: 'websocket only' });
        const pair = new WebSocketPair(); this.ctx.acceptWebSocket(pair[1]); return new Response(null, { status: 101, webSocket: pair[0] });
      }
      if (req.method !== 'GET' && req.headers.get('X-PB') !== '1') throw httpErr(403, 'missing header');
      if (p === '/') return html(200, page(slug));
      if (p === '/pb-local.js') return js(SHIM);
      if (p === '/hub-ui.js') return js(UI);
      if (p === '/admin') { if (me.role !== 'admin') throw httpErr(403, 'admins only'); return html(200, await this.adminPage(base, me)); }
      if (p === '/api/me') return json(200, { id: me.id, name: me.name, email: me.email, role: me.role, isOwner: !!me.owner });
      if (p === '/api/profiles') { const out = {}; for (const id of (u.searchParams.get('ids') || '').split(',')) { const m = id && (await this.hub.member(id)); if (m) out[id] = { name: m.name }; } return json(200, { profiles: out }); }
      if (p === '/api/doc' && req.method === 'GET') return json(200, { data: await this.hub.apiGetDoc(me, u.searchParams.get('path')) });
      if (p === '/api/col') return json(200, { docs: await this.hub.apiCol(me, u.searchParams.get('name')) });
      if (p === '/api/doc' && req.method === 'POST') { await this.hub.apiWrite(me, await req.json()); return json(200, { ok: true }); }
      if (p === '/api/add' && req.method === 'POST') { const b = await req.json(); return json(200, { id: await this.hub.apiAdd(me, b.col, b.data) }); }
      if (p === '/api/import' && req.method === 'POST') { // admin: bulk load {docs:[{col,id,data}]} (moving a board here)
        if (me.role !== 'admin') throw httpErr(403, 'admins only');
        const b = await req.json(); let n = 0; for (const d of b.docs || []) { await this.hub.apiWrite(me, { op: 'set', path: d.col + '/' + d.id, data: d.data }); n++; }
        return json(200, { ok: true, n });
      }
      if (p === '/api/members') {
        if (me.role !== 'admin') throw httpErr(403, 'admins only');
        const b = await req.json();
        if (req.method === 'POST') { if (!String(b.name || '').trim()) throw httpErr(400, 'name required'); const r = await this.hub.addMember({ name: b.name, email: b.email, role: b.role }); return json(200, { id: r.id, link: base + '/join?t=' + r.token }); }
        if (req.method === 'DELETE') { await this.hub.removeMember(b.id); return json(200, { ok: true }); }
      }
      throw httpErr(404, 'not found');
    } catch (e) { const c = e.code >= 400 && e.code < 600 ? e.code : 500; if (c === 500) console.error(e); return json(c, { error: e.message }); }
  }

  async adminPage(base, me) {
    const rows = (await this.hub.members()).filter((m) => !m.removed).map((m) => `<tr><td>${esc(m.name)}${m.owner ? ' (owner)' : ''}<br><small>${esc(m.email)}</small></td><td>${m.role}</td>
      <td><label>board<input readonly value="${esc(base + '/join?t=' + m.token)}"></label><label>MCP<input readonly value="${esc(base + '/mcp/' + m.token)}"></label></td>
      <td>${m.owner ? '' : `<button data-id="${m.id}" class="del">remove</button>`}</td></tr>`).join('');
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Planboard members</title>
<style>:root{--bg:#f7f7f4;--fg:#1f2328;--line:#d6d6cf;--dim:#6a6f76}@media(prefers-color-scheme:dark){:root{--bg:#16181c;--fg:#e8e6e1;--line:#33363c;--dim:#9a9ea6;color-scheme:dark}}
body{font:15px system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg);padding-block:24px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
main{max-width:900px;margin:0 auto}table{width:100%;border-collapse:collapse}td,th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}label{display:block;font-size:12px;color:var(--dim)}
input,select,button{font:inherit}td input{width:100%;font:12px ui-monospace,monospace;margin:2px 0 6px}form{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}pre{background:var(--line);padding:10px;border-radius:6px;overflow-x:auto;font-size:12px}.wrap{overflow-x:auto}</style>
<main><h1>Members</h1><p>Each person gets their own board link and MCP URL. Treat both like passwords. <a href="${base}/">← board</a></p>
<form id="f"><input name="name" placeholder="name" required><input name="email" placeholder="email (optional)"><select name="role"><option value="interact">collaborator (comment, claim modules)</option><option value="view">view only</option><option value="admin">admin (edit plan, modules, contracts)</option></select><button>Create</button></form>
<div class="wrap"><table><tr><th>name</th><th>role</th><th>links</th><th></th></tr>${rows}</table></div>
<h2>Connecting an AI</h2>
<p>Claude (claude.ai): Settings → Connectors → Add custom connector → paste the MCP URL.</p>
<pre>claude mcp add --transport http planboard &lt;MCP URL&gt;          # Claude Code</pre>
<pre>// Gemini CLI: ~/.gemini/settings.json
{ "mcpServers": { "planboard": { "httpUrl": "&lt;MCP URL&gt;" } } }</pre>
</main><script>const H={'Content-Type':'application/json','X-PB':'1'};
f.onsubmit=async e=>{e.preventDefault();const r=await fetch('${base}/api/members',{method:'POST',headers:H,body:JSON.stringify(Object.fromEntries(new FormData(f)))});if(r.ok)location.reload();else alert((await r.json()).error)};
document.querySelectorAll('.del').forEach(b=>b.onclick=async()=>{if(!confirm('Remove? Their links stop working.'))return;await fetch('${base}/api/members',{method:'DELETE',headers:H,body:JSON.stringify({id:b.dataset.id})});location.reload()});
document.querySelectorAll('td input').forEach(i=>i.onclick=()=>i.select());</script>`;
  }
}

// The whole board lives in memory while the object is awake: one full read when it wakes, then every get/list is free.
// Writes go to storage and memory together. (The object is the only writer of its storage, so the copy can't go stale.)
function memCache(st) {
  let all = null; const load = async () => (all = all || new Map([...(await st.list())].sort(([a], [b]) => (a < b ? -1 : 1))));
  return {
    get: async (k) => structuredClone((await load()).get(k)),
    put: async (k, v) => { await st.put(k, v); (await load()).set(k, structuredClone(v)); },
    delete: async (k) => { await st.delete(k); (await load()).delete(k); },
    list: async (p) => { const m = await load(); return new Map([...m].filter(([k]) => k.startsWith(p)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, structuredClone(v)])); },
  };
}
function page(slug) {
  const pre = `<script>window.PB_BASE='/b/${slug}';window.PB_WS=true;</script><script src="/b/${slug}/pb-local.js"></script>`;
  let s = PAGE; const i = s.indexOf('<script'); s = i >= 0 ? s.slice(0, i) + pre + s.slice(i) : pre + s;
  s = s.replace(/<\/body>|$/, `<script src="/b/${slug}/hub-ui.js" defer></script>$&`);
  if (!/^\s*<!doctype/i.test(s)) s = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + s;
  return s;
}
const NO_ACCESS = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Planboard</title><body style="font:16px system-ui;margin:40px">이 기획판은 초대 링크로만 들어올 수 있어.<br><small>This board needs an invite link.</small></body>';
const cookie = (req, n) => { const m = (req.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + n + '=([^;]+)')); return m ? decodeURIComponent(m[1]) : null; };
const json = (code, o) => new Response(JSON.stringify(o), { status: code, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const html = (code, s) => new Response(s, { status: code, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' } });
const js = (s) => new Response(s, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' } });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export { ROLES };
