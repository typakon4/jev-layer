import { configuredProviderOptions } from "../config.mjs";
import { DemoProvider } from "./demo.mjs";
import { OpenRouterDecisionsProvider, TypeSafeProvider } from "./typesafe.mjs";

export function resolveProvider(provider, options = {}) {
  if (provider && typeof provider === "object") return provider;
  if (provider === "demo") return new DemoProvider();
  const settings = { ...configuredProviderOptions(options.config, provider), ...options[provider] };
  if (provider === "openrouter") return new OpenRouterDecisionsProvider(settings);
  if (provider === "typesafe") return new TypeSafeProvider(settings);
  throw new Error(`unsupported provider: ${provider}`);
}
