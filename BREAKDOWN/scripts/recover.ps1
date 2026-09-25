# Explicit administrator maintenance; only BREAKDOWN is affected.
param([ValidateSet('Stop','Start','Remove')][string]$Action = 'Stop')
$ErrorActionPreference = 'Stop'
$taskAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (!$taskAdmin) { throw 'Run PowerShell as administrator.' }
if ($Action -eq 'Start') { Start-Service -Name BreakdownGuard; return }
$taskService = Get-Service -Name BreakdownGuard -ErrorAction SilentlyContinue
if ($taskService) { Stop-Service -Name BreakdownGuard -Force; $taskService.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(20)) }
if ($Action -eq 'Remove') { & sc.exe delete BreakdownGuard; if ($LASTEXITCODE -ne 0) { throw 'Service removal failed' } }
