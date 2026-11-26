const { spawn } = require("child_process");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { db, getSettings } = require("./db");
const { curateViralClips } = require("./llm");

const WORKER_SCRIPT = path.resolve(__dirname, "../worker/pipeline.py");
const STORAGE_PROJECTS = path.resolve(__dirname, "../storage/projects");
const STORAGE_EXPORTS = path.resolve(__dirname, "../storage/exports");

function runPythonWorker(command, payload) {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [WORKER_SCRIPT, command], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", chunk => { stdout += chunk.toString(); });
    proc.stderr.on("data", chunk => { stderr += chunk.toString(); });
    proc.on("error", err => reject(err));
    proc.on("close", code => {
      const lines = stdout.trim().split("\n").filter(Boolean);
      const lastLine = lines[lines.length - 1] || "";
      try {
        const parsed = JSON.parse(lastLine);
        if (parsed.ok) return resolve(parsed.data);
        return reject(new Error(parsed.error || `Worker failed (code ${code})`));
      } catch {
        return reject(new Error(`Worker invalid output (code ${code}): ${stderr.slice(-500) || stdout.slice(-500)}`));
      }
    });
    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
  });
}

function updateProject(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const setSql = keys.map(k => `${k} = ?`).join(", ");
  const vals = keys.map(k => fields[k]);
  db.prepare(`UPDATE projects SET ${setSql} WHERE id = ?`).run(...vals, id);
}

async function processProjectPipeline(projectId) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!project) return;
  const settings = getSettings();
  const outDir = path.join(STORAGE_PROJECTS, projectId);

  try {
    let media;
    if (project.sourceType === "youtube") {
      updateProject(projectId, { status: "downloading", progress: 12, progressMsg: "Baixando vídeo do YouTube via yt-dlp..." });
      media = await runPythonWorker("ingest_youtube", { url: project.sourceUrl, out_dir: outDir });
      updateProject(projectId, {
        title: media.title || project.title,
        channel: media.channel || "",
        videoPath: media.videoPath,
        audioPath: media.audioPath,
        thumbPath: media.thumbPath || "",
        duration: media.duration,
        width: media.width,
        height: media.height,
        fps: media.fps,
        progress: 32,
        progressMsg: "Vídeo baixado! Extraindo transcrição palavra por palavra (Whisper)..."
      });
    } else {
      updateProject(projectId, { status: "downloading", progress: 18, progressMsg: "Analisando vídeo enviado e extraindo áudio (FFmpeg)..." });
      media = await runPythonWorker("ingest_upload", { video_path: project.videoPath, out_dir: outDir });
      updateProject(projectId, {
        audioPath: media.audioPath,
        thumbPath: media.thumbPath || "",
        duration: media.duration,
        width: media.width,
        height: media.height,
        fps: media.fps,
        progress: 32,
        progressMsg: "Áudio extraído! Transcrevendo com Whisper..."
      });
    }

async function transcribeViaCloudApi(audioPath, settings) {
  const fs = require("fs");
  const { execFileSync } = require("child_process");
  const apiKey = (settings.llmApiKey || "").trim();
  if (!apiKey) return null;

  // Compress audio to small mp3 (under 25MB limit for Groq/OpenAI Whisper)
  const mp3Path = audioPath.replace(/\.wav$/i, ".mp3");
  execFileSync("ffmpeg", ["-y", "-i", audioPath, "-ac", "1", "-ar", "16000", "-b:a", "48k", mp3Path], { stdio: "ignore" });

  const isGroq = settings.whisperProvider === "groq";
  const endpoint = isGroq
    ? "https://api.groq.com/openai/v1/audio/transcriptions"
    : "https://api.openai.com/v1/audio/transcriptions";
  const model = isGroq ? "whisper-large-v3-turbo" : "whisper-1";

  const buf = fs.readFileSync(mp3Path);
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "audio/mpeg" }), "audio.mp3");
  fd.append("model", model);
  fd.append("response_format", "verbose_json");
  fd.append("timestamp_granularities[]", "word");
  fd.append("timestamp_granularities[]", "segment");
  if (settings.defaultLanguage) fd.append("language", settings.defaultLanguage);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd
  });
  if (!res.ok) throw new Error(`Cloud Whisper error (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();

  const words = (data.words || []).map(w => ({
    text: String(w.word || "").trim(),
    start: Number(w.start || 0),
    end: Number(w.end || 0)
  })).filter(w => w.text);

  const segments = (data.segments || []).map((s, idx) => ({
    id: idx,
    start: Number(s.start || 0),
    end: Number(s.end || 0),
    text: String(s.text || "").trim()
  })).filter(s => s.text);

  return {
    language: data.language || settings.defaultLanguage || "pt",
    text: data.text || segments.map(s => s.text).join(" "),
    segments,
    words
  };
}

    // 2. Transcribe (Groq/OpenAI Cloud Whisper if selected, otherwise local faster-whisper)
    let tr = null;
    if ((settings.whisperProvider === "groq" || settings.whisperProvider === "openai") && settings.llmApiKey) {
      updateProject(projectId, { status: "transcribing", progress: 42, progressMsg: `Transcrevendo ultra-rápido via ${settings.whisperProvider.toUpperCase()} Whisper API...` });
      try {
        tr = await transcribeViaCloudApi(media.audioPath, settings);
      } catch (e) {
        console.error("[Cloud Whisper fallback to local]", e.message);
      }
    }
    if (!tr) {
      updateProject(projectId, { status: "transcribing", progress: 42, progressMsg: `Transcrevendo áudio com faster-whisper local (${settings.whisperModel})...` });
      tr = await runPythonWorker("transcribe", {
        audio_path: media.audioPath,
        model_size: settings.whisperModel || "tiny",
        language: settings.defaultLanguage || null
      });
    }

    updateProject(projectId, {
      language: tr.language || "pt",
      transcriptText: tr.text || "",
      segmentsJson: JSON.stringify(tr.segments || []),
      wordsJson: JSON.stringify(tr.words || []),
      progress: 68,
      progressMsg: "Rastreando rostos / enquadramento 9:16 (OpenCV)..."
    });

    // 3. Face detection keyframes
    updateProject(projectId, { status: "tracking", progress: 72 });
    const faceData = await runPythonWorker("detect_faces", {
      video_path: media.videoPath,
      interval_sec: Math.max(1.5, Math.min(4.0, (media.duration || 60) / 30))
    });
    updateProject(projectId, {
      faceKeyframesJson: JSON.stringify(faceData.keyframes || []),
      progress: 84,
      progressMsg: "Calculando Virality Score e cortando melhores momentos com IA..."
    });

    // 4. AI Clip Curation (ClipAnything + 2Short Moments)
    updateProject(projectId, { status: "curating", progress: 88 });
    const updatedProj = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
    const curated = await curateViralClips({
      segments: tr.segments || [],
      duration: media.duration || 60,
      workflowId: updatedProj.workflowId,
      projectTitle: updatedProj.title,
      settings
    });

    // Determine default layout based on workflow
    const defaultLayout = updatedProj.workflowId === "builtin:gaming-streams" ? "split"
      : updatedProj.workflowId === "builtin:ai-reframe" ? "auto" : "auto";
    const defaultProgressBar = updatedProj.workflowId === "builtin:social-edit" ? 1 : 0;
    const defaultAutoColor = updatedProj.workflowId === "builtin:auto-cleaning"
      ? JSON.stringify({ enabled: true, denoise: 0.6, sharpen: 0.8, deblock: 0.2, glow: 0 })
      : JSON.stringify({ enabled: false, denoise: 0, sharpen: 0.5, deblock: 0.2, glow: 0 });

    // Compute median tracked face panX/panY per clip
    const kfs = faceData.keyframes || [];
    const insertClip = db.prepare(`
      INSERT INTO clips (
        id, projectId, title, description, hashtags,
        viralityScore, hookScore, pacingScore, storyScore, reason,
        startSec, endSec, aspectRatio, layoutMode, captionEnabled, captionPreset,
        captionConfigJson, framingJson, autoColorJson, wordsJson, headlineText, progressBar, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const allWords = tr.words || [];
    const now = new Date().toISOString();

    for (const c of curated) {
      const clipWords = allWords.filter(w => w.end >= c.startSec && w.start <= c.endSec);
      const clipKfs = kfs.filter(k => k.t >= c.startSec && k.t <= c.endSec && k.faces > 0);
      const avgX = clipKfs.length ? clipKfs.reduce((a, b) => a + b.xPct, 0) / clipKfs.length : 0.5;
      const avgY = clipKfs.length ? clipKfs.reduce((a, b) => a + b.yPct, 0) / clipKfs.length : 0.45;

      insertClip.run(
        uuidv4(),
        projectId,
        c.title,
        c.description,
        c.hashtags,
        c.viralityScore,
        c.hookScore,
        c.pacingScore,
        c.storyScore,
        c.reason,
        c.startSec,
        c.endSec,
        "9:16",
        defaultLayout,
        1,
        "karaoke",
        JSON.stringify({ highlightColor: "#04F827", primaryColor: "#FFFFFF", fontSize: 68, uppercase: true, positionY: 0.72 }),
        JSON.stringify({ zoom: 1, panX: Number(avgX.toFixed(3)), panY: Number(avgY.toFixed(3)) }),
        defaultAutoColor,
        JSON.stringify(clipWords),
        updatedProj.workflowId === "builtin:gaming-streams" ? c.title.slice(0, 36) : "",
        defaultProgressBar,
        now
      );
    }

    updateProject(projectId, {
      status: "ready",
      progress: 100,
      progressMsg: `Concluído! ${curated.length} clipes virais gerados.`
    });
  } catch (err) {
    console.error(`[Pipeline error ${projectId}]`, err);
    updateProject(projectId, {
      status: "error",
      errorMsg: err.message || String(err),
      progressMsg: `Erro: ${err.message || String(err)}`
    });
  }
}

async function renderClipJob(clipId, opts = {}) {
  const clip = db.prepare("SELECT * FROM clips WHERE id = ?").get(clipId);
  if (!clip) throw new Error("Clip not found");
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(clip.projectId);
  if (!project || !project.videoPath) throw new Error("Source video missing");

  db.prepare("UPDATE clips SET exportStatus = 'rendering', exportError = '' WHERE id = ?").run(clipId);

  try {
    let watermarkPath = null;
    if (clip.brandKitId) {
      const bk = db.prepare("SELECT * FROM brand_kits WHERE id = ?").get(clip.brandKitId);
      if (bk && bk.logoPath) watermarkPath = bk.logoPath;
    }

    const outPath = path.join(STORAGE_EXPORTS, `${clipId}_${Date.now()}.mp4`);
    const res = await runPythonWorker("render_clip", {
      video_path: project.videoPath,
      out_path: outPath,
      start_sec: clip.startSec,
      end_sec: clip.endSec,
      aspect_ratio: clip.aspectRatio || "9:16",
      resolution: opts.resolution || "1080p",
      fps: Number(opts.fps) || 30,
      layout_mode: clip.layoutMode || "auto",
      framing: JSON.parse(clip.framingJson || "{}"),
      auto_color: JSON.parse(clip.autoColorJson || "{}"),
      caption_enabled: Boolean(clip.captionEnabled),
      caption_preset: clip.captionPreset || "karaoke",
      caption_config: JSON.parse(clip.captionConfigJson || "{}"),
      words: JSON.parse(clip.wordsJson || "[]"),
      watermark_path: watermarkPath,
      headline_text: clip.headlineText || "",
      progress_bar: Boolean(clip.progressBar)
    });

    db.prepare("UPDATE clips SET exportStatus = 'done', exportPath = ? WHERE id = ?").run(res.exportPath, clipId);
    return res;
  } catch (err) {
    db.prepare("UPDATE clips SET exportStatus = 'error', exportError = ? WHERE id = ?").run(err.message, clipId);
    throw err;
  }
}

module.exports = { runPythonWorker, processProjectPipeline, renderClipJob };
