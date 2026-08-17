param(
    [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$InstallRoot = Join-Path $env:LOCALAPPDATA "Programs\CopilotSessionHub"
$StartupFolder = [Environment]::GetFolderPath("Startup")
$StartupScript = Join-Path $StartupFolder "Copilot Session Hub.cmd"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 22.5 or newer is required."
}

$NodeVersion = [version]((node --version).TrimStart("v"))
if ($NodeVersion -lt [version]"22.5.0") {
    throw "Node.js 22.5 or newer is required. Found $NodeVersion."
}

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
Get-ChildItem -LiteralPath $ProjectRoot -Force |
    Where-Object { $_.Name -notin @(".git", "node_modules") } |
    Copy-Item -Destination $InstallRoot -Recurse -Force

$ServerPath = Join-Path $InstallRoot "server\server.mjs"
$StartupContent = "@echo off`r`nstart `"`" /min node `"$ServerPath`"`r`n"
Set-Content -LiteralPath $StartupScript -Value $StartupContent -Encoding ASCII

try {
    copilot plugin uninstall copilot-session-hub 2>$null | Out-Null
} catch {
}
copilot plugin install $InstallRoot

try {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:43120/api/shutdown" -TimeoutSec 2 | Out-Null
    Start-Sleep -Milliseconds 400
} catch {
}

Start-Process -FilePath "node" -ArgumentList "`"$ServerPath`"" -WorkingDirectory $InstallRoot -WindowStyle Hidden
$Healthy = $false
for ($Attempt = 0; $Attempt -lt 20; $Attempt++) {
    Start-Sleep -Milliseconds 250
    try {
        $Health = Invoke-RestMethod -Uri "http://127.0.0.1:43120/api/health" -TimeoutSec 2
        if ($Health.ok) {
            $Healthy = $true
            break
        }
    } catch {
    }
}
if (-not $Healthy) {
    throw "Session Hub did not become healthy on http://127.0.0.1:43120."
}

if (-not $NoOpen) {
    Start-Process "http://127.0.0.1:43120"
}

Write-Host "Copilot Session Hub installed." -ForegroundColor Green
Write-Host "Dashboard: http://127.0.0.1:43120"
Write-Host "Restart Copilot CLI so the plugin hooks are loaded."
