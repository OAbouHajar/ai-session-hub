---
description: Prepare a safe AI Session Hub update from the latest GitHub Release
---

Prepare the latest AI Session Hub update without replacing files used by the current AI CLI session.

1. Find the dashboard URL in the Session Hub context added when this session started.
2. GET `{dashboardUrl}/api/update?refresh=1`.
3. Stop and report clearly when:
   - update checks are disabled;
   - the check returned an error;
   - no newer version is available.
4. Require `latestVersion` to match `X.Y.Z` using decimal numbers only. Never use an unvalidated version in a command.
5. Shallow-clone the exact `v{latestVersion}` tag (`--depth 1 --branch v{latestVersion}`) from
   `https://github.com/OAbouHajar/ai-session-hub.git` into a new temporary directory.
6. Read the staged `package.json` and verify its version exactly matches `latestVersion`. Delete only that new temporary directory and stop if verification fails.
7. Do not run the installer inside the active AI CLI session. Updating provider integrations while they are loaded can leave the application updated but the active plugin stale.
8. Give the user the exact staged installer command:
   - macOS: `"<staged-path>/scripts/install.sh"`
   - Windows: `pwsh -File "<staged-path>\\scripts\\install.ps1"`
9. Tell the user to exit all active supported AI CLI sessions, run that command in a normal terminal, and restart the CLIs afterward. Existing Session Hub data and unrelated provider settings are preserved.
10. Include the installed version, available version, and GitHub Release URL in the result.

Never install a branch, prerelease, draft, or version other than the validated latest stable release.
