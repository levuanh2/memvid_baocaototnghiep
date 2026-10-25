$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot.Replace('\', '/')
$output = Join-Path $PSScriptRoot 'screenshots'

$captures = @(
  @{ Name = 'workspace-desk-1440x900-light.png'; Width = 1440; Height = 900; Query = 'theme=light,layout=desk' },
  @{ Name = 'workspace-desk-1440x900-dark.png'; Width = 1440; Height = 900; Query = 'theme=dark,layout=desk' },
  @{ Name = 'workspace-desk-820x1180-light.png'; Width = 820; Height = 1180; Query = 'theme=light,layout=desk' },
  @{ Name = 'workspace-desk-820x1180-dark.png'; Width = 820; Height = 1180; Query = 'theme=dark,layout=desk' },
  @{ Name = 'workspace-desk-390x844-light.png'; Width = 390; Height = 844; Query = 'theme=light,layout=desk' },
  @{ Name = 'workspace-desk-390x844-dark.png'; Width = 390; Height = 844; Query = 'theme=dark,layout=desk' },
  @{ Name = 'workspace-desk-320x844-light-stress.png'; Width = 320; Height = 844; Query = 'theme=light,layout=desk' },
  @{ Name = 'workspace-focus-1440x900-light.png'; Width = 1440; Height = 900; Query = 'theme=light,layout=focus' },
  @{ Name = 'workspace-focus-1440x900-dark.png'; Width = 1440; Height = 900; Query = 'theme=dark,layout=focus' }
)

foreach ($capture in $captures) {
  $target = Join-Path $output $capture.Name
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
  $url = "file:///$root/workspace.html?$($capture.Query)"
  & npx.cmd --yes --package=playwright@1.64.1 playwright screenshot --browser chromium --viewport-size "$($capture.Width), $($capture.Height)" --wait-for-timeout 150 $url $target
  if (-not (Test-Path -LiteralPath $target)) { throw "Capture was not created: $target" }
}
