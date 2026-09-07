import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerGatewayRoutes } from "./gatewayRoutes";
import { authenticateClientKey, createClientKey, listCombos, listExposedModels, listProviders, proxyChat, resolveRoutes, setAllowedModelAlias, snapshot, testProviderModel, toggleAllowedModel, upsertCombo, upsertProvider, _resetForTest } from "./gatewayStore";
import { addAllowedModel, listAllowedModels } from "./gatewayStore";

describe("local gateway core", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    _resetForTest();
  });

  it("never returns upstream API keys in provider listings", () => {
    const provider = upsertProvider({ name: "Test upstream", baseUrl: "https://example.com/v1", apiKey: "secret-upstream", modelId: "test-model" });
    expect(provider).not.toHaveProperty("apiKey");
    expect(listProviders().find(p => p.id === provider.id)).not.toHaveProperty("apiKey");
  });

  it("updates an existing provider during edit instead of duplicating it", () => {
    const provider = upsertProvider({ name: "Editable", baseUrl: "https://old.example/v1", apiKey: "key", modelId: "old-model" });
    upsertProvider({ id: provider.id, name: "Edited", baseUrl: "https://new.example/v1", apiKey: "new-key", modelId: "new-model" });
    const matches = listProviders().filter(p => p.id === provider.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ name: "Edited", baseUrl: "https://new.example/v1", modelId: "new-model" });
  });

  it("retains multiple model IDs and records a live model test", async () => {
    const provider = upsertProvider({ name: "Multi-model", baseUrl: "https://models.example/v1", apiKey: "secret", modelId: "alpha", modelIds: ["alpha", "beta"] });
    expect(listProviders().find(p => p.id === provider.id)?.modelIds).toEqual(["alpha", "beta"]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 })));
    const result = await testProviderModel(provider.id, "beta");
    expect(result.modelTests?.beta.status).toBe("healthy");
    expect(result).not.toHaveProperty("apiKey");
  });

  it("protects the OpenAI-compatible models endpoint with bearer auth", async () => {
    const app = express(); registerGatewayRoutes(app);
    const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const s = app.listen(0, () => resolve(s)); });
    const address = server.address(); const port = typeof address === "object" && address ? address.port : 0;
    const denied = await fetch(`http://127.0.0.1:${port}/v1/models`);
    expect(denied.status).toBe(401);
    const key = createClientKey("http-test");
    upsertProvider({ name: "Discovery provider", baseUrl: "https://discover.example/v1", apiKey: "key", modelId: "discover-a", modelIds: ["discover-a", "discover-b"] });
    const allowed = await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { Authorization: `Bearer ${key.secret}` } });
    expect(allowed.status).toBe(200);
    const payload = await allowed.json();
    expect(payload.object).toBe("list");
    expect(payload.data.map((model: { id: string }) => model.id)).toEqual(expect.arrayContaining(["discover-a", "discover-b"]));
    server.close();
  });

  it("serves authenticated direct, combo, JSON, and streaming chat requests", async () => {
    const upstream = express(); upstream.use(express.json());
    upstream.post("/v1/chat/completions", (req, res) => { if (req.body.stream) { res.type("text/event-stream").send("data: {\\\"choices\\\":[{\\\"delta\\\":{\\\"content\\\":\\\"hi\\\"}}]}\\n\\ndata: [DONE]\\n\\n"); } else res.json({ id: "chatcmpl-local", object: "chat.completion", model: req.body.model, choices: [{ message: { role: "assistant", content: "hello" } }] }); });
    const upstreamServer = await new Promise<ReturnType<typeof upstream.listen>>(resolve => { const s = upstream.listen(0, () => resolve(s)); });
    const upstreamAddress = upstreamServer.address(); const upstreamPort = typeof upstreamAddress === "object" && upstreamAddress ? upstreamAddress.port : 0;
    const provider = upsertProvider({ name: "HTTP upstream", baseUrl: `http://127.0.0.1:${upstreamPort}/v1`, apiKey: "key", modelId: "direct-model" });
    const combo = upsertCombo({ name: "HTTP combo", alias: `http-combo-${provider.id.slice(0, 5)}`, routes: [{ providerId: provider.id, modelId: "direct-model" }] });
    const app = express(); app.use(express.json()); registerGatewayRoutes(app);
    const localServer = await new Promise<ReturnType<typeof app.listen>>(resolve => { const s = app.listen(0, () => resolve(s)); });
    const localAddress = localServer.address(); const localPort = typeof localAddress === "object" && localAddress ? localAddress.port : 0;
    const key = createClientKey("chat-http-test");
    try {
      expect((await fetch(`http://127.0.0.1:${localPort}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "direct-model", messages: [] }) })).status).toBe(401);
      const direct = await fetch(`http://127.0.0.1:${localPort}/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "direct-model", messages: [] }) });
      expect(direct.status).toBe(200); expect((await direct.json()).object).toBe("chat.completion");
      const comboResponse = await fetch(`http://127.0.0.1:${localPort}/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: combo.alias, messages: [] }) });
      expect(comboResponse.status).toBe(200); expect((await comboResponse.json()).model).toBe("direct-model");
      const stream = await fetch(`http://127.0.0.1:${localPort}/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: combo.alias, stream: true, messages: [] }) });
      expect(stream.status).toBe(200); expect(stream.headers.get("content-type")).toContain("text/event-stream"); expect(await stream.text()).toContain("[DONE]");
    } finally { localServer.close(); upstreamServer.close(); }
  });

  it("hashes client keys and authenticates only the raw bearer value", () => {
    const result = createClientKey("VS Code");
    expect(result.secret).toMatch(/^lr_/);
    expect(snapshot().keys.find(k => k.id === result.id)).not.toHaveProperty("hash");
    expect(authenticateClientKey(result.secret)).toBe(true);
    expect(authenticateClientKey("lr_invalid")).toBe(false);
  });

  it("rejects combo routes that use disabled providers", () => {
    const provider = upsertProvider({ name: "Disabled", baseUrl: "https://example.com/v1", apiKey: "key", modelId: "model", enabled: false });
    expect(() => upsertCombo({ name: "Invalid", alias: `invalid-${provider.id.slice(0, 5)}`, routes: [{ providerId: provider.id, modelId: "model" }] })).toThrow("Only enabled providers");
  });

  it("falls back to the next upstream when the first route fails", async () => {
    const first = upsertProvider({ name: "Failing", baseUrl: "https://fail.example/v1", apiKey: "one", modelId: "one" });
    const second = upsertProvider({ name: "Working", baseUrl: "https://work.example/v1", apiKey: "two", modelId: "two" });
    upsertCombo({ name: "Resilient", alias: `resilient-${first.id.slice(0, 5)}`, routes: [{ providerId: first.id, modelId: "one" }, { providerId: second.id, modelId: "two" }] });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("upstream down", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "ok", model: "two" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await proxyChat(`resilient-${first.id.slice(0, 5)}`, { messages: [{ role: "user", content: "hi" }] });
    expect(result).toEqual({ id: "ok", model: "two" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves ordered combo routes", () => {
    const first = upsertProvider({ name: "First", baseUrl: "https://first.example/v1", apiKey: "one", modelId: "one" });
    const second = upsertProvider({ name: "Second", baseUrl: "https://second.example/v1", apiKey: "two", modelId: "two" });
    const combo = upsertCombo({ name: "Fallback", alias: `fallback-${first.id.slice(0, 5)}`, routes: [{ providerId: second.id, modelId: "two" }, { providerId: first.id, modelId: "one" }] });
    expect(listCombos().find(c => c.id === combo.id)?.routes.map(route => route.providerId)).toEqual([second.id, first.id]);
  });

  it("routes two provider copies of the same model via distinct custom aliases", async () => {
    const first = upsertProvider({ name: "Meta", baseUrl: "https://meta.example/v1", apiKey: "key-a", modelId: "muse-spark" });
    const second = upsertProvider({ name: "MetaOpenclaw", baseUrl: "https://claw.example/v1", apiKey: "key-b", modelId: "muse-spark" });
    const entryA = addAllowedModel({ providerId: first.id, modelId: "muse-spark" });
    const entryB = addAllowedModel({ providerId: second.id, modelId: "muse-spark" });
    toggleAllowedModel(entryA.id, true);
    toggleAllowedModel(entryB.id, true);
    setAllowedModelAlias(entryA.id, "opus-spark-key-a");
    setAllowedModelAlias(entryB.id, "opus-spark-key-b");
    const routeA = await resolveRoutes("opus-spark-key-a");
    const routeB = await resolveRoutes("opus-spark-key-b");
    expect(routeA[0]?.provider?.id).toBe(first.id);
    expect(routeA[0]?.model).toBe("muse-spark");
    expect(routeB[0]?.provider?.id).toBe(second.id);
    expect(routeB[0]?.model).toBe("muse-spark");
    // Raw id and auto alias still resolve deterministically to the first copy.
    expect((await resolveRoutes("muse-spark"))[0]?.provider?.id).toBe(first.id);
    expect((await resolveRoutes("opus-muse-spark"))[0]?.provider?.id).toBe(first.id);
    // /v1/models must not list the duplicate id twice.
    const ids = listExposedModels().map(m => m.id);
    expect(ids.filter(id => id === "muse-spark")).toHaveLength(1);
    expect(ids).toEqual(expect.arrayContaining(["muse-spark", "opus-spark-key-a", "opus-spark-key-b"]));
    expect(listAllowedModels().find(m => m.id === entryA.id)?.alias).toBe("opus-spark-key-a");
  });

  it("rejects custom aliases that collide and clears back to auto alias", () => {
    const first = upsertProvider({ name: "P1", baseUrl: "https://p1.example/v1", apiKey: "k", modelId: "alpha" });
    const second = upsertProvider({ name: "P2", baseUrl: "https://p2.example/v1", apiKey: "k", modelId: "beta" });
    const entryA = addAllowedModel({ providerId: first.id, modelId: "alpha" });
    const entryB = addAllowedModel({ providerId: second.id, modelId: "beta" });
    expect(() => setAllowedModelAlias(entryB.id, "alpha")).toThrow("already used as a model ID");
    setAllowedModelAlias(entryA.id, "opus-custom");
    expect(() => setAllowedModelAlias(entryB.id, "opus-custom")).toThrow("already used by another model");
    expect(() => setAllowedModelAlias(entryB.id, "opus-alpha")).toThrow("clashes with the auto alias");
    upsertCombo({ name: "C", alias: "opus-combo", routes: [{ providerId: first.id, modelId: "alpha" }] });
    expect(() => setAllowedModelAlias(entryB.id, "opus-combo")).toThrow('already used by combo');
    setAllowedModelAlias(entryA.id, "   ");
    expect(listAllowedModels().find(m => m.id === entryA.id)?.alias).toBeUndefined();
  });
});
