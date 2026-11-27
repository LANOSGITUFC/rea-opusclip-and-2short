import React, { useEffect, useRef, useState } from "react";
import { api, BrandKit, CaptionPreset, Clip, fmtTime, ProjectSummary, WordTiming } from "../api";
import {
  ArrowLeft, Play, Pause, Volume2, VolumeX, Download, Sparkles, Save,
  Sliders, Type, Layout, Wand2, Palette, Loader2, CheckCircle2, AlertCircle, RefreshCw, Trash2, Music
} from "lucide-react";

interface Props {
  clipId: string;
  presets: CaptionPreset[];
  brandKits: BrandKit[];
  onBack: () => void;
}

const TRANSITIONS = [
  "hard-cut", "dip-to-black", "light-leak", "whip-pan", "punch-in",
  "defocus", "signal-glitch", "iris", "shutter", "white-flash"
];

const MOTIONS = [
  { id: "none", label: "Sem movimento" },
  { id: "punch-in", label: "Punch in (Zoom de impacto)" },
  { id: "slow-push", label: "Slow push (Zoom dramático)" },
  { id: "auto-zoom", label: "Auto zoom IA" }
];

export const EditorView: React.FC<Props> = ({ clipId, presets, brandKits, onBack }) => {
  const [clip, setClip] = useState<Clip | null>(null);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [toolTab, setToolTab] = useState<"captions" | "framing" | "motion" | "overlays" | "color">("captions");
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [curTime, setCurTime] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exportRes, setExportRes] = useState("1080p");
  const [exportFps, setExportFps] = useState(30);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [videoErr, setVideoErr] = useState(false);
  const [aiEmojisBusy, setAiEmojisBusy] = useState(false);
  const [translatingLang, setTranslatingLang] = useState<string | null>(null);
  const [bgmBusy, setBgmBusy] = useState(false);
  const [renderBusy, setRenderBusy] = useState(false);
  const [editingWord, setEditingWord] = useState<{ idx: number; text: string } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const facecamVideoRef = useRef<HTMLVideoElement | null>(null);
  const bgmInputRef = useRef<HTMLInputElement | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatchRef = useRef<Partial<Clip>>({});
  const saveSeqRef = useRef(0);
  const activeClipIdRef = useRef(clipId);
  activeClipIdRef.current = clipId;

  const loadClip = async () => {
    const requestedId = clipId;
    setLoading(true);
    setErr(null);
    setVideoErr(false);
    try {
      const r = await api.getClip(requestedId);
      if (activeClipIdRef.current !== requestedId) return;
      setClip(r.clip);
      setProject(r.project);
      setCurTime(r.clip.startSec);
    } catch (e: unknown) {
      if (activeClipIdRef.current !== requestedId) return;
      setErr(e instanceof Error ? e.message : "Erro ao carregar clipe.");
    } finally {
      if (activeClipIdRef.current === requestedId) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    activeClipIdRef.current = clipId;
    loadClip();
    return () => {
      saveSeqRef.current += 1;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      pendingPatchRef.current = {};
      setSaving(false);
    };
  }, [clipId]);

  // Poll render status while rendering
  useEffect(() => {
    if (clip?.exportStatus !== "rendering") return;
    const t = setInterval(async () => {
      try {
        const r = await api.getClip(clipId);
        setClip(r.clip);
      } catch (e: unknown) {
        setActionErr(e instanceof Error ? e.message : "Erro ao verificar status da renderização.");
      }
    }, 2500);
    return () => clearInterval(t);
  }, [clip?.exportStatus, clipId]);

  // Sync video to clip startSec on initial load
  useEffect(() => {
    const v = videoRef.current;
    if (v && clip && v.currentTime < clip.startSec) {
      v.currentTime = clip.startSec;
    }
  }, [clip?.id]);

  // Sync split-screen / multi-panel videos with main video via media event listeners
  const auxVideoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  useEffect(() => {
    const main = videoRef.current;
    if (!main) return;
    const isMulti = clip?.layoutMode === "split" || clip?.layoutMode === "three" || clip?.layoutMode === "four";
    if (!isMulti) return;

    const getSecondaries = (): HTMLVideoElement[] => {
      const list: HTMLVideoElement[] = [];
      if (clip?.layoutMode === "split" && facecamVideoRef.current) {
        list.push(facecamVideoRef.current);
      }
      if (clip?.layoutMode === "three" || clip?.layoutMode === "four") {
        for (const el of auxVideoRefs.current) {
          if (el) list.push(el);
        }
      }
      return list;
    };

    const syncAll = () => {
      for (const sec of getSecondaries()) {
        sec.currentTime = main.currentTime;
        if (!main.paused && sec.paused) sec.play().catch(() => {});
        else if (main.paused && !sec.paused) sec.pause();
      }
    };
    syncAll();

    const onPlay = () => {
      for (const sec of getSecondaries()) sec.play().catch(() => {});
    };
    const onPause = () => {
      for (const sec of getSecondaries()) sec.pause();
    };
    const onSeeked = () => {
      for (const sec of getSecondaries()) sec.currentTime = main.currentTime;
    };
    const onTimeUpdate = () => {
      for (const sec of getSecondaries()) {
        if (Math.abs(sec.currentTime - main.currentTime) > 0.25) {
          sec.currentTime = main.currentTime;
        }
      }
    };

    main.addEventListener("play", onPlay);
    main.addEventListener("pause", onPause);
    main.addEventListener("seeked", onSeeked);
    main.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      main.removeEventListener("play", onPlay);
      main.removeEventListener("pause", onPause);
      main.removeEventListener("seeked", onSeeked);
      main.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [clip?.layoutMode, clip?.id]);

  if (loading && !clip) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
      </div>
    );
  }

  if (err && (!clip || !project)) {
    return (
      <div className="max-w-md mx-auto my-12 bg-[#111827] border border-red-500/30 rounded-2xl p-6 text-center space-y-4">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-white">Não foi possível carregar o editor</h3>
          <p className="text-xs text-red-300">{err}</p>
        </div>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={onBack}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar
          </button>
          <button
            onClick={loadClip}
            className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (!clip || !project) return null;

  const activePreset = presets.find(p => p.id === clip.captionPreset) || presets[0] || {
    id: "karaoke", name: "Karaokê", primary: "#FFFFFF", highlight: "#04F827", uppercase: true, wordsPerLine: 3
  };
  const highlightColor = clip.captionConfig?.highlightColor || activePreset.highlight;
  const primaryColor = clip.captionConfig?.primaryColor || activePreset.primary;
  const fontSize = clip.captionConfig?.fontSize ?? 22;
  const uppercase = clip.captionConfig?.uppercase ?? activePreset.uppercase;
  const posY = clip.captionConfig?.positionY ?? 0.72;
  const bgmTrack = clip.tracks?.find(t => t.type === "bgm");

  const saveChanges = async (patch: Partial<Clip>) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const mergedPatch = { ...pendingPatchRef.current, ...patch };
    pendingPatchRef.current = {};
    const seq = ++saveSeqRef.current;

    setClip(prev => (prev ? { ...prev, ...patch } : prev));
    setSaving(true);
    setActionErr(null);
    try {
      const r = await api.updateClip(clip.id, mergedPatch);
      if (seq === saveSeqRef.current) {
        setClip(r.clip);
      }
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : "Erro ao salvar alterações.");
    } finally {
      if (seq === saveSeqRef.current) {
        setSaving(false);
      }
    }
  };

  const debouncedSaveChanges = (patch: Partial<Clip>) => {
    setClip(prev => (prev ? { ...prev, ...patch } : prev));
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    const seq = ++saveSeqRef.current;
    debounceTimerRef.current = setTimeout(async () => {
      const toSend = pendingPatchRef.current;
      pendingPatchRef.current = {};
      debounceTimerRef.current = null;
      setSaving(true);
      setActionErr(null);
      try {
        const r = await api.updateClip(clip.id, toSend);
        if (seq === saveSeqRef.current) {
          setClip(r.clip);
        }
      } catch (e: unknown) {
        setActionErr(e instanceof Error ? e.message : "Erro ao salvar alterações.");
      } finally {
        if (seq === saveSeqRef.current) {
          setSaving(false);
        }
      }
    }, 250);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < clip.startSec || v.currentTime >= clip.endSec) {
        v.currentTime = clip.startSec;
      }
      v.play().catch(() => {});
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setCurTime(v.currentTime);
    if (v.currentTime >= clip.endSec) {
      v.currentTime = clip.startSec;
    }
  };

  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(clip.startSec, Math.min(clip.endSec, t));
    v.currentTime = clamped;
    setCurTime(clamped);
  };

  const handleEditWord = (idx: number) => {
    const w = clip.words[idx];
    if (!w) return;
    setEditingWord({ idx, text: w.text });
  };

  const commitEditWord = async (remove = false) => {
    if (!editingWord) return;
    const updated = [...clip.words];
    const trimmed = editingWord.text.trim();
    if (remove || !trimmed) {
      updated.splice(editingWord.idx, 1);
    } else {
      updated[editingWord.idx] = { ...updated[editingWord.idx], text: trimmed };
    }
    setEditingWord(null);
    await saveChanges({ words: updated });
  };

  const handleAiEmojis = async () => {
    setAiEmojisBusy(true);
    setActionErr(null);
    setActionMsg(null);
    try {
      const r = await api.generateAiEmojis(clip.id);
      setClip(prev => (prev ? { ...prev, words: r.words } : prev));
      setActionMsg("Emojis gerados com IA!");
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : "Erro ao gerar AI Emojis.");
    } finally {
      setAiEmojisBusy(false);
    }
  };

  const triggerRender = async () => {
    setRenderBusy(true);
    setActionErr(null);
    try {
      await api.renderClip(clip.id, exportRes, exportFps);
      setClip(prev => (prev ? { ...prev, exportStatus: "rendering", exportError: "" } : prev));
    } catch (e: unknown) {
      setActionErr(e instanceof Error ? e.message : "Erro ao iniciar renderização.");
    } finally {
      setRenderBusy(false);
    }
  };

  // Determine current visible subtitle chunk
  const wpl = activePreset.wordsPerLine || 3;
  const activeWordIdx = clip.words.findIndex(w => curTime >= w.start && curTime <= w.end + 0.15);
  const chunkStart = activeWordIdx >= 0 ? Math.floor(activeWordIdx / wpl) * wpl : 0;
  const visibleWords: Array<{ w: WordTiming; i: number }> = clip.words
    .slice(chunkStart, chunkStart + wpl)
    .map((w, offset) => ({ w, i: chunkStart + offset }));

  const aspectClass =
    clip.aspectRatio === "9:16" ? "aspect-[9/16] max-w-[290px]"
    : clip.aspectRatio === "4:5" ? "aspect-[4/5] max-w-[330px]"
    : clip.aspectRatio === "1:1" ? "aspect-square max-w-[340px]"
    : "aspect-video max-w-[480px]";

  const clipDuration = Math.max(1, clip.endSec - clip.startSec);
  const progressPct = Math.max(0, Math.min(100, ((curTime - clip.startSec) / clipDuration) * 100));

  return (
    <div className="space-y-4 pb-24">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#111827] border border-slate-800 rounded-2xl p-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <button onClick={onBack} className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <input
            value={clip.title}
            onChange={e => setClip({ ...clip, title: e.target.value })}
            onBlur={() => saveChanges({ title: clip.title })}
            className="bg-transparent text-sm font-bold text-white border-b border-transparent focus:border-purple-500 focus:outline-none truncate max-w-[200px] sm:max-w-[340px]"
          />
          {saving && <span className="text-[10px] text-purple-400 flex items-center gap-1"><Save className="w-3 h-3" /> Salvando...</span>}
        </div>

        <div className="flex items-center gap-2">
          {clip.exportStatus === "done" && (
            <a
              href={`/api/clips/${clip.id}/download`}
              className="px-3 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-xs font-bold flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> Baixar MP4
            </a>
          )}
          <button
            onClick={() => setShowExport(true)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-black font-black text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-500/20"
          >
            {clip.exportStatus === "rendering" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            <span>{clip.exportStatus === "rendering" ? "Renderizando..." : "Exportar MP4"}</span>
          </button>
        </div>
      </div>

      {/* Action Feedback Banners */}
      {actionErr && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" /> {actionErr}</span>
          <button onClick={() => setActionErr(null)} className="text-slate-400 hover:text-white text-xs">✕</button>
        </div>
      )}
      {actionMsg && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 shrink-0" /> {actionMsg}</span>
          <button onClick={() => setActionMsg(null)} className="text-slate-400 hover:text-white text-xs">✕</button>
        </div>
      )}

      {/* Main 3-column / responsive editor workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT: Word-by-word Transcript */}
        <div className="lg:col-span-4 bg-[#111827] border border-slate-800 rounded-2xl p-3.5 space-y-3 order-2 lg:order-1">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-white">Transcrição Palavra por Palavra</h3>
            <button
              onClick={handleAiEmojis}
              disabled={aiEmojisBusy}
              className="px-2.5 py-1 rounded-lg bg-purple-600/20 border border-purple-500/40 text-purple-300 text-[11px] font-bold flex items-center gap-1 hover:bg-purple-600/30 disabled:opacity-50"
            >
              {aiEmojisBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {aiEmojisBusy ? "Gerando..." : "AI Emojis"}
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            Toque na palavra para pular o vídeo; clique duas vezes para editar o texto.
          </p>

          {/* Inline Word Editor */}
          {editingWord && (
            <form
              onSubmit={e => { e.preventDefault(); commitEditWord(false); }}
              className="p-2.5 rounded-xl bg-[#090d16] border border-purple-500/40 space-y-2 text-xs"
            >
              <span className="text-[10px] font-bold text-purple-300 block">Editar palavra #{editingWord.idx + 1}</span>
              <input
                autoFocus
                value={editingWord.text}
                onChange={e => setEditingWord({ ...editingWord, text: e.target.value })}
                placeholder="Digite o texto ou deixe vazio para remover"
                className="w-full px-2.5 py-1.5 rounded-lg bg-[#111827] border border-slate-700 text-white text-xs focus:outline-none focus:border-purple-500"
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => commitEditWord(true)}
                  className="px-2.5 py-1 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-300 text-[11px] font-bold"
                >
                  Remover
                </button>
                <button
                  type="button"
                  onClick={() => setEditingWord(null)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold"
                >
                  Salvar
                </button>
              </div>
            </form>
          )}

          <div className="max-h-[340px] overflow-y-auto flex flex-wrap gap-1.5 p-2.5 bg-[#090d16] rounded-xl border border-slate-800">
            {clip.words.length === 0 ? (
              <span className="text-xs text-slate-500">Nenhuma palavra transcrita neste trecho.</span>
            ) : (
              clip.words.map((w, idx) => {
                const isActive = idx === activeWordIdx;
                return (
                  <button
                    key={`${idx}-${w.start}`}
                    onClick={() => seekTo(w.start)}
                    onDoubleClick={() => handleEditWord(idx)}
                    className={`px-2 py-1 rounded-lg text-xs font-semibold border transition ${
                      isActive
                        ? "bg-emerald-500 text-black border-emerald-400 font-black scale-105"
                        : "bg-slate-900 text-slate-200 border-slate-800 hover:border-purple-500"
                    }`}
                  >
                    {w.text} {w.emoji || ""}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* CENTER: Real Video Player + Live Subtitles + Framing */}
        <div className="lg:col-span-4 flex flex-col items-center space-y-3 order-1 lg:order-2">
          <div className={`relative w-full ${aspectClass} bg-black rounded-3xl overflow-hidden border-2 border-slate-700 shadow-2xl`}>
            {/* Real streaming HTML5 video (Split / Three / Four / Single Frame) */}
            {videoErr ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center gap-2 bg-slate-950 text-slate-300">
                <AlertCircle className="w-7 h-7 text-red-400" />
                <p className="text-xs font-bold">Falha ao carregar o vídeo de preview</p>
                <button
                  onClick={() => { setVideoErr(false); loadClip(); }}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold"
                >
                  Recarregar
                </button>
              </div>
            ) : clip.layoutMode === "split" ? (
              <div className="absolute inset-0 flex flex-col">
                {/* Top 40%: Facecam Crop Preview */}
                <div className="relative h-[40%] w-full overflow-hidden border-b border-white/20 bg-black">
                  <video
                    ref={facecamVideoRef}
                    src={`/api/projects/${clip.projectId}/video`}
                    playsInline
                    muted
                    onError={() => setVideoErr(true)}
                    className="w-full h-full object-cover"
                    style={{
                      objectPosition: `${(clip.framing.camX ?? 0.15) * 100}% ${(clip.framing.camY ?? 0.8) * 100}%`,
                      transform: `scale(${Math.max(1.2, 1 / (clip.framing.camW ?? 0.28) * 0.55)})`,
                      transformOrigin: `${(clip.framing.camX ?? 0.15) * 100}% ${(clip.framing.camY ?? 0.8) * 100}%`,
                      filter: clip.autoColor?.enabled ? "contrast(1.08) saturate(1.14)" : undefined
                    }}
                  />
                  <span className="absolute top-1.5 left-2 bg-black/70 text-[9px] text-emerald-400 font-mono px-1.5 py-0.5 rounded z-10">
                    FACECAM ({Math.round((clip.framing.camX ?? 0.15) * 100)}%, {Math.round((clip.framing.camY ?? 0.8) * 100)}%)
                  </span>
                </div>
                {/* Bottom 60%: Gameplay */}
                <div className="relative h-[60%] w-full overflow-hidden bg-black">
                  <video
                    ref={videoRef}
                    src={`/api/projects/${clip.projectId}/video`}
                    playsInline
                    muted={muted}
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={() => setPlaying(false)}
                    onError={() => setVideoErr(true)}
                    className="w-full h-full object-cover"
                    style={{
                      filter: clip.autoColor?.enabled ? "contrast(1.08) saturate(1.14)" : undefined
                    }}
                  />
                </div>
              </div>
            ) : clip.layoutMode === "three" ? (
              <div className="absolute inset-0 flex flex-col">
                <div className="relative h-1/2 w-full overflow-hidden border-b border-white/20 bg-black">
                  <video
                    ref={videoRef}
                    src={`/api/projects/${clip.projectId}/video`}
                    playsInline
                    muted={muted}
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={() => setPlaying(false)}
                    onError={() => setVideoErr(true)}
                    className="w-full h-full object-cover"
                    style={{
                      objectPosition: `${(clip.framing.panX ?? 0.5) * 100}% ${(clip.framing.panY ?? 0.5) * 100}%`,
                      transform: `scale(${clip.framing.zoom || 1})`,
                      filter: clip.autoColor?.enabled ? "contrast(1.08) saturate(1.14)" : undefined
                    }}
                  />
                  <span className="absolute top-1.5 left-2 bg-black/70 text-[9px] text-purple-300 font-mono px-1.5 py-0.5 rounded z-10">PAINEL 1</span>
                </div>
                <div className="h-1/2 w-full grid grid-cols-2">
                  {[0, 1].map(idx => (
                    <div key={idx} className={`relative h-full overflow-hidden bg-black ${idx === 0 ? "border-r border-white/20" : ""}`}>
                      <video
                        ref={el => { auxVideoRefs.current[idx] = el; }}
                        src={`/api/projects/${clip.projectId}/video`}
                        playsInline
                        muted
                        onError={() => setVideoErr(true)}
                        className="w-full h-full object-cover"
                        style={{
                          objectPosition: idx === 0 ? "20% 50%" : "80% 50%",
                          transform: "scale(1.35)",
                          filter: clip.autoColor?.enabled ? "contrast(1.08) saturate(1.14)" : undefined
                        }}
                      />
                      <span className="absolute top-1 left-1.5 bg-black/70 text-[9px] text-emerald-300 font-mono px-1 py-0.5 rounded z-10">
                        PAINEL {idx + 2}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : clip.layoutMode === "four" ? (
              <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
                <div className="relative overflow-hidden border-r border-b border-white/20 bg-black">
                  <video
                    ref={videoRef}
                    src={`/api/projects/${clip.projectId}/video`}
                    playsInline
                    muted={muted}
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={() => setPlaying(false)}
                    onError={() => setVideoErr(true)}
                    className="w-full h-full object-cover"
                    style={{
                      objectPosition: "25% 25%",
                      transform: `scale(${Math.max(1.2, clip.framing.zoom || 1)})`,
                      filter: clip.autoColor?.enabled ? "contrast(1.08) saturate(1.14)" : undefined
                    }}
                  />
                  <span className="absolute top-1 left-1.5 bg-black/70 text-[9px] text-purple-300 font-mono px-1 py-0.5 rounded z-10">QUAD 1</span>
                </div>
                {[
                  { pos: "75% 25%", label: "QUAD 2", border: "border-b border-white/20" },
                  { pos: "25% 75%", label: "QUAD 3", border: "border-r border-white/20" },
                  { pos: "75% 75%", label: "QUAD 4", border: "" }
                ].map((q, idx) => (
                  <div key={q.label} className={`relative overflow-hidden bg-black ${q.border}`}>
                    <video
                      ref={el => { auxVideoRefs.current[idx] = el; }}
                      src={`/api/projects/${clip.projectId}/video`}
                      playsInline
                      muted
                      onError={() => setVideoErr(true)}
                      className="w-full h-full object-cover"
                      style={{
                        objectPosition: q.pos,
                        transform: "scale(1.3)",
                        filter: clip.autoColor?.enabled ? "contrast(1.08) saturate(1.14)" : undefined
                      }}
                    />
                    <span className="absolute top-1 left-1.5 bg-black/70 text-[9px] text-emerald-300 font-mono px-1 py-0.5 rounded z-10">{q.label}</span>
                  </div>
                ))}
              </div>
            ) : (
              <video
                ref={videoRef}
                src={`/api/projects/${clip.projectId}/video`}
                playsInline
                muted={muted}
                onTimeUpdate={handleTimeUpdate}
                onEnded={() => setPlaying(false)}
                onError={() => setVideoErr(true)}
                className={`absolute inset-0 w-full h-full ${clip.layoutMode === "fit" ? "object-contain" : "object-cover"}`}
                style={{
                  objectPosition: `${(clip.framing.panX ?? 0.5) * 100}% ${(clip.framing.panY ?? 0.5) * 100}%`,
                  transform: `scale(${clip.framing.zoom || 1})`,
                  filter: clip.autoColor?.enabled ? "contrast(1.08) saturate(1.14)" : undefined
                }}
              />
            )}

            {/* Progress Bar Overlay */}
            {clip.progressBar && (
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-black/50 z-20">
                <div className="h-full bg-[#04F827]" style={{ width: `${progressPct}%` }} />
              </div>
            )}

            {/* Headline Overlay */}
            {clip.headlineText && (
              <div className="absolute top-5 left-3 right-3 z-20 text-center">
                <span className="inline-block px-3 py-1 rounded-lg bg-black/75 text-white font-black text-xs uppercase tracking-wide shadow">
                  {clip.headlineText}
                </span>
              </div>
            )}

            {/* Brand Kit Watermark Preview */}
            {clip.brandKitId && (
              <img
                src={`/api/brand-kits/${clip.brandKitId}/logo`}
                alt="Logo"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                className="absolute top-3 right-3 w-12 h-12 object-contain z-20 opacity-90"
              />
            )}

            {/* Live Synchronized Karaoke Subtitles */}
            {clip.captionEnabled && visibleWords.length > 0 && (
              <div
                className="absolute left-3 right-3 z-20 text-center pointer-events-none px-2"
                style={{ top: `${posY * 100}%`, transform: "translateY(-50%)" }}
              >
                <div
                  className="inline-flex flex-wrap justify-center gap-1.5 font-black leading-tight drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)]"
                  style={{ fontSize: `${fontSize}px` }}
                >
                  {visibleWords.map(({ w, i }) => {
                    const active = i === activeWordIdx;
                    const txt = uppercase ? w.text.toUpperCase() : w.text;
                    const isBox = clip.captionPreset === "highlighter-box";
                    return (
                      <span
                        key={i}
                        style={{
                          color: active ? (isBox ? "#FFFFFF" : highlightColor) : primaryColor,
                          backgroundColor: active && isBox ? highlightColor : "transparent",
                          padding: isBox ? "2px 6px" : "0 2px",
                          borderRadius: "6px",
                          transform: active ? "scale(1.1)" : "scale(1)",
                          transition: "transform 80ms ease-out"
                        }}
                      >
                        {txt} {w.emoji || ""}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Bottom Controls */}
            <div className="absolute bottom-0 inset-x-0 z-20 p-3 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex items-center justify-between">
              <button onClick={togglePlay} className="w-9 h-9 rounded-full bg-purple-600 text-white flex items-center justify-center shadow-lg">
                {playing ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
              </button>
              <span className="text-[11px] font-mono text-white">
                {fmtTime(curTime - clip.startSec)} / {fmtTime(clipDuration)}
              </span>
              <button onClick={() => setMuted(!muted)} className="p-2 rounded-lg bg-white/10 text-white">
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Multitrack Timeline & Precision Trimming */}
          <div className="w-full bg-[#111827] border border-slate-800 rounded-2xl p-3 space-y-2.5 text-xs">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-bold text-white">Timeline Multitrack</span>
              <span className="font-mono">{fmtTime(clip.startSec)} → {fmtTime(clip.endSec)}</span>
            </div>
            <input
              type="range"
              min={clip.startSec}
              max={clip.endSec}
              step={0.05}
              value={Math.max(clip.startSec, Math.min(clip.endSec, curTime))}
              onChange={e => seekTo(parseFloat(e.target.value))}
              className="w-full accent-purple-500"
            />
            {/* Visual Track Lanes */}
            <div className="space-y-1 text-[10px] font-mono">
              <div className="h-5 rounded bg-purple-500/20 border border-purple-500/40 px-2 flex items-center text-purple-300">
                KeyFrameTrack ({clip.layoutMode} • {clip.aspectRatio})
              </div>
              <div className="h-5 rounded bg-emerald-500/20 border border-emerald-500/40 px-2 flex items-center text-emerald-300">
                CaptionTrack ({activePreset.name} • {clip.words.length} palavras)
              </div>
              {clip.headlineText && (
                <div className="h-5 rounded bg-amber-500/20 border border-amber-500/40 px-2 flex items-center text-amber-300">
                  TextOverlayTrack ({clip.headlineText})
                </div>
              )}
            </div>
            {/* Trim Start / End */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <label className="space-y-1">
                <span className="text-[10px] text-slate-400">Início ({clip.startSec.toFixed(1)}s)</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, clip.endSec - 3)}
                  step={0.5}
                  value={clip.startSec}
                  onChange={e => debouncedSaveChanges({ startSec: parseFloat(e.target.value) })}
                  className="w-full accent-emerald-500"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-slate-400">Fim ({clip.endSec.toFixed(1)}s)</span>
                <input
                  type="range"
                  min={clip.startSec + 3}
                  max={Math.max(clip.endSec, project.duration || clip.endSec)}
                  step={0.5}
                  value={clip.endSec}
                  onChange={e => debouncedSaveChanges({ endSec: parseFloat(e.target.value) })}
                  className="w-full accent-emerald-500"
                />
              </label>
            </div>
          </div>
        </div>

        {/* RIGHT: Inspector Tabs (Captions, Framing, Transitions/Motion, Overlays, AutoColor) */}
        <div className="lg:col-span-4 bg-[#111827] border border-slate-800 rounded-2xl p-3.5 space-y-3 order-3">
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1 border-b border-slate-800 text-[11px] font-bold">
            {[
              { id: "captions", label: "Legendas", icon: Type },
              { id: "framing", label: "Framing", icon: Layout },
              { id: "motion", label: "Transições", icon: Wand2 },
              { id: "overlays", label: "Overlays", icon: Sliders },
              { id: "color", label: "AutoColor", icon: Palette }
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setToolTab(t.id as any)}
                className={`px-2.5 py-1.5 rounded-lg flex items-center gap-1 whitespace-nowrap ${
                  toolTab === t.id ? "bg-purple-600 text-white" : "bg-slate-800/70 text-slate-400"
                }`}
              >
                <t.icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            ))}
          </div>

          {toolTab === "captions" && (
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white">Exibir Legendas</span>
                <input
                  type="checkbox"
                  checked={clip.captionEnabled}
                  onChange={e => saveChanges({ captionEnabled: e.target.checked })}
                  className="w-4 h-4 accent-purple-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-1.5 max-h-[210px] overflow-y-auto pr-1">
                {presets.map(p => (
                  <button
                    key={p.id}
                    onClick={() => saveChanges({
                      captionPreset: p.id,
                      captionConfig: { ...clip.captionConfig, highlightColor: p.highlight, primaryColor: p.primary, uppercase: p.uppercase }
                    })}
                    className={`p-2 rounded-xl border text-left transition ${
                      clip.captionPreset === p.id ? "border-emerald-500 bg-emerald-500/10" : "border-slate-800 bg-[#090d16]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-[11px]">{p.name}</span>
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: p.highlight }} />
                    </div>
                    <span className="text-[9px] text-slate-400">{p.source}</span>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Cor Destaque</span>
                  <input
                    type="color"
                    value={highlightColor}
                    onChange={e => debouncedSaveChanges({ captionConfig: { ...clip.captionConfig, highlightColor: e.target.value } })}
                    className="w-full h-8 rounded bg-transparent cursor-pointer"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Posição Vertical ({Math.round(posY * 100)}%)</span>
                  <input
                    type="range"
                    min={0.2}
                    max={0.88}
                    step={0.02}
                    value={posY}
                    onChange={e => debouncedSaveChanges({ captionConfig: { ...clip.captionConfig, positionY: parseFloat(e.target.value) } })}
                    className="w-full accent-purple-500"
                  />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-[11px] text-slate-400">Tamanho da Fonte ({fontSize}px)</span>
                <input
                  type="range"
                  min={14}
                  max={42}
                  step={1}
                  value={fontSize}
                  onChange={e => debouncedSaveChanges({ captionConfig: { ...clip.captionConfig, fontSize: parseInt(e.target.value, 10) } })}
                  className="w-full accent-purple-500"
                />
              </label>
            </div>
          )}

          {toolTab === "framing" && (
            <div className="space-y-3 text-xs">
              <div>
                <span className="text-[11px] text-slate-400 font-bold block mb-1.5">Proporção de Saída</span>
                <div className="grid grid-cols-4 gap-1.5">
                  {(["9:16", "4:5", "1:1", "16:9"] as const).map(ar => (
                    <button
                      key={ar}
                      onClick={() => saveChanges({ aspectRatio: ar })}
                      className={`py-2 rounded-xl border font-bold ${
                        clip.aspectRatio === ar ? "border-purple-500 bg-purple-500/20 text-white" : "border-slate-800 bg-[#090d16] text-slate-400"
                      }`}
                    >
                      {ar}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-[11px] text-slate-400 font-bold block mb-1.5">Modo de Layout</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["auto", "fill", "fit", "split", "three", "four"] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => saveChanges({ layoutMode: m })}
                      className={`py-2 rounded-xl border font-bold uppercase text-[11px] ${
                        clip.layoutMode === m ? "border-purple-500 bg-purple-500/20 text-white" : "border-slate-800 bg-[#090d16] text-slate-400"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-800">
                {clip.layoutMode === "split" ? (
                  <>
                    <span className="text-[11px] text-purple-300 font-bold block">Posição da Facecam (Modo Split)</span>
                    <div className="grid grid-cols-2 gap-1.5 pb-1">
                      {[
                        { label: "↖ Sup. Esquerdo", camX: 0.14, camY: 0.18 },
                        { label: "↗ Sup. Direito", camX: 0.86, camY: 0.18 },
                        { label: "↙ Inf. Esquerdo", camX: 0.14, camY: 0.82 },
                        { label: "↘ Inf. Direito", camX: 0.86, camY: 0.82 }
                      ].map(pos => (
                        <button
                          key={pos.label}
                          onClick={() => saveChanges({ framing: { ...clip.framing, camX: pos.camX, camY: pos.camY } })}
                          className="py-1.5 px-2 rounded-lg bg-[#090d16] border border-slate-700 hover:border-purple-500 text-[11px] font-semibold text-slate-200"
                        >
                          {pos.label}
                        </button>
                      ))}
                    </div>
                    <label className="block">
                      <span className="text-[11px] text-slate-400">Facecam Horizontal X ({Math.round((clip.framing.camX ?? 0.15) * 100)}%)</span>
                      <input type="range" min={0.05} max={0.95} step={0.01} value={clip.framing.camX ?? 0.15}
                        onChange={e => debouncedSaveChanges({ framing: { ...clip.framing, camX: parseFloat(e.target.value) } })}
                        className="w-full accent-emerald-500" />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-slate-400">Facecam Vertical Y ({Math.round((clip.framing.camY ?? 0.8) * 100)}%)</span>
                      <input type="range" min={0.05} max={0.95} step={0.01} value={clip.framing.camY ?? 0.8}
                        onChange={e => debouncedSaveChanges({ framing: { ...clip.framing, camY: parseFloat(e.target.value) } })}
                        className="w-full accent-emerald-500" />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-slate-400">Largura do Recorte da Câmera ({Math.round((clip.framing.camW ?? 0.28) * 100)}%)</span>
                      <input type="range" min={0.15} max={0.55} step={0.01} value={clip.framing.camW ?? 0.28}
                        onChange={e => {
                          const v = parseFloat(e.target.value);
                          debouncedSaveChanges({ framing: { ...clip.framing, camW: v, camH: Number(Math.min(0.6, v * 1.15).toFixed(2)) } });
                        }}
                        className="w-full accent-emerald-500" />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="block">
                      <span className="text-[11px] text-slate-400">Zoom ({(clip.framing.zoom || 1).toFixed(2)}x)</span>
                      <input type="range" min={1} max={2.5} step={0.05} value={clip.framing.zoom || 1}
                        onChange={e => debouncedSaveChanges({ framing: { ...clip.framing, zoom: parseFloat(e.target.value) } })}
                        className="w-full accent-purple-500" />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-slate-400">Horizontal Pan ({Math.round((clip.framing.panX ?? 0.5) * 100)}%)</span>
                      <input type="range" min={0} max={1} step={0.02} value={clip.framing.panX ?? 0.5}
                        onChange={e => debouncedSaveChanges({ framing: { ...clip.framing, panX: parseFloat(e.target.value) } })}
                        className="w-full accent-purple-500" />
                    </label>
                    <label className="block">
                      <span className="text-[11px] text-slate-400">Vertical Pan ({Math.round((clip.framing.panY ?? 0.5) * 100)}%)</span>
                      <input type="range" min={0} max={1} step={0.02} value={clip.framing.panY ?? 0.5}
                        onChange={e => debouncedSaveChanges({ framing: { ...clip.framing, panY: parseFloat(e.target.value) } })}
                        className="w-full accent-purple-500" />
                    </label>
                  </>
                )}
              </div>
            </div>
          )}

          {toolTab === "motion" && (
            <div className="space-y-3 text-xs">
              <div>
                <span className="text-[11px] text-slate-400 font-bold block mb-1.5">Transições Cinematográficas (10)</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {TRANSITIONS.map(tr => (
                    <button
                      key={tr}
                      onClick={() => saveChanges({ transitionType: tr })}
                      className={`py-2 px-2.5 rounded-xl border text-left capitalize font-semibold ${
                        clip.transitionType === tr ? "border-purple-500 bg-purple-500/20 text-white" : "border-slate-800 bg-[#090d16] text-slate-400"
                      }`}
                    >
                      {tr.replace(/-/g, " ")}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pt-2 border-t border-slate-800">
                <span className="text-[11px] text-slate-400 font-bold block mb-1.5">Movimento de Câmera (Motion)</span>
                <div className="space-y-1.5">
                  {MOTIONS.map(m => (
                    <button
                      key={m.id}
                      onClick={() => saveChanges({ motionType: m.id })}
                      className={`w-full py-2 px-3 rounded-xl border text-left font-semibold ${
                        clip.motionType === m.id ? "border-emerald-500 bg-emerald-500/15 text-emerald-300" : "border-slate-800 bg-[#090d16] text-slate-300"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {toolTab === "overlays" && (
            <div className="space-y-3 text-xs">
              <label className="block space-y-1">
                <span className="font-bold text-slate-300">Headline Viral (Banner no Topo)</span>
                <input
                  value={clip.headlineText}
                  onChange={e => setClip({ ...clip, headlineText: e.target.value })}
                  onBlur={() => saveChanges({ headlineText: clip.headlineText })}
                  placeholder="ex: OLHA O QUE ACONTECEU NO FINAL..."
                  className="w-full px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-white"
                />
              </label>
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#090d16] border border-slate-800">
                <span className="font-semibold text-slate-200">Barra de Progresso (Social Edit)</span>
                <input
                  type="checkbox"
                  checked={clip.progressBar}
                  onChange={e => saveChanges({ progressBar: e.target.checked })}
                  className="w-4 h-4 accent-emerald-500"
                />
              </div>
              <label className="block space-y-1">
                <span className="font-bold text-slate-300">Brand Kit / Logotipo Watermark</span>
                <select
                  value={clip.brandKitId}
                  onChange={e => saveChanges({ brandKitId: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-white"
                >
                  <option value="">Sem marca d'água</option>
                  {brandKits.map(bk => (
                    <option key={bk.id} value={bk.id}>{bk.name}</option>
                  ))}
                </select>
              </label>

              {/* BGM Music with Auto Audio Ducking */}
              <div className="p-3 rounded-xl bg-[#090d16] border border-slate-800 space-y-2">
                <span className="font-bold text-purple-300 block">🎵 Música de Fundo (BGM + Audio Ducking)</span>
                <p className="text-[10px] text-slate-400">O FFmpeg abaixa a música automaticamente quando alguém fala.</p>

                {bgmTrack && (
                  <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-purple-200 font-semibold truncate flex items-center gap-1.5">
                      <Music className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      {bgmTrack.name || "Trilha BGM anexada"}
                    </span>
                    <button
                      type="button"
                      disabled={bgmBusy}
                      onClick={async () => {
                        setBgmBusy(true);
                        setActionErr(null);
                        setActionMsg(null);
                        try {
                          const r = await api.removeBgm(clip.id);
                          setClip(r.clip);
                          setActionMsg("Música de fundo removida.");
                        } catch (e: unknown) {
                          setActionErr(e instanceof Error ? e.message : "Erro ao remover BGM.");
                        } finally {
                          setBgmBusy(false);
                        }
                      }}
                      className="px-2 py-1 rounded bg-red-600/20 hover:bg-red-600/30 text-red-300 text-[10px] font-bold flex items-center gap-1 shrink-0 disabled:opacity-50"
                    >
                      <Trash2 className="w-3 h-3" /> Remover
                    </button>
                  </div>
                )}

                <label className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold text-center cursor-pointer block">
                  {bgmBusy ? "Enviando áudio..." : bgmTrack ? "Trocar MP3 / WAV de Fundo" : "Enviar MP3 / WAV de Fundo"}
                  <input
                    ref={bgmInputRef}
                    type="file"
                    accept="audio/*"
                    disabled={bgmBusy}
                    className="hidden"
                    onChange={async e => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      setBgmBusy(true);
                      setActionErr(null);
                      setActionMsg(null);
                      try {
                        const r = await api.uploadBgm(clip.id, f, 0.22, true);
                        setClip(r.clip);
                        setActionMsg(`Música "${f.name}" anexada com Audio Ducking!`);
                      } catch (err: unknown) {
                        setActionErr(err instanceof Error ? err.message : "Erro ao enviar música de fundo.");
                      } finally {
                        setBgmBusy(false);
                        if (bgmInputRef.current) bgmInputRef.current.value = "";
                      }
                    }}
                  />
                </label>
              </div>

              {/* AI Caption Translation */}
              <div className="p-3 rounded-xl bg-[#090d16] border border-slate-800 space-y-2">
                <span className="font-bold text-emerald-300 block">🌍 Traduzir Legendas com IA</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {["English", "Español", "Português"].map(lang => (
                    <button
                      key={lang}
                      disabled={translatingLang !== null}
                      onClick={async () => {
                        setTranslatingLang(lang);
                        setActionErr(null);
                        setActionMsg(null);
                        try {
                          const r = await api.translateClip(clip.id, lang);
                          setClip(prev => (prev ? { ...prev, words: r.words } : prev));
                          setActionMsg(`Legendas traduzidas para ${lang}!`);
                        } catch (e: unknown) {
                          setActionErr(e instanceof Error ? e.message : "Erro ao traduzir legendas.");
                        } finally {
                          setTranslatingLang(null);
                        }
                      }}
                      className="py-1.5 rounded-lg bg-slate-800 hover:bg-emerald-600/30 border border-slate-700 text-[11px] font-bold text-white disabled:opacity-50"
                    >
                      {translatingLang === lang ? "..." : lang}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {toolTab === "color" && (
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#090d16] border border-slate-800">
                <span className="font-bold text-white">Ativar AutoColor (FFmpeg Filters)</span>
                <input
                  type="checkbox"
                  checked={Boolean(clip.autoColor?.enabled)}
                  onChange={e => saveChanges({ autoColor: { ...clip.autoColor, enabled: e.target.checked } })}
                  className="w-4 h-4 accent-purple-500"
                />
              </div>
              <label className="block">
                <span className="text-[11px] text-slate-400">Nitidez / Sharpen ({clip.autoColor?.sharpen ?? 0.5})</span>
                <input type="range" min={0} max={1.5} step={0.1} value={clip.autoColor?.sharpen ?? 0.5}
                  onChange={e => debouncedSaveChanges({ autoColor: { ...clip.autoColor, sharpen: parseFloat(e.target.value) } })}
                  className="w-full accent-purple-500" />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-400">Redução de Ruído / Denoise ({clip.autoColor?.denoise ?? 0})</span>
                <input type="range" min={0} max={1} step={0.1} value={clip.autoColor?.denoise ?? 0}
                  onChange={e => debouncedSaveChanges({ autoColor: { ...clip.autoColor, denoise: parseFloat(e.target.value) } })}
                  className="w-full accent-purple-500" />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-400">Suavização de Blocos / Deblock ({clip.autoColor?.deblock ?? 0})</span>
                <input type="range" min={0} max={1} step={0.1} value={clip.autoColor?.deblock ?? 0}
                  onChange={e => debouncedSaveChanges({ autoColor: { ...clip.autoColor, deblock: parseFloat(e.target.value) } })}
                  className="w-full accent-purple-500" />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-400">Brilho / Glow ({clip.autoColor?.glow ?? 0})</span>
                <input type="range" min={0} max={1} step={0.1} value={clip.autoColor?.glow ?? 0}
                  onChange={e => debouncedSaveChanges({ autoColor: { ...clip.autoColor, glow: parseFloat(e.target.value) } })}
                  className="w-full accent-purple-500" />
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Real FFmpeg Export Modal */}
      {showExport && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111827] border border-slate-700 rounded-2xl p-5 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-extrabold text-white">Exportar Vídeo Real (FFmpeg)</h3>
              <button onClick={() => setShowExport(false)} className="text-slate-400 hover:text-white text-sm">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="space-y-1">
                <span className="font-bold text-slate-300">Resolução</span>
                <select value={exportRes} onChange={e => setExportRes(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-white">
                  <option value="1080p">Full HD (1080p)</option>
                  <option value="720p">HD (720p — mais rápido)</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="font-bold text-slate-300">Frame Rate</span>
                <select value={exportFps} onChange={e => setExportFps(Number(e.target.value))} className="w-full px-3 py-2 rounded-xl bg-[#090d16] border border-slate-700 text-white">
                  <option value={30}>30 fps</option>
                  <option value={60}>60 fps</option>
                </select>
              </label>
            </div>

            {clip.exportStatus === "rendering" && (
              <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-300 text-xs flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>Renderizando MP4 com legendas .ASS, reframe e filtros no FFmpeg...</span>
              </div>
            )}

            {clip.exportStatus === "done" && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-bold"><CheckCircle2 className="w-4 h-4" /> Vídeo pronto!</span>
                <a href={`/api/clips/${clip.id}/download`} className="px-3 py-1.5 rounded-lg bg-emerald-500 text-black font-black">
                  Baixar MP4
                </a>
              </div>
            )}

            {clip.exportStatus === "error" && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{clip.exportError}</span>
              </div>
            )}

            <button
              onClick={triggerRender}
              disabled={renderBusy || clip.exportStatus === "rendering"}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-black font-black text-xs disabled:opacity-50"
            >
              {renderBusy ? "Iniciando..." : clip.exportStatus === "rendering" ? "Renderizando..." : "Iniciar Renderização FFmpeg"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
