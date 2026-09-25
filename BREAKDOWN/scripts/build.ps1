param([switch]$Installer)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskSdk = Join-Path $taskRoot '.tools\dotnet\dotnet.exe'
if (!(Test-Path -LiteralPath $taskSdk)) { $taskSdk = (Get-Command dotnet -ErrorAction Stop).Source }
$env:DOTNET_ROOT = Split-Path -Parent $taskSdk
$env:DOTNET_CLI_HOME = Join-Path $taskRoot '.tools\dotnet-home'
$env:NUGET_PACKAGES = Join-Path $taskRoot '.tools\nuget'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$taskDist = Join-Path $taskRoot 'dist'
foreach ($taskStaleTarget in @('conversation-target.json','conversation-target.example.json')) {
  $taskStalePath = Join-Path $taskDist $taskStaleTarget
  if (Test-Path -LiteralPath $taskStalePath) {
    $taskFullStale = [IO.Path]::GetFullPath($taskStalePath)
    if (!$taskFullStale.StartsWith([IO.Path]::GetFullPath($taskDist) + '\',[StringComparison]::OrdinalIgnoreCase)) {
      throw 'Refusing unexpected stale target cleanup path'
    }
    Remove-Item -LiteralPath $taskFullStale -Force
  }
}
& $taskSdk run --project native/Breakdown.Tests -c Release
if ($LASTEXITCODE -ne 0) { throw 'Core tests failed' }
& $taskSdk publish native/Breakdown.Host -c Release -r win-x64 --self-contained true -o artifacts/guard -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
if ($LASTEXITCODE -ne 0) { throw 'Guard build failed' }
& npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Desktop tests failed' }
& node scripts/ipc-smoke.cjs
if ($LASTEXITCODE -ne 0) { throw 'Named Pipe integration failed' }
& node scripts/peer-sync-smoke.cjs
if ($LASTEXITCODE -ne 0) { throw 'Peer TLS integration failed' }
foreach ($taskSmoke in @(
  @{Name='dom'; Script='dist/dom-smoke.js'; Variable='BREAKDOWN_DOM_FIXTURE'},
  @{Name='ui'; Script='scripts/ui-smoke.cjs'; Variable='BREAKDOWN_UI_FIXTURE'}
)) {
$taskFixture = Join-Path $taskRoot ('.dev\' + $taskSmoke.Name + '-fixture-' + $PID)
Set-Item -LiteralPath ('Env:' + $taskSmoke.Variable) -Value $taskFixture
try {
  & node_modules\.bin\electron.cmd $taskSmoke.Script
  if ($LASTEXITCODE -ne 0) { throw ($taskSmoke.Name + ' fixture failed') }
}
finally {
  Remove-Item -LiteralPath ('Env:' + $taskSmoke.Variable) -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $taskFixture) {
    $taskResolved = (Resolve-Path -LiteralPath $taskFixture).Path
    if ($taskResolved -ine $taskFixture -or !$taskResolved.StartsWith($taskRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected fixture cleanup path' }
    $taskLinks = @(Get-Item -LiteralPath $taskFixture -Force) + @(Get-ChildItem -LiteralPath $taskFixture -Force -Recurse)
    if ($taskLinks | Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }) { throw 'Refusing linked fixture cleanup' }
    Remove-Item -LiteralPath $taskResolved -Recurse -Force
  }
}
}
if ($Installer) { & npm.cmd run installer } else { & npm.cmd run pack }
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed' }
& node scripts/check-distribution.cjs
if ($LASTEXITCODE -ne 0) { throw 'Distribution payload validation failed' }
