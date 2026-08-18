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

  assert.match(html, /Local AI session management/);
  assert.match(html, /Manage your AI sessions in one place/);
  assert.match(html, /helps you track, visualize, and manage sessions/);
  assert.match(html, /turn sessions into projects/);
  assert.match(html, /Why do you need it/);
  assert.match(html, /Without Session Hub/);
  assert.match(html, /With Session Hub/);
  assert.match(html, /Ask your AI CLI to install it/);
  assert.match(html, /id="copyHeroPrompt"/);
  assert.match(html, /Copy AI install prompt/);
  assert.match(html, /id="installPrompt"/);
  assert.match(html, /Copilot/);
  assert.match(html, /Claude Code/);
  assert.match(html, /OpenAI Codex/);
  assert.match(html, /Google Gemini/);
  assert.match(html, /screenshots\/sessions-screenshot\.png/);
  assert.match(script, /#copyPrompt, #copyHeroPrompt/);
  assert.match(script, /navigator\.clipboard\.writeText/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/);
});
