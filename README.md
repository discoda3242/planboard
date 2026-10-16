# Planboard · 같이 쓰는 기획판

claude.ai 아티팩트로 띄우는 **프로젝트 기획판**이야. 로드맵, 상세 설계, 코멘트, 메모를 여러 사람이 같이 보고 쓰고, Claude는 거기서 할 일을 읽고 작업 기록을 남겨.

- 페이지 코드는 이 저장소의 `planboard.html` **하나**를 모든 프로젝트가 같이 써. 프로젝트 내용은 전부 기획판 데이터에 들어가.
- Claude는 작업할 때 페이지를 읽지 않고, 기획판이 만들어 두는 **짧은 요약(약 40~300토큰)**만 읽어. 기획 문서를 통째로 읽는 것보다 시작 비용이 작고, 기획이 커져도 그대로야.
- 선택 기능: **작업 버튼**(초대한 사람이 눌러도 주인 계정으로 Claude 작업 실행), **코드 구조 보기**(GitHub 저장소를 그래프로).

## 들어 있는 것

| 경로 | 내용 |
|---|---|
| `planboard.html` | 기획판 페이지 공용 틀. 수정 없이 그대로 게시 |
| `seed-example.json` | 처음 채울 데이터 예시 (프로젝트 정보, 단계, 설계) |
| `skills/planboard/` | Claude용 스킬: 기획판 만들기·읽기·기록 규칙 |
| `skills/planboard-run-button/` | Claude용 스킬: 작업 버튼 연결 (선택) |
| `button-server/` | 작업 버튼·코드 구조 보기 서버 (Cloudflare Worker, 선택) |

## 빠른 시작

필요한 것: claude.ai Pro·Max·Team·Enterprise 플랜, 코드 실행 기능 켜짐.

1. **스킬 올리기**
   - `skills/planboard` 폴더를 zip으로 묶어 (zip 안에 `planboard/SKILL.md`가 있게).
   - claude.ai → 설정 → Capabilities → Skills → **Upload skill** → zip 선택 → 켜기.
   - 작업 버튼까지 쓸 거면 `skills/planboard-run-button`도 같은 방법으로.
2. **Claude에게 만들어 달라고 하기**
   > planboard 스킬로 ○○ 프로젝트 기획판 만들어줘. 단계는 ○○, ○○…
   
   Claude가 이 저장소의 `planboard.html`을 가져와 새 아티팩트로 게시하고, 내용을 데이터로 채워.
3. **같이 할 사람 초대**: 기획판을 열고 오른쪽 위 공유 메뉴에서 초대해. 코멘트를 쓰려면 보기 전용이 아니라 참여 이상 권한이 필요해.
4. **작업할 때**: 프로젝트 저장소의 `CLAUDE.md`에 기획판 링크가 있으면, Claude가 작업 시작 때 요약을 읽고 끝날 때 기록을 남겨.

## 기획판 쓰는 법 (사람)

| 탭 | 하는 일 |
|---|---|
| **로드맵** | 단계별 목표, 할 일, 끝 기준, 정할 것. 단계마다 코멘트·추가 제안을 달 수 있어 |
| **코멘트** | 특정 단계에 안 맞는 전체 의견. 새로 달린 것만 숫자로 표시돼 |
| **상세 설계** | 규칙, 표, 수치 같은 자세한 설계 문서 |
| **구조** | 단계 → 할 일 → 설계 연결 그래프. 누르면 해당 카드로 이동 |
| **메모장** | 같이 쓰는 자유 메모, 자동 저장 |
| **요청** | 작업 버튼 (설정한 경우만 보임). 보낸 요청과 Claude 답변이 기록돼 |

- 코멘트에 Claude가 답글을 달면 '반영됨'으로 바뀌고, 다음 작업부터 Claude는 그 코멘트를 다시 읽지 않아.
- 할 일 끝에 `#태그`를 붙이면 기둥(분류) 색이 붙어. 글에 `[[s3]]`처럼 항목 id를 쓰면 구조 탭에서 연결선이 그려져.
- 페이지 아래 '홈 화면에 추가'로 폰에 앱처럼 둘 수 있어.

## 데이터 구조 (Claude·직접 편집용)

기획판 내용은 아티팩트 데이터베이스에 있어. 페이지는 이것만 읽어서 그려.

| 위치 | 내용 | 누가 씀 |
|---|---|---|
| `project/info` | `{title, eyebrow, lead, footer, links[], tags[], project?, runUrl?}` | 편집자·Claude |
| `items/{id}` | `{type: "phase"\|"spec", order, title, num?, badge?, state?, md}` | 편집자·Claude |
| `comments`, `replies/{코멘트id}` | 사람 코멘트 / Claude 답글 | 참여자 / Claude |
| `log` | Claude 작업 기록·상태 (작업 중, 확인 부탁, 완료) | Claude |
| `notes/digest` | Claude가 읽는 요약. 페이지가 자동으로 갱신 | 페이지 |
| `notes/memo` | 메모장 | 참여자 |
| `requests`, `req_replies`, `reqnotes`, `secret/run` | 작업 버튼용 | 버튼 설정 시 |

`md` 문법:
- **단계(phase)**: 일반 줄 = 목표 · `- 할 일 #태그` · `완료: …` = 끝 기준 · `? …` = 정할 것
- **설계(spec)**: 문단 · `- ` 목록 · `> ` 강조 박스 · `## ` 소제목 · `| a | b |` 표 · `※ ` 작은 주석 · `**굵게**`

예시는 `seed-example.json`.

## 작업 버튼 (선택)

초대한 사람이 기획판 '요청' 탭에서 버튼을 누르면, **기획판 주인 계정**의 예약 작업이 클라우드에서 실행돼. 결과는 기획판 기록과 요청 답변에 남아.

```
기획판 요청 탭 ──새 탭──▶ 버튼 서버 (Cloudflare Worker) ──API──▶ 주인 계정의 예약 작업 ──▶ Claude가 작업 후 기획판에 기록
```

- **접근 제한**: 기획판에 숨겨진 실행 키(`secret/run`, 참여 권한 이상만 읽힘)를 버튼 서버가 확인해. 보기 전용인 사람은 버튼이 안 보여.
- **비용**: 주인 계정 구독 사용량에서 빠져 (별도 API 요금 없음). 예약 작업당 시간당 30회 제한.
- **설정 순서**: `button-server/README.md`. 서버는 사람당 하나만 두고 모든 프로젝트가 같이 써.
- **알아둘 점**: 버튼으로 시작된 실행은 아티팩트를 다시 게시하기 전에 주인 승인을 기다려. 버튼으로 결과물을 고치게 할 거면 결과물은 아티팩트 대신 GitHub 저장소 + 자동 배포 사이트(Cloudflare Pages 등)로 두는 게 좋아.

## 코드 구조 보기 (선택)

버튼 서버가 있으면 '구조' 탭의 **코드 구조 보기**로 프로젝트 GitHub 저장소를 그래프로 볼 수 있어. Claude 실행 없이 볼 때마다 최신 코드 기준이야.

- 실선: 파일 이름 언급(import, require, 빌드 스크립트, 문서 링크)
- 점선: 다른 파일에 정의된 함수 사용
- 분홍 노드: 코드 주석 `// @plan s3`로 이어진 기획 항목 → 누르면 기획판 그 항목으로
- 필요한 것: 버튼 서버 시크릿 `GITHUB_TOKEN` 하나 (읽기 전용, 모든 프로젝트 공용)

## 틀 업데이트

페이지 기능을 바꿀 땐 이 저장소의 `planboard.html`만 고쳐. 그다음 쓰고 있는 기획판들에 같은 파일을 다시 게시하면 돼 (내용은 데이터에 있어서 그대로 남아). Claude에게 "planboard 틀 바뀐 거 내 기획판들에 반영해줘"라고 하면 돼.

## 직접 쓰기 (Claude 없이)

`planboard.html`은 claude.ai 아티팩트의 데이터베이스(`db`)·사용자(`user`) 기능을 써서, claude.ai 아티팩트로 게시해야 동작해. 게시할 때 capabilities:

```json
{"db":{"rules":[{"path":"project","write":"admin"},{"path":"items","write":"admin"},{"path":"log","write":"admin"},{"path":"replies","write":"admin"},{"path":"board","write":"admin"},{"path":"req_replies","write":"admin"},{"path":"secret","read":"interact","write":"admin"}]},"user":{"scopes":["profile","email"]}}
```

일반 웹 서버에 올리면 "claude.ai에서 열면 내용이 보여"만 떠.
