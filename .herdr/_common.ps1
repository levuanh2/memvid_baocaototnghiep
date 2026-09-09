# Shared discovery for the Herdr agent bridge. Dot-source this; don't run it.
#
# Why this file exists: `herdr agent list` returns EVERY agent in the Herdr session,
# including agents working in other repositories. Messaging the wrong pane means
# telling an agent in an unrelated project to edit files here. Every lookup below
# filters by the current repository root and refuses to guess when ambiguous.
#
# No pane IDs are hardcoded anywhere. Pane IDs (w1:pD, w1:pM, ...) change every
# session and are never reused after a pane closes.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-HerdrRepoRoot {
    # Herdr reports `cwd` with Windows separators; git reports forward slashes.
    $root = git rev-parse --show-toplevel 2>$null
    if (-not $root) { throw "Not inside a git repository." }
    return ($root -replace '/', '\')
}

function Assert-HerdrEnv {
    # Outside Herdr the CLI would talk to whatever session happens to be running,
    # which is somebody else's terminal. Fail loudly instead.
    if ($env:HERDR_ENV -ne '1') {
        throw "Not running inside a Herdr pane (HERDR_ENV != 1). Start this agent from Herdr."
    }
}

function Get-HerdrAgents {
    Assert-HerdrEnv

    # Deliberately NO `2>&1`. In PowerShell 5.1 redirecting a native command's stderr
    # wraps every stderr line in an ErrorRecord (NativeCommandError) and flips `$?` to
    # false even when the exe exits 0 -- and with $ErrorActionPreference='Stop' that
    # becomes a terminating error. herdr writes benign warnings to stderr in some
    # contexts (observed: "Os { code: 5, kind: PermissionDenied }" from the Codex pane)
    # while stdout still carries valid JSON. Capturing stdout alone and trusting the
    # exit code is the only reading that works from both agents' shells.
    $raw = herdr agent list
    if ($LASTEXITCODE -ne 0) {
        throw "herdr agent list failed (exit $LASTEXITCODE). Is the Herdr server running?"
    }
    if (-not $raw) { throw "herdr agent list returned nothing." }

    try {
        $parsed = ($raw | Out-String) | ConvertFrom-Json
    } catch {
        throw "herdr agent list returned non-JSON output: $($raw | Out-String)"
    }
    return $parsed.result.agents
}

<#
.SYNOPSIS
Find the one live agent of a given kind working in THIS repository.

.DESCRIPTION
Returns a single agent object. Throws with a readable message when there is no
match or more than one - never picks a candidate on its own, because sending to
the wrong agent is worse than sending to none.
#>
function Find-HerdrAgent {
    param(
        [Parameter(Mandatory)][ValidateSet('claude', 'codex')][string]$Kind,
        [switch]$IncludeSelf
    )

    $repo = Get-HerdrRepoRoot
    $all = @(Get-HerdrAgents | Where-Object { $_.agent -eq $Kind -and $_.cwd -eq $repo })

    # Exclude the calling pane so `read-claude` from Claude doesn't read itself.
    $found = $all
    if (-not $IncludeSelf -and $env:HERDR_PANE_ID) {
        $found = @($all | Where-Object { $_.pane_id -ne $env:HERDR_PANE_ID })
    }

    if ($found.Count -eq 0) {
        # Distinguish "the only candidate is me" from "nobody is there". Telling an
        # agent to go start itself is the kind of error message that wastes a turn.
        if ($all.Count -gt 0) {
            throw ("The only '$Kind' agent in $repo is this pane ($($env:HERDR_PANE_ID)).`n" +
                   "You are asking to talk to yourself. Target the OTHER agent instead.")
        }
        throw ("No '$Kind' agent is running in $repo.`n" +
               "Open a Herdr pane in this repository and start $Kind there, then retry.`n" +
               "Run .\.herdr\find-agents.ps1 to see every agent Herdr can see.")
    }
    if ($found.Count -gt 1) {
        $ids = ($found | ForEach-Object { "$($_.pane_id) [$($_.agent_status)]" }) -join ', '
        throw ("Ambiguous: $($found.Count) '$Kind' agents in $repo -> $ids`n" +
               "Refusing to guess. Target one explicitly, e.g.:`n" +
               "  herdr agent read <pane_id> --source recent-unwrapped --lines 80")
    }
    return $found[0]
}
