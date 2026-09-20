import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const DEFAULT_CONFIG = Object.freeze({
  schema_version: 1,
  provider: "demo",
  replay_cases: ".jev/replay/cases.jsonl",
  features: {
    browser_fast_path: false,
    supervision: false,
    context_filter: null,
  },
  providers: {
    openrouter: {
      api_key_env: "OPENROUTER_API_KEY",
      endpoint_env: "OPENROUTER_DECISIONS_ENDPOINT",
      model_env: "OPENROUTER_DECISIONS_MODEL",
    },
    typesafe: {
      api_key_env: "TYPESAFE_API_KEY",
      endpoint_env: "TYPESAFE_ENDPOINT",
      model_env: "TYPESAFE_MODEL",
    },
  },
});

export async function loadConfig({ cwd = process.cwd(), path = process.env.JEV_CONFIG } = {}) {
  const configPath = resolve(path || join(cwd, ".jev", "config.json"));
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { config: { ...DEFAULT_CONFIG }, path: configPath, error: "config must be a JSON object" };
    }
    return {
      config: mergeConfig(parsed),
      path: configPath,
      error: null,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { config: { ...DEFAULT_CONFIG }, path: configPath, error: null };
    return { config: { ...DEFAULT_CONFIG }, path: configPath, error: error instanceof Error ? error.message : String(error) };
  }
}

export function configuredProvider(config, explicitProvider) {
  return explicitProvider ?? process.env.JEV_LAYER_PROVIDER ?? config?.provider ?? DEFAULT_CONFIG.provider;
}

export function configuredProviderOptions(config, provider) {
  if (!config?.providers?.[provider]) return {};
  const names = { ...DEFAULT_CONFIG.providers[provider], ...config.providers[provider] };
  return {
    apiKey: process.env[names.api_key_env] ?? "",
    endpoint: process.env[names.endpoint_env],
    model: process.env[names.model_env],
  };
}

export function configuredReplayPath(config) {
  return process.env.JEV_REPLAY_CASES ?? config?.replay_cases ?? DEFAULT_CONFIG.replay_cases;
}

export async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function mergeConfig(parsed) {
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    features: {
      ...DEFAULT_CONFIG.features,
      ...(parsed.features && typeof parsed.features === "object" ? parsed.features : {}),
    },
    providers: {
      ...DEFAULT_CONFIG.providers,
      ...(parsed.providers && typeof parsed.providers === "object" ? parsed.providers : {}),
    },
  };
}
