import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = process.env.JEV_LAYER_ROOT
  ? resolve(process.env.JEV_LAYER_ROOT)
  : resolve(pluginRoot, "../..");

await import(resolve(projectRoot, "src/mcp-server.mjs"));
