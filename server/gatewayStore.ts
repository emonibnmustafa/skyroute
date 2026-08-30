import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Provider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  modelIds: string[];
  modelTests: Record<string, { status: "unknown" | "healthy" | "error"; message: string; at: number }>;
  timeoutMs: number;
  enabled: boolean;
  status: "unknown" | "healthy" | "error";
  lastTestAt?: number;
  lastTestMessage?: string;
  lastFailure?: string;
  lastFailureAt?: number;
};

type ComboRoute = { providerId: string; modelId: string };
type Combo = { id: string; name: string; alias: string; routes: ComboRoute[]; enabled: boolean };
type ClientKey = { id: string; name: string; prefix: string; hash: string; createdAt: number; lastUsedAt?: number };

type AllowedModel = {
  id: string;
  providerId: string;
  modelId: string;
  alias?: string;
  enabled: boolean;
  status: "unknown" | "healthy" | "error";
  lastTestAt?: number;
  lastTestMessage?: string;
  createdAt: number;
};

type State = { providers: Provider[]; combos: Combo[]; keys: ClientKey[]; allowedModels: AllowedModel[] };

const dataFile = process.env.SKYROUTE_DATA_FILE || process.env.LOCALROUTE_DATA_FILE || path.join(process.cwd(), "skyroute-data.json");
const legacyDataFile = path.join(process.cwd(), "localroute-data.json");
const state: State = { providers: [], combos: [], keys: [], allowedModels: [] };
if (!existsSync(dataFile) && existsSync(legacyDataFile)) { try { const legacy = readFileSync(legacyDataFile, "utf8"); writeFileSync(dataFile, legacy); console.log("[SkyRoute] Migrated legacy localroute-data.json to skyroute-data.json"); } catch {} }
if (existsSync(dataFile)) {
  try {
    const raw = JSON.parse(readFileSync(dataFile, "utf8"));
    Object.assign(state, raw);
    state.providers.forEach(provider => { provider.modelIds = Array.from(new Set([provider.modelId, ...(provider.modelIds ?? [])].filter(Boolean))); provider.modelId = provider.modelId || provider.modelIds[0]; provider.modelTests = provider.modelTests ?? {}; });
    state.allowedModels = (raw.allowedModels ?? []) as AllowedModel[];
    // migration: if allowedModels empty but providers have models, seed from providers (disabled by default per user request)
    if (!state.allowedModels.length && state.providers.length) {
      for (const p of state.providers) {
        for (const mid of p.modelIds) {
          const alias = toOpusAlias(mid) !== mid.toLowerCase().replace(/[^a-z0-9._-]/g, "-") ? toOpusAlias(mid) : undefined;
          state.allowedModels.push({ id: randomUUID(), providerId: p.id, modelId: mid, alias, enabled: false, status: "unknown", createdAt: Date.now() });
        }
      }
      // dedup by provider+model
      const seen = new Set<string>();
      state.allowedModels = state.allowedModels.filter(m => {
        const k = `${m.providerId}:${m.modelId}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    // also dedup any existing allowedModels
    const seen2 = new Set<string>();
    state.allowedModels = state.allowedModels.filter(m => {
      const k = `${m.providerId}:${m.modelId}`;
      if (seen2.has(k)) return false;
      seen2.add(k);
      return true;
    });
  } catch { console.warn("[SkyRoute] Could not read local data file; starting empty"); }
}

function toOpusAlias(modelId: string): string {
  const normalized = modelId.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  if (normalized.includes("opus")) return normalized;
  return `opus-${normalized}`;
}
function persist() { try { writeFileSync(dataFile, JSON.stringify(state, null, 2), { mode: 0o600 }); } catch (error) { console.warn("[SkyRoute] Could not persist data:", error); } }

export function listProviders() {
  return state.providers.map(({ apiKey: _apiKey, ...provider }) => provider);
}
export function listCombos() { return state.combos; }
export function listKeys() { return state.keys.map(({ hash: _hash, ...key }) => key); }
export function getProvider(id: string) { return state.providers.find(p => p.id === id); }
export function getCombo(id: string) { return state.combos.find(c => c.id === id); }
export function findComboByAlias(alias: string) { return state.combos.find(c => c.alias === alias && c.enabled); }

function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

export function upsertProvider(input: Partial<Provider> & { name: string; baseUrl: string; modelId?: string; modelIds?: string[] }) {
  const id = input.id || randomUUID();
  const current = getProvider(id);
  const next: Provider = {
    id,
    name: input.name.trim(),
    baseUrl: normalizeBaseUrl(input.baseUrl),
    apiKey: input.apiKey ?? current?.apiKey ?? "",
    modelId: (input.modelId || input.modelIds?.[0] || current?.modelId || "").trim(),
    modelIds: Array.from(new Set([...(input.modelIds ?? []), input.modelId, current?.modelId, ...(current?.modelIds ?? [])].filter(Boolean).map(value => String(value).trim()))),
    modelTests: current?.modelTests ?? {},
    timeoutMs: Math.max(1000, Math.min(120000, Number(input.timeoutMs ?? current?.timeoutMs ?? 30000))),
    enabled: input.enabled ?? current?.enabled ?? true,
    status: current?.status ?? "unknown",
    lastTestAt: current?.lastTestAt,
    lastTestMessage: current?.lastTestMessage,
    lastFailure: current?.lastFailure,
    lastFailureAt: current?.lastFailureAt,
  };
  if (!next.name || !next.baseUrl || !next.modelId || !next.modelIds.length) throw new Error("Name, base URL, and at least one model ID are required");
  const index = state.providers.findIndex(p => p.id === id);
  if (index >= 0) state.providers[index] = next; else state.providers.push(next);
  persist();
  return listProviders().find(p => p.id === id)!;
}

export function deleteProvider(id: string) {
  state.providers.splice(state.providers.findIndex(p => p.id === id), 1);
  state.combos.forEach(combo => combo.routes = combo.routes.filter(route => route.providerId !== id));
  state.allowedModels = state.allowedModels.filter(m => m.providerId !== id);
  persist();
}
export function toggleProvider(id: string, enabled: boolean) { const p = getProvider(id); if (!p) throw new Error("Provider not found"); p.enabled = enabled; persist(); return listProviders().find(x => x.id === id)!; }

export function upsertCombo(input: { id?: string; name: string; alias: string; routes: ComboRoute[]; enabled?: boolean }) {
  const alias = input.alias.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  if (!input.name.trim() || !alias || input.routes.length === 0) throw new Error("Combo name, alias, and at least one route are required");
  if (state.combos.some(c => c.alias === alias && c.id !== input.id)) throw new Error("Combo alias already exists");
  const validRoutes = input.routes.filter(route => getProvider(route.providerId)?.enabled && route.modelId.trim());
  if (!validRoutes.length) throw new Error("Only enabled providers can be used in combos");
  const next: Combo = { id: input.id || randomUUID(), name: input.name.trim(), alias, routes: validRoutes, enabled: input.enabled ?? true };
  const index = state.combos.findIndex(c => c.id === next.id);
  if (index >= 0) state.combos[index] = next; else state.combos.push(next);
  persist();
  return next;
}
export function deleteCombo(id: string) { state.combos.splice(state.combos.findIndex(c => c.id === id), 1); persist(); }

function hashKey(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function createClientKey(name: string) {
  const raw = `lr_${randomBytes(24).toString("hex")}`;
  const key: ClientKey = { id: randomUUID(), name: name.trim() || "Unnamed key", prefix: raw.slice(0, 12), hash: hashKey(raw), createdAt: Date.now() };
  state.keys.push(key); persist();
  return { ...listKeys().find(k => k.id === key.id)!, secret: raw };
}
export function revokeClientKey(id: string) { state.keys.splice(state.keys.findIndex(k => k.id === id), 1); persist(); }
export function authenticateClientKey(value: string | undefined) {
  if (!value) return false;
  const key = state.keys.find(k => k.hash === hashKey(value));
  if (!key) return false;
  key.lastUsedAt = Date.now();
  return true;
}

export function listAllowedModels() { return state.allowedModels; }
export function getAllowedModel(id: string) { return state.allowedModels.find(m => m.id === id); }

export function addAllowedModel(input: { providerId: string; modelId: string; alias?: string }) {
  const provider = getProvider(input.providerId);
  if (!provider || !provider.enabled) throw new Error("Provider not found or disabled");
  if (!provider.modelIds.includes(input.modelId)) throw new Error("Model not found in provider");
  const exists = state.allowedModels.find(m => m.providerId === input.providerId && m.modelId === input.modelId);
  if (exists) throw new Error("Model already in SkyRoute list");
  const alias = input.alias?.trim() ? input.alias.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-") : toOpusAlias(input.modelId) !== input.modelId.toLowerCase().replace(/[^a-z0-9._-]/g, "-") ? toOpusAlias(input.modelId) : undefined;
  const entry: AllowedModel = {
    id: randomUUID(),
    providerId: input.providerId,
    modelId: input.modelId,
    alias: alias && alias !== input.modelId.toLowerCase() ? alias : undefined,
    enabled: false,
    status: "unknown",
    createdAt: Date.now(),
  };
  state.allowedModels.push(entry);
  persist();
  return entry;
}

export function removeAllowedModel(id: string) {
  const idx = state.allowedModels.findIndex(m => m.id === id);
  if (idx === -1) throw new Error("Allowed model not found");
  state.allowedModels.splice(idx, 1);
  persist();
}

export function toggleAllowedModel(id: string, enabled: boolean) {
  const m = getAllowedModel(id);
  if (!m) throw new Error("Allowed model not found");
  m.enabled = enabled;
  persist();
  return m;
}

export async function testAllowedModel(id: string) {
  const m = getAllowedModel(id);
  if (!m) throw new Error("Allowed model not found");
  const provider = getProvider(m.providerId);
  if (!provider) throw new Error("Provider not found");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider.timeoutMs);
  try {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({ model: m.modelId, messages: [{ role: "user", content: "Reply with OK" }], max_tokens: 16, stream: false }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().then(t => t.slice(0, 200)).catch(() => "")}`);
    const data: any = await res.json().catch(() => ({}));
    // consider healthy if response has choices or ok
    if (data?.choices || data?.id) {
      m.status = "healthy";
      m.lastTestMessage = "Model responded successfully";
      m.lastTestAt = Date.now();
      provider.status = "healthy";
      provider.lastTestMessage = `Model ${m.modelId} healthy`;
    } else {
      throw new Error("Invalid response");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Test failed";
    m.status = "error";
    m.lastTestMessage = msg;
    m.lastTestAt = Date.now();
  } finally {
    clearTimeout(timeout);
    persist();
  }
  return m;
}

export function snapshot() { return { providers: listProviders(), combos: listCombos(), keys: listKeys(), allowedModels: listAllowedModels() }; }

export async function testProviderModel(id: string, modelId: string) {
  const provider = getProvider(id); if (!provider || !provider.modelIds.includes(modelId)) throw new Error("Provider model not found");
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), provider.timeoutMs);
  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` }, body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "Reply with OK" }], max_tokens: 8, stream: false }), signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    provider.modelTests[modelId] = { status: "healthy", message: "Model responded successfully", at: Date.now() }; provider.status = "healthy"; persist();
  } catch (error) { const message = error instanceof Error ? error.message : "Model test failed"; provider.modelTests[modelId] = { status: "error", message, at: Date.now() }; provider.status = "error"; persist(); }
  finally { clearTimeout(timeout); }
  return listProviders().find(p => p.id === id)!;
}

export async function discoverUpstreamModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${clean}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as any;
    const ids: string[] = Array.isArray(data?.data) ? data.data.map((m: any) => String(m.id)).filter(Boolean) : Array.isArray(data?.models) ? data.models.map((m: any) => String(m.id || m)).filter(Boolean) : [];
    if (!ids.length && Array.isArray(data)) return data.map((m: any) => String(m.id || m)).filter(Boolean);
    return ids;
  } finally { clearTimeout(timeout); }
}

export async function testProvider(id: string) {
  const provider = getProvider(id); if (!provider) throw new Error("Provider not found");
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), provider.timeoutMs);
  try {
    const response = await fetch(`${provider.baseUrl}/models`, { headers: { Authorization: `Bearer ${provider.apiKey}` }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    provider.status = "healthy"; provider.lastTestAt = Date.now(); provider.lastTestMessage = "Models endpoint reachable";
  } catch (error) {
    provider.status = "error"; provider.lastTestAt = Date.now(); provider.lastTestMessage = error instanceof Error ? error.message : "Connection failed";
  } finally { clearTimeout(timeout); }
  return listProviders().find(p => p.id === id)!;
}

export function listOpusAliases(): Array<{ id: string; object: string; owned_by: string }> {
  // deprecated: now allowedModels controls exposure, keep for backward compat but return empty if allowedModels exist
  if (state.allowedModels.length) return [];
  const seen = new Set<string>();
  const out: Array<{ id: string; object: string; owned_by: string }> = [];
  for (const p of state.providers.filter(p => p.enabled)) {
    for (const mid of p.modelIds) {
      const alias = toOpusAlias(mid);
      if (alias === mid.toLowerCase().replace(/[^a-z0-9._-]/g, "-")) continue;
      if (seen.has(alias)) continue;
      seen.add(alias);
      if (state.combos.some(c => c.alias === alias && c.enabled)) continue;
      out.push({ id: alias, object: "model", owned_by: `skyroute:${p.name}` });
    }
  }
  return out;
}

export function listExposedModels(): Array<{ id: string; object: string; owned_by: string }> {
  const out: Array<{ id: string; object: string; owned_by: string }> = [];
  for (const m of state.allowedModels.filter(x => x.enabled)) {
    const p = getProvider(m.providerId);
    if (!p || !p.enabled) continue;
    // expose original modelId
    out.push({ id: m.modelId, object: "model", owned_by: p.name });
    // expose alias if different and enabled
    if (m.alias && m.alias !== m.modelId.toLowerCase()) {
      out.push({ id: m.alias, object: "model", owned_by: `${p.name} (alias)` });
    } else {
      // auto opus alias if original doesn't contain opus, expose as well for Claude
      const autoAlias = toOpusAlias(m.modelId);
      if (autoAlias !== m.modelId.toLowerCase().replace(/[^a-z0-9._-]/g, "-")) {
        out.push({ id: autoAlias, object: "model", owned_by: `${p.name} (alias)` });
      }
    }
  }
  // also include combos for backward compat
  for (const c of state.combos.filter(x => x.enabled)) {
    if (!out.some(o => o.id === c.alias)) out.push({ id: c.alias, object: "model", owned_by: `skyroute:${c.name}` });
  }
  return out;
}

export async function resolveRoutes(model: string) {
  // 1. check allowedModels (primary)
  const lower = model.toLowerCase();
  for (const m of state.allowedModels.filter(x => x.enabled)) {
    const p = getProvider(m.providerId);
    if (!p || !p.enabled) continue;
    if (m.modelId.toLowerCase() === lower) return [{ provider: p, model: m.modelId }];
    if (m.alias && m.alias.toLowerCase() === lower) return [{ provider: p, model: m.modelId }];
    if (toOpusAlias(m.modelId).toLowerCase() === lower) return [{ provider: p, model: m.modelId }];
    const norm = m.modelId.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
    if (norm === lower) return [{ provider: p, model: m.modelId }];
  }
  // 2. check combos (backward compat)
  const combo = findComboByAlias(model);
  if (combo) return combo.routes.map(route => ({ provider: getProvider(route.providerId), model: route.modelId })).filter(route => route.provider?.enabled);
  // 3. fallback: if no allowedModels, allow any provider model (for migration)
  if (!state.allowedModels.length) {
    const exact = state.providers.filter(p => p.enabled && (p.modelIds.includes(model) || p.id === model || p.name === model)).map(provider => ({ provider, model: provider.modelIds.includes(model) ? model : provider.modelId }));
    if (exact.length) return exact;
    for (const p of state.providers.filter(p => p.enabled)) {
      for (const mid of p.modelIds) {
        if (toOpusAlias(mid) === lower) return [{ provider: p, model: mid }];
        const normalizedMid = mid.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
        if (normalizedMid === lower) return [{ provider: p, model: mid }];
      }
    }
  }
  return [];
}

export async function proxyChat(model: string, body: Record<string, unknown>, onStream?: (chunk: Uint8Array) => void) {
  const routes = await resolveRoutes(model);
  if (!routes.length) throw new Error(`No enabled route found for model: ${model}`);
  let lastError = "No route attempted";
  for (const route of routes) {
    const provider = route.provider!; const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), provider.timeoutMs);
    try {
      const upstreamBody = { ...body, model: route.model, stream: body.stream === true };
      const response = await fetch(`${provider.baseUrl}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` }, body: JSON.stringify(upstreamBody), signal: controller.signal });
      if (!response.ok) { lastError = `${provider.name}: HTTP ${response.status}`; provider.status = "error"; provider.lastFailure = lastError; provider.lastFailureAt = Date.now(); persist(); continue; }
      provider.status = "healthy"; provider.lastTestAt = Date.now(); provider.lastTestMessage = `Route healthy for ${route.model}`; provider.lastFailure = undefined; provider.lastFailureAt = undefined; persist();
      if (onStream && response.body) { const reader = response.body.getReader(); while (true) { const item = await reader.read(); if (item.done) break; onStream(item.value); } return; }
      return await response.json();
    } catch (error) { lastError = `${provider.name}: ${error instanceof Error ? error.message : "request failed"}`; provider.status = "error"; provider.lastFailure = lastError; provider.lastFailureAt = Date.now(); persist(); }
    finally { clearTimeout(timeout); }
  }
  throw new Error(`All combo routes failed. ${lastError}`);
}
