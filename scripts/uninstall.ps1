$ErrorActionPreference = "Stop"
$InstallRoot = Join-Path $env:LOCALAPPDATA "Programs\CopilotSessionHub"
$StartupScript = Join-Path ([Environment]::GetFolderPath("Startup")) "Copilot Session Hub.cmd"

try {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:43120/api/shutdown" -TimeoutSec 2 | Out-Null
} catch {
}

try {
    copilot plugin uninstall copilot-session-hub
} catch {
}

if (Test-Path -LiteralPath $StartupScript) {
    Remove-Item -LiteralPath $StartupScript -Force
}

Write-Host "Copilot Session Hub uninstalled. Session data remains in %LOCALAPPDATA%\CopilotSessionHub." -ForegroundColor Yellow
Write-Host "The application files can be removed from: $InstallRoot"
