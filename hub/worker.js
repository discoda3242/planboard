// Planboard hub — the board on a server (Cloudflare Worker + one Durable Object per board) with an MCP endpoint
// so every collaborator's AI (Claude, Gemini CLI, Codex…) can see the board, claim a module, get its interface
// contracts and report progress live. The page is the same planboard.html, served with the local shim.
//
// Routes (per board, prefix /b/<board>):
//   /join?t=<token>   invite link → sets the cookie        /            the board page
//   /admin            members, invite links, MCP URLs       /api/*       page API (same as local/server.mjs) + /api/ws live updates
//   /mcp/<token>      MCP (Streamable HTTP)                 /api/ci-check  CI: changed files vs. claims (Bearer CI_KEY)
//   /login            sign in with GitHub (members registered by GitHub username on /admin)
// Secrets: OWNER_KEY (your master link: /b/<board>/join?t=<OWNER_KEY>), CI_KEY (GitHub Actions),
//          GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET (GitHub OAuth app, callback <hub>/auth/github/callback).
// Var: OWNER_GITHUB — your GitHub username; signing in with it makes you the owner of any board on this hub.
import { Hub, mcpHandle, httpErr, ROLES, randToken, ghName } from './core.js';
import { PAGE, SHIM, UI } from './assets.js';
// Merge gate (optional): the board as a GitHub App merges PRs that pass its claim check and the repo's build checks.
//   Secrets GH_APP_ID, GH_APP_KEY (the app's private key PEM), GH_WEBHOOK_SECRET; var GH_BOARDS {"owner/repo":"board"},
//   GH_CHECKS (check names that must pass, default "build"). App webhook URL: <hub>/gh/webhook
import { githubClient, verifyWebhook } from './github.js';

const ghBoards = (env) => { const v = env.GH_BOARDS; if (v && typeof v === 'object') return v; try { return JSON.parse(v || '{}'); } catch { return {}; } };

const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === '/auth/github/callback') return githubCallback(req, env, u);
    if (u.pathname === '/gh/webhook' && req.method === 'POST') {
      const body = await req.text();
      if (!(await verifyWebhook(env.GH_WEBHOOK_SECRET, body, req.headers.get('X-Hub-Signature-256')))) return new Response('bad signature', { status: 401 });
      let p; try { p = JSON.parse(body); } catch { return new Response('bad json', { status: 400 }); }
      const slug = p.repository && ghBoards(env)[p.repository.full_name];
      if (!slug || !SLUG.test(slug)) return new Response('no board for this repo', { status: 202 });
      return env.BOARD.get(env.BOARD.idFromName(slug)).fetch(new Request(`${u.origin}/b/${slug}/__ghhook`, { method: 'POST', headers: { 'X-GitHub-Event': req.headers.get('X-GitHub-Event') || '' }, body }));
    }
    const m = u.pathname.match(/^\/b\/([^/]+)(\/.*)?$/);
    if (!m) return new Response('Planboard hub. Open /b/<board>/join?t=<link token>.', { status: u.pathname === '/' ? 200 : 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    if (!SLUG.test(m[1])) return new Response('bad board name', { status: 400 });
    if (!m[2]) return Response.redirect(u.origin + u.pathname + '/' + u.search, 302);
    if (m[2] === '/__gh' || m[2] === '/__ghhook') return new Response('not found', { status: 404 }); // internal: only reached from this worker
    if (m[2] === '/login') {
      if (!env.GITHUB_CLIENT_ID) return html(501, page404('GitHub 로그인이 아직 설정되지 않았어. 초대 링크로 들어와줘.'));
      const state = m[1] + '.' + randToken();
      const q = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: u.origin + '/auth/github/callback', state, allow_signup: 'false' });
      return new Response(null, { status: 302, headers: { Location: 'https://github.com/login/oauth/authorize?' + q, 'Set-Cookie': `pb_oauth=${state}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } });
    }
    const stub = env.BOARD.get(env.BOARD.idFromName(m[1]));
    return stub.fetch(req);
  },
};

// GitHub sends the person back here; we check the state cookie, ask GitHub who it is, and let the board sign them in.
async function githubCallback(req, env, u) {
  const state = u.searchParams.get('state') || '', code = u.searchParams.get('code') || '';
  if (!state || state !== cookie(req, 'pb_oauth')) return html(400, page404('로그인 요청이 만료됐어. 기획판에서 다시 GitHub 로그인을 눌러줘.'));
  const slug = state.split('.')[0]; if (!SLUG.test(slug)) return html(400, page404('bad board'));
  try {
    const t = await (await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: u.origin + '/auth/github/callback' }) })).json();
    if (!t.access_token) throw new Error(t.error_description || 'no token');
    const gu = await (await fetch('https://api.github.com/user', { headers: { Authorization: 'Bearer ' + t.access_token, 'User-Agent': 'planboard-hub', Accept: 'application/vnd.github+json' } })).json();
    if (!gu.login) throw new Error('no user');
    const stub = env.BOARD.get(env.BOARD.idFromName(slug));
    // redirect: 'manual' — the board answers with a 302 + session cookie for the browser; a followed redirect would
    // fetch the board again without that cookie and hand back the sign-in page instead
    const r = await stub.fetch(new Request(`${u.origin}/b/${slug}/__gh`, { method: 'POST', redirect: 'manual', body: JSON.stringify({ login: gu.login, name: gu.name || gu.login, token: t.access_token }) }));
    const out = new Response(r.body, r); out.headers.append('Set-Cookie', 'pb_oauth=; Path=/auth; Max-Age=0'); return out;
  } catch (e) { return html(502, page404('GitHub 로그인에 실패했어: ' + esc(e.message))); }
}

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
    if (!this.hub.gh && this.env.GH_APP_ID && this.env.GH_APP_KEY) { // this board's repo, if the hub's GitHub App is set up for it
      const repo = Object.entries(ghBoards(this.env)).find(([, b]) => b === slug)?.[0];
      if (repo) { this.hub.gh = githubClient({ appId: this.env.GH_APP_ID, key: this.env.GH_APP_KEY, repo }); this.hub.repo = repo; if (this.env.GH_CHECKS) this.hub.checks = String(this.env.GH_CHECKS).split(',').map((x) => x.trim()).filter(Boolean); }
    }
    try {
      if (p === '/__ghhook' && req.method === 'POST') {
        const ev = req.headers.get('X-GitHub-Event'), d = await req.json();
        try {
          if (ev === 'pull_request') await this.hub.onPullRequest(d.pull_request);
          else if (ev === 'check_suite' && d.action === 'completed') await this.hub.onChecksDone(d.check_suite.head_sha);
          else if (ev === 'check_run' && d.action === 'completed') await this.hub.onChecksDone(d.check_run.head_sha);
        } catch (e) { console.error('webhook', e); return json(200, { error: e.message }); }
        await this.schedule(); return json(200, { ok: true });
      }
      // ---- MCP: token in the path (works as a claude.ai custom connector, in Claude Code and Gemini CLI) ----
      const mm = p.match(/^\/mcp\/([A-Za-z0-9_-]{8,})$/);
      if (mm) {
        if (req.method !== 'POST') return new Response('MCP endpoint: POST JSON-RPC', { status: 405, headers: { Allow: 'POST' } });
        const me = await this.hub.byToken(mm[1]); if (!me || me.removed) return json(401, { error: 'unknown member token' });
        const mc = { sid: req.headers.get('Mcp-Session-Id') || '' };
        const out = await mcpHandle(this.hub, me, await req.json(), mc);
        await this.schedule();
        const r = out ? json(200, out) : new Response(null, { status: 202 });
        if (mc.newSid) r.headers.set('Mcp-Session-Id', mc.newSid);
        return r;
      }
      if (p === '/api/ci-check') {
        if (!this.env.CI_KEY || (req.headers.get('Authorization') || '') !== 'Bearer ' + this.env.CI_KEY) return json(401, { error: 'bad CI key' });
        return json(200, await this.hub.ciCheck(await req.json()));
      }
      if (p === '/__gh' && req.method === 'POST') {
        const { login, name, token } = await req.json(); let me = await this.hub.byGithub(login);
        const ownerGh = ghName(this.env.OWNER_GITHUB);
        if (!me && ownerGh && ghName(login) === ownerGh) {
          const o = (await this.hub.members()).find((x) => x.owner);
          if (o) { await this.hub.setGithub(o.id, login); me = await this.hub.member(o.id); }
          else { const r = await this.hub.addMember({ name, role: 'admin', owner: true, github: login }); me = await this.hub.member(r.id); }
        }
        if (!me || me.removed) return html(403, page404(`GitHub <b>${esc(login)}</b>은(는) 이 기획판 멤버가 아니야. 관리자에게 이 아이디를 알려주면 추가해줄 거야.`));
        await this.hub.setGhToken(me.id, token);
        if (name && me.name === me.github && name !== me.name) await this.hub.setName(me.id, name); // invited by username only: take their GitHub name
        return new Response(null, { status: 302, headers: { Location: base + '/', 'Set-Cookie': sessionCookie(slug, me.token) } });
      }
      if (p === '/join') {
        const t = u.searchParams.get('t') || '';
        let me = await this.hub.byToken(t);
        if (!me && this.env.OWNER_KEY && t === this.env.OWNER_KEY) { // master link: the owner of every board on this hub
          me = (await this.hub.members()).find((x) => x.owner);
          if (!me) { const r = await this.hub.addMember({ name: u.searchParams.get('name') || 'owner', role: 'admin', owner: true }); me = await this.hub.member(r.id); }
        }
        if (!me || me.removed) return html(403, noAccess(base, !!this.env.GITHUB_CLIENT_ID));
        return new Response(null, { status: 302, headers: { Location: base + '/', 'Set-Cookie': sessionCookie(slug, me.token) } });
      }
      const me = await this.hub.byToken(cookie(req, 'pb_t'));
      if (!me || me.removed) return p.startsWith('/api/') ? json(401, { error: 'invite link needed' }) : html(401, noAccess(base, !!this.env.GITHUB_CLIENT_ID));
      if (p === '/api/ws') {
        if (req.headers.get('Upgrade') !== 'websocket') return json(426, { error: 'websocket only' });
        const pair = new WebSocketPair(); this.ctx.acceptWebSocket(pair[1]); return new Response(null, { status: 101, webSocket: pair[0] });
      }
      if (req.method !== 'GET' && req.headers.get('X-PB') !== '1') throw httpErr(403, 'missing header');
      if (p === '/') return html(200, page(slug));
      if (p === '/pb-local.js') return js(SHIM);
      if (p === '/hub-ui.js') return js(UI);
      if (p === '/admin') { if (me.role !== 'admin') throw httpErr(403, 'admins only'); return html(200, await this.adminPage(base, me)); }
      if (p === '/api/me') return json(200, { id: me.id, name: me.name, email: me.email, role: me.role, isOwner: !!me.owner, github: me.github || '' });
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
      if (p === '/api/team') return json(200, { team: (await this.hub.members()).filter((m) => !m.removed).map((m) => ({ id: m.id, name: m.name, github: m.github || '', role: m.role })) });
      if (p === '/api/crq' && req.method === 'POST') { const b = await req.json(); return json(200, { ok: true, text: await this.hub.decideCrq(me, String(b.id || ''), !!b.ok) }); }
      if (p === '/api/people') { // admin: GitHub people to invite — search results for ?q=, else the admin's following + followers
        if (me.role !== 'admin') throw httpErr(403, 'admins only');
        return json(200, await this.people(me, (u.searchParams.get('q') || '').trim().slice(0, 60)));
      }
      if (p === '/api/members') {
        if (me.role !== 'admin') throw httpErr(403, 'admins only');
        if (req.method === 'GET') return json(200, { members: (await this.hub.members()).filter((m) => !m.removed).map((m) => ({ id: m.id, name: m.name, github: m.github || '', role: m.role, owner: !!m.owner })) });
        const b = await req.json();
        if (req.method === 'POST') { if (!String(b.name || '').trim() && !ghName(b.github)) throw httpErr(400, 'name or GitHub username required'); const r = await this.hub.addMember({ name: b.name, email: b.email, role: b.role, github: b.github }); return json(200, { id: r.id, link: base + '/join?t=' + r.token }); }
        if (req.method === 'PATCH') { await this.hub.setGithub(b.id, b.github); return json(200, { ok: true }); }
        if (req.method === 'DELETE') { await this.hub.removeMember(b.id); return json(200, { ok: true }); }
      }
      throw httpErr(404, 'not found');
    } catch (e) { const c = e.code >= 400 && e.code < 600 ? e.code : 500; if (c === 500) console.error(e); return json(c, { error: e.message }); }
  }

  // GitHub accounts for the invite box, called with the admin's own token when they signed in with GitHub (higher rate limit)
  async people(me, q) {
    let tok = await this.hub.ghToken(me.id);
    const gh = async (path) => {
      const h = { 'User-Agent': 'planboard-hub', Accept: 'application/vnd.github+json' };
      let r = await fetch('https://api.github.com' + path, { headers: tok ? { ...h, Authorization: 'Bearer ' + tok } : h });
      if (r.status === 401 && tok) { await this.hub.setGhToken(me.id, null); tok = null; r = await fetch('https://api.github.com' + path, { headers: h }); } // revoked: retry without
      if (!r.ok) throw httpErr(r.status === 403 || r.status === 429 ? 429 : 502, r.status === 403 || r.status === 429 ? 'GitHub 검색 한도에 걸렸어. 잠깐 뒤에 다시 해줘.' : 'GitHub 응답 ' + r.status);
      return r.json();
    };
    let list = [], friends = false;
    if (q) list = (await gh('/search/users?per_page=12&q=' + encodeURIComponent(q))).items || [];
    else if (tok) { // without the admin's own token GitHub's shared-IP limit is hit almost at once, so the page asks them to sign in instead
      friends = true;
      const [a, b] = await Promise.all([gh('/user/following?per_page=100'), gh('/user/followers?per_page=100')]);
      const seen = new Set(); list = [...a, ...b].filter((x) => !seen.has(x.login) && seen.add(x.login));
    }
    const members = new Map((await this.hub.members()).filter((m) => !m.removed && m.github).map((m) => [m.github, m.role]));
    return { friends, signedIn: !!tok, people: list.filter((x) => x.type !== 'Organization').map((x) => ({ login: x.login, avatar: x.avatar_url, role: members.get(ghName(x.login)) || null })) };
  }

  async adminPage(base, me) {
    const rows = (await this.hub.members()).filter((m) => !m.removed).map((m) => `<tr><td>${esc(m.name)}${m.owner ? ' (owner)' : ''}<br><small>${esc(m.email)}</small></td><td>${m.role}</td>
      <td><input class="gh" data-id="${m.id}" value="${esc(m.github || '')}" placeholder="GitHub username" aria-label="GitHub username of ${esc(m.name)}"></td>
      <td><label>board<input readonly value="${esc(base + '/join?t=' + m.token)}"></label><label>MCP<input readonly value="${esc(base + '/mcp/' + m.token)}"></label></td>
      <td>${m.owner ? '' : `<button data-id="${m.id}" class="del">remove</button>`}</td></tr>`).join('');
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Planboard members</title>
<style>:root{--bg:#f7f7f4;--fg:#1f2328;--line:#d6d6cf;--dim:#6a6f76}@media(prefers-color-scheme:dark){:root{--bg:#16181c;--fg:#e8e6e1;--line:#33363c;--dim:#9a9ea6;color-scheme:dark}}
body{font:15px system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg);padding-block:24px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
main{max-width:900px;margin:0 auto}table{width:100%;border-collapse:collapse}td,th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}label{display:block;font-size:12px;color:var(--dim)}
input,select,button{font:inherit}td input{width:100%;font:12px ui-monospace,monospace;margin:2px 0 6px}form{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}pre{background:var(--line);padding:10px;border-radius:6px;overflow-x:auto;font-size:12px}.wrap{overflow-x:auto}</style>
<main><h1>Members</h1><p>Add people by GitHub username: they open <b>${esc(base)}/</b> and sign in with GitHub. The CI check also uses it to match pull requests to claims. Each person also has an invite link and an MCP URL for their AI; treat both like passwords. <a href="${base}/">← board</a></p>
<form id="f"><input name="github" placeholder="GitHub username"><input name="name" placeholder="name"><input name="email" placeholder="email (optional)"><select name="role"><option value="interact">collaborator (comment, claim modules)</option><option value="view">view only</option><option value="admin">admin (edit plan, modules, contracts)</option></select><button>Create</button></form>
<div class="wrap"><table><tr><th>name</th><th>role</th><th>GitHub</th><th>links</th><th></th></tr>${rows}</table></div>
<h2>Connecting an AI</h2>
<p>Claude (claude.ai): Settings → Connectors → Add custom connector → paste the MCP URL.</p>
<pre>claude mcp add --transport http planboard &lt;MCP URL&gt;          # Claude Code</pre>
<pre>// Gemini CLI: ~/.gemini/settings.json
{ "mcpServers": { "planboard": { "httpUrl": "&lt;MCP URL&gt;" } } }</pre>
</main><script>const H={'Content-Type':'application/json','X-PB':'1'};
f.onsubmit=async e=>{e.preventDefault();const r=await fetch('${base}/api/members',{method:'POST',headers:H,body:JSON.stringify(Object.fromEntries(new FormData(f)))});if(r.ok)location.reload();else alert((await r.json()).error)};
document.querySelectorAll('.del').forEach(b=>b.onclick=async()=>{if(!confirm('Remove? Their links stop working.'))return;await fetch('${base}/api/members',{method:'DELETE',headers:H,body:JSON.stringify({id:b.dataset.id})});location.reload()});
document.querySelectorAll('td input[readonly]').forEach(i=>i.onclick=()=>i.select());
document.querySelectorAll('input.gh').forEach(i=>i.onchange=async()=>{const r=await fetch('${base}/api/members',{method:'PATCH',headers:H,body:JSON.stringify({id:i.dataset.id,github:i.value})});if(!r.ok)alert((await r.json()).error)});</script>`;
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
const page404 = (msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Planboard</title><style>:root{--bg:#f7f7f4;--fg:#1f2328;--dim:#6a6f76}@media(prefers-color-scheme:dark){:root{--bg:#16181c;--fg:#e8e6e1;--dim:#9a9ea6;color-scheme:dark}}body{font:16px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg);padding-block:40px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}main{max-width:520px;margin:0 auto}a.gh{display:inline-block;margin-top:16px;padding:10px 16px;border-radius:8px;background:var(--fg);color:var(--bg);text-decoration:none;font-weight:600}small{color:var(--dim)}</style><main>${msg}</main>`;
const noAccess = (base, gh) => page404(`<h1 style="font-size:20px">기획판</h1><p>멤버만 들어올 수 있어. ${gh ? 'GitHub 계정이 멤버로 등록돼 있으면 로그인해줘.' : '받은 초대 링크로 다시 열어줘.'}</p>${gh ? `<a class="gh" href="${base}/login">GitHub로 로그인</a>` : ''}<p><small>This board is for members. ${gh ? 'Sign in with GitHub or use your invite link.' : 'Open it with your invite link.'}</small></p>`);
const sessionCookie = (slug, token) => `pb_t=${encodeURIComponent(token)}; Path=/b/${slug}; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
const cookie = (req, n) => { const m = (req.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + n + '=([^;]+)')); return m ? decodeURIComponent(m[1]) : null; };
const json = (code, o) => new Response(JSON.stringify(o), { status: code, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const html = (code, s) => new Response(s, { status: code, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' } });
const js = (s) => new Response(s, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' } });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export { ROLES };
