# Register the ChoreKey router agent as a Windows Scheduled Task that starts at
# logon and auto-restarts if it dies. Run this once, from an elevated PowerShell:
#     powershell -ExecutionPolicy Bypass -File .\install-task.ps1
# Remove later with:  Unregister-ScheduledTask -TaskName 'ChoreKey Router Agent'
$ErrorActionPreference = 'Stop'
$taskName = 'ChoreKey Router Agent'
$runScript = Join-Path $PSScriptRoot 'run.ps1'

if (-not (Test-Path $runScript)) { Write-Error "run.ps1 not found next to this script." }

$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runScript`""

# At logon of the current user (this PC is the always-on host).
$trigger = New-ScheduledTaskTrigger -AtLogOn

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -RestartCount 999 `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force

Write-Host "Registered scheduled task '$taskName'. Start it now with:"
Write-Host "  Start-ScheduledTask -TaskName '$taskName'"
