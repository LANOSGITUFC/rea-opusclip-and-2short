/**
 * CommonJS preload script loaded via NODE_OPTIONS="--require ..." in the spawned server process.
 * Rewrites globalThis.fetch calls targeting external third-party APIs to MOCK_API_BASE_URL,
 * preserving original host in `x-mock-target-host` and path/query/method/headers/body.
 */
"use strict";

const MOCK_HOSTS = new Set([
  "api.groq.com",
  "generativelanguage.googleapis.com",
  "api.openai.com",
  "openrouter.ai",
  "api.giphy.com",
  "oauth2.googleapis.com",
  "www.googleapis.com",
  "open.tiktokapis.com",
  "graph.facebook.com"
]);

const mockBaseUrl = process.env.MOCK_API_BASE_URL;

if (mockBaseUrl && typeof globalThis.fetch === "function") {
  const originalFetch = globalThis.fetch;
  const mockBase = mockBaseUrl.replace(/\/+$/, "");

  globalThis.fetch = async function interceptedFetch(input, init) {
    let urlStr;
    let isRequestObj = false;

    if (typeof input === "string") {
      urlStr = input;
    } else if (input instanceof URL) {
      urlStr = input.toString();
    } else if (input && typeof input === "object" && typeof input.url === "string") {
      urlStr = input.url;
      isRequestObj = true;
    } else {
      return originalFetch.call(this, input, init);
    }

    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch {
      return originalFetch.call(this, input, init);
    }

    if (!MOCK_HOSTS.has(parsed.hostname)) {
      return originalFetch.call(this, input, init);
    }

    const rewrittenUrl = `${mockBase}${parsed.pathname}${parsed.search}`;

    if (isRequestObj) {
      const mergedHeaders = new Headers(input.headers);
      if (init && init.headers) {
        new Headers(init.headers).forEach((v, k) => mergedHeaders.set(k, v));
      }
      mergedHeaders.set("x-mock-target-host", parsed.host);

      const nextInit = {
        method: (init && init.method) || input.method,
        headers: mergedHeaders,
        body: init && init.body !== undefined ? init.body : input.body,
        signal: (init && init.signal) || input.signal,
        redirect: (init && init.redirect) || input.redirect
      };
      if (nextInit.body != null && nextInit.method !== "GET" && nextInit.method !== "HEAD") {
        nextInit.duplex = "half";
      }
      return originalFetch.call(this, rewrittenUrl, nextInit);
    }

    const nextInit = init ? { ...init } : {};
    const headers = new Headers(nextInit.headers || {});
    headers.set("x-mock-target-host", parsed.host);
    nextInit.headers = headers;

    return originalFetch.call(this, rewrittenUrl, nextInit);
  };
}
