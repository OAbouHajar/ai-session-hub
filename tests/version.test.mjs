import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("package and plugin versions stay aligned", async () => {
  const [packageJson, pluginJson] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../plugin.json", import.meta.url), "utf8")
  ]);
  const packageVersion = JSON.parse(packageJson).version;
  const pluginVersion = JSON.parse(pluginJson).version;
  assert.match(packageVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(pluginVersion, packageVersion);
});
