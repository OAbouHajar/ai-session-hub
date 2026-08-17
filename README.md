# AI Session Hub

**Local-first continuity for AI coding sessions. Find past work, understand where it stopped, and continue without reconstructing the whole conversation.**

> AI Session Hub integrates with **GitHub Copilot CLI**, **Claude Code**, **OpenAI Codex CLI**, and **Google Gemini CLI**.
>
> This is an independent open source project and is not an official GitHub or Microsoft product.

![AI Session Hub Sessions view](screenshots/sessions-screenshot.png)

_The Sessions view keeps the goal, completed work, stopping point, next action, and resume control together._

## Why this project matters

AI coding sessions are productive but easy to lose:

- the useful context is trapped in an old terminal session;
- you remember the task, file, or project, but not the session ID;
- a long conversation ends without a reliable handoff;
- the next steps disappear between sessions;
- project work becomes scattered across many AI conversations.

AI Session Hub turns session history into a searchable continuity layer. It answers:

> “I worked with an AI coding assistant on this before. What happened, where did we stop, and how do I continue?”

## What you get

- **Automatic session tracking** through supported AI CLI lifecycle hooks.
- **Wrapped-session focus** so high-quality continuity checkpoints appear first.
- **Normal search** across titles, summaries, actions, tasks, projects, folders, and worked-on files.
- **Recall-first session details** with summary, last completed action, recommended next action, and resume command.
- **Explicit next-session todos** with `/wrap-with-next`.
- **Questions and actions history** with system noise removed and skill calls humanized.
- **Worked-on file evidence** imported from local session history when available.
- **Sessions and Board views** for recall and optional Kanban project tracking.
- **Work item links**, currently supporting Azure DevOps work-item URLs.
- **Local-only storage** and a loopback-only dashboard at `http://127.0.0.1:43120`.
- **Safe upgrades** that preserve existing SQLite session data.

## Quick start

### Option 1: Ask your AI CLI to install it

Copy this platform-aware prompt into GitHub Copilot CLI, Claude Code, Codex CLI, or Gemini CLI:

```text
Install AI Session Hub from https://github.com/OAbouHajar/ai-session-hub on this machine.

Detect the operating system first and use the matching setup:
- On macOS, verify git, Node.js 22.5+, and at least one supported AI CLI (GitHub Copilot, Claude Code, Codex, or Gemini); use `./scripts/install.sh --no-open`; and preserve all existing data under `~/Library/Application Support/CopilotSessionHub` or the legacy `~/.copilot-session-hub` location.
- On Windows, verify git, PowerShell 7, Node.js 22.5+, and at least one supported AI CLI; use `pwsh -File .\scripts\install.ps1 -NoOpen`; and preserve all existing data under `%LOCALAPPDATA%\CopilotSessionHub`.
- On any other operating system, stop and report that it is unsupported.

Verify that each detected AI CLI is usable and signed in. Clone the latest `main` branch into a temporary directory, read the README and the matching installer before running it, and do not delete or overwrite existing session data or unrelated AI CLI settings. If a prerequisite is missing, report the exact official installation command or link. If a plugin or hook cannot be refreshed because an active AI CLI session is using it, report the installer's exact retry command and do not claim success. After installation, verify `http://127.0.0.1:43120/api/health` returns `ok: true`, open the dashboard, and report the installed version, configured providers, and any remaining action. Proceed autonomously and only ask before administrator-required or destructive actions.
```

The full AI-assisted installation prompts for [macOS](docs/copilot-install-prompt-macos.md) and [Windows](docs/copilot-install-prompt.md) include prerequisite recovery, hook or plugin handling, and verification steps.

### Option 2: Install manually

Requirements:

- macOS or Windows
- Git
- PowerShell 7 (`pwsh`) on Windows
- Node.js 22.5 or newer
- At least one supported AI CLI, signed in

macOS:

```bash
git clone https://github.com/OAbouHajar/ai-session-hub.git
cd ai-session-hub
./scripts/install.sh
```

Windows:

```powershell
git clone https://github.com/OAbouHajar/ai-session-hub.git
cd ai-session-hub
pwsh -File .\scripts\install.ps1
```

The installer detects installed providers and adds only AI Session Hub hook entries while preserving existing settings. Restart each detected AI CLI after installation so its hooks are loaded.

## Supported providers

| Provider | Tracking | Resume from dashboard | Integration |
|---|---|---|---|
| GitHub Copilot CLI | Yes | Yes | Plugin hooks and commands |
| Claude Code | Yes | Yes | User lifecycle hooks |
| OpenAI Codex CLI | Yes | Yes | User lifecycle hooks |
| Google Gemini CLI | Yes | Yes | User lifecycle hooks |

AI Session Hub uses documented lifecycle hook payloads as its stable integration boundary. Provider transcript formats are not treated as stable APIs.

## How to use it

1. Start or resume a session in a supported AI CLI.
2. Work normally; the lifecycle appears in AI Session Hub.
3. Before stopping, ask the assistant to wrap or checkpoint the session. In GitHub Copilot CLI, you can also use:

| Command | Purpose |
|---|---|
| `/wrap` | Save a continuity checkpoint inferred from the actual session history |
| `/wrap-with-next` | Save the checkpoint plus your explicit next-session todo list |
| `/kanban` | Generate an ordered plan from genuinely unfinished work |
| `/kanban-update` | Reconcile board state with completed, blocked, and discovered work |
| `/kanban-process` | Select and execute the next actionable board item |

4. Return later and search for anything you remember: a task, project, folder, action, or filename.
5. Review the stopping point and next action.
6. Resume from the dashboard or copy:

The copied resume command matches the session provider, such as `copilot --resume=<id>`, `claude --resume <id>`, `codex resume <id>`, or `gemini --resume <id>`.

## Manage a session as a project board

Any session can become a tracked project without losing its continuity view:

1. Open a session in the **Sessions** view.
2. Expand **More context** and choose **Track as project**.
3. Switch to the **Board** view.
4. Select the tracked project from the sidebar.
5. Add tasks manually, drag cards between columns, or use the AI commands:
   - `/kanban` creates an ordered board from genuinely unfinished session work.
   - `/kanban-update` reconciles completed, blocked, and newly discovered work.
   - `/kanban-process` selects and executes the next actionable card.
6. Link a work item when the project maps to an external tracker.
7. Choose **Open session** at any time to return to the full session context.

The board uses **Backlog**, **Next**, **In progress**, **Blocked**, and **Done** columns.

![AI Session Hub Board view](screenshots/board-screenshot.png)

_The Board view organizes tracked project tasks into Backlog, Next, In progress, Blocked, and Done._

## How it works

```text
Supported AI CLI hooks
          |
          v
Local Node.js service on 127.0.0.1
          |
          v
Local SQLite continuity store
          |
          v
Searchable browser dashboard
```

- Hook payloads track session lifecycle events.
- `/wrap` runs while conversation context is still available and writes the semantic handoff.
- Existing Copilot CLI session history is imported read-only.
- File paths are stored locally for search, but the browser receives workspace-relative paths or basenames.
- The service does not upload session data.

## Data and privacy

- Service binding: `127.0.0.1` only.
- Session database: `~/Library/Application Support/CopilotSessionHub/sessions.db` on macOS or `%LOCALAPPDATA%\CopilotSessionHub\sessions.db` on Windows.
- Installation directory: `~/Library/Application Support/AI Session Hub/app` on macOS or `%LOCALAPPDATA%\Programs\CopilotSessionHub` on Windows.
- Existing session data is preserved during reinstall and uninstall.
- Existing macOS data in the legacy `~/.copilot-session-hub` location continues to be used automatically.
- Request Host/Origin checks and anti-framing headers protect local actions.
- No cloud database, analytics service, or external upload is required.

## Upgrade

Pull the latest version and rerun the installer.

macOS:

```bash
git pull
./scripts/install.sh --no-open
```

Windows:

```powershell
git pull
pwsh -File .\scripts\install.ps1 -NoOpen
```

If an active Copilot session locks the loaded plugin files, the installer updates the application, keeps the dashboard available, and prints the exact retry command to run after exiting Copilot.

## Development

```bash
npm start
npm test
```

The project uses Node.js built-ins, including `node:http`, `node:sqlite`, and the native test runner. There are no runtime npm dependencies.

## Roadmap

- Provider-specific historical session import beyond Copilot CLI.
- Support for additional AI coding CLI providers.
- Generic work-item providers beyond the current Azure DevOps URL integration.
- Optional packaged installer and release artifacts.

## Uninstall

macOS:

```bash
./scripts/uninstall.sh
```

Windows:

```powershell
pwsh -File .\scripts\uninstall.ps1
```

Uninstalling leaves the local SQLite session data in place.

## License

[MIT](LICENSE)
