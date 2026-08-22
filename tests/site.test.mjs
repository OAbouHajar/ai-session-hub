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

  assert.match(html, /AI work management for your local machine/);
  assert.match(html, /Turn AI conversations into managed projects/);
  assert.match(html, /tasks, project boards, progress, and effort insights/);
  assert.match(html, /Your AI chat is not the project/);
  assert.match(html, /One board/);
  assert.match(html, /See what the result really took/);
  assert.match(html, /Stop anywhere/);
  assert.match(html, /Let your AI set it up/);
  assert.match(html, /id="copyHeroPrompt"/);
  assert.match(html, /Install with AI/);
  assert.match(html, /id="installPrompt"/);
  assert.match(html, /Copilot/);
  assert.match(html, /Claude Code/);
  assert.match(html, /OpenAI Codex/);
  assert.match(html, /Google Gemini/);
  assert.match(html, /screenshots\/board-screenshot\.png/);
  assert.match(script, /copyHeroPrompt/);
  assert.match(script, /copyPrompt/);
  assert.match(script, /navigator\.clipboard\.writeText/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /questions-screenshot\.png/);
  assert.match(workflow, /board-screenshot\.png/);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/);
});
