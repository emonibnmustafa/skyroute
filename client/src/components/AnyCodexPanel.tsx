import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  RotateCw,
  RefreshCw,
  Check,
  Search,
  Bot,
  Activity,
  Play,
  Pencil,
  Trash2,
  X,
  Plus,
  Zap,
  SlidersHorizontal
} from "lucide-react";
import { toast } from "sonner";

export default function AnyCodexPanel() {
  const utils = trpc.useUtils();
  const { data: status } = trpc.anycodex.status.useQuery(undefined, {
    refetchInterval: 3000
  });
  const { data: gatewayData } = trpc.gateway.snapshot.useQuery();
  const allowedQ = trpc.gateway.allowedModels.useQuery(undefined, {
    refetchInterval: 3000
  });

  const [search, setSearch] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Edit / Set state for top Currently Set Model box
  const [isEditingCurrentModel, setIsEditingCurrentModel] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");

  // Inline rename state for individual cards
  const [editingCardUuid, setEditingCardUuid] = useState<string | null>(null);
  const [editingCardAlias, setEditingCardAlias] = useState("");

  // Add model state
  const [showAddModelModal, setShowAddModelModal] = useState(false);
  const [newModelSelected, setNewModelSelected] = useState<{ providerId: string; modelId: string } | null>(null);
  const [newModelAlias, setNewModelAlias] = useState("");

  const handleUniversalRefresh = async () => {
    setIsRefreshing(true);
    try {
      await utils.invalidate();
      await Promise.allSettled([
        utils.gateway.snapshot.refetch(),
        utils.gateway.allowedModels.refetch(),
        utils.anycodex.status.refetch(),
        allowedQ.refetch(),
      ]);
      toast.success("SkyRoute refreshed — all data up to date");
    } catch (e: any) {
      toast.error("Refresh failed: " + (e?.message || e));
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  const applyMutation = trpc.anycodex.applyModel.useMutation({
    onSuccess: (res) => {
      utils.anycodex.status.invalidate();
      toast.success(`AnyCodex model set to: ${res.activeModel}`);
    },
    onError: (err) => toast.error(err.message)
  });

  const setAliasMutation = (trpc.gateway as any).setAllowedModelAlias.useMutation({
    onSuccess: (res: any) => {
      utils.gateway.allowedModels.invalidate();
      utils.anycodex.status.invalidate();
      allowedQ.refetch();
      toast.success("Model name updated");
    },
    onError: (err: any) => toast.error(err.message)
  });

  const toggleAllowedMutation = trpc.gateway.toggleAllowedModel.useMutation({
    onSuccess: () => {
      utils.gateway.allowedModels.invalidate();
      utils.anycodex.status.invalidate();
      allowedQ.refetch();
      toast.success("Model list updated");
    },
    onError: (err: any) => toast.error(err.message)
  });

  const removeAllowedMutation = trpc.gateway.removeAllowedModel.useMutation({
    onSuccess: () => {
      utils.gateway.allowedModels.invalidate();
      utils.anycodex.status.invalidate();
      allowedQ.refetch();
      toast.success("Model deleted");
    },
    onError: (err: any) => toast.error(err.message)
  });

  const addAllowedMutation = trpc.gateway.addAllowedModel.useMutation({
    onSuccess: () => {
      utils.gateway.allowedModels.invalidate();
      utils.anycodex.status.invalidate();
      allowedQ.refetch();
    },
    onError: (err: any) => toast.error(err.message)
  });

  const appControlMutation = trpc.anycodex.controlApp.useMutation({
    onSuccess: (res, vars) => {
      utils.anycodex.status.invalidate();
      if (vars.action === "launch") toast.success("AnyCodex app launched");
      else if (vars.action === "restart") toast.success("AnyCodex app restarted");
    },
    onError: (err) => toast.error(err.message)
  });

  const testRouteMutation = trpc.anycodex.testConnection.useMutation({
    onSuccess: (res) => {
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    },
    onError: (err) => toast.error(err.message)
  });

  // Collect ONLY enabled models from SkyRoute gateway
  const enabledModels = useMemo(() => {
    const allowed = (allowedQ.data as any[]) ?? [];
    const providers = gatewayData?.providers ?? [];
    const enabledOnly = allowed.filter((m: any) => m.enabled);

    return enabledOnly.map((m: any) => {
      const provider = providers.find((p: any) => p.id === m.providerId);
      const provName = provider?.name || "Provider";

      return {
        uuid: m.id,
        id: m.modelId,
        alias: m.alias || "",
        displayName: m.alias || m.modelId,
        rawModelId: m.modelId,
        providerId: provider?.id || "meta",
        providerName: provName,
      };
    });
  }, [allowedQ.data, gatewayData]);

  // All upstream models from providers for the "+ Add Model" option
  const allProviderModels = useMemo(() => {
    const list: Array<{ providerId: string; providerName: string; modelId: string }> = [];
    const providers = gatewayData?.providers ?? [];
    for (const p of providers) {
      for (const m of p.modelIds || []) {
        list.push({ providerId: p.id, providerName: p.name, modelId: m });
      }
    }
    return list;
  }, [gatewayData]);

  // Determine active model & active provider display
  const rawActiveModel = status?.activeModel || "muse-spark-1.3-contributor";

  const matchingEnabledModel = useMemo(() => {
    return enabledModels.find(
      (m) =>
        m.displayName.toLowerCase() === rawActiveModel.toLowerCase() ||
        m.rawModelId.toLowerCase() === rawActiveModel.toLowerCase() ||
        (m.alias && m.alias.toLowerCase() === rawActiveModel.toLowerCase())
    );
  }, [enabledModels, rawActiveModel]);

  const activeModelDisplay = matchingEnabledModel?.displayName || rawActiveModel;
  const activeProviderDisplay = matchingEnabledModel?.providerName || status?.activeProviderName || "Meta for OpenCodex";
  const isRunning = status?.isAppRunning ?? false;

  const filteredModels = useMemo(() => {
    if (!search.trim()) return enabledModels;
    const s = search.toLowerCase();
    return enabledModels.filter(
      (m) =>
        m.displayName.toLowerCase().includes(s) ||
        m.rawModelId.toLowerCase().includes(s) ||
        m.providerName.toLowerCase().includes(s)
    );
  }, [enabledModels, search]);

  return (
    <div className="space-y-6">
      {/* Top Status Card */}
      <div className="mac-card rounded-2xl p-6 bg-white shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-black/[.06]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#007AFF] to-[#5856D6] grid place-items-center text-white shadow-md">
              <Bot size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight text-[#1d1d1f]">AnyCodex</h2>
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                    isRunning
                      ? "bg-[#34C759]/10 text-[#248A3D] border-[#34C759]/30"
                      : "bg-black/5 text-black/50 border-black/10"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? "bg-[#34C759] animate-pulse" : "bg-black/30"}`} />
                  {isRunning ? "App Running" : "App Idle"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              disabled={isRefreshing}
              onClick={handleUniversalRefresh}
              className="mac-card px-3.5 py-2 rounded-xl text-xs font-medium hover:bg-black/[.03] flex items-center gap-1.5 transition text-black/80"
              title="Universal Refresh: Refresh all data across SkyRoute and AnyCodex"
            >
              <RefreshCw size={13} className={isRefreshing ? "animate-spin text-[#007AFF]" : "text-[#007AFF]"} />
              Universal Refresh
            </button>

            <button
              disabled={testRouteMutation.isPending}
              onClick={() => testRouteMutation.mutate({ model: matchingEnabledModel?.rawModelId || activeModelDisplay })}
              className="mac-card px-3.5 py-2 rounded-xl text-xs font-medium hover:bg-black/[.03] flex items-center gap-1.5 transition text-black/80"
              title="Test current model route"
            >
              <Activity size={14} className={testRouteMutation.isPending ? "animate-spin text-[#007AFF]" : "text-[#007AFF]"} />
              {testRouteMutation.isPending ? "Testing..." : "Test"}
            </button>

            {isRunning ? (
              <button
                disabled={appControlMutation.isPending}
                onClick={() => appControlMutation.mutate({ action: "restart" })}
                className="mac-card px-3.5 py-2 rounded-xl text-xs font-medium hover:bg-black/[.03] flex items-center gap-1.5 transition text-black/80"
              >
                <RotateCw size={14} className={appControlMutation.isPending ? "animate-spin" : ""} />
                Restart
              </button>
            ) : (
              <button
                disabled={appControlMutation.isPending}
                onClick={() => appControlMutation.mutate({ action: "launch" })}
                className="bg-[#007AFF] hover:bg-[#0062cc] text-white px-3.5 py-2 rounded-xl text-xs font-medium flex items-center gap-1.5 shadow-sm transition"
              >
                <Play size={14} />
                Launch AnyCodex
              </button>
            )}
          </div>
        </div>

        {/* Provider Name & Model Name Currently Set Boxes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-4">
          <div className="bg-black/[.02] border border-black/[.05] rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-black/45 uppercase tracking-wider">Provider Name</div>
            <div className="text-[15px] font-semibold text-black/85 truncate mt-0.5" title={activeProviderDisplay}>
              {activeProviderDisplay}
            </div>
          </div>

          <div className="bg-black/[.02] border border-black/[.05] rounded-xl p-3.5 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-medium text-black/45 uppercase tracking-wider">Currently Set Model</div>
              <button
                onClick={() => {
                  setCustomModelInput(activeModelDisplay);
                  setIsEditingCurrentModel((v) => !v);
                }}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#007AFF] hover:underline"
              >
                <Pencil size={11} />
                {isEditingCurrentModel ? "Close" : "Change / Edit"}
              </button>
            </div>

            <div className="text-[15px] font-semibold text-[#007AFF] truncate mt-0.5" title={activeModelDisplay}>
              {activeModelDisplay}
            </div>
          </div>
        </div>

        {/* Inline Edit/Set Model Panel */}
        {isEditingCurrentModel && (
          <div className="mt-4 p-4 rounded-xl bg-blue-50/40 border border-[#007AFF]/25 space-y-3 animate-in fade-in">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#1d1d1f]">Set Active Model for AnyCodex</span>
              <button onClick={() => setIsEditingCurrentModel(false)} className="text-black/40 hover:text-black/70">
                <X size={14} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-black/60 font-medium mb-1">Pick from Enabled Models</label>
                <select
                  value={customModelInput}
                  onChange={(e) => setCustomModelInput(e.target.value)}
                  className="mac-input w-full px-2.5 py-1.5 rounded-lg text-xs"
                >
                  <option value="">-- Select an enabled model --</option>
                  {enabledModels.map((m) => (
                    <option key={m.uuid} value={m.displayName}>
                      {m.displayName} ({m.providerName})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-black/60 font-medium mb-1">Or Type Custom Model / Alias</label>
                <input
                  type="text"
                  placeholder="e.g. spark1.3-con-anycodex"
                  value={customModelInput}
                  onChange={(e) => setCustomModelInput(e.target.value)}
                  className="mac-input w-full px-2.5 py-1.5 rounded-lg text-xs font-mono"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => {
                  applyMutation.mutate({
                    model: "muse-spark-1.3-contributor",
                    providerId: "meta",
                    providerName: "Meta for OpenCodex"
                  });
                  setIsEditingCurrentModel(false);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-black/50 hover:text-black/80 hover:bg-black/[.04]"
              >
                Reset Default
              </button>
              <button
                disabled={!customModelInput.trim() || applyMutation.isPending}
                onClick={() => {
                  const target = customModelInput.trim();
                  const found = enabledModels.find((m) => m.displayName === target || m.rawModelId === target);
                  applyMutation.mutate({
                    model: target,
                    providerId: found?.providerId || "meta",
                    providerName: found?.providerName || activeProviderDisplay
                  });
                  setIsEditingCurrentModel(false);
                }}
                className="bg-[#007AFF] hover:bg-[#0062cc] disabled:opacity-40 text-white px-4 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-xs transition"
              >
                <Check size={13} />
                Set as AnyCodex Model
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Enabled Models List */}
      <div className="mac-card rounded-2xl p-6 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[#1d1d1f]">
              Enabled Models ({enabledModels.length})
            </h3>
            <button
              onClick={() => setShowAddModelModal(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-[#007AFF]/10 hover:bg-[#007AFF] text-[#007AFF] hover:text-white transition"
            >
              <Plus size={12} />
              Add Model
            </button>
          </div>

          {enabledModels.length > 3 && (
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/30" />
              <input
                type="text"
                placeholder="Filter models..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mac-input pl-8 pr-3 py-1.5 rounded-xl text-xs w-[180px]"
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredModels.map((m) => {
            const isCurrent =
              rawActiveModel.toLowerCase() === m.displayName.toLowerCase() ||
              rawActiveModel.toLowerCase() === m.rawModelId.toLowerCase() ||
              (m.alias && rawActiveModel.toLowerCase() === m.alias.toLowerCase());

            const isEditingThisCard = editingCardUuid === m.uuid;

            return (
              <div
                key={m.uuid}
                className={`border rounded-2xl p-4 transition relative flex flex-col justify-between ${
                  isCurrent
                    ? "bg-blue-50/40 border-[#007AFF]/40 ring-1 ring-[#007AFF]/20"
                    : "bg-white/60 border-black/[.06] hover:border-black/15 hover:shadow-xs"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-black/40 font-medium uppercase tracking-wide truncate">
                      {m.providerName}
                    </span>

                    {/* Actions: Edit Name & Delete/Disable */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          if (isEditingThisCard) {
                            setEditingCardUuid(null);
                          } else {
                            setEditingCardUuid(m.uuid);
                            setEditingCardAlias(m.displayName);
                          }
                        }}
                        className="p-1 rounded-md text-black/40 hover:text-[#007AFF] hover:bg-black/[.04] transition"
                        title="Rename / Edit model alias"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Disable/Remove '${m.displayName}' from AnyCodex list?`)) {
                            toggleAllowedMutation.mutate({ id: m.uuid, enabled: false });
                          }
                        }}
                        className="p-1 rounded-md text-black/40 hover:text-red-500 hover:bg-black/[.04] transition"
                        title="Disable / Remove model"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Renamed name or Inline Edit */}
                  {isEditingThisCard ? (
                    <div className="mt-2 space-y-2">
                      <input
                        type="text"
                        value={editingCardAlias}
                        onChange={(e) => setEditingCardAlias(e.target.value)}
                        className="mac-input w-full px-2 py-1 rounded-lg text-xs font-semibold"
                        placeholder="Model name / alias"
                        autoFocus
                      />
                      <div className="flex items-center gap-1.5 justify-end">
                        <button
                          onClick={() => setEditingCardUuid(null)}
                          className="px-2 py-1 text-[11px] text-black/50 hover:bg-black/[.04] rounded"
                        >
                          Cancel
                        </button>
                        <button
                          disabled={!editingCardAlias.trim()}
                          onClick={() => {
                            const trimmed = editingCardAlias.trim();
                            setAliasMutation.mutate({ id: m.uuid, alias: trimmed });
                            // If it's currently active, also update AnyCodex config
                            if (isCurrent) {
                              applyMutation.mutate({
                                model: trimmed,
                                providerId: m.providerId,
                                providerName: m.providerName
                              });
                            }
                            setEditingCardUuid(null);
                          }}
                          className="px-2.5 py-1 text-[11px] font-medium bg-[#007AFF] text-white rounded flex items-center gap-1"
                        >
                          <Check size={11} /> Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h4 className="text-[15px] font-semibold text-[#1d1d1f] mt-1.5 truncate" title={m.displayName}>
                        {m.displayName}
                      </h4>

                      {m.alias && m.alias !== m.rawModelId && (
                        <div className="text-xs font-mono text-black/40 truncate mt-0.5" title={m.rawModelId}>
                          {m.rawModelId}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-black/[.04]">
                  {isCurrent ? (
                    <div className="py-1.5 px-3 rounded-xl text-xs font-medium text-[#007AFF] flex items-center justify-center gap-1.5 bg-blue-50">
                      <Check size={14} strokeWidth={2.5} />
                      Active in AnyCodex
                    </div>
                  ) : (
                    <button
                      disabled={applyMutation.isPending}
                      onClick={() =>
                        applyMutation.mutate({
                          model: m.alias || m.rawModelId,
                          providerId: m.providerId,
                          providerName: m.providerName
                        })
                      }
                      className="w-full py-1.5 px-3 rounded-xl text-xs font-medium bg-black/[.04] hover:bg-[#007AFF] hover:text-white text-black/75 transition flex items-center justify-center gap-1.5"
                    >
                      <Zap size={13} />
                      Set for AnyCodex
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {filteredModels.length === 0 && (
            <div className="col-span-full py-12 text-center text-black/40 text-xs">
              {enabledModels.length === 0 ? (
                <div className="space-y-2 max-w-sm mx-auto">
                  <p className="text-sm font-semibold text-black/60">No models currently enabled</p>
                  <p className="text-xs text-black/40">
                    Click &quot;Add Model&quot; above to select and enable models for AnyCodex.
                  </p>
                  <button
                    onClick={() => setShowAddModelModal(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium bg-[#007AFF] text-white shadow-xs"
                  >
                    <Plus size={13} />
                    Add Model
                  </button>
                </div>
              ) : (
                <p>No models matching &apos;{search}&apos;</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add Model Modal */}
      {showAddModelModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm grid place-items-center p-4">
          <div className="mac-card bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#1d1d1f]">Add Model to AnyCodex</h3>
              <button
                onClick={() => {
                  setShowAddModelModal(false);
                  setNewModelSelected(null);
                  setNewModelAlias("");
                }}
                className="text-black/40 hover:text-black/70 text-sm font-medium"
              >
                Cancel
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-black/60 font-medium mb-1">Select Upstream Model</label>
                <select
                  value={newModelSelected ? `${newModelSelected.providerId}::${newModelSelected.modelId}` : ""}
                  onChange={(e) => {
                    if (!e.target.value) {
                      setNewModelSelected(null);
                      return;
                    }
                    const [pid, mid] = e.target.value.split("::");
                    setNewModelSelected({ providerId: pid, modelId: mid });
                    if (!newModelAlias) setNewModelAlias(mid);
                  }}
                  className="mac-input w-full px-3 py-2 rounded-xl text-xs"
                >
                  <option value="">-- Choose a model from your providers --</option>
                  {allProviderModels.map((m) => (
                    <option key={`${m.providerId}::${m.modelId}`} value={`${m.providerId}::${m.modelId}`}>
                      {m.modelId} ({m.providerName})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-black/60 font-medium mb-1">Custom Name / Alias (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. spark1.3-con-anycodex"
                  value={newModelAlias}
                  onChange={(e) => setNewModelAlias(e.target.value)}
                  className="mac-input w-full px-3 py-2 rounded-xl text-xs font-mono"
                />
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setShowAddModelModal(false);
                  setNewModelSelected(null);
                  setNewModelAlias("");
                }}
                className="px-4 py-2 rounded-xl text-xs font-medium text-black/60 hover:bg-black/[.04]"
              >
                Cancel
              </button>
              <button
                disabled={!newModelSelected}
                onClick={async () => {
                  if (!newModelSelected) return;
                  try {
                    const added = await addAllowedMutation.mutateAsync({
                      providerId: newModelSelected.providerId,
                      modelId: newModelSelected.modelId,
                      alias: newModelAlias.trim() || undefined
                    });
                    await toggleAllowedMutation.mutateAsync({ id: added.id, enabled: true });
                    toast.success("Model added to enabled list!");
                    setShowAddModelModal(false);
                    setNewModelSelected(null);
                    setNewModelAlias("");
                  } catch (e: any) {
                    toast.error(e?.message || "Failed to add model");
                  }
                }}
                className="bg-[#007AFF] hover:bg-[#0062cc] disabled:opacity-40 text-white px-4 py-2 rounded-xl text-xs font-medium shadow-sm transition"
              >
                Add Model
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
