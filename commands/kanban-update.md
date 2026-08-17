---
description: Synchronize the project Kanban with work completed or discovered in this conversation
---

Reconcile the current tracked project's Kanban with the full conversation and actual tool results.

1. Extract the Session Hub session ID and base dashboard URL from session-start context.
2. GET `{baseUrl}/api/board?sessionId={sessionId}`.
3. Compare every board task with the substantive chat, tests, and tool results.
4. Update only when evidence supports it:
   - `done`: implemented and verified.
   - `in_progress`: actively being worked with remaining steps.
   - `blocked`: cannot continue because of a concrete blocker.
   - `next`: actionable and should be done soon.
   - `backlog`: valid but not currently prioritized.
5. PATCH changed tasks at `{baseUrl}/api/tasks/{taskId}` with `{ "status": "..." }`.
6. Add newly discovered unfinished user-requested work through
   `{baseUrl}/api/sessions/{sessionId}/tasks` with `{ "text": "...", "status": "next" }`.
7. Never delete, rewrite, or duplicate user-created tasks. Never create generic maintenance work.
8. Update the checkpoint `nextAction` to the highest-priority actionable task and `tasks` to the ordered open items.

Report counts for moved, added, completed, and blocked tasks, then recommend the next task.
