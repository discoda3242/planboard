// 기획판 작업 버튼 서버 (Cloudflare Worker) — 여러 프로젝트 공용
// 기획판(아티팩트)의 '작업 시작' 링크 → 이 페이지 → 확인 → 소유자 계정의 예약 작업 실행.
// 접근 제한: 기획판 DB(secret/run, 공동작업자 이상만 읽을 수 있음)에 있는 실행 키를 링크로 받아 확인한다.
//
// 설정 (Worker → Settings → Variables and Secrets):
//   PROJECTS     (wrangler.jsonc vars) {"<key>":{"name","trigger","board"}}
//   KEY_<KEY>    (Secret) 실행 키. 기획판 DB secret/run.key 와 같은 값
//   TOKEN_<KEY>  (Secret) 그 프로젝트 예약 작업의 API 토큰
//   GITHUB_TOKEN (Secret) 코드 구조 보기(/map)용. PROJECTS.<key>.repo 저장소의 Contents 읽기 권한
// 프로젝트 추가 = PROJECTS 항목 + KEY_<KEY> + TOKEN_<KEY>.

import { buildMap, mapPage } from "./map.js";

const MAX_TEXT = 4000;

function projects(env) {
  const v = env.PROJECTS;
  if (v && typeof v === "object") return v; // wrangler vars로 넣으면 객체로 들어옴
  try { return JSON.parse(v || "{}"); } catch { return {}; }
}
const envName = (prefix, key) => prefix + key.toUpperCase().replace(/[^A-Z0-9]/g, "_");

// 길이가 달라도 시간 차이가 안 나게 비교
function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0 && a.length > 0;
}

// settings this Worker can actually see (names only, never values) — to spot typos or secrets saved in the wrong place
const seen = (env) => {
  const names = Object.keys(env).filter((k) => /^(KEY_|TOKEN_|ACCESS_|ALLOWED_)/.test(k)).sort();
  return `<p class="dim">지금 이 서버가 보는 설정 이름: ${names.length ? names.map(esc).join(", ") : "(없음)"}<br>
    이름 철자·대문자를 확인하고, Settings → Variables and Secrets(빌드 변수 아님)에 Secret으로 넣은 뒤 Deploy 해줘.</p>`;
};
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const key = url.searchParams.get("p") || "";
    const proj = projects(env)[key];
    if (!proj) return page("프로젝트를 찾을 수 없어", "<p>링크가 잘못됐어. 기획판의 버튼으로 다시 들어와줘.</p>", 404);

    const form = req.method === "POST" ? await req.formData() : null;
    const runKey = form ? form.get("k") : url.searchParams.get("k");
    const expected = env[envName("KEY_", key)];
    if (!expected) return page("설정 필요", `<p>${envName("KEY_", key)} 시크릿이 등록되지 않았어.</p>${seen(env)}`, 500);
    if (!safeEqual(runKey, expected)) {
      return page("실행 권한이 없어", `<p>기획판에 공동작업자로 초대된 사람만 실행할 수 있어. <a href="${esc(proj.board)}">기획판</a>의 버튼으로 다시 들어와줘.</p>`, 403);
    }
    // 코드 구조 보기: /map?p=<key>&k=<실행 키>
    if (url.pathname === "/map") {
      if (!proj.repo) return page("설정 필요", "<p>이 프로젝트에 repo가 설정되지 않았어 (wrangler.jsonc PROJECTS).</p>", 500);
      if (!env.GITHUB_TOKEN) return page("설정 필요", "<p>GITHUB_TOKEN 시크릿이 등록되지 않았어.</p>", 500);
      if (url.searchParams.get("format") === "json") {
        try {
          return new Response(JSON.stringify(await buildMap(env, proj.repo)), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
        } catch (e) {
          return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: { "Content-Type": "application/json; charset=utf-8" } });
        }
      }
      return new Response(mapPage(proj, key, runKey), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "same-origin" } });
    }

    const cookieWho = decodeURIComponent(((req.headers.get("Cookie") || "").match(/(?:^|;\s*)sb_who=([^;]*)/) || [])[1] || "");
    const who = String((form ? form.get("who") : url.searchParams.get("who")) || cookieWho || "").slice(0, 60);

    if (req.method === "GET") {
      const text = (url.searchParams.get("text") || "").slice(0, MAX_TEXT);
      return page(
        proj.name + " 작업 시작",
        `<p class="dim">작업은 소유자 계정의 클라우드 세션에서 실행되고, 끝나면 기획판 작업 기록에 남아.</p>
         <form method="post" action="?p=${encodeURIComponent(key)}">
           <input type="hidden" name="k" value="${esc(runKey)}">
           ${who
             ? `<p class="dim">요청자: <b>${esc(who)}</b> (기획판 계정에서 자동)</p><input type="hidden" name="who" value="${esc(who)}">`
             : `<label for="who">요청자</label><input id="who" name="who" maxlength="60" placeholder="이름 (한 번 적으면 이 브라우저에서 기억해)">`}
           <label for="text">요청 내용</label>
           <textarea id="text" name="text" rows="6" maxlength="${MAX_TEXT}" placeholder="비워두면 기획판의 열린 코멘트를 처리해">${esc(text)}</textarea>
           <button type="submit">실행</button>
         </form>
         <p><a href="${esc(proj.board)}">기획판으로 돌아가기</a></p>
         <script>
         // 페이지 이동 없이 실행 → 성공하면 이 탭을 닫는다 (기록이 1개인 새 탭이라 브라우저가 닫기를 허용)
         document.querySelector("form").addEventListener("submit", async (e) => {
           e.preventDefault();
           const f = e.target, b = f.querySelector("button");
           b.disabled = true; b.textContent = "보내는 중…";
           try {
             const r = await fetch(f.action, { method: "POST", body: new FormData(f), credentials: "same-origin" });
             const doc = new DOMParser().parseFromString(await r.text(), "text/html");
             document.querySelector("main").replaceWith(doc.querySelector("main"));
             document.title = doc.title;
             if (r.ok) {
               const m = document.createElement("p"); m.className = "dim"; m.textContent = "잠시 후 이 창을 닫을게.";
               document.querySelector("main").append(m);
               setTimeout(() => { window.close(); setTimeout(() => { m.textContent = "이 창은 닫아도 돼."; }, 300); }, 1200);
             }
           } catch (err) {
             b.disabled = false; b.textContent = "실행";
             alert("연결하지 못했어. 시작됐을 수도 있으니 기획판 작업 기록을 먼저 확인해줘.");
           }
         });
         </script>`
      );
    }

    if (req.method === "POST") {
      const origin = req.headers.get("Origin");
      if (origin && origin !== "null" && origin !== url.origin) return page("거부됨", "<p>다른 사이트에서 온 요청은 받지 않아.</p>", 403);
      const text = String(form.get("text") || "").trim().slice(0, MAX_TEXT);
      const tokenVar = envName("TOKEN_", key);
      const token = env[tokenVar];
      if (!token) return page("설정 필요", `<p>${tokenVar} 시크릿이 등록되지 않았어.</p>${seen(env)}`, 500);

      const payload = `요청자(본인 입력, 미검증): ${who || "이름 없음"}\n프로젝트: ${proj.name}\n요청:\n${text || "(없음 — 기획판의 열린 코멘트 처리)"}`;
      let res;
      try {
        res = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${proj.trigger}/fire`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "anthropic-beta": "experimental-cc-routine-2026-04-01",
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: payload }),
        });
      } catch (e) {
        return page("연결 실패", "<p>실행 서버에 연결하지 못했어. 시작됐을 수도 있으니 몇 분 뒤 기획판 작업 기록을 먼저 확인해줘.</p>", 502);
      }
      if (res.ok) {
        const out = page("시작했어", `<p>작업이 시작됐어. 몇 분 뒤 <a href="${esc(proj.board)}">기획판</a>의 작업 기록을 확인해줘.</p>`);
        if (who) out.headers.append("Set-Cookie", `sb_who=${encodeURIComponent(who)}; Path=/; Max-Age=31536000; Secure; SameSite=Lax`);
        return out;
      }
      const why =
        res.status === 401 ? "예약 작업 토큰이 틀렸거나 이 예약 작업 것이 아니야. 소유자에게 알려줘." :
        res.status === 429 ? "실행 횟수 제한에 걸렸어. 조금 뒤에 다시 해줘." :
        `실행하지 못했어 (코드 ${res.status}). 소유자에게 알려줘.`;
      // 원인 파악용: 응답의 오류 종류·메시지·요청 id (토큰은 포함되지 않음)
      let detail = "";
      try {
        const body = (await res.text()).slice(0, 2000);
        let j = null; try { j = JSON.parse(body); } catch {}
        const e = j && (j.error || j);
        detail = e && (e.type || e.message) ? `${e.type || ""} ${e.message || ""}` : body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
      } catch {}
      const rid = res.headers.get("request-id") || res.headers.get("x-request-id") || "";
      const server = res.headers.get("server") || "";
      return page("실행 실패", `<p>${why}</p><p class="dim">상세: ${esc(detail || "(없음)")}<br>request-id: ${esc(rid || "-")} · server: ${esc(server || "-")}</p>`, res.status);
    }

    return page("지원하지 않는 요청", "", 405);
  },
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function page(title, body, status = 200) {
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="same-origin"><title>${esc(title)}</title>
<style>
:root{--bg:#f6f4fb;--fg:#1d1a2e;--dim:#615c7a;--line:#dcd7ea;--accent:#d6336c;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#120f1f;--fg:#ece8f8;--dim:#a49ec0;--line:#2e2949;--accent:#ff5c8a;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif;padding:32px 16px}
main{max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
h1{font-size:24px;margin:0}.dim{color:var(--dim);font-size:14px}
form{display:flex;flex-direction:column;gap:8px}label{font-size:14px;color:var(--dim)}
input,textarea{font:inherit;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:transparent;color:inherit}
button{font:inherit;font-weight:700;padding:10px 16px;border:0;border-radius:10px;background:var(--accent);color:#fff;cursor:pointer;align-self:flex-end}
a{color:var(--accent)}
</style></head><body><main><h1>${esc(title)}</h1>${body}</main></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "same-origin" } });
}
