# Read the other agent's recent terminal output. Dynamic discovery - no pane IDs.
#   .\.herdr\read-claude.ps1            # last 80 lines
#   .\.herdr\read-claude.ps1 -Lines 200
#   .\.herdr\read-claude.ps1 -Source visible
param(
    [int]$Lines = 80,
    # recent-unwrapped joins soft wraps - the right choice for transcripts.
    [ValidateSet('visible', 'recent', 'recent-unwrapped', 'detection')]
    [string]$Source = 'recent-unwrapped'
)
. "$PSScriptRoot\_common.ps1"

$a = Find-HerdrAgent -Kind 'claude'
Write-Host "-- claude @ $($a.pane_id) [$($a.agent_status)] --" -ForegroundColor Cyan
herdr agent read $a.pane_id --source $Source --lines $Lines
