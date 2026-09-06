/**
 * Simplified chatgptTlsClient — wraps native fetch with browser-like fingerprint
 * For full TLS impersonation OmniRoute uses tls-client-node (Firefox 148) via koffi.
 * SkyRoute uses native fetch + browser headers. If Cloudflare blocks, error surfaces
 * as "cf-mitigated" so UI can guide user to re-copy cf_clearance cookie.
 */

export interface TlsFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal | null;
  timeoutMs?: number;
}

export interface TlsFetchResult {
  status: number;
  headers: Headers;
  text: string | null;
  body: ReadableStream<Uint8Array> | null;
}

export class TlsClientUnavailableError extends Error { constructor(m:string){ super(m); this.name="TlsClientUnavailableError"; } }
export class TlsClientHangError extends Error { constructor(){ super("TLS client hang"); this.name="TlsClientHangError"; } }

export async function tlsFetchChatGpt(url: string, opts: TlsFetchOptions = {}): Promise<TlsFetchResult> {
  const controller = new AbortController();
  const timeout = opts.timeoutMs ?? 30000;
  let timeoutId: NodeJS.Timeout | null = null;
  if (timeout > 0) {
    timeoutId = setTimeout(() => controller.abort(), timeout);
  }
  const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;

  // Merge abort: if opts.signal aborts, abort our controller
  const onAbort = () => controller.abort((opts.signal as any)?.reason);
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort((opts.signal as any)?.reason);
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers: opts.headers,
      body: opts.body,
      signal,
      // @ts-ignore - keepalive for node
      duplex: opts.body ? "half" : undefined,
    } as any);
    const text = await res.text().catch(() => null);
    // Try to get body stream if needed (for SSE). Since we consumed text, stream is null unless we clone.
    // For SSE streaming we need raw stream — re-fetch with streaming mode is handled in executor directly via fetch.
    // Here we return text path only. Executor will use fetch directly for streaming case.
    return {
      status: res.status,
      headers: res.headers,
      text,
      body: null,
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
  }
}

// Streaming fetch helper for SSE — returns raw ReadableStream without consuming text
export async function tlsFetchChatGptStream(url: string, opts: TlsFetchOptions = {}): Promise<{ status:number; headers:Headers; body: ReadableStream<Uint8Array> | null }> {
  const controller = new AbortController();
  const timeout = opts.timeoutMs ?? 120000;
  let timeoutId: NodeJS.Timeout | null = null;
  if (timeout > 0) timeoutId = setTimeout(() => controller.abort(), timeout);
  const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;
  const onAbort = () => controller.abort((opts.signal as any)?.reason);
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort((opts.signal as any)?.reason);
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const res = await fetch(url, {
      method: opts.method || "POST",
      headers: opts.headers,
      body: opts.body,
      signal,
      duplex: opts.body ? "half" : undefined,
    } as any);
    return { status: res.status, headers: res.headers, body: res.body as any };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
  }
}

export function isCloudflareChallenge(text: string | null): boolean {
  if (!text) return false;
  return /just a moment|window\._cf_chl_opt|challenges\.cloudflare\.com|attention required|cf-chl/i.test(text);
}
export function looksLikeSse(text: string): boolean {
  const trimmed = text.replace(/^[\s\r\n]+/, "");
  if (!trimmed) return false;
  if (trimmed.startsWith(":")) return true;
  return /^(data|event|id|retry):/i.test(trimmed);
}
