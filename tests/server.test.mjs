import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = await mkdtemp(join(tmpdir(), "copilot-session-hub-"));
const port = 43121;
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server/server.mjs"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: {
    ...process.env,
    COPILOT_SESSION_HUB_DATA: dataDir,
    COPILOT_SESSION_HUB_PORT: String(port),
    COPILOT_SESSION_HUB_IMPORT_HISTORY: "0"
  },
  stdio: "ignore",
  windowsHide: true
});

await waitForHealth();

test.after(async () => {
  await fetch(`${baseUrl}/api/shutdown`, { method: "POST" }).catch(() => {});
  server.kill();
});

test("tracks, checkpoints, and updates a Copilot session", async () => {
  const id = "test-session-1";
  let response = await fetch(`${baseUrl}/api/hooks/sessionStart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: id, timestamp: Date.now(), cwd: process.cwd(), source: "new" })
  });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/api/sessions/${id}/checkpoint`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Build session dashboard",
      summary: "Implemented local continuity tracking.",
      lastAction: "Created the API.",
      nextAction: "Verify the dashboard.",
      tasks: ["Run tests", "Install plugin"],
      unresolved: ["Visual regression testing"],
      decisions: ["Use localhost-only storage"]
    })
  });
  assert.equal(response.status, 200);

  const session = await fetch(`${baseUrl}/api/sessions/${id}`).then((result) => result.json());
  assert.equal(session.title, "Build session dashboard");
  assert.equal(session.tasks.length, 2);
  assert.equal(session.needsReview, false);

  response = await fetch(`${baseUrl}/api/tasks/${session.tasks[0].id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ completed: true })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).completed, true);

  response = await fetch(`${baseUrl}/api/tasks/${session.tasks[1].id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "in_progress" })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "in_progress");

  response = await fetch(`${baseUrl}/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ isProject: true })
  });
  assert.equal(response.status, 200);

  response = await fetch(`${baseUrl}/api/sessions/${id}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "Feature",
      title: "Session continuity",
      url: "https://example.visualstudio.com/Engineering/_workitems/edit/12345"
    })
  });
  assert.equal(response.status, 201);

  const board = await fetch(`${baseUrl}/api/board?sessionId=${id}`).then((result) => result.json());
  assert.equal(board.counts.done, 1);
  assert.equal(board.counts.in_progress, 1);
  assert.equal(board.workItems[0].workItemId, 12345);
  const projects = await fetch(`${baseUrl}/api/projects`).then((result) => result.json());
  assert.equal(projects.length, 1);
  assert.equal(projects[0].isProject, true);

  response = await fetch(`${baseUrl}/api/sessions/${id}/checkpoint`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ summary: "Updated summary only." })
  });
  assert.equal(response.status, 200);
  const preserved = await fetch(`${baseUrl}/api/sessions/${id}`).then((result) => result.json());
  assert.equal(preserved.title, "Build session dashboard");
  assert.equal(preserved.tasks.length, 2);
  assert.equal(preserved.summary, "Updated summary only.");
  assert.equal(preserved.imported, false);
  assert.equal(preserved.workItems.length, 1);
  assert.ok("metrics" in preserved);
});

test("checkpoint task reconciliation preserves board identities and statuses", async () => {
  const id = "task-preservation";
  await fetch(`${baseUrl}/api/hooks/sessionStart`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: id, timestamp: Date.now(), cwd: process.cwd(), source: "new" })
  });
  await fetch(`${baseUrl}/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ isProject: true })
  });

  const taskA = await fetch(`${baseUrl}/api/sessions/${id}/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Keep backlog identity" })
  }).then((response) => response.json());
  const taskB = await fetch(`${baseUrl}/api/sessions/${id}/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Keep blocked identity" })
  }).then((response) => response.json());
  await fetch(`${baseUrl}/api/tasks/${taskA.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "backlog" })
  });
  await fetch(`${baseUrl}/api/tasks/${taskB.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "blocked" })
  });

  let response = await fetch(`${baseUrl}/api/sessions/${id}/checkpoint`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tasks: ["Keep backlog identity", "New AI-discovered task"] })
  });
  assert.equal(response.status, 200);

  let session = await fetch(`${baseUrl}/api/sessions/${id}`).then((result) => result.json());
  const preservedA = session.tasks.find((task) => task.text === "Keep backlog identity");
  const preservedB = session.tasks.find((task) => task.text === "Keep blocked identity");
  assert.equal(preservedA.id, taskA.id);
  assert.equal(preservedA.status, "backlog");
  assert.equal(preservedB.id, taskB.id);
  assert.equal(preservedB.status, "blocked");
  assert.equal(session.tasks.filter((task) => task.text === "Keep backlog identity").length, 1);
  assert.equal(session.tasks.some((task) => task.text === "New AI-discovered task"), true);

  response = await fetch(`${baseUrl}/api/sessions/${id}/checkpoint`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tasks: [] })
  });
  assert.equal(response.status, 200);
  session = await fetch(`${baseUrl}/api/sessions/${id}`).then((result) => result.json());
  assert.equal(session.tasks.find((task) => task.id === taskA.id).status, "backlog");
  assert.equal(session.tasks.find((task) => task.id === taskB.id).status, "blocked");
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test server did not start");
}
