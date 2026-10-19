// node hub/test.mjs — runs the hub (core + Worker routes) in Node against an in-memory store.
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
execSync('node ' + new URL('./build.mjs', import.meta.url).pathname);
const { Hub, mcpHandle, globRe, LEASE_MIN } = await import('./core.js');
const { default: worker, Board } = await import('./worker.js');

function memStore() {
  const m = new Map();
  return { m, get: async (k) => structuredClone(m.get(k)), put: async (k, v) => void m.set(k, structuredClone(v)), delete: async (k) => void m.delete(k),
    list: async (o) => { const p = typeof o === 'string' ? o : (o && o.prefix) || ''; return new Map([...m].filter(([k]) => k.startsWith(p)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, structuredClone(v)])); } };
}
let T = Date.parse('2026-10-19T01:00:00Z');
const hub = new Hub(memStore(), { now: () => T });
const a = await hub.member((await hub.addMember({ name: '지은', role: 'admin', owner: true })).id);
const b = await hub.member((await hub.addMember({ name: '유삭', role: 'interact' })).id);
const v = await hub.member((await hub.addMember({ name: '구경꾼', role: 'view' })).id);

// globs
assert.ok(globRe('src/**').test('src/a/b.js')); assert.ok(globRe('src/room.js').test('src/room.js')); assert.ok(!globRe('src/*.js').test('src/a/b.js'));
assert.ok(globRe('**/*.md').test('README.md') && globRe('**/*.md').test('docs/x/y.md'));

// modules + contracts
await hub.put('modules', 'room', { files: ['src/room.js'], provides: ['furniture-build', 'room-save'], requires: ['prize-spec', 'game-globals'], order: 5 });
await hub.put('modules', 'arcade', { files: ['src/index.src.html'], provides: ['game-globals'], requires: ['prize-spec'], order: 1 });
await hub.put('modules', '_free', { files: ['dist/**', 'README.md'] });
await hub.put('contracts', 'furniture-build', { md: 'FURN entry: {n, ic, w, d, top?, L, b(g)} — cm, front +z', owner: 'room', v: 1 });
await hub.put('contracts', 'prize-spec', { md: 'PRIZES[i] = {id, name, ko, dims, ...}', owner: 'arcade', v: 1 });

const call = (me, n, x) => hub.call(me, n, x);
let r = await call(b, 'claim', { module: 'room', task: 'p1', note: '부품 시스템', agent: 'Gemini' });
assert.match(r, /잡았어: room/); assert.match(r, /furniture-build v1/); assert.match(r, /prize-spec/); assert.match(r, /src\/room\.js/);
const claimId = r.match(/claim (\w+)/)[1];
r = await call(a, 'claim', { module: 'room', note: '가구 추가' });
assert.equal(r.error, true); assert.match(r.text, /막힘: room은\(는\) 유삭\/Gemini/);
await assert.rejects(call(v, 'claim', { module: 'arcade', note: 'x' }), /보기 전용/);
await assert.rejects(call(a, 'claim', { module: 'nope', note: 'x' }), /없음/);
// page sees "working" through the log collection
let logs = await hub.list('log'); assert.equal(logs.length, 1); assert.equal(logs[0].data.state, 'working'); assert.match(logs[0].data.note, /유삭 · Gemini · room/);

// digest
r = await call(b, 'digest');
assert.match(r, /room=유삭\/Gemini/); assert.match(r, /arcade=비어있음/); assert.match(r, /내가 잡은 것: room/); assert.ok(r.length < 900, 'digest stays short: ' + r.length);

// contract change: b holds room (provider of furniture-build) → applied; b does not hold arcade → request
r = await call(b, 'contract', { name: 'furniture-build', propose: 'FURN v2: + parts[]', reason: '부품 붙이기' });
assert.match(r, /바꿨어: furniture-build v2/);
r = await call(b, 'contract', { name: 'prize-spec', propose: 'PRIZES + weight', reason: '무게 점수' });
assert.match(r, /요청 올렸어/); const crq = r.match(/\((\w+)\)/)[1];
r = await call(a, 'digest'); assert.match(r, /연결부 변경 요청: /); assert.match(r, /열린 코멘트 2/);
await assert.rejects(call(b, 'contract', { approve: crq }), /승인할 수 있어/);
r = await call(a, 'contract', { approve: crq }); assert.match(r, /승인: prize-spec/);
r = await call(b, 'contract', { name: 'prize-spec' }); assert.match(r, /prize-spec v2/); assert.match(r, /weight/);
r = await call(b, 'contract', {}); assert.match(r, /furniture-build v2/);

// status → shows on the page log; lease renews
T += 30 * 6e4; await call(b, 'status', { module: 'room', note: '버튼 부품 끝' });
logs = await hub.list('log'); assert.match(logs[0].data.note, /버튼 부품 끝/);
const c1 = (await hub.claims()).room; assert.equal(c1.until, T + LEASE_MIN * 6e4);
await assert.rejects(call(a, 'status', { module: 'room', note: 'x' }), /네가 잡은 모듈이 아니야/);

// CI check
let ci = await hub.ciCheck({ files: ['src/room.js', 'dist/index.html'], claims: [claimId] }); assert.deepEqual(ci, { ok: true, bad: [] });
ci = await hub.ciCheck({ files: ['src/index.src.html', 'build.py'], claims: [claimId] }); assert.equal(ci.ok, false); assert.equal(ci.bad.length, 2);

// release
r = await call(b, 'release', { module: 'room', summary: '부품 시스템 1차', commit: 'abc1234' });
assert.match(r, /풀었어/); assert.equal((await hub.claims()).room, undefined);
logs = await hub.list('log'); assert.equal(logs[0].data.state, 'review'); assert.match(logs[0].data.text, /부품 시스템 1차/);
assert.equal((await hub.ciCheck({ files: ['src/room.js'], claims: [claimId] })).ok, true, 'released claim still valid for CI for a while');

// expiry frees a silent claim; the next holder supersedes it, so the old claim id no longer passes CI
r = await call(a, 'claim', { module: 'arcade', note: 'UI' }); const oldId = r.match(/claim (\w+)/)[1];
assert.equal(await hub.nextExpiry(), T + LEASE_MIN * 6e4);
T += (LEASE_MIN + 1) * 6e4;
await hub.expire(); assert.equal(await hub.nextExpiry(), 0); // what the alarm does
assert.equal((await hub.ciCheck({ files: ['src/index.src.html'], claims: [oldId] })).ok, true, 'expired but nobody took it yet: still accepted');
r = await call(b, 'claim', { module: 'arcade', note: '내가 할게' }); assert.match(r, /잡았어: arcade/);
ci = await hub.ciCheck({ files: ['src/index.src.html'], claims: [oldId] }); assert.equal(ci.ok, false); assert.match(ci.bad[0], /시간 초과로 풀린 뒤 다른 사람이/);
await assert.rejects(call(a, 'status', { module: 'arcade', note: '아직 하는 중' }), /응답이 없어서 풀렸어 — 지금 유삭이\(가\) 잡고 있어/);
await call(b, 'release', { module: 'arcade', summary: 'x' });
await assert.rejects(call(a, 'release', { module: 'arcade', summary: 'x' }), /다시 claim하고 이어서 해/);

// replies, items, memo
const cid = (await hub.list('comments'))[0].id;
assert.equal(await call(b, 'reply', { comment: cid, text: '확인' }), 'ok');
await hub.put('items', 'p1', { type: 'phase', order: 1, title: '창작 기반', md: '- 부품 #make' });
assert.match(await call(b, 'item', { id: 'p1' }), /부품/);
await assert.rejects(call(b, 'item', { id: 'p1', old_str: '부품', new_str: 'x' }), /관리자만/);
assert.equal(await call(a, 'item', { id: 'p1', old_str: '부품', new_str: '부품 시스템' }), 'ok');
await hub.put('notes', 'memo', { text: '오늘 회의', at: T });
assert.match(await call(b, 'digest'), /메모: 바뀜/); await call(b, 'item', { id: 'notes/memo' }); assert.match(await call(b, 'digest'), /메모: 변경 없음/);

// MCP JSON-RPC
let res = await mcpHandle(hub, b, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
assert.equal(res.result.protocolVersion, '2025-06-18'); assert.match(res.result.instructions, /claim/);
assert.equal(await mcpHandle(hub, b, { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
res = await mcpHandle(hub, b, { jsonrpc: '2.0', id: 2, method: 'tools/list' }); assert.equal(res.result.tools.length, 7);
await call(b, 'claim', { module: 'arcade', note: 'y' });
res = await mcpHandle(hub, a, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'claim', arguments: { module: 'arcade', note: 'x' } } });
assert.equal(res.result.isError, true); assert.match(res.result.content[0].text, /막힘/);

// ---- Worker routes through a fake Durable Object ----
const st = memStore(); const sent = [];
let alarmAt = null;
const ctx = { storage: { get: st.get, put: st.put, delete: st.delete, list: st.list, setAlarm: async (t) => { alarmAt = t; }, deleteAlarm: async () => { alarmAt = null; } }, getWebSockets: () => [{ send: (x) => sent.push(x) }], acceptWebSocket() {} };
const env = { OWNER_KEY: 'owner-master-key-123', CI_KEY: 'ci-key' };
const board = new Board(ctx, env);
env.BOARD = { idFromName: (n) => n, get: () => ({ fetch: (req) => board.fetch(req) }) };
const H = 'https://hub.example.dev/b/claw';
const f = (path, init = {}) => worker.fetch(new Request(H + path, init), env);
let resp = await f('/'); assert.equal(resp.status, 401);
resp = await f('/join?t=wrong'); assert.equal(resp.status, 403);
resp = await f('/join?t=owner-master-key-123&name=지은'); assert.equal(resp.status, 302);
const ck = resp.headers.get('Set-Cookie').match(/pb_t=([^;]+)/)[1]; assert.match(resp.headers.get('Set-Cookie'), /Path=\/b\/claw/);
const auth = { Cookie: 'pb_t=' + ck };
resp = await f('/', { headers: auth }); let txt = await resp.text();
assert.equal(resp.status, 200); assert.ok(txt.includes("window.PB_BASE='/b/claw'") && txt.includes('/b/claw/hub-ui.js'));
resp = await f('/api/me', { headers: auth }); assert.equal((await resp.json()).role, 'admin');
resp = await f('/api/doc', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'set', path: 'items/p1', data: { type: 'phase', title: 'x' } }) });
assert.equal(resp.status, 403, 'needs X-PB header');
const post = (p, body) => f(p, { method: 'POST', headers: { ...auth, 'X-PB': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
resp = await post('/api/import', { docs: [{ col: 'items', id: 'p1', data: { type: 'phase', order: 1, title: '창작 기반', md: '- a' } }, { col: 'modules', id: 'room', data: { files: ['src/room.js'], provides: [], requires: [] } }] });
assert.deepEqual(await resp.json(), { ok: true, n: 2 });
await new Promise((r) => setTimeout(r, 120)); assert.ok(sent.some((x) => x.includes('items') || x.includes('"all"')), 'live update pushed');
resp = await f('/api/col?name=items', { headers: auth }); assert.equal((await resp.json()).docs[0].id, 'p1');
resp = await post('/api/members', { name: '유삭', role: 'interact' }); const link = (await resp.json()).link; const tok = link.split('t=')[1];
resp = await f('/admin', { headers: auth }); txt = await resp.text(); assert.ok(txt.includes('/b/claw/mcp/' + tok));
const mcp = (body, t = tok) => f('/mcp/' + t, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) });
resp = await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'claim', arguments: { module: 'room', note: '테스트', agent: 'Claude' } } });
assert.match((await resp.json()).result.content[0].text, /잡았어/); assert.ok(alarmAt > Date.now(), 'alarm set for the lease end');
const rows = st.m.size; await board.hub.list('items'); await board.hub.get('items', 'p1'); assert.equal(st.m.size, rows);
resp = await mcp({ jsonrpc: '2.0', method: 'notifications/initialized' }); assert.equal(resp.status, 202);
resp = await mcp({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'badtoken123'); assert.equal(resp.status, 401);
resp = await f('/api/ci-check', { method: 'POST', headers: { Authorization: 'Bearer ci-key' }, body: JSON.stringify({ files: ['src/room.js'], claims: [] }) });
assert.equal((await resp.json()).ok, false);
resp = await f('/api/col?name=claimlog', { headers: { Cookie: 'pb_t=' + tok } }); assert.equal(resp.status, 403);
console.log('hub tests passed');
