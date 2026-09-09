# AGENTS.md

Shared instructions for coding agents in this repository (Codex reads this file;
Claude Code reads `CLAUDE.md`, which carries the same protocol).

Project rules live in `.claude/rules/`. `.claude/rules/AGENTS.md` is mandatory:
read `.playbook/known-issues.md` and `.playbook/lessons-learned.md` before changing
code, and update `.playbook` after fixing a bug.

---

# Herdr Collaboration

A Claude Code agent may be running in another Herdr pane for the same repository.

Use Herdr as the shared agent communication layer.

When asked about Claude:

1. discover Herdr panes
2. identify Claude for the current repo
3. read its recent output
4. communicate through Herdr

**Do not assume Claude is unavailable because it does not appear in Codex-internal
state.** Each agent's own session list only shows agents of its own kind. Herdr is
the only layer that sees both.

Before modifying dirty or shared files:

- run `git status --short`
- inspect Claude's pane
- determine ownership
- do not overwrite another agent's uncommitted work

## Preconditions

Herdr control only works from inside a Herdr-managed pane:

```bash
test "${HERDR_ENV:-}" = 1      # must be 1
```

`$HERDR_PANE_ID` is your own pane. Exclude it from lookups so you do not read or
message yourself.

---

# Communication commands

## IMPORTANT: which surface works for which agent

Verified on this machine, 2026-09-09:

| invocation | Claude Code | Codex |
|---|---|---|
| `herdr agent list/read/prompt` run directly | works | **works** |
| the same command inside a `.ps1` / any nested child process | works | **fails** |

Codex loses Herdr socket access in child processes it spawns. Proof: from the Codex
pane, `herdr agent list` succeeds, while `powershell -NoProfile -Command herdr agent
list` fails with `Error: Os { code: 5, kind: PermissionDenied }`. The env vars are
inherited correctly (`HERDR_ENV=1`); it is the socket call that is denied one process
hop down.

**Therefore: Codex must use the raw `herdr` commands below and must NOT call the
`.herdr\*.ps1` helpers.** Those helpers are a Claude-side convenience. They are
listed here only so both agents recognise them; they are not part of the Codex path.


Verified working on this machine (Herdr `0.8.0-preview.2026-08-04-d78e3d3b5126`,
Windows). Each section gives the raw command (works for **both** agents) and, marked
`Claude only`, the PowerShell helper in `.herdr/` (discovers panes dynamically,
filters by this repository, excludes the calling pane, and fails with a readable
error rather than messaging the wrong agent).

## Discover panes

```powershell
# Claude only -- fails from Codex (see table above)
.\.herdr\find-agents.ps1
```

```bash
herdr agent list
# then filter .result.agents[] by .cwd == <repo root, Windows separators>
# and .agent == "claude" | "codex"; drop the entry whose .pane_id == $HERDR_PANE_ID
```

`herdr pane list` is the fallback when an agent is running but not classified —
inspect `cwd`, `terminal_title_stripped`, and `agent_status` there.

## Read Claude

```powershell
# Claude only -- fails from Codex (see table above)
.\.herdr\read-claude.ps1 -Lines 120
```

```bash
herdr agent read <claude_pane_id> --source recent-unwrapped --lines 120
```

## Read Codex

```powershell
# Claude only -- fails from Codex (see table above)
.\.herdr\read-codex.ps1 -Lines 120
```

```bash
herdr agent read <codex_pane_id> --source recent-unwrapped --lines 120
```

Read sources: `visible` (viewport) · `recent` (with soft wraps) ·
`recent-unwrapped` (wraps joined — best for transcripts) · `detection`.

## Send to Claude

```powershell
# Claude only -- fails from Codex (see table above)
.\.herdr\send-claude.ps1 "Please review BE/app/main.py"
```

```bash
herdr agent prompt <claude_pane_id> "<text>" --wait --timeout 120000
```

## Send to Codex

```powershell
# Claude only -- fails from Codex (see table above)
.\.herdr\send-codex.ps1 "Please review BE/app/main.py"
```

```bash
herdr agent prompt <codex_pane_id> "<text>" --wait --timeout 120000
```

`agent prompt` submits the text and Enter atomically and honours the pane's live
bracketed-paste mode. Use `--NoWait` / omit `--wait` for fire-and-forget.

## Status / wait

```powershell
# Claude only -- fails from Codex (see table above)
.\.herdr\status.ps1
```

```bash
herdr agent get  <pane_id>
herdr agent wait <pane_id> --until blocked --timeout 120000   # or idle|working|done
herdr agent send-keys <pane_id> esc                           # cancel a prompt UI
herdr agent explain <pane_id>                                 # why a state was inferred
```

States: `idle` ready · `working` mid-turn · `blocked` awaiting human approval ·
`done` finished unseen background work · `unknown` present but unclassified (not
proof of completion).

## Pane IDs are volatile

`w1:pD`, `w1:pM`, … change every session and are never reused after a pane closes.
No pane ID is stored in this repository. Always rediscover by `cwd` + agent kind.

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
