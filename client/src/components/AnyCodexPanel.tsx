import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  Zap,
  Sparkles,
  RefreshCw,
  Play,
  RotateCw,
  Square,
  Check,
  CheckCircle2,
  Copy,
  Plus,
  Trash2,
  Search,
  Settings2,
  ExternalLink,
  Bot,
  Layers,
  Cpu,
  ShieldCheck,
  Activity,
  AlertCircle
} from "lucide-react";
import { toast } from "sonner";

export default function AnyCodexPanel() {
  const utils = trpc.useUtils();
  const { data: status, isLoading: statusLoading } = trpc.anycodex.status.useQuery(undefined, {
    refetchInterval: 3000
  });
  const { data: gatewayData } = trpc.gateway.snapshot.useQuery();

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<"all" | "meta" | "skirt" | "presets">("all");
  const [showAddPreset, setShowAddPreset] = useState(false);
  const [presetForm, setPresetForm] = useState({
    id: "",
    name: "",
    model: "",
    providerId: "meta",
    providerName: "Meta Muse Spark",
    baseUrl: "http://127.0.0.1:3000/v1",
    badge: "Custom"
  });

  const applyMutation = trpc.anycodex.applyModel.useMutation({
    onSuccess: (res) => {
      utils.anycodex.status.invalidate();
      toast.success(`AnyCodex model changed to ${res.activeModel}`);
    },
    onError: (err) => toast.error(err.message)
  });

  const settingsMutation = trpc.anycodex.updateSettings.useMutation({
    onSuccess: () => {
      utils.anycodex.status.invalidate();
      toast.success("Settings updated successfully");
    },
    onError: (err) => toast.error(err.message)
  });

  const savePresetMutation = trpc.anycodex.savePreset.useMutation({
    onSuccess: () => {
      utils.anycodex.status.invalidate();
      setShowAddPreset(false);
      setPresetForm({
        id: "",
        name: "",
        model: "",
        providerId: "meta",
        providerName: "Meta Muse Spark",
        baseUrl: "http://127.0.0.1:3000/v1",
        badge: "Custom"
      });
      toast.success("Preset saved");
    },
    onError: (err) => toast.error(err.message)
  });

  const deletePresetMutation = trpc.anycodex.deletePreset.useMutation({
    onSuccess: () => {
      utils.anycodex.status.invalidate();
      toast.success("Preset removed");
    },
    onError: (err) => toast.error(err.message)
  });

  const appControlMutation = trpc.anycodex.controlApp.useMutation({
    onSuccess: (res, vars) => {
      utils.anycodex.status.invalidate();
      if (vars.action === "launch") toast.success("AnyCodex app launched");
      else if (vars.action === "restart") toast.success("AnyCodex app restarted");
      else if (vars.action === "quit") toast.success("AnyCodex app quit");
    },
    onError: (err) => toast.error(err.message)
  });

  const testRouteMutation = trpc.anycodex.testConnection.useMutation({
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    },
    onError: (err) => toast.error(err.message)
  });

  // Collect all models from SkyRoute gateway
  const availableModels = useMemo(() => {
    const list: Array<{
      id: string;
      name: string;
      providerId: string;
      providerName: string;
      category: "meta" | "skirt" | "other";
      badge: string;
    }> = [];

    const providers = gatewayData?.providers ?? [];
    for (const p of providers) {
      const isMeta = p.name.toLowerCase().includes("meta") || p.baseUrl.includes("meta.ai");
      const isSkirt = p.name.toLowerCase().includes("skirt") || p.baseUrl.includes("xkiro");

      for (const m of p.modelIds || []) {
        if (!list.some((item) => item.id === m)) {
          let badge = "Standard";
          if (isMeta) badge = "Unlimited Free";
          else if (m.includes("deepseek") || m.includes("coder")) badge = "Code Expert";
          else if (m.includes("claude") || m.includes("sonnet") || m.includes("opus")) badge = "High Reasoning";
          else if (m.includes("gpt")) badge = "OpenAI";

          list.push({
            id: m,
            name: m,
            providerId: isMeta ? "meta" : p.id,
            providerName: p.name,
            category: isMeta ? "meta" : isSkirt ? "skirt" : "other",
            badge
          });
        }
      }
    }

    return list;
  }, [gatewayData]);

  const presets = status?.presets ?? [];

  // Filtered models
  const filteredModels = useMemo(() => {
    let result = availableModels;
    if (activeCategory === "meta") {
      result = result.filter((m) => m.category === "meta");
    } else if (activeCategory === "skirt") {
      result = result.filter((m) => m.category === "skirt");
    }

    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(
        (m) =>
          m.id.toLowerCase().includes(s) ||
          m.name.toLowerCase().includes(s) ||
          m.providerName.toLowerCase().includes(s)
      );
    }
    return result;
  }, [availableModels, activeCategory, search]);

  const filteredPresets = useMemo(() => {
    if (!search.trim()) return presets;
    const s = search.toLowerCase();
    return presets.filter(
      (p) =>
        p.name.toLowerCase().includes(s) ||
        p.model.toLowerCase().includes(s) ||
        p.providerName.toLowerCase().includes(s)
    );
  }, [presets, search]);

  const activeModel = status?.activeModel || "muse-spark-1.3-contributor";
  const isRunning = status?.isAppRunning ?? false;

  return (
    <div className="space-y-6">
      {/* Top Banner / Hero Status */}
      <div className="mac-card rounded-2xl p-6 relative overflow-hidden bg-gradient-to-br from-white via-white to-blue-50/30">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#007AFF] to-[#5856D6] grid place-items-center text-white shadow-md">
                <Bot size={22} />
              </div>
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-[#1d1d1f] flex items-center gap-2">
                  AnyCodex Control Center
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                      isRunning
                        ? "bg-[#34C759]/10 text-[#248A3D] border-[#34C759]/30"
                        : "bg-black/5 text-black/50 border-black/10"
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isRunning ? "bg-[#34C759] animate-pulse" : "bg-black/30"
                      }`}
                    />
                    {isRunning ? "App Running" : "App Idle / Closed"}
                  </span>
                </h2>
                <p className="text-[13px] text-black/60">
                  Manage AnyCodex models, provider routing, and runtime settings directly from SkyRoute.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              disabled={testRouteMutation.isPending}
              onClick={() => testRouteMutation.mutate({ model: activeModel })}
              className="mac-card px-3.5 py-2 rounded-xl text-xs font-medium hover:bg-white flex items-center gap-1.5 transition text-black/80"
              title="Send a quick test request through SkyRoute"
            >
              <Activity size={14} className={testRouteMutation.isPending ? "animate-spin text-[#007AFF]" : "text-[#007AFF]"} />
              {testRouteMutation.isPending ? "Testing..." : "Test Route"}
            </button>

            {isRunning ? (
              <>
                <button
                  disabled={appControlMutation.isPending}
                  onClick={() => appControlMutation.mutate({ action: "restart" })}
                  className="mac-card px-3.5 py-2 rounded-xl text-xs font-medium hover:bg-white flex items-center gap-1.5 transition text-black/80"
                >
                  <RotateCw size={14} className={appControlMutation.isPending ? "animate-spin" : ""} />
                  Restart AnyCodex
                </button>
                <button
                  disabled={appControlMutation.isPending}
                  onClick={() => appControlMutation.mutate({ action: "quit" })}
                  className="mac-card px-3 py-2 rounded-xl text-xs font-medium hover:bg-red-50 text-red-600 border-red-200/50 flex items-center gap-1.5 transition"
                >
                  <Square size={13} />
                  Quit
                </button>
              </>
            ) : (
              <button
                disabled={appControlMutation.isPending}
                onClick={() => appControlMutation.mutate({ action: "launch" })}
                className="bg-[#007AFF] hover:bg-[#0062cc] text-white px-4 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 shadow-sm transition"
              >
                <Play size={14} />
                Launch AnyCodex
              </button>
            )}
          </div>
        </div>

        {/* Current Active Configuration Bar */}
        <div className="mt-5 pt-4 border-t border-black/[.06] grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <div className="bg-black/[.02] border border-black/[.04] rounded-xl p-3">
            <div className="text-[11px] font-medium text-black/45 uppercase tracking-wider">Active Model</div>
            <div className="text-[14px] font-semibold text-[#007AFF] truncate mt-0.5" title={activeModel}>
              {activeModel}
            </div>
          </div>
          <div className="bg-black/[.02] border border-black/[.04] rounded-xl p-3">
            <div className="text-[11px] font-medium text-black/45 uppercase tracking-wider">Active Provider</div>
            <div className="text-[14px] font-semibold text-black/80 truncate mt-0.5">
              {status?.activeProviderName || "Meta Muse Spark"}
            </div>
          </div>
          <div className="bg-black/[.02] border border-black/[.04] rounded-xl p-3">
            <div className="text-[11px] font-medium text-black/45 uppercase tracking-wider">Gateway Routing</div>
            <div className="text-[13px] font-mono text-black/70 truncate mt-0.5">
              http://127.0.0.1:3000/v1
            </div>
          </div>
          <div className="bg-black/[.02] border border-black/[.04] rounded-xl p-3 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-medium text-black/45 uppercase tracking-wider">Reasoning Effort</div>
              <div className="text-[13px] font-semibold capitalize text-black/80 mt-0.5">
                {status?.reasoningEffort || "medium"}
              </div>
            </div>
            <select
              value={status?.reasoningEffort || "medium"}
              onChange={(e) => settingsMutation.mutate({ reasoningEffort: e.target.value })}
              className="text-xs bg-white border border-black/10 rounded-lg px-2 py-1 outline-none font-medium cursor-pointer"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
      </div>

      {/* Model Browser & Quick Switching */}
      <div className="mac-card rounded-2xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <h3 className="text-base font-semibold text-[#1d1d1f] flex items-center gap-2">
              <Cpu size={18} className="text-[#007AFF]" />
              Model Switcher & Presets
            </h3>
            <p className="text-xs text-black/50 mt-0.5">
              Click &apos;Activate&apos; on any model to immediately switch AnyCodex. No terminal commands required.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/30" />
              <input
                type="text"
                placeholder="Search models..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mac-input pl-8 pr-3 py-1.5 rounded-xl text-xs w-[180px] sm:w-[220px]"
              />
            </div>

            <button
              onClick={() => setShowAddPreset(true)}
              className="mac-card hover:bg-white px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition text-[#007AFF]"
            >
              <Plus size={14} />
              Add Preset
            </button>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-1.5 border-b border-black/[.06] pb-3 mb-5 overflow-x-auto">
          {[
            { id: "all", label: `All Available (${availableModels.length})` },
            { id: "meta", label: "Meta Models (Free & Unlimited)" },
            { id: "skirt", label: "Skirt & Upstream Models" },
            { id: "presets", label: `Quick Presets (${presets.length})` }
          ].map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition whitespace-nowrap ${
                activeCategory === c.id
                  ? "bg-[#007AFF] text-white shadow-xs"
                  : "text-black/60 hover:bg-black/[.04] hover:text-black/80"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Presets View */}
        {activeCategory === "presets" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredPresets.map((p) => {
              const isCurrent = activeModel === p.model;
              return (
                <div
                  key={p.id}
                  className={`border rounded-2xl p-4 transition relative flex flex-col justify-between ${
                    isCurrent
                      ? "bg-blue-50/40 border-[#007AFF]/40 ring-1 ring-[#007AFF]/20"
                      : "bg-white/60 border-black/[.06] hover:border-black/15 hover:shadow-xs"
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/[.04] text-black/60">
                        {p.badge || "Preset"}
                      </span>
                      {!p.isSystem && (
                        <button
                          onClick={() => deletePresetMutation.mutate({ id: p.id })}
                          className="text-black/30 hover:text-red-500 p-1 transition"
                          title="Delete custom preset"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>

                    <h4 className="text-sm font-semibold text-[#1d1d1f] mt-2">{p.name}</h4>
                    <p className="text-xs font-mono text-black/55 mt-0.5 truncate" title={p.model}>
                      {p.model}
                    </p>
                    <p className="text-[11px] text-black/40 mt-1">{p.providerName}</p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-black/[.04] flex items-center justify-between">
                    {isCurrent ? (
                      <span className="text-xs font-medium text-[#007AFF] flex items-center gap-1">
                        <CheckCircle2 size={14} />
                        Currently Active
                      </span>
                    ) : (
                      <button
                        disabled={applyMutation.isPending}
                        onClick={() =>
                          applyMutation.mutate({
                            model: p.model,
                            providerId: p.providerId,
                            providerName: p.providerName,
                            baseUrl: p.baseUrl
                          })
                        }
                        className="w-full py-1.5 px-3 rounded-xl text-xs font-medium bg-[#007AFF]/10 hover:bg-[#007AFF] text-[#007AFF] hover:text-white transition flex items-center justify-center gap-1.5"
                      >
                        Activate Model
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Available Models Grid */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {filteredModels.map((m) => {
              const isCurrent = activeModel === m.id;
              return (
                <div
                  key={m.id}
                  className={`border rounded-2xl p-4 transition relative flex flex-col justify-between ${
                    isCurrent
                      ? "bg-blue-50/40 border-[#007AFF]/40 ring-1 ring-[#007AFF]/20"
                      : "bg-white/60 border-black/[.06] hover:border-black/15 hover:shadow-xs"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          m.category === "meta"
                            ? "bg-emerald-500/10 text-emerald-700 border border-emerald-500/20"
                            : "bg-black/[.04] text-black/60"
                        }`}
                      >
                        {m.badge}
                      </span>
                      <span className="text-[10px] text-black/40 uppercase tracking-wide truncate max-w-[120px]">
                        {m.providerName}
                      </span>
                    </div>

                    <h4 className="text-xs font-mono font-semibold text-[#1d1d1f] mt-2.5 truncate" title={m.name}>
                      {m.name}
                    </h4>
                  </div>

                  <div className="mt-4 pt-3 border-t border-black/[.04]">
                    {isCurrent ? (
                      <div className="py-1 px-2 rounded-lg text-xs font-medium text-[#007AFF] flex items-center justify-center gap-1 bg-blue-50">
                        <Check size={14} strokeWidth={2.5} />
                        Active in AnyCodex
                      </div>
                    ) : (
                      <button
                        disabled={applyMutation.isPending}
                        onClick={() =>
                          applyMutation.mutate({
                            model: m.id,
                            providerId: m.providerId,
                            providerName: m.providerName
                          })
                        }
                        className="w-full py-1.5 px-3 rounded-xl text-xs font-medium bg-black/[.04] hover:bg-[#007AFF] hover:text-white text-black/75 transition flex items-center justify-center gap-1.5"
                      >
                        Activate Model
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {filteredModels.length === 0 && (
              <div className="col-span-full py-12 text-center text-black/40 text-xs">
                No models found matching &apos;{search}&apos;
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Custom Preset Modal */}
      {showAddPreset && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm grid place-items-center p-4">
          <div className="mac-card bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#1d1d1f]">Add Model Preset</h3>
              <button
                onClick={() => setShowAddPreset(false)}
                className="text-black/40 hover:text-black/70 text-sm font-medium"
              >
                Cancel
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-black/60 font-medium mb-1">Preset Display Name</label>
                <input
                  type="text"
                  placeholder="e.g. DeepSeek Coder Pro"
                  value={presetForm.name}
                  onChange={(e) => setPresetForm((s) => ({ ...s, name: e.target.value }))}
                  className="mac-input w-full px-3 py-2 rounded-xl text-xs"
                />
              </div>

              <div>
                <label className="block text-black/60 font-medium mb-1">Model Name / ID</label>
                <input
                  type="text"
                  placeholder="e.g. muse-spark-1.3 or deepseek/deepseek-v4-pro"
                  value={presetForm.model}
                  onChange={(e) => setPresetForm((s) => ({ ...s, model: e.target.value }))}
                  className="mac-input w-full px-3 py-2 rounded-xl text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-black/60 font-medium mb-1">Provider ID</label>
                <input
                  type="text"
                  placeholder="meta, skirt, or custom"
                  value={presetForm.providerId}
                  onChange={(e) => setPresetForm((s) => ({ ...s, providerId: e.target.value }))}
                  className="mac-input w-full px-3 py-2 rounded-xl text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-black/60 font-medium mb-1">Base URL</label>
                <input
                  type="text"
                  placeholder="http://127.0.0.1:3000/v1"
                  value={presetForm.baseUrl}
                  onChange={(e) => setPresetForm((s) => ({ ...s, baseUrl: e.target.value }))}
                  className="mac-input w-full px-3 py-2 rounded-xl text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-black/60 font-medium mb-1">Badge Tag</label>
                <input
                  type="text"
                  placeholder="e.g. Fast, Custom, Special"
                  value={presetForm.badge}
                  onChange={(e) => setPresetForm((s) => ({ ...s, badge: e.target.value }))}
                  className="mac-input w-full px-3 py-2 rounded-xl text-xs"
                />
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowAddPreset(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-black/60 hover:bg-black/[.04]"
              >
                Cancel
              </button>
              <button
                disabled={!presetForm.name || !presetForm.model}
                onClick={() => {
                  const id = `preset-${Date.now()}`;
                  savePresetMutation.mutate({
                    ...presetForm,
                    id
                  });
                }}
                className="bg-[#007AFF] hover:bg-[#0062cc] disabled:opacity-40 text-white px-4 py-2 rounded-xl text-xs font-medium shadow-sm transition"
              >
                Save Preset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
