import { byteLength, decisionEnvelope, sha256 } from "./contract.mjs";
import { appendExecutionReceipt, appendRoutingCase } from "./receipts.mjs";
import { routeRequest } from "./route.mjs";

export const BROWSER_FAST_PATH_ENV = "JEV_BROWSER_FAST_PATH";
const MAX_TARGETS = 64;
const MAX_TABS = 16;
const MAX_OPTIONS = 32;
const MAX_LABEL = 240;
const SAFE_OPERATIONS = new Set(["scroll", "switch_tab"]);
const CONSEQUENTIAL_OPERATIONS = new Set(["click", "select", "navigate"]);

export function browserFastPathEnabled(options = {}) {
  if (options.enabled === true) return true;
  if (options.enabled === false) return false;
  return process.env[BROWSER_FAST_PATH_ENV] === "1";
}

export function buildBrowserRequest({ goal, observation = {}, harness = "browser", start_url = null, actor_permissions = ["browser"], policy = {}, progress = null }) {
  if (typeof goal !== "string" || goal.trim() === "") throw new TypeError("browser goal must be a non-empty string");
  const normalizedObservation = normalizeObservation(observation);
  const baseProgress = normalizeProgress(progress, goal.trim(), normalizedObservation);
  const candidates = collectBrowserActions(normalizedObservation, start_url);
  const inferredExpectedProgress = inferExpectedProgress(goal.trim(), candidates);
  const completedProgress = new Set(baseProgress.executed_actions.filter((item) => item.status === "completed").map((item) => item.id));
  const remainingExpectedProgress = baseProgress.remaining_expected_progress ?? inferredExpectedProgress?.filter((id) => !completedProgress.has(id)) ?? null;
  const normalizedProgress = normalizeProgress({ ...baseProgress, remaining_expected_progress: remainingExpectedProgress }, goal.trim(), normalizedObservation);
  const actions = candidates.filter((candidate) => browserActionAllowed(candidate, normalizedObservation, normalizedProgress));
  return {
    schema_version: 1,
    harness,
    intent: `Browser goal: ${goal.trim()}`,
    context: {
      browser: {
        goal: goal.trim(),
        start_url: typeof start_url === "string" ? start_url : null,
        observation: normalizedObservation,
        progress: normalizedProgress,
      },
    },
    actor_permissions,
    capabilities: actions.map(toCapability),
    policy,
  };
}
export function browserActions({ goal, observation, start_url = null, progress = null }) {
  const normalizedObservation = normalizeObservation(observation);
  const normalizedProgress = normalizeProgress(progress, typeof goal === "string" ? goal : "", normalizedObservation);
  return collectBrowserActions(normalizedObservation, start_url).filter((candidate) => browserActionAllowed(candidate, normalizedObservation, normalizedProgress));
}

function collectBrowserActions(normalizedObservation, start_url) {
  const actions = [];
  const currentUrl = normalizedObservation.url;
  if (typeof start_url === "string" && start_url && currentUrl !== start_url) {
    actions.push(action("navigate", `browser:navigate:${encodeURIComponent(start_url)}`, `Navigate to ${start_url}`, { url: start_url, consequential: true }));
  }
  if (normalizedObservation.scroll?.up) actions.push(action("scroll", "browser:scroll:up", "Scroll the visible page upward", { direction: "up" }));
  if (normalizedObservation.scroll?.down) actions.push(action("scroll", "browser:scroll:down", "Scroll the visible page downward", { direction: "down" }));
  for (const tab of normalizedObservation.tabs) {
    if (!tab.active) actions.push(action("switch_tab", `browser:switch_tab:${tab.id}`, `Switch to visible tab ${tab.title || tab.id}`, { tab_id: tab.id }));
  }
  for (const target of normalizedObservation.targets) {
    const label = target.name || target.role || target.id;
    const linkUrl = target.visible !== false ? resolveLinkUrl(target.href ?? target.url, currentUrl) : null;
    if (linkUrl) {
      actions.push(action("navigate", `browser:navigate:${encodeURIComponent(linkUrl)}:${target.id}`, `Navigate via visible link ${label} to ${linkUrl}`, {
        target_id: target.id,
        url: linkUrl,
        consequential: true,
      }));
    }
    if (target.visible !== false && target.clickable) {
      actions.push(action("click", `browser:click:${target.id}`, `Click visible ${label}`, { target_id: target.id, consequential: true }));
    }
    if (target.visible !== false && Array.isArray(target.options)) {
      for (const option of target.options.slice(0, MAX_OPTIONS)) {
        const optionId = typeof option === "string" ? option : option.id ?? option.value ?? option.label;
        if (!optionId) continue;
        const optionLabel = typeof option === "string" ? option : option.label ?? option.value ?? option.id;
        actions.push(action("select", `browser:select:${target.id}:${optionId}`, `Select ${optionLabel} in ${label}`, {
          target_id: target.id,
          option_id: String(optionId),
          consequential: true,
        }));
      }
    }
  }
  actions.push(action("handoff", "browser:handoff", "Return browser state to the host", { consequential: false }));
  return actions;
}
export async function decideBrowserStep(input, options = {}) {
  const request = buildBrowserRequest(input);
  const actions = browserActions({
    goal: input.goal,
    observation: request.context.browser.observation,
    start_url: input.start_url,
    progress: request.context.browser.progress,
  });
  if (!browserFastPathEnabled(options)) {
    return {
      request,
      action: null,
      decision: disabledDecision(request, actions),
    };
  }
  const decision = await routeRequest(request, {
    provider: options.provider ?? "demo",
    engine: options.engine ?? "native",
    policy: options.policy,
    maxContextBytes: options.maxContextBytes,
  });
  return {
    request,
    decision,
    action: actions.find((candidate) => candidate.id === decision.selected) ?? null,
  };
}


export async function runBrowserFastPath({
  goal,
  executor,
  harness = "browser",
  start_url = null,
  provider = "demo",
  enabled,
  maxSteps = 8,
  maxSeconds = 30,
  policy,
  receiptPath,
  mainModelTurns = 1,
} = {}) {
  const started = performance.now();
  const metrics = {
    wall_time_ms: null,
    main_model_turns: mainModelTurns,
    jev_calls: 0,
    browser_actions: 0,
    failures: 0,
    cost_usd: 0,
  };
  const trace = [];
  const finish = (status, reason, observation = null) => ({
    status,
    reason,
    observation,
    trace,
    metrics: { ...metrics, wall_time_ms: elapsed(started) },
  });

  if (!browserFastPathEnabled({ enabled })) return finish("handoff", "browser_fast_path_disabled");
  const hasActionExecutor = typeof executor?.execute === "function" || typeof executor?.select === "function";
  if (!executor || typeof executor.observe !== "function" || !hasActionExecutor) {
    return finish("handoff", "browser_executor_unavailable");
  }

  let observation;
  try {
    observation = normalizeObservation(await executor.observe());
  } catch (error) {
    metrics.failures += 1;
    return finish("handoff", "browser_observation_failed", { error: message(error) });
  }
  let progress = createProgress(goal, observation);

  for (let step = 1; step <= maxSteps; step += 1) {
    if (elapsed(started) > maxSeconds * 1_000) return finish("handoff", "browser_fast_path_timeout", observation);
    let routed;
    try {
      routed = await decideBrowserStep({ goal, observation, harness, start_url, progress }, { enabled: true, provider, policy });
    } catch (error) {
      metrics.failures += 1;
      return finish("handoff", "browser_decision_failed", observation);
    }
    metrics.jev_calls += 1;
    metrics.cost_usd += routed.decision.receipt?.cost_usd ?? routed.decision.raw_jev?.usage?.cost ?? 0;
    const stepTrace = {
      step,
      correlation_id: routed.decision.correlation_id,
      selected: routed.decision.selected,
      status: routed.decision.status,
      confidence: routed.decision.confidence,
      operation: routed.action?.operation ?? null,
      executed: false,
    };

    if (!routed.action || routed.decision.status !== "selected") {
      await persistBrowserStep(receiptPath, routed, harness, {
        status: "not_started",
        capability_id: routed.decision.selected,
        result: { handoff: true, reason: routed.decision.fallback?.type ?? routed.decision.status },
        browser: { operation: routed.action?.operation ?? null, executed: false },
      });
      trace.push(stepTrace);
      return finish("handoff", routed.decision.fallback?.type ?? routed.decision.status, observation);
    }
    if (routed.action.operation === "handoff") {
      await persistBrowserStep(receiptPath, routed, harness, {
        status: "not_started",
        capability_id: routed.action.id,
        result: { handoff: true, reason: "host_handoff" },
        browser: { operation: routed.action.operation, executed: false },
      });
      trace.push(stepTrace);
      return finish("handoff", "host_handoff", observation);
    }
    if (routed.action.operation === "visible_target") {
      await persistBrowserStep(receiptPath, routed, harness, {
        status: "not_started",
        capability_id: routed.action.id,
        result: { handoff: true, reason: "visible_target", target_id: routed.action.target_id },
        browser: { operation: routed.action.operation, target_id: routed.action.target_id, executed: false },
      });
      trace.push(stepTrace);
      return finish("handoff", "visible_target", observation);
    }
    if (CONSEQUENTIAL_OPERATIONS.has(routed.action.operation)) {
      const approved = typeof executor.approve === "function" && await executor.approve(routed.action, routed.decision);
      if (!approved) {
        await persistBrowserStep(receiptPath, routed, harness, {
          status: "not_started",
          capability_id: routed.action.id,
          result: { handoff: true, reason: "host_confirmation_required" },
          browser: { operation: routed.action.operation, approved: false, executed: false },
        });
        trace.push(stepTrace);
        return finish("handoff", "host_confirmation_required", observation);
      }
    }
    if (!SAFE_OPERATIONS.has(routed.action.operation) && !CONSEQUENTIAL_OPERATIONS.has(routed.action.operation)) {
      await persistBrowserStep(receiptPath, routed, harness, {
        status: "not_started",
        capability_id: routed.action.id,
        result: { handoff: true, reason: "unsupported_browser_operation" },
        browser: { operation: routed.action.operation, executed: false },
      });
      trace.push(stepTrace);
      return finish("handoff", "unsupported_browser_operation", observation);
    }

    const actionStarted = performance.now();
    try {
      const execute = routed.action.operation === "select" && typeof executor.select === "function"
        ? executor.select.bind(executor)
        : executor.execute.bind(executor);
      const result = await execute(routed.action);
      metrics.browser_actions += 1;
      stepTrace.executed = true;
      const nextObservation = normalizeObservation(result?.observation ?? await executor.observe());
      progress = advanceProgress(progress, routed.action, observation, nextObservation, {
        status: "completed",
        result: result?.result ?? result ?? null,
      });
      const execution = {
        status: "completed",
        capability_id: routed.action.id,
        result: result?.result ?? result ?? null,
        exit_status: 0,
        duration_ms: elapsed(actionStarted),
        browser: { operation: routed.action.operation, target_id: routed.action.target_id ?? null, option_id: routed.action.option_id ?? null, executed: true },
      };
      await persistBrowserStep(receiptPath, routed, harness, execution);
      trace.push(stepTrace);
      observation = nextObservation;
      if (result?.handoff || result?.done) return finish(result.done ? "done" : "handoff", result.done ? "goal_completed_by_host" : "host_handoff", observation);
    } catch (error) {
      metrics.failures += 1;
      progress = advanceProgress(progress, routed.action, observation, observation, { status: "failed", result: null, error: message(error) });
      const execution = {
        status: "failed",
        capability_id: routed.action.id,
        result: null,
        error: message(error),
        exit_status: 1,
        duration_ms: elapsed(actionStarted),
        browser: { operation: routed.action.operation, target_id: routed.action.target_id ?? null, executed: false },
      };
      await persistBrowserStep(receiptPath, routed, harness, execution);
      trace.push(stepTrace);
      return finish("handoff", "browser_action_failed", observation);
    }
  }
  return finish("handoff", "browser_step_budget_exhausted", observation);
}

function toCapability(candidate) {
  return {
    id: candidate.id,
    kind: "tool",
    name: `Browser ${candidate.operation}`,
    description: candidate.description,
    permissions: ["browser"],
    risk: "low",
    policy: { requires_confirmation: false },
  };
}
function action(operation, id, description, extra = {}) {
  return { operation, id, description, consequential: Boolean(extra.consequential), ...extra };
}

function normalizeObservation(observation) {
  if (!observation || typeof observation !== "object") return { url: null, title: null, visible_text: "", targets: [], tabs: [], scroll: { up: false, down: false, position: null, max: null, viewport: null } };
  const scroll = observation.scroll && typeof observation.scroll === "object" ? observation.scroll : {};
  return {
    url: typeof observation.url === "string" ? observation.url.slice(0, 2_000) : null,
    title: typeof observation.title === "string" ? observation.title.slice(0, 500) : null,
    visible_text: typeof observation.visible_text === "string" ? observation.visible_text.slice(0, 8_000) : "",
    targets: Array.isArray(observation.targets) ? observation.targets.slice(0, MAX_TARGETS).map(normalizeTarget).filter(Boolean) : [],
    tabs: Array.isArray(observation.tabs) ? observation.tabs.slice(0, MAX_TABS).map(normalizeTab).filter(Boolean) : [],
    scroll: {
      up: scroll.up === true,
      down: scroll.down === true,
      position: finiteNumber(scroll.position ?? observation.scroll_y),
      max: finiteNumber(scroll.max ?? observation.scroll_max),
      viewport: finiteNumber(scroll.viewport ?? observation.viewport_height),
    },
  };
}

function normalizeTarget(target) {
  if (!target || typeof target !== "object" || typeof target.id !== "string" || target.id.trim() === "") return null;
  const role = typeof target.role === "string" ? target.role.slice(0, 80) : null;
  const roleIsClickable = role === "a" || role === "button" || role === "link";
  return {
    id: target.id.slice(0, 160),
    role,
    name: typeof target.name === "string" ? target.name.slice(0, MAX_LABEL) : null,
    href: typeof target.href === "string" ? target.href.slice(0, 2_000) : null,
    url: typeof target.url === "string" ? target.url.slice(0, 2_000) : null,
    visible: target.visible !== false,
    clickable: target.clickable === true || roleIsClickable,
    options: Array.isArray(target.options) ? target.options.slice(0, MAX_OPTIONS).map((option) => typeof option === "string" ? option.slice(0, MAX_LABEL) : {
      id: typeof option?.id === "string" ? option.id.slice(0, MAX_LABEL) : undefined,
      value: typeof option?.value === "string" ? option.value.slice(0, MAX_LABEL) : undefined,
      label: typeof option?.label === "string" ? option.label.slice(0, MAX_LABEL) : undefined,
    }) : [],
  };
}

function normalizeProgress(progress, goal, observation) {
  const source = progress && typeof progress === "object" ? progress : {};
  return {
    goal: goal.slice(0, MAX_LABEL),
    current_observation: observation,
    executed_actions: Array.isArray(source.executed_actions) ? source.executed_actions.slice(-16).map(compactActionRecord) : [],
    used_targets: Array.isArray(source.used_targets) ? [...new Set(source.used_targets.filter((value) => typeof value === "string").slice(-32))] : [],
    blocked_actions: Array.isArray(source.blocked_actions) ? [...new Set(source.blocked_actions.filter((value) => typeof value === "string").slice(-32))] : [],
    current_url: typeof source.current_url === "string" ? source.current_url.slice(0, 2_000) : observation.url,
    current_state: typeof source.current_state === "string" ? source.current_state : browserStateFingerprint(observation),
    last_action: source.last_action ? compactActionRecord(source.last_action) : null,
    last_result: source.last_result ? compactResult(source.last_result) : null,
    remaining_expected_progress: source.remaining_expected_progress ?? null,
  };
}

function createProgress(goal, observation) {
  return normalizeProgress({ remaining_expected_progress: null }, goal, observation);
}

function advanceProgress(progress, action, before, after, result) {
  const beforeObservation = normalizeObservation(before);
  const afterObservation = normalizeObservation(after);
  const beforeState = browserStateFingerprint(beforeObservation);
  const afterState = browserStateFingerprint(afterObservation);
  const stateChanged = beforeState !== afterState;
  const scrollProgress = action.operation === "scroll" && scrollStateProgress(action.direction, beforeObservation, afterObservation, stateChanged);
  const record = compactActionRecord({ ...action, status: result.status });
  const executedActions = result.status === "completed"
    ? [...progress.executed_actions, record].slice(-16)
    : progress.executed_actions;
  const usedTargets = [...new Set([
    ...progress.used_targets,
    ...(action.target_id ? [String(action.target_id)] : []),
  ])].slice(-32);
  const blockedActions = [...new Set([
    ...progress.blocked_actions,
    ...(result.status !== "completed" && stateChanged ? [actionKey(action)] : []),
  ])].slice(-32);
  const remainingExpectedProgress = Array.isArray(progress.remaining_expected_progress)
    ? progress.remaining_expected_progress.filter((id) => id !== action.id)
    : progress.remaining_expected_progress;
  return normalizeProgress({
    ...progress,
    executed_actions: executedActions,
    used_targets: usedTargets,
    blocked_actions: blockedActions,
    current_url: afterObservation.url,
    current_state: afterState,
    last_action: record,
    last_result: {
      status: result.status,
      state_changed: stateChanged,
      scroll_progress: scrollProgress,
      before_state: beforeState,
      after_state: afterState,
      result: compactValue(result.result),
      error: typeof result.error === "string" ? result.error.slice(0, MAX_LABEL) : null,
    },
    remaining_expected_progress: remainingExpectedProgress,
  }, progress.goal, afterObservation);
}
function compactActionRecord(action) {
  return {
    id: typeof action?.id === "string" ? action.id.slice(0, 240) : null,
    operation: typeof action?.operation === "string" ? action.operation : null,
    target_id: typeof action?.target_id === "string" ? action.target_id.slice(0, 160) : null,
    option_id: typeof action?.option_id === "string" ? action.option_id.slice(0, MAX_LABEL) : null,
    url: typeof action?.url === "string" ? action.url.slice(0, 2_000) : null,
    direction: typeof action?.direction === "string" ? action.direction : null,
    status: typeof action?.status === "string" ? action.status : null,
  };
}

function compactResult(result) {
  return {
    status: typeof result?.status === "string" ? result.status : null,
    state_changed: result?.state_changed === true,
    scroll_progress: result?.scroll_progress === true,
    before_state: typeof result?.before_state === "string" ? result.before_state : null,
    after_state: typeof result?.after_state === "string" ? result.after_state : null,
    result: compactValue(result?.result),
    error: typeof result?.error === "string" ? result.error.slice(0, MAX_LABEL) : null,
  };
}

function compactValue(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return typeof value === "string" ? value.slice(0, MAX_LABEL) : value;
  if (!value || typeof value !== "object") return null;
  return {
    operation: typeof value.operation === "string" ? value.operation : null,
    status: typeof value.status === "string" ? value.status : null,
    done: value.done === true,
    handoff: value.handoff === true,
  };
}

function inferExpectedProgress(goal, candidates) {
  const clauses = String(goal).split(/\bthen\b|,|;|\bafter\b|\band\b/gi).map((clause) => clause.trim()).filter(Boolean);
  const expected = [];
  for (const clause of clauses) {
    const operation = clauseOperation(clause);
    if (!operation) continue;
    const options = candidates.filter((candidate) => candidate.operation === operation);
    if (options.length === 0) return null;
    const direction = clause.match(/\b(up|down|upward|downward)\b/i)?.[1]?.toLowerCase();
    const directional = operation === "scroll" && direction
      ? options.filter((candidate) => candidate.direction === (direction.startsWith("up") ? "up" : "down"))
      : options;
    const ranked = directional.map((candidate) => ({ candidate, score: clauseScore(clause, candidate) })).sort((left, right) => right.score - left.score);
    const best = ranked[0];
    if (!best || (best.score === 0 && directional.length > 1) || (ranked[1] && ranked[1].score === best.score && best.score > 0)) return null;
    if (!expected.includes(best.candidate.id)) expected.push(best.candidate.id);
  }
  return expected.length > 0 ? expected : null;
}

function clauseOperation(clause) {
  if (/\b(click|press|tap)\b/i.test(clause)) return "click";
  if (/\b(select|choose|pick)\b/i.test(clause)) return "select";
  if (/\b(scroll)\b/i.test(clause)) return "scroll";
  if (/\b(navigate|go|open|visit)\b/i.test(clause)) return "navigate";
  return null;
}

function clauseScore(clause, candidate) {
  const ignored = new Set(["click", "press", "tap", "select", "choose", "pick", "scroll", "navigate", "go", "open", "visit", "then", "after", "the", "to", "via", "visible", "page", "down", "up", "upward", "downward", "and", "a", "an", "in", "on", "from"]);
  const haystackTokens = new Set(`${candidate.description} ${candidate.target_id ?? ""} ${candidate.option_id ?? ""} ${candidate.url ?? ""}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return clause.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1 && !ignored.has(token)).filter((token) => haystackTokens.has(token)).length;
}

function browserActionAllowed(candidate, observation, progress) {
  if (candidate.operation === "handoff") return true;
  const expected = Array.isArray(progress.remaining_expected_progress) ? progress.remaining_expected_progress.filter(Boolean) : [];
  if (expected.length > 0 && candidate.id !== expected[0]) return false;
  if (candidate.operation === "scroll") return scrollActionAllowed(candidate, observation, progress);
  const completed = new Set(progress.executed_actions.filter((item) => item.status === "completed").map((item) => item.id));
  return !completed.has(actionKey(candidate)) && !progress.blocked_actions.includes(actionKey(candidate));
}

function scrollActionAllowed(candidate, observation, progress) {
  const last = progress.last_action;
  if (!last || last.operation !== "scroll" || last.direction !== candidate.direction) return canScroll(candidate.direction, observation);
  const result = progress.last_result;
  return result?.state_changed === true && result.scroll_progress === true && canScroll(candidate.direction, observation);
}

function canScroll(direction, observation) {
  return direction === "up" ? observation.scroll.up : observation.scroll.down;
}

function scrollStateProgress(direction, before, after, stateChanged) {
  const beforePosition = before.scroll.position;
  const afterPosition = after.scroll.position;
  if (Number.isFinite(beforePosition) && Number.isFinite(afterPosition)) {
    return direction === "up" ? afterPosition < beforePosition : afterPosition > beforePosition;
  }
  return stateChanged;
}

function browserStateFingerprint(observation) {
  return sha256({
    url: observation.url,
    title: observation.title,
    visible_text: observation.visible_text,
    targets: observation.targets,
    tabs: observation.tabs,
    scroll: observation.scroll,
  });
}

function actionKey(action) {
  return typeof action?.id === "string" ? action.id : `${action?.operation ?? ""}:${action?.target_id ?? ""}:${action?.option_id ?? ""}:${action?.url ?? ""}`;
}

function resolveLinkUrl(raw, currentUrl) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const resolved = currentUrl ? new URL(raw, currentUrl) : new URL(raw);
    return resolved.protocol === "http:" || resolved.protocol === "https:" ? resolved.href : null;
  } catch {
    return null;
  }
}

function finiteNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function normalizeTab(tab) {
  if (!tab || typeof tab !== "object" || typeof tab.id !== "string") return null;
  return {
    id: tab.id.slice(0, 160),
    title: typeof tab.title === "string" ? tab.title.slice(0, MAX_LABEL) : null,
    url: typeof tab.url === "string" ? tab.url.slice(0, 2_000) : null,
    active: tab.active === true,
  };
}

function disabledDecision(request, actions) {
  return decisionEnvelope({
    status: "fallback",
    reason: `${BROWSER_FAST_PATH_ENV} is not enabled`,
    provider: "browser-fast-path:disabled",
    candidateCount: actions.length,
    contextBytes: byteLength(request.context),
    candidates: actions.map((candidate) => ({ id: candidate.id, kind: "tool", name: `Browser ${candidate.operation}`, risk: candidate.consequential ? "medium" : "low", available: true, filtered: false, filter_reason: null, probability: null, confidence: null, requires_confirmation: Boolean(candidate.consequential) })),
    fallback: { type: "browser_fast_path_disabled", reason: "host must continue with its normal browser path" },
  });
}

async function persistBrowserStep(path, routed, harness, host) {
  if (!path) return;
  await appendRoutingCase({ path, request: routed.request, decision: routed.decision });
  await appendExecutionReceipt({
    path,
    request: routed.request,
    decision: routed.decision,
    host: { harness, ...host },
  });
}

function elapsed(started) {
  return Number((performance.now() - started).toFixed(3));
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}