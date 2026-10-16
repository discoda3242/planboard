// 코드 구조 지도: GitHub 저장소를 읽어 파일·함수·파일 간 참조·@plan 연결을 그래프로 보여준다.
// 필요: PROJECTS.<key>.repo ("owner/name"), 시크릿 GITHUB_TOKEN (해당 저장소 Contents 읽기 권한)

const CODE_EXT = /\.(m?js|cjs|jsx|tsx?|py|html?|css|json|md|sh|go|rs|java|kt|cs|lua|gd)$/i;
const MAX_FILES = 150, MAX_BYTES = 400000, CACHE_SEC = 300;
const STOP = new Set("init update render draw main start setup reset test step load save show hide open close next prev tick loop run make get set add remove toggle create build parse handle value data item list node text name type count index start stop clear apply call".split(" "));

async function gh(env, path, opts = {}) {
  const r = await fetch("https://api.github.com" + path, {
    ...opts,
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, "User-Agent": "start-button-map", Accept: "application/vnd.github+json", ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`GitHub ${r.status} ${path}`);
  return r.json();
}

export async function buildMap(env, repo) {
  const [owner, name] = repo.split("/");
  const info = await gh(env, `/repos/${repo}`);
  const branch = info.default_branch;
  const tree = await gh(env, `/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  const sha = tree.sha;

  const cache = caches.default;
  const ckey = new Request(`https://cache.start-button/map/${repo}/${sha}`);
  const hit = await cache.match(ckey);
  if (hit) return hit.json();

  const files = tree.tree
    .filter((t) => t.type === "blob" && CODE_EXT.test(t.path) && t.size <= MAX_BYTES)
    .slice(0, MAX_FILES);

  // GraphQL 한 번에 여러 파일 내용 가져오기 (서브요청 수 절약)
  const texts = {};
  for (let i = 0; i < files.length; i += 50) {
    const chunk = files.slice(i, i + 50);
    const q = `query($o:String!,$n:String!){repository(owner:$o,name:$n){${chunk
      .map((f, j) => `f${j}:object(expression:${JSON.stringify(branch + ":" + f.path)}){... on Blob{text isBinary}}`)
      .join(" ")}}}`;
    const r = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, "User-Agent": "start-button-map", "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, variables: { o: owner, n: name } }),
    });
    const j = await r.json();
    if (j.errors && !j.data) throw new Error("GitHub GraphQL: " + j.errors[0].message);
    chunk.forEach((f, k) => {
      const b = j.data.repository["f" + k];
      if (b && !b.isBinary && typeof b.text === "string") texts[f.path] = b.text;
    });
  }

  const result = analyze(texts, files);
  result.repo = repo; result.branch = branch; result.sha = sha; result.at = Date.now();
  await cache.put(ckey, new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CACHE_SEC * 12}` } }));
  return result;
}

export function analyze(texts, files) {
  const paths = Object.keys(texts);
  const base = (p) => p.split("/").pop();
  const dir = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const baseCount = {};
  paths.forEach((p) => (baseCount[base(p)] = (baseCount[base(p)] || 0) + 1));

  const nodes = paths.map((p) => {
    const t = texts[p];
    const syms = [];
    const seen = new Set();
    const push = (s, kind) => { if (s && !seen.has(s) && syms.length < 60) { seen.add(s); syms.push({ s, kind }); } };
    if (/\.py$/i.test(p)) {
      for (const m of t.matchAll(/^[ \t]*(def|class)\s+([A-Za-z_]\w*)/gm)) push(m[2], m[1] === "class" ? "class" : "fn");
    } else if (/\.(m?js|cjs|jsx|tsx?|html?)$/i.test(p)) {
      for (const m of t.matchAll(/^[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) push(m[1], "fn");
      for (const m of t.matchAll(/^[ \t]*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gm)) push(m[1], "class");
      for (const m of t.matchAll(/^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>|\{|\(function)/gm)) push(m[1], "var");
    } else if (/\.md$/i.test(p)) {
      for (const m of t.matchAll(/^#{1,3}\s+(.+)$/gm)) push(m[1].trim().slice(0, 40), "heading");
    }
    const plan = new Set();
    for (const m of t.matchAll(/@plan\s+([a-z]\d+(?:\s*[, ]\s*[a-z]\d+)*)/gi)) m[1].split(/[\s,]+/).forEach((x) => x && plan.add(x.toLowerCase()));
    return { id: p, dir: dir(p), top: p.includes("/") ? p.split("/")[0] : "(루트)", lines: t.split("\n").length, syms, plan: [...plan] };
  });

  const edges = [];
  const add = (a, b, kind, label) => { if (a !== b) edges.push({ source: a, target: b, kind, label }); };

  // 1) 파일 이름·경로 언급 (import, require, 빌드 스크립트, 문서 링크 등)
  for (const p of paths) {
    const t = texts[p];
    for (const q of paths) {
      if (p === q) continue;
      const b = base(q);
      const esc = b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      let hit = false;
      if (baseCount[b] === 1) hit = new RegExp(`(^|[^\\w.-])${esc}(?![\\w-])`).test(t);
      else {
        const tail = q.split("/").slice(-2).join("/");
        hit = q.includes("/") && t.includes(tail);
        if (!hit && dir(p) === dir(q)) hit = new RegExp(`['"\`](\\./)?${esc}['"\`]`).test(t);
      }
      if (hit) add(p, q, "ref");
    }
  }
  // 2) 다른 파일에 정의된 함수·클래스 사용 (번들 없이 이어붙이는 구조 대응)
  const defs = {};
  nodes.forEach((n) => n.syms.forEach(({ s, kind }) => { if (kind !== "heading" && s.length >= 5 && !STOP.has(s.toLowerCase())) (defs[s] = defs[s] || []).push(n.id); }));
  const uniq = Object.entries(defs).filter(([, f]) => f.length === 1);
  const codeFile = (p) => /\.(m?js|cjs|jsx|tsx?|py|html?)$/i.test(p);
  const lang = (p) => (/\.py$/i.test(p) ? "py" : "js");
  for (const p of paths) {
    if (!codeFile(p)) continue;
    const used = {};
    for (const [s, [owner]] of uniq) {
      if (owner === p || !codeFile(owner) || lang(owner) !== lang(p)) continue;
      if (new RegExp(`(^|[^\\w$.])${s.replace(/\$/g, "\\$")}\\s*[.(]`).test(texts[p])) (used[owner] = used[owner] || []).push(s);
    }
    for (const [owner, list] of Object.entries(used)) add(p, owner, "uses", list.slice(0, 8).join(", ") + (list.length > 8 ? " …" : ""));
  }
  // 같은 방향 중복 제거 (ref가 있으면 uses 라벨만 합침)
  const merged = {};
  for (const e of edges) {
    const k = e.source + "→" + e.target;
    if (!merged[k]) merged[k] = { ...e };
    else if (e.kind === "uses") merged[k].label = e.label;
  }
  return { nodes, edges: Object.values(merged), skipped: files.length - paths.length };
}

export function mapPage(proj, key, runKey) {
  const q = `?p=${encodeURIComponent(key)}&k=${encodeURIComponent(runKey)}&format=json`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="same-origin">
<title>${esc(proj.name)} 코드 구조</title>
<style>
:root{--bg:#f6f4fb;--panel:#fff;--fg:#1d1a2e;--dim:#615c7a;--line:#dcd7ea;--accent:#d6336c;--chip:#efeaf8;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#120f1f;--panel:#1b1730;--fg:#ece8f8;--dim:#a49ec0;--line:#2e2949;--accent:#ff5c8a;--chip:#251f40;color-scheme:dark}}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif;display:flex;flex-direction:column}
header{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line)}
h1{font-size:18px;margin:0}.dim{color:var(--dim);font-size:12px}
header a{color:var(--accent)}
.filters{display:flex;flex-wrap:wrap;gap:6px;margin-left:auto}
.filters label{display:flex;gap:4px;align-items:center;font-size:12px;padding:3px 8px;border:1px solid var(--line);border-radius:999px;cursor:pointer;background:var(--panel)}
.filters i{width:9px;height:9px;border-radius:50%;display:inline-block}
main{flex:1;display:grid;grid-template-columns:240px minmax(0,1fr) 300px;min-height:0}
@media (max-width:900px){html,body{height:auto}main{grid-template-columns:minmax(0,1fr);grid-template-rows:auto 65vh auto}#tree{max-height:32vh;border-right:0;border-bottom:1px solid var(--line)}#side{border-left:0;border-top:1px solid var(--line)}}
#tree,#side{overflow:auto;padding:10px 12px;background:var(--panel)}
#tree{border-right:1px solid var(--line)}#side{border-left:1px solid var(--line)}
#tree details{margin-left:8px}#tree summary{cursor:pointer;color:var(--dim);font-size:12px;padding:2px 0}
#tree button{display:block;width:100%;text-align:left;font:inherit;font-size:13px;border:0;background:none;color:var(--fg);padding:2px 6px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#tree button:hover,#tree button.on{background:var(--chip)}
#tree small{color:var(--dim)}
#graph{position:relative;min-height:0}svg{width:100%;height:100%;display:block}
.edge{fill:none;stroke-opacity:.55}.edge.ref{stroke:var(--dim)}.edge.uses{stroke:var(--dim);stroke-dasharray:4 3}.edge.plan{stroke:var(--accent);stroke-dasharray:2 3}
.edge.hl{stroke:var(--accent);stroke-opacity:1;stroke-width:2}
.node text{font-size:11px;fill:var(--fg);paint-order:stroke;stroke:var(--bg);stroke-width:3px;pointer-events:none}
.node circle{stroke:var(--bg);stroke-width:1.5px;cursor:pointer}.node.dim{opacity:.18}.node.sel circle{stroke:var(--accent);stroke-width:3px}
.node.plan rect{fill:var(--accent);cursor:pointer}.node.plan text{fill:#fff;stroke:none;font-weight:700}
#side h2{font-size:15px;margin:4px 0 2px;word-break:break-all}#side h3{font-size:12px;color:var(--dim);margin:12px 0 4px}
#side ul{margin:0;padding-left:16px}#side li{font-size:13px}#side a{color:var(--accent)}
.chip{display:inline-block;font-size:11px;padding:1px 7px;border-radius:999px;background:var(--chip);margin:2px 2px 0 0}
.chip.plan{background:var(--accent);color:#fff;text-decoration:none}
#msg{position:absolute;inset:0;display:grid;place-items:center;color:var(--dim);text-align:center;padding:16px}
</style></head><body>
<header><h1>${esc(proj.name)} · 코드 구조</h1><span class="dim" id="meta">불러오는 중…</span>
<a href="${esc(proj.board)}">기획판 ↗</a><div class="filters" id="filters"></div></header>
<main><nav id="tree" aria-label="파일 트리"></nav><div id="graph"><svg id="svg"></svg><div id="msg">저장소를 읽는 중…</div></div>
<aside id="side"><p class="dim">파일이나 기획 노드를 누르면 자세히 보여.<br>실선: 파일 이름 언급(import·빌드·문서) · 점선: 다른 파일 함수 사용 · 분홍: <code>@plan</code> 주석으로 연결된 기획 항목</p></aside></main>
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<script>
const BOARD=${JSON.stringify(proj.board)};
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
fetch(${JSON.stringify(q)}).then(r=>r.json()).then(d=>{if(d.error)throw new Error(d.error);draw(d)}).catch(e=>{$('msg').textContent='불러오지 못했어: '+e.message});
function draw(d){
  $('msg').remove();
  $('meta').textContent=d.repo+' · '+d.branch+' · '+d.sha.slice(0,7)+' · 파일 '+d.nodes.length+'개';
  const tops=[...new Set(d.nodes.map(n=>n.top))];
  const color=d3.scaleOrdinal(tops,d3.schemeTableau10);
  const off=new Set(tops.filter(t=>/^(tests?|docs?|dist|vendor|node_modules)$/i.test(t)));
  // 필터
  const F=$('filters');tops.forEach(t=>{const l=document.createElement('label');l.innerHTML='<input type="checkbox" '+(off.has(t)?'':'checked')+'><i style="background:'+color(t)+'"></i>'+esc(t);
    l.querySelector('input').onchange=e=>{e.target.checked?off.delete(t):off.add(t);update();};F.append(l);});
  // 트리
  const byPath={};d.nodes.forEach(n=>byPath[n.id]=n);
  const root={};d.nodes.forEach(n=>{let c=root;const parts=n.id.split('/');parts.slice(0,-1).forEach(p=>c=(c[p]=c[p]||{}));(c.__f=c.__f||[]).push(n);});
  function mk(obj,el){Object.keys(obj).filter(k=>k!=='__f').sort().forEach(k=>{const det=document.createElement('details');det.open=true;det.innerHTML='<summary>'+esc(k)+'/</summary>';mk(obj[k],det);el.append(det);});
    (obj.__f||[]).sort((a,b)=>a.id.localeCompare(b.id)).forEach(n=>{const b=document.createElement('button');b.dataset.id=n.id;b.innerHTML=esc(n.id.split('/').pop())+' <small>'+n.lines+'</small>';b.onclick=()=>select(n.id);el.append(b);});}
  mk(root,$('tree'));
  // 그래프 데이터 (+ 기획 노드)
  const planIds=[...new Set(d.nodes.flatMap(n=>n.plan))];
  const all=d.nodes.map(n=>({...n,kind:'file'})).concat(planIds.map(id=>({id:'@'+id,kind:'plan',plan:[id]})));
  const links=d.edges.map(e=>({...e})).concat(d.nodes.flatMap(n=>n.plan.map(p=>({source:n.id,target:'@'+p,kind:'plan'}))));
  const svg=d3.select('#svg');const g=svg.append('g');
  const zoom=d3.zoom().scaleExtent([.2,4]).on('zoom',e=>g.attr('transform',e.transform));svg.call(zoom);let fitted=false;
  svg.append('defs').append('marker').attr('id','arr').attr('viewBox','0 -4 8 8').attr('refX',8).attr('markerWidth',6).attr('markerHeight',6).attr('orient','auto').append('path').attr('d','M0,-4L8,0L0,4').attr('fill','currentColor');
  const R=n=>n.kind==='plan'?10:4+Math.sqrt(n.lines||1)*.6;
  let link=g.append('g').selectAll('path'),node=g.append('g').selectAll('g');
  const sim=d3.forceSimulation().force('link',d3.forceLink().id(n=>n.id).distance(l=>l.kind==='plan'?60:90).strength(.4))
    .force('charge',d3.forceManyBody().strength(-260)).force('collide',d3.forceCollide(n=>R(n)+14))
    .force('x',d3.forceX().strength(.04)).force('y',d3.forceY().strength(.06)).on('tick',tick).on('end',fit);
  function visible(n){return n.kind==='plan'?true:!off.has(n.top);}
  function update(){
    const N=all.filter(visible),ids=new Set(N.map(n=>n.id));
    const L=links.filter(l=>ids.has(l.source.id||l.source)&&ids.has(l.target.id||l.target));
    const usedPlan=new Set(L.filter(l=>l.kind==='plan').map(l=>l.target.id||l.target));
    const N2=N.filter(n=>n.kind!=='plan'||usedPlan.has(n.id));
    link=link.data(L,l=>(l.source.id||l.source)+'>'+(l.target.id||l.target)+l.kind).join('path').attr('class',l=>'edge '+l.kind).attr('marker-end',l=>l.kind==='plan'?null:'url(#arr)').style('color','var(--dim)');
    node=node.data(N2,n=>n.id).join(en=>{const s=en.append('g').attr('class',n=>'node '+n.kind).on('click',(e,n)=>select(n.id)).call(d3.drag().on('start',(e,n)=>{if(!e.active)sim.alphaTarget(.3).restart();n.fx=n.x;n.fy=n.y}).on('drag',(e,n)=>{n.fx=e.x;n.fy=e.y}).on('end',(e,n)=>{if(!e.active)sim.alphaTarget(0);n.fx=n.fy=null}));
      s.filter(n=>n.kind==='file').append('circle').attr('r',R).attr('fill',n=>color(n.top));
      s.filter(n=>n.kind==='plan').append('rect').attr('x',-16).attr('y',-10).attr('width',32).attr('height',20).attr('rx',10);
      s.append('text').attr('dy',n=>n.kind==='plan'?4:-R(n)-4).attr('text-anchor','middle').text(n=>n.kind==='plan'?n.id.slice(1):n.id.split('/').pop());return s;});
    sim.nodes(N2);sim.force('link').links(L);fitted=false;sim.alpha(.9).restart();
  }
  function tick(){
    link.attr('d',l=>{const s=l.source,t=l.target,dx=t.x-s.x,dy=t.y-s.y,dist=Math.hypot(dx,dy)||1,r=R(t)+3;return 'M'+s.x+','+s.y+'L'+(t.x-dx/dist*r)+','+(t.y-dy/dist*r);});
    node.attr('transform',n=>'translate('+n.x+','+n.y+')');
  }
  function fit(){if(fitted)return;fitted=true;const b=g.node().getBBox(),box=$('graph').getBoundingClientRect();if(!b.width)return;
    const k=Math.min(1.6,.85*Math.min(box.width/b.width,box.height/b.height));
    svg.transition().duration(500).call(zoom.transform,d3.zoomIdentity.scale(k).translate(-(b.x+b.width/2),-(b.y+b.height/2)));}
  function resize(){const b=$('graph').getBoundingClientRect();svg.attr('viewBox',[-b.width/2,-b.height/2,b.width,b.height]);}
  addEventListener('resize',resize);resize();update();
  function select(id){
    const n=all.find(x=>x.id===id);if(!n)return;
    document.querySelectorAll('#tree button').forEach(b=>b.classList.toggle('on',b.dataset.id===id));
    const near=new Set([id]);links.forEach(l=>{const s=l.source.id||l.source,t=l.target.id||l.target;if(s===id)near.add(t);if(t===id)near.add(s);});
    node.classed('dim',x=>!near.has(x.id)).classed('sel',x=>x.id===id);
    link.classed('hl',l=>(l.source.id||l.source)===id||(l.target.id||l.target)===id);
    const out=links.filter(l=>(l.source.id||l.source)===id),inn=links.filter(l=>(l.target.id||l.target)===id);
    const li=(arr,end)=>arr.length?'<ul>'+arr.map(l=>{const o=(end?l.target:l.source);const oid=o.id||o;return '<li><a href="#" data-go="'+esc(oid)+'">'+esc(oid)+'</a>'+(l.kind==='uses'&&l.label?' <span class="dim">('+esc(l.label)+')</span>':l.kind==='plan'?' <span class="dim">(@plan)</span>':'')+'</li>';}).join('')+'</ul>':'<p class="dim">없음</p>';
    let h;
    if(n.kind==='plan'){const pid=n.id.slice(1);h='<h2>기획 '+esc(pid)+'</h2><p><a class="chip plan" href="'+esc(BOARD)+'#'+esc(pid)+'" target="_blank" rel="noopener">기획판에서 보기 ↗</a></p><h3>이 기획에 연결된 파일</h3>'+li(inn,false);}
    else{h='<h2>'+esc(n.id)+'</h2><p class="dim">'+n.lines+'줄 · <a href="https://github.com/'+esc(window.__repo)+'/blob/'+esc(window.__branch)+'/'+n.id.split('/').map(encodeURIComponent).join('/')+'" target="_blank" rel="noopener">GitHub ↗</a></p>'
      +(n.plan.length?'<h3>연결된 기획</h3>'+n.plan.map(p=>'<a class="chip plan" href="'+esc(BOARD)+'#'+esc(p)+'" target="_blank" rel="noopener">'+esc(p)+'</a>').join(''):'')
      +'<h3>이 파일이 참조</h3>'+li(out.filter(l=>l.kind!=='plan'),true)+'<h3>이 파일을 참조</h3>'+li(inn,false)
      +'<h3>함수·클래스·제목 '+n.syms.length+'</h3>'+(n.syms.length?n.syms.map(s=>'<span class="chip">'+esc(s.s)+'</span>').join(''):'<p class="dim">없음</p>');}
    $('side').innerHTML=h;
    $('side').querySelectorAll('[data-go]').forEach(a=>a.onclick=e=>{e.preventDefault();select(a.dataset.go);});
  }
  window.__repo=d.repo;window.__branch=d.branch;
  svg.on('click',e=>{if(e.target.tagName==='svg'){node.classed('dim',false).classed('sel',false);link.classed('hl',false);}});
}
</script></body></html>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
