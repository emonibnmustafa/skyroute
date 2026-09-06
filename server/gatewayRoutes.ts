import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { authenticateClientKey, proxyChat, resolveRoutes, snapshot, getProvider, listExposedModels, listOpusAliases } from "./gatewayStore";

function bearer(req: Request) { return req.headers.authorization?.replace(/^Bearer\s+/i, "") || (req.headers["x-api-key"] as string | undefined) || (req.headers["api-key"] as string | undefined); }
function requireKey(req: Request, res: Response) { if (authenticateClientKey(bearer(req))) return true; res.status(401).json({ error: { message: "Valid bearer API key required", type: "authentication_error" } }); return false; }

function anthropicText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter((b: any) => b?.type === "text" && typeof b?.text === "string").map((b: any) => b.text).join("\n") || "";
  return "";
}

function anthropicToolsToOpenAI(tools: unknown): any[] | undefined {
  if (!Array.isArray(tools) || !tools.length) return undefined;
  return tools.map((t: any) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description || "",
      parameters: t.input_schema || t.inputSchema || { type: "object", properties: {} },
    },
  }));
}

function anthropicToolChoiceToOpenAI(choice: unknown): any {
  if (!choice) return undefined;
  if (typeof choice === "string") return choice;
  if ((choice as any).type === "auto") return "auto";
  if ((choice as any).type === "any") return "required";
  if ((choice as any).type === "tool" && (choice as any).name) return { type: "function", function: { name: (choice as any).name } };
  return undefined;
}

function toOpenAIMessages(anthBody: Record<string, unknown>): Array<any> {
  const out: Array<any> = [];
  const system = anthBody.system;
  if (typeof system === "string" && system.trim()) out.push({ role: "system", content: system });
  else if (Array.isArray(system)) {
    const sysText = anthropicText(system);
    if (sysText) out.push({ role: "system", content: sysText });
  }
  const messages = (anthBody.messages as Array<Record<string, unknown>> | undefined) ?? [];
  for (const m of messages) {
    const role = typeof m.role === "string" ? m.role : "user";
    const content = m.content;
    if (typeof content === "string") {
      out.push({ role, content });
    } else if (Array.isArray(content)) {
      const textParts: string[] = [];
      const toolCalls: any[] = [];
      let hasToolResult = false;
      for (const block of content as any[]) {
        if (block.type === "text" && typeof block.text === "string") textParts.push(block.text);
        else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
          });
        } else if (block.type === "tool_result") {
          hasToolResult = true;
          const toolContent = typeof block.content === "string" ? block.content : anthropicText(block.content);
          out.push({
            role: "tool",
            tool_call_id: block.tool_use_id,
            content: toolContent || (block.is_error ? "Error" : ""),
          });
        } else if (block.type === "image") {
          textParts.push("[image]");
        }
      }
      if (textParts.length || toolCalls.length) {
        const msg: any = { role, content: textParts.join("\n") || "" };
        if (toolCalls.length) {
          msg.tool_calls = toolCalls;
          if (!msg.content) msg.content = "";
        }
        if (!hasToolResult || textParts.length || toolCalls.length) {
          const isToolResultOnly = (content as any[]).every((b: any) => b.type === "tool_result");
          if (!isToolResultOnly) out.push(msg);
        }
      } else if ((content as any[]).length === 0) {
        out.push({ role, content: "" });
      }
    } else {
      out.push({ role, content: "" });
    }
  }
  return out;
}

function openAIToolCallsToAnthropic(toolCalls: any[]): any[] {
  return toolCalls.map((tc: any) => ({
    type: "tool_use",
    id: tc.id,
    name: tc.function?.name || tc.name || "unknown",
    input: (() => {
      try {
        return JSON.parse(tc.function?.arguments || "{}");
      } catch {
        return {};
      }
    })(),
  }));
}

function openAIReasonToAnthropic(reason: string | null | undefined): string {
  if (reason === "length") return "max_tokens";
  if (reason === "tool_calls") return "tool_use";
  if (reason === "content_filter") return "stop_sequence";
  return "end_turn";
}

export function registerGatewayRoutes(app: Express) {
  // Tolerate clients configured with a base URL that already ends in /v1
  // (e.g. Claude Desktop Gateway base URL set to http://host:3000/v1).
  // Such clients append /v1/models or /v1/messages themselves, producing
  // /v1/v1/models which previously fell through to the SPA and returned
  // HTML 200, confusing Claude with "<!doctype ..." errors.
  app.use((req, _res, next) => {
    const url = (req as any).url as string | undefined;
    if (typeof url === "string" && (url === "/v1/v1" || url.startsWith("/v1/v1/") || url.startsWith("/v1/v1?"))) {
      (req as any).url = "/v1" + url.slice("/v1/v1".length);
    }
    next();
  });
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, api-key, anthropic-version, x-anthropic-version");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.get("/health", (_req, res) => res.json({ status: "ok", service: "skyroute" }));

  app.get("/v1/models", (req, res) => {
    if (!requireKey(req, res)) return;
    const snap = snapshot() as any;
    const exposed = listExposedModels();
    if (!snap.allowedModels || snap.allowedModels.length === 0 || exposed.length === 0) {
      const { providers, combos } = snap;
      const virtualOpus = listOpusAliases();
      const providerModels = providers.filter((p: any) => p.enabled).flatMap((p: any) => p.modelIds.map((modelId: string) => ({ id: modelId, object: "model", owned_by: p.name })));
      const comboModels = combos.filter((c: any) => c.enabled).map((c: any) => ({ id: c.alias, object: "model", owned_by: "skyroute" }));
      const combined = [...providerModels, ...comboModels, ...virtualOpus, ...exposed];
      const seen = new Set<string>();
      const deduped = combined.filter((m: any) => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
      return res.json({ object: "list", data: deduped });
    }
    res.json({ object: "list", data: exposed });
  });

  app.post("/v1/messages", async (req, res) => {
    if (!requireKey(req, res)) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requestedModel = typeof body.model === "string" ? body.model : "";
    if (!requestedModel) return res.status(400).json({ type: "error", error: { type: "invalid_request_error", message: "model is required" } });
    const routes = await resolveRoutes(requestedModel);
    if (!routes.length) return res.status(404).json({ type: "error", error: { type: "not_found_error", message: `Unknown model or combo: ${requestedModel}` } });

    const isStreaming = body.stream === true;
    const openAIMessages = toOpenAIMessages(body);
    let maxTokens = typeof body.max_tokens === "number" ? body.max_tokens : 4096;
    if (maxTokens < 1024) maxTokens = 4096;
    if (maxTokens > 16000) maxTokens = 16000;
    const temperature = typeof body.temperature === "number" ? body.temperature : undefined;
    const topP = typeof body.top_p === "number" ? body.top_p : undefined;
    const tools = anthropicToolsToOpenAI((body as any).tools);
    const toolChoice = anthropicToolChoiceToOpenAI((body as any).tool_choice);

    const baseOpenAI: Record<string, unknown> = {
      messages: openAIMessages,
      max_tokens: maxTokens,
      stream: isStreaming,
    };
    if (temperature !== undefined) baseOpenAI.temperature = temperature;
    if (topP !== undefined) baseOpenAI.top_p = topP;
    if (tools) {
      (baseOpenAI as any).tools = tools;
      (baseOpenAI as any).tool_choice = toolChoice || "auto";
    }
    console.log(`[SkyRoute] /v1/messages ${requestedModel} stream=${isStreaming} msgs=${openAIMessages.length} tools=${tools?.length || 0} max_tokens=${maxTokens}`);

    let lastError = "No route attempted";
    for (const route of routes) {
      const provider: any = route.provider!;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), provider.timeoutMs);
      try {
        const isWeb = provider.providerType === "chatgpt-web";
        if (isWeb) {
          const { proxyChatGptWeb } = await import("./executors/chatgptWeb.js");
          // For web, we use proxyChatGptWeb — handle both streaming and non-streaming via single fetch then adapt to Anthropic
          // Always fetch non-streaming result then convert to Anthropic format (streaming simulated)
          const webResult: any = await proxyChatGptWeb({
            cookie: provider.cookie,
            model: route.model,
            messages: openAIMessages,
            stream: false,
            signal: controller.signal,
          });
          const choice = webResult.choices?.[0];
          const text = choice?.message?.content ?? "";
          const toolCalls = choice?.message?.tool_calls;
          const finish = choice?.finish_reason ?? "stop";
          const usage = webResult.usage ?? {};
          const inputTokens = usage.prompt_tokens ?? 0;
          const outputTokens = usage.completion_tokens ?? Math.ceil(text.length/4);

          // Mark provider healthy
          (getProvider(provider.id) as any).status = "healthy";
          (getProvider(provider.id) as any).lastTestAt = Date.now();
          (getProvider(provider.id) as any).lastTestMessage = `Route healthy for ${route.model} (chatgpt-web)`;

          if (isStreaming) {
            res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
            const heartbeat = setInterval(() => { try { res.write(`: keepalive\n\n`); } catch {} }, 15000);
            const msgId = `msg_${randomUUID().replace(/-/g, "")}`;
            res.write(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: msgId, type: "message", role: "assistant", model: requestedModel, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } })}\n\n`);
            res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`);
            if (text) {
              // Split into chunks to simulate streaming
              const chunkSize = 30;
              for (let i=0; i<text.length; i+=chunkSize) {
                const part = text.slice(i, i+chunkSize);
                res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: part } })}\n\n`);
              }
            }
            // Handle tool calls if present (chatgpt-web currently text-only, but keep)
            let nextIdx = 1;
            if (Array.isArray(toolCalls) && toolCalls.length) {
              for (const tc of toolCalls) {
                res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: nextIdx, content_block: { type: "tool_use", id: tc.id, name: tc.function?.name, input: {} } })}\n\n`);
                const args = tc.function?.arguments || "{}";
                res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: nextIdx, delta: { type: "input_json_delta", partial_json: args } })}\n\n`);
                res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: nextIdx })}\n\n`);
                nextIdx++;
              }
            }
            res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`);
            const stopReason = toolCalls?.length ? "tool_use" : openAIReasonToAnthropic(finish);
            res.write(`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } })}\n\n`);
            res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
            clearInterval(heartbeat);
            res.end();
            return;
          } else {
            let content: any[] = [];
            if (text) content.push({ type: "text", text });
            if (Array.isArray(toolCalls) && toolCalls.length) {
              for (const tc of openAIToolCallsToAnthropic(toolCalls)) content.push(tc);
            }
            if (!content.length) content = [{ type: "text", text: "" }];
            const stopReason = toolCalls?.length ? "tool_use" : openAIReasonToAnthropic(finish);
            const anthropicRes = {
              id: `msg_${randomUUID().replace(/-/g, "")}`,
              type: "message",
              role: "assistant",
              model: requestedModel,
              content,
              stop_reason: stopReason,
              stop_sequence: null,
              usage: { input_tokens: inputTokens, output_tokens: outputTokens || Math.ceil(JSON.stringify(content).length/4) },
            };
            res.json(anthropicRes);
            return;
          }
        } else {
          // OpenAI-compatible provider
          const upstreamBody = { ...baseOpenAI, model: route.model, stream: isStreaming };
          const response = await fetch(`${provider.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
            body: JSON.stringify(upstreamBody),
            signal: controller.signal,
          });
          if (!response.ok) {
            lastError = `${provider.name}: HTTP ${response.status}`;
            (getProvider(provider.id) as any).status = "error";
            (getProvider(provider.id) as any).lastFailure = lastError;
            (getProvider(provider.id) as any).lastFailureAt = Date.now();
            continue;
          }
          (getProvider(provider.id) as any).status = "healthy";
          (getProvider(provider.id) as any).lastTestAt = Date.now();
          (getProvider(provider.id) as any).lastTestMessage = `Route healthy for ${route.model}`;

          if (isStreaming) {
            res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
            const heartbeat = setInterval(() => {
              try { res.write(`: keepalive\n\n`); } catch {}
            }, 15000);
            const msgId = `msg_${randomUUID().replace(/-/g, "")}`;
            res.write(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: msgId, type: "message", role: "assistant", model: requestedModel, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } })}\n\n`);
            res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`);
            let outputTokens = 0;
            let fullText = "";
            let toolCalls: Map<number, any> = new Map();
            let hasTool = false;
            let toolIndexMap = new Map<number, number>();
            let nextAnthropicIndex = 1;
            if (response.body) {
              const reader = response.body.getReader();
              const decoder = new TextDecoder();
              let buffer = "";
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                for (const line of lines) {
                  const trimmed = line.trim();
                  if (!trimmed.startsWith("data:")) {
                    if (trimmed.startsWith(":")) { res.write(`${trimmed}\n\n`); }
                    continue;
                  }
                  const data = trimmed.replace(/^data:\s*/, "");
                  if (data === "[DONE]") break;
                  try {
                    const json = JSON.parse(data);
                    const delta = json.choices?.[0]?.delta;
                    if (delta?.content && typeof delta.content === "string" && delta.content) {
                      fullText += delta.content;
                      res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta.content } })}\n\n`);
                    }
                    if (Array.isArray(delta?.tool_calls)) {
                      for (const tc of delta.tool_calls) {
                        const idx = tc.index ?? 0;
                        if (!toolCalls.has(idx)) {
                          hasTool = true;
                          const anthIdx = nextAnthropicIndex++;
                          toolIndexMap.set(idx, anthIdx);
                          toolCalls.set(idx, { id: tc.id || `tool_${idx}`, name: tc.function?.name || "", arguments: "" });
                          res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: anthIdx, content_block: { type: "tool_use", id: tc.id || `tool_${idx}`, name: tc.function?.name || "", input: {} } })}\n\n`);
                        }
                        const entry = toolCalls.get(idx);
                        if (tc.function?.arguments) {
                          entry.arguments += tc.function.arguments;
                          res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: toolIndexMap.get(idx), delta: { type: "input_json_delta", partial_json: tc.function.arguments } })}\n\n`);
                        }
                        if (tc.id) entry.id = tc.id;
                        if (tc.function?.name) entry.name = tc.function.name;
                      }
                    }
                    if (json.usage?.completion_tokens) outputTokens = json.usage.completion_tokens;
                  } catch { }
                }
              }
              if (buffer.trim().startsWith("data:")) {
                const data = buffer.trim().replace(/^data:\s*/, "");
                if (data && data !== "[DONE]") {
                  try {
                    const json = JSON.parse(data);
                    const delta = json.choices?.[0]?.delta?.content;
                    if (typeof delta === "string" && delta) {
                      res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta } })}\n\n`);
                    }
                  } catch {}
                }
              }
            }
            clearInterval(heartbeat);
            res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`);
            for (const [idx, anthIdx] of toolIndexMap.entries()) {
              res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: anthIdx })}\n\n`);
            }
            if (!outputTokens) outputTokens = Math.ceil(fullText.length / 4) || (hasTool ? 50 : 0);
            const stopReason = hasTool ? "tool_use" : "end_turn";
            res.write(`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } })}\n\n`);
            res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
            res.end();
            return;
          } else {
            const openAI: any = await response.json();
            const choice = openAI.choices?.[0];
            const finish = choice?.finish_reason ?? null;
            const usage = openAI.usage ?? {};
            const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
            const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
            let content: any[] = [];
            const text = choice?.message?.content;
            if (text) content.push({ type: "text", text });
            const toolCalls = choice?.message?.tool_calls;
            if (Array.isArray(toolCalls) && toolCalls.length) {
              for (const tc of openAIToolCallsToAnthropic(toolCalls)) content.push(tc);
            }
            if (!content.length) content = [{ type: "text", text: "" }];
            const stopReason = toolCalls?.length ? "tool_use" : openAIReasonToAnthropic(finish);
            const anthropicRes = {
              id: `msg_${randomUUID().replace(/-/g, "")}`,
              type: "message",
              role: "assistant",
              model: requestedModel,
              content,
              stop_reason: stopReason,
              stop_sequence: null,
              usage: { input_tokens: inputTokens, output_tokens: outputTokens || Math.ceil(JSON.stringify(content).length / 4) },
            };
            res.json(anthropicRes);
            return;
          }
        }
      } catch (error) {
        lastError = `${provider.name}: ${error instanceof Error ? error.message : "request failed"}`;
        (getProvider(provider.id) as any).status = "error";
        (getProvider(provider.id) as any).lastFailure = lastError;
        (getProvider(provider.id) as any).lastFailureAt = Date.now();
      } finally {
        clearTimeout(timeout);
      }
    }
    if (!res.headersSent) res.status(502).json({ type: "error", error: { type: "api_error", message: `All routes failed. ${lastError}` } });
    else res.end();
  });

  app.post("/v1/chat/completions", async (req, res) => {
    if (!requireKey(req, res)) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const model = typeof body.model === "string" ? body.model : "";
    if (!model) return res.status(400).json({ error: { message: "model is required", type: "invalid_request_error" } });
    const routes = await resolveRoutes(model);
    if (!routes.length) return res.status(404).json({ error: { message: `Unknown model or combo: ${model}`, type: "invalid_request_error" } });
    const streaming = body.stream === true;
    try {
      if (streaming) {
        res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        await proxyChat(model, body, chunk => res.write(Buffer.from(chunk)));
        res.end();
      } else {
        res.json(await proxyChat(model, body));
      }
    } catch (error) {
      if (!res.headersSent) res.status(502).json({ error: { message: error instanceof Error ? error.message : "Upstream request failed", type: "upstream_error" } });
      else res.end();
    }
  });

  // Unknown /v1/* paths must return JSON, never the SPA HTML fallback.
  // Otherwise API clients (Claude Desktop) report confusing
  // "content-type html, body is an HTML page" errors with HTTP 200.
  app.all("/v1/*", (req, res) => {
    res.status(404).json({
      type: "error",
      error: {
        type: "not_found_error",
        message: `Unknown gateway path: ${req.path}. Expected /v1/models, /v1/messages, or /v1/chat/completions. If Claude shows /v1/v1/... in its error, remove the trailing /v1 from the Gateway base URL.`,
      },
    });
  });
}
