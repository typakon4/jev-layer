#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { buildModelRouteReport } from "../src/model-route-metrics.mjs";

const path = process.argv[2] ?? process.env.JEV_REPLAY_CASES ?? ".jev/replay/cases.jsonl";
let text = "";
try {
  text = await readFile(path, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const records = text.split(/\r?\n/).filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
});
console.log(JSON.stringify(buildModelRouteReport(records), null, 2));
