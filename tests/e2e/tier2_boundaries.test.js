/**
 * Tier 2: Boundary & Corner Cases E2E Tests
 * Opaque-box tests using Node 22 node:test + node:assert/strict.
 * Verifies >= 5 boundary, invalid input, error handling, and corner cases per feature group.
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

describe("Tier 2: Boundary & Corner Cases", () => {
  let mockApi;
  let server;
  let tmpDir;
  let sampleVideoPath;
  let sampleLogoPath;
  let readyProjectId;
  let readyClipId;

  before(async () => {
    tmpDir = createTempDir("opus2short-tier2-");
    sampleVideoPath = createTestVideo(path.join(tmpDir, "sample.mp4"), {
      duration: 6,
      width: 640,
      height: 360,
      fps: 24
    });
    sampleLogoPath = createTestPng(path.join(tmpDir, "logo.png"));

    mockApi = createMockApiServer();
    await mockApi.start();
    server = await startServer({ mockApiUrl: mockApi.url });
    const origRequest = server.request;
    server.request = (method, reqPath, reqOpts = {}) =>
      origRequest(method, reqPath, {
        ...reqOpts,
        headers: { Connection: "close", ...(reqOpts.headers || {}) }
      });

    // Create one ready project + rendered clip for shared boundary tests
    await server.request("POST", "/api/settings", {
      json: { llmProvider: "groq", whisperProvider: "groq", clearApiKey: true }
    });
    const kRes = await server.request("POST", "/api/keys", {
      json: { provider: "groq", label: "T2SharedKey", keysText: "gsk_tier2_shared_key_12345" }
    });
    server.trackKey(kRes.json.keys.find((k) => k.label === "T2SharedKey")?.id);
    mockApi.addResponseOverride(
      { pathIncludes: "/chat/completions" },
      () => ({
        status: 200,
        body: {
          id: "chatcmpl-t2-shared",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify({
                  clips: [
                    {
                      title: "T2 Shared Clip",
                      description: "Boundary test clip",
                      hashtags: "#shorts",
                      viralityScore: 90,
                      hookScore: 90,
                      pacingScore: 90,
                      storyScore: 90,
                      reason: "T2",
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
      { title: "T2 Shared Project" },
      { video: { path: sampleVideoPath, filename: "t2.mp4", contentType: "video/mp4" } }
    );
    readyProjectId = upRes.json.id;
    server.trackProject(readyProjectId);

    const detail = await server.pollUntil(async () => {
      const r = await server.request("GET", `/api/projects/${readyProjectId}`);
      return r.json?.project?.status === "ready" ? r.json : null;
    }, { timeoutMs: 30000, label: "T2 shared project ready" });

    readyClipId = detail.clips[0].id;
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
  // Group 1: Settings & Multi-Key Pool Boundaries
  // =========================================================================
  describe("Group 1: Settings & API Keys Boundaries", () => {
    it("rejects empty or too-short keysText with 400", async () => {
      const r1 = await server.request("POST", "/api/keys", {
        json: { provider: "groq", keysText: "" }
      });
      assert.equal(r1.status, 400);

      const r2 = await server.request("POST", "/api/keys", {
        json: { provider: "groq", keysText: "short" }
      });
      assert.equal(r2.status, 400);
    });

    it("preserves existing llmApiKey on empty string unless clearApiKey=true", async () => {
      const s1 = await server.request("POST", "/api/settings", {
        json: { llmApiKey: "sk-boundary-keep-123456" }
      });
      assert.equal(s1.status, 200);
      assert.equal(s1.json.settings.hasApiKey, true);

      const s2 = await server.request("POST", "/api/settings", {
        json: { llmApiKey: "", unknownFieldShouldBeIgnored: "abc" }
      });
      assert.equal(s2.status, 200);
      assert.equal(s2.json.settings.hasApiKey, true);
      assert.equal(s2.json.settings.unknownFieldShouldBeIgnored, undefined);

      const s3 = await server.request("POST", "/api/settings", {
        json: { clearApiKey: true }
      });
      assert.equal(s3.status, 200);
      assert.equal(s3.json.settings.hasApiKey, false);
      assert.equal(s3.json.settings.llmApiKeyMasked, "");
    });

    it("handles PATCH/DELETE on nonexistent key ID without 500", async () => {
      const p = await server.request("PATCH", "/api/keys/KEY_DOES_NOT_EXIST", {
        json: { enabled: false }
      });
      assert.ok(p.status < 500);

      const d = await server.request("DELETE", "/api/keys/KEY_DOES_NOT_EXIST");
      assert.ok(d.status < 500);
    });
  });

  // =========================================================================
  // Group 2: Projects, Clips & Upload Boundaries
  // =========================================================================
  describe("Group 2: Projects, Clips & Upload Boundaries", () => {
    it("returns 400 for upload without video file and invalid youtube URL", async () => {
      const upNoFile = await server.uploadMultipart("/api/projects/upload", { title: "No File" }, {});
      assert.equal(upNoFile.status, 400);

      const ytEmpty = await server.request("POST", "/api/projects/youtube", { json: {} });
      assert.equal(ytEmpty.status, 400);

      const ytEmptyStr = await server.request("POST", "/api/projects/youtube", { json: { url: "" } });
      assert.equal(ytEmptyStr.status, 400);

      const ytBadUrl = await server.request("POST", "/api/projects/youtube", {
        json: { url: "not-a-valid-url" }
      });
      assert.equal(ytBadUrl.status, 400);
    });

    it("returns 404 for nonexistent project and clip endpoints", async () => {
      assert.equal((await server.request("GET", "/api/projects/P_NOPE")).status, 404);
      assert.equal((await server.request("GET", "/api/projects/P_NOPE/video")).status, 404);
      assert.equal((await server.request("GET", "/api/projects/P_NOPE/thumb")).status, 404);
      assert.equal((await server.request("GET", "/api/clips/C_NOPE")).status, 404);
      assert.equal((await server.request("PATCH", "/api/clips/C_NOPE", { json: { title: "x" } })).status, 404);
      assert.equal((await server.request("POST", "/api/clips/C_NOPE/render", { json: {} })).status, 404);
      assert.equal((await server.request("POST", "/api/clips/C_NOPE/ai-emojis")).status, 404);
      assert.equal((await server.request("POST", "/api/clips/C_NOPE/translate", { json: { targetLang: "en" } })).status, 404);
    });

    it("returns 400 for empty chat message and 404 for nonexistent project chat", async () => {
      const emptyChat = await server.request("POST", `/api/projects/${readyProjectId}/chat`, {
        json: { message: "" }
      });
      assert.equal(emptyChat.status, 400);

      const missingProjChat = await server.request("POST", "/api/projects/P_NOPE/chat", {
        json: { message: "hello" }
      });
      assert.equal(missingProjChat.status, 404);
    });
  });

  // =========================================================================
  // Group 3: Range Streaming & Safe JSON Boundaries
  // =========================================================================
  describe("Group 3: Range Streaming & Safe JSON Boundaries", () => {
    it("returns 416 for out-of-bounds and malformed Range headers, and 404 for unrendered clip download", async () => {
      const unrendered = await server.request("GET", `/api/clips/${readyClipId}/download`);
      assert.equal(unrendered.status, 404);

      const oobRange = await server.request("GET", `/api/projects/${readyProjectId}/video`, {
        headers: { Range: "bytes=999999999-" }
      });
      assert.equal(oobRange.status, 416);
      assert.match(oobRange.headers.get("content-range") || "", /^bytes \*\/\d+$/);

      const badRange = await server.request("GET", `/api/projects/${readyProjectId}/video`, {
        headers: { Range: "bytes=abc" }
      });
      assert.equal(badRange.status, 416);

      const zeroSuffix = await server.request("GET", `/api/projects/${readyProjectId}/video`, {
        headers: { Range: "bytes=-0" }
      });
      assert.equal(zeroSuffix.status, 416);
    });

    it("handles malformed garbage JSON from LLM in /translate without crashing server", async () => {
      mockApi.addResponseOverride(
        { pathIncludes: "/chat/completions" },
        () => ({
          status: 200,
          body: {
            id: "chatcmpl-garbage",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "NOT VALID JSON AT ALL {{{ !!" },
                finish_reason: "stop"
              }
            ]
          }
        }),
        true
      );

      const trRes = await server.request("POST", `/api/clips/${readyClipId}/translate`, {
        json: { targetLang: "French" }
      });
      assert.ok(trRes.status === 400 || trRes.status === 500);
      assert.ok(trRes.json && typeof trRes.json.error === "string");

      // /translate with missing targetLang defaults gracefully without 500
      const clipDetail = await server.request("GET", `/api/clips/${readyClipId}`);
      const wordCount = clipDetail.json.clip.words.length;
      mockApi.addResponseOverride(
        { pathIncludes: "/chat/completions" },
        () => ({
          status: 200,
          body: {
            id: "chatcmpl-missing-lang",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    words: Array.from({ length: wordCount }, (_, i) => `word_${i}`)
                  })
                },
                finish_reason: "stop"
              }
            ]
          }
        }),
        true
      );
      const missingLangRes = await server.request("POST", `/api/clips/${readyClipId}/translate`, {
        json: {}
      });
      assert.equal(missingLangRes.status, 200);
      assert.ok(Array.isArray(missingLangRes.json.words));

      // Verify server is still healthy
      const health = await server.request("GET", "/api/workflows");
      assert.equal(health.status, 200);
    });
  });

  // =========================================================================
  // Group 4: OAuth Security & PlanSocial Boundaries
  // =========================================================================
  describe("Group 4: OAuth Security & PlanSocial Boundaries", () => {
    it("rejects missing and tampered OAuth state, and upserts without duplicating accounts", async () => {
      await server.request("POST", "/api/oauth/config", {
        json: { googleClientId: "t2-cid", googleClientSecret: "t2-csec" }
      });

      // Missing state
      const noState = await server.request("GET", "/api/oauth/youtube/callback?code=abc", {
        redirect: "manual"
      });
      assert.equal(noState.status, 302);
      assert.match(noState.headers.get("location") || "", /\?oauth=error/);

      // Tampered state
      const badState = await server.request("GET", "/api/oauth/youtube/callback?state=tampered_state_123&code=abc", {
        redirect: "manual"
      });
      assert.equal(badState.status, 302);
      assert.match(badState.headers.get("location") || "", /\?oauth=error/);

      // Two valid callbacks -> should upsert, not create duplicate YOUTUBE account
      for (let i = 0; i < 2; i++) {
        const start = await server.request("GET", "/api/oauth/youtube/start", { redirect: "manual" });
        const st = new URL(start.headers.get("location")).searchParams.get("state");
        const cb = await server.request(
          "GET",
          `/api/oauth/youtube/callback?state=${encodeURIComponent(st)}&code=code_${i}`,
          { redirect: "manual" }
        );
        assert.equal(cb.status, 302);
        assert.match(cb.headers.get("location") || "", /\?oauth=success/);
      }

      const accs = await server.request("GET", "/api/social-accounts");
      const ytAccs = accs.json.accounts.filter((a) => a.platform === "YOUTUBE");
      for (const a of ytAccs) server.trackSocialAccount(a.id);
      assert.equal(ytAccs.length, 1, "Repeated OAuth callback must upsert without duplicating account");
    });

    it("rejects invalid client_secret JSON and handles nonexistent/non-YouTube publish schedules cleanly", async () => {
      const badSecret = await server.request("POST", "/api/oauth/google/upload-secret", {
        json: { jsonText: "{not valid json" }
      });
      assert.equal(badSecret.status, 400);

      const badClipSched = await server.request("POST", "/api/publish-schedules", {
        json: { clipId: "C_DOES_NOT_EXIST", platform: "YOUTUBE", title: "Test" }
      });
      assert.equal(badClipSched.status, 404);

      const missingPub = await server.request("POST", "/api/publish-schedules/PS_NOPE/publish-now");
      assert.equal(missingPub.status, 404);

      // Non-YouTube account publish-now returns FAILED cleanly
      const tkAccRes = await server.request("POST", "/api/social-accounts", {
        json: { platform: "TIKTOK_BUSINESS", accountName: "Mock TikTok", accessToken: "tk_tok_123" }
      });
      assert.equal(tkAccRes.status, 201);
      server.trackSocialAccount(tkAccRes.json.account.id);

      const tkSched = await server.request("POST", "/api/publish-schedules", {
        json: { clipId: readyClipId, accountId: tkAccRes.json.account.id, platform: "TIKTOK_BUSINESS", title: "TK" }
      });
      server.trackSchedule(tkSched.json.schedule.id);

      const tkPub = await server.request("POST", `/api/publish-schedules/${tkSched.json.schedule.id}/publish-now`);
      assert.equal(tkPub.status, 200);
      assert.equal(tkPub.json.status, "FAILED");
      assert.ok(tkPub.json.error);
    });
  });

  // =========================================================================
  // Group 5: Brand Kits, Editor Controls & BGM Boundaries
  // =========================================================================
  describe("Group 5: Brand Kits, Editor Controls & BGM Boundaries", () => {
    it("clamps watermarkOpacity boundaries (0, 1.0, <0, >1) and returns 404 for missing logo", async () => {
      const cases = [
        { input: "0", expected: 0 },
        { input: "1.0", expected: 1 },
        { input: "-0.5", expected: 0 },
        { input: "2.5", expected: 1 }
      ];
      for (const c of cases) {
        const res = await server.uploadMultipart(
          "/api/brand-kits",
          { name: `Opacity ${c.input}`, watermarkOpacity: c.input },
          { logo: { path: sampleLogoPath, filename: "logo.png", contentType: "image/png" } }
        );
        assert.equal(res.status, 201);
        server.trackBrandKit(res.json.kit.id);
        assert.equal(res.json.kit.watermarkOpacity, c.expected);
      }

      const missingLogo = await server.request("GET", "/api/brand-kits/BK_NOPE/logo");
      assert.equal(missingLogo.status, 404);
    });

    it("handles DELETE/POST BGM boundaries and invalid clip timestamps cleanly", async () => {
      // DELETE BGM when none attached
      const delNone = await server.request("DELETE", `/api/clips/${readyClipId}/bgm`);
      assert.equal(delNone.status, 200);

      // POST BGM without file -> 400; nonexistent clip -> 404
      const postNoFile = await server.uploadMultipart(`/api/clips/${readyClipId}/bgm`, {}, {});
      assert.equal(postNoFile.status, 400);

      const postMissingClip = await server.uploadMultipart("/api/clips/C_NOPE/bgm", {}, {});
      assert.equal(postMissingClip.status, 404);

      // PATCH clip with startSec >= endSec or negative timestamps should not 500 crash
      const negPatch = await server.request("PATCH", `/api/clips/${readyClipId}`, {
        json: { startSec: -5, endSec: -1 }
      });
      assert.ok(negPatch.status < 500);

      const invertedPatch = await server.request("PATCH", `/api/clips/${readyClipId}`, {
        json: { startSec: 5, endSec: 2 }
      });
      assert.ok(invertedPatch.status < 500);

      // Non-audio BGM upload (.txt buffer) should not crash server
      const txtBgm = await server.uploadMultipart(
        `/api/clips/${readyClipId}/bgm`,
        {},
        {
          audio: {
            buffer: Buffer.from("plain text not audio"),
            filename: "not_audio.txt",
            contentType: "text/plain"
          }
        }
      );
      assert.ok(txtBgm.status < 500);
      await server.request("DELETE", `/api/clips/${readyClipId}/bgm`);

      // Restore valid timestamps on shared clip
      await server.request("PATCH", `/api/clips/${readyClipId}`, {
        json: { startSec: 0, endSec: 2.5 }
      });
    });
  });

  // =========================================================================
  // Group 6: Worker & AI B-Roll / Giphy Fallbacks
  // =========================================================================
  describe("Group 6: Worker & AI B-Roll Fallbacks", () => {
    it("handles Giphy 500 and empty Giphy results gracefully during builtin:ai-broll", async () => {
      await server.request("POST", "/api/settings", {
        json: { llmProvider: "groq", whisperProvider: "groq", giphyApiKey: "mock_giphy" }
      });

      mockApi.addFailure({
        host: "api.giphy.com",
        path: "/v1/gifs/search",
        status: 500,
        once: true,
        body: { error: "Giphy internal error" }
      });
      mockApi.addResponseOverride(
        { pathIncludes: "/chat/completions" },
        () => ({
          status: 200,
          body: {
            id: "chatcmpl-t2-giphy",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    clips: [
                      {
                        title: "T2 Giphy Clip",
                        description: "Giphy fallback clip",
                        hashtags: "#shorts",
                        viralityScore: 90,
                        hookScore: 90,
                        pacingScore: 90,
                        storyScore: 90,
                        reason: "T2",
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
        { title: "T2 Giphy 500", workflowId: "builtin:ai-broll" },
        { video: { path: sampleVideoPath, filename: "giphy500.mp4", contentType: "video/mp4" } }
      );
      assert.equal(upRes.status, 201);
      server.trackProject(upRes.json.id);

      const detail = await server.pollUntil(async () => {
        const r = await server.request("GET", `/api/projects/${upRes.json.id}`);
        return r.json?.project?.status === "ready" ? r.json : null;
      }, { timeoutMs: 30000, label: "T2 Giphy 500 project ready" });
      assert.ok(detail.clips.length >= 1);

      // Empty Giphy results ({ data: [] }) during builtin:ai-broll
      mockApi.addResponseOverride(
        { host: "api.giphy.com", path: "/v1/gifs/search" },
        () => ({
          status: 200,
          body: { data: [], pagination: { total_count: 0, count: 0, offset: 0 }, meta: { status: 200, msg: "OK" } }
        }),
        true
      );
      mockApi.addResponseOverride(
        { pathIncludes: "/chat/completions" },
        () => ({
          status: 200,
          body: {
            id: "chatcmpl-t2-giphy-empty",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    clips: [
                      {
                        title: "T2 Giphy Empty Clip",
                        description: "Empty giphy fallback clip",
                        hashtags: "#shorts",
                        viralityScore: 90,
                        hookScore: 90,
                        pacingScore: 90,
                        storyScore: 90,
                        reason: "T2 empty giphy",
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

      const upEmpty = await server.uploadMultipart(
        "/api/projects/upload",
        { title: "T2 Giphy Empty", workflowId: "builtin:ai-broll" },
        { video: { path: sampleVideoPath, filename: "giphyempty.mp4", contentType: "video/mp4" } }
      );
      assert.equal(upEmpty.status, 201);
      server.trackProject(upEmpty.json.id);

      const detailEmpty = await server.pollUntil(async () => {
        const r = await server.request("GET", `/api/projects/${upEmpty.json.id}`);
        return r.json?.project?.status === "ready" ? r.json : null;
      }, { timeoutMs: 30000, label: "T2 Giphy empty project ready" });
      assert.ok(detailEmpty.clips.length >= 1);
    });

    it("handles unknown layout_mode, all-false auto_color, and empty words in render_clip", () => {
      const out1 = path.join(tmpDir, "t2_unknown_layout.mp4");
      runWorker("render_clip", {
        video_path: sampleVideoPath,
        out_path: out1,
        start_sec: 0,
        end_sec: 1.5,
        aspect_ratio: "9:16",
        resolution: "720p",
        fps: 24,
        layout_mode: "nonexistent_layout",
        caption_enabled: true,
        words: [],
        auto_color: { enabled: false, sharpen: 0, denoise: 0, deblock: false, glow: 0 }
      });
      const probed = probeMedia(out1);
      assert.equal(probed.hasVideo, true);
      assert.equal(probed.hasAudio, true);
      assert.equal(probed.width, 720);
      assert.equal(probed.height, 1280);
    });
  });
});
