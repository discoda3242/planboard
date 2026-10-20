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
  const inv = document.createElement('button'); inv.type = 'button'; inv.className = 'hubinv'; inv.textContent = '공유 · 멤버 초대';
  const card = document.createElement('div'); card.className = 'hubcard';
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
    box.hidden = !mods.length && !inv.isConnected && !card.isConnected;
    list.hidden = !open || !mods.length;
  }
  (async () => {
    const db = window.claude && (await window.claude.use('db')); if (!db) return;
    document.body.appendChild(box); box.hidden = true;
    db.collection('modules').onSnapshot((q) => { mods = q.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => !m.id.startsWith('_')).sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id)); draw(); });
    db.collection('claims').onSnapshot((q) => { claims = Object.fromEntries(q.docs.map((d) => [d.id, d.data()])); draw(); });
    setInterval(draw, 30000);
    const me = await api('/api/me').catch(() => null);
    if (me && me.role === 'admin') { box.append(inv); inv.onclick = openInvite; draw(); }
    if (me) setupCard(me);
  })();

  // ---------- first visit: connect this computer (installer clones the repo and connects the member's AI) ----------
  function setupCard(me) {
    const key = 'hubsetup:' + B; let later = false; try { later = localStorage.getItem(key) === 'later'; } catch (e) {}
    const reopen = el('button', { type: 'button', className: 'hubinv', textContent: '내 컴퓨터에 연결', onclick: () => { try { localStorage.removeItem(key); } catch (e) {} reopen.remove(); show(); } });
    if (me.aiConnected) return;
    if (later) { box.append(reopen); draw(); return; }
    show();
    function show() {
      const steps = el('ol', null,
        el('li', { textContent: me.repo ? `코드를 둘 폴더를 정하고, 아래 설치 파일을 그 폴더에 저장해.` : '아래 설치 파일을 아무 폴더에 저장해. (코드 저장소는 관리자가 아직 안 정했어. 정해지면 다시 받으면 돼.)' }),
        el('li', { textContent: 'Windows: 저장한 파일을 더블클릭. Mac·Linux: 터미널에서 sh <파일 경로>' }),
        el('li', { textContent: me.repo ? `${me.repo} 코드를 받고, Claude Code를 이 기획판에 연결해 줘. GitHub 로그인 창이 뜨면 로그인하면 돼.` : 'Claude Code를 이 기획판에 연결해 줘.' }));
      card.replaceChildren(el('b', { textContent: '내 컴퓨터에 연결' }),
        el('p', { textContent: '이 기획판에서 같이 작업하려면 한 번만 설정하면 돼. 네 AI가 작업할 때마다 여기 실시간으로 보고해.' }), steps,
        el('div', { className: 'row' },
          el('a', { className: 'pri', href: B + '/setup.bat', download: '', textContent: 'Windows 설치 파일' }),
          el('a', { href: B + '/setup.sh', download: '', textContent: 'Mac · Linux' }),
          el('button', { type: 'button', textContent: '나중에', onclick: () => { try { localStorage.setItem(key, 'later'); } catch (e) {} card.remove(); box.append(reopen); draw(); } })),
        el('small', { textContent: '설치 파일에는 네 전용 AI 연결 주소가 들어 있어. 다른 사람에게 보내지 마. 다른 AI(Gemini CLI·Codex)는 파일 안의 MCP 주소를 쓰면 돼.' }),
        el('small', { className: 'state', role: 'status', textContent: 'AI 연결 기다리는 중…' }));
      box.prepend(card); draw();
      const t = setInterval(async () => { // the card goes away by itself once this member's AI calls the board
        if (!card.isConnected) return clearInterval(t);
        const m = await api('/api/me').catch(() => null);
        if (m && m.aiConnected) { clearInterval(t); card.querySelector('.state').textContent = '연결됐어!'; setTimeout(() => { card.remove(); draw(); }, 2500); }
      }, 15000);
    }
  }

  // ---------- share + invite (admins): GitHub friends / search → member, like adding a collaborator on GitHub ----------
  const B = window.PB_BASE || '';
  async function api(path, method, body) {
    const r = await fetch(B + path, { method: method || 'GET', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-PB': '1' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j;
  }
  const el = (tag, props, ...kids) => { const e = document.createElement(tag); Object.assign(e, props || {}); e.append(...kids.filter((k) => k != null)); return e; };
  const ROLE_KO = { admin: '기획 편집', interact: '개발·코멘트', view: '보기만' };
  document.head.appendChild(el('style', { textContent: `.hubinv{all:unset;cursor:pointer;display:block;box-sizing:border-box;width:100%;padding:8px 12px;border-top:1px solid var(--line,#ccc);font-weight:600;color:var(--accent,#36c)}
  .hubinv:focus-visible,.hubdlg button:focus-visible,.hubdlg input:focus-visible,.hubdlg select:focus-visible{outline:2px solid var(--accent,#36c);outline-offset:2px}
  .hubdlg{width:min(480px,calc(100vw - 32px));max-height:calc(100dvh - 48px);box-sizing:border-box;padding:0;border:1px solid var(--line,#ccc);border-radius:14px;background:var(--panel,#fff);color:var(--fg,#222);font:14px/1.5 var(--f-body,system-ui,sans-serif)}
  .hubdlg::backdrop{background:rgba(0,0,0,.35)}.hubdlg>div{padding:16px;display:grid;gap:12px}.hubdlg h2{margin:0;font-size:17px}.hubdlg h3{margin:4px 0 0;font-size:13px;color:var(--dim,#777);font-weight:600}
  .hubdlg .row{display:flex;gap:8px;align-items:center}.hubdlg input,.hubdlg select{font:inherit;min-width:0;padding:7px 9px;border:1px solid var(--line,#ccc);border-radius:8px;background:transparent;color:inherit}.hubdlg input{flex:1}
  .hubdlg button{font:inherit;padding:7px 12px;border-radius:8px;border:1px solid var(--line,#ccc);background:transparent;color:inherit;cursor:pointer}.hubdlg button.pri{background:var(--accent,#36c);border-color:var(--accent,#36c);color:#fff}
  .hubdlg ul{list-style:none;margin:0;padding:0;display:grid;gap:4px;max-height:32vh;overflow:auto}.hubdlg li{display:flex;gap:10px;align-items:center;min-height:40px}
  .hubdlg li img{width:32px;height:32px;border-radius:50%;flex:none;background:var(--line,#ccc)}.hubdlg li .nm{flex:1;min-width:0;overflow-wrap:anywhere}.hubdlg small,.hubdlg .dim{color:var(--dim,#777)}
  .hubdlg .x{position:absolute;top:10px;right:10px;border:0;font-size:18px;line-height:1;padding:6px 9px}
  .hubcard{padding:12px;display:grid;gap:8px;border-bottom:1px solid var(--line,#ccc)}.hubcard p,.hubcard ol{margin:0}.hubcard ol{padding-left:20px;display:grid;gap:2px}.hubcard small{color:var(--dim,#777)}
  .hubcard .row{display:flex;gap:8px;flex-wrap:wrap}.hubcard .row>*{font:inherit;padding:7px 12px;border-radius:8px;border:1px solid var(--line,#ccc);background:transparent;color:inherit;cursor:pointer;text-decoration:none}
  .hubcard .row>.pri{background:var(--accent,#36c);border-color:var(--accent,#36c);color:#fff;font-weight:600}.hubcard .row>*:focus-visible{outline:2px solid var(--accent,#36c);outline-offset:2px}` }));
  let dlg;
  function openInvite() {
    if (!dlg) dlg = buildInvite();
    dlg.showModal(); dlg.refresh();
  }
  function buildInvite() {
    const url = location.origin + B + '/';
    const link = el('input', { readOnly: true, value: url, ariaLabel: '기획판 주소' });
    const copy = el('button', { type: 'button', textContent: '복사', onclick: async () => { try { await navigator.clipboard.writeText(url); copy.textContent = '복사됨'; } catch (e) { link.select(); } setTimeout(() => (copy.textContent = '복사'), 1500); } });
    const role = el('select', { ariaLabel: '초대할 권한' }, ...Object.entries({ interact: '개발·코멘트 (모듈 claim)', admin: '기획 편집 (관리자)', view: '보기만' }).map(([v, t]) => el('option', { value: v, textContent: t })));
    const q = el('input', { type: 'search', placeholder: 'GitHub 아이디나 이름 검색', ariaLabel: 'GitHub 사람 검색' });
    const title = el('h3'), msg = el('p', { className: 'dim', role: 'status' }), people = el('ul'), members = el('ul');
    const repo = el('input', { placeholder: 'owner/name', ariaLabel: '코드 저장소 (owner/name)' }), repoMsg = el('small', { role: 'status' });
    const repoSave = el('button', { type: 'button', textContent: '저장', onclick: async () => {
      try { const r = await api('/api/repo', 'POST', { repo: repo.value }); repo.value = r.repo; repoMsg.textContent = !r.repo ? '저장소 없음: 초대해도 GitHub 저장소에는 초대 안 돼.' : r.autoInvite ? '저장됨. 초대하면 이 저장소 콜라보레이터 초대도 같이 가.' : '저장됨. 저장소 자동 초대는 허브에 GITHUB_REPO_TOKEN을 넣으면 켜져.'; }
      catch (e) { repoMsg.textContent = e.message; } } });
    const d = el('dialog', { className: 'hubdlg', ariaLabel: '공유 · 멤버 초대' }, el('div', null,
      el('button', { type: 'button', className: 'x', textContent: '×', ariaLabel: '닫기', onclick: () => d.close() }),
      el('h2', { textContent: '공유 · 멤버 초대' }),
      el('div', null, el('div', { className: 'row' }, link, copy), el('small', { textContent: '초대한 사람은 이 주소를 열고 GitHub로 로그인하면 바로 들어와.' })),
      el('div', null, el('h3', { textContent: '코드 저장소 (초대하면 여기 콜라보레이터로도 초대, 설치 파일이 이걸 받음)' }), el('div', { className: 'row' }, repo, repoSave), repoMsg),
      el('div', { className: 'row' }, q, role), title, msg, people,
      el('h3', { textContent: '멤버' }), members, el('small', null, el('a', { href: B + '/admin', textContent: '링크·MCP URL·내보내기 관리 →' }))));
    document.body.appendChild(d);
    let seq = 0, timer = 0;
    async function loadPeople() {
      const my = ++seq, text = q.value.trim(); msg.textContent = '불러오는 중…';
      try {
        const r = await api('/api/people' + (text ? '?q=' + encodeURIComponent(text) : '')); if (my !== seq) return;
        title.textContent = text ? '검색 결과' : '내 GitHub 친구 (팔로잉 · 팔로워)';
        msg.replaceChildren(r.people.length ? '' : text ? '찾는 사람이 없어.' : r.signedIn ? '팔로잉·팔로워가 없어. 위에서 아이디로 검색해줘.' : 'GitHub로 로그인하면 친구 목록이 보여. ',
          !text && !r.signedIn ? el('a', { href: B + '/login', textContent: 'GitHub로 로그인' }) : null);
        people.replaceChildren(...r.people.map((p) => el('li', null, el('img', { src: p.avatar + (p.avatar.includes('?') ? '&' : '?') + 's=64', alt: '', loading: 'lazy' }),
          el('span', { className: 'nm', textContent: p.login }),
          p.role ? el('span', { className: 'dim', textContent: '멤버 · ' + ROLE_KO[p.role] })
            : el('button', { type: 'button', className: 'pri', textContent: '초대', ariaLabel: p.login + ' 초대', onclick: (e) => invite(p.login, e.target) }))));
      } catch (e) { if (my === seq) { msg.textContent = e.message; people.replaceChildren(); } }
    }
    async function invite(login, btn) {
      btn.disabled = true;
      try {
        const r = await api('/api/members', 'POST', { github: login, role: role.value }), ri = r.repoInvite || {};
        const gh = { sent: ' GitHub 저장소 초대도 보냈어 (메일로 가니까 수락하라고 말해줘).', already: ' 저장소에는 이미 들어와 있어.', owner: '', off: ' (저장소 자동 초대 꺼짐: ' + (ri.why || '') + ')', error: ' 저장소 초대 실패: ' + (ri.why || '') }[ri.state] || '';
        await Promise.all([loadPeople(), loadMembers()]); msg.textContent = `${login} 초대함 (${ROLE_KO[role.value]}). 위 주소를 보내주면 돼.` + gh;
      }
      catch (e) { msg.textContent = e.message; btn.disabled = false; }
    }
    async function loadMembers() {
      try {
        const r = await api('/api/members');
        members.replaceChildren(...r.members.map((m) => el('li', null, el('span', { className: 'nm' }, m.name, m.github ? el('small', { textContent: '  @' + m.github }) : null),
          el('span', { className: 'dim', textContent: (m.owner ? '주인 · ' : '') + ROLE_KO[m.role] }))));
      } catch (e) { members.replaceChildren(el('li', { className: 'dim', textContent: e.message })); }
    }
    q.oninput = () => { clearTimeout(timer); timer = setTimeout(loadPeople, 350); };
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // click on the backdrop
    d.refresh = () => { loadPeople(); loadMembers(); api('/api/me').then((m) => { if (document.activeElement !== repo) repo.value = m.repo || ''; }).catch(() => {}); q.focus(); };
    return d;
  }
})();
