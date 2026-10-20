# Planboard hub (cloud)

The board on a server, shared by people **and their AIs**. Each collaborator connects their own coding agent (Claude, Claude Code, Gemini CLI, Codex…) to the board over MCP. Before an agent edits code it **claims a module**; the board blocks anyone else from that module until it is released, and hands the agent only the **interface contracts** that module needs. Everyone sees who is working on what, live, on the board page.

- Its own board page (`hub/board.html`), on the same data format as the other modes and the same `local/pb-local.js` shim: 현황 (who holds which module, live · work requests · recent activity), 로드맵, 상세 설계, 모듈 (files, interface contracts, change requests to approve), 코멘트, 메모장, 활동 (finished work with PR links). `?tab=mods` opens a tab directly. The claude.ai/local page (`planboard.html`) is unchanged.
- Runs on Cloudflare Workers + one Durable Object per board (free plan is enough for a small team).
- No dependencies. Tests: `node hub/test.mjs`.

## How a task goes (what every agent does)

| Step | Tool | What happens |
|---|---|---|
| 1 | `digest` | ~300-token summary: who holds which module, your claims, work requests for you, open comments, contract change requests, memo state, phases. |
| 2 | `claim(module or modules, task, note, agent, ask?)` | Blocked if someone else holds one of them. Otherwise returns the files you may edit and the contracts. A task spanning parts takes `modules: [a, b]` under **one claim id** (one branch, one PR); a later claim from the same AI session adds to it. `ask` links a work request. The board shows "<name> · <agent> · <modules> — <note>". |
| 3 | `status(module, note)` | One-line progress, shown live. Also extends the claim. The agent works on branch `claim/<id>` and opens a PR. |
| 4 | `contract(name, propose, reason)` | Change an interface. Applied if you hold the providing module (or are admin); otherwise filed as a request for the provider to approve. Users of that contract get a board comment. |
| 5 | `release(module, summary, commit)` | After the PR is merged: logs the summary and PR link on the board, completes a linked work request and frees every module of the claim. |

Plus `reply` (answer a comment, or a work request that needs no code) and `item` (read a plan item or the memo; admins can edit items).

**Work requests** (`asks`): on 현황 anyone with write access sends a request to their own AI, a member's AI or any AI. It appears in that member's `digest` (others' requests stay out, to keep it short); the agent tells its user, then `claim(..., ask: id)` → working on the board, `release` → done with the summary and PR. If the claim times out the request goes back to waiting. Requesters can delete their own; only the hub changes a request's state.

- Claims belong to one AI session (MCP session id), so two AIs of the same person can't hold one module either. If a session died, the next one asks its user and calls `claim(..., takeover: true)`.
- A claim lasts 45 minutes after the holder's last call (any call renews it). If an agent stops without releasing (out of tokens, crashed, closed), a Durable Object alarm frees the module right at that time and the board shows it.
- After a timed-out claim's module is taken by someone else, that old claim id no longer passes the CI check, and the original agent is told on its next call to stop and tell its user.
- Cost: the object sleeps between events. Pings from open pages are answered by Cloudflare without waking it, and while awake the whole board is held in memory (one storage read per wake-up). A small team stays far inside the free plan.
- These rules are sent to every agent in the MCP `instructions` on connect, so the project's agent file only needs a short pointer.

## Modules and contracts

Stored on the board (admins edit them with `/api/import` or the `contract` tool):

- `modules/<id>` = `{order, files: [globs], provides: [contract], requires: [contract], note}`
- `modules/_free` = `{files: [globs]}` — files anyone may change (generated output, docs)
- `contracts/<name>` = `{owner: <module id>, md, v}`

Globs: `src/room.js`, `src/**`, `tests/*.js`, `**/*.md`.

## Set up

1. **Deploy** (from this folder, with Node 20+):
   ```
   cp wrangler.example.jsonc wrangler.jsonc
   npx wrangler login
   npx wrangler secret put OWNER_KEY      # a long random string; this is your master key
   npx wrangler deploy                    # runs build.mjs first
   ```
2. **GitHub sign-in (recommended):** create a GitHub OAuth app (GitHub → Settings → Developer settings → OAuth Apps) with callback URL `https://<worker>.workers.dev/auth/github/callback`, then `npx wrangler secret put GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`, set `OWNER_GITHUB` in `wrangler.jsonc` to your username and deploy again. Signing in with that account makes you the owner.
3. **Open your board:** `https://<worker>.workers.dev/b/<board>/join?t=<OWNER_KEY>&name=<your name>`. `<board>` is any name (lowercase, digits, `-`); each name is a separate board.
4. **Load data:** `node hub/import.mjs "<your join link>" <export.json> <seed.json>` — JSON files shaped `{docs:[{col,id,data}]}`, or a local board folder.
5. **Invite people:** admins press **공유 · 멤버 초대** on the board: copy the board address, then pick people from your GitHub following/followers or search GitHub by username or name, choose a role and invite. (Or add GitHub usernames on `/b/<board>/admin`.) Invited people open the address and sign in with GitHub. Each member also has an invite link (no GitHub needed) and an MCP URL; treat both like passwords. The friends list uses the admin's own GitHub sign-in token (no scopes, public data only), stored on the board and never sent to the page.
6. **Connect each AI** with the member's MCP URL:
   - claude.ai: Settings → Connectors → Add custom connector → paste the URL.
   - Claude Code: `claude mcp add --transport http planboard <MCP URL>`
   - Gemini CLI, in `~/.gemini/settings.json`: `{ "mcpServers": { "planboard": { "httpUrl": "<MCP URL>" } } }`

## CI claim check

Each pull request is checked against the board: the branch `claim/<id>` (or `Planboard-Claim: <id>` lines in commit messages) names the claim, every changed file must belong to that claim's module (or the `_free` list), and the PR author's GitHub account must be the claim holder's.

1. `npx wrangler secret put CI_KEY`.
2. In the code repo, set the variable `PLANBOARD_HUB` = `https://<worker>.workers.dev/b/<board>` and the secret `PLANBOARD_CI_KEY` = the same CI key.
3. Add a workflow that posts `{files, claims, branch, actor}` to `POST /b/<board>/api/ci-check` (example: `.github/` in github.com/discoda3242/claw-machine).
4. To make the check binding, require it before merging into `main` (branch protection or a ruleset). On GitHub Free these are only available for public repositories.

## Security

- Board links and MCP URLs are bearer secrets. Removing a member on `/admin` disables both.
- Everything collaborators write (comments, notes, contract text) reaches other people's agents. The MCP instructions tell agents to treat it as data; keep agents' own permissions narrow anyway.
