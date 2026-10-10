param([string]$KeyFile = '')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
if (!$KeyFile) { $KeyFile = Join-Path $taskRoot '.dev\amo-signing.json' }
try { $taskCredentials = Get-Content -LiteralPath $KeyFile -Raw | ConvertFrom-Json }
catch { throw 'Mozilla signing input is missing or is not valid JSON.' }
if (!$taskCredentials.apiKey -or !$taskCredentials.apiSecret) { throw 'Fill apiKey and apiSecret in the local signing input file first.' }
$taskCli = Join-Path $taskRoot 'tooling\firefox\node_modules\web-ext\bin\web-ext.js'
if (!(Test-Path -LiteralPath $taskCli)) { $taskCli = Join-Path $taskRoot '.tools\browser-dev\node_modules\web-ext\bin\web-ext.js' }
if (!(Test-Path -LiteralPath $taskCli)) { throw 'Install the project Firefox tools with pnpm first.' }
$taskOldKey = $env:WEB_EXT_API_KEY
$taskOldSecret = $env:WEB_EXT_API_SECRET
try {
    # Environment variables keep signing credentials out of command-line arguments and logs.
    $env:WEB_EXT_API_KEY = ([string]$taskCredentials.apiKey).Trim()
    $env:WEB_EXT_API_SECRET = ([string]$taskCredentials.apiSecret).Trim()
    & node $taskCli sign --channel unlisted --source-dir (Join-Path $taskRoot 'firefox-extension') --artifacts-dir (Join-Path $taskRoot 'artifacts\firefox') --approval-timeout 60000 --timeout 60000 --no-input --no-config-discovery
    if ($LASTEXITCODE -ne 0) { throw 'Mozilla signing did not finish. Inspect the non-secret validation result before retrying.' }
}
finally {
    $env:WEB_EXT_API_KEY = $taskOldKey
    $env:WEB_EXT_API_SECRET = $taskOldSecret
    $taskCredentials = $null
}
