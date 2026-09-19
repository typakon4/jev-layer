import { stableJson } from "../contract.mjs";

export class TypeSafeProvider {
  name = "typesafe";

  constructor({ apiKey = process.env.TYPESAFE_API_KEY, endpoint = process.env.TYPESAFE_ENDPOINT ?? "https://api.typesafe.ai/v1/systemone", model = process.env.TYPESAFE_MODEL ?? "jev-latest", timeoutMs = 2_000 } = {}) {
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  async decide({ state, candidates }) {
    const criteria = Object.fromEntries(candidates.map((candidate) => [candidate.id, {
      name: candidate.name,
      kind: candidate.kind,
      description: candidate.description,
      risk: candidate.risk,
    }]));
    return this.evaluate({
      state,
      questions: {
        tool: {
          type: "choice",
          instructions: "Which single capability should handle this request? Choose only from the supplied options.",
          criteria,
        },
      },
    });
  }

  async evaluate({ state, questions }) {
    if (!this.apiKey) throw new Error("TYPESAFE_API_KEY is not configured");
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state, model: this.model, questions }),
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error) => {
      if (error?.name === "TimeoutError") throw new Error(`TypeSafe request timed out after ${this.timeoutMs}ms`);
      throw error;
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`TypeSafe returned HTTP ${response.status}: ${body.slice(0, 240)}`);
    }
    const raw = await response.json();
    if (!raw || typeof raw !== "object" || !raw.answers || typeof raw.answers !== "object") {
      throw new Error("TypeSafe response has no answers object");
    }
    return raw;
  }
}

export class OpenRouterDecisionsProvider {
  name = "openrouter:typesafe/jev-1.13";

  constructor({
    apiKey = process.env.OPENROUTER_API_KEY,
    endpoint = process.env.OPENROUTER_DECISIONS_ENDPOINT ?? "https://openrouter.ai/api/alpha/decisions",
    model = process.env.OPENROUTER_DECISIONS_MODEL ?? "typesafe/jev-1.13",
    timeoutMs = 5_000,
    fetchImpl = globalThis.fetch,
    httpReferer = process.env.OPENROUTER_HTTP_REFERER,
    appTitle = process.env.OPENROUTER_APP_TITLE,
  } = {}) {
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.httpReferer = httpReferer;
  }
  async decide({ state, candidates }) {
    const criteria = Object.fromEntries(candidates.map((candidate) => [candidate.id, {
      name: candidate.name,
      kind: candidate.kind,
      description: candidate.description,
      risk: candidate.risk,
    }]));
    return this.evaluate({
      state,
      questions: {
        tool: {
          type: "choice",
          instructions: "Which single capability should handle this request? Choose only from the supplied options.",
          criteria,
        },
      },
    });
  }

  async evaluate({ state, questions }) {
    if (!this.apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
    if (typeof this.fetchImpl !== "function") throw new Error("fetch is unavailable");

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(this.httpReferer ? { "HTTP-Referer": this.httpReferer } : {}),
        ...(this.appTitle ? { "X-Title": this.appTitle } : {}),
      },
      body: JSON.stringify({ model: this.model, questions, state }),
      signal: AbortSignal.timeout(this.timeoutMs),
    }).catch((error) => {
      if (error?.name === "TimeoutError") throw new Error(`OpenRouter Decisions request timed out after ${this.timeoutMs}ms`);
      throw error;
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter Decisions returned HTTP ${response.status}: ${body.slice(0, 240)}`);
    }
    const raw = await response.json();
    if (!raw || typeof raw !== "object" || !raw.answers || typeof raw.answers !== "object") {
      throw new Error("OpenRouter Decisions response has no answers object");
    }
    return raw;
  }
}
