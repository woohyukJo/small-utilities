param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9]+$')][string]$Serial,
  [Parameter(Mandatory=$true)][string]$HostAddress,
  [Parameter(Mandatory=$true)][string]$PhoneAddress,
  [Parameter(Mandatory=$true)][string]$ResultFile,
  [int]$Port=18432
)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskResult=[IO.Path]::GetFullPath($ResultFile)
if (!$taskResult.StartsWith($taskRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Result must stay in workspace' }
$taskAdmin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (!$taskAdmin) { throw 'Administrator is required for the temporary device-only firewall rule' }
$taskHost=[Net.IPAddress]::Parse($HostAddress)
$taskPhone=[Net.IPAddress]::Parse($PhoneAddress)
if ($taskHost.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $taskPhone.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'IPv4 addresses required' }
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw 'Test port already in use' }
$taskRule='BREAKDOWN device sync test ' + $PID
$taskAdb=Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$taskGuard=(Resolve-Path -LiteralPath 'artifacts\guard\Breakdown.Guard.exe').Path
$taskExit=1
try {
  New-NetFirewallRule -DisplayName $taskRule -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -RemoteAddress $PhoneAddress -Program $taskGuard -Profile Any | Out-Null
  & node scripts/device-sync-smoke.cjs $taskAdb $Serial $HostAddress $Port 2>&1 | Tee-Object -FilePath .dev/device-sync-smoke.log
  $taskExit=$LASTEXITCODE
} catch { $_.Exception.Message | Set-Content -LiteralPath (Join-Path $taskRoot '.dev\device-sync-error.txt') }
finally {
  Get-NetFirewallRule -DisplayName $taskRule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  @{exitCode=$taskExit; completedAt=[DateTimeOffset]::UtcNow.ToString('O')} | ConvertTo-Json | Set-Content -LiteralPath $taskResult
}
exit $taskExit
