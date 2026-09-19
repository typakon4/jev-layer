#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configuredProvider, loadConfig, pathExists } from "../src/config.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [command = "help", ...argv] = process.argv.slice(2);

try {
  if (command === "mcp") {
    await import("../src/mcp-server.mjs");
  } else if (command === "cli") {
    await import("../src/cli.mjs");
  } else if (command === "install") {
    await install(argv);
  } else if (command === "init") {
    await init(argv);
  } else if (command === "add") {
    await add(argv);
  } else if (command === "doctor") {
    await doctor(argv);
  } else {
    printHelp();
    if (command !== "help" && command !== "--help" && command !== "-h") process.exitCode = 1;
  }
} catch (error) {
  console.error(`jev: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function install(argv) {
  const options = parseOptions(argv);
  const project = projectPath(options);
  const result = await writeInitialConfig(project, options.force);
  console.log(`jev-layer ${result.created ? "initialized" : "already initialized"} at ${project}`);
  console.log("Runtime dependencies: none. Node.js >= 20 is required.");
  console.log("Next: jev add <omp|hermes|codex|generic> && jev doctor");
}

async function init(argv) {
  const options = parseOptions(argv);
  const project = projectPath(options);
  const result = await writeInitialConfig(project, options.force);
  console.log(JSON.stringify({ ok: true, project, created: result.created, config: result.configPath, env_example: result.envPath }, null, 2));
}

async function add(argv) {
  const harness = argv[0];
  if (!harness || ["--help", "-h"].includes(harness)) {
    console.error("Usage: jev add <omp|hermes|codex|generic> [--project DIR] [--command CMD]");
    process.exitCode = 1;
    return;
  }
  const options = parseOptions(argv.slice(1));
  const project = projectPath(options);
  const { config } = await loadConfig({ cwd: project });
  const provider = configuredProvider(config, options.provider);
  const commandName = options.command ?? process.env.JEV_COMMAND ?? "jev";
  const server = {
    type: "stdio",
    command: commandName,
    args: ["mcp"],
    cwd: ".",
    env: { JEV_LAYER_PROVIDER: provider },
  };

  let destination;
  let mode = "snippet";
  if (harness === "omp") {
    destination = await addOmp(project, server);
    mode = destination.endsWith(".omp/mcp.json") ? "config" : "snippet";
  } else if (harness === "codex") {
    destination = await addCodex(project, server);
    mode = destination.endsWith(".codex/config.toml") ? "config" : "snippet";
  } else if (harness === "hermes") {
    destination = await writeSnippet(project, "hermes", hermesSnippet(server));
  } else if (harness === "generic" || harness === "mcp") {
    destination = await writeSnippet(project, "generic", JSON.stringify({ mcpServers: { jev: server } }, null, 2) + "\n", ".json");
  } else {
    throw new Error(`unsupported harness: ${harness}`);
  }

  console.log(JSON.stringify({ ok: true, harness, provider, destination, mode, command: commandName }, null, 2));
  if (mode === "snippet") console.log("Merge this adapter snippet into the harness configuration; existing files were not overwritten.");
}

async function doctor(argv) {
  const options = parseOptions(argv);
  const project = projectPath(options);
  const { config, path: configPath, error: configError } = await loadConfig({ cwd: project });
  const provider = configuredProvider(config, options.provider);
  const checks = [];
  const fail = (name, detail) => checks.push({ name, status: "error", detail });
  const pass = (name, detail) => checks.push({ name, status: "ok", detail });
  const warn = (name, detail) => checks.push({ name, status: "warning", detail });
  const nodeMajor = Number(process.versions.node.split(".")[0]);

  if (nodeMajor >= 20) pass("node", process.versions.node);
  else fail("node", `Node.js >= 20 required; found ${process.versions.node}`);
  for (const relative of ["src/route.mjs", "src/cli.mjs", "src/mcp-server.mjs", "bin/jev.mjs"]) {
    if (await pathExists(join(PACKAGE_ROOT, relative))) pass(`package:${relative}`, "present");
    else fail(`package:${relative}`, "missing from installation");
  }
  if (configError) fail("config", configError);
  else if (await pathExists(configPath)) pass("config", configPath);
  else warn("config", `not initialized at ${configPath}; run jev init`);

  if (!["demo", "openrouter", "typesafe"].includes(provider)) fail("provider", `unsupported provider ${provider}`);
  else pass("provider", provider);
  if (provider === "openrouter" || provider === "typesafe") {
    const keyEnv = config.providers?.[provider]?.api_key_env ?? (provider === "openrouter" ? "OPENROUTER_API_KEY" : "TYPESAFE_API_KEY");
    if (process.env[keyEnv]) pass(`secret:${keyEnv}`, "configured through environment");
    else fail(`secret:${keyEnv}`, `missing; export ${keyEnv} before using ${provider}`);
  } else {
    pass("provider-secret", "not required for demo provider");
  }
  if (process.env.JEV_LAYER_ENABLED === "0") warn("fail-open", "JEV_LAYER_ENABLED=0; routing will return fallback decisions");

  const errors = checks.filter((check) => check.status === "error");
  console.log(JSON.stringify({ ok: errors.length === 0, project, package_root: PACKAGE_ROOT, checks }, null, 2));
  if (errors.length) process.exitCode = 1;
}

async function writeInitialConfig(project, force = false) {
  const state = join(project, ".jev");
  await mkdir(state, { recursive: true });
  const configPath = join(state, "config.json");
  const envPath = join(state, "providers.env.example");
  const config = await readPackageFile("config/jev.example.json");
  const envExample = await readPackageFile("config/providers.env.example");
  const configCreated = await writeIfAllowed(configPath, config, force);
  const envCreated = await writeIfAllowed(envPath, envExample, force);
  return { created: configCreated || envCreated, configPath, envPath };
}

async function addOmp(project, server) {
  const target = join(project, ".omp", "mcp.json");
  if (!(await pathExists(target))) {
    await writeJson(target, { "$schema": "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json", mcpServers: { jev: server } });
    return target;
  }
  try {
    const parsed = JSON.parse(await readFile(target, "utf8"));
    parsed.mcpServers = { ...(parsed.mcpServers ?? {}), jev: server };
    await writeFile(target, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    return target;
  } catch {
    return writeSnippet(project, "omp", JSON.stringify({ mcpServers: { jev: server } }, null, 2) + "\n", ".json");
  }
}

async function addCodex(project, server) {
  const target = join(project, ".codex", "config.toml");
  if (!(await pathExists(target))) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, codexSnippet(server), "utf8");
    return target;
  }
  return writeSnippet(project, "codex", codexSnippet(server), ".toml");
}

async function writeSnippet(project, name, content, extension = ".yaml") {
  const destination = join(project, ".jev", "adapters", `${name}${extension}`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, "utf8");
  return destination;
}

function codexSnippet(server) {
  return `[mcp_servers.jev]\ncommand = ${JSON.stringify(server.command)}\nargs = ["mcp"]\ncwd = "."\n\n[mcp_servers.jev.env]\nJEV_LAYER_PROVIDER = ${JSON.stringify(server.env.JEV_LAYER_PROVIDER)}\n`;
}

function hermesSnippet(server) {
  return `mcp_servers:\n  jev:\n    command: ${server.command}\n    args:\n      - mcp\n    env:\n      JEV_LAYER_PROVIDER: ${server.env.JEV_LAYER_PROVIDER}\n      # Export OPENROUTER_API_KEY or TYPESAFE_API_KEY in the Hermes process environment.\n`;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeIfAllowed(path, content, force) {
  if (!force && await pathExists(path)) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return true;
}

async function readPackageFile(relative) {
  return readFile(join(PACKAGE_ROOT, relative), "utf8");
}

function projectPath(options) {
  return resolve(options.project ?? process.cwd());
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--project") options.project = argv[++index];
    else if (value === "--command") options.command = argv[++index];
    else if (value === "--provider") options.provider = argv[++index];
    else if (value === "--force") options.force = true;
    else if (value === "--help" || value === "-h") options.help = true;
    else throw new Error(`unknown option ${value}`);
  }
  return options;
}

function printHelp() {
  console.log(`jev-layer portable setup\n\nCommands:\n  jev install [--project DIR]       initialize local state\n  jev init [--project DIR]          write .jev/config.json and env example\n  jev add <harness> [options]       add omp, hermes, codex, or generic MCP adapter\n  jev doctor [--project DIR]        check runtime, config, provider and secrets\n  jev mcp                           run the stdio MCP server\n  jev cli                           run the JSONL CLI adapter\n\nOptions:\n  --project DIR                     target workspace; defaults to cwd\n  --command CMD                     MCP command; defaults to jev\n  --provider NAME                   override provider for generated config\n  --force                           replace generated init files\n`);
}