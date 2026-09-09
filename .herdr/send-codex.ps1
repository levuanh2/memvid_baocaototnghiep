# Send a prompt to the other agent and wait for it to settle.
#   .\.herdr\send-codex.ps1 "Review BE/app/main.py"
#   .\.herdr\send-codex.ps1 "long job" -TimeoutMs 600000
#   .\.herdr\send-codex.ps1 "fire and forget" -NoWait
param(
    [Parameter(Mandatory, Position = 0)][string]$Text,
    [int]$TimeoutMs = 120000,
    [switch]$NoWait
)
. "$PSScriptRoot\_common.ps1"

$a = Find-HerdrAgent -Kind 'codex'
Write-Host "-> codex @ $($a.pane_id): $Text" -ForegroundColor Cyan

# 'agent prompt' submits text + Enter atomically and respects bracketed paste.
if ($NoWait) {
    herdr agent prompt $a.pane_id $Text
} else {
    herdr agent prompt $a.pane_id $Text --wait --timeout $TimeoutMs
}

# Long text arrives in the Codex TUI as a "[Pasted Content NNNN chars]" placeholder
# and the submit does NOT take effect -- the agent sits idle with the prompt sitting
# unsent in its input box, which looks exactly like "it ignored me". Observed at
# ~1100 chars; short prompts submit fine. Nudge Enter when it is still not working.
Start-Sleep -Milliseconds 1500
$after = (herdr agent get $a.pane_id | Out-String | ConvertFrom-Json).result.agent
if ($after.agent_status -ne 'working') {
    herdr agent send-keys $a.pane_id enter | Out-Null
    Write-Host "   (sent Enter: prompt was still unsubmitted)" -ForegroundColor DarkYellow
}
