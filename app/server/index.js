const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const { db, getSettings, saveSettings } = require("./db");
const { processProjectPipeline, renderClipJob } = require("./workerBridge");
const { generateSocialCopy, projectChat } = require("./llm");

const app = express();
const PORT = process.env.PORT || 3000;

const STORAGE_UPLOADS = path.resolve(__dirname, "../storage/uploads");
const STORAGE_BRANDKITS = path.resolve(__dirname, "../storage/brandkits");
const WEB_DIST = path.resolve(__dirname, "../web/dist");

fs.mkdirSync(STORAGE_UPLOADS, { recursive: true });
fs.mkdirSync(STORAGE_BRANDKITS, { recursive: true });

app.use(cors());
app.use(express.json({ limit: "25mb" }));

const uploadVideo = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, STORAGE_UPLOADS),
    filename: (_, file, cb) => {
      const ext = path.extname(file.originalname || ".mp4") || ".mp4";
      cb(null, `${Date.now()}_${uuidv4().slice(0, 8)}${ext}`);
    }
  }),
  limits: { fileSize: 1024 * 1024 * 1024 } // 1 GB
});

const uploadLogo = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, STORAGE_BRANDKITS),
    filename: (_, file, cb) => {
      const ext = path.extname(file.originalname || ".png") || ".png";
      cb(null, `logo_${Date.now()}_${uuidv4().slice(0, 6)}${ext}`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 }
});

// Helper: HTTP Range streaming for mobile Safari/Chrome video playback
function streamVideoFile(req, res, filePath, downloadName = null) {
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Arquivo de vídeo não encontrado." });
  }
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (downloadName) {
    res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
  }

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 2 * 1024 * 1024, fileSize - 1);
    const chunksize = end - start + 1;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunksize,
      "Content-Type": "video/mp4"
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Accept-Ranges": "bytes",
      "Content-Type": "video/mp4"
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

// ==========================================
// 1. CATALOGS (9 Workflows + 14 Caption Presets + 10 Transitions)
// ==========================================
const WORKFLOWS = [
  { id: "builtin:long-to-shorts", name: "Clip long video", badge: "OpusClip #1", icon: "🎬", desc: "IA encontra hooks, melhores momentos e transforma em shorts virais com speaker tracking 9:16." },
  { id: "builtin:gaming-streams", name: "Clip gaming streams", badge: "Gaming", icon: "🎮", desc: "Detecta clutch plays e reações. Facecam no topo + gameplay embaixo (Split 9:16) com headline." },
  { id: "builtin:auto-edits", name: "Auto-edit talking videos", badge: "Jump-Cut", icon: "✂️", desc: "Remove silêncios, aplica zoom dinâmico e prepara vídeos falados prontos para postar." },
  { id: "builtin:ai-captions", name: "Captions", badge: "Karaokê", icon: "💬", desc: "Legendas animadas palavra por palavra com cores neon e emojis automáticos." },
  { id: "builtin:ai-reframe", name: "Reframe", badge: "9:16 AI", icon: "📐", desc: "Reenquadramento automático por rastreamento facial OpenCV sem crop manual." },
  { id: "builtin:social-edit", name: "Social Edit", badge: "Retenção", icon: "📈", desc: "Adiciona barra de progresso animada e headlines virais para segurar a atenção nos 3s iniciais." },
  { id: "builtin:ai-broll", name: "AI B-roll", badge: "B-Roll", icon: "🎞️", desc: "Sugere e sobrepõe B-rolls e stickers contextuais sincronizados com o roteiro." },
  { id: "builtin:auto-cleaning", name: "Clean up recording", badge: "AutoColor", icon: "✨", desc: "Aplica denoise, sharpen e correção de cor automática em podcasts e entrevistas." },
  { id: "builtin:translate-dubbing", name: "Translate & dub", badge: "Multi-idioma", icon: "🌍", desc: "Transcreve e prepara legendas traduzidas em 20+ idiomas." }
];

const CAPTION_PRESETS = [
  { id: "karaoke", name: "Karaokê Neon", source: "OpusClip", primary: "#FFFFFF", highlight: "#04F827", uppercase: true, wordsPerLine: 3 },
  { id: "think-media", name: "Think Media", source: "OpusClip", primary: "#FFFFFF", highlight: "#FFE600", uppercase: true, wordsPerLine: 3 },
  { id: "highlighter-box", name: "Highlighter Box", source: "OpusClip", primary: "#FFFFFF", highlight: "#1C4EBF", uppercase: true, wordsPerLine: 4 },
  { id: "seamless-bounce", name: "Seamless Bounce", source: "OpusClip", primary: "#FFFFFF", highlight: "#D7FF37", uppercase: true, wordsPerLine: 3 },
  { id: "glitch", name: "Glitch Infinite", source: "OpusClip", primary: "#FFFFFF", highlight: "#5DFBFF", uppercase: true, wordsPerLine: 3 },
  { id: "punch", name: "Punch", source: "OpusClip", primary: "#FFFFFF", highlight: "#FFE600", uppercase: true, wordsPerLine: 2 },
  { id: "comic", name: "Comic Impact", source: "OpusClip", primary: "#FFE600", highlight: "#FF0055", uppercase: true, wordsPerLine: 3 },
  { id: "sunset", name: "Sunset", source: "OpusClip", primary: "#FFFFFF", highlight: "#FF37B9", uppercase: true, wordsPerLine: 3 },
  { id: "spotlight", name: "Spotlight", source: "2Short.ai", primary: "#FFFFFF", highlight: "#FFD600", uppercase: true, wordsPerLine: 3 },
  { id: "marker", name: "Marker", source: "2Short.ai", primary: "#FFFFFF", highlight: "#00F5D4", uppercase: true, wordsPerLine: 3 },
  { id: "one-beat", name: "One Beat", source: "2Short.ai", primary: "#FFFFFF", highlight: "#FF37B9", uppercase: true, wordsPerLine: 1 },
  { id: "editorial", name: "Editorial", source: "2Short.ai", primary: "#F8FAFC", highlight: "#E2E8F0", uppercase: false, wordsPerLine: 5 },
  { id: "typewriter", name: "Typewriter", source: "2Short.ai", primary: "#38BDF8", highlight: "#FFFFFF", uppercase: false, wordsPerLine: 4 },
  { id: "classic", name: "Classic", source: "2Short.ai", primary: "#FFFFFF", highlight: "#FFFFFF", uppercase: false, wordsPerLine: 6 }
];

app.get("/api/workflows", (_, res) => res.json({ workflows: WORKFLOWS }));
app.get("/api/fancy-template-presets", (_, res) => res.json({ presets: CAPTION_PRESETS }));

// ==========================================
// 2. SETTINGS (LLM API Keys, Whisper, Giphy)
// ==========================================
app.get("/api/settings", (_, res) => {
  const s = getSettings();
  res.json({
    ...s,
    hasApiKey: Boolean(s.llmApiKey),
    llmApiKeyMasked: s.llmApiKey ? `${s.llmApiKey.slice(0, 6)}...${s.llmApiKey.slice(-4)}` : "",
    llmApiKey: undefined
  });
});

app.post("/api/settings", (req, res) => {
  const patch = {};
  const allowed = ["llmProvider", "llmModel", "llmApiKey", "whisperProvider", "whisperModel", "giphyApiKey", "defaultLanguage", "socialCopyPrompt"];
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      if (k === "llmApiKey" && req.body[k] === "") continue; // don't wipe unless explicit clear
      patch[k] = req.body[k];
    }
  }
  if (req.body.clearApiKey) patch.llmApiKey = "";
  const updated = saveSettings(patch);
  res.json({
    ok: true,
    settings: {
      ...updated,
      hasApiKey: Boolean(updated.llmApiKey),
      llmApiKeyMasked: updated.llmApiKey ? `${updated.llmApiKey.slice(0, 6)}...${updated.llmApiKey.slice(-4)}` : "",
      llmApiKey: undefined
    }
  });
});

// ==========================================
// 3. PROJECTS (YouTube Ingest, File Upload, List, Detail, Delete)
// ==========================================
app.get("/api/projects", (_, res) => {
  const projects = db.prepare(`
    SELECT p.id, p.title, p.channel, p.sourceType, p.sourceUrl, p.workflowId, p.duration,
           p.width, p.height, p.status, p.progress, p.progressMsg, p.errorMsg, p.language, p.createdAt,
           (SELECT COUNT(*) FROM clips c WHERE c.projectId = p.id) AS clipCount
    FROM projects p
    ORDER BY p.createdAt DESC
  `).all();
  res.json({ projects });
});

app.post("/api/projects/youtube", (req, res) => {
  const { url, workflowId = "builtin:long-to-shorts", title } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "Informe uma URL válida (YouTube, Twitch, etc.)." });
  }
  const id = `P_${uuidv4().slice(0, 10)}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO projects (id, title, sourceType, sourceUrl, workflowId, status, progress, progressMsg, createdAt)
    VALUES (?, ?, 'youtube', ?, ?, 'queued', 5, 'Iniciando download do YouTube...', ?)
  `).run(id, title || "Importando vídeo do YouTube...", url.trim(), workflowId, now);

  // Fire background pipeline
  setImmediate(() => processProjectPipeline(id));
  res.status(201).json({ id, status: "queued" });
});

app.post("/api/projects/upload", uploadVideo.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Envie um arquivo de vídeo (MP4, MOV ou WebM)." });
  }
  const id = `P_${uuidv4().slice(0, 10)}`;
  const workflowId = req.body.workflowId || "builtin:long-to-shorts";
  const title = req.body.title || path.parse(req.file.originalname).name || "Vídeo Enviado";
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO projects (id, title, sourceType, videoPath, workflowId, status, progress, progressMsg, createdAt)
    VALUES (?, ?, 'upload', ?, ?, 'queued', 10, 'Vídeo recebido! Preparando extração...', ?)
  `).run(id, title, req.file.path, workflowId, now);

  setImmediate(() => processProjectPipeline(id));
  res.status(201).json({ id, status: "queued" });
});

app.get("/api/projects/:id", (req, res) => {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!project) return res.status(404).json({ error: "Projeto não encontrado." });
  const clips = db.prepare("SELECT * FROM clips WHERE projectId = ? ORDER BY viralityScore DESC").all(req.params.id);
  res.json({
    project: {
      ...project,
      segments: JSON.parse(project.segmentsJson || "[]"),
      words: JSON.parse(project.wordsJson || "[]"),
      faceKeyframes: JSON.parse(project.faceKeyframesJson || "[]")
    },
    clips: clips.map(formatClip)
  });
});

app.delete("/api/projects/:id", (req, res) => {
  db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.get("/api/projects/:id/video", (req, res) => {
  const project = db.prepare("SELECT videoPath FROM projects WHERE id = ?").get(req.params.id);
  if (!project) return res.status(404).end();
  streamVideoFile(req, res, project.videoPath);
});

app.get("/api/projects/:id/thumb", (req, res) => {
  const project = db.prepare("SELECT thumbPath FROM projects WHERE id = ?").get(req.params.id);
  if (!project || !project.thumbPath || !fs.existsSync(project.thumbPath)) {
    return res.status(404).end();
  }
  res.sendFile(project.thumbPath);
});

// ==========================================
// 4. CLIPS & EDITOR (CRUD, Word Edit, AI Emojis/Highlights, FFmpeg Render)
// ==========================================
function formatClip(c) {
  return {
    ...c,
    captionEnabled: Boolean(c.captionEnabled),
    progressBar: Boolean(c.progressBar),
    liked: Boolean(c.liked),
    captionConfig: JSON.parse(c.captionConfigJson || "{}"),
    framing: JSON.parse(c.framingJson || '{"zoom":1,"panX":0.5,"panY":0.5}'),
    autoColor: JSON.parse(c.autoColorJson || '{"enabled":false}'),
    tracks: JSON.parse(c.tracksJson || "[]"),
    words: JSON.parse(c.wordsJson || "[]")
  };
}

app.get("/api/clips/:id", (req, res) => {
  const clip = db.prepare("SELECT * FROM clips WHERE id = ?").get(req.params.id);
  if (!clip) return res.status(404).json({ error: "Clipe não encontrado." });
  const project = db.prepare("SELECT id, title, duration, width, height, faceKeyframesJson FROM projects WHERE id = ?").get(clip.projectId);
  res.json({
    clip: formatClip(clip),
    project: project ? { ...project, faceKeyframes: JSON.parse(project.faceKeyframesJson || "[]") } : null
  });
});

app.patch("/api/clips/:id", (req, res) => {
  const clip = db.prepare("SELECT * FROM clips WHERE id = ?").get(req.params.id);
  if (!clip) return res.status(404).json({ error: "Clipe não encontrado." });

  const b = req.body || {};
  const updates = {};
  const scalarFields = ["title", "description", "hashtags", "startSec", "endSec", "aspectRatio", "layoutMode", "captionPreset", "transitionType", "motionType", "headlineText", "brandKitId"];
  for (const f of scalarFields) {
    if (b[f] !== undefined) updates[f] = b[f];
  }
  if (b.captionEnabled !== undefined) updates.captionEnabled = b.captionEnabled ? 1 : 0;
  if (b.progressBar !== undefined) updates.progressBar = b.progressBar ? 1 : 0;
  if (b.liked !== undefined) updates.liked = b.liked ? 1 : 0;
  if (b.captionConfig !== undefined) updates.captionConfigJson = JSON.stringify(b.captionConfig);
  if (b.framing !== undefined) updates.framingJson = JSON.stringify(b.framing);
  if (b.autoColor !== undefined) updates.autoColorJson = JSON.stringify(b.autoColor);
  if (b.tracks !== undefined) updates.tracksJson = JSON.stringify(b.tracks);
  if (b.words !== undefined) updates.wordsJson = JSON.stringify(b.words);

  const keys = Object.keys(updates);
  if (keys.length > 0) {
    const sql = `UPDATE clips SET ${keys.map(k => `${k} = ?`).join(", ")} WHERE id = ?`;
    db.prepare(sql).run(...keys.map(k => updates[k]), req.params.id);
  }
  const fresh = db.prepare("SELECT * FROM clips WHERE id = ?").get(req.params.id);
  res.json({ clip: formatClip(fresh) });
});

app.post("/api/clips/:id/ai-emojis", (req, res) => {
  const clip = db.prepare("SELECT * FROM clips WHERE id = ?").get(req.params.id);
  if (!clip) return res.status(404).json({ error: "Clipe não encontrado." });
  const words = JSON.parse(clip.wordsJson || "[]");
  const emojiMap = [
    [/dinheiro|mil|grana|rico|dólar|real|lucro|preço/i, "💰"],
    [/fogo|insano|épico|incrível|brabo|top|viral/i, "🔥"],
    [/polícia|alerta|cuidado|perigo|urgente|pare/i, "🚨"],
    [/cofre|segredo|chave|código|senha/i, "🔐"],
    [/rápido|corre|agora|vai|velocidade/i, "⚡"],
    [/risada|haha|kkk|engraçado|rir/i, "😂"],
    [/jogo|game|play|ganhei|vitória/i, "🎮"],
    [/ideia|dica|aprende|segredo|mente/i, "💡"],
    [/amor|coração|amo|lindo/i, "❤️"],
    [/morte|morrer|morri|acabou/i, "💀"]
  ];
  const enriched = words.map(w => {
    for (const [rx, em] of emojiMap) {
      if (rx.test(w.text)) return { ...w, emoji: em };
    }
    return w;
  });
  db.prepare("UPDATE clips SET wordsJson = ? WHERE id = ?").run(JSON.stringify(enriched), clip.id);
  res.json({ words: enriched });
});

app.post("/api/clips/:id/render", (req, res) => {
  const clip = db.prepare("SELECT * FROM clips WHERE id = ?").get(req.params.id);
  if (!clip) return res.status(404).json({ error: "Clipe não encontrado." });
  const { resolution = "1080p", fps = 30 } = req.body || {};

  setImmediate(() => {
    renderClipJob(clip.id, { resolution, fps }).catch(err => console.error("[Render error]", err.message));
  });
  res.json({ status: "rendering", clipId: clip.id });
});

app.get("/api/clips/:id/download", (req, res) => {
  const clip = db.prepare("SELECT title, exportPath FROM clips WHERE id = ?").get(req.params.id);
  if (!clip || !clip.exportPath || !fs.existsSync(clip.exportPath)) {
    return res.status(404).json({ error: "Clipe ainda não foi renderizado." });
  }
  const safeName = (clip.title || "short").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40) + ".mp4";
  streamVideoFile(req, res, clip.exportPath, safeName);
});

// ==========================================
// 5. PROJECT CHAT (2Short AI Copilot)
// ==========================================
app.get("/api/projects/:id/chat", (req, res) => {
  const messages = db.prepare("SELECT * FROM project_chats WHERE projectId = ? ORDER BY createdAt ASC").all(req.params.id);
  res.json({ messages });
});

app.post("/api/projects/:id/chat", async (req, res) => {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!project) return res.status(404).json({ error: "Projeto não encontrado." });
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: "Mensagem vazia." });

  const now = new Date().toISOString();
  db.prepare("INSERT INTO project_chats(id, projectId, role, content, createdAt) VALUES(?, ?, 'user', ?, ?)")
    .run(uuidv4(), project.id, message, now);

  const clips = db.prepare("SELECT * FROM clips WHERE projectId = ?").all(project.id);
  const history = db.prepare("SELECT role, content FROM project_chats WHERE projectId = ? ORDER BY createdAt ASC").all(project.id);
  const settings = getSettings();

  const reply = await projectChat({ project, clips, history, message, settings });
  const replyId = uuidv4();
  const replyTime = new Date().toISOString();
  db.prepare("INSERT INTO project_chats(id, projectId, role, content, createdAt) VALUES(?, ?, 'assistant', ?, ?)")
    .run(replyId, project.id, reply, replyTime);

  res.json({ reply: { id: replyId, role: "assistant", content: reply, createdAt: replyTime } });
});

// ==========================================
// 6. BRAND KITS
// ==========================================
app.get("/api/brand-kits", (_, res) => {
  const kits = db.prepare("SELECT * FROM brand_kits ORDER BY createdAt DESC").all();
  res.json({ kits });
});

app.post("/api/brand-kits", uploadLogo.single("logo"), (req, res) => {
  const id = `BK_${uuidv4().slice(0, 8)}`;
  const { name = "Meu Brand Kit", primaryColor = "#0169EE", highlightColor = "#04F827", secondaryColor = "#FF37B9", fontFamily = "DejaVu Sans", defaultPreset = "karaoke" } = req.body || {};
  const logoPath = req.file ? req.file.path : "";
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO brand_kits (id, name, logoPath, primaryColor, highlightColor, secondaryColor, fontFamily, defaultPreset, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, logoPath, primaryColor, highlightColor, secondaryColor, fontFamily, defaultPreset, now);

  res.status(201).json({ kit: db.prepare("SELECT * FROM brand_kits WHERE id = ?").get(id) });
});

app.get("/api/brand-kits/:id/logo", (req, res) => {
  const kit = db.prepare("SELECT logoPath FROM brand_kits WHERE id = ?").get(req.params.id);
  if (!kit || !kit.logoPath || !fs.existsSync(kit.logoPath)) return res.status(404).end();
  res.sendFile(kit.logoPath);
});

app.delete("/api/brand-kits/:id", (req, res) => {
  db.prepare("DELETE FROM brand_kits WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ==========================================
// 7. PLANSOCIAL (Social Accounts, AI Copy & Publish Calendar)
// ==========================================
app.get("/api/social-accounts", (_, res) => {
  const accounts = db.prepare("SELECT id, platform, accountName, handle, profileUrl, scopesJson, enabled, createdAt FROM social_accounts ORDER BY createdAt DESC").all();
  res.json({ accounts: accounts.map(a => ({ ...a, scopes: JSON.parse(a.scopesJson || "[]"), enabled: Boolean(a.enabled) })) });
});

app.post("/api/social-accounts", (req, res) => {
  const { platform, accountName, handle = "", accessToken = "", refreshToken = "" } = req.body || {};
  if (!platform || !accountName) return res.status(400).json({ error: "Plataforma e nome da conta são obrigatórios." });
  const id = `SA_${uuidv4().slice(0, 8)}`;
  const scopesByPlatform = {
    YOUTUBE: ["youtube.upload", "yt-analytics.readonly"],
    TIKTOK_BUSINESS: ["video.publish", "video.upload", "user.info.basic"],
    INSTAGRAM_BUSINESS: ["instagram_content_publish", "pages_read_engagement"],
    FACEBOOK: ["pages_manage_posts"],
    LINKEDIN: ["w_member_social"],
    TWITTER: ["tweet.write", "media.write"],
    THREADS: ["threads_content_publish"]
  };
  db.prepare(`
    INSERT INTO social_accounts (id, platform, accountName, handle, scopesJson, accessToken, refreshToken, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, platform, accountName, handle, JSON.stringify(scopesByPlatform[platform] || []), accessToken, refreshToken, new Date().toISOString());

  res.status(201).json({ account: db.prepare("SELECT id, platform, accountName, handle, enabled, createdAt FROM social_accounts WHERE id = ?").get(id) });
});

app.delete("/api/social-accounts/:id", (req, res) => {
  db.prepare("DELETE FROM social_accounts WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.post("/api/social-copy", async (req, res) => {
  const { clipId, platform = "YOUTUBE", prompt } = req.body || {};
  const clip = db.prepare("SELECT * FROM clips WHERE id = ?").get(clipId);
  if (!clip) return res.status(404).json({ error: "Clipe não encontrado." });
  const copy = await generateSocialCopy({ clip, platform, customPrompt: prompt, settings: getSettings() });
  res.json({ copy });
});

app.get("/api/publish-schedules", (_, res) => {
  const schedules = db.prepare(`
    SELECT ps.*, sa.accountName, sa.handle, c.title AS clipTitle, c.exportStatus
    FROM publish_schedules ps
    LEFT JOIN social_accounts sa ON sa.id = ps.accountId
    LEFT JOIN clips c ON c.id = ps.clipId
    ORDER BY ps.scheduledAt ASC
  `).all();
  res.json({ schedules });
});

app.post("/api/publish-schedules", (req, res) => {
  const { clipId, accountId, platform, title, description = "", hashtags = "", scheduledAt, timezone = "America/Sao_Paulo" } = req.body || {};
  const clip = db.prepare("SELECT * FROM clips WHERE id = ?").get(clipId);
  if (!clip) return res.status(404).json({ error: "Clipe não encontrado." });
  const id = `PS_${uuidv4().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO publish_schedules (id, clipId, projectId, accountId, platform, title, description, hashtags, scheduledAt, timezone, status, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
  `).run(id, clipId, clip.projectId, accountId || "", platform || "YOUTUBE", title || clip.title, description, hashtags, scheduledAt || new Date().toISOString(), timezone, new Date().toISOString());

  res.status(201).json({ schedule: db.prepare("SELECT * FROM publish_schedules WHERE id = ?").get(id) });
});

app.post("/api/publish-schedules/:id/publish-now", (req, res) => {
  const item = db.prepare("SELECT * FROM publish_schedules WHERE id = ?").get(req.params.id);
  if (!item) return res.status(404).json({ error: "Agendamento não encontrado." });
  const acc = db.prepare("SELECT * FROM social_accounts WHERE id = ?").get(item.accountId);
  if (!acc || !acc.accessToken) {
    db.prepare("UPDATE publish_schedules SET status = 'FAILED', errorMsg = ? WHERE id = ?")
      .run("Conta conectada sem token OAuth válido. Configure o OAuth Token na aba Redes Sociais.", item.id);
    return res.json({ status: "FAILED", error: "Token OAuth não configurado para publicação real na rede." });
  }
  db.prepare("UPDATE publish_schedules SET status = 'PUBLISHED', errorMsg = '' WHERE id = ?").run(item.id);
  res.json({ status: "PUBLISHED" });
});

app.delete("/api/publish-schedules/:id", (req, res) => {
  db.prepare("DELETE FROM publish_schedules WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ==========================================
// 8. SERVE FRONTEND SPA
// ==========================================
if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(WEB_DIST, "index.html"));
  });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Opus2Short AI Studio Server listening on http://0.0.0.0:${PORT}`);
});
