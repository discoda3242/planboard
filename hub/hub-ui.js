// Planboard hub overlay: a live "who is working on which module" strip on the board page.
// Reads the hub's claims + modules collections through the same window.claude db shim the page uses; adds no page code.
(function () {
  const css = `.hubbar{position:fixed;right:max(12px,env(safe-area-inset-right,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:50;max-width:min(420px,calc(100vw - 24px));
  background:var(--panel,#fff);color:var(--fg,#222);border:1px solid var(--line,#ccc);border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.18);font:13px/1.45 var(--f-body,system-ui,sans-serif)}
  .hubbar>button{all:unset;cursor:pointer;display:flex;gap:8px;align-items:center;padding:8px 12px;width:100%;box-sizing:border-box}
  .hubbar>button:focus-visible{outline:2px solid var(--accent,#36c);outline-offset:2px;border-radius:12px}
  .hubbar .dot{width:8px;height:8px;border-radius:50%;background:var(--line,#ccc);flex:none}.hubbar .dot.on{background:var(--accent,#36c);animation:hubp 1.6s ease-in-out infinite}
  @keyframes hubp{50%{opacity:.35}}@media (prefers-reduced-motion:reduce){.hubbar .dot.on{animation:none}}
  .hubbar ul{list-style:none;margin:0;padding:0 12px 10px;display:grid;gap:6px;max-height:40vh;overflow:auto}
  .hubbar li{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;align-items:baseline}.hubbar li b{font-weight:600}
  .hubbar .who{color:var(--dim,#777);grid-column:2;min-width:0;overflow-wrap:anywhere}.hubbar .free{color:var(--dim,#777)}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const box = document.createElement('div'); box.className = 'hubbar'; box.setAttribute('role', 'status');
  const head = document.createElement('button'); head.type = 'button'; head.setAttribute('aria-expanded', 'false');
  const list = document.createElement('ul'); list.hidden = true; box.append(head, list);
  let open = false; try { open = localStorage.getItem('hubbar') === '1'; } catch (e) {}
  head.onclick = () => { open = !open; try { localStorage.setItem('hubbar', open ? '1' : '0'); } catch (e) {} draw(); };
  let mods = [], claims = {};
  const hhmm = (t) => new Date(t).toTimeString().slice(0, 5);
  function draw() {
    const now = Date.now(), live = Object.entries(claims).filter(([, c]) => c.until > now);
    head.replaceChildren(); const d = document.createElement('span'); d.className = 'dot' + (live.length ? ' on' : '');
    const t = document.createElement('span'); t.textContent = live.length ? `작업 중 ${live.length} · 모듈 ${mods.length}` : `작업 중인 모듈 없음 · 모듈 ${mods.length}`;
    head.append(d, t); head.setAttribute('aria-expanded', String(open)); list.hidden = !open;
    list.replaceChildren(...mods.map((m) => {
      const c = claims[m.id] && claims[m.id].until > now ? claims[m.id] : null; const li = document.createElement('li');
      const dot = document.createElement('span'); dot.className = 'dot' + (c ? ' on' : ''); const nm = document.createElement('b'); nm.textContent = m.id;
      const who = document.createElement('span'); who.className = c ? 'who' : 'who free';
      who.textContent = c ? `${c.name}${c.agent ? ' · ' + c.agent : ''} — ${c.note || ''} (${hhmm(c.since)}~)` : '비어 있음';
      const row = document.createElement('span'); row.style.display = 'contents'; row.append(dot, nm); li.append(row, who); return li;
    }));
    box.hidden = !mods.length;
  }
  (async () => {
    const db = window.claude && (await window.claude.use('db')); if (!db) return;
    document.body.appendChild(box); box.hidden = true;
    db.collection('modules').onSnapshot((q) => { mods = q.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => !m.id.startsWith('_')).sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id)); draw(); });
    db.collection('claims').onSnapshot((q) => { claims = Object.fromEntries(q.docs.map((d) => [d.id, d.data()])); draw(); });
    setInterval(draw, 30000);
  })();
})();
