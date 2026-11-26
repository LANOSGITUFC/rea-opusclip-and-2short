const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { db, getSettings, saveSettings } = require("./db");

const DATA_DIR = path.resolve(__dirname, "../data");

function getOAuthConfig() {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'oauth_%'").all();
  const cfg = {};
  for (const r of rows) cfg[r.key] = r.value;

  // Auto-load Google client_secret*.json from app/data (works automatically with Google Drive in Colab!)
  if (!cfg.oauth_google_client_id) {
    try {
      const files = fs.readdirSync(DATA_DIR).filter(f => /^client_secret.*\.json$/i.test(f));
      if (files.length > 0) {
        const parsed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, files[0]), "utf8"));
        const creds = parsed.web || parsed.installed;
        if (creds?.client_id && creds?.client_secret) {
          cfg.oauth_google_client_id = creds.client_id;
          cfg.oauth_google_client_secret = creds.client_secret;
          saveSettings({
            oauth_google_client_id: creds.client_id,
            oauth_google_client_secret: creds.client_secret
          });
        }
      }
    } catch {}
  }

  return {
    googleClientId: cfg.oauth_google_client_id || "",
    googleClientSecret: cfg.oauth_google_client_secret || "",
    tiktokClientKey: cfg.oauth_tiktok_client_key || "",
    tiktokClientSecret: cfg.oauth_tiktok_client_secret || "",
    metaAppId: cfg.oauth_meta_app_id || "",
    metaAppSecret: cfg.oauth_meta_app_secret || ""
  };
}

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

async function refreshGoogleAccessToken(account) {
  const cfg = getOAuthConfig();
  if (!account.refreshToken || !cfg.googleClientId || !cfg.googleClientSecret) {
    return account.accessToken;
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.googleClientId,
      client_secret: cfg.googleClientSecret,
      refresh_token: account.refreshToken,
      grant_type: "refresh_token"
    })
  });
  if (!res.ok) return account.accessToken;
  const data = await res.json();
  if (data.access_token) {
    db.prepare("UPDATE social_accounts SET accessToken = ? WHERE id = ?").run(data.access_token, account.id);
    return data.access_token;
  }
  return account.accessToken;
}

/**
 * Real YouTube Data API v3 Shorts Upload (multipart metadata + mp4 binary)
 */
async function uploadToYouTubeShorts(schedule, account, videoFilePath) {
  const token = await refreshGoogleAccessToken(account);
  if (!token) throw new Error("Token OAuth do YouTube ausente. Reconecte sua conta Google.");
  if (!videoFilePath || !fs.existsSync(videoFilePath)) {
    throw new Error("Renderize o clipe em MP4 no Editor antes de publicar no YouTube.");
  }

  const metadata = {
    snippet: {
      title: String(schedule.title || "Short").slice(0, 100),
      description: `${schedule.description || ""}\n\n${schedule.hashtags || "#shorts"}`.trim(),
      categoryId: "22"
    },
    status: {
      privacyStatus: "public",
      selfDeclaredMadeForKids: false
    }
  };

  const boundary = "opus2short_yt_boundary_" + Date.now();
  const videoBuffer = fs.readFileSync(videoFilePath);

  const part1 = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`
  );
  const part2 = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([part1, videoBuffer, part2]);

  const res = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length)
      },
      body
    }
  );

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error(`YouTube Upload erro (${res.status}): ${data.error?.message || JSON.stringify(data).slice(0, 200)}`);
  }
  return `https://www.youtube.com/shorts/${data.id}`;
}

function registerOAuthRoutes(app, uploadJsonMiddleware) {
  // Get OAuth status + exact Redirect URIs to paste into Google/TikTok/Meta Consoles
  app.get("/api/oauth/config", (req, res) => {
    const cfg = getOAuthConfig();
    const base = getBaseUrl(req);
    res.json({
      googleConfigured: Boolean(cfg.googleClientId && cfg.googleClientSecret),
      googleClientIdPreview: cfg.googleClientId ? `${cfg.googleClientId.slice(0, 16)}...` : "",
      tiktokConfigured: Boolean(cfg.tiktokClientKey && cfg.tiktokClientSecret),
      metaConfigured: Boolean(cfg.metaAppId && cfg.metaAppSecret),
      redirectUris: {
        youtube: `${base}/api/oauth/youtube/callback`,
        tiktok: `${base}/api/oauth/tiktok/callback`,
        instagram: `${base}/api/oauth/instagram/callback`
      }
    });
  });

  // Save OAuth client IDs/secrets manually
  app.post("/api/oauth/config", (req, res) => {
    const b = req.body || {};
    const patch = {};
    if (b.googleClientId) patch.oauth_google_client_id = b.googleClientId.trim();
    if (b.googleClientSecret) patch.oauth_google_client_secret = b.googleClientSecret.trim();
    if (b.tiktokClientKey) patch.oauth_tiktok_client_key = b.tiktokClientKey.trim();
    if (b.tiktokClientSecret) patch.oauth_tiktok_client_secret = b.tiktokClientSecret.trim();
    if (b.metaAppId) patch.oauth_meta_app_id = b.metaAppId.trim();
    if (b.metaAppSecret) patch.oauth_meta_app_secret = b.metaAppSecret.trim();
    saveSettings(patch);
    res.json({ ok: true });
  });

  // Upload Google Cloud client_secret_*.json directly from phone/laptop
  app.post("/api/oauth/google/upload-secret", uploadJsonMiddleware.single("file"), (req, res) => {
    try {
      const raw = req.file ? fs.readFileSync(req.file.path, "utf8") : (req.body.jsonText || "");
      const parsed = JSON.parse(raw);
      const creds = parsed.web || parsed.installed;
      if (!creds?.client_id || !creds?.client_secret) {
        return res.status(400).json({ error: "Arquivo JSON inválido. Exporte o OAuth 2.0 Client ID (Web application) do Google Cloud Console." });
      }
      saveSettings({
        oauth_google_client_id: creds.client_id,
        oauth_google_client_secret: creds.client_secret
      });
      // Persist copy in app/data/client_secret.json
      fs.writeFileSync(path.join(DATA_DIR, "client_secret.json"), raw);
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.json({ ok: true, clientId: creds.client_id });
    } catch (e) {
      res.status(400).json({ error: `Erro ao ler client_secret.json: ${e.message}` });
    }
  });

  // === YOUTUBE OAUTH START & CALLBACK ===
  app.get("/api/oauth/youtube/start", (req, res) => {
    const cfg = getOAuthConfig();
    if (!cfg.googleClientId) {
      return res.status(400).send("Envie primeiro seu client_secret.json do Google Cloud Console na aba PlanSocial.");
    }
    const redirectUri = `${getBaseUrl(req)}/api/oauth/youtube/callback`;
    const params = new URLSearchParams({
      client_id: cfg.googleClientId,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly"
      ].join(" ")
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get("/api/oauth/youtube/callback", async (req, res) => {
    try {
      const code = req.query.code;
      if (!code) return res.redirect("/?oauth=error&msg=missing_code");
      const cfg = getOAuthConfig();
      const redirectUri = `${getBaseUrl(req)}/api/oauth/youtube/callback`;

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: String(code),
          client_id: cfg.googleClientId,
          client_secret: cfg.googleClientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code"
        })
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.access_token) {
        return res.redirect(`/?oauth=error&msg=${encodeURIComponent(tokenData.error_description || "token_exchange_failed")}`);
      }

      // Fetch YouTube channel name
      const chRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const chData = await chRes.json().catch(() => ({}));
      const ch = chData.items?.[0];
      const name = ch?.snippet?.title || "Canal YouTube";
      const handle = ch?.snippet?.customUrl || "";
      const profileUrl = ch?.id ? `https://www.youtube.com/channel/${ch.id}` : "";

      db.prepare(`
        INSERT INTO social_accounts (id, platform, accountName, handle, profileUrl, scopesJson, accessToken, refreshToken, createdAt)
        VALUES (?, 'YOUTUBE', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `SA_${uuidv4().slice(0, 8)}`,
        name,
        handle,
        profileUrl,
        JSON.stringify(["youtube.upload", "youtube.readonly"]),
        tokenData.access_token,
        tokenData.refresh_token || "",
        new Date().toISOString()
      );

      res.redirect("/?oauth=success&platform=YOUTUBE");
    } catch (err) {
      res.redirect(`/?oauth=error&msg=${encodeURIComponent(err.message)}`);
    }
  });

  // === TIKTOK OAUTH START & CALLBACK ===
  app.get("/api/oauth/tiktok/start", (req, res) => {
    const cfg = getOAuthConfig();
    if (!cfg.tiktokClientKey) {
      return res.status(400).send("Configure o TikTok Client Key e Client Secret na aba PlanSocial primeiro.");
    }
    const redirectUri = `${getBaseUrl(req)}/api/oauth/tiktok/callback`;
    const params = new URLSearchParams({
      client_key: cfg.tiktokClientKey,
      scope: "user.info.basic,video.upload,video.publish",
      response_type: "code",
      redirect_uri: redirectUri,
      state: uuidv4().slice(0, 12)
    });
    res.redirect(`https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`);
  });

  app.get("/api/oauth/tiktok/callback", async (req, res) => {
    try {
      const code = req.query.code;
      if (!code) return res.redirect("/?oauth=error&msg=missing_code");
      const cfg = getOAuthConfig();
      const redirectUri = `${getBaseUrl(req)}/api/oauth/tiktok/callback`;

      const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: cfg.tiktokClientKey,
          client_secret: cfg.tiktokClientSecret,
          code: String(code),
          grant_type: "authorization_code",
          redirect_uri: redirectUri
        })
      });
      const data = await tokenRes.json();
      if (!data.access_token) {
        return res.redirect(`/?oauth=error&msg=${encodeURIComponent(data.error_description || "tiktok_token_failed")}`);
      }
      db.prepare(`
        INSERT INTO social_accounts (id, platform, accountName, handle, scopesJson, accessToken, refreshToken, createdAt)
        VALUES (?, 'TIKTOK_BUSINESS', ?, ?, ?, ?, ?, ?)
      `).run(
        `SA_${uuidv4().slice(0, 8)}`,
        `TikTok (${data.open_id?.slice(0, 8) || "Conta"})`,
        "",
        JSON.stringify(["user.info.basic", "video.upload", "video.publish"]),
        data.access_token,
        data.refresh_token || "",
        new Date().toISOString()
      );
      res.redirect("/?oauth=success&platform=TIKTOK_BUSINESS");
    } catch (err) {
      res.redirect(`/?oauth=error&msg=${encodeURIComponent(err.message)}`);
    }
  });

  // === INSTAGRAM (META) OAUTH START & CALLBACK ===
  app.get("/api/oauth/instagram/start", (req, res) => {
    const cfg = getOAuthConfig();
    if (!cfg.metaAppId) {
      return res.status(400).send("Configure o Meta App ID e App Secret na aba PlanSocial primeiro.");
    }
    const redirectUri = `${getBaseUrl(req)}/api/oauth/instagram/callback`;
    const params = new URLSearchParams({
      client_id: cfg.metaAppId,
      redirect_uri: redirectUri,
      scope: "instagram_basic,instagram_content_publish,pages_show_list",
      response_type: "code"
    });
    res.redirect(`https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`);
  });

  app.get("/api/oauth/instagram/callback", async (req, res) => {
    try {
      const code = req.query.code;
      if (!code) return res.redirect("/?oauth=error&msg=missing_code");
      const cfg = getOAuthConfig();
      const redirectUri = `${getBaseUrl(req)}/api/oauth/instagram/callback`;

      const tokenRes = await fetch(
        `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${encodeURIComponent(cfg.metaAppId)}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${encodeURIComponent(cfg.metaAppSecret)}&code=${encodeURIComponent(String(code))}`
      );
      const data = await tokenRes.json();
      if (!data.access_token) {
        return res.redirect(`/?oauth=error&msg=${encodeURIComponent(data.error?.message || "meta_token_failed")}`);
      }
      db.prepare(`
        INSERT INTO social_accounts (id, platform, accountName, handle, scopesJson, accessToken, refreshToken, createdAt)
        VALUES (?, 'INSTAGRAM_BUSINESS', 'Instagram Business', '', ?, ?, '', ?)
      `).run(
        `SA_${uuidv4().slice(0, 8)}`,
        JSON.stringify(["instagram_basic", "instagram_content_publish"]),
        data.access_token,
        new Date().toISOString()
      );
      res.redirect("/?oauth=success&platform=INSTAGRAM_BUSINESS");
    } catch (err) {
      res.redirect(`/?oauth=error&msg=${encodeURIComponent(err.message)}`);
    }
  });
}

module.exports = { registerOAuthRoutes, uploadToYouTubeShorts, getOAuthConfig };
