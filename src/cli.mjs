#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { configuredProvider, loadConfig } from "./config.mjs";
import { routeRequest } from "./route.mjs";

const args = parseArgs(process.argv.slice(2));
const { config } = await loadConfig();
const input = args.input ? await readFile(args.input, "utf8") : null;
const lines = input === null ? createInterface({ input: process.stdin, crlfDelay: Infinity }) : [input];

for await (const line of lines) {
  if (!line.trim()) continue;
  try {
    const request = JSON.parse(line);
    const { provider = args.provider ?? configuredProvider(config), engine = args.engine ?? "native", ...payload } = request;
    const decision = await routeRequest(payload, { provider, engine, config });
    process.stdout.write(`${JSON.stringify(decision)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "error", reason: error instanceof Error ? error.message : String(error), execution: { enabled: false, status: "not_started" } })}\n`);
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") result.input = argv[++index];
    else if (value === "--provider") result.provider = argv[++index];
    else if (value === "--engine") result.engine = argv[++index];
  }
  return result;
}
