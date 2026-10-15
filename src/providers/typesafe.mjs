import { normalizeImageAssets } from "../images.mjs";

function containsReference(value, reference) {
  if (typeof value === "string") return value.includes(reference);
  return value !== null && typeof value === "object"
    && Object.values(value).some((child) => containsReference(child, reference));
}

function openRouterImageInput(state, questions, images) {
  const parts = Object.fromEntries(Object.entries(images).map(([reference, image]) => [reference, {
    type: "image_url",
    image_url: { url: `data:image/${image.format === "png" ? "png" : "jpeg"};base64,${image.data_base64}` },
  }]));
  const pattern = new RegExp(Object.keys(parts).sort((a, b) => b.length - a.length).map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  const used = new Set();
  function expand(value) {
    if (typeof value === "string") {
      if (Object.hasOwn(parts, value)) {
        used.add(value);
        return parts[value];
      }
      const content = [];
      let offset = 0;
      for (const match of value.matchAll(pattern)) {
        if (match.index > offset) content.push(value.slice(offset, match.index));
        content.push(parts[match[0]]);
        used.add(match[0]);
        offset = match.index + match[0].length;
      }
      if (!content.length) return value;
      if (offset < value.length) content.push(value.slice(offset));
      return content;
    }
    if (Array.isArray(value)) return value.map(expand);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, expand(child)]));
    return value;
  }
  const input = {
    state: expand(state),
    questions: Object.fromEntries(Object.entries(questions).map(([key, question]) => [key, {
      ...question,
      instructions: expand(question.instructions),
      ...(question.criteria !== undefined ? { criteria: expand(question.criteria) } : {}),
    }])),
  };
  if (used.size !== Object.keys(parts).length) throw new Error("every image asset must be referenced in state, instructions, or criteria");
  return input;
}

export class TypeSafeProvider {
  name = "typesafe";
  supportsImages = true;

  constructor({ apiKey = process.env.TYPESAFE_API_KEY, endpoint = process.env.TYPESAFE_ENDPOINT ?? "https://api.typesafe.ai/v1/systemone", model = process.env.TYPESAFE_MODEL ?? "jev-1.14.0", timeoutMs = 2_000, fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async decide({ state, candidates, assets }) {
    const criteria = Object.fromEntries(candidates.map((candidate) => [candidate.id, {
      name: candidate.name,
      kind: candidate.kind,
      description: candidate.description,
      risk: candidate.risk,
    }]));
    return this.evaluate({
      state,
      assets,
      questions: {
        tool: {
          type: "choice",
          instructions: "Which single capability should handle this request? Choose only from the supplied options.",
          criteria,
        },
      },
    });
  }

  async evaluate({ state, questions, assets }) {
    if (!this.apiKey) throw new Error("TYPESAFE_API_KEY is not configured");
    if (typeof this.fetchImpl !== "function") throw new Error("fetch is unavailable");
    const images = normalizeImageAssets(assets);
    const hasImages = Object.keys(images).length > 0;
    const hasBox = Object.values(questions).some((question) => question?.type === "box");
    for (const reference of Object.keys(images)) {
      if (!containsReference(state, reference)
        && !Object.values(questions).some((question) => containsReference(question?.instructions, reference) || containsReference(question?.criteria, reference))) {
        throw new Error("every image asset must be referenced in state, instructions, or criteria");
      }
    }
    const body = JSON.stringify({ state, model: this.model, questions, ...(hasImages ? { assets: images } : {}) });
    if (Buffer.byteLength(body) > 32 * 1024 * 1024) throw new Error("TypeSafe request exceeds the 32 MiB body limit");
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(hasImages || hasBox ? { "TypeSafe-Danger-Zone-Images": "true" } : {}),
      },
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error) => {
      if (error?.name === "TimeoutError") throw new Error(`TypeSafe request timed out after ${this.timeoutMs}ms`);
      if (hasImages) throw new Error("TypeSafe image request failed");
      throw error;
    });

    if (!response.ok) {
      // Image requests must not copy an upstream echo of image data into receipts.
      const detail = hasImages ? "" : `: ${(await response.text()).slice(0, 240)}`;
      throw new Error(`TypeSafe returned HTTP ${response.status}${detail}`);
    }
    const raw = await response.json().catch((error) => {
      if (hasImages) throw new Error("TypeSafe image response is not valid JSON");
      throw error;
    });
    if (!raw || typeof raw !== "object" || !raw.answers || typeof raw.answers !== "object") {
      throw new Error("TypeSafe response has no answers object");
    }
    return raw;
  }
}

export class OpenRouterDecisionsProvider {
  supportsImages = true;

  constructor({
    apiKey = process.env.OPENROUTER_API_KEY,
    endpoint = process.env.OPENROUTER_DECISIONS_ENDPOINT ?? "https://openrouter.ai/api/alpha/decisions",
    model = process.env.OPENROUTER_DECISIONS_MODEL ?? "typesafe/jev-1.14",
    timeoutMs = 5_000,
    fetchImpl = globalThis.fetch,
    httpReferer = process.env.OPENROUTER_HTTP_REFERER,
    appTitle = process.env.OPENROUTER_APP_TITLE,
  } = {}) {
    this.name = `openrouter:${model}`;
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.httpReferer = httpReferer;
    this.appTitle = appTitle;
  }
  async decide({ state, candidates, assets }) {
    const criteria = Object.fromEntries(candidates.map((candidate) => [candidate.id, {
      name: candidate.name,
      kind: candidate.kind,
      description: candidate.description,
      risk: candidate.risk,
    }]));
    return this.evaluate({
      state,
      assets,
      questions: {
        tool: {
          type: "choice",
          instructions: "Which single capability should handle this request? Choose only from the supplied options.",
          criteria,
        },
      },
    });
  }

  async evaluate({ state, questions, assets }) {
    if (!this.apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
    if (typeof this.fetchImpl !== "function") throw new Error("fetch is unavailable");
    const images = normalizeImageAssets(assets);
    const hasImages = Object.keys(images).length > 0;
    const input = hasImages ? openRouterImageInput(state, questions, images) : { state, questions };
    const body = JSON.stringify({ model: this.model, ...input });
    if (Buffer.byteLength(body) > 32 * 1024 * 1024) throw new Error("OpenRouter Decisions request exceeds the 32 MiB body limit");

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(this.httpReferer ? { "HTTP-Referer": this.httpReferer } : {}),
        ...(this.appTitle ? { "X-Title": this.appTitle } : {}),
      },
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error) => {
      if (error?.name === "TimeoutError") throw new Error(`OpenRouter Decisions request timed out after ${this.timeoutMs}ms`);
      if (hasImages) throw new Error("OpenRouter Decisions image request failed");
      throw error;
    });

    if (!response.ok) {
      const detail = hasImages ? "" : `: ${(await response.text()).slice(0, 240)}`;
      throw new Error(`OpenRouter Decisions returned HTTP ${response.status}${detail}`);
    }
    const raw = await response.json().catch((error) => {
      if (hasImages) throw new Error("OpenRouter Decisions image response is not valid JSON");
      throw error;
    });
    if (!raw || typeof raw !== "object" || !raw.answers || typeof raw.answers !== "object") {
      throw new Error("OpenRouter Decisions response has no answers object");
    }
    return raw;
  }
}
