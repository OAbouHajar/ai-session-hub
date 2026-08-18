import { readFileSync, writeFileSync } from "node:fs";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const status = JSON.parse(readFileSync(config.statusPath, "utf8"));
writeFileSync(config.statusPath, `${JSON.stringify({
  ...status,
  state: "waiting_for_exit",
  updatedAt: Date.now()
})}\n`);
