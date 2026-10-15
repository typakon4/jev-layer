import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeImageAssets } from "../src/images.mjs";
import { OpenRouterDecisionsProvider, TypeSafeProvider } from "../src/providers/typesafe.mjs";
import { routeRequest } from "../src/route.mjs";
import { PNG as png } from "./image-fixture.mjs";

const reference = "frame-6e1d0b7c";
const image = { type: "image", format: "png", data_base64: png };
const assets = { [reference]: image };
const candidates = [{ id: "search", name: "Search", kind: "mcp", description: "Search files", permissions: ["read"], risk: "low" }];
const request = { intent: "Inspect the image and choose a capability", actor_permissions: ["read"], capabilities: candidates, assets };
const questions = { visible: { type: "noul", instructions: "Is the target visible?" }, target: { type: "box", instructions: "the target in `screenshot`" } };

// Keep provider resolution deterministic without using developer credentials.
for (const key of Object.keys(process.env)) {
  if (/^(JEV_|TYPESAFE_|OPENROUTER_)/.test(key)) delete process.env[key];
}

test("image reference names cannot change the output object's prototype", () => {
  const special = normalizeImageAssets(JSON.parse(`{"__proto__":${JSON.stringify(image)}}`));
  assert.equal(Object.hasOwn(special, "__proto__"), true);
  assert.equal(Object.getPrototypeOf(special), Object.prototype);
});

test("image trust boundary rejects malformed maps, references, formats and noncanonical base64", () => {
  for (const input of [null, [], "file.png", { "": image }, { " ": image }, { ["é".repeat(513)]: image }]) {
    assert.throws(() => normalizeImageAssets(input));
  }
  for (const invalid of [
    { ...image, format: "webp" }, { ...image, format: "jpg" }, { ...image, type: "video" },
    { ...image, part: "file" }, { ...image, url: "https://example.test/image.png" },
    { ...image, data_base64: `data:image/png;base64,${png}` },
    { ...image, data_base64: `${png}\n` }, { ...image, data_base64: "AB==" },
    { ...image, data_base64: "!!!!" }, { ...image, data_base64: png.slice(0, -4) },
  ]) assert.throws(() => normalizeImageAssets({ [reference]: invalid }));
  const manyReferences = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`${i}-${"x".repeat(1018)}`, image]));
  assert.throws(() => normalizeImageAssets(manyReferences), /references/);
});

test("image dimensions, animation and decoded byte limits are checked locally", () => {
  for (const [width, height] of [[256, 256], [255, 400], [400, 1569]]) {
    const bytes = Buffer.from(png, "base64");
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    assert.throws(() => normalizeImageAssets({ [reference]: { ...image, data_base64: bytes.toString("base64") } }), /dimensions/);
  }
  const bytes = Buffer.from(png, "base64");
  const animation = Buffer.alloc(20);
  animation.writeUInt32BE(8);
  animation.write("acTL", 4);
  const animated = Buffer.concat([bytes.subarray(0, 33), animation, bytes.subarray(33)]).toString("base64");
  assert.throws(() => normalizeImageAssets({ [reference]: { ...image, data_base64: animated } }), /animated/);
  const tooLarge = "A".repeat(4 * Math.ceil((16 * 1024 * 1024 + 1) / 3));
  assert.throws(() => normalizeImageAssets({ [reference]: { ...image, data_base64: tooLarge } }), /16 MiB/);
});

for (const Provider of [TypeSafeProvider, OpenRouterDecisionsProvider]) {
  test(`${Provider.name} rejects unreferenced images and oversized requests before HTTP`, async () => {
    let calls = 0;
    const provider = new Provider({ apiKey: "fixture-key", fetchImpl: async () => { calls += 1; return Response.json({ answers: {} }); } });
    await assert.rejects(provider.evaluate({ state: { [reference]: "not an image reference" }, questions, assets }), /must be referenced/);
    await assert.rejects(provider.evaluate({ state: "x".repeat(32 * 1024 * 1024), questions: {} }), /32 MiB/);
    assert.equal(calls, 0);
  });
}

for (const Provider of [TypeSafeProvider, OpenRouterDecisionsProvider]) {
  test(`${Provider.name} image errors remain fail-open without leaking bytes`, async () => {
    for (const settings of [
      { apiKey: "", fetchImpl: () => { throw new Error("must not call HTTP"); } },
      { apiKey: "fixture-key", fetchImpl: async () => new Response(png, { status: 400 }) },
      { apiKey: "fixture-key", fetchImpl: async () => new Response(png) },
      { apiKey: "fixture-key", fetchImpl: async () => { throw new Error(png); } },
      { apiKey: "fixture-key", fetchImpl: async () => { throw new DOMException("fixture timeout", "TimeoutError"); } },
    ]) {
      const result = await routeRequest(request, { provider: new Provider(settings) });
      assert.equal(result.status, "fallback");
      assert.equal(result.fallback.type, "provider_error");
      assert.equal(result.execution.enabled, false);
      assert.equal(JSON.stringify(result).includes(png), false);
    }
  });
}

