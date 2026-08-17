---
description: Save a high-quality continuity checkpoint for the current Copilot session
---

Wrap the current session into Copilot Session Hub.

1. Use the current conversation and tool history to produce:
   - A concise session title.
   - A short summary of the goal and meaningful progress.
   - The last meaningful thing completed.
   - One specific recommended next action that is directly supported by an unfinished user request, failed validation, unresolved blocker, promised follow-up, or incomplete implementation in this conversation.
   - Up to six additional next actions, but ONLY for explicit todo/checklist items or clearly unfinished requested work.
   - Any unresolved questions, blockers, or important decisions.
2. Find the Session Hub session ID and checkpoint endpoint in the context added when this session started.
3. POST the checkpoint as JSON using PowerShell `Invoke-RestMethod`. Use this shape:

```json
{
  "title": "Short title",
  "summary": "What this session accomplished",
  "lastAction": "Last meaningful completed action",
  "nextAction": "Best next action",
  "tasks": ["Additional action"],
  "unresolved": ["Open question"],
  "decisions": ["Important decision"]
}
```

4. The request body MUST use exactly the property names above. Do not substitute fields such as `action`, `status`, `timestamp`, `sessionId`, or `remainingCredits`; the session ID is already part of the endpoint URL.
5. Evidence rules:
   - Read the whole substantive chat history, including user corrections and failed tool/test results.
   - Never invent setup advice, maintenance suggestions, or generic future work.
   - Exclude work already completed and verified.
   - If no unfinished requested work remains, set `nextAction` to "No pending action — this session is complete." and use an empty `tasks` array.
   - `lastAction` must be the most recent meaningful completed and verified outcome, not merely the latest command.
6. Do not include secrets, credentials, access tokens, or raw tool output.
7. If the POST fails, state the error clearly and do not claim the checkpoint was saved.
8. After a successful save, show the recommended next action and the dashboard URL. Do not exit Copilot automatically.
