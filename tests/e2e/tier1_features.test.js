/**
 * Tier 1: Feature Coverage E2E Tests (F1 - F14)
 * Opaque-box tests using Node 22 node:test + node:assert/strict.
 * Verifies every feature in PROJECT.md § Feature Inventory with >= 5 assertions/cases per feature.
 */
"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { REPO_ROOT, startServer } = require("./helpers/harness");
const {
  createTempDir,
  removeDir,
  createTestVideo,
  createTestAudio,
  createTestPng,
  probeMedia
} = require("./helpers/fixtures");
const { createMockApiServer } = require("./helpers/mock-apis");

function runWorker(cmd, payload) {
  const stdout = execFileSync(
    "python3",
    [path.join(REPO_ROOT, "app/worker/pipeline.py"), cmd],
    {
      cwd: REPO_ROOT,
      input: JSON.stringify(payload),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    }
  );
  const parsed = JSON.parse(stdout.trim());
  assert.equal(parsed.ok, true, `Worker ${cmd} failed: ${stdout}`);
  return parsed.data;
}

describe("Tier 1: Feature Coverage (F1 - F14)", () => {
  let mockApi;
  let server;
  let tmpDir;
  let sampleVideoPath;
  let silentGapVideoPath;
  let sampleBgmPath;
  let sampleLogoPath;

  before(async () => {
    tmpDir = createTempDir("opus2short-tier1-");
    sampleVideoPath = createTestVideo(path.join(tmpDir, "sample.mp4"), {
      duration: 6,
      width: 640,
      height: 360,
      fps: 24
    });
    silentGapVideoPath = createTestVideo(path.join(tmpDir, "silent_gap.mp4"), {
      duration: 3.5,
      width: 640,
      height: 360,
      fps: 24,
      silentGap: true
    });
    sampleBgmPath = createTestAudio(path.join(tmpDir, "bgm.wav"), { duration: 3 });
    sampleLogoPath = createTestPng(path.join(tmpDir, "logo.png"), { width: 64, height: 64 });

    mockApi = createMockApiServer();
    await mockApi.start();
    server = await startServer({ mockApiUrl: mockApi.url });
    const origRequest = server.request;
    server.request = (method, reqPath, reqOpts = {}) =>
      origRequest(method, reqPath, {
        ...reqOpts,
        headers: { Connection: "close", ...(reqOpts.headers || {}) }
      });
  });

  after(async () => {
    try {
      if (server) await server.stop();
    } finally {
      try {
        if (mockApi) await mockApi.stop();
      } finally {
        removeDir(tmpDir);
      }
    }
  });

  // =========================================================================
  // F1: Runtime & Build Environment
  // =========================================================================
  describe("F1: Runtime & Build Environment", () => {
    it("verifies server, web, tsconfig, system binaries, and built SPA serving", async () => {
      const serverPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "app/server/package.json"), "utf8"));
      assert.equal(serverPkg.main, "index.js");
      assert.ok(serverPkg.dependencies.express);

      const webPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "app/web/package.json"), "utf8"));
      assert.equal(webPkg.scripts.build, "vite build");
      assert.equal(webPkg.scripts.typecheck, "tsc --noEmit");
      assert.ok(fs.existsSync(path.join(REPO_ROOT, "app/web/tsconfig.json")));

      const ffmpegOut = execFileSync("ffmpeg", ["-version"], { encoding: "utf8" });
      assert.match(ffmpegOut, /ffmpeg version/i);
      const ffprobeOut = execFileSync("ffprobe", ["-version"], { encoding: "utf8" });
      assert.match(ffprobeOut, /ffprobe version/i);
      const pyOut = execFileSync("python3", ["--version"], { encoding: "utf8" });
      assert.match(pyOut, /Python 3\./);

      const distIndex = path.join(REPO_ROOT, "app/web/dist/index.html");
      assert.ok(fs.existsSync(distIndex), "app/web/dist/index.html must exist");

      const rootRes = await server.request("GET", "/");
      assert.equal(rootRes.status, 200);
      assert.match(rootRes.headers.get("content-type") || "", /text\/html/i);
      assert.match(rootRes.text, /<div id="root">/i);
    });
  });

  // =========================================================================
  // F2: Multi-Key Pool & LLM Failover
  // =========================================================================
  describe("F2: Multi-Key Pool & LLM Failover", () => {
    it("manages key CRUD, fails over from 429 key 1 to key 2, and falls back locally with no keys", async () => {
      mockApi.reset();

      // 1. Create two Groq keys
      const addRes = await server.request("POST", "/api/keys", {
        json: {
          provider: "groq",
          label: "Tier1Key",
          keysText: "gsk_tier1_fail_key_0001\ngsk_tier1_good_key_0002"
        }
      });
      assert.equal(addRes.status, 201);
      assert.equal(addRes.json.ok, true);
      assert.equal(addRes.json.added, 2);

      const createdKeys = addRes.json.keys.filter((k) => k.label.startsWith("Tier1Key"));
      assert.equal(createdKeys.length, 2);
      for (const k of createdKeys) server.trackKey(k.id);

      const key1 = createdKeys.find((k) => k.label.includes("#1")) || createdKeys[0];
      const key2 = createdKeys.find((k) => k.label.includes("#2")) || createdKeys[1];

      // 2. GET /api/keys lists them masked
      const listRes = await server.request("GET", "/api/keys");
      assert.equal(listRes.status, 200);
      assert.ok(listRes.json.keys.some((k) => k.id === key1.id));

      // 3. PATCH /api/keys/:id updates label and enabled state
      const patchRes = await server.request("PATCH", `/api/keys/${key1.id}`, {
        json: { label: "Tier1Key-Primary", enabled: true }
      });
      assert.equal(patchRes.status, 200);
      assert.ok(patchRes.json.keys.some((k) => k.id === key1.id && k.label === "Tier1Key-Primary"));

      // 4. Upload a project (with whisperProvider=groq so transcription is fast & mocked)
      await server.request("POST", "/api/settings", {
        json: { llmProvider: "groq", whisperProvider: "groq", clearApiKey: true }
      });

      // Inject 429 on key1 for chat/completions -> should failover to key2
      mockApi.addFailure({
        host: "api.groq.com",
        pathIncludes: "/chat/completions",
        apiKey: "gsk_tier1_fail_key_0001",
        status: 429,
        body: { error: { message: "Rate limit exceeded" } }
      });
      mockApi.addResponseOverride(
        { pathIncludes: "/chat/completions" },
        () => ({
          status: 200,
          body: {
            id: "chatcmpl-curate-f2",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    clips: [
                      {
                        title: "Mock Viral Hook Clip",
                        description: "High retention mock clip",
                        hashtags: "#shorts #viral",
                        viralityScore: 92,
                        hookScore: 94,
                        pacingScore: 89,
                        storyScore: 90,
                        reason: "Strong hook",
                        startSec: 0,
                        endSec: 5.5
                      }
                    ]
                  })
                },
                finish_reason: "stop"
              }
            ]
          }
        }),
        true
      );

      const upRes = await server.uploadMultipart(
        "/api/projects/upload",
        { title: "F2 Failover Project", workflowId: "builtin:long-to-shorts" },
        { video: { path: sampleVideoPath, filename: "sample.mp4", contentType: "video/mp4" } }
      );
      assert.equal(upRes.status, 201);
      server.trackProject(upRes.json.id);

      const detail = await server.pollUntil(async () => {
        const r = await server.request("GET", `/api/projects/${upRes.json.id}`);
        if (r.json?.project?.status === "ready") return r.json;
        if (r.json?.project?.status === "error") {
          throw new Error(`Project failed: ${r.json.project.errorMsg}`);
        }
        return null;
      }, { timeoutMs: 30000, label: "F2 project ready" });

      assert.ok(detail.clips.length >= 1, "curateViralClips should produce >= 1 clip via failover");
      const clipId = detail.clips[0].id;

      // 5. Social copy & project chat also succeed via key2 after key1 cooldown
      const copyRes = await server.request("POST", "/api/social-copy", {
        json: { clipId, platform: "YOUTUBE" }
      });
      assert.equal(copyRes.status, 200);
      assert.ok(copyRes.json.copy?.title);

      const chatRes = await server.request("POST", `/api/projects/${upRes.json.id}/chat`, {
        json: { message: "Qual o melhor hook?" }
      });
      assert.equal(chatRes.status, 200);
      assert.ok(chatRes.json.reply?.content);

      const chatHist = await server.request("GET", `/api/projects/${upRes.json.id}/chat`);
      assert.equal(chatHist.status, 200);
      assert.ok(Array.isArray(chatHist.json?.messages));
      assert.ok(chatHist.json.messages.some((m) => m.role === "user" && m.content === "Qual o melhor hook?"));
      assert.ok(chatHist.json.messages.some((m) => m.role === "assistant" && m.content));

      // 6. Delete both keys & verify local fallback works when no keys configured
      await server.request("DELETE", `/api/keys/${key1.id}`);
      await server.request("DELETE", `/api/keys/${key2.id}`);
      const afterDel = await server.request("GET", "/api/keys");
      assert.equal(afterDel.json.keys.some((k) => k.id === key1.id || k.id === key2.id), false);

      const fallbackChat = await server.request("POST", `/api/projects/${upRes.json.id}/chat`, {
        json: { message: "Resumo local" }
      });
      assert.equal(fallbackChat.status, 200);
      assert.ok(fallbackChat.json.reply?.content);
    });
  });

  // =========================================================================
  // F3: Bounded Job Queue & Crash Recovery
  // =========================================================================
  describe("F3: Bounded Job Queue & Crash Recovery", () => {
    it("processes concurrent uploads & renders in bounded queue and cleans up on DELETE", async () => {
      mockApi.reset();
      await server.request("POST", "/api/settings", {
        json: { llmProvider: "groq", whisperProvider: "groq", clearApiKey: true }
      });
      const kRes = await server.request("POST", "/api/keys", {
        json: { provider: "groq", label: "F3Key", keysText: "gsk_tier1_queue_key_12345" }
      });
      const kId = kRes.json.keys.find((k) => k.label === "F3Key")?.id;
      server.trackKey(kId);

      for (let i = 0; i < 2; i++) {
        mockApi.addResponseOverride(
          { pathIncludes: "/chat/completions" },
          () => ({
            status: 200,
            body: {
              id: `chatcmpl-f3-${i}`,
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: JSON.stringify({
                      clips: [
                        {
                          title: `Queue Clip ${i}`,
                          description: "Mock clip",
                          hashtags: "#shorts",
                          viralityScore: 88,
                          hookScore: 90,
                          pacingScore: 85,
                          storyScore: 87,
                          reason: "Queue test",
                          startSec: 0,
                          endSec: 5.5
                        }
                      ]
                    })
                  },
                  finish_reason: "stop"
                }
              ]
            }
          }),
          true
        );
      }

      // Upload 2 projects concurrently
      const [up1, up2] = await Promise.all([
        server.uploadMultipart(
          "/api/projects/upload",
          { title: "Queue P1" },
          { video: { path: sampleVideoPath, filename: "p1.mp4", contentType: "video/mp4" } }
        ),
        server.uploadMultipart(
          "/api/projects/upload",
          { title: "Queue P2" },
          { video: { path: sampleVideoPath, filename: "p2.mp4", contentType: "video/mp4" } }
        )
      ]);
      assert.equal(up1.status, 201);
      assert.equal(up2.status, 201);
      assert.equal(up1.json.status, "queued");
      assert.equal(up2.json.status, "queued");
      server.trackProject(up1.json.id);
      server.trackProject(up2.json.id);

      const [d1, d2] = await Promise.all([
        server.pollUntil(async () => {
          const r = await server.request("GET", `/api/projects/${up1.json.id}`);
          return r.json?.project?.status === "ready" ? r.json : null;
        }, { timeoutMs: 45000, label: "P1 ready" }),
        server.pollUntil(async () => {
          const r = await server.request("GET", `/api/projects/${up2.json.id}`);
          return r.json?.project?.status === "ready" ? r.json : null;
        }, { timeoutMs: 45000, label: "P2 ready" })
      ]);

      assert.ok(d1.clips.length >= 1);
      assert.ok(d2.clips.length >= 1);

      // Render both clips concurrently
      const [r1, r2] = await Promise.all([
        server.request("POST", `/api/clips/${d1.clips[0].id}/render`, { json: { resolution: "720p", fps: 24 } }),
        server.request("POST", `/api/clips/${d2.clips[0].id}/render`, { json: { resolution: "720p", fps: 24 } })
      ]);
      assert.equal(r1.status, 200);
      assert.equal(r2.status, 200);

      const [c1, c2] = await Promise.all([
        server.pollUntil(async () => {
          const r = await server.request("GET", `/api/clips/${d1.clips[0].id}`);
          if (r.json?.clip?.exportStatus === "done") return r.json.clip;
          if (r.json?.clip?.exportStatus === "error") throw new Error(`C1 render error: ${r.json.clip.exportError}`);
          return null;
        }, { timeoutMs: 45000, label: "C1 done" }),
        server.pollUntil(async () => {
          const r = await server.request("GET", `/api/clips/${d2.clips[0].id}`);
          if (r.json?.clip?.exportStatus === "done") return r.json.clip;
          if (r.json?.clip?.exportStatus === "error") throw new Error(`C2 render error: ${r.json.clip.exportError}`);
          return null;
        }, { timeoutMs: 45000, label: "C2 done" })
      ]);

      assert.ok(c1.exportPath && fs.existsSync(c1.exportPath));
      assert.ok(c2.exportPath && fs.existsSync(c2.exportPath));

      // DELETE project cleans up files and DB record
      const delRes = await server.request("DELETE", `/api/projects/${up1.json.id}`);
      assert.equal(delRes.status, 200);
      assert.equal(fs.existsSync(c1.exportPath), false);
      const getDeleted = await server.request("GET", `/api/projects/${up1.json.id}`);
      assert.equal(getDeleted.status, 404);
    });
  });

  // =========================================================================
  // F4: Range Streaming & Safe JSON Endpoints
  // =========================================================================
  describe("F4: Range Streaming & Safe JSON Endpoints", () => {
    it("supports HTTP 200/206 Range streaming and parses valid & markdown-fenced JSON in /translate", async () => {
      mockApi.reset();
      await server.request("POST", "/api/settings", {
        json: { llmProvider: "groq", whisperProvider: "groq", clearApiKey: true }
      });
      const kRes = await server.request("POST", "/api/keys", {
        json: { provider: "groq", label: "F4Key", keysText: "gsk_tier1_f4_key_123456" }
      });
      server.trackKey(kRes.json.keys.find((k) => k.label === "F4Key")?.id);
      mockApi.addResponseOverride(
        { pathIncludes: "/chat/completions" },
        () => ({
          status: 200,
          body: {
            id: "chatcmpl-f4",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    clips: [
                      {
                        title: "F4 Clip",
                        description: "Range clip",
                        hashtags: "#shorts",
                        viralityScore: 90,
                        hookScore: 90,
                        pacingScore: 90,
                        storyScore: 90,
                        reason: "F4",
                        startSec: 0,
                        endSec: 5.5
                      }
                    ]
                  })
                },
                finish_reason: "stop"
              }
            ]
          }
        }),
        true
      );

      const upRes = await server.uploadMultipart(
        "/api/projects/upload",
        { title: "F4 Range & JSON" },
        { video: { path: sampleVideoPath, filename: "f4.mp4", contentType: "video/mp4" } }
      );
      server.trackProject(upRes.json.id);

      const detail = await server.pollUntil(async () => {
        const r = await server.request("GET", `/api/projects/${upRes.json.id}`);
        return r.json?.project?.status === "ready" ? r.json : null;
      }, { timeoutMs: 30000, label: "F4 project ready" });

      const clipId = detail.clips[0].id;

      // Project thumbnail 200 + image content-type + non-empty bytes
      const thumbRes = await server.request("GET", `/api/projects/${upRes.json.id}/thumb`);
      assert.equal(thumbRes.status, 200);
      assert.match(thumbRes.headers.get("content-type") || "", /^image\//i);
      assert.ok(thumbRes.buffer.length > 0, "Project thumbnail must have non-empty bytes");

      // Project video 200 & 206
      const fullVid = await server.request("GET", `/api/projects/${upRes.json.id}/video`);
      assert.equal(fullVid.status, 200);
      assert.equal(fullVid.headers.get("accept-ranges"), "bytes");
      assert.equal(fullVid.headers.get("content-type"), "video/mp4");

      const rangeVid = await server.request("GET", `/api/projects/${upRes.json.id}/video`, {
        headers: { Range: "bytes=0-1023" }
      });
      assert.equal(rangeVid.status, 206);
      assert.match(rangeVid.headers.get("content-range") || "", /^bytes 0-1023\/\d+$/);
      assert.equal(rangeVid.buffer.length, 1024);

      // Render clip & test download 200/206
      await server.request("POST", `/api/clips/${clipId}/render`, { json: { resolution: "720p", fps: 24 } });
      await server.pollUntil(async () => {
        const r = await server.request("GET", `/api/clips/${clipId}`);
        if (r.json?.clip?.exportStatus === "done") return r.json.clip;
        if (r.json?.clip?.exportStatus === "error") throw new Error(`F4 render error: ${r.json.clip.exportError}`);
        return null;
      }, { timeoutMs: 30000, label: "F4 clip rendered" });

      const dlRange = await server.request("GET", `/api/clips/${clipId}/download`, {
        headers: { Range: "bytes=0-511" }
      });
      assert.equal(dlRange.status, 206);
      assert.equal(dlRange.buffer.length, 512);
      assert.equal(dlRange.headers.get("content-type"), "video/mp4");

      // /translate with markdown-fenced JSON response from LLM
      const wordCount = detail.clips[0].words.length;
      const fencedWords = Array.from({ length: wordCount }, (_, i) => `palavra_${i}`);
      mockApi.addResponseOverride(
        { pathIncludes: "/chat/completions" },
        () => ({
          status: 200,
          body: {
            id: "chatcmpl-fenced",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "```json\n" + JSON.stringify({ words: fencedWords }) + "\n```"
                },
                finish_reason: "stop"
              }
            ]
          }
        }),
        true
      );

      const trRes = await server.request("POST", `/api/clips/${clipId}/translate`, {
        json: { targetLang: "Portuguese" }
      });
      assert.equal(trRes.status, 200);
      assert.equal(trRes.json.words[0].text, "palavra_0");
    });
  });

  // =========================================================================
  // F5: OAuth Security & Account Upsert
  // =========================================================================
  describe("F5: OAuth Security & Account Upsert", () => {
    it("configures OAuth, validates state on YouTube callback, upserts account, and publishes Short", async () => {
      mockApi.reset();

      const cfgPost = await server.request("POST", "/api/oauth/config", {
        json: {
          googleClientId: "mock-google-client-id",
          googleClientSecret: "mock-google-client-secret"
        }
      });
      assert.equal(cfgPost.status, 200);

      const cfgGet = await server.request("GET", "/api/oauth/config");
      assert.equal(cfgGet.status, 200);
      assert.equal(cfgGet.json.googleConfigured, true);
      assert.ok(cfgGet.json.redirectUris.youtube.endsWith("/api/oauth/youtube/callback"));

      // Upload client_secret JSON
      const secretRes = await server.request("POST", "/api/oauth/google/upload-secret", {
        json: {
          jsonText: JSON.stringify({
            web: { client_id: "uploaded-client-id", client_secret: "uploaded-client-secret" }
          })
        }
      });
      assert.equal(secretRes.status, 200);
      assert.equal(secretRes.json.clientId, "uploaded-client-id");

      // Start YouTube OAuth (manual redirect to capture state)
      const startRes = await server.request("GET", "/api/oauth/youtube/start", { redirect: "manual" });
      assert.equal(startRes.status, 302);
      const loc = startRes.headers.get("location") || "";
      const state = new URL(loc).searchParams.get("state");
      assert.ok(state && state.length >= 16, "OAuth start must include state param");

      // Complete callback with valid state
      const cbRes = await server.request(
        "GET",
        `/api/oauth/youtube/callback?state=${encodeURIComponent(state)}&code=mock_auth_code`,
        { redirect: "manual" }
      );
      assert.equal(cbRes.status, 302);
      assert.match(cbRes.headers.get("location") || "", /\?oauth=success&platform=YOUTUBE/);

      const accsRes = await server.request("GET", "/api/social-accounts");
      assert.equal(accsRes.status, 200);
      const ytAcc = accsRes.json.accounts.find((a) => a.platform === "YOUTUBE");
      assert.ok(ytAcc, "YouTube account should be upserted");
      server.trackSocialAccount(ytAcc.id);

      // Upload, render, schedule & publish-now
      await server.request("POST", "/api/settings", {
        json: { llmProvider: "groq", whisperProvider: "groq" }
      });
      mockApi.addResponseOverride(
        { pathIncludes: "/chat/completions" },
        () => ({
          status: 200,
          body: {
            id: "chatcmpl-f5",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    clips: [
                      {
                        title: "F5 Clip",
                        description: "OAuth clip",
                        hashtags: "#shorts",
                        viralityScore: 90,
                        hookScore: 90,
                        pacingScore: 90,
                        storyScore: 90,
                        reason: "F5",
                        startSec: 0,
                        endSec: 5.5
                      }
                    ]
                  })
                },
                finish_reason: "stop"
              }
            ]
          }
        }),
        true
      );
      const upRes = await server.uploadMultipart(
        "/api/projects/upload",
        { title: "F5 Publish Project" },
        { video: { path: sampleVideoPath, filename: "f5.mp4", contentType: "video/mp4" } }
      );
      server.trackProject(upRes.json.id);

      const detail = await server.pollUntil(async () => {
        const r = await server.request("GET", `/api/projects/${upRes.json.id}`);
        return r.json?.project?.status === "ready" ? r.json : null;
      }, { timeoutMs: 30000, label: "F5 project ready" });

      const clipId = detail.clips[0].id;
      await server.request("POST", `/api/clips/${clipId}/render`, { json: { resolution: "720p", fps: 24 } });
      await server.pollUntil(async () => {
        const r = await server.request("GET", `/api/clips/${clipId}`);
        if (r.json?.clip?.exportStatus === "done") return r.json.clip;
        if (r.json?.clip?.exportStatus === "error") throw new Error(`F5 render error: ${r.json.clip.exportError}`);
        return null;
      }, { timeoutMs: 30000, label: "F5 clip rendered" });

      const schedRes = await server.request("POST", "/api/publish-schedules", {
        json: {
          clipId,
          accountId: ytAcc.id,
          platform: "YOUTUBE",
          title: "F5 Test Short",
          hashtags: "#shorts"
        }
      });
      assert.equal(schedRes.status, 201);
      server.trackSchedule(schedRes.json.schedule.id);

      const pubRes = await server.request("POST", `/api/publish-schedules/${schedRes.json.schedule.id}/publish-now`);
      assert.equal(pubRes.status, 200);
      assert.equal(pubRes.json.status, "PUBLISHED");
      assert.match(pubRes.json.publishedUrl || "", /youtube\.com\/shorts\/mock_yt_video_123/);

      // GET /api/publish-schedules, DELETE /api/publish-schedules/:id, DELETE /api/social-accounts/:id
      const listSched = await server.request("GET", "/api/publish-schedules");
      assert.equal(listSched.status, 200);
      assert.ok(listSched.json.schedules.some((s) => s.id === schedRes.json.schedule.id));

      const delSched = await server.request("DELETE", `/api/publish-schedules/${schedRes.json.schedule.id}`);
      assert.equal(delSched.status, 200);
      const listSchedAfter = await server.request("GET", "/api/publish-schedules");
      assert.equal(listSchedAfter.json.schedules.some((s) => s.id === schedRes.json.schedule.id), false);

      const delAcc = await server.request("DELETE", `/api/social-accounts/${ytAcc.id}`);
      assert.equal(delAcc.status, 200);
      const accsAfter = await server.request("GET", "/api/social-accounts");
      assert.equal(accsAfter.json.accounts.some((a) => a.id === ytAcc.id), false);

      // TikTok & Instagram OAuth start + callback (error without config, then 302 + callback with config)
      const tkUnconf = await server.request("GET", "/api/oauth/tiktok/start", { redirect: "manual" });
      assert.equal(tkUnconf.status, 400);
      const igUnconf = await server.request("GET", "/api/oauth/instagram/start", { redirect: "manual" });
      assert.equal(igUnconf.status, 400);

      await server.request("POST", "/api/oauth/config", {
        json: {
          tiktokClientKey: "mock-tk-key",
          tiktokClientSecret: "mock-tk-secret",
          metaAppId: "mock-meta-id",
          metaAppSecret: "mock-meta-secret"
        }
      });

      const tkStart = await server.request("GET", "/api/oauth/tiktok/start", { redirect: "manual" });
      assert.equal(tkStart.status, 302);
      const tkState = new URL(tkStart.headers.get("location") || "").searchParams.get("state");
      assert.ok(tkState && tkState.length >= 16);

      const tkBadCb = await server.request("GET", "/api/oauth/tiktok/callback?state=bad&code=abc", { redirect: "manual" });
      assert.equal(tkBadCb.status, 302);
      assert.match(tkBadCb.headers.get("location") || "", /\?oauth=error&platform=TIKTOK_BUSINESS/);

      const tkCb = await server.request(
        "GET",
        `/api/oauth/tiktok/callback?state=${encodeURIComponent(tkState)}&code=mock_tk_code`,
        { redirect: "manual" }
      );
      assert.equal(tkCb.status, 302);
      assert.match(tkCb.headers.get("location") || "", /\?oauth=success&platform=TIKTOK_BUSINESS/);

      const igStart = await server.request("GET", "/api/oauth/instagram/start", { redirect: "manual" });
      assert.equal(igStart.status, 302);
      const igState = new URL(igStart.headers.get("location") || "").searchParams.get("state");
      assert.ok(igState && igState.length >= 16);

      const igBadCb = await server.request("GET", "/api/oauth/instagram/callback?state=bad&code=abc", { redirect: "manual" });
      assert.equal(igBadCb.status, 302);
      assert.match(igBadCb.headers.get("location") || "", /\?oauth=error&platform=INSTAGRAM_BUSINESS/);

      const igCb = await server.request(
        "GET",
        `/api/oauth/instagram/callback?state=${encodeURIComponent(igState)}&code=mock_ig_code`,
        { redirect: "manual" }
      );
      assert.equal(igCb.status, 302);
      assert.match(igCb.headers.get("location") || "", /\?oauth=success&platform=INSTAGRAM_BUSINESS/);

      const socialAll = await server.request("GET", "/api/social-accounts");
      for (const a of socialAll.json.accounts) {
        if (a.platform === "TIKTOK_BUSINESS" || a.platform === "INSTAGRAM_BUSINESS") {
          server.trackSocialAccount(a.id);
        }
      }
    });
  });

  // =========================================================================
  // F6: Brand Kit Persistence & Wiring
  // =========================================================================
  describe("F6: Brand Kit Persistence & Wiring", () => {
    it("persists Brand Kit fields + logo PNG, wires to clip, serves logo, and deletes cleanly", async () => {
      const bkRes = await server.uploadMultipart(
        "/api/brand-kits",
        {
          name: "Tier1 Brand",
          primaryColor: "#112233",
          highlightColor: "#44FF55",
          secondaryColor: "#FF00AA",
          fontFamily: "DejaVu Sans",
          defaultPreset: "punch",
          watermarkPosition: "bottom-left",
          watermarkOpacity: "0.65"
        },
        { logo: { path: sampleLogoPath, filename: "logo.png", contentType: "image/png" } }
      );
      assert.equal(bkRes.status, 201);
      const kit = bkRes.json.kit;
      server.trackBrandKit(kit.id);

      assert.equal(kit.name, "Tier1 Brand");
      assert.equal(kit.primaryColor, "#112233");
      assert.equal(kit.highlightColor, "#44FF55");
      assert.equal(kit.secondaryColor, "#FF00AA");
      assert.equal(kit.watermarkPosition, "bottom-left");
      assert.equal(kit.watermarkOpacity, 0.65);

      const listRes = await server.request("GET", "/api/brand-kits");
      assert.equal(listRes.status, 200);
      assert.ok(listRes.json.kits.some((k) => k.id === kit.id));

      const logoRes = await server.request("GET", `/api/brand-kits/${kit.id}/logo`);
      assert.equal(logoRes.status, 200);
      assert.match(logoRes.headers.get("content-type") || "", /image\/png/);

      // Assign brandKitId to a clip via PATCH /api/clips/:id and verify persistence
      mockApi.addResponseOverride(
        { pathIncludes: "/chat/completions" },
        () => ({
          status: 200,
          body: {
            id: "chatcmpl-f6",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    clips: [
                      {
                        title: "F6 Branded Clip",
                        description: "Brand kit clip",
                        hashtags: "#shorts",
                        viralityScore: 90,
                        hookScore: 90,
                        pacingScore: 90,
                        storyScore: 90,
                        reason: "F6",
                        startSec: 0,
                        endSec: 5.5
                      }
                    ]
                  })
                },
                finish_reason: "stop"
              }
            ]
          }
        }),
        true
      );
      const bkProj = await server.uploadMultipart(
        "/api/projects/upload",
        { title: "F6 BrandKit Project" },
        { video: { path: sampleVideoPath, filename: "f6.mp4", contentType: "video/mp4" } }
      );
      assert.equal(bkProj.status, 201);
      server.trackProject(bkProj.json.id);

      const bkDetail = await server.pollUntil(async () => {
        const r = await server.request("GET", `/api/projects/${bkProj.json.id}`);
        return r.json?.project?.status === "ready" ? r.json : null;
      }, { timeoutMs: 30000, label: "F6 project ready" });

      const bkClipId = bkDetail.clips[0].id;
      const patchClip = await server.request("PATCH", `/api/clips/${bkClipId}`, {
        json: { brandKitId: kit.id }
      });
      assert.equal(patchClip.status, 200);
      assert.equal(patchClip.json.clip.brandKitId, kit.id);

      const getClip = await server.request("GET", `/api/clips/${bkClipId}`);
      assert.equal(getClip.status, 200);
      assert.equal(getClip.json.clip.brandKitId, kit.id);

      // Delete brand kit removes record and logo
      const delRes = await server.request("DELETE", `/api/brand-kits/${kit.id}`);
      assert.equal(delRes.status, 200);
      const logoAfter = await server.request("GET", `/api/brand-kits/${kit.id}/logo`);
      assert.equal(logoAfter.status, 404);
    });
  });

  // =========================================================================
  // F7: FFmpeg Progress Bar & Silence Removal
  // =========================================================================
  describe("F7: FFmpeg Progress Bar & Silence Removal", () => {
    it("renders with progress_bar=true and remove_silences=true with and without BGM", () => {
      const outProgress = path.join(tmpDir, "f7_progress.mp4");
      const r1 = runWorker("render_clip", {
        video_path: sampleVideoPath,
        out_path: outProgress,
        start_sec: 0,
        end_sec: 2.5,
        aspect_ratio: "9:16",
        resolution: "720p",
        fps: 24,
        progress_bar: true,
        caption_enabled: false
      });
      assert.ok(fs.existsSync(r1.exportPath));
      const p1 = probeMedia(outProgress);
      assert.equal(p1.hasVideo, true);
      assert.equal(p1.hasAudio, true);
      assert.equal(p1.width, 720);
      assert.equal(p1.height, 1280);

      // Silence removal without BGM
      const outSilentNoBgm = path.join(tmpDir, "f7_silent_nobgm.mp4");
      runWorker("render_clip", {
        video_path: silentGapVideoPath,
        out_path: outSilentNoBgm,
        start_sec: 0,
        end_sec: 3.5,
        aspect_ratio: "9:16",
        resolution: "720p",
        fps: 24,
        remove_silences: true,
        caption_enabled: false
      });
      const p2 = probeMedia(outSilentNoBgm);
      assert.equal(p2.hasVideo, true);
      assert.equal(p2.hasAudio, true);
      assert.ok(p2.duration < 3.2, `Expected silence removal to shorten duration, got ${p2.duration}`);

      // Silence removal WITH BGM
      const outSilentBgm = path.join(tmpDir, "f7_silent_bgm.mp4");
      runWorker("render_clip", {
        video_path: silentGapVideoPath,
        out_path: outSilentBgm,
        start_sec: 0,
        end_sec: 3.5,
        aspect_ratio: "9:16",
        resolution: "720p",
        fps: 24,
        remove_silences: true,
        bgm_path: sampleBgmPath,
        bgm_volume: 0.25,
        bgm_ducking: true,
        caption_enabled: false
      });
      const p3 = probeMedia(outSilentBgm);
      assert.equal(p3.hasVideo, true);
      assert.equal(p3.hasAudio, true);
    });
  });

  // =========================================================================
  // F8: AI Emojis & Brand Kit Rendering
  // =========================================================================
  describe("F8: AI Emojis & Brand Kit Rendering", () => {
    it("enriches words with AI emojis via API and renders with Brand Kit watermark & colors", async () => {
      mockApi.reset();
      await server.request("POST", "/api/settings", {
        json: { llmProvider: "groq", whisperProvider: "groq" }
      });
      mockApi.addResponseOverride(
        { pathIncludes: "/chat/completions" },
        () => ({
          status: 200,
          body: {
            id: "chatcmpl-f8",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    clips: [
                      {
                        title: "F8 Clip",
                        description: "Emoji clip",
                        hashtags: "#shorts",
                        viralityScore: 90,
                        hookScore: 90,
                        pacingScore: 90,
                        storyScore: 90,
                        reason: "F8",
                        startSec: 0,
                        endSec: 5.5
                      }
                    ]
                  })
                },
                finish_reason: "stop"
              }
            ]
          }
        }),
        true
      );

      const upRes = await server.uploadMultipart(
        "/api/projects/upload",
        { title: "F8 Emoji Project" },
        { video: { path: sampleVideoPath, filename: "f8.mp4", contentType: "video/mp4" } }
      );
      server.trackProject(upRes.json.id);

      const detail = await server.pollUntil(async () => {
        const r = await server.request("GET", `/api/projects/${upRes.json.id}`);
        return r.json?.project?.status === "ready" ? r.json : null;
      }, { timeoutMs: 30000, label: "F8 project ready" });

      const clipId = detail.clips[0].id;
      await server.request("PATCH", `/api/clips/${clipId}`, {
        json: {
          words: [
            { text: "dinheiro", start: 0.1, end: 0.6 },
            { text: "fogo", start: 0.7, end: 1.2 },
            { text: "segredo", start: 1.3, end: 1.8 }
          ]
        }
      });

      const emRes = await server.request("POST", `/api/clips/${clipId}/ai-emojis`);
      assert.equal(emRes.status, 200);
      assert.equal(emRes.json.words[0].emoji, "💰");
      assert.equal(emRes.json.words[1].emoji, "🔥");
      assert.equal(emRes.json.words[2].emoji, "🔐");

      const outPath = path.join(tmpDir, "f8_brandkit_emoji.mp4");
      runWorker("render_clip", {
        video_path: sampleVideoPath,
        out_path: outPath,
        start_sec: 0,
        end_sec: 2.5,
        aspect_ratio: "9:16",
        resolution: "720p",
        fps: 24,
        caption_enabled: true,
        words: emRes.json.words,
        watermark_path: sampleLogoPath,
        watermark_position: "bottom-right",
        watermark_opacity: 0.4,
        brand_kit: {
          primaryColor: "#FFFFFF",
          highlightColor: "#04F827",
          secondaryColor: "#FF37B9",
          fontFamily: "DejaVu Sans",
          watermarkPosition: "bottom-right",
          watermarkOpacity: 0.4
        }
      });
      const probed = probeMedia(outPath);
      assert.equal(probed.hasVideo, true);
      assert.equal(probed.hasAudio, true);
    });
  });

  // =========================================================================
  // F9: Multi-Panel Layouts & AutoColor
  // =========================================================================
  describe("F9: Multi-Panel Layouts & AutoColor", () => {
    it("renders three, four, split, fill, and fit layouts with AutoColor filters", () => {
      const layouts = ["three", "four", "split", "fill", "fit"];
      for (const layoutMode of layouts) {
        const outPath = path.join(tmpDir, `f9_${layoutMode}.mp4`);
        runWorker("render_clip", {
          video_path: sampleVideoPath,
          out_path: outPath,
          start_sec: 0,
          end_sec: 1.8,
          aspect_ratio: "9:16",
          resolution: "720p",
          fps: 24,
          layout_mode: layoutMode,
          caption_enabled: false,
          auto_color: {
            enabled: true,
            sharpen: 0.6,
            denoise: 0.5,
            deblock: true,
            glow: 0.5
          }
        });
        const probed = probeMedia(outPath);
        assert.equal(probed.hasVideo, true, `${layoutMode} must produce video`);
        assert.equal(probed.hasAudio, true, `${layoutMode} must produce audio`);
        assert.equal(probed.width, 720, `${layoutMode} width`);
        assert.equal(probed.height, 1280, `${layoutMode} height`);
      }
    });
  });

  // =========================================================================
  // F10: AI B-Roll & Translate/Dubbing Workflows
  // =========================================================================
  describe("F10: AI B-Roll & Translate/Dubbing Workflows", () => {
    it("exposes builtin:ai-broll and builtin:translate-dubbing and executes translate + Giphy workflow", async () => {
      mockApi.reset();
      const wfRes = await server.request("GET", "/api/workflows");
      assert.equal(wfRes.status, 200);
      const ids = wfRes.json.workflows.map((w) => w.id);
      assert.ok(ids.includes("builtin:ai-broll"));
      assert.ok(ids.includes("builtin:translate-dubbing"));

      await server.request("POST", "/api/settings", {
        json: { llmProvider: "groq", whisperProvider: "groq", giphyApiKey: "mock_giphy_key" }
      });
      const kRes = await server.request("POST", "/api/keys", {
        json: { provider: "groq", label: "F10Key", keysText: "gsk_tier1_f10_key_12345" }
      });
      server.trackKey(kRes.json.keys.find((k) => k.label === "F10Key")?.id);
      mockApi.addResponseOverride(
        { pathIncludes: "/chat/completions" },
        () => ({
          status: 200,
          body: {
            id: "chatcmpl-f10",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    clips: [
                      {
                        title: "F10 Clip",
                        description: "B-Roll clip",
                        hashtags: "#shorts",
                        viralityScore: 90,
                        hookScore: 90,
                        pacingScore: 90,
                        storyScore: 90,
                        reason: "F10",
                        startSec: 0,
                        endSec: 5.5
                      }
                    ]
                  })
                },
                finish_reason: "stop"
              }
            ]
          }
        }),
        true
      );

      const upRes = await server.uploadMultipart(
        "/api/projects/upload",
        { title: "F10 B-Roll", workflowId: "builtin:ai-broll" },
        { video: { path: sampleVideoPath, filename: "f10.mp4", contentType: "video/mp4" } }
      );
      server.trackProject(upRes.json.id);

      const detail = await server.pollUntil(async () => {
        const r = await server.request("GET", `/api/projects/${upRes.json.id}`);
        return r.json?.project?.status === "ready" ? r.json : null;
      }, { timeoutMs: 30000, label: "F10 project ready" });

      assert.equal(detail.project.workflowId, "builtin:ai-broll");
      assert.ok(detail.clips.length >= 1);

      const clipId = detail.clips[0].id;
      const wordCount = detail.clips[0].words.length;
      mockApi.addResponseOverride(
        { pathIncludes: "/chat/completions" },
        () => ({
          status: 200,
          body: {
            id: "chatcmpl-tr",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    words: Array.from({ length: wordCount }, (_, i) => `Hola_${i}`)
                  })
                },
                finish_reason: "stop"
              }
            ]
          }
        }),
        true
      );

      const trRes = await server.request("POST", `/api/clips/${clipId}/translate`, {
        json: { targetLang: "Spanish" }
      });
      assert.equal(trRes.status, 200);
      assert.equal(trRes.json.words[0].text, "Hola_0");

      // Also test workflowId: "builtin:translate-dubbing" on project upload
      mockApi.addResponseOverride(
        { pathIncludes: "/chat/completions" },
        () => ({
          status: 200,
          body: {
            id: "chatcmpl-f10-td",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    clips: [
                      {
                        title: "F10 Translate Dubbing Clip",
                        description: "Dubbing clip",
                        hashtags: "#shorts",
                        viralityScore: 91,
                        hookScore: 90,
                        pacingScore: 89,
                        storyScore: 90,
                        reason: "F10 dubbing",
                        startSec: 0,
                        endSec: 5.5
                      }
                    ]
                  })
                },
                finish_reason: "stop"
              }
            ]
          }
        }),
        true
      );
      const tdRes = await server.uploadMultipart(
        "/api/projects/upload",
        { title: "F10 Translate Dubbing", workflowId: "builtin:translate-dubbing" },
        { video: { path: sampleVideoPath, filename: "f10td.mp4", contentType: "video/mp4" } }
      );
      assert.equal(tdRes.status, 201);
      server.trackProject(tdRes.json.id);

      const tdDetail = await server.pollUntil(async () => {
        const r = await server.request("GET", `/api/projects/${tdRes.json.id}`);
        return r.json?.project?.status === "ready" ? r.json : null;
      }, { timeoutMs: 30000, label: "F10 translate-dubbing ready" });

      assert.equal(tdDetail.project.workflowId, "builtin:translate-dubbing");
      assert.ok(tdDetail.clips.length >= 1);
    });
  });

  // =========================================================================
  // F11: Frontend Typecheck, OAuth Routing & Error States
  // =========================================================================
  describe("F11: Frontend Typecheck, OAuth Routing & Error States", () => {
    it("serves SPA for OAuth success/error query routes and passes TypeScript typecheck", async () => {
      const okRoute = await server.request("GET", "/?oauth=success&platform=youtube&msg=ok");
      assert.equal(okRoute.status, 200);
      assert.match(okRoute.headers.get("content-type") || "", /text\/html/i);

      const errRoute = await server.request("GET", "/?oauth=error&platform=youtube&msg=denied");
      assert.equal(errRoute.status, 200);
      assert.match(errRoute.headers.get("content-type") || "", /text\/html/i);

      const spaFallback = await server.request("GET", "/editor/C_123");
      assert.equal(spaFallback.status, 200);

      const tsconfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "app/web/tsconfig.json"), "utf8"));
      assert.ok(tsconfig.compilerOptions);

      // Run npm --prefix app/web run typecheck
      execFileSync("npm", ["--prefix", path.join(REPO_ROOT, "app/web"), "run", "typecheck"], {
        cwd: REPO_ROOT,
        stdio: "pipe"
      });
    });
  });

  // =========================================================================
  // F12: EditorView Controls Contract
  // =========================================================================
  describe("F12: EditorView Controls Contract", () => {
    it("persists captionConfig.fontSize, autoColor.deblock/glow, layoutMode three/four, and BGM attach/delete", async () => {
      mockApi.reset();
      const presetsRes = await server.request("GET", "/api/fancy-template-presets");
      assert.equal(presetsRes.status, 200);
      assert.ok(Array.isArray(presetsRes.json?.presets) && presetsRes.json.presets.length > 0);

      await server.request("POST", "/api/settings", {
        json: { llmProvider: "groq", whisperProvider: "groq" }
      });
      mockApi.addResponseOverride(
        { pathIncludes: "/chat/completions" },
        () => ({
          status: 200,
          body: {
            id: "chatcmpl-f12",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    clips: [
                      {
                        title: "F12 Clip",
                        description: "Editor clip",
                        hashtags: "#shorts",
                        viralityScore: 90,
                        hookScore: 90,
                        pacingScore: 90,
                        storyScore: 90,
                        reason: "F12",
                        startSec: 0,
                        endSec: 5.5
                      }
                    ]
                  })
                },
                finish_reason: "stop"
              }
            ]
          }
        }),
        true
      );

      const upRes = await server.uploadMultipart(
        "/api/projects/upload",
        { title: "F12 Editor Controls" },
        { video: { path: sampleVideoPath, filename: "f12.mp4", contentType: "video/mp4" } }
      );
      server.trackProject(upRes.json.id);

      const detail = await server.pollUntil(async () => {
        const r = await server.request("GET", `/api/projects/${upRes.json.id}`);
        return r.json?.project?.status === "ready" ? r.json : null;
      }, { timeoutMs: 30000, label: "F12 project ready" });

      const clipId = detail.clips[0].id;

      // PATCH layoutMode=three, fontSize, deblock, glow
      const p1 = await server.request("PATCH", `/api/clips/${clipId}`, {
        json: {
          layoutMode: "three",
          captionConfig: { fontSize: 64 },
          autoColor: { enabled: true, deblock: true, glow: 0.4, sharpen: 0.3, denoise: 0.2 }
        }
      });
      assert.equal(p1.status, 200);
      assert.equal(p1.json.clip.layoutMode, "three");
      assert.equal(p1.json.clip.captionConfig.fontSize, 64);
      assert.equal(p1.json.clip.autoColor.deblock, true);
      assert.equal(p1.json.clip.autoColor.glow, 0.4);

      // PATCH layoutMode=four
      const p2 = await server.request("PATCH", `/api/clips/${clipId}`, {
        json: { layoutMode: "four" }
      });
      assert.equal(p2.status, 200);
      assert.equal(p2.json.clip.layoutMode, "four");

      // Attach BGM & Delete BGM
      const bgmAdd = await server.uploadMultipart(
        `/api/clips/${clipId}/bgm`,
        { volume: "0.3", ducking: "true" },
        { audio: { path: sampleBgmPath, filename: "bgm.wav", contentType: "audio/wav" } }
      );
      assert.equal(bgmAdd.status, 200);
      assert.ok(bgmAdd.json.clip.tracks.some((t) => t.type === "bgm"));

      const bgmDel = await server.request("DELETE", `/api/clips/${clipId}/bgm`);
      assert.equal(bgmDel.status, 200);
      assert.equal(bgmDel.json.clip.tracks.some((t) => t.type === "bgm"), false);
    });
  });

  // =========================================================================
  // F13: Settings & Dashboard Polling
  // =========================================================================
  describe("F13: Settings & Dashboard Polling", () => {
    it("persists settings with masked API key and exposes dashboard polling fields", async () => {
      const saveRes = await server.request("POST", "/api/settings", {
        json: {
          llmProvider: "openai",
          llmModel: "gpt-4o-mini",
          llmApiKey: "sk-test-secret-key-987654",
          whisperProvider: "groq",
          whisperModel: "whisper-large-v3",
          giphyApiKey: "giphy-test-key-123"
        }
      });
      assert.equal(saveRes.status, 200);
      assert.equal(saveRes.json.settings.hasApiKey, true);
      assert.equal(saveRes.json.settings.llmApiKey, undefined);
      assert.match(saveRes.json.settings.llmApiKeyMasked, /^sk-tes\.\.\.7654$/);

      const getRes = await server.request("GET", "/api/settings");
      assert.equal(getRes.status, 200);
      assert.equal(getRes.json.llmProvider, "openai");
      assert.equal(getRes.json.llmModel, "gpt-4o-mini");
      assert.equal(getRes.json.whisperProvider, "groq");
      assert.equal(getRes.json.whisperModel, "whisper-large-v3");
      assert.equal(getRes.json.giphyApiKey, "giphy-test-key-123");
      assert.equal(getRes.json.llmApiKey, undefined);

      const projList = await server.request("GET", "/api/projects");
      assert.equal(projList.status, 200);
      assert.ok(Array.isArray(projList.json.projects));
    });
  });

  // =========================================================================
  // F14: Docker & Deployment Alignment
  // =========================================================================
  describe("F14: Docker & Deployment Alignment", () => {
    it("aligns Dockerfile and docker-compose.yml with port 3000, server entrypoint, and runtime deps", () => {
      const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile"), "utf8");
      const compose = fs.readFileSync(path.join(REPO_ROOT, "docker-compose.yml"), "utf8");

      assert.match(dockerfile, /EXPOSE\s+3000/);
      assert.match(dockerfile, /CMD\s+\["node",\s*"\/studio\/app\/server\/index\.js"\]/);
      assert.match(dockerfile, /ffmpeg/);
      assert.match(dockerfile, /python3/);
      assert.match(dockerfile, /faster-whisper/);

      assert.match(compose, /3000:3000/);
      assert.match(compose, /PORT=3000/);
    });
  });
});
