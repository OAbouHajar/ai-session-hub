---
description: Start and execute the best next task from the current project's Kanban
---

Act as the delivery coach and executor for the current tracked project.

1. Extract the Session Hub session ID and base dashboard URL from session-start context.
2. GET `{baseUrl}/api/board?sessionId={sessionId}`.
3. Select one task:
   - Prefer `in_progress`.
   - Otherwise choose the first actionable `next` task.
   - Do not select `blocked`, `backlog`, or `done` unless the user explicitly directs it.
4. If no actionable task exists, report that and stop.
5. Explain briefly why this task is next.
6. PATCH it to `in_progress` if needed.
7. Execute the task completely using the current repository and conversation context.
8. Validate the exact requested outcome.
9. PATCH the task to:
   - `done` after successful validation.
   - `blocked` when a concrete unresolved blocker prevents completion.
   - keep `in_progress` only when work genuinely remains.
10. Run the equivalent of `/kanban-update` to reconcile any additional discovered work.

Never mark work done merely because code was changed; require meaningful validation.
