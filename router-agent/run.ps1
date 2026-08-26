# Start the ChoreKey router agent. Double-click-safe / Task-Scheduler-safe.
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

# Fresh shells on this PC need Node on PATH.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $env:Path += ';C:\Program Files\nodejs'
}

if (-not (Test-Path '.env')) {
  Write-Error "No .env found. Copy .env.example to .env and fill in ROUTER_PASSWORD + SUPABASE_SERVICE_ROLE_KEY."
}

node src/main.js
