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

$ProviderCommands = @("copilot", "claude", "codex", "gemini")
$InstalledProviders = @($ProviderCommands | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue })
if ($InstalledProviders.Count -eq 0) {
    throw "Install at least one supported AI CLI: GitHub Copilot, Claude Code, Codex, or Gemini."
}

# Stop the service before replacing files or reinstalling the plugin. The running
# process may be using the plugin cache that Copilot needs to update.
try {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:43120/api/shutdown" -TimeoutSec 2 | Out-Null
} catch {
}

for ($Attempt = 0; $Attempt -lt 20; $Attempt++) {
    $Listener = Get-NetTCPConnection -LocalPort 43120 -State Listen -ErrorAction SilentlyContinue
    if (-not $Listener) {
        break
    }
    Start-Sleep -Milliseconds 250
}
if (Get-NetTCPConnection -LocalPort 43120 -State Listen -ErrorAction SilentlyContinue) {
    throw "Port 43120 is still in use. Close the process using it, then run the installer again."
}

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
$ResolvedProjectRoot = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd("\")
$ResolvedInstallRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd("\")
if ($ResolvedProjectRoot -ne $ResolvedInstallRoot) {
    Get-ChildItem -LiteralPath $ProjectRoot -Force |
        Where-Object { $_.Name -notin @(".git", "node_modules") } |
        Copy-Item -Destination $InstallRoot -Recurse -Force
}

$ServerPath = Join-Path $InstallRoot "server\server.mjs"
$StartupContent = "@echo off`r`nstart `"`" /min node `"$ServerPath`"`r`n"
Set-Content -LiteralPath $StartupScript -Value $StartupContent -Encoding ASCII

& node (Join-Path $InstallRoot "scripts\provider-hooks.mjs") install $InstallRoot
if ($LASTEXITCODE -ne 0) {
    throw "Could not configure AI CLI provider hooks."
}

if (Get-Command copilot -ErrorAction SilentlyContinue) {
    try {
        copilot plugin uninstall copilot-session-hub 2>$null | Out-Null
    } catch {
    }
    $InstallOutput = copilot plugin install $InstallRoot 2>&1
    if ($LASTEXITCODE -ne 0) {
        $InstallMessage = ($InstallOutput | Out-String).Trim()
        Start-Process -FilePath "node" -ArgumentList "`"$ServerPath`"" -WorkingDirectory $InstallRoot -WindowStyle Hidden
        throw @"
AI Session Hub application files were updated, but the Copilot plugin could not be refreshed.
This usually means an active Copilot session is using the plugin files.

Exit all Copilot CLI sessions, then run:
pwsh -File "$InstallRoot\scripts\install.ps1" -NoOpen

Copilot plugin error:
$InstallMessage
"@
    }
    $InstallOutput | Write-Host
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

Write-Host "AI Session Hub installed." -ForegroundColor Green
Write-Host "Dashboard: http://127.0.0.1:43120"
Write-Host "Restart each supported AI CLI so the Session Hub hooks are loaded."
