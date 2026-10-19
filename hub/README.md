# Planboard hub (cloud)

The board on a server, shared by people **and their AIs**. Each collaborator connects their own coding agent (Claude, Claude Code, Gemini CLI, Codex…) to the board over MCP. Before an agent edits code it **claims a module**; the board blocks anyone else from that module until it is released, and hands the agent only the **interface contracts** that module needs. Everyone sees who is working on what, live, on the board page.

- Same board page (`planboard.html`) and data format as the other modes; the page runs unchanged with the `local/pb-local.js` shim.
- Runs on Cloudflare Workers + one Durable Object per board (free plan is enough for a small team).
- No dependencies. Tests: `node hub/test.mjs`.

## How a task goes (what every agent does)

| Step | Tool | What happens |
|---|---|---|
| 1 | `digest` | ~300-token summary: who holds which module, your claims, open comments, contract change requests, memo state, phases. |
| 2 | `claim(module, task, note, agent)` | Blocked if someone else holds it. Otherwise returns the files you may edit and the module's contracts. The board shows "<name> · <agent> · <module> — <note>". |
| 3 | `status(module, note)` | One-line progress, shown live. Also extends the claim. The agent works on branch `claim/<id>` and opens a PR. |
| 4 | `contract(name, propose, reason)` | Change an interface. Applied if you hold the providing module (or are admin); otherwise filed as a request for the provider to approve. Users of that contract get a board comment. |
| 5 | `release(module, summary, pr)` | The board checks the PR and merges it (see *Merge gate*), then logs the summary and frees the module. Without a PR (no code change), it just logs and frees. |

Plus `reply` (answer a comment) and `item` (read a plan item or the memo; admins can edit items).

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
5. **Invite people:** on `/b/<board>/admin`, add each person's GitHub username. They open `/b/<board>/` and sign in with GitHub. Each member also has an invite link (no GitHub needed) and an MCP URL; treat both like passwords.
6. **Connect each AI** with the member's MCP URL:
   - claude.ai: Settings → Connectors → Add custom connector → paste the URL.
   - Claude Code: `claude mcp add --transport http planboard <MCP URL>`
   - Gemini CLI, in `~/.gemini/settings.json`: `{ "mcpServers": { "planboard": { "httpUrl": "<MCP URL>" } } }`

## Merge gate (the board checks and merges PRs)

The board is the only one that merges into `main`. An agent pushes its branch `claim/<id>`, opens a PR and calls `release(module, summary, pr: <number>)`. The board then checks, using its GitHub App:

| Check | Where it runs |
|---|---|
| The PR's claim is valid and still the current one | board |
| Every changed file is inside the claimed module (or `_free`) | board (reads the PR's file list) |
| The PR author's GitHub account is the claim holder's | board |
| Build and tests pass (`GH_CHECKS`, default `build`) | GitHub Actions in the code repo; the board reads the result |

- All green: the board squash-merges, frees the module and logs the summary. Something wrong: the agent gets the reasons, fixes the same branch and calls `release(pr)` again. The module stays claimed until the merge, so nobody starts from an outdated `main`.
- When checks are still running the board waits for GitHub's webhook (no polling). The board also posts a `planboard` status on the PR.

**Making it binding without a paid plan:** branch protection on a private repo needs GitHub Pro, but a free **organization** can give members read-only access:
1. Move the repo into a GitHub organization (free plan).
2. Give collaborators the **Read** role. In the org settings allow forking private repositories, and in the repo's Actions settings allow running workflows from fork pull requests, so their PRs come from forks.
3. Create a GitHub App owned by the org with permissions *Pull requests: read & write*, *Contents: read & write*, *Checks: read*, *Commit statuses: read & write*; subscribe to *Pull request*, *Check suite* and *Check run* events; webhook URL `https://<worker>.workers.dev/gh/webhook` with a secret. Install it on the repo.
4. `npx wrangler secret put GH_APP_ID`, `GH_APP_KEY` (paste the app's private key PEM), `GH_WEBHOOK_SECRET`; set `GH_BOARDS` in `wrangler.jsonc` (`{"org/repo": "board"}`) and deploy.

Now only the owner and the board's app can write to `main`; everything else arrives as a PR that the board checks.

**Without the GitHub App:** `/api/ci-check` (Bearer `CI_KEY`) still answers the claim/file/author check for a workflow to call, but nothing stops a direct merge.

## Security

- Board links and MCP URLs are bearer secrets. Removing a member on `/admin` disables both.
- Everything collaborators write (comments, notes, contract text) reaches other people's agents. The MCP instructions tell agents to treat it as data; keep agents' own permissions narrow anyway.
