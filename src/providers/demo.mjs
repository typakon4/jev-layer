import { stableJson } from "../contract.mjs";

const TOKEN_RE = /[\p{L}\p{N}_-]+/gu;

export class DemoProvider {
  name = "jev-demo";

  async decide({ state, candidates }) {
    const requestTokens = tokens(`${state.intent} ${stableJson(state.context ?? {})}`);
    const scored = candidates.map((candidate) => {
      const candidateTokens = tokens(`${candidate.id} ${candidate.name} ${candidate.description}`);
      const overlap = [...requestTokens].filter((token) => candidateTokens.has(token)).length;
      return { id: candidate.id, score: overlap + 0.01 };
    });
    const total = scored.reduce((sum, item) => sum + item.score, 0);
    const probabilities = Object.fromEntries(scored.map(({ id, score }) => [id, score / total]));
    const choice = [...scored].sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))[0]?.id ?? "";
    const top = choice ? probabilities[choice] : 0;
    const confidence = scored.length <= 1
      ? 1
      : Math.max(0, Math.min(1, (top - 1 / scored.length) / Math.max(1 - 1 / scored.length, 0.0001)));
    return {
      model: "jev-demo",
      answers: {
        tool: {
          type: "choice",
          choice,
          probabilities,
          confidence,
        },
      },
      usage: { input_bytes: Buffer.byteLength(stableJson(state), "utf8"), output_bytes: 0 },
    };
  }

  async evaluate({ state, questions }) {
    const supplied = state.context?.supervision?.judgments ?? {};
    const answers = Object.fromEntries(Object.keys(questions).map((id) => {
      const value = typeof supplied[id] === "number" ? Math.max(0, Math.min(1, supplied[id])) : 0.5;
      return [id, { type: "noul", probability: value, confidence: 1 }];
    }));
    return {
      model: "jev-demo",
      answers,
      usage: { input_bytes: Buffer.byteLength(stableJson(state), "utf8"), output_bytes: 0 },
    };
  }
}

function tokens(value) {
  return new Set(value.toLowerCase().match(TOKEN_RE) ?? []);
}
