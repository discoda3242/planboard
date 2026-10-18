#!/usr/bin/env node
// Load board data into a hub board.
//   node hub/import.mjs <board link with ?t=…> <source> [<source> …]
// <source> is a JSON file {docs:[{col,id,data}]} (e.g. an export of a claude.ai board, or modules/contracts seed)
// or a local board folder (planboard/ written by local/server.mjs). Existing documents with the same id are replaced.
import fs from 'node:fs';
import path from 'node:path';

const [link, ...srcs] = process.argv.slice(2);
if (!link || !srcs.length) { console.error('usage: node hub/import.mjs https://<hub>/b/<board>/join?t=<token> <file.json|planboard-folder> …'); process.exit(1); }
const u = new URL(link), token = u.searchParams.get('t'), base = u.origin + u.pathname.replace(/\/join$/, '');

function readMd(t) {
  const m = t.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/); const d = {}; if (!m) return { md: t };
  for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i < 0) continue; const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim(); try { d[k] = JSON.parse(v); } catch { d[k] = v; } }
  d.md = m[2].replace(/\n$/, ''); return d;
}
function fromFolder(dir) {
  const docs = [];
  for (const col of fs.readdirSync(dir)) {
    const p = path.join(dir, col); if (col.startsWith('.') || !fs.statSync(p).isDirectory()) continue;
    for (const f of fs.readdirSync(p)) { const m = f.match(/^(.+)\.(json|md)$/); if (!m) continue; const t = fs.readFileSync(path.join(p, f), 'utf8'); docs.push({ col, id: m[1], data: m[2] === 'md' ? readMd(t) : JSON.parse(t) }); }
  }
  return docs;
}

// the join link sets the session cookie; reuse it for the API calls
const j = await fetch(link, { redirect: 'manual' }); const ck = (j.headers.get('set-cookie') || '').match(/pb_t=[^;]+/);
if (!ck) { console.error('The link was refused (' + j.status + '). Use your owner/admin link.'); process.exit(1); }
for (const s of srcs) {
  const docs = fs.statSync(s).isDirectory() ? fromFolder(s) : JSON.parse(fs.readFileSync(s, 'utf8')).docs;
  for (let i = 0; i < docs.length; i += 50) {
    const r = await fetch(base + '/api/import', { method: 'POST', headers: { Cookie: ck[0], 'X-PB': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ docs: docs.slice(i, i + 50) }) });
    if (!r.ok) { console.error(s, 'failed:', r.status, await r.text()); process.exit(1); }
  }
  console.log(`${s}: ${docs.length} documents`);
}
