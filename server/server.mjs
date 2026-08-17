import http from "node:http";
import { readFile, mkdir, access, rename, unlink } from "node:fs/promises";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");
const port = Number(process.env.COPILOT_SESSION_HUB_PORT) || 43120;
const baseUrl = `http://127.0.0.1:${port}`;
const antiFramingHeaders = {
  "content-security-policy": "frame-ancestors 'none'",
  "x-frame-options": "DENY"
};
const dataDir = process.env.COPILOT_SESSION_HUB_DATA ||
  (process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "CopilotSessionHub")
    : join(homedir(), ".copilot-session-hub"));
const historyPath = process.env.COPILOT_SESSION_HUB_HISTORY_DB || join(homedir(), ".copilot", "session-store.db");
await mkdir(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, "sessions.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'Untitled session',
    summary TEXT NOT NULL DEFAULT '',
    initial_question TEXT NOT NULL DEFAULT '',
    questions TEXT NOT NULL DEFAULT '[]',
    last_action TEXT NOT NULL DEFAULT '',
    next_action TEXT NOT NULL DEFAULT '',
    unresolved TEXT NOT NULL DEFAULT '[]',
    decisions TEXT NOT NULL DEFAULT '[]',
    cwd TEXT NOT NULL DEFAULT '',
    repository TEXT NOT NULL DEFAULT '',
    branch TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'startup',
    status TEXT NOT NULL DEFAULT 'active',
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    ended_at INTEGER,
    end_reason TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    needs_review INTEGER NOT NULL DEFAULT 1,
    transcript_path TEXT NOT NULL DEFAULT '',
    compacted_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS work_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    work_item_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(session_id, work_item_id)
  );
  CREATE TABLE IF NOT EXISTS session_files (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    path_key TEXT NOT NULL,
    tool_name TEXT NOT NULL DEFAULT '',
    turn_index INTEGER,
    first_seen_at INTEGER,
    PRIMARY KEY(session_id, path_key)
  );
  CREATE TABLE IF NOT EXISTS app_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id, position);
  CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_work_items_session ON work_items(session_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_session_files_path ON session_files(path_key, session_id);
`);
ensureColumn("sessions", "imported", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("sessions", "is_project", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("sessions", "ai_credits", "REAL");
ensureColumn("sessions", "current_tokens", "INTEGER");
ensureColumn("sessions", "context_limit", "INTEGER");
ensureColumn("sessions", "model", "TEXT NOT NULL DEFAULT ''");
ensureColumn("sessions", "context_tier", "TEXT NOT NULL DEFAULT ''");
ensureColumn("sessions", "metrics_at", "INTEGER");
ensureColumn("sessions", "initial_question", "TEXT NOT NULL DEFAULT ''");
ensureColumn("sessions", "questions", "TEXT NOT NULL DEFAULT '[]'");
ensureColumn("sessions", "files_status", "TEXT NOT NULL DEFAULT 'unavailable'");
ensureColumn("sessions", "files_synced_at", "INTEGER");
ensureColumn("sessions", "files_sync_error", "TEXT NOT NULL DEFAULT ''");
ensureColumn("tasks", "status", "TEXT NOT NULL DEFAULT 'next'");
db.exec("UPDATE tasks SET status = CASE WHEN completed = 1 THEN 'done' ELSE 'next' END WHERE status IS NULL OR status = ''");
const aicUnitVersion = db.prepare("SELECT value FROM app_metadata WHERE key = 'aic_unit_version'").get()?.value;
if (aicUnitVersion !== "2") {
  db.exec("UPDATE sessions SET ai_credits = ai_credits * 1000 WHERE ai_credits IS NOT NULL");
  db.prepare("INSERT OR REPLACE INTO app_metadata(key, value) VALUES ('aic_unit_version', '2')").run();
}

const clients = new Set();
await replayPendingEvents();
const initialImport = process.env.COPILOT_SESSION_HUB_IMPORT_HISTORY === "0"
  ? { imported: 0 }
  : importHistory();
if (initialImport.imported) {
  console.log(`Imported ${initialImport.imported} existing Copilot CLI sessions.`);
}

function metadataSearchMatch(row, query) {
  const matches = [
    ["title", row.title, cleanText(row.title, 180)],
    ["summary", row.summary, cleanText(row.summary, 180)],
    ["last action", row.last_action, cleanText(row.last_action, 180)],
    ["next action", row.next_action, cleanText(row.next_action, 180)],
    ["project", row.repository, basenamePath(row.repository)],
    ["folder", row.cwd, basenamePath(row.cwd)]
  ];
  const needle = query.toLocaleLowerCase();
  const match = matches.find(([, value]) => String(value || "").toLocaleLowerCase().includes(needle));
  return match ? { type: match[0], text: match[2] } : undefined;
}

function basenamePath(value) {
  return slashPath(value).split("/").filter(Boolean).at(-1) || "";
}

const server = http.createServer(async (request, response) => {
  try {
    if (!isAllowedRequest(request)) return json(response, 403, { error: "Request origin is not allowed" });
    const url = new URL(request.url, baseUrl);
    if (url.pathname === "/api/health") return json(response, 200, { ok: true, version: "0.1.0" });
    if (url.pathname === "/api/events" && request.method === "GET") return openEventStream(request, response);
    if (url.pathname === "/api/sessions" && request.method === "GET") return listSessions(url, response);
    if (url.pathname === "/api/stats" && request.method === "GET") return getStats(response);
    if (url.pathname === "/api/board" && request.method === "GET") return getBoard(url, response);
    if (url.pathname === "/api/projects" && request.method === "GET") return getProjects(response);
    if (url.pathname === "/api/import-history" && request.method === "POST") {
      const result = importHistory();
      if (result.imported || result.fileSessions) broadcast("sessions-changed", { eventName: "history-imported" });
      return json(response, 200, result);
    }
    if (url.pathname.startsWith("/api/hooks/") && request.method === "POST") {
      return handleHook(url.pathname.slice("/api/hooks/".length), await body(request), response);
    }

    const match = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/([^/]+))?$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const action = match[2];
      if (!action && request.method === "GET") return getSession(id, response);
      if (!action && request.method === "PATCH") return updateSession(id, await body(request), response);
      if (action === "checkpoint" && request.method === "POST") return checkpoint(id, await body(request), response);
      if (action === "tasks" && request.method === "POST") return addTask(id, await body(request), response);
      if (action === "work-items" && request.method === "POST") return addWorkItem(id, await body(request), response);
      if (action === "resume" && request.method === "POST") return resumeSession(id, response);
      if (action === "folder" && request.method === "POST") return openFolder(id, response);
    }

    const taskMatch = url.pathname.match(/^\/api\/tasks\/(\d+)$/);
    if (taskMatch && request.method === "PATCH") return updateTask(Number(taskMatch[1]), await body(request), response);
    if (taskMatch && request.method === "DELETE") return deleteTask(Number(taskMatch[1]), response);
    const workItemMatch = url.pathname.match(/^\/api\/work-items\/(\d+)$/);
    if (workItemMatch && request.method === "DELETE") return deleteWorkItem(Number(workItemMatch[1]), response);

    if (url.pathname === "/api/shutdown" && request.method === "POST") {
      json(response, 200, { ok: true });
      setTimeout(() => server.close(() => process.exit(0)), 50);
      return;
    }
    return serveStatic(url.pathname, response);
  } catch (error) {
    console.error(error);
    json(response, error.statusCode || 500, { error: error.message || "Unexpected server error" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Copilot Session Hub: ${baseUrl}`);
});

function listSessions(url, response) {
  const query = (url.searchParams.get("q") || "").trim().slice(0, 200);
  const filter = url.searchParams.get("filter") || "open";
  const where = [];
  const params = {};
  if (!query) {
    if (filter === "open") where.push("archived = 0");
    if (filter === "wrapped") where.push("needs_review = 0 AND archived = 0");
    if (filter === "active") where.push("status = 'active' AND archived = 0");
    if (filter === "paused") where.push("status = 'paused' AND archived = 0");
    if (filter === "archived") where.push("archived = 1");
  }
  if (query) {
    where.push(`(
      instr(lower(title), lower(:query)) > 0
      OR instr(lower(summary), lower(:query)) > 0
      OR instr(lower(cwd), lower(:query)) > 0
      OR instr(lower(repository), lower(:query)) > 0
      OR instr(lower(last_action), lower(:query)) > 0
      OR instr(lower(next_action), lower(:query)) > 0
      OR EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.session_id = sessions.id AND instr(lower(t.text), lower(:query)) > 0
      )
      OR EXISTS (
        SELECT 1 FROM session_files sf
        WHERE sf.session_id = sessions.id AND instr(lower(sf.file_path), lower(:query)) > 0
      )
    )`);
    params.query = query;
  }
  const matchSelect = query
    ? `, (SELECT sf.file_path FROM session_files sf WHERE sf.session_id = sessions.id AND instr(lower(sf.file_path), lower(:query)) > 0 ORDER BY sf.file_path LIMIT 1) AS matched_file_path
       , (SELECT t.text FROM tasks t WHERE t.session_id = sessions.id AND instr(lower(t.text), lower(:query)) > 0 ORDER BY t.position, t.id LIMIT 1) AS matched_task_text`
    : "";
  const sql = `SELECT sessions.*${matchSelect} FROM sessions ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY pinned DESC, CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC`;
  const rows = db.prepare(sql).all(params).map((row) => {
    const session = sessionRecord(row);
    if (row.matched_file_path) {
      session.searchMatch = {
        type: "file",
        text: displayFilePath(row.matched_file_path, row.repository || row.cwd).path
      };
    } else if (row.matched_task_text) {
      session.searchMatch = { type: "task", text: cleanText(row.matched_task_text, 180) };
    } else {
      session.searchMatch = metadataSearchMatch(row, query);
    }
    return session;
  });
  json(response, 200, rows);
}

function getSession(id, response) {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  if (!row) return json(response, 404, { error: "Session not found" });
  const session = sessionRecord(row);
  session.tasks = db.prepare("SELECT * FROM tasks WHERE session_id = ? ORDER BY position, id").all(id).map(taskRecord);
  session.workItems = db.prepare("SELECT * FROM work_items WHERE session_id = ? ORDER BY created_at, id").all(id).map(workItemRecord);
  session.events = db.prepare("SELECT * FROM events WHERE session_id = ? ORDER BY created_at DESC LIMIT 40").all(id);
  Object.assign(session, fileHistoryRecord(row));
  json(response, 200, session);
}

function getStats(response) {
  const result = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN archived = 0 THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN needs_review = 0 AND archived = 0 THEN 1 ELSE 0 END) AS wrapped,
      SUM(CASE WHEN status = 'active' AND archived = 0 THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'paused' AND archived = 0 THEN 1 ELSE 0 END) AS paused,
      SUM(CASE WHEN needs_review = 1 AND archived = 0 THEN 1 ELSE 0 END) AS needsReview,
      SUM(CASE WHEN pinned = 1 AND archived = 0 THEN 1 ELSE 0 END) AS pinned
    FROM sessions
  `).get();
  json(response, 200, result);
}

function getBoard(url, response) {
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) return json(response, 200, { tasks: [], counts: emptyBoardCounts(), total: 0, project: null, workItems: [] });
  const projectRow = db.prepare("SELECT * FROM sessions WHERE id = ? AND is_project = 1 AND archived = 0").get(sessionId);
  if (!projectRow) return json(response, 404, { error: "Tracked project not found" });
  const tasks = db.prepare(`
    SELECT t.*, s.title AS session_title, s.repository, s.cwd, s.branch, s.updated_at AS session_updated_at
    FROM tasks t
    JOIN sessions s ON s.id = t.session_id
    WHERE s.archived = 0 AND s.is_project = 1 AND s.id = ?
    ORDER BY
      CASE t.status
        WHEN 'in_progress' THEN 0
        WHEN 'blocked' THEN 1
        WHEN 'next' THEN 2
        WHEN 'backlog' THEN 3
        WHEN 'done' THEN 4
        ELSE 5
      END,
      s.pinned DESC,
      s.updated_at DESC,
      t.position,
      t.id
  `).all(sessionId).map((row) => ({
    ...taskRecord(row),
    sessionTitle: row.session_title,
    repository: row.repository,
    cwd: row.cwd,
    branch: row.branch,
    sessionUpdatedAt: row.session_updated_at
  }));
  const counts = Object.fromEntries(["backlog", "next", "in_progress", "blocked", "done"].map((status) => [
    status,
    tasks.filter((task) => task.status === status).length
  ]));
  const workItems = db.prepare("SELECT * FROM work_items WHERE session_id = ? ORDER BY created_at, id").all(sessionId).map(workItemRecord);
  json(response, 200, { tasks, counts, total: tasks.length, project: { ...sessionRecord(projectRow), ...fileHistoryRecord(projectRow) }, workItems });
}

function getProjects(response) {
  const rows = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM tasks t WHERE t.session_id = s.id AND t.status <> 'done') AS open_task_count,
      (SELECT COUNT(*) FROM work_items w WHERE w.session_id = s.id) AS work_item_count
    FROM sessions s
    WHERE s.is_project = 1 AND s.archived = 0
    ORDER BY s.pinned DESC, s.updated_at DESC
  `).all().map((row) => ({
    ...sessionRecord(row),
    ...fileHistoryRecord(row),
    openTaskCount: row.open_task_count,
    workItemCount: row.work_item_count
  }));
  json(response, 200, rows);
}

function handleHook(eventName, payload, response) {
  const id = payload.sessionId;
  if (!id) return json(response, 400, { error: "Missing sessionId" });
  const timestamp = Number(payload.timestamp) || Date.now();
  const existing = db.prepare("SELECT id FROM sessions WHERE id = ?").get(id);
  if (!existing) {
    const git = gitContext(payload.cwd);
    db.prepare(`
      INSERT INTO sessions
      (id, title, cwd, repository, branch, source, status, started_at, updated_at, needs_review)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1)
    `).run(id, suggestedTitle(payload.cwd), payload.cwd || "", git.repository, git.branch, payload.source || "startup", timestamp, timestamp);
  }

  if (eventName === "sessionStart") {
    db.prepare("UPDATE sessions SET status = 'active', source = ?, cwd = ?, updated_at = ?, ended_at = NULL, end_reason = NULL WHERE id = ?")
      .run(payload.source || "startup", payload.cwd || "", timestamp, id);
  } else if (eventName === "agentStop") {
    db.prepare("UPDATE sessions SET status = 'active', transcript_path = ?, updated_at = ? WHERE id = ?")
      .run(payload.transcriptPath || "", timestamp, id);
  } else if (eventName === "sessionEnd") {
    db.prepare("UPDATE sessions SET status = 'paused', ended_at = ?, end_reason = ?, updated_at = ? WHERE id = ?")
      .run(timestamp, payload.reason || "user_exit", timestamp, id);
  } else if (eventName === "preCompact") {
    db.prepare("UPDATE sessions SET compacted_at = ?, transcript_path = ?, updated_at = ? WHERE id = ?")
      .run(timestamp, payload.transcriptPath || "", timestamp, id);
  }

  addEvent(id, eventName, eventDetail(eventName, payload), timestamp);
  if (["agentStop", "preCompact", "sessionEnd"].includes(eventName)) syncSessionFiles(id);
  broadcast("sessions-changed", { id, eventName });
  json(response, 200, { ok: true, sessionId: id });
}

function checkpoint(id, data, response) {
  const existing = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  if (!existing) return json(response, 404, { error: "Session not found. Start the tracked Copilot session first." });
  const now = Date.now();
  const title = data.title === undefined ? existing.title : (cleanText(data.title, 120) || existing.title);
  const summary = data.summary === undefined ? existing.summary : cleanText(data.summary, 3000);
  const lastAction = data.lastAction === undefined ? existing.last_action : cleanText(data.lastAction, 1000);
  const nextAction = data.nextAction === undefined ? existing.next_action : cleanText(data.nextAction, 1000);
  const unresolved = data.unresolved === undefined ? parseArray(existing.unresolved) : cleanArray(data.unresolved, 20, 500);
  const decisions = data.decisions === undefined ? parseArray(existing.decisions) : cleanArray(data.decisions, 20, 500);
  const tasks = data.tasks === undefined ? null : cleanArray(data.tasks, 20, 500);
  const metrics = readSessionMetrics(id, existing.transcript_path);
  db.exec("BEGIN");
  try {
    db.prepare(`
      UPDATE sessions SET title = ?, summary = ?, last_action = ?, next_action = ?,
        unresolved = ?, decisions = ?, needs_review = 0, updated_at = ?,
        ai_credits = ?, current_tokens = ?, context_limit = ?, model = ?, context_tier = ?, metrics_at = ?
      WHERE id = ?
    `).run(
      title, summary, lastAction, nextAction, JSON.stringify(unresolved), JSON.stringify(decisions), now,
      metrics.aiCredits, metrics.currentTokens, metrics.contextLimit, metrics.model, metrics.contextTier, metrics.capturedAt,
      id
    );
    if (tasks) {
      const existingTasks = db.prepare("SELECT text FROM tasks WHERE session_id = ?").all(id);
      const existingText = new Set(existingTasks.map((task) => task.text.toLocaleLowerCase()));
      const nextPosition = Number(db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tasks WHERE session_id = ?").get(id).position);
      const insert = db.prepare("INSERT INTO tasks(session_id, text, completed, position, created_at, status) VALUES (?, ?, 0, ?, ?, 'next')");
      let added = 0;
      for (const task of tasks) {
        const key = task.toLocaleLowerCase();
        if (existingText.has(key)) continue;
        insert.run(id, task, nextPosition + added, now);
        existingText.add(key);
        added++;
      }
    }
    addEvent(id, "checkpoint", "AI continuity checkpoint saved", now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  broadcast("sessions-changed", { id, eventName: "checkpoint" });
  json(response, 200, { ok: true, dashboardUrl: baseUrl, sessionId: id });
}

function updateSession(id, data, response) {
  const allowed = {
    title: ["title", (value) => cleanText(value, 120)],
    summary: ["summary", (value) => cleanText(value, 3000)],
    lastAction: ["last_action", (value) => cleanText(value, 1000)],
    nextAction: ["next_action", (value) => cleanText(value, 1000)],
    pinned: ["pinned", (value) => value ? 1 : 0],
    archived: ["archived", (value) => value ? 1 : 0],
    needsReview: ["needs_review", (value) => value ? 1 : 0],
    status: ["status", (value) => ["active", "paused", "complete"].includes(value) ? value : "paused"],
    isProject: ["is_project", (value) => value ? 1 : 0]
  };
  const updates = [];
  const values = [];
  for (const [key, value] of Object.entries(data)) {
    if (!allowed[key]) continue;
    updates.push(`${allowed[key][0]} = ?`);
    values.push(allowed[key][1](value));
  }
  if (!updates.length) return json(response, 400, { error: "No supported fields supplied" });
  updates.push("updated_at = ?");
  values.push(Date.now(), id);
  const result = db.prepare(`UPDATE sessions SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  if (!result.changes) return json(response, 404, { error: "Session not found" });
  broadcast("sessions-changed", { id, eventName: "updated" });
  getSession(id, response);
}

function addTask(id, data, response) {
  const text = cleanText(data.text, 500);
  if (!text) return json(response, 400, { error: "Task text is required" });
  const status = normalizeTaskStatus(data.status);
  const position = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM tasks WHERE session_id = ?").get(id).position;
  const result = db.prepare("INSERT INTO tasks(session_id, text, completed, position, created_at, status) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, text, status === "done" ? 1 : 0, position, Date.now(), status);
  broadcast("sessions-changed", { id, eventName: "task-added" });
  json(response, 201, { id: Number(result.lastInsertRowid), sessionId: id, text, completed: status === "done", status, position });
}

function updateTask(id, data, response) {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  if (!row) return json(response, 404, { error: "Task not found" });
  const text = data.text === undefined ? row.text : cleanText(data.text, 500);
  let status = data.status === undefined ? normalizeTaskStatus(row.status) : normalizeTaskStatus(data.status);
  if (data.completed !== undefined) status = data.completed ? "done" : (status === "done" ? "next" : status);
  const completed = status === "done" ? 1 : 0;
  db.prepare("UPDATE tasks SET text = ?, completed = ?, status = ? WHERE id = ?").run(text, completed, status, id);
  db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(Date.now(), row.session_id);
  broadcast("sessions-changed", { id: row.session_id, eventName: "task-updated" });
  json(response, 200, taskRecord({ ...row, text, completed, status }));
}

function deleteTask(id, response) {
  const row = db.prepare("SELECT session_id FROM tasks WHERE id = ?").get(id);
  if (!row) return json(response, 404, { error: "Task not found" });
  db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  broadcast("sessions-changed", { id: row.session_id, eventName: "task-deleted" });
  json(response, 200, { ok: true });
}

function addWorkItem(sessionId, data, response) {
  const session = db.prepare("SELECT id FROM sessions WHERE id = ?").get(sessionId);
  if (!session) return json(response, 404, { error: "Session not found" });
  const url = cleanText(data.url, 2000);
  const parsed = parseAdoWorkItemUrl(url);
  if (!parsed) return json(response, 400, { error: "Enter a valid Azure DevOps work item URL containing /_workitems/edit/{id}" });
  const type = normalizeWorkItemType(data.type);
  const title = cleanText(data.title, 200);
  try {
    const result = db.prepare(`
      INSERT INTO work_items(session_id, work_item_id, type, title, url, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionId, parsed.id, type, title, parsed.url, Date.now());
    db.prepare("UPDATE sessions SET is_project = 1, updated_at = ? WHERE id = ?").run(Date.now(), sessionId);
    broadcast("sessions-changed", { id: sessionId, eventName: "work-item-added" });
    json(response, 201, {
      id: Number(result.lastInsertRowid),
      sessionId,
      workItemId: parsed.id,
      type,
      title,
      url: parsed.url
    });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) return json(response, 409, { error: "This work item is already linked to the project" });
    throw error;
  }
}

function deleteWorkItem(id, response) {
  const row = db.prepare("SELECT session_id FROM work_items WHERE id = ?").get(id);
  if (!row) return json(response, 404, { error: "Work item link not found" });
  db.prepare("DELETE FROM work_items WHERE id = ?").run(id);
  broadcast("sessions-changed", { id: row.session_id, eventName: "work-item-deleted" });
  json(response, 200, { ok: true });
}

function resumeSession(id, response) {
  const row = db.prepare("SELECT cwd FROM sessions WHERE id = ?").get(id);
  if (!row) return json(response, 404, { error: "Session not found" });
  if (!row.cwd || !existsSync(row.cwd)) {
    return json(response, 409, { error: "The original working directory no longer exists. Restore or recreate that folder, then try resuming again." });
  }
  const cwd = row.cwd;
  const copilotPath = resolveExecutable("copilot");
  const pwshPath = resolveExecutable("pwsh.exe") || "pwsh.exe";
  const terminalPath = resolveExecutable("wt.exe");
  if (!copilotPath) return json(response, 409, { error: "Copilot CLI was not found on PATH" });
  const command = `& '${escapePowerShellLiteral(copilotPath)}' --resume='${escapePowerShellLiteral(id)}'`;
  const executable = terminalPath || pwshPath;
  const args = terminalPath
    ? ["-d", cwd, pwshPath, "-NoExit", "-Command", command]
    : ["-NoExit", "-Command", `Set-Location -LiteralPath '${escapePowerShellLiteral(cwd)}'; ${command}`];
  const child = spawn(executable, args, {
    cwd,
    detached: true,
    windowsHide: false,
    stdio: "ignore"
  });
  child.unref();
  addEvent(id, "resume-requested", "Resume launched from dashboard", Date.now());
  json(response, 200, { ok: true });
}

function resolveExecutable(command) {
  try {
    if (command === "copilot") {
      return execFileSync("pwsh.exe", ["-NoProfile", "-Command", "(Get-Command copilot -ErrorAction Stop).Source"], {
        encoding: "utf8",
        timeout: 2000,
        windowsHide: true
      }).trim();
    }
    return execFileSync("where.exe", [command], {
      encoding: "utf8",
      timeout: 2000,
      windowsHide: true
    }).split(/\r?\n/).map((value) => value.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}

function escapePowerShellLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function openFolder(id, response) {
  const row = db.prepare("SELECT cwd FROM sessions WHERE id = ?").get(id);
  if (!row) return json(response, 404, { error: "Session not found" });
  if (!existsSync(row.cwd)) return json(response, 409, { error: "Working directory no longer exists" });
  const child = spawn("explorer.exe", [row.cwd], { detached: true, windowsHide: true, stdio: "ignore" });
  child.unref();
  json(response, 200, { ok: true });
}

function openEventStream(request, response) {
  response.writeHead(200, {
    ...antiFramingHeaders,
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "connection": "keep-alive"
  });
  response.write("event: connected\ndata: {}\n\n");
  clients.add(response);
  const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 20000);
  request.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(response);
  });
}

async function serveStatic(pathname, response) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = normalize(join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) return json(response, 403, { error: "Forbidden" });
  try {
    await access(filePath);
  } catch {
    return json(response, 404, { error: "Not found" });
  }
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml"
  };
  response.writeHead(200, {
    ...antiFramingHeaders,
    "content-type": types[extname(filePath)] || "application/octet-stream"
  });
  createReadStream(filePath).pipe(response);
}

async function replayPendingEvents() {
  const queuePath = join(dataDir, "pending-events.jsonl");
  if (!existsSync(queuePath)) return;
  const processingPath = `${queuePath}.processing`;
  await rename(queuePath, processingPath);
  try {
    const lines = (await readFile(processingPath, "utf8")).split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const fakeResponse = { writeHead() {}, end() {} };
        handleHook(entry.eventName, entry.payload, fakeResponse);
      } catch (error) {
        console.error("Failed to replay queued event:", error.message);
      }
    }
  } finally {
    await unlink(processingPath).catch(() => {});
  }
}

function sessionRecord(row) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    initialQuestion: row.initial_question,
    questions: parseArray(row.questions),
    lastAction: row.last_action,
    nextAction: row.next_action,
    unresolved: parseArray(row.unresolved),
    decisions: parseArray(row.decisions),
    cwd: row.cwd,
    repository: row.repository,
    branch: row.branch,
    source: row.source,
    status: row.status,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
    endReason: row.end_reason,
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
    needsReview: Boolean(row.needs_review),
    transcriptPath: row.transcript_path,
    compactedAt: row.compacted_at,
    imported: Boolean(row.imported),
    isProject: Boolean(row.is_project),
    metrics: {
      aiCredits: row.ai_credits,
      currentTokens: row.current_tokens,
      contextLimit: row.context_limit,
      model: row.model || "",
      contextTier: row.context_tier || "",
      capturedAt: row.metrics_at
    }
  };
}

function taskRecord(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    text: row.text,
    completed: Boolean(row.completed),
    status: normalizeTaskStatus(row.status || (row.completed ? "done" : "next")),
    position: row.position
  };
}

function workItemRecord(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    workItemId: row.work_item_id,
    type: row.type,
    title: row.title,
    url: row.url,
    createdAt: row.created_at
  };
}

function fileHistoryRecord(session) {
  const rows = db.prepare(`
    SELECT file_path, tool_name, turn_index, first_seen_at
    FROM session_files
    WHERE session_id = ?
    ORDER BY COALESCE(turn_index, 2147483647), COALESCE(first_seen_at, 0), file_path
    LIMIT 101
  `).all(session.id);
  const truncated = rows.length > 100;
  return {
    files: rows.slice(0, 100).map((row) => fileRecord(row, session)),
    fileCount: Number(db.prepare("SELECT COUNT(*) AS count FROM session_files WHERE session_id = ?").get(session.id)?.count || 0),
    filesTruncated: truncated,
    fileHistoryStatus: normalizeFileStatus(session.files_status),
    fileHistorySyncedAt: session.files_synced_at
  };
}

function fileRecord(row, session) {
  const display = displayFilePath(row.file_path, session.repository || session.cwd);
  return {
    displayPath: display.path,
    outsideWorkspace: display.outsideWorkspace,
    toolName: row.tool_name,
    turnIndex: row.turn_index,
    firstSeenAt: row.first_seen_at
  };
}

function displayFilePath(filePath, workspace) {
  const path = slashPath(filePath);
  const base = slashPath(workspace).replace(/\/+$/, "");
  if (base && path.toLowerCase().startsWith(`${base.toLowerCase()}/`)) {
    return { path: path.slice(base.length + 1), outsideWorkspace: false };
  }
  return { path: path.split("/").filter(Boolean).at(-1) || "Unknown file", outsideWorkspace: true };
}

function gitContext(cwd) {
  if (!cwd || !existsSync(cwd)) return { repository: "", branch: "" };
  try {
    const repository = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", timeout: 1500, windowsHide: true }).trim();
    const branch = execFileSync("git", ["branch", "--show-current"], { cwd, encoding: "utf8", timeout: 1500, windowsHide: true }).trim();
    return { repository, branch };
  } catch {
    return { repository: "", branch: "" };
  }
}

function suggestedTitle(cwd) {
  if (!cwd) return "New Copilot session";
  return `${cwd.split(/[\\/]/).filter(Boolean).at(-1) || "Workspace"} session`;
}

function eventDetail(eventName, payload) {
  if (eventName === "sessionStart") return payload.source === "resume" ? "Session resumed" : "Session started";
  if (eventName === "sessionEnd") return `Session ended: ${payload.reason || "unknown"}`;
  if (eventName === "preCompact") return `Context compacted: ${payload.trigger || "unknown"}`;
  if (eventName === "agentStop") return "Copilot completed a turn";
  return eventName;
}

function addEvent(sessionId, type, detail, timestamp) {
  db.prepare("INSERT INTO events(session_id, type, detail, created_at) VALUES (?, ?, ?, ?)")
    .run(sessionId, type, detail, timestamp);
}

function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) client.write(message);
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanArray(value, maxItems, maxLength) {
  return Array.isArray(value) ? value.slice(0, maxItems).map((item) => cleanText(item, maxLength)).filter(Boolean) : [];
}

function cleanHistoryFile(row) {
  if (!row || typeof row.file_path !== "string") return null;
  const filePath = row.file_path.trim();
  if (!filePath || filePath.length > 1024 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/i.test(filePath)) {
    return null;
  }
  return {
    filePath,
    pathKey: slashPath(filePath).toLowerCase(),
    toolName: cleanText(row.tool_name, 64),
    turnIndex: Number.isInteger(row.turn_index) && row.turn_index >= 0 ? row.turn_index : null,
    firstSeenAt: parseHistoryTimestamp(row.first_seen_at)
  };
}

function slashPath(value) {
  return typeof value === "string" ? value.replaceAll("\\", "/").replace(/\/+/g, "/") : "";
}

function parseArray(value) {
  try {
    return JSON.parse(value || "[]");
  } catch {
    return [];
  }
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

function json(response, status, value) {
  response.writeHead(status, {
    ...antiFramingHeaders,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(value));
}

function importHistory() {
  if (!existsSync(historyPath)) {
    markAllFileHistoryFailure("SOURCE_DB_UNAVAILABLE");
    return { imported: 0, skipped: 0, fileSessions: 0, available: false, error: "SOURCE_DB_UNAVAILABLE" };
  }
  let history;
  try {
    history = new DatabaseSync(historyPath, { readOnly: true });
    const tables = history.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
    if (!tables.includes("sessions")) {
      markAllFileHistoryFailure("SOURCE_SCHEMA_UNSUPPORTED");
      return { imported: 0, skipped: 0, fileSessions: 0, available: false, error: "SOURCE_SCHEMA_UNSUPPORTED" };
    }
    const sourceSessions = history.prepare(`
      SELECT id, cwd, repository, branch, summary, created_at, updated_at
      FROM sessions
      WHERE host_type IS NULL
      ORDER BY updated_at DESC
      LIMIT 1000
    `).all();
    const latestCheckpoint = tables.includes("checkpoints")
      ? history.prepare(`
          SELECT title, overview, work_done, next_steps
          FROM checkpoints
          WHERE session_id = ?
          ORDER BY checkpoint_number DESC, created_at DESC
          LIMIT 1
        `)
      : null;
    const latestTurn = tables.includes("turns")
      ? history.prepare(`
          SELECT user_message, assistant_response
          FROM turns
          WHERE session_id = ?
          ORDER BY turn_index DESC
          LIMIT 1
        `)
      : null;
    const allTurns = tables.includes("turns")
      ? history.prepare(`
          SELECT user_message
          FROM turns
          WHERE session_id = ?
          ORDER BY turn_index
          LIMIT 100
        `)
      : null;
    const sourceFiles = tables.includes("session_files")
      ? history.prepare(`
          SELECT session_id, file_path, tool_name, turn_index, first_seen_at
          FROM session_files
          WHERE session_id = ?
          ORDER BY turn_index, first_seen_at, file_path
          LIMIT 10001
        `)
      : null;
    if (!sourceFiles) markAllFileHistoryFailure("SOURCE_SCHEMA_UNSUPPORTED");
    const insert = db.prepare(`
      INSERT OR IGNORE INTO sessions
      (id, title, summary, initial_question, questions, last_action, next_action, cwd, repository, branch, source,
       status, started_at, updated_at, ended_at, end_reason, needs_review, imported)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'history-import', 'paused', ?, ?, ?, 'historical', 1, 1)
    `);
    const addImportEvent = db.prepare(`
      INSERT INTO events(session_id, type, detail, created_at)
      SELECT ?, 'history-import', 'Imported from existing Copilot CLI history', ?
      WHERE NOT EXISTS (SELECT 1 FROM events WHERE session_id = ? AND type = 'history-import')
    `);
    let imported = 0;
    let skipped = 0;
    let fileSessions = 0;
    db.exec("BEGIN");
    try {
      for (const source of sourceSessions) {
        const fileRows = sourceFiles ? sourceFiles.all(source.id) : [];
        const hasFileEvidence = fileRows.some((row) => cleanHistoryFile(row));
        const checkpoint = latestCheckpoint?.get(source.id) || {};
        const turn = latestTurn?.get(source.id) || {};
        const questions = cleanSessionQuestions(allTurns?.all(source.id) || []);
        const initialQuestion = questions.find((question) => !isSkillAction(question)) || questions[0] || "";
        const rawTitle = checkpoint.title || source.summary || firstMeaningfulLine(turn.user_message);
        const summary = cleanText(checkpoint.overview, 3000) ||
          cleanText(source.summary && source.summary.length > 160 ? source.summary : "", 3000) ||
          cleanText(turn.assistant_response, 1200);
        const lastAction = cleanText(checkpoint.work_done, 1000) || cleanText(turn.assistant_response, 1000);
        const nextAction = cleanText(checkpoint.next_steps, 1000);
        const existing = db.prepare("SELECT id FROM sessions WHERE id = ?").get(source.id);
        if (!existing && !cleanText(rawTitle, 500) && !summary && !lastAction && !source.cwd && !hasFileEvidence) {
          skipped++;
          continue;
        }
        const startedAt = parseTimestamp(source.created_at) || Date.now();
        const updatedAt = parseTimestamp(source.updated_at) || startedAt;
        if (!existing) {
          const title = historyTitle(rawTitle, source.cwd);
          const result = insert.run(
            source.id,
            title || suggestedTitle(source.cwd),
            summary,
            initialQuestion,
            JSON.stringify(questions),
            lastAction,
            nextAction,
            source.cwd || "",
            source.repository || "",
            source.branch || "",
            startedAt,
            updatedAt,
            updatedAt
          );
          if (result.changes) {
            imported++;
            addImportEvent.run(source.id, updatedAt, source.id);
            if (nextAction) {
              db.prepare(`
                INSERT INTO tasks(session_id, text, completed, position, created_at, status)
                VALUES (?, ?, 0, 0, ?, 'backlog')
              `).run(source.id, firstMeaningfulLine(nextAction).slice(0, 500), updatedAt);
            }
          }
        } else {
          skipped++;
          if (questions.length) {
            db.prepare("UPDATE sessions SET initial_question = ?, questions = ? WHERE id = ?")
              .run(initialQuestion, JSON.stringify(questions), source.id);
          }
        }
        if (sourceFiles) {
          if (replaceSessionFiles(source.id, fileRows, Date.now(), false)) fileSessions++;
        } else {
          markFileHistoryFailure(source.id, "SOURCE_SCHEMA_UNSUPPORTED");
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { imported, skipped, fileSessions, available: true, filesAvailable: Boolean(sourceFiles) };
  } catch (error) {
    console.error("Could not import Copilot history:", error.message);
    markAllFileHistoryFailure("SOURCE_DB_UNAVAILABLE");
    return { imported: 0, skipped: 0, fileSessions: 0, available: true, error: "SOURCE_DB_UNAVAILABLE" };
  } finally {
    history?.close();
  }
}

function syncSessionFiles(sessionId) {
  if (!existsSync(historyPath)) return markFileHistoryFailure(sessionId, "SOURCE_DB_UNAVAILABLE");
  let history;
  try {
    history = new DatabaseSync(historyPath, { readOnly: true });
    syncSessionQuestion(history, sessionId);
    const hasFiles = history.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_files'").get();
    if (!hasFiles) return markFileHistoryFailure(sessionId, "SOURCE_SCHEMA_UNSUPPORTED");
    const rows = history.prepare(`
      SELECT session_id, file_path, tool_name, turn_index, first_seen_at
      FROM session_files
      WHERE session_id = ?
      ORDER BY turn_index, first_seen_at, file_path
      LIMIT 10001
    `).all(sessionId);
    return replaceSessionFiles(sessionId, rows, Date.now());
  } catch {
    return markFileHistoryFailure(sessionId, "SOURCE_DB_UNAVAILABLE");
  } finally {
    history?.close();
  }
}

function syncSessionQuestion(history, sessionId) {
  const hasTurns = history.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'turns'").get();
  if (!hasTurns) return;
  const rows = history.prepare(`
    SELECT user_message
    FROM turns
    WHERE session_id = ?
    ORDER BY turn_index
    LIMIT 100
  `).all(sessionId);
  const questions = cleanSessionQuestions(rows);
  if (questions.length) {
    const initialQuestion = questions.find((question) => !isSkillAction(question)) || questions[0];
    db.prepare("UPDATE sessions SET initial_question = ?, questions = ? WHERE id = ?")
      .run(initialQuestion, JSON.stringify(questions), sessionId);
  }
}

function cleanSessionQuestions(rows) {
  const seen = new Set();
  const questions = [];
  for (const row of rows) {
    const raw = typeof row?.user_message === "string" ? row.user_message : "";
    const skillMatch = raw.match(/<skill-context\s+name=["']([^"']+)["']/i);
    const skillAction = skillMatch ? `${humanizeSkillName(skillMatch[1])} skill was called.` : "";
    const withoutSystemContext = raw
      .replace(/<current_datetime>[\s\S]*?<\/current_datetime>/gi, "")
      .replace(/<system_reminder>[\s\S]*?<\/system_reminder>/gi, "")
      .replace(/<system_notification>[\s\S]*?<\/system_notification>/gi, "")
      .replace(/<skill-context[\s\S]*?<\/skill-context>/gi, "")
      .replace(/<working_directory_changed>[\s\S]*?<\/working_directory_changed>/gi, "");
    const text = skillAction || cleanText(withoutSystemContext, 2000);
    if (!text || text.startsWith("/")) continue;
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push(text);
    if (questions.length >= 50) break;
  }
  return questions;
}

function humanizeSkillName(value) {
  return String(value || "")
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function isSkillAction(value) {
  return String(value || "").endsWith(" skill was called.");
}

function replaceSessionFiles(sessionId, sourceRows, timestamp, useTransaction = true) {
  if (sourceRows.length > 10000) return markFileHistoryFailure(sessionId, "SOURCE_ROWS_TRUNCATED");
  const files = new Map();
  let invalidRows = 0;
  for (const row of sourceRows) {
    const file = cleanHistoryFile(row);
    if (!file) {
      invalidRows++;
      continue;
    }
    const existing = files.get(file.pathKey);
    if (!existing || (file.turnIndex ?? -1) >= (existing.turnIndex ?? -1)) files.set(file.pathKey, file);
  }
  if (invalidRows) return markFileHistoryFailure(sessionId, "SOURCE_ROWS_INVALID");
  const write = () => {
    db.prepare("DELETE FROM session_files WHERE session_id = ?").run(sessionId);
    const insert = db.prepare(`
      INSERT INTO session_files(session_id, file_path, path_key, tool_name, turn_index, first_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const file of files.values()) {
      insert.run(sessionId, file.filePath, file.pathKey, file.toolName, file.turnIndex, file.firstSeenAt);
    }
    db.prepare("UPDATE sessions SET files_status = ?, files_synced_at = ?, files_sync_error = '' WHERE id = ?")
      .run(files.size ? "current" : "empty", timestamp, sessionId);
  };
  if (!useTransaction) {
    write();
    return true;
  }
  db.exec("BEGIN");
  try {
    write();
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    markFileHistoryFailure(sessionId, "LOCAL_SYNC_FAILED");
    return false;
  }
}

function markFileHistoryFailure(sessionId, errorCode) {
  const count = Number(db.prepare("SELECT COUNT(*) AS count FROM session_files WHERE session_id = ?").get(sessionId)?.count || 0);
  db.prepare("UPDATE sessions SET files_status = ?, files_sync_error = ? WHERE id = ?")
    .run(count ? "stale" : "unavailable", errorCode, sessionId);
  return false;
}

function markAllFileHistoryFailure(errorCode) {
  db.prepare(`
    UPDATE sessions
    SET files_status = CASE
      WHEN EXISTS (SELECT 1 FROM session_files sf WHERE sf.session_id = sessions.id) THEN 'stale'
      ELSE 'unavailable'
    END,
    files_sync_error = ?
  `).run(errorCode);
}

function normalizeFileStatus(value) {
  return ["current", "empty", "stale", "unavailable"].includes(value) ? value : "unavailable";
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function historyTitle(value, cwd) {
  const text = cleanText(value, 500);
  if (!text) return suggestedTitle(cwd);
  const firstLine = firstMeaningfulLine(text);
  if (/^(Session File Path:|PromptRouter local preparation:|Environment:|Read [A-Z]:\\)/i.test(firstLine)) {
    return suggestedTitle(cwd);
  }
  return firstLine.slice(0, 120);
}

function firstMeaningfulLine(value) {
  if (typeof value !== "string") return "";
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
}

function parseTimestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function parseHistoryTimestamp(value) {
  if (Number.isFinite(value)) return Number(value);
  return parseTimestamp(value);
}

function readSessionMetrics(sessionId, transcriptPath) {
  const eventsPath = transcriptPath && existsSync(transcriptPath)
    ? transcriptPath
    : join(homedir(), ".copilot", "session-state", sessionId, "events.jsonl");
  const empty = {
    aiCredits: null,
    currentTokens: null,
    contextLimit: null,
    model: "",
    contextTier: "",
    capturedAt: Date.now()
  };
  if (!existsSync(eventsPath)) return empty;
  try {
    let totalNanoAiu = null;
    let currentTokens = null;
    let contextLimit = null;
    let model = "";
    let contextTier = "";
    for (const line of readFileSync(eventsPath, "utf8").split(/\r?\n/)) {
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "session.usage_checkpoint" && Number.isFinite(event.data?.totalNanoAiu)) {
        totalNanoAiu = event.data.totalNanoAiu;
      }
      if (event.type === "session.shutdown") {
        if (Number.isFinite(event.data?.totalNanoAiu)) totalNanoAiu = event.data.totalNanoAiu;
        if (Number.isFinite(event.data?.currentTokens)) currentTokens = event.data.currentTokens;
        if (event.data?.currentModel) model = event.data.currentModel;
      }
      if (event.type === "session.resume") {
        if (event.data?.selectedModel) model = event.data.selectedModel;
        if (event.data?.contextTier) contextTier = event.data.contextTier;
      }
      if (event.type === "session.model_change") {
        if (event.data?.newModel) model = event.data.newModel;
        if (event.data?.contextTier) contextTier = event.data.contextTier;
      }
      const limit = findNumericMetric(event.data, "responseTokenLimit");
      if (limit) contextLimit = limit;
    }
    return {
      aiCredits: totalNanoAiu === null ? null : totalNanoAiu / 1_000_000_000,
      currentTokens,
      contextLimit,
      model,
      contextTier,
      capturedAt: Date.now()
    };
  } catch (error) {
    console.error(`Could not read metrics for session ${sessionId}:`, error.message);
    return empty;
  }
}

function findNumericMetric(value, key) {
  if (!value || typeof value !== "object") return null;
  if (Number.isFinite(value[key])) return value[key];
  for (const child of Object.values(value)) {
    const found = findNumericMetric(child, key);
    if (found !== null) return found;
  }
  return null;
}

function normalizeTaskStatus(value) {
  return ["backlog", "next", "in_progress", "blocked", "done"].includes(value) ? value : "next";
}

function emptyBoardCounts() {
  return { backlog: 0, next: 0, in_progress: 0, blocked: 0, done: 0 };
}

function normalizeWorkItemType(value) {
  return ["Epic", "Feature", "PBI", "Task", "Bug"].includes(value) ? value : "PBI";
}

function parseAdoWorkItemUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const match = url.pathname.match(/\/_workitems\/edit\/(\d+)(?:\/|$)/i);
    if (!match) return null;
    return { id: Number(match[1]), url: url.toString() };
  } catch {
    return null;
  }
}

function isAllowedRequest(request) {
  const host = request.headers.host || "";
  if (!new RegExp(`^(127\\.0\\.0\\.1|localhost):${port}$`, "i").test(host)) return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  return origin === baseUrl || origin === `http://localhost:${port}`;
}

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
