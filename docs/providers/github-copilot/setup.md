# GitHub Copilot CLI setup

## Requirements

- GitHub Copilot CLI, signed in
- Node.js 22.5 or newer
- Git
- macOS or Windows
- PowerShell 7 on Windows

## Install

Run the platform installer from the repository:

**macOS**

```bash
./scripts/install.sh
```

**Windows**

```powershell
pwsh -File .\scripts\install.ps1
```

The installer:

1. Copies the application into the platform installation directory.
2. Installs or refreshes the `copilot-session-hub` plugin.
3. Starts AI Session Hub at `http://127.0.0.1:43120`.
4. Preserves the existing Session Hub database.

Restart any Copilot CLI sessions that were open during installation. A new or restarted session loads the plugin hooks and slash commands.

Direct plugin installation may show a marketplace deprecation warning. It is informational while the plugin installation still succeeds.

## Verify

```bash
curl http://127.0.0.1:43120/api/health
copilot plugin list
```

The health response must contain `"ok":true`, and the plugin list must include `copilot-session-hub`.
