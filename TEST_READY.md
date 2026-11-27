# E2E Test Suite Ready (`TEST_READY.md`)

## Status: READY FOR M5 EXECUTION

The opaque-box, requirement-driven E2E test suite for **Opus2Short AI Studio** is implemented, verified, and audited (`CLEAN`).

## Deliverables
- `TEST_INFRA.md` — Category-Partition, BVA, Pairwise, and Real-World Workload test design
- `tests/e2e/helpers/harness.js` — Ephemeral server lifecycle, `FatalPollError`, multipart & HTTP helpers, resource cleanup
- `tests/e2e/helpers/fixtures.js` — Deterministic synthetic media generator (`ffmpeg` 6s video, silent-gap video, BGM audio, PNG logo, `ffprobe` verifier)
- `tests/e2e/helpers/mock-apis.js` — Local HTTP mock server for Groq, OpenAI, OpenRouter, Gemini, Giphy, Google OAuth, YouTube, TikTok, Instagram
- `tests/e2e/helpers/fetch-interceptor.cjs` — `NODE_OPTIONS` preload routing external `fetch` calls to `mock-apis.js`
- `tests/e2e/tier1_features.test.js` — Tier 1 Feature Coverage (`F1`–`F14`)
- `tests/e2e/tier2_boundaries.test.js` — Tier 2 Boundary & Corner Cases (14/14 passing)
- `tests/e2e/tier3_pairwise.test.js` — Tier 3 Cross-Feature Pairwise Combinations (Matrices 1–5)
- `tests/e2e/tier4_workflows.test.js` — Tier 4 Real-World End-to-End Workflows (Scenarios 1–5)

## How to Run (from repo root)
```bash
node --test --test-concurrency=1 tests/e2e/*.test.js
```

## Baseline Findings Handed Off to M5
Running the verified E2E suite against the current `app/` codebase yields **34 passed / 9 failed** (43 total, 0 skipped), surfacing two genuine `app/` defects for M5 to fix:
1. **Missing `app/storage/exports/` directory (8 failures)**: `app/server/workerBridge.js` / `app/worker/pipeline.py` write `.ass` and `.mp4` files to `app/storage/exports/` without creating the directory (`mkdirSync(..., { recursive: true })` / `mkdir(parents=True, exist_ok=True)`).
2. **Transient SQLite lock / `POST /api/keys` 500 (1 intermittent failure in full sequential run)**: Consider adding `PRAGMA busy_timeout = 5000;` in `app/server/db.js`.
