import { createHash, randomUUID, randomBytes } from "node:crypto";
import { sha3_512Hex } from "../utils/sha3-512.js";
import { tlsFetchChatGpt, tlsFetchChatGptStream } from "../services/chatgptTlsClient.js";
import { MODEL_MAP, resolveChatGptModel } from "./chatgptWebModels.js";

const CHATGPT_BASE = "https://chatgpt.com";
const SESSION_URL = `${CHATGPT_BASE}/api/auth/session`;
const CONV_URL = `${CHATGPT_BASE}/backend-api/f/conversation`;
const SENTINEL_PREPARE_URL = `${CHATGPT_BASE}/backend-api/sentinel/chat-requirements/prepare`;
const SENTINEL_CR_URL = `${CHATGPT_BASE}/backend-api/sentinel/chat-requirements`;

const CHATGPT_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0";
const OAI_CLIENT_VERSION = "prod-81e0c5cdf6140e8c5db714d613337f4aeab94029";
const OAI_CLIENT_BUILD_NUMBER = "6128297";

function browserHeaders(): Record<string,string> {
  return {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Origin: CHATGPT_BASE,
    Pragma: "no-cache",
    Referer: `${CHATGPT_BASE}/`,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": CHATGPT_USER_AGENT,
  };
}
function oaiHeaders(sessionId: string, deviceId: string): Record<string,string> {
  return {
    "OAI-Language": "en-US",
    "OAI-Device-Id": deviceId,
    "OAI-Client-Version": OAI_CLIENT_VERSION,
    "OAI-Client-Build-Number": OAI_CLIENT_BUILD_NUMBER,
    "OAI-Session-Id": sessionId,
  };
}

const deviceIdCache = new Map<string,string>();
function deviceIdFor(cookie:string): string {
  const key = createHash("sha256").update(cookie).digest("hex").slice(0,16);
  let id = deviceIdCache.get(key);
  if(id) return id;
  const h = createHash("sha256").update(cookie).digest("hex");
  id = `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-${((parseInt(h.slice(16,17),16)&0x3)|0x8).toString(16)}${h.slice(17,20)}-${h.slice(20,32)}`;
  if(deviceIdCache.size>=200){ const f=deviceIdCache.keys().next().value; if(f) deviceIdCache.delete(f); }
  deviceIdCache.set(key,id);
  return id;
}
function cookieKey(cookie:string): string { return createHash("sha256").update(cookie).digest("hex").slice(0,16); }

interface TokenEntry { accessToken:string; accountId:string|null; expiresAt:number; refreshedCookie?:string; }
const TOKEN_TTL_MS = 5*60*1000;
const tokenCache = new Map<string, TokenEntry>();
function tokenLookup(cookie:string): TokenEntry|null {
  const e=tokenCache.get(cookieKey(cookie)); if(!e) return null; if(Date.now()>=e.expiresAt){ tokenCache.delete(cookieKey(cookie)); return null; } return e;
}
function tokenStore(cookie:string, entry:TokenEntry){
  if(tokenCache.size>=200 && !tokenCache.has(cookieKey(cookie))){ const f=tokenCache.keys().next().value; if(f) tokenCache.delete(f); }
  tokenCache.set(cookieKey(cookie), entry);
}

const SESSION_TOKEN_FAMILY_RE = /^__Secure-next-auth\.session-token(?:\.\d+)?$/;
function mergeRefreshedCookie(originalCookie:string, setCookieHeader:string|null): string|null {
  if(!setCookieHeader) return null;
  const matches = Array.from(setCookieHeader.matchAll(/(__Secure-next-auth\.session-token(?:\.\d+)?)=([^;,\s]+)/g));
  if(matches.length===0) return null;
  const refreshed=new Map<string,string>();
  for(const m of matches) refreshed.set(m[1],m[2]);
  let blob=originalCookie.trim();
  if(/^cookie\s*:\s*/i.test(blob)) blob=blob.replace(/^cookie\s*:\s*/i,"");
  if(!/=/.test(blob)) return Array.from(refreshed,([k,v])=>`${k}=${v}`).join("; ");
  const pairs=blob.split(/;\s*/).filter(Boolean);
  const result:string[]=[];
  let mutated=false, droppedStale=false;
  for(const pair of pairs){
    const eq=pair.indexOf("=");
    if(eq<0){ result.push(pair); continue; }
    const name=pair.slice(0,eq).trim(), value=pair.slice(eq+1);
    if(SESSION_TOKEN_FAMILY_RE.test(name)){ if(!refreshed.has(name)||refreshed.get(name)!==value) mutated=true; droppedStale=true; continue; }
    result.push(`${name}=${value}`);
  }
  for(const [n,v] of refreshed) result.push(`${n}=${v}`);
  if(!droppedStale) mutated=true;
  return mutated? result.join("; "): null;
}
export function normalizeCookieInput(rawInput:string): string {
  let s = rawInput.trim();
  // Handle Cookie Editor JSON export: array of {name,value} objects or single object
  if ((s.startsWith("[") || s.startsWith("{")) && s.includes("__Secure-next-auth")) {
    try {
      const parsed = JSON.parse(s);
      const cookies: Array<{name:string; value:string}> = Array.isArray(parsed) ? parsed : [parsed];
      // Extract relevant cookies
      const wanted = new Set(["__Secure-next-auth.session-token", "__Secure-next-auth.session-token.0", "__Secure-next-auth.session-token.1", "cf_clearance", "__cf_bm", "_cfuvid", "_puid", "oai-did"]);
      const pairs: string[] = [];
      for (const c of cookies) {
        if (c && typeof c.name === "string" && typeof c.value === "string") {
          if (wanted.has(c.name) || c.name.startsWith("__Secure-next-auth.session-token")) {
            pairs.push(`${c.name}=${c.value}`);
          }
        }
      }
      if (pairs.length) return pairs.join("; ");
      // Fallback: try to find any object with "name" and "value" containing session token
      for (const c of cookies) {
        if (c && c.name && c.name.includes("session-token") && c.value) {
          return `${c.name}=${c.value}`;
        }
      }
    } catch {}
  }
  // Handle JSON with single "value" field (user pasted just the value object)
  if (s.startsWith("{") && s.includes('"value"') && s.includes("c323")) {
    try {
      const obj = JSON.parse(s);
      if (obj.value && typeof obj.value === "string" && obj.value.length > 20) {
        s = obj.value;
      }
    } catch {}
  }
  // Handle Netscape cookies.txt format or Get cookies.txt export
  if (s.includes("\t") && s.includes("chatgpt.com")) {
    const lines = s.split("\n").filter(l => l && !l.startsWith("#"));
    const pairs: string[] = [];
    for (const line of lines) {
      const parts = line.split("\t");
      if (parts.length >= 7) {
        const name = parts[5];
        const value = parts[6];
        if (name && value) pairs.push(`${name}=${value}`);
      }
    }
    if (pairs.length) return pairs.join("; ");
  }
  if(/^cookie\s*:\s*/i.test(s)) s=s.replace(/^cookie\s*:\s*/i,"");
  if(/__Secure-next-auth\.session-token(?:\.\d+)?\s*=/.test(s)) return s;
  // If input looks like a bare JWT (starts with eyJ), prepend name
  if (s.startsWith("eyJ") && s.length > 100) return `__Secure-next-auth.session-token=${s}`;
  // Generic: if input is JSON that failed to parse earlier but contains a JWT inside, extract it
  const jwtMatch = s.match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
  if (jwtMatch && jwtMatch[0].length > 100) return `__Secure-next-auth.session-token=${jwtMatch[0]}`;
  return `__Secure-next-auth.session-token=${s}`;
}
export function buildSessionCookieHeader(rawInput:string): string {
  return normalizeCookieInput(rawInput);
}

export class SessionAuthError extends Error { constructor(m:string){ super(m); this.name="SessionAuthError"; } }

async function exchangeSession(cookie:string, signal?: AbortSignal|null): Promise<TokenEntry> {
  const cached=tokenLookup(cookie);
  if(cached) return cached;
  const headers: Record<string,string> = { ...browserHeaders(), Accept:"application/json", Cookie: buildSessionCookieHeader(cookie) };
  const resp = await tlsFetchChatGpt(SESSION_URL, { method:"GET", headers, timeoutMs:30000, signal });
  if(resp.status===401 || resp.status===403) throw new SessionAuthError("Invalid session cookie — re-copy from chatgpt.com (maybe expired or missing __Secure-next-auth.session-token)");
  if(resp.status>=400){
    // check cloudflare
    if(resp.text && /just a moment|cf-chl/i.test(resp.text)) throw new SessionAuthError("Cloudflare blocked the request — paste full Cookie header including cf_clearance from DevTools Network tab, not just session-token");
    throw new Error(`Session exchange failed (HTTP ${resp.status}) ${resp.text?.slice(0,200) || ""}`);
  }
  const refreshed=mergeRefreshedCookie(cookie, resp.headers.get("set-cookie"));
  let data:any={};
  try{ data=JSON.parse(resp.text||"{}"); } catch{}
  if(!data.accessToken) throw new SessionAuthError("Session response missing accessToken — cookie likely expired. Re-login and copy fresh cookie.");
  const expiresAt=data.expires? new Date(data.expires).getTime(): Date.now()+TOKEN_TTL_MS;
  const entry: TokenEntry = { accessToken:data.accessToken, accountId: data.user?.id ?? null, expiresAt: Math.min(expiresAt, Date.now()+TOKEN_TTL_MS), refreshedCookie: refreshed ?? undefined };
  tokenStore(cookie, entry);
  return entry;
}

// DPL cache
interface DplInfo { dpl:string; scriptSrc:string; expiresAt:number; }
let dplCache: DplInfo|null=null;
const DPL_TTL_MS=60*60*1000;
async function fetchDpl(cookie:string, signal?:AbortSignal|null): Promise<{dpl:string; scriptSrc:string}> {
  if(dplCache && Date.now()<dplCache.expiresAt) return { dpl:dplCache.dpl, scriptSrc:dplCache.scriptSrc };
  const headers: Record<string,string> = { ...browserHeaders(), Accept:"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8", Cookie: buildSessionCookieHeader(cookie) };
  const resp = await tlsFetchChatGpt(`${CHATGPT_BASE}/`, { method:"GET", headers, timeoutMs:20000, signal });
  const html=resp.text||"";
  const dplMatch=html.match(/data-build="([^"]+)"/);
  const dpl=dplMatch?`dpl=${dplMatch[1]}`:`dpl=${OAI_CLIENT_VERSION.replace(/^prod-/,"")}`;
  const scriptMatch=html.match(/<script[^>]+src="(https?:\/\/[^"]*\.js[^"]*)"/);
  const scriptSrc=scriptMatch?.[1] ?? `${CHATGPT_BASE}/_next/static/chunks/webpack-${randomBytes(8).toString("hex")}.js`;
  dplCache={ dpl, scriptSrc, expiresAt: Date.now()+DPL_TTL_MS };
  return { dpl, scriptSrc };
}

// PoW helpers
const NAVIGATOR_KEYS=["webdriver−false","geolocation","languages","language","platform","userAgent","vendor","hardwareConcurrency","deviceMemory","permissions","plugins","mediaDevices"];
const DOCUMENT_KEYS=["_reactListeningkfj3eavmks","_reactListeningo743lnnpvdg","location","scrollingElement","documentElement"];
const WINDOW_KEYS=["webpackChunk_N_E","__NEXT_DATA__","chrome","history","screen","navigation","scrollX","scrollY"];
function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random()*arr.length)]; }
function buildPrekeyConfig(userAgent:string,dpl:string,scriptSrc:string): unknown[] {
  const screenSizes=[3000,4000,3120,4160] as const;
  const cores=[8,16,24,32] as const;
  const dateStr=new Date().toString();
  const perfNow=performance.now();
  const epochOffset=Date.now()-perfNow;
  return [pick(screenSizes), dateStr, 4294705152, 0, userAgent, scriptSrc, dpl, "en-US", "en-US,en", 0, pick(NAVIGATOR_KEYS), pick(DOCUMENT_KEYS), pick(WINDOW_KEYS), perfNow, randomUUID(), "", pick(cores), epochOffset];
}
const POW_YIELD_EVERY=1000;
function yieldToEventLoop(): Promise<void>{ return new Promise(r=>setImmediate(r)); }
interface PowOptions { config:unknown[]; seed:string; target:string; prefix:string; maxIter:number; label:string; }
async function solvePow(opts:PowOptions): Promise<string> {
  const cfg=[...opts.config];
  for(let i=0;i<opts.maxIter;i++){
    if(i>0 && i%POW_YIELD_EVERY===0) await yieldToEventLoop();
    cfg[3]=i;
    const json=JSON.stringify(cfg);
    const b64=Buffer.from(json).toString("base64");
    const hash=sha3_512Hex(opts.seed+b64);
    if(opts.target && hash.slice(0,opts.target.length) <= opts.target) return `${opts.prefix}${b64}`;
  }
  const b64=Buffer.from(JSON.stringify(cfg)).toString("base64");
  return `${opts.prefix}${b64}`;
}
async function buildPrepareToken(config:unknown[]): Promise<string> {
  return solvePow({ config, seed:"", target:"0fffff", prefix:"gAAAAAC", maxIter:100000, label:"prepare" });
}
async function solveProofOfWork(seed:string,difficulty:string,config:unknown[]): Promise<string> {
  return solvePow({ config, seed, target:(difficulty||"").toLowerCase(), prefix:"gAAAAAB", maxIter:500000, label:"conversation" });
}

// Sentinel
interface ChatRequirements { token?:string; prepare_token?:string; persona?:string; proofofwork?:{required?:boolean; seed?:string; difficulty?:string}; turnstile?:{required?:boolean; dx?:string}; }

async function prepareChatRequirements(accessToken:string, accountId:string|null, sessionId:string, deviceId:string, cookie:string, dplInfo:{dpl:string; scriptSrc:string}, signal?:AbortSignal|null): Promise<ChatRequirements> {
  const config=buildPrekeyConfig(CHATGPT_USER_AGENT, dplInfo.dpl, dplInfo.scriptSrc);
  const prekey=await buildPrepareToken(config);
  const headers:Record<string,string>={ ...browserHeaders(), ...oaiHeaders(sessionId, deviceId), "Content-Type":"application/json", Authorization:`Bearer ${accessToken}`, Cookie: buildSessionCookieHeader(cookie), Priority:"u=1, i" };
  if(accountId) headers["chatgpt-account-id"]=accountId;
  const prepResp = await tlsFetchChatGpt(SENTINEL_PREPARE_URL, { method:"POST", headers, body: JSON.stringify({p:prekey}), timeoutMs:30000, signal });
  if(prepResp.status===401||prepResp.status===403) throw new Error(`Sentinel /prepare blocked (HTTP ${prepResp.status})`);
  if(prepResp.status>=400) throw new Error(`Sentinel /prepare failed (HTTP ${prepResp.status}) ${(prepResp.text||"").slice(0,200)}`);
  let prepData:ChatRequirements={};
  try{ prepData=JSON.parse(prepResp.text||"{}"); } catch{}
  if(!prepData.prepare_token) return prepData;
  const crResp = await tlsFetchChatGpt(SENTINEL_CR_URL, { method:"POST", headers, body: JSON.stringify({ p:prekey, prepare_token: prepData.prepare_token }), timeoutMs:30000, signal });
  if(crResp.status===401||crResp.status===403) throw new Error(`Sentinel /chat-requirements blocked (HTTP ${crResp.status})`);
  if(crResp.status>=400) return prepData;
  try{
    const crData=JSON.parse(crResp.text||"{}");
    return { ...crData, prepare_token: prepData.prepare_token };
  } catch{ return prepData; }
}

// Message translation
function parseOpenAIMessages(messages:Array<Record<string,unknown>>): { systemMsg:string; history:Array<{role:string;content:string}>; currentMsg:string } {
  let systemMsg="";
  const history:Array<{role:string;content:string}>=[];
  for(const msg of messages){
    let role=String(msg.role||"user");
    if(role==="developer") role="system";
    let content="";
    if(typeof msg.content==="string") content=msg.content;
    else if(Array.isArray(msg.content)) content=(msg.content as any[]).filter(c=>c.type==="text").map(c=>String(c.text||"")).join(" ");
    if(!content.trim()) continue;
    if(role==="system") systemMsg+=(systemMsg?"\n":"")+content;
    else if(role==="user"||role==="assistant") history.push({role,content});
  }
  let currentMsg="";
  if(history.length>0 && history[history.length-1].role==="user") currentMsg=history.pop()!.content;
  return { systemMsg, history, currentMsg };
}
function buildConversationBody(parsed:{systemMsg:string; history:{role:string;content:string}[]; currentMsg:string}, modelSlug:string, parentMessageId:string, options:{ persistConversation:boolean; thinkingEffort:string|null; systemHints:string[] }): Record<string,unknown> {
  const systemParts:string[]=[];
  if(parsed.systemMsg.trim()) systemParts.push(parsed.systemMsg.trim());
  if(parsed.history.length>0){
    const formatted=parsed.history.map(h=>`${h.role==="assistant"?"Assistant":"User"}: ${h.content}`).join("\n\n");
    systemParts.push(`Prior conversation (for context — answer only the new user message below):\n\n${formatted}`);
  }
  const messages:any[]=[];
  if(systemParts.length>0) messages.push({ id:randomUUID(), author:{role:"system"}, content:{content_type:"text", parts:[systemParts.join("\n\n")]} });
  messages.push({ id:randomUUID(), author:{role:"user"}, content:{content_type:"text", parts:[parsed.currentMsg||""]}, ...(options.systemHints.length?{metadata:{system_hints:[...options.systemHints]}}:{}) });
  return {
    action:"next",
    messages,
    model:modelSlug,
    conversation_id: null,
    parent_message_id: parentMessageId,
    timezone_offset_min: -new Date().getTimezoneOffset(),
    history_and_training_disabled: !options.persistConversation,
    suggestions:[],
    websocket_request_id: randomUUID(),
    conversation_mode:{ kind:"primary_assistant" },
    supports_buffering:true,
    force_parallel_switch:"auto",
    paragen_cot_summary_display_override:"allow",
    ...(options.systemHints.length?{system_hints:[...options.systemHints]}:{}),
    ...(options.thinkingEffort?{thinking_effort: options.thinkingEffort}:{}),
  };
}

// SSE parsing helpers
async function* readChatGptSseEvents(body: ReadableStream<Uint8Array>, signal?:AbortSignal|null): AsyncGenerator<{message?:any; conversation_id?:string; error?:any; type?:string; token?:string}> {
  const reader=body.getReader();
  const decoder=new TextDecoder();
  let buffer=""; let dataLines:string[]=[]; let eventName:string|null=null;
  function flush(): any|null|"done" {
    if(dataLines.length===0){ eventName=null; return null; }
    const payload=dataLines.join("\n"); dataLines=[]; const sseEventName=eventName; eventName=null;
    const trimmed=payload.trim(); if(!trimmed||trimmed==="[DONE]") return "done";
    try{ const parsed=JSON.parse(trimmed); if(sseEventName && !parsed.type) parsed.type=sseEventName; return parsed; } catch{ return null; }
  }
  try{
    while(true){
      if(signal?.aborted) return;
      const {value, done}=await reader.read();
      if(done) break;
      buffer+=decoder.decode(value,{stream:true});
      while(true){
        const idx=buffer.indexOf("\n");
        if(idx<0) break;
        const rawLine=buffer.slice(0,idx); buffer=buffer.slice(idx+1);
        const line=rawLine.endsWith("\r")?rawLine.slice(0,-1):rawLine;
        if(line===""){
          const p=flush();
          if(p==="done") return;
          if(p) yield p;
          continue;
        }
        if(line.startsWith("event:")) eventName=line.slice(6).trim();
        else if(line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
    }
    buffer+=decoder.decode();
    if(buffer.trim().startsWith("data:")) dataLines.push(buffer.trim().slice(5).trimStart());
    const tail=flush(); if(tail && tail!=="done") yield tail;
  } finally{ reader.releaseLock(); }
}

export interface ChatGptWebChatOptions {
  cookie: string;
  model: string; // user facing modelId like gpt-5-6
  messages: Array<Record<string,unknown>>;
  stream?: boolean;
  signal?: AbortSignal | null;
  maxTokens?: number;
  temperature?: number;
}

export async function validateChatGptWebCookie(cookie:string, signal?:AbortSignal|null): Promise<{ ok:boolean; accountId?:string|null; error?:string }> {
  // Early format check — give helpful error before network call
  const normalized = buildSessionCookieHeader(cookie);
  const hasSessionToken = /__Secure-next-auth\.session-token/.test(normalized);
  const hasJwt = normalized.includes("eyJ") && normalized.length > 200;
  if (!hasSessionToken) {
    return { ok:false, error:"No __Secure-next-auth.session-token found — paste the ChatGPT session cookie. Found: " + normalized.slice(0,100) };
  }
  if (!hasJwt) {
    // Check if it's a UUID-like wrong cookie
    if (/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(normalized) && !normalized.includes("eyJ")) {
      return { ok:false, error:"Wrong cookie — you pasted a UUID (" + normalized.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i)?.[0] + "), not the session token. The __Secure-next-auth.session-token should be a long JWT starting with eyJ... (1000+ chars). In Cookie Editor, find __Secure-next-auth.session-token (or .0 + .1) and copy its Value, or copy full Cookie header from Network tab." };
    }
    if (normalized.length < 200) {
      return { ok:false, error:`Cookie too short (${normalized.length} chars) — session token should be ~1000+ chars starting with eyJ. Did you copy the full Value? If it's split into .0 and .1, copy both and paste as "__Secure-next-auth.session-token.0=...; __Secure-next-auth.session-token.1=...; cf_clearance=..." or use Network → Copy Cookie header.` };
    }
  }
  try{
    const entry=await exchangeSession(cookie, signal);
    // try warmup + models fetch to confirm plus access
    const sessionId=randomUUID();
    const deviceId=deviceIdFor(cookie);
    // quick models check
    const headers:Record<string,string>={ ...browserHeaders(), ...oaiHeaders(sessionId,deviceId), Accept:"*/*", Authorization:`Bearer ${entry.accessToken}`, Cookie: buildSessionCookieHeader(cookie) };
    if(entry.accountId) headers["chatgpt-account-id"]=entry.accountId;
    const modelsResp = await tlsFetchChatGpt(`${CHATGPT_BASE}/backend-api/models?history_and_training_disabled=false`, { method:"GET", headers, timeoutMs:15000, signal });
    if(modelsResp.status===401||modelsResp.status===403) return { ok:false, error:"Session expired or not Plus/Pro — models endpoint blocked (401/403). Re-copy fresh cookie with cf_clearance." };
    if(modelsResp.status>=400){
      if(modelsResp.text && /just a moment|cf-chl/i.test(modelsResp.text)) return { ok:false, error:"Cloudflare challenge — re-copy full Cookie header including cf_clearance from Network tab." };
      return { ok:false, error:`Models check failed HTTP ${modelsResp.status}` };
    }
    return { ok:true, accountId: entry.accountId };
  } catch(e){
    const msg=e instanceof Error? e.message: String(e);
    if(e instanceof SessionAuthError) return { ok:false, error: msg };
    if(/cloudflare|cf-chl/i.test(msg)) return { ok:false, error:"Cloudflare blocked — need cf_clearance cookie." };
    return { ok:false, error: msg };
  }
}

export async function discoverChatGptWebModels(cookie:string, signal?:AbortSignal|null): Promise<string[]> {
  // Validate cookie first — if invalid, throw so UI shows no models (user must fix cookie)
  const validation = await validateChatGptWebCookie(cookie, signal);
  if (!validation.ok) throw new Error(validation.error || "Invalid cookie");
  const curated = Object.keys(MODEL_MAP);
  try{
    const entry=await exchangeSession(cookie, signal);
    const sessionId=randomUUID();
    const deviceId=deviceIdFor(cookie);
    const headers:Record<string,string>={ ...browserHeaders(), ...oaiHeaders(sessionId,deviceId), Accept:"*/*", Authorization:`Bearer ${entry.accessToken}`, Cookie: buildSessionCookieHeader(cookie) };
    if(entry.accountId) headers["chatgpt-account-id"]=entry.accountId;
    const resp = await tlsFetchChatGpt(`${CHATGPT_BASE}/backend-api/models?history_and_training_disabled=false`, { method:"GET", headers, timeoutMs:15000, signal });
    if(resp.status>=200 && resp.status<300 && resp.text){
      try{
        const data=JSON.parse(resp.text);
        const models = data.models || data.data || [];
        const ids = Array.isArray(models)? models.map((m:any)=> typeof m==="string"? m : m.slug || m.id).filter(Boolean): [];
        if(ids.length) return Array.from(new Set([...curated, ...ids.map(String)]));
      } catch{}
    }
  } catch{}
  return curated;
}

// Main proxy function
export async function proxyChatGptWeb(opts: ChatGptWebChatOptions, onStreamChunk?: (chunk: Uint8Array)=>void): Promise<any> {
  const { cookie, model, messages, stream, signal } = opts;
  const { slug, isPro } = resolveChatGptModel(model);
  // 1. session exchange
  const entry=await exchangeSession(cookie, signal);
  const sessionId=randomUUID();
  const deviceId=deviceIdFor(cookie);
  const parentMessageId=randomUUID();

  // 2. parse messages
  const parsed=parseOpenAIMessages(messages);
  if(!parsed.currentMsg) throw new Error("No user message found");

  // 3. optional sentinel — try to get token, but don't fail hard if it errors (fallback to no token)
  let sentinelToken: string | null = null;
  let prepareToken: string | null = null;
  try{
    const dplInfo=await fetchDpl(cookie, signal);
    const reqs=await prepareChatRequirements(entry.accessToken, entry.accountId, sessionId, deviceId, cookie, dplInfo, signal);
    if(reqs.token) sentinelToken=reqs.token;
    if(reqs.prepare_token) prepareToken=reqs.prepare_token;
    // if proofofwork required, solve it
    if(reqs.proofofwork?.required && reqs.proofofwork.seed && reqs.proofofwork.difficulty){
      const config=buildPrekeyConfig(CHATGPT_USER_AGENT, dplInfo.dpl, dplInfo.scriptSrc);
      const proof=await solveProofOfWork(reqs.proofofwork.seed, reqs.proofofwork.difficulty, config);
      // The proof token replaces sentinelToken for conversation
      sentinelToken=proof;
    }
  } catch(e){
    // log and continue without sentinel — low-friction accounts still work
    console.warn("[chatgpt-web] sentinel prepare failed, continuing without token:", e instanceof Error? e.message: String(e));
  }

  const body = buildConversationBody(parsed, slug, parentMessageId, { persistConversation: false, thinkingEffort: null, systemHints: [] });

  const headers: Record<string,string> = {
    ...browserHeaders(),
    ...oaiHeaders(sessionId, deviceId),
    "Content-Type":"application/json",
    Accept: "text/event-stream",
    Authorization: `Bearer ${entry.accessToken}`,
    Cookie: buildSessionCookieHeader(cookie),
  };
  if(entry.accountId) headers["chatgpt-account-id"]=entry.accountId;
  if(sentinelToken) headers["openai-sentinel-chat-requirements-token"]=sentinelToken;
  // prepare token header variant if present (some clients send both)
  if(prepareToken) headers["openai-sentinel-chat-requirements-token"] = sentinelToken || prepareToken;

  if(isPro){
    // Pro models may need longer timeout
    headers["x-pro-model"]="true";
  }

  // Stream or non-stream share same endpoint — chatgpt always returns SSE
  const response = await tlsFetchChatGptStream(CONV_URL, {
    method:"POST",
    headers,
    body: JSON.stringify(body),
    timeoutMs: 120000,
    signal,
  });

  if(!response.body) throw new Error(`ChatGPT upstream no body (HTTP ${response.status})`);
  if(response.status===401||response.status===403) throw new SessionAuthError(`ChatGPT auth failed HTTP ${response.status} — cookie expired?`);
  if(response.status>=400){
    // try to read first bytes for error
    const reader=response.body.getReader();
    const {value}=await reader.read().catch(()=>({value:undefined}));
    const text=value? new TextDecoder().decode(value).slice(0,500): "";
    if(/just a moment|cf-chl/i.test(text)) throw new Error(`Cloudflare challenge HTTP ${response.status} — re-copy cf_clearance`);
    throw new Error(`ChatGPT upstream HTTP ${response.status} ${text}`);
  }

  // Parse SSE into text
  let fullText="";
  let conversationId:string|null=null;
  let messageId:string|null=null;
  let isLive=false;
  let emittedLen=0;
  let currentText="";

  // Helper to emit SSE delta for streaming clients
  const streamBuffers: string[] = [];

  for await (const event of readChatGptSseEvents(response.body, signal)){
    if(event.error){
      const msg=typeof event.error==="string"? event.error: event.error.message||"ChatGPT stream error";
      throw new Error(msg);
    }
    if(event.conversation_id) conversationId=event.conversation_id;
    const m=event.message;
    if(!m) continue;
    if(m.author?.role!=="assistant") continue;
    const id=m.id ?? null;
    const status=m.status ?? "";
    if(id && id!==messageId){
      messageId=id;
      currentText="";
      emittedLen=0;
      isLive=false;
    }
    if(status==="in_progress") isLive=true;
    const parts=m.content?.parts ?? [];
    if(!parts.length) continue;
    const cumulative=parts.map((p:any)=> typeof p==="string"? p:"").join("");
    if(cumulative.length>currentText.length) currentText=cumulative;
    if(isLive && currentText.length>emittedLen){
      const delta=currentText.slice(emittedLen);
      emittedLen=currentText.length;
      fullText=currentText; // keep latest cumulative
      if(stream && onStreamChunk){
        // Emit OpenAI SSE chunk
        const chunk = JSON.stringify({ id:`chatcmpl-${messageId||randomUUID().slice(0,8)}`, object:"chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices:[{ index:0, delta:{ content: delta }, finish_reason:null }] });
        onStreamChunk(new TextEncoder().encode(`data: ${chunk}\n\n`));
      }
    }
  }
  // fallback if no in_progress observed
  if(!isLive && currentText.length>emittedLen){
    const delta=currentText.slice(emittedLen);
    fullText=currentText;
    if(stream && onStreamChunk){
      const chunk = JSON.stringify({ id:`chatcmpl-${messageId||randomUUID().slice(0,8)}`, object:"chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices:[{ index:0, delta:{ content: delta }, finish_reason:null }] });
      onStreamChunk(new TextEncoder().encode(`data: ${chunk}\n\n`));
    }
  }
  if(!fullText) fullText=currentText;
  if(!fullText) throw new Error("ChatGPT returned empty response body — may be sentinel block or model unavailable for your plan");

  if(stream && onStreamChunk){
    const done = JSON.stringify({ id:`chatcmpl-${messageId||randomUUID().slice(0,8)}`, object:"chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices:[{ index:0, delta:{}, finish_reason:"stop" }] });
    onStreamChunk(new TextEncoder().encode(`data: ${done}\n\n`));
    onStreamChunk(new TextEncoder().encode(`data: [DONE]\n\n`));
    return;
  } else {
    return {
      id: `chatcmpl-${messageId||randomUUID().slice(0,8)}`,
      object: "chat.completion",
      created: Math.floor(Date.now()/1000),
      model,
      choices: [{ index:0, message:{ role:"assistant", content: fullText }, finish_reason:"stop" }],
      usage: { prompt_tokens: Math.ceil(JSON.stringify(messages).length/4), completion_tokens: Math.ceil(fullText.length/4), total_tokens: Math.ceil((JSON.stringify(messages).length+fullText.length)/4) },
    };
  }
}
