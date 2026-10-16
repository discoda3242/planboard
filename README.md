# Planboard — a shared project board for working with Claude

Planboard is a **project planning board that runs as a claude.ai artifact**. You and your collaborators share a roadmap, design specs, comments and a memo. Claude reads what's new on the board before it starts work, and logs what it did when it's finished.

- **One page for every project.** All boards use the same `planboard.html` from this repo. Each project's content lives in that board's own artifact database.
- **Cheap for Claude to read.** Claude never reads the page itself. At the start of a task it reads one short digest the page keeps up to date (about 40–300 tokens). It skips comments it has already answered, and the digest stays small as your plan grows.
- **Optional: a request button.** Collaborators can queue work for Claude from the board. You choose how requests get run:
  - **Local:** your own Claude Code CLI picks them up.
  - **Cloud:** a small server starts a cloud run on your account.
- **Optional: a code map.** If you have the cloud server, the board can show your GitHub repo as a file and dependency graph that links back to plan items.

> The board's interface is currently in Korean. The data format and these docs are in English.

## What's in this repo

| Path | What it is |
|---|---|
| `planboard.html` | The board page. Publish it as-is; it reads all its text from the database. |
| `seed-example.json` | Example starting data: project info, phases and a spec. |
| `skills/planboard/` | Skill that teaches Claude how to create, read and log to a board. |
| `skills/planboard-run-button/` | Skill for setting up the request button (local or cloud). Optional. |
| `button-server/` | Cloudflare Worker for cloud runs and the code map. Optional. |

## Quick start

You need a Claude Pro, Max, Team or Enterprise plan.

1. **Install the skill.**
   - Zip the `skills/planboard` folder so the zip contains `planboard/SKILL.md`.
   - On claude.ai, go to **Settings → Capabilities → Skills → Upload skill**, upload the zip, and turn the skill on.
   - Claude Code CLI users can instead copy the folder to `~/.claude/skills/planboard/`.
2. **Ask Claude to make a board.**
   > Use the planboard skill to make a board for my project X. Phases: …, …

   Claude fetches `planboard.html` from this repo, publishes it as a new artifact, and fills in your content.
3. **Invite people.** Open the board and use **Share**. Collaborators need more than view-only access to comment or send requests.
4. **Connect your project.** Add the board link to your project's `CLAUDE.md`, for example "Planboard: <url> — read `notes/digest` at the start of each task." From then on, Claude checks the board when a task starts and logs to it when the task ends. This works in claude.ai and in the Claude Code CLI, where you sign in with `/login`.

## Using the board

| Tab | What it's for |
|---|---|
| **로드맵 (Roadmap)** | Phases, each with a goal, to-dos, a "done when" line and open questions. Each phase takes comments and proposals. |
| **코멘트 (Comments)** | General comments that don't belong to one phase. A badge counts the new ones. |
| **상세 설계 (Specs)** | Detailed design docs: rules, tables, numbers. |
| **구조 (Structure)** | A graph from phases to to-dos to specs. Click a node to jump to its card. |
| **메모장 (Memo)** | A shared free-form memo that saves automatically. |
| **요청 (Requests)** | The request button and a history of requests and Claude's answers. Only shown when set up. |

- When Claude replies to a comment, the comment is marked as handled. Claude doesn't read it again.
- To color a to-do by category, end it with `#tag`. To link items, write `[[s3]]` (any item id) in the text, and the Structure tab draws the link.

## Data format

Everything lives in the artifact's database. The page only renders it.

| Path | Contents | Written by |
|---|---|---|
| `project/info` | `{title, eyebrow, lead, footer, links[], tags[], project?, runUrl?, runMode?}` | owner / Claude |
| `items/{id}` | `{type: "phase"\|"spec", order, title, num?, badge?, state?, md}` | owner / Claude |
| `comments`, `replies/{commentId}` | people's comments / Claude's replies | collaborators / Claude |
| `log` | Claude's work log and status (working, review, done) | Claude |
| `notes/digest` | The short summary Claude reads. The page keeps it updated. | page |
| `notes/memo` | Shared memo | collaborators |
| `requests`, `req_replies`, `reqnotes`, `secret/run` | Request button | when set up |

How the `md` field is written:

- **Phase:** plain line = goal · `- to-do #tag` · `완료: …` = done-when line · `? …` = open question
- **Spec:** paragraphs · `- ` list · `> ` callout · `## ` subheading · `| a | b |` table · `※ ` small note · `**bold**`

See `seed-example.json` for an example.

## Request button (optional)

Collaborators type a request in the **요청** tab and send it. Claude does the work on **the board owner's account**, then writes an answer under the request and logs the work.

### Local mode (recommended to start)

```
board: request saved to requests/{id}  ──▶  owner's Claude Code CLI (watching)  ──▶  works in the repo, answers in req_replies/{id}
```

- **Nothing to deploy.** Set `runMode: "local"` in `project/info`.
- **The owner runs the watcher.** Start Claude Code in the project repo and run `/loop 10m check the planboard request queue and handle new requests`. Claude checks the queue every 10 minutes, does each new request, and replies on the board.
- **Requests only run while that session is open.** Until then they wait as "대기 중" (waiting).
- **Cost:** your subscription's usage. Each idle check is one small database read.
- **Safety:** requests come from other people and run on your machine. Claude treats them as untrusted and limits itself to the project repo and the board. Keep Claude Code in a permission mode where it asks before running commands you haven't allowed.

### Cloud mode

```
board ──new tab──▶ button server (Cloudflare Worker) ──API──▶ owner's routine on claude.ai ──▶ Claude works, logs to the board
```

- **Runs without your computer.** Requests run in the cloud.
- **Setup:** one Worker, one routine per project, and a few secrets. See `button-server/README.md`.
- **Access:** the board holds a hidden run key that only collaborators can read, and the server checks it.
- **Cost:** subscription usage, with no separate API billing. Each routine can run 30 times per hour.
- **Approval step:** a run started by API waits for the owner's approval before it republishes an artifact. If requests should change your app, host the app as a repo that auto-deploys (for example on Cloudflare Pages) rather than as an artifact.

## Code map (cloud server only)

The **코드 구조 보기** (code map) button on the Structure tab opens your GitHub repo as a graph. It's built fresh from the latest commit each time and doesn't use Claude.

- **Solid line:** one file mentions another by name (imports, requires, build scripts, doc links).
- **Dashed line:** a file calls a function defined in another file.
- **Pink nodes:** plan items linked with a `// @plan s3` comment at the top of a file. Click one to jump to that item on the board.
- **Requirement:** one read-only `GITHUB_TOKEN` secret on the button server, shared by all your projects.

## Updating the page

To change features, edit `planboard.html` in this repo, then republish the same file to each of your boards. Their content stays because it lives in each board's database. You can ask Claude: "Republish the updated planboard template to my boards."

## Publishing by hand

The page uses the artifact database (`db`) and viewer identity (`user`) capabilities, so it only works when published as a claude.ai artifact. Publish it with these capabilities:

```json
{"db":{"rules":[{"path":"project","write":"admin"},{"path":"items","write":"admin"},{"path":"log","write":"admin"},{"path":"replies","write":"admin"},{"path":"board","write":"admin"},{"path":"req_replies","write":"admin"},{"path":"secret","read":"interact","write":"admin"}]},"user":{"scopes":["profile","email"]}}
```

On an ordinary web server, the page only shows a note asking you to open it on claude.ai.
