import { createHash, randomUUID } from "node:crypto";
import { decisionEnvelope } from "./contract.mjs";
import { imageDimensions, normalizeImageAssets } from "./images.mjs";
import { resolveProvider } from "./providers/index.mjs";
import { routeRequest } from "./route.mjs";

const OPERATIONS = new Set(["click", "type", "key", "scroll", "handoff"]);
const CONSEQUENTIAL = new Set(["click", "type", "key"]);
const ARGUMENTS = {
  click: ["x", "y", "button"],
  type: ["text"],
  key: ["keys"],
  scroll: ["direction", "amount", "x", "y"],
  handoff: ["reason"],
};

export async function decideComputerStep(input, options = {}) {
  const enabled = options.enabled === true || options.enabled !== false && process.env.JEV_COMPUTER_USE === "1";
  if (!enabled) return failed(null, null, "computer_use_disabled", "Computer-use advice is disabled", options);

  let request;
  let actions;
  let screenshot;
  let thresholds;
  try {
    if (!object(input) || !text(input.goal, 8_000)) throw new TypeError("goal is required");
    const supplied = input.observation?.screenshot;
    if (!object(supplied)) throw new TypeError("screenshot is required");
    const reference = randomUUID();
    const assets = normalizeImageAssets({ [reference]: { type: "image", format: supplied.format, data_base64: supplied.data_base64 } });
    const dimensions = imageDimensions(assets[reference]);
    if (supplied.width !== dimensions.width || supplied.height !== dimensions.height) throw new TypeError("screenshot dimensions do not match image");
    screenshot = {
      ...dimensions,
      format: assets[reference].format,
      sha256: `sha256:${createHash("sha256").update(Buffer.from(assets[reference].data_base64, "base64")).digest("hex")}`,
      requires_current: true,
    };
    if (!Array.isArray(input.actions) || input.actions.length > 32) throw new TypeError("actions must contain at most 32 candidates");
    actions = input.actions.map((candidate) => normalizeAction(candidate, dimensions));
    if (new Set(actions.map((candidate) => candidate.id)).size !== actions.length) throw new TypeError("action ids must be unique");
    if (input.policy !== undefined && !object(input.policy) || options.policy !== undefined && !object(options.policy)) throw new TypeError("invalid policy");
    const policy = { ...(input.policy ?? {}), ...(options.policy ?? {}) };
    thresholds = {
      visibility: policy.min_target_visibility ?? 0.9,
      box: policy.min_box_confidence ?? 0.8,
    };
    if (!probability(thresholds.visibility) || thresholds.visibility === 0 || !probability(thresholds.box) || thresholds.box === 0) throw new TypeError("invalid grounding thresholds");
    const observation = { screenshot };
    for (const key of ["visible_text", "application"]) {
      if (input.observation[key] !== undefined) {
        if (!text(input.observation[key], key === "visible_text" ? 8_000 : 240, true)) throw new TypeError(`invalid ${key}`);
        observation[key] = input.observation[key];
      }
    }
    if (input.actor_permissions !== undefined && (!Array.isArray(input.actor_permissions) || input.actor_permissions.length > 32 || input.actor_permissions.some((permission) => !text(permission, 240)))) throw new TypeError("invalid actor_permissions");
    request = {
      schema_version: 1,
      harness: text(input.harness, 240) ? input.harness : "computer",
      intent: `Computer goal: ${input.goal}`,
      context: {
        computer: {
          observation,
          actions: actions.map(({ id, operation, args, target }) => ({ id, operation, args, ...(target ? { target } : {}) })),
        },
      },
      assets,
      actor_permissions: input.actor_permissions ?? [],
      capabilities: actions.map((candidate) => ({
        ...candidate,
        kind: "tool",
        name: candidate.name ?? `${candidate.operation}: ${candidate.id}`,
        description: candidate.description ?? `${candidate.operation} ${candidate.target ?? JSON.stringify(candidate.args)}`,
        permissions: [...new Set(["computer", ...(candidate.permissions ?? [])])],
        risk: candidate.risk ?? (CONSEQUENTIAL.has(candidate.operation) ? "medium" : "low"),
        policy: { ...candidate.policy, requires_confirmation: CONSEQUENTIAL.has(candidate.operation) || candidate.consequential === true || candidate.requires_confirmation === true || candidate.policy?.requires_confirmation === true },
        execution: { mode: "host", target: candidate.id },
      })),
      policy,
    };
  } catch {
    return failed(null, null, "invalid_input", "Computer advice requires valid bounded actions and a matching PNG/JPEG screenshot", options);
  }

  let provider;
  try {
    provider = resolveProvider(options.provider ?? "typesafe", options);
  } catch {
    return failed(request, null, "provider_error", "Computer advice provider is unavailable", options);
  }
  if (provider.supportsImages !== true) return failed(request, null, "unsupported_images", "Provider does not support image input", options);

  let decision;
  try {
    decision = await routeRequest(request, { ...options, engine: "native", discovery: undefined, provider });
  } catch {
    return failed(request, null, "invalid_input", "Computer routing request could not be validated", options);
  }
  if (!["selected", "needs_confirmation"].includes(decision.status)) return { request, decision, action: null };
  const selected = actions.find((candidate) => candidate.id === decision.selected);
  if (!selected) return failed(request, decision, "invalid_selection", "Selected action is outside the host candidate set", options);
  let action = { ...selected, screenshot };
  if (selected.operation === "click" && selected.args.x === undefined) {
    if (typeof provider.evaluate !== "function") return failed(request, decision, "grounding_unavailable", "Provider cannot ground the selected target", options);
    let raw;
    try {
      raw = await provider.evaluate({
        state: { screenshot: Object.keys(request.assets)[0], target: selected.target },
        assets: request.assets,
        questions: {
          target_visible: { type: "noul", instructions: "Is the exact target described in `target` clearly visible and uniquely identifiable in `screenshot`?" },
          target_box: { type: "box", instructions: "Find the exact target described in `target` in `screenshot`." },
        },
      });
    } catch {
      return failed(request, decision, "provider_error", "Selected target grounding failed", options);
    }
    const visible = raw?.answers?.target_visible;
    const located = raw?.answers?.target_box;
    const box = located?.box;
    if (visible?.type !== "noul" || !probability(visible.noul) || located?.type !== "box" || !probability(located.confidence) || !object(box)
      || ![box.left, box.right, box.top, box.bottom].every(probability) || box.left >= box.right || box.top >= box.bottom) {
      return failed(request, decision, "malformed_grounding", "Provider returned invalid target visibility or box", options);
    }
    if (visible.noul < thresholds.visibility) return failed(request, decision, "target_not_visible", "Selected target is not confidently visible", options);
    if (located.confidence < thresholds.box) return failed(request, decision, "low_grounding_confidence", "Selected target box is below the host confidence threshold", options);
    action = {
      ...action,
      args: {
        ...selected.args,
        x: Math.min(screenshot.width - 1, Math.floor((box.left + box.right) / 2 * screenshot.width)),
        y: Math.min(screenshot.height - 1, Math.floor((box.top + box.bottom) / 2 * screenshot.height)),
      },
      grounding: {
        box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
        visibility: visible.noul,
        confidence: located.confidence,
        coordinate_space: "screenshot_pixels",
      },
    };
  }
  return { request, decision, action };
}

function normalizeAction(raw, dimensions) {
  if (!object(raw) || !text(raw.id, 240) || raw.id !== raw.id.trim() || !OPERATIONS.has(raw.operation)) throw new TypeError("invalid action");
  const args = raw.args ?? {};
  if (!object(args) || Object.keys(args).some((key) => !ARGUMENTS[raw.operation].includes(key))) throw new TypeError("invalid action arguments");
  const hasCoordinates = args.x !== undefined || args.y !== undefined;
  if (hasCoordinates && (!Number.isInteger(args.x) || args.x < 0 || args.x >= dimensions.width || !Number.isInteger(args.y) || args.y < 0 || args.y >= dimensions.height)) throw new TypeError("coordinates must be inside screenshot");
  if (raw.target !== undefined && !text(raw.target, 1_000)) throw new TypeError("invalid target description");
  if (raw.operation === "click" && (!hasCoordinates && !raw.target || args.button !== undefined && !["left", "middle", "right"].includes(args.button))) throw new TypeError("invalid click");
  if (raw.operation === "type" && !text(args.text, 8_000)) throw new TypeError("invalid text");
  if (raw.operation === "key" && (!Array.isArray(args.keys) || args.keys.length < 1 || args.keys.length > 8 || args.keys.some((key) => !text(key, 80)))) throw new TypeError("invalid keys");
  if (raw.operation === "scroll" && (!["up", "down", "left", "right"].includes(args.direction) || args.amount !== undefined && (!Number.isInteger(args.amount) || args.amount < 1 || args.amount > 10_000))) throw new TypeError("invalid scroll");
  if (raw.operation === "handoff" && args.reason !== undefined && !text(args.reason, 1_000)) throw new TypeError("invalid handoff reason");
  if (raw.permissions !== undefined && (!Array.isArray(raw.permissions) || raw.permissions.some((permission) => !text(permission, 240)))) throw new TypeError("invalid permissions");
  for (const key of ["name", "description"]) {
    if (raw[key] !== undefined && !text(raw[key], key === "name" ? 240 : 2_000)) throw new TypeError(`invalid ${key}`);
  }
  for (const key of ["available", "requires_confirmation", "consequential", "verified"]) {
    if (raw[key] !== undefined && typeof raw[key] !== "boolean") throw new TypeError(`invalid ${key}`);
  }
  if (raw.policy !== undefined && (!object(raw.policy) || raw.policy.requires_confirmation !== undefined && typeof raw.policy.requires_confirmation !== "boolean")) throw new TypeError("invalid confirmation policy");
  if (raw.availability !== undefined && (!object(raw.availability) || raw.availability.available !== undefined && typeof raw.availability.available !== "boolean")) throw new TypeError("invalid availability");
  const action = { id: raw.id, operation: raw.operation, args: structuredClone(args) };
  for (const key of ["target", "name", "description", "permissions", "risk", "available", "availability", "requires_confirmation", "policy", "consequential", "source", "verified", "metadata"]) {
    if (raw[key] !== undefined) action[key] = structuredClone(raw[key]);
  }
  return action;
}

function failed(request, decision, type, reason, options) {
  const fallback = { type, reason };
  return {
    request,
    action: null,
    decision: decision ? { ...decision, status: "fallback", reason, fallback } : decisionEnvelope({
      status: "fallback", reason, fallback,
      provider: typeof options.provider === "string" ? options.provider : options.provider?.name ?? "typesafe",
      latencyMs: 0, candidateCount: request?.capabilities.length ?? 0, contextBytes: 0,
    }),
  };
}

function object(value) {
  return value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function text(value, maximum, allowEmpty = false) {
  return typeof value === "string" && value.length <= maximum && (allowEmpty || value.trim().length > 0);
}

function probability(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
