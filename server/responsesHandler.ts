import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import type { Request, Response } from "express";
import { resolveRoutes, listProviders, getProviderRaw, logUsage, estimateTokens } from "./gatewayStore";

const toolRegistry = new Map<string, { name: string; namespace?: string }>();

function cleanToolName(str: string): string {
  return (str || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getUniqueMetaToolName(rawName: string): string {
  let name = cleanToolName(rawName);
  if (name.length > 64) {
    const hash = crypto.createHash("md5").update(name).digest("hex").slice(0, 8);
    name = `${name.slice(0, 55)}_${hash}`;
  }
  return name;
}

function sanitizeSchema(schema: any, isTopLevel = false): any {
  if (!schema || typeof schema !== "object") return schema;

  delete schema.$schema;
  delete schema.$id;
  delete schema.not;

  if (Array.isArray(schema.oneOf)) {
    schema.anyOf = schema.oneOf;
    delete schema.oneOf;
  }

  if (isTopLevel) {
    if (Array.isArray(schema.allOf)) {
      for (const sub of schema.allOf) {
        if (sub && typeof sub === "object") {
          if (sub.properties) {
            schema.properties = { ...(schema.properties || {}), ...sub.properties };
          }
          if (Array.isArray(sub.required)) {
            schema.required = [...(schema.required || []), ...sub.required];
          }
        }
      }
      delete schema.allOf;
    }

    if (Array.isArray(schema.anyOf)) {
      for (const sub of schema.anyOf) {
        if (sub && typeof sub === "object" && (sub.type === "object" || sub.properties)) {
          schema.properties = { ...(schema.properties || {}), ...(sub.properties || {}) };
          if (Array.isArray(sub.required)) {
            schema.required = [...(schema.required || []), ...sub.required];
          }
        }
      }
      delete schema.anyOf;
    }

    delete schema.enum;
  }

  if (schema.type === "object" || schema.properties) {
    schema.type = "object";
    if (schema.properties && typeof schema.properties === "object") {
      const propKeys = Object.keys(schema.properties);
      if (!Array.isArray(schema.required)) {
        schema.required = [];
      }
      for (const key of propKeys) {
        if (!schema.required.includes(key)) {
          schema.required.push(key);
        }
      }
      schema.additionalProperties = false;
      for (const val of Object.values(schema.properties)) {
        sanitizeSchema(val, false);
      }
    } else {
      schema.properties = {};
      schema.required = [];
      schema.additionalProperties = false;
    }
  } else if (schema.type === "array") {
    if (schema.items) {
      sanitizeSchema(schema.items, false);
    } else {
      schema.items = { type: "string" };
    }
  }

  if (Array.isArray(schema.anyOf)) schema.anyOf.forEach((s: any) => sanitizeSchema(s, false));
  if (Array.isArray(schema.allOf)) schema.allOf.forEach((s: any) => sanitizeSchema(s, false));
  return schema;
}

function sanitizeToolParams(params: any): any {
  if (!params || typeof params !== "object") {
    return { type: "object", properties: {}, required: [], additionalProperties: false };
  }
  sanitizeSchema(params, true);
  if (params.type !== "object") params.type = "object";
  if (!params.properties || typeof params.properties !== "object") params.properties = {};
  if (!Array.isArray(params.required)) params.required = [];
  params.additionalProperties = false;
  return params;
}

function buildMetaTools(rawTools: any[], rawInputs: any[]): any[] {
  const allRaw = Array.isArray(rawTools) ? [...rawTools] : [];
  if (Array.isArray(rawInputs)) {
    for (const item of rawInputs) {
      if (item && item.type === "additional_tools" && Array.isArray(item.tools)) {
        allRaw.push(...item.tools);
      }
    }
  }

  const seenNames = new Set<string>();
  const metaTools: any[] = [];

  function addTool(tool: any) {
    if (!tool || !tool.name) return;
    if (tool.name.length > 64) {
      tool.name = getUniqueMetaToolName(tool.name);
    }
    if (seenNames.has(tool.name)) return;
    seenNames.add(tool.name);
    metaTools.push(tool);
  }

  for (const t of allRaw) {
    if (!t) continue;
    if (t.type === "namespace" && Array.isArray(t.tools)) {
      const origNs = t.name || "";
      let cleanNs = origNs;
      if (cleanNs.startsWith("mcp__")) {
        cleanNs = cleanNs.slice(5);
      }
      cleanNs = cleanToolName(cleanNs);
      const codexNs = origNs.startsWith("mcp__") ? origNs : (origNs ? `mcp__${origNs}` : "");

      for (const inner of t.tools) {
        if (!inner || !inner.name) continue;
        if (inner.name === "exec") {
          toolRegistry.set("exec", { name: "exec", namespace: undefined });
          addTool({
            type: "function",
            name: "exec",
            description: inner.description || "Run JavaScript code to orchestrate/compose tool calls.",
            parameters: {
              type: "object",
              properties: {
                code: { type: "string", description: "Raw JavaScript code to execute." }
              },
              required: ["code"],
              additionalProperties: false
            },
            strict: false
          });
        } else {
          const innerClean = cleanToolName(inner.name);
          const rawMetaName = cleanNs ? `${cleanNs}__${innerClean}` : innerClean;
          const metaName = getUniqueMetaToolName(rawMetaName);
          toolRegistry.set(metaName, {
            name: inner.name,
            namespace: codexNs
          });

          let desc = inner.description || inner.name || "tool function";
          if (inner.name === "js" && (cleanNs === "cua_repl" || origNs.includes("cua_repl"))) {
            desc = "UI automation through a persistent JavaScript session using the initialized CUA API.";
          }

          addTool({
            type: "function",
            name: metaName,
            description: desc,
            parameters: sanitizeToolParams(inner.parameters || { type: "object", properties: {} }),
            strict: false
          });
        }
      }
    } else if (t.name === "exec") {
      toolRegistry.set("exec", { name: "exec", namespace: undefined });
      addTool({
        type: "function",
        name: "exec",
        description: t.description || "Run JavaScript code to orchestrate/compose tool calls.",
        parameters: {
          type: "object",
          properties: {
            code: { type: "string", description: "Raw JavaScript code to execute." }
          },
          required: ["code"],
          additionalProperties: false
        },
        strict: false
      });
    } else {
      const rawCleanName = cleanToolName(t.name || "tool");
      const cleanName = getUniqueMetaToolName(rawCleanName);
      toolRegistry.set(cleanName, {
        name: t.name,
        namespace: undefined
      });
      addTool({
        type: "function",
        name: cleanName,
        description: t.description || t.name || "tool function",
        parameters: sanitizeToolParams(t.parameters || { type: "object", properties: {} }),
        strict: false
      });
    }
  }
  return metaTools;
}

function translateInputs(inputs: any[]): any[] {
  if (!Array.isArray(inputs)) return [];
  const translated: any[] = [];

  for (const item of inputs) {
    if (!item) continue;
    if (item.type === "additional_tools") continue;

    if (item.type === "custom_tool_call") {
      const toolName = item.name || "custom_tool";
      let args = "{}";
      if (typeof item.input === "string") {
        args = JSON.stringify({ code: item.input });
      } else if (item.input !== undefined) {
        args = JSON.stringify(item.input);
      }
      translated.push({
        type: "function_call",
        id: item.id || `call_${Date.now()}`,
        call_id: item.call_id || item.id || `call_${Date.now()}`,
        name: toolName,
        arguments: args
      });
    } else if (item.type === "custom_tool_call_output") {
      let outputStr = "";
      if (typeof item.output === "string") {
        outputStr = item.output;
      } else if (item.output !== undefined) {
        outputStr = JSON.stringify(item.output);
      }
      translated.push({
        type: "function_call_output",
        call_id: item.call_id || "",
        output: outputStr
      });
    } else {
      translated.push(item);
    }
  }
  return translated;
}

function transformItem(item: any) {
  if (!item || typeof item !== "object") return;

  if (item.type === "function_call" && item.name === "exec") {
    item.type = "custom_tool_call";
    if (typeof item.id === "string" && item.id.includes(":")) {
      item.id = item.id.replace(/:/g, "_");
    }
    if (typeof item.call_id === "string" && item.call_id.includes(":")) {
      item.call_id = item.call_id.replace(/:/g, "_");
    }
    delete item.namespace;
    if (item.arguments !== undefined) {
      try {
        const parsed = JSON.parse(item.arguments);
        item.input = parsed.code || item.arguments;
      } catch {
        item.input = item.arguments;
      }
      delete item.arguments;
    } else if (item.input === undefined) {
      item.input = "";
    }
    return;
  }

  if (typeof item.name === "string") {
    if (toolRegistry.has(item.name)) {
      const entry = toolRegistry.get(item.name)!;
      item.name = entry.name;
      if (entry.namespace) {
        item.namespace = entry.namespace;
      } else {
        delete item.namespace;
      }
      return;
    }

    if (item.name.includes("__")) {
      const idx = item.name.lastIndexOf("__");
      let ns = item.name.slice(0, idx);
      const name = item.name.slice(idx + 2);
      if (!ns.startsWith("mcp__")) {
        ns = "mcp__" + ns;
      }
      item.namespace = ns;
      item.name = name;
    }
  }

  if (typeof item.id === "string" && item.id.includes(":")) {
    item.id = item.id.replace(/:/g, "_");
  }
  if (typeof item.call_id === "string" && item.call_id.includes(":")) {
    item.call_id = item.call_id.replace(/:/g, "_");
  }
}

function transformPayload(payload: any) {
  if (!payload || typeof payload !== "object") return;
  if (typeof payload.id === "string" && payload.id.includes(":")) {
    payload.id = payload.id.replace(/:/g, "_");
  }
  if (typeof payload.item_id === "string" && payload.item_id.includes(":")) {
    payload.item_id = payload.item_id.replace(/:/g, "_");
  }
  if (payload.item) transformItem(payload.item);
  if (payload.response && Array.isArray(payload.response.output)) {
    for (const item of payload.response.output) transformItem(item);
  }
}

export async function handleResponsesRequest(req: Request, res: Response) {
  const startedAt = Date.now();
  const body = (req.body ?? {}) as Record<string, any>;
  let requestedModel = typeof body.model === "string" ? body.model : "muse-spark-1.3-contributor";

  // 1. Resolve Provider from SkyRoute's store
  let targetBaseUrl = "https://api.meta.ai";
  let targetApiKey = "";
  let targetModel = requestedModel;

  const routes = await resolveRoutes(requestedModel);
  if (routes && routes.length > 0 && routes[0].provider) {
    const p = routes[0].provider;
    targetBaseUrl = p.baseUrl.replace(/\/v1\/?$/, "");
    targetApiKey = p.apiKey;
    targetModel = (routes[0] as any).model || requestedModel;
  } else {
    const allProviders = listProviders();
    const metaProv = allProviders.find(p => p.enabled && (p.name.toLowerCase().includes("meta") || p.baseUrl.includes("meta.ai")));
    const fallbackProv = metaProv || allProviders.find(p => p.enabled);
    if (fallbackProv) {
      const raw = getProviderRaw(fallbackProv.id);
      if (raw) {
        targetBaseUrl = raw.baseUrl.replace(/\/v1\/?$/, "");
        targetApiKey = raw.apiKey;
      }
    }
  }

  body.model = targetModel;
  body.tools = buildMetaTools(body.tools, body.input);
  if (Array.isArray(body.tools) && body.tools.length === 0) {
    delete body.tools;
    delete body.tool_choice;
  }
  body.input = translateInputs(body.input);

  const modifiedPayload = JSON.stringify(body);
  const targetUrl = new URL(targetBaseUrl);
  const isHttps = targetUrl.protocol === "https:";
  const client = isHttps ? https : http;
  const targetPort = targetUrl.port || (isHttps ? 443 : 80);

  const forwardPath = targetBaseUrl.includes("api.meta.ai") ? "/v1/responses" : "/v1/responses";

  const headers: Record<string, any> = {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(modifiedPayload),
    "authorization": `Bearer ${targetApiKey}`
  };

  const proxyReq = client.request(
    {
      hostname: targetUrl.hostname,
      port: targetPort,
      path: forwardPath,
      method: "POST",
      headers: headers
    },
    proxyRes => {
      const isOk = (proxyRes.statusCode ?? 500) >= 200 && (proxyRes.statusCode ?? 500) < 300;
      if (!isOk) {
        res.writeHead(proxyRes.statusCode ?? 500, {
          "content-type": proxyRes.headers["content-type"] || "application/json",
          "cache-control": "no-cache"
        });
        proxyRes.pipe(res);
        return;
      }

      const isSSE = (proxyRes.headers["content-type"] || "").includes("text/event-stream");
      res.writeHead(proxyRes.statusCode ?? 200, {
        "content-type": proxyRes.headers["content-type"] || (isSSE ? "text/event-stream" : "application/json"),
        "cache-control": "no-cache",
        "connection": "keep-alive"
      });

      if (!isSSE) {
        const resChunks: Buffer[] = [];
        proxyRes.on("data", chunk => resChunks.push(chunk));
        proxyRes.on("end", () => {
          try {
            const rawBody = Buffer.concat(resChunks).toString("utf8");
            const parsed = JSON.parse(rawBody);
            transformPayload(parsed);
            res.end(JSON.stringify(parsed));
          } catch {
            res.end(Buffer.concat(resChunks));
          }
        });
        return;
      }

      // SSE Streaming translation
      let sseBuffer = "";
      let isWithinExec = false;

      proxyRes.on("data", chunk => {
        sseBuffer += chunk.toString("utf8");
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") {
              res.write(line + "\n");
              continue;
            }
            try {
              const payload = JSON.parse(jsonStr);
              transformPayload(payload);

              if (payload.type === "response.output_item.added") {
                if (payload.item && payload.item.name === "exec") {
                  isWithinExec = true;
                  payload.item.type = "custom_tool_call";
                  delete payload.item.namespace;
                }
              } else if (payload.type === "response.output_item.done") {
                if (payload.item && (payload.item.name === "exec" || isWithinExec)) {
                  isWithinExec = false;
                  payload.item.type = "custom_tool_call";
                  delete payload.item.namespace;
                  if (payload.item.arguments !== undefined) {
                    try {
                      const p = JSON.parse(payload.item.arguments);
                      payload.item.input = p.code || payload.item.arguments;
                    } catch {
                      payload.item.input = payload.item.arguments;
                    }
                    delete payload.item.arguments;
                  }
                }
              }

              if (isWithinExec) {
                if (payload.type === "response.function_call_arguments.delta") {
                  payload.type = "response.custom_tool_call_input.delta";
                } else if (payload.type === "response.function_call_arguments.done") {
                  payload.type = "response.custom_tool_call_input.done";
                  if (payload.arguments !== undefined) {
                    try {
                      const p = JSON.parse(payload.arguments);
                      payload.input = p.code || payload.arguments;
                    } catch {
                      payload.input = payload.arguments;
                    }
                    delete payload.arguments;
                  }
                }
              }

              res.write(`data: ${JSON.stringify(payload)}\n`);
            } catch {
              res.write(line + "\n");
            }
          } else {
            res.write(line + "\n");
          }
        }
      });

      proxyRes.on("end", () => {
        if (sseBuffer) res.write(sseBuffer);
        res.end();
        logUsage({
          endpoint: "/v1/responses",
          requestedModel,
          keyPrefix: "codex",
          stream: true,
          inputTokens: 100,
          outputTokens: 100,
          estimated: true,
          latencyMs: Date.now() - startedAt,
          ok: true
        });
      });
    }
  );

  proxyReq.on("error", err => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: err.message, type: "upstream_error" } }));
    }
  });

  proxyReq.write(modifiedPayload);
  proxyReq.end();
}
