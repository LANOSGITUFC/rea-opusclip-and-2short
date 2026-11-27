/**
 * AI B-Roll (OpusClip `builtin:ai-broll`) and AI Dubbing (`builtin:translate-dubbing`).
 *
 * B-Roll: LLM (or local heuristic) picks visual keywords + timestamps from the clip transcript,
 *         then fetches stock media from Pexels (videos) or Giphy (GIF/MP4). When no media key is
 *         configured, overlays fall back to procedural keyword callout cards rendered by FFmpeg.
 * Dubbing: transcript is grouped into sentences, translated sentence-by-sentence with the LLM pool,
 *         and synthesized with neural TTS (edge-tts, fallback espeak-ng) aligned to the timeline.
 */
const fs = require("fs");
const path = require("path");
const { callLLM, parseJsonSafe } = require("./llm");
const { STORAGE_PROJECTS } = require("./paths");

const STOPWORDS = new Set((
  "a o os as um uma uns umas de do da dos das em no na nos nas por para com sem que e é ou mas se " +
  "eu tu ele ela nós vós eles elas você vocês meu minha seu sua isso isto aquilo esse essa este esta " +
  "the a an of to in on for with and or but is are was were be been it this that these those i you he she " +
  "we they my your his her our their not so very just like then than there here what when where how why " +
  "muito mais menos também já ainda então aqui ali lá tipo né porque quando onde como qual quem foi ser " +
  "estar está estou tem ter vai vou fazer faz coisa gente"
).split(/\s+/));

function clipRelativeWords(clip) {
  const words = JSON.parse(clip.wordsJson || "[]");
  return words
    .map(w => ({
      text: String(w.text || "").trim(),
      start: Math.max(0, Number(w.start || 0) - clip.startSec),
      end: Math.max(0, Number(w.end || 0) - clip.startSec)
    }))
    .filter(w => w.text && w.start < clip.endSec - clip.startSec);
}

/** Group word timings into sentence segments (by punctuation, pause > 0.6s or 14 words). */
function buildSentenceSegments(words) {
  const segs = [];
  let cur = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!cur) cur = { start: w.start, end: w.end, words: [] };
    cur.words.push(w.text);
    cur.end = w.end;
    const next = words[i + 1];
    const pause = next ? next.start - w.end : 99;
    if (/[.!?…]$/.test(w.text) || pause > 0.6 || cur.words.length >= 14 || !next) {
      segs.push({ start: +cur.start.toFixed(3), end: +cur.end.toFixed(3), text: cur.words.join(" ") });
      cur = null;
    }
  }
  return segs;
}

function heuristicKeywords(words, maxItems) {
  const scored = new Map();
  for (const w of words) {
    const clean = w.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (clean.length < 5 || STOPWORDS.has(clean)) continue;
    const prev = scored.get(clean);
    if (prev) prev.count++;
    else scored.set(clean, { keyword: clean, start: w.start, count: 1 });
  }
  return [...scored.values()]
    .sort((a, b) => (b.count * 10 + b.keyword.length) - (a.count * 10 + a.keyword.length))
    .slice(0, maxItems)
    .sort((a, b) => a.start - b.start)
    .map(k => ({ keyword: k.keyword, query: k.keyword, start: k.start }));
}

async function pickBrollMoments(clip, settings, maxItems = 4) {
  const words = clipRelativeWords(clip);
  const dur = Math.max(1, clip.endSec - clip.startSec);
  if (words.length === 0) return [];

  let picks = null;
  try {
    const transcript = buildSentenceSegments(words).map(s => `[${s.start.toFixed(1)}s] ${s.text}`).join("\n");
    const sys = `You are the AI B-roll engine of OpusClip. Pick up to ${maxItems} visual b-roll moments for this short video.
For each, give a short English stock-footage search query (1-3 words), the on-screen keyword (in the transcript language) and the start second.
Reply strictly as JSON: {"suggestions":[{"timeSec":1.2,"query":"money","keyword":"dinheiro"}]}`;
    const raw = await callLLM(settings, sys, transcript.slice(0, 6000), true);
    const parsed = parseJsonSafe(raw);
    const list = parsed?.suggestions || parsed?.brolls || [];
    if (Array.isArray(list) && list.length) {
      picks = list
        .filter(s => s && (s.query || s.keyword))
        .map(s => ({
          query: String(s.query || s.keyword).slice(0, 40),
          keyword: String(s.keyword || s.query).slice(0, 40),
          start: Math.max(0, Math.min(dur - 1, Number(s.timeSec ?? s.start ?? 0) || 0))
        }));
      // If the LLM only returned "queries" without timestamps, spread them across the clip
    } else if (Array.isArray(parsed?.queries) && parsed.queries.length) {
      picks = parsed.queries.slice(0, maxItems).map((q, i, arr) => ({
        query: String(q), keyword: String(q), start: (dur / (arr.length + 1)) * (i + 1) - 1
      }));
    }
  } catch (err) {
    console.warn("[B-roll LLM fallback]", err.message);
  }
  if (!picks || picks.length === 0) picks = heuristicKeywords(words, maxItems);

  // Normalize: 2.5s windows, no overlap, inside clip, skip first 1.0s (hook stays on speaker)
  const out = [];
  let lastEnd = 1.0;
  for (const p of picks.sort((a, b) => a.start - b.start)) {
    const start = Math.max(lastEnd + 0.4, p.start);
    const end = Math.min(dur - 0.3, start + 2.5);
    if (end - start < 1.0) continue;
    out.push({ query: p.query, keyword: p.keyword, start: +start.toFixed(2), end: +end.toFixed(2) });
    lastEnd = end;
    if (out.length >= maxItems) break;
  }
  return out;
}

async function downloadTo(url, destPath, maxBytes = 40 * 1024 * 1024) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 512 || buf.length > maxBytes) throw new Error(`invalid media size ${buf.length}`);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return destPath;
}

async function searchPexels(query, apiKey) {
  const res = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=3&orientation=portrait&size=small`, {
    headers: { Authorization: apiKey }, signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`Pexels ${res.status}`);
  const data = await res.json();
  for (const v of data.videos || []) {
    const files = (v.video_files || [])
      .filter(f => f.link && /mp4/i.test(f.file_type || "mp4"))
      .sort((a, b) => (a.width || 9999) - (b.width || 9999));
    const pick = files.find(f => (f.width || 0) >= 480) || files[0];
    if (pick) return { url: pick.link, ext: ".mp4", source: "pexels" };
  }
  return null;
}

async function searchGiphy(query, apiKey) {
  const res = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(query)}&limit=1&rating=pg-13`, {
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`Giphy ${res.status}`);
  const data = await res.json();
  const img = data.data?.[0]?.images?.original;
  if (img?.mp4) return { url: img.mp4, ext: ".mp4", source: "giphy" };
  if (img?.url) return { url: img.url, ext: ".gif", source: "giphy" };
  return null;
}

/**
 * Generate B-roll overlays for a clip and persist them as `broll` tracks.
 * Returns the array of broll tracks.
 */
async function generateBrollForClip(clip, settings, { maxItems = 4 } = {}) {
  const moments = await pickBrollMoments(clip, settings, maxItems);
  const dir = path.join(STORAGE_PROJECTS, clip.projectId, "broll");
  const tracks = [];

  for (let i = 0; i < moments.length; i++) {
    const m = moments[i];
    const track = { type: "broll", keyword: m.keyword, query: m.query, start: m.start, end: m.end, mediaPath: "", source: "callout" };
    const providers = [];
    if (settings.pexelsApiKey) providers.push(() => searchPexels(m.query, settings.pexelsApiKey));
    if (settings.giphyApiKey) providers.push(() => searchGiphy(m.query, settings.giphyApiKey));
    for (const search of providers) {
      try {
        const hit = await search();
        if (!hit) continue;
        const dest = path.join(dir, `${clip.id}_${i}_${Date.now()}${hit.ext}`);
        await downloadTo(hit.url, dest);
        track.mediaPath = dest;
        track.source = hit.source;
        break;
      } catch (err) {
        console.warn(`[B-roll] ${m.query}:`, err.message);
      }
    }
    tracks.push(track);
  }
  return tracks;
}

const LANG_CODES = {
  english: "en", inglês: "en", ingles: "en", portuguese: "pt", português: "pt", portugues: "pt",
  spanish: "es", español: "es", espanol: "es", espanhol: "es", french: "fr", francês: "fr", frances: "fr",
  german: "de", alemão: "de", alemao: "de", italian: "it", italiano: "it", japanese: "ja", japonês: "ja",
  korean: "ko", coreano: "ko", chinese: "zh", chinês: "zh", russian: "ru", russo: "ru", hindi: "hi",
  arabic: "ar", árabe: "ar", turkish: "tr", turco: "tr", dutch: "nl", polish: "pl", indonesian: "id",
  vietnamese: "vi", ukrainian: "uk", swedish: "sv", thai: "th"
};

function toLangCode(lang) {
  if (!lang) return "en";
  const l = String(lang).trim().toLowerCase();
  if (/^[a-z]{2}(-[a-z]{2})?$/i.test(l)) return l.slice(0, 2);
  return LANG_CODES[l] || "en";
}

async function translateSegments(segments, targetLang, settings) {
  if (!segments.length) return segments;
  const sys = `Translate each subtitle sentence into ${targetLang}. Keep the same number of items (${segments.length}) and keep them short enough to be spoken in the same time. Reply strictly as JSON: {"sentences":["...","..."]}`;
  const raw = await callLLM(settings, sys, JSON.stringify(segments.map(s => s.text)), true);
  const parsed = parseJsonSafe(raw);
  if (!parsed || !Array.isArray(parsed.sentences) || parsed.sentences.length === 0) return null;
  return segments.map((s, i) => ({ ...s, text: String(parsed.sentences[i] || s.text) }));
}

module.exports = {
  clipRelativeWords,
  buildSentenceSegments,
  pickBrollMoments,
  generateBrollForClip,
  translateSegments,
  toLangCode
};
