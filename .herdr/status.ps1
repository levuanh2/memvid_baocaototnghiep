# One-line state for both agents in this repository, plus the working tree.
# Read this before touching a shared file: `working` means the other agent is
# mid-edit, `blocked` means it is waiting on a human.
. "$PSScriptRoot\_common.ps1"

$repo = Get-HerdrRepoRoot
Write-Host "repo: $repo" -ForegroundColor Cyan

foreach ($kind in 'claude', 'codex') {
    try {
        $a = Find-HerdrAgent -Kind $kind -IncludeSelf
        $me = if ($a.pane_id -eq $env:HERDR_PANE_ID) { ' (me)' } else { '' }
        Write-Host ("  {0,-6} {1,-7} {2}{3}" -f $a.agent, $a.pane_id, $a.agent_status, $me)
    } catch {
        Write-Host ("  {0,-6} -- {1}" -f $kind, $_.Exception.Message.Split("`n")[0]) -ForegroundColor DarkYellow
    }
}

Write-Host "`nuncommitted:" -ForegroundColor Cyan
$st = git status --short
if ($st) { $st } else { Write-Host "  (clean)" }
