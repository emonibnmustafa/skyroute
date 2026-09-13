import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import type { Request, Response } from "express";
import { resolveRoutes, listProviders, getProviderRaw, logUsage, estimateTokens } from "./gatewayStore";

const toolRegistry = new Map<string, { name: string; namespace?: string }>();
const reverseToolRegistry = new Map<string, string>();

// Pre-populate core AnyCodex CUA tools so translation is always reliable
toolRegistry.set("cua_repl__js", { name: "js", namespace: "mcp__cua_repl" });
toolRegistry.set("cua_repl__js_reset", { name: "js_reset", namespace: "mcp__cua_repl" });
toolRegistry.set("cua_repl__turn_ended", { name: "turn_ended", namespace: "mcp__cua_repl" });
reverseToolRegistry.set("mcp__cua_repl::js", "cua_repl__js");
reverseToolRegistry.set("cua_repl::js", "cua_repl__js");
reverseToolRegistry.set("js", "cua_repl__js");
reverseToolRegistry.set("mcp__cua_repl::js_reset", "cua_repl__js_reset");
reverseToolRegistry.set("cua_repl::js_reset", "cua_repl__js_reset");
reverseToolRegistry.set("js_reset", "cua_repl__js_reset");
reverseToolRegistry.set("mcp__cua_repl::turn_ended", "cua_repl__turn_ended");
reverseToolRegistry.set("cua_repl::turn_ended", "cua_repl__turn_ended");
reverseToolRegistry.set("turn_ended", "cua_repl__turn_ended");

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

function hasTopLevelReturn(code: string): boolean {
  if (!code || typeof code !== "string") return false;
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    const nextChar = code[i + 1];

    if (inLineComment) {
      if (char === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingleQuote) {
      if (char === "\\") { i++; continue; }
      if (char === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (char === "\\") { i++; continue; }
      if (char === '"') inDoubleQuote = false;
      continue;
    }
    if (inTemplate) {
      if (char === "\\") { i++; continue; }
      if (char === "`") inTemplate = false;
      continue;
    }

    if (char === "/" && nextChar === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (char === "/" && nextChar === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (char === "'") { inSingleQuote = true; continue; }
    if (char === '"') { inDoubleQuote = true; continue; }
    if (char === "`") { inTemplate = true; continue; }

    if (char === "{") {
      depth++;
      continue;
    }
    if (char === "}") {
      if (depth > 0) depth--;
      continue;
    }

    if (depth === 0) {
      if (code.slice(i, i + 6) === "return") {
        const prev = i > 0 ? code[i - 1] : " ";
        const next = i + 6 < code.length ? code[i + 6] : " ";
        if (/[\s;(){}\[\]]/.test(prev) && /[\s;(){}\[\]]/.test(next)) {
          return true;
        }
      }
    }
  }
  return false;
}

function sanitizeJsCode(code: string): string {
  if (!code || typeof code !== "string") return code;
  if (!hasTopLevelReturn(code)) return code;
  return `const _res = await (async () => {\n${code}\n})(); if (_res !== undefined && typeof nodeRepl !== "undefined") nodeRepl.write(_res);`;
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
          reverseToolRegistry.set("exec", "exec");
          reverseToolRegistry.set("::exec", "exec");
          reverseToolRegistry.set(`${origNs}::exec`, "exec");
          reverseToolRegistry.set(`${cleanNs}::exec`, "exec");
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
          reverseToolRegistry.set(`${origNs}::${inner.name}`, metaName);
          reverseToolRegistry.set(`${cleanNs}::${inner.name}`, metaName);
          reverseToolRegistry.set(inner.name, metaName);

          let desc = inner.description || inner.name || "tool function";
          if (inner.name === "js" && (cleanNs === "cua_repl" || origNs.includes("cua_repl"))) {
            desc = "UI automation through a persistent JavaScript session using the initialized CUA API. Examples: 'await cua.listApps()', 'let app = await cua.getApp(\"App Name\")', 'await app.getAXState()', 'await app.click(\"target\")'. Runs in Node REPL with top-level await.";
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
      reverseToolRegistry.set("exec", "exec");
      reverseToolRegistry.set("::exec", "exec");
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
      reverseToolRegistry.set(t.name, cleanName);
      reverseToolRegistry.set(`::${t.name}`, cleanName);
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
      const toolName = item.name || "exec";
      let args = "{}";
      if (typeof item.input === "string") {
        args = JSON.stringify({ code: item.input });
      } else if (item.input !== undefined) {
        args = JSON.stringify(item.input);
      }
      translated.push({
        type: "function_call",
        id: (item.id || `call_${Date.now()}`).replace(/:/g, "_"),
        call_id: (item.call_id || item.id || `call_${Date.now()}`).replace(/:/g, "_"),
        name: toolName,
        arguments: args
      });
    } else if (item.type === "custom_tool_call_output") {
      let outputStr = "";
      if (typeof item.output === "string") {
        outputStr = item.output;
      } else if (Array.isArray(item.output)) {
        outputStr = item.output
          .map((part: any) => (typeof part === "string" ? part : part?.text || JSON.stringify(part)))
          .join("\n");
      } else if (item.output !== undefined) {
        outputStr = JSON.stringify(item.output);
      }
      translated.push({
        type: "function_call_output",
        call_id: (item.call_id || "").replace(/:/g, "_"),
        output: outputStr
      });
    } else if (item.type === "function_call") {
      const cloned = { ...item };
      if (typeof cloned.id === "string" && cloned.id.includes(":")) {
        cloned.id = cloned.id.replace(/:/g, "_");
      }
      if (typeof cloned.call_id === "string" && cloned.call_id.includes(":")) {
        cloned.call_id = cloned.call_id.replace(/:/g, "_");
      }

      // Map AnyCodex tool name + namespace back to Meta's flat tool name
      const origNs = cloned.namespace || "";
      let cleanNs = origNs;
      if (cleanNs.startsWith("mcp__")) cleanNs = cleanNs.slice(5);
      cleanNs = cleanToolName(cleanNs);

      let targetName = cloned.name;
      if (reverseToolRegistry.has(`${origNs}::${cloned.name}`)) {
        targetName = reverseToolRegistry.get(`${origNs}::${cloned.name}`)!;
      } else if (reverseToolRegistry.has(`${cleanNs}::${cloned.name}`)) {
        targetName = reverseToolRegistry.get(`${cleanNs}::${cloned.name}`)!;
      } else if (cleanNs && !cloned.name.startsWith(cleanNs)) {
        targetName = getUniqueMetaToolName(`${cleanNs}__${cleanToolName(cloned.name)}`);
      } else if (reverseToolRegistry.has(cloned.name)) {
        targetName = reverseToolRegistry.get(cloned.name)!;
      }

      cloned.name = targetName;
      delete cloned.namespace;

      // Guarantee arguments is a valid JSON string representing an object
      if (typeof cloned.arguments !== "string" || !cloned.arguments.trim()) {
        cloned.arguments = "{}";
      } else {
        try {
          JSON.parse(cloned.arguments);
        } catch {
          cloned.arguments = "{}";
        }
      }
      translated.push(cloned);
    } else if (item.type === "function_call_output") {
      const cloned = { ...item };
      if (typeof cloned.call_id === "string" && cloned.call_id.includes(":")) {
        cloned.call_id = cloned.call_id.replace(/:/g, "_");
      }
      if (Array.isArray(cloned.output)) {
        cloned.output = cloned.output
          .map((part: any) => (typeof part === "string" ? part : part?.text || JSON.stringify(part)))
          .join("\n");
      } else if (typeof cloned.output !== "string" && cloned.output !== undefined && cloned.output !== null) {
        cloned.output = JSON.stringify(cloned.output);
      } else if (cloned.output === undefined || cloned.output === null) {
        cloned.output = "";
      }
      translated.push(cloned);
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
        item.input = sanitizeJsCode(parsed.code || item.arguments);
      } catch {
        item.input = sanitizeJsCode(item.arguments);
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
    } else if (item.name.includes("__")) {
      const idx = item.name.lastIndexOf("__");
      let ns = item.name.slice(0, idx);
      const name = item.name.slice(idx + 2);
      if (!ns.startsWith("mcp__")) {
        ns = "mcp__" + ns;
      }
      item.namespace = ns;
      item.name = name;
    } else if (item.name === "js" || item.name === "js_reset" || item.name === "turn_ended") {
      item.namespace = "mcp__cua_repl";
    }
  }

  // Also sanitize code in function_call arguments (for js and other tools)
  if (typeof item.arguments === "string" && item.arguments.trim()) {
    try {
      const parsed = JSON.parse(item.arguments);
      if (typeof parsed.code === "string") {
        parsed.code = sanitizeJsCode(parsed.code);
        item.arguments = JSON.stringify(parsed);
      }
    } catch {}
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
        console.error(`[ResponsesHandler] Upstream error: status=${proxyRes.statusCode}`);
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
                      payload.item.input = sanitizeJsCode(p.code || payload.item.arguments);
                    } catch {
                      payload.item.input = sanitizeJsCode(payload.item.arguments);
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
                      payload.input = sanitizeJsCode(p.code || payload.arguments);
                    } catch {
                      payload.input = sanitizeJsCode(payload.arguments);
                    }
                    delete payload.arguments;
                  }
                }
              } else if (payload.type === "response.function_call_arguments.done") {
                if (typeof payload.arguments === "string" && payload.arguments.trim()) {
                  try {
                    const p = JSON.parse(payload.arguments);
                    if (typeof p.code === "string") {
                      p.code = sanitizeJsCode(p.code);
                      payload.arguments = JSON.stringify(p);
                    }
                  } catch {}
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
