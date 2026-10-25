$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot.Replace('\', '/')
$output = Join-Path $PSScriptRoot 'screenshots'
$captures = @(
  @{ Screen = 'mindmap'; Theme = 'light'; Width = 1440; Height = 900 },
  @{ Screen = 'mindmap'; Theme = 'dark'; Width = 1440; Height = 900 },
  @{ Screen = 'mindmap'; Theme = 'light'; Width = 820; Height = 1180 },
  @{ Screen = 'mindmap'; Theme = 'dark'; Width = 820; Height = 1180 },
  @{ Screen = 'mindmap'; Theme = 'light'; Width = 390; Height = 844 },
  @{ Screen = 'mindmap'; Theme = 'dark'; Width = 390; Height = 844 },
  @{ Screen = 'mindmap'; Theme = 'light'; Width = 320; Height = 844 },
  @{ Screen = 'studymap'; Theme = 'light'; Width = 1440; Height = 900 },
  @{ Screen = 'studymap'; Theme = 'dark'; Width = 1440; Height = 900 },
  @{ Screen = 'studymap'; Theme = 'light'; Width = 820; Height = 1180 },
  @{ Screen = 'studymap'; Theme = 'dark'; Width = 820; Height = 1180 },
  @{ Screen = 'studymap'; Theme = 'light'; Width = 390; Height = 844 },
  @{ Screen = 'studymap'; Theme = 'dark'; Width = 390; Height = 844 },
  @{ Screen = 'studymap'; Theme = 'light'; Width = 320; Height = 844 }
)

foreach ($capture in $captures) {
  $name = "$($capture.Screen)-$($capture.Width)x$($capture.Height)-$($capture.Theme)$(if ($capture.Width -eq 320) { '-stress' }).png"
  $target = Join-Path $output $name
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
  $url = "file:///$root/maps.html?screen=$($capture.Screen),theme=$($capture.Theme)"
  & npx.cmd --yes --package=playwright@1.64.1 playwright screenshot --browser chromium --viewport-size "$($capture.Width), $($capture.Height)" --wait-for-timeout 150 $url $target
  if (-not (Test-Path -LiteralPath $target)) { throw "Capture was not created: $target" }
}
