const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

const { DATA_DIR } = require("./paths");

const DB_PATH = path.join(DATA_DIR, "studio.db");
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    channel TEXT DEFAULT '',
    sourceType TEXT NOT NULL, -- 'youtube' | 'upload'
    sourceUrl TEXT DEFAULT '',
    workflowId TEXT DEFAULT 'builtin:long-to-shorts',
    videoPath TEXT DEFAULT '',
    audioPath TEXT DEFAULT '',
    thumbPath TEXT DEFAULT '',
    duration REAL DEFAULT 0,
    width INTEGER DEFAULT 1280,
    height INTEGER DEFAULT 720,
    fps REAL DEFAULT 30,
    status TEXT DEFAULT 'queued', -- 'queued' | 'downloading' | 'transcribing' | 'tracking' | 'curating' | 'ready' | 'error'
    progress INTEGER DEFAULT 0,
    progressMsg TEXT DEFAULT 'Na fila...',
    errorMsg TEXT DEFAULT '',
    language TEXT DEFAULT 'pt',
    transcriptText TEXT DEFAULT '',
    segmentsJson TEXT DEFAULT '[]',
    wordsJson TEXT DEFAULT '[]',
    faceKeyframesJson TEXT DEFAULT '[]',
    brandKitId TEXT DEFAULT '',
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    hashtags TEXT DEFAULT '',
    viralityScore INTEGER DEFAULT 80,
    hookScore INTEGER DEFAULT 80,
    pacingScore INTEGER DEFAULT 80,
    storyScore INTEGER DEFAULT 80,
    reason TEXT DEFAULT '',
    startSec REAL NOT NULL,
    endSec REAL NOT NULL,
    aspectRatio TEXT DEFAULT '9:16',
    layoutMode TEXT DEFAULT 'auto', -- 'auto' | 'fill' | 'fit' | 'split' | 'three' | 'four'
    captionEnabled INTEGER DEFAULT 1,
    captionPreset TEXT DEFAULT 'karaoke',
    captionConfigJson TEXT DEFAULT '{}',
    framingJson TEXT DEFAULT '{"zoom":1,"panX":0.5,"panY":0.5}',
    transitionType TEXT DEFAULT 'hard-cut',
    motionType TEXT DEFAULT 'none',
    autoColorJson TEXT DEFAULT '{"enabled":false,"denoise":0,"sharpen":0.5,"deblock":0.2,"glow":0}',
    tracksJson TEXT DEFAULT '[]',
    wordsJson TEXT DEFAULT '[]',
    headlineText TEXT DEFAULT '',
    progressBar INTEGER DEFAULT 0,
    brandKitId TEXT DEFAULT '',
    liked INTEGER DEFAULT 0,
    exportPath TEXT DEFAULT '',
    exportStatus TEXT DEFAULT 'idle', -- 'idle' | 'rendering' | 'done' | 'error'
    exportError TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS brand_kits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    logoPath TEXT DEFAULT '',
    primaryColor TEXT DEFAULT '#0169EE',
    highlightColor TEXT DEFAULT '#04F827',
    secondaryColor TEXT DEFAULT '#FF37B9',
    fontFamily TEXT DEFAULT 'DejaVu Sans',
    defaultPreset TEXT DEFAULT 'karaoke',
    watermarkPosition TEXT DEFAULT 'top-right',
    watermarkOpacity REAL DEFAULT 0.9,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS social_accounts (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL, -- YOUTUBE | TIKTOK_BUSINESS | INSTAGRAM_BUSINESS | FACEBOOK | LINKEDIN | TWITTER | THREADS
    accountName TEXT NOT NULL,
    handle TEXT DEFAULT '',
    profileUrl TEXT DEFAULT '',
    scopesJson TEXT DEFAULT '[]',
    accessToken TEXT DEFAULT '',
    refreshToken TEXT DEFAULT '',
    enabled INTEGER DEFAULT 1,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS publish_schedules (
    id TEXT PRIMARY KEY,
    clipId TEXT NOT NULL,
    projectId TEXT NOT NULL,
    accountId TEXT NOT NULL,
    platform TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    hashtags TEXT DEFAULT '',
    scheduledAt TEXT NOT NULL,
    timezone TEXT DEFAULT 'America/Sao_Paulo',
    status TEXT DEFAULT 'PENDING', -- PENDING | UPLOADING | PUBLISHED | FAILED
    errorMsg TEXT DEFAULT '',
    publishedUrl TEXT DEFAULT '',
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_chats (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    role TEXT NOT NULL, -- 'user' | 'assistant'
    content TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    provider TEXT NOT NULL, -- 'groq' | 'gemini' | 'openai' | 'openrouter'
    apiKey TEXT NOT NULL,
    model TEXT DEFAULT '',
    capabilities TEXT DEFAULT 'both', -- 'both' | 'llm' | 'whisper'
    enabled INTEGER DEFAULT 1,
    usageCount INTEGER DEFAULT 0,
    errorCount INTEGER DEFAULT 0,
    lastError TEXT DEFAULT '',
    cooldownUntil TEXT DEFAULT '',
    lastUsedAt TEXT DEFAULT '',
    createdAt TEXT NOT NULL
  );
`);

function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    llmProvider: map.llmProvider || "groq",
    llmModel: map.llmModel || "",
    llmApiKey: map.llmApiKey || "",
    whisperProvider: map.whisperProvider || "groq", // 'local' | 'groq' | 'openai'
    whisperModel: map.whisperModel || "tiny",
    giphyApiKey: map.giphyApiKey || "",
    defaultLanguage: map.defaultLanguage || "pt",
    socialCopyPrompt: map.socialCopyPrompt || "Escreva título chamativo, descrição curta e hashtags virais em português do Brasil."
  };
}

function saveSettings(patch) {
  const stmt = db.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined && v !== null) {
      stmt.run(k, String(v));
    }
  }
  return getSettings();
}

function maskKey(k) {
  if (!k || k.length < 10) return "****";
  return `${k.slice(0, 6)}...${k.slice(-4)}`;
}

function listApiKeys() {
  const rows = db.prepare("SELECT * FROM api_keys ORDER BY createdAt DESC").all();
  return rows.map(r => ({
    id: r.id,
    label: r.label,
    provider: r.provider,
    apiKeyMasked: maskKey(r.apiKey),
    model: r.model,
    capabilities: r.capabilities,
    enabled: Boolean(r.enabled),
    usageCount: r.usageCount,
    errorCount: r.errorCount,
    lastError: r.lastError,
    cooldownUntil: r.cooldownUntil,
    lastUsedAt: r.lastUsedAt,
    createdAt: r.createdAt
  }));
}

function getActiveKeysFor(capability, preferredProvider = "") {
  const nowIso = new Date().toISOString();
  const rows = db.prepare(`
    SELECT * FROM api_keys
    WHERE enabled = 1
      AND (cooldownUntil = '' OR cooldownUntil <= ?)
      AND (capabilities = 'both' OR capabilities = ?)
    ORDER BY
      CASE WHEN provider = ? THEN 0 ELSE 1 END ASC,
      lastUsedAt ASC,
      usageCount ASC
  `).all(nowIso, capability, preferredProvider);

  // If whisper requested, only groq/openai support Whisper audio endpoint
  if (capability === "whisper") {
    return rows.filter(r => r.provider === "groq" || r.provider === "openai");
  }
  return rows;
}

function recordKeySuccess(id) {
  if (!id) return;
  db.prepare(`
    UPDATE api_keys
    SET usageCount = usageCount + 1, lastUsedAt = ?, lastError = '', cooldownUntil = ''
    WHERE id = ?
  `).run(new Date().toISOString(), id);
}

function recordKeyError(id, statusCode, message) {
  if (!id) return;
  // 429 rate-limit -> 15 min cooldown; 401/403 -> 60 min cooldown; other -> 2 min cooldown
  const cooldownMs = statusCode === 429 ? 15 * 60_000 : (statusCode === 401 || statusCode === 403) ? 60 * 60_000 : 2 * 60_000;
  const until = new Date(Date.now() + cooldownMs).toISOString();
  db.prepare(`
    UPDATE api_keys
    SET errorCount = errorCount + 1, lastError = ?, cooldownUntil = ?
    WHERE id = ?
  `).run(String(message || "Erro na API").slice(0, 220), until, id);
}

function upsertSocialAccount({ id, platform, accountName, handle = "", profileUrl = "", scopesJson = "[]", accessToken = "", refreshToken = "" }) {
  const existing = handle
    ? db.prepare("SELECT * FROM social_accounts WHERE platform = ? AND (handle = ? OR accountName = ?) LIMIT 1").get(platform, handle, accountName)
    : db.prepare("SELECT * FROM social_accounts WHERE platform = ? AND accountName = ? LIMIT 1").get(platform, accountName);

  if (existing) {
    db.prepare(`
      UPDATE social_accounts
      SET accountName = ?,
          handle = ?,
          profileUrl = ?,
          scopesJson = ?,
          accessToken = ?,
          refreshToken = CASE WHEN ? != '' THEN ? ELSE refreshToken END,
          enabled = 1
      WHERE id = ?
    `).run(
      accountName,
      handle,
      profileUrl || existing.profileUrl || "",
      scopesJson,
      accessToken,
      refreshToken || "",
      refreshToken || "",
      existing.id
    );
    return existing.id;
  }

  db.prepare(`
    INSERT INTO social_accounts (id, platform, accountName, handle, profileUrl, scopesJson, accessToken, refreshToken, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    platform,
    accountName,
    handle,
    profileUrl,
    scopesJson,
    accessToken,
    refreshToken,
    new Date().toISOString()
  );
  return id;
}

module.exports = {
  db,
  getSettings,
  saveSettings,
  listApiKeys,
  getActiveKeysFor,
  recordKeySuccess,
  recordKeyError,
  upsertSocialAccount
};
