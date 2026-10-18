# Planboard — a shared project board for working with Claude

Planboard is a **project planning board** that you share with collaborators and with Claude. It holds a roadmap, design specs, comments and a shared memo. Claude reads what's new on the board before it starts work, and logs what it did when it's finished.

You can run the same board page in two ways:

| | **On claude.ai** (artifact) | **On your computer** (local server) |
|---|---|---|
| Where the page runs | claude.ai artifact | `node local/server.mjs` on your machine |
| Where the data lives | the artifact's database | plain files in your project: `planboard/` (plan items are Markdown) |
| Who can open it | people you share the artifact with | people you send an invite link to |
| Request button | optional: Cloudflare Worker + claude.ai routine | built in: runs Claude Code on your machine |
| Code map | optional: from GitHub, through the Worker | built in: from your local files |
| Needs | Claude Pro, Max, Team or Enterprise | Node 20+; a coding agent CLI (Claude Code, Codex, Gemini…) for requests; `cloudflared` to share outside your network |
| AI | Claude only | any file-editing agent |

> The board's interface is currently in Korean. The data format and these docs are in English.

## What's in this repo

| Path | What it is |
|---|---|
| `planboard.html` | The board page, shared by both modes. Publish or serve it as-is: it reads all its text from the data. |
| `local/` | The local server (`server.mjs`) and the browser shim it injects (`pb-local.js`). No dependencies. |
| `seed-example.json` | Example starting data: project info, phases and a spec. |
| `skills/planboard/` | Skill that teaches Claude to create, read and log to a board, in either mode. |
| `skills/planboard-run-button/` | Skill for the claude.ai request button (cloud). Optional. |
| `button-server/` | Cloudflare Worker for the claude.ai request button and GitHub code map. Optional. |
| `hub/` | **Planboard hub**: the board on Cloudflare with an MCP endpoint, so several people's AIs claim modules, get interface contracts and report progress live without stepping on each other. See `hub/README.md`. |

---

## Option A: Run it on your computer

1. **Get this repo.**
   ```
   git clone https://github.com/discoda3242/planboard
   ```
2. **Start the server for your project.**
   ```
   node planboard/local/server.mjs /path/to/your-project --tunnel
   ```
   - The board's data goes in `your-project/planboard/`. Commit it with your code if you like.
   - Invite tokens are kept in `your-project/planboard/.secret/`, which is git-ignored.
   - The first run prints **your owner link**. Open it once and your browser stays signed in.
3. **Invite people.** Open `/admin`, enter a name, an optional email and a role, and send that person the link it creates.
   - **collaborator:** can comment, edit the memo and send requests.
   - **view only:** can read the board.
   - **admin:** can do everything a collaborator can, edit plan data through the page, and manage members.
   - Removing someone disables their link.
4. **Share it beyond your machine.**
   - **Over the internet:** `--tunnel` starts a free Cloudflare quick tunnel and gives you a public `https://….trycloudflare.com` URL. It needs [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) installed. Invite links on `/admin` use that URL automatically. The URL changes each time the tunnel restarts, so send new links after a restart.
   - **On your local network:** use `--lan` instead.
   - **Only you:** use neither flag.

**Requests**
- When a collaborator sends a request from the **요청** tab, the server runs a coding agent CLI in your project folder, one request at a time.
- The agent's final message appears under the request. The agent can also update plan files, reply to comments and add a log entry.
- It uses that agent's login and subscription on your machine.

**Which agent**
- The local board is plain files, so any agent that can read and edit files can use it. Choose one with `--agent` (saved in `.secret/config.json` as `run.agent`):
  - `claude` (default): Claude Code, `claude -p`
  - `codex`: OpenAI Codex CLI, `codex exec`
  - `gemini`: Gemini CLI, `gemini -p`
- **Any other CLI:** set `run.cmd` in the config to an argument list containing `"{prompt}"`, for example `["aider", "--yes", "--message", "{prompt}"]`.
- **Check flags first:** the codex and gemini presets assume current CLI flags. Check `codex exec --help` or `gemini --help` before relying on them.
- **Per-agent safety:** only the Claude preset restricts which tools can run, through `run.allowedTools`. With the others, safety depends on each CLI's sandbox and approval settings.

**Code map**
- **코드 구조 보기** (code map) on the Structure tab draws your project's files from disk.
- In a git repo it follows `git ls-files`, so ignored files are skipped.

**Safety**
- Requests come from other people and run on your machine.
- By default Claude may only read and edit files in the project and run a few safe git and `node --check` commands. It can't push.
- To change that, edit `run.allowedTools` in `planboard/.secret/config.json`. Set `run.enabled` to `false` to turn requests off.
- Anyone with an invite link can get in, so treat links like passwords.

**Working with an agent yourself:** add this to your project's agent instructions (`CLAUDE.md`, `AGENTS.md` for Codex, `GEMINI.md` for Gemini):

```
Planboard (local): read planboard/notes/digest.md at the start of each task.
Plan items are planboard/items/<id>.md. When done, add planboard/log/<id>.json and planboard/replies/<commentId>.json.
```

Server options: `--port 8787`, `--data planboard` (data folder inside the project), `--lan`, `--host`, `--tunnel`, `--name <owner name>`, `--agent claude|codex|gemini`.

---

## Option B: Run it on claude.ai

1. **Install the skill.**
   - Zip the `skills/planboard` folder so the zip contains `planboard/SKILL.md`.
   - On claude.ai, go to **Settings → Capabilities → Skills → Upload skill**, upload the zip, and turn the skill on.
   - Claude Code users can instead copy the folder to `~/.claude/skills/planboard/`.
2. **Ask Claude to make a board.**
   > Use the planboard skill to make a board for my project X. Phases: …, …

   Claude publishes `planboard.html` as a new artifact and fills in your content.
3. **Invite people.** Open the board and use **Share**. Collaborators need more than view-only access to comment.
4. **Connect your project.** Add the board link to your project's `CLAUDE.md`, for example "Planboard: <url> — read `notes/digest` at the start of each task."

**Request button (optional)**
- **Flow:** a collaborator presses the button, a small Cloudflare Worker starts a routine on the owner's claude.ai account, and Claude works in the cloud and answers on the board.
- **Cost:** subscription usage, with no separate API billing. Each routine can run 30 times per hour.
- **Approval:** a run started by API waits for the owner's approval before it republishes an artifact.
- **Setup:** see `button-server/README.md`.

**Code map (optional):** the same Worker reads your GitHub repo with one read-only `GITHUB_TOKEN`.

**Publishing by hand:** the page needs these artifact capabilities:

```json
{"db":{"rules":[{"path":"project","write":"admin"},{"path":"items","write":"admin"},{"path":"log","write":"admin"},{"path":"replies","write":"admin"},{"path":"board","write":"admin"},{"path":"req_replies","write":"admin"},{"path":"secret","read":"interact","write":"admin"}]},"user":{"scopes":["profile","email"]}}
```

---

## Using the board

| Tab | What it's for |
|---|---|
| **로드맵 (Roadmap)** | Phases, each with a goal, to-dos, a "done when" line and open questions. Each phase takes comments and proposals. |
| **코멘트 (Comments)** | General comments that don't belong to one phase. |
| **상세 설계 (Specs)** | Detailed design docs: rules, tables, numbers. |
| **구조 (Structure)** | A graph from phases to to-dos to specs, plus the code map button. |
| **메모장 (Memo)** | A shared memo that saves automatically. |
| **요청 (Requests)** | Send work to Claude, and see each request with Claude's answer. Only shown when requests are set up. |

- **Handled comments:** once Claude replies to a comment, the comment is marked handled and Claude doesn't read it again.
- **Tags:** end a to-do with `#tag` to color it by category.
- **Links:** write `[[s3]]` (any item id) in an item's text to draw a link to that item on the Structure tab.
- **Linking code to the plan:** put a `// @plan s3` comment at the top of a code file. The code map then links that file to the plan item.

## Data format

Both modes store the same documents. On claude.ai they're in the artifact database. Locally, each document is a file under `planboard/`. Plan items and the digest are Markdown with front matter. Everything else is JSON.

| Document | Local file | Contents |
|---|---|---|
| `project/info` | `project/info.json` | `{title, eyebrow, lead, footer, links[], tags[]}` |
| `items/{id}` | `items/{id}.md` | front matter `type: phase\|spec`, `order`, `title`, `num?`, `badge?`, `state?`; body = `md` |
| `comments/{id}`, `replies/{commentId}` | `comments/…json`, `replies/…json` | people's comments / Claude's replies |
| `log/{id}` | `log/…json` | Claude's work log `{text, phase, state, at}` |
| `notes/digest` | `notes/digest.md` | Short summary for Claude. The page keeps it up to date. |
| `notes/memo` | `notes/memo.json` | Shared memo |
| `requests`, `req_replies`, `reqnotes` | same names | Requests, answers and notes on requests |

How the `md` body is written:

- **Phase:** plain line = goal · `- to-do #tag` · `완료: …` = done-when line · `? …` = open question
- **Spec:** paragraphs · `- ` list · `> ` callout · `## ` subheading · `| a | b |` table · `※ ` small note · `**bold**`

Example local item, `planboard/items/p1.md`:

```markdown
---
type: phase
order: 1
title: "Phase 1: core loop"
num: 1
---
Enemies spawn and the player can fight back.
- Enemy spawner #core
- Basic weapon #core
완료: a full wave is playable
? endless mode or fixed waves
```

## Updating the page

Edit `planboard.html` in this repo.
- **Local boards:** pick up the change on the next page load.
- **claude.ai boards:** republish the same file to each board. Their content stays because it lives in each board's database.
