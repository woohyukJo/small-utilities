param(
  [Parameter(Mandatory=$true)][string]$InstallDirectory,
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$ResultFile
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
$taskTarget = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
$taskInstaller = (Resolve-Path -LiteralPath $Installer).Path
$taskResult = [IO.Path]::GetFullPath($ResultFile)
$taskRegistry = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\69aa984a-66c8-521c-8bd9-a361cab4144f'
$taskReport = [ordered]@{ status='running'; stage='preflight'; target=$taskTarget; version=$taskVersion }
$taskStaging = $null

function Save-Stage([string]$Stage) {
  $taskReport.stage=$Stage
  $taskReport.updatedAt=[DateTimeOffset]::Now.ToString('O')
  $taskReport | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $taskResult -Encoding UTF8
  Write-Output $Stage
}
function Run-Installer([string]$File,[string]$Arguments) {
  $taskProcess = Start-Process -FilePath $File -ArgumentList $Arguments -WindowStyle Hidden -PassThru
  $taskDeadline = [DateTime]::UtcNow.AddMinutes(3)
  try {
    while (!$taskProcess.WaitForExit(1000)) {
      if ([DateTime]::UtcNow -gt $taskDeadline) { throw ('Timed out waiting for ' + [IO.Path]::GetFileName($File)) }
    }
    $taskProcess.Refresh()
    if ($taskProcess.ExitCode -ne 0) { throw ([IO.Path]::GetFileName($File) + ' exited with ' + $taskProcess.ExitCode) }
  } finally { $taskProcess.Dispose() }
}

try {
  $taskAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (!$taskAdmin) { throw 'Administrator elevation is required.' }
  if (!$taskResult.StartsWith($taskRoot + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Result file must stay in the project.' }
  if ([IO.Path]::GetFileName($taskTarget) -ine 'BREAKDOWN') { throw 'Unexpected install directory; refusing removal.' }
  $taskDirectory = Get-Item -LiteralPath $taskTarget
  if (($taskDirectory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Refusing a redirected install directory.' }
  if ($taskDirectory.FullName.TrimEnd('\') -ine $taskTarget) { throw 'Install directory did not resolve to the expected target.' }
  $taskUninstaller = Join-Path $taskTarget 'Uninstall BREAKDOWN.exe'
  if (!(Test-Path -LiteralPath $taskUninstaller -PathType Leaf)) { throw 'Original uninstaller is missing.' }
  if ([IO.Path]::GetFileName($taskInstaller) -ne ('BREAKDOWN Setup ' + $taskVersion + '.exe')) { throw 'Installer version/path mismatch.' }
  $taskExisting = Get-ItemProperty -LiteralPath $taskRegistry
  if (!$taskExisting.UninstallString.StartsWith('"' + $taskUninstaller + '"',[StringComparison]::OrdinalIgnoreCase)) { throw 'Registered uninstaller does not match this directory.' }
  $taskReport.oldVersion=$taskExisting.DisplayVersion
  $taskData = Join-Path $env:ProgramData 'BREAKDOWN'
  $taskProfile = Join-Path $env:LOCALAPPDATA 'BREAKDOWN\browser'
  $taskHadDatabase = Test-Path -LiteralPath (Join-Path $taskData 'gate.db')
  $taskHadProfile = Test-Path -LiteralPath $taskProfile
  Save-Stage 'stopping-existing-service'
  $taskService = Get-Service -Name BreakdownGuard -ErrorAction SilentlyContinue
  if ($taskService) {
    try {
      if ($taskService.Status -ne 'Stopped') {
        Stop-Service -Name BreakdownGuard -Force
        $taskService.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(30))
      }
    } finally { $taskService.Dispose() }
  }
  # Only processes executing from the explicitly verified installation directory.
  Get-Process -Name 'BREAKDOWN','Breakdown.Guard' -ErrorAction SilentlyContinue | ForEach-Object {
    $taskProcess = $_
    try {
      if ($taskProcess.Path -and $taskProcess.Path.StartsWith($taskTarget + '\',[StringComparison]::OrdinalIgnoreCase)) {
        Stop-Process -InputObject $taskProcess -Force
        if (!$taskProcess.WaitForExit(10000)) { throw 'An old BREAKDOWN process did not exit.' }
      }
    } finally { $taskProcess.Dispose() }
  }
  $taskStaging = Join-Path $taskRoot ('.dev\reinstall-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $taskStaging | Out-Null
  $taskUninstallerCopy = Join-Path $taskStaging 'Uninstall BREAKDOWN.exe'
  Copy-Item -LiteralPath $taskUninstaller -Destination $taskUninstallerCopy
  Save-Stage 'running-original-uninstaller'
  # NSIS _?= must be last and unquoted, including when the directory has spaces.
  Run-Installer $taskUninstallerCopy ('/S /allusers /KEEP_APP_DATA _?=' + $taskTarget)
  if (Test-Path -LiteralPath (Join-Path $taskTarget 'BREAKDOWN.exe')) { throw 'Uninstaller left the old executable in place.' }
  $taskDeadline = [DateTime]::UtcNow.AddSeconds(30)
  while (Test-Path -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\BreakdownGuard') {
    if ([DateTime]::UtcNow -gt $taskDeadline) { throw 'Old service is still pending deletion.' }
    Start-Sleep -Milliseconds 500
  }
  Save-Stage 'installing-same-directory'
  # NSIS /D= must be last and unquoted.
  Run-Installer $taskInstaller ('/S /allusers /D=' + $taskTarget)
  Save-Stage 'verifying-installation'
  $taskNew = Get-ItemProperty -LiteralPath $taskRegistry
  if ($taskNew.DisplayVersion -ne $taskVersion) { throw 'Registered version does not match the new build.' }
  if (!$taskNew.UninstallString.StartsWith('"' + $taskUninstaller + '"',[StringComparison]::OrdinalIgnoreCase)) { throw 'Installer selected a different directory.' }
  $taskImagePath = (Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\BreakdownGuard').ImagePath.Trim('"')
  if ($taskImagePath -ine (Join-Path $taskTarget 'resources\guard\Breakdown.Guard.exe')) { throw 'Service image path does not match the requested directory.' }
  $taskService = Get-Service -Name BreakdownGuard
  try { $taskService.WaitForStatus('Running',[TimeSpan]::FromSeconds(20)) } finally { $taskService.Dispose() }
  $taskExpectedGuard = Join-Path $taskRoot 'release\win-unpacked\resources\guard\Breakdown.Guard.exe'
  if ((Get-FileHash -LiteralPath $taskImagePath).Hash -ne (Get-FileHash -LiteralPath $taskExpectedGuard).Hash) { throw 'Installed guard binary does not match the build.' }
  $taskReport.databasePreserved = (!$taskHadDatabase) -or (Test-Path -LiteralPath (Join-Path $taskData 'gate.db'))
  $taskReport.browserProfilePreserved = (!$taskHadProfile) -or (Test-Path -LiteralPath $taskProfile)
  if (!$taskReport.databasePreserved -or !$taskReport.browserProfilePreserved) { throw 'An existing data directory was not preserved.' }
  $taskReport.status='complete'
  Save-Stage 'complete'
} catch {
  $taskReport.status='failed'
  $taskReport.error=$_.Exception.Message
  try { Save-Stage $taskReport.stage } catch {}
  Write-Error $_
  exit 1
} finally {
  if ($taskReport.status -eq 'complete' -and $taskStaging) {
    try {
      $taskStagingResolved = (Resolve-Path -LiteralPath $taskStaging).Path
      $taskStagingItem = Get-Item -LiteralPath $taskStagingResolved
      $taskExpectedParent = Join-Path $taskRoot '.dev'
      if ((Split-Path -Parent $taskStagingResolved) -ine $taskExpectedParent -or
          $taskStagingItem.Name -notmatch '^reinstall-[0-9a-f]{32}$' -or
          ($taskStagingItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Unexpected uninstaller staging directory.'
      }
      Remove-Item -LiteralPath (Join-Path $taskStagingResolved 'Uninstall BREAKDOWN.exe') -Force
      # The staging directory contains only the copied uninstaller. No recursive removal.
      Remove-Item -LiteralPath $taskStagingResolved -Force
    } catch { Write-Warning ('Installation succeeded; staging cleanup: ' + $_.Exception.Message) }
  }
}
