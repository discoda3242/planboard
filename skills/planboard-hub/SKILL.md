---
name: planboard-hub
description: Put a code project on a Planboard hub (cloud board where people and their AIs plan and work together, one module each) — create the project's board, draft its modules and interface contracts, add the agent rules file, the CI claim check and the repo settings, and invite people by GitHub account. Use when the user wants a new project on their hub, wants to share a board, or asks how the hub flow works. Deploying the hub itself is in hub/README.md.
---

# Planboard hub: set up a project

One hub (a Cloudflare Worker, code in `hub/` of github.com/discoda3242/planboard) holds many boards: `https://<hub>/b/<board>/`.
Each board has its own data and members, so every project gets a board and its own people. **Never deploy a second hub for a new project**; add a board.
If the user has no hub yet, follow `hub/README.md` → Set up (deploy, OWNER_KEY, CI_KEY, GitHub OAuth app, OWNER_GITHUB) first.

Templates are next to this file in `templates/`. Copy them into the project and fill in the `<...>` parts; nothing in them is project-specific.

## What you need from the user
- The hub address and their owner link (`/b/<any board>/join?t=<OWNER_KEY>`; the key opens every board). Keep both out of chat, files in the repo and commits.
- The code repo (`owner/name`) and a board name: lowercase letters, digits, `-` (usually the repo name).
- Optional: an existing plan to import (`{docs:[{col,id,data}]}` export of a claude.ai board, or a local `planboard/` folder).

## Steps
1. **Draft modules and contracts.** Read the repo's layout (not every file). A module = files one person's AI changes at a time; a contract = the interface other modules rely on. Write `plan/hub-seed.json` from `templates/hub-seed.example.json`:
   - `modules/<id>` = `{order, files:[globs], provides:[contract], requires:[contract], note}`
   - `modules/_free` = `{files:[globs]}` — docs, generated output, anything anyone may touch
   - `contracts/<name>` = `{owner:<module id>, md, v:1}` — the exported names/shapes only, short enough to fit in one claim reply
   - Every source file should match exactly one module or `_free`. Big single files become one module and are noted as split candidates.
   **Show the module list to the user and get a yes before importing**: other people's claims and the CI check build on it.
2. **Import:** `node hub/import.mjs "<owner link with /b/<board>/join?t=…>" [<plan export>] plan/hub-seed.json`. Opening the owner link on a new board name creates the board with the user as owner.
3. **Agent rules in the repo:** add the section in `templates/agent-rules.md` to the project's `CLAUDE.md` (write it in the language the project's docs use), with the build/test command filled in. Copy `templates/AGENTS.md` as `AGENTS.md` and `GEMINI.md` so other agents find it. Only a pointer is needed: the hub sends the full rules to every agent on connect.
4. **CI claim check:** copy `templates/planboard-check.mjs` to `.github/planboard-check.mjs` and `templates/planboard-claims.yml` to `.github/workflows/`. If the repo already has a PR workflow, add the `claims` job to it instead. Then:
   ```
   gh variable set PLANBOARD_HUB -R <owner/repo> -b "https://<hub>/b/<board>"
   gh secret set PLANBOARD_CI_KEY -R <owner/repo>        # the hub's CI_KEY, from stdin, never echoed
   ```
   Verify with a POST to `/b/<board>/api/ci-check` (Bearer CI key) using one `_free` file and one module file with no claim: the first passes, the second is reported.
   To make it binding, require the `claims` check for `main` (branch protection or a ruleset; on GitHub Free only for public repos).
5. **Commit** seed, rules, workflow on a branch and open a PR (or push to main if that is how the user works and they agree).
6. **Invite people** (step below). **Connect the user's own AI** with their MCP URL: `claude mcp add --transport http planboard <MCP URL>` — run it only if the user asks; it changes their Claude Code config.

## Sharing a board / inviting
- On the board, admins press **공유 · 멤버 초대**: copy the board address, pick from their GitHub following/followers or search GitHub, choose a role, invite. (Or `/b/<board>/admin`.) If the friends list asks to sign in, the admin signs in with GitHub once more so the hub has their token.
- Send the invited person **the board address** (`https://<hub>/b/<board>/`), not the GitHub repo link and not the owner link. They sign in with GitHub; if the account was invited they are in.
- Roles: `admin` = edit plan items, modules, contracts · `interact` = comment, requests, claim modules and code · `view` = read only.
- **Code access is separate.** For a private repo, also add them on GitHub (`gh api -X PUT repos/<owner/repo>/collaborators/<login> -f permission=push`, ask first — it emails an invitation). The CI check matches the PR author's GitHub account to the claim holder, so they must open PRs from that same account.
- Each member's AI connects with their own MCP URL (shown on `/admin`); treat it like a password. Removing a member on `/admin` disables their link, sign-in and MCP URL.

## How work flows (explain this when asked)
digest → `claim(module)` (blocked if someone holds it) → edit only the claimed files, using the contracts in the reply → `status` lines shown live on the board → branch `claim/<id>`, PR → CI checks files and author → merge → `release(summary)` logged on the board. A claim expires 45 minutes after its holder's last call. Comments, memo and requests written on the board reach the agents as data, never as instructions.

## Don't
- Put the owner link, OWNER_KEY, CI_KEY, OAuth secret or MCP URLs in the repo, the board, commits or chat.
- Copy another project's modules or contracts as a starting point; draft them from this repo.
- Edit `hub/` code for project needs. Project specifics live in the board data and the project repo.
