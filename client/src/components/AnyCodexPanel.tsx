import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  RotateCw,
  Check,
  Search,
  Bot,
  Activity,
  Play
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

  const applyMutation = trpc.anycodex.applyModel.useMutation({
    onSuccess: (res) => {
      utils.anycodex.status.invalidate();
      toast.success(`AnyCodex model changed to ${res.activeModel}`);
    },
    onError: (err) => toast.error(err.message)
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
        id: m.modelId,
        alias: m.alias || "",
        displayName: m.alias || m.modelId,
        rawModelId: m.modelId,
        providerId: provider?.id || "meta",
        providerName: provName,
      };
    });
  }, [allowedQ.data, gatewayData]);

  // Determine active model & active provider display
  const rawActiveModel = status?.activeModel || "muse-spark-1.3-contributor";

  // Look up if currently active model matches any enabled model's alias or id
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
      {/* Top Status Card: Only Provider name, Model name currently set, Test and Restart options */}
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

        {/* ONLY Provider Name & Model Name currently set */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-4">
          <div className="bg-black/[.02] border border-black/[.05] rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-black/45 uppercase tracking-wider">Provider Name</div>
            <div className="text-[15px] font-semibold text-black/85 truncate mt-0.5" title={activeProviderDisplay}>
              {activeProviderDisplay}
            </div>
          </div>

          <div className="bg-black/[.02] border border-black/[.05] rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-black/45 uppercase tracking-wider">Currently Set Model</div>
            <div className="text-[15px] font-semibold text-[#007AFF] truncate mt-0.5" title={activeModelDisplay}>
              {activeModelDisplay}
            </div>
          </div>
        </div>
      </div>

      {/* Enabled Models List: Showing renamed names */}
      <div className="mac-card rounded-2xl p-6 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h3 className="text-sm font-semibold text-[#1d1d1f]">
            Enabled Models ({enabledModels.length})
          </h3>

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

            return (
              <div
                key={m.id + (m.alias || "")}
                className={`border rounded-2xl p-4 transition relative flex flex-col justify-between ${
                  isCurrent
                    ? "bg-blue-50/40 border-[#007AFF]/40 ring-1 ring-[#007AFF]/20"
                    : "bg-white/60 border-black/[.06] hover:border-black/15 hover:shadow-xs"
                }`}
              >
                <div>
                  <div className="text-[11px] text-black/40 font-medium uppercase tracking-wide truncate">
                    {m.providerName}
                  </div>

                  {/* Renamed name shown prominently */}
                  <h4 className="text-[15px] font-semibold text-[#1d1d1f] mt-1.5 truncate" title={m.displayName}>
                    {m.displayName}
                  </h4>

                  {/* If renamed, show original model id as subtitle */}
                  {m.alias && m.alias !== m.rawModelId && (
                    <div className="text-xs font-mono text-black/40 truncate mt-0.5" title={m.rawModelId}>
                      {m.rawModelId}
                    </div>
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
                      Activate Model
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {filteredModels.length === 0 && (
            <div className="col-span-full py-12 text-center text-black/40 text-xs">
              {enabledModels.length === 0 ? (
                <div className="space-y-1.5 max-w-sm mx-auto">
                  <p className="text-sm font-semibold text-black/60">No models currently enabled</p>
                  <p className="text-xs text-black/40">
                    Go to the &quot;Models&quot; tab in the sidebar and enable models to make them available here.
                  </p>
                </div>
              ) : (
                <p>No models matching &apos;{search}&apos;</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
