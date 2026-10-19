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
| 3 | `status(module, note)` | One-line progress, shown live. Also extends the claim. |
| 4 | `contract(name, propose, reason)` | Change an interface. Applied if you hold the providing module (or are admin); otherwise filed as a request for the provider to approve. Users of that contract get a board comment. |
| 5 | `release(module, summary)` | Logs the summary on the board and frees the module. |

Plus `reply` (answer a comment) and `item` (read a plan item or the memo; admins can edit items).

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
2. **Open your board:** `https://<worker>.workers.dev/b/<board>/join?t=<OWNER_KEY>&name=<your name>`. `<board>` is any name (lowercase, digits, `-`); each name is a separate board.
3. **Load data:** `node hub/import.mjs "<your join link>" <export.json> <seed.json>` — JSON files shaped `{docs:[{col,id,data}]}`, or a local board folder.
4. **Invite people:** open `/b/<board>/admin`. Each member gets a board link and an MCP URL. Treat both like passwords.
5. **Connect each AI** with the member's MCP URL:
   - claude.ai: Settings → Connectors → Add custom connector → paste the URL.
   - Claude Code: `claude mcp add --transport http planboard <MCP URL>`
   - Gemini CLI, in `~/.gemini/settings.json`: `{ "mcpServers": { "planboard": { "httpUrl": "<MCP URL>" } } }`

## Optional: CI claim check

Reject commits that change files outside the modules they claimed:

1. `npx wrangler secret put CI_KEY`.
2. In the code repo, set the variable `PLANBOARD_HUB` = `https://<worker>.workers.dev/b/<board>` and the secret `PLANBOARD_CI_KEY` = the same CI key.
3. Add a workflow that sends each commit's changed files and its `Planboard-Claim: <id>` trailers to `POST /b/<board>/api/ci-check` (see `claw-machine/.github/` for one).

## Security

- Board links and MCP URLs are bearer secrets. Removing a member on `/admin` disables both.
- Everything collaborators write (comments, notes, contract text) reaches other people's agents. The MCP instructions tell agents to treat it as data; keep agents' own permissions narrow anyway.
