# 버튼 서버 (작업 버튼 + 코드 구조 보기)

Cloudflare Worker 하나로 모든 프로젝트의 작업 버튼과 코드 구조 보기를 처리해. **사람당 하나**만 만들면 돼.

## 하는 일
- `/?p=<프로젝트 키>&k=<실행 키>`: 실행 화면 → 확인 → 그 프로젝트의 예약 작업 실행 → 성공하면 창이 닫힘
- `/map?p=<프로젝트 키>&k=<실행 키>`: 프로젝트 GitHub 저장소를 파일 트리 + 연결 그래프로 표시
- 실행 키가 틀리면 전부 403. 키는 기획판 `secret/run.key`(참여 권한 이상만 읽힘)와 Worker 시크릿 `KEY_<키>`에 같은 값으로 둬.

## 처음 만들기

1. **GitHub에 비공개 저장소**를 하나 만들고, 이 폴더의 `worker.js`, `map.js`를 넣어. `wrangler.example.jsonc`는 `wrangler.jsonc`로 이름을 바꿔 넣어.
2. **Cloudflare** → Workers & Pages → Create → **Import a repository** → 그 저장소 선택 → 배포.
   주소는 `<worker 이름>.<계정 서브도메인>.workers.dev`. 서브도메인은 Workers & Pages 오른쪽 Account details에서 바꿀 수 있어 (계정 전체 공통).
3. **GitHub 토큰 (코드 구조 보기용, 한 번만)**: GitHub → Settings → Developer settings → Fine-grained tokens → Repository access **All repositories**, Permissions **Contents: Read-only** → Worker → Settings → Variables and Secrets에 Secret `GITHUB_TOKEN`으로 등록. 만료되면 새로 받아 같은 이름으로 덮어써.

## 프로젝트 하나 연결하기

1. **예약 작업 만들기**: claude.ai/code/routines → New routine
   - 저장소: 그 프로젝트 저장소만, 커넥터: 안 쓰는 건 빼기
   - 트리거: **API** → 저장 후 **Generate token** (한 번만 보여)
   - 지시문: `skills/planboard-run-button/SKILL.md`의 '예약 작업 프롬프트 틀'을 채워 붙여넣기
2. **`wrangler.jsonc`의 `PROJECTS`에 한 줄 추가** → 푸시하면 자동 재배포
   ```jsonc
   "myproj": { "name": "내 프로젝트", "trigger": "trig_…", "board": "https://claude.ai/artifact/…", "repo": "id/repo" }
   ```
3. **Worker 시크릿 두 개** (키 이름은 프로젝트 키를 대문자로)
   - `KEY_MYPROJ`: 실행 키 (긴 무작위 문자열)
   - `TOKEN_MYPROJ`: 1번에서 받은 예약 작업 토큰
4. **기획판 데이터**: `project/info`에 `project: "myproj"`, `runUrl: "https://…workers.dev"`, `secret/run`에 `{key: "<실행 키>"}`

Claude에게 `planboard-run-button` 스킬로 "○○ 기획판에 작업 버튼 연결해줘"라고 하면 2·4번과 실행 키 생성은 Claude가 하고, 1·3번만 네가 하면 돼.

## 문제 해결

| 화면 | 원인 |
|---|---|
| 실행 권한이 없어 | 실행 키가 다름. 기획판 `secret/run.key`와 `KEY_<키>` 확인 |
| `KEY_…`/`TOKEN_…` 시크릿이 등록되지 않았어 | 시크릿 이름 철자, 등록 후 배포 여부 |
| 코드 401 | 예약 작업 토큰이 틀렸거나 다른 예약 작업 것 |
| 코드 403 · `forbidden Request not allowed` · server: cloudflare | Anthropic이 그 지역 Cloudflare 서버 요청을 막음 → `wrangler.jsonc`의 `placement.region` 확인 |
| 코드 429 | 시간당 실행 횟수 제한 |
| 코드 구조: GitHub 401 | `GITHUB_TOKEN` 만료·권한 부족 |

## 보안 메모
- 토큰은 Worker 시크릿에만. 저장소·기획판·대화에 넣지 마.
- 실행 키가 새면 새 값으로 바꿔 (기획판 `secret/run`과 `KEY_<키>` 둘 다).
- 버튼으로 들어온 요청은 예약 작업에서 '신뢰 안 된 데이터'로 표시돼서 들어가. 지시문에 작업 범위를 꼭 적어둬 (프롬프트 틀에 있음).
