/**
 * Tier 4 E2E Tests: Real-World Application Scenarios
 * 5 full multi-step end-to-end workflows exercised exclusively via public HTTP APIs
 * and verified with ffprobe and mock API request logs.
 */
"use strict";

const { describe, it, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { FatalPollError, startServer } = require("./helpers/harness");
const {
  createTempDir,
  removeDir,
  createTestVideo,
  createTestAudio,
  createTestPng,
  probeMedia
} = require("./helpers/fixtures");
const { createMockApiServer } = require("./helpers/mock-apis");

describe("Tier 4: Real-World Application Scenarios", () => {
  let tmpDir;
  let mockApi;
  let server;
  let sampleVideoPath;
  let silentGapVideoPath;
  let sampleBgmPath;
  let sampleLogoPath;

  before(async () => {
    tmpDir = createTempDir("opus2short-tier4-");
    sampleVideoPath = createTestVideo(path.join(tmpDir, "sample_3s.mp4"), {
      duration: 3,
      width: 640,
      height: 360,
      fps: 24
    });
    silentGapVideoPath = createTestVideo(path.join(tmpDir, "silent_gap_3s.mp4"), {
      duration: 3,
      width: 640,
      height: 360,
      fps: 24,
      silentGap: true
    });
    sampleBgmPath = createTestAudio(path.join(tmpDir, "bgm_2s.wav"), {
      duration: 2,
      frequency: 330
    });
    sampleLogoPath = createTestPng(path.join(tmpDir, "brand_logo.png"), {
      width: 64,
      height: 64,
      rgba: [16, 185, 129, 255]
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

  afterEach(async () => {
    if (server) await server.cleanup();
  });

  async function ensureGroqKey(label) {
    const keyVal = `gsk_${label}_${Date.now()}`;
    const res = await server.request("POST", "/api/keys", {
      json: { provider: "groq", label, capabilities: "both", apiKey: keyVal }
    });
    assert.equal(res.status, 201);
    const created = res.json.keys.find((k) => k.label === label);
    assert.ok(created, "Expected created key in /api/keys response");
    server.trackKey(created.id);
    await server.request("POST", "/api/settings", {
      json: { llmProvider: "groq", whisperProvider: "groq" }
    });
    return { keyId: created.id, keyVal };
  }

  async function uploadAndWaitReady(videoPath, title, workflowId = "builtin:long-to-shorts") {
    const upRes = await server.uploadMultipart(
      "/api/projects/upload",
      { workflowId, title },
      { video: { path: videoPath, filename: path.basename(videoPath), contentType: "video/mp4" } }
    );
    assert.equal(upRes.status, 201);
    const projectId = upRes.json.id;
    server.trackProject(projectId);

    const detail = await server.pollUntil(
      async () => {
        const r = await server.request("GET", `/api/projects/${projectId}`);
        if (r.json?.project?.status === "error") {
          throw new FatalPollError(`Project pipeline error: ${r.json.project.errorMsg}`);
        }
        return r.json?.project?.status === "ready" ? r.json : null;
      },
      { timeoutMs: 30000, intervalMs: 300, label: `project ${projectId} ready` }
    );
    return { projectId, detail };
  }

  async function renderAndWaitDone(clipId, opts = { resolution: "720p", fps: 24 }) {
    const renderRes = await server.request("POST", `/api/clips/${clipId}/render`, { json: opts });
    assert.equal(renderRes.status, 200);
    assert.equal(renderRes.json.status, "rendering");

    return server.pollUntil(
      async () => {
        const r = await server.request("GET", `/api/clips/${clipId}`);
        if (r.json?.clip?.exportStatus === "error") {
          throw new FatalPollError(`Clip render error: ${r.json.clip.exportError}`);
        }
        return r.json?.clip?.exportStatus === "done" ? r.json.clip : null;
      },
      { timeoutMs: 30000, intervalMs: 300, label: `clip ${clipId} render done` }
    );
  }

  it("Scenario 1 — Full Video Upload-to-MP4 Download", async () => {
    mockApi.reset();
    const { keyId } = await ensureGroqKey("S1-Key");

    const { detail } = await uploadAndWaitReady(sampleVideoPath, "Scenario 1 Upload");
    assert.ok(Array.isArray(detail.clips) && detail.clips.length >= 1, "Expected >= 1 clip");
    assert.ok(Array.isArray(detail.project.words) && detail.project.words.length >= 1, "Expected transcribed words");

    const clip = detail.clips[0];
    const patchRes = await server.request("PATCH", `/api/clips/${clip.id}`, {
      json: {
        startSec: 0,
        endSec: 2.2,
        layoutMode: "fill",
        aspectRatio: "9:16"
      }
    });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.json.clip.layoutMode, "fill");
    assert.equal(patchRes.json.clip.endSec, 2.2);

    await renderAndWaitDone(clip.id);

    // Partial Range 206 download
    const rangeRes = await server.request("GET", `/api/clips/${clip.id}/download`, {
      headers: { Range: "bytes=0-1023" }
    });
    assert.equal(rangeRes.status, 206);
    assert.ok((rangeRes.headers.get("content-range") || "").startsWith("bytes 0-1023/"));
    assert.equal(rangeRes.buffer.length, 1024);

    // Full 200 download & ffprobe verification
    const fullRes = await server.request("GET", `/api/clips/${clip.id}/download`);
    assert.equal(fullRes.status, 200);
    assert.ok(fullRes.buffer.length > 1024);

    const downloadedMp4 = path.join(tmpDir, "s1_downloaded.mp4");
    fs.writeFileSync(downloadedMp4, fullRes.buffer);
    const info = probeMedia(downloadedMp4);
    assert.equal(info.hasVideo, true);
    assert.equal(info.hasAudio, true);
    assert.ok(info.duration > 0.5);

    await server.request("DELETE", `/api/keys/${keyId}`);
  });

  it("Scenario 2 — Branded Shorts Production", async () => {
    mockApi.reset();
    const { keyId } = await ensureGroqKey("S2-Key");

    // Create Brand Kit with PNG logo + watermarkPosition + watermarkOpacity + colors + fontFamily
    const bkRes = await server.uploadMultipart(
      "/api/brand-kits",
      {
        name: "Scenario 2 Brand Kit",
        watermarkPosition: "bottom-left",
        watermarkOpacity: "0.5",
        primaryColor: "#112233",
        highlightColor: "#00FF88",
        secondaryColor: "#FF0099",
        fontFamily: "DejaVu Sans",
        defaultPreset: "karaoke"
      },
      { logo: { path: sampleLogoPath, filename: "logo.png", contentType: "image/png" } }
    );
    assert.equal(bkRes.status, 201);
    const kit = bkRes.json.kit;
    assert.ok(kit?.id);
    server.trackBrandKit(kit.id);
    assert.equal(kit.watermarkPosition, "bottom-left");
    assert.equal(kit.watermarkOpacity, 0.5);

    const logoRes = await server.request("GET", `/api/brand-kits/${kit.id}/logo`);
    assert.equal(logoRes.status, 200);
    assert.ok(logoRes.buffer.length > 0);

    const { detail } = await uploadAndWaitReady(sampleVideoPath, "Scenario 2 Branded");
    const clip = detail.clips[0];

    const patchRes = await server.request("PATCH", `/api/clips/${clip.id}`, {
      json: {
        brandKitId: kit.id,
        progressBar: true,
        layoutMode: "three",
        autoColor: { enabled: true, deblock: true, glow: true, sharpen: 0.4, denoise: 0.2 }
      }
    });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.json.clip.brandKitId, kit.id);
    assert.equal(patchRes.json.clip.progressBar, true);
    assert.equal(patchRes.json.clip.layoutMode, "three");

    const emojiRes = await server.request("POST", `/api/clips/${clip.id}/ai-emojis`);
    assert.equal(emojiRes.status, 200);
    assert.ok(Array.isArray(emojiRes.json.words));

    await renderAndWaitDone(clip.id);

    const dlRes = await server.request("GET", `/api/clips/${clip.id}/download`);
    assert.equal(dlRes.status, 200);
    const outPath = path.join(tmpDir, "s2_branded.mp4");
    fs.writeFileSync(outPath, dlRes.buffer);
    const info = probeMedia(outPath);
    assert.equal(info.hasVideo, true);
    assert.equal(info.hasAudio, true);
    assert.ok(info.width > 0 && info.height > 0 && info.width < info.height, `Expected 9:16 portrait dimensions (width < height), got ${info.width}x${info.height}`);
    assert.ok(info.duration > 0.5);

    await server.request("DELETE", `/api/keys/${keyId}`);
  });

  it("Scenario 3 — PlanSocial OAuth & Publishing", async () => {
    mockApi.reset();
    const { keyId } = await ensureGroqKey("S3-Key");

    const cfgRes = await server.request("POST", "/api/oauth/config", {
      json: {
        googleClientId: "s3_google_client_id",
        googleClientSecret: "s3_google_client_secret"
      }
    });
    assert.equal(cfgRes.status, 200);

    const startRes = await server.request("GET", "/api/oauth/youtube/start", { redirect: "manual" });
    assert.ok([301, 302].includes(startRes.status));
    const state = new URL(startRes.headers.get("location")).searchParams.get("state");
    assert.ok(state, "Expected OAuth state token");

    const cbRes = await server.request(
      "GET",
      `/api/oauth/youtube/callback?code=s3_auth_code&state=${encodeURIComponent(state)}`,
      { redirect: "manual" }
    );
    assert.ok([301, 302].includes(cbRes.status));
    assert.ok((cbRes.headers.get("location") || "").includes("oauth=success"));

    const accRes = await server.request("GET", "/api/social-accounts");
    assert.equal(accRes.status, 200);
    const ytAcc = accRes.json.accounts.find((a) => a.platform === "YOUTUBE");
    assert.ok(ytAcc, "Expected YOUTUBE account in social_accounts");
    server.trackSocialAccount(ytAcc.id);

    const { detail } = await uploadAndWaitReady(sampleVideoPath, "Scenario 3 PlanSocial");
    const clip = detail.clips[0];
    await renderAndWaitDone(clip.id);

    const copyRes = await server.request("POST", "/api/social-copy", {
      json: { clipId: clip.id, platform: "YOUTUBE" }
    });
    assert.equal(copyRes.status, 200);
    assert.ok(copyRes.json.copy?.title);

    const schedRes = await server.request("POST", "/api/publish-schedules", {
      json: {
        clipId: clip.id,
        accountId: ytAcc.id,
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

    const ytUploadLogs = mockApi.getLogs((l) => l.pathname === "/upload/youtube/v3/videos");
    assert.ok(ytUploadLogs.length >= 1, "Expected mocked YouTube upload request");

    const listSched = await server.request("GET", "/api/publish-schedules");
    const saved = listSched.json.schedules.find((s) => s.id === scheduleId);
    assert.equal(saved?.status, "PUBLISHED");

    await server.request("DELETE", `/api/keys/${keyId}`);
  });

  it("Scenario 4 — Multi-Key Pool Failover Under Load", async () => {
    mockApi.reset();

    const preKeysRes = await server.request("GET", "/api/keys");
    const preEnabledIds = (preKeysRes.json?.keys || [])
      .filter((k) => k.enabled)
      .map((k) => k.id);
    for (const id of preEnabledIds) {
      await server.request("PATCH", `/api/keys/${id}`, { json: { enabled: false } });
    }

    let whisperKey = null;
    let poolKeys = [];
    try {
      const whisperKeyRes = await server.request("POST", "/api/keys", {
        json: {
          provider: "groq",
          label: "S4-Whisper",
          capabilities: "whisper",
          apiKey: `gsk_s4_whisper_${Date.now()}`
        }
      });
      assert.equal(whisperKeyRes.status, 201);
      whisperKey = whisperKeyRes.json.keys.find((k) => k.label === "S4-Whisper");
      if (whisperKey) server.trackKey(whisperKey.id);

    const key1Val = `gsk_s4_primary_${Date.now()}`;
    const key2Val = `gsk_s4_secondary_${Date.now()}`;
    const addRes = await server.request("POST", "/api/keys", {
      json: {
        provider: "groq",
        label: "S4-Pool",
        capabilities: "llm",
        keysText: `${key1Val}\n${key2Val}`
      }
    });
    assert.equal(addRes.status, 201);
    poolKeys = addRes.json.keys.filter((k) => k.label.startsWith("S4-Pool"));
    assert.equal(poolKeys.length, 2);
    for (const k of poolKeys) server.trackKey(k.id);

    await server.request("POST", "/api/settings", {
      json: { llmProvider: "groq", whisperProvider: "groq", whisperModel: "whisper-large-v3" }
    });

    // Inject 429 on key 1 for chat completions before upload so curateViralClips deterministically hits key1Val first
    mockApi.addFailure({
      host: "api.groq.com",
      pathIncludes: "/chat/completions",
      apiKey: key1Val,
      status: 429,
      times: 2
    });

    const { projectId, detail } = await uploadAndWaitReady(sampleVideoPath, "Scenario 4 Failover");
    const clip = detail.clips[0];

    const copyRes = await server.request("POST", "/api/social-copy", {
      json: { clipId: clip.id, platform: "YOUTUBE" }
    });
    assert.equal(copyRes.status, 200);
    assert.ok(copyRes.json.copy?.title);

    const chatRes = await server.request("POST", `/api/projects/${projectId}/chat`, {
      json: { message: "Suggest improvements for this clip" }
    });
    assert.equal(chatRes.status, 200);
    assert.ok(chatRes.json.reply?.content);

    const keysAfter = await server.request("GET", "/api/keys");
    const s4Keys = keysAfter.json.keys.filter((k) => k.label.startsWith("S4-Pool"));
    const cooledKey = s4Keys.find((k) => k.label === "S4-Pool #1");
    const healthyKey = s4Keys.find((k) => k.label === "S4-Pool #2");
    assert.ok(cooledKey && Boolean(cooledKey.cooldownUntil) && cooledKey.errorCount >= 1, "Key 1 should enter cooldown after 429");
    assert.ok(healthyKey && !healthyKey.cooldownUntil && healthyKey.usageCount >= 2, "Key 2 should handle failover requests seamlessly");

    } finally {
      for (const k of poolKeys) {
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

  it("Scenario 5 — Translate/Dubbing & BGM Lifecycle", async () => {
    mockApi.reset();
    const { keyId } = await ensureGroqKey("S5-Key");

    const { detail } = await uploadAndWaitReady(
      silentGapVideoPath,
      "Scenario 5 Translate & BGM",
      "builtin:auto-edits"
    );
    const clip = detail.clips[0];

    // 1. Attach BGM
    const bgm1 = await server.uploadMultipart(
      `/api/clips/${clip.id}/bgm`,
      { volume: "0.25", ducking: "true" },
      { audio: { path: sampleBgmPath, filename: "bgm1.wav", contentType: "audio/wav" } }
    );
    assert.equal(bgm1.status, 200);
    assert.ok(bgm1.json.clip.tracks.some((t) => t.type === "bgm"));

    // 2. Delete BGM
    const delBgm = await server.request("DELETE", `/api/clips/${clip.id}/bgm`);
    assert.equal(delBgm.status, 200);
    assert.equal(delBgm.json.clip.tracks.some((t) => t.type === "bgm"), false);

    // 3. Re-attach BGM
    const bgm2 = await server.uploadMultipart(
      `/api/clips/${clip.id}/bgm`,
      { volume: "0.3", ducking: "true" },
      { audio: { path: sampleBgmPath, filename: "bgm2.wav", contentType: "audio/wav" } }
    );
    assert.equal(bgm2.status, 200);
    assert.ok(bgm2.json.clip.tracks.some((t) => t.type === "bgm"));

    // 4. Translate captions
    const trRes = await server.request("POST", `/api/clips/${clip.id}/translate`, {
      json: { targetLang: "English" }
    });
    assert.equal(trRes.status, 200);
    assert.ok(Array.isArray(trRes.json.words) && trRes.json.words.length >= 1);

    // 5. Patch transition & render final MP4
    const patchRes = await server.request("PATCH", `/api/clips/${clip.id}`, {
      json: { transitionType: "fade", removeSilences: true }
    });
    assert.equal(patchRes.status, 200);

    await renderAndWaitDone(clip.id);

    const dlRes = await server.request("GET", `/api/clips/${clip.id}/download`);
    assert.equal(dlRes.status, 200);
    const outPath = path.join(tmpDir, "s5_translated_bgm.mp4");
    fs.writeFileSync(outPath, dlRes.buffer);
    const info = probeMedia(outPath);
    assert.equal(info.hasVideo, true);
    assert.equal(info.hasAudio, true);
    assert.ok(info.duration > 0.5);

    await server.request("DELETE", `/api/keys/${keyId}`);
  });
});
