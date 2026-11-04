// Project-scoped custom pages. Code runs in an opaque-origin sandbox; only its own state crosses the bridge.
window.PB_CUSTOM = (() => {
  const $ = id => document.getElementById(id);
  let db, me, navigate, tabs = [], current = '', selected = '', base = '', loaded = false;
  let liveFrame = null, previewFrame = null, mount = 0;
  const admin = () => me?.role === 'admin';
  const key = () => 'pb-custom-draft:' + (window.PB_BASE || '') + ':' + (selected || 'new');
  const status = text => { $('customStatus').textContent = text; };
  const el = (tag, text, action) => { const n = document.createElement(tag); n.textContent = text; if (action) n.onclick = action; return n; };
  const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
  const style = '<style>body{font:16px/1.6 system-ui;background:#f6f4fb;color:#27213d;padding:24px;max-width:800px;margin:auto}input,textarea,button{font:inherit;padding:8px;border:1px solid #d6d0e3;border-radius:8px}textarea{display:block;width:95%;min-height:120px}label{display:block;margin:12px 0}button{cursor:pointer;background:#e8e0f5}section{background:white;padding:20px;border-radius:12px;margin:12px 0}</style>';
  const templates = {
    notes: style + '<h1>프로젝트 노트</h1><section><label>아이디어<textarea data-key="ideas"></textarea></label><label>다음에 할 일<textarea data-key="next"></textarea></label></section>',
    checklist: style + '<h1>체크리스트</h1><section><label><input type="checkbox" data-key="first"> 첫 번째 목표</label><label><input type="checkbox" data-key="second"> 두 번째 목표</label><label>메모<textarea data-key="memo"></textarea></label></section>',
    character: style + '<h1>캐릭터 설정</h1><section><label>이름 <input data-key="name"></label><label>역할 <input data-key="role"></label><label>배경·성격<textarea data-key="background"></textarea></label></section>',
    blank: style + '<h1>새 탭</h1><p>HTML과 CSS로 화면을 만들고, script로 동작을 추가하세요.</p><label>메모<textarea data-key="memo"></textarea></label>\n<!-- data-key를 붙인 입력란은 자동 저장됩니다. JS에서는 await pb.save({...pb.state, count: 1})을 사용하세요. -->'
  };
  function draft(){ try { localStorage.setItem(key(), JSON.stringify({ title:$('customTitle').value, html:$('customCode').value })); } catch {} status('초안 · 저장 후 탭에 반영돼요'); }
  function dirty(){ return JSON.stringify({ title:$('customTitle').value, html:$('customCode').value }) !== base; }
  function choose(id = '') {
    selected = id; const tab = tabs.find(t => t.id === id);
    $('customTitle').value = tab?.title || '새 탭'; $('customCode').value = tab?.html || templates.notes;
    base = JSON.stringify({ title:$('customTitle').value, html:$('customCode').value });
    try { const d = JSON.parse(localStorage.getItem(key())); if (d) { $('customTitle').value = d.title; $('customCode').value = d.html; } } catch {}
    $('customDelete').disabled = !tab; status(dirty() ? '복구한 초안 · 저장 후 반영돼요' : '저장된 코드');
    $('customPreview').replaceChildren(); previewFrame = null;
  }
  function frame(host, tab, state, preview) {
    const iframe = document.createElement('iframe'); iframe.title = (preview ? '미리보기 · ' : '') + tab.title;
    iframe.setAttribute('sandbox', 'allow-scripts'); iframe.setAttribute('referrerpolicy', 'no-referrer');
    const token = crypto.randomUUID(); const record = { iframe, token, id:tab.id, preview, queue:Promise.resolve() };
    // Inject the bridge before user code, including before an existing <head>.
    const bridge = `(() => {const token=${json(token)}, pending=new Map();let seq=0;window.pb={state:${json(state)},readOnly:${json(me?.role === 'view' && !preview)},preview:${json(!!preview)},save(value){if(pb.readOnly)return Promise.reject(Error('읽기 전용입니다'));if(pb.preview){pb.state={...value};return Promise.resolve(pb.state);}return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});parent.postMessage({type:'pb-custom-save',token,id,value},'*');setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(Error('저장 응답이 없습니다'));}},15000);});}};window.addEventListener('message',e=>{if(e.source!==parent||e.data?.token!==token)return;const p=pending.get(e.data.id);if(!p)return;pending.delete(e.data.id);if(e.data.error)p.reject(Error(e.data.error));else{pb.state=e.data.value;p.resolve(pb.state);}});document.addEventListener('DOMContentLoaded',()=>{const fields=[...document.querySelectorAll('[data-key]')];for(const n of fields){if(Object.hasOwn(pb.state,n.dataset.key)){if(n.type==='checkbox')n.checked=!!pb.state[n.dataset.key];else n.value=pb.state[n.dataset.key];}if(pb.readOnly)n.disabled=true;}let timer;document.addEventListener('input',e=>{if(!e.target.matches('[data-key]')||pb.readOnly)return;clearTimeout(timer);timer=setTimeout(()=>{const value={...pb.state};for(const n of fields)value[n.dataset.key]=n.type==='checkbox'?n.checked:n.value;pb.save(value).then(()=>document.getElementById('pb-save-status').textContent=pb.preview?'미리보기 · 저장 안 됨':'저장됨').catch(e=>document.getElementById('pb-save-status').textContent='저장 실패: '+e.message);},350);document.getElementById('pb-save-status').textContent='저장 중…';});const s=document.createElement('p');s.id='pb-save-status';s.style='font:12px system-ui;color:#666';s.textContent=pb.preview?'미리보기 · 입력은 저장되지 않아요':pb.readOnly?'읽기 전용':'입력 내용은 이 프로젝트의 탭에 자동 저장돼요';document.body.append(s);});})();`;
    iframe.srcdoc = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: https:; font-src data:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'"><script>' + bridge + '</scr' + 'ipt>' + tab.html;
    host.replaceChildren(iframe); return record;
  }
  async function open(id) {
    current = id; const generation = ++mount; liveFrame = null; $('customPage').textContent = '불러오는 중…';
    const tab = tabs.find(t => t.id === id); if (!tab) { $('customPage').textContent = '탭이 없어요.'; return; }
    $('customPageTitle').textContent = tab.title; $('customEdit').hidden = !admin();
    try { const snap = await db.doc('customdata/' + id).get(); if (generation !== mount) return;
      liveFrame = frame($('customPage'), tab, snap.exists ? snap.data().value || {} : {}, false);
    } catch(e) { if (generation === mount) $('customPage').textContent = '불러오기 실패: ' + e.message; }
  }
  function render() {
    $('customNav').replaceChildren(...tabs.map(t => { const b = el('button', t.title); b.dataset.v = 'c:' + t.id; b.classList.toggle('on', current === t.id); return b; }));
    $('customList').replaceChildren(...tabs.map(t => el('button', t.title, () => { choose(t.id); })));
    $('customList').querySelectorAll('button').forEach(b => b.className = 'btn ghost sm');
  }
  window.addEventListener('message', e => {
    const r = [liveFrame, previewFrame].find(r => r && e.source === r.iframe.contentWindow && e.data?.token === r.token);
    if (!r || e.data.type !== 'pb-custom-save') return;
    const request = e.data;
    r.queue = r.queue.then(async () => {
      try {
        if (r.preview || me.role === 'view' || !tabs.some(t => t.id === r.id)) throw Error('저장 권한이 없어요');
        const value = request.value; if (!value || Array.isArray(value) || typeof value !== 'object' || JSON.stringify(value).length > 100000) throw Error('저장할 데이터는 100KB 이하 객체여야 해요');
        await db.doc('customdata/' + r.id).set({ value });
        r.iframe.contentWindow.postMessage({ token:r.token, id:request.id, value }, '*');
      } catch(e) { r.iframe.contentWindow.postMessage({ token:r.token, id:request.id, error:e.message }, '*'); }
    });
  });
  return {
    open,
    async init(database, member, go) {
      db = database; me = member; navigate = go;
      $('customToolsAdmin').hidden = !admin(); $('customToolsHelp').hidden = admin();
      $('customEdit').onclick = () => { choose(current); navigate('tools'); };
      $('customNew').onclick = () => choose();
      $('customTemplate').onchange = e => { if (confirm('편집 중인 코드를 선택한 예제로 바꿀까요?')) { $('customCode').value = templates[e.target.value]; draft(); } e.target.value = ''; };
      $('customCode').oninput = draft; $('customTitle').oninput = draft;
      $('customCode').onkeydown = e => { if(e.key === 'Tab'){e.preventDefault();const n=e.target;n.setRangeText('  ',n.selectionStart,n.selectionEnd,'end');draft();} };
      $('customRun').onclick = () => { previewFrame = frame($('customPreview'), { title:$('customTitle').value, html:$('customCode').value }, {}, true); };
      $('customSave').onclick = async () => {
        const title = $('customTitle').value.trim(), html = $('customCode').value;
        if (!title || title.length > 40 || html.length > 150000) { status('탭 이름은 1~40자, 코드는 150KB 이하로 적어줘요'); return; }
        $('customSave').disabled = true;
        try {
          if (selected) { const s = await db.doc('customtabs/' + selected).get(); if (!s.exists || JSON.stringify({title:s.data().title,html:s.data().html}) !== base) throw Error('다른 곳에서 탭을 바꿨어요. 목록에서 다시 열어 확인해줘요. 초안은 보관돼요'); }
          const id = selected || crypto.randomUUID(); await db.doc('customtabs/' + id).set({ title, html, order:tabs.find(t => t.id === id)?.order ?? Date.now() });
          try { localStorage.removeItem(key()); } catch {} selected = id; base = JSON.stringify({title,html}); status('저장됐어요 · 위쪽 탭에서 열 수 있어요'); $('customDelete').disabled = false;
        } catch(e) { status('저장 실패: ' + e.message); } finally { $('customSave').disabled = false; }
      };
      $('customDelete').onclick = async () => {
        if (!selected || !confirm('이 탭과 입력 내용을 삭제할까요?')) return;
        try { await db.doc('customtabs/' + selected).delete(); try { localStorage.removeItem(key()); } catch {} choose(); status('삭제됐어요'); } catch(e) { status('삭제 실패: ' + e.message); }
      };
      choose();
      db.collection('customtabs').onSnapshot(q => {
        const old = tabs.find(t => t.id === current); tabs = q.docs.map(d => ({...d.data(), id:d.id})).sort((a,b)=>(a.order||0)-(b.order||0)); render();
        if (current && !tabs.some(t => t.id === current) && loaded) { current = ''; navigate('tools'); }
        else if (current && (!liveFrame || old?.html !== tabs.find(t => t.id === current)?.html)) open(current);
        if (!loaded) { loaded = true; let want; try { want = new URLSearchParams(location.search).get('tab') || localStorage.getItem('pb-hub-tab:' + (window.PB_BASE || '')); } catch {} if (want?.startsWith('c:') && tabs.some(t => 'c:' + t.id === want)) navigate(want); else if (!$('v-custom').hidden && !current) navigate('now'); }
      }, e => status('탭을 불러오지 못했어요: ' + e.message));
    }
  };
})();
