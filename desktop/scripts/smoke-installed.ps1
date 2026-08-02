# Layer 2 installed-app smoke, Windows leg (macOS/Linux live in
# smoke-installed.sh): silently run the NSIS installer, launch the installed
# app like a user would, wait for the sidecar to publish its port at
# %APPDATA%\<identifier>\.mcp-port, assert /health, then run the Playwright
# suite in frontend/e2e-installed/ against the live app.
#
# Usage:
#   pwsh desktop/scripts/smoke-installed.ps1 -Installer <path.exe> [-ExpectedVersion 1.2.3]
#
# Requirements: node on PATH, frontend deps installed (npm ci) and a
# Playwright chromium (npx playwright install chromium). WebView2 is
# preinstalled on GitHub windows runners.
param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [string]$ExpectedVersion = ''
)
$ErrorActionPreference = 'Stop'

# Tauri's NSIS bundle defaults to a per-user install under
# $LOCALAPPDATA\<productName>; check Program Files too in case the install
# mode ever flips to perMachine.
Start-Process -FilePath (Resolve-Path $Installer) -ArgumentList '/S' -Wait

$roots = @(
  (Join-Path $env:LOCALAPPDATA 'Athena Accounting'),
  (Join-Path $env:ProgramFiles 'Athena Accounting')
)
$exe = $null
foreach ($root in $roots) {
  if (Test-Path $root) {
    $exe = Get-ChildItem -Path $root -Filter *.exe -Recurse |
      Where-Object { $_.Name -notmatch 'unins' } |
      Select-Object -First 1
    if ($exe) { break }
  }
}
if (-not $exe) { throw "installed exe not found under: $($roots -join ', ')" }
Write-Host "launching: $($exe.FullName)"

$dataDir = Join-Path $env:APPDATA 'com.athena.accounting.desktop'
$portFile = Join-Path $dataDir '.mcp-port'
Remove-Item -Force -ErrorAction SilentlyContinue $portFile

$proc = Start-Process -FilePath $exe.FullName -PassThru
try {
  # The sidecar writes .mcp-port right after Fastify binds (entry/tauri.ts).
  $port = $null
  foreach ($i in 1..120) {
    if (Test-Path $portFile) {
      $port = (Get-Content $portFile -Raw).Trim()
      if ($port) { break }
    }
    if ($proc.HasExited) { throw 'app exited before publishing a port' }
    Start-Sleep -Seconds 1
  }
  if (-not $port) { throw "timed out waiting for $portFile" }

  $base = "http://127.0.0.1:$port"
  Write-Host "sidecar bound on $base"
  $health = Invoke-RestMethod -Uri "$base/health" -TimeoutSec 30
  Write-Host "health: $($health | ConvertTo-Json -Compress)"
  if (-not $health.ok) { throw 'health not ok' }
  if ($health.driver -ne 'pglite') { throw "unexpected driver $($health.driver)" }
  if ($ExpectedVersion -and $health.version -ne $ExpectedVersion) {
    throw "version $($health.version) != expected $ExpectedVersion"
  }

  # Fast signal before the browser suite: the app must serve the SPA at /,
  # not just the API.
  $root = Invoke-WebRequest -Uri "$base/" -TimeoutSec 30 -UseBasicParsing
  if ($root.StatusCode -ne 200) { throw "GET / returned $($root.StatusCode) — SPA not served" }

  Push-Location (Join-Path $PSScriptRoot '..\..\frontend')
  try {
    $env:ATHENA_SMOKE_URL = $base
    $env:ATHENA_EXPECT_VERSION = $ExpectedVersion
    npx playwright test -c playwright.installed.config.ts
    if ($LASTEXITCODE -ne 0) { throw "playwright suite failed (exit $LASTEXITCODE)" }
  }
  finally { Pop-Location }

  Write-Host 'installed-app smoke passed'
}
finally {
  # Hard kill is fine here: the sidecar's parent watchdog exits with the
  # shell, and the smoke database is throwaway.
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
}
