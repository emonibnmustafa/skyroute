import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  AlertTriangle,
  Boxes,
  Check,
  CheckCircle,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  X,
  Zap,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

type Tab = "overview" | "providers" | "models" | "enabled" | "aliases" | "keys";

function copy(v: string) {
  navigator.clipboard.writeText(v);
  toast.success("Copied");
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("providers");
  const [q, setQ] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [providerForm, setProviderForm] = useState({
    id: "",
    name: "",
    baseUrl: "http://localhost:20128/v1",
    apiKey: "",
    modelIdsText: "",
    timeoutMs: 60000,
    providerType: "openai" as "openai" | "chatgpt-web",
    cookie: "",
  });
  const [aliasForm, setAliasForm] = useState({ name: "", alias: "", routes: [] as { providerId: string; modelId: string }[] });
  const [keyName, setKeyName] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [fetched, setFetched] = useState<string[] | null>(null);
  const [fetchedSearch, setFetchedSearch] = useState("");
  const [allowedSearch, setAllowedSearch] = useState("");
  const [testPopup, setTestPopup] = useState<{ open: boolean; title: string; message: string; ok: boolean } | null>(null);
  const [cookieCheck, setCookieCheck] = useState<{ ok: boolean; msg: string } | null>(null);

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.gateway.snapshot.useQuery(undefined, { refetchInterval: 5000 });
  const allowedQ = trpc.gateway.allowedModels.useQuery();
  const saveProvider = trpc.gateway.saveProvider.useMutation({
    onSuccess: () => {
      utils.gateway.snapshot.invalidate();
      allowedQ.refetch();
      setProviderForm({ id: "", name: "", baseUrl: "http://localhost:20128/v1", apiKey: "", modelIdsText: "", timeoutMs: 60000, providerType: "openai", cookie: "" });
      setFetched(null);
      setCookieCheck(null);
      toast.success("Provider saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const testProvider = trpc.gateway.testProvider.useMutation({
    onSuccess: () => {
      utils.gateway.snapshot.invalidate();
      toast.success("Checked");
    },
    onError: (e) => toast.error(e.message),
  });
  const discover = trpc.gateway.discoverModels.useMutation({
    onSuccess: (ids) => {
      if (!ids.length) toast.error("No models found");
      else {
        setProviderForm((s) => ({ ...s, modelIdsText: ids.join("\n") }));
        setFetched(ids);
        setFetchedSearch("");
        toast.success(`Found ${ids.length} models — browse below`);
      }
    },
    onError: (e) => toast.error(e.message),
  });
  const discoverChatGpt = (trpc.gateway as any).discoverChatGptModels.useMutation({
    onMutate: () => {
      console.log("[SkyRoute] discoverChatGpt mutate start", providerForm.cookie.slice(0,30));
      setCookieCheck(null);
    },
    onSuccess: (ids: string[]) => {
      console.log("[SkyRoute] discoverChatGpt success", ids.length);
      if (!ids.length) {
        toast.error("No models found");
        setCookieCheck({ ok: false, msg: "No models found — cookie may be invalid" });
      } else {
        setProviderForm((s) => ({ ...s, modelIdsText: ids.join("\n") }));
        setFetched(ids);
        setFetchedSearch("");
        setCookieCheck({ ok: true, msg: `Cookie valid — found ${ids.length} models` });
        toast.success(`Found ${ids.length} ChatGPT models — browse below`);
      }
    },
    onError: (e: any) => {
      console.error("[SkyRoute] discoverChatGpt error", e);
      setFetched(null);
      const msg = e?.message || e?.data?.message || "Cookie invalid";
      setCookieCheck({ ok: false, msg });
      toast.error(msg);
    },
  });
  const validateCookie = (trpc.gateway as any).validateChatGptCookie.useMutation({
    onMutate: () => console.log("[SkyRoute] validateCookie start"),
    onSuccess: (r: any) => {
      console.log("[SkyRoute] validate success", r);
      const msg = r?.message || "Cookie valid — Plus session active";
      setCookieCheck({ ok: true, msg });
      toast.success(msg);
    },
    onError: (e: any) => {
      console.error("[SkyRoute] validate error", e);
      const msg = e?.message || e?.data?.message || "Cookie invalid";
      setCookieCheck({ ok: false, msg });
      toast.error(msg);
    },
  });
  const toggle = trpc.gateway.toggleProvider.useMutation({ onSuccess: () => utils.gateway.snapshot.invalidate() });
  const delProvider = trpc.gateway.deleteProvider.useMutation({ onSuccess: () => { utils.gateway.snapshot.invalidate(); allowedQ.refetch(); toast.success("Removed"); } });
  const saveAlias = trpc.gateway.saveCombo.useMutation({
    onSuccess: () => {
      utils.gateway.snapshot.invalidate();
      setAliasForm({ name: "", alias: "", routes: [] });
      toast.success("Alias saved");
    },
    onError: (e) => toast.error(e.message),
  });
  const delAlias = trpc.gateway.deleteCombo.useMutation({ onSuccess: () => utils.gateway.snapshot.invalidate() });
  const createKey = trpc.gateway.createKey.useMutation({
    onSuccess: (r) => {
      utils.gateway.snapshot.invalidate();
      setRevealed(r.secret);
      setKeyName("");
      toast.success("Key created — copy now");
    },
    onError: (e) => toast.error(e.message),
  });
  const revoke = trpc.gateway.revokeKey.useMutation({ onSuccess: () => utils.gateway.snapshot.invalidate() });
  const addAllowed = trpc.gateway.addAllowedModel.useMutation({
    onSuccess: () => {
      allowedQ.refetch();
      toast.success("Added to SkyRoute by Emon models");
    },
    onError: (e) => toast.error(e.message),
  });
  const removeAllowed = trpc.gateway.removeAllowedModel.useMutation({ onSuccess: () => allowedQ.refetch() });
  const toggleAllowed = trpc.gateway.toggleAllowedModel.useMutation({ onSuccess: () => allowedQ.refetch() });
  const refreshModels = (trpc.gateway as any).refreshModels.useMutation({
    onSuccess: (res: any) => {
      utils.gateway.snapshot.invalidate();
      allowedQ.refetch();
      const totalDiscovered = res?.results?.reduce((a: number, r: any) => a + (r.discovered || 0), 0) ?? 0;
      if (res?.added > 0) toast.success(`Refreshed ${res.refreshed} provider(s) — added ${res.added} new model(s) (${totalDiscovered} total)`);
      else if (res?.refreshed > 0) toast.success(`Refreshed ${res.refreshed} provider(s) — all ${totalDiscovered} models up-to-date`);
      else if (res?.skipped > 0 && res?.refreshed === 0) toast.error("No enabled providers to refresh");
      if (res?.errors?.length) {
        const msg = res.errors.map((e: any) => `${e.providerName}: ${e.error}`).join("; ").slice(0, 200);
        toast.error(`${res.errors.length} provider(s) failed — ${msg}`);
      }
    },
    onError: (e: any) => toast.error(e.message),
  });
  const testAllowed = trpc.gateway.testAllowedModel.useMutation({
    onSuccess: (m) => {
      allowedQ.refetch();
      utils.gateway.snapshot.invalidate();
      if (m.status === "healthy") {
        setTestPopup({ open: true, title: "Model working", message: m.lastTestMessage || "Model responded successfully", ok: true });
        toast.success("Model working");
      } else {
        setTestPopup({ open: true, title: "Model failed", message: m.lastTestMessage || "Unknown error", ok: false });
        toast.error("Model failed");
      }
    },
    onError: (e) => {
      setTestPopup({ open: true, title: "Test error", message: e.message, ok: false });
      toast.error(e.message);
    },
  });

  const providers = data?.providers ?? [];
  const combos = data?.combos ?? [];
  const keys = data?.keys ?? [];
  const allowed = (allowedQ.data as any[]) ?? [];
  const endpoint = typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:3000";

  useEffect(() => {
    fetch("/health")
      .then((r) => setHealth(r.ok ? "online" : "offline"))
      .catch(() => setHealth("offline"));
  }, []);
  useEffect(() => {
    // reset cookie check when cookie or type changes
    setCookieCheck(null);
    // also clear fetched models when switching type
    setFetched(null);
  }, [providerForm.cookie, providerForm.providerType]);

  const filteredProviders = useMemo(() => {
    if (!q) return providers;
    const l = q.toLowerCase();
    return providers.filter((p) => p.name.toLowerCase().includes(l) || p.baseUrl.toLowerCase().includes(l) || p.modelIds.join(" ").toLowerCase().includes(l));
  }, [providers, q]);

  const filteredAliases = useMemo(() => {
    if (!q) return combos;
    const l = q.toLowerCase();
    return combos.filter((c) => c.name.toLowerCase().includes(l) || c.alias.toLowerCase().includes(l));
  }, [combos, q]);

  const filteredAllowed = useMemo(() => {
    if (!allowedSearch) return allowed;
    const l = allowedSearch.toLowerCase();
    return allowed.filter((m: any) => m.modelId.toLowerCase().includes(l) || (m.alias && m.alias.toLowerCase().includes(l)) || (providers.find((p) => p.id === m.providerId)?.name.toLowerCase().includes(l) ?? false));
  }, [allowed, providers, allowedSearch]);

  const fetchedFiltered = useMemo(() => {
    if (!fetched) return null;
    if (!fetchedSearch) return fetched;
    const l = fetchedSearch.toLowerCase();
    return fetched.filter((id) => id.toLowerCase().includes(l));
  }, [fetched, fetchedSearch]);

  const enabledCount = allowed.filter((m: any) => m.enabled).length;
  const nav: { id: Tab; label: string; icon: any; count?: number }[] = [
    { id: "overview", label: "Overview", icon: Layers },
    { id: "providers", label: "Providers", icon: Server, count: providers.length },
    { id: "models", label: "Models", icon: Boxes, count: allowed.length },
    { id: "enabled", label: "Enabled Models", icon: CheckCircle, count: enabledCount },
    { id: "aliases", label: "Aliases", icon: Sparkles, count: combos.length },
    { id: "keys", label: "Keys", icon: KeyRound, count: keys.length },
  ];

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f]">
      <div className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 border-b border-black/[.06]">
        <div className="mx-auto max-w-[1280px] px-6 h-[52px] flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#FF5F57] border border-black/10" />
              <span className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-black/10" />
              <span className="w-3 h-3 rounded-full bg-[#28C840] border border-black/10" />
            </div>
            <div className="flex items-center gap-2.5 ml-3">
              <div className="w-7 h-7 rounded-lg bg-[#007AFF] grid place-items-center text-white">
                <Zap size={14} />
              </div>
              <div>
                <div className="text-[13px] font-semibold tracking-tight">SkyRoute by Emon</div>
                <div className="text-[10px] leading-none text-black/50">Gateway · Mac</div>
              </div>
            </div>
            <span className={`ml-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border ${health === "online" ? "bg-[#34C759]/10 text-[#248A3D] border-[#34C759]/20" : health === "offline" ? "bg-[#FF3B30]/10 text-[#D70015] border-[#FF3B30]/20" : "bg-black/5 text-black/50 border-black/5"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${health === "online" ? "bg-[#34C759]" : health === "offline" ? "bg-[#FF3B30]" : "bg-black/20 animate-pulse"}`} />
              {health}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 text-xs">
              <span className="text-black/40" title="Claude Desktop Gateway mode expects the root URL (no /v1). VS Code / OpenAI clients need the /v1 URL.">Gateway</span>
              <button onClick={() => copy(`${endpoint}/v1`)} title="OpenAI / VS Code URL (with /v1). For Claude Desktop Gateway mode, use the root URL without /v1." className="mac-card rounded-full px-3 py-1.5 font-mono text-[12px] flex items-center gap-1.5 hover:bg-white">
                {endpoint}/v1 <Copy size={12} className="opacity-40" />
              </button>
            </div>
            <a href="https://github.com/emonibnmustafa/skyroute" target="_blank" className="w-8 h-8 rounded-full mac-card grid place-items-center hover:bg-white">
              <ExternalLink size={14} className="opacity-60" />
            </a>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1280px] px-6 py-6 flex gap-6">
        <aside className="hidden lg:block w-[220px] shrink-0">
          <div className="mac-card rounded-2xl p-3 sticky top-[68px]">
            <div className="px-2 py-1.5 text-[11px] font-semibold tracking-widest text-black/30 uppercase">Menu</div>
            <nav className="space-y-1">
              {nav.map((n) => (
                <button
                  key={n.id}
                  onClick={() => setTab(n.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13px] font-medium transition ${tab === n.id ? "bg-[#007AFF] text-white shadow-sm" : "text-black/60 hover:bg-black/[.04] hover:text-black/80"}`}
                >
                  <n.icon size={16} strokeWidth={tab === n.id ? 2.5 : 2} />
                  <span className="flex-1 text-left">{n.label}</span>
                  {n.count !== undefined && (
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-mono ${tab === n.id ? "bg-white/20 text-white" : "bg-black/5 text-black/50"}`}>{n.count}</span>
                  )}
                </button>
              ))}
            </nav>
            <div className="mt-4 p-3 rounded-xl bg-[#f5f5f7] border border-black/[.04]">
              <div className="text-[11px] font-semibold text-black/60 flex items-center gap-1.5">
                <Activity size={12} /> System
              </div>
              <div className="mt-1 text-xs text-black/50">Local-only. Data in <span className="font-mono">skyroute-data.json</span></div>
              <div className="mt-2 flex items-center gap-1 text-[11px] text-[#007AFF]">
                <ShieldCheck size={12} /> Secure · 0600
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          <div className="flex lg:hidden gap-1.5 mb-4 overflow-auto">
            {nav.map((n) => (
              <button
                key={n.id}
                onClick={() => setTab(n.id)}
                className={`whitespace-nowrap px-3.5 py-2 rounded-full text-[13px] font-medium border ${tab === n.id ? "bg-[#007AFF] text-white border-[#007AFF]" : "bg-white text-black/60 border-black/10"}`}
              >
                {n.label} {n.count !== undefined ? `· ${n.count}` : ""}
              </button>
            ))}
          </div>

          <div className="mac-card rounded-2xl p-2 flex items-center gap-2 mb-5">
            <Search size={16} className="ml-2 opacity-30" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search providers, aliases, models…" className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-black/30" />
            {q && (
              <button onClick={() => setQ("")} className="text-xs text-black/40 hover:text-black/70 px-2">
                Clear
              </button>
            )}
            <div className="hidden sm:flex items-center gap-1 text-[11px] text-black/30 mr-2">
              <span className="w-5 h-5 grid place-items-center rounded border bg-white text-[10px]">⌘</span>
              <span className="w-5 h-5 grid place-items-center rounded border bg-white text-[10px]">K</span>
            </div>
          </div>

          {isLoading ? (
            <div className="mac-card rounded-2xl h-64 grid place-items-center">
              <RefreshCw className="animate-spin opacity-20" />
            </div>
          ) : (
            <>
              {tab === "overview" && <Overview providers={providers} combos={combos} keys={keys} allowed={allowed} endpoint={endpoint} onTab={setTab} />}
              {tab === "providers" && (
                <Providers
                  providers={filteredProviders}
                  form={providerForm}
                  setForm={setProviderForm}
                  onSave={() => {
                    const isWeb = providerForm.providerType === "chatgpt-web";
                    const ids = providerForm.modelIdsText
                      .split(/[\n,]+/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                    if (!ids.length) return toast.error("Add at least one model ID — use Fetch to populate");
                    if (isWeb && !providerForm.cookie.trim()) return toast.error("Paste ChatGPT cookie first");
                    if (!isWeb && !providerForm.apiKey && !providerForm.id) return toast.error("Enter API key");
                    saveProvider.mutate({
                      id: providerForm.id || undefined,
                      name: providerForm.name,
                      baseUrl: isWeb ? "https://chatgpt.com" : providerForm.baseUrl,
                      apiKey: isWeb ? undefined : (providerForm.apiKey || undefined),
                      modelIds: ids,
                      modelId: ids[0],
                      timeoutMs: Number(providerForm.timeoutMs) || 60000,
                      providerType: providerForm.providerType,
                      cookie: isWeb ? providerForm.cookie : undefined,
                    } as any);
                  }}
                  onEdit={(p: any) => {
                    setProviderForm({ id: p.id, name: p.name, baseUrl: p.baseUrl, apiKey: "", modelIdsText: (p.modelIds || [p.modelId]).join("\n"), timeoutMs: p.timeoutMs, providerType: p.providerType || "openai", cookie: "" });
                    setFetched(null);
                  }}
                  onDiscover={() => {
                    console.log("[SkyRoute] onDiscover click", providerForm.providerType, providerForm.cookie.slice(0,20));
                    const isWeb = providerForm.providerType === "chatgpt-web";
                    if (isWeb) {
                      if (!providerForm.cookie.trim()) return toast.error("Paste cookie first");
                      console.log("[SkyRoute] calling discoverChatGpt.mutate");
                      discoverChatGpt.mutate({ cookie: providerForm.cookie });
                      return;
                    }
                    if (!providerForm.baseUrl) return toast.error("Enter base URL");
                    if (!providerForm.apiKey) return toast.error("Enter API key to fetch");
                    discover.mutate({ baseUrl: providerForm.baseUrl, apiKey: providerForm.apiKey });
                  }}
                  fetched={fetchedFiltered}
                  fetchedSearch={fetchedSearch}
                  setFetchedSearch={setFetchedSearch}
                  onAddToAllowed={(modelId: string) => {
                    // need providerId: if editing existing, use its id, else need to save provider first
                    const pid = providerForm.id || providers.find((p) => p.baseUrl === providerForm.baseUrl)?.id;
                    if (!pid) return toast.error("Save provider first, then add models");
                    addAllowed.mutate({ providerId: pid, modelId });
                  }}
                  allowed={allowed}
                  onTest={(id: string) => testProvider.mutate({ id })}
                  onToggle={(id: string, en: boolean) => toggle.mutate({ id, enabled: en })}
                  onDelete={(id: string) => delProvider.mutate({ id })}
                  discovering={discover.isPending || discoverChatGpt.isPending}
                  showKey={showKey}
                  setShowKey={setShowKey}
                  onValidateCookie={() => {
                    if (!providerForm.cookie.trim()) return toast.error("Paste cookie first");
                    validateCookie.mutate({ cookie: providerForm.cookie });
                  }}
                  validating={validateCookie.isPending}
                  cookieCheck={cookieCheck}
                />
              )}
              {tab === "models" && <ModelsSection allowed={filteredAllowed} providers={providers} search={allowedSearch} setSearch={setAllowedSearch} onToggle={(id: string, en: boolean) => toggleAllowed.mutate({ id, enabled: en })} onRemove={(id: string) => removeAllowed.mutate({ id })} onTest={(id: string) => testAllowed.mutate({ id })} testing={testAllowed.isPending} onRefresh={() => refreshModels.mutate()} refreshing={refreshModels.isPending} />}
              {tab === "enabled" && <EnabledModelsSection allowed={allowed.filter((m: any) => m.enabled)} providers={providers} onToggle={(id: string, en: boolean) => toggleAllowed.mutate({ id, enabled: en })} onRemove={(id: string) => removeAllowed.mutate({ id })} onTest={(id: string) => testAllowed.mutate({ id })} testing={testAllowed.isPending} onRefresh={() => refreshModels.mutate()} refreshing={refreshModels.isPending} />}
              {tab === "aliases" && (
                <Aliases
                  providers={providers}
                  combos={filteredAliases}
                  form={aliasForm}
                  setForm={setAliasForm}
                  onSave={() => {
                    if (!aliasForm.name || !aliasForm.alias || !aliasForm.routes.length) return toast.error("Name, alias and at least one route required");
                    saveAlias.mutate(aliasForm);
                  }}
                  onDelete={(id: string) => delAlias.mutate({ id })}
                />
              )}
              {tab === "keys" && (
                <Keys
                  keys={keys}
                  name={keyName}
                  setName={setKeyName}
                  revealed={revealed}
                  setRevealed={setRevealed}
                  onCreate={() => {
                    if (!keyName.trim()) return toast.error("Enter key name");
                    createKey.mutate({ name: keyName });
                  }}
                  onRevoke={(id: string) => revoke.mutate({ id })}
                  endpoint={endpoint}
                />
              )}
            </>
          )}
        </main>
      </div>

      <div className="mx-auto max-w-[1280px] px-6 pb-8 text-center text-[11px] text-black/25">SkyRoute by Emon · local-only gateway · models allow-list controls /v1/models for Claude/VS Code</div>

      {testPopup?.open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 backdrop-blur-sm p-4" onClick={() => setTestPopup(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md mac-card rounded-2xl overflow-hidden">
            <div className={`px-5 py-4 flex items-center gap-3 ${testPopup.ok ? "bg-[#34C759]/10" : "bg-[#FF3B30]/10"}`}>
              {testPopup.ok ? <CheckCircle className="text-[#34C759]" size={20} /> : <AlertTriangle className="text-[#FF3B30]" size={20} />}
              <div className={`text-sm font-semibold ${testPopup.ok ? "text-[#248A3D]" : "text-[#D70015]"}`}>{testPopup.title}</div>
              <button onClick={() => setTestPopup(null)} className="ml-auto w-7 h-7 grid place-items-center rounded-full hover:bg-black/5">
                <X size={14} />
              </button>
            </div>
            <div className="p-5">
              <div className={`rounded-xl p-3 text-sm font-mono break-all ${testPopup.ok ? "bg-[#34C759]/10 text-[#1d1d1f] border border-[#34C759]/20" : "bg-[#FF3B30]/10 text-[#1d1d1f] border border-[#FF3B30]/20"}`}>{testPopup.message}</div>
              <div className="mt-3 flex justify-end gap-2">
                <button onClick={() => setTestPopup(null)} className="rounded-full bg-[#007AFF] text-white px-4 py-1.5 text-sm">
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ title, subtitle, action, children }: any) {
  return (
    <div className="mac-card rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-black/[.06] flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold">{title}</div>
          {subtitle && <div className="text-xs text-black/50">{subtitle}</div>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Overview({ providers, combos, keys, allowed, endpoint, onTab }: any) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <div className="mac-card rounded-2xl p-5">
          <div className="text-[11px] tracking-widest font-semibold text-black/30 uppercase">Providers</div>
          <div className="text-[28px] font-semibold mt-1">{providers.length}</div>
          <div className="text-xs text-black/40">{providers.filter((p: any) => p.enabled).length} enabled</div>
        </div>
        <div className="mac-card rounded-2xl p-5">
          <div className="text-[11px] tracking-widest font-semibold text-black/30 uppercase">Models</div>
          <div className="text-[28px] font-semibold mt-1">{allowed.length}</div>
          <div className="text-xs text-black/40">{allowed.filter((m: any) => m.enabled).length} exposed to /v1/models</div>
        </div>
        <div className="mac-card rounded-2xl p-5">
          <div className="text-[11px] tracking-widest font-semibold text-black/30 uppercase">Keys</div>
          <div className="text-[28px] font-semibold mt-1">{keys.length}</div>
          <div className="text-xs text-black/40">Bearer lr_…</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-5">
        <Card title="Allowed models" subtitle="Only enabled models are fetched by Claude/VS Code" action={<button onClick={() => onTab("models")} className="text-xs text-[#007AFF] font-medium">Manage →</button>}>
          <div className="space-y-2 max-h-[260px] overflow-auto pr-1">
            {allowed.length ? (
              allowed.slice(0, 6).map((m: any) => (
                <div key={m.id} className="flex items-center justify-between rounded-xl border border-black/5 bg-[#f5f5f7] px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium font-mono truncate">{m.modelId}</div>
                    <div className="font-mono text-xs text-black/40 truncate">{m.alias || "no alias"} · {providers.find((p: any) => p.id === m.providerId)?.name}</div>
                  </div>
                  <span className={`w-2 h-2 rounded-full ${m.enabled ? "bg-[#34C759]" : "bg-black/20"} ${m.enabled ? "shadow-[0_0_6px_rgba(52,199,89,.6)]" : ""}`} />
                </div>
              ))
            ) : (
              <div className="text-sm text-black/40 py-6 text-center">No models yet — fetch from provider and add</div>
            )}
          </div>
        </Card>
        <Card title="Quick start" subtitle="One base URL for Claude">
          <div className="text-sm leading-6 text-black/60">Add provider → Fetch models → Add to SkyRoute by Emon list → enable. Only enabled models appear at /v1/models for any client.</div>
          <div className="mt-3 rounded-xl bg-[#f5f5f7] border border-black/5 p-3 font-mono text-xs break-all">{endpoint}/v1</div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              ["1", "Fetch"],
              ["2", "Add"],
              ["3", "Enable"],
            ].map(([n, l]) => (
              <div key={n} className="rounded-xl bg-white border border-black/5 p-3 text-center">
                <div className="text-xs font-mono text-[#007AFF]">{n}</div>
                <div className="text-xs font-medium">{l}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card title="Aliases" subtitle="Fallback combos (optional)">
        <div className="space-y-2">
          {combos.length ? (
            combos.slice(0, 4).map((c: any) => (
              <div key={c.id} className="flex items-center justify-between rounded-xl border border-black/5 bg-[#f5f5f7] px-3 py-2">
                <div className="font-mono text-xs">/{c.alias} · {c.routes.length} routes</div>
                <span className="w-2 h-2 rounded-full bg-[#34C759]" />
              </div>
            ))
          ) : (
            <div className="text-xs text-black/40">No aliases</div>
          )}
        </div>
      </Card>
    </div>
  );
}

function Providers({ providers, form, setForm, onSave, onEdit, fetched, fetchedSearch, setFetchedSearch, onAddToAllowed, allowed, onTest, onToggle, onDelete, discovering, showKey, setShowKey, onValidateCookie, validating, cookieCheck }: any) {
  const isEdit = !!form.id;
  const isWeb = form.providerType === "chatgpt-web";
  return (
    <div className="space-y-5">
      <Card
        title={isEdit ? "Edit provider" : "Add provider"}
        subtitle={isWeb ? "ChatGPT Web — use Plus cookie to unlock gpt-5.6 without API key" : "Upstream OpenAI-compatible. OmniRoute preset included."}
        action={
          <div className="flex gap-2">
            <button
              onClick={() => setForm({ id: "", name: "OmniRoute", baseUrl: "http://localhost:20128/v1", apiKey: "", modelIdsText: "", timeoutMs: 60000, providerType: "openai", cookie: "" })}
              className="hidden sm:inline-flex rounded-full bg-black text-white px-3 py-1.5 text-xs font-medium"
            >
              Fill OmniRoute
            </button>
            <button
              onClick={() => setForm({ id: "", name: "ChatGPT Plus (Web)", baseUrl: "https://chatgpt.com", apiKey: "", modelIdsText: "", timeoutMs: 120000, providerType: "chatgpt-web", cookie: "" })}
              className="hidden sm:inline-flex rounded-full bg-[#10A37F] text-white px-3 py-1.5 text-xs font-medium"
            >
              Fill ChatGPT Web
            </button>
            <button onClick={() => setForm({ id: "", name: "", baseUrl: "http://localhost:20128/v1", apiKey: "", modelIdsText: "", timeoutMs: 60000, providerType: "openai", cookie: "" })} className="rounded-full border border-black/10 px-3 py-1.5 text-xs">
              Clear
            </button>
          </div>
        }
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="space-y-1 sm:col-span-2">
            <div className="text-xs font-medium text-black/60">Provider type</div>
            <div className="flex gap-2">
              <button onClick={() => setForm({ ...form, providerType: "openai", modelIdsText: form.providerType === "chatgpt-web" ? "" : form.modelIdsText })} className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-medium border ${!isWeb ? "bg-[#007AFF] text-white border-[#007AFF]" : "bg-white border-black/10 text-black/60"}`}>OpenAI-compatible (API key)</button>
              <button onClick={() => setForm({ ...form, providerType: "chatgpt-web", modelIdsText: "" })} className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-medium border ${isWeb ? "bg-[#10A37F] text-white border-[#10A37F]" : "bg-white border-black/10 text-black/60"}`}>ChatGPT Web (Plus cookie)</button>
            </div>
            <div className="text-[11px] text-black/40">{isWeb ? "Paste your Plus cookie — no API key needed. Unlocks gpt-5.6 etc." : "Use for OmniRoute, OpenAI, Meta etc. with API key."}</div>
          </label>

          <label className="space-y-1">
            <div className="text-xs font-medium text-black/60">Name</div>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={isWeb ? "ChatGPT Plus (Web)" : "OmniRoute"} className="mac-input w-full rounded-xl px-3 py-2.5 text-sm" />
          </label>
          <label className="space-y-1">
            <div className="text-xs font-medium text-black/60">Base URL {isWeb && <span className="text-black/30">(auto)</span>}</div>
            <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder={isWeb ? "https://chatgpt.com (auto)" : "http://localhost:20128/v1"} disabled={isWeb} className="mac-input w-full rounded-xl px-3 py-2.5 text-sm font-mono disabled:bg-black/5 disabled:text-black/40" />
          </label>

          {isWeb ? (
            <label className="space-y-1 sm:col-span-2">
              <div className="text-xs font-medium text-black/60 flex items-center justify-between">
                ChatGPT cookie — paste from Cookie Editor <button onClick={() => setShowKey(!showKey)} className="text-black/40 hover:text-black/60">{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
              </div>
              <textarea value={form.cookie} onChange={(e) => setForm({ ...form, cookie: e.target.value })} placeholder="__Secure-next-auth.session-token=eyJhbGc...  OR full Cookie header: __Secure-next-auth.session-token.0=...; __Secure-next-auth.session-token.1=...; cf_clearance=...; __cf_bm=..." className="mac-input w-full rounded-xl px-3 py-2.5 text-xs font-mono min-h-[80px]" />
              <div className="rounded-xl bg-[#F5F5F7] border border-black/5 p-3 space-y-1">
                <div className="text-[11px] font-semibold text-black/70 flex items-center gap-1"><KeyRound size={10}/> How to get cookie:</div>
                <ol className="text-[11px] text-black/50 list-decimal pl-4 space-y-0.5">
                  <li>Login to <a href="https://chatgpt.com" target="_blank" className="text-[#10A37F] underline">chatgpt.com</a> with your Plus account</li>
                  <li>Install <a href="https://chrome.google.com/webstore/detail/cookie-editor/" target="_blank" className="text-[#007AFF] underline">Cookie Editor</a> extension → open chatgpt.com → click extension → Export → Copy</li>
                  <li>Or: F12 → Application → Cookies → chatgpt.com → copy <span className="font-mono text-black/70">__Secure-next-auth.session-token</span> (+ .0/.1 if chunked) and <span className="font-mono text-black/70">cf_clearance</span></li>
                  <li>Paste full cookie header here. Tip: Network tab → any request → Copy Cookie header = best (includes cf_clearance)</li>
                </ol>
                <div className="text-[11px] text-amber-600/80">⚠️ Cookie expires in hours/days. If Test fails, re-copy fresh. Never share cookie — gives full account access.</div>
                <div className="flex gap-2 pt-1 flex-wrap items-center">
                  <button onClick={onValidateCookie} disabled={validating || !form.cookie.trim()} className="rounded-full bg-white border border-black/10 px-3 py-1.5 text-xs font-medium flex items-center gap-1 disabled:opacity-40">
                    {validating ? <RefreshCw size={12} className="animate-spin"/> : <ShieldCheck size={12}/>} Validate cookie
                  </button>
                  <span className="text-[11px] text-black/30 py-1.5">Checks /api/auth/session</span>
                  {cookieCheck && (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border ${cookieCheck.ok ? "bg-[#34C759]/10 text-[#248A3D] border-[#34C759]/20" : "bg-[#FF3B30]/10 text-[#D70015] border-[#FF3B30]/20"}`}>
                      {cookieCheck.ok ? <CheckCircle size={12}/> : <AlertTriangle size={12}/>} {cookieCheck.msg.slice(0,80)}
                    </span>
                  )}
                </div>
                {cookieCheck && !cookieCheck.ok && (
                  <div className="text-[11px] text-[#D70015] bg-[#FF3B30]/5 border border-[#FF3B30]/10 rounded-lg px-2.5 py-1.5 mt-1">{cookieCheck.msg}</div>
                )}
                {cookieCheck && cookieCheck.ok && (
                  <div className="text-[11px] text-[#248A3D] bg-[#34C759]/5 border border-[#34C759]/10 rounded-lg px-2.5 py-1.5 mt-1">{cookieCheck.msg} — now click Fetch models from ChatGPT below.</div>
                )}
              </div>
            </label>
          ) : (
            <label className="space-y-1 sm:col-span-2">
              <div className="text-xs font-medium text-black/60 flex items-center justify-between">
                API key <button onClick={() => setShowKey(!showKey)} className="text-black/40 hover:text-black/60">{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button>
              </div>
              <input type={showKey ? "text" : "password"} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-..." className="mac-input w-full rounded-xl px-3 py-2.5 text-sm font-mono" />
              <div className="text-[11px] text-black/40">Stored server-side, never shown again. Leave empty on edit to keep.</div>
            </label>
          )}

          <label className="sm:col-span-2 space-y-1">
            <div className="text-xs font-medium text-black/60 flex items-center justify-between">
              Model IDs <span className="font-mono text-[11px] text-black/40">{form.modelIdsText.split(/[\n,]+/).filter(Boolean).length} models</span>
            </div>
            <textarea value={form.modelIdsText} onChange={(e) => setForm({ ...form, modelIdsText: e.target.value })} placeholder={isWeb ? "gpt-5-6\ngpt-5-6-thinking\ngpt-5-6-pro\ngpt-5-5\ngpt-5-5-thinking" : "auto/best-coding\nauto/best-reasoning\nmuse-spark-1.2"} className="mac-input w-full rounded-xl px-3 py-2.5 text-sm font-mono min-h-[96px]" />
            <div className="flex gap-2">
              <button onClick={() => (window as any).__fetchModels ? (window as any).__fetchModels() : null} style={{ display: "none" }} />
              <button
                onClick={() => {
                  const btn = document.getElementById("fetchBtn") as any;
                  if (btn) btn.click();
                }}
                className="hidden"
              />
              <button
                onClick={() => {
                  const ev = new CustomEvent("fetchModels");
                  window.dispatchEvent(ev);
                }}
                className="hidden"
              />
              <button onClick={() => {
                  // @ts-ignore
                  if (typeof onDiscover === "function") onDiscover();
                }} disabled={discovering} className="rounded-full bg-white border border-black/10 px-3 py-1.5 text-xs font-medium flex items-center gap-1">
                {discovering ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />} {isWeb ? "Fetch models from ChatGPT (via cookie)" : "Fetch models from provider"}
              </button>
              <span className="text-xs text-black/40 py-1.5">One per line or comma</span>
            </div>
            {isWeb && <div className="text-[11px] text-black/40">Fetches curated gpt-5.6/5.5 list + live /backend-api/models via your cookie. Shows 13-18 models.</div>}
          </label>
          <label className="space-y-1">
            <div className="text-xs font-medium text-black/60">Timeout (ms)</div>
            <input type="number" value={form.timeoutMs} onChange={(e) => setForm({ ...form, timeoutMs: Number(e.target.value) })} className="mac-input w-full rounded-xl px-3 py-2.5 text-sm" />
          </label>
        </div>
        <button onClick={onSave} className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#007AFF] text-white px-5 py-2.5 text-sm font-medium shadow-sm hover:bg-[#0063CC]">
          <Plus size={14} /> {isEdit ? "Update provider" : "Add provider"}
        </button>

        {fetched && (
          <div className="mt-6 rounded-2xl border border-black/10 bg-[#f5f5f7] p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="text-sm font-semibold">Available models · {fetched.length}</div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 opacity-30" />
                  <input value={fetchedSearch} onChange={(e) => setFetchedSearch(e.target.value)} placeholder="Search model id" className="mac-input rounded-full pl-7 pr-3 py-1.5 text-xs w-[200px]" />
                </div>
                <button onClick={() => (setFetchedSearch(""), (document.activeElement as any)?.blur())} className="text-xs text-black/40">
                  Clear
                </button>
              </div>
            </div>
            <div className="max-h-[320px] overflow-auto space-y-1.5 pr-1">
              {(fetched as string[]).slice(0, 200).map((mid) => {
                const already = (allowed as any[]).some((a) => a.modelId === mid && a.providerId === (form.id || "new"));
                // also check if provider not yet saved, use baseUrl match
                const isAdded = (allowed as any[]).some((a) => a.modelId === mid);
                return (
                  <div key={mid} className="flex items-center justify-between rounded-xl bg-white border border-black/5 px-3 py-2">
                    <span className="font-mono text-xs truncate mr-2">{mid}</span>
                    {isAdded ? (
                      <span className="text-[11px] font-medium text-[#34C759] flex items-center gap-1">
                        <Check size={12} /> Added
                      </span>
                    ) : (
                      <button onClick={() => onAddToAllowed(mid)} className="rounded-full bg-[#007AFF] text-white px-3 py-1 text-xs font-medium hover:bg-[#0063CC]">
                        Add to SkyRoute by Emon
                      </button>
                    )}
                  </div>
                );
              })}
              {(fetched as string[]).length > 200 && <div className="text-xs text-black/40 text-center py-2">Showing 200 of {fetched.length} — use search</div>}
            </div>
            <div className="text-[11px] text-black/40 mt-2">Click Add to make model available in Models tab → enables exposure via /v1/models</div>
          </div>
        )}
      </Card>

      <Card title={`Providers · ${providers.length}`} subtitle="Toggle, test, edit, delete.">
        <div className="space-y-3 max-h-[640px] overflow-auto pr-1">
          {providers.length ? (
            providers.map((p: any) => (
              <div key={p.id} className="rounded-2xl border border-black/[.06] bg-white p-4 flex flex-col sm:flex-row gap-4 sm:items-center">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`w-2 h-2 rounded-full ${p.status === "healthy" ? "bg-[#34C759]" : p.status === "error" ? "bg-[#FF3B30]" : "bg-black/15"}`} />
                    <span className="font-medium text-sm truncate">{p.name}</span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full border ${p.enabled ? "bg-[#34C759]/10 text-[#248A3D] border-[#34C759]/20" : "bg-black/5 text-black/40 border-black/10"}`}>{p.enabled ? "enabled" : "disabled"}</span>
                    {p.providerType === "chatgpt-web" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#10A37F]/10 text-[#0E7A5F] border border-[#10A37F]/20 font-medium">ChatGPT Web · cookie</span>}
                    {p.providerType === "openai" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-black/5 text-black/40 border border-black/10">API</span>}
                  </div>
                  <div className="font-mono text-xs text-black/50 truncate mt-1">{p.baseUrl} · {p.modelIds.length} models · {p.timeoutMs}ms {p.hasCookie && "· cookie ✓"}</div>
                  <div className="font-mono text-[11px] text-black/40 truncate">{p.modelIds.slice(0, 3).join(", ")}{p.modelIds.length > 3 ? ` +${p.modelIds.length - 3}` : ""}</div>
                  {p.lastTestMessage && <div className="text-xs text-black/40 mt-1">{p.lastTestMessage}</div>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button onClick={() => onTest(p.id)} className="rounded-full bg-white border border-black/10 px-2.5 py-1.5 text-xs">Test</button>
                  <button onClick={() => onEdit(p)} className="rounded-full bg-white border border-black/10 px-2.5 py-1.5 text-xs flex items-center gap-1">
                    <Pencil size={12} /> Edit
                  </button>
                  <label className="flex items-center gap-1 text-xs ml-1">
                    <input type="checkbox" checked={p.enabled} onChange={(e) => onToggle(p.id, e.target.checked)} /> Enable
                  </label>
                  <button onClick={() => onDelete(p.id)} className="ml-1 w-7 h-7 grid place-items-center rounded-full hover:bg-[#FF3B30]/10 text-black/40 hover:text-[#FF3B30]">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-sm text-black/40 py-10 text-center">No providers — add OmniRoute or Meta</div>
          )}
        </div>
      </Card>
    </div>
  );
}

function ModelsSection({ allowed, providers, search, setSearch, onToggle, onRemove, onTest, testing, onRefresh, refreshing }: any) {
  const enabledOnly = allowed.filter((m: any) => m.enabled);
  const noProviders = providers.length === 0;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-xs text-black/40">{providers.length} provider(s) · {allowed.length} model(s) in SkyRoute</div>
        <button
          onClick={onRefresh}
          disabled={refreshing || noProviders}
          title={noProviders ? "Add a provider first" : "Fetch latest models from all enabled providers"}
          className="inline-flex items-center gap-1.5 rounded-full bg-white border border-black/10 px-3.5 py-1.5 text-xs font-medium hover:bg-black/[.04] disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> {refreshing ? "Refreshing…" : "Refresh models"}
        </button>
      </div>
      <Card title="Enabled for SkyRoute by Emon" subtitle="Only these models are exposed via /v1/models to Claude / VS Code. Disable or delete here." action={
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#007AFF] bg-[#007AFF]/10 px-2 py-1 rounded-full">{enabledOnly.length} enabled</span>
          <button onClick={onRefresh} disabled={refreshing || noProviders} className="inline-flex items-center gap-1 rounded-full bg-white border border-black/10 px-2.5 py-1 text-xs font-medium hover:bg-black/[.04] disabled:opacity-40">
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      }>
        {enabledOnly.length ? (
          <div className="grid sm:grid-cols-2 gap-3 max-h-[360px] overflow-auto pr-1">
            {enabledOnly.map((m: any) => {
              const p = providers.find((x: any) => x.id === m.providerId);
              return (
                <div key={m.id} className="rounded-2xl border border-[#007AFF]/20 bg-[#007AFF]/[0.04] p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <div className="font-mono text-[13px] font-semibold truncate flex-1">{m.modelId}</div>
                        <button onClick={() => copy(m.modelId)} className="shrink-0 w-6 h-6 grid place-items-center rounded-full hover:bg-black/5 text-black/30 hover:text-black/60" title="Copy model ID">
                          <Copy size={12} />
                        </button>
                      </div>
                      <div className="font-mono text-xs text-black/40 truncate">{m.alias || "no alias"} · {p?.name || "unknown"}</div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${m.status === "healthy" ? "bg-[#34C759]" : m.status === "error" ? "bg-[#FF3B30]" : "bg-black/15"}`} />
                        <span className="text-[11px] text-black/50">{m.status}</span>
                      </div>
                    </div>
                    <span className="shrink-0 w-2 h-2 rounded-full bg-[#34C759] shadow-[0_0_6px_rgba(52,199,89,.5)]" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => onToggle(m.id, false)} className="flex-1 rounded-full bg-white border border-black/10 px-3 py-1.5 text-xs font-medium hover:bg-black/5">
                      Disable
                    </button>
                    <button onClick={() => onRemove(m.id)} className="rounded-full bg-[#FF3B30]/10 text-[#D70015] border border-[#FF3B30]/20 px-3 py-1.5 text-xs font-medium hover:bg-[#FF3B30]/20">
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-black/40 py-6 text-center border border-dashed border-black/10 rounded-xl">No enabled models — enable from the list below to expose via SkyRoute by Emon</div>
        )}
      </Card>

      <Card title={`SkyRoute by Emon models · ${allowed.length}`} subtitle="All models added to SkyRoute by Emon. Each box has its own test. Enable to expose." action={
        <div className="flex items-center gap-2">
          <span className="text-xs text-black/40">{allowed.filter((m: any) => m.enabled).length} enabled</span>
          <button onClick={onRefresh} disabled={refreshing || noProviders} className="inline-flex items-center gap-1 rounded-full bg-white border border-black/10 px-2.5 py-1 text-xs font-medium hover:bg-black/[.04] disabled:opacity-40">
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      }>
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-30" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by model id, alias, provider…" className="mac-input w-full rounded-xl pl-9 pr-3 py-2 text-sm" />
          </div>
          <span className="text-xs text-black/40">{allowed.length} total</span>
        </div>
        {allowed.length ? (
          <div className="grid sm:grid-cols-2 gap-3 max-h-[720px] overflow-auto pr-1">
            {allowed.map((m: any) => {
              const p = providers.find((x: any) => x.id === m.providerId);
              return (
                <div key={m.id} className="rounded-2xl border border-black/[.06] bg-white p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <div className="font-mono text-[13px] font-semibold truncate flex-1">{m.modelId}</div>
                        <button onClick={() => copy(m.modelId)} className="shrink-0 w-6 h-6 grid place-items-center rounded-full hover:bg-black/5 text-black/30 hover:text-black/60" title="Copy model ID">
                          <Copy size={12} />
                        </button>
                      </div>
                      <div className="font-mono text-xs text-black/40 truncate">{m.alias || "no alias"} · {p?.name || "unknown provider"}</div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${m.status === "healthy" ? "bg-[#34C759]" : m.status === "error" ? "bg-[#FF3B30]" : "bg-black/15"}`} />
                        <span className="text-[11px] text-black/50">{m.status} {m.lastTestMessage ? `· ${m.lastTestMessage.slice(0, 60)}` : ""}</span>
                      </div>
                    </div>
                    <span className={`shrink-0 w-2 h-2 rounded-full ${m.enabled ? "bg-[#34C759] shadow-[0_0_6px_rgba(52,199,89,.5)]" : "bg-black/15"}`} />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button onClick={() => onTest(m.id)} disabled={testing} className="flex-1 min-w-[80px] rounded-full bg-[#007AFF] text-white px-3 py-1.5 text-xs font-medium flex items-center justify-center gap-1 hover:bg-[#0063CC] disabled:opacity-50">
                      {testing ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />} Test
                    </button>
                    <label className="flex items-center gap-1 text-xs rounded-full border border-black/10 px-2.5 py-1.5 bg-[#f5f5f7]">
                      <input type="checkbox" checked={m.enabled} onChange={(e) => onToggle(m.id, e.target.checked)} /> {m.enabled ? "Enabled" : "Disabled"}
                    </label>
                    <button onClick={() => onRemove(m.id)} className="w-7 h-7 grid place-items-center rounded-full hover:bg-[#FF3B30]/10 text-black/30 hover:text-[#FF3B30]">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-black/40 py-10 text-center">No models yet. Go to Providers → Fetch models → Add to SkyRoute by Emon</div>
        )}
      </Card>
    </div>
  );
}

function EnabledModelsSection({ allowed, providers, onToggle, onRemove, onTest, testing, onRefresh, refreshing }: any) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    if (!q) return allowed;
    const l = q.toLowerCase();
    return allowed.filter((m: any) => m.modelId.toLowerCase().includes(l) || (m.alias && m.alias.toLowerCase().includes(l)) || (providers.find((p: any) => p.id === m.providerId)?.name.toLowerCase().includes(l) ?? false));
  }, [allowed, providers, q]);
  const noProviders = providers.length === 0;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-xs text-black/40">{providers.length} provider(s) · {allowed.length} enabled model(s)</div>
        <button
          onClick={onRefresh}
          disabled={refreshing || noProviders}
          title={noProviders ? "Add a provider first" : "Fetch latest models from all enabled providers"}
          className="inline-flex items-center gap-1.5 rounded-full bg-white border border-black/10 px-3.5 py-1.5 text-xs font-medium hover:bg-black/[.04] disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> {refreshing ? "Refreshing…" : "Refresh models"}
        </button>
      </div>
      <Card title="Enabled Models" subtitle="Only these models are exposed via /v1/models to Claude / VS Code. Disable or delete to hide." action={
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#34C759] bg-[#34C759]/10 px-2 py-1 rounded-full">{allowed.length} enabled</span>
          <button onClick={onRefresh} disabled={refreshing || noProviders} className="inline-flex items-center gap-1 rounded-full bg-white border border-black/10 px-2.5 py-1 text-xs font-medium hover:bg-black/[.04] disabled:opacity-40">
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      }>
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-30" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search enabled models…" className="mac-input w-full rounded-xl pl-9 pr-3 py-2 text-sm" />
          </div>
          <span className="text-xs text-black/40">{filtered.length} shown</span>
        </div>
        {filtered.length ? (
          <div className="grid sm:grid-cols-2 gap-3 max-h-[720px] overflow-auto pr-1">
            {filtered.map((m: any) => {
              const p = providers.find((x: any) => x.id === m.providerId);
              return (
                <div key={m.id} className="rounded-2xl border border-[#007AFF]/20 bg-white p-4 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <div className="font-mono text-[13px] font-semibold truncate flex-1">{m.modelId}</div>
                        <button onClick={() => copy(m.modelId)} className="shrink-0 w-6 h-6 grid place-items-center rounded-full hover:bg-black/5 text-black/30 hover:text-black/60" title="Copy model ID">
                          <Copy size={12} />
                        </button>
                      </div>
                      <div className="font-mono text-xs text-black/40 truncate">{m.alias || "no alias"} · {p?.name || "unknown"}</div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${m.status === "healthy" ? "bg-[#34C759]" : m.status === "error" ? "bg-[#FF3B30]" : "bg-[#34C759]"}`} />
                        <span className="text-[11px] text-black/50">{m.status} {m.lastTestMessage ? `· ${m.lastTestMessage.slice(0, 50)}` : ""}</span>
                      </div>
                    </div>
                    <span className="shrink-0 w-2 h-2 rounded-full bg-[#34C759] shadow-[0_0_6px_rgba(52,199,89,.5)]" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => onTest(m.id)} disabled={testing} className="flex-1 rounded-full bg-[#007AFF] text-white px-3 py-1.5 text-xs font-medium flex items-center justify-center gap-1 hover:bg-[#0063CC] disabled:opacity-50">
                      {testing ? <RefreshCw size={12} className="animate-spin" /> : <Zap size={12} />} Test
                    </button>
                    <button onClick={() => onToggle(m.id, false)} className="flex-1 rounded-full bg-white border border-black/10 px-3 py-1.5 text-xs font-medium hover:bg-black/5">
                      Disable
                    </button>
                    <button onClick={() => onRemove(m.id)} className="w-7 h-7 grid place-items-center rounded-full hover:bg-[#FF3B30]/10 text-black/30 hover:text-[#FF3B30]">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-black/40 py-10 text-center border border-dashed border-black/10 rounded-xl">No enabled models — go to Models tab and enable</div>
        )}
      </Card>
    </div>
  );
}

function Aliases({ providers, combos, form, setForm, onSave, onDelete }: any) {
  const addRoute = (pid: string) => {
    const p = providers.find((x: any) => x.id === pid);
    if (!p || form.routes.some((r: any) => r.providerId === pid)) return;
    setForm({ ...form, routes: [...form.routes, { providerId: pid, modelId: p.modelId }] });
  };
  return (
    <div className="space-y-5">
      <Card title="Create alias" subtitle="Claude sees alias. We route to real model. Must contain opus.">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="space-y-1">
            <div className="text-xs font-medium text-black/60">Display name</div>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Muse Spark Opus" className="mac-input w-full rounded-xl px-3 py-2.5 text-sm" />
          </label>
          <label className="space-y-1">
            <div className="text-xs font-medium text-black/60">Alias (for Claude)</div>
            <input value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value.toLowerCase() })} placeholder="opus-muspark1.2" className="mac-input w-full rounded-xl px-3 py-2.5 text-sm font-mono" />
            <div className="text-[11px] text-black/40">Lower, opus required. Example: opus-auto-best-coding</div>
          </label>
        </div>
        <div className="mt-4">
          <div className="text-xs font-medium text-black/60 mb-2">Tap provider to add route (ordered fallback)</div>
          <div className="flex flex-wrap gap-1.5">
            {providers
              .filter((p: any) => p.enabled)
              .map((p: any) => (
                <button key={p.id} onClick={() => addRoute(p.id)} className="rounded-full bg-white border border-black/10 px-3 py-1.5 text-xs">
                  + {p.name} <span className="text-black/40">/ {p.modelId}</span>
                </button>
              ))}
          </div>
        </div>
        {!!form.routes.length && (
          <div className="mt-3 space-y-2">
            {form.routes.map((r: any, i: number) => {
              const prov = providers.find((p: any) => p.id === r.providerId);
              return (
                <div key={r.providerId} className="flex items-center gap-2 rounded-xl border border-black/5 bg-[#f5f5f7] px-3 py-2">
                  <span className="font-mono text-xs text-black/40">0{i + 1}</span>
                  <span className="text-sm flex-1">{prov?.name}</span>
                  <input value={r.modelId} onChange={(e) => setForm({ ...form, routes: form.routes.map((x: any) => (x.providerId === r.providerId ? { ...x, modelId: e.target.value } : x)) })} className="mac-input rounded-lg px-2 py-1 text-xs font-mono w-40" />
                  <button onClick={() => setForm({ ...form, routes: form.routes.filter((x: any) => x.providerId !== r.providerId) })} className="text-black/30 hover:text-[#FF3B30]">
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <button onClick={onSave} className="mt-4 rounded-full bg-[#007AFF] text-white px-5 py-2.5 text-sm font-medium">Save alias</button>
        <div className="mt-2 text-[11px] text-black/40">Tip: Models tab auto-exposes opus-* for each allowed model. Use alias for custom fallbacks.</div>
      </Card>

      <Card title={`Aliases · ${combos.length}`} subtitle="Visible to Claude Desktop. Virtual opus-* for OmniRoute also available.">
        <div className="space-y-2 max-h-[520px] overflow-auto pr-1">
          {combos.length ? (
            combos.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between rounded-xl border border-black/5 bg-white px-3 py-2.5">
                <div>
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="font-mono text-xs text-black/50">/{c.alias} · {c.routes.length} routes</div>
                </div>
                <button onClick={() => onDelete(c.id)} className="w-7 h-7 grid place-items-center rounded-full hover:bg-[#FF3B30]/10 text-black/30">
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          ) : (
            <div className="text-sm text-black/40 py-8 text-center">No manual aliases — virtual opus-* covers Models automatically</div>
          )}
        </div>
      </Card>
    </div>
  );
}

function Keys({ keys, name, setName, revealed, setRevealed, onCreate, onRevoke, endpoint }: any) {
  const [tab, setTab] = useState<"generic" | "claude" | "vscode">("claude");
  const snippets: any = {
    generic: `curl ${endpoint}/v1/chat/completions \\\n  -H "Authorization: Bearer YOUR_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"opus-muspark1.2","messages":[{"role":"user","content":"hi"}]}'`,
    claude: `Gateway base URL: ${endpoint}/\nGateway API key: YOUR_KEY\nGateway auth: bearer\nModel: opus-muspark1.2 (or any opus-*)`,
    vscode: `Base URL: ${endpoint}/v1\nAPI key: YOUR_KEY\nModel: opus-muspark1.2`,
  };
  return (
    <div className="space-y-5">
      <Card title="Create key" subtitle="Bearer lr_... for Claude, VS Code, curl">
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Claude Desktop" className="mac-input flex-1 rounded-xl px-3 py-2.5 text-sm" />
          <button onClick={onCreate} className="rounded-full bg-[#007AFF] text-white px-5 py-2.5 text-sm font-medium">Create</button>
        </div>
        {revealed && (
          <div className="mt-3 rounded-xl bg-[#1d1d1f] text-white p-3 flex items-center justify-between gap-3">
            <span className="font-mono text-xs break-all">{revealed}</span>
            <button onClick={() => copy(revealed)} className="shrink-0 rounded-full bg-white text-black px-3 py-1.5 text-xs flex items-center gap-1">
              <Copy size={12} /> Copy
            </button>
          </div>
        )}
        {revealed && (
          <button onClick={() => setRevealed(null)} className="mt-2 text-xs text-black/40">
            Dismiss (shown once)
          </button>
        )}
      </Card>

      <Card title={`Keys · ${keys.length}`}>
        <div className="space-y-2">
          {keys.length ? (
            keys.map((k: any) => (
              <div key={k.id} className="flex items-center justify-between rounded-xl border border-black/5 bg-[#f5f5f7] px-3 py-2.5">
                <div>
                  <div className="text-sm font-medium">{k.name}</div>
                  <div className="font-mono text-xs text-black/50">{k.prefix}… · {new Date(k.createdAt).toLocaleDateString()}</div>
                </div>
                <button onClick={() => onRevoke(k.id)} className="rounded-full bg-white border border-black/10 px-3 py-1.5 text-xs hover:bg-[#FF3B30]/10 hover:text-[#FF3B30] hover:border-[#FF3B30]/20">
                  Revoke
                </button>
              </div>
            ))
          ) : (
            <div className="text-sm text-black/40 py-6 text-center">No keys</div>
          )}
        </div>
      </Card>

      <Card title="Connect">
        <div className="flex gap-1.5 mb-3">
          {(["claude", "generic", "vscode"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-full px-3 py-1.5 text-xs font-medium border ${tab === t ? "bg-[#007AFF] text-white border-[#007AFF]" : "bg-white border-black/10"}`}>
              {t === "claude" ? "Claude" : t === "vscode" ? "VS Code" : "curl"}
            </button>
          ))}
        </div>
        <pre className="rounded-xl bg-[#1d1d1f] text-[#f5f5f7] p-3 text-xs font-mono whitespace-pre-wrap break-all">{snippets[tab].replace("YOUR_KEY", revealed || "lr_...")}</pre>
        <div className="mt-2 text-xs text-black/40 flex items-center gap-1">
          <ShieldCheck size={12} /> Local-only gateway · no cloud
        </div>
      </Card>
    </div>
  );
}
