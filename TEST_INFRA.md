# Test Infrastructure & Strategy (`TEST_INFRA.md`)

## 1. Overview & Philosophy
This document defines the opaque-box, requirement-driven End-to-End (E2E) test infrastructure for **Opus2Short AI Studio**, derived directly from `PROJECT.md § Feature Inventory` and `PROJECT.md § Interface Contracts`.

- **Test Runner**: Node.js 22 built-in `node --test` (`node:test` + `node:assert/strict`) — zero external test framework dependencies.
- **Opaque-Box Principle**: Tests interact exclusively through public HTTP REST endpoints (`http://127.0.0.1:<port>/api/...`, `/`), spawned Python worker CLI (`python3 app/worker/pipeline.py <command>`), and build/config artifacts. Tests NEVER import internal server modules (`llm.js`, `db.js`, etc.) to assert private state, and NEVER modify `app/` source code.
- **Determinism & Isolation**:
  - Ephemeral TCP port (`PORT` dynamically allocated per test suite).
  - Isolated temporary directories for synthetic media fixtures (`os.tmpdir()`).
  - Local mock HTTP server (`tests/e2e/helpers/mock-apis.js`) + `NODE_OPTIONS="--require tests/e2e/helpers/fetch-interceptor.cjs"` in the spawned server child process to intercept external APIs (`api.groq.com`, `generativelanguage.googleapis.com`, `api.openai.com`, `openrouter.ai`, `api.giphy.com`, `oauth2.googleapis.com`, `www.googleapis.com`, `open.tiktokapis.com`, `graph.facebook.com`) deterministically without internet access or paid API keys.
  - Synthetic media fixtures generated on demand via `ffmpeg -f lavfi` (3s MP4 with `testsrc` + `sine` audio, 2s WAV BGM, 64x64 PNG watermark logo).

---

## 2. Directory Layout
```text
tests/e2e/
├── helpers/
│   ├── harness.js              # Server lifecycle, isolated temp dirs, HTTP client, polling helpers
│   ├── fixtures.js             # Deterministic ffmpeg/png/wav synthetic media generator
│   ├── mock-apis.js            # Local HTTP mock server for Groq/Gemini/OpenAI/OpenRouter/Giphy/OAuth/YouTube
│   └── fetch-interceptor.cjs   # NODE_OPTIONS preload routing external fetch() calls to mock-apis.js
├── tier1_features.test.js      # Tier 1: Feature Coverage (>= 5 assertions/cases per feature F1-F14)
├── tier2_boundaries.test.js    # Tier 2: Boundary & Corner Cases (>= 5 per feature: invalid inputs, 4xx, Range 206/416, malformed JSON)
├── tier3_pairwise.test.js      # Tier 3: Cross-Feature Pairwise Combinations
└── tier4_workflows.test.js     # Tier 4: Real-World End-to-End Application Scenarios (>= 5 full workflows)
```

---

## 3. Category-Partition & Boundary Value Analysis (BVA) Matrix

| Feature | Categories / Partitions | Boundary & Corner Cases (BVA) |
|---|---|---|
| **F1: Runtime & Build** | Node 22+, Python 3, `ffmpeg`/`ffprobe`, `app/web/dist`, `app/server/node_modules` | Missing dist fallback, invalid route 404, static `index.html` MIME & 200 |
| **F2: Multi-Key Pool & LLM Failover** | Providers (`groq`, `gemini`, `openrouter`, `openai`), key status (`active`, `cooldown`, `disabled`), local fallback | Empty `keysText` -> 400, 429/500 on primary key -> cooldown & failover to secondary key, all keys exhausted -> cross-provider/local fallback, long transcript (>16k chars) truncation/chunking, fetch timeout |
| **F3: Bounded Queue & Crash Recovery** | Concurrent uploads, concurrent renders, job states (`queued`, `processing`, `ready`, `error`) | Burst of >3 concurrent jobs remains bounded without OOM/crash, invalid project ID -> 404, cleanup of deleted project removes files |
| **F4: Range Streaming & Safe JSON** | Full GET (`200`), partial Range (`206`), out-of-bounds Range (`416`), `/translate` JSON modes | `Range: bytes=0-1023`, `Range: bytes=100-`, `Range: bytes=999999999-`, malformed `Range: bytes=abc`, `/translate` with fenced JSON vs garbage text -> clean error JSON (no 500 crash) |
| **F5: OAuth Security & Upsert** | Providers (`youtube`, `tiktok`, `instagram`), `state` token (`valid`, `missing`, `tampered`), client secret upload | Missing `state` on callback -> redirect `?oauth=error`, tampered `state` -> rejected, repeated valid callback -> upserts existing account (no duplicate), invalid secret JSON -> 400, non-YouTube publish status handled cleanly |
| **F6: Brand Kit Persistence & Wiring** | Logo upload (PNG / none), colors, `fontFamily`, `defaultPreset`, `watermarkPosition`, `watermarkOpacity` | Missing `name` -> fallback/400, `watermarkOpacity` at `0`, `0.5`, `1.0`, invalid brandKitId on clip, deleting brand kit removes logo & record |
| **F7: Progress Bar & Silence Removal** | `progress_bar` (`true`/`false`), `remove_silences` (`true`/`false`), `bgm_path` (present/absent) | `progress_bar: true` on short 2s clip, `remove_silences: true` on all-sine vs silent-gap audio, `remove_silences + bgm_path` combined without A/V desync |
| **F8: AI Emojis & Brand Kit Render** | `POST /api/clips/:id/ai-emojis`, Brand Kit colors/font/watermark in `render_clip` | Empty words array, clip not found -> 404, `watermark_position` (`top-left`, `bottom-right`), `watermark_opacity: 0.25` |
| **F9: Multi-Panel Layouts & AutoColor** | `layout_mode` (`auto`, `fill`, `fit`, `split`, `three`, `four`), `auto_color` (`sharpen`, `denoise`, `deblock`, `glow`) | Invalid `layout_mode` fallback, `three` & `four` produce valid playable MP4 with target aspect ratio, `auto_color` all flags `true` vs all `false` |
| **F10: AI B-Roll & Translate/Dubbing** | `builtin:ai-broll` (Giphy key present vs missing fallback), `builtin:translate-dubbing` | Giphy API returns empty results -> graceful fallback, Giphy 500 -> graceful fallback, translate with missing `targetLang` |
| **F11: Frontend Build & OAuth Routing** | `GET /`, `GET /?oauth=success&platform=youtube`, `GET /?oauth=error&msg=denied`, `tsc --noEmit` | SPA fallback routing on unknown non-API paths, asset MIME types (`js`, `css`) |
| **F12: EditorView Controls Contract** | `PATCH /api/clips/:id` (`captionConfig.fontSize`, `autoColor.deblock/glow`, `layoutMode: three/four`), `POST/DELETE /api/clips/:id/bgm` | `startSec >= endSec` or negative timestamps, `DELETE /api/clips/:id/bgm` when no BGM attached, non-audio BGM upload |
| **F13: Settings & Dashboard Polling** | `GET/POST /api/settings` (`llmModel`, `whisperModel`, `giphyApiKey`, `clearApiKey`), `GET /api/projects` | `llmApiKey` never leaked in `GET /api/settings` (masked only), `clearApiKey: true` clears stored key, unknown fields ignored |
| **F14: Docker & Deployment Alignment** | `Dockerfile`, `docker-compose.yml` | Exposed port `3000` matches `index.js`, `WORKDIR` & `CMD` match `app/server/index.js`, Python & `ffmpeg` installed in image |

---

## 4. Tier 3: Pairwise Cross-Feature Combinations
Pairwise combinations tested in `tier3_pairwise.test.js`:
1. `(Layout: three/four) x (AutoColor: deblock+glow) x (AspectRatio: 9:16 | 1:1)`
2. `(BrandKit: watermark+colors) x (ProgressBar: true) x (CaptionPreset: neon|classic)`
3. `(SilenceRemoval: true) x (BGM: attached+ducking) x (Transition: fade)`
4. `(KeyPool: primary 429 + secondary 200) x (Workflow: ai-broll | translate-dubbing)`
5. `(OAuth: YouTube callback upsert) x (PlanSocial: social-copy + schedule + publish-now)`

---

## 5. Tier 4: Real-World Application Scenarios
End-to-end multi-step workflows in `tier4_workflows.test.js`:
1. **Scenario 1 — Full Video Upload-to-MP4 Download**: Upload synthetic MP4 -> poll project ready -> verify transcribed words -> update clip trim & layout -> render MP4 -> download via HTTP Range `206` -> verify output MP4 via `ffprobe`.
2. **Scenario 2 — Branded Shorts Production**: Create Brand Kit with PNG logo + `watermarkPosition` + `watermarkOpacity` + colors -> apply to clip -> enable `progressBar`, `ai-emojis`, `three` layout, `deblock`/`glow` -> render & verify MP4.
3. **Scenario 3 — PlanSocial OAuth & Publishing**: Configure OAuth -> complete state-validated YouTube callback -> generate AI social copy -> create publish schedule -> `publish-now` -> verify mocked YouTube upload & schedule status `published`.
4. **Scenario 4 — Multi-Key Pool Failover Under Load**: Add 2 Groq keys + 1 Gemini fallback key -> mock key 1 returning `429` -> trigger `curateViralClips` / `social-copy` / `chat` -> verify cooldown on key 1 and transparent failover to key 2 / fallback.
5. **Scenario 5 — Translate/Dubbing & AI B-Roll + BGM Lifecycle**: Attach BGM -> `DELETE /api/clips/:id/bgm` -> re-attach BGM -> translate clip captions -> render with `removeSilences: true` -> verify final MP4 audio/video streams via `ffprobe`.

---

## 6. Execution Commands
```bash
# Run full E2E suite sequentially (from repo root, prevents shared SQLite DB lock contention)
node --test --test-concurrency=1 tests/e2e/*.test.js

# Run individual tiers
node --test --test-concurrency=1 tests/e2e/tier1_features.test.js
node --test --test-concurrency=1 tests/e2e/tier2_boundaries.test.js
node --test --test-concurrency=1 tests/e2e/tier3_pairwise.test.js
node --test --test-concurrency=1 tests/e2e/tier4_workflows.test.js
```
