import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("landing page presents the project and AI-first installation path", async () => {
  const [html, script, workflow] = await Promise.all([
    readFile(new URL("../site/index.html", import.meta.url), "utf8"),
    readFile(new URL("../site/app.js", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8")
  ]);

  assert.match(html, /Local continuity for AI coding/);
  assert.match(html, /Find the session/);
  assert.match(html, /Core capabilities/);
  assert.match(html, /Search sessions/);
  assert.match(html, /Restore context/);
  assert.match(html, /Resume instantly/);
  assert.match(html, /Convert to a project/);
  assert.match(html, /100%/);
  assert.match(html, /Search\. Review\. Resume\./);
  assert.match(html, /Turn a session into a board/);
  assert.match(html, /Ask your AI CLI to install it/);
  assert.match(html, /id="copyHeroPrompt"/);
  assert.match(html, /Copy AI install prompt/);
  assert.match(html, /id="installPrompt"/);
  assert.match(html, /Copilot/);
  assert.match(html, /Claude Code/);
  assert.match(html, /OpenAI Codex/);
  assert.match(html, /Google Gemini/);
  assert.match(html, /screenshots\/sessions-screenshot\.png/);
  assert.match(html, /screenshots\/board-screenshot\.png/);
  assert.match(script, /#copyPrompt, #copyHeroPrompt/);
  assert.match(script, /navigator\.clipboard\.writeText/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /board-screenshot\.png/);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/);
});
