# planboard 저장소 작업 규칙

- `planboard.html`은 모든 기획판이 같이 쓰는 **공용 틀**이다. 프로젝트 이름·내용·링크를 코드에 넣지 않는다 (전부 db `project/info`, `items`에서 읽음). `<title>`은 `기획판`으로 둔다.
- 틀을 고치면: `<script>` 문법 검사(`node --check`) → 커밋 → 이 틀을 쓰는 기획판들에 같은 파일을 다시 게시(Artifact publish, `capabilities` 생략으로 유지, 라이브 버전이 더 새로우면 합친 뒤 게시).
- `button-server/`는 버튼 서버 **원본 코드**. 개인 설정(프로젝트 목록·주소)은 넣지 않는다. `wrangler.example.jsonc`만 둔다.
- `skills/`는 다른 사람이 그대로 올려 쓸 수 있는 일반 버전이다. 개인 기획판 링크·예약 작업 ID를 넣지 않는다.
- README는 처음 보는 사람 기준으로, 한국어로 쓴다.
