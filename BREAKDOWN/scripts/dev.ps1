$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
$taskGuard = Join-Path $taskRoot 'artifacts\guard\Breakdown.Guard.exe'
if (!(Test-Path -LiteralPath $taskGuard)) { throw 'Run scripts/build.ps1 first.' }
$taskData = Join-Path $taskRoot '.dev\service'
$taskProcess = Start-Process -FilePath $taskGuard -ArgumentList @('--console','--pipe','BREAKDOWN-Dev','--data',('"' + $taskData + '"')) -WindowStyle Hidden -PassThru
try { & npm.cmd run dev }
finally { if (!$taskProcess.HasExited) { Stop-Process -Id $taskProcess.Id } }
