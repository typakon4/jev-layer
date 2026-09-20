import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = process.env.JEV_LAYER_ROOT
  ? resolve(process.env.JEV_LAYER_ROOT)
  : fileURLToPath(new URL("../..", import.meta.url));
const CORE = resolve(PACKAGE_ROOT, "src/cli.mjs");
export default function jevLayerExtension(pi) {
  const z = pi.zod;
  pi.registerTool({
    name: "jev_route",
    label: "Jev route",
    description: "Return one bounded Jev capability decision. The host executes the selected capability; this tool never executes it.",
    parameters: z.object({
      intent: z.string(),
      harness: z.string().optional(),
      context: z.unknown().optional(),
      actor_permissions: z.array(z.string()).optional(),
      capabilities: z.array(z.unknown()),
      policy: z.unknown().optional(),
    }),
    async execute(_toolCallId, params, signal) {
      const decision = await runCore({ ...params, harness: params.harness ?? "omp" }, signal);
      return {
        content: [{ type: "text", text: JSON.stringify(decision) }],
        details: decision,
      };
    },
  });
}

async function runCore(payload, signal) {
  if (globalThis.Bun?.spawn) return runCoreWithBun(payload, signal);
  return runCoreWithNode(payload, signal);
}

async function runCoreWithBun(payload, signal) {
  const child = Bun.spawn([process.env.JEV_NODE ?? "node", CORE], {
    cwd: process.cwd(),
    env: process.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const abort = () => child.kill("SIGTERM");
  signal?.addEventListener("abort", abort, { once: true });
  child.stdin.write(`${JSON.stringify(payload)}\n`);
  child.stdin.end();
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  signal?.removeEventListener("abort", abort);
  return parseCoreOutput(stdout, stderr, code);
}

function runCoreWithNode(payload, signal) {
  return new Promise((resolve) => {
    const child = spawn(process.env.JEV_NODE ?? "node", [CORE], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => resolve(fallback(error.message)));
    child.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      resolve(parseCoreOutput(stdout, stderr, code));
    });
    child.stdin.end(`${JSON.stringify(payload)}\n`);
  });
}

function parseCoreOutput(stdout, stderr, code) {
  if (code !== 0) return fallback(stderr.trim() || `core exited with status ${code}`);
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const jsonStart = line.indexOf("{");
    if (jsonStart < 0) continue;
    try {
      return JSON.parse(line.slice(jsonStart));
    } catch {
      // Ignore non-decision lines emitted by a host runtime wrapper.
    }
  }
  return fallback("core returned no valid JSON decision");
}

function fallback(reason) {
  return {
    schema_version: 1,
    status: "fallback",
    selected: null,
    reason,
    fallback: { type: "adapter_error", reason },
    execution: { enabled: false, status: "not_started" },
  };
}
