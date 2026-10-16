# Button server (cloud mode and the code map)

A single Cloudflare Worker serves cloud-mode request buttons and the code map for all your projects. **Make one per person**, not one per project.

If you only use local mode, you don't need this server. See the main README.

## Routes

- **`/?p=<project key>&k=<run key>`** shows a confirm page. On confirm it starts that project's routine, and the tab closes on success.
- **`/map?p=<project key>&k=<run key>`** shows the project's GitHub repo as a file tree and dependency graph. If the project has no `KEY_<KEY>` secret (map-only projects), the map opens without a run key; projects with a key still check it.
- **Run key:** a wrong key returns 403 on both routes. Keep the same value in two places: the board's `secret/run.key`, which only collaborators can read, and the Worker secret `KEY_<KEY>`.

## First-time setup

1. **Create a private GitHub repo.** Add `worker.js` and `map.js` from this folder. Copy `wrangler.example.jsonc` in as `wrangler.jsonc`.
2. **Deploy it.** In Cloudflare, go to **Workers & Pages → Create → Import a repository** and pick the repo.
   - The Worker's URL is `<worker name>.<account subdomain>.workers.dev`.
   - You can change the subdomain under **Account details** on the Workers & Pages page. The change applies to every Worker on your account.
3. **Add a GitHub token for the code map (once).**
   - On GitHub, go to **Settings → Developer settings → Fine-grained tokens**.
   - Choose **All repositories** with **Contents: Read-only**.
   - In the Worker, go to **Settings → Variables and Secrets** and add it as the secret `GITHUB_TOKEN`.
   - When it expires, generate a new one and overwrite the secret.

## Connect a project

1. **Create a routine** at claude.ai/code/routines → **New routine**.
   - **Repositories:** only this project's repo.
   - **Connectors:** remove any you don't need.
   - **Trigger:** **API**. Save, then click **Generate token**. The token is shown only once.
   - **Instructions:** fill in the routine prompt template from `skills/planboard-run-button/SKILL.md`.
2. **Add the project to `PROJECTS` in `wrangler.jsonc`.** Pushing redeploys the Worker.
   ```jsonc
   "myproj": { "name": "My project", "trigger": "trig_…", "board": "https://claude.ai/artifact/…", "repo": "owner/repo" }
   ```
3. **Add two Worker secrets.** The suffix is the project key in uppercase.
   - `KEY_MYPROJ`: the run key, a long random string.
   - `TOKEN_MYPROJ`: the routine token from step 1.
4. **Update the board data.**
   - In `project/info`, set `project: "myproj"` and `runUrl: "https://…workers.dev"`.
   - Set `secret/run` to `{key: "<run key>"}`.

With the `planboard-run-button` skill, you can ask Claude to "connect the request button for my X board." Claude generates the run key and does steps 2 and 4. You do steps 1 and 3.

## Troubleshooting

| You see | Cause |
|---|---|
| 실행 권한이 없어 ("no permission") | The run key doesn't match. Compare the board's `secret/run.key` with `KEY_<KEY>`. |
| `KEY_…`/`TOKEN_…` 시크릿이 등록되지 않았어 ("secret not set") | Check the secret's spelling, and check that it was added before the last deploy. |
| Code 401 | Wrong routine token, or a token from a different routine. |
| Code 403 · `forbidden Request not allowed` · server: cloudflare | Anthropic's API is blocking requests from that Cloudflare region. Keep `placement.region` in `wrangler.jsonc`. |
| Code 429 | The routine has hit its hourly run limit. |
| Code map: GitHub 401 | `GITHUB_TOKEN` has expired or lacks access. |

## Security notes

- **Tokens:** keep them only in Worker secrets. Don't put them in repos, boards or chats.
- **Leaked run key:** change it in both places, the board's `secret/run` and `KEY_<KEY>`.
- **Requests are untrusted:** the routine receives each request marked as untrusted data. Always state the allowed scope in the routine's instructions. The template does this.
