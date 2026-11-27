/**
 * E2E Test Harness for Opus2Short AI Studio.
 * Manages server child process lifecycle on an ephemeral TCP port,
 * injects fetch-interceptor.cjs + MOCK_API_BASE_URL, and provides
 * HTTP, multipart upload, polling, and cleanup helpers.
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SERVER_ENTRY = path.join(REPO_ROOT, "app/server/index.js");
const FETCH_INTERCEPTOR = path.join(__dirname, "fetch-interceptor.cjs");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

class FatalPollError extends Error {
  constructor(message) {
    super(message);
    this.name = "FatalPollError";
    this.fatal = true;
  }
}

async function pollUntil(fn, { timeoutMs = 30000, intervalMs = 250, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const val = await fn();
      if (val) return val;
    } catch (err) {
      if (err instanceof FatalPollError || err?.fatal === true) {
        throw err;
      }
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const extra = lastErr ? ` (last error: ${lastErr.message})` : "";
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}${extra}`);
}

async function startServer(opts = {}) {
  const port = opts.port || (await getFreePort());
  const baseUrl = `http://127.0.0.1:${port}`;

  const env = { ...process.env, PORT: String(port) };
  // Isolated, ephemeral DB + storage per server run (never touches app/data or app/storage)
  const isolatedRoot = (opts.dataDir && opts.storageDir) ? null : fs.mkdtempSync(path.join(os.tmpdir(), "opus2short-e2e-"));
  env.DATA_DIR = opts.dataDir || path.join(isolatedRoot, "data");
  env.STORAGE_DIR = opts.storageDir || path.join(isolatedRoot, "storage");

  if (opts.mockApiUrl) {
    env.MOCK_API_BASE_URL = opts.mockApiUrl;
    const prevNodeOpts = env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ` : "";
    env.NODE_OPTIONS = `${prevNodeOpts}--require ${FETCH_INTERCEPTOR}`.trim();
  }

  const proc = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (d) => {
    stdout += d.toString();
    if (stdout.length > 16384) stdout = stdout.slice(-16384);
  });
  proc.stderr.on("data", (d) => {
    stderr += d.toString();
    if (stderr.length > 16384) stderr = stderr.slice(-16384);
  });

  let exitedEarly = false;
  let exitCode = null;
  proc.on("exit", (code) => {
    exitedEarly = true;
    exitCode = code;
  });

  try {
    await pollUntil(
      async () => {
        if (exitedEarly) {
          throw new FatalPollError(`Server exited early with code ${exitCode}. stderr: ${stderr}`);
        }
        const res = await fetch(`${baseUrl}/api/workflows`);
        return res.status === 200;
      },
      { timeoutMs: opts.startupTimeoutMs || 15000, intervalMs: 150, label: "server /api/workflows ready" }
    );
  } catch (err) {
    try {
      proc.kill("SIGKILL");
    } catch {}
    throw err;
  }

  const tracked = {
    projects: new Set(),
    brandKits: new Set(),
    keys: new Set(),
    socialAccounts: new Set(),
    schedules: new Set()
  };

  async function request(method, reqPath, reqOpts = {}) {
    const url = reqPath.startsWith("http") ? reqPath : `${baseUrl}${reqPath}`;
    const headers = { ...(reqOpts.headers || {}) };
    let body = reqOpts.body;

    if (reqOpts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(reqOpts.json);
    }

    const res = await fetch(url, {
      method: method.toUpperCase(),
      headers,
      body,
      redirect: reqOpts.redirect || "follow"
    });

    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString("utf8");
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    return {
      status: res.status,
      headers: res.headers,
      buffer: buf,
      text,
      json
    };
  }

  async function uploadMultipart(reqPath, fields = {}, files = {}) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && v !== null) {
        fd.append(k, String(v));
      }
    }
    for (const [fieldName, fileSpec] of Object.entries(files)) {
      const spec = typeof fileSpec === "string" ? { path: fileSpec } : fileSpec;
      const buf = spec.buffer || fs.readFileSync(spec.path);
      const filename = spec.filename || (spec.path ? path.basename(spec.path) : "upload.bin");
      const contentType = spec.contentType || "application/octet-stream";
      fd.append(fieldName, new Blob([buf], { type: contentType }), filename);
    }

    const url = reqPath.startsWith("http") ? reqPath : `${baseUrl}${reqPath}`;
    const res = await fetch(url, { method: "POST", body: fd });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString("utf8");
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    return {
      status: res.status,
      headers: res.headers,
      buffer: buf,
      text,
      json
    };
  }

  async function cleanup() {
    for (const id of tracked.schedules) {
      await request("DELETE", `/api/publish-schedules/${id}`).catch(() => {});
    }
    for (const id of tracked.socialAccounts) {
      await request("DELETE", `/api/social-accounts/${id}`).catch(() => {});
    }
    for (const id of tracked.projects) {
      await request("DELETE", `/api/projects/${id}`).catch(() => {});
    }
    for (const id of tracked.brandKits) {
      await request("DELETE", `/api/brand-kits/${id}`).catch(() => {});
    }
    for (const id of tracked.keys) {
      await request("DELETE", `/api/keys/${id}`).catch(() => {});
    }
    tracked.schedules.clear();
    tracked.socialAccounts.clear();
    tracked.projects.clear();
    tracked.brandKits.clear();
    tracked.keys.clear();
  }

  async function stop() {
    await cleanup();
    if (!proc.killed && exitCode === null) {
      proc.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {}
          resolve();
        }, 3000);
        proc.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    if (isolatedRoot) {
      try { fs.rmSync(isolatedRoot, { recursive: true, force: true }); } catch {}
    }
  }

  return {
    port,
    baseUrl,
    dataDir: env.DATA_DIR,
    storageDir: env.STORAGE_DIR,
    proc,
    getLogs: () => ({ stdout, stderr }),
    request,
    uploadMultipart,
    pollUntil,
    trackProject: (id) => id && tracked.projects.add(id),
    trackBrandKit: (id) => id && tracked.brandKits.add(id),
    trackKey: (id) => id && tracked.keys.add(id),
    trackSocialAccount: (id) => id && tracked.socialAccounts.add(id),
    trackSchedule: (id) => id && tracked.schedules.add(id),
    cleanup,
    stop
  };
}

module.exports = {
  REPO_ROOT,
  FatalPollError,
  getFreePort,
  pollUntil,
  startServer
};
