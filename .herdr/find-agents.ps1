# List every agent Herdr can see, marking the ones in THIS repository.
# Start here when a lookup fails: it shows what Herdr actually sees, not what
# Claude Code's own `ListAgents` sees (that one is Claude-only and never shows Codex).
. "$PSScriptRoot\_common.ps1"

$repo = Get-HerdrRepoRoot
Write-Host "repo: $repo" -ForegroundColor Cyan
if ($env:HERDR_PANE_ID) { Write-Host "self: $($env:HERDR_PANE_ID)" -ForegroundColor DarkGray }

Get-HerdrAgents |
    Select-Object @{n = 'here'; e = { if ($_.cwd -eq $repo) { '*' } else { '' } } },
                  agent, pane_id, agent_status,
                  @{n = 'self'; e = { if ($_.pane_id -eq $env:HERDR_PANE_ID) { '<- me' } else { '' } } },
                  cwd |
    Sort-Object here -Descending |
    Format-Table -AutoSize
