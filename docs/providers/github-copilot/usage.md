# GitHub Copilot CLI usage

Start or resume Copilot normally. The Session Hub plugin tracks session start, completed turns, context compaction, and session end.

## Save continuity

Use:

| Command | Purpose |
|---|---|
| `/wrap` | Save a continuity checkpoint |
| `/wrap-with-next` | Save a checkpoint with an explicit next-session todo list |
| `/kanban` | Build an ordered board from unfinished work |
| `/kanban-update` | Reconcile board state with actual progress |
| `/kanban-process` | Execute the next actionable board task |

You can also ask Copilot to **wrap this session** or **checkpoint this session**.

## Resume

Choose **Resume this session** in the dashboard or run:

```bash
copilot --resume=<session-id>
```

Existing local Copilot session history is imported read-only when its supported history database is available.
