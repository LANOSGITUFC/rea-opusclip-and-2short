# Project: Opus2Short AI Studio

## Architecture
- **Frontend (`app/web/`)**: Vite 6 + React 18 + TypeScript + Tailwind CSS v4 SPA served by Express in production (`app/web/dist`) or Vite dev server (`:5173` proxying `/api` to `:3000`). Six views: `DashboardView`, `ProjectView`, `EditorView`, `SocialView`, `BrandKitsView`, `SettingsView`.
- **Backend (`app/server/`)**: Express + Node 22 built-in `node:sqlite` (`app/data/studio.db`, WAL mode). Modules:
  - `index.js`: REST API, static SPA serving, bounded job queue, startup recovery, 60s PlanSocial scheduler, HTTP Range video streaming.
  - `db.js`: SQLite schema (`settings`, `projects`, `clips`, `brand_kits`, `social_accounts`, `publish_schedules`, `project_chats`, `api_keys`), multi-key pool cooldown/usage tracking.
  - `llm.js`: Multi-provider LLM & Whisper client (`groq`, `gemini`, `openrouter`, `openai`) with key-pool failover, viral clip curation, social copy generation, and project chat.
  - `workerBridge.js`: Orchestrates Python worker invocations (`ingest`, `transcribe`, `face_track`, `render_clip`), manages progress updates and file cleanup.
  - `oauth.js`: OAuth 2.0 flows for YouTube, TikTok, Instagram + YouTube Shorts upload.
- **Media Worker (`app/worker/pipeline.py`)**: Python 3 CLI using `yt-dlp`, `ffmpeg`, `ffprobe`, `faster-whisper`, and `opencv-python-headless` (`cv2`) for media ingest, audio extraction, local transcription, face-tracking keyframes, `.ass` karaoke subtitle generation, multi-layout reframing, transitions, motion zoom, BGM ducking, AutoColor, watermarks, and MP4 export.

## Feature Inventory
Every Survey feature assigned a milestone (none unassigned):
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Runtime & Build Environment | Install `app/server` & `app/web` npm deps, `tsconfig.json`, `ffmpeg`, `ffprobe`, `yt-dlp`, `faster-whisper`, `opencv-python-headless`, and verify `vite build` | M1 | Survey 3 |
| 2 | Multi-Key Pool & LLM Failover | Fix `llm.js` pool-key gating (`curateViralClips`, `generateSocialCopy`, `projectChat`), cross-provider model fallback, `fetch` timeouts, long transcript handling | M2 | Survey 1 |
| 3 | Bounded Job Queue & Crash Recovery | Add bounded concurrency queue for project pipelines & clip renders, reset stuck DB jobs on startup, clean up old export/BGM/temp files | M2 | Survey 1 |
| 4 | Range Streaming & Safe JSON Endpoints | Fix `streamVideoFile` Range validation & MIME types; fix `/api/clips/:id/translate` JSON parsing | M2 | Survey 1 |
| 5 | OAuth Security & Account Upsert | Add CSRF `state` validation & account upsert in `oauth.js`; stream YouTube uploads; handle non-YouTube connector status cleanly | M2 | Survey 1 |
| 6 | Brand Kit Persistence & Wiring | Persist `watermarkPosition`/`watermarkOpacity` in `POST /api/brand-kits` and pass full Brand Kit styling to `renderClipJob` | M2 | Survey 1 |
| 7 | FFmpeg Progress Bar & Silence Removal | Replace broken `drawbox` `t` expression; fix `silenceremove` A/V desync via synchronized segment trim/concat (compatible with BGM) | M3 | Survey 1 |
| 8 | AI Emojis & Brand Kit Rendering | Render `emoji` in `build_ass_subtitles`; apply Brand Kit watermark position/opacity, colors, and font in `pipeline.py` | M3 | Survey 1 |
| 9 | Multi-Panel Layouts (`three`/`four`) & AutoColor | Implement `three` and `four` split-screen layouts and `deblock`/`glow` AutoColor filters in `pipeline.py` | M3 | Survey 1, 3 |
| 10 | AI B-Roll & Translate/Dubbing Workflows | Implement `builtin:ai-broll` (Giphy API / fallback overlay) and `builtin:translate-dubbing` workflow support | M3 | Survey 1, 3 |
| 11 | Frontend Typecheck, OAuth Routing & Error States | Add `tsconfig.json`/`typecheck`, sync `?oauth=` route in `App.tsx`, add `try/catch` + error/retry UI across all 6 views | M4 | Survey 2 |
| 12 | EditorView Debounce, Video Sync & Controls | Debounce `PATCH /api/clips/:id` sliders, fix split-screen `<video>` ref, add `three`/`four` previews, `fontSize`, `deblock`/`glow`, BGM remove/status, modal/inline UI | M4 | Survey 2 |
| 13 | Settings, Dashboard Polling & API Client Cleanup | Expose `llmModel`/`whisperModel`/`giphyApiKey` in `SettingsView`, smart polling in `DashboardView`, move raw `fetch` to `api.ts`, fix TS types & a11y | M4 | Survey 2 |
| 14 | Docker & Deployment Alignment | Verify `Dockerfile` and `docker-compose.yml` ports, deps, and startup commands match `app/` | M2 | Survey 3 |
| 15 | E2E Verification & Tier 5 Hardening | Pass 100% of E2E suite (Tiers 1–4) and complete Tier 5 adversarial coverage hardening | M5 | Project Pattern |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Environment & Build Setup | Install Node/Python/FFmpeg deps, add `tsconfig.json`, verify `app/web` build and `app/server` + `app/worker` syntax | none | DONE |
| M2 | Backend Stability, LLM Pool & OAuth | Fix `llm.js`, `index.js`, `workerBridge.js`, `oauth.js`, and align `Dockerfile`/`docker-compose.yml` | M1 | DONE |
| M3 | Python Media Pipeline & AI Workflows | Fix `pipeline.py` (`progressBar`, `silenceremove`, `ai-emojis`, `three`/`four`, `AutoColor`, Brand Kit, `ai-broll`, `translate-dubbing`) | M1 | DONE |
| M4 | Frontend UI/UX & Editor Polish | Fix `App.tsx`, `api.ts`, and all 6 views (`DashboardView`, `ProjectView`, `EditorView`, `SocialView`, `BrandKitsView`, `SettingsView`) + `vite build` | M1 | DONE |
| M5 | Final Milestone: E2E & Tier 5 Hardening | Wait for `TEST_READY.md`, pass Tiers 1–4 E2E tests, then run Tier 5 adversarial hardening | M2, M3, M4 | IN_PROGRESS (conv: e8b439cca8a018a4b2a931826fe947f7) |

## Interface Contracts
### Frontend (`app/web/src/api.ts`) ↔ Backend (`app/server/index.js`, `app/server/oauth.js`)
- `GET /api/workflows`, `GET /api/fancy-template-presets`
- `GET/POST /api/settings` (includes `llmProvider`, `llmModel`, `llmApiKey`, `whisperProvider`, `whisperModel`, `whisperApiKey`, `giphyApiKey`, `defaultAspectRatio`, `defaultPreset`)
- `GET/POST /api/keys`, `PATCH/DELETE /api/keys/:id`
- `GET /api/projects`, `POST /api/projects/youtube`, `POST /api/projects/upload`, `GET/DELETE /api/projects/:id`, `GET /api/projects/:id/video`, `GET /api/projects/:id/thumb` (HTTP 200/206/416)
- `GET/PATCH /api/clips/:id`, `POST /api/clips/:id/ai-emojis`, `POST /api/clips/:id/bgm`, `DELETE /api/clips/:id/bgm`, `POST /api/clips/:id/translate`, `POST /api/clips/:id/render`, `GET /api/clips/:id/download`
- `GET/POST /api/projects/:id/chat`
- `GET/POST /api/brand-kits` (accepts `name`, `logo`, `primaryColor`, `highlightColor`, `secondaryColor`, `fontFamily`, `defaultPreset`, `watermarkPosition`, `watermarkOpacity`), `GET /api/brand-kits/:id/logo`, `DELETE /api/brand-kits/:id`
- `GET/POST/DELETE /api/social-accounts`, `POST /api/social-copy`, `GET/POST/DELETE /api/publish-schedules`, `POST /api/publish-schedules/:id/publish-now`
- `GET/POST /api/oauth/config`, `POST /api/oauth/google/upload-secret`, `GET /api/oauth/{youtube,tiktok,instagram}/{start,callback}` -> redirects to `/?oauth=success|error&platform=...&msg=...`

### Backend (`app/server/workerBridge.js`) ↔ Python Worker (`app/worker/pipeline.py`)
- CLI invocation: `python3 app/worker/pipeline.py <command> <json_args_or_file>`
- Commands: `ingest`, `transcribe`, `face_track`, `render_clip`
- `render_clip` JSON payload includes: `video_path`, `output_path`, `ass_path`, `start_sec`, `end_sec`, `aspect_ratio`, `layout_mode` (`auto|fill|fit|split|three|four`), `framing`, `caption_enabled`, `caption_preset`, `caption_config`, `words`, `face_keyframes`, `transition_type`, `motion_type`, `auto_color` (`enabled`, `sharpen`, `denoise`, `deblock`, `glow`), `bgm_path`, `bgm_volume`, `remove_silences`, `progress_bar`, `headline_text`, `watermark_path`, `watermark_position`, `watermark_opacity`, `brand_kit` (`primaryColor`, `highlightColor`, `secondaryColor`, `fontFamily`).

## Code Layout
- `app/server/` — Express backend (`index.js`, `db.js`, `llm.js`, `workerBridge.js`, `oauth.js`, `package.json`)
- `app/worker/` — Python media worker (`pipeline.py`)
- `app/web/` — React/Vite/TS frontend (`index.html`, `package.json`, `tsconfig.json`, `vite.config.ts`, `src/App.tsx`, `src/api.ts`, `src/components/*.tsx`)
- `app/data/` — SQLite DB runtime directory (gitignored)
- `app/storage/` — Media uploads/exports/brandkits runtime directory (gitignored)
- `tests/` — Automated unit, integration, and E2E test suites
- `Dockerfile`, `docker-compose.yml`, `README.md`, `DEPLOY_GRATIS.md`
