# CLAUDE.md

Repository instructions for Claude Code. Project rules live in `.claude/rules/`
(`AGENTS.md` there is mandatory: read `.playbook/known-issues.md` and
`.playbook/lessons-learned.md` before changing code). This file adds the
cross-agent collaboration protocol only.

---

# Herdr Collaboration

You may be running alongside a Codex agent in another Herdr pane for this same
repository.

**Important: Claude Code `ListAgents` is NOT the shared source of truth for Codex.**
`ListAgents` only enumerates Claude sessions. Codex will never appear in it. Do not
conclude that Codex is absent merely because `ListAgents` does not show it.

When the user mentions:

- "Codex bên cạnh"
- "Codex đang làm gì"
- "hỏi Codex"
- "đọc Codex"
- "phối hợp với Codex"

you MUST first use Herdr to discover the Codex pane.

## Workflow

1. Run `git status --short`.
2. Discover Herdr panes using the commands below.
3. Identify the Codex pane **for the current repository** (filter by `cwd`).
4. Read recent Codex output.
5. Determine: current task, currently edited files, ownership, and
   blocked/done/idle state.
6. Communicate through Herdr when needed.

**Never say "I cannot see Codex" before attempting Herdr discovery.**

Before editing a dirty or shared file:

- inspect the Codex pane
- determine whether Codex owns it
- do not overwrite Codex's uncommitted changes

## Preconditions

Herdr control only works from inside a Herdr-managed pane:

```bash
test "${HERDR_ENV:-}" = 1      # must be 1
```

`$HERDR_PANE_ID` is your own pane. Exclude it from lookups so you do not read or
message yourself.

## Commands

Prefer the helper scripts in `.herdr/` — they discover panes dynamically, filter by
this repository, exclude your own pane, and refuse to guess when ambiguous.

**These helpers work for you, not for Codex.** Codex loses Herdr socket access one
process hop down: from its pane `herdr agent list` succeeds, but
`powershell -NoProfile -Command herdr agent list` fails with
`Error: Os { code: 5, kind: PermissionDenied }`. So when you ask Codex to do
something involving Herdr, give it the **raw `herdr` commands**, never
`.\.herdr\*.ps1`. See the table in `AGENTS.md`.

```powershell
.\.herdr\find-agents.ps1                 # every agent Herdr sees; '*' = this repo
.\.herdr\status.ps1                      # both agents' state + git status --short
.\.herdr\read-codex.ps1                  # Codex's recent output (default 80 lines)
.\.herdr\read-codex.ps1 -Lines 200
.\.herdr\send-codex.ps1 "Review BE/app/main.py"
.\.herdr\send-codex.ps1 "long job" -TimeoutMs 600000
.\.herdr\send-codex.ps1 "fire and forget" -NoWait
```

Raw Herdr equivalents (Herdr 0.8.0-preview; `herdr agent` targets accept a pane ID
or a unique live agent name — **never** a terminal ID):

```bash
# Discover. Filter .result.agents[] by .agent == "codex" AND .cwd == <repo root>.
herdr agent list

# Read. recent-unwrapped joins soft wraps; best for transcripts.
herdr agent read <pane_id> --source recent-unwrapped --lines 120

# Send (submits text + Enter atomically, honours bracketed paste).
herdr agent prompt <pane_id> "<text>" --wait --timeout 120000

# State.
herdr agent get <pane_id>
herdr agent wait <pane_id> --until blocked --timeout 120000
herdr agent send-keys <pane_id> esc
```

Pane IDs (`w1:pD`, `w1:pM`, …) are **volatile** — they change between sessions and
are never reused after a pane closes. Always rediscover; never hardcode them.

State meanings: `idle` ready for input · `working` mid-turn · `blocked` waiting on a
human approval/question · `done` finished unseen background work · `unknown` present
but unclassified (**not** proof of completion).

---

# Shared File Ownership Protocol

Before editing shared files, each agent must identify ownership.

Task format:

```
TASK:
OWNER:
FILES:
DO NOT TOUCH:
ACCEPTANCE CRITERIA:
```

Rules:

- Never edit files actively owned by the other agent.
- Never reset/restore/stash/delete the other agent's uncommitted changes.
- Do not use destructive git operations without explicit user approval.
- Default to no commit and no push unless requested.
- Use `git diff --check` before reporting completion.
