// CI: a pull request may only change files inside the module its claim holds on the planboard hub.
// The claim comes from the branch name (claim/<id>) or "Planboard-Claim: <id>" lines in commit messages,
// and the PR author's GitHub account must be the claim holder's (members are registered by GitHub username).
// Needs repo variable PLANBOARD_HUB (https://<hub>/b/<board>) and secret PLANBOARD_CI_KEY. Without them it only reports.
import { execFileSync } from 'node:child_process';
const [base, head] = process.argv.slice(2);
const { HUB, CI_KEY, BRANCH = '', ACTOR = '' } = process.env;
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
if (!HUB || !CI_KEY) { console.log('PLANBOARD_HUB / PLANBOARD_CI_KEY not set: skipping the claim check.'); process.exit(0); }
const files = git('diff', '--name-only', `${base}...${head}`).split('\n').filter(Boolean);
const msgs = git('log', '--format=%B', `${base}..${head}`);
const claims = [...new Set([...msgs.matchAll(/^Planboard-Claim:\s*([A-Za-z0-9]+)\s*$/gm)].map((m) => m[1]))];
const r = await fetch(HUB.replace(/\/$/, '') + '/api/ci-check', { method: 'POST', headers: { Authorization: 'Bearer ' + CI_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ files, claims, branch: BRANCH, actor: ACTOR }) });
if (!r.ok) { console.log(`::error::planboard hub check failed (${r.status})`); process.exit(1); }
const j = await r.json();
console.log(`${files.length} files · branch ${BRANCH} · author ${ACTOR} · claims ${claims.join(', ') || '(from branch)'}`);
if (!j.ok) { for (const b of j.bad) console.log('::error::' + b); process.exit(1); }
console.log('ok: every change is inside the claimed module');
