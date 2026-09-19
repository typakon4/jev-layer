const MODES = new Set(["shadow", "conservative"]);
const SIGNALS = [
  /(?:^|[\s"'`])(?:\/[\w.\-~]+|~\/[^\s"'`]+|[A-Za-z]:\\[^\s"'`]+)/u,
  /\b(?:error|exception|traceback|failed|failure|exit\s+status|stderr)\b/i,
  /`[^`\n]+`/u,
  /(?:^|\n)\s*(?:[$#])\s*[A-Za-z0-9_.-]+/u,
  /\b(?:must|required|requirement|acceptance|should|need\s+to)\b/i,
];
const LIST_KEYS = new Set(["messages", "events", "logs", "tool_results", "history", "transcript"]);

export function normalizeRelevanceMode(mode) {
  if (mode === true) return "shadow";
  if (typeof mode !== "string") return null;
  const normalized = mode.trim().toLowerCase();
  return MODES.has(normalized) ? normalized : null;
}

export function filterContext(context, { mode = "shadow", recent = 8 } = {}) {
  const normalizedMode = normalizeRelevanceMode(mode);
  if (!normalizedMode) return { context, report: disabledReport() };
  const source = context && typeof context === "object" ? context : {};
  const report = {
    mode: normalizedMode,
    changed: false,
    considered: 0,
    kept: 0,
    dropped: 0,
    pinned: 0,
    pinned_reasons: [],
  };
  if (normalizedMode === "shadow") {
    inspectValue(source, report);
    return { context: source, report };
  }

  const output = Array.isArray(source) ? source.slice() : { ...source };
  for (const [key, value] of Object.entries(source)) {
    if (!LIST_KEYS.has(key) || !Array.isArray(value)) continue;
    const filtered = filterList(value, normalizedMode, recent, report);
    output[key] = filtered;
  }
  if (report.dropped > 0) {
    report.changed = true;
    output._jev_relevance = {
      mode: normalizedMode,
      dropped: report.dropped,
      pinned: report.pinned,
    };
  }
  return { context: output, report };
}

export function isPinnedEvidence(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const reasons = [];
  if (SIGNALS[0].test(text)) reasons.push("path");
  if (SIGNALS[1].test(text)) reasons.push("error");
  if (SIGNALS[2].test(text) || SIGNALS[3].test(text)) reasons.push("command");
  if (SIGNALS[4].test(text)) reasons.push("requirement");
  return { pinned: reasons.length > 0, reasons };
}

function filterList(items, mode, recent, report) {
  const keepFrom = Math.max(0, items.length - Math.max(0, recent));
  return items.filter((item, index) => {
    report.considered += 1;
    const evidence = isPinnedEvidence(item);
    const keep = evidence.pinned || index >= keepFrom || mode === "conservative" && index === items.length - 1;
    if (evidence.pinned) {
      report.pinned += 1;
      report.pinned_reasons.push(...evidence.reasons);
    }
    if (keep) report.kept += 1;
    else report.dropped += 1;
    return keep;
  });
}

function inspectValue(value, report) {
  if (Array.isArray(value)) {
    for (const item of value) {
      report.considered += 1;
      const evidence = isPinnedEvidence(item);
      if (evidence.pinned) {
        report.pinned += 1;
        report.pinned_reasons.push(...evidence.reasons);
      }
      inspectValue(item, report);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) inspectValue(child, report);
  }
}

function disabledReport() {
  return { mode: null, changed: false, considered: 0, kept: 0, dropped: 0, pinned: 0, pinned_reasons: [] };
}
