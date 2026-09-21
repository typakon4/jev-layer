import { sanitizeContext } from "./context-filter.mjs";
import { isPinnedEvidence } from "./relevance-filter.mjs";
import { OpenRouterDecisionsProvider, TypeSafeProvider } from "./providers/typesafe.mjs";
import { DemoProvider } from "./providers/demo.mjs";

const LIST_KEYS = new Set(["messages", "events", "logs", "tool_results", "history", "transcript"]);
const DEFAULT_BATCH_SIZE = 8;
const DEFAULT_KEEP_THRESHOLD = 0.5;
const DEFAULT_MIN_CONFIDENCE = 0.7;
const MAX_ITEMS = 64;
const MAX_PREVIEW = 320;

/**
 * Produce advisory Jev compaction decisions without mutating context.
 * Pinned evidence is never sent as droppable and provider failure retains all items.
 */
export async function buildShadowCompactionReport({
  intent = "Assess which context records must remain available to a later agent.",
  context = {},
  provider = "demo",
  batchSize = DEFAULT_BATCH_SIZE,
  keepThreshold = DEFAULT_KEEP_THRESHOLD,
  minConfidence = DEFAULT_MIN_CONFIDENCE,
} = {}) {
  const items = collectContextItems(context);
  const normalizedBatchSize = boundedInteger(batchSize, DEFAULT_BATCH_SIZE, 1, DEFAULT_BATCH_SIZE);
  const normalizedThreshold = boundedNumber(keepThreshold, DEFAULT_KEEP_THRESHOLD);
  const normalizedConfidence = boundedNumber(minConfidence, DEFAULT_MIN_CONFIDENCE);
  const protectedItems = items.filter((item) => item.pinned);
  const evaluable = items.filter((item) => !item.pinned);
  const decisions = new Map(protectedItems.map((item) => [item.id, {
    decision: "keep",
    probability: 1,
    confidence: 1,
    reason: `pinned:${item.pinned_reasons.join(",")}`,
  }]));
  let costUsd = 0;
  let failed = null;

  try {
    const resolved = resolveProvider(provider);
    if (!resolved || typeof resolved.evaluate !== "function") throw new Error("provider does not support batched evaluation");
    for (const batch of batches(evaluable, normalizedBatchSize)) {
      const raw = await resolved.evaluate({
        state: {
          intent: boundedText(intent),
          compaction: {
            mode: "shadow",
            instruction: "For each item, decide whether dropping it would lose a requirement, exact identifier, path, command, error, user decision, execution receipt, or other evidence needed later. Be conservative: keep when uncertain.",
            items: batch.map(publicItem),
          },
        },
        questions: Object.fromEntries(batch.map((item, index) => [`item_${index}`, keepQuestion()])),
      });
      costUsd += finiteCost(raw?.usage?.cost) ?? 0;
      for (const [index, item] of batch.entries()) {
        const answer = readNoul(raw?.answers?.[`item_${index}`]);
        if (!answer) throw new Error(`provider response has no valid item_${index} judgment`);
        const decision = answer.confidence < normalizedConfidence || answer.probability >= normalizedThreshold ? "keep" : "drop_candidate";
        decisions.set(item.id, {
          decision,
          probability: answer.probability,
          confidence: answer.confidence,
          reason: answer.confidence < normalizedConfidence ? "low_confidence" : decision === "keep" ? "provider_keep" : "provider_drop_candidate",
        });
      }
    }
  } catch (error) {
    failed = error instanceof Error ? error.message : String(error);
    for (const item of evaluable) {
      decisions.set(item.id, { decision: "keep", probability: null, confidence: null, reason: "provider_error" });
    }
  }

  const reportedItems = items.map((item) => ({ ...publicItem(item), ...decisions.get(item.id) }));
  const droppableCount = reportedItems.filter((item) => item.decision === "drop_candidate").length;
  return {
    schema_version: 1,
    mode: "jev_shadow",
    status: failed ? "fallback" : "judged",
    changed: false,
    candidate_count: reportedItems.length,
    evaluated_count: evaluable.length,
    protected_count: protectedItems.length,
    retained_count: reportedItems.length - droppableCount,
    droppable_count: droppableCount,
    keep_threshold: normalizedThreshold,
    min_confidence: normalizedConfidence,
    cost_usd: failed ? null : Number(costUsd.toFixed(8)),
    fallback: failed ? { type: "provider_error", reason: failed } : null,
    items: reportedItems,
  };
}

export function collectContextItems(context = {}) {
  const source = context && typeof context === "object" ? context : {};
  const items = [];
  for (const [list, value] of Object.entries(source)) {
    if (!LIST_KEYS.has(list) || !Array.isArray(value)) continue;
    for (const [index, original] of value.entries()) {
      if (items.length >= MAX_ITEMS) return items;
      const sanitized = sanitizeContext(original);
      const evidence = isPinnedEvidence(sanitized);
      items.push({
        id: `${list}[${index}]`,
        list,
        index,
        value: sanitized,
        pinned: evidence.pinned,
        pinned_reasons: evidence.reasons,
      });
    }
  }
  return items;
}

function publicItem(item) {
  return {
    id: item.id,
    list: item.list,
    index: item.index,
    pinned: item.pinned,
    pinned_reasons: item.pinned_reasons,
    preview: boundedText(typeof item.value === "string" ? item.value : JSON.stringify(item.value)),
  };
}

function keepQuestion() {
  return {
    type: "noul",
    instructions: "Would dropping this context record lose information needed by a later agent? Return true to keep it and false only when it is safely stale or redundant.",
    criteria: {
      true: "Keep: it contains a requirement, decision, identifier, path, command, error, execution evidence, or context that may matter later; uncertainty means keep.",
      false: "Drop candidate: it is safely stale or redundant and losing it would not affect later work.",
    },
  };
}

function readNoul(answer) {
  if (!answer || typeof answer !== "object") return null;
  const probability = ["probability", "p_true", "score", "value", "noul"].map((key) => answer[key]).find(validProbability);
  if (!validProbability(probability)) return null;
  const confidence = validProbability(answer.confidence) ? answer.confidence : probability;
  return { probability, confidence };
}

function resolveProvider(provider) {
  if (provider && typeof provider === "object") return provider;
  if (provider === "demo") return new DemoProvider();
  if (provider === "openrouter") return new OpenRouterDecisionsProvider();
  if (provider === "typesafe") return new TypeSafeProvider();
  throw new Error(`unsupported provider: ${provider}`);
}

function batches(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

function boundedText(value) {
  const text = String(value ?? "");
  return text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}…` : text;
}

function boundedNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function boundedInteger(value, fallback, min, max) {
  return Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function validProbability(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function finiteCost(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
