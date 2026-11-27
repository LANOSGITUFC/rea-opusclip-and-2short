/**
 * Tier 3 E2E Tests: Cross-Feature Pairwise Combinations
 * Tests pairwise combinations across rendering, Brand Kits, audio/silence,
 * key-pool failover + AI workflows, and OAuth + PlanSocial publishing.
 */
"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { REPO_ROOT, FatalPollError, startServer } = require("./helpers/harness");
const {
  createTempDir,
  removeDir,
  createTestVideo,
  createTestAudio,
  createTestPng,
  probeMedia
} = require("./helpers/fixtures");
const { createMockApiServer } = require("./helpers/mock-apis");

const WORKER_SCRIPT = path.join(REPO_ROOT, "app/worker/pipeline.py");

function runWorkerRenderClip(payload) {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [WORKER_SCRIPT, "render_clip"], {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      const lines = stdout.trim().split("\n").filter(Boolean);
      const lastLine = lines[lines.length - 1] || "";
      let parsed = null;
      try {
        parsed = JSON.parse(lastLine);
      } catch {
        return reject(new Error(`Worker invalid JSON (exit ${code}): ${stderr || stdout}`));
      }
      resolve({ code, parsed, stdout, stderr });
    });
    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
  });
}

describe("Tier 3: Cross-Feature Pairwise Combinations", () => {
  let tmpDir;
  let mockApi;
  let server;
  let sampleVideoPath;
  let silentGapVideoPath;
  let sampleBgmPath;
  let sampleLogoPath;

  before(async () => {
    tmpDir = createTempDir("opus2short-tier3-");
    sampleVideoPath = createTestVideo(path.join(tmpDir, "sample.mp4"), {
      duration: 3,
      width: 640,
      height: 360,
      fps: 24
    });
    silentGapVideoPath = createTestVideo(path.join(tmpDir, "silent_gap.mp4"), {
      duration: 6,
      width: 640,
      height: 360,
      fps: 24,
      silentGap: true
    });
    sampleBgmPath = createTestAudio(path.join(tmpDir, "bgm.wav"), {
      duration: 2,
      frequency: 330
    });
    sampleLogoPath = createTestPng(path.join(tmpDir, "logo.png"), {
      width: 64,
      height: 64,
      rgba: [255, 64, 128, 255]
    });

    mockApi = createMockApiServer();
    await mockApi.start();
    server = await startServer({ mockApiUrl: mockApi.url });
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

  describe("Matrix 1: (layout_mode: three | four) x (auto_color: deblock+glow | none) x (aspect_ratio: 9:16 | 1:1)", () => {
    const cases = [
      {
        name: "three + deblock+glow + 9:16",
        layout_mode: "three",
        auto_color: { enabled: true, sharpen: 0.5, denoise: 0.2, deblock: 0.4, glow: 0.3 },
        aspect_ratio: "9:16",
        expectedW: 720,
        expectedH: 1280
      },
      {
        name: "three + none + 1:1",
        layout_mode: "three",
        auto_color: { enabled: false },
        aspect_ratio: "1:1",
        expectedW: 720,
        expectedH: 720
      },
      {
        name: "four + deblock+glow + 1:1",
        layout_mode: "four",
        auto_color: { enabled: true, sharpen: 0.4, denoise: 0.1, deblock: 0.5, glow: 0.4 },
        aspect_ratio: "1:1",
        expectedW: 720,
        expectedH: 720
      },
      {
        name: "four + none + 9:16",
        layout_mode: "four",
        auto_color: { enabled: false },
        aspect_ratio: "9:16",
        expectedW: 720,
        expectedH: 1280
      }
    ];

    for (const tc of cases) {
      it(`renders ${tc.name} into playable MP4 with expected dimensions`, async () => {
        const outPath = path.join(tmpDir, `m1_${tc.layout_mode}_${tc.aspect_ratio.replace(":", "x")}_${tc.auto_color.enabled ? "ac" : "noac"}.mp4`);
        const { code, parsed } = await runWorkerRenderClip({
          video_path: sampleVideoPath,
          out_path: outPath,
          start_sec: 0,
          end_sec: 2.0,
          aspect_ratio: tc.aspect_ratio,
          resolution: "720p",
          fps: 24,
          layout_mode: tc.layout_mode,
          auto_color: tc.auto_color,
          caption_enabled: false
        });

        assert.equal(code, 0, `Worker exited with ${code}: ${parsed?.error}`);
        assert.equal(parsed.ok, true);
        assert.ok(fs.existsSync(outPath), "Output MP4 must exist");

        const info = probeMedia(outPath);
        assert.equal(info.hasVideo, true, "Output must contain a video stream");
        assert.equal(info.hasAudio, true, "Output must contain an audio stream");
        assert.equal(info.width, tc.expectedW, `Expected width ${tc.expectedW}`);
        assert.equal(info.height, tc.expectedH, `Expected height ${tc.expectedH}`);
        assert.ok(info.duration > 0.5, `Expected duration > 0.5s, got ${info.duration}`);
      });
    }
  });

  describe("Matrix 2: (BrandKit: watermark+colors) x (progress_bar: true) x (caption_preset: neon | classic)", () => {
    const cases = [
      {
        name: "top-left 0.35 + neon (karaoke) + progress_bar",
        watermark_position: "top-left",
        watermark_opacity: 0.35,
        caption_preset: "karaoke",
        brand_kit: {
          primaryColor: "#FF5500",
          highlightColor: "#00FFAA",
          secondaryColor: "#AA00FF",
          fontFamily: "DejaVu Sans"
        }
      },
      {
        name: "bottom-right 0.85 + classic + progress_bar",
        watermark_position: "bottom-right",
        watermark_opacity: 0.85,
        caption_preset: "classic",
        brand_kit: {
          primaryColor: "#0169EE",
          highlightColor: "#04F827",
          secondaryColor: "#FF37B9",
          fontFamily: "DejaVu Sans"
        }
      }
    ];

    for (const tc of cases) {
      it(`renders ${tc.name} into valid MP4`, async () => {
        const outPath = path.join(tmpDir, `m2_${tc.caption_preset}_${tc.watermark_position}.mp4`);
        const { code, parsed } = await runWorkerRenderClip({
          video_path: sampleVideoPath,
          out_path: outPath,
          start_sec: 0,
          end_sec: 2.0,
          aspect_ratio: "9:16",
          resolution: "720p",
          fps: 24,
          layout_mode: "auto",
          caption_enabled: true,
          caption_preset: tc.caption_preset,
          words: [
            { text: "Hello", start: 0.1, end: 0.7 },
            { text: "world", start: 0.8, end: 1.6 }
          ],
          watermark_path: sampleLogoPath,
          watermark_position: tc.watermark_position,
          watermark_opacity: tc.watermark_opacity,
          brand_kit: tc.brand_kit,
          progress_bar: true
        });

        assert.equal(code, 0, `Worker exited with ${code}: ${parsed?.error}`);
        assert.equal(parsed.ok, true);
        assert.ok(fs.existsSync(outPath), "Output MP4 must exist");

        const info = probeMedia(outPath);
        assert.equal(info.hasVideo, true);
        assert.equal(info.hasAudio, true);
        assert.equal(info.width, 720, `Expected 9:16 width 720, got ${info.width}`);
        assert.equal(info.height, 1280, `Expected 9:16 height 1280, got ${info.height}`);
        assert.ok(info.duration > 0.5);
      });
    }
  });

  describe("Matrix 3: (remove_silences: true) x (bgm_path: attached + ducking) x (transition_type: fade)", () => {
    it("renders silent-gap video with silence removal, BGM ducking, and fade transition", async () => {
      const outPath = path.join(tmpDir, "m3_silence_bgm_fade.mp4");
      const { code, parsed } = await runWorkerRenderClip({
        video_path: silentGapVideoPath,
        out_path: outPath,
        start_sec: 0,
        end_sec: 6.0,
        aspect_ratio: "9:16",
        resolution: "720p",
        fps: 24,
        layout_mode: "auto",
        caption_enabled: false,
        remove_silences: true,
        bgm_path: sampleBgmPath,
        bgm_volume: 0.25,
        bgm_ducking: true,
        transition_type: "fade"
      });

      assert.equal(code, 0, `Worker exited with ${code}: ${parsed?.error}`);
      assert.equal(parsed.ok, true);
      assert.ok(fs.existsSync(outPath), "Output MP4 must exist");

      const info = probeMedia(outPath);
      assert.equal(info.hasVideo, true, "Output must have video stream");
      assert.equal(info.hasAudio, true, "Output must have audio stream");
      assert.equal(info.width, 720, `Expected 9:16 width 720, got ${info.width}`);
      assert.equal(info.height, 1280, `Expected 9:16 height 1280, got ${info.height}`);
      assert.ok(
        info.duration > 0.5 && info.duration < 5.5,
        `Expected silence-trimmed duration in (0.5, 5.5)s, got ${info.duration}`
      );
    });
  });

  describe("Matrix 4: (KeyPool: primary 429 + secondary 200) x (Workflow: ai-broll | translate-dubbing)", () => {
    const workflows = ["builtin:ai-broll", "builtin:translate-dubbing"];

    for (const wf of workflows) {
      it(`fails over from 429 primary key to secondary key and completes ${wf}`, async () => {
        mockApi.reset();

        const preKeysRes = await server.request("GET", "/api/keys");
        const preEnabledIds = (preKeysRes.json?.keys || [])
          .filter((k) => k.enabled)
          .map((k) => k.id);
        for (const id of preEnabledIds) {
          await server.request("PATCH", `/api/keys/${id}`, { json: { enabled: false } });
        }

        const key1Val = `gsk_m4_primary_${Date.now()}`;
        const key2Val = `gsk_m4_secondary_${Date.now()}`;

        let whisperKey = null;
        let addedKeys = [];
        try {

        const whisperKeyRes = await server.request("POST", "/api/keys", {
          json: {
            provider: "groq",
            label: `M4-Whisper-${wf}`,
            capabilities: "whisper",
            apiKey: `gsk_m4_whisper_${Date.now()}`
          }
        });
        assert.equal(whisperKeyRes.status, 201);
        whisperKey = whisperKeyRes.json.keys.find((k) => k.label === `M4-Whisper-${wf}`);
        if (whisperKey) server.trackKey(whisperKey.id);

        const addRes = await server.request("POST", "/api/keys", {
          json: {
            provider: "groq",
            label: `M4-${wf}`,
            capabilities: "llm",
            keysText: `${key1Val}\n${key2Val}`
          }
        });
        assert.equal(addRes.status, 201);
        addedKeys = addRes.json.keys.filter((k) => k.label.startsWith(`M4-${wf}`));
        assert.equal(addedKeys.length, 2, "Expected 2 keys created for Matrix 4");
        for (const k of addedKeys) server.trackKey(k.id);

        await server.request("POST", "/api/settings", {
          json: {
            llmProvider: "groq",
            whisperProvider: "groq",
            whisperModel: "whisper-large-v3",
            giphyApiKey: "mock_giphy_key"
          }
        });

        mockApi.addFailure({
          host: "api.groq.com",
          pathIncludes: "/chat/completions",
          apiKey: key1Val,
          status: 429,
          times: 1
        });

        const upRes = await server.uploadMultipart(
          "/api/projects/upload",
          { workflowId: wf, title: `M4 ${wf}` },
          { video: { path: sampleVideoPath, filename: "m4.mp4", contentType: "video/mp4" } }
        );
        assert.equal(upRes.status, 201);
        const projectId = upRes.json.id;
        server.trackProject(projectId);

        const detail = await server.pollUntil(
          async () => {
            const r = await server.request("GET", `/api/projects/${projectId}`);
            if (r.json?.project?.status === "error") {
              throw new FatalPollError(`Project failed: ${r.json.project.errorMsg}`);
            }
            return r.json?.project?.status === "ready" ? r.json : null;
          },
          { timeoutMs: 30000, intervalMs: 300, label: `project ${projectId} ready (${wf})` }
        );

        assert.ok(detail.clips.length >= 1, "Expected at least 1 generated clip");

        const key1Id = addedKeys[0].id;
        const key2Id = addedKeys[1].id;
        const keysAfter = await server.request("GET", "/api/keys");
        const poolKeys = keysAfter.json.keys.filter((k) => k.label.startsWith(`M4-${wf}`));
        const key1After = poolKeys.find((k) => k.id === key1Id);
        const key2After = poolKeys.find((k) => k.id === key2Id);
        assert.ok(key1After, "Primary key must exist in /api/keys");
        assert.ok(key2After, "Secondary key must exist in /api/keys");
        assert.ok(
          key1After.errorCount >= 1 && Boolean(key1After.cooldownUntil),
          "Primary key (key1Val) should record 429 error and enter cooldown"
        );
        assert.ok(key2After.usageCount >= 1, "Secondary key (key2Val) should succeed after failover");

        } finally {
          // Clean up keys for this iteration and restore pre-existing keys
          for (const k of addedKeys) {
            await server.request("DELETE", `/api/keys/${k.id}`);
          }
          if (whisperKey) {
            await server.request("DELETE", `/api/keys/${whisperKey.id}`);
          }
          for (const id of preEnabledIds) {
            await server.request("PATCH", `/api/keys/${id}`, { json: { enabled: true } });
          }
        }
      });
    }
  });

  describe("Matrix 5: (OAuth: YouTube callback upsert) x (PlanSocial: social-copy + schedule + publish-now)", () => {
    it("completes YouTube OAuth upsert and publishes rendered clip via PlanSocial", async () => {
      mockApi.reset();

      const keyVal = `gsk_m5_social_${Date.now()}`;
      const keyRes = await server.request("POST", "/api/keys", {
        json: { provider: "groq", label: "M5-Key", capabilities: "both", apiKey: keyVal }
      });
      assert.equal(keyRes.status, 201);
      const createdKey = keyRes.json.keys.find((k) => k.label === "M5-Key");
      if (createdKey) server.trackKey(createdKey.id);

      await server.request("POST", "/api/settings", {
        json: { llmProvider: "groq", whisperProvider: "groq" }
      });

      const cfgRes = await server.request("POST", "/api/oauth/config", {
        json: {
          googleClientId: "mock_google_client_id",
          googleClientSecret: "mock_google_client_secret"
        }
      });
      assert.equal(cfgRes.status, 200);

      // 1st OAuth start + callback
      const start1 = await server.request("GET", "/api/oauth/youtube/start", { redirect: "manual" });
      assert.ok([301, 302].includes(start1.status));
      const loc1 = start1.headers.get("location") || "";
      const state1 = new URL(loc1).searchParams.get("state");
      assert.ok(state1, "OAuth start must emit state parameter");

      const cb1 = await server.request("GET", `/api/oauth/youtube/callback?code=code_1&state=${encodeURIComponent(state1)}`, { redirect: "manual" });
      assert.ok([301, 302].includes(cb1.status));
      assert.ok((cb1.headers.get("location") || "").includes("oauth=success"));

      // 2nd OAuth start + callback -> must upsert, not duplicate
      const start2 = await server.request("GET", "/api/oauth/youtube/start", { redirect: "manual" });
      const state2 = new URL(start2.headers.get("location")).searchParams.get("state");
      const cb2 = await server.request("GET", `/api/oauth/youtube/callback?code=code_2&state=${encodeURIComponent(state2)}`, { redirect: "manual" });
      assert.ok((cb2.headers.get("location") || "").includes("oauth=success"));

      const accRes = await server.request("GET", "/api/social-accounts");
      assert.equal(accRes.status, 200);
      const ytAccounts = accRes.json.accounts.filter((a) => a.platform === "YOUTUBE" && a.handle === "@mockchannel");
      assert.equal(ytAccounts.length, 1, "Repeated YouTube OAuth callback must upsert single account");
      const account = ytAccounts[0];
      server.trackSocialAccount(account.id);

      // Upload & render clip
      const upRes = await server.uploadMultipart(
        "/api/projects/upload",
        { workflowId: "builtin:long-to-shorts", title: "M5 Social Project" },
        { video: { path: sampleVideoPath, filename: "m5.mp4", contentType: "video/mp4" } }
      );
      assert.equal(upRes.status, 201);
      const projectId = upRes.json.id;
      server.trackProject(projectId);

      const detail = await server.pollUntil(
        async () => {
          const r = await server.request("GET", `/api/projects/${projectId}`);
          if (r.json?.project?.status === "error") throw new FatalPollError(r.json.project.errorMsg);
          return r.json?.project?.status === "ready" ? r.json : null;
        },
        { timeoutMs: 30000, intervalMs: 300, label: "M5 project ready" }
      );
      const clip = detail.clips[0];
      assert.ok(clip);

      const renderRes = await server.request("POST", `/api/clips/${clip.id}/render`, {
        json: { resolution: "720p", fps: 24 }
      });
      assert.equal(renderRes.status, 200);

      await server.pollUntil(
        async () => {
          const r = await server.request("GET", `/api/clips/${clip.id}`);
          if (r.json?.clip?.exportStatus === "error") throw new FatalPollError(r.json.clip.exportError);
          return r.json?.clip?.exportStatus === "done" ? r.json.clip : null;
        },
        { timeoutMs: 30000, intervalMs: 300, label: "M5 clip rendered" }
      );

      // Social copy -> Schedule -> Publish now
      const copyRes = await server.request("POST", "/api/social-copy", {
        json: { clipId: clip.id, platform: "YOUTUBE" }
      });
      assert.equal(copyRes.status, 200);
      assert.ok(copyRes.json.copy?.title);

      const schedRes = await server.request("POST", "/api/publish-schedules", {
        json: {
          clipId: clip.id,
          accountId: account.id,
          platform: "YOUTUBE",
          title: copyRes.json.copy.title,
          description: copyRes.json.copy.description || "",
          hashtags: copyRes.json.copy.hashtags || "#shorts"
        }
      });
      assert.equal(schedRes.status, 201);
      const scheduleId = schedRes.json.schedule.id;
      server.trackSchedule(scheduleId);

      const pubRes = await server.request("POST", `/api/publish-schedules/${scheduleId}/publish-now`);
      assert.equal(pubRes.status, 200);
      assert.equal(pubRes.json.status, "PUBLISHED");
      assert.ok((pubRes.json.publishedUrl || "").startsWith("https://www.youtube.com/shorts/"));
    });
  });
});
