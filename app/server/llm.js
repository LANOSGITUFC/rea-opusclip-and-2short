/**
 * Multi-provider LLM client (OpenAI, Gemini, Groq, OpenRouter)
 * + deterministic local fallback when no API key is configured yet.
 */

async function callLLM(settings, systemPrompt, userPrompt, expectJson = false) {
  const apiKey = (settings.llmApiKey || "").trim();
  if (!apiKey) return null;

  const provider = settings.llmProvider || "openai";
  let model = (settings.llmModel || "").trim();

  if (provider === "gemini") {
    model = model || "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
      generationConfig: {
        temperature: 0.5,
        ...(expectJson ? { responseMimeType: "application/json" } : {})
      }
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Gemini API error (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  // OpenAI-compatible providers (openai, groq, openrouter)
  let baseUrl = "https://api.openai.com/v1/chat/completions";
  if (provider === "groq") {
    baseUrl = "https://api.groq.com/openai/v1/chat/completions";
    model = model || "llama-3.3-70b-versatile";
  } else if (provider === "openrouter") {
    baseUrl = "https://openrouter.ai/api/v1/chat/completions";
    model = model || "google/gemini-2.0-flash-001";
  } else {
    model = model || "gpt-4o-mini";
  }

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://opus2short.studio";
    headers["X-Title"] = "Opus2Short AI Studio";
  }

  const body = {
    model,
    temperature: 0.5,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    ...(expectJson ? { response_format: { type: "json_object" } } : {})
  };

  const res = await fetch(baseUrl, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = new Error(`${provider} API error (${res.status}): ${(await res.text()).slice(0, 180)}`);
    err.statusCode = res.status;
    throw err;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function callLLM(settings, systemPrompt, userPrompt, expectJson = false) {
  const poolKeys = getActiveKeysFor("llm", settings.llmProvider || "groq");
  const candidates = [...poolKeys];

  if (settings.llmApiKey && !candidates.some(c => c.apiKey === settings.llmApiKey)) {
    candidates.push({
      id: null,
      provider: settings.llmProvider || "groq",
      model: settings.llmModel || "",
      apiKey: settings.llmApiKey
    });
  }

  if (candidates.length === 0) return null;

  let lastErr = null;
  for (const keyRow of candidates) {
    try {
      const result = await callSingleProvider(
        keyRow.provider,
        keyRow.model || settings.llmModel,
        keyRow.apiKey,
        systemPrompt,
        userPrompt,
        expectJson
      );
      recordKeySuccess(keyRow.id);
      return result;
    } catch (err) {
      lastErr = err;
      console.warn(`[LLM Pool Failover] Key ${keyRow.id || "legacy"} (${keyRow.provider}) failed:`, err.message);
      recordKeyError(keyRow.id, err.statusCode || 500, err.message);
    }
  }

  if (lastErr) throw lastErr;
  return null;
}

function parseJsonSafe(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { return null; }
    }
    return null;
  }
}

/**
 * Deterministic local clip curator when no LLM key is set (or if LLM fails).
 * Segments video into 25-55s high-density speech windows with scored hooks.
 */
function fallbackCurateClips(segments, duration, workflowId, projectTitle) {
  const targetLen = duration < 60 ? Math.max(10, duration) : 40;
  const clips = [];

  if (segments && segments.length > 0) {
    let curStart = segments[0].start;
    let curText = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      curText.push(seg.text);
      const elapsed = seg.end - curStart;
      const isLast = i === segments.length - 1;
      if (elapsed >= 25 || isLast) {
        const endSec = Math.min(duration, Math.max(curStart + 8, seg.end));
        const textJoined = curText.join(" ").trim();
        const wordsCount = textJoined.split(/\s+/).length;
        const wps = wordsCount / Math.max(1, endSec - curStart);
        const hasQuestion = /\?/.test(textJoined);
        const hasExcl = /!/.test(textJoined);
        const hookScore = Math.min(96, Math.round(70 + (hasQuestion ? 12 : 0) + (hasExcl ? 8 : 0) + Math.min(10, wps * 3)));
        const pacingScore = Math.min(95, Math.round(68 + Math.min(25, wps * 8)));
        const storyScore = Math.min(94, Math.round(72 + Math.min(18, elapsed / 3)));
        const viralityScore = Math.round(hookScore * 0.45 + pacingScore * 0.3 + storyScore * 0.25);

        const snippetTitle = textJoined.split(/[.!?]/)[0].trim().slice(0, 62) || `${projectTitle} — Parte ${clips.length + 1}`;
        clips.push({
          title: snippetTitle,
          description: textJoined.slice(0, 180),
          hashtags: workflowId === "builtin:gaming-streams" ? "#gaming #clips #shorts #viral" : "#shorts #reels #tiktok #viral",
          viralityScore,
          hookScore,
          pacingScore,
          storyScore,
          reason: `Ritmo de fala ${wps.toFixed(1)} palavras/s${hasQuestion ? " com pergunta forte de gancho" : ""}${hasExcl ? " e pico de emoção" : ""}.`,
          startSec: Number(curStart.toFixed(2)),
          endSec: Number(endSec.toFixed(2))
        });

        if (clips.length >= 6) break;
        if (!isLast) {
          curStart = segments[i + 1].start;
          curText = [];
        }
      }
    }
  }

  if (clips.length === 0) {
    const count = Math.max(1, Math.min(4, Math.floor(duration / 30) || 1));
    for (let i = 0; i < count; i++) {
      const s = i * targetLen;
      const e = Math.min(duration || 30, s + targetLen);
      if (e - s < 4) break;
      clips.push({
        title: `${projectTitle} — Clipe #${i + 1}`,
        description: "Corte automático pronto para edição e legendas.",
        hashtags: "#shorts #reels #viral",
        viralityScore: 82 - i * 3,
        hookScore: 84,
        pacingScore: 80,
        storyScore: 81,
        reason: "Segmentação automática por janela temporal.",
        startSec: Number(s.toFixed(2)),
        endSec: Number(e.toFixed(2))
      });
    }
  }

  return clips.sort((a, b) => b.viralityScore - a.viralityScore);
}

async function curateViralClips({ segments, duration, workflowId, projectTitle, settings }) {
  if (!settings.llmApiKey || !segments || segments.length === 0) {
    return fallbackCurateClips(segments, duration, workflowId, projectTitle);
  }

  try {
    const compactTranscript = segments
      .slice(0, 180)
      .map(s => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`)
      .join("\n");

    const systemPrompt = `Você é a engine ClipAnything do OpusClip + Moments do 2Short.ai.
Analise a transcrição com timestamps e extraia de 3 a 6 clipes virais (entre 18 e 60 segundos cada) otimizados para TikTok, Reels e YouTube Shorts.
Workflow selecionado: ${workflowId}.
Responda ESTRITAMENTE em JSON válido no formato:
{
  "clips": [
    {
      "title": "Título viral curto e forte",
      "description": "Resumo atrativo de 1-2 frases",
      "hashtags": "#tag1 #tag2 #tag3 #shorts",
      "startSec": 12.4,
      "endSec": 54.2,
      "viralityScore": 91,
      "hookScore": 94,
      "pacingScore": 88,
      "storyScore": 90,
      "reason": "Explicação curta do porquê este trecho tem alto potencial viral"
    }
  ]
}`;

    const raw = await callLLM(settings, systemPrompt, `Vídeo: "${projectTitle}" (duração ${duration.toFixed(1)}s)\n\nTranscrição:\n${compactTranscript}`, true);
    const parsed = parseJsonSafe(raw);
    if (parsed && Array.isArray(parsed.clips) && parsed.clips.length > 0) {
      return parsed.clips
        .filter(c => typeof c.startSec === "number" && typeof c.endSec === "number" && c.endSec > c.startSec + 4)
        .map(c => ({
          title: String(c.title || projectTitle).slice(0, 90),
          description: String(c.description || "").slice(0, 300),
          hashtags: String(c.hashtags || "#shorts #viral"),
          viralityScore: Math.max(1, Math.min(99, Math.round(Number(c.viralityScore) || 82))),
          hookScore: Math.max(1, Math.min(99, Math.round(Number(c.hookScore) || 82))),
          pacingScore: Math.max(1, Math.min(99, Math.round(Number(c.pacingScore) || 80))),
          storyScore: Math.max(1, Math.min(99, Math.round(Number(c.storyScore) || 80))),
          reason: String(c.reason || "Alto potencial de retenção detectado pela IA."),
          startSec: Math.max(0, Number(c.startSec)),
          endSec: Math.min(duration || c.endSec, Number(c.endSec))
        }))
        .sort((a, b) => b.viralityScore - a.viralityScore);
    }
  } catch (err) {
    console.error("[LLM curateViralClips fallback]", err.message);
  }
  return fallbackCurateClips(segments, duration, workflowId, projectTitle);
}

async function generateSocialCopy({ clip, platform, customPrompt, settings }) {
  const promptText = customPrompt || settings.socialCopyPrompt || "";
  if (settings.llmApiKey) {
    try {
      const sys = `Você gera copy social (PlanSocial) otimizada para a plataforma ${platform}. Responda em JSON: {"title":"...","description":"...","hashtags":"..."}`;
      const usr = `Clipe: ${clip.title}\nDescrição atual: ${clip.description}\nInstrução do usuário: ${promptText}`;
      const raw = await callLLM(settings, sys, usr, true);
      const parsed = parseJsonSafe(raw);
      if (parsed && parsed.title) {
        return {
          title: String(parsed.title),
          description: String(parsed.description || clip.description),
          hashtags: String(parsed.hashtags || clip.hashtags)
        };
      }
    } catch (err) {
      console.error("[LLM generateSocialCopy fallback]", err.message);
    }
  }

  const suffix = platform === "YOUTUBE" ? " #shorts" : platform === "INSTAGRAM_BUSINESS" ? " #reels" : " #fyp";
  return {
    title: `${clip.title}${clip.title.includes("#") ? "" : suffix}`,
    description: clip.description || `Assista até o final! ${clip.title}`,
    hashtags: clip.hashtags || "#viral #shorts #reels #tiktok"
  };
}

async function projectChat({ project, clips, history, message, settings }) {
  if (settings.llmApiKey) {
    try {
      const sys = `Você é o Project Chat (copiloto de vídeo do 2Short.ai / OpusClip).
Projeto: "${project.title}" (${Math.round(project.duration)}s).
Clipes já detectados: ${clips.map(c => `"${c.title}" (${c.startSec}s-${c.endSec}s, score ${c.viralityScore})`).join("; ")}.
Transcrição (trecho): ${(project.transcriptText || "").slice(0, 6000)}
Responda em português de forma prática, direta e com timestamps [MM:SS] quando citar trechos do vídeo.`;
      const convo = (history || []).slice(-6).map(m => `${m.role === "user" ? "Usuário" : "Assistente"}: ${m.content}`).join("\n");
      const reply = await callLLM(settings, sys, `${convo}\nUsuário: ${message}`, false);
      if (reply) return reply;
    } catch (err) {
      return `Erro ao chamar sua API de IA (${err.message}). Verifique a chave na aba **Configurações**.`;
    }
  }

  // Local smart fallback for quick actions
  const lower = message.toLowerCase();
  const segments = JSON.parse(project.segmentsJson || "[]");
  if (lower.includes("título") || lower.includes("title")) {
    return `Aqui estão sugestões baseadas no projeto **${project.title}** (adicione sua chave de IA em *Configurações* para resultados gerados por LLM):\n\n` +
      clips.slice(0, 5).map((c, i) => `${i + 1}. **${c.title}** (Score ${c.viralityScore})`).join("\n");
  }
  if (lower.includes("capítulo") || lower.includes("chapter")) {
    return "**Capítulos sugeridos:**\n" + segments.filter((_, i) => i % Math.max(1, Math.floor(segments.length / 6)) === 0).slice(0, 8)
      .map(s => {
        const m = Math.floor(s.start / 60);
        const sec = String(Math.floor(s.start % 60)).padStart(2, "0");
        return `- \`${m}:${sec}\` — ${s.text.slice(0, 65)}`;
      }).join("\n");
  }
  // Keyword search in transcript
  const terms = lower.split(/\s+/).filter(w => w.length > 3);
  const hits = segments.filter(s => terms.some(t => s.text.toLowerCase().includes(t))).slice(0, 5);
  if (hits.length > 0) {
    return "**Trechos encontrados na transcrição:**\n" + hits.map(h => {
      const m = Math.floor(h.start / 60);
      const sec = String(Math.floor(h.start % 60)).padStart(2, "0");
      return `- \`${m}:${sec}\` — "${h.text}"`;
    }).join("\n");
  }
  return `Analisei o projeto **${project.title}** (${clips.length} clipes prontos, ${segments.length} segmentos transcritos). Configure sua chave de IA (OpenAI, Gemini, Groq ou OpenRouter) na aba **Configurações** para liberar respostas completas com LLM!`;
}

module.exports = { callLLM, curateViralClips, generateSocialCopy, projectChat };
