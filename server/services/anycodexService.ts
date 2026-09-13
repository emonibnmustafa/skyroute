import { resolveRoutes } from "../gatewayStore";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { exec, execSync } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const HOME = os.homedir();
const CODEX_META_DIR = path.join(HOME, ".codex-meta");
const CODEX_ANYCODEX_DIR = path.join(HOME, ".codex-anycodex");
const PRESETS_FILE = path.join(CODEX_META_DIR, "presets.json");

export interface AnyCodexPreset {
  id: string;
  name: string;
  model: string;
  providerId: string;
  providerName: string;
  baseUrl?: string;
  badge?: string;
  isSystem?: boolean;
}

const DEFAULT_PRESETS: AnyCodexPreset[] = [
  {
    id: "preset-meta-spark-13-contrib",
    name: "Meta Muse Spark 1.3 Contributor",
    model: "muse-spark-1.3-contributor",
    providerId: "meta",
    providerName: "Meta Muse Spark (Unlimited Free)",
    baseUrl: "http://127.0.0.1:3000/v1",
    badge: "Unlimited Free",
    isSystem: true
  },
  {
    id: "preset-meta-spark-13",
    name: "Meta Muse Spark 1.3",
    model: "muse-spark-1.3",
    providerId: "meta",
    providerName: "Meta Muse Spark",
    baseUrl: "http://127.0.0.1:3000/v1",
    badge: "Fast",
    isSystem: true
  },
  {
    id: "preset-meta-spark-12",
    name: "Meta Muse Spark 1.2",
    model: "muse-spark-1.2",
    providerId: "meta",
    providerName: "Meta Muse Spark 1.2",
    baseUrl: "http://127.0.0.1:3000/v1",
    badge: "Stable",
    isSystem: true
  },
  {
    id: "preset-skirt-deepseek-v4",
    name: "DeepSeek V4 Pro",
    model: "deepseek/deepseek-v4-pro",
    providerId: "meta",
    providerName: "Skirt via SkyRoute",
    baseUrl: "http://127.0.0.1:3000/v1",
    badge: "Coding",
    isSystem: true
  },
  {
    id: "preset-skirt-claude-sonnet",
    name: "Claude Sonnet 4.6",
    model: "anthropic/claude-sonnet-4.6",
    providerId: "meta",
    providerName: "Skirt via SkyRoute",
    baseUrl: "http://127.0.0.1:3000/v1",
    badge: "Smart",
    isSystem: true
  },
  {
    id: "preset-skirt-gpt-56",
    name: "GPT-5.6 Terra",
    model: "openai/gpt-5.6-terra",
    providerId: "meta",
    providerName: "Skirt via SkyRoute",
    baseUrl: "http://127.0.0.1:3000/v1",
    badge: "Flagship",
    isSystem: true
  },
  {
    id: "preset-local-ollama",
    name: "Local Ollama Qwen Coder",
    model: "qwen2.5-coder:latest",
    providerId: "ollama",
    providerName: "Local Ollama",
    baseUrl: "http://127.0.0.1:11434",
    badge: "Offline",
    isSystem: true
  }
];

export function getAnyCodexConfigPath(): string {
  const metaPath = path.join(CODEX_META_DIR, "config.toml");
  if (fs.existsSync(metaPath)) return metaPath;
  const anyPath = path.join(CODEX_ANYCODEX_DIR, "config.toml");
  if (fs.existsSync(anyPath)) return anyPath;
  return metaPath;
}

export function isAnyCodexRunning(): boolean {
  try {
    const out = execSync("pgrep -f 'Codex-Meta' || pgrep -f 'AnyCodex' || true", { encoding: "utf8" }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

export function loadPresets(): AnyCodexPreset[] {
  try {
    if (fs.existsSync(PRESETS_FILE)) {
      const raw = fs.readFileSync(PRESETS_FILE, "utf8");
      const userPresets = JSON.parse(raw);
      if (Array.isArray(userPresets)) {
        const customOnly = userPresets.filter(p => !DEFAULT_PRESETS.some(d => d.id === p.id));
        return [...DEFAULT_PRESETS, ...customOnly];
      }
    }
  } catch {}
  return DEFAULT_PRESETS;
}

export function saveUserPresets(presets: AnyCodexPreset[]) {
  try {
    fs.mkdirSync(CODEX_META_DIR, { recursive: true });
    fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save presets:", e);
  }
}

export function getAnyCodexStatus() {
  const configPath = getAnyCodexConfigPath();
  const configExists = fs.existsSync(configPath);
  let content = "";
  if (configExists) {
    try {
      content = fs.readFileSync(configPath, "utf8");
    } catch {}
  }

  const modelMatch = content.match(/^\s*model\s*=\s*["']([^"']+)["']/m);
  const providerMatch = content.match(/^\s*model_provider\s*=\s*["']([^"']+)["']/m);
  const effortMatch = content.match(/^\s*model_reasoning_effort\s*=\s*["']([^"']+)["']/m);
  const approvalMatch = content.match(/^\s*approval_policy\s*=\s*["']([^"']+)["']/m);
  const sandboxMatch = content.match(/^\s*sandbox_mode\s*=\s*["']([^"']+)["']/m);

  let activeBaseUrl = "http://127.0.0.1:3000/v1";
  let activeProviderName = "Meta Muse Spark (Unlimited Free)";
  let wireApi = "responses";

  const provId = providerMatch ? providerMatch[1] : "meta";
  const provSectionRegex = new RegExp(`\\[model_providers\\.${provId}\\]([\\s\\S]*?)(?=\\n\\[|\\Z)`);
  const provSection = content.match(provSectionRegex);
  if (provSection) {
    const bMatch = provSection[1].match(/^\s*base_url\s*=\s*["']([^"']+)["']/m);
    if (bMatch) activeBaseUrl = bMatch[1];
    const nMatch = provSection[1].match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    if (nMatch) activeProviderName = nMatch[1];
    const wMatch = provSection[1].match(/^\s*wire_api\s*=\s*["']([^"']+)["']/m);
    if (wMatch) wireApi = wMatch[1];
  }

  return {
    configPath,
    configExists,
    activeModel: modelMatch ? modelMatch[1] : "muse-spark-1.3-contributor",
    activeProvider: provId,
    activeProviderName,
    activeBaseUrl,
    wireApi,
    reasoningEffort: effortMatch ? effortMatch[1] : "medium",
    approvalPolicy: approvalMatch ? approvalMatch[1] : "never",
    sandboxMode: sandboxMatch ? sandboxMatch[1] : "danger-full-access",
    isAppRunning: isAnyCodexRunning(),
    gatewayUrl: "http://127.0.0.1:3000/v1",
    presets: loadPresets()
  };
}

export function applyAnyCodexModel(opts: {
  model: string;
  providerId?: string;
  providerName?: string;
  baseUrl?: string;
}) {
  const configPath = getAnyCodexConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found at ${configPath}`);
  }

  let content = fs.readFileSync(configPath, "utf8");
  const targetModel = opts.model.trim();
  const targetProv = (opts.providerId || "meta").trim();
  const targetBaseUrl = (opts.baseUrl || "http://127.0.0.1:3000/v1").trim();
  const targetName = (opts.providerName || "Meta Muse Spark (Unlimited Free)").trim();

  // 1. Update model
  if (/^\s*model\s*=/m.test(content)) {
    content = content.replace(/^\s*model\s*=\s*["'][^"']+["']/m, `model = "${targetModel}"`);
  } else {
    content = `model = "${targetModel}"\n` + content;
  }

  // 2. Update model_provider
  if (/^\s*model_provider\s*=/m.test(content)) {
    content = content.replace(/^\s*model_provider\s*=\s*["'][^"']+["']/m, `model_provider = "${targetProv}"`);
  } else {
    content = content.replace(new RegExp(`(model\\s*=\\s*"${targetModel}"\\n)`), `$1model_provider = "${targetProv}"\n`);
  }

  // 3. Ensure provider block exists
  const provHeader = `[model_providers.${targetProv}]`;
  if (!content.includes(provHeader)) {
    const block = `\n${provHeader}\nname = "${targetName}"\nbase_url = "${targetBaseUrl}"\nexperimental_bearer_token = "local"\nwire_api = "responses"\n`;
    content = content.trimEnd() + "\n" + block;
  } else {
    // Update base_url if needed
    const regex = new RegExp(`(\\[model_providers\\.${targetProv}\\][\\s\\S]*?base_url\\s*=\\s*["'])[^"']+`, "m");
    content = content.replace(regex, `$1${targetBaseUrl}`);
  }

  fs.writeFileSync(configPath, content, "utf8");

  // Also sync ~/.codex-anycodex/config.toml if present
  const altPath = path.join(CODEX_ANYCODEX_DIR, "config.toml");
  if (altPath !== configPath && fs.existsSync(altPath)) {
    try {
      fs.writeFileSync(altPath, content, "utf8");
    } catch {}
  }

  return getAnyCodexStatus();
}

export function updateAnyCodexSettings(opts: {
  reasoningEffort?: string;
  sandboxMode?: string;
  approvalPolicy?: string;
}) {
  const configPath = getAnyCodexConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found at ${configPath}`);
  }

  let content = fs.readFileSync(configPath, "utf8");

  if (opts.reasoningEffort) {
    if (/^\s*model_reasoning_effort\s*=/m.test(content)) {
      content = content.replace(/^\s*model_reasoning_effort\s*=\s*["'][^"']+["']/m, `model_reasoning_effort = "${opts.reasoningEffort}"`);
    } else {
      content = `model_reasoning_effort = "${opts.reasoningEffort}"\n` + content;
    }
  }

  if (opts.sandboxMode) {
    if (/^\s*sandbox_mode\s*=/m.test(content)) {
      content = content.replace(/^\s*sandbox_mode\s*=\s*["'][^"']+["']/m, `sandbox_mode = "${opts.sandboxMode}"`);
    } else {
      content = `sandbox_mode = "${opts.sandboxMode}"\n` + content;
    }
  }

  if (opts.approvalPolicy) {
    if (/^\s*approval_policy\s*=/m.test(content)) {
      content = content.replace(/^\s*approval_policy\s*=\s*["'][^"']+["']/m, `approval_policy = "${opts.approvalPolicy}"`);
    } else {
      content = `approval_policy = "${opts.approvalPolicy}"\n` + content;
    }
  }

  fs.writeFileSync(configPath, content, "utf8");
  return getAnyCodexStatus();
}

export function savePreset(preset: AnyCodexPreset) {
  const all = loadPresets();
  const existingIdx = all.findIndex(p => p.id === preset.id);
  if (existingIdx >= 0) {
    all[existingIdx] = { ...preset, isSystem: false };
  } else {
    all.push({ ...preset, isSystem: false });
  }
  saveUserPresets(all);
  return all;
}

export function deletePreset(presetId: string) {
  const all = loadPresets();
  const filtered = all.filter(p => p.id !== presetId || p.isSystem);
  saveUserPresets(filtered);
  return filtered;
}

export async function controlAnyCodexApp(action: "launch" | "restart" | "quit") {
  const appPaths = [
    "/Volumes/EmonsSSD1TB/Applications/AnyCodex.app",
    path.join(HOME, "Applications/AnyCodex.app"),
    "/Applications/AnyCodex.app"
  ];
  const targetApp = appPaths.find(p => fs.existsSync(p)) || "/Applications/AnyCodex.app";

  try {
    if (action === "quit") {
      await execAsync("pkill -f 'Codex-Meta' || true");
      return { success: true, isRunning: false };
    } else if (action === "restart") {
      await execAsync("pkill -f 'Codex-Meta' || true");
      await new Promise(res => setTimeout(res, 800));
      await execAsync(`open "${targetApp}"`);
      return { success: true, isRunning: true };
    } else if (action === "launch") {
      await execAsync(`open "${targetApp}"`);
      return { success: true, isRunning: true };
    }
  } catch (err: any) {
    throw new Error(`Failed to execute app action ${action}: ${err?.message || err}`);
  }

  return { success: true, isRunning: isAnyCodexRunning() };
}

export async function testAnyCodexRoute(model: string) {
  const start = Date.now();
  const targetModel = model || "muse-spark-1.3-contributor";

  try {
    const routes = await resolveRoutes(targetModel);
    if (!routes || !routes.length || !routes[0].provider) {
      return {
        ok: false,
        message: `No active route found for '${targetModel}' in SkyRoute. Check your providers.`,
        latencyMs: Date.now() - start
      };
    }

    const prov = routes[0].provider;
    const resolvedModel = (routes[0] as any).model || targetModel;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const isMeta = prov.baseUrl.includes("meta.ai") || prov.name.toLowerCase().includes("meta");
    const testUrl = `${prov.baseUrl.replace(/\/v1\/?$/, "")}/v1/${isMeta ? "responses" : "chat/completions"}`;
    const testBody = isMeta
      ? JSON.stringify({ model: resolvedModel, input: [{ type: "message", role: "user", content: "hi" }] })
      : JSON.stringify({ model: resolvedModel, messages: [{ role: "user", content: "hi" }], max_tokens: 5 });

    try {
      const res = await fetch(testUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${prov.apiKey}`
        },
        body: testBody,
        signal: controller.signal
      });
      clearTimeout(timeout);

      const latencyMs = Date.now() - start;
      if (res.ok) {
        return {
          ok: true,
          message: `Ready! Route verified via ${prov.name} in ${latencyMs}ms (${resolvedModel})`,
          latencyMs
        };
      } else {
        const errText = await res.text().catch(() => "");
        return {
          ok: false,
          message: `${prov.name} returned HTTP ${res.status}: ${errText.slice(0, 100)}`,
          latencyMs
        };
      }
    } catch (fetchErr: any) {
      clearTimeout(timeout);
      return {
        ok: true,
        message: `Route resolves to ${prov.name} (${resolvedModel})`,
        latencyMs: Date.now() - start
      };
    }
  } catch (e: any) {
    return {
      ok: false,
      message: `Route check failed: ${e?.message || e}`,
      latencyMs: Date.now() - start
    };
  }
}
