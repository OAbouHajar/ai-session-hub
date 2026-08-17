import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const eventName = process.argv[2];
const input = await readStdin();
const payload = input ? JSON.parse(input) : {};
const url = process.env.COPILOT_SESSION_HUB_URL || "http://127.0.0.1:43120";

let response = await postEvent();
if (!response) {
  startServer();
  await delay(700);
  response = await postEvent();
}

if (!response) {
  await queueEvent();
  process.stdout.write("{}");
  process.exit(0);
}

if (eventName === "sessionStart") {
  const body = await response.json();
  process.stdout.write(JSON.stringify({
    additionalContext:
      `Copilot Session Hub is tracking this session. Session ID: ${payload.sessionId}. ` +
      `Checkpoint endpoint: ${url}/api/sessions/${encodeURIComponent(payload.sessionId)}/checkpoint. ` +
      `Dashboard: ${url}. When the user asks to wrap, checkpoint, pause, or hand off, save a structured checkpoint there.`
  }));
} else {
  process.stdout.write("{}");
}

async function postEvent() {
  try {
    const response = await fetch(`${url}/api/hooks/${eventName}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2500)
    });
    return response.ok ? response : null;
  } catch {
    return null;
  }
}

function startServer() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const child = spawn(process.execPath, [join(root, "server", "server.mjs")], {
    cwd: root,
    detached: true,
    windowsHide: true,
    stdio: "ignore"
  });
  child.unref();
}

async function queueEvent() {
  const dataDir = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "CopilotSessionHub")
    : join(homedir(), ".copilot-session-hub");
  const queuePath = join(dataDir, "pending-events.jsonl");
  await mkdir(dataDir, { recursive: true });
  await appendFile(queuePath, `${JSON.stringify({ eventName, payload })}\n`, "utf8");
}

async function readStdin() {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
