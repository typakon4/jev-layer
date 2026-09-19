import { readFile } from "node:fs/promises";

const DISCOVERY_SOURCES = Object.freeze([
  ["skills", "skill"],
  ["mcp", "mcp"],
  ["cli", "cli"],
  ["dsh", "dsh"],
  ["tools", "tool"],
  ["subagents", "subagent"],
  ["models", "model"],
]);

export function discoverCapabilities(input = {}) {
  const entries = [];
  for (const [field, kind] of DISCOVERY_SOURCES) {
    const values = Array.isArray(input[field]) ? input[field] : [];
    for (const value of values) entries.push(normalizeDiscovered(value, kind, input.source ?? `${kind}-discovery`));
  }
  const manifests = Array.isArray(input.manifests) ? input.manifests : [];
  for (const manifest of manifests) {
    const values = Array.isArray(manifest?.capabilities) ? manifest.capabilities : [manifest];
    for (const value of values) {
      const kind = value?.kind ?? value?.type ?? manifest?.kind ?? "tool";
      entries.push(normalizeDiscovered(value, kind, value?.source ?? manifest?.source ?? "manifest"));
    }
  }
  const seen = new Set();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

export async function loadCapabilityManifest(path, options = {}) {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  const manifest = Array.isArray(parsed) ? { capabilities: parsed } : parsed;
  return discoverCapabilities({ manifests: [{ ...manifest, source: options.source ?? manifest.source ?? "manifest" }] });
}

function normalizeDiscovered(value, kind, source) {
  if (!value || typeof value !== "object") throw new TypeError("discovered capability must be an object");
  const id = stringValue(value.id ?? value.name, `${kind}-capability`);
  const name = stringValue(value.name ?? value.id, id);
  const description = stringValue(value.description ?? value.summary, `${kind} capability ${name}`);
  const metadata = {
    ...(value.metadata && typeof value.metadata === "object" ? value.metadata : {}),
    [kind]: stringValue(value.target ?? value.command ?? value.name, name),
  };
  return {
    ...value,
    id,
    kind,
    name,
    description,
    source: stringValue(value.source, source),
    verified: value.verified === true,
    metadata,
    available: value.available !== false && value.availability?.available !== false,
  };
}

function stringValue(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
